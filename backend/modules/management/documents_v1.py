"""
modules/management/documents_v1.py
====================================
Fitur Documents versi REST API standar: /api/v1/management/documents/...

Sebelumnya logic Documents (baca saja) numpuk langsung di main.py sebagai
GET /api/v1/management/getDocuments -- endpoint itu memang sudah pakai
path bergaya v1, tapi:
    - Tidak ada di folder modules/management/ (masih di file datar main.py)
    - Response-nya bentuk bebas ({"documents": [...]})  bukan amplop
      standar {status,message,data,errors}
    - Tidak ada fitur TULIS sama sekali -- tombol "Upload" di
      src/app/documents/components/DocumentsPageClient.tsx masih
      toast.info() doang, tidak pernah nyimpen apa-apa ke database.

File ini melengkapi itu: dipindah ke folder modules/management/ (pola
sama dengan modules/auth/v1.py), dibungkus amplop standar, DITAMBAH 2
endpoint tulis baru (create + update status). GET lama di main.py
SENGAJA belum dihapus (biar tidak ada yang tiba-tiba 404 kalau frontend
belum sempat dipindah ke path baru) -- lihat main.py untuk endpoint lama.

Autentikasi: get_current_user_v1 (JWT wajib, lewat jwt_v1_middleware --
BUKAN Depends(auth.get_current_user) yang dipakai endpoint lama main.py).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger

logger = get_module_logger("management_documents_v1")

router = APIRouter(prefix="/api/v1/management/documents", tags=["management-documents-v1"])


# ============================================================
# SKEMA REQUEST
# ============================================================

class TambahDokumenRequest(BaseModel):
    client_id: str
    name: str = Field(..., min_length=1, max_length=200)
    category: Optional[str] = None  # Invoice/Receipt/Bank Statement/Tax Document/Contract/Audit Evidence/Financial Report/Other
    file_format: Optional[str] = None  # PDF/Excel/Image/CSV/Word
    file_size: Optional[str] = None  # mis. "2.4 MB", disimpan sbg teks
    storage_url: Optional[str] = None  # link file di storage (diisi setelah upload fisik selesai)
    tags: Optional[str] = None  # dipisah koma
    related_record: Optional[str] = None  # mis. nomor invoice/PO terkait


class UbahStatusDokumenRequest(BaseModel):
    status: str  # Processed/Pending Review/Needs Attention/Archived


# ============================================================
# ENDPOINTS
# ============================================================

@router.get(
    "",
    summary="Daftar dokumen milik satu client",
    responses={200: {"description": "OK."}},
)
def daftar_dokumen(
    client_id: str = Query(..., description="UUID client"),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    """Semua dokumen milik `client_id`, terbaru duluan."""
    dokumen: List[Dict[str, Any]] = dbc.ambil_data_documents(client_id)
    return sukses(data={"documents": dokumen}, message="OK")


@router.post(
    "",
    summary="Catat dokumen baru (tombol \"Upload\")",
    responses={
        201: {"description": "Dokumen berhasil dicatat."},
        422: {"description": "Payload tidak valid (mis. nama kosong, kategori/format tidak dikenal)."},
    },
)
def tambah_dokumen(
    payload: TambahDokumenRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    """
    Catat metadata dokumen baru. File fisiknya sendiri TIDAK diunggah lewat
    endpoint ini -- kalau upload ke storage (mis. Supabase Storage)
    dilakukan terpisah oleh frontend, isi `storage_url` dengan link hasil
    upload itu. Kalau belum ada, boleh dikosongkan dulu dan dokumen tetap
    tercatat berstatus "Pending Review".
    """
    try:
        hasil = dbc.tambah_dokumen(
            client_id=payload.client_id, name=payload.name, category=payload.category,
            file_format=payload.file_format, file_size=payload.file_size,
            storage_url=payload.storage_url, tags=payload.tags,
            related_record=payload.related_record,
            uploaded_by=current_user.get("nama") or current_user.get("username"),
        )
    except ValueError as e:
        return gagal(message=str(e), status_code=422)
    dbc.log_audit(
        client_id=payload.client_id, user=current_user.get("username", "unknown"),
        aksi="tambah_dokumen", detail={"name": payload.name, "category": payload.category},
    )
    return sukses(data=hasil, message="Dokumen berhasil dicatat.", status_code=201)


@router.patch(
    "/{document_id}/status",
    summary="Ubah status dokumen",
    responses={
        200: {"description": "Status berhasil diubah."},
        404: {"description": "Dokumen tidak ditemukan untuk client ini."},
        422: {"description": "Status tidak dikenal."},
    },
)
def ubah_status_dokumen(
    document_id: str,
    payload: UbahStatusDokumenRequest,
    client_id: str = Query(..., description="UUID client (pemilik dokumen)"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        hasil = dbc.ubah_status_dokumen(client_id=client_id, document_id=document_id, status=payload.status)
    except ValueError as e:
        status_code = 404 if "tidak ditemukan" in str(e) else 422
        return gagal(message=str(e), status_code=status_code)
    dbc.log_audit(
        client_id=client_id, user=current_user.get("username", "unknown"),
        aksi="ubah_status_dokumen", detail={"document_id": document_id, "status": payload.status},
    )
    return sukses(data=hasil, message="Status dokumen berhasil diubah.")