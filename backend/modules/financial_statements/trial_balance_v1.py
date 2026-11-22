"""
modules/financial_statements/trial_balance_v1.py
==================================================
Report "Trial Balance" (Neraca Saldo) -- halaman src/app/reports/trial-balance:

    GET /api/v1/reports/trial-balance            TB per akun, per bulan (Jan..bulan akhir) + YTD
    GET /api/v1/reports/trial-balance/periods    tahun-tahun yang punya transaksi (semua status)

Sumber data = SAMA dengan General Ledger: db_client.ambil_baris_jurnal_posted_transaksi
(Journal Entry termasuk Opening Balance, Cash & Bank, Sales, Purchase, Fixed Assets,
Inventory, Other, dan jurnal penutup tahun).

`status_filter`:
    all     (default) semua transaksi yang sudah masuk Journal Preview -- draft / pending /
            approved / posted -- langsung masuk TB tanpa menunggu Post, sama seperti
            General Ledger. Yang rejected / void / cancelled / dihapus tidak ikut.
    posted  hanya transaksi POSTED (angka resmi, sama dengan Financial Statements).

Respons membawa `status_summary` (jumlah jurnal/baris/nominal per status) dan per akun
`unposted_debit/unposted_kredit`, jadi pengguna tahu bagian TB yang belum di-post.
Mesin hitung & aturan saldo: trial_balance_core.py (murni Python, mudah dites).
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import trial_balance_core as tbc
from .v1 import _filter_pemilik

logger = get_module_logger("trial_balance_v1")

router = APIRouter(prefix="/api/v1/reports/trial-balance", tags=["reports-trial-balance-v1"])


def _baca_baris(filter_: Dict[str, Optional[str]], sampai: Optional[date], hanya_posted: bool):
    return dbc.ambil_baris_jurnal_posted_transaksi(
        sampai_tanggal=sampai,
        termasuk_belum_posted=not hanya_posted,
        termasuk_penutup=True,
        **filter_,
    )


@router.get("", summary="Trial Balance per akun per bulan (Jan..bulan akhir) + YTD")
def trial_balance(
    year: Optional[int] = Query(None, ge=1900, le=9999, description="Tahun buku. Default: tahun terbaru yang punya transaksi."),
    end_month: Optional[int] = Query(None, ge=1, le=12, description="Bulan terakhir. Default: bulan terakhir yang ada transaksi di tahun itu."),
    include: str = Query("non_zero", description="non_zero | with_activity | all"),
    status_filter: str = Query("all", description="all (semua yang ada di Journal Preview) | posted (hanya posted)"),
    management_client_id: Optional[str] = Query(None, description="id management_clients (klien); filter utama"),
    client_id: Optional[str] = Query(None, description="id_user management_users; default user yang login kalau management_client_id kosong"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if include not in tbc.MODE_INCLUDE:
        return gagal(message=f"include harus salah satu dari: {', '.join(tbc.MODE_INCLUDE)}.", errors={"code": "INVALID_INCLUDE"}, status_code=400)
    if status_filter not in tbc.MODE_STATUS:
        return gagal(message=f"status_filter harus salah satu dari: {', '.join(tbc.MODE_STATUS)}.", errors={"code": "INVALID_STATUS_FILTER"}, status_code=400)

    filter_, error = _filter_pemilik(client_id, management_client_id, current_user)
    if error is not None:
        return error
    hanya_posted = status_filter == "posted"
    try:
        if year is None:
            baris = _baca_baris(filter_, None, hanya_posted)
            tahun_data = [b["tanggal"].year for b in baris if b.get("tanggal")]
            year = max(tahun_data) if tahun_data else date.today().year
        else:
            baris = _baca_baris(filter_, tbc.akhir_bulan(year, end_month or 12), hanya_posted)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca transaksi untuk trial balance: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)

    coa = dbc.list_management_client_coa(filter_["management_client_id"]) if filter_["management_client_id"] else []
    sampai_bulan = end_month or tbc.tentukan_sampai_bulan(baris, year)
    data = tbc.susun_trial_balance(baris, coa, year, sampai_bulan, include)
    data["filter"] = {"status_filter": status_filter, **filter_}
    return sukses(data=data, message="OK")


@router.get("/periods", summary="Tahun yang punya transaksi (semua status kecuali rejected/void/cancelled)")
def periode_trial_balance(
    status_filter: str = Query("all", description="all | posted"),
    management_client_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if status_filter not in tbc.MODE_STATUS:
        return gagal(message=f"status_filter harus salah satu dari: {', '.join(tbc.MODE_STATUS)}.", errors={"code": "INVALID_STATUS_FILTER"}, status_code=400)
    filter_, error = _filter_pemilik(client_id, management_client_id, current_user)
    if error is not None:
        return error
    try:
        baris = _baca_baris(filter_, None, status_filter == "posted")
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca periode trial balance: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    per_tahun: Dict[int, set] = {}
    for b in baris:
        if b.get("tanggal"):
            per_tahun.setdefault(b["tanggal"].year, set()).add(b["tanggal"].month)
    tahun = [{"year": t, "last_month": max(bln), "active_months": sorted(bln)} for t, bln in sorted(per_tahun.items(), reverse=True)]
    return sukses(data={**filter_, "years": tahun, "default_year": tahun[0]["year"] if tahun else date.today().year}, message="OK")