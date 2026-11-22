"""
modules/financial_statements/adjustment_v1.py
==============================================
Report "Adjustment" (Jurnal Penyesuaian) -- halaman src/app/reports/adjustment:

    GET /api/v1/reports/adjustment

Sumber data = SAMA dengan General Ledger & Trial Balance
(db_client.ambil_baris_jurnal_posted_transaksi, termasuk jurnal penutup agar
saldo "Unadjusted/Adjusted" konsisten dengan Trial Balance). Jurnal penyesuaian =
Journal Entry bertanda `is_adjustment` (migrations/63, checkbox "Adjusting entry"
di form New Journal Entry). Mesin hitung: adjustment_core.py.

`status_filter`:
    all     (default) semua jurnal di Journal Preview (draft/pending/approved/posted)
    posted  hanya yang sudah POSTED (angka resmi)
Daftar tahun yang punya transaksi: pakai GET /api/v1/reports/trial-balance/periods.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import adjustment_core as adj
from .general_ledger_v1 import _info_akun
from .v1 import _filter_pemilik

logger = get_module_logger("adjustment_v1")

router = APIRouter(prefix="/api/v1/reports/adjustment", tags=["reports-adjustment-v1"])


@router.get("", summary="Jurnal penyesuaian + efeknya ke Trial Balance (Unadjusted -> ADJ -> Adjusted)")
def laporan_adjustment(
    year: Optional[int] = Query(None, ge=1900, le=9999, description="Tahun buku. Default: tahun terbaru yang punya transaksi."),
    end_month: Optional[int] = Query(None, ge=1, le=12, description="Bulan terakhir. Default: 12."),
    status_filter: str = Query("all", description="all (semua yang ada di Journal Preview) | posted (hanya posted)"),
    management_client_id: Optional[str] = Query(None, description="id management_clients (klien); filter utama"),
    client_id: Optional[str] = Query(None, description="id_user management_users; default user yang login kalau management_client_id kosong"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if status_filter not in adj.MODE_STATUS:
        return gagal(message=f"status_filter harus salah satu dari: {', '.join(adj.MODE_STATUS)}.", errors={"code": "INVALID_STATUS_FILTER"}, status_code=400)
    filter_, error = _filter_pemilik(client_id, management_client_id, current_user)
    if error is not None:
        return error

    hanya_posted = status_filter == "posted"
    try:
        if year is None:
            semua = dbc.ambil_baris_jurnal_posted_transaksi(termasuk_belum_posted=not hanya_posted, termasuk_penutup=True, **filter_)
            tahun_data = [b["tanggal"].year for b in semua if b.get("tanggal")]
            year = max(tahun_data) if tahun_data else date.today().year
        bulan = end_month or 12
        baris = dbc.ambil_baris_jurnal_posted_transaksi(
            sampai_tanggal=adj.akhir_bulan(year, bulan), termasuk_belum_posted=not hanya_posted, termasuk_penutup=True, **filter_,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca transaksi untuk report adjustment: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)

    coa = dbc.list_management_client_coa(filter_["management_client_id"]) if filter_["management_client_id"] else []
    coa_per_kode = {str(c["acc_no"]).strip(): c for c in coa if c.get("acc_no")}
    data = adj.susun_adjustment(baris, lambda kode, nama: _info_akun(kode, nama, coa_per_kode.get(kode)), year, bulan)
    data["filter"] = {"status_filter": status_filter, **filter_}
    return sukses(data=data, message="OK")
