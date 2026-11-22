"""
modules/financial_statements/isi_ai_v1.py
==========================================
Endpoint "Isi AI" untuk tombol Download Excel di halaman Reports (src/app/reports):

    POST /api/v1/reports/ai-fill          kerjakan satu kelompok item (party | catatan | catatan_pnl)
    GET  /api/v1/reports/ai-fill/status   konfigurasi aktif + pemakaian token (tanpa rahasia)

Seluruh logika (cache, anggaran token, pemutus, validasi) ada di isi_ai_core.py.
Frontend memanggil endpoint ini dari src/lib/reportsAiFill.ts, per kelompok <= 60 item.
Kegagalan di sini TIDAK boleh menggagalkan download: frontend tetap mengunduh file dengan sel kosong.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import isi_ai_core as core
from .v1 import _filter_pemilik

logger = get_module_logger("isi_ai_v1")

router = APIRouter(prefix="/api/v1/reports/ai-fill", tags=["reports-ai-fill-v1"])


class PermintaanIsiAi(BaseModel):
    management_client_id: str = Field(..., description="id management_clients (PT yang dipilih di halaman Reports)")
    tugas: str = Field(..., description="party | catatan | catatan_pnl")
    id_unduhan: Optional[str] = Field(None, max_length=64, description="id unik satu kali klik Download (untuk batas token per unduhan)")
    items: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("", summary="Isi sel kosong laporan dengan bantuan AI (hemat token, ber-cache, ber-anggaran)")
def isi_ai(body: PermintaanIsiAi, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    if body.tugas not in core.TUGAS_VALID:
        return gagal(message=f"tugas harus salah satu dari: {', '.join(core.TUGAS_VALID)}.", errors={"code": "INVALID_TUGAS"}, status_code=400)
    filter_, error = _filter_pemilik(None, body.management_client_id, current_user)
    if error is not None:
        return error
    klien = filter_["management_client_id"]
    if not klien:
        return gagal(message="Pilih company terlebih dahulu.", errors={"code": "MANAGEMENT_CLIENT_REQUIRED"}, status_code=400)
    try:
        data = core.proses_permintaan(klien, body.tugas, body.items, body.id_unduhan)
    except Exception as e:  # noqa: BLE001
        logger.exception("Isi-AI gagal tak terduga (%s): %s", body.tugas, e)
        return gagal(message="Pengisian AI gagal diproses.", errors={"code": "AI_FILL_ERROR"}, status_code=500)
    return sukses(data=data, message="OK")


@router.get("/status", summary="Konfigurasi dan pemakaian token isi-AI")
def status_isi_ai(current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    k = core.ambil_konfigurasi()
    p = core._anggaran_default.pemakaian(None)  # noqa: SLF001
    return sukses(data={
        "aktif": k.aktif,
        "model_ringan": k.model_ringan,
        "model_analisis": k.model_analisis,
        "batas": {"token_unduhan": k.batas_token_unduhan, "token_hari": k.batas_token_hari, "token_bulan": k.batas_token_bulan},
        "terpakai": {"token_hari": p["token_hari"], "token_bulan": p["token_bulan"]},
        "pemutus_terbuka": not core._pemutus_default.boleh(),  # noqa: SLF001
    }, message="OK")