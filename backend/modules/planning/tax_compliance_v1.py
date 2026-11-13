"""
modules/planning/tax_compliance_v1.py
=====================================
Tax Compliance (grup sidebar Planning), UI dataset/picture/Template UI/Tax
Compliance/1-8.jpeg -- tab Overview, Tax Ledger, PPh, VAT, Payments,
Reconciliation, Exceptions, Reports. Semua endpoint di /api/v1/planning/tax/...
Tabel: migrations/41-create_tax_compliance_tables.py.

Sumber data = transaksi yang sudah POSTED (POST /sync, dipanggil halaman saat
dibuka dan lewat tombol Sync):
    Sales posted        ppn  -> VAT Output ; pph (dipotong customer) -> PPh Credit
    Purchase posted     tax_amount -> VAT Input
    Journal Entry &     baris di akun pajak (planning_tax_account_mappings, atau
    Cash & Bank posted  tebakan dari COA): kredit akun hutang pajak = kewajiban,
                        debit akun PPN Masukan / pajak dibayar dimuka = kredit pajak.
                        Transaksi Cash & Bank source 'tax' (setoran dari modul ini)
                        dan transaksi yang dibalik tidak ikut.
    Manual              Add Adjustment.
Baris hasil sinkron yang sumbernya hilang/batal posting ikut terhapus; isian
user (nomor e-Faktur / e-Bupot, kode objek, NPWP, catatan) dipertahankan.

Status bayar per baris dihitung FIFO per jenis & masa dari setoran berstatus
paid (PPN: Keluaran dikurangi Masukan masa yang sama dulu). Status lapor dari
SPT (planning_tax_filings) jenis & masa yang sama. Jatuh tempo (PMK 81/2024):
setor PPh masa tgl 15 bulan berikutnya, PPN akhir bulan berikutnya; lapor SPT
Masa PPh tgl 20, SPT Masa PPN akhir bulan berikutnya, SPT Tahunan Badan 30 April.

Record Tax Payment bisa membuat transaksi Cash Payment (source 'tax'):
Dr akun hutang pajak / Cr akun bank -> GL lewat jalur Cash & Bank biasa.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_helpers as bc

logger = get_module_logger("planning_tax_compliance_v1")

router = APIRouter(prefix="/api/v1/planning/tax", tags=["tax-compliance"])

LEVEL_INPUT = bc.LEVEL_INPUT
LEVEL_POST = bc.LEVEL_POST
NOL = Decimal("0")
SEN = Decimal("0.01")
_Gagal = bc._Gagal
_f = bc._f
_nama = bc._nama
_sekarang = bc._sekarang

MAP = dbc.TaxAccountMapping
LG = dbc.TaxLedgerEntry
PAY = dbc.TaxPayment
FIL = dbc.TaxFiling
EXC = dbc.TaxException
REC = dbc.TaxReconciliation
COA = dbc.ManagementClientCoa
TX = dbc.BankCashTransaction
SI = dbc.SalesInvoice
PT = dbc.PurchaseTransaction


@dataclass(frozen=True)
class Jenis:
    label: str
    sifat: str                     # payable / creditable
    bayar: Optional[str]           # kunci setoran
    spt: Optional[str]             # jenis SPT
    tarif: Optional[Decimal]       # tarif standar (persen)
    kelompok: str                  # vat / pph / other


JENIS: Dict[str, Jenis] = {
    "vat_output": Jenis("VAT Output", "payable", "vat", "ppn", Decimal("11"), "vat"),
    "vat_input": Jenis("VAT Input", "creditable", None, "ppn", Decimal("11"), "vat"),
    "pph21": Jenis("PPh 21", "payable", "pph21", "pph21", None, "pph"),
    "pph22": Jenis("PPh 22", "payable", "pph22", "unifikasi", Decimal("1.5"), "pph"),
    "pph23": Jenis("PPh 23", "payable", "pph23", "unifikasi", Decimal("2"), "pph"),
    "pph26": Jenis("PPh 26", "payable", "pph26", "unifikasi", Decimal("20"), "pph"),
    "pph4_2": Jenis("PPh 4(2)", "payable", "pph4_2", "unifikasi", Decimal("10"), "pph"),
    "pph15": Jenis("PPh 15", "payable", "pph15", "unifikasi", None, "pph"),
    "pph25": Jenis("PPh 25", "payable", "pph25", None, None, "pph"),
    "pph29": Jenis("PPh 29", "payable", "pph29", "annual_corporate", None, "pph"),
    "pph_credit": Jenis("PPh Credit (withheld by customers)", "creditable", None, None, None, "pph"),
    "pbb": Jenis("PBB", "payable", "pbb", None, None, "other"),
    "other": Jenis("Other Tax", "payable", "other", None, None, "other"),
}
JENIS_BAYAR = {"vat": "VAT (PPN)", "pph21": "PPh 21", "pph22": "PPh 22", "pph23": "PPh 23", "pph26": "PPh 26", "pph4_2": "PPh 4(2)",
               "pph15": "PPh 15", "pph25": "PPh 25", "pph29": "PPh 29", "pbb": "PBB", "other": "Other"}
SPT = {"ppn": "SPT Masa PPN", "pph21": "SPT Masa PPh 21/26", "unifikasi": "SPT Masa PPh Unifikasi",
       "annual_corporate": "SPT Tahunan PPh Badan", "other": "Other Return"}
DENDA_SPT = {"ppn": Decimal("500000"), "pph21": Decimal("100000"), "unifikasi": Decimal("100000"), "annual_corporate": Decimal("1000000")}
STATUS_EXC = ("open", "in_review", "on_hold", "resolved", "dismissed")


def _d(v: Any) -> Decimal:
    return bc._dec(v)


def _bulat(v: Decimal) -> Decimal:
    return v.quantize(SEN, rounding=ROUND_HALF_UP)


def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _awal(d: date) -> date:
    return d.replace(day=1)


def _akhir(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _geser(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def _respon(fn, pesan: str = "OK"):
    return bc._respon(fn, pesan)


def _kunci(session, kid: str) -> None:
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"tax:{kid}"})


def jatuh_tempo_bayar(kunci: Optional[str], masa: date) -> Optional[date]:
    if kunci in (None, "pbb", "other"):
        return None
    if kunci == "pph29":
        return date(masa.year + 1, 4, 30)
    if kunci == "vat":
        return _akhir(_geser(masa, 1))
    return _geser(masa, 1).replace(day=15)


def jatuh_tempo_lapor(spt: Optional[str], masa: date) -> Optional[date]:
    if spt is None or spt == "other":
        return None
    if spt == "annual_corporate":
        return date(masa.year + 1, 4, 30)
    if spt == "ppn":
        return _akhir(_geser(masa, 1))
    return _geser(masa, 1).replace(day=20)


def _masa_spt(spt: Optional[str], masa: date) -> date:
    return date(masa.year, 1, 1) if spt == "annual_corporate" else _awal(masa)


def _periode_sebelum(dari: date, sampai: date) -> Tuple[date, date]:
    bulan = (sampai.year - dari.year) * 12 + sampai.month - dari.month + 1
    return _geser(_awal(dari), -bulan), _awal(dari) - timedelta(days=1)


def _rentang(date_from: Optional[date], date_to: Optional[date]) -> Tuple[date, date]:
    sampai = date_to or _akhir(date.today())
    dari = date_from or date(sampai.year, 1, 1)
    if dari > sampai:
        raise _Gagal("The start date must be on or before the end date.")
    return _awal(dari), _akhir(sampai)


# ============================================================
# AKUN PAJAK (mapping COA -> jenis pajak)
# ============================================================

def tebak_jenis(a: Any, ada_keluaran: bool) -> Optional[str]:
    """Tebak jenis pajak dari nama & kode standar akun COA (None = bukan akun pajak)."""
    nama = (a.account_name or "").lower()
    std = (a.standard_account_code or "").lower()
    aset = std.startswith("std_asset") or (a.account_classification or "").upper() == "ASSET"
    if re.search(r"keluaran|vat\s*out|output\s*vat", nama):
        return "vat_output"
    if re.search(r"masukan|vat\s*in\b|input\s*vat", nama):
        return None if "belum" in nama else "vat_input"
    if std == "std_liability_current_tax_vat_payable":
        return None if ada_keluaran else "vat_output"
    if std == "std_asset_current_tax_vat_receivable":
        return "vat_input"
    pph = "pph" in nama or "pajak" in nama or "tax" in nama or "income_payable" in std or "income_receivable" in std
    if not pph or "biaya" in nama or "expense" in nama or std.startswith("std_expense") or std == "std_income_tax_expense":
        return None
    if aset:
        if re.search(r"\b25\b", nama):
            return None                       # angsuran PPh 25 dibayar di muka = setoran, bukan pemotongan
        return "pph_credit" if re.search(r"\b2[123]\b|4\s*\(?2\)?|pph|pajak dibayar", nama) else None
    if re.search(r"4\s*\(\s*2\s*\)|4\s*ayat\s*2|\bfinal\b|art\.?\s*4", nama):
        return "pph4_2"
    for kode, pola in (("pph29", r"25\s*/\s*29|\b29\b"), ("pph25", r"\b25\b"), ("pph26", r"\b26\b"), ("pph23", r"\b23\b"),
                       ("pph22", r"\b22\b"), ("pph21", r"\b21\b"), ("pph15", r"\b15\b")):
        if re.search(pola, nama):
            return kode
    return "other" if "income_payable" in std else None


def _akun_pajak(session, kid: str) -> Tuple[Dict[str, str], bool]:
    """{kode akun: jenis pajak}, dan True kalau dari mapping tersimpan (False = tebakan otomatis)."""
    akun = {a.id: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}
    simpan = session.query(MAP).filter(MAP.client_id == kid).all()
    if simpan:
        return {akun[m.coa_id].acc_no: m.tax_type for m in simpan if m.coa_id in akun}, True
    ada_keluaran = any(re.search(r"keluaran|vat\s*out|output\s*vat", (a.account_name or "").lower()) for a in akun.values())
    hasil = {}
    for a in akun.values():
        j = tebak_jenis(a, ada_keluaran)
        if j:
            hasil[a.acc_no] = j
    return hasil, False


@router.get("/accounts", summary="Akun COA klien + jenis pajak hasil mapping / tebakan")
def daftar_akun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        peta, tersimpan = _akun_pajak(session, kid)
        return {"saved": tersimpan, "accounts": [{
            "id": a.id, "code": a.acc_no, "name": a.account_name, "classification": a.account_classification, "sub": a.account_sub,
            "standard_code": a.standard_account_code, "is_active": bool(a.is_active), "tax_type": peta.get(a.acc_no),
        } for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()],
            "tax_types": [{"key": k, "label": v.label, "nature": v.sifat} for k, v in JENIS.items()],
            "payment_types": [{"key": k, "label": v} for k, v in JENIS_BAYAR.items()],
            "return_types": [{"key": k, "label": v} for k, v in SPT.items()]}
    return _respon(aksi)


class MappingRequest(BaseModel):
    client_id: UUID
    mappings: List[Dict[str, str]] = Field(..., description="[{coa_id, tax_type}]")


@router.put("/account-mappings", summary="Simpan mapping akun pajak (Supervisor+)")
def simpan_mapping(payload: MappingRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        session.query(MAP).filter(MAP.client_id == kid).delete(synchronize_session=False)
        n = 0
        for m in payload.mappings:
            jenis = m.get("tax_type")
            if not jenis:
                continue
            if jenis not in JENIS:
                raise _Gagal(f"Unknown tax type {jenis}.")
            bc._akun(session, kid, m.get("coa_id"))
            session.add(MAP(client_id=kid, tax_type=jenis, coa_id=m["coa_id"], created_by=current_user.get("id")))
            n += 1
        session.flush()
        return {"saved": n}
    return _respon(aksi, "Tax account mapping saved. Run Sync to refresh the tax ledger.")


# ============================================================
# SINKRON TAX LEDGER DARI TRANSAKSI POSTED
# ============================================================

def _kandidat(session, kid: str) -> Dict[str, Dict[str, Any]]:
    """Semua baris pajak dari transaksi posted, per source_key."""
    hasil: Dict[str, Dict[str, Any]] = {}
    gl = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=kid)
    per_jurnal: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for b in gl:
        per_jurnal[b["jurnal_id"]].append(b)

    def akun_dari_gl(jurnal_id: str, nilai: Decimal, sisi: str) -> Tuple[Optional[str], Optional[str]]:
        for b in per_jurnal.get(jurnal_id, []):
            if abs(_d(b[sisi]) - nilai) < Decimal("0.01"):
                return b["account_code"], b["account_name"]
        return None, None

    # Sales
    # Model ArCustomer (tabel master customer AR) belum ada di db_client -> lewati lookup NPWP cadangan
    # (NPWP tetap diambil dari inv.customer_npwp). Aktif otomatis kalau modelnya nanti ditambahkan.
    _ar_customer = getattr(dbc, "ArCustomer", None)
    npwp_cust = {(c.name or "").strip().upper(): c.npwp for c in session.query(_ar_customer).filter(
        _ar_customer.client_id == kid, _ar_customer.deleted_at.is_(None)).all() if c.npwp} if _ar_customer is not None else {}
    for inv in session.query(SI).filter(SI.management_client_id == kid, func.lower(SI.posting_status) == "posted", SI.deleted_at.is_(None)).all():
        gross, ppn, pph = _d(inv.gross_amount), _d(inv.ppn), _d(inv.pph)
        dpp = _d(inv.dpp) or _bulat(gross / Decimal("1.11"))
        npwp = inv.customer_npwp or npwp_cust.get((inv.customer_name or "").strip().upper())
        dasar = dict(entry_date=inv.invoice_date, source_module="sales", source_id=inv.id, source_document=inv.invoice_no,
                     journal_no=inv.invoice_no, party_name=inv.customer_name, party_type="customer", party_npwp=npwp, dpp=dpp)
        if ppn > 0:
            kode, nama = akun_dari_gl(f"sales:{inv.id}", ppn, "kredit")
            hasil[f"sales:{inv.id}:vat"] = {**dasar, "tax_type": "vat_output", "tax_amount": ppn,
                                           "rate": _bulat(ppn / dpp * 100) if dpp else None, "gl_account_code": kode, "gl_account_name": nama}
        if pph > 0:
            hasil[f"sales:{inv.id}:pph"] = {**dasar, "tax_type": "pph_credit", "tax_amount": pph,
                                           "rate": _bulat(pph / dpp * 100) if dpp else None, "gl_account_code": None, "gl_account_name": None}
    # Purchase
    for tx in session.query(PT).filter(PT.management_client_id == kid, func.lower(PT.status) == "posted", PT.deleted_at.is_(None)).all():
        pajak = _d(tx.tax_amount)
        if pajak <= 0:
            continue
        dpp = _d(tx.subtotal) - _d(tx.discount)
        kode, nama = dbc.akun_posting_purchase(tx)["tax"]
        hasil[f"purchase:{tx.id}:vat"] = {
            "entry_date": tx.invoice_date or tx.purchase_date, "source_module": "purchase", "source_id": tx.id,
            "source_document": tx.invoice_number or tx.purchase_no, "journal_no": tx.purchase_no, "party_name": tx.vendor_name,
            "party_type": "vendor", "party_npwp": None, "dpp": dpp if dpp > 0 else None, "tax_type": "vat_input", "tax_amount": pajak,
            "rate": _bulat(pajak / dpp * 100) if dpp > 0 else None, "gl_account_code": kode, "gl_account_name": nama}

    # Journal Entry & Cash & Bank: baris di akun pajak.
    peta, _ = _akun_pajak(session, kid)
    lewati = {f"cash_bank:{i}" for (i,) in session.query(TX.id).filter(TX.client_id == kid, (TX.source == "tax") | (TX.status == "reversed")).all()}
    urutan: Dict[str, int] = defaultdict(int)
    for b in gl:
        if b["sumber"] not in ("journal_entry", "cash_bank") or b["jurnal_id"] in lewati or "_rv:" in b["jurnal_id"]:
            continue
        jenis = peta.get(b["account_code"])
        if not jenis:
            continue
        j = JENIS[jenis]
        nilai = _d(b["kredit"]) if j.sifat == "payable" else _d(b["debit"])
        if nilai <= 0:
            continue
        k = f"{b['jurnal_id']}:{b['account_code']}"
        urutan[k] += 1
        dpp = _bulat(nilai * 100 / j.tarif) if j.tarif else None
        hasil[f"{k}:{urutan[k]}"] = {
            "entry_date": b["tanggal"], "source_module": b["sumber"], "source_id": b["jurnal_id"].split(":", 1)[1],
            "source_document": b["nomor"], "journal_no": b["nomor"], "party_name": b.get("pihak"), "party_type": None, "party_npwp": None,
            "dpp": dpp, "dpp_estimated": dpp is not None, "tax_type": jenis, "tax_amount": nilai, "rate": j.tarif if dpp else None,
            "gl_account_code": b["account_code"], "gl_account_name": b["account_name"], "tax_object": (b.get("keterangan") or "")[:255] or None}
    return hasil


def sinkron(session, kid: str) -> Dict[str, int]:
    kandidat = _kandidat(session, kid)
    ada = {r.source_key: r for r in session.query(LG).filter(LG.client_id == kid, LG.deleted_at.is_(None), LG.is_manual.is_(False)).all()}
    waktu = _sekarang()
    baru = ubah = hapus = 0
    for kunci, v in kandidat.items():
        v = dict(v)
        v["tax_period"] = _awal(v["entry_date"])
        perkiraan = v.pop("dpp_estimated", False)
        r = ada.pop(kunci, None)
        if r is None:
            session.add(LG(client_id=kid, source_key=kunci, synced_at=waktu, dpp_estimated=perkiraan, **v))
            baru += 1
            continue
        diubah_user = r.edited_at is not None
        for k, nilai in v.items():
            if k in ("tax_object",) and r.tax_object:
                continue
            if k == "party_npwp" and (r.party_npwp or not nilai):
                continue
            if k in ("dpp", "rate", "tax_type") and diubah_user and not (k == "dpp" and r.dpp is None):
                continue
            if getattr(r, k) != nilai:
                setattr(r, k, nilai)
        if not diubah_user:
            r.dpp_estimated = perkiraan
        r.synced_at = waktu
        ubah += 1
    for r in ada.values():
        r.deleted_at = waktu
        hapus += 1
    session.flush()
    return {"created": baru, "updated": ubah, "removed": hapus}


# ============================================================
# MESIN STATUS (bayar, lapor, jatuh tempo)
# ============================================================

@dataclass
class Baris:
    row: Any
    jenis: Jenis
    bayar: str = "unpaid"         # paid / partial / unpaid / credited
    dibayar: Decimal = NOL
    lapor: str = "unreported"     # reported / unreported / not_required / n/a
    tempo_bayar: Optional[date] = None
    tempo_lapor: Optional[date] = None

    @property
    def nilai(self) -> Decimal:
        return _d(self.row.tax_amount)

    @property
    def sisa(self) -> Decimal:
        return max(self.nilai - self.dibayar, NOL) if self.bayar not in ("credited",) else NOL


@dataclass
class Buku:
    kid: str
    baris: List[Baris]
    setoran: List[Any]
    status_setoran: Dict[str, str]
    spt: Dict[Tuple[str, date], Any]
    per_id: Dict[str, Baris] = field(default_factory=dict)


def _status_setoran(session, kid: str, setoran: List[Any]) -> Dict[str, str]:
    ids = [p.bank_cash_transaction_id for p in setoran if p.bank_cash_transaction_id]
    tx = {t.id: t for t in session.query(TX).filter(TX.id.in_(ids)).all()} if ids else {}
    hasil = {}
    for p in setoran:
        st = p.status
        if p.bank_cash_transaction_id:
            t = tx.get(p.bank_cash_transaction_id)
            st = "cancelled" if t is None or t.deleted_at is not None or t.status == "reversed" else ("paid" if t.status == "posted" else "pending")
            if st != p.status:
                p.status = st
        hasil[p.id] = st
    return hasil


def muat(session, kid: str) -> Buku:
    rows = session.query(LG).filter(LG.client_id == kid, LG.deleted_at.is_(None)).order_by(LG.entry_date, LG.created_at).all()
    setoran = session.query(PAY).filter(PAY.client_id == kid, PAY.deleted_at.is_(None)).order_by(PAY.payment_date).all()
    st = _status_setoran(session, kid, setoran)
    spt = {(f.return_type, f.tax_period): f for f in session.query(FIL).filter(FIL.client_id == kid, FIL.deleted_at.is_(None)).all()}
    baris = [Baris(row=r, jenis=JENIS.get(r.tax_type, JENIS["other"])) for r in rows]
    b = Buku(kid=kid, baris=baris, setoran=setoran, status_setoran=st, spt=spt)
    b.per_id = {x.row.id: x for x in baris}

    bayar: Dict[Tuple[str, date], Decimal] = defaultdict(lambda: NOL)
    for p in setoran:
        if st[p.id] == "paid":
            bayar[(p.tax_type, _awal(p.tax_period))] += _d(p.amount)
    # Kredit PPN Masukan masa yang sama menutup PPN Keluaran lebih dulu.
    for x in baris:
        if x.row.tax_type == "vat_input":
            bayar[("vat", x.row.tax_period)] += x.nilai
    for x in baris:
        j = x.jenis
        x.tempo_bayar = jatuh_tempo_bayar(j.bayar, x.row.tax_period)
        if j.sifat == "creditable":
            x.bayar = "credited"
        else:
            k = (j.bayar, x.row.tax_period)
            ambil = min(bayar[k], x.nilai)
            bayar[k] -= ambil
            x.dibayar = ambil
            x.bayar = "paid" if ambil >= x.nilai - Decimal("0.5") else ("partial" if ambil > 0 else "unpaid")
        if j.spt is None:
            x.lapor = "n/a"
        else:
            masa = _masa_spt(j.spt, x.row.tax_period)
            x.tempo_lapor = jatuh_tempo_lapor(j.spt, masa)
            f = spt.get((j.spt, masa))
            x.lapor = "reported" if f is not None and f.status == "filed" else ("not_required" if f is not None and f.status == "not_required" else "unreported")
    return b


def _baris_dict(x: Baris) -> Dict[str, Any]:
    r = x.row
    return {
        "id": r.id, "date": r.entry_date, "tax_period": r.tax_period, "tax_type": r.tax_type, "tax_type_label": x.jenis.label,
        "nature": x.jenis.sifat, "tax_code": r.tax_code, "tax_object": r.tax_object, "source_module": r.source_module,
        "source_document": r.source_document, "journal_no": r.journal_no, "party_name": r.party_name, "party_type": r.party_type,
        "party_npwp": r.party_npwp, "dpp": _f(r.dpp) if r.dpp is not None else None, "dpp_estimated": bool(r.dpp_estimated),
        "rate": float(r.rate) if r.rate is not None else None, "tax_amount": _f(r.tax_amount),
        "gl_account_code": r.gl_account_code, "gl_account_name": r.gl_account_name, "tax_document_no": r.tax_document_no,
        "tax_document_date": r.tax_document_date, "is_manual": bool(r.is_manual), "notes": r.notes,
        "payment_status": x.bayar, "paid_amount": _f(x.dibayar), "outstanding": _f(x.sisa), "payment_due": x.tempo_bayar,
        "reporting_status": x.lapor, "filing_due": x.tempo_lapor, "match_status": "matched" if r.tax_document_no else "unmatched",
    }


def _dalam(x: Baris, dari: date, sampai: date) -> bool:
    return dari <= x.row.tax_period <= sampai


# ============================================================
# ENDPOINT -- SYNC + OVERVIEW
# ============================================================

class KlienRequest(BaseModel):
    client_id: UUID


@router.post("/sync", summary="Sinkron Tax Ledger dari transaksi posted + jalankan cek temuan")
def sync(payload: KlienRequest, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        hasil = sinkron(session, kid)
        hasil["exceptions"] = deteksi(session, kid)
        return hasil
    return _respon(aksi, "Tax ledger synchronised with posted transactions.")


def _ringkas(b: Buku, dari: date, sampai: date) -> Dict[str, Any]:
    xs = [x for x in b.baris if _dalam(x, dari, sampai)]
    pph = [x for x in xs if x.jenis.kelompok == "pph" and x.jenis.sifat == "payable"]
    hutang = [x for x in xs if x.jenis.sifat == "payable"]
    setor = [p for p in b.setoran if dari <= _awal(p.tax_period) <= sampai and b.status_setoran[p.id] == "paid"]
    return {
        "total_dpp": _f(sum((_d(x.row.dpp) for x in xs if x.jenis.sifat == "payable" or x.row.tax_type == "vat_input"), NOL)),
        "pph_payable": _f(sum((x.nilai for x in pph), NOL)),
        "vat_output": _f(sum((x.nilai for x in xs if x.row.tax_type == "vat_output"), NOL)),
        "vat_input": _f(sum((x.nilai for x in xs if x.row.tax_type == "vat_input"), NOL)),
        "tax_paid": _f(sum((_d(p.amount) for p in setor), NOL)),
        "unpaid": _f(sum((x.sisa for x in hutang), NOL)),
        "unreported": _f(sum((x.nilai for x in xs if x.lapor == "unreported"), NOL)),
        "records": len(xs),
        "tax_amount": _f(sum((x.nilai for x in xs), NOL)),
    }


def _spt_wajib(b: Buku, dari: date, sampai: date) -> List[Dict[str, Any]]:
    """SPT yang wajib per masa dalam rentang (dari jenis pajak yang ada) + SPT yang sudah dicatat."""
    perlu: Dict[Tuple[str, date], Decimal] = defaultdict(lambda: NOL)
    for x in b.baris:
        if x.jenis.spt and _dalam(x, dari, sampai):
            tanda = 1 if x.jenis.sifat == "payable" else -1
            perlu[(x.jenis.spt, _masa_spt(x.jenis.spt, x.row.tax_period))] += tanda * x.nilai
    for (rt, masa), f in b.spt.items():
        if dari <= masa <= sampai or (rt == "annual_corporate" and dari.year <= masa.year <= sampai.year):
            perlu.setdefault((rt, masa), NOL)
    hari = date.today()
    hasil = []
    for (rt, masa), nilai in sorted(perlu.items(), key=lambda t: (t[0][1], t[0][0])):
        f = b.spt.get((rt, masa))
        tempo = (f.due_date if f is not None and f.due_date else None) or jatuh_tempo_lapor(rt, masa)
        status = f.status if f is not None else "not_filed"
        terlambat = bool(tempo and ((f is not None and f.status == "filed" and f.filed_date and f.filed_date > tempo)
                                    or (status in ("not_filed", "draft") and tempo < hari)))
        hasil.append({"id": f.id if f is not None else None, "return_type": rt, "return_label": SPT.get(rt, rt), "tax_period": masa,
                      "due_date": tempo, "filed_date": f.filed_date if f is not None else None, "status": status,
                      "receipt_no": f.receipt_no if f is not None else None, "amount": _f(f.amount) if f is not None and f.amount is not None else _f(nilai),
                      "is_amendment": bool(f.is_amendment) if f is not None else False, "notes": f.notes if f is not None else None,
                      "late": terlambat})
    return hasil


@router.get("/overview", summary="Overview: KPI, ringkasan per jenis, status bayar & lapor, tren bulanan, eksposur")
def overview(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
             _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        b = muat(session, kid)
        pd, ps = _periode_sebelum(dari, sampai)
        kini, lalu = _ringkas(b, dari, sampai), _ringkas(b, pd, ps)
        spt = _spt_wajib(b, dari, sampai)
        exc = session.query(EXC).filter(EXC.client_id == kid, EXC.deleted_at.is_(None)).all()
        terbuka = [e for e in exc if e.status in ("open", "in_review", "on_hold")]
        terbuka_lalu = [e for e in exc if e.detected_at.date() <= ps and (e.resolved_at is None or e.resolved_at.date() > ps)]
        per_jenis = []
        for k, j in JENIS.items():
            xs = [x for x in b.baris if x.row.tax_type == k and _dalam(x, dari, sampai)]
            if not xs:
                continue
            tarif = {float(x.row.rate) for x in xs if x.row.rate is not None}
            lapor = {x.lapor for x in xs}
            bayar = {x.bayar for x in xs}
            status = "on_track" if bayar <= {"paid", "credited"} and lapor <= {"reported", "n/a", "not_required"} else (
                "pending" if bayar <= {"unpaid"} and "reported" not in lapor else "partial")
            per_jenis.append({"tax_type": k, "label": j.label, "dpp": _f(sum((_d(x.row.dpp) for x in xs), NOL)),
                              "rate": (f"{tarif.pop():g}%" if len(tarif) == 1 else ("Varies" if tarif else "—")),
                              "tax_amount": _f(sum((x.nilai for x in xs), NOL)), "paid": _f(sum((x.dibayar for x in xs), NOL)),
                              "reported": "Yes" if lapor <= {"reported", "not_required"} else ("n/a" if lapor == {"n/a"} else "No"),
                              "status": status, "count": len(xs)})
        # Status bayar & lapor per item jenis+masa (donut).
        item: Dict[Tuple[str, date], List[Baris]] = defaultdict(list)
        for x in b.baris:
            if x.jenis.sifat == "payable" and _dalam(x, dari, sampai):
                item[(x.jenis.bayar or x.row.tax_type, x.row.tax_period)].append(x)
        hitung = {"paid_reported": 0, "paid_not_reported": 0, "unpaid": 0, "overdue": 0}
        for xs in item.values():
            lunas = all(x.bayar == "paid" for x in xs)
            lapor = all(x.lapor in ("reported", "n/a", "not_required") for x in xs)
            telat = any(x.bayar != "paid" and x.tempo_bayar and x.tempo_bayar < date.today() for x in xs)
            kunci = "overdue" if telat else ("paid_reported" if lunas and lapor else ("paid_not_reported" if lunas else "unpaid"))
            hitung[kunci] += 1
        tren = []
        m = dari
        while m <= sampai:
            xs = [x for x in b.baris if x.row.tax_period == m]
            pph = sum((x.nilai for x in xs if x.jenis.kelompok == "pph" and x.jenis.sifat == "payable"), NOL)
            vat = sum((x.nilai for x in xs if x.row.tax_type == "vat_output"), NOL) - sum((x.nilai for x in xs if x.row.tax_type == "vat_input"), NOL)
            tren.append({"month": m.strftime("%Y-%m"), "pph": _f(pph), "vat": _f(max(vat, NOL)), "total": _f(pph + max(vat, NOL))})
            m = _geser(m, 1)
        return {
            "period": {"from": dari, "to": sampai, "previous_from": pd, "previous_to": ps},
            "kpi": {**kini, "unreported_returns": sum(1 for s in spt if s["status"] in ("not_filed", "draft")),
                    "exceptions": len(terbuka)},
            "previous": {**lalu, "exceptions": len(terbuka_lalu),
                         "unreported_returns": sum(1 for s in _spt_wajib(b, pd, ps) if s["status"] in ("not_filed", "draft"))},
            "by_type": per_jenis, "status_items": hitung, "trend": tren,
            "exposure": [_exc_dict(e) for e in sorted(terbuka, key=lambda e: -_d(e.potential_tax))[:5]],
        }
    return _respon(aksi)


# ============================================================
# ENDPOINT -- TAX LEDGER
# ============================================================

@router.get("/ledger", summary="Tax Ledger: baris pajak + status bayar/lapor + KPI + siklus")
def ledger(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
           _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        b = muat(session, kid)
        pd, ps = _periode_sebelum(dari, sampai)
        xs = [x for x in b.baris if _dalam(x, dari, sampai)]
        siklus = {"posted": len(xs), "paid": sum(1 for x in xs if x.bayar in ("paid", "credited")),
                  "unpaid": sum(1 for x in xs if x.bayar in ("unpaid", "partial")),
                  "reported": sum(1 for x in xs if x.lapor == "reported"), "unreported": sum(1 for x in xs if x.lapor == "unreported"),
                  "manual": sum(1 for x in xs if x.row.is_manual)}
        per_jenis = []
        for k, j in JENIS.items():
            ys = [x for x in xs if x.row.tax_type == k]
            if ys:
                per_jenis.append({"tax_type": k, "label": j.label, "count": len(ys),
                                  "paid": sum(1 for x in ys if x.bayar in ("paid", "credited")),
                                  "partial": sum(1 for x in ys if x.bayar == "partial"),
                                  "unpaid": sum(1 for x in ys if x.bayar == "unpaid")})
        jurnal = [x for x in sorted(xs, key=lambda x: x.row.entry_date, reverse=True) if x.row.journal_no][:8]
        return {"period": {"from": dari, "to": sampai}, "kpi": _ringkas(b, dari, sampai), "previous": _ringkas(b, pd, ps),
                "rows": [_baris_dict(x) for x in sorted(xs, key=lambda x: (x.row.entry_date, x.row.source_document or ""), reverse=True)],
                "lifecycle": siklus, "by_type": per_jenis,
                "journal_links": [{"date": x.row.entry_date, "journal_no": x.row.journal_no, "source_module": x.row.source_module,
                                   "description": f"{x.jenis.label} - {x.row.party_name or x.row.source_document or ''}".strip(" -"),
                                   "tax_amount": _f(x.row.tax_amount)} for x in jurnal]}
    return _respon(aksi)


class LedgerRequest(BaseModel):
    client_id: UUID
    entry_date: date
    tax_type: Literal["vat_output", "vat_input", "pph21", "pph22", "pph23", "pph26", "pph4_2", "pph15", "pph25", "pph29", "pph_credit", "pbb", "other"]
    tax_code: Optional[str] = Field(None, max_length=30)
    tax_object: Optional[str] = Field(None, max_length=255)
    source_document: Optional[str] = Field(None, max_length=100)
    party_name: Optional[str] = Field(None, max_length=255)
    party_type: Optional[Literal["customer", "vendor", "employee", "other"]] = None
    party_npwp: Optional[str] = Field(None, max_length=30)
    dpp: Optional[float] = Field(None, ge=0)
    rate: Optional[float] = Field(None, ge=0, le=100)
    tax_amount: float = Field(..., description="Boleh negatif untuk koreksi")
    gl_coa_id: Optional[UUID] = None
    tax_document_no: Optional[str] = Field(None, max_length=60)
    tax_document_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)


@router.post("/ledger", summary="Add Adjustment: baris pajak manual (Supervisor+)")
def tambah_ledger(payload: LedgerRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        if payload.tax_amount == 0:
            raise _Gagal("Tax amount cannot be zero.")
        akun = bc._akun(session, kid, str(payload.gl_coa_id)) if payload.gl_coa_id else None
        nomor = session.query(func.count(LG.id)).filter(LG.client_id == kid, LG.is_manual.is_(True)).scalar() or 0
        r = LG(client_id=kid, entry_date=payload.entry_date, tax_period=_awal(payload.entry_date), tax_type=payload.tax_type,
               tax_code=_teks(payload.tax_code), tax_object=_teks(payload.tax_object), source_module="manual",
               source_key=f"manual:{_sekarang().timestamp()}:{nomor + 1}", source_document=_teks(payload.source_document) or f"ADJ-TAX-{nomor + 1:04d}",
               party_name=_teks(payload.party_name), party_type=payload.party_type, party_npwp=_teks(payload.party_npwp),
               dpp=Decimal(str(payload.dpp)) if payload.dpp is not None else None, rate=Decimal(str(payload.rate)) if payload.rate is not None else None,
               tax_amount=_bulat(Decimal(str(payload.tax_amount))), gl_account_code=akun.acc_no if akun else None,
               gl_account_name=akun.account_name if akun else None, tax_document_no=_teks(payload.tax_document_no),
               tax_document_date=payload.tax_document_date, is_manual=True, notes=_teks(payload.notes),
               created_by=current_user.get("id"), created_by_name=_nama(current_user))
        session.add(r)
        session.flush()
        b = muat(session, kid)
        return _baris_dict(b.per_id[r.id])
    return _respon(aksi, "Tax adjustment added.")


class UbahLedgerRequest(BaseModel):
    client_id: UUID
    tax_type: Optional[str] = None
    tax_code: Optional[str] = Field(None, max_length=30)
    tax_object: Optional[str] = Field(None, max_length=255)
    party_npwp: Optional[str] = Field(None, max_length=30)
    party_type: Optional[Literal["customer", "vendor", "employee", "other"]] = None
    dpp: Optional[float] = Field(None, ge=0)
    rate: Optional[float] = Field(None, ge=0, le=100)
    tax_document_no: Optional[str] = Field(None, max_length=60)
    tax_document_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)
    tax_amount: Optional[float] = None
    entry_date: Optional[date] = None


@router.put("/ledger/{entry_id}", summary="Lengkapi baris pajak: nomor e-Faktur/e-Bupot, kode objek, NPWP, DPP (Supervisor+)")
def ubah_ledger(entry_id: UUID, payload: UbahLedgerRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        r = session.get(LG, str(entry_id))
        if r is None or r.deleted_at is not None or str(r.client_id) != kid:
            raise _Gagal("Tax ledger entry not found.", kode="NOT_FOUND", status_code=404)
        data = payload.model_dump(exclude_unset=True)
        data.pop("client_id", None)
        if not r.is_manual and ({"tax_amount", "entry_date"} & set(data)):
            raise _Gagal("Amount and date of a synced entry follow the source transaction. Correct the source or add an adjustment.")
        if "tax_type" in data and data["tax_type"] not in JENIS:
            raise _Gagal("Unknown tax type.")
        for k, v in data.items():
            if k in ("dpp", "rate", "tax_amount") and v is not None:
                v = Decimal(str(v))
            if isinstance(v, str):
                v = _teks(v)
            setattr(r, k, v)
        if "dpp" in data:
            r.dpp_estimated = False
        if "entry_date" in data and data["entry_date"]:
            r.tax_period = _awal(data["entry_date"])
        r.edited_at, r.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        deteksi(session, kid)
        return _baris_dict(muat(session, kid).per_id[r.id])
    return _respon(aksi, "Tax ledger entry updated.")


@router.delete("/ledger/{entry_id}", summary="Hapus adjustment manual (Supervisor+)")
def hapus_ledger(entry_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        r = session.get(LG, str(entry_id))
        if r is None or r.deleted_at is not None or str(r.client_id) != kid:
            raise _Gagal("Tax ledger entry not found.", kode="NOT_FOUND", status_code=404)
        if not r.is_manual:
            raise _Gagal("Only manual adjustments can be deleted; synced entries follow their source transaction.", kode="CONFLICT", status_code=409)
        r.deleted_at, r.deleted_by = _sekarang(), current_user.get("id")
        return {"id": r.id}
    return _respon(aksi, "Tax adjustment deleted.")


# ============================================================
# ENDPOINT -- PPh & VAT
# ============================================================

@router.get("/pph", summary="Tab PPh: KPI, transaksi pemotongan, breakdown per pasal, gap pemotongan")
def pph(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
        _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        b = muat(session, kid)

        def kpi(d1: date, d2: date) -> Dict[str, Any]:
            xs = [x for x in b.baris if x.jenis.kelompok == "pph" and x.jenis.sifat == "payable" and _dalam(x, d1, d2)]
            setor = [p for p in b.setoran if p.tax_type.startswith("pph") and d1 <= _awal(p.tax_period) <= d2 and b.status_setoran[p.id] == "paid"]
            return {"total_dpp": _f(sum((_d(x.row.dpp) for x in xs), NOL)), "pph_payable": _f(sum((x.nilai for x in xs), NOL)),
                    "paid": _f(sum((_d(p.amount) for p in setor), NOL)), "unpaid": _f(sum((x.sisa for x in xs), NOL)),
                    "reported": _f(sum((x.nilai for x in xs if x.lapor == "reported"), NOL)),
                    "needs_review": sum(1 for x in xs if x.row.dpp_estimated or not x.row.tax_document_no or not x.row.party_npwp)}
        xs = [x for x in b.baris if x.jenis.kelompok == "pph" and _dalam(x, dari, sampai)]
        rinci = defaultdict(lambda: NOL)
        for x in xs:
            if x.jenis.sifat == "payable":
                rinci[x.row.tax_type] += x.nilai
        gap = session.query(EXC).filter(EXC.client_id == kid, EXC.deleted_at.is_(None), EXC.status.in_(("open", "in_review", "on_hold")),
                                        EXC.tax_type.like("pph%")).order_by(EXC.potential_tax.desc()).limit(8).all()
        return {"period": {"from": dari, "to": sampai}, "kpi": kpi(dari, sampai), "previous": kpi(pd, ps),
                "rows": [_baris_dict(x) for x in sorted(xs, key=lambda x: x.row.entry_date, reverse=True)],
                "breakdown": [{"tax_type": k, "label": JENIS[k].label, "amount": _f(v)} for k, v in sorted(rinci.items(), key=lambda t: -t[1])],
                "gaps": [_exc_dict(e) for e in gap]}
    return _respon(aksi)


def _gl_per_jenis(session, kid: str, dari: date, sampai: date) -> Dict[str, Decimal]:
    """Pajak yang diakui di GL per jenis: sisi natural akun pajak (kredit hutang / debit kredit pajak);
    baris jurnal pembalik (RV-) mengurangi. Setoran pajak (debit hutang) tidak ikut."""
    peta, _ = _akun_pajak(session, kid)
    hasil: Dict[str, Decimal] = defaultdict(lambda: NOL)
    for b in dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=kid, sampai_tanggal=sampai):
        if b["tanggal"] < dari:
            continue
        jenis = peta.get(b["account_code"])
        if not jenis:
            continue
        payable = JENIS[jenis].sifat == "payable"
        alami, lawan = (_d(b["kredit"]), _d(b["debit"])) if payable else (_d(b["debit"]), _d(b["kredit"]))
        if "_rv:" in b["jurnal_id"]:
            hasil[jenis] -= lawan
        else:
            hasil[jenis] += alami
    return hasil


@router.get("/vat", summary="Tab VAT: KPI, PPN Keluaran & Masukan, tren, VAT ledger vs GL")
def vat(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
        _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        b = muat(session, kid)

        def kpi(d1: date, d2: date) -> Dict[str, Any]:
            xs = [x for x in b.baris if x.jenis.kelompok == "vat" and _dalam(x, d1, d2)]
            out = sum((x.nilai for x in xs if x.row.tax_type == "vat_output"), NOL)
            inp = sum((x.nilai for x in xs if x.row.tax_type == "vat_input"), NOL)
            return {"output": _f(out), "input": _f(inp), "net": _f(out - inp), "matched": sum(1 for x in xs if x.row.tax_document_no),
                    "total": len(xs), "unmatched": sum(1 for x in xs if not x.row.tax_document_no),
                    "draft_returns": sum(1 for s in _spt_wajib(b, d1, d2) if s["return_type"] == "ppn" and s["status"] in ("draft", "not_filed"))}
        xs = [x for x in b.baris if x.jenis.kelompok == "vat" and _dalam(x, dari, sampai)]
        tren = []
        m = dari
        while m <= sampai:
            ys = [x for x in b.baris if x.row.tax_period == m and x.jenis.kelompok == "vat"]
            o = sum((x.nilai for x in ys if x.row.tax_type == "vat_output"), NOL)
            i = sum((x.nilai for x in ys if x.row.tax_type == "vat_input"), NOL)
            tren.append({"month": m.strftime("%Y-%m"), "output": _f(o), "input": _f(i), "net": _f(o - i)})
            m = _geser(m, 1)
        gl = _gl_per_jenis(session, kid, dari, sampai)
        k = kpi(dari, sampai)
        return {"period": {"from": dari, "to": sampai}, "kpi": k, "previous": kpi(pd, ps),
                "output": [_baris_dict(x) for x in sorted(xs, key=lambda x: x.row.entry_date, reverse=True) if x.row.tax_type == "vat_output"],
                "input": [_baris_dict(x) for x in sorted(xs, key=lambda x: x.row.entry_date, reverse=True) if x.row.tax_type == "vat_input"],
                "trend": tren,
                "vs_gl": {"ledger_output": k["output"], "ledger_input": k["input"], "ledger_net": k["net"],
                          "gl_output": _f(gl["vat_output"]), "gl_input": _f(gl["vat_input"]), "gl_net": _f(gl["vat_output"] - gl["vat_input"]),
                          "difference": _f((Decimal(str(k["net"]))) - (gl["vat_output"] - gl["vat_input"]))}}
    return _respon(aksi)


# ============================================================
# ENDPOINT -- PAYMENTS & FILINGS
# ============================================================

def _setoran_dict(p: Any, status: str) -> Dict[str, Any]:
    return {"id": p.id, "payment_no": p.payment_no, "payment_date": p.payment_date, "tax_type": p.tax_type,
            "tax_type_label": JENIS_BAYAR.get(p.tax_type, p.tax_type), "tax_period": p.tax_period, "related_liability": p.related_liability,
            "dpp": _f(p.dpp) if p.dpp is not None else None, "amount": _f(p.amount), "billing_code": p.billing_code, "ntpn": p.ntpn,
            "bank_account": f"{p.bank_account_code} · {p.bank_account_name}" if p.bank_account_code else None, "bank_coa_id": p.bank_coa_id,
            "payable_coa_id": p.payable_coa_id, "bank_cash_transaction_id": p.bank_cash_transaction_id, "status": status, "notes": p.notes,
            "created_by_name": p.created_by_name, "created_at": p.created_at,
            "overdue": status == "pending" and (jatuh_tempo_bayar(p.tax_type, p.tax_period) or date.max) < date.today(),
            "due_date": jatuh_tempo_bayar(p.tax_type, p.tax_period)}


@router.get("/payments", summary="Tab Payments: KPI, daftar setoran, setoran per jenis per bulan, jatuh tempo, SPT")
def payments(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
             _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        b = muat(session, kid)
        session.flush()
        hari = date.today()

        def kewajiban(d1: date, d2: date) -> Dict[Tuple[str, date], Dict[str, Decimal]]:
            per: Dict[Tuple[str, date], Dict[str, Decimal]] = defaultdict(lambda: {"due": NOL, "paid": NOL})
            for x in b.baris:
                if not _dalam(x, d1, d2):
                    continue
                if x.row.tax_type == "vat_input":
                    per[("vat", x.row.tax_period)]["due"] -= x.nilai
                elif x.jenis.sifat == "payable" and x.jenis.bayar:
                    per[(x.jenis.bayar, x.row.tax_period)]["due"] += x.nilai
            for p in b.setoran:
                if d1 <= _awal(p.tax_period) <= d2 and b.status_setoran[p.id] == "paid":
                    per[(p.tax_type, _awal(p.tax_period))]["paid"] += _d(p.amount)
            return per

        def kpi(d1: date, d2: date) -> Dict[str, Any]:
            per = kewajiban(d1, d2)
            due = sum((max(v["due"], NOL) for v in per.values()), NOL)
            paid = sum((v["paid"] for v in per.values()), NOL)
            overdue = sum((max(max(v["due"], NOL) - v["paid"], NOL) for (k, m), v in per.items()
                           if (jatuh_tempo_bayar(k, m) or date.max) < hari), NOL)
            upcoming = sum((max(max(v["due"], NOL) - v["paid"], NOL) for (k, m), v in per.items()
                            if (jatuh_tempo_bayar(k, m) or date.min) >= hari), NOL)
            lewat = [v for (k, m), v in per.items() if max(v["due"], NOL) > 0]
            tepat = sum(1 for v in lewat if v["paid"] >= max(v["due"], NOL) - Decimal("0.5"))
            lebih = sum((max(v["paid"] - max(v["due"], NOL), NOL) for v in per.values()), NOL)
            return {"total_due": _f(due), "total_paid": _f(paid), "overdue": _f(overdue), "upcoming": _f(upcoming),
                    "success_rate": round(tepat / len(lewat) * 100, 1) if lewat else None, "unallocated": _f(lebih)}
        daftar = [p for p in b.setoran if dari <= _awal(p.tax_period) <= sampai or dari <= p.payment_date <= sampai]
        bulanan = []
        m = dari
        while m <= sampai:
            baris = {"month": m.strftime("%Y-%m")}
            for p in b.setoran:
                if p.payment_date and _awal(p.payment_date) == m and b.status_setoran[p.id] == "paid":
                    baris[p.tax_type] = baris.get(p.tax_type, 0.0) + _f(p.amount)
            bulanan.append(baris)
            m = _geser(m, 1)
        tenggat = []
        for (k, masa), v in kewajiban(_geser(_awal(hari), -24), _akhir(_geser(hari, 1))).items():
            sisa = max(v["due"], NOL) - v["paid"]
            if sisa <= Decimal("0.5"):
                continue
            tempo = jatuh_tempo_bayar(k, masa)
            tenggat.append({"due_date": tempo, "tax_period": masa, "tax_type": k, "tax_type_label": JENIS_BAYAR.get(k, k), "amount": _f(sisa),
                            "status": "overdue" if tempo and tempo < hari else ("due_soon" if tempo and tempo <= hari + timedelta(days=14) else "not_due")})
        tenggat.sort(key=lambda t: t["due_date"] or date.max)
        return {"period": {"from": dari, "to": sampai}, "kpi": kpi(dari, sampai), "previous": kpi(pd, ps),
                "payments": [_setoran_dict(p, b.status_setoran[p.id]) for p in sorted(daftar, key=lambda p: p.payment_date, reverse=True)],
                "monthly": bulanan, "deadlines": tenggat[:20], "filings": _spt_wajib(b, dari, sampai)}
    return _respon(aksi)


class SetoranRequest(BaseModel):
    client_id: UUID
    payment_date: date
    tax_type: Literal["vat", "pph21", "pph22", "pph23", "pph26", "pph4_2", "pph15", "pph25", "pph29", "pbb", "other"]
    tax_period: date
    related_liability: Optional[str] = Field(None, max_length=255)
    dpp: Optional[float] = Field(None, ge=0)
    amount: float = Field(..., gt=0)
    billing_code: Optional[str] = Field(None, max_length=30)
    ntpn: Optional[str] = Field(None, max_length=30)
    notes: Optional[str] = Field(None, max_length=2000)
    mode: Literal["cash_bank", "record_only"] = "cash_bank"
    bank_coa_id: Optional[UUID] = None
    payable_coa_id: Optional[UUID] = None
    status: Literal["pending", "paid"] = "paid"


def _nomor_setoran(session, kid: str, tanggal: date) -> str:
    awalan = f"TXP-{tanggal.year}-"
    nomor = [n for (n,) in session.query(PAY.payment_no).filter(PAY.client_id == kid, PAY.payment_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


def _akun_hutang_default(session, kid: str, kunci: str) -> Optional[str]:
    peta, _ = _akun_pajak(session, kid)
    target = {"vat": "vat_output"}.get(kunci, kunci)
    kode = next((k for k, j in peta.items() if j == target), None)
    if not kode:
        return None
    a = session.query(COA).filter(COA.client_id == kid, COA.acc_no == kode, COA.deleted_at.is_(None)).first()
    return a.id if a else None


@router.post("/payments", summary="Record Tax Payment (Supervisor+; Cash & Bank langsung posted untuk Manager+)")
def buat_setoran(payload: SetoranRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        bc._kunci_klien(session, kid)
        masa = _awal(payload.tax_period)
        jumlah = _bulat(Decimal(str(payload.amount)))
        p = PAY(client_id=kid, payment_no=_nomor_setoran(session, kid, payload.payment_date), payment_date=payload.payment_date,
                tax_type=payload.tax_type, tax_period=masa, related_liability=_teks(payload.related_liability) or JENIS_BAYAR[payload.tax_type],
                dpp=Decimal(str(payload.dpp)) if payload.dpp is not None else None, amount=jumlah, billing_code=_teks(payload.billing_code),
                ntpn=_teks(payload.ntpn), notes=_teks(payload.notes), status=payload.status,
                created_by=current_user.get("id"), created_by_name=_nama(current_user))
        if payload.mode == "cash_bank":
            if not payload.bank_coa_id:
                raise _Gagal("Choose the bank / cash account the tax is paid from.")
            bank = bc._akun_kas(session, kid, str(payload.bank_coa_id))
            hutang_id = str(payload.payable_coa_id) if payload.payable_coa_id else _akun_hutang_default(session, kid, payload.tax_type)
            if not hutang_id:
                raise _Gagal("Choose the tax payable account to debit (or map it in Tax Settings).")
            hutang = bc._akun(session, kid, hutang_id)
            manajer = auth.role_level(current_user.get("role")) >= LEVEL_POST
            waktu = _sekarang()
            ket = f"{JENIS_BAYAR[payload.tax_type]} payment for {masa:%b %Y}" + (f" · NTPN {p.ntpn}" if p.ntpn else "")
            tx = TX(client_id=kid, tx_number=bc._nomor_baru(session, kid, "payment", payload.payment_date), direction="payment",
                    tx_date=payload.payment_date, bank_coa_id=bank.id, bank_account_code=bank.acc_no, bank_account_name=bank.account_name,
                    amount=jumlah, kind="non_invoice", category="Tax Payment", counterparty="Direktorat Jenderal Pajak", description=ket,
                    reference=p.billing_code or p.ntpn, payment_method="bank_transfer", reference_date=payload.payment_date, currency="IDR",
                    source="tax", status="posted" if manajer else "draft", created_by=current_user.get("id"), created_by_name=_nama(current_user))
            if manajer:
                tx.approved_at = tx.posted_at = waktu
                tx.approved_by = tx.posted_by = current_user.get("id")
                tx.approved_by_name = tx.posted_by_name = _nama(current_user)
            session.add(tx)
            session.flush()
            bc._tulis_baris(session, tx, [{"line_type": "account", "sales_invoice_id": None, "purchase_transaction_id": None, "coa_id": hutang.id,
                                           "account_code": hutang.acc_no, "account_name": hutang.account_name, "description": ket,
                                           "debit": jumlah, "credit": NOL}])
            p.bank_cash_transaction_id = tx.id
            p.bank_coa_id, p.bank_account_code, p.bank_account_name = bank.id, bank.acc_no, bank.account_name
            p.payable_coa_id = hutang.id
            p.status = "paid" if manajer else "pending"
        session.add(p)
        session.flush()
        deteksi(session, kid)
        return _setoran_dict(p, p.status)
    return _respon(aksi, "Tax payment recorded.")


class UbahSetoranRequest(BaseModel):
    client_id: UUID
    billing_code: Optional[str] = Field(None, max_length=30)
    ntpn: Optional[str] = Field(None, max_length=30)
    related_liability: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = Field(None, max_length=2000)
    status: Optional[Literal["pending", "paid"]] = None


@router.put("/payments/{payment_id}", summary="Lengkapi setoran: kode billing, NTPN, catatan, status (record only)")
def ubah_setoran(payment_id: UUID, payload: UbahSetoranRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        p = session.get(PAY, str(payment_id))
        if p is None or p.deleted_at is not None or str(p.client_id) != kid:
            raise _Gagal("Tax payment not found.", kode="NOT_FOUND", status_code=404)
        data = payload.model_dump(exclude_unset=True)
        data.pop("client_id", None)
        if "status" in data and p.bank_cash_transaction_id:
            raise _Gagal("The status of this payment follows its Cash & Bank transaction.")
        for k, v in data.items():
            setattr(p, k, _teks(v) if isinstance(v, str) and k != "status" else v)
        p.edited_at, p.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        st = _status_setoran(session, kid, [p])[p.id]
        deteksi(session, kid)
        return _setoran_dict(p, st)
    return _respon(aksi, "Tax payment updated.")


class BatalRequest(BaseModel):
    client_id: UUID
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/payments/{payment_id}/cancel", summary="Batalkan setoran (transaksi Cash & Bank draft dihapus / posted dibalik, Manager+ untuk posted)")
def batal_setoran(payment_id: UUID, payload: BatalRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        bc._kunci_klien(session, kid)
        p = session.get(PAY, str(payment_id))
        if p is None or p.deleted_at is not None or str(p.client_id) != kid:
            raise _Gagal("Tax payment not found.", kode="NOT_FOUND", status_code=404)
        waktu = _sekarang()
        if p.bank_cash_transaction_id:
            tx = session.get(TX, p.bank_cash_transaction_id)
            if tx is not None and tx.deleted_at is None:
                if tx.status in ("draft", "approved"):
                    tx.deleted_at, tx.deleted_by = waktu, current_user.get("id")
                elif tx.status == "posted":
                    if auth.role_level(current_user.get("role")) < LEVEL_POST:
                        raise _Gagal("Reversing a posted payment requires Manager level or above.", kode="FORBIDDEN", status_code=403)
                    tgl = max(date.today(), tx.tx_date)
                    tx.status, tx.reversal_date, tx.reversal_reason = "reversed", tgl, payload.reason.strip()
                    tx.reversed_at, tx.reversed_by, tx.reversed_by_name = waktu, current_user.get("id"), _nama(current_user)
        p.status = "cancelled"
        p.notes = ((p.notes + "\n") if p.notes else "") + f"Cancelled: {payload.reason.strip()}"
        p.edited_at, p.edited_by = waktu, current_user.get("id")
        session.flush()
        deteksi(session, kid)
        return _setoran_dict(p, "cancelled")
    return _respon(aksi, "Tax payment cancelled.")


class SptRequest(BaseModel):
    client_id: UUID
    return_type: Literal["ppn", "pph21", "unifikasi", "annual_corporate", "other"]
    tax_period: date
    status: Literal["draft", "filed", "not_required"]
    filed_date: Optional[date] = None
    due_date: Optional[date] = None
    receipt_no: Optional[str] = Field(None, max_length=60)
    amount: Optional[float] = None
    is_amendment: bool = False
    notes: Optional[str] = Field(None, max_length=2000)


@router.put("/filings", summary="Catat / ubah status SPT per jenis & masa (Supervisor+)")
def simpan_spt(payload: SptRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        masa = _masa_spt(payload.return_type, payload.tax_period)
        if payload.status == "filed" and not payload.filed_date:
            raise _Gagal("Enter the filing date.")
        f = session.query(FIL).filter(FIL.client_id == kid, FIL.return_type == payload.return_type, FIL.tax_period == masa,
                                      FIL.deleted_at.is_(None)).first()
        nilai = dict(status=payload.status, filed_date=payload.filed_date if payload.status == "filed" else None,
                     due_date=payload.due_date or jatuh_tempo_lapor(payload.return_type, masa), receipt_no=_teks(payload.receipt_no),
                     amount=Decimal(str(payload.amount)) if payload.amount is not None else None, is_amendment=payload.is_amendment,
                     notes=_teks(payload.notes))
        if f is None:
            f = FIL(client_id=kid, return_type=payload.return_type, tax_period=masa, created_by=current_user.get("id"),
                    created_by_name=_nama(current_user), **nilai)
            session.add(f)
        else:
            for k, v in nilai.items():
                setattr(f, k, v)
            f.edited_at, f.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        deteksi(session, kid)
        return {"id": f.id, "return_type": f.return_type, "tax_period": f.tax_period, "status": f.status}
    return _respon(aksi, "Tax return status saved.")


# ============================================================
# ENDPOINT -- RECONCILIATION
# ============================================================

def _rekonsiliasi(session, kid: str, b: Buku, dari: date, sampai: date) -> List[Dict[str, Any]]:
    gl = _gl_per_jenis(session, kid, dari, sampai)
    spt = _spt_wajib(b, dari, sampai)
    hasil = []
    for k, j in JENIS.items():
        xs = [x for x in b.baris if x.row.tax_type == k and _dalam(x, dari, sampai)]
        buku = sum((x.nilai for x in xs), NOL)
        if not xs and not gl.get(k):
            continue
        if k == "pph_credit" and not gl.get(k):
            continue    # PPh yang dipotong customer tidak dibukukan modul Sales ke GL -> bukan selisih

        bayar = sum((_d(p.amount) for p in b.setoran if j.bayar and p.tax_type == j.bayar and k != "vat_input"
                     and dari <= _awal(p.tax_period) <= sampai and b.status_setoran[p.id] == "paid"), NOL)
        lapor = [s for s in spt if s["return_type"] == j.spt]
        status_lapor = "not_required" if not j.spt else ("filed" if lapor and all(s["status"] in ("filed", "not_required") for s in lapor)
                                                         else ("partial" if any(s["status"] == "filed" for s in lapor) else "not_filed"))
        selisih = buku - gl.get(k, NOL)
        hasil.append({"tax_type": k, "label": j.label, "ledger_amount": _f(buku), "gl_amount": _f(gl.get(k, NOL)), "difference": _f(selisih),
                      "payment_amount": _f(bayar), "filing_status": status_lapor, "items": len(xs),
                      "status": "reconciled" if abs(selisih) < 1 else "difference"})
    return hasil


@router.get("/reconciliation", summary="Tab Reconciliation: Tax Ledger vs GL per jenis + saran perbaikan")
def rekonsiliasi(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
                 _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        b = muat(session, kid)
        rows = _rekonsiliasi(session, kid, b, dari, sampai)
        prev = _rekonsiliasi(session, kid, b, pd, ps)
        terakhir = session.query(REC).filter(REC.client_id == kid).order_by(REC.run_at.desc()).first()
        _, tersimpan = _akun_pajak(session, kid)

        def kpi(rs):
            return {"reconciled_amount": _f(sum((Decimal(str(r["ledger_amount"])) for r in rs if r["status"] == "reconciled"), NOL)),
                    "unreconciled_amount": _f(sum((abs(Decimal(str(r["difference"]))) for r in rs), NOL)),
                    "matched_items": sum(r["items"] for r in rs if r["status"] == "reconciled"),
                    "difference_count": sum(1 for r in rs if r["status"] == "difference")}
        saran = []
        for r in rows:
            if r["status"] != "difference":
                continue
            d = Decimal(str(r["difference"]))
            saran.append({"tax_type": r["tax_type"], "title": f"{r['label']} difference", "amount": _f(abs(d)),
                          "detail": (f"GL is lower than Tax Ledger by Rp {abs(d):,.0f}" if d > 0 else f"Tax recorded in GL but not in Tax Ledger: Rp {abs(d):,.0f}"),
                          "action": "review" if d > 0 else "create_je", "severity": "high" if abs(d) >= 10_000_000 else "medium"})
        return {"period": {"from": dari, "to": sampai}, "rows": rows, "kpi": kpi(rows), "previous": kpi(prev), "fixes": saran,
                "mapping_saved": tersimpan,
                "last_run": {"run_at": terakhir.run_at, "run_by_name": terakhir.run_by_name, "difference_count": terakhir.difference_count,
                             "period_from": terakhir.period_from, "period_to": terakhir.period_to} if terakhir else None}
    return _respon(aksi)


class RunRekonRequest(BaseModel):
    client_id: UUID
    date_from: date
    date_to: date
    notes: Optional[str] = Field(None, max_length=2000)


@router.post("/reconciliation/run", summary="Simpan snapshot rekonsiliasi (Supervisor+)")
def run_rekonsiliasi(payload: RunRekonRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        dari, sampai = _rentang(payload.date_from, payload.date_to)
        _kunci(session, kid)
        sinkron(session, kid)
        b = muat(session, kid)
        rows = _rekonsiliasi(session, kid, b, dari, sampai)
        r = REC(client_id=kid, period_from=dari, period_to=sampai, total_ledger=sum((Decimal(str(x["ledger_amount"])) for x in rows), NOL),
                total_gl=sum((Decimal(str(x["gl_amount"])) for x in rows), NOL), difference_count=sum(1 for x in rows if x["status"] == "difference"),
                rows=[{k: (str(v) if isinstance(v, (date,)) else v) for k, v in x.items()} for x in rows], notes=_teks(payload.notes),
                run_by=current_user.get("id"), run_by_name=_nama(current_user))
        session.add(r)
        session.flush()
        deteksi(session, kid)
        return {"id": r.id, "difference_count": r.difference_count, "run_at": r.run_at}
    return _respon(aksi, "Reconciliation completed.")


# ============================================================
# EXCEPTIONS
# ============================================================

def _exc_dict(e: Any) -> Dict[str, Any]:
    return {"id": e.id, "exception_no": e.exception_no, "rule_code": e.rule_code, "ledger_id": e.ledger_id, "tax_type": e.tax_type,
            "tax_type_label": JENIS[e.tax_type].label if e.tax_type in JENIS else (e.tax_type or "—"), "tax_period": e.tax_period,
            "source_document": e.source_document, "party_name": e.party_name, "reason": e.reason,
            "dpp": _f(e.dpp) if e.dpp is not None else None, "potential_tax": _f(e.potential_tax), "severity": e.severity,
            "assigned_to": e.assigned_to, "status": e.status, "is_auto": bool(e.is_auto), "detected_at": e.detected_at,
            "resolved_at": e.resolved_at, "resolved_by_name": e.resolved_by_name, "resolution_note": e.resolution_note,
            "age_days": (date.today() - e.detected_at.date()).days}


def _nomor_exc(session, kid: str) -> str:
    awalan = f"EXC-{date.today().year}-"
    nomor = [n for (n,) in session.query(EXC.exception_no).filter(EXC.client_id == kid, EXC.exception_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:03d}"


def _temuan(session, kid: str, b: Buku) -> Dict[str, Dict[str, Any]]:
    hari = date.today()
    hasil: Dict[str, Dict[str, Any]] = {}

    def tambah(fp: str, x: Optional[Baris], **v):
        r = x.row if x is not None else None
        hasil[fp] = {"ledger_id": r.id if r is not None else None, "tax_type": r.tax_type if r is not None else v.pop("tax_type", None),
                     "tax_period": r.tax_period if r is not None else v.pop("tax_period", None),
                     "source_document": r.source_document if r is not None else v.pop("source_document", None),
                     "party_name": r.party_name if r is not None else None, "dpp": r.dpp if r is not None else None, **v}

    faktur: Dict[str, List[Baris]] = defaultdict(list)
    for x in b.baris:
        r = x.row
        if r.tax_type == "vat_input" and r.tax_document_no:
            faktur[r.tax_document_no.strip()].append(x)
        if r.tax_type == "vat_output" and not r.tax_document_no and x.nilai > 0:
            tambah(f"vat_output_no_efaktur:{r.id}", x, rule_code="vat_output_no_efaktur", reason="Unreported VAT output (sales not in e-Faktur)",
                   potential_tax=x.nilai, severity="high" if x.nilai >= 10_000_000 else "medium")
        if r.tax_type == "vat_input" and not r.tax_document_no and x.nilai > 0:
            tambah(f"vat_input_no_efaktur:{r.id}", x, rule_code="vat_input_no_efaktur", reason="VAT input without valid e-Faktur",
                   potential_tax=x.nilai, severity="high")
        if r.tax_type in ("pph21", "pph22", "pph23", "pph4_2", "vat_output") and not r.party_npwp and r.party_name and x.nilai > 0:
            tambah(f"no_npwp:{r.id}", x, rule_code="no_npwp", reason="No NPWP counterparty",
                   potential_tax=x.nilai if r.tax_type in ("pph22", "pph23") else NOL, severity="medium")
        tarif = x.jenis.tarif
        if tarif and r.rate is not None and not r.dpp_estimated and r.dpp:
            ok = abs(_d(r.rate) - tarif) <= Decimal("0.05") or (x.jenis.kelompok == "vat" and abs(_d(r.rate) - 12) <= Decimal("0.05"))
            if not ok:
                seharusnya = _bulat(_d(r.dpp) * tarif / 100)
                tambah(f"rate_mismatch:{r.id}", x, rule_code="rate_mismatch",
                       reason=f"Rate {float(r.rate):g}% differs from the standard {float(tarif):g}%",
                       potential_tax=max(seharusnya - x.nilai, NOL), severity="medium")
        if r.dpp_estimated:
            tambah(f"dpp_estimated:{r.id}", x, rule_code="dpp_estimated", reason="Tax base (DPP) estimated from the standard rate — verify the DPP",
                   potential_tax=NOL, severity="low")
        if x.bayar in ("unpaid", "partial") and x.tempo_bayar and x.tempo_bayar < hari and x.jenis.sifat == "payable":
            tambah(f"overdue_payment:{r.id}", x, rule_code="overdue_payment",
                   reason=f"Tax payment overdue (due {x.tempo_bayar:%d %b %Y})", potential_tax=x.sisa, severity="high")
    for no, xs in faktur.items():
        if len(xs) > 1:
            for x in xs[1:]:
                tambah(f"duplicate_vat_input:{x.row.id}", x, rule_code="duplicate_vat_input", reason=f"Duplicate VAT input claim (e-Faktur {no})",
                       potential_tax=x.nilai, severity="medium")
    for s in _spt_wajib(b, date(2000, 1, 1), _akhir(hari)):
        if s["status"] in ("not_filed", "draft") and s["due_date"] and s["due_date"] < hari:
            jenis = {"ppn": "vat_output", "pph21": "pph21", "unifikasi": "pph23", "annual_corporate": "pph29"}.get(s["return_type"])
            tambah(f"not_filed:{s['return_type']}:{s['tax_period']}", None, rule_code="return_not_filed",
                   reason=f"{s['return_label']} {s['tax_period']:%b %Y} not filed (due {s['due_date']:%d %b %Y})",
                   potential_tax=DENDA_SPT.get(s["return_type"], NOL), severity="high", tax_type=jenis, tax_period=s["tax_period"],
                   source_document=s["return_label"])
    return hasil


def deteksi(session, kid: str) -> Dict[str, int]:
    b = muat(session, kid)
    temuan = _temuan(session, kid, b)
    ada = {e.fingerprint: e for e in session.query(EXC).filter(EXC.client_id == kid, EXC.deleted_at.is_(None), EXC.is_auto.is_(True)).all()}
    waktu = _sekarang()
    baru = selesai = 0
    for fp, v in temuan.items():
        e = ada.pop(fp, None)
        if e is None:
            session.add(EXC(client_id=kid, exception_no=_nomor_exc(session, kid), fingerprint=fp, is_auto=True, status="open", **v))
            session.flush()
            baru += 1
            continue
        for k in ("reason", "potential_tax", "tax_period", "source_document", "party_name", "dpp"):
            if getattr(e, k) != v.get(k):
                setattr(e, k, v.get(k))
        if e.status == "resolved" and e.resolved_by_name == "System":
            e.status, e.resolved_at, e.resolved_by_name, e.resolution_note = "open", None, None, None
    for e in ada.values():
        if e.status in ("open", "in_review", "on_hold"):
            e.status, e.resolved_at, e.resolved_by_name, e.resolution_note = "resolved", waktu, "System", "Condition no longer detected."
            selesai += 1
    session.flush()
    return {"new": baru, "auto_resolved": selesai}


@router.get("/exceptions", summary="Tab Exceptions: KPI, daftar temuan, insight, eksposur per jenis, aging")
def exceptions(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
               _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        semua = session.query(EXC).filter(EXC.client_id == kid, EXC.deleted_at.is_(None)).order_by(EXC.detected_at.desc()).all()
        dalam = lambda e, d1, d2: e.tax_period is None or d1 <= e.tax_period <= d2
        kini = [e for e in semua if dalam(e, dari, sampai)]
        lalu = [e for e in semua if e.tax_period is not None and pd <= e.tax_period <= ps]
        aktif = lambda es: [e for e in es if e.status in ("open", "in_review", "on_hold")]
        hari = date.today()

        def kpi(es):
            a = aktif(es)
            return {"total": len(a), "high": sum(1 for e in a if e.severity == "high"), "medium": sum(1 for e in a if e.severity == "medium"),
                    "overdue_review": sum(1 for e in a if (hari - e.detected_at.date()).days > 7),
                    "resolved_month": sum(1 for e in es if e.resolved_at and e.resolved_at.date() >= hari.replace(day=1)),
                    "exposure": _f(sum((_d(e.potential_tax) for e in a), NOL))}
        per_jenis: Dict[str, Decimal] = defaultdict(lambda: NOL)
        for e in aktif(kini):
            per_jenis[e.tax_type or "other"] += _d(e.potential_tax)
        umur = {"0_7": 0, "8_30": 0, "31_60": 0, "60_plus": 0}
        for e in aktif(kini):
            d = (hari - e.detected_at.date()).days
            umur["0_7" if d <= 7 else "8_30" if d <= 30 else "31_60" if d <= 60 else "60_plus"] += 1
        # Insight berbasis aturan (bukan AI generatif): bandingkan dengan periode sebelumnya.
        insight = []
        k1, k0 = kpi(kini), kpi(lalu)
        if k1["exposure"]:
            terbesar = max(per_jenis.items(), key=lambda t: t[1])[0] if per_jenis else None
            insight.append({"level": "info", "text": f"Based on current exceptions, estimated potential tax exposure is Rp {k1['exposure']:,.0f}"
                            + (f", mainly from {JENIS[terbesar].label if terbesar in JENIS else terbesar}." if terbesar else ".")})
        vi = sum(1 for e in aktif(kini) if e.tax_type == "vat_input")
        vi0 = sum(1 for e in aktif(lalu) if e.tax_type == "vat_input")
        if vi:
            naik = f" ({'+' if vi >= vi0 else ''}{((vi - vi0) / vi0 * 100):.0f}% vs previous period)" if vi0 else ""
            insight.append({"level": "high", "text": f"{vi} VAT input issue(s) need valid e-Faktur numbers{naik}."})
        p23 = sum(1 for e in aktif(kini) if e.tax_type == "pph23" and e.severity == "high")
        if p23:
            insight.append({"level": "medium", "text": f"{p23} high-risk PPh 23 item(s) without withholding evidence or payment."})
        vo = sum(1 for e in aktif(kini) if e.rule_code == "vat_output_no_efaktur")
        if vo:
            insight.append({"level": "high", "text": f"Potential unreported VAT output detected from {vo} sales transaction(s)."})
        npwp = sum(1 for e in aktif(kini) if e.rule_code == "no_npwp")
        if npwp:
            insight.append({"level": "tip", "text": f"Review customer/vendor master data — {npwp} item(s) have no NPWP."})
        return {"period": {"from": dari, "to": sampai}, "kpi": k1, "previous": k0, "rows": [_exc_dict(e) for e in kini],
                "exposure_by_type": [{"tax_type": k, "label": JENIS[k].label if k in JENIS else k, "amount": _f(v)}
                                     for k, v in sorted(per_jenis.items(), key=lambda t: -t[1])],
                "aging": umur, "insights": insight}
    return _respon(aksi)


class ExcRequest(BaseModel):
    client_id: UUID
    reason: str = Field(..., min_length=3, max_length=2000)
    tax_type: Optional[str] = None
    tax_period: Optional[date] = None
    ledger_id: Optional[UUID] = None
    source_document: Optional[str] = Field(None, max_length=100)
    party_name: Optional[str] = Field(None, max_length=255)
    dpp: Optional[float] = Field(None, ge=0)
    potential_tax: float = Field(0, ge=0)
    severity: Literal["high", "medium", "low"] = "medium"
    assigned_to: Optional[str] = Field(None, max_length=255)


@router.post("/exceptions", summary="Catat temuan manual (Supervisor+)")
def buat_exception(payload: ExcRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        if payload.tax_type and payload.tax_type not in JENIS:
            raise _Gagal("Unknown tax type.")
        e = EXC(client_id=kid, exception_no=_nomor_exc(session, kid), rule_code="manual", fingerprint=f"manual:{_sekarang().timestamp()}",
                ledger_id=str(payload.ledger_id) if payload.ledger_id else None, tax_type=payload.tax_type,
                tax_period=_awal(payload.tax_period) if payload.tax_period else None, source_document=_teks(payload.source_document),
                party_name=_teks(payload.party_name), reason=payload.reason.strip(), dpp=Decimal(str(payload.dpp)) if payload.dpp is not None else None,
                potential_tax=Decimal(str(payload.potential_tax)), severity=payload.severity, assigned_to=_teks(payload.assigned_to),
                status="open", is_auto=False, created_by=current_user.get("id"), created_by_name=_nama(current_user))
        session.add(e)
        session.flush()
        return _exc_dict(e)
    return _respon(aksi, "Exception recorded.")


class UbahExcRequest(BaseModel):
    client_id: UUID
    status: Optional[Literal["open", "in_review", "on_hold", "resolved", "dismissed"]] = None
    severity: Optional[Literal["high", "medium", "low"]] = None
    assigned_to: Optional[str] = Field(None, max_length=255)
    resolution_note: Optional[str] = Field(None, max_length=2000)


@router.put("/exceptions/{exception_id}", summary="Ubah status / penanggung jawab / tingkat temuan (Supervisor+)")
def ubah_exception(exception_id: UUID, payload: UbahExcRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        e = session.get(EXC, str(exception_id))
        if e is None or e.deleted_at is not None or str(e.client_id) != kid:
            raise _Gagal("Exception not found.", kode="NOT_FOUND", status_code=404)
        data = payload.model_dump(exclude_unset=True)
        if "status" in data and data["status"] in ("resolved", "dismissed") and e.status not in ("resolved", "dismissed"):
            e.resolved_at, e.resolved_by_name = _sekarang(), _nama(current_user)
        if "status" in data and data["status"] in ("open", "in_review", "on_hold"):
            e.resolved_at, e.resolved_by_name = None, None
        for k in ("status", "severity", "assigned_to", "resolution_note"):
            if k in data:
                setattr(e, k, _teks(data[k]) if k in ("assigned_to", "resolution_note") else data[k])
        e.edited_at, e.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        return _exc_dict(e)
    return _respon(aksi, "Exception updated.")


# ============================================================
# REPORTS
# ============================================================

JENIS_LAPORAN = ("withholding_summary", "vat_summary", "payment_register", "reconciliation", "exposure", "filing_status")


@router.get("/reports/{report_type}", summary="Data laporan pajak (withholding, VAT, setoran, rekonsiliasi, eksposur, SPT)")
def laporan(report_type: str, client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
            _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    if report_type not in JENIS_LAPORAN:
        return bc._respon_gagal(_Gagal("Unknown report type.", kode="NOT_FOUND", status_code=404))

    def aksi(session):
        dari, sampai = _rentang(date_from, date_to)
        pd, ps = _periode_sebelum(dari, sampai)
        b = muat(session, kid)
        klien = dbc.get_management_client_by_id(kid) or {}
        dasar = {"report_type": report_type, "period": {"from": dari, "to": sampai}, "client": {
            "name": klien.get("nama_client") or "", "npwp": klien.get("npwp"), "address": ", ".join(
                x for x in (klien.get("alamat"), klien.get("kota"), klien.get("provinsi"), klien.get("kode_pos")) if x)}}
        if report_type == "withholding_summary":
            def grup(d1, d2):
                g: Dict[str, Dict[str, Any]] = {}
                for x in b.baris:
                    if x.jenis.kelompok != "pph" or x.jenis.sifat != "payable" or not _dalam(x, d1, d2):
                        continue
                    v = g.setdefault(x.row.tax_type, {"tax_type": x.row.tax_type, "label": x.jenis.label, "dpp": NOL, "tax_amount": NOL, "count": 0, "rates": set()})
                    v["dpp"] += _d(x.row.dpp)
                    v["tax_amount"] += x.nilai
                    v["count"] += 1
                    if x.row.rate is not None:
                        v["rates"].add(float(x.row.rate))
                return g
            g, g0 = grup(dari, sampai), grup(pd, ps)
            rows = [{"tax_type": v["tax_type"], "label": v["label"], "dpp": _f(v["dpp"]), "tax_amount": _f(v["tax_amount"]), "count": v["count"],
                     "rate": f"{next(iter(v['rates'])):g}%" if len(v["rates"]) == 1 else ("Various" if v["rates"] else "—")}
                    for v in sorted(g.values(), key=lambda v: v["tax_type"])]
            tot = lambda gg, k: sum((v[k] for v in gg.values()), NOL) if k != "count" else sum(v["count"] for v in gg.values())
            return {**dasar, "rows": rows, "summary": {"total_dpp": _f(tot(g, "dpp")), "total_tax": _f(tot(g, "tax_amount")), "transactions": tot(g, "count"),
                                                       "types": len(g), "prev_total_dpp": _f(tot(g0, "dpp")), "prev_total_tax": _f(tot(g0, "tax_amount")),
                                                       "prev_transactions": tot(g0, "count"), "type_labels": ", ".join(v["label"] for v in g.values())}}
        if report_type == "vat_summary":
            rows = []
            m = dari
            spt = {(s["return_type"], s["tax_period"]): s for s in _spt_wajib(b, dari, sampai)}
            while m <= sampai:
                xs = [x for x in b.baris if x.row.tax_period == m and x.jenis.kelompok == "vat"]
                o = [x for x in xs if x.row.tax_type == "vat_output"]
                i = [x for x in xs if x.row.tax_type == "vat_input"]
                net = sum((x.nilai for x in o), NOL) - sum((x.nilai for x in i), NOL)
                bayar = sum((_d(p.amount) for p in b.setoran if p.tax_type == "vat" and _awal(p.tax_period) == m and b.status_setoran[p.id] == "paid"), NOL)
                s = spt.get(("ppn", m))
                rows.append({"period": m, "output_dpp": _f(sum((_d(x.row.dpp) for x in o), NOL)), "output_vat": _f(sum((x.nilai for x in o), NOL)),
                             "input_dpp": _f(sum((_d(x.row.dpp) for x in i), NOL)), "input_vat": _f(sum((x.nilai for x in i), NOL)),
                             "net_vat": _f(net), "position": "Payable" if net > 0 else ("Overpaid" if net < 0 else "Nil"), "paid": _f(bayar),
                             "filing": s["status"] if s else "n/a"})
                m = _geser(m, 1)
            return {**dasar, "rows": rows}
        if report_type == "payment_register":
            rows = [_setoran_dict(p, b.status_setoran[p.id]) for p in b.setoran if dari <= p.payment_date <= sampai]
            return {**dasar, "rows": rows}
        if report_type == "reconciliation":
            return {**dasar, "rows": _rekonsiliasi(session, kid, b, dari, sampai)}
        if report_type == "exposure":
            es = session.query(EXC).filter(EXC.client_id == kid, EXC.deleted_at.is_(None), EXC.status.in_(("open", "in_review", "on_hold"))).all()
            es = [e for e in es if e.tax_period is None or dari <= e.tax_period <= sampai]
            return {**dasar, "rows": [_exc_dict(e) for e in sorted(es, key=lambda e: (-{"high": 3, "medium": 2, "low": 1}[e.severity], -_d(e.potential_tax)))]}
        return {**dasar, "rows": _spt_wajib(b, dari, sampai)}
    return _respon(aksi)
