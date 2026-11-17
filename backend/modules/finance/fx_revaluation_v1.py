"""
modules/finance/fx_revaluation_v1.py
====================================
Fase 3A kurs: REVALUASI akhir periode saldo AR/AP valas -> /api/v1/finance/fx-revaluation/...

Selisih kurs TERealisasi (Fase 2) timbul saat invoice/bill valas dilunasi. Modul ini menghitung selisih kurs
BELUM terealisasi atas saldo yang MASIH TERBUKA pada tanggal akhir periode:

    sisa valas (per tanggal) x kurs penutup  -  saldo IDR tercatat di buku (per tanggal)

    AR: selisih > 0 = untung (Dr Piutang, Cr Untung Selisih Kurs Belum Terealisasi), < 0 = rugi.
    AP: selisih > 0 = rugi  (Dr Rugi Selisih Kurs Belum Terealisasi, Cr Hutang),     < 0 = untung.

Hasilnya 2 jurnal POSTED (financial_transaction_journal_entry_drafts, source_type 'Revaluation'):
    REV-<yyyymmdd>      tanggal akhir periode      -> langsung masuk GL / laporan keuangan
    RV-REV-<yyyymmdd>   tanggal akhir periode + 1  -> jurnal pembalik OTOMATIS (debit/kredit ditukar)

Karena dibalik otomatis, perhitungan Fase 2 TIDAK berubah: pelunasan tetap membandingkan kurs pelunasan dengan
kurs INVOICE (bukan kurs revaluasi), dan revaluasi periode berikutnya selalu dihitung dari saldo dokumen yang
bersih lagi (tidak berantai dari revaluasi sebelumnya).

Saldo per tanggal memakai _muat_dokumen milik receivables_payables_v1 (sumber yang sama dengan Aging/Statement),
jadi angka IDR tercatat PASTI sama dengan buku pembantu. Sisa valas dihitung dari alokasi fx_amount yang posted
pada/ sebelum tanggal (pelunasan yang dibalik sebelum tanggal tidak dihitung).

Kurs penutup: master kurs jenis 'middle' terakhir pada/ sebelum tanggal (maks UMUR_KURS_MAKS_HARI hari), atau
kurs manual per mata uang di request (`rates`). Akun untung/rugi belum terealisasi: Settings > Account Mapping >
Foreign Exchange (fx_gain_unrealized / fx_loss_unrealized).

Endpoint:
    POST /preview                 hitung saja (tidak menyimpan apa pun)        -- Supervisor+
    POST /run                     buat + posting jurnal revaluasi & pembaliknya -- Manager+
    GET  /runs                    riwayat revaluasi klien
    GET  /runs/{id}               detail 1 run (snapshot per dokumen + jurnal)
    POST /runs/{id}/cancel        batalkan run (kedua jurnal di-soft-delete)    -- Manager+

Batasan yang disengaja: hanya AR/AP valas. Rekening bank valas & transfer antar mata uang = Fase 3B/3C.
Kalau ada pelunasan baru bertanggal <= as_of dimasukkan SETELAH run dibuat, saldo berubah: batalkan run lalu
buat ulang (pratinjau selalu menampilkan run aktif di tanggal itu lewat `existing_run`).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..transactions import bank_cash_willi as bc
from . import receivables_payables_v1 as rp

logger = get_module_logger("finance_fx_revaluation_v1")

router = APIRouter(prefix="/api/v1/finance/fx-revaluation", tags=["fx-revaluation"])

LEVEL_PREVIEW = bc.LEVEL_INPUT      # Supervisor+
LEVEL_POST = bc.LEVEL_POST          # Manager+ (jurnal langsung posted)
NOL = bc.NOL
SEN = Decimal("0.01")
SOURCE_TYPE_JURNAL = "Revaluation"
KEY_GAIN = "fx_gain_unrealized"
KEY_LOSS = "fx_loss_unrealized"
_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober",
          "November", "Desember"]

TX, TL = bc.TX, bc.TL
_Gagal = bc._Gagal


# ============================================================
# PERHITUNGAN
# ============================================================

def _kurs_penutup(session, mu: str, per: date) -> Optional[Tuple[Decimal, date]]:
    """Kurs 'middle' terakhir pada/ sebelum `per` (maks UMUR_KURS_MAKS_HARI hari lalu) -> (kurs, tanggal kurs)."""
    ER = dbc.ExchangeRate
    r = session.query(ER.rate, ER.rate_date).filter(
        ER.currency == mu, ER.rate_type == "middle", ER.rate_date <= per,
    ).order_by(ER.rate_date.desc()).first()
    if r is None or (per - r[1]).days > bc.UMUR_KURS_MAKS_HARI:
        return None
    return bc._dec(r[0]), r[1]


def _asing_dibayar(session, kid: str, sisi: "rp.Sisi", ids: List[str], per: date) -> Dict[str, Decimal]:
    """Nominal VALAS yang sudah dilunasi per dokumen pada tanggal `per` (transaksi posted, atau reversed tetapi
    pembaliknya bertanggal setelah `per`). Aturan tanggal sama dengan Dok.dibayar (buku pembantu)."""
    if not ids:
        return {}
    kolom = getattr(TL, sisi.kolom)
    q = session.query(kolom, TX.status, TX.reversal_date, func.sum(TL.fx_amount)).join(
        TX, TX.id == TL.transaction_id
    ).filter(
        TX.client_id == kid, TX.deleted_at.is_(None), TX.status.in_(("posted", "reversed")),
        kolom.in_(ids), TL.fx_amount.isnot(None), TX.tx_date <= per,
    ).group_by(kolom, TX.status, TX.reversal_date)
    hasil: Dict[str, Decimal] = {}
    for doc_id, status, tgl_balik, jumlah in q.all():
        if status == "reversed" and tgl_balik and tgl_balik <= per:
            continue
        hasil[str(doc_id)] = hasil.get(str(doc_id), NOL) + bc._dec(jumlah)
    return hasil


def _akun_unrealized(session, kid: str, jenis: str) -> Optional[Any]:
    kunci = KEY_GAIN if jenis == "gain" else KEY_LOSS
    m = session.query(bc.MAP_AKUN).filter(bc.MAP_AKUN.client_id == kid, bc.MAP_AKUN.mapping_key == kunci).first()
    a = session.get(bc.COA, m.coa_id) if m is not None else None
    if a is None or a.deleted_at is not None or not a.is_active or bc._jenis_kas(a):
        return None
    return a


def _baca_rates(rates: Optional[Dict[str, float]]) -> Dict[str, Decimal]:
    return {k.upper(): bc._dec(v) for k, v in (rates or {}).items()}


def _hitung(session, kid: str, per: date, rates: Optional[Dict[str, float]]) -> Dict[str, Any]:
    """Hitung revaluasi per tanggal `per`. Murni baca -- dipakai preview dan run."""
    manual = _baca_rates(rates)
    kurs_cache: Dict[str, Optional[Tuple[Decimal, Optional[date], str]]] = {}

    def kurs_untuk(mu: str):
        if mu not in kurs_cache:
            if mu in manual:
                kurs_cache[mu] = (manual[mu], None, "manual")
            else:
                k = _kurs_penutup(session, mu, per)
                kurs_cache[mu] = (k[0], k[1], "master") if k else None
        return kurs_cache[mu]

    dokumen: List[Dict[str, Any]] = []
    kurang_kurs: set = set()
    for sisi in (rp.AR, rp.AP):
        docs = [d for d in rp._muat_dokumen(session, kid, sisi) if d.fx is not None and d.tanggal <= per]
        dibayar = _asing_dibayar(session, kid, sisi, [d.id for d in docs], per)
        for d in docs:
            sisa_idr = d.sisa(per)
            if sisa_idr <= NOL:
                continue
            mu, kurs_inv, total_asing = d.fx
            asing = max(total_asing - dibayar.get(d.id, NOL), NOL)
            if d.total > NOL:       # bagian yang lunas di luar Cash & Bank mengurangi sisa valas secara proporsional
                asing = min(asing, bc._bulat(total_asing * sisa_idr / d.total))
            if asing <= NOL:
                continue
            kurs = kurs_untuk(mu)
            if kurs is None:
                kurang_kurs.add(mu)
                continue
            nilai_baru = bc._bulat(asing * kurs[0])
            selisih = nilai_baru - sisa_idr
            # Untung/rugi: AR naik = untung; AP naik = rugi.
            untung = selisih > 0 if sisi.kode == "ar" else selisih < 0
            dokumen.append({
                "type": sisi.kode, "id": d.id, "no": d.no, "party": d.pihak, "date": d.tanggal,
                "currency": mu, "foreign_outstanding": bc._f(asing), "booking_rate": float(kurs_inv),
                "carried_idr": bc._f(sisa_idr), "closing_rate": float(kurs[0]), "revalued_idr": bc._f(nilai_baru),
                "difference": bc._f(selisih), "effect": None if selisih == NOL else ("gain" if untung else "loss"),
                "account_code": d.akun_kode, "account_name": d.akun_nama,
                "_selisih": selisih, "_untung": untung,
            })

    total_untung = sum((x["_selisih"] if x["type"] == "ar" else -x["_selisih"] for x in dokumen if x["effect"] == "gain"), NOL)
    total_rugi = sum((-x["_selisih"] if x["type"] == "ar" else x["_selisih"] for x in dokumen if x["effect"] == "loss"), NOL)
    return {
        "dokumen": dokumen, "kurang_kurs": sorted(kurang_kurs), "total_untung": total_untung,
        "total_rugi": total_rugi,
        "kurs": {mu: {"currency": mu, "rate": float(v[0]), "rate_date": v[1], "source": v[2]}
                 for mu, v in kurs_cache.items() if v is not None},
    }


def _susun_baris_jurnal(session, kid: str, hit: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Baris jurnal revaluasi: akun kontrol (net per akun) + 1 baris untung (kredit) + 1 baris rugi (debit)."""
    per_akun: Dict[Tuple[str, str], Decimal] = {}
    for x in hit["dokumen"]:
        if x["_selisih"] == NOL:
            continue
        net_debit = x["_selisih"] if x["type"] == "ar" else -x["_selisih"]      # Dr kontrol (+) / Cr kontrol (-)
        k = (x["account_code"], x["account_name"] or "")
        per_akun[k] = per_akun.get(k, NOL) + net_debit
    baris: List[Dict[str, Any]] = []
    for (kode, nama), net in sorted(per_akun.items()):
        if net == NOL:
            continue
        baris.append({"account_code": kode, "account_name": nama,
                      "description": "Revaluation of foreign-currency AR/AP",
                      "debit": net if net > 0 else NOL, "credit": -net if net < 0 else NOL})
    if hit["total_untung"] > NOL:
        a = _akun_unrealized(session, kid, "gain")
        if a is None:
            raise _Gagal("Set the 'Unrealized FX Gain' account in Settings > Account Mapping (Foreign Exchange) first.",
                         kode="FX_ACCOUNT_NOT_SET", status_code=422)
        baris.append({"account_code": a.acc_no, "account_name": a.account_name,
                      "description": "Unrealized FX gain (revaluation)", "debit": NOL, "credit": hit["total_untung"]})
    if hit["total_rugi"] > NOL:
        a = _akun_unrealized(session, kid, "loss")
        if a is None:
            raise _Gagal("Set the 'Unrealized FX Loss' account in Settings > Account Mapping (Foreign Exchange) first.",
                         kode="FX_ACCOUNT_NOT_SET", status_code=422)
        baris.append({"account_code": a.acc_no, "account_name": a.account_name,
                      "description": "Unrealized FX loss (revaluation)", "debit": hit["total_rugi"], "credit": NOL})
    d = sum((b["debit"] for b in baris), NOL)
    k = sum((b["credit"] for b in baris), NOL)
    if d != k:      # tidak boleh terjadi (dijamin konstruksi); jaga-jaga sebelum menulis ke GL
        raise _Gagal(f"Revaluation journal is not balanced (debit {d} vs credit {k}).", kode="UNBALANCED_ENTRY", status_code=500)
    return baris


def _baris_dict(baris: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{**b, "debit": bc._f(b["debit"]), "credit": bc._f(b["credit"])} for b in baris]


def _bersih(x: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in x.items() if not k.startswith("_")}


def _run_aktif(session, kid: str, per: date) -> Optional[Any]:
    return session.query(dbc.FxRevaluationRun).filter(
        dbc.FxRevaluationRun.client_id == kid, dbc.FxRevaluationRun.as_of_date == per,
        dbc.FxRevaluationRun.status == "posted",
    ).first()


# ============================================================
# JURNAL
# ============================================================

def _tulis_jurnal(session, kid: str, user: Dict[str, Any], *, je_number: str, tgl: date, description: str,
                  reference: str, baris: List[Dict[str, Any]]) -> Any:
    """Insert 1 jurnal POSTED + barisnya (pola sama dgn opening_balance_v1._tulis_jurnal). TIDAK commit."""
    nama = bc._nama(user)
    je = dbc.JournalEntryDraft(
        client_id=user.get("id"), management_client_id=kid, je_number=je_number[:100],
        entry_date=tgl, posting_date=tgl, period_label=f"{_BULAN[tgl.month - 1]} {tgl.year}",
        description=description[:2000], source_type=SOURCE_TYPE_JURNAL, source_reference=reference[:100],
        total_debit=sum((b["debit"] for b in baris), NOL), total_credit=sum((b["credit"] for b in baris), NOL),
        currency="IDR", status="posted", created_by=user.get("id"), created_by_name=nama, approved_by_name=nama,
        posted_at=datetime.now(), posted_by=user.get("id"),
    )
    session.add(je)
    session.flush()
    for no, b in enumerate(baris, 1):
        session.add(dbc.JournalEntryDraftLine(
            draft_id=je.id, client_id=user.get("id"), line_no=no, account_code=b["account_code"],
            account_name=(b["account_name"] or "")[:200], description=(b.get("description") or "")[:2000],
            debit=b["debit"], credit=b["credit"], created_by=user.get("id"),
        ))
    session.flush()
    dbc._log_je(session, je, "Posted", f"Journal {je.je_number} posted to the general ledger (FX revaluation).", nama, user.get("id"))
    return je


def _nomor_dasar(session, kid: str, per: date) -> str:
    """REV-yyyymmdd; kalau tanggal itu pernah punya run (mis. dibatalkan lalu dibuat ulang) -> REV-yyyymmdd-2, -3, ..."""
    n = session.query(func.count(dbc.FxRevaluationRun.id)).filter(
        dbc.FxRevaluationRun.client_id == kid, dbc.FxRevaluationRun.as_of_date == per).scalar() or 0
    dasar = f"REV-{per:%Y%m%d}"
    return dasar if n == 0 else f"{dasar}-{n + 1}"


# ============================================================
# REQUEST & SERIALISASI
# ============================================================

class HitungRequest(BaseModel):
    client_id: UUID
    as_of: date
    # Kurs penutup manual per mata uang (IDR per 1 unit). Kosong -> kurs master 'middle' terakhir.
    rates: Optional[Dict[str, float]] = None

    @field_validator("rates")
    @classmethod
    def _cek_rates(cls, v):
        for mu, nilai in (v or {}).items():
            if not mu or mu.upper() == "IDR" or len(mu) != 3:
                raise ValueError(f"Invalid currency code '{mu}'.")
            if nilai is None or nilai <= 0:
                raise ValueError(f"Rate for {mu} must be greater than 0.")
        return v


class RunRequest(HitungRequest):
    notes: Optional[str] = Field(None, max_length=500)


class BatalRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


def _run_dict(r: Any, dengan_detail: bool = False) -> Dict[str, Any]:
    d = {
        "id": str(r.id), "as_of": r.as_of_date, "reversal_date": r.reversal_date, "status": r.status,
        "rates": r.rates, "total_gain": bc._f(r.total_gain), "total_loss": bc._f(r.total_loss),
        "net_effect": bc._f(bc._dec(r.total_gain) - bc._dec(r.total_loss)), "document_count": r.document_count,
        "journal_id": r.journal_id, "reversal_journal_id": r.reversal_journal_id, "notes": r.notes,
        "created_at": r.created_at, "created_by_name": r.created_by_name,
        "cancelled_at": r.cancelled_at, "cancelled_by_name": r.cancelled_by_name, "cancel_reason": r.cancel_reason,
    }
    if dengan_detail:
        d["documents"] = r.detail
    return d


# ============================================================
# ENDPOINT
# ============================================================

@router.post("/preview", summary="Hitung revaluasi AR/AP valas per tanggal (tidak menyimpan apa pun)")
def preview(payload: HitungRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_PREVIEW, "preview an FX revaluation")
        bc._wajib_klien(kid)
        hit = _hitung(session, kid, payload.as_of, payload.rates)
        akun_ok = {"gain": _akun_unrealized(session, kid, "gain") is not None,
                   "loss": _akun_unrealized(session, kid, "loss") is not None}
        journal: List[Dict[str, Any]] = []
        siap = not hit["kurang_kurs"] and bool(hit["dokumen"])
        masalah: List[str] = []
        if hit["kurang_kurs"]:
            masalah.append("No closing rate on file for: " + ", ".join(hit["kurang_kurs"]) + ".")
        try:
            journal = _baris_dict(_susun_baris_jurnal(session, kid, hit))
        except _Gagal as e:
            siap = False
            masalah.append(e.message)
        if not hit["dokumen"]:
            masalah.append("No open foreign-currency invoice or bill on this date.")
        elif not any(x["_selisih"] != NOL for x in hit["dokumen"]):
            siap = False
            masalah.append("Every open document is already stated at the closing rate: nothing to revalue.")
        existing = _run_aktif(session, kid, payload.as_of)
        if existing is not None:
            siap = False
            masalah.append(f"A revaluation for {payload.as_of:%d %b %Y} already exists. Cancel it first to run again.")
        return {
            "as_of": payload.as_of, "reversal_date": payload.as_of + timedelta(days=1),
            "rates": list(hit["kurs"].values()), "missing_rates": hit["kurang_kurs"], "accounts_ready": akun_ok,
            "documents": [_bersih(x) for x in hit["dokumen"]],
            "totals": {"gain": bc._f(hit["total_untung"]), "loss": bc._f(hit["total_rugi"]),
                       "net": bc._f(hit["total_untung"] - hit["total_rugi"]), "document_count": len(hit["dokumen"])},
            "journal": journal, "can_run": siap, "issues": masalah,
            "existing_run": _run_dict(existing) if existing is not None else None,
        }
    return bc._respon(aksi)


@router.post("/run", summary="Posting jurnal revaluasi + jurnal pembalik otomatis (Manager ke atas)")
def jalankan(payload: RunRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "post an FX revaluation")
        bc._wajib_klien(kid)
        bc._kunci_klien(session, kid)
        per = payload.as_of
        if _run_aktif(session, kid, per) is not None:
            raise _Gagal(f"A revaluation for {per:%d %b %Y} already exists. Cancel it first to run again.",
                         kode="REVALUATION_EXISTS", status_code=409)
        hit = _hitung(session, kid, per, payload.rates)
        if hit["kurang_kurs"]:
            raise _Gagal("Enter the closing rate for: " + ", ".join(hit["kurang_kurs"])
                         + " (no recent rate is on file for " + f"{per:%d %b %Y}).",
                         kode="FX_RATE_REQUIRED", status_code=422, data={"currencies": hit["kurang_kurs"]})
        if not any(x["_selisih"] != NOL for x in hit["dokumen"]):
            raise _Gagal("Nothing to revalue: no open foreign-currency document differs from its closing-rate value.",
                         kode="NOTHING_TO_REVALUE", status_code=422)
        baris = _susun_baris_jurnal(session, kid, hit)
        pembalik = [{**b, "debit": b["credit"], "credit": b["debit"]} for b in baris]
        tgl_balik = per + timedelta(days=1)
        dasar = _nomor_dasar(session, kid, per)
        ket_kurs = ", ".join(f"{mu} @ {v['rate']:,.2f}" for mu, v in sorted(hit["kurs"].items()))
        je = _tulis_jurnal(session, kid, user, je_number=dasar, tgl=per, reference=dasar,
                           description=f"Unrealized FX revaluation of open AR/AP as of {per:%d %b %Y} ({ket_kurs})", baris=baris)
        jb = _tulis_jurnal(session, kid, user, je_number=f"RV-{dasar}", tgl=tgl_balik, reference=dasar,
                           description=f"Auto-reversal of {dasar} (FX revaluation as of {per:%d %b %Y})", baris=pembalik)
        run = dbc.FxRevaluationRun(
            client_id=kid, as_of_date=per, reversal_date=tgl_balik, status="posted",
            rates={mu: v["rate"] for mu, v in hit["kurs"].items()},
            total_gain=hit["total_untung"], total_loss=hit["total_rugi"], document_count=len(hit["dokumen"]),
            detail=[{**_bersih(x), "date": x["date"].isoformat()} for x in hit["dokumen"]],
            journal_id=je.id, reversal_journal_id=jb.id, notes=payload.notes,
            created_by=user.get("id"), created_by_name=bc._nama(user),
        )
        session.add(run)
        session.flush()
        return {"run": _run_dict(run, dengan_detail=True), "journal": _baris_dict(baris), "reversal_journal": _baris_dict(pembalik),
                "journal_number": je.je_number, "reversal_journal_number": jb.je_number}
    return bc._respon(aksi, "FX revaluation posted.")


@router.get("/runs", summary="Riwayat revaluasi valas klien")
def daftar_run(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(dbc.FxRevaluationRun).filter(dbc.FxRevaluationRun.client_id == kid).order_by(
            dbc.FxRevaluationRun.as_of_date.desc(), dbc.FxRevaluationRun.created_at.desc()).all()
        return [_run_dict(r) for r in rows]
    return bc._respon(aksi)


@router.get("/runs/{run_id}", summary="Detail 1 revaluasi: snapshot per dokumen + jurnal")
def detail_run(run_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    def aksi(session):
        r = session.get(dbc.FxRevaluationRun, str(run_id))
        if r is None or str(r.client_id) != str(client_id):
            raise _Gagal("Revaluation not found.", kode="NOT_FOUND", status_code=404)
        d = _run_dict(r, dengan_detail=True)
        jurnal = {}
        for nama, jid in (("journal", r.journal_id), ("reversal_journal", r.reversal_journal_id)):
            je = session.get(dbc.JournalEntryDraft, jid) if jid else None
            if je is None:
                jurnal[nama] = None
                continue
            baris = session.query(dbc.JournalEntryDraftLine).filter(
                dbc.JournalEntryDraftLine.draft_id == je.id, dbc.JournalEntryDraftLine.deleted_at.is_(None)
            ).order_by(dbc.JournalEntryDraftLine.line_no).all()
            jurnal[nama] = {"id": str(je.id), "number": je.je_number, "date": je.entry_date, "status": je.status,
                            "deleted": je.deleted_at is not None,
                            "lines": [{"account_code": b.account_code, "account_name": b.account_name,
                                       "debit": bc._f(b.debit), "credit": bc._f(b.credit)} for b in baris]}
        return {**d, **jurnal}
    return bc._respon(aksi)


@router.post("/runs/{run_id}/cancel", summary="Batalkan revaluasi: kedua jurnal dihapus dari GL (Manager ke atas)")
def batalkan(run_id: UUID, payload: BatalRequest, client_id: UUID = Query(...),
             user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "cancel an FX revaluation")
        bc._kunci_klien(session, kid)
        r = session.get(dbc.FxRevaluationRun, str(run_id))
        if r is None or str(r.client_id) != kid:
            raise _Gagal("Revaluation not found.", kode="NOT_FOUND", status_code=404)
        if r.status != "posted":
            raise _Gagal("This revaluation is already cancelled.", kode="ALREADY_CANCELLED", status_code=409)
        sekarang = datetime.now()
        for jid in (r.journal_id, r.reversal_journal_id):
            je = session.get(dbc.JournalEntryDraft, jid) if jid else None
            if je is None or je.deleted_at is not None:
                continue
            dbc._log_je(session, je, "Deleted", f"Journal {je.je_number} removed: FX revaluation cancelled."
                        + (f" Reason: {payload.reason}" if payload.reason else ""), bc._nama(user), user.get("id"))
            je.deleted_at, je.deleted_by = sekarang, user.get("id")
            for b in session.query(dbc.JournalEntryDraftLine).filter(
                    dbc.JournalEntryDraftLine.draft_id == je.id, dbc.JournalEntryDraftLine.deleted_at.is_(None)).all():
                b.deleted_at, b.deleted_by = sekarang, user.get("id")
        r.status = "cancelled"
        r.cancelled_at, r.cancelled_by, r.cancelled_by_name = sekarang, user.get("id"), bc._nama(user)
        r.cancel_reason = payload.reason
        session.flush()
        return _run_dict(r)
    return bc._respon(aksi, "FX revaluation cancelled.")
