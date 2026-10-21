"""
modules/assets_and_equity/inventory_v1.py
=========================================
Inventory (grup sidebar Assets & Equity), UI dataset/picture/Template
UI/Inventory/1-8.jpeg -- tab Overview, Item List, Stock Movement,
Adjustments, Transfer, Reports. Semua endpoint di /api/v1/asset/inventory/...
Tabel: migrations/40-create_inventory_tables.py.

Alur:
    master      gudang, kategori (akun persediaan / HPP / selisih), item
    dokumen     opening | receipt | issue | adjustment | transfer
                draft (Supervisor+) -> posted (Manager+) -> void (Manager+)
    kartu stok  asset_inventory_movements, ditulis saat dokumen diposting;
                void = movement pembalik di void_date (riwayat tetap utuh)
    biaya       rata-rata bergerak per item (semua gudang); barang keluar
                dinilai rata-rata per tanggal dokumen

Integrasi:
    Purchase posted  -> Receipt (source purchase): item dicocokkan dari
                        item_code / deskripsi baris purchase, biaya = (subtotal -
                        diskon) / qty. TANPA jurnal default -- Purchase sudah
                        mendebit akun barisnya (hindari dobel).
    Sales posted     -> Issue (source sales): dari baris invoice (Create Invoice);
                        jurnal HPP opsional Dr HPP / Cr persediaan.
    GL / FS          -> jurnal INV-YYYY-#### dibaca sebagai sumber "inventory"
                        (db_client.ambil_baris_jurnal_posted_transaksi).
    Year-End Closing -> trigger kunci periode di tabel jurnal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, Iterable, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..api_response import sukses
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_v1 as bc

logger = get_module_logger("asset_inventory_v1")

router = APIRouter(prefix="/api/v1/asset/inventory", tags=["inventory"])

LEVEL_INPUT = bc.LEVEL_INPUT
LEVEL_POST = bc.LEVEL_POST
NOL = Decimal("0")
SEN = Decimal("0.01")
QTY = Decimal("0.0001")
_Gagal = bc._Gagal
_f = bc._f
_nama = bc._nama
_sekarang = bc._sekarang

WH = dbc.InventoryWarehouse
CAT = dbc.InventoryCategory
IT = dbc.InventoryItem
DOC = dbc.InventoryDocument
DL = dbc.InventoryDocumentLine
MV = dbc.InventoryMovement
JR = dbc.InventoryJournal
JL = dbc.InventoryJournalLine
COA = dbc.ManagementClientCoa
PT = dbc.PurchaseTransaction
PTL = dbc.PurchaseTransactionLine
SI = dbc.SalesInvoice
SIL = dbc.SalesInvoiceLine

JENIS_DOK = ("opening", "receipt", "issue", "adjustment", "transfer")
AWALAN = {"opening": "OB", "receipt": "GR", "issue": "GI", "adjustment": "ADJ", "transfer": "TRF"}
ALASAN = ("stock_count", "damaged", "expired", "lost", "production_variance", "system_correction", "other")
JENIS_LAPORAN = ("stock_summary", "stock_card", "stock_aging", "valuation", "category_summary", "movement", "adjustment",
                 "transfer", "low_stock")


def _q(v: Any) -> Decimal:
    if v is None:
        return NOL
    return Decimal(str(v)).quantize(QTY)


def _d(v: Any) -> Decimal:
    return bc._dec(v)


def _uang(v: Decimal) -> Decimal:
    return v.quantize(SEN, rounding=ROUND_HALF_UP)


def _fq(v: Any) -> float:
    return round(float(v or 0), 4) + 0.0


def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _norm(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().upper())


def _kunci_klien(session, kid: str) -> None:
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"inventory:{kid}"})


def _respon(fn, pesan: str = "OK"):
    return bc._respon(fn, pesan)


def _akun_opsional(session, kid: str, coa_id: Any) -> Any:
    return bc._akun(session, kid, str(coa_id)) if coa_id else None


def _akun_ringkas(a: Any) -> Optional[Dict[str, Any]]:
    return {"id": a.id, "code": a.acc_no, "name": a.account_name} if a is not None else None


def _peta_akun(session, kid: str) -> Dict[str, Any]:
    return {a.id: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}


def _akhir_bulan(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _tambah_bulan(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


# ============================================================
# MESIN STOK (kartu stok -> saldo, rata-rata)
# ============================================================

@dataclass
class Mv:
    id: str
    item: str
    wh: str
    tanggal: date
    jenis: str
    doc_id: str
    ref: str
    sumber: Optional[str]
    qin: Decimal
    qout: Decimal
    vin: Decimal
    vout: Decimal
    harga: Decimal
    balik: bool
    urut: Any


def _muat_mv(session, kid: str, sampai: Optional[date] = None, items: Optional[Iterable[str]] = None) -> List[Mv]:
    q = session.query(MV).filter(MV.client_id == kid)
    if sampai:
        q = q.filter(MV.movement_date <= sampai)
    if items is not None:
        ids = list(items)
        if not ids:
            return []
        q = q.filter(MV.item_id.in_(ids))
    return [Mv(id=m.id, item=m.item_id, wh=m.warehouse_id, tanggal=m.movement_date, jenis=m.movement_type, doc_id=m.document_id,
               ref=m.reference_no, sumber=m.source_ref, qin=_q(m.qty_in), qout=_q(m.qty_out), vin=_d(m.value_in), vout=_d(m.value_out),
               harga=_d(m.unit_cost), balik=bool(m.is_reversal), urut=m.created_at)
            for m in q.order_by(MV.movement_date, MV.created_at).all()]


@dataclass
class Saldo:
    qty: Decimal = NOL
    nilai: Decimal = NOL

    @property
    def rata(self) -> Decimal:
        return (self.nilai / self.qty) if self.qty > 0 else NOL


def _saldo(mvs: List[Mv], per: Optional[date] = None) -> Tuple[Dict[str, Saldo], Dict[Tuple[str, str], Decimal]]:
    """(saldo per item {qty, nilai}, qty per (item, gudang)) per tanggal `per` (inklusif)."""
    item: Dict[str, Saldo] = {}
    gudang: Dict[Tuple[str, str], Decimal] = {}
    for m in mvs:
        if per and m.tanggal > per:
            continue
        s = item.setdefault(m.item, Saldo())
        s.qty += m.qin - m.qout
        s.nilai += m.vin - m.vout
        gudang[(m.item, m.wh)] = gudang.get((m.item, m.wh), NOL) + m.qin - m.qout
    return item, gudang


def _tersedia(mvs: List[Mv], item: str, wh: str, mulai: date) -> Decimal:
    """Qty minimum item di gudang sejak tanggal `mulai` (saldo per `mulai` dan setiap titik sesudahnya),
    supaya dokumen bertanggal mundur tidak membuat saldo masa depan negatif."""
    saldo = NOL
    minimum: Optional[Decimal] = None
    for m in mvs:
        if m.item != item or m.wh != wh:
            continue
        if m.tanggal > mulai and minimum is None:
            minimum = saldo
        saldo += m.qin - m.qout
        if m.tanggal > mulai:
            minimum = min(minimum, saldo)
    return saldo if minimum is None else min(minimum, saldo)


def _rata_per(mvs: List[Mv], item: str, per: date) -> Decimal:
    s = Saldo()
    for m in mvs:
        if m.item == item and m.tanggal <= per:
            s.qty += m.qin - m.qout
            s.nilai += m.vin - m.vout
    return s.rata


# ============================================================
# MASTER: GUDANG, KATEGORI, ITEM
# ============================================================

def _wh_dict(w: Any) -> Dict[str, Any]:
    return {"id": w.id, "code": w.code, "name": w.name, "address": w.address, "is_active": bool(w.is_active)}


@router.get("/accounts", summary="Akun COA klien (pilihan akun persediaan / HPP / selisih / lawan)")
def daftar_akun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: [{
        "id": a.id, "code": a.acc_no, "name": a.account_name, "classification": a.account_classification, "sub": a.account_sub,
        "standard_code": a.standard_account_code, "is_active": bool(a.is_active),
    } for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()])


@router.get("/warehouses", summary="Daftar gudang")
def daftar_gudang(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: [_wh_dict(w) for w in session.query(WH).filter(WH.client_id == kid, WH.deleted_at.is_(None)).order_by(WH.code).all()])


class GudangRequest(BaseModel):
    client_id: UUID
    code: Optional[str] = Field(None, max_length=30)
    name: str = Field(..., min_length=1, max_length=150)
    address: Optional[str] = Field(None, max_length=1000)
    is_active: bool = True


def _ambil(session, model, kid: str, oid: Any, label: str) -> Any:
    o = session.get(model, str(oid))
    if o is None or getattr(o, "deleted_at", None) is not None or str(o.client_id) != kid:
        raise _Gagal(f"{label} not found.", kode="NOT_FOUND", status_code=404)
    return o


def _kode_berikut(session, model, kolom, kid: str, awalan: str, lebar: int = 3) -> str:
    kode = [k for (k,) in session.query(kolom).filter(model.client_id == kid).all()]
    urut = max((int(m.group(1)) for k in kode if (m := re.fullmatch(rf"{awalan}-(\d+)", k or ""))), default=0)
    return f"{awalan}-{urut + 1:0{lebar}d}"


def _simpan_gudang(session, kid: str, p: GudangRequest, user: Dict[str, Any], w: Any = None) -> Any:
    kode = (_teks(p.code) or (w.code if w is not None else None) or _kode_berikut(session, WH, WH.code, kid, "WH")).upper()
    lain = session.query(WH).filter(WH.client_id == kid, WH.deleted_at.is_(None), WH.code == kode)
    if w is not None:
        lain = lain.filter(WH.id != w.id)
    if lain.first() is not None:
        raise _Gagal(f"Warehouse code {kode} is already used.", kode="CONFLICT", status_code=409)
    nilai = dict(code=kode, name=p.name.strip(), address=_teks(p.address), is_active=p.is_active)
    if w is None:
        w = WH(client_id=kid, created_by=user.get("id"), **nilai)
        session.add(w)
    else:
        for k, v in nilai.items():
            setattr(w, k, v)
        w.edited_at, w.edited_by = _sekarang(), user.get("id")
    session.flush()
    return w


@router.post("/warehouses", summary="Tambah gudang (Supervisor+)")
def buat_gudang(payload: GudangRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return _wh_dict(_simpan_gudang(session, kid, payload, current_user))
    return _respon(aksi, "Warehouse saved.")


@router.put("/warehouses/{warehouse_id}", summary="Ubah gudang (Supervisor+)")
def ubah_gudang(warehouse_id: UUID, payload: GudangRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    return _respon(lambda session: _wh_dict(_simpan_gudang(session, kid, payload, current_user, _ambil(session, WH, kid, warehouse_id, "Warehouse"))),
                   "Warehouse updated.")


@router.delete("/warehouses/{warehouse_id}", summary="Hapus gudang yang belum pernah dipakai (Supervisor+)")
def hapus_gudang(warehouse_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        w = _ambil(session, WH, kid, warehouse_id, "Warehouse")
        dipakai = session.query(DOC).filter(DOC.client_id == kid, DOC.deleted_at.is_(None),
                                            (DOC.warehouse_id == w.id) | (DOC.to_warehouse_id == w.id)).first()
        if dipakai is not None:
            raise _Gagal("This warehouse has stock documents. Deactivate it instead.", kode="CONFLICT", status_code=409)
        w.deleted_at, w.deleted_by = _sekarang(), current_user.get("id")
        return {"id": w.id}
    return _respon(aksi, "Warehouse deleted.")


def _kat_dict(c: Any, akun: Dict[str, Any], jumlah: int = 0) -> Dict[str, Any]:
    return {"id": c.id, "name": c.name, "description": c.description, "item_count": jumlah,
            "inventory_account": _akun_ringkas(akun.get(c.inventory_coa_id)), "cogs_account": _akun_ringkas(akun.get(c.cogs_coa_id)),
            "adjustment_account": _akun_ringkas(akun.get(c.adjustment_coa_id))}


@router.get("/categories", summary="Kategori item")
def daftar_kategori(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        akun = _peta_akun(session, kid)
        jumlah = dict(session.query(IT.category_id, func.count()).filter(IT.client_id == kid, IT.deleted_at.is_(None)).group_by(IT.category_id).all())
        return [_kat_dict(c, akun, jumlah.get(c.id, 0)) for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).order_by(CAT.name).all()]
    return _respon(aksi)


class KategoriRequest(BaseModel):
    client_id: UUID
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    inventory_coa_id: Optional[UUID] = None
    cogs_coa_id: Optional[UUID] = None
    adjustment_coa_id: Optional[UUID] = None


def _simpan_kategori(session, kid: str, p: KategoriRequest, user: Dict[str, Any], c: Any = None) -> Any:
    nama = p.name.strip()
    lain = session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None), func.upper(CAT.name) == nama.upper())
    if c is not None:
        lain = lain.filter(CAT.id != c.id)
    if lain.first() is not None:
        raise _Gagal(f"Category '{nama}' already exists.", kode="CONFLICT", status_code=409)
    for k in ("inventory_coa_id", "cogs_coa_id", "adjustment_coa_id"):
        _akun_opsional(session, kid, getattr(p, k))
    nilai = dict(name=nama, description=_teks(p.description),
                 inventory_coa_id=str(p.inventory_coa_id) if p.inventory_coa_id else None,
                 cogs_coa_id=str(p.cogs_coa_id) if p.cogs_coa_id else None,
                 adjustment_coa_id=str(p.adjustment_coa_id) if p.adjustment_coa_id else None)
    if c is None:
        c = CAT(client_id=kid, created_by=user.get("id"), **nilai)
        session.add(c)
    else:
        for k, v in nilai.items():
            setattr(c, k, v)
        c.edited_at, c.edited_by = _sekarang(), user.get("id")
    session.flush()
    return c


@router.post("/categories", summary="Tambah kategori (Supervisor+)")
def buat_kategori(payload: KategoriRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return _kat_dict(_simpan_kategori(session, kid, payload, current_user), _peta_akun(session, kid))
    return _respon(aksi, "Category saved.")


@router.put("/categories/{category_id}", summary="Ubah kategori (Supervisor+)")
def ubah_kategori(category_id: UUID, payload: KategoriRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    return _respon(lambda session: _kat_dict(_simpan_kategori(session, kid, payload, current_user, _ambil(session, CAT, kid, category_id, "Category")),
                                             _peta_akun(session, kid)), "Category updated.")


@router.delete("/categories/{category_id}", summary="Hapus kategori tanpa item (Supervisor+)")
def hapus_kategori(category_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        c = _ambil(session, CAT, kid, category_id, "Category")
        if session.query(IT).filter(IT.category_id == c.id, IT.deleted_at.is_(None)).first() is not None:
            raise _Gagal("This category still has items.", kode="CONFLICT", status_code=409)
        c.deleted_at, c.deleted_by = _sekarang(), current_user.get("id")
        return {"id": c.id}
    return _respon(aksi, "Category deleted.")


@router.post("/categories/seed-from-coa", summary="Buat kategori dari akun persediaan di COA klien (Supervisor+)")
def kategori_dari_coa(payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        akun = session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()
        std = lambda a: (a.standard_account_code or "").lower()
        persediaan = [a for a in akun if std(a) == "std_asset_current_inventory"]
        hpp = next((a for a in akun if "cogs" in std(a) or (a.account_classification or "").upper() == "COST OF SALES"), None)
        selisih = next((a for a in akun if re.search(r"penyesuaian persediaan|inventory adjust|selisih persediaan", a.account_name or "", re.I)), None)
        sudah = {c.inventory_coa_id for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
        nama_ada = {c.name.upper() for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
        dibuat = []
        for a in persediaan:
            if a.id in sudah:
                continue
            nama = re.sub(r"^(persediaan|inventory)\s*[-_:]?\s*", "", a.account_name.strip(), flags=re.I).strip() or a.account_name.strip()
            nama = nama.title()
            if nama.upper() in nama_ada:
                nama = f"{nama} ({a.acc_no})"
            session.add(CAT(client_id=kid, name=nama[:150], inventory_coa_id=a.id, cogs_coa_id=hpp.id if hpp else None,
                            adjustment_coa_id=selisih.id if selisih else None, description=f"Created from COA account {a.acc_no}",
                            created_by=current_user.get("id")))
            nama_ada.add(nama.upper())
            dibuat.append(nama)
        session.flush()
        return {"created": dibuat, "inventory_accounts": len(persediaan)}
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    pesan = (f"{len(data['created'])} categor{'y' if len(data['created']) == 1 else 'ies'} created from the chart of accounts."
             if data["inventory_accounts"] else "No inventory accounts (standard code std_asset_current_inventory) found in this client's chart of accounts.")
    return sukses(data=data, message=pesan)


def _status_stok(it: Any, qty: Decimal) -> str:
    if it.status != "active":
        return "inactive"
    if qty <= 0:
        return "out_of_stock"
    if _q(it.min_stock) > 0 and qty <= _q(it.min_stock):
        return "low_stock"
    return "active"


def _item_dict(it: Any, kat: Dict[str, Any], gudang: Dict[str, Any], s: Optional[Saldo], per_wh: Dict[Tuple[str, str], Decimal]) -> Dict[str, Any]:
    s = s or Saldo()
    c = kat.get(it.category_id)
    stok_wh = [{"warehouse_id": w, "warehouse": gudang[w].name if w in gudang else "—", "qty": _fq(q)}
               for (i, w), q in per_wh.items() if i == it.id and q != 0]
    return {
        "id": it.id, "code": it.code, "name": it.name, "barcode": it.barcode, "category_id": it.category_id,
        "category": c.name if c is not None else None, "unit": it.unit, "min_stock": _fq(it.min_stock),
        "reorder_qty": _fq(it.reorder_qty) if it.reorder_qty is not None else None,
        "default_warehouse_id": it.default_warehouse_id, "purchase_price": _f(it.purchase_price) if it.purchase_price is not None else None,
        "sale_price": _f(it.sale_price) if it.sale_price is not None else None, "description": it.description,
        "status": it.status, "stock_status": _status_stok(it, s.qty),
        "qty": _fq(s.qty), "avg_cost": round(float(s.rata), 4), "value": _f(_uang(s.nilai)) if s.qty else 0.0,
        "stock_by_warehouse": stok_wh,
    }


def _konteks(session, kid: str):
    kat = {c.id: c for c in session.query(CAT).filter(CAT.client_id == kid).all()}
    gudang = {w.id: w for w in session.query(WH).filter(WH.client_id == kid).all()}
    items = session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).order_by(IT.code).all()
    return kat, gudang, items


@router.get("/items", summary="Item List: master item + stok, rata-rata, nilai per tanggal")
def daftar_item(client_id: UUID = Query(...), as_of: Optional[date] = Query(None), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        kat, gudang, items = _konteks(session, kid)
        s_item, s_wh = _saldo(_muat_mv(session, kid, per))
        return {"as_of": per, "items": [_item_dict(i, kat, gudang, s_item.get(i.id), s_wh) for i in items],
                "next_code": _kode_berikut(session, IT, IT.code, kid, "ITM", 4)}
    return _respon(aksi)


@router.get("/items/{item_id}", summary="Detail item + 20 movement terakhir")
def detail_item(item_id: UUID, client_id: UUID = Query(...), as_of: Optional[date] = Query(None), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        it = _ambil(session, IT, kid, item_id, "Item")
        kat, gudang, _ = _konteks(session, kid)
        mvs = _muat_mv(session, kid, per, [it.id])
        s_item, s_wh = _saldo(mvs)
        return {**_item_dict(it, kat, gudang, s_item.get(it.id), s_wh),
                "movements": [_mv_dict(m, {it.id: it}, gudang) for m in reversed(mvs[-20:])]}
    return _respon(aksi)


class ItemRequest(BaseModel):
    client_id: UUID
    code: Optional[str] = Field(None, max_length=50)
    name: str = Field(..., min_length=1, max_length=255)
    barcode: Optional[str] = Field(None, max_length=100)
    category_id: Optional[UUID] = None
    unit: str = Field("Pcs", min_length=1, max_length=30)
    min_stock: float = Field(0, ge=0)
    reorder_qty: Optional[float] = Field(None, ge=0)
    default_warehouse_id: Optional[UUID] = None
    purchase_price: Optional[float] = Field(None, ge=0)
    sale_price: Optional[float] = Field(None, ge=0)
    description: Optional[str] = Field(None, max_length=2000)
    status: Literal["active", "inactive"] = "active"


def _simpan_item(session, kid: str, p: ItemRequest, user: Dict[str, Any], it: Any = None) -> Any:
    kode = (_teks(p.code) or (it.code if it is not None else None) or _kode_berikut(session, IT, IT.code, kid, "ITM", 4)).upper()
    lain = session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None), IT.code == kode)
    if it is not None:
        lain = lain.filter(IT.id != it.id)
    if lain.first() is not None:
        raise _Gagal(f"Item code {kode} is already used.", kode="CONFLICT", status_code=409)
    if p.category_id:
        _ambil(session, CAT, kid, p.category_id, "Category")
    if p.default_warehouse_id:
        _ambil(session, WH, kid, p.default_warehouse_id, "Warehouse")
    nilai = dict(code=kode, name=p.name.strip(), barcode=_teks(p.barcode), category_id=str(p.category_id) if p.category_id else None,
                 unit=p.unit.strip(), min_stock=Decimal(str(p.min_stock)), reorder_qty=Decimal(str(p.reorder_qty)) if p.reorder_qty is not None else None,
                 default_warehouse_id=str(p.default_warehouse_id) if p.default_warehouse_id else None,
                 purchase_price=Decimal(str(p.purchase_price)) if p.purchase_price is not None else None,
                 sale_price=Decimal(str(p.sale_price)) if p.sale_price is not None else None,
                 description=_teks(p.description), status=p.status)
    if it is None:
        it = IT(client_id=kid, created_by=user.get("id"), **nilai)
        session.add(it)
    else:
        for k, v in nilai.items():
            setattr(it, k, v)
        it.edited_at, it.edited_by = _sekarang(), user.get("id")
    session.flush()
    return it


def _respon_item(session, kid: str, it: Any) -> Dict[str, Any]:
    kat, gudang, _ = _konteks(session, kid)
    s_item, s_wh = _saldo(_muat_mv(session, kid, None, [it.id]))
    return _item_dict(it, kat, gudang, s_item.get(it.id), s_wh)


@router.post("/items", summary="Tambah item (Supervisor+)")
def buat_item(payload: ItemRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return _respon_item(session, kid, _simpan_item(session, kid, payload, current_user))
    return _respon(aksi, "Item saved.")


@router.put("/items/{item_id}", summary="Ubah item (Supervisor+)")
def ubah_item(item_id: UUID, payload: ItemRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    return _respon(lambda session: _respon_item(session, kid, _simpan_item(session, kid, payload, current_user, _ambil(session, IT, kid, item_id, "Item"))),
                   "Item updated.")


@router.delete("/items/{item_id}", summary="Hapus item tanpa transaksi stok (Supervisor+)")
def hapus_item(item_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        it = _ambil(session, IT, kid, item_id, "Item")
        if session.query(DL).join(DOC, DOC.id == DL.document_id).filter(DL.item_id == it.id, DOC.deleted_at.is_(None)).first() is not None:
            raise _Gagal("This item is used in stock documents. Set it to inactive instead.", kode="CONFLICT", status_code=409)
        it.deleted_at, it.deleted_by = _sekarang(), current_user.get("id")
        return {"id": it.id}
    return _respon(aksi, "Item deleted.")


class ImportItemRow(BaseModel):
    code: Optional[str] = Field(None, max_length=50)
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(None, max_length=150)
    unit: Optional[str] = Field(None, max_length=30)
    barcode: Optional[str] = Field(None, max_length=100)
    min_stock: Optional[float] = Field(None, ge=0)
    purchase_price: Optional[float] = Field(None, ge=0)
    sale_price: Optional[float] = Field(None, ge=0)


class ImportItemRequest(BaseModel):
    client_id: UUID
    rows: List[ImportItemRow] = Field(..., min_length=1, max_length=5000)
    update_existing: bool = True


@router.post("/items/import", summary="Import item dari Excel/CSV (baris sudah di-parse frontend, Supervisor+)")
def import_item(payload: ImportItemRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci_klien(session, kid)
        kat = {c.name.upper(): c for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
        ada = {i.code: i for i in session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).all()}
        baru = ubah = lewat = 0
        kat_baru = []
        for r in payload.rows:
            c = None
            if _teks(r.category):
                c = kat.get(r.category.strip().upper())
                if c is None:
                    c = CAT(client_id=kid, name=r.category.strip()[:150], created_by=current_user.get("id"))
                    session.add(c)
                    session.flush()
                    kat[c.name.upper()] = c
                    kat_baru.append(c.name)
            kode = (_teks(r.code) or "").upper()
            it = ada.get(kode) if kode else None
            if it is not None and not payload.update_existing:
                lewat += 1
                continue
            if it is None:
                kode = kode or _kode_berikut(session, IT, IT.code, kid, "ITM", 4)
                it = IT(client_id=kid, code=kode, name=r.name.strip(), unit=_teks(r.unit) or "Pcs", created_by=current_user.get("id"))
                session.add(it)
                ada[kode] = it
                baru += 1
            else:
                it.name = r.name.strip()
                if _teks(r.unit):
                    it.unit = r.unit.strip()
                it.edited_at, it.edited_by = _sekarang(), current_user.get("id")
                ubah += 1
            if c is not None:
                it.category_id = c.id
            if _teks(r.barcode):
                it.barcode = r.barcode.strip()
            if r.min_stock is not None:
                it.min_stock = Decimal(str(r.min_stock))
            if r.purchase_price is not None:
                it.purchase_price = Decimal(str(r.purchase_price))
            if r.sale_price is not None:
                it.sale_price = Decimal(str(r.sale_price))
            session.flush()
        return {"created": baru, "updated": ubah, "skipped": lewat, "categories_created": kat_baru}
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=f"{data['created']} item(s) created, {data['updated']} updated, {data['skipped']} skipped.")


# ============================================================
# OVERVIEW
# ============================================================

@router.get("/overview", summary="Overview: KPI, tren nilai & qty, per kategori, top item, stok menipis")
def overview(client_id: UUID = Query(...), as_of: Optional[date] = Query(None), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    per = as_of or date.today()

    def aksi(session):
        kat, gudang, items = _konteks(session, kid)
        mvs = _muat_mv(session, kid, per)
        s_item, s_wh = _saldo(mvs)
        aktif = [i for i in items if i.status == "active"]
        rows = [_item_dict(i, kat, gudang, s_item.get(i.id), s_wh) for i in items]
        per_kat: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            if r["value"] <= 0:
                continue
            g = per_kat.setdefault(r["category"] or "Uncategorized", {"category": r["category"] or "Uncategorized", "value": 0.0, "qty": 0.0, "items": 0})
            g["value"] += r["value"]
            g["qty"] += r["qty"]
            g["items"] += 1
        tren = []
        for i in range(11, -1, -1):
            akhir = min(_akhir_bulan(_tambah_bulan(per.replace(day=1), -i)), per)
            s, _ = _saldo(mvs, akhir)
            tren.append({"month": akhir.strftime("%Y-%m"), "value": _f(sum((x.nilai for x in s.values()), NOL)),
                         "qty": _fq(sum((x.qty for x in s.values()), NOL))})
        return {
            "as_of": per,
            "kpi": {
                "total_items": len(aktif), "total_value": _f(sum((Decimal(str(r["value"])) for r in rows), NOL)),
                "low_stock": sum(1 for r in rows if r["stock_status"] == "low_stock"),
                "out_of_stock": sum(1 for r in rows if r["stock_status"] == "out_of_stock"),
                "warehouses": sum(1 for w in gudang.values() if w.deleted_at is None and w.is_active),
                "categories": sum(1 for c in kat.values() if c.deleted_at is None),
            },
            "trend": tren,
            "by_category": sorted(per_kat.values(), key=lambda g: -g["value"]),
            "top_items": sorted((r for r in rows if r["value"] > 0), key=lambda r: -r["value"])[:5],
            "low_stock_items": [r for r in rows if r["stock_status"] in ("low_stock", "out_of_stock")][:20],
        }
    return _respon(aksi)


# ============================================================
# STOCK MOVEMENT
# ============================================================

def _mv_dict(m: Mv, items: Dict[str, Any], gudang: Dict[str, Any], saldo: Optional[Decimal] = None) -> Dict[str, Any]:
    it = items.get(m.item)
    return {
        "id": m.id, "date": m.tanggal, "reference_no": m.ref, "type": m.jenis, "is_reversal": m.balik, "document_id": m.doc_id,
        "item_id": m.item, "item_code": it.code if it is not None else None, "item_name": it.name if it is not None else None,
        "unit": it.unit if it is not None else None, "warehouse_id": m.wh,
        "warehouse": gudang[m.wh].name if m.wh in gudang else None, "source": m.sumber,
        "qty_in": _fq(m.qin), "qty_out": _fq(m.qout), "unit_cost": round(float(m.harga), 4),
        "value_in": _f(m.vin), "value_out": _f(m.vout), "balance": _fq(saldo) if saldo is not None else None,
    }


@router.get("/movements", summary="Stock Movement: kartu stok dengan saldo berjalan per item & gudang")
def daftar_movement(client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
                    item_id: Optional[UUID] = Query(None), warehouse_id: Optional[UUID] = Query(None), type: Optional[str] = Query(None),
                    _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        _, gudang, items = _konteks(session, kid)
        peta = {i.id: i for i in items}
        mvs = _muat_mv(session, kid, date_to, [str(item_id)] if item_id else None)
        saldo: Dict[Tuple[str, str], Decimal] = {}
        hasil = []
        for m in mvs:
            k = (m.item, m.wh)
            saldo[k] = saldo.get(k, NOL) + m.qin - m.qout
            if date_from and m.tanggal < date_from:
                continue
            if warehouse_id and m.wh != str(warehouse_id):
                continue
            if type and m.jenis != type:
                continue
            hasil.append(_mv_dict(m, peta, gudang, saldo[k]))
        hasil.reverse()
        return {"movements": hasil, "totals": {"qty_in": _fq(sum((Decimal(str(x["qty_in"])) for x in hasil), NOL)),
                                               "qty_out": _fq(sum((Decimal(str(x["qty_out"])) for x in hasil), NOL)),
                                               "value_in": _f(sum((Decimal(str(x["value_in"])) for x in hasil), NOL)),
                                               "value_out": _f(sum((Decimal(str(x["value_out"])) for x in hasil), NOL))}}
    return _respon(aksi)


# ============================================================
# DOKUMEN STOK
# ============================================================

def _doc_dict(d: Any, gudang: Dict[str, Any], akun: Dict[str, Any], baris: Optional[List[Any]] = None,
              items: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    hasil = {
        "id": d.id, "doc_no": d.doc_no, "doc_type": d.doc_type, "doc_date": d.doc_date,
        "warehouse_id": d.warehouse_id, "warehouse": gudang[d.warehouse_id].name if d.warehouse_id in gudang else None,
        "to_warehouse_id": d.to_warehouse_id, "to_warehouse": gudang[d.to_warehouse_id].name if d.to_warehouse_id in gudang else None,
        "reason": d.reason, "source_type": d.source_type, "source_id": d.source_id, "source_ref": d.source_ref, "notes": d.notes,
        "post_journal": bool(d.post_journal), "offset_account": _akun_ringkas(akun.get(d.offset_coa_id)), "offset_coa_id": d.offset_coa_id,
        "total_qty": _fq(d.total_qty), "total_value": _f(d.total_value), "status": d.status, "journal_id": d.journal_id,
        "created_by_name": d.created_by_name, "created_at": d.created_at, "posted_by_name": d.posted_by_name, "posted_at": d.posted_at,
        "void_date": d.void_date, "void_reason": d.void_reason, "voided_by_name": d.voided_by_name,
    }
    if baris is not None:
        items = items or {}
        hasil["lines"] = [{
            "id": l.id, "line_no": l.line_no, "item_id": l.item_id, "item_code": getattr(items.get(l.item_id), "code", None),
            "item_name": getattr(items.get(l.item_id), "name", None), "unit": getattr(items.get(l.item_id), "unit", None),
            "quantity": _fq(l.quantity), "system_qty": _fq(l.system_qty) if l.system_qty is not None else None,
            "counted_qty": _fq(l.counted_qty) if l.counted_qty is not None else None,
            "unit_cost": round(float(l.unit_cost), 4) if l.unit_cost is not None else None,
            "amount": _f(l.amount) if l.amount is not None else None, "source_line_id": l.source_line_id, "notes": l.notes,
        } for l in sorted(baris, key=lambda x: x.line_no)]
        if len({l.item_id for l in baris}) == 1 and baris:
            hasil["item_code"] = hasil["lines"][0]["item_code"]
            hasil["item_name"] = hasil["lines"][0]["item_name"]
        else:
            hasil["item_code"] = None
            hasil["item_name"] = f"{len(baris)} items" if baris else None
    return hasil


@router.get("/documents", summary="Daftar dokumen stok (filter jenis, tanggal, status)")
def daftar_dokumen(client_id: UUID = Query(...), doc_type: Optional[str] = Query(None), date_from: Optional[date] = Query(None),
                   date_to: Optional[date] = Query(None), status: Optional[str] = Query(None), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        _, gudang, items = _konteks(session, kid)
        peta = {i.id: i for i in items}
        q = session.query(DOC).filter(DOC.client_id == kid, DOC.deleted_at.is_(None))
        if doc_type:
            q = q.filter(DOC.doc_type == doc_type)
        if date_from:
            q = q.filter(DOC.doc_date >= date_from)
        if date_to:
            q = q.filter(DOC.doc_date <= date_to)
        if status:
            q = q.filter(DOC.status == status)
        docs = q.order_by(DOC.doc_date.desc(), DOC.doc_no.desc()).all()
        baris: Dict[str, List[Any]] = {}
        if docs:
            for l in session.query(DL).filter(DL.document_id.in_([d.id for d in docs])).all():
                baris.setdefault(l.document_id, []).append(l)
        akun = _peta_akun(session, kid)
        return [_doc_dict(d, gudang, akun, baris.get(d.id, []), peta) for d in docs]
    return _respon(aksi)


def _detail_dok(session, kid: str, d: Any) -> Dict[str, Any]:
    _, gudang, items = _konteks(session, kid)
    akun = _peta_akun(session, kid)
    hasil = _doc_dict(d, gudang, akun, session.query(DL).filter(DL.document_id == d.id).all(), {i.id: i for i in items})
    if d.journal_id:
        j = session.get(JR, d.journal_id)
        if j is not None:
            hasil["journal"] = _jurnal_dict(j, session.query(JL).filter(JL.journal_id == j.id).order_by(JL.line_no).all())
    return hasil


@router.get("/documents/{document_id}", summary="Detail dokumen stok + jurnal")
def detail_dokumen(document_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: _detail_dok(session, kid, _ambil(session, DOC, kid, document_id, "Document")))


class BarisDokIn(BaseModel):
    item_id: UUID
    quantity: float
    counted_qty: Optional[float] = Field(None, ge=0)
    unit_cost: Optional[float] = Field(None, ge=0)
    source_line_id: Optional[UUID] = None
    notes: Optional[str] = Field(None, max_length=500)


class DokumenRequest(BaseModel):
    client_id: UUID
    doc_type: Literal["opening", "receipt", "issue", "adjustment", "transfer"]
    doc_date: date
    warehouse_id: UUID
    to_warehouse_id: Optional[UUID] = None
    reason: Optional[Literal["stock_count", "damaged", "expired", "lost", "production_variance", "system_correction", "other"]] = None
    source_type: Optional[Literal["purchase", "sales"]] = None
    source_id: Optional[UUID] = None
    source_ref: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)
    post_journal: bool = False
    offset_coa_id: Optional[UUID] = None
    lines: List[BarisDokIn] = Field(..., min_length=1, max_length=1000)
    post_now: bool = False


def _nomor_dok(session, kid: str, jenis: str, tanggal: date) -> str:
    awalan = f"{AWALAN[jenis]}-{tanggal.year}-"
    nomor = [n for (n,) in session.query(DOC.doc_no).filter(DOC.client_id == kid, DOC.doc_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{re.escape(awalan)}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


def _simpan_dok(session, kid: str, p: DokumenRequest, user: Dict[str, Any], d: Any = None) -> Any:
    wh = _ambil(session, WH, kid, p.warehouse_id, "Warehouse")
    if not wh.is_active:
        raise _Gagal(f"Warehouse {wh.name} is inactive.")
    ke = None
    if p.doc_type == "transfer":
        if not p.to_warehouse_id:
            raise _Gagal("Choose the destination warehouse.")
        ke = _ambil(session, WH, kid, p.to_warehouse_id, "Destination warehouse")
        if ke.id == wh.id:
            raise _Gagal("Source and destination warehouse must differ.")
    if p.doc_type == "adjustment" and not p.reason:
        raise _Gagal("Choose the adjustment reason.")
    if p.post_journal and p.doc_type == "receipt" and not p.offset_coa_id:
        raise _Gagal("Choose the credit (offset) account for the receipt journal.")
    _akun_opsional(session, kid, p.offset_coa_id)
    sumber_ref = _teks(p.source_ref)
    if p.source_type == "purchase" and p.source_id:
        pt = session.get(PT, str(p.source_id))
        if pt is None or str(pt.management_client_id) != kid:
            raise _Gagal("Purchase not found.", kode="NOT_FOUND", status_code=404)
        sumber_ref = sumber_ref or pt.purchase_no
    if p.source_type == "sales" and p.source_id:
        si = session.get(SI, str(p.source_id))
        if si is None or str(si.management_client_id) != kid:
            raise _Gagal("Sales invoice not found.", kode="NOT_FOUND", status_code=404)
        sumber_ref = sumber_ref or si.invoice_no
    items = {}
    for b in p.lines:
        it = _ambil(session, IT, kid, b.item_id, "Item")
        items[it.id] = it
        if p.doc_type == "adjustment":
            if b.quantity == 0 and b.counted_qty is None:
                raise _Gagal(f"Quantity of {it.code} cannot be zero.")
        elif b.quantity <= 0:
            raise _Gagal(f"Quantity of {it.code} must be greater than zero.")
        if p.doc_type in ("opening", "receipt") and b.unit_cost is None:
            raise _Gagal(f"Unit cost of {it.code} is required.")
    nilai = dict(doc_type=p.doc_type, doc_date=p.doc_date, warehouse_id=wh.id, to_warehouse_id=ke.id if ke is not None else None,
                 reason=p.reason if p.doc_type == "adjustment" else None, source_type=p.source_type if p.source_id else None,
                 source_id=str(p.source_id) if p.source_id else None, source_ref=sumber_ref, notes=_teks(p.notes),
                 post_journal=bool(p.post_journal) and p.doc_type in ("receipt", "issue"),
                 offset_coa_id=str(p.offset_coa_id) if p.offset_coa_id else None)
    if p.doc_type == "adjustment":
        nilai["post_journal"] = True
    if d is None:
        d = DOC(client_id=kid, doc_no=_nomor_dok(session, kid, p.doc_type, p.doc_date), status="draft",
                created_by=user.get("id"), created_by_name=_nama(user), **nilai)
        session.add(d)
        session.flush()
    else:
        if d.status != "draft":
            raise _Gagal(f"{d.doc_no} is {d.status} and can no longer be edited.", kode="CONFLICT", status_code=409)
        if d.doc_type != p.doc_type:
            raise _Gagal("The document type cannot be changed.")
        for k, v in nilai.items():
            setattr(d, k, v)
        d.edited_at, d.edited_by = _sekarang(), user.get("id")
        session.query(DL).filter(DL.document_id == d.id).delete(synchronize_session=False)
    buku: Dict[Tuple[str, str], Decimal] = {}
    if p.doc_type == "adjustment" and any(b.counted_qty is not None for b in p.lines):
        _, buku = _saldo(_muat_mv(session, kid, p.doc_date, items.keys()), p.doc_date)
    tq, tv = NOL, NOL
    no = 0
    for b in p.lines:
        qty = _q(b.quantity)
        sistem = None
        if p.doc_type == "adjustment" and b.counted_qty is not None:
            sistem = buku.get((str(b.item_id), wh.id), NOL)
            qty = _q(b.counted_qty) - sistem
            if qty == 0:
                continue
        no += 1
        i = no
        harga = Decimal(str(b.unit_cost)) if b.unit_cost is not None else None
        session.add(DL(document_id=d.id, line_no=i, item_id=str(b.item_id), quantity=qty, system_qty=sistem,
                       counted_qty=_q(b.counted_qty) if b.counted_qty is not None else None, unit_cost=harga,
                       amount=_uang(abs(qty) * harga) if harga is not None else None,
                       source_line_id=str(b.source_line_id) if b.source_line_id else None, notes=_teks(b.notes)))
        tq += abs(qty)
        tv += _uang(abs(qty) * harga) if harga is not None else NOL
    if not no:
        raise _Gagal("Counted quantities equal the book quantities — nothing to adjust.")
    d.total_qty, d.total_value = tq, tv
    session.flush()
    return d


def _jenis_mv(d: Any, arah: str) -> str:
    if d.doc_type == "receipt":
        return "purchase" if d.source_type == "purchase" else "receipt"
    if d.doc_type == "issue":
        return "sales" if d.source_type == "sales" else "issue"
    return d.doc_type


def _posting_dok(session, kid: str, d: Any, user: Dict[str, Any]) -> None:
    baris = session.query(DL).filter(DL.document_id == d.id).order_by(DL.line_no).all()
    if not baris:
        raise _Gagal("The document has no lines.")
    items = {i.id: i for i in session.query(IT).filter(IT.id.in_([l.item_id for l in baris])).all()}
    mvs = _muat_mv(session, kid, None, items.keys())
    kat = {c.id: c for c in session.query(CAT).filter(CAT.client_id == kid).all()}
    akun = _peta_akun(session, kid)

    # Stock count: qty penyesuaian = hitung fisik - saldo buku per tanggal dokumen.
    if d.doc_type == "adjustment":
        _, s_wh = _saldo(mvs, d.doc_date)
        for l in baris:
            if l.counted_qty is not None:
                buku = s_wh.get((l.item_id, d.warehouse_id), NOL)
                l.system_qty = buku
                if _q(l.counted_qty) == buku:
                    session.delete(l)
                else:
                    l.quantity = _q(l.counted_qty) - buku
        session.flush()
        baris = [l for l in baris if l.counted_qty is None or _q(l.counted_qty) != _q(l.system_qty)]
        if not baris:
            raise _Gagal("Counted quantities equal the book quantities — nothing to adjust.")

    keluar: Dict[str, Decimal] = {}
    for l in baris:
        qty = _q(l.quantity)
        if d.doc_type in ("issue", "transfer") or (d.doc_type == "adjustment" and qty < 0):
            keluar[l.item_id] = keluar.get(l.item_id, NOL) + abs(qty)
    for item_id, butuh in keluar.items():
        ada = _tersedia(mvs, item_id, d.warehouse_id, d.doc_date)
        if ada < butuh:
            it = items[item_id]
            raise _Gagal(f"Insufficient stock for {it.code} {it.name} in this warehouse on {d.doc_date:%d %b %Y}: "
                         f"available {_fq(ada):,.4g}, needed {_fq(butuh):,.4g}.", kode="INSUFFICIENT_STOCK", status_code=409)

    waktu = _sekarang()
    jurnal: Dict[Tuple[str, str], Decimal] = {}   # (akun debit, akun kredit) -> nilai
    tv = NOL
    for l in baris:
        it = items[l.item_id]
        qty = _q(l.quantity)
        masuk = d.doc_type in ("opening", "receipt") or (d.doc_type == "adjustment" and qty > 0)
        rata = _rata_per(mvs, it.id, d.doc_date)
        harga = _d(l.unit_cost) if masuk and l.unit_cost is not None else rata
        if masuk and l.unit_cost is None and rata <= 0:
            raise _Gagal(f"Enter the unit cost for {it.code} (no average cost available yet).")
        nilai = _uang(abs(qty) * harga)
        l.unit_cost, l.amount = harga, nilai
        tv += nilai
        jenis = _jenis_mv(d, "in" if masuk else "out")
        dasar = dict(client_id=kid, item_id=it.id, movement_date=d.doc_date, movement_type=jenis, document_id=d.id,
                     document_line_id=l.id, reference_no=d.doc_no, source_ref=d.source_ref, unit_cost=harga, created_by=user.get("id"))
        if d.doc_type == "transfer":
            session.add(MV(warehouse_id=d.warehouse_id, qty_out=abs(qty), value_out=nilai, **dasar))
            session.add(MV(warehouse_id=d.to_warehouse_id, qty_in=abs(qty), value_in=nilai, **dasar))
        elif masuk:
            session.add(MV(warehouse_id=d.warehouse_id, qty_in=abs(qty), value_in=nilai, **dasar))
        else:
            session.add(MV(warehouse_id=d.warehouse_id, qty_out=abs(qty), value_out=nilai, **dasar))
        # Sesudah setiap baris, mesin stok di memori ikut diperbarui (baris berikut item yang sama memakai rata-rata baru).
        mvs.append(Mv(id="", item=it.id, wh=d.warehouse_id, tanggal=d.doc_date, jenis=jenis, doc_id=d.id, ref=d.doc_no, sumber=None,
                      qin=abs(qty) if masuk else NOL, qout=NOL if masuk else abs(qty), vin=nilai if masuk else NOL,
                      vout=NOL if masuk else nilai, harga=harga, balik=False, urut=None))
        mvs.sort(key=lambda m: m.tanggal)

        if nilai and (d.post_journal or d.doc_type == "adjustment"):
            c = kat.get(it.category_id)
            persediaan = c.inventory_coa_id if c is not None else None
            if not persediaan:
                raise _Gagal(f"Set the inventory account on the category of {it.code} before posting a journal.")
            if d.doc_type == "receipt":
                pasangan = (persediaan, d.offset_coa_id)
            elif d.doc_type == "issue":
                lawan = d.offset_coa_id or (c.cogs_coa_id if c is not None else None)
                if not lawan:
                    raise _Gagal(f"Set the COGS account on the category of {it.code} or choose an offset account.")
                pasangan = (lawan, persediaan)
            else:
                lawan = d.offset_coa_id or (c.adjustment_coa_id if c is not None else None)
                if not lawan:
                    raise _Gagal(f"Set the adjustment account on the category of {it.code} or choose an offset account.")
                pasangan = (persediaan, lawan) if qty > 0 else (lawan, persediaan)
            jurnal[pasangan] = jurnal.get(pasangan, NOL) + nilai

    if jurnal:
        baris_j: List[Tuple[Any, Decimal, Decimal]] = []
        for (dr, cr), n in jurnal.items():
            if dr not in akun or cr not in akun:
                raise _Gagal("A journal account no longer exists in the chart of accounts.")
            baris_j += [(akun[dr], n, NOL), (akun[cr], NOL, n)]
        j = _tulis_jurnal(session, kid, user, jenis={"receipt": "receipt", "issue": "issue"}.get(d.doc_type, "adjustment"),
                          tanggal=d.doc_date, document_id=d.id, baris=baris_j, reference=d.source_ref or d.doc_no,
                          description=f"{d.doc_type.title()} {d.doc_no}" + (f" ({d.source_ref})" if d.source_ref else ""))
        d.journal_id = j.id
    d.total_value = tv
    d.total_qty = sum((abs(_q(l.quantity)) for l in baris), NOL)
    d.status, d.posted_at, d.posted_by, d.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
    session.flush()


@router.post("/documents", summary="Buat dokumen stok (draft Supervisor+; post_now Manager+)")
def buat_dokumen(payload: DokumenRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci_klien(session, kid)
        d = _simpan_dok(session, kid, payload, current_user)
        if payload.post_now:
            if auth.role_level(current_user.get("role")) < LEVEL_POST:
                raise _Gagal("Posting requires Manager level or above.", kode="FORBIDDEN", status_code=403)
            _posting_dok(session, kid, d, current_user)
        return _detail_dok(session, kid, d)
    return _respon(aksi, "Document posted." if payload.post_now else "Document saved as draft.")


@router.put("/documents/{document_id}", summary="Ubah dokumen draft (Supervisor+)")
def ubah_dokumen(document_id: UUID, payload: DokumenRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        d = _simpan_dok(session, kid, payload, current_user, _ambil(session, DOC, kid, document_id, "Document"))
        if payload.post_now:
            if auth.role_level(current_user.get("role")) < LEVEL_POST:
                raise _Gagal("Posting requires Manager level or above.", kode="FORBIDDEN", status_code=403)
            _posting_dok(session, kid, d, current_user)
        return _detail_dok(session, kid, d)
    return _respon(aksi, "Document updated.")


@router.delete("/documents/{document_id}", summary="Hapus dokumen draft (Supervisor+)")
def hapus_dokumen(document_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        d = _ambil(session, DOC, kid, document_id, "Document")
        if d.status != "draft":
            raise _Gagal(f"Only drafts can be deleted ({d.doc_no} is {d.status}). Void it instead.", kode="CONFLICT", status_code=409)
        d.deleted_at, d.deleted_by = _sekarang(), current_user.get("id")
        return {"id": d.id}
    return _respon(aksi, "Document deleted.")


@router.post("/documents/{document_id}/post", summary="Post dokumen -> kartu stok (+ jurnal) (Manager+)")
def post_dokumen(document_id: UUID, payload: bc.KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        d = _ambil(session, DOC, kid, document_id, "Document")
        if d.status != "draft":
            raise _Gagal(f"{d.doc_no} is already {d.status}.", kode="CONFLICT", status_code=409)
        _posting_dok(session, kid, d, current_user)
        return _detail_dok(session, kid, d)
    return _respon(aksi, "Document posted.")


class VoidRequest(BaseModel):
    client_id: UUID
    void_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/documents/{document_id}/void", summary="Void dokumen posted: movement pembalik + jurnal dibalik (Manager+)")
def void_dokumen(document_id: UUID, payload: VoidRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        d = _ambil(session, DOC, kid, document_id, "Document")
        if d.status != "posted":
            raise _Gagal(f"Only posted documents can be voided ({d.doc_no} is {d.status}).", kode="CONFLICT", status_code=409)
        tgl = payload.void_date or date.today()
        if tgl < d.doc_date:
            raise _Gagal("The void date cannot be earlier than the document date.")
        asal = session.query(MV).filter(MV.document_id == d.id, MV.is_reversal.is_(False)).all()
        mvs = _muat_mv(session, kid, None, {m.item_id for m in asal})
        # Membatalkan barang masuk mengurangi stok -> pastikan saldo cukup sejak tanggal void.
        butuh: Dict[Tuple[str, str], Decimal] = {}
        for m in asal:
            if _q(m.qty_in) > 0:
                butuh[(m.item_id, m.warehouse_id)] = butuh.get((m.item_id, m.warehouse_id), NOL) + _q(m.qty_in)
        for (item_id, wh), n in butuh.items():
            ada = _tersedia(mvs, item_id, wh, tgl)
            if ada < n:
                it = session.get(IT, item_id)
                raise _Gagal(f"Cannot void: stock of {it.code} would become negative (available {_fq(ada):,.4g}, to remove {_fq(n):,.4g}).",
                             kode="INSUFFICIENT_STOCK", status_code=409)
        for m in asal:
            session.add(MV(client_id=kid, item_id=m.item_id, warehouse_id=m.warehouse_id, movement_date=tgl, movement_type=m.movement_type,
                           document_id=d.id, document_line_id=m.document_line_id, reference_no=d.doc_no, source_ref=f"Void {d.doc_no}",
                           qty_in=m.qty_out, qty_out=m.qty_in, unit_cost=m.unit_cost, value_in=m.value_out, value_out=m.value_in,
                           is_reversal=True, created_by=current_user.get("id")))
        if d.journal_id:
            j = session.get(JR, d.journal_id)
            if j is not None and j.status == "posted":
                j.status, j.reversal_date, j.reversal_reason = "reversed", tgl, payload.reason.strip()
                j.reversed_at, j.reversed_by, j.reversed_by_name = _sekarang(), current_user.get("id"), _nama(current_user)
        d.status, d.void_date, d.void_reason = "void", tgl, payload.reason.strip()
        d.voided_at, d.voided_by, d.voided_by_name = _sekarang(), current_user.get("id"), _nama(current_user)
        session.flush()
        return _detail_dok(session, kid, d)
    return _respon(aksi, "Document voided.")


# ============================================================
# JURNAL
# ============================================================

def _nomor_jurnal(session, kid: str, tanggal: date) -> str:
    awalan = f"INV-{tanggal.year}-"
    nomor = [n for (n,) in session.query(JR.journal_no).filter(JR.client_id == kid, JR.journal_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


def _tulis_jurnal(session, kid: str, user: Dict[str, Any], *, jenis: str, tanggal: date, document_id: str,
                  baris: List[Tuple[Any, Decimal, Decimal]], reference: Optional[str], description: str) -> Any:
    # Gabungkan baris akun yang sama di sisi yang sama.
    gabung: Dict[Tuple[str, str], List[Any]] = {}
    for a, dr, cr in baris:
        sisi = "D" if dr else "K"
        g = gabung.setdefault((a.id, sisi), [a, NOL])
        g[1] += dr or cr
    total_d = sum((v for (_, s), (_, v) in gabung.items() if s == "D"), NOL)
    total_k = sum((v for (_, s), (_, v) in gabung.items() if s == "K"), NOL)
    if total_d != total_k or total_d <= 0:
        raise _Gagal("The inventory journal is not balanced.")
    j = JR(client_id=kid, journal_no=_nomor_jurnal(session, kid, tanggal), journal_type=jenis, journal_date=tanggal,
           document_id=document_id, reference=reference, description=description, amount=total_d, status="posted",
           posted_at=_sekarang(), posted_by=user.get("id"), posted_by_name=_nama(user))
    session.add(j)
    session.flush()
    for i, ((_, sisi), (a, v)) in enumerate(sorted(gabung.items(), key=lambda t: t[0][1]), start=1):
        session.add(JL(journal_id=j.id, line_no=i, coa_id=a.id, account_code=a.acc_no, account_name=a.account_name,
                       description=description, debit=v if sisi == "D" else NOL, credit=v if sisi == "K" else NOL))
    session.flush()
    return j


def _jurnal_dict(j: Any, baris: Optional[List[Any]] = None) -> Dict[str, Any]:
    d = {"id": j.id, "journal_no": j.journal_no, "journal_type": j.journal_type, "journal_date": j.journal_date,
         "document_id": j.document_id, "reference": j.reference, "description": j.description, "amount": _f(j.amount),
         "status": j.status, "posted_by_name": j.posted_by_name, "posted_at": j.posted_at, "reversal_date": j.reversal_date,
         "reversal_reason": j.reversal_reason}
    if baris is not None:
        d["lines"] = [{"line_no": l.line_no, "account_code": l.account_code, "account_name": l.account_name, "description": l.description,
                       "debit": _f(l.debit), "credit": _f(l.credit)} for l in baris]
    return d


@router.get("/journals", summary="Jurnal Inventory (adjustment, HPP, receipt)")
def daftar_jurnal(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda session: [_jurnal_dict(j) for j in session.query(JR).filter(JR.client_id == kid)
                                    .order_by(JR.journal_date.desc(), JR.journal_no.desc()).all()])


# ============================================================
# SUMBER: PURCHASE & SALES POSTED
# ============================================================

def _cocok_item(items: List[Any], kode: Optional[str], nama: Optional[str]) -> Optional[Any]:
    k, n = _norm(kode), _norm(nama)
    for it in items:
        if k and _norm(it.code) == k:
            return it
    for it in items:
        if n and (_norm(it.name) == n or _norm(it.code) == n):
            return it
    return None


def _diproses(session, kid: str, jenis: str, source_ids: List[str]) -> Dict[str, Decimal]:
    """Qty yang sudah diterima/dikeluarkan per baris sumber (dokumen draft & posted, bukan void)."""
    if not source_ids:
        return {}
    hasil: Dict[str, Decimal] = {}
    for sl, qty in session.query(DL.source_line_id, DL.quantity).join(DOC, DOC.id == DL.document_id).filter(
            DOC.client_id == kid, DOC.deleted_at.is_(None), DOC.status != "void", DOC.doc_type == jenis,
            DOC.source_id.in_(source_ids), DL.source_line_id.isnot(None)).all():
        hasil[sl] = hasil.get(sl, NOL) + _q(qty)
    return hasil


@router.get("/sources/purchases", summary="Purchase posted + baris + qty yang belum diterima ke gudang")
def sumber_purchase(client_id: UUID = Query(...), only_open: bool = Query(True), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        items = session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).all()
        txs = session.query(PT).filter(PT.management_client_id == kid, func.lower(PT.status) == "posted", PT.deleted_at.is_(None)
                                       ).order_by(PT.purchase_date.desc()).limit(500).all()
        baris: Dict[str, List[Any]] = {}
        if txs:
            for l in session.query(PTL).filter(PTL.transaction_id.in_([t.id for t in txs]), PTL.deleted_at.is_(None)).order_by(PTL.line_no).all():
                baris.setdefault(l.transaction_id, []).append(l)
        sudah = _diproses(session, kid, "receipt", [t.id for t in txs])
        hasil = []
        for t in txs:
            ls = []
            for l in baris.get(t.id, []):
                qty = _q(l.quantity)
                if qty <= 0:
                    continue
                cocok = _cocok_item(items, l.item_code, l.description)
                biaya = (_d(l.subtotal) - _d(l.discount)) / qty if qty else NOL
                ls.append({"line_id": l.id, "item_code": l.item_code, "description": l.description, "unit": l.unit, "quantity": _fq(qty),
                           "processed_qty": _fq(sudah.get(l.id, NOL)), "open_qty": _fq(max(qty - sudah.get(l.id, NOL), NOL)),
                           "unit_cost": round(float(biaya), 4), "account_code": l.account_code,
                           "matched_item_id": cocok.id if cocok is not None else None})
            terbuka = sum(x["open_qty"] for x in ls)
            if only_open and not terbuka:
                continue
            hasil.append({"id": t.id, "number": t.purchase_no, "date": t.purchase_date, "party": t.vendor_name, "total": _f(t.total),
                          "lines": ls, "open_qty": terbuka})
        return hasil
    return _respon(aksi)


@router.get("/sources/sales", summary="Invoice Sales posted (yang punya baris item) + qty yang belum dikeluarkan")
def sumber_sales(client_id: UUID = Query(...), only_open: bool = Query(True), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        items = session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).all()
        inv = session.query(SI).filter(SI.management_client_id == kid, func.lower(SI.posting_status) == "posted", SI.deleted_at.is_(None)
                                       ).order_by(SI.invoice_date.desc()).limit(1000).all()
        baris: Dict[str, List[Any]] = {}
        if inv:
            for l in session.query(SIL).filter(SIL.invoice_id.in_([i.id for i in inv])).order_by(SIL.line_no).all():
                baris.setdefault(l.invoice_id, []).append(l)
        inv = [i for i in inv if i.id in baris]
        sudah = _diproses(session, kid, "issue", [i.id for i in inv])
        hasil = []
        for i in inv:
            ls = []
            for l in baris[i.id]:
                qty = _q(l.quantity)
                cocok = _cocok_item(items, None, l.product_name)
                ls.append({"line_id": l.id, "item_code": None, "description": l.product_name, "unit": l.unit, "quantity": _fq(qty),
                           "processed_qty": _fq(sudah.get(l.id, NOL)), "open_qty": _fq(max(qty - sudah.get(l.id, NOL), NOL)),
                           "unit_cost": None, "matched_item_id": cocok.id if cocok is not None else None})
            terbuka = sum(x["open_qty"] for x in ls)
            if only_open and not terbuka:
                continue
            hasil.append({"id": i.id, "number": i.invoice_no, "date": i.invoice_date, "party": i.customer_name, "total": _f(i.gross_amount),
                          "lines": ls, "open_qty": terbuka})
        return hasil
    return _respon(aksi)


# ============================================================
# REPORTS
# ============================================================

def _filter_item(items: List[Any], category_id: Optional[str], hanya_aktif: bool = False) -> List[Any]:
    return [i for i in items if (not category_id or i.category_id == category_id) and (not hanya_aktif or i.status == "active")]


def _laporan(session, kid: str, jenis: str, dari: date, sampai: date, category_id: Optional[str], warehouse_id: Optional[str],
             item_id: Optional[str]) -> Dict[str, Any]:
    kat, gudang, semua = _konteks(session, kid)
    items = _filter_item(semua, category_id)
    peta = {i.id: i for i in semua}
    nama_kat = lambda i: kat[i.category_id].name if i.category_id in kat else "Uncategorized"
    mvs = _muat_mv(session, kid, sampai, [i.id for i in items])
    kemarin = dari - timedelta(days=1)

    def qty_wh(s_wh: Dict[Tuple[str, str], Decimal], item: str) -> Decimal:
        if warehouse_id:
            return s_wh.get((item, warehouse_id), NOL)
        return sum((q for (i, _), q in s_wh.items() if i == item), NOL)

    if jenis == "stock_summary":
        s_awal, wh_awal = _saldo(mvs, kemarin)
        s_akhir, wh_akhir = _saldo(mvs, sampai)
        rows = []
        for i in items:
            masuk = sum((m.qin for m in mvs if m.item == i.id and dari <= m.tanggal <= sampai and (not warehouse_id or m.wh == warehouse_id)), NOL)
            keluar = sum((m.qout for m in mvs if m.item == i.id and dari <= m.tanggal <= sampai and (not warehouse_id or m.wh == warehouse_id)), NOL)
            awal, akhir = qty_wh(wh_awal, i.id), qty_wh(wh_akhir, i.id)
            if not (awal or masuk or keluar or akhir):
                continue
            rata = s_akhir.get(i.id, Saldo()).rata
            rows.append({"item_code": i.code, "item_name": i.name, "category": nama_kat(i), "unit": i.unit, "opening_qty": _fq(awal),
                         "qty_in": _fq(masuk), "qty_out": _fq(keluar), "closing_qty": _fq(akhir), "avg_cost": round(float(rata), 4),
                         "closing_value": _f(_uang(akhir * rata))})
        return {"rows": rows}
    if jenis == "stock_card":
        if not item_id:
            raise _Gagal("Choose an item for the stock card.")
        it = peta.get(item_id)
        if it is None:
            raise _Gagal("Item not found.", kode="NOT_FOUND", status_code=404)
        mi = [m for m in _muat_mv(session, kid, sampai, [item_id]) if not warehouse_id or m.wh == warehouse_id]
        qty = sum((m.qin - m.qout for m in mi if m.tanggal < dari), NOL)
        nilai = sum((m.vin - m.vout for m in mi if m.tanggal < dari), NOL)
        rows = [{"date": None, "reference_no": "", "type": "opening_balance", "warehouse": "", "qty_in": None, "qty_out": None,
                 "unit_cost": None, "value_in": None, "value_out": None, "balance_qty": _fq(qty), "balance_value": _f(nilai)}]
        for m in mi:
            if m.tanggal < dari:
                continue
            qty += m.qin - m.qout
            nilai += m.vin - m.vout
            rows.append({"date": m.tanggal, "reference_no": m.ref, "type": m.jenis + (" (void)" if m.balik else ""),
                         "warehouse": gudang[m.wh].name if m.wh in gudang else "", "qty_in": _fq(m.qin) or None, "qty_out": _fq(m.qout) or None,
                         "unit_cost": round(float(m.harga), 4), "value_in": _f(m.vin) or None, "value_out": _f(m.vout) or None,
                         "balance_qty": _fq(qty), "balance_value": _f(nilai)})
        return {"item": {"code": it.code, "name": it.name, "unit": it.unit}, "rows": rows}
    if jenis == "stock_aging":
        s_akhir, wh_akhir = _saldo(mvs, sampai)
        batas = (30, 60, 90, 180)
        rows = []
        for i in items:
            sisa = qty_wh(wh_akhir, i.id)
            if sisa <= 0:
                continue
            rata = s_akhir.get(i.id, Saldo()).rata
            ember = [NOL] * 5
            lapisan = [m for m in mvs if m.item == i.id and m.qin > 0 and not m.balik and m.jenis != "transfer"
                       and (not warehouse_id or m.wh == warehouse_id)]
            for m in sorted(lapisan, key=lambda m: m.tanggal, reverse=True):
                if sisa <= 0:
                    break
                ambil = min(sisa, m.qin)
                umur = (sampai - m.tanggal).days
                idx = next((k for k, b in enumerate(batas) if umur <= b), 4)
                ember[idx] += ambil
                sisa -= ambil
            if sisa > 0:
                ember[4] += sisa
            total = sum(ember, NOL)
            rows.append({"item_code": i.code, "item_name": i.name, "category": nama_kat(i), "unit": i.unit, "qty": _fq(total),
                         "d0_30": _fq(ember[0]), "d31_60": _fq(ember[1]), "d61_90": _fq(ember[2]), "d91_180": _fq(ember[3]),
                         "d180_plus": _fq(ember[4]), "value": _f(_uang(total * rata)),
                         "value_over_90": _f(_uang((ember[3] + ember[4]) * rata))})
        return {"rows": rows}
    if jenis == "valuation":
        s_akhir, wh_akhir = _saldo(mvs, sampai)
        rows = []
        for i in items:
            if i.status != "active":
                continue
            rata = s_akhir.get(i.id, Saldo()).rata
            for (ii, w), q in sorted(wh_akhir.items(), key=lambda t: gudang[t[0][1]].name if t[0][1] in gudang else ""):
                if ii != i.id or q == 0 or (warehouse_id and w != warehouse_id):
                    continue
                rows.append({"item_code": i.code, "item_name": i.name, "category": nama_kat(i), "warehouse": gudang[w].name if w in gudang else "",
                             "unit": i.unit, "qty": _fq(q), "avg_cost": round(float(rata), 4), "value": _f(_uang(q * rata))})
        return {"rows": rows}
    if jenis == "category_summary":
        s_akhir, wh_akhir = _saldo(mvs, sampai)
        grup: Dict[str, Dict[str, Any]] = {}
        for i in items:
            q = qty_wh(wh_akhir, i.id)
            if i.status != "active":
                continue
            g = grup.setdefault(nama_kat(i), {"category": nama_kat(i), "item_count": 0, "qty": NOL, "value": NOL})
            g["item_count"] += 1
            g["qty"] += q
            g["value"] += _uang(q * s_akhir.get(i.id, Saldo()).rata)
        total = sum((g["value"] for g in grup.values()), NOL)
        rows = [{"category": g["category"], "item_count": g["item_count"], "qty": _fq(g["qty"]), "value": _f(g["value"]),
                 "pct": round(float(g["value"] / total * 100), 2) if total else 0.0} for g in sorted(grup.values(), key=lambda g: -g["value"])]
        dipakai = {w for (i, w), q in wh_akhir.items() if q > 0}
        return {"rows": rows, "summary": {"total_value": _f(total), "total_sku": sum(r["item_count"] for r in rows),
                                          "categories": len(rows), "warehouses": len(dipakai)}}
    if jenis == "movement":
        saldo: Dict[Tuple[str, str], Decimal] = {}
        rows = []
        for m in mvs:
            k = (m.item, m.wh)
            saldo[k] = saldo.get(k, NOL) + m.qin - m.qout
            if m.tanggal < dari or (warehouse_id and m.wh != warehouse_id):
                continue
            rows.append(_mv_dict(m, peta, gudang, saldo[k]))
        return {"rows": rows}
    if jenis in ("adjustment", "transfer"):
        q = session.query(DOC).filter(DOC.client_id == kid, DOC.deleted_at.is_(None), DOC.doc_type == jenis,
                                      DOC.doc_date >= dari, DOC.doc_date <= sampai, DOC.status != "draft")
        if warehouse_id:
            q = q.filter((DOC.warehouse_id == warehouse_id) | (DOC.to_warehouse_id == warehouse_id))
        docs = q.order_by(DOC.doc_date, DOC.doc_no).all()
        rows = []
        if docs:
            ids = {i.id for i in items}
            for d, l in session.query(DOC, DL).join(DL, DL.document_id == DOC.id).filter(DOC.id.in_([d.id for d in docs])).order_by(DOC.doc_date, DOC.doc_no, DL.line_no).all():
                if l.item_id not in ids:
                    continue
                it = peta.get(l.item_id)
                rows.append({"date": d.doc_date, "doc_no": d.doc_no, "item_code": it.code if it else None, "item_name": it.name if it else None,
                             "unit": it.unit if it else None, "quantity": _fq(l.quantity), "unit_cost": round(float(l.unit_cost or 0), 4),
                             "amount": _f(l.amount) * (-1 if jenis == "adjustment" and _q(l.quantity) < 0 else 1),
                             "reason": d.reason, "from_warehouse": gudang[d.warehouse_id].name if d.warehouse_id in gudang else None,
                             "to_warehouse": gudang[d.to_warehouse_id].name if d.to_warehouse_id in gudang else None,
                             "status": d.status, "created_by": d.created_by_name})
        return {"rows": rows}
    if jenis == "low_stock":
        s_akhir, wh_akhir = _saldo(mvs, sampai)
        rows = []
        for i in items:
            if i.status != "active":
                continue
            q = qty_wh(wh_akhir, i.id)
            st = _status_stok(i, q)
            if st not in ("low_stock", "out_of_stock"):
                continue
            minimum = _q(i.min_stock)
            saran = _q(i.reorder_qty) if i.reorder_qty is not None and _q(i.reorder_qty) > 0 else max(minimum * 2 - q, minimum - q, NOL)
            rows.append({"item_code": i.code, "item_name": i.name, "category": nama_kat(i), "unit": i.unit, "qty": _fq(q),
                         "min_stock": _fq(minimum), "suggested_order": _fq(saran), "status": st,
                         "avg_cost": round(float(s_akhir.get(i.id, Saldo()).rata), 4)})
        return {"rows": rows}
    raise _Gagal("Unknown report type.", kode="NOT_FOUND", status_code=404)


@router.get("/reports/{report_type}", summary="Laporan Inventory (stock summary, card, aging, valuation, kategori, movement, adjustment, transfer, low stock)")
def laporan(report_type: str, client_id: UUID = Query(...), date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
            category_id: Optional[UUID] = Query(None), warehouse_id: Optional[UUID] = Query(None), item_id: Optional[UUID] = Query(None),
            _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    sampai = date_to or date.today()
    dari = date_from or date(sampai.year, 1, 1)
    if report_type not in JENIS_LAPORAN:
        return bc._respon_gagal(_Gagal("Unknown report type.", kode="NOT_FOUND", status_code=404))
    if dari > sampai:
        return bc._respon_gagal(_Gagal("The start date must be on or before the end date."))

    def aksi(session):
        data = _laporan(session, kid, report_type, dari, sampai, str(category_id) if category_id else None,
                        str(warehouse_id) if warehouse_id else None, str(item_id) if item_id else None)
        klien = dbc.get_management_client_by_id(kid) or {}
        return {"report_type": report_type, "period": {"from": dari, "to": sampai}, "client_name": klien.get("nama_client") or "", **data}
    return _respon(aksi)
