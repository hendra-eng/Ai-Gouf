"""
modules/financial_statements/v1.py
====================================
Fitur "Financial Statements" versi REST API standar:
/api/v1/financial-statements/...

Standar SAMA dengan modules/transactions/*_v1.py:
    - Response amplop {status, message, data, errors} (modules/api_response.py).
    - Autentikasi ditegakkan middleware `jwt_v1_middleware` (grup /api/v1/**);
      semua endpoint di sini READ-ONLY, cukup token valid.
    - client_id = id_user management_users (akun yang login), sama persis
      dengan filter tab Transactions (Sales/Journal Entry/Purchase). Kalau
      tidak dikirim, default ke user yang sedang login.

Sumber data: HANYA transaksi berstatus Posted dari tabel fitur
Transactions (db_client.ambil_baris_jurnal_posted_transaksi). Perhitungan
ada di modules/financial_statements/core.py.

Endpoint (semua GET, query: client_id?, tahun?, sampai_bulan?):
    /                    -> kelima laporan + neraca saldo sekaligus
    /periods             -> tahun-tahun yang punya transaksi posted
    /trial-balance       -> neraca saldo per akun
    /profit-loss         -> laporan laba rugi
    /balance-sheet       -> neraca (laporan posisi keuangan)
    /cash-flow           -> arus kas (metode langsung + tidak langsung)
    /changes-in-equity   -> laporan perubahan ekuitas
    /notes               -> catatan atas laporan keuangan (CALK)
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import core

logger = get_module_logger("financial_statements_v1")

router = APIRouter(prefix="/api/v1/financial-statements", tags=["financial-statements-v1"])

_RESPONSES = {200: {"description": "OK."}, 400: {"description": "Parameter tidak valid."}, 401: {"description": "Unauthorized."}}


def _client_id_valid(client_id: Optional[str], current_user: Dict[str, Any]) -> Optional[str]:
    """client_id dari query atau user login; None kalau bukan UUID valid."""
    nilai = client_id or current_user.get("id")
    try:
        return str(uuid.UUID(str(nilai)))
    except (ValueError, TypeError):
        return None


def _hitung(client_id: Optional[str], tahun: Optional[int], sampai_bulan: Optional[int],
            nama_perusahaan: Optional[str], current_user: Dict[str, Any]):
    """Return (laporan, None) atau (None, response gagal)."""
    cid = _client_id_valid(client_id, current_user)
    if cid is None:
        return None, gagal(message="client_id tidak valid.", errors={"code": "INVALID_CLIENT_ID"}, status_code=400)
    tahun = tahun or date.today().year
    try:
        # Transaksi sesudah periode laporan tidak perlu dibaca sama sekali.
        baris = dbc.ambil_baris_jurnal_posted_transaksi(cid, core.akhir_bulan(tahun, sampai_bulan or 12))
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca transaksi posted untuk laporan keuangan: %s", e)
        return None, gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    laporan = core.susun_laporan_keuangan(baris, tahun, sampai_bulan, nama_perusahaan)
    laporan["periode"]["client_id"] = cid
    return laporan, None


def _endpoint_laporan(kunci: Optional[str]):
    def handler(
        client_id: Optional[str] = Query(None, description="id_user management_users; default user yang login"),
        tahun: Optional[int] = Query(None, ge=1900, le=9999, description="Default tahun berjalan"),
        sampai_bulan: Optional[int] = Query(None, ge=1, le=12, description="Default bulan terakhir yang ada transaksi posted"),
        nama_perusahaan: Optional[str] = Query(None, max_length=255, description="Dipakai di narasi CALK"),
        current_user: Dict[str, Any] = Depends(get_current_user_v1),
    ):
        laporan, error = _hitung(client_id, tahun, sampai_bulan, nama_perusahaan, current_user)
        if error is not None:
            return error
        data = laporan if kunci is None else {"periode": laporan["periode"], kunci: laporan[kunci]}
        return sukses(data=data, message="OK")
    return handler


for _path, _kunci, _ringkas in [
    ("", None, "Semua laporan keuangan (Laba Rugi, Neraca, Arus Kas, Perubahan Ekuitas, CALK) + neraca saldo"),
    ("/trial-balance", "trial_balance", "Neraca saldo per akun"),
    ("/profit-loss", "profit_loss", "Laporan Laba Rugi"),
    ("/balance-sheet", "balance_sheet", "Neraca (Laporan Posisi Keuangan)"),
    ("/cash-flow", "cash_flow", "Laporan Arus Kas (metode langsung & tidak langsung)"),
    ("/changes-in-equity", "changes_in_equity", "Laporan Perubahan Ekuitas"),
    ("/notes", "notes", "Catatan atas Laporan Keuangan (CALK)"),
]:
    router.add_api_route(_path, _endpoint_laporan(_kunci), methods=["GET"], summary=_ringkas, responses=_RESPONSES,
                         name=f"financial_statements{_path.replace('/', '_').replace('-', '_') or '_semua'}")


@router.get("/periods", summary="Tahun-tahun yang punya transaksi posted", responses=_RESPONSES)
def daftar_periode(
    client_id: Optional[str] = Query(None, description="id_user management_users; default user yang login"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    cid = _client_id_valid(client_id, current_user)
    if cid is None:
        return gagal(message="client_id tidak valid.", errors={"code": "INVALID_CLIENT_ID"}, status_code=400)
    try:
        baris = dbc.ambil_baris_jurnal_posted_transaksi(cid)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca periode laporan keuangan: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    per_tahun: Dict[int, set] = {}
    for b in baris:
        if b.get("tanggal"):
            per_tahun.setdefault(b["tanggal"].year, set()).add(b["tanggal"].month)
    tahun = [{"tahun": t, "bulan_terakhir": max(bln), "bulan_aktif": sorted(bln)} for t, bln in sorted(per_tahun.items(), reverse=True)]
    return sukses(data={"client_id": cid, "tahun": tahun, "default_tahun": tahun[0]["tahun"] if tahun else date.today().year}, message="OK")
