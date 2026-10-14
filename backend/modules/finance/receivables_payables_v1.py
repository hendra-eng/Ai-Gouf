"""
modules/finance/receivables_payables_v1.py
==========================================
Accounts Receivable  -> /api/v1/finance/receivables/...  (piutang usaha atas invoice Sales)
Accounts Payable     -> /api/v1/finance/payables/...     (hutang dagang atas Purchase)

Kedua menu memakai logika yang sama, dibedakan lewat konfigurasi `Sisi`:

    AR: dokumen = financial_transaction_sales_invoices posting_status 'Posted'
        nilai = gross_amount, akun = akun piutang invoice (SalesAccountMapping,
        fallback default akun sales klien), pihak = customer_name.
    AP: dokumen = financial_transaction_purchase_transactions status 'posted'
        nilai = accounts_payable (fallback total), akun = ap_account_code
        (db_client.akun_posting_purchase), pihak = vendor_name.

TIDAK ADA tabel buku pembantu terpisah. Saldo per dokumen dihitung dari:
    total dokumen
  - pelunasan lewat transaksi Cash & Bank (baris sales_invoice / purchase),
    termasuk yang dibuat dari Record Receipt / Record Payment di sini
  - pelunasan di luar Cash & Bank (AR: sisa Sales.paid_amount yang tidak
    berasal dari Cash & Bank, mis. penjualan tunai saat import; AP:
    payment_status 'paid' yang ditandai manual) -- dianggap lunas di tanggal
    dokumen.
Setiap pelunasan punya tanggal (tx_date, dan reversal_date kalau dibalik),
jadi saldo, aging, dan statement bisa dihitung "per tanggal" (as_of).

Record Receipt / Record Payment = transaksi Cash & Bank source 'ar' / 'ap'
(migrations/37-add_ar_ap_settlement_columns.py menambah payment_method,
reference_date, currency). Validasi baris, jurnal, pelunasan invoice, kunci
periode, dan GL/FS (sumber "cash_bank") memakai jalur yang sama dengan
modules/transactions/bank_cash_v1.py:
    Save Draft  -> status draft (Supervisor+)
    Submit      -> Manager+: langsung posted; Supervisor: approved (menunggu
                   Post oleh Manager di sini atau di Cash & Bank Journal Preview)
    Reverse     -> jurnal pembalik RV-<no> + pelunasan dibatalkan (Manager+)

Aging berdasarkan JATUH TEMPO (due_date; kalau kosong = tanggal dokumen +
angka hari di termin pembayaran, mis. "Net 30"; tanpa termin = tanggal dokumen).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func

import db_client as dbc
from ..api_response import sukses
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_v1 as bc

logger = get_module_logger("finance_receivables_payables_v1")

LEVEL_INPUT = bc.LEVEL_INPUT   # Supervisor+: draft, ubah, hapus, submit (-> approved)
LEVEL_POST = bc.LEVEL_POST     # Manager+: submit langsung posted, post, reverse
NOL = bc.NOL
TOL = bc.TOLERANSI

TX, TL, SI, PT, MU = bc.TX, bc.TL, bc.SI, bc.PT, bc.MU

METODE_BAYAR = ("bank_transfer", "cash", "cheque", "giro", "virtual_account", "credit_card", "other")
BUCKETS = ("current", "1_30", "31_60", "61_90", "91_plus")
_Gagal = bc._Gagal


@dataclass(frozen=True)
class Sisi:
    kode: str          # ar / ap
    arah: str          # receipt / payment
    line_type: str     # sales_invoice / purchase
    kolom: str         # kolom FK di transaction_lines
    awalan: str        # RCV / PAY
    dokumen: str       # invoice / bill (untuk pesan)
    pihak: str         # customer / vendor
    aksi: str          # Receipt / Payment


AR = Sisi("ar", "receipt", "sales_invoice", "sales_invoice_id", "RCV", "invoice", "customer", "Receipt")
AP = Sisi("ap", "payment", "purchase", "purchase_transaction_id", "PAY", "bill", "vendor", "Payment")


# ============================================================
# BUKU PEMBANTU (dihitung dari dokumen + pelunasan)
# ============================================================

@dataclass
class Pelunasan:
    tanggal: date
    nilai: Decimal
    tx_id: str
    tx_number: str
    status: str
    reversal_date: Optional[date]


@dataclass
class Dok:
    id: str
    no: str
    ref_no: Optional[str]
    pihak: str
    npwp: Optional[str]
    tanggal: date
    jatuh_tempo: date
    tempo_perkiraan: bool
    total: Decimal
    akun_kode: str
    akun_nama: str
    keterangan: Optional[str]
    lain: Decimal = NOL                      # lunas di luar Cash & Bank (dianggap di tanggal dokumen)
    pelunasan: List[Pelunasan] = field(default_factory=list)
    pending: Decimal = NOL                   # alokasi draft/approved (belum mengubah saldo)

    def dibayar(self, per: date) -> Decimal:
        n = self.lain if self.tanggal <= per else NOL
        for p in self.pelunasan:
            if p.tanggal <= per:
                n += p.nilai
            if p.reversal_date and p.reversal_date <= per:
                n -= p.nilai
        return n

    def sisa(self, per: date) -> Decimal:
        if self.tanggal > per:
            return NOL
        s = self.total - self.dibayar(per)
        return s if s > TOL else NOL

    def telat(self, per: date) -> int:
        return (per - self.jatuh_tempo).days

    def bayar_terakhir(self, per: date) -> Optional[date]:
        t = [p.tanggal for p in self.pelunasan if p.tanggal <= per and not (p.reversal_date and p.reversal_date <= per)]
        return max(t) if t else None


def _bucket(hari: int) -> str:
    if hari <= 0:
        return "current"
    if hari <= 30:
        return "1_30"
    if hari <= 60:
        return "31_60"
    if hari <= 90:
        return "61_90"
    return "91_plus"


def _status(d: Dok, per: date) -> str:
    if d.sisa(per) <= NOL:
        return "paid"
    if d.telat(per) > 0:
        return "overdue"
    return "partial" if d.dibayar(per) > TOL else "open"


def _hari_termin(teks: Optional[str]) -> Optional[int]:
    s = (teks or "").strip().lower()
    if not s:
        return None
    if s in ("cod", "cash", "tunai", "cbd", "due on receipt"):
        return 0
    m = re.search(r"(\d{1,3})", s)
    return int(m.group(1)) if m else None


def _jatuh_tempo(tgl: date, due: Optional[date], termin: Optional[str]) -> Tuple[date, bool]:
    if due:
        return due, False
    hari = _hari_termin(termin)
    return (tgl + timedelta(days=hari) if hari else tgl), True


def _norm_pihak(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).upper()


def _muat_pelunasan(session, kid: str, sisi: Sisi, docs: Dict[str, Dok], kecuali_tx: Optional[str]) -> None:
    kolom = getattr(TL, sisi.kolom)
    q = session.query(kolom, TX.id, TX.tx_number, TX.status, TX.direction, TX.tx_date, TX.reversal_date,
                      func.sum(TL.debit), func.sum(TL.credit)).join(TX, TX.id == TL.transaction_id).filter(
        TX.client_id == kid, TX.deleted_at.is_(None), kolom.isnot(None),
        TX.status.in_(("draft", "approved", "posted", "reversed")),
    ).group_by(kolom, TX.id, TX.tx_number, TX.status, TX.direction, TX.tx_date, TX.reversal_date)
    for doc_id, tx_id, nomor, status, arah, tgl, tgl_balik, deb, kre in q.all():
        d = docs.get(str(doc_id))
        if d is None:
            continue
        nilai = bc._dec(kre) - bc._dec(deb) if arah == "receipt" else bc._dec(deb) - bc._dec(kre)
        if status in ("draft", "approved"):
            if str(tx_id) != (kecuali_tx or ""):
                d.pending += nilai
            continue
        d.pelunasan.append(Pelunasan(tgl, nilai, str(tx_id), nomor, status, tgl_balik if status == "reversed" else None))


def _muat_dokumen(session, kid: str, sisi: Sisi, kecuali_tx: Optional[str] = None) -> List[Dok]:
    hasil: Dict[str, Dok] = {}
    if sisi.kode == "ar":
        rows = session.query(SI).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None), func.lower(SI.posting_status) == "posted",
        ).all()
        mapping = {}
        if rows:
            for m in session.query(dbc.SalesAccountMapping).filter(
                dbc.SalesAccountMapping.invoice_id.in_([r.id for r in rows]), dbc.SalesAccountMapping.deleted_at.is_(None),
            ).all():
                if m.piutang_account_code:
                    mapping[str(m.invoice_id)] = (m.piutang_account_code, m.piutang_account_name or "")
        cache: Dict[Any, Any] = {}
        for r in rows:
            akun = mapping.get(str(r.id))
            if akun is None:
                kunci = (r.management_client_id, (r.cabang or "").upper())
                if kunci not in cache:
                    cache[kunci] = dbc.akun_default_sales(r.management_client_id, r.cabang, session=session) or {}
                a = cache[kunci].get("piutang") or dbc._AKUN_DEFAULT_SALES["piutang"]
                akun = (a[0], a[1] or "")
            tempo, kira = _jatuh_tempo(r.invoice_date, r.due_date, r.term_of_payment)
            hasil[str(r.id)] = Dok(
                id=str(r.id), no=r.invoice_no, ref_no=None, pihak=_norm_pihak(r.customer_name) or "(NO NAME)",
                npwp=r.customer_npwp, tanggal=r.invoice_date, jatuh_tempo=tempo, tempo_perkiraan=kira,
                total=bc._dec(r.gross_amount), akun_kode=akun[0], akun_nama=akun[1], keterangan=r.description,
            )
        _muat_pelunasan(session, kid, sisi, hasil, kecuali_tx)
        paid = {str(r.id): bc._dec(r.paid_amount) for r in rows}
        for d in hasil.values():
            via_kas = sum((p.nilai for p in d.pelunasan if p.status == "posted"), NOL)
            lain = paid[d.id] - via_kas
            d.lain = min(lain, d.total) if lain > TOL else NOL
    else:
        rows = session.query(PT).filter(
            PT.management_client_id == kid, PT.deleted_at.is_(None), func.lower(PT.status) == "posted",
        ).all()
        status_bayar = {}
        for r in rows:
            tgl = r.invoice_date or r.purchase_date
            tempo, kira = _jatuh_tempo(tgl, r.due_date, r.payment_terms)
            kode, nama = dbc.akun_posting_purchase(r)["ap"]
            hasil[str(r.id)] = Dok(
                id=str(r.id), no=r.invoice_number or r.purchase_no, ref_no=r.purchase_no,
                pihak=_norm_pihak(r.vendor_name) or "(NO NAME)", npwp=r.vendor_code, tanggal=tgl, jatuh_tempo=tempo,
                tempo_perkiraan=kira, total=bc._dec(r.accounts_payable if r.accounts_payable is not None else r.total),
                akun_kode=kode, akun_nama=nama or "", keterangan=r.description,
            )
            status_bayar[str(r.id)] = (r.payment_status or "").lower()
        _muat_pelunasan(session, kid, sisi, hasil, kecuali_tx)
        for d in hasil.values():
            via_kas = sum((p.nilai for p in d.pelunasan if p.status == "posted"), NOL)
            if status_bayar[d.id] == "paid" and via_kas < d.total - TOL:
                d.lain = d.total - via_kas
    return sorted(hasil.values(), key=lambda d: (d.tanggal, d.no))


# ============================================================
# SERIALISASI
# ============================================================

def _dok_dict(d: Dok, per: date) -> Dict[str, Any]:
    sisa = d.sisa(per)
    hari = d.telat(per)
    return {
        "id": d.id, "no": d.no, "ref_no": d.ref_no, "party": d.pihak, "party_tax_id": d.npwp,
        "date": d.tanggal, "due_date": d.jatuh_tempo, "due_date_estimated": d.tempo_perkiraan,
        "total": bc._f(d.total), "paid": bc._f(min(d.dibayar(per), d.total)), "outstanding": bc._f(sisa),
        "in_process": bc._f(d.pending), "available": bc._f(max(sisa - d.pending, NOL)),
        "days_overdue": max(hari, 0) if sisa > 0 else 0, "bucket": _bucket(hari) if sisa > 0 else None,
        "status": _status(d, per), "account_code": d.akun_kode, "account_name": d.akun_nama,
        "description": d.keterangan, "last_payment_date": d.bayar_terakhir(per),
    }


def _ember_kosong() -> Dict[str, Decimal]:
    return {b: NOL for b in BUCKETS}


def _rekap_pihak(docs: List[Dok], per: date, termasuk_nol: bool, dengan_detail: bool) -> Dict[str, Any]:
    pihak: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        if d.tanggal > per:
            continue
        p = pihak.setdefault(d.pihak, {"party": d.pihak, "party_tax_id": d.npwp, "buckets": _ember_kosong(),
                                        "total": NOL, "invoice_count": 0, "open_count": 0, "invoices": []})
        p["party_tax_id"] = p["party_tax_id"] or d.npwp
        p["invoice_count"] += 1
        sisa = d.sisa(per)
        if sisa <= 0:
            continue
        p["buckets"][_bucket(d.telat(per))] += sisa
        p["total"] += sisa
        p["open_count"] += 1
        if dengan_detail:
            p["invoices"].append(_dok_dict(d, per))
    baris = [p for p in pihak.values() if termasuk_nol or p["total"] > 0]
    baris.sort(key=lambda p: (-p["total"], p["party"]))
    total = _ember_kosong()
    for p in baris:
        for b in BUCKETS:
            total[b] += p["buckets"][b]
    for p in baris:
        p["buckets"] = {b: bc._f(v) for b, v in p["buckets"].items()}
        p["total"] = bc._f(p["total"])
    return {
        "as_of": per, "rows": baris,
        "totals": {"buckets": {b: bc._f(v) for b, v in total.items()}, "total": bc._f(sum(total.values(), NOL))},
    }


def _settle_dict(session, tx: Any, baris: Optional[List[Any]] = None, sisi: Optional[Sisi] = None) -> Dict[str, Any]:
    d = bc._tx_dict(session, tx, baris)
    alokasi = [l for l in d["lines"] if l["line_type"] in ("sales_invoice", "purchase")]
    lain = [l for l in d["lines"] if l["line_type"] == "account"]
    d.update({
        "payment_method": tx.payment_method, "reference_date": tx.reference_date, "currency": tx.currency or "IDR",
        "allocated": bc._f(sum(l["amount"] for l in alokasi)), "unapplied": bc._f(sum(l["amount"] for l in lain)),
        "editable": bool(sisi and tx.source == sisi.kode and tx.status in ("draft", "approved")),
    })
    return d


# ============================================================
# UTIL
# ============================================================

def _hari_ini() -> date:
    return date.today()


def _akhir_bulan_lalu(per: date) -> date:
    return per.replace(day=1) - timedelta(days=1)


def _geser_bulan(tgl: date, n: int) -> date:
    """Tanggal 1 bulan ke-n dari bulan `tgl` (n negatif = mundur)."""
    m = tgl.year * 12 + tgl.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def _total_sisa(docs: List[Dok], per: date) -> Decimal:
    return sum((d.sisa(per) for d in docs), NOL)


def _total_telat(docs: List[Dok], per: date) -> Decimal:
    return sum((d.sisa(per) for d in docs if d.telat(per) > 0), NOL)


def _jumlah_pihak(docs: List[Dok], per: date) -> int:
    return len({d.pihak for d in docs if d.sisa(per) > 0})


def _terkumpul(docs: List[Dok], awal: date, akhir: date) -> Decimal:
    """Pelunasan bersih lewat Cash & Bank di [awal, akhir] (pembalik mengurangi di tanggal pembaliknya)."""
    n = NOL
    for d in docs:
        for p in d.pelunasan:
            if awal <= p.tanggal <= akhir:
                n += p.nilai
            if p.reversal_date and awal <= p.reversal_date <= akhir:
                n -= p.nilai
    return n


def _rata_hari_tagih(docs: List[Dok], awal: date, akhir: date) -> Optional[float]:
    """Rata-rata (tertimbang nominal) hari dari tanggal dokumen ke tanggal pelunasan, untuk pelunasan
    di [awal, akhir] yang tidak dibalik."""
    bobot, total = NOL, NOL
    for d in docs:
        for p in d.pelunasan:
            if awal <= p.tanggal <= akhir and p.status == "posted" and p.nilai > 0:
                bobot += p.nilai * (p.tanggal - d.tanggal).days
                total += p.nilai
    return round(float(bobot / total), 1) if total > 0 else None


def _wajib_level(user: Dict[str, Any], minimal: int, aksi: str) -> None:
    if auth.role_level(user.get("role")) < minimal:
        raise _Gagal(f"Your role cannot {aksi}.", kode="FORBIDDEN", status_code=403)


def _nomor_berikut(session, kid: str, sisi: Sisi, tgl: date) -> str:
    awalan = f"{sisi.awalan}/{tgl:%Y}/"
    nomor = [n for (n,) in session.query(TX.tx_number).filter(TX.client_id == kid, TX.tx_number.like(f"{awalan}%")).all()]
    urut = max((int(n.rsplit("/", 1)[1]) for n in nomor if n.rsplit("/", 1)[1].isdigit()), default=0)
    return f"{awalan}{urut + 1:04d}"


def _ambil_settle(session, kid: str, sisi: Sisi, tx_id: Any, harus_milik: bool = True) -> Any:
    tx = bc._ambil_tx(session, kid, tx_id)
    if harus_milik and tx.source != sisi.kode:
        raise _Gagal(f"{tx.tx_number} was created in Cash & Bank; manage it there.", kode="CONFLICT", status_code=409)
    return tx


def _post(session, kid: str, tx: Any, user: Dict[str, Any]) -> None:
    waktu = bc._sekarang()
    bc._akun_kas(session, kid, tx.bank_coa_id)
    if not tx.approved_at:
        tx.approved_at, tx.approved_by, tx.approved_by_name = waktu, user.get("id"), bc._nama(user)
    tx.status, tx.posted_at, tx.posted_by, tx.posted_by_name = "posted", waktu, user.get("id"), bc._nama(user)
    session.flush()
    bc._terapkan_pelunasan(session, kid, tx, +1)
    session.flush()


def _submit(session, kid: str, tx: Any, user: Dict[str, Any]) -> str:
    """Manager+: langsung posted. Supervisor: approved (menunggu Post)."""
    if auth.role_level(user.get("role")) >= LEVEL_POST:
        _post(session, kid, tx, user)
        return "posted"
    if tx.status == "draft":
        tx.status, tx.approved_at, tx.approved_by, tx.approved_by_name = "approved", bc._sekarang(), user.get("id"), bc._nama(user)
    return "approved"


# ============================================================
# REQUEST
# ============================================================

class AlokasiIn(BaseModel):
    invoice_id: UUID
    amount: float = Field(..., gt=0)


class SettlementRequest(BaseModel):
    client_id: UUID
    number: Optional[str] = Field(None, max_length=50)
    tx_date: date
    party: str = Field(..., min_length=1, max_length=255)
    bank_coa_id: UUID
    payment_method: str = Field("bank_transfer", max_length=30)
    currency: str = Field("IDR", max_length=10)
    reference: Optional[str] = Field(None, max_length=255)
    reference_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=500)
    allocations: List[AlokasiIn] = Field(default_factory=list, max_length=500)
    unapplied_amount: float = Field(0, ge=0)
    unapplied_coa_id: Optional[UUID] = None
    submit: bool = False


class KlienRequest(BaseModel):
    client_id: UUID


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


# ============================================================
# ROUTER
# ============================================================

def _buat_router(sisi: Sisi, prefix: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    D = sisi.dokumen
    P = sisi.pihak

    @router.get("/overview", summary=f"Ringkasan {tag}: KPI, aging, top {P} overdue, tren bulanan")
    def overview(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                 months: int = Query(6, ge=3, le=12, description="Jumlah bulan tren"),
                 _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            per = as_of or _hari_ini()
            lalu = _akhir_bulan_lalu(per)
            docs = _muat_dokumen(session, kid, sisi)
            awal_bulan = per.replace(day=1)
            awal_bulan_lalu = lalu.replace(day=1)

            ember = {b: {"amount": NOL, "count": 0} for b in BUCKETS}
            telat_pihak: Dict[str, Dict[str, Any]] = {}
            for d in docs:
                s = d.sisa(per)
                if s <= 0:
                    continue
                b = _bucket(d.telat(per))
                ember[b]["amount"] += s
                ember[b]["count"] += 1
                if d.telat(per) > 0:
                    t = telat_pihak.setdefault(d.pihak, {"party": d.pihak, "amount": NOL, "count": 0, "max_days": 0})
                    t["amount"] += s
                    t["count"] += 1
                    t["max_days"] = max(t["max_days"], d.telat(per))
            top = sorted(telat_pihak.values(), key=lambda t: -t["amount"])
            tren = []
            for i in range(1 - months, 1):
                awal = _geser_bulan(per, i)
                akhir = min(_geser_bulan(per, i + 1) - timedelta(days=1), per)
                tren.append({
                    "month": f"{awal:%Y-%m}",
                    "invoiced": bc._f(sum((d.total for d in docs if awal <= d.tanggal <= akhir), NOL)),
                    "collected": bc._f(_terkumpul(docs, awal, akhir)),
                    "balance": bc._f(_total_sisa(docs, akhir)),
                })
            draft = session.query(TX.status, func.count(), func.sum(TX.amount)).filter(
                TX.client_id == kid, TX.deleted_at.is_(None), TX.source == sisi.kode, TX.status.in_(("draft", "approved")),
            ).group_by(TX.status).all()
            return {
                "as_of": per, "previous_as_of": lalu,
                "kpi": {
                    "total_outstanding": bc._f(_total_sisa(docs, per)), "total_outstanding_prev": bc._f(_total_sisa(docs, lalu)),
                    "overdue": bc._f(_total_telat(docs, per)), "overdue_prev": bc._f(_total_telat(docs, lalu)),
                    "collected_month": bc._f(_terkumpul(docs, awal_bulan, per)),
                    "collected_prev_month": bc._f(_terkumpul(docs, awal_bulan_lalu, lalu)),
                    "avg_days_to_settle": _rata_hari_tagih(docs, awal_bulan, per),
                    "avg_days_to_settle_prev": _rata_hari_tagih(docs, awal_bulan_lalu, lalu),
                    "parties_with_balance": _jumlah_pihak(docs, per), "parties_with_balance_prev": _jumlah_pihak(docs, lalu),
                    "open_count": sum(1 for d in docs if d.sisa(per) > 0),
                    "overdue_count": sum(1 for d in docs if d.sisa(per) > 0 and d.telat(per) > 0),
                },
                "aging": [{"bucket": b, "amount": bc._f(ember[b]["amount"]), "count": ember[b]["count"]} for b in BUCKETS],
                "top_overdue": [{"party": t["party"], "amount": bc._f(t["amount"]), "count": t["count"],
                                 "max_days": t["max_days"], "bucket": _bucket(t["max_days"])} for t in top[:5]],
                "trend": tren,
                "pending": {st: {"count": n, "amount": bc._f(a)} for st, n, a in draft},
            }
        return bc._respon(aksi)

    @router.get("/invoices", summary=f"Daftar {D} posted + saldo, aging & status per tanggal (as_of)")
    def daftar_dokumen(
        client_id: UUID = Query(...),
        as_of: Optional[date] = Query(None),
        party: Optional[str] = Query(None),
        only_open: bool = Query(False),
        exclude_settlement: Optional[UUID] = Query(None, description="Abaikan alokasi pending transaksi ini (form edit)"),
        _u: Dict[str, Any] = Depends(get_current_user_v1),
    ):
        kid = str(client_id)

        def aksi(session):
            per = as_of or _hari_ini()
            docs = _muat_dokumen(session, kid, sisi, str(exclude_settlement) if exclude_settlement else None)
            target = _norm_pihak(party) if party else None
            hasil = []
            for d in docs:
                if d.tanggal > per or (target and d.pihak != target):
                    continue
                if only_open and d.sisa(per) <= 0:
                    continue
                hasil.append(_dok_dict(d, per))
            hasil.sort(key=lambda r: (r["date"], r["no"]), reverse=True)
            return hasil
        return bc._respon(aksi)

    @router.get("/aging", summary=f"Aging per {P} per tanggal (as_of) berdasarkan jatuh tempo")
    def aging(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
              include_zero: bool = Query(False), include_details: bool = Query(False),
              _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            per = as_of or _hari_ini()
            return _rekap_pihak(_muat_dokumen(session, kid, sisi), per, include_zero, include_details)
        return bc._respon(aksi)

    @router.get("/parties", summary=f"Daftar {P} (dari {D} posted) + saldo hari ini")
    def daftar_pihak(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            per = _hari_ini()
            hasil: Dict[str, Dict[str, Any]] = {}
            for d in _muat_dokumen(session, kid, sisi):
                p = hasil.setdefault(d.pihak, {"name": d.pihak, "tax_id": d.npwp, "invoice_count": 0,
                                               "open_count": 0, "outstanding": NOL, "overdue": NOL})
                p["tax_id"] = p["tax_id"] or d.npwp
                p["invoice_count"] += 1
                s = d.sisa(per)
                if s > 0:
                    p["open_count"] += 1
                    p["outstanding"] += s
                    if d.telat(per) > 0:
                        p["overdue"] += s
            for p in hasil.values():
                p["outstanding"], p["overdue"] = bc._f(p["outstanding"]), bc._f(p["overdue"])
            return sorted(hasil.values(), key=lambda p: p["name"])
        return bc._respon(aksi)

    @router.get("/statement", summary=f"Statement 1 {P}: saldo awal, {D} & pelunasan dalam periode, saldo akhir")
    def statement(client_id: UUID = Query(...), party: str = Query(..., min_length=1),
                  date_from: date = Query(...), date_to: date = Query(...),
                  _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            if date_to < date_from:
                raise _Gagal("The end date cannot be earlier than the start date.")
            target = _norm_pihak(party)
            docs = [d for d in _muat_dokumen(session, kid, sisi) if d.pihak == target]
            sebelum = date_from - timedelta(days=1)
            awal = _total_sisa(docs, sebelum)
            baris: List[Dict[str, Any]] = []
            for d in docs:
                if date_from <= d.tanggal <= date_to:
                    baris.append({"date": d.tanggal, "type": D, "number": d.no, "description": d.keterangan or "",
                                  "due_date": d.jatuh_tempo, "charge": d.total, "settlement": NOL})
                    if d.lain > 0:
                        baris.append({"date": d.tanggal, "type": "settled_outside", "number": d.no,
                                      "description": f"Settled outside Cash & Bank ({d.no})", "due_date": None,
                                      "charge": NOL, "settlement": d.lain})
                for p in d.pelunasan:
                    if date_from <= p.tanggal <= date_to:
                        baris.append({"date": p.tanggal, "type": "settlement", "number": p.tx_number,
                                      "description": f"{sisi.aksi} for {d.no}", "due_date": None,
                                      "charge": NOL, "settlement": p.nilai})
                    if p.reversal_date and date_from <= p.reversal_date <= date_to:
                        baris.append({"date": p.reversal_date, "type": "reversal", "number": f"RV-{p.tx_number}",
                                      "description": f"Reversal of {p.tx_number} ({d.no})", "due_date": None,
                                      "charge": p.nilai, "settlement": NOL})
            urutan = {D: 0, "settled_outside": 1, "settlement": 2, "reversal": 3}
            baris.sort(key=lambda b: (b["date"], urutan[b["type"]], b["number"]))
            saldo = awal
            for b in baris:
                saldo += b["charge"] - b["settlement"]
                b["balance"] = bc._f(saldo)
                b["charge"], b["settlement"] = bc._f(b["charge"]), bc._f(b["settlement"])
            npwp = next((d.npwp for d in docs if d.npwp), None)
            rekap = _rekap_pihak(docs, date_to, True, True)
            return {
                "party": target, "party_tax_id": npwp, "date_from": date_from, "date_to": date_to,
                "opening_balance": bc._f(awal), "closing_balance": bc._f(saldo),
                "total_charges": bc._f(sum((Decimal(str(b["charge"])) for b in baris), NOL)),
                "total_settlements": bc._f(sum((Decimal(str(b["settlement"])) for b in baris), NOL)),
                "lines": baris,
                "aging": rekap["totals"]["buckets"],
                "open_invoices": rekap["rows"][0]["invoices"] if rekap["rows"] else [],
            }
        return bc._respon(aksi)

    # ---------------- Record Receipt / Payment ----------------

    @router.get("/settlements/next-number", summary=f"Nomor {sisi.aksi} berikutnya ({sisi.awalan}/YYYY/####)")
    def nomor_berikut(client_id: UUID = Query(...), date_: Optional[date] = Query(None, alias="date"),
                      _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)
        return bc._respon(lambda s: {"number": _nomor_berikut(s, kid, sisi, date_ or _hari_ini())})

    @router.get("/settlements", summary=f"Semua pelunasan {D} (Record {sisi.aksi} + Cash & Bank)")
    def daftar_settlement(
        client_id: UUID = Query(...),
        status: Optional[str] = Query(None, description="draft/approved/posted/reversed, boleh dipisah koma"),
        date_from: Optional[date] = Query(None),
        date_to: Optional[date] = Query(None),
        _u: Dict[str, Any] = Depends(get_current_user_v1),
    ):
        kid = str(client_id)

        def aksi(session):
            kolom = getattr(TL, sisi.kolom)
            ada_alokasi = session.query(TL.transaction_id).filter(kolom.isnot(None))
            q = session.query(TX).filter(
                TX.client_id == kid, TX.deleted_at.is_(None), TX.direction == sisi.arah,
                (TX.source == sisi.kode) | TX.id.in_(ada_alokasi),
            )
            if status:
                q = q.filter(TX.status.in_([s.strip() for s in status.split(",") if s.strip()]))
            if date_from:
                q = q.filter(TX.tx_date >= date_from)
            if date_to:
                q = q.filter(TX.tx_date <= date_to)
            txs = q.order_by(TX.tx_date.desc(), TX.tx_number.desc()).all()
            if not txs:
                return []
            baris: Dict[str, List[Any]] = {}
            for b in session.query(TL).filter(TL.transaction_id.in_([t.id for t in txs])).order_by(TL.line_no).all():
                baris.setdefault(b.transaction_id, []).append(b)
            return [_settle_dict(session, t, baris.get(t.id, []), sisi) for t in txs]
        return bc._respon(aksi)

    @router.get("/settlements/{tx_id}", summary=f"Detail 1 {sisi.aksi} + jurnalnya")
    def detail_settlement(tx_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)
        return bc._respon(lambda s: _settle_dict(s, _ambil_settle(s, kid, sisi, tx_id, harus_milik=False), sisi=sisi))

    def _isi(session, kid: str, payload: SettlementRequest, user: Dict[str, Any], tx: Any = None) -> Tuple[Any, str]:
        if payload.currency.upper() != "IDR":
            raise _Gagal("Only IDR is supported for now (the ledger is kept in IDR).")
        metode = payload.payment_method.strip().lower()
        if metode not in METODE_BAYAR:
            raise _Gagal(f"Unknown payment method '{payload.payment_method}'.")
        if not payload.allocations and payload.unapplied_amount <= 0:
            raise _Gagal(f"Allocate the {sisi.aksi.lower()} to at least one {D}, or enter an unapplied amount.")
        pihak = _norm_pihak(payload.party)
        ids = [str(a.invoice_id) for a in payload.allocations]
        if len(set(ids)) != len(ids):
            raise _Gagal(f"Each {D} can only be allocated once per {sisi.aksi.lower()}.")
        docs = {d.id: d for d in _muat_dokumen(session, kid, sisi, tx.id if tx is not None else None)}
        for i in ids:
            d = docs.get(i)
            if d is None:
                raise _Gagal(f"The selected {D} is not posted or does not belong to this client.", kode="NOT_FOUND", status_code=404)
            if d.pihak != pihak:
                raise _Gagal(f"{D.capitalize()} {d.no} belongs to {d.pihak}, not {pihak}.")
        baris_in = [bc.BarisIn(type=sisi.line_type, invoice_id=a.invoice_id, amount=a.amount) for a in payload.allocations]
        if payload.unapplied_amount > 0:
            if not payload.unapplied_coa_id:
                raise _Gagal("Choose the account for the unapplied amount (e.g. customer deposits / vendor advances).")
            akun = bc._akun(session, kid, str(payload.unapplied_coa_id))
            if bc._jenis_kas(akun):
                raise _Gagal("The unapplied amount cannot be posted to a cash or bank account.")
            baris_in.append(bc.BarisIn(type="account", coa_id=payload.unapplied_coa_id, amount=payload.unapplied_amount,
                                       description=f"Unapplied {sisi.aksi.lower()} - {pihak}"))
        akun_bank = bc._akun_kas(session, kid, str(payload.bank_coa_id))
        baris, nominal, jenis, _ = bc._susun_baris(session, kid, sisi.arah, baris_in, kecuali_tx=tx.id if tx is not None else None)

        nomor = (payload.number or "").strip() or None
        if tx is None or (nomor and nomor != tx.tx_number):
            nomor = nomor or _nomor_berikut(session, kid, sisi, payload.tx_date)
            bentrok = session.query(TX.id).filter(TX.client_id == kid, TX.tx_number == nomor).first()
            if bentrok:
                raise _Gagal(f"Number {nomor} is already used. Choose another number.", kode="CONFLICT", status_code=409)
        catatan = (payload.notes or "").strip() or None
        nilai = dict(
            tx_date=payload.tx_date, bank_coa_id=akun_bank.id, bank_account_code=akun_bank.acc_no,
            bank_account_name=akun_bank.account_name, amount=nominal, kind=jenis,
            category=bc.KATEGORI_INVOICE[sisi.arah] if jenis == "invoice" else "Advance", counterparty=pihak,
            description=catatan or f"{sisi.aksi} {('from' if sisi.kode == 'ar' else 'to')} {pihak}",
            reference=(payload.reference or "").strip() or None, reference_date=payload.reference_date,
            payment_method=metode, currency="IDR",
        )
        if tx is None:
            tx = TX(client_id=kid, tx_number=nomor, direction=sisi.arah, source=sisi.kode, status="draft",
                    created_by=user.get("id"), created_by_name=bc._nama(user), **nilai)
            session.add(tx)
        else:
            if nomor:
                tx.tx_number = nomor
            for k, v in nilai.items():
                setattr(tx, k, v)
            # Diubah -> kembali draft (approval sebelumnya untuk isi yang lama).
            tx.status, tx.approved_at, tx.approved_by, tx.approved_by_name = "draft", None, None, None
            tx.edited_at, tx.edited_by = bc._sekarang(), user.get("id")
        session.flush()
        bc._tulis_baris(session, tx, baris)
        hasil = "draft"
        if payload.submit:
            hasil = _submit(session, kid, tx, user)
        return tx, hasil

    def _pesan(nomor: str, hasil: str) -> str:
        return {
            "draft": f"{nomor} saved as draft.",
            "approved": f"{nomor} submitted — awaiting posting by a Manager.",
            "posted": f"{nomor} posted to the ledger.",
        }[hasil]

    @router.post("/settlements", summary=f"Record {sisi.aksi}: simpan draft / submit (Supervisor+; posting langsung Manager+)")
    def buat_settlement(payload: SettlementRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
        kid = str(payload.client_id)

        def aksi(session):
            bc._wajib_klien(kid)
            bc._kunci_klien(session, kid)
            tx, hasil = _isi(session, kid, payload, current_user)
            return {"settlement": _settle_dict(session, tx, sisi=sisi), "result": hasil}
        try:
            data = bc._jalankan(aksi)
        except _Gagal as e:
            return bc._respon_gagal(e)
        return sukses(data=data, message=_pesan(data["settlement"]["tx_number"], data["result"]), status_code=201)

    @router.put("/settlements/{tx_id}", summary=f"Ubah {sisi.aksi} draft/approved (kembali draft kecuali submit)")
    def ubah_settlement(tx_id: UUID, payload: SettlementRequest,
                        current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
        kid = str(payload.client_id)

        def aksi(session):
            bc._kunci_klien(session, kid)
            tx = _ambil_settle(session, kid, sisi, tx_id)
            if tx.status not in ("draft", "approved"):
                raise _Gagal(f"{tx.tx_number} is {tx.status}; reverse it instead of editing.", kode="CONFLICT", status_code=409)
            tx, hasil = _isi(session, kid, payload, current_user, tx)
            return {"settlement": _settle_dict(session, tx, sisi=sisi), "result": hasil}
        try:
            data = bc._jalankan(aksi)
        except _Gagal as e:
            return bc._respon_gagal(e)
        return sukses(data=data, message=_pesan(data["settlement"]["tx_number"], data["result"]))

    @router.post("/settlements/{tx_id}/submit", summary=f"Submit {sisi.aksi} draft/approved (Manager+ -> posted)")
    def submit_settlement(tx_id: UUID, payload: KlienRequest,
                          current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
        kid = str(payload.client_id)

        def aksi(session):
            bc._kunci_klien(session, kid)
            tx = _ambil_settle(session, kid, sisi, tx_id, harus_milik=False)
            if tx.status not in ("draft", "approved"):
                raise _Gagal(f"{tx.tx_number} is already {tx.status}.", kode="CONFLICT", status_code=409)
            if tx.status == "approved":
                _wajib_level(current_user, LEVEL_POST, "post transactions (Manager or above)")
            hasil = _submit(session, kid, tx, current_user)
            return {"settlement": _settle_dict(session, tx, sisi=sisi), "result": hasil}
        try:
            data = bc._jalankan(aksi)
        except _Gagal as e:
            return bc._respon_gagal(e)
        return sukses(data=data, message=_pesan(data["settlement"]["tx_number"], data["result"]))

    @router.delete("/settlements/{tx_id}", summary=f"Hapus {sisi.aksi} draft/approved")
    def hapus_settlement(tx_id: UUID, client_id: UUID = Query(...),
                         current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
        kid = str(client_id)

        def aksi(session):
            tx = _ambil_settle(session, kid, sisi, tx_id)
            if tx.status not in ("draft", "approved"):
                raise _Gagal(f"{tx.tx_number} is {tx.status}; reverse it instead of deleting.", kode="CONFLICT", status_code=409)
            tx.deleted_at, tx.deleted_by = bc._sekarang(), current_user.get("id")
            return {"id": tx.id}
        return bc._respon(aksi, f"{sisi.aksi} deleted.")

    @router.post("/settlements/{tx_id}/reverse", summary=f"Balik {sisi.aksi} posted: jurnal pembalik + pelunasan dibatalkan (Manager+)")
    def balik_settlement(tx_id: UUID, payload: BalikRequest,
                         current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
        kid = str(payload.client_id)

        def aksi(session):
            bc._kunci_klien(session, kid)
            tx = _ambil_settle(session, kid, sisi, tx_id, harus_milik=False)
            if tx.status != "posted":
                raise _Gagal(f"Only posted transactions can be reversed ({tx.tx_number} is {tx.status}).", kode="CONFLICT", status_code=409)
            tanggal = payload.reversal_date or _hari_ini()
            if tanggal < tx.tx_date:
                raise _Gagal("The reversal date cannot be earlier than the transaction date.")
            waktu = bc._sekarang()
            tx.status, tx.reversal_date, tx.reversal_reason = "reversed", tanggal, payload.reason.strip()
            tx.reversed_at, tx.reversed_by, tx.reversed_by_name = waktu, current_user.get("id"), bc._nama(current_user)
            tx.edited_at, tx.edited_by = waktu, current_user.get("id")
            session.flush()
            bc._terapkan_pelunasan(session, kid, tx, -1)
            if tx.mutation_id:
                m = session.get(MU, tx.mutation_id)
                if m is not None and m.transaction_id == tx.id:
                    m.status, m.transaction_id = "unmatched", None
                    m.edited_at, m.edited_by = waktu, current_user.get("id")
            session.flush()
            return _settle_dict(session, tx, sisi=sisi)
        return bc._respon(aksi, f"{sisi.aksi} reversed.")

    return router


router_ar = _buat_router(AR, "/api/v1/finance/receivables", "finance-receivables-v1")
router_ap = _buat_router(AP, "/api/v1/finance/payables", "finance-payables-v1")
