"""
modules/management/coa_v1.py
=============================
Fitur Management > COA (master Chart of Accounts per klien):
/api/v1/management/coa/...

Standar SAMA dengan modules/management/clients_v1.py (amplop response
{status, message, data, errors}, auth lewat middleware jwt_v1_middleware).

Data di tabel `management_client_coa` (ORM db_client.py::ManagementClientCoa,
DDL root/ddl-table, seed awal dari dataset/COA/COA_Clients_GOUF.xlsx lewat
migrations/seed_coa_*.sql). client_id = management_clients.id (UUID).

Endpoint:
    GET    /api/v1/management/coa/client/{client_id}   daftar COA 1 klien
           (?search=  acc_no/nama akun, ?classification=, ?active_only=, ?limit=)
           -- juga dipakai autocomplete Account Name di New Journal Entry.
    GET    /api/v1/management/coa/unassigned            daftar akun yang BELUM
           terhubung ke klien mana pun (client_id NULL), filter sama seperti di atas
    POST   /api/v1/management/coa/assign                hubungkan akun unassigned
           ke 1 klien ({client_id, coa_ids}) -- baris yang sama diisi client_id-nya
    GET    /api/v1/management/coa/{coa_id}              detail 1 akun
    POST   /api/v1/management/coa                       tambah akun (client_id
           boleh null = akun unassigned)
    PUT    /api/v1/management/coa/{coa_id}              ubah akun
    DELETE /api/v1/management/coa/{coa_id}              soft-delete akun

Baca: cukup token valid. Tulis (create/update/delete): minimal Tahap 3
(Supervisor) -- mengubah COA berdampak ke posting & laporan klien, jadi
bukan aksi bebas staf junior.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .clients_v1 import _require_level_v1

logger = get_module_logger("management_coa_v1")

router = APIRouter(prefix="/api/v1/management/coa", tags=["management-coa-v1"])

LEVEL_MINIMAL_UBAH_COA = 3

KLASIFIKASI_AKUN = (
    "ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST OF SALES",
    "EXPENSE", "OTHER INCOME", "OTHER EXPENSE", "INCOME TAX",
)
SALDO_NORMAL = ("DEBIT", "CREDIT")


def _validasi_klasifikasi(nilai: Optional[str]) -> Optional[str]:
    if nilai is None:
        return None
    nilai = nilai.strip().upper()
    if nilai not in KLASIFIKASI_AKUN:
        raise ValueError(f"account_classification harus salah satu dari: {', '.join(KLASIFIKASI_AKUN)}.")
    return nilai


def _validasi_saldo_normal(nilai: Optional[str]) -> Optional[str]:
    if nilai is None or nilai.strip() == "":
        return None
    nilai = nilai.strip().upper()
    if nilai not in SALDO_NORMAL:
        raise ValueError("normal_balance harus DEBIT atau CREDIT.")
    return nilai


def _rapikan_teks(nilai: Optional[str]) -> Optional[str]:
    if nilai is None:
        return None
    nilai = nilai.strip()
    return nilai or None


# ============================================================
# SKEMA REQUEST
# ============================================================

class CoaCreateRequest(BaseModel):
    # None = akun unassigned (belum terhubung ke klien mana pun).
    client_id: Optional[str] = None
    acc_no: str = Field(..., min_length=1, max_length=50)
    account_name: str = Field(..., min_length=1, max_length=255)
    account_classification: str = Field(..., max_length=30)
    account_head: Optional[str] = Field(None, max_length=50)
    account_sub: Optional[str] = Field(None, max_length=100)
    normal_balance: Optional[str] = Field(None, max_length=10)
    description: Optional[str] = None
    international_standard_group: Optional[str] = Field(None, max_length=255)
    standard_account_code: Optional[str] = Field(None, max_length=100)
    ifrs_taxonomy_reference: Optional[str] = Field(None, max_length=255)
    ifrs_source: Optional[str] = Field(None, max_length=255)
    is_active: bool = True

    _cek_klasifikasi = field_validator("account_classification")(_validasi_klasifikasi)
    _cek_saldo = field_validator("normal_balance")(_validasi_saldo_normal)


class CoaUpdateRequest(BaseModel):
    """Semua field opsional -- partial update. client_id tidak bisa dipindah."""
    acc_no: Optional[str] = Field(None, min_length=1, max_length=50)
    account_name: Optional[str] = Field(None, min_length=1, max_length=255)
    account_classification: Optional[str] = Field(None, max_length=30)
    account_head: Optional[str] = Field(None, max_length=50)
    account_sub: Optional[str] = Field(None, max_length=100)
    normal_balance: Optional[str] = Field(None, max_length=10)
    description: Optional[str] = None
    international_standard_group: Optional[str] = Field(None, max_length=255)
    standard_account_code: Optional[str] = Field(None, max_length=100)
    ifrs_taxonomy_reference: Optional[str] = Field(None, max_length=255)
    ifrs_source: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None

    _cek_klasifikasi = field_validator("account_classification")(_validasi_klasifikasi)
    _cek_saldo = field_validator("normal_balance")(_validasi_saldo_normal)


class CoaAssignRequest(BaseModel):
    client_id: UUID
    coa_ids: List[UUID] = Field(..., min_length=1, max_length=5000)


def _payload_bersih(payload: BaseModel) -> Dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    return {k: (_rapikan_teks(v) if isinstance(v, str) else v) for k, v in data.items()}


def _acc_no_bentrok(client_id: Optional[str], acc_no: str, kecuali_id: Optional[str] = None):
    """Return ("aktif", row) kalau acc_no sudah dipakai akun aktif lain,
    ("terhapus", row) kalau dipakai akun yang sudah di-soft-delete, else (None, None)."""
    row = dbc.cari_management_client_coa_by_acc_no(client_id, acc_no)
    if not row or row["id"] == kecuali_id:
        return None, None
    return ("aktif" if row["aktif"] else "terhapus"), row


def _label_tempat(client_id: Optional[str]) -> str:
    return "klien ini" if client_id else "daftar akun unassigned"


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/client/{client_id}", summary="Daftar COA 1 klien")
def daftar_coa_client(
    client_id: str,
    search: Optional[str] = Query(None, description="Cari di acc_no atau account_name (substring, tidak case-sensitive)."),
    classification: Optional[str] = Query(None, description="Filter account_classification, mis. ASSET."),
    active_only: bool = Query(False, description="Hanya akun is_active = true (mis. untuk autocomplete jurnal)."),
    limit: Optional[int] = Query(None, ge=1, le=5000),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if dbc.get_management_client_by_id(client_id) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    data = dbc.list_management_client_coa(
        client_id,
        search=search,
        account_classification=classification,
        hanya_aktif=active_only,
        limit=limit,
    )
    return sukses(data=data, message="OK")


@router.get("/client/{client_id}/balances", summary="Saldo per akun COA 1 klien (dari jurnal POSTED)")
def saldo_coa_client(
    client_id: str,
    as_of: Optional[date] = Query(None, description="Saldo s.d. tanggal ini (inklusif). Kosong = semua jurnal POSTED."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    """Total debit & kredit per acc_no dari SEMUA jurnal POSTED klien -- sumber
    sama persis dengan Financial Statements (dbc.ambil_baris_jurnal_posted_transaksi:
    Journal Entry termasuk Opening Balance, Sales, Purchase), jadi angkanya
    konsisten dengan Trial Balance. Saldo bertanda (debit - kredit); frontend
    mengubahnya ke sisi saldo normal akun."""
    if dbc.get_management_client_by_id(client_id) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    total: Dict[str, Dict[str, float]] = {}
    for baris in dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=client_id, sampai_tanggal=as_of):
        kode = (baris.get("account_code") or "").strip()
        if not kode:
            continue
        t = total.setdefault(kode, {"debit": 0.0, "credit": 0.0})
        t["debit"] += float(baris.get("debit") or 0)
        t["credit"] += float(baris.get("kredit") or 0)
    data = [
        {"acc_no": kode, "debit": round(t["debit"], 2), "credit": round(t["credit"], 2),
         "balance": round(t["debit"] - t["credit"], 2)}
        for kode, t in sorted(total.items())
    ]
    return sukses(data=data, message="OK")


@router.get("/unassigned", summary="Daftar akun COA yang belum terhubung ke klien")
def daftar_coa_unassigned(
    search: Optional[str] = Query(None, description="Cari di acc_no atau account_name (substring, tidak case-sensitive)."),
    classification: Optional[str] = Query(None, description="Filter account_classification, mis. ASSET."),
    active_only: bool = Query(False, description="Hanya akun is_active = true."),
    limit: Optional[int] = Query(None, ge=1, le=5000),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_management_client_coa(
        None,
        search=search,
        account_classification=classification,
        hanya_aktif=active_only,
        limit=limit,
    )
    return sukses(data=data, message="OK")


@router.post("/assign", summary="Hubungkan akun unassigned ke 1 klien (minimal Supervisor)")
def assign_coa(
    payload: CoaAssignRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_COA)),
):
    """Akun yang dipilih diisi client_id klien tujuan (keluar dari daftar
    unassigned). Akun yang ACC NO-nya sudah dipakai di klien tujuan, sudah
    punya klien, atau tidak ditemukan dilewati (lihat `skipped`) -- sisanya
    tetap di-assign."""
    client_id = str(payload.client_id)
    client = dbc.get_management_client_by_id(client_id)
    if client is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    try:
        hasil = dbc.assign_management_client_coa(
            [str(i) for i in payload.coa_ids], client_id, client.get("client_code"), assigned_by=current_user.get("id")
        )
    except Exception:  # noqa: BLE001 -- sudah di-log di db_client
        logger.exception("Gagal assign COA ke client %s", client_id)
        return gagal(message="Gagal menghubungkan akun ke klien (kesalahan database).", status_code=500)

    n_ok, n_skip = len(hasil["assigned"]), len(hasil["skipped"])
    pesan = f"{n_ok} akun berhasil ditambahkan ke {client.get('nama_client') or 'klien'}."
    if n_skip:
        pesan += f" {n_skip} akun dilewati."
    return sukses(data=hasil, message=pesan)


@router.get("/{coa_id}", summary="Detail 1 akun COA")
def detail_coa(coa_id: str, _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    data = dbc.get_management_client_coa_by_id(coa_id)
    if data is None:
        return gagal(message="Akun COA tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.post("", summary="Tambah akun COA (minimal Supervisor)")
def buat_coa(
    payload: CoaCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_COA)),
):
    data = _payload_bersih(payload)
    client_id = data.get("client_id")
    if client_id:
        client = dbc.get_management_client_by_id(client_id)
        if client is None:
            return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        data["client_code"] = client.get("client_code")
    else:
        data["client_id"] = None
        data["client_code"] = None

    status_bentrok, lama = _acc_no_bentrok(client_id, data["acc_no"])
    if status_bentrok == "terhapus" and not client_id:
        # Pool unassigned tidak terkena UNIQUE (client_id, acc_no) -- cukup buat baris baru.
        status_bentrok = None
    if status_bentrok == "aktif":
        return gagal(
            message=f"ACC NO {data['acc_no']} sudah dipakai akun '{lama['account_name']}' di {_label_tempat(client_id)}.",
            errors={"code": "DUPLICATE_ACC_NO"},
            status_code=409,
        )
    if status_bentrok == "terhapus":
        # UNIQUE (client_id, acc_no) tetap berlaku untuk baris terhapus --
        # hidupkan lagi baris lama dengan isi baru.
        dibuat = dbc.restore_management_client_coa(lama["id"], data, updated_by=current_user.get("id"))
    else:
        dibuat = dbc.create_management_client_coa(data, created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal menyimpan akun COA (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Akun COA berhasil ditambahkan.", status_code=201)


@router.put("/{coa_id}", summary="Ubah akun COA (minimal Supervisor)")
def ubah_coa(
    coa_id: str,
    payload: CoaUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_COA)),
):
    lama = dbc.get_management_client_coa_by_id(coa_id)
    if lama is None:
        return gagal(message="Akun COA tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)

    data = _payload_bersih(payload)
    if data.get("acc_no") and data["acc_no"] != lama["acc_no"]:
        status_bentrok, lain = _acc_no_bentrok(lama["client_id"], data["acc_no"], kecuali_id=coa_id)
        if status_bentrok == "terhapus" and not lama["client_id"]:
            status_bentrok = None
        if status_bentrok:
            keterangan = f"akun '{lain['account_name']}'" + (" (sudah dihapus)" if status_bentrok == "terhapus" else "")
            return gagal(
                message=f"ACC NO {data['acc_no']} sudah dipakai {keterangan} di {_label_tempat(lama['client_id'])}.",
                errors={"code": "DUPLICATE_ACC_NO"},
                status_code=409,
            )
    diupdate = dbc.update_management_client_coa(coa_id, data, updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Gagal mengubah akun COA (kesalahan database).", status_code=500)
    return sukses(data=diupdate, message="Akun COA berhasil diubah.")


@router.delete("/{coa_id}", summary="Hapus (soft-delete) akun COA (minimal Supervisor)")
def hapus_coa(
    coa_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH_COA)),
):
    if not dbc.soft_delete_management_client_coa(coa_id, deleted_by=current_user.get("id")):
        return gagal(message="Akun COA tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Akun COA berhasil dihapus.")
