"""
modules/assets_and_equity/fixed_assets_v1.py
============================================
Fixed Assets (grup sidebar Assets & Equity), UI dataset/picture/Template
UI/Fix Assets/1-6.jpeg -- tab Overview, Asset Register, Depreciation,
Disposal, Reports, Posted. Semua endpoint di /api/v1/asset/fixed-assets/...
Tabel: migrations/39-create_fixed_asset_tables.py.

Alur akuntansi (jurnal FA-YYYY-####, dibaca GL/FS sebagai sumber "fixed_asset";
tidak ada salinan ke Journal Entry):

    Acquisition  (opsional, Manager+)  Dr akun aset            / Cr akun lawan pilihan
                 -- hanya kalau perolehan BELUM tercatat lewat Purchase / Cash &
                    Bank / Opening Balance, supaya biaya tidak terhitung dua kali.
    Depreciation (batch bulanan DEP-YYYY-MM: draft -> approved -> posted)
                 1 jurnal per aset: Dr beban penyusutan / Cr akumulasi penyusutan
    Disposal     (DSP-YYYY-###: draft -> pending -> approved -> posted)
                 Dr akumulasi, Dr akun hasil (proceeds), Dr rugi | Cr laba, Cr akun aset
    Adjustment   (Manager+) koreksi biaya atau akumulasi dengan akun lawan

Periode penyusutan harus SETELAH bulan cut-off opening balance klien
(_bulan_pertama_susut): akumulasi s.d. cut-off sudah ada di
opening_accumulated_depreciation (mis. aset hasil import Asset Register di
Opening Balance), jadi bulan sebelumnya tidak boleh disusutkan lagi.

Nilai per tanggal (as_of) dihitung, tidak disimpan:
    biaya     = cost + sum(cost_change jurnal efektif)
    akumulasi = opening_accumulated_depreciation + sum(accum_change jurnal efektif)
    efektif   = journal_date <= as_of dan belum dibalik per as_of.

Hak akses mengikuti Cash & Bank: Supervisor+ (LEVEL_INPUT) input & approve,
Manager+ (LEVEL_POST) post, reverse, adjustment, jurnal perolehan.
Kunci periode Year-End Closing dijaga trigger DB di tabel jurnal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import db_client as dbc
from ..api_response import sukses
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_v1 as bc

logger = get_module_logger("asset_fixed_assets_v1")

router = APIRouter(prefix="/api/v1/asset/fixed-assets", tags=["fixed-assets"])

LEVEL_INPUT = bc.LEVEL_INPUT
LEVEL_POST = bc.LEVEL_POST
NOL = Decimal("0")
SEN = Decimal("0.01")
TOL = Decimal("0.005")
_Gagal = bc._Gagal

CAT = dbc.FixedAssetCategory
FA = dbc.FixedAsset
RUN = dbc.FixedAssetDepreciationRun
RL = dbc.FixedAssetDepreciationLine
DSP = dbc.FixedAssetDisposal
JR = dbc.FixedAssetJournal
JL = dbc.FixedAssetJournalLine
LOG = dbc.FixedAssetReportLog
COA = dbc.ManagementClientCoa

METODE = ("straight_line", "declining_balance", "none")
STATUS_ASET = ("active", "under_construction", "inactive", "disposed")
METODE_LEPAS = ("sold", "scrapped", "lost", "transferred", "donated")
JENIS_LAPORAN = ("asset_register", "depreciation_schedule", "asset_movement", "disposal", "nbv_summary", "near_end_of_life")
BATAS_HAMPIR_HABIS = 24   # bulan sisa umur untuk "near end of useful life"


def _bulat(v: Decimal) -> Decimal:
    return v.quantize(SEN, rounding=ROUND_HALF_UP)


def _dec(v: Any) -> Decimal:
    return bc._dec(v)


_f = bc._f
_nama = bc._nama
_sekarang = bc._sekarang


def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _awal_bulan(d: date) -> date:
    return d.replace(day=1)


def _akhir_bulan(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _tambah_bulan(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def _selisih_bulan(a: date, b: date) -> int:
    """Jumlah bulan kalender dari bulan a ke bulan b (a=Jan, b=Mar -> 2)."""
    return (b.year - a.year) * 12 + (b.month - a.month)


def _kunci_klien(session, kid: str) -> None:
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"fixed-asset:{kid}"})


def _respon(fn, pesan: str = "OK"):
    return bc._respon(fn, pesan)


# ============================================================
# AKUN COA
# ============================================================

def _akun_opsional(session, kid: str, coa_id: Any) -> Any:
    return bc._akun(session, kid, str(coa_id)) if coa_id else None


def _peta_akun(session, kid: str) -> Dict[str, Any]:
    return {a.id: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}


def _akun_ringkas(a: Any) -> Optional[Dict[str, Any]]:
    return {"id": a.id, "code": a.acc_no, "name": a.account_name} if a is not None else None


# ============================================================
# MODEL HITUNG (biaya, akumulasi, nilai buku, penyusutan)
# ============================================================

@dataclass
class Jurnal:
    id: str
    no: str
    jenis: str
    tanggal: date
    asset_id: Optional[str]
    biaya: Decimal
    akumulasi: Decimal
    nominal: Decimal
    status: str
    tanggal_balik: Optional[date]

    def efektif(self, per: date) -> bool:
        if self.tanggal > per:
            return False
        return not (self.status == "reversed" and self.tanggal_balik and self.tanggal_balik <= per)


@dataclass
class Aset:
    row: Any
    kategori: Any
    jurnal: List[Jurnal] = field(default_factory=list)
    tanggal_lepas: Optional[date] = None       # disposal posted (efektif kalau belum dibalik)
    lepas_dibalik: Optional[date] = None

    @property
    def id(self) -> str:
        return self.row.id

    @property
    def metode(self) -> Optional[str]:
        if self.row.depreciation_method:
            return self.row.depreciation_method
        if self.kategori is not None:
            return self.kategori.depreciation_method if self.kategori.is_depreciable else "none"
        return None

    @property
    def umur(self) -> Optional[int]:
        if self.row.useful_life_months:
            return int(self.row.useful_life_months)
        if self.row.useful_life_years:
            return int(self.row.useful_life_years) * 12
        return int(self.kategori.useful_life_months) if self.kategori is not None and self.kategori.useful_life_months else None

    @property
    def residu(self) -> Decimal:
        return _dec(self.row.residual_value)

    @property
    def mulai(self) -> Optional[date]:
        return self.row.depreciation_start_date or self.row.purchase_date

    def akun(self, jenis: str) -> Optional[str]:
        kolom = {"asset": ("coa_id", "asset_coa_id"), "accum": ("accum_coa_id", "accum_coa_id"),
                 "expense": ("expense_coa_id", "expense_coa_id")}[jenis]
        v = getattr(self.row, kolom[0], None)
        if not v and self.kategori is not None:
            v = getattr(self.kategori, kolom[1], None)
        return v

    def biaya(self, per: date) -> Decimal:
        return _dec(self.row.cost) + sum((j.biaya for j in self.jurnal if j.efektif(per)), NOL)

    def akumulasi(self, per: date) -> Decimal:
        return _dec(self.row.opening_accumulated_depreciation) + sum((j.akumulasi for j in self.jurnal if j.efektif(per)), NOL)

    def dilepas(self, per: date) -> bool:
        return bool(self.tanggal_lepas and self.tanggal_lepas <= per and not (self.lepas_dibalik and self.lepas_dibalik <= per))

    def ada(self, per: date) -> bool:
        """Sudah diperoleh per tanggal itu (aset tanpa tanggal dianggap ada)."""
        return not self.row.purchase_date or self.row.purchase_date <= per

    def nbv(self, per: date) -> Decimal:
        if not self.ada(per) or self.dilepas(per):
            return NOL
        return self.biaya(per) - self.akumulasi(per)

    def bulan_berjalan(self, per: date) -> int:
        """Bulan penyusutan yang sudah lewat s.d. bulan `per` (bulan mulai dihitung 1)."""
        if not self.mulai or self.mulai > _akhir_bulan(per):
            return 0
        return _selisih_bulan(self.mulai, per) + 1

    def sisa_umur(self, per: date) -> Optional[int]:
        if not self.umur:
            return None
        return max(self.umur - self.bulan_berjalan(per), 0)

    def penyusutan_bulan(self, biaya: Decimal, akumulasi: Decimal, ke: int) -> Decimal:
        """Penyusutan 1 bulan (bulan ke-`ke`, mulai 1) dari posisi biaya & akumulasi."""
        umur = self.umur
        if not umur or self.metode not in ("straight_line", "declining_balance"):
            return NOL
        sisa = biaya - self.residu - akumulasi
        if sisa <= TOL:
            return NOL
        garis_lurus = (biaya - self.residu) / Decimal(umur)
        if self.metode == "straight_line" or ke > umur:
            # Lewat umur tapi masih bersisa (mis. akumulasi awal kurang): lanjut tarif garis lurus sampai habis.
            nilai = garis_lurus
        else:
            nilai = (biaya - akumulasi) * Decimal(2) / Decimal(umur)
        if ke == umur and sisa <= max(nilai, garis_lurus) * 2:
            return _bulat(sisa)   # bulan terakhir umur: habiskan sisa (pembulatan / sisa saldo menurun)
        return _bulat(min(nilai, sisa))

    def habis(self, per: date) -> bool:
        return self.biaya(per) - self.residu - self.akumulasi(per) <= TOL


@dataclass
class Buku:
    kid: str
    aset: List[Aset]
    kategori: Dict[str, Any]
    akun: Dict[str, Any]
    jurnal: List[Jurnal]

    def per_id(self) -> Dict[str, Aset]:
        return {a.id: a for a in self.aset}


def _muat(session, kid: str) -> Buku:
    kategori = {c.id: c for c in session.query(CAT).filter(CAT.client_id == kid).all()}
    baris = session.query(FA).filter(FA.client_id == kid, FA.deleted_at.is_(None)).order_by(FA.asset_code).all()
    aset = [Aset(row=r, kategori=kategori.get(r.category_id)) for r in baris]
    per_id = {a.id: a for a in aset}
    jurnal: List[Jurnal] = []
    for j in session.query(JR).filter(JR.client_id == kid).order_by(JR.journal_date, JR.journal_no).all():
        jj = Jurnal(id=j.id, no=j.journal_no, jenis=j.journal_type, tanggal=j.journal_date, asset_id=j.asset_id,
                    biaya=_dec(j.cost_change), akumulasi=_dec(j.accum_change), nominal=_dec(j.amount),
                    status=j.status, tanggal_balik=j.reversal_date)
        jurnal.append(jj)
        a = per_id.get(j.asset_id)
        if a is None:
            continue
        a.jurnal.append(jj)
        if j.journal_type == "disposal":
            a.tanggal_lepas = j.journal_date
            a.lepas_dibalik = j.reversal_date if j.status == "reversed" else None
    return Buku(kid=kid, aset=aset, kategori=kategori, akun=_peta_akun(session, kid), jurnal=jurnal)


def _masalah(a: Aset, per: date) -> List[str]:
    """Data yang membuat aset aktif tidak bisa disusutkan otomatis (kartu Pending Review)."""
    r = a.row
    if r.status != "active" or (a.kategori is not None and not a.kategori.is_depreciable) or a.metode == "none":
        return []
    isu = []
    if a.kategori is None:
        isu.append("Check asset category")
    if not r.purchase_date or r.purchase_date > date.today():
        isu.append("Verify acquisition date")
    if a.metode not in ("straight_line", "declining_balance"):
        isu.append("Check method")
    if not a.umur:
        isu.append("Missing useful life")
    if r.residual_value is None:
        isu.append("Missing salvage value")
    if _dec(r.cost) <= 0:
        isu.append("Missing cost")
    if not a.akun("expense") or not a.akun("accum"):
        isu.append("Missing depreciation accounts")
    return isu


def _status_tampil(a: Aset, per: date) -> str:
    if a.dilepas(per) or a.row.status == "disposed":
        return "disposed"
    if a.row.status in ("under_construction", "inactive"):
        return a.row.status
    if a.metode in ("straight_line", "declining_balance") and a.umur and a.habis(per):
        return "fully_depreciated"
    sisa = a.sisa_umur(per)
    if sisa is not None and a.metode in ("straight_line", "declining_balance") and sisa <= BATAS_HAMPIR_HABIS:
        return "near_end_of_life"
    return "active"


def _aset_dict(b: Buku, a: Aset, per: date) -> Dict[str, Any]:
    r = a.row
    biaya, akum = a.biaya(per), a.akumulasi(per)
    lepas = a.dilepas(per)
    return {
        "id": r.id, "asset_code": r.asset_code, "name": r.name, "description": r.description,
        "category_id": r.category_id, "category": a.kategori.name if a.kategori is not None else (r.category or None),
        "acquisition_date": r.purchase_date, "depreciation_start_date": r.depreciation_start_date,
        "cost": _f(biaya), "original_cost": _f(r.cost), "residual_value": _f(r.residual_value) if r.residual_value is not None else None,
        "accumulated_depreciation": _f(0 if lepas else akum), "net_book_value": _f(a.nbv(per)),
        "opening_accumulated_depreciation": _f(r.opening_accumulated_depreciation),
        "depreciation_method": a.metode, "method_override": r.depreciation_method,
        "useful_life_months": a.umur, "life_override": r.useful_life_months,
        "months_elapsed": a.bulan_berjalan(per), "remaining_life_months": a.sisa_umur(per),
        "monthly_depreciation": _f(0 if lepas or r.status != "active" else a.penyusutan_bulan(biaya, akum, a.bulan_berjalan(per) + 1)),
        "location": r.location, "branch": r.branch, "department": r.department, "custodian": r.custodian,
        "serial_number": r.serial_number, "supplier": r.supplier, "reference": r.reference,
        "status": r.status or "active", "display_status": _status_tampil(a, per),
        "asset_account": _akun_ringkas(b.akun.get(a.akun("asset"))),
        "accum_account": _akun_ringkas(b.akun.get(a.akun("accum"))),
        "expense_account": _akun_ringkas(b.akun.get(a.akun("expense"))),
        "asset_coa_override": r.coa_id, "accum_coa_override": r.accum_coa_id, "expense_coa_override": r.expense_coa_id,
        "acquisition_journal_id": r.acquisition_journal_id,
        "disposal_date": r.disposal_date, "disposal_value": _f(r.disposal_value) if r.disposal_value is not None else None,
        "issues": _masalah(a, per),
        "created_at": r.created_at, "created_by_name": r.created_by_name,
    }


# ============================================================
# JURNAL
# ============================================================

def _nomor_jurnal(session, kid: str, tanggal: date) -> str:
    awalan = f"FA-{tanggal.year}-"
    nomor = [n for (n,) in session.query(JR.journal_no).filter(JR.client_id == kid, JR.journal_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


def _tulis_jurnal(session, kid: str, user: Dict[str, Any], *, jenis: str, tanggal: date, asset_id: Optional[str],
                  baris: List[Tuple[Any, Decimal, Decimal, Optional[str]]], reference: Optional[str],
                  description: Optional[str], biaya: Decimal = NOL, akumulasi: Decimal = NOL,
                  run_id: Optional[str] = None, disposal_id: Optional[str] = None) -> Any:
    """baris: (akun COA, debit, kredit, keterangan). Wajib seimbang."""
    baris = [(a, _bulat(d), _bulat(k), ket) for a, d, k, ket in baris if _bulat(d) or _bulat(k)]
    total_d = sum((d for _, d, _, _ in baris), NOL)
    total_k = sum((k for _, _, k, _ in baris), NOL)
    if not baris or total_d <= 0:
        raise _Gagal("The journal has no amount.")
    if total_d != total_k:
        raise _Gagal(f"Journal is not balanced (debit {total_d:,.2f} vs credit {total_k:,.2f}).")
    waktu = _sekarang()
    j = JR(client_id=kid, journal_no=_nomor_jurnal(session, kid, tanggal), journal_type=jenis, journal_date=tanggal,
           asset_id=asset_id, depreciation_run_id=run_id, disposal_id=disposal_id, reference=reference,
           description=description, amount=total_d, cost_change=_bulat(biaya), accum_change=_bulat(akumulasi),
           status="posted", posted_at=waktu, posted_by=user.get("id"), posted_by_name=_nama(user))
    session.add(j)
    session.flush()
    for i, (a, d, k, ket) in enumerate(baris, start=1):
        session.add(JL(journal_id=j.id, line_no=i, coa_id=a.id, account_code=a.acc_no, account_name=a.account_name,
                       description=ket, debit=d, credit=k))
    session.flush()
    return j


def _balik_jurnal(session, j: Any, tanggal: date, alasan: str, user: Dict[str, Any]) -> None:
    if j.status != "posted":
        raise _Gagal(f"Journal {j.journal_no} is already {j.status}.", kode="CONFLICT", status_code=409)
    if tanggal < j.journal_date:
        raise _Gagal("The reversal date cannot be earlier than the journal date.")
    j.status, j.reversal_date, j.reversal_reason = "reversed", tanggal, alasan
    j.reversed_at, j.reversed_by, j.reversed_by_name = _sekarang(), user.get("id"), _nama(user)
    session.flush()


def _jurnal_dict(j: Any, baris: Optional[List[Any]] = None, aset: Optional[Any] = None) -> Dict[str, Any]:
    d = {
        "id": j.id, "journal_no": j.journal_no, "journal_type": j.journal_type, "journal_date": j.journal_date,
        "asset_id": j.asset_id, "asset_code": aset.asset_code if aset is not None else None,
        "asset_name": aset.name if aset is not None else None, "category": None,
        "reference": j.reference, "description": j.description, "amount": _f(j.amount),
        "cost_change": _f(j.cost_change), "accum_change": _f(j.accum_change), "status": j.status,
        "depreciation_run_id": j.depreciation_run_id, "disposal_id": j.disposal_id,
        "posted_at": j.posted_at, "posted_by_name": j.posted_by_name,
        "reversal_date": j.reversal_date, "reversal_reason": j.reversal_reason, "reversed_by_name": j.reversed_by_name,
    }
    if baris is not None:
        d["lines"] = [{"line_no": l.line_no, "account_code": l.account_code, "account_name": l.account_name,
                       "description": l.description, "debit": _f(l.debit), "credit": _f(l.credit)} for l in baris]
    return d


# ============================================================
# ENDPOINT -- AKUN & KATEGORI
# ============================================================

@router.get("/accounts", summary="Akun COA klien untuk pilihan akun aset / akumulasi / beban / lawan")
def daftar_akun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return [{
            "id": a.id, "code": a.acc_no, "name": a.account_name, "classification": a.account_classification,
            "sub": a.account_sub, "standard_code": a.standard_account_code, "is_active": bool(a.is_active),
        } for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()]
    return _respon(aksi)


def _kategori_dict(c: Any, akun: Dict[str, Any], jumlah: int = 0) -> Dict[str, Any]:
    return {
        "id": c.id, "name": c.name, "description": c.description, "is_depreciable": bool(c.is_depreciable),
        "depreciation_method": c.depreciation_method, "useful_life_months": c.useful_life_months,
        "residual_rate": _f(c.residual_rate),
        "asset_account": _akun_ringkas(akun.get(c.asset_coa_id)), "accum_account": _akun_ringkas(akun.get(c.accum_coa_id)),
        "expense_account": _akun_ringkas(akun.get(c.expense_coa_id)), "asset_count": jumlah,
    }


@router.get("/categories", summary="Kategori aset tetap klien")
def daftar_kategori(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        akun = _peta_akun(session, kid)
        jumlah: Dict[str, int] = {}
        for (cid,) in session.query(FA.category_id).filter(FA.client_id == kid, FA.deleted_at.is_(None)).all():
            jumlah[cid] = jumlah.get(cid, 0) + 1
        return [_kategori_dict(c, akun, jumlah.get(c.id, 0)) for c in session.query(CAT).filter(
            CAT.client_id == kid, CAT.deleted_at.is_(None)).order_by(CAT.name).all()]
    return _respon(aksi)


class KategoriRequest(BaseModel):
    client_id: UUID
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    is_depreciable: bool = True
    depreciation_method: Literal["straight_line", "declining_balance", "none"] = "straight_line"
    useful_life_months: Optional[int] = Field(None, gt=0, le=1200)
    residual_rate: float = Field(0, ge=0, lt=100)
    asset_coa_id: Optional[UUID] = None
    accum_coa_id: Optional[UUID] = None
    expense_coa_id: Optional[UUID] = None


def _isi_kategori(session, kid: str, p: KategoriRequest, user: Dict[str, Any], c: Any = None) -> Any:
    nama = p.name.strip()
    lain = session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None),
                                     text("upper(name) = :n")).params(n=nama.upper())
    if c is not None:
        lain = lain.filter(CAT.id != c.id)
    if lain.first() is not None:
        raise _Gagal(f"Category '{nama}' already exists.", kode="CONFLICT", status_code=409)
    depresiasi = p.is_depreciable and p.depreciation_method != "none"
    if depresiasi and not p.useful_life_months:
        raise _Gagal("Useful life is required for a depreciable category.")
    for kolom in ("asset_coa_id", "accum_coa_id", "expense_coa_id"):
        _akun_opsional(session, kid, getattr(p, kolom))
    nilai = dict(name=nama, description=_teks(p.description), is_depreciable=p.is_depreciable,
                 depreciation_method=p.depreciation_method if p.is_depreciable else "none",
                 useful_life_months=p.useful_life_months if depresiasi else None, residual_rate=Decimal(str(p.residual_rate)),
                 asset_coa_id=str(p.asset_coa_id) if p.asset_coa_id else None,
                 accum_coa_id=str(p.accum_coa_id) if p.accum_coa_id else None,
                 expense_coa_id=str(p.expense_coa_id) if p.expense_coa_id else None)
    if c is None:
        c = CAT(client_id=kid, created_by=user.get("id"), **nilai)
        session.add(c)
    else:
        for k, v in nilai.items():
            setattr(c, k, v)
        c.edited_at, c.edited_by = _sekarang(), user.get("id")
        session.query(FA).filter(FA.category_id == c.id).update({FA.category: nama}, synchronize_session=False)
    session.flush()
    return c


def _ambil_kategori(session, kid: str, cid: Any) -> Any:
    c = session.get(CAT, str(cid))
    if c is None or c.deleted_at is not None or str(c.client_id) != kid:
        raise _Gagal("Category not found.", kode="NOT_FOUND", status_code=404)
    return c


@router.post("/categories", summary="Tambah kategori aset (Supervisor+)")
def buat_kategori(payload: KategoriRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        c = _isi_kategori(session, kid, payload, current_user)
        return _kategori_dict(c, _peta_akun(session, kid))
    return _respon(aksi, "Category saved.")


@router.put("/categories/{category_id}", summary="Ubah kategori aset (Supervisor+)")
def ubah_kategori(category_id: UUID, payload: KategoriRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        c = _isi_kategori(session, kid, payload, current_user, _ambil_kategori(session, kid, category_id))
        return _kategori_dict(c, _peta_akun(session, kid))
    return _respon(aksi, "Category updated.")


@router.delete("/categories/{category_id}", summary="Hapus kategori yang belum dipakai aset (Supervisor+)")
def hapus_kategori(category_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        c = _ambil_kategori(session, kid, category_id)
        if session.query(FA).filter(FA.category_id == c.id, FA.deleted_at.is_(None)).first() is not None:
            raise _Gagal("This category is still used by assets. Move them to another category first.", kode="CONFLICT", status_code=409)
        c.deleted_at, c.deleted_by = _sekarang(), current_user.get("id")
        return {"id": c.id}
    return _respon(aksi, "Category deleted.")


# Default per kode standar akun aset (umur ekonomis mengikuti kelompok fiskal PMK 72/2023).
_DEFAULT_STD = {
    "std_asset_noncurrent_ppe_land": ("Land", False, None),
    "std_asset_noncurrent_ppe_cip": ("Construction in Progress", False, None),
    "std_asset_noncurrent_ppe_building": ("Property & Buildings", True, 240),
    "std_asset_noncurrent_ppe_vehicle": ("Vehicles", True, 96),
    "std_asset_noncurrent_ppe_equipment": ("Machinery & Equipment", True, 48),
}
_KATA_ABAIKAN = {"aset", "asset", "assets", "tetap", "fixed", "akumulasi", "accumulated", "penyusutan", "depreciation",
                 "beban", "expense", "on", "dan", "and", "the", "of", "f", "i", "ii"}


def _token(s: Optional[str]) -> set:
    return {t for t in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(t) >= 3 and t not in _KATA_ABAIKAN}


def _prefix_sama(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a or "", b or ""):
        if x != y:
            break
        n += 1
    return n


def _paling_mirip(akun_aset: Any, kandidat: List[Any]) -> Optional[Any]:
    """Akun akumulasi / beban yang paling cocok: kata nama akun dulu, lalu prefix kode akun."""
    if len(kandidat) == 1:
        return kandidat[0]
    t = _token(akun_aset.account_name)
    terbaik, skor = None, (0, 0)
    for a in kandidat:
        s = (len(t & _token(a.account_name)), _prefix_sama(akun_aset.acc_no, a.acc_no))
        if s > skor:
            terbaik, skor = a, s
    return terbaik if skor[0] or skor[1] >= 2 else None


@router.post("/categories/seed-from-coa", summary="Buat kategori dari akun aset tetap di COA klien (Supervisor+)")
def kategori_dari_coa(payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        akun = [a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()]
        std = lambda a: (a.standard_account_code or "").lower()
        aset_ppe = [a for a in akun if std(a).startswith("std_asset_noncurrent_ppe") and "accum" not in std(a)]
        akum = [a for a in akun if std(a) == "std_asset_noncurrent_ppe_accum_depreciation"]
        beban = [a for a in akun if std(a) == "std_expense_operating_depreciation"]
        sudah = {c.asset_coa_id for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
        nama_ada = {c.name.upper() for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
        dibuat = []
        for a in aset_ppe:
            if a.id in sudah:
                continue
            label, susut, umur = _DEFAULT_STD.get(std(a), (a.account_name, True, 48))
            nama = a.account_name.strip().title() if len(aset_ppe) > 1 else label
            if nama.upper() in nama_ada:
                nama = f"{nama} ({a.acc_no})"
            akun_akum = _paling_mirip(a, akum) if susut else None
            akun_beban = _paling_mirip(a, beban) if susut else None
            c = CAT(client_id=kid, name=nama[:150], is_depreciable=susut, depreciation_method="straight_line" if susut else "none",
                    useful_life_months=umur if susut else None, residual_rate=0, asset_coa_id=a.id,
                    accum_coa_id=akun_akum.id if akun_akum is not None else None,
                    expense_coa_id=akun_beban.id if akun_beban is not None else None,
                    description=f"Created from COA account {a.acc_no}", created_by=current_user.get("id"))
            session.add(c)
            nama_ada.add(nama.upper())
            dibuat.append(nama)
        session.flush()
        return {"created": dibuat, "fixed_asset_accounts": len(aset_ppe)}
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    pesan = f"{len(data['created'])} categor{'y' if len(data['created']) == 1 else 'ies'} created from the chart of accounts."
    if not data["fixed_asset_accounts"]:
        pesan = "No fixed asset accounts (standard code std_asset_noncurrent_ppe_*) found in this client's chart of accounts."
    return sukses(data=data, message=pesan)


# ============================================================
# ENDPOINT -- ASSET REGISTER
# ============================================================

def _kode_aset_berikut(session, kid: str) -> str:
    kode = [k for (k,) in session.query(FA.asset_code).filter(FA.client_id == kid).all()]
    urut = max((int(m.group(1)) for k in kode if (m := re.fullmatch(r"FA-(\d+)", k or ""))), default=0)
    return f"FA-{urut + 1:04d}"


def _ambil_aset(session, kid: str, asset_id: Any) -> Any:
    r = session.get(FA, str(asset_id))
    if r is None or r.deleted_at is not None or str(r.client_id) != kid:
        raise _Gagal("Asset not found.", kode="NOT_FOUND", status_code=404)
    return r


def _kpi_register(b: Buku, per: date) -> Dict[str, Any]:
    lalu = per.replace(year=per.year - 1) if not (per.month == 2 and per.day == 29) else per.replace(year=per.year - 1, day=28)

    def hitung(t: date) -> Dict[str, float]:
        aktif = [a for a in b.aset if a.ada(t) and not a.dilepas(t)]
        return {
            "total_cost": _f(sum((a.biaya(t) for a in aktif), NOL)),
            "accumulated": _f(sum((a.akumulasi(t) for a in aktif), NOL)),
            "nbv": _f(sum((a.nbv(t) for a in aktif), NOL)),
            "active_cost": _f(sum((a.biaya(t) for a in aktif if a.row.status == "active"), NOL)),
            "under_construction": _f(sum((a.biaya(t) for a in aktif if a.row.status == "under_construction"), NOL)),
            "near_end": _f(sum((a.biaya(t) for a in aktif if _status_tampil(a, t) == "near_end_of_life"), NOL)),
            "additions_ytd": _f(sum((_dec(a.row.cost) for a in b.aset if a.row.purchase_date
                                     and a.row.purchase_date.year == t.year and a.row.purchase_date <= t), NOL)),
            "count": len(aktif),
        }
    return {"as_of": per, "previous_as_of": lalu, "current": hitung(per), "previous": hitung(lalu)}


@router.get("/assets", summary="Asset Register: semua aset + nilai per tanggal + KPI")
def daftar_aset(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        b = _muat(session, kid)
        return {"as_of": per, "kpi": _kpi_register(b, per), "assets": [_aset_dict(b, a, per) for a in b.aset],
                "next_code": _kode_aset_berikut(session, kid)}
    return _respon(aksi)


def _jadwal(a: Aset, per: date, bulan: int = 600) -> List[Dict[str, Any]]:
    """Proyeksi penyusutan bulanan dari bulan setelah penyusutan terakhir yang diposting."""
    if a.row.status != "active" or a.metode not in ("straight_line", "declining_balance") or not a.umur or not a.mulai:
        return []
    biaya, akum = a.biaya(per), a.akumulasi(per)
    terakhir = max((j.tanggal for j in a.jurnal if j.jenis == "depreciation" and j.efektif(per)), default=None)
    bulan_awal = _tambah_bulan(terakhir, 1) if terakhir else _awal_bulan(a.mulai)
    bulan_awal = max(bulan_awal, _awal_bulan(a.mulai))
    hasil = []
    for i in range(bulan):
        b = _tambah_bulan(bulan_awal, i)
        nilai = a.penyusutan_bulan(biaya, akum, a.bulan_berjalan(b))
        if nilai <= 0:
            break
        akum += nilai
        hasil.append({"period": b, "depreciation": _f(nilai), "accumulated": _f(akum), "nbv": _f(biaya - akum)})
    return hasil


@router.get("/assets/{asset_id}", summary="Detail aset: nilai, riwayat jurnal, proyeksi penyusutan")
def detail_aset(asset_id: UUID, client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        r = _ambil_aset(session, kid, asset_id)
        b = _muat(session, kid)
        a = b.per_id()[r.id]
        jurnal = session.query(JR).filter(JR.client_id == kid, JR.asset_id == r.id).order_by(JR.journal_date, JR.journal_no).all()
        lepas = session.query(DSP).filter(DSP.asset_id == r.id, DSP.deleted_at.is_(None)).order_by(DSP.created_at.desc()).all()
        return {**_aset_dict(b, a, per), "journals": [_jurnal_dict(j, aset=r) for j in jurnal],
                "disposals": [_disposal_dict(d, r, b.akun) for d in lepas], "schedule": _jadwal(a, per)}
    return _respon(aksi)


class AsetRequest(BaseModel):
    client_id: UUID
    asset_code: Optional[str] = Field(None, max_length=50)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    category_id: UUID
    acquisition_date: date
    depreciation_start_date: Optional[date] = None
    cost: float = Field(..., gt=0)
    residual_value: Optional[float] = Field(None, ge=0)
    useful_life_months: Optional[int] = Field(None, gt=0, le=1200)
    depreciation_method: Optional[Literal["straight_line", "declining_balance", "none"]] = None
    opening_accumulated_depreciation: float = Field(0, ge=0)
    location: Optional[str] = Field(None, max_length=255)
    branch: Optional[str] = Field(None, max_length=100)
    department: Optional[str] = Field(None, max_length=255)
    custodian: Optional[str] = Field(None, max_length=255)
    serial_number: Optional[str] = Field(None, max_length=100)
    supplier: Optional[str] = Field(None, max_length=255)
    reference: Optional[str] = Field(None, max_length=100)
    status: Literal["active", "under_construction", "inactive"] = "active"
    asset_coa_id: Optional[UUID] = None
    accum_coa_id: Optional[UUID] = None
    expense_coa_id: Optional[UUID] = None
    # Jurnal perolehan (Manager+): Dr akun aset / Cr akun lawan.
    post_acquisition: bool = False
    acquisition_credit_coa_id: Optional[UUID] = None


def _ada_jurnal_efektif(session, asset_id: str, jenis: Optional[Tuple[str, ...]] = None) -> bool:
    q = session.query(JR).filter(JR.asset_id == asset_id, JR.status == "posted")
    if jenis:
        q = q.filter(JR.journal_type.in_(jenis))
    return q.first() is not None


def _isi_aset(session, kid: str, p: AsetRequest, user: Dict[str, Any], r: Any = None) -> Any:
    kat = _ambil_kategori(session, kid, p.category_id)
    kode = (_teks(p.asset_code) or (r.asset_code if r is not None else None) or _kode_aset_berikut(session, kid)).upper()
    lain = session.query(FA).filter(FA.client_id == kid, FA.deleted_at.is_(None), FA.asset_code == kode)
    if r is not None:
        lain = lain.filter(FA.id != r.id)
    if lain.first() is not None:
        raise _Gagal(f"Asset code {kode} is already used.", kode="CONFLICT", status_code=409)
    for kolom in ("asset_coa_id", "accum_coa_id", "expense_coa_id"):
        _akun_opsional(session, kid, getattr(p, kolom))
    mulai = p.depreciation_start_date or p.acquisition_date
    if mulai < p.acquisition_date:
        raise _Gagal("Depreciation cannot start before the acquisition date.")
    biaya = Decimal(str(p.cost))
    residu = Decimal(str(p.residual_value)) if p.residual_value is not None else (
        _bulat(biaya * _dec(kat.residual_rate) / 100) if kat.is_depreciable else NOL)
    if residu >= biaya and kat.is_depreciable:
        raise _Gagal("Residual value must be lower than the cost.")
    if Decimal(str(p.opening_accumulated_depreciation)) > biaya - residu:
        raise _Gagal("Opening accumulated depreciation cannot exceed cost minus residual value.")

    nilai = dict(
        asset_code=kode, name=p.name.strip(), description=_teks(p.description), category_id=kat.id, category=kat.name,
        location=_teks(p.location), branch=_teks(p.branch), department=_teks(p.department), custodian=_teks(p.custodian),
        serial_number=_teks(p.serial_number), supplier=_teks(p.supplier), reference=_teks(p.reference),
        residual_value=residu, useful_life_months=p.useful_life_months,
        useful_life_years=(p.useful_life_months // 12) if p.useful_life_months else None,
        depreciation_method=p.depreciation_method, status=p.status,
        coa_id=str(p.asset_coa_id) if p.asset_coa_id else None,
        accum_coa_id=str(p.accum_coa_id) if p.accum_coa_id else None,
        expense_coa_id=str(p.expense_coa_id) if p.expense_coa_id else None,
    )
    # Angka yang membentuk nilai buku hanya boleh diubah selama belum ada jurnal (penyusutan/perolehan/disposal).
    angka = dict(purchase_date=p.acquisition_date, depreciation_start_date=mulai, cost=biaya,
                 opening_accumulated_depreciation=Decimal(str(p.opening_accumulated_depreciation)))
    if r is None:
        r = FA(client_id=kid, created_by=user.get("id"), created_by_name=_nama(user), **nilai, **angka)
        session.add(r)
    else:
        if r.status == "disposed":
            raise _Gagal("A disposed asset cannot be edited.", kode="CONFLICT", status_code=409)
        terkunci = _ada_jurnal_efektif(session, r.id)
        for k, v in angka.items():
            lama = getattr(r, k)
            beda = (_dec(lama) != _dec(v)) if isinstance(v, Decimal) else (lama != v)
            if beda and terkunci:
                raise _Gagal("Cost, dates and opening accumulated depreciation are locked once journals are posted for this asset. "
                             "Use an adjustment instead.", kode="CONFLICT", status_code=409)
            setattr(r, k, v)
        if terkunci and (r.depreciation_method != p.depreciation_method or (r.useful_life_months or None) != p.useful_life_months
                         or _dec(r.residual_value) != residu):
            logger.info("Parameter penyusutan aset %s diubah setelah ada jurnal (berlaku prospektif)", r.asset_code)
        for k, v in nilai.items():
            setattr(r, k, v)
        r.updated_at, r.edited_by = _sekarang(), user.get("id")
    session.flush()
    return r


def _posting_perolehan(session, kid: str, r: Any, kredit_id: Any, user: Dict[str, Any]) -> Any:
    if r.acquisition_journal_id:
        j = session.get(JR, r.acquisition_journal_id)
        if j is not None and j.status == "posted":
            raise _Gagal(f"The acquisition journal {j.journal_no} is already posted.", kode="CONFLICT", status_code=409)
    kat = session.get(CAT, r.category_id) if r.category_id else None
    akun_aset = _akun_opsional(session, kid, r.coa_id or (kat.asset_coa_id if kat is not None else None))
    if akun_aset is None:
        raise _Gagal("Set the asset account (category or asset) before posting the acquisition journal.")
    lawan = _akun_opsional(session, kid, kredit_id)
    if lawan is None:
        raise _Gagal("Choose the credit account for the acquisition journal (e.g. accounts payable, cash/bank).")
    if lawan.id == akun_aset.id:
        raise _Gagal("The credit account must differ from the asset account.")
    biaya = _dec(r.cost)
    j = _tulis_jurnal(session, kid, user, jenis="acquisition", tanggal=r.purchase_date, asset_id=r.id,
                      baris=[(akun_aset, biaya, NOL, f"Acquisition {r.asset_code} {r.name}"),
                             (lawan, NOL, biaya, f"Acquisition {r.asset_code} {r.name}")],
                      reference=r.reference or r.asset_code, description=f"Acquisition of {r.asset_code} - {r.name}")
    r.acquisition_journal_id = j.id
    session.flush()
    return j


def _cek_level(user: Dict[str, Any], minimal: int, aksi: str) -> None:
    if auth.role_level(user.get("role")) < minimal:
        raise _Gagal(f"{aksi} requires Manager level or above.", kode="FORBIDDEN", status_code=403)


@router.post("/assets", summary="Tambah aset (Supervisor+; jurnal perolehan opsional Manager+)")
def buat_aset(payload: AsetRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci_klien(session, kid)
        r = _isi_aset(session, kid, payload, current_user)
        if payload.post_acquisition:
            _cek_level(current_user, LEVEL_POST, "Posting the acquisition journal")
            _posting_perolehan(session, kid, r, payload.acquisition_credit_coa_id, current_user)
        b = _muat(session, kid)
        return _aset_dict(b, b.per_id()[r.id], date.today())
    return _respon(aksi, "Asset added.")


@router.put("/assets/{asset_id}", summary="Ubah aset (Supervisor+)")
def ubah_aset(asset_id: UUID, payload: AsetRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        r = _isi_aset(session, kid, payload, current_user, _ambil_aset(session, kid, asset_id))
        if payload.post_acquisition and not r.acquisition_journal_id:
            _cek_level(current_user, LEVEL_POST, "Posting the acquisition journal")
            _posting_perolehan(session, kid, r, payload.acquisition_credit_coa_id, current_user)
        b = _muat(session, kid)
        return _aset_dict(b, b.per_id()[r.id], date.today())
    return _respon(aksi, "Asset updated.")


@router.delete("/assets/{asset_id}", summary="Hapus aset yang belum punya jurnal posted (Supervisor+)")
def hapus_aset(asset_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        r = _ambil_aset(session, kid, asset_id)
        if _ada_jurnal_efektif(session, r.id):
            raise _Gagal("This asset has posted journals. Reverse them or record a disposal instead of deleting.",
                         kode="CONFLICT", status_code=409)
        if session.query(RL).join(RUN, RUN.id == RL.run_id).filter(
                RL.asset_id == r.id, RUN.deleted_at.is_(None), RUN.status.in_(("draft", "approved"))).first() is not None:
            raise _Gagal("This asset is included in an unposted depreciation batch. Recalculate or delete that batch first.",
                         kode="CONFLICT", status_code=409)
        session.query(DSP).filter(DSP.asset_id == r.id, DSP.deleted_at.is_(None), DSP.status.in_(("draft", "pending", "approved", "rejected"))
                                  ).update({DSP.deleted_at: _sekarang(), DSP.deleted_by: current_user.get("id")}, synchronize_session=False)
        r.deleted_at, r.deleted_by = _sekarang(), current_user.get("id")
        return {"id": r.id}
    return _respon(aksi, "Asset deleted.")


class PerolehanRequest(BaseModel):
    client_id: UUID
    credit_coa_id: UUID


@router.post("/assets/{asset_id}/acquisition-journal", summary="Posting jurnal perolehan aset (Manager+)")
def jurnal_perolehan(asset_id: UUID, payload: PerolehanRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        r = _ambil_aset(session, kid, asset_id)
        j = _posting_perolehan(session, kid, r, payload.credit_coa_id, current_user)
        return _jurnal_dict(j, session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all(), r)
    return _respon(aksi, "Acquisition journal posted.")


class PenyesuaianRequest(BaseModel):
    client_id: UUID
    target: Literal["cost", "accumulated_depreciation"]
    amount: float = Field(..., description="Positif = menambah, negatif = mengurangi")
    adjustment_date: date
    offset_coa_id: UUID
    reference: Optional[str] = Field(None, max_length=100)
    description: str = Field(..., min_length=3, max_length=1000)


@router.post("/assets/{asset_id}/adjustments", summary="Adjustment biaya / akumulasi aset dengan akun lawan (Manager+)")
def penyesuaian(asset_id: UUID, payload: PenyesuaianRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        r = _ambil_aset(session, kid, asset_id)
        if r.status == "disposed":
            raise _Gagal("A disposed asset cannot be adjusted.", kode="CONFLICT", status_code=409)
        nilai = _bulat(Decimal(str(payload.amount)))
        if nilai == 0:
            raise _Gagal("Adjustment amount cannot be zero.")
        b = _muat(session, kid)
        a = b.per_id()[r.id]
        tgl = payload.adjustment_date
        if r.purchase_date and tgl < r.purchase_date:
            raise _Gagal("The adjustment date cannot be earlier than the acquisition date.")
        lawan = bc._akun(session, kid, str(payload.offset_coa_id))
        if payload.target == "cost":
            akun = _akun_opsional(session, kid, a.akun("asset"))
            if akun is None:
                raise _Gagal("Set the asset account first.")
            if a.biaya(tgl) + nilai < a.akumulasi(tgl):
                raise _Gagal("Cost cannot drop below accumulated depreciation.")
            biaya, akum = nilai, NOL
            # Biaya naik: Dr aset / Cr lawan. Biaya turun: kebalikannya.
            baris = [(akun, max(nilai, NOL), max(-nilai, NOL), payload.description), (lawan, max(-nilai, NOL), max(nilai, NOL), payload.description)]
        else:
            akun = _akun_opsional(session, kid, a.akun("accum"))
            if akun is None:
                raise _Gagal("Set the accumulated depreciation account first.")
            if a.akumulasi(tgl) + nilai < 0:
                raise _Gagal("Accumulated depreciation cannot become negative.")
            if a.akumulasi(tgl) + nilai > a.biaya(tgl):
                raise _Gagal("Accumulated depreciation cannot exceed cost.")
            biaya, akum = NOL, nilai
            # Akumulasi naik (kredit): Dr lawan / Cr akumulasi.
            baris = [(lawan, max(nilai, NOL), max(-nilai, NOL), payload.description), (akun, max(-nilai, NOL), max(nilai, NOL), payload.description)]
        if lawan.id == akun.id:
            raise _Gagal("The offset account must differ from the asset account being adjusted.")
        j = _tulis_jurnal(session, kid, current_user, jenis="adjustment", tanggal=tgl, asset_id=r.id, baris=baris,
                          reference=_teks(payload.reference), description=payload.description.strip(), biaya=biaya, akumulasi=akum)
        return _jurnal_dict(j, session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all(), r)
    return _respon(aksi, "Adjustment posted.")


# ============================================================
# ENDPOINT -- OVERVIEW
# ============================================================

@router.get("/overview", summary="Overview Fixed Assets: KPI, tren nilai buku, per kategori, hampir habis umur")
def overview(client_id: UUID = Query(...), as_of: Optional[date] = Query(None), months: int = Query(12, ge=3, le=36),
             _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        b = _muat(session, kid)
        tren = []
        for i in range(months - 1, -1, -1):
            akhir = min(_akhir_bulan(_tambah_bulan(_awal_bulan(per), -i)), per)
            tren.append({"month": akhir.strftime("%Y-%m"), "nbv": _f(sum((a.nbv(akhir) for a in b.aset), NOL)),
                         "cost": _f(sum((a.biaya(akhir) for a in b.aset if a.ada(akhir) and not a.dilepas(akhir)), NOL))})
        hampir = sorted((a for a in b.aset if _status_tampil(a, per) == "near_end_of_life"), key=lambda a: a.sisa_umur(per) or 0)
        return {
            "as_of": per, "kpi": _kpi_register(b, per), "trend": tren, "by_category": _per_kategori(b, per),
            "near_end_of_life": [_aset_dict(b, a, per) for a in hampir],
            "issues_count": sum(1 for a in b.aset if _masalah(a, per)),
            "category_count": len([c for c in b.kategori.values() if c.deleted_at is None]),
        }
    return _respon(aksi)


def _per_kategori(b: Buku, per: date, saring=None) -> List[Dict[str, Any]]:
    grup: Dict[str, Dict[str, Any]] = {}
    for a in b.aset:
        if not a.ada(per) or a.dilepas(per) or (saring and not saring(a)):
            continue
        nama = a.kategori.name if a.kategori is not None else "Uncategorized"
        g = grup.setdefault(nama, {"category": nama, "cost": NOL, "accumulated": NOL, "nbv": NOL, "count": 0})
        g["cost"] += a.biaya(per)
        g["accumulated"] += a.akumulasi(per)
        g["nbv"] += a.nbv(per)
        g["count"] += 1
    return sorted(({**g, "cost": _f(g["cost"]), "accumulated": _f(g["accumulated"]), "nbv": _f(g["nbv"])} for g in grup.values()),
                  key=lambda g: -g["nbv"])


# ============================================================
# ENDPOINT -- DEPRECIATION
# ============================================================

def _hitung_batch(session, b: Buku, periode: date, kecuali_run: Optional[str] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(baris penyusutan, aset bermasalah) untuk bulan `periode`."""
    akhir = _akhir_bulan(periode)
    sudah = {aid for (aid,) in session.query(RL.asset_id).join(RUN, RUN.id == RL.run_id).filter(
        RUN.client_id == b.kid, RUN.period == periode, RUN.deleted_at.is_(None), RUN.status != "reversed",
        *( [RUN.id != kecuali_run] if kecuali_run else [] )).all()}
    baris, isu = [], []
    for a in b.aset:
        r = a.row
        if r.status != "active" or a.id in sudah or not a.ada(akhir) or a.dilepas(akhir):
            continue
        masalah = _masalah(a, akhir)
        if masalah:
            isu.append({"asset_id": a.id, "asset_code": r.asset_code, "name": r.name, "nbv": _f(a.nbv(akhir)), "issues": masalah})
            continue
        if a.metode not in ("straight_line", "declining_balance") or not a.mulai or a.mulai > akhir:
            continue
        # Posisi sebelum bulan ini (jurnal penyusutan bulan ini sendiri belum ada).
        biaya, akum = a.biaya(akhir), a.akumulasi(akhir)
        nilai = a.penyusutan_bulan(biaya, akum, a.bulan_berjalan(periode))
        if nilai <= 0:
            continue
        exp, acc = b.akun.get(a.akun("expense")), b.akun.get(a.akun("accum"))
        if exp is None or acc is None:
            isu.append({"asset_id": a.id, "asset_code": r.asset_code, "name": r.name, "nbv": _f(a.nbv(akhir)),
                        "issues": ["Missing depreciation accounts"]})
            continue
        baris.append({"asset_id": a.id, "asset_code": r.asset_code, "name": r.name,
                      "category": a.kategori.name if a.kategori is not None else None, "method": a.metode,
                      "cost": biaya, "accumulated_before": akum, "amount": nilai, "exp": exp, "acc": acc})
    return baris, isu


def _run_dict(run: Any, baris: Optional[List[Any]] = None, aset: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    d = {
        "id": run.id, "run_no": run.run_no, "period": run.period, "posting_date": run.posting_date,
        "asset_count": run.asset_count, "total_amount": _f(run.total_amount), "status": run.status, "notes": run.notes,
        "prepared_by_name": run.created_by_name, "created_at": run.created_at,
        "approved_by_name": run.approved_by_name, "approved_at": run.approved_at,
        "posted_by_name": run.posted_by_name, "posted_at": run.posted_at,
        "reversal_date": run.reversal_date, "reversal_reason": run.reversal_reason, "reversed_by_name": run.reversed_by_name,
    }
    if baris is not None:
        aset = aset or {}
        d["lines"] = [{
            "asset_id": l.asset_id, "asset_code": getattr(aset.get(l.asset_id), "asset_code", None),
            "name": getattr(aset.get(l.asset_id), "name", None), "category": getattr(aset.get(l.asset_id), "category", None),
            "method": l.method, "cost": _f(l.cost), "accumulated_before": _f(l.accumulated_before), "amount": _f(l.amount),
            "nbv_after": _f(_dec(l.cost) - _dec(l.accumulated_before) - _dec(l.amount)),
            "expense_account": f"{l.expense_account_code} · {l.expense_account_name}",
            "accum_account": f"{l.accum_account_code} · {l.accum_account_name}", "journal_id": l.journal_id,
        } for l in baris]
    return d


def _bulan_pertama_susut(session, kid: str) -> Optional[date]:
    """Bulan pertama yang boleh disusutkan = bulan setelah cut-off opening balance
    klien (None kalau klien belum punya opening balance)."""
    OB = dbc.ManagementClientCoaOpeningBalance
    cut_off = session.query(OB.as_of_date).filter(OB.client_id == kid, OB.deleted_at.is_(None)).order_by(OB.as_of_date).first()
    return _tambah_bulan(_awal_bulan(cut_off[0]), 1) if cut_off else None


def _periode_berikut(session, kid: str, b: Buku) -> date:
    terakhir = session.query(RUN.period).filter(RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status != "reversed"
                                                ).order_by(RUN.period.desc()).first()
    if terakhir:
        return _tambah_bulan(terakhir[0], 1)
    mulai = [a.mulai for a in b.aset if a.mulai and a.row.status == "active"]
    berikut = _awal_bulan(min(mulai)) if mulai else _awal_bulan(date.today())
    pertama = _bulan_pertama_susut(session, kid)
    return max(berikut, pertama) if pertama else berikut


@router.get("/depreciation", summary="Tab Depreciation: KPI, tren bulanan, run berikutnya, daftar batch, aset perlu review")
def ringkasan_penyusutan(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                         _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        b = _muat(session, kid)
        jur = [j for j in b.jurnal if j.jenis == "depreciation"]

        def total(dari: date, sampai: date) -> float:
            return _f(sum((j.nominal for j in jur if dari <= j.tanggal <= sampai and j.efektif(per)), NOL))

        bulan_ini = _awal_bulan(per)
        bulan_lalu = _tambah_bulan(bulan_ini, -1)
        tahun_lalu = per.replace(year=per.year - 1, day=min(per.day, 28))
        runs = session.query(RUN).filter(RUN.client_id == kid, RUN.deleted_at.is_(None)).order_by(RUN.period.desc()).all()
        pending = [r for r in runs if r.status in ("draft", "approved")]
        tren = []
        for i in range(11, -1, -1):
            m = _tambah_bulan(bulan_ini, -i)
            tren.append({"month": m.strftime("%Y-%m"), "amount": total(m, _akhir_bulan(m))})
        berikut = _periode_berikut(session, kid, b)
        baris, isu = _hitung_batch(session, b, berikut)
        _, isu_kini = _hitung_batch(session, b, bulan_ini)
        ada_run = next((r for r in runs if r.period == berikut and r.status != "reversed"), None)
        return {
            "as_of": per,
            "kpi": {
                "current_month": total(bulan_ini, _akhir_bulan(bulan_ini)), "previous_month": total(bulan_lalu, _akhir_bulan(bulan_lalu)),
                "ytd": total(date(per.year, 1, 1), per), "ytd_prev": total(date(per.year - 1, 1, 1), tahun_lalu),
                "pending_batches": len(pending),
                "pending_prev_month": sum(1 for r in pending if r.period <= bulan_lalu),
                "posted_entries_ytd": sum(1 for j in jur if j.tanggal.year == per.year and j.tanggal <= per and j.status == "posted"),
                "posted_entries_prev_ytd": sum(1 for j in jur if j.tanggal.year == per.year - 1 and j.tanggal <= tahun_lalu and j.status == "posted"),
            },
            "trend": tren,
            "next_run": {
                "period": berikut, "eligible_assets": len(baris), "estimated_amount": _f(sum((x["amount"] for x in baris), NOL)),
                "methods": sorted({x["method"] for x in baris}), "issues": len(isu),
                "existing_run_id": ada_run.id if ada_run else None,
                "status": "exists" if ada_run else ("ready" if baris else "nothing_to_run"),
            },
            "runs": [_run_dict(r) for r in runs],
            "review": isu_kini if isu_kini else isu,
        }
    return _respon(aksi)


class PeriodeRequest(BaseModel):
    client_id: UUID
    period: date = Field(..., description="Tanggal mana pun di bulan penyusutan")
    notes: Optional[str] = Field(None, max_length=1000)


@router.post("/depreciation/preview", summary="Hitung penyusutan 1 bulan tanpa menyimpan")
def preview_penyusutan(payload: PeriodeRequest, _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)
    periode = _awal_bulan(payload.period)

    def aksi(session):
        b = _muat(session, kid)
        baris, isu = _hitung_batch(session, b, periode)
        return {"period": periode, "lines": [{k: (_f(v) if isinstance(v, Decimal) else v) for k, v in x.items() if k not in ("exp", "acc")}
                                              | {"expense_account": f"{x['exp'].acc_no} · {x['exp'].account_name}",
                                                 "accum_account": f"{x['acc'].acc_no} · {x['acc'].account_name}"} for x in baris],
                "total": _f(sum((x["amount"] for x in baris), NOL)), "issues": isu}
    return _respon(aksi)


def _isi_baris_run(session, run: Any, baris: List[Dict[str, Any]]) -> None:
    session.query(RL).filter(RL.run_id == run.id).delete(synchronize_session=False)
    for x in baris:
        session.add(RL(run_id=run.id, asset_id=x["asset_id"], method=x["method"], cost=_bulat(x["cost"]),
                       accumulated_before=_bulat(x["accumulated_before"]), amount=x["amount"],
                       expense_account_code=x["exp"].acc_no, expense_account_name=x["exp"].account_name,
                       accum_account_code=x["acc"].acc_no, accum_account_name=x["acc"].account_name))
    run.asset_count = len(baris)
    run.total_amount = sum((x["amount"] for x in baris), NOL)
    session.flush()


def _ambil_run(session, kid: str, run_id: Any) -> Any:
    r = session.get(RUN, str(run_id))
    if r is None or r.deleted_at is not None or str(r.client_id) != kid:
        raise _Gagal("Depreciation batch not found.", kode="NOT_FOUND", status_code=404)
    return r


def _detail_run(session, run: Any) -> Dict[str, Any]:
    baris = session.query(RL).filter(RL.run_id == run.id).all()
    aset = {a.id: a for a in session.query(FA).filter(FA.id.in_([l.asset_id for l in baris] or ["00000000-0000-0000-0000-000000000000"])).all()}
    d = _run_dict(run, sorted(baris, key=lambda l: getattr(aset.get(l.asset_id), "asset_code", "") or ""), aset)
    d["journal_count"] = session.query(JR).filter(JR.depreciation_run_id == run.id).count()
    return d


def _posting_run(session, kid: str, run: Any, user: Dict[str, Any]) -> None:
    b = _muat(session, kid)
    per_id = b.per_id()
    akun_kode = {a.acc_no: a for a in b.akun.values()}
    baris = session.query(RL).filter(RL.run_id == run.id).all()
    if not baris:
        raise _Gagal("This batch has no assets to depreciate.")
    lebih_baru = session.query(RUN).filter(RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status == "posted",
                                           RUN.period > run.period).first()
    if lebih_baru is not None:
        raise _Gagal(f"A later batch ({lebih_baru.run_no}) is already posted. Post batches in period order.", kode="CONFLICT", status_code=409)
    for l in baris:
        a = per_id.get(l.asset_id)
        if a is None or a.row.status != "active" or a.dilepas(run.posting_date):
            raise _Gagal(f"Asset {getattr(a.row if a else None, 'asset_code', l.asset_id)} is no longer active. Recalculate the batch.",
                         kode="CONFLICT", status_code=409)
        if _dec(l.accumulated_before) != _bulat(a.akumulasi(run.posting_date)) or _dec(l.cost) != _bulat(a.biaya(run.posting_date)):
            raise _Gagal(f"Values of asset {a.row.asset_code} changed after this batch was prepared. Recalculate the batch.",
                         kode="CONFLICT", status_code=409)
        exp, acc = akun_kode.get(l.expense_account_code), akun_kode.get(l.accum_account_code)
        if exp is None or acc is None:
            raise _Gagal(f"Depreciation accounts of {a.row.asset_code} no longer exist in the chart of accounts.")
        ket = f"Depreciation {run.period.strftime('%b %Y')} - {a.row.asset_code} {a.row.name}"
        j = _tulis_jurnal(session, kid, user, jenis="depreciation", tanggal=run.posting_date, asset_id=a.id,
                          baris=[(exp, _dec(l.amount), NOL, ket), (acc, NOL, _dec(l.amount), ket)],
                          reference=run.run_no, description=ket, akumulasi=_dec(l.amount), run_id=run.id)
        l.journal_id = j.id
    waktu = _sekarang()
    run.status, run.posted_at, run.posted_by, run.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
    if not run.approved_at:
        run.approved_at, run.approved_by, run.approved_by_name = waktu, user.get("id"), _nama(user)
    session.flush()


class BuatRunRequest(PeriodeRequest):
    post_now: bool = False


@router.post("/depreciation/runs", summary="Run Depreciation: buat batch draft 1 bulan (Supervisor+; post_now Manager+)")
def buat_run(payload: BuatRunRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    periode = _awal_bulan(payload.period)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci_klien(session, kid)
        ada = session.query(RUN).filter(RUN.client_id == kid, RUN.period == periode, RUN.deleted_at.is_(None),
                                        RUN.status != "reversed").first()
        if ada is not None:
            raise _Gagal(f"Batch {ada.run_no} already exists for {periode.strftime('%B %Y')} ({ada.status}).", kode="CONFLICT", status_code=409)
        lebih_baru = session.query(RUN).filter(RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status != "reversed",
                                               RUN.period > periode).order_by(RUN.period.desc()).first()
        if lebih_baru is not None:
            raise _Gagal(f"A later batch ({lebih_baru.run_no}) already exists. Depreciation must be run in period order.",
                         kode="CONFLICT", status_code=409)
        pertama = _bulan_pertama_susut(session, kid)
        if pertama and periode < pertama:
            raise _Gagal(f"Depreciation up to the opening balance cut-off is already included in the opening accumulated "
                         f"depreciation. The first period you can run is {pertama.strftime('%B %Y')}.",
                         kode="BEFORE_OPENING_BALANCE", status_code=422)
        b = _muat(session, kid)
        baris, isu = _hitung_batch(session, b, periode)
        if not baris:
            raise _Gagal(f"No assets are eligible for depreciation in {periode.strftime('%B %Y')}."
                         + (f" {len(isu)} asset(s) need review first." if isu else ""), kode="NOTHING_TO_RUN", status_code=422)
        nomor = f"DEP-{periode.year}-{periode.month:02d}"
        if session.query(RUN).filter(RUN.client_id == kid, RUN.run_no.like(f"{nomor}%")).count():
            nomor = f"{nomor}-{session.query(RUN).filter(RUN.client_id == kid, RUN.run_no.like(f'{nomor}%')).count() + 1}"
        run = RUN(client_id=kid, run_no=nomor, period=periode, posting_date=_akhir_bulan(periode), notes=_teks(payload.notes),
                  status="draft", created_by=current_user.get("id"), created_by_name=_nama(current_user))
        session.add(run)
        session.flush()
        _isi_baris_run(session, run, baris)
        if payload.post_now:
            _cek_level(current_user, LEVEL_POST, "Posting depreciation")
            _posting_run(session, kid, run, current_user)
        return {**_detail_run(session, run), "skipped": isu}
    return _respon(aksi, "Depreciation batch created.")


@router.get("/depreciation/runs/{run_id}", summary="Detail batch penyusutan")
def detail_run(run_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: _detail_run(session, _ambil_run(session, kid, run_id)))


@router.post("/depreciation/runs/{run_id}/recalculate", summary="Hitung ulang batch draft/approved (kembali ke draft, Supervisor+)")
def hitung_ulang_run(run_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        run = _ambil_run(session, kid, run_id)
        if run.status not in ("draft", "approved"):
            raise _Gagal(f"Only unposted batches can be recalculated ({run.run_no} is {run.status}).", kode="CONFLICT", status_code=409)
        baris, _ = _hitung_batch(session, _muat(session, kid), run.period, kecuali_run=run.id)
        _isi_baris_run(session, run, baris)
        run.status, run.approved_at, run.approved_by, run.approved_by_name = "draft", None, None, None
        run.edited_at, run.edited_by = _sekarang(), current_user.get("id")
        return _detail_run(session, run)
    return _respon(aksi, "Batch recalculated.")


def _ubah_status_run(run_id: UUID, kid: str, user: Dict[str, Any], dari: Tuple[str, ...], ke: str, pesan: str):
    def aksi(session):
        _kunci_klien(session, kid)
        run = _ambil_run(session, kid, run_id)
        if run.status not in dari:
            raise _Gagal(f"{run.run_no} is {run.status}.", kode="CONFLICT", status_code=409)
        waktu = _sekarang()
        if ke == "approved":
            run.status, run.approved_at, run.approved_by, run.approved_by_name = "approved", waktu, user.get("id"), _nama(user)
        elif ke == "draft":
            run.status, run.approved_at, run.approved_by, run.approved_by_name = "draft", None, None, None
        elif ke == "posted":
            _posting_run(session, kid, run, user)
        run.edited_at, run.edited_by = waktu, user.get("id")
        session.flush()
        return _detail_run(session, run)
    return _respon(aksi, pesan)


@router.post("/depreciation/runs/{run_id}/approve", summary="Approve batch draft (Supervisor+)")
def approve_run(run_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _ubah_status_run(run_id, str(payload.client_id), current_user, ("draft",), "approved", "Batch approved.")


@router.post("/depreciation/runs/{run_id}/return-to-draft", summary="Kembalikan batch approved ke draft (Supervisor+)")
def draft_run(run_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _ubah_status_run(run_id, str(payload.client_id), current_user, ("approved",), "draft", "Batch returned to draft.")


@router.post("/depreciation/runs/{run_id}/post", summary="Post batch -> jurnal FA per aset (Manager+)")
def post_run(run_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _ubah_status_run(run_id, str(payload.client_id), current_user, ("draft", "approved"), "posted", "Depreciation posted.")


@router.delete("/depreciation/runs/{run_id}", summary="Hapus batch yang belum diposting (Supervisor+)")
def hapus_run(run_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        run = _ambil_run(session, kid, run_id)
        if run.status not in ("draft", "approved"):
            raise _Gagal(f"Posted batches cannot be deleted. Reverse {run.run_no} instead.", kode="CONFLICT", status_code=409)
        run.deleted_at, run.deleted_by = _sekarang(), current_user.get("id")
        return {"id": run.id}
    return _respon(aksi, "Batch deleted.")


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/depreciation/runs/{run_id}/reverse", summary="Balik batch posted terakhir (Manager+)")
def balik_run(run_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        run = _ambil_run(session, kid, run_id)
        if run.status != "posted":
            raise _Gagal(f"Only posted batches can be reversed ({run.run_no} is {run.status}).", kode="CONFLICT", status_code=409)
        lebih_baru = session.query(RUN).filter(RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status == "posted",
                                               RUN.period > run.period).first()
        if lebih_baru is not None:
            raise _Gagal(f"Reverse the later batch {lebih_baru.run_no} first.", kode="CONFLICT", status_code=409)
        tgl = payload.reversal_date or run.posting_date
        alasan = payload.reason.strip()
        for j in session.query(JR).filter(JR.depreciation_run_id == run.id, JR.status == "posted").all():
            _balik_jurnal(session, j, tgl, alasan, current_user)
        waktu = _sekarang()
        run.status, run.reversal_date, run.reversal_reason = "reversed", tgl, alasan
        run.reversed_at, run.reversed_by, run.reversed_by_name = waktu, current_user.get("id"), _nama(current_user)
        session.flush()
        return _detail_run(session, run)
    return _respon(aksi, "Depreciation batch reversed.")


# ============================================================
# ENDPOINT -- DISPOSAL
# ============================================================

def _disposal_dict(d: Any, r: Any, akun: Dict[str, Any], b: Optional[Buku] = None) -> Dict[str, Any]:
    nbv = _dec(d.nbv_at_disposal) if d.nbv_at_disposal is not None else None
    biaya = _dec(d.cost_at_disposal) if d.cost_at_disposal is not None else None
    akum = _dec(d.accumulated_at_disposal) if d.accumulated_at_disposal is not None else None
    if nbv is None and b is not None:
        a = b.per_id().get(d.asset_id)
        if a is not None:
            biaya, akum = a.biaya(d.disposal_date), a.akumulasi(d.disposal_date)
            nbv = biaya - akum
    hasil = _dec(d.proceeds)
    return {
        "id": d.id, "disposal_no": d.disposal_no, "asset_id": d.asset_id,
        "asset_code": r.asset_code if r is not None else None, "asset_name": r.name if r is not None else None,
        "category": r.category if r is not None else None, "disposal_date": d.disposal_date, "method": d.method,
        "reason": d.reason, "counterparty": d.counterparty, "proceeds": _f(hasil),
        "cost": _f(biaya) if biaya is not None else None, "accumulated": _f(akum) if akum is not None else None,
        "net_book_value": _f(nbv) if nbv is not None else None,
        "gain_loss": _f(d.gain_loss) if d.gain_loss is not None else (_f(hasil - nbv) if nbv is not None else None),
        "values_final": d.nbv_at_disposal is not None,
        "proceeds_account": _akun_ringkas(akun.get(d.proceeds_coa_id)), "gain_loss_account": _akun_ringkas(akun.get(d.gain_loss_coa_id)),
        "proceeds_coa_id": d.proceeds_coa_id, "gain_loss_coa_id": d.gain_loss_coa_id,
        "status": d.status, "journal_id": d.journal_id, "rejected_reason": d.rejected_reason,
        "created_by_name": d.created_by_name, "created_at": d.created_at, "submitted_at": d.submitted_at,
        "approved_by_name": d.approved_by_name, "approved_at": d.approved_at,
        "posted_by_name": d.posted_by_name, "posted_at": d.posted_at,
        "reversal_date": d.reversal_date, "reversal_reason": d.reversal_reason, "reversed_by_name": d.reversed_by_name,
    }


def _nomor_disposal(session, kid: str, tanggal: date) -> str:
    awalan = f"DSP-{tanggal.year}-"
    nomor = [n for (n,) in session.query(DSP.disposal_no).filter(DSP.client_id == kid, DSP.disposal_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:03d}"


def _ambil_disposal(session, kid: str, did: Any) -> Any:
    d = session.get(DSP, str(did))
    if d is None or d.deleted_at is not None or str(d.client_id) != kid:
        raise _Gagal("Disposal not found.", kode="NOT_FOUND", status_code=404)
    return d


@router.get("/disposals", summary="Tab Disposal: KPI, antrean, per alasan, daftar transaksi")
def ringkasan_disposal(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                       _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        b = _muat(session, kid)
        aset = {a.id: a.row for a in b.aset}
        for r in session.query(FA).filter(FA.client_id == kid, FA.deleted_at.isnot(None)).all():
            aset.setdefault(r.id, r)
        semua = session.query(DSP).filter(DSP.client_id == kid, DSP.deleted_at.is_(None)).order_by(DSP.disposal_date.desc(), DSP.disposal_no.desc()).all()
        daftar = [_disposal_dict(d, aset.get(d.asset_id), b.akun, b) for d in semua]
        posted = [x for x in daftar if x["status"] == "posted"]

        def tahun(x, th, sampai):
            return x["disposal_date"].year == th and x["disposal_date"] <= sampai

        lalu = per.replace(year=per.year - 1, day=min(per.day, 28))
        ini = [x for x in posted if tahun(x, per.year, per)]
        dulu = [x for x in posted if tahun(x, per.year - 1, lalu)]
        alasan: Dict[str, int] = {}
        for x in ini:
            alasan[x["method"]] = alasan.get(x["method"], 0) + 1
        antre = [x for x in daftar if x["status"] in ("draft", "pending", "approved")]
        return {
            "as_of": per,
            "kpi": {
                "pending": len(antre), "pending_value": _f(sum((Decimal(str(x["net_book_value"] or 0)) for x in antre), NOL)),
                "disposed_ytd": len(ini), "disposed_prev_ytd": len(dulu),
                "proceeds_ytd": _f(sum((Decimal(str(x["proceeds"])) for x in ini), NOL)),
                "proceeds_prev_ytd": _f(sum((Decimal(str(x["proceeds"])) for x in dulu), NOL)),
                "gain_loss_ytd": _f(sum((Decimal(str(x["gain_loss"] or 0)) for x in ini), NOL)),
                "gain_loss_prev_ytd": _f(sum((Decimal(str(x["gain_loss"] or 0)) for x in dulu), NOL)),
            },
            "queue": sorted(antre, key=lambda x: x["disposal_date"]),
            "by_reason": [{"method": m, "count": n} for m, n in sorted(alasan.items(), key=lambda t: -t[1])],
            "disposals": daftar,
        }
    return _respon(aksi)


class DisposalRequest(BaseModel):
    client_id: UUID
    asset_id: UUID
    disposal_date: date
    method: Literal["sold", "scrapped", "lost", "transferred", "donated"]
    reason: Optional[str] = Field(None, max_length=2000)
    counterparty: Optional[str] = Field(None, max_length=255)
    proceeds: float = Field(0, ge=0)
    proceeds_coa_id: Optional[UUID] = None
    gain_loss_coa_id: Optional[UUID] = None
    submit: bool = False


def _isi_disposal(session, kid: str, p: DisposalRequest, user: Dict[str, Any], d: Any = None) -> Any:
    r = _ambil_aset(session, kid, p.asset_id)
    if r.status == "disposed":
        raise _Gagal(f"Asset {r.asset_code} is already disposed.", kode="CONFLICT", status_code=409)
    lain = session.query(DSP).filter(DSP.asset_id == r.id, DSP.deleted_at.is_(None), DSP.status.notin_(("reversed", "rejected")))
    if d is not None:
        lain = lain.filter(DSP.id != d.id)
    if (x := lain.first()) is not None:
        raise _Gagal(f"Asset {r.asset_code} already has disposal {x.disposal_no} ({x.status}).", kode="CONFLICT", status_code=409)
    if r.purchase_date and p.disposal_date < r.purchase_date:
        raise _Gagal("The disposal date cannot be earlier than the acquisition date.")
    hasil = Decimal(str(p.proceeds))
    if hasil > 0 and not p.proceeds_coa_id:
        raise _Gagal("Choose the account that receives the proceeds (cash/bank or receivable).")
    _akun_opsional(session, kid, p.proceeds_coa_id)
    _akun_opsional(session, kid, p.gain_loss_coa_id)
    nilai = dict(asset_id=r.id, disposal_date=p.disposal_date, method=p.method, reason=_teks(p.reason),
                 counterparty=_teks(p.counterparty), proceeds=_bulat(hasil),
                 proceeds_coa_id=str(p.proceeds_coa_id) if p.proceeds_coa_id else None,
                 gain_loss_coa_id=str(p.gain_loss_coa_id) if p.gain_loss_coa_id else None)
    if d is None:
        d = DSP(client_id=kid, disposal_no=_nomor_disposal(session, kid, p.disposal_date), status="draft",
                created_by=user.get("id"), created_by_name=_nama(user), **nilai)
        session.add(d)
    else:
        if d.status not in ("draft", "pending", "rejected"):
            raise _Gagal(f"{d.disposal_no} is {d.status} and can no longer be edited.", kode="CONFLICT", status_code=409)
        for k, v in nilai.items():
            setattr(d, k, v)
        d.status, d.rejected_reason = "draft", None
        d.edited_at, d.edited_by = _sekarang(), user.get("id")
    if p.submit:
        d.status, d.submitted_at = "pending", _sekarang()
    session.flush()
    return d


def _respon_disposal(session, kid: str, d: Any) -> Dict[str, Any]:
    b = _muat(session, kid)
    return {**_disposal_dict(d, session.get(FA, d.asset_id), b.akun, b), "journal": _preview_disposal(session, kid, d, b)}


@router.post("/disposals", summary="Buat disposal (draft / submit pending, Supervisor+)")
def buat_disposal(payload: DisposalRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci_klien(session, kid)
        return _respon_disposal(session, kid, _isi_disposal(session, kid, payload, current_user))
    return _respon(aksi, "Disposal submitted for approval." if payload.submit else "Disposal saved as draft.")


@router.put("/disposals/{disposal_id}", summary="Ubah disposal draft/pending/rejected (Supervisor+)")
def ubah_disposal(disposal_id: UUID, payload: DisposalRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        d = _isi_disposal(session, kid, payload, current_user, _ambil_disposal(session, kid, disposal_id))
        return _respon_disposal(session, kid, d)
    return _respon(aksi, "Disposal updated.")


@router.get("/disposals/{disposal_id}", summary="Detail disposal + preview jurnal")
def detail_disposal(disposal_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: _respon_disposal(session, kid, _ambil_disposal(session, kid, disposal_id)))


@router.delete("/disposals/{disposal_id}", summary="Hapus disposal yang belum diposting (Supervisor+)")
def hapus_disposal(disposal_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        d = _ambil_disposal(session, kid, disposal_id)
        if d.status in ("posted", "reversed"):
            raise _Gagal("Posted disposals cannot be deleted. Reverse it instead.", kode="CONFLICT", status_code=409)
        d.deleted_at, d.deleted_by = _sekarang(), current_user.get("id")
        return {"id": d.id}
    return _respon(aksi, "Disposal deleted.")


def _baris_disposal(session, kid: str, d: Any, b: Buku) -> Tuple[List[Tuple[Any, Decimal, Decimal, str]], Dict[str, Decimal]]:
    a = b.per_id().get(d.asset_id)
    if a is None:
        raise _Gagal("The asset of this disposal no longer exists.")
    tgl = d.disposal_date
    biaya, akum = a.biaya(tgl), a.akumulasi(tgl)
    nbv = biaya - akum
    hasil = _dec(d.proceeds)
    laba = hasil - nbv
    akun_aset = _akun_opsional(session, kid, a.akun("asset"))
    akun_akum = _akun_opsional(session, kid, a.akun("accum"))
    akun_hasil = _akun_opsional(session, kid, d.proceeds_coa_id)
    akun_laba = _akun_opsional(session, kid, d.gain_loss_coa_id)
    kurang = []
    if akun_aset is None:
        kurang.append("asset account")
    if akum > 0 and akun_akum is None:
        kurang.append("accumulated depreciation account")
    if hasil > 0 and akun_hasil is None:
        kurang.append("proceeds account")
    if abs(laba) > TOL and akun_laba is None:
        kurang.append("gain/loss on disposal account")
    if kurang:
        raise _Gagal("Missing " + ", ".join(kurang) + " for this disposal.")
    ket = f"Disposal ({d.method}) {a.row.asset_code} {a.row.name}"
    baris = [(akun_akum, akum, NOL, ket), (akun_hasil, hasil, NOL, ket)]
    if laba < 0:
        baris.append((akun_laba, -laba, NOL, f"Loss on disposal {a.row.asset_code}"))
    elif laba > 0:
        baris.append((akun_laba, NOL, laba, f"Gain on disposal {a.row.asset_code}"))
    baris.append((akun_aset, NOL, biaya, ket))
    return [x for x in baris if x[0] is not None], {"cost": biaya, "accumulated": akum, "nbv": nbv, "gain_loss": laba}


def _preview_disposal(session, kid: str, d: Any, b: Buku) -> Dict[str, Any]:
    if d.journal_id:
        j = session.get(JR, d.journal_id)
        if j is not None:
            return {"posted": True, "journal_no": j.journal_no, "error": None,
                    "lines": [{"account_code": l.account_code, "account_name": l.account_name, "debit": _f(l.debit), "credit": _f(l.credit)}
                              for l in session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all()]}
    try:
        baris, _ = _baris_disposal(session, kid, d, b)
    except _Gagal as e:
        return {"posted": False, "journal_no": None, "error": e.message, "lines": []}
    return {"posted": False, "journal_no": None, "error": None,
            "lines": [{"account_code": a.acc_no, "account_name": a.account_name, "debit": _f(dd), "credit": _f(k)}
                      for a, dd, k, _ in baris if _bulat(dd) or _bulat(k)]}


def _aksi_disposal(disposal_id: UUID, kid: str, user: Dict[str, Any], dari: Tuple[str, ...], ke: str, pesan: str,
                   alasan: Optional[str] = None, tanggal: Optional[date] = None):
    def aksi(session):
        _kunci_klien(session, kid)
        d = _ambil_disposal(session, kid, disposal_id)
        if d.status not in dari:
            raise _Gagal(f"{d.disposal_no} is {d.status}.", kode="CONFLICT", status_code=409)
        waktu = _sekarang()
        r = session.get(FA, d.asset_id)
        if ke == "pending":
            d.status, d.submitted_at = "pending", waktu
        elif ke == "approved":
            d.status, d.approved_at, d.approved_by, d.approved_by_name = "approved", waktu, user.get("id"), _nama(user)
        elif ke == "rejected":
            d.status, d.rejected_reason = "rejected", alasan
        elif ke == "posted":
            b = _muat(session, kid)
            belum = session.query(RUN).filter(RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status.in_(("draft", "approved")),
                                              RUN.period <= d.disposal_date).join(RL, RL.run_id == RUN.id).filter(RL.asset_id == d.asset_id).first()
            if belum is not None:
                raise _Gagal(f"Post or delete depreciation batch {belum.run_no} (it includes this asset) before posting the disposal.",
                             kode="CONFLICT", status_code=409)
            lebih_baru = session.query(JR).filter(JR.asset_id == d.asset_id, JR.status == "posted", JR.journal_date > d.disposal_date).first()
            if lebih_baru is not None:
                raise _Gagal(f"Journal {lebih_baru.journal_no} for this asset is dated after the disposal date. Reverse it first.",
                             kode="CONFLICT", status_code=409)
            baris, angka = _baris_disposal(session, kid, d, b)
            j = _tulis_jurnal(session, kid, user, jenis="disposal", tanggal=d.disposal_date, asset_id=d.asset_id, baris=baris,
                              reference=d.disposal_no, description=f"Disposal of {r.asset_code} - {r.name} ({d.method})",
                              disposal_id=d.id)
            d.cost_at_disposal, d.accumulated_at_disposal = _bulat(angka["cost"]), _bulat(angka["accumulated"])
            d.nbv_at_disposal, d.gain_loss = _bulat(angka["nbv"]), _bulat(angka["gain_loss"])
            d.journal_id = j.id
            d.status, d.posted_at, d.posted_by, d.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
            if not d.approved_at:
                d.approved_at, d.approved_by, d.approved_by_name = waktu, user.get("id"), _nama(user)
            r.status, r.disposal_date, r.disposal_value = "disposed", d.disposal_date, d.proceeds
            r.updated_at = waktu
        elif ke == "reversed":
            tgl = tanggal or d.disposal_date
            j = session.get(JR, d.journal_id) if d.journal_id else None
            if j is not None:
                _balik_jurnal(session, j, tgl, alasan or "", user)
            d.status, d.reversal_date, d.reversal_reason = "reversed", tgl, alasan
            d.reversed_at, d.reversed_by, d.reversed_by_name = waktu, user.get("id"), _nama(user)
            r.status, r.disposal_date, r.disposal_value = "active", None, None
            r.updated_at = waktu
        d.edited_at, d.edited_by = waktu, user.get("id")
        session.flush()
        return _respon_disposal(session, kid, d)
    return _respon(aksi, pesan)


@router.post("/disposals/{disposal_id}/submit", summary="Ajukan disposal untuk approval (Supervisor+)")
def submit_disposal(disposal_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_disposal(disposal_id, str(payload.client_id), current_user, ("draft", "rejected"), "pending", "Disposal submitted for approval.")


@router.post("/disposals/{disposal_id}/approve", summary="Approve disposal (Manager+)")
def approve_disposal(disposal_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_disposal(disposal_id, str(payload.client_id), current_user, ("pending",), "approved", "Disposal approved.")


class TolakRequest(BaseModel):
    client_id: UUID
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/disposals/{disposal_id}/reject", summary="Tolak disposal (Manager+)")
def tolak_disposal(disposal_id: UUID, payload: TolakRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_disposal(disposal_id, str(payload.client_id), current_user, ("pending", "approved"), "rejected",
                          "Disposal rejected.", alasan=payload.reason.strip())


@router.post("/disposals/{disposal_id}/post", summary="Post disposal -> jurnal FA disposal, aset jadi disposed (Manager+)")
def post_disposal(disposal_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_disposal(disposal_id, str(payload.client_id), current_user, ("approved", "pending"), "posted", "Disposal posted.")


@router.post("/disposals/{disposal_id}/reverse", summary="Balik disposal posted, aset kembali aktif (Manager+)")
def balik_disposal(disposal_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_disposal(disposal_id, str(payload.client_id), current_user, ("posted",), "reversed", "Disposal reversed.",
                          alasan=payload.reason.strip(), tanggal=payload.reversal_date)


# ============================================================
# ENDPOINT -- POSTED (jurnal)
# ============================================================

@router.get("/journals", summary="Tab Posted: jurnal FA + KPI")
def daftar_jurnal(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
                  as_of: Optional[date] = Query(None), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date_to or date.today()

    def aksi(session):
        aset = {r.id: r for r in session.query(FA).filter(FA.client_id == kid).all()}
        q = session.query(JR).filter(JR.client_id == kid)
        if date_from:
            q = q.filter(JR.journal_date >= date_from)
        if date_to:
            q = q.filter(JR.journal_date <= date_to)
        daftar = q.order_by(JR.journal_date.desc(), JR.journal_no.desc()).all()
        semua = session.query(JR).filter(JR.client_id == kid).all()
        lalu = per.replace(year=per.year - 1, day=min(per.day, 28))
        bulan = _awal_bulan(per)
        bulan_lalu = _tambah_bulan(bulan, -1)

        def hit(pred) -> int:
            return sum(1 for j in semua if pred(j))

        def jumlah(jenis: str, th: int, sampai: date) -> float:
            return _f(sum((_dec(j.amount) for j in semua if j.journal_type == jenis and j.status == "posted"
                           and j.journal_date.year == th and j.journal_date <= sampai), NOL))

        hasil = []
        for j in daftar:
            r = aset.get(j.asset_id)
            d = _jurnal_dict(j, aset=r)
            d["category"] = r.category if r is not None else None
            hasil.append(d)
        return {
            "kpi": {
                "entries_ytd": hit(lambda j: j.journal_date.year == per.year and j.journal_date <= per),
                "entries_prev_ytd": hit(lambda j: j.journal_date.year == per.year - 1 and j.journal_date <= lalu),
                "entries_month": hit(lambda j: bulan <= j.journal_date <= per),
                "entries_prev_month": hit(lambda j: bulan_lalu <= j.journal_date <= _akhir_bulan(bulan_lalu)),
                "depreciation_ytd": jumlah("depreciation", per.year, per), "depreciation_prev_ytd": jumlah("depreciation", per.year - 1, lalu),
                "disposals_ytd": jumlah("disposal", per.year, per), "disposals_prev_ytd": jumlah("disposal", per.year - 1, lalu),
            },
            "journals": hasil,
        }
    return _respon(aksi)


@router.get("/journals/{journal_id}", summary="Detail jurnal FA + baris")
def detail_jurnal(journal_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        j = session.get(JR, str(journal_id))
        if j is None or str(j.client_id) != kid:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        r = session.get(FA, j.asset_id) if j.asset_id else None
        d = _jurnal_dict(j, session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all(), r)
        d["category"] = r.category if r is not None else None
        return d
    return _respon(aksi)


@router.post("/journals/{journal_id}/reverse", summary="Balik jurnal acquisition / adjustment (Manager+)")
def balik_jurnal(journal_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        j = session.get(JR, str(journal_id))
        if j is None or str(j.client_id) != kid:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        if j.journal_type == "depreciation":
            raise _Gagal("Depreciation journals are reversed per batch (Depreciation tab).", kode="CONFLICT", status_code=409)
        if j.journal_type == "disposal":
            raise _Gagal("Disposal journals are reversed from the Disposal tab.", kode="CONFLICT", status_code=409)
        r = session.get(FA, j.asset_id) if j.asset_id else None
        if r is not None and r.status == "disposed":
            raise _Gagal("Reverse the disposal of this asset first.", kode="CONFLICT", status_code=409)
        _balik_jurnal(session, j, payload.reversal_date or date.today(), payload.reason.strip(), current_user)
        if r is not None and r.acquisition_journal_id == j.id:
            r.acquisition_journal_id = None
        return _jurnal_dict(j, session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all(), r)
    return _respon(aksi, "Journal reversed.")


# ============================================================
# ENDPOINT -- REPORTS
# ============================================================

def _saring(branch: Optional[str], category_id: Optional[str], location: Optional[str]):
    def f(a: Aset) -> bool:
        r = a.row
        return ((not branch or (r.branch or "") == branch) and (not category_id or r.category_id == category_id)
                and (not location or (r.location or "") == location))
    return f


@router.get("/reports", summary="Tab Reports: KPI, nilai buku per kategori, opsi filter, riwayat laporan")
def ringkasan_laporan(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
                      branch: Optional[str] = Query(None), category_id: Optional[UUID] = Query(None), location: Optional[str] = Query(None),
                      _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    sampai = date_to or date.today()
    dari = date_from or date(sampai.year, 1, 1)

    def aksi(session):
        b = _muat(session, kid)
        f = _saring(branch, str(category_id) if category_id else None, location)
        aset = [a for a in b.aset if f(a)]
        bulan = _awal_bulan(sampai)
        susut = lambda m: sum((j.nominal for a in aset for j in a.jurnal if j.jenis == "depreciation"
                               and m <= j.tanggal <= _akhir_bulan(m) and j.efektif(sampai)), NOL)
        lepas = lambda d1, d2: sum(1 for a in aset if a.tanggal_lepas and d1 <= a.tanggal_lepas <= d2 and a.dilepas(sampai))
        lalu_dari, lalu_sampai = dari.replace(year=dari.year - 1, day=min(dari.day, 28)), sampai.replace(year=sampai.year - 1, day=min(sampai.day, 28))
        log = session.query(LOG).filter(LOG.client_id == kid).order_by(LOG.created_at.desc()).limit(20).all()
        return {
            "period": {"from": dari, "to": sampai},
            "kpi": {
                "categories": len({a.row.category_id for a in aset if a.ada(sampai) and not a.dilepas(sampai)}),
                "nbv": _f(sum((a.nbv(sampai) for a in aset), NOL)), "nbv_prev": _f(sum((a.nbv(lalu_sampai) for a in aset), NOL)),
                "monthly_depreciation": _f(susut(bulan)), "monthly_depreciation_prev": _f(susut(_tambah_bulan(bulan, -1))),
                "disposals": lepas(dari, sampai), "disposals_prev": lepas(lalu_dari, lalu_sampai),
            },
            "nbv_by_category": _per_kategori(b, sampai, f),
            "options": {
                "branches": sorted({a.row.branch for a in b.aset if a.row.branch}),
                "locations": sorted({a.row.location for a in b.aset if a.row.location}),
                "categories": [{"id": c.id, "name": c.name} for c in sorted(b.kategori.values(), key=lambda c: c.name) if c.deleted_at is None],
            },
            "recent": [{"id": l.id, "report_type": l.report_type, "period_from": l.period_from, "period_to": l.period_to,
                        "format": l.file_format, "row_count": l.row_count, "created_at": l.created_at,
                        "created_by_name": l.created_by_name, "filters": l.filters} for l in log],
        }
    return _respon(aksi)


def _laporan(b: Buku, jenis: str, dari: date, sampai: date, f) -> Dict[str, Any]:
    aset = [a for a in b.aset if f(a)]
    kemarin = dari - timedelta(days=1)
    if jenis == "asset_register":
        rows = [_aset_dict(b, a, sampai) for a in aset if a.ada(sampai)]
        return {"rows": rows}
    if jenis == "near_end_of_life":
        rows = [_aset_dict(b, a, sampai) for a in aset if _status_tampil(a, sampai) in ("near_end_of_life", "fully_depreciated")
                and a.ada(sampai) and not a.dilepas(sampai)]
        return {"rows": sorted(rows, key=lambda r: r["remaining_life_months"] or 0)}
    if jenis == "depreciation_schedule":
        bulan = []
        m = _awal_bulan(dari)
        while m <= sampai and len(bulan) < 36:
            bulan.append(m)
            m = _tambah_bulan(m, 1)
        rows = []
        for a in aset:
            if not a.ada(sampai):
                continue
            per_bulan = []
            for m in bulan:
                akhir = min(_akhir_bulan(m), sampai)
                per_bulan.append(_f(sum((j.nominal for j in a.jurnal if j.jenis == "depreciation" and m <= j.tanggal <= akhir and j.efektif(sampai)), NOL)))
            total = sum(per_bulan)
            if not total and (a.metode == "none" or a.dilepas(kemarin)):
                continue
            rows.append({"asset_code": a.row.asset_code, "name": a.row.name, "category": a.kategori.name if a.kategori is not None else None,
                         "method": a.metode, "useful_life_months": a.umur, "cost": _f(a.biaya(sampai)),
                         "opening_accumulated": _f(a.akumulasi(kemarin) if a.ada(kemarin) else _dec(a.row.opening_accumulated_depreciation)),
                         "months": per_bulan, "total": total, "closing_accumulated": _f(a.akumulasi(sampai)), "nbv": _f(a.nbv(sampai))})
        return {"months": [m.strftime("%Y-%m") for m in bulan], "rows": rows}
    if jenis == "asset_movement":
        grup: Dict[str, Dict[str, Decimal]] = {}
        detail = []
        for a in aset:
            nama = a.kategori.name if a.kategori is not None else "Uncategorized"
            g = grup.setdefault(nama, {k: NOL for k in ("opening_cost", "additions", "adjustments", "disposals", "closing_cost",
                                                        "opening_accum", "depreciation", "accum_disposed", "accum_adjust", "closing_accum")})
            awal = a.ada(kemarin) and not a.dilepas(kemarin)
            akhir = a.ada(sampai) and not a.dilepas(sampai)
            tambah = _dec(a.row.cost) if a.row.purchase_date and dari <= a.row.purchase_date <= sampai else NOL
            adj_b = sum((j.biaya for j in a.jurnal if j.jenis == "adjustment" and dari <= j.tanggal <= sampai and j.efektif(sampai)), NOL)
            adj_a = sum((j.akumulasi for j in a.jurnal if j.jenis == "adjustment" and dari <= j.tanggal <= sampai and j.efektif(sampai)), NOL)
            dep = sum((j.akumulasi for j in a.jurnal if j.jenis == "depreciation" and dari <= j.tanggal <= sampai and j.efektif(sampai)), NOL)
            dilepas_periode = a.dilepas(sampai) and not a.dilepas(kemarin)
            nilai = {
                "opening_cost": a.biaya(kemarin) if awal else NOL, "additions": tambah, "adjustments": adj_b,
                "disposals": a.biaya(a.tanggal_lepas) if dilepas_periode else NOL,
                "closing_cost": a.biaya(sampai) if akhir else NOL,
                "opening_accum": a.akumulasi(kemarin) if awal else NOL, "depreciation": dep, "accum_adjust": adj_a,
                "accum_disposed": a.akumulasi(a.tanggal_lepas) if dilepas_periode else NOL,
                "closing_accum": a.akumulasi(sampai) if akhir else NOL,
            }
            if tambah and a.ada(sampai):
                # Akumulasi awal aset yang diperoleh di periode ini masuk sebagai bagian dari penambahan.
                nilai["opening_accum"] += _dec(a.row.opening_accumulated_depreciation) if not awal else NOL
            for k, v in nilai.items():
                g[k] += v
            if any(nilai[k] for k in ("additions", "adjustments", "disposals", "depreciation", "accum_adjust")):
                detail.append({"asset_code": a.row.asset_code, "name": a.row.name, "category": nama,
                               **{k: _f(v) for k, v in nilai.items()}})
        rows = [{"category": k, **{kk: _f(vv) for kk, vv in v.items()}} for k, v in sorted(grup.items())]
        return {"rows": rows, "details": detail}
    if jenis == "disposal":
        rows = []
        for a in aset:
            for j in a.jurnal:
                if j.jenis == "disposal" and dari <= j.tanggal <= sampai and j.efektif(sampai):
                    rows.append({"asset_id": a.id, "journal_no": j.no, "asset_code": a.row.asset_code, "name": a.row.name,
                                 "category": a.kategori.name if a.kategori is not None else None, "disposal_date": j.tanggal})
        return {"rows": rows}
    if jenis == "nbv_summary":
        def ringkas(kunci) -> List[Dict[str, Any]]:
            g: Dict[str, Dict[str, Any]] = {}
            for a in aset:
                if not a.ada(sampai) or a.dilepas(sampai):
                    continue
                k = kunci(a) or "—"
                x = g.setdefault(k, {"group": k, "count": 0, "cost": NOL, "accumulated": NOL, "nbv": NOL})
                x["count"] += 1
                x["cost"] += a.biaya(sampai)
                x["accumulated"] += a.akumulasi(sampai)
                x["nbv"] += a.nbv(sampai)
            return [{**x, "cost": _f(x["cost"]), "accumulated": _f(x["accumulated"]), "nbv": _f(x["nbv"])}
                    for x in sorted(g.values(), key=lambda x: -x["nbv"])]
        return {"by_category": ringkas(lambda a: a.kategori.name if a.kategori is not None else "Uncategorized"),
                "by_location": ringkas(lambda a: a.row.location), "by_branch": ringkas(lambda a: a.row.branch)}
    raise _Gagal("Unknown report type.")


@router.get("/reports/{report_type}", summary="Data 1 laporan Fixed Assets (register, schedule, movement, disposal, NBV, near end)")
def data_laporan(report_type: str, client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
                 branch: Optional[str] = Query(None), category_id: Optional[UUID] = Query(None), location: Optional[str] = Query(None),
                 _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    sampai = date_to or date.today()
    dari = date_from or date(sampai.year, 1, 1)
    if report_type not in JENIS_LAPORAN:
        return bc._respon_gagal(_Gagal("Unknown report type.", kode="NOT_FOUND", status_code=404))
    if dari > sampai:
        return bc._respon_gagal(_Gagal("The start date must be on or before the end date."))

    def aksi(session):
        b = _muat(session, kid)
        data = _laporan(b, report_type, dari, sampai, _saring(branch, str(category_id) if category_id else None, location))
        if report_type == "disposal":
            per_jurnal = {d.journal_id: d for d in session.query(DSP).filter(DSP.client_id == kid, DSP.status == "posted").all()}
            per_no = {j.journal_no: j.id for j in session.query(JR).filter(JR.client_id == kid, JR.journal_type == "disposal").all()}
            rows = []
            for x in data["rows"]:
                d = per_jurnal.get(per_no.get(x["journal_no"]))
                rows.append({**x, "disposal_no": d.disposal_no if d else None, "method": d.method if d else None,
                             "counterparty": d.counterparty if d else None, "reason": d.reason if d else None,
                             "cost": _f(d.cost_at_disposal) if d else None, "accumulated": _f(d.accumulated_at_disposal) if d else None,
                             "net_book_value": _f(d.nbv_at_disposal) if d else None, "proceeds": _f(d.proceeds) if d else None,
                             "gain_loss": _f(d.gain_loss) if d else None})
            data["rows"] = rows
        klien = dbc.get_management_client_by_id(kid) or {}
        return {"report_type": report_type, "period": {"from": dari, "to": sampai},
                "client_name": klien.get("nama_client") or klien.get("name") or "", **data}
    return _respon(aksi)


class LogLaporanRequest(BaseModel):
    client_id: UUID
    report_type: Literal["asset_register", "depreciation_schedule", "asset_movement", "disposal", "nbv_summary", "near_end_of_life"]
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    format: Literal["pdf", "xlsx", "csv"]
    row_count: Optional[int] = Field(None, ge=0)
    filters: Optional[Dict[str, Any]] = None


@router.post("/reports/log", summary="Catat laporan yang di-generate (Recent Generated Reports)")
def catat_laporan(payload: LogLaporanRequest, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        l = LOG(client_id=kid, report_type=payload.report_type, period_from=payload.period_from, period_to=payload.period_to,
                file_format=payload.format, row_count=payload.row_count, filters=payload.filters,
                created_by=current_user.get("id"), created_by_name=_nama(current_user))
        session.add(l)
        session.flush()
        return {"id": l.id}
    return _respon(aksi, "Report logged.")
