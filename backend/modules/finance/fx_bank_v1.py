"""
modules/finance/fx_bank_v1.py
=============================
Fase 3B/3C kurs: REKENING KAS/BANK VALAS dan TRANSFER ANTAR REKENING BEDA MATA UANG -> /api/v1/finance/fx-bank/...

Buku besar tetap dalam IDR. Rekening bank valas (mis. "Bank BCA USD") adalah satu akun COA biasa; modul ini menambah
informasi "berapa USD-nya" supaya dua hal bisa dihitung:

  3B  Saldo valas per tanggal + nilai buku IDR (dari GL) -> biaya rata-rata (IDR per 1 unit) dan dasar REVALUASI akhir
      periode (fx_revaluation_v1.py memanggil posisi_bank_valas() di sini; revaluasi bank ikut 1 run dgn AR/AP).
  3C  Transfer antar rekening beda mata uang (IDR -> USD, USD -> IDR, USD -> EUR, USD -> USD rekening lain).

SALDO VALAS rekening = saldo awal (sebelum tracking_start) + gerakan sejak tracking_start dari:
  - transaksi Cash & Bank di rekening itu (posted; reversed baru dikeluarkan setelah tanggal pembaliknya). Nominal valas:
    header fx_amount kalau diisi, kalau tidak jumlah fx_amount baris pelunasan invoice valas (mata uang sama dgn rekening).
    Selain itu transaksi dianggap BELUM DIKONVERSI -> dilaporkan, dan revaluasi/transfer dari rekening itu ditolak sampai
    nominal valasnya diisi (PUT /transactions/{id}/foreign-amount).
  - transfer antar mata uang (modul ini).
NILAI BUKU IDR = saldo GL akun itu (semua sumber, tanpa jurnal revaluasi). Jurnal manual / sumber lain di akun valas SETELAH
tracking_start tidak punya nominal valas -> dilaporkan sebagai masalah.

TRANSFER (Dr tujuan / Cr asal, jurnal POSTED source_type 'FxTransfer', nomor FXT-yymm-nnnn):
  nilai keluar  = rekening IDR: nominal ; rekening valas: nominal x biaya rata-rata (saldo habis -> sisa buku persis)
  nilai masuk   = IDR: nominal ; valas beda mata uang: nominal x kurs penilaian (rate_in, default kurs master 'middle') ;
                  valas SAMA mata uang (antar rekening): nilai keluar dibawa utuh (tanpa untung/rugi)
  selisih       = nilai masuk - nilai keluar -> FX Gain (> 0) / FX Loss (< 0) TERealisasi (Account Mapping fx_gain_realized /
                  fx_loss_realized). Contoh IDR -> USD: spread bank terhadap kurs tengah tercatat sebagai rugi kurs.
Pembalikan: jurnal RV-<nomor> di tanggal pembalikan; transfer baru dikeluarkan dari saldo valas setelah tanggal itu.

Endpoint:
    GET  /accounts                              rekening kas/bank + mata uang + saldo valas, nilai buku, transaksi belum dikonversi
    PUT  /accounts                              tandai rekening sebagai valas / ubah tracking_start & saldo awal  -- Manager+
    DELETE /accounts/{coa_id}                   lepas penanda valas (ditolak kalau sudah ada transfer aktif)      -- Manager+
    PUT  /transactions/{tx_id}/foreign-amount   isi nominal valas transaksi Cash & Bank di rekening valas        -- Supervisor+
    POST /transfers/preview                     hitung saja                                                       -- Supervisor+
    POST /transfers                             posting transfer + jurnal                                         -- Manager+
    GET  /transfers                             riwayat
    POST /transfers/{id}/reverse                balik transfer                                                    -- Manager+

Batasan yang disengaja: tanpa biaya transfer (catat biaya bank sebagai transaksi Cash & Bank biasa); transfer ini belum bisa
dicocokkan dari Bank Feed; satu klien memakai metode biaya rata-rata (bukan FIFO).
"""

from __future__ import annotations

from datetime import date, datetime
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

logger = get_module_logger("finance_fx_bank_v1")

router = APIRouter(prefix="/api/v1/finance/fx-bank", tags=["fx-bank"])

LEVEL_VIEW = bc.LEVEL_INPUT          # Supervisor+
LEVEL_POST = bc.LEVEL_POST           # Manager+
NOL = bc.NOL
IDR = "IDR"
SOURCE_TYPE_TRANSFER = "FxTransfer"
SOURCE_TYPE_REVALUASI = "Revaluation"      # jurnal revaluasi (fx_revaluation_v1) -- tidak dihitung ke nilai buku dasar
TOLERANSI_SALDO = Decimal("0.01")
_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober",
          "November", "Desember"]

TX, TL = bc.TX, bc.TL
_Gagal = bc._Gagal
FA = dbc.FxBankAccount
FT = dbc.FxTransfer


# ============================================================
# JURNAL (dipakai juga oleh fx_revaluation_v1)
# ============================================================

def tulis_jurnal(session, kid: str, user: Dict[str, Any], *, source_type: str, je_number: str, tgl: date,
                 description: str, reference: str, baris: List[Dict[str, Any]], log: str) -> Any:
    """Insert 1 jurnal POSTED + barisnya (pola opening_balance_v1._tulis_jurnal). TIDAK commit."""
    nama = bc._nama(user)
    je = dbc.JournalEntryDraft(
        client_id=user.get("id"), management_client_id=kid, je_number=je_number[:100],
        entry_date=tgl, posting_date=tgl, period_label=f"{_BULAN[tgl.month - 1]} {tgl.year}",
        description=description[:2000], source_type=source_type, source_reference=reference[:100],
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
    dbc._log_je(session, je, "Posted", f"Journal {je.je_number} posted to the general ledger ({log}).", nama, user.get("id"))
    return je


# ============================================================
# SALDO & NILAI BUKU REKENING VALAS
# ============================================================

def _muat_konteks(session, kid: str, per: date) -> Dict[str, Any]:
    """Baris GL posted s.d. `per` + id jurnal yang dikecualikan (revaluasi) / dikenal (transfer)."""
    rows = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=kid, sampai_tanggal=per)
    JE = dbc.JournalEntryDraft
    reval = {f"je:{i}" for (i,) in session.query(JE.id).filter(
        JE.management_client_id == kid, JE.source_type == SOURCE_TYPE_REVALUASI).all()}
    transfer = set()
    for j1, j2 in session.query(FT.journal_id, FT.reversal_journal_id).filter(FT.client_id == kid).all():
        transfer.update(f"je:{j}" for j in (j1, j2) if j)
    return {"rows": rows, "reval": reval, "transfer": transfer}


def _asing_tx(session, txs: List[Any], mu: str) -> Tuple[Dict[str, Decimal], List[Any]]:
    """Nominal valas per transaksi Cash & Bank di rekening valas -> ({tx_id: nominal}, transaksi belum dikonversi)."""
    jumlah_baris: Dict[str, Decimal] = {}
    ids = [t.id for t in txs]
    if ids:
        for tid, n in session.query(TL.transaction_id, func.sum(TL.fx_amount)).filter(
                TL.transaction_id.in_(ids), TL.fx_amount.isnot(None), TL.is_fx_difference.is_(False)
        ).group_by(TL.transaction_id).all():
            jumlah_baris[str(tid)] = bc._dec(n)
    hasil: Dict[str, Decimal] = {}
    belum: List[Any] = []
    for t in txs:
        if t.fx_amount is not None:
            hasil[str(t.id)] = bc._dec(t.fx_amount)
        elif (t.currency or IDR).upper() == mu and jumlah_baris.get(str(t.id), NOL) > NOL:
            hasil[str(t.id)] = jumlah_baris[str(t.id)]
        else:
            belum.append(t)
    return hasil, belum


def _posisi(session, kid: str, fa: Any, akun: Any, per: date, ctx: Dict[str, Any]) -> Dict[str, Any]:
    mu, kode, mulai = fa.currency.upper(), akun.acc_no, fa.tracking_start
    issues: List[str] = []

    semua_tx = {str(i) for (i,) in session.query(TX.id).filter(TX.client_id == kid, TX.bank_coa_id == fa.coa_id).all()}
    txs = session.query(TX).filter(
        TX.client_id == kid, TX.bank_coa_id == fa.coa_id, TX.deleted_at.is_(None), TX.status.in_(("posted", "reversed")),
        TX.tx_date >= mulai, TX.tx_date <= per,
    ).all()
    txs = [t for t in txs if not (t.status == "reversed" and t.reversal_date and t.reversal_date <= per)]
    nilai_tx, belum = _asing_tx(session, txs, mu)
    asing = bc._dec(fa.opening_foreign)
    for t in txs:
        n = nilai_tx.get(str(t.id))
        if n is not None:
            asing += n if t.direction == "receipt" else -n

    transfer = session.query(FT).filter(
        FT.client_id == kid, FT.transfer_date >= mulai, FT.transfer_date <= per,
        (FT.from_coa_id == fa.coa_id) | (FT.to_coa_id == fa.coa_id),
    ).all()
    for tr in transfer:
        if tr.status == "reversed" and tr.reversal_date and tr.reversal_date <= per:
            continue
        if str(tr.from_coa_id) == str(fa.coa_id):
            asing -= bc._dec(tr.from_amount)
        if str(tr.to_coa_id) == str(fa.coa_id):
            asing += bc._dec(tr.to_amount)

    # Nilai buku IDR = saldo GL akun (tanpa jurnal revaluasi). Gerakan GL yang tidak punya nominal valas dilaporkan.
    buku = NOL
    jurnal_lain = 0
    nilai_lain = NOL
    for x in ctx["rows"]:
        if x["account_code"] != kode or x["jurnal_id"] in ctx["reval"]:
            continue
        net = bc._dec(x["debit"]) - bc._dec(x["kredit"])
        buku += net
        if x["tanggal"] < mulai:
            continue
        jid = x["jurnal_id"]
        if jid.startswith("cash_bank:"):
            if jid.split(":", 1)[1] in semua_tx:
                continue
        elif jid in ctx["transfer"]:
            continue
        jurnal_lain += 1
        nilai_lain += net
    if belum:
        issues.append(f"{len(belum)} Cash & Bank transaction(s) on {kode} have no {mu} amount: "
                      + ", ".join(t.tx_number for t in belum[:5]) + (" ..." if len(belum) > 5 else "") + ".")
    if jurnal_lain:
        issues.append(f"{jurnal_lain} ledger line(s) on {kode} since {mulai:%d %b %Y} (net {bc._f(nilai_lain):,.2f} IDR) "
                      f"come from journals or transactions without a {mu} amount.")
    rata = (buku / asing) if asing != NOL else None
    return {
        "coa_id": str(akun.id), "account_code": kode, "account_name": akun.account_name, "currency": mu,
        "foreign_balance": asing, "carrying_idr": buku, "average_rate": rata, "issues": issues,
        "unconverted": [{"id": str(t.id), "tx_number": t.tx_number, "tx_date": t.tx_date, "direction": t.direction,
                         "amount_idr": bc._f(t.amount), "currency": t.currency, "description": t.description} for t in belum],
        "tracking_start": mulai, "opening_foreign": bc._f(fa.opening_foreign),
    }


def _akun_valas(session, kid: str) -> List[Tuple[Any, Any]]:
    hasil = []
    for fa in session.query(FA).filter(FA.client_id == kid).order_by(FA.created_at).all():
        akun = session.get(bc.COA, fa.coa_id)
        if akun is not None and akun.deleted_at is None:
            hasil.append((fa, akun))
    return hasil


def posisi_bank_valas(session, kid: str, per: date) -> List[Dict[str, Any]]:
    """Posisi tiap rekening kas/bank valas per tanggal `per` (dipakai revaluasi). Murni baca."""
    pasangan = _akun_valas(session, kid)
    if not pasangan:
        return []
    ctx = _muat_konteks(session, kid, per)
    return [_posisi(session, kid, fa, akun, per, ctx) for fa, akun in pasangan if fa.tracking_start <= per]


def _dict_posisi(p: Dict[str, Any]) -> Dict[str, Any]:
    return {**p, "foreign_balance": bc._f(p["foreign_balance"]), "carrying_idr": bc._f(p["carrying_idr"]),
            "average_rate": float(p["average_rate"]) if p["average_rate"] is not None else None}


# ============================================================
# REQUEST
# ============================================================

def _kode_mu(v: str) -> str:
    v = (v or "").strip().upper()
    if len(v) != 3 or not v.isalpha() or v == IDR:
        raise ValueError("Currency must be a 3-letter code other than IDR.")
    return v


class AkunValasRequest(BaseModel):
    client_id: UUID
    coa_id: UUID
    currency: str
    tracking_start: date
    opening_foreign: float = Field(0, ge=0)
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("currency")
    @classmethod
    def _cek_mu(cls, v):
        return _kode_mu(v)


class JumlahValasRequest(BaseModel):
    client_id: UUID
    fx_amount: Optional[float] = Field(None, gt=0)
    fx_rate: Optional[float] = Field(None, gt=0)


class TransferRequest(BaseModel):
    client_id: UUID
    transfer_date: date
    from_coa_id: UUID
    to_coa_id: UUID
    from_amount: float = Field(..., gt=0)
    to_amount: float = Field(..., gt=0)
    # Kurs penilaian sisi masuk (IDR per 1 unit mata uang tujuan). Kosong -> kurs master 'middle' (maks 10 hari lalu).
    rate_in: Optional[float] = Field(None, gt=0)
    reference: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = Field(None, max_length=500)


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: Optional[str] = Field(None, max_length=500)


# ============================================================
# REKENING
# ============================================================

def _akun_kas(session, kid: str, coa_id: Any) -> Any:
    akun = session.get(bc.COA, str(coa_id))
    if akun is None or akun.deleted_at is not None or str(akun.client_id) != kid:
        raise _Gagal("Account not found.", kode="NOT_FOUND", status_code=404)
    if not akun.is_active or not bc._jenis_kas(akun):
        raise _Gagal(f"{akun.acc_no} {akun.account_name} is not an active cash or bank account.")
    return akun


@router.get("/accounts", summary="Rekening kas/bank klien + mata uang, saldo valas, nilai buku & transaksi belum dikonversi")
def daftar_rekening(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                    _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        per = as_of or date.today()
        akun_semua = session.query(bc.COA).filter(bc.COA.client_id == kid, bc.COA.deleted_at.is_(None),
                                                  bc.COA.is_active.is_(True)).order_by(bc.COA.acc_no).all()
        kas = [a for a in akun_semua if bc._jenis_kas(a)]
        valas = {str(fa.coa_id): fa for fa, _a in _akun_valas(session, kid)}
        ctx = _muat_konteks(session, kid, per) if valas else None
        hasil = []
        for a in kas:
            fa = valas.get(str(a.id))
            d = {"coa_id": str(a.id), "account_code": a.acc_no, "account_name": a.account_name, "kind": bc._jenis_kas(a),
                 "currency": fa.currency.upper() if fa else IDR, "is_foreign": fa is not None}
            if fa is not None:
                d.update({"tracking_start": fa.tracking_start, "opening_foreign": bc._f(fa.opening_foreign), "notes": fa.notes})
                if fa.tracking_start <= per:
                    p = _dict_posisi(_posisi(session, kid, fa, a, per, ctx))
                    d.update({k: p[k] for k in ("foreign_balance", "carrying_idr", "average_rate", "issues", "unconverted")})
                else:
                    d.update({"foreign_balance": bc._f(fa.opening_foreign), "carrying_idr": None, "average_rate": None,
                              "issues": [f"Tracking starts on {fa.tracking_start:%d %b %Y}."], "unconverted": []})
            hasil.append(d)
        return {"as_of": per, "accounts": hasil}
    return bc._respon(aksi)


@router.put("/accounts", summary="Tandai rekening kas/bank sebagai rekening valas (Manager ke atas)")
def simpan_rekening(payload: AkunValasRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "set up a foreign-currency bank account")
        bc._wajib_klien(kid)
        bc._kunci_klien(session, kid)
        akun = _akun_kas(session, kid, payload.coa_id)
        fa = session.query(FA).filter(FA.client_id == kid, FA.coa_id == str(payload.coa_id)).first()
        if fa is None:
            fa = FA(client_id=kid, coa_id=str(payload.coa_id), created_by=user.get("id"), created_by_name=bc._nama(user))
            session.add(fa)
        else:
            if fa.currency.upper() != payload.currency and session.query(FT.id).filter(
                    FT.client_id == kid, (FT.from_coa_id == fa.coa_id) | (FT.to_coa_id == fa.coa_id)).first() is not None:
                raise _Gagal("The currency cannot be changed after transfers exist on this account.", kode="CURRENCY_LOCKED", status_code=409)
            fa.edited_at, fa.edited_by_name = datetime.now(), bc._nama(user)
        fa.currency, fa.tracking_start = payload.currency, payload.tracking_start
        fa.opening_foreign, fa.notes = bc._dec(payload.opening_foreign), payload.notes
        session.flush()
        return {"coa_id": str(akun.id), "account_code": akun.acc_no, "currency": fa.currency,
                "tracking_start": fa.tracking_start, "opening_foreign": bc._f(fa.opening_foreign)}
    return bc._respon(aksi, "Foreign-currency bank account saved.")


@router.delete("/accounts/{coa_id}", summary="Lepas penanda rekening valas (Manager ke atas)")
def hapus_rekening(coa_id: UUID, client_id: UUID = Query(...), user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "remove a foreign-currency bank account")
        bc._kunci_klien(session, kid)
        fa = session.query(FA).filter(FA.client_id == kid, FA.coa_id == str(coa_id)).first()
        if fa is None:
            raise _Gagal("This account is not marked as foreign-currency.", kode="NOT_FOUND", status_code=404)
        if session.query(FT.id).filter(FT.client_id == kid, FT.status == "posted",
                                       (FT.from_coa_id == fa.coa_id) | (FT.to_coa_id == fa.coa_id)).first() is not None:
            raise _Gagal("Reverse the transfers on this account first.", kode="HAS_TRANSFERS", status_code=409)
        session.delete(fa)
        session.flush()
        return {"coa_id": str(coa_id)}
    return bc._respon(aksi, "Foreign-currency marker removed.")


@router.put("/transactions/{tx_id}/foreign-amount", summary="Isi nominal valas transaksi Cash & Bank di rekening valas (Supervisor ke atas)")
def isi_nominal_valas(tx_id: UUID, payload: JumlahValasRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_VIEW, "set the foreign amount of a transaction")
        bc._kunci_klien(session, kid)
        tx = session.get(TX, str(tx_id))
        if tx is None or tx.deleted_at is not None or str(tx.client_id) != kid:
            raise _Gagal("Transaction not found.", kode="NOT_FOUND", status_code=404)
        fa = session.query(FA).filter(FA.client_id == kid, FA.coa_id == tx.bank_coa_id).first()
        if fa is None:
            raise _Gagal("This transaction is not on a foreign-currency bank account.", kode="NOT_FOREIGN_ACCOUNT")
        if tx.status == "reversed":
            raise _Gagal("A reversed transaction cannot be changed.", kode="TX_REVERSED", status_code=409)
        tx.fx_amount = bc._dec(payload.fx_amount) if payload.fx_amount is not None else None
        tx.fx_rate = (bc._dec(payload.fx_rate).quantize(Decimal("0.000001")) if payload.fx_rate is not None else None)
        session.flush()
        return {"id": str(tx.id), "tx_number": tx.tx_number, "currency": fa.currency.upper(),
                "fx_amount": bc._f(tx.fx_amount) if tx.fx_amount is not None else None,
                "fx_rate": float(tx.fx_rate) if tx.fx_rate is not None else None}
    return bc._respon(aksi, "Foreign amount saved.")


# ============================================================
# TRANSFER
# ============================================================

def _mu_akun(session, kid: str, akun: Any) -> Tuple[str, Optional[Any]]:
    fa = session.query(FA).filter(FA.client_id == kid, FA.coa_id == str(akun.id)).first()
    return (fa.currency.upper(), fa) if fa is not None else (IDR, None)


def _rencana(session, kid: str, p: TransferRequest) -> Dict[str, Any]:
    """Validasi + hitung nilai transfer. Murni baca; melempar _Gagal untuk pelanggaran aturan."""
    if str(p.from_coa_id) == str(p.to_coa_id):
        raise _Gagal("The source and destination accounts must be different.")
    asal = _akun_kas(session, kid, p.from_coa_id)
    tujuan = _akun_kas(session, kid, p.to_coa_id)
    mu_a, fa_a = _mu_akun(session, kid, asal)
    mu_t, fa_t = _mu_akun(session, kid, tujuan)
    if mu_a == IDR and mu_t == IDR:
        raise _Gagal("Both accounts are in IDR. Record IDR transfers in Cash & Bank; mark a bank account as "
                     "foreign-currency first to transfer between currencies.", kode="NO_FOREIGN_ACCOUNT")
    tgl = p.transfer_date
    for fa, akun in ((fa_a, asal), (fa_t, tujuan)):
        if fa is not None and tgl < fa.tracking_start:
            raise _Gagal(f"{akun.acc_no} tracks its {fa.currency.upper()} balance from {fa.tracking_start:%d %b %Y}; "
                         "the transfer date cannot be earlier.", kode="BEFORE_TRACKING_START")

    dari, ke = bc._bulat(bc._dec(p.from_amount)), bc._bulat(bc._dec(p.to_amount))
    if dari <= NOL or ke <= NOL:
        raise _Gagal("Amounts must be greater than 0.")
    if mu_a == mu_t and dari != ke:
        raise _Gagal(f"Both accounts are in {mu_a}: the amount received must equal the amount sent.", kode="AMOUNT_MISMATCH")

    ctx = _muat_konteks(session, kid, tgl) if fa_a is not None else None
    posisi_asal: Optional[Dict[str, Any]] = None
    if fa_a is None:
        nilai_keluar = dari
    else:
        posisi_asal = _posisi(session, kid, fa_a, asal, tgl, ctx)
        if posisi_asal["issues"]:
            raise _Gagal(f"The {mu_a} balance of {asal.acc_no} is not reliable yet: {posisi_asal['issues'][0]}",
                         kode="FX_BANK_UNCONVERTED", status_code=422, data={"issues": posisi_asal["issues"]})
        saldo = posisi_asal["foreign_balance"]
        if dari > saldo + TOLERANSI_SALDO:
            raise _Gagal(f"Insufficient balance: {asal.acc_no} holds {bc._f(saldo):,.2f} {mu_a} on {tgl:%d %b %Y}, "
                         f"but {bc._f(dari):,.2f} {mu_a} is being sent.", kode="INSUFFICIENT_BALANCE", status_code=422)
        nilai_keluar = posisi_asal["carrying_idr"] if dari >= saldo - TOLERANSI_SALDO else bc._bulat(posisi_asal["carrying_idr"] * dari / saldo)

    rate_in: Optional[Decimal] = None
    if mu_t == IDR:
        nilai_masuk = ke
    elif mu_t == mu_a:
        nilai_masuk = nilai_keluar
    else:
        rate_in = bc._dec(p.rate_in) if p.rate_in is not None else bc._kurs_master(session, mu_t, tgl)
        if rate_in is None or rate_in <= 0:
            raise _Gagal(f"Enter the {mu_t} valuation rate: no recent rate is on file for {tgl:%d %b %Y}.",
                         kode="FX_RATE_REQUIRED", status_code=422)
        rate_in = rate_in.quantize(Decimal("0.000001"))
        nilai_masuk = bc._bulat(ke * rate_in)

    selisih = nilai_masuk - nilai_keluar
    baris: List[Dict[str, Any]] = [
        {"account_code": tujuan.acc_no, "account_name": tujuan.account_name, "debit": nilai_masuk, "credit": NOL,
         "description": f"Received {bc._f(ke):,.2f} {mu_t}"},
        {"account_code": asal.acc_no, "account_name": asal.account_name, "debit": NOL, "credit": nilai_keluar,
         "description": f"Sent {bc._f(dari):,.2f} {mu_a}"},
    ]
    if selisih != NOL:
        untung = selisih > NOL
        akun_fx = bc._akun_fx(session, kid, "gain" if untung else "loss")
        baris.append({"account_code": akun_fx.acc_no, "account_name": akun_fx.account_name,
                      "debit": NOL if untung else -selisih, "credit": selisih if untung else NOL,
                      "description": f"Realized FX {'gain' if untung else 'loss'} on currency transfer"})
    return {"asal": asal, "tujuan": tujuan, "mu_a": mu_a, "mu_t": mu_t, "dari": dari, "ke": ke, "rate_in": rate_in,
            "nilai_keluar": nilai_keluar, "nilai_masuk": nilai_masuk, "selisih": selisih, "baris": baris,
            "posisi_asal": posisi_asal}


def _baris_dict(baris: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{**b, "debit": bc._f(b["debit"]), "credit": bc._f(b["credit"])} for b in baris]


def _ringkas_rencana(r: Dict[str, Any]) -> Dict[str, Any]:
    pa = r["posisi_asal"]
    return {
        "from": {"account_code": r["asal"].acc_no, "account_name": r["asal"].account_name, "currency": r["mu_a"], "amount": bc._f(r["dari"])},
        "to": {"account_code": r["tujuan"].acc_no, "account_name": r["tujuan"].account_name, "currency": r["mu_t"], "amount": bc._f(r["ke"])},
        "from_average_rate": float(pa["average_rate"]) if pa and pa["average_rate"] is not None else None,
        "from_balance": bc._f(pa["foreign_balance"]) if pa else None,
        "rate_in": float(r["rate_in"]) if r["rate_in"] is not None else None,
        "value_out_idr": bc._f(r["nilai_keluar"]), "value_in_idr": bc._f(r["nilai_masuk"]),
        "fx_difference": bc._f(r["selisih"]), "effect": None if r["selisih"] == NOL else ("gain" if r["selisih"] > NOL else "loss"),
        "journal": _baris_dict(r["baris"]),
    }


def _nomor_transfer(session, kid: str, tgl: date) -> str:
    awal = f"FXT-{tgl:%y%m}-"
    n = session.query(func.count(FT.id)).filter(FT.client_id == kid, FT.transfer_no.like(awal + "%")).scalar() or 0
    return f"{awal}{n + 1:04d}"


def _transfer_dict(t: Any) -> Dict[str, Any]:
    return {
        "id": str(t.id), "transfer_no": t.transfer_no, "transfer_date": t.transfer_date, "status": t.status,
        "from_account_code": t.from_account_code, "from_account_name": t.from_account_name, "from_currency": t.from_currency,
        "from_amount": bc._f(t.from_amount), "to_account_code": t.to_account_code, "to_account_name": t.to_account_name,
        "to_currency": t.to_currency, "to_amount": bc._f(t.to_amount), "rate_in": float(t.rate_in) if t.rate_in is not None else None,
        "value_out_idr": bc._f(t.value_out_idr), "value_in_idr": bc._f(t.value_in_idr), "fx_difference": bc._f(t.fx_difference),
        "effect": None if bc._dec(t.fx_difference) == NOL else ("gain" if bc._dec(t.fx_difference) > NOL else "loss"),
        "journal_id": t.journal_id, "reversal_journal_id": t.reversal_journal_id, "reversal_date": t.reversal_date,
        "reversal_reason": t.reversal_reason, "reference": t.reference, "notes": t.notes,
        "created_at": t.created_at, "created_by_name": t.created_by_name, "reversed_by_name": t.reversed_by_name,
    }


@router.post("/transfers/preview", summary="Hitung transfer antar mata uang (tidak menyimpan apa pun)")
def preview_transfer(payload: TransferRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_VIEW, "preview a currency transfer")
        bc._wajib_klien(kid)
        try:
            r = _rencana(session, kid, payload)
        except _Gagal as e:
            return {"can_post": False, "issues": [e.message], "code": e.kode}
        return {"can_post": True, "issues": [], **_ringkas_rencana(r)}
    return bc._respon(aksi)


@router.post("/transfers", summary="Posting transfer antar rekening beda mata uang (Manager ke atas)")
def buat_transfer(payload: TransferRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "post a currency transfer")
        bc._wajib_klien(kid)
        bc._kunci_klien(session, kid)
        r = _rencana(session, kid, payload)
        no = _nomor_transfer(session, kid, payload.transfer_date)
        asal, tujuan = r["asal"], r["tujuan"]
        je = tulis_jurnal(
            session, kid, user, source_type=SOURCE_TYPE_TRANSFER, je_number=no, tgl=payload.transfer_date, reference=no,
            description=(f"Currency transfer {no}: {bc._f(r['dari']):,.2f} {r['mu_a']} from {asal.acc_no} to "
                         f"{bc._f(r['ke']):,.2f} {r['mu_t']} in {tujuan.acc_no}"
                         + (f" - {payload.notes}" if payload.notes else "")),
            baris=r["baris"], log="currency transfer")
        t = FT(
            client_id=kid, transfer_no=no, transfer_date=payload.transfer_date,
            from_coa_id=asal.id, from_account_code=asal.acc_no, from_account_name=asal.account_name,
            from_currency=r["mu_a"], from_amount=r["dari"],
            to_coa_id=tujuan.id, to_account_code=tujuan.acc_no, to_account_name=tujuan.account_name,
            to_currency=r["mu_t"], to_amount=r["ke"], rate_in=r["rate_in"],
            value_out_idr=r["nilai_keluar"], value_in_idr=r["nilai_masuk"], fx_difference=r["selisih"],
            status="posted", journal_id=je.id, reference=payload.reference, notes=payload.notes,
            created_by=user.get("id"), created_by_name=bc._nama(user),
        )
        session.add(t)
        session.flush()
        return {"transfer": _transfer_dict(t), **_ringkas_rencana(r), "journal_number": je.je_number}
    return bc._respon(aksi, "Currency transfer posted.")


@router.get("/transfers", summary="Riwayat transfer antar mata uang klien")
def daftar_transfer(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(FT).filter(FT.client_id == kid).order_by(FT.transfer_date.desc(), FT.created_at.desc()).all()
        return [_transfer_dict(t) for t in rows]
    return bc._respon(aksi)


@router.post("/transfers/{transfer_id}/reverse", summary="Balik transfer: jurnal pembalik di tanggal pembalikan (Manager ke atas)")
def balik_transfer(transfer_id: UUID, payload: BalikRequest, user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        rp._wajib_level(user, LEVEL_POST, "reverse a currency transfer")
        bc._kunci_klien(session, kid)
        t = session.get(FT, str(transfer_id))
        if t is None or str(t.client_id) != kid:
            raise _Gagal("Transfer not found.", kode="NOT_FOUND", status_code=404)
        if t.status != "posted":
            raise _Gagal("This transfer is already reversed.", kode="ALREADY_REVERSED", status_code=409)
        tgl = payload.reversal_date or max(date.today(), t.transfer_date)
        if tgl < t.transfer_date:
            raise _Gagal("The reversal date cannot be earlier than the transfer date.")
        fa_t = session.query(FA).filter(FA.client_id == kid, FA.coa_id == t.to_coa_id).first()
        if fa_t is not None:       # uang yang sudah diterima rekening valas tujuan tidak boleh sudah terpakai
            akun_t = session.get(bc.COA, t.to_coa_id)
            pos = _posisi(session, kid, fa_t, akun_t, tgl, _muat_konteks(session, kid, tgl))
            if pos["foreign_balance"] - bc._dec(t.to_amount) < -TOLERANSI_SALDO:
                raise _Gagal(f"Cannot reverse: {akun_t.acc_no} holds only {bc._f(pos['foreign_balance']):,.2f} {fa_t.currency.upper()} "
                             f"on {tgl:%d %b %Y}, less than the {bc._f(t.to_amount):,.2f} received by this transfer.",
                             kode="INSUFFICIENT_BALANCE", status_code=409)
        baris = session.query(dbc.JournalEntryDraftLine).filter(
            dbc.JournalEntryDraftLine.draft_id == t.journal_id, dbc.JournalEntryDraftLine.deleted_at.is_(None)
        ).order_by(dbc.JournalEntryDraftLine.line_no).all()
        pembalik = [{"account_code": b.account_code, "account_name": b.account_name, "description": f"Reversal: {b.description or ''}".strip(),
                     "debit": bc._dec(b.credit), "credit": bc._dec(b.debit)} for b in baris]
        jb = tulis_jurnal(
            session, kid, user, source_type=SOURCE_TYPE_TRANSFER, je_number=f"RV-{t.transfer_no}", tgl=tgl, reference=t.transfer_no,
            description=f"Reversal of {t.transfer_no}" + (f": {payload.reason}" if payload.reason else ""),
            baris=pembalik, log="currency transfer reversal")
        t.status, t.reversal_journal_id, t.reversal_date = "reversed", jb.id, tgl
        t.reversal_reason, t.reversed_at = payload.reason, datetime.now()
        t.reversed_by, t.reversed_by_name = user.get("id"), bc._nama(user)
        session.flush()
        return _transfer_dict(t)
    return bc._respon(aksi, "Currency transfer reversed.")
