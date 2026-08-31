"""
modules/history.py
===================
Riwayat perubahan (audit trail): mencatat SIAPA mengubah APA dan KAPAN.
Butuh tabel `audit_log` di database (lihat db_client.py::init_db). Kalau
database tidak aktif, pencatatan dilewati secara diam-diam (tidak boleh
menggagalkan alur utama aplikasi).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from .logging_config import get_module_logger

logger = get_module_logger("history")


def catat_riwayat(
    client_id: Optional[int],
    user: str,
    aksi: str,
    detail: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Catat satu entri riwayat perubahan.

    Args:
        client_id: id client (boleh None kalau belum ada konsep client aktif)
        user: username yang melakukan aksi
        aksi: deskripsi singkat aksi, mis. "koreksi_jurnal", "upload_file", "hapus_baris"
        detail: dict bebas berisi konteks (mis. {"row": 3, "before": ..., "after": ...})

    Returns:
        bool sukses/tidak (tidak melempar exception ke caller)
    """
    try:
        import db_client as dbc
        dbc.log_audit(client_id=client_id, user=user, aksi=aksi, detail=detail or {})
        return True
    except Exception as e:
        logger.warning(f"Gagal mencatat riwayat ke database ({e}); dilewati.")
        return False


def ambil_riwayat(client_id: Optional[int] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """Ambil riwayat perubahan terbaru (kosong kalau database tidak aktif)."""
    try:
        import db_client as dbc
        return dbc.get_audit_history(client_id=client_id, limit=limit)
    except Exception as e:
        logger.warning(f"Gagal mengambil riwayat dari database ({e}).")
        return []


def bandingkan_perubahan(sebelum: Dict[str, Any], sesudah: Dict[str, Any]) -> Dict[str, Any]:
    """Bandingkan dua dict (mis. baris jurnal sebelum/sesudah koreksi), hasil dict {field: {from, to}}."""
    perubahan = {}
    semua_key = set(sebelum.keys()) | set(sesudah.keys())
    for key in semua_key:
        nilai_lama = sebelum.get(key)
        nilai_baru = sesudah.get(key)
        if nilai_lama != nilai_baru:
            perubahan[key] = {"from": nilai_lama, "to": nilai_baru}
    return perubahan