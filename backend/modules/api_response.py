"""
modules/api_response.py
========================
Amplop (envelope) response standar untuk endpoint REST API versi baru
(grup /api/v1/...):

    {
        "status": "success" | "error",
        "message": "...",
        "data": <apa saja, null kalau error>,
        "errors": <detail error, null kalau sukses>
    }

Dipakai supaya konsumen API (frontend, dokumentasi, integrasi pihak
ketiga) selalu tahu bentuk response tanpa harus baca kode tiap endpoint.

Endpoint LAMA (semua yang bukan di bawah /api/v1/...) SENGAJA TIDAK
diubah ke format ini -- sudah dipakai frontend dengan bentuk response
masing-masing, mengubahnya berisiko breaking change di luar scope fitur
auth ini.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def sukses(data: Any = None, message: str = "OK", status_code: int = 200) -> JSONResponse:
    """Bungkus response sukses ke amplop standar."""
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "success",
            "message": message,
            "data": jsonable_encoder(data),
            "errors": None,
        },
    )


def gagal(
    message: str = "Terjadi kesalahan.",
    errors: Optional[Any] = None,
    status_code: int = 400,
) -> JSONResponse:
    """Bungkus response gagal ke amplop standar."""
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "error",
            "message": message,
            "data": None,
            "errors": jsonable_encoder(errors) if errors is not None else None,
        },
    )
