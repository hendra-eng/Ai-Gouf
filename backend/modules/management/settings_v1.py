"""
modules/management/settings_v1.py
==================================
Fitur Management > Settings: /api/v1/management/settings/...

Tab Company memakai endpoint yang sudah ada (clients_v1.py:
GET/PUT /api/v1/management/clients/{id}). File ini menambah data yang
belum punya endpoint:

    GET /api/v1/management/settings/users?client_id=<uuid>
        Tab User Management: user yang management_users.client_id = company
        terpilih (soft-deleted disembunyikan). Kolom: nama, username, role
        (+ label & grup, katalog di modules/auth/core.py LEVELS/CLIENT_LEVELS
        -- lihat RBAC.md), status (is_active), type (is_member).
    GET /api/v1/management/settings/accountants
        Pilihan "Akuntan penanggung jawab" di tab Company: user internal
        (role tahap_N / super_admin) yang belum dihapus.
    GET /api/v1/management/settings/purchase?client_id=<uuid>
    PUT /api/v1/management/settings/purchase?client_id=<uuid>
        Tab Purchase: variabel default purchase per company (tabel
        management_setting_purchase, migration 27). Company yang belum
        pernah disimpan -> nilai default (exists=false). PUT = upsert
        (add kalau belum ada, update kalau sudah), minimal Tahap 5 seperti
        PUT company.
    GET/PUT /api/v1/management/settings/product?client_id=<uuid>
        Tab Product > Subfeature settings (management_setting_product,
        migration 28): stock_info_on_sales_purchases & product_variant. PUT = upsert.
    GET    /api/v1/management/settings/product/{categories|units}?client_id=&search=&page=&page_size=
    POST   /api/v1/management/settings/product/{categories|units}?client_id=
    PUT    /api/v1/management/settings/product/{categories|units}/{id}
    DELETE /api/v1/management/settings/product/{categories|units}/{id}
        Tab Product > Basic setting: master product category & product unit
        (name + amount manual). List dipaginasi (default 20/hal) + search nama.
        Delete = soft delete. Nama unik per company (case-insensitive).
    GET/PUT /api/v1/management/settings/account-mapping?client_id=<uuid>
        Tab Account Mapping: 1 akun COA (management_client_coa milik company
        tsb) per input, dikelompokkan Sales / Purchase / AR-AP / Inventory /
        Others (katalog ACCOUNT_MAPPING_GROUPS). Tabel
        management_setting_account_mappings (migration 29). PUT parsial:
        hanya key yang dikirim yang diubah; null = kosongkan mapping.

Semua tulis (PUT/POST/DELETE) minimal Tahap 5. Baca cukup token valid (sama seperti GET client di clients_v1.py).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func

import db_client as dbc
from .. import auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from .clients_v1 import _require_level_v1

router = APIRouter(prefix="/api/v1/management/settings", tags=["management-settings-v1"])


def _grup_role(role: str) -> str:
    if role == auth.SUPER_ADMIN_ROLE:
        return "super_admin"
    if role in auth.CLIENT_LEVELS:
        return "client"
    if role in auth.LEVELS:
        return "internal"
    return "unknown"


def _label_role(role: str) -> str:
    if role in auth.CLIENT_LEVELS:
        return auth.client_role_label(role)
    return auth.role_label(role)


def _user_ke_dict(u: Any) -> Dict[str, Any]:
    return {
        "id": u.id_user,
        "name": u.nama_user,
        "username": u.username,
        "phone": u.telp_user,
        "role": u.role,
        "role_label": _label_role(u.role),
        "role_group": _grup_role(u.role),
        "is_active": u.is_active is not False,
        "is_member": bool(u.is_member),
        "client_id": u.client_id,
        "created_at": u.created_at,
        "updated_at": u.updated_at,
    }


@router.get("/users", summary="Daftar user milik 1 company (tab User Management)")
def daftar_user_company(
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    session = dbc.SessionLocal()
    try:
        rows: List[Any] = (
            session.query(dbc.User)
            .filter(dbc.User.client_id == str(client_id), dbc.User.deleted_at.is_(None))
            .order_by(dbc.User.nama_user)
            .all()
        )
        return sukses(data=[_user_ke_dict(u) for u in rows], message="OK")
    finally:
        session.close()


@router.get("/accountants", summary="User internal untuk pilihan akuntan penanggung jawab")
def daftar_akuntan(_current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        internal = list(auth.LEVELS.keys()) + [auth.SUPER_ADMIN_ROLE]
        rows = (
            session.query(dbc.User)
            .filter(dbc.User.role.in_(internal), dbc.User.deleted_at.is_(None))
            .order_by(dbc.User.nama_user)
            .all()
        )
        return sukses(data=[{
            "id": u.id_user, "name": u.nama_user, "username": u.username,
            "role_label": _label_role(u.role), "is_active": u.is_active is not False,
        } for u in rows], message="OK")
    finally:
        session.close()


# ── Tab Purchase ───────────────────────────────────────────────────────────

PURCHASE_TERMS = [
    "Net 30", "Cash on Delivery", "Net 15", "Net 60", "Custom", "Net 7",
    "Net 14", "Transfer", "Net 1", "Net 20", "Net 17",
]
FLAG_PURCHASE = ["activate_supplier_in_purchase_request", "shipping", "discount", "discount_per_lines", "deposit"]
LEVEL_MINIMAL_UBAH_SETTING = 5


class PurchaseSettingInput(BaseModel):
    preferred_purchase_term: Optional[str] = Field(None, max_length=50)
    activate_supplier_in_purchase_request: bool = False
    shipping: bool = False
    discount: bool = False
    discount_per_lines: bool = False
    deposit: bool = False
    default_purchase_message: Optional[str] = None


def _purchase_ke_dict(client_id: str, row: Optional[Any]) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "client_id": client_id,
        "exists": row is not None,
        "preferred_purchase_term": row.preferred_purchase_term if row else None,
        "default_purchase_message": row.default_purchase_message if row else None,
        "edited_at": (row.edited_at or row.created_at) if row else None,
        "term_options": PURCHASE_TERMS,
    }
    for f in FLAG_PURCHASE:
        data[f] = bool(getattr(row, f)) if row else False
    return data


@router.get("/purchase", summary="Variabel default purchase 1 company (tab Purchase)")
def ambil_setting_purchase(
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    session = dbc.SessionLocal()
    try:
        row = session.query(dbc.ManagementSettingPurchase).filter_by(client_id=str(client_id)).first()
        return sukses(data=_purchase_ke_dict(str(client_id), row), message="OK")
    finally:
        session.close()


@router.put("/purchase", summary="Simpan (add/update) variabel default purchase 1 company")
def simpan_setting_purchase(
    payload: PurchaseSettingInput,
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    term = (payload.preferred_purchase_term or "").strip() or None
    if term is not None and term not in PURCHASE_TERMS:
        return gagal(
            message=f"Preferred purchase term tidak valid: {term}.",
            errors={"code": "VALIDATION_ERROR", "field": "preferred_purchase_term", "options": PURCHASE_TERMS},
            status_code=422,
        )
    pesan = (payload.default_purchase_message or "").strip() or None

    session = dbc.SessionLocal()
    try:
        row = session.query(dbc.ManagementSettingPurchase).filter_by(client_id=str(client_id)).first()
        baru = row is None
        if baru:
            row = dbc.ManagementSettingPurchase(client_id=str(client_id), created_by=current_user.get("id"))
            session.add(row)
        else:
            row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        row.preferred_purchase_term = term
        row.default_purchase_message = pesan
        for f in FLAG_PURCHASE:
            setattr(row, f, bool(getattr(payload, f)))
        session.commit()
        session.refresh(row)
        return sukses(
            data=_purchase_ke_dict(str(client_id), row),
            message="Setting purchase ditambahkan." if baru else "Setting purchase diperbarui.",
        )
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Tab Product ────────────────────────────────────────────────────────────

FLAG_PRODUCT = ["stock_info_on_sales_purchases", "product_variant"]


class ProductSettingInput(BaseModel):
    stock_info_on_sales_purchases: bool = False
    product_variant: bool = False


def _product_ke_dict(client_id: str, row: Optional[Any]) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "client_id": client_id,
        "exists": row is not None,
        "edited_at": (row.edited_at or row.created_at) if row else None,
    }
    for f in FLAG_PRODUCT:
        data[f] = bool(getattr(row, f)) if row else False
    return data


@router.get("/product", summary="Subfeature settings product 1 company (tab Product)")
def ambil_setting_product(
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    session = dbc.SessionLocal()
    try:
        row = session.query(dbc.ManagementSettingProduct).filter_by(client_id=str(client_id)).first()
        return sukses(data=_product_ke_dict(str(client_id), row), message="OK")
    finally:
        session.close()


@router.put("/product", summary="Simpan (add/update) subfeature settings product 1 company")
def simpan_setting_product(
    payload: ProductSettingInput,
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    session = dbc.SessionLocal()
    try:
        row = session.query(dbc.ManagementSettingProduct).filter_by(client_id=str(client_id)).first()
        baru = row is None
        if baru:
            row = dbc.ManagementSettingProduct(client_id=str(client_id), created_by=current_user.get("id"))
            session.add(row)
        else:
            row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        for f in FLAG_PRODUCT:
            setattr(row, f, bool(getattr(payload, f)))
        session.commit()
        session.refresh(row)
        return sukses(
            data=_product_ke_dict(str(client_id), row),
            message="Setting product ditambahkan." if baru else "Setting product diperbarui.",
        )
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


class MasterProductInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    amount: Decimal = Field(Decimal("0"), ge=0, max_digits=18, decimal_places=2)


def _master_ke_dict(row: Any) -> Dict[str, Any]:
    return {
        "id": row.id,
        "client_id": row.client_id,
        "name": row.name,
        "amount": float(row.amount or 0),
        "created_at": row.created_at,
        "edited_at": row.edited_at,
    }


def _daftarkan_master_product(segmen: str, model: Any, label: str) -> None:
    """Pasang endpoint list/tambah/ubah/hapus untuk 1 master product
    (categories / units) -- strukturnya identik, beda tabel & label saja."""
    dasar = f"/product/{segmen}"

    def _nama_dipakai(session: Any, client_id: str, nama: str, kecuali_id: Optional[str] = None) -> bool:
        q = session.query(model.id).filter(
            model.client_id == client_id,
            model.deleted_at.is_(None),
            func.lower(model.name) == nama.lower(),
        )
        if kecuali_id:
            q = q.filter(model.id != kecuali_id)
        return q.first() is not None

    def _duplikat(nama: str):
        return gagal(
            message=f"{label} \"{nama}\" sudah ada.",
            errors={"code": "DUPLICATE", "field": "name"},
            status_code=409,
        )

    def _nama_kosong():
        return gagal(message=f"Nama {label} wajib diisi.", errors={"code": "VALIDATION_ERROR", "field": "name"}, status_code=422)

    def _ambil(session: Any, item_id: str) -> Optional[Any]:
        return session.query(model).filter(model.id == item_id, model.deleted_at.is_(None)).first()

    @router.get(dasar, summary=f"Daftar {label} 1 company (search + pagination)")
    def daftar(
        client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
        search: Optional[str] = Query(None, description="Cari di nama (case-insensitive)."),
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        _current_user: Dict[str, Any] = Depends(get_current_user_v1),
    ):
        session = dbc.SessionLocal()
        try:
            q = session.query(model).filter(model.client_id == str(client_id), model.deleted_at.is_(None))
            kata = (search or "").strip()
            if kata:
                q = q.filter(model.name.ilike(f"%{kata}%"))
            total = q.count()
            rows = q.order_by(func.lower(model.name)).offset((page - 1) * page_size).limit(page_size).all()
            return sukses(data={
                "items": [_master_ke_dict(r) for r in rows],
                "total": total,
                "page": page,
                "page_size": page_size,
            }, message="OK")
        finally:
            session.close()

    @router.post(dasar, summary=f"Tambah {label}")
    def tambah(
        payload: MasterProductInput,
        client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
        current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
    ):
        if dbc.get_management_client_by_id(str(client_id)) is None:
            return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        nama = payload.name.strip()
        if not nama:
            return _nama_kosong()
        session = dbc.SessionLocal()
        try:
            if _nama_dipakai(session, str(client_id), nama):
                return _duplikat(nama)
            row = model(client_id=str(client_id), name=nama, amount=payload.amount, created_by=current_user.get("id"))
            session.add(row)
            session.commit()
            session.refresh(row)
            return sukses(data=_master_ke_dict(row), message=f"{label} ditambahkan.", status_code=201)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @router.put(dasar + "/{item_id}", summary=f"Ubah {label}")
    def ubah(
        item_id: UUID,
        payload: MasterProductInput,
        current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
    ):
        nama = payload.name.strip()
        if not nama:
            return _nama_kosong()
        session = dbc.SessionLocal()
        try:
            row = _ambil(session, str(item_id))
            if row is None:
                return gagal(message=f"{label} tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
            if _nama_dipakai(session, row.client_id, nama, kecuali_id=row.id):
                return _duplikat(nama)
            row.name, row.amount = nama, payload.amount
            row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
            session.commit()
            session.refresh(row)
            return sukses(data=_master_ke_dict(row), message=f"{label} diperbarui.")
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @router.delete(dasar + "/{item_id}", summary=f"Hapus {label} (soft delete)")
    def hapus(
        item_id: UUID,
        current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
    ):
        session = dbc.SessionLocal()
        try:
            row = _ambil(session, str(item_id))
            if row is None:
                return gagal(message=f"{label} tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
            row.deleted_at, row.deleted_by = datetime.now(), current_user.get("id")
            session.commit()
            return sukses(data={"id": str(item_id)}, message=f"{label} dihapus.")
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


_daftarkan_master_product("categories", dbc.ManagementSettingProductCategory, "Product category")
_daftarkan_master_product("units", dbc.ManagementSettingProductUnit, "Product unit")


# ── Tab Account Mapping ────────────────────────────────────────────────────

# (key grup, label grup, [(mapping_key, label input)]) -- urutan = urutan tampil.
ACCOUNT_MAPPING_GROUPS: List[Tuple[str, str, List[Tuple[str, str]]]] = [
    ("sales", "Sales", [
        ("sales_revenue", "Sales Revenue"),
        ("sales_discount", "Sales Discount"),
        ("sales_return", "Sales Return"),
        ("sales_shipping", "Sales Shipping"),
        ("unearned_revenue", "Unearned Revenue"),
        ("unbilled_sales", "Unbilled Sales"),
        ("unbilled_receivable", "Unbilled Receivable"),
        ("sales_tax_payable", "Sales Tax Payable"),
    ]),
    ("purchase", "Purchase", [
        ("purchase_cogs", "Purchase (COGS)"),
        ("purchase_shipping", "Purchase Shipping"),
        ("prepayment", "Prepayment"),
        ("unbilled_payable", "Unbilled Payable"),
        ("purchase_tax_receivable", "Purchase Tax Receivable"),
    ]),
    ("ar_ap", "AR/AP", [
        ("account_receivable", "Account Receivable"),
        ("account_payable", "Account Payable"),
    ]),
    ("inventory", "Inventory", [
        ("inventory", "Inventory"),
        ("inventory_general", "Inventory General"),
        ("inventory_waste", "Inventory Waste"),
        ("inventory_production", "Inventory Production"),
    ]),
    ("others", "Others", [
        ("opening_balance_equity", "Opening Balance Equity"),
        ("fixed_asset", "Fixed Asset"),
    ]),
]
ACCOUNT_MAPPING_KEYS = {k for _, _, items in ACCOUNT_MAPPING_GROUPS for k, _ in items}

# Fitur yang SUDAH membaca mapping ini (lihat db_client.py: akun_default_sales,
# akun_purchase_setting/lengkapi_akun_purchase; opening_balance_v1.py).
# Key yang tidak ada di sini disimpan saja, belum ada fiturnya.
ACCOUNT_MAPPING_DIPAKAI: Dict[str, str] = {
    "sales_revenue": "Sales journal (revenue, unless the import template sets a branch account)",
    "account_receivable": "Sales journal (receivable)",
    "sales_tax_payable": "Sales journal (output VAT)",
    "purchase_cogs": "Purchase item lines without an account",
    "purchase_shipping": "Purchase import \"Other Costs\" line",
    "account_payable": "Purchase journal (accounts payable)",
    "purchase_tax_receivable": "Purchase journal (input VAT)",
    "opening_balance_equity": "Opening balance suspense account (default)",
}


class AccountMappingInput(BaseModel):
    # {mapping_key: coa_id | null}; key yang tidak dikirim tidak diubah.
    mappings: Dict[str, Optional[UUID]]


def _coa_ringkas(coa: Any) -> Dict[str, Any]:
    return {
        "id": coa.id,
        "acc_no": coa.acc_no,
        "account_name": coa.account_name,
        "account_classification": coa.account_classification,
        "is_active": coa.is_active is not False,
        "deleted": coa.deleted_at is not None,
    }


def _account_mapping_data(session: Any, client_id: str) -> Dict[str, Any]:
    rows = (
        session.query(dbc.ManagementSettingAccountMapping, dbc.ManagementClientCoa)
        .join(dbc.ManagementClientCoa, dbc.ManagementClientCoa.id == dbc.ManagementSettingAccountMapping.coa_id)
        .filter(dbc.ManagementSettingAccountMapping.client_id == client_id)
        .all()
    )
    per_key = {m.mapping_key: (m, coa) for m, coa in rows}
    terakhir = max((m.edited_at or m.created_at for m, _ in rows), default=None)
    groups = []
    for g_key, g_label, items in ACCOUNT_MAPPING_GROUPS:
        isi = []
        for k, label in items:
            m_coa = per_key.get(k)
            isi.append({
                "key": k,
                "label": label,
                "used_in": ACCOUNT_MAPPING_DIPAKAI.get(k),
                "coa_id": m_coa[1].id if m_coa else None,
                "coa": _coa_ringkas(m_coa[1]) if m_coa else None,
            })
        groups.append({"key": g_key, "label": g_label, "items": isi})
    return {
        "client_id": client_id,
        "groups": groups,
        "mapped": len(per_key.keys() & ACCOUNT_MAPPING_KEYS),
        "total": len(ACCOUNT_MAPPING_KEYS),
        "edited_at": terakhir,
    }


@router.get("/account-mapping", summary="Account mapping 1 company (tab Account Mapping)")
def ambil_account_mapping(
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    session = dbc.SessionLocal()
    try:
        return sukses(data=_account_mapping_data(session, str(client_id)), message="OK")
    finally:
        session.close()


@router.put("/account-mapping", summary="Simpan (add/update/kosongkan) account mapping 1 company")
def simpan_account_mapping(
    payload: AccountMappingInput,
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_SETTING)),
):
    cid = str(client_id)
    if dbc.get_management_client_by_id(cid) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    tak_dikenal = sorted(set(payload.mappings) - ACCOUNT_MAPPING_KEYS)
    if tak_dikenal:
        return gagal(
            message=f"Mapping tidak dikenal: {', '.join(tak_dikenal)}.",
            errors={"code": "VALIDATION_ERROR", "fields": tak_dikenal},
            status_code=422,
        )

    session = dbc.SessionLocal()
    try:
        # Akun yang dipilih wajib milik company ini & belum dihapus.
        coa_ids = {str(v) for v in payload.mappings.values() if v is not None}
        valid = {
            r.id for r in session.query(dbc.ManagementClientCoa.id).filter(
                dbc.ManagementClientCoa.id.in_(coa_ids),
                dbc.ManagementClientCoa.client_id == cid,
                dbc.ManagementClientCoa.deleted_at.is_(None),
            )
        } if coa_ids else set()
        salah = sorted(k for k, v in payload.mappings.items() if v is not None and str(v) not in valid)
        if salah:
            return gagal(
                message="Akun COA tidak ditemukan di COA company ini untuk: " + ", ".join(salah) + ".",
                errors={"code": "INVALID_COA", "fields": salah},
                status_code=422,
            )

        ada = {
            m.mapping_key: m for m in session.query(dbc.ManagementSettingAccountMapping).filter(
                dbc.ManagementSettingAccountMapping.client_id == cid,
                dbc.ManagementSettingAccountMapping.mapping_key.in_(list(payload.mappings)),
            )
        }
        sekarang, uid = datetime.now(), current_user.get("id")
        for key, coa_id in payload.mappings.items():
            row = ada.get(key)
            if coa_id is None:
                if row is not None:
                    session.delete(row)
            elif row is None:
                session.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key=key, coa_id=str(coa_id), created_by=uid))
            elif row.coa_id != str(coa_id):
                row.coa_id, row.edited_at, row.edited_by = str(coa_id), sekarang, uid
        session.commit()
        return sukses(data=_account_mapping_data(session, cid), message="Account mapping disimpan.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
