"""
modules/finance/payables_v1.py
==============================
Accounts Payable (hutang usaha) -- sisi AP dari halaman Accounts Payable.
Router: /api/v1/finance/payables/...   (kontrak = src/lib/receivablesPayablesStore.ts, side 'ap')

Sumber data: Purchase Transaction berstatus 'posted'
(financial_transaction_purchase_transactions) -- termasuk bill hasil Create Bill
(purchase_bill_v1.py) setelah Approve -> Post di tab Purchase Preview.
Jadi bill yang diposting OTOMATIS muncul di sini, tanpa kode tambahan.

Aturan hitung (mengikuti modul rekonsiliasi bank, bank_reconciliation_v1.py):
  total        = total bill (nominal tagihan awal)
  outstanding  = accounts_payable bill = SISA hutang. Kolom ini berkurang otomatis (trigger DB
                 fn_bcp_apply) saat pembayaran di financial_transaction_bank_cash_payments diposting
  paid         = total - outstanding
  in_process   = pembayaran yang sudah dicatat tapi belum diposting (applied_at kosong)
  available    = outstanding - in_process
  due_date     = due_date bill; kalau kosong dihitung dari payment_terms ("Net 30", "30 days";
                 tanpa angka / "COD" = jatuh tempo di tanggal invoice) dan ditandai due_date_estimated
  tanggal      = invoice_date, fallback purchase_date
  umur         = as_of - due_date; bucket: current, 1_30, 31_60, 61_90, 91_plus

BATASAN: Record Payment dari halaman AP (endpoint /settlements tulis) BELUM tersedia -- pelunasan
sekarang dicatat lewat Cash & Bank > Reconciliation, dan hasilnya otomatis terbaca di sini.
Endpoint /settlements mengembalikan daftar kosong dan aksi tulisnya 501 dengan pesan jelas.
"""

from __future__ import annotations

import calendar
import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("finance_payables_v1")

router = APIRouter(prefix="/api/v1/finance/payables", tags=["finance-payables-v1"])

BUCKETS = ["current", "1_30", "31_60", "61_90", "91_plus"]
_BATAS_BUCKET = [(30, "1_30"), (60, "31_60"), (90, "61_90")]


# ============================================================
# Helper
# ============================================================

def _f(v: Any) -> float:
    return round(float(Decimal(str(v if v is not None else 0))), 2)


def _hari_terakhir(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def _geser_bulan(d: date, n: int) -> date:
    """Awal bulan d digeser n bulan."""
    idx = d.year * 12 + (d.month - 1) + n
    return date(idx // 12, idx % 12 + 1, 1)


def _hari_termin(termin: Optional[str]) -> int:
    m = re.search(r"\d+", termin or "")
    return int(m.group()) if m else 0


def _bucket(hari_lewat: int) -> str:
    if hari_lewat <= 0:
        return "current"
    for batas, nama in _BATAS_BUCKET:
        if hari_lewat <= batas:
            return nama
    return "91_plus"


def _pembayaran_per_bill(session, tx_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """{bill_id: {"pending": float, "last_date": date|None}} dari financial_transaction_bank_cash_payments.
    pending = pembayaran belum diposting (applied_at kosong); last_date = tanggal bayar terakhir yang
    sudah diposting. Tabel ini dikelola modul rekonsiliasi bank (DDL-nya tidak ada di ORM). Kalau
    tabel belum ada di database, AP tetap jalan tanpa info ini (SAVEPOINT supaya sesi tidak rusak)."""
    if not tx_ids:
        return {}
    try:
        with session.begin_nested():
            rows = session.execute(text("""
                select purchase_transaction_id::text as id,
                       coalesce(sum(amount) filter (where applied_at is null), 0) as pending,
                       max(payment_date) filter (where applied_at is not null) as last_date
                  from financial_transaction_bank_cash_payments
                 where purchase_transaction_id = any(cast(:ids as uuid[])) and deleted_at is null
                 group by purchase_transaction_id
            """), {"ids": list(tx_ids)}).mappings().all()
    except Exception:  # noqa: BLE001
        logger.warning("Tabel pembayaran (bank_cash_payments) tidak terbaca -- AP tanpa info pembayaran.", exc_info=True)
        return {}
    return {r["id"]: {"pending": _f(r["pending"]), "last_date": r["last_date"]} for r in rows}


def _dibayar_per_bulan(session, client_id: str) -> Dict[str, float]:
    """{'YYYY-MM': total pembayaran hutang yang SUDAH diposting} dari tabel pembayaran (kosong kalau tabel tak terbaca)."""
    try:
        with session.begin_nested():
            rows = session.execute(text("""
                select to_char(payment_date, 'YYYY-MM') as bln, sum(amount) as jml
                  from financial_transaction_bank_cash_payments
                 where client_id = cast(:c as uuid) and direction = 'cash_payment'
                   and purchase_transaction_id is not null and applied_at is not null and deleted_at is null
                 group by 1
            """), {"c": client_id}).mappings().all()
    except Exception:  # noqa: BLE001
        logger.warning("Tabel pembayaran tidak terbaca -- 'collected' = 0.", exc_info=True)
        return {}
    return {r["bln"]: _f(r["jml"]) for r in rows}


def _susun_docs(session, client_id: str, as_of: date) -> List[Dict[str, Any]]:
    PT = dbc.PurchaseTransaction
    rows = session.query(PT).filter(
        PT.management_client_id == client_id,
        PT.deleted_at.is_(None),
        PT.status == "posted",
    ).order_by(PT.purchase_date, PT.purchase_no).all()
    pelunasan = _pembayaran_per_bill(session, [r.id for r in rows])

    docs: List[Dict[str, Any]] = []
    for r in rows:
        tgl = r.invoice_date or r.purchase_date
        if tgl is None or tgl > as_of:
            continue
        total = _f(r.total if r.total is not None else r.accounts_payable)
        sisa = _f(r.accounts_payable if r.accounts_payable is not None else r.total)
        outstanding = min(max(sisa, 0.0), total)
        paid = round(total - outstanding, 2)
        info = pelunasan.get(r.id) or {}
        in_process = min(_f(info.get("pending", 0)), outstanding)

        estimasi = r.due_date is None
        jatuh_tempo = r.due_date or (tgl + timedelta(days=_hari_termin(r.payment_terms)))
        hari_lewat = max(0, (as_of - jatuh_tempo).days) if outstanding > 0 else 0
        akun = dbc.akun_posting_purchase(r)["ap"]
        if outstanding <= 0:
            status = "paid"
        elif hari_lewat > 0:
            status = "overdue"
        elif paid > 0:
            status = "partial"
        else:
            status = "open"
        docs.append({
            "id": r.id,
            "no": (r.invoice_number or "").strip() or r.purchase_no,
            "ref_no": r.purchase_no,
            "party": (r.vendor_name or "").strip(),
            "party_tax_id": None,
            "date": tgl.isoformat(),
            "due_date": jatuh_tempo.isoformat(),
            "due_date_estimated": estimasi,
            "total": total,
            "paid": paid,
            "outstanding": outstanding,
            "in_process": in_process,
            "available": round(outstanding - in_process, 2),
            "days_overdue": hari_lewat,
            "bucket": _bucket((as_of - jatuh_tempo).days) if outstanding > 0 else None,
            "status": status,
            "account_code": akun[0] or "",
            "account_name": akun[1] or "",
            "description": r.description,
            "last_payment_date": info["last_date"].isoformat() if info.get("last_date") else None,
        })
    return docs


def _parse_tgl(v: Optional[str], default: date) -> date:
    if not v:
        return default
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        return default


def _hitung_kpi(docs: List[Dict[str, Any]]) -> Dict[str, Any]:
    terbuka = [d for d in docs if d["outstanding"] > 0]
    telat = [d for d in terbuka if d["days_overdue"] > 0]
    return {
        "total_outstanding": round(sum(d["outstanding"] for d in terbuka), 2),
        "overdue": round(sum(d["outstanding"] for d in telat), 2),
        "open_count": len(terbuka),
        "overdue_count": len(telat),
        "parties": len({d["party"] for d in terbuka}),
    }


def _gagal_db(pesan: str, exc: Exception):
    logger.exception(pesan)
    return gagal(message=f"{pesan} (database error).", status_code=500)


# ============================================================
# Endpoints
# ============================================================

@router.get("/overview", summary="Ringkasan AP: KPI, aging, top vendor terlambat, tren")
def overview(
    client_id: str = Query(...), as_of: Optional[str] = Query(None), months: int = Query(6, ge=1, le=24),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        akhir = _parse_tgl(as_of, date.today())
        sebelumnya = _geser_bulan(akhir, 0) - timedelta(days=1)  # akhir bulan lalu
        docs = _susun_docs(session, client_id, akhir)
        docs_lalu = _susun_docs(session, client_id, sebelumnya)
        k, kl = _hitung_kpi(docs), _hitung_kpi(docs_lalu)
        dibayar = _dibayar_per_bulan(session, client_id)
        bln_ini, bln_lalu = akhir.strftime("%Y-%m"), _geser_bulan(akhir, -1).strftime("%Y-%m")

        aging = []
        for b in BUCKETS:
            isi = [d for d in docs if d["bucket"] == b]
            aging.append({"bucket": b, "amount": round(sum(d["outstanding"] for d in isi), 2), "count": len(isi)})

        per_vendor: Dict[str, Dict[str, Any]] = {}
        for d in docs:
            if d["outstanding"] > 0 and d["days_overdue"] > 0:
                v = per_vendor.setdefault(d["party"], {"party": d["party"], "amount": 0.0, "count": 0, "max_days": 0, "bucket": "1_30"})
                v["amount"] = round(v["amount"] + d["outstanding"], 2)
                v["count"] += 1
                v["max_days"] = max(v["max_days"], d["days_overdue"])
                v["bucket"] = _bucket(v["max_days"])
        top = sorted(per_vendor.values(), key=lambda x: x["amount"], reverse=True)[:5]

        tren = []
        for i in range(months - 1, -1, -1):
            awal = _geser_bulan(akhir, -i)
            ujung = min(_hari_terakhir(awal), akhir)
            bulan_ini = [d for d in docs if d["date"][:7] == awal.strftime("%Y-%m")]
            sampai = [d for d in docs if d["date"] <= ujung.isoformat() and d["outstanding"] > 0]
            tren.append({
                "month": awal.strftime("%Y-%m"),
                "invoiced": round(sum(d["total"] for d in bulan_ini), 2),
                "collected": dibayar.get(awal.strftime("%Y-%m"), 0.0),
                "balance": round(sum(d["outstanding"] for d in sampai), 2),
            })

        return sukses(data={
            "as_of": akhir.isoformat(),
            "previous_as_of": sebelumnya.isoformat(),
            "kpi": {
                "total_outstanding": k["total_outstanding"], "total_outstanding_prev": kl["total_outstanding"],
                "overdue": k["overdue"], "overdue_prev": kl["overdue"],
                "collected_month": dibayar.get(bln_ini, 0.0), "collected_prev_month": dibayar.get(bln_lalu, 0.0),
                "avg_days_to_settle": None, "avg_days_to_settle_prev": None,
                "parties_with_balance": k["parties"], "parties_with_balance_prev": kl["parties"],
                "open_count": k["open_count"], "overdue_count": k["overdue_count"],
            },
            "aging": aging, "top_overdue": top, "trend": tren, "pending": {},
        }, message="OK")
    except Exception as exc:  # noqa: BLE001
        return _gagal_db("Failed to load AP overview", exc)
    finally:
        session.close()


@router.get("/invoices", summary="Daftar bill (hutang) dari Purchase yang sudah posted")
def daftar_bill(
    client_id: str = Query(...), as_of: Optional[str] = Query(None), party: Optional[str] = Query(None),
    only_open: bool = Query(False), exclude_settlement: Optional[str] = Query(None),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        docs = _susun_docs(session, client_id, _parse_tgl(as_of, date.today()))
        if party:
            docs = [d for d in docs if d["party"].strip().lower() == party.strip().lower()]
        if only_open:
            docs = [d for d in docs if d["outstanding"] > 0]
        return sukses(data=sorted(docs, key=lambda d: (d["due_date"], d["no"])), message="OK")
    except Exception as exc:  # noqa: BLE001
        return _gagal_db("Failed to load payables", exc)
    finally:
        session.close()


@router.get("/aging", summary="Laporan umur hutang per vendor")
def aging(
    client_id: str = Query(...), as_of: Optional[str] = Query(None),
    include_zero: bool = Query(False), include_details: bool = Query(False),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        akhir = _parse_tgl(as_of, date.today())
        docs = _susun_docs(session, client_id, akhir)
        per: Dict[str, Dict[str, Any]] = {}
        for d in docs:
            r = per.setdefault(d["party"], {
                "party": d["party"], "party_tax_id": d["party_tax_id"],
                "buckets": {b: 0.0 for b in BUCKETS}, "total": 0.0, "invoice_count": 0, "open_count": 0, "invoices": [],
            })
            r["invoice_count"] += 1
            if d["outstanding"] > 0:
                r["open_count"] += 1
                r["buckets"][d["bucket"]] = round(r["buckets"][d["bucket"]] + d["outstanding"], 2)
                r["total"] = round(r["total"] + d["outstanding"], 2)
                if include_details:
                    r["invoices"].append(d)
        rows = [r for r in per.values() if include_zero or r["total"] > 0]
        rows.sort(key=lambda r: r["total"], reverse=True)
        totals = {b: round(sum(r["buckets"][b] for r in rows), 2) for b in BUCKETS}
        return sukses(data={
            "as_of": akhir.isoformat(), "rows": rows,
            "totals": {"buckets": totals, "total": round(sum(totals.values()), 2)},
        }, message="OK")
    except Exception as exc:  # noqa: BLE001
        return _gagal_db("Failed to load AP aging", exc)
    finally:
        session.close()


@router.get("/parties", summary="Daftar vendor yang punya bill posted")
def parties(client_id: str = Query(...), _user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        docs = _susun_docs(session, client_id, date.today())
        per: Dict[str, Dict[str, Any]] = {}
        for d in docs:
            p = per.setdefault(d["party"], {
                "name": d["party"], "tax_id": d["party_tax_id"], "invoice_count": 0, "open_count": 0, "outstanding": 0.0, "overdue": 0.0,
            })
            p["invoice_count"] += 1
            if d["outstanding"] > 0:
                p["open_count"] += 1
                p["outstanding"] = round(p["outstanding"] + d["outstanding"], 2)
                if d["days_overdue"] > 0:
                    p["overdue"] = round(p["overdue"] + d["outstanding"], 2)
        return sukses(data=sorted(per.values(), key=lambda p: p["name"].lower()), message="OK")
    except Exception as exc:  # noqa: BLE001
        return _gagal_db("Failed to load vendors", exc)
    finally:
        session.close()


@router.get("/statement", summary="Statement hutang 1 vendor")
def statement(
    client_id: str = Query(...), party: str = Query(...), date_from: str = Query(...), date_to: str = Query(...),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        dari, sampai = _parse_tgl(date_from, date.today()), _parse_tgl(date_to, date.today())
        semua = [d for d in _susun_docs(session, client_id, sampai) if d["party"].strip().lower() == party.strip().lower()]
        awal = round(sum(d["total"] for d in semua if d["date"] < dari.isoformat()), 2)  # dibayar (paid) dikurangkan di bawah
        awal -= round(sum(d["paid"] for d in semua if d["date"] < dari.isoformat()), 2)
        saldo = awal
        lines: List[Dict[str, Any]] = []
        charges = settlements = 0.0
        for d in [x for x in semua if x["date"] >= dari.isoformat()]:
            saldo = round(saldo + d["total"], 2)
            charges = round(charges + d["total"], 2)
            lines.append({"date": d["date"], "type": "bill", "number": d["no"], "description": d["description"] or f"Bill {d['ref_no']}",
                          "due_date": d["due_date"], "charge": d["total"], "settlement": 0.0, "balance": saldo})
            if d["paid"] > 0:
                saldo = round(saldo - d["paid"], 2)
                settlements = round(settlements + d["paid"], 2)
                lines.append({"date": d["last_payment_date"] or d["date"], "type": "settled_outside", "number": d["no"],
                              "description": f"Paid - {d['no']}", "due_date": None, "charge": 0.0, "settlement": d["paid"], "balance": saldo})
        terbuka = [d for d in semua if d["outstanding"] > 0]
        aging_p = {b: round(sum(d["outstanding"] for d in terbuka if d["bucket"] == b), 2) for b in BUCKETS}
        return sukses(data={
            "party": party, "party_tax_id": None, "date_from": dari.isoformat(), "date_to": sampai.isoformat(),
            "opening_balance": round(awal, 2), "closing_balance": saldo,
            "total_charges": charges, "total_settlements": settlements,
            "lines": lines, "aging": aging_p, "open_invoices": terbuka,
        }, message="OK")
    except Exception as exc:  # noqa: BLE001
        return _gagal_db("Failed to load vendor statement", exc)
    finally:
        session.close()


# ============================================================
# Pembayaran (settlements) -- BELUM tersedia, lihat catatan di docstring modul
# ============================================================

_PESAN_BELUM = ("Record Payment is not available yet: the Cash & Bank backend is not part of this project, "
                "so payments cannot be stored or posted.")


def _belum_tersedia():
    return gagal(message=_PESAN_BELUM, errors={"code": "NOT_AVAILABLE"}, status_code=501)


@router.get("/settlements", summary="Daftar pembayaran hutang (belum tersedia -> kosong)")
def daftar_pembayaran(client_id: str = Query(...), status: Optional[str] = Query(None),
                      _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return sukses(data=[], message="OK")


@router.get("/settlements/next-number", summary="Nomor pembayaran berikutnya")
def nomor_pembayaran(client_id: str = Query(...), tanggal: Optional[str] = Query(None, alias="date"),
                     _user: Dict[str, Any] = Depends(get_current_user_v1)):
    tahun = (tanggal or "")[:4] if (tanggal or "")[:4].isdigit() else str(date.today().year)
    return sukses(data={"number": f"PAY/{tahun}/0001"}, message="OK")


@router.get("/settlements/{settlement_id}", summary="Detail pembayaran (belum tersedia)")
def detail_pembayaran(settlement_id: str, client_id: str = Query(...), _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return gagal(message="Payment not found.", errors={"code": "NOT_FOUND"}, status_code=404)


@router.post("/settlements", summary="Buat pembayaran (belum tersedia)")
def buat_pembayaran(_user: Dict[str, Any] = Depends(get_current_user_v1)):
    return _belum_tersedia()


@router.put("/settlements/{settlement_id}", summary="Edit pembayaran (belum tersedia)")
def edit_pembayaran(settlement_id: str, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return _belum_tersedia()


@router.post("/settlements/{settlement_id}/submit", summary="Submit pembayaran (belum tersedia)")
def submit_pembayaran(settlement_id: str, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return _belum_tersedia()


@router.post("/settlements/{settlement_id}/reverse", summary="Reverse pembayaran (belum tersedia)")
def reverse_pembayaran(settlement_id: str, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return _belum_tersedia()


@router.delete("/settlements/{settlement_id}", summary="Hapus pembayaran (belum tersedia)")
def hapus_pembayaran(settlement_id: str, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    return _belum_tersedia()