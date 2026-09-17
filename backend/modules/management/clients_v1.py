"""
modules/management/clients_v1.py
==================================
Fitur "Kelola Klien" versi REST API standar: /api/v1/management/clients/...

Mengikuti standar YANG SAMA dengan modules/auth/v1.py (lihat file itu
untuk alasan detailnya):

    - Routing versi: /api/[version]/[group]/[fitur], di sini
      /api/v1/management/clients/... (BUKAN endpoint datar
      /api/management-clients atau semacamnya).
    - Response SELALU pakai amplop standar {status, message, data, errors}
      -- modules/api_response.py.
    - Autentikasi (WAJIB header "Authorization: Bearer <token>" yang
      valid) ditegakkan di MIDDLEWARE `jwt_v1_middleware`
      (modules/auth/v1.py), yang sudah menjaga SELURUH grup /api/v1/**
      -- bukan cuma /api/v1/auth/. Paket ini TIDAK perlu middleware
      sendiri, cukup pasang router-nya (lihat main.py).
    - Endpoint yang mengubah data (create/update/delete) dibatasi
      `Depends(auth.require_level(5))` -- PERSIS seperti
      POST /api/v1/auth/register -- karena mengelola data klien firm-wide
      adalah aksi admin, bukan aksi bebas untuk semua staf yang login.
    - Endpoint baca (list/detail) cukup token valid (any authenticated
      user), lewat Depends(get_current_user_v1) yang sama dipakai
      /api/v1/auth/me & /api/v1/auth/roles.

Data disimpan di tabel `management_clients` (DDL: root/ddl-table, ORM:
db_client.py::ManagementClient) -- TERPISAH dari tabel `clients` (lama,
dipakai modul akuntansi/upload). Soft-delete lewat kolom deleted_at/
deleted_by (pola sama seperti management_users), bukan DELETE permanen.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("management_clients_v1")

router = APIRouter(prefix="/api/v1/management/clients", tags=["management-clients-v1"])


def _require_level_v1(min_tahap: int):
    """Versi `auth.require_level()` yang kompatibel dengan alur cookie httpOnly.

    `auth.require_level()` (modules/auth/core.py) bergantung ke
    `auth.get_current_user`, yang membaca token HANYA dari header
    `Authorization: Bearer ...` (lewat HTTPBearer). Dashboard frontend
    menyimpan token di cookie httpOnly "gouf_session" (lihat
    src/app/api/session/login/route.ts), TANPA header Authorization --
    jadi `auth.get_current_user` selalu menganggap tidak ada kredensial
    dan jatuh ke bypass ALLOW_ANONYMOUS_DEV (`DEFAULT_USER_TANPA_LOGIN`,
    id integer 0). Endpoint ini lalu memasukkan `created_by=0` ke SQL
    yang meng-cast ::UUID, dan "0" bukan UUID valid -> insert gagal.

    `get_current_user_v1` sudah benar (baca `request.state.user`, yang
    diisi `jwt_v1_middleware` -- middleware itu SUDAH mendukung fallback
    cookie), jadi cek level di sini dibangun di atasnya supaya
    `current_user["id"]` yang dipakai sebagai created_by/updated_by
    selalu UUID user yang benar-benar login."""

    def _dependency(current_user: Dict[str, Any] = Depends(get_current_user_v1)) -> Dict[str, Any]:
        if auth.role_level(current_user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. "
                    f"Akun kamu: {auth.role_label(current_user.get('role'))}."
                ),
            )
        return current_user

    return _dependency


# ============================================================
# SKEMA REQUEST
# ============================================================

class ManagementClientCreateRequest(BaseModel):
    client_code: Optional[str] = Field(None, max_length=50)
    nama_client: str = Field(..., min_length=1, max_length=255)
    tipe_badan_usaha: Optional[str] = Field(None, max_length=255)
    npwp: Optional[str] = Field(None, max_length=20)
    nomor_akta_nib: Optional[str] = Field(None, max_length=255)
    status_pkp: Optional[bool] = None
    klasifikasi_lapangan_usaha: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    no_telepon: Optional[str] = Field(None, max_length=255)
    no_handphone: Optional[str] = Field(None, max_length=255)
    nama_pic: Optional[str] = Field(None, max_length=255)
    jabatan_pic: Optional[str] = Field(None, max_length=255)
    alamat: Optional[str] = None
    kota: Optional[str] = Field(None, max_length=50)
    provinsi: Optional[str] = Field(None, max_length=50)
    kode_pos: Optional[str] = Field(None, max_length=255)
    industry: Optional[str] = Field(None, max_length=255)
    tahun_buku_mulai: Optional[str] = Field(None, max_length=10)
    mata_uang_default: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=10)
    akuntan_penanggung_jawab: Optional[str] = None
    tanggal_mulai_kerjasama: Optional[datetime] = None


class ManagementClientUpdateRequest(BaseModel):
    """Semua field opsional -- update bersifat partial (kolom yang tidak
    dikirim tidak diubah)."""
    client_code: Optional[str] = Field(None, max_length=50)
    nama_client: Optional[str] = Field(None, min_length=1, max_length=255)
    tipe_badan_usaha: Optional[str] = Field(None, max_length=255)
    npwp: Optional[str] = Field(None, max_length=20)
    nomor_akta_nib: Optional[str] = Field(None, max_length=255)
    status_pkp: Optional[bool] = None
    klasifikasi_lapangan_usaha: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    no_telepon: Optional[str] = Field(None, max_length=255)
    no_handphone: Optional[str] = Field(None, max_length=255)
    nama_pic: Optional[str] = Field(None, max_length=255)
    jabatan_pic: Optional[str] = Field(None, max_length=255)
    alamat: Optional[str] = None
    kota: Optional[str] = Field(None, max_length=50)
    provinsi: Optional[str] = Field(None, max_length=50)
    kode_pos: Optional[str] = Field(None, max_length=255)
    industry: Optional[str] = Field(None, max_length=255)
    tahun_buku_mulai: Optional[str] = Field(None, max_length=10)
    mata_uang_default: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=10)
    akuntan_penanggung_jawab: Optional[str] = None
    tanggal_mulai_kerjasama: Optional[datetime] = None


# ============================================================
# ENDPOINTS
# ============================================================

@router.post(
    "",
    summary="Buat data klien baru (khusus Partner/Admin)",
    responses={
        201: {"description": "Client berhasil dibuat."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        403: {"description": "User yang login bukan role tahap_5 (Partner/Admin) atau super_admin."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_client(
    payload: ManagementClientCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(5)),
):
    """
    Buat data klien baru di `management_clients`.

    Dibatasi HANYA untuk role tahap_5 (Partner/Admin) -- atau super_admin
    -- sama seperti POST /api/v1/auth/register, karena data klien
    firm-wide ini adalah data administratif yang tidak boleh dibuat bebas
    oleh sembarang staf yang login.
    """
    dibuat = dbc.create_management_client(
        data=payload.model_dump(exclude_unset=True),
        created_by=current_user.get("id"),
    )
    if dibuat is None:
        return gagal(message="Gagal membuat data klien (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Data klien berhasil dibuat.", status_code=201)


@router.get(
    "",
    summary="Daftar data klien",
    responses={
        200: {"description": "OK."},
        401: {"description": "Token tidak dikirim / tidak valid."},
    },
)
def daftar_client(
    termasuk_nonaktif: bool = Query(False, description="Sertakan client yang sudah di-soft-delete."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    """Daftar semua data klien di `management_clients` (any authenticated user, cukup token valid)."""
    data = dbc.list_management_clients(termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/{client_id}",
    summary="Detail 1 data klien",
    responses={
        200: {"description": "OK."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        404: {"description": "Client tidak ditemukan."},
    },
)
def detail_client(
    client_id: str,
    termasuk_nonaktif: bool = Query(False, description="Tetap tampilkan meski sudah di-soft-delete."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_management_client_by_id(client_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/{client_id}",
    summary="Update data klien (khusus Partner/Admin)",
    responses={
        200: {"description": "Client berhasil diupdate."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        403: {"description": "User yang login bukan role tahap_5 (Partner/Admin) atau super_admin."},
        404: {"description": "Client tidak ditemukan."},
    },
)
def update_client(
    client_id: str,
    payload: ManagementClientUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(5)),
):
    """Update sebagian/semua kolom data klien. Field yang tidak dikirim tidak diubah."""
    diupdate = dbc.update_management_client(
        client_id,
        data=payload.model_dump(exclude_unset=True),
        updated_by=current_user.get("id"),
    )
    if diupdate is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Data klien berhasil diupdate.")


@router.delete(
    "/{client_id}",
    summary="Nonaktifkan (soft-delete) data klien (khusus Partner/Admin)",
    responses={
        200: {"description": "Client berhasil dinonaktifkan."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        403: {"description": "User yang login bukan role tahap_5 (Partner/Admin) atau super_admin."},
        404: {"description": "Client tidak ditemukan."},
    },
)
def hapus_client(
    client_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(5)),
):
    """Soft-delete (isi deleted_at/deleted_by) -- data TIDAK dihapus permanen dari database."""
    berhasil = dbc.soft_delete_management_client(client_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Data klien berhasil dinonaktifkan.")
