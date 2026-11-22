"""
modules/financial_statements/saldo_rk_v1.py
===========================================
Saldo Rekening Koran (RK) untuk kolom "Saldo RK" di sheet TB pada Download Excel halaman Reports (src/app/reports):

    GET /api/v1/reports/bank-statement-balances?management_client_id=...&year=2026&end_month=10

Tanpa AI: saldo akhir sudah tersimpan saat rekening koran diunggah di Bank & Cash
(tabel financial_transaction_bank_cash_statements, kolom closing_balance), jadi cukup dibaca.
Per akun bank diambil rekening koran TERBARU yang periodenya berakhir pada / sebelum akhir periode laporan
(atau yang tanggal periodenya kosong, bila tidak ada yang bertanggal).

Tiap akun diberi `status` (aturan lengkap di saldo_rk_core.py): ok / belum_akhir_periode / saldo_tidak_terbaca /
periode_tidak_terbaca / valas. Frontend hanya menghitung selisih untuk status "ok"; sisanya diberi penanda.
Rekening koran terbaru yang saldonya kosong TIDAK diganti diam-diam dengan saldo bulan yang lebih lama.
Kegagalan di sini TIDAK boleh menggagalkan download (frontend tetap mengunduh dengan kolom kosong).
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from .saldo_rk_core import TOLERANSI_HARI, akhir_periode, bentuk_baris
from .v1 import _filter_pemilik

logger = get_module_logger("saldo_rk_v1")

router = APIRouter(prefix="/api/v1/reports/bank-statement-balances", tags=["reports-bank-statement-balances-v1"])

T_STMT = "financial_transaction_bank_cash_statements"
T_COA = "management_client_coa"
T_FX = "finance_fx_bank_accounts"

# Per akun bank: rekening koran dengan period_end terbaru (<= akhir periode; yang period_end-nya kosong paling akhir).
# Bila ada dua RK dengan period_end sama, yang saldonya terisi didahulukan. RK terbaru yang saldonya kosong TIDAK dilewati:
# saldo dari bulan yang lebih lama bukan saldo per akhir periode, jadi menampilkannya akan menyesatkan.
_SQL = f"""
SELECT DISTINCT ON (s.bank_coa_id)
       s.bank_coa_id AS coa_id,
       COALESCE(NULLIF(c.source_acc_no, ''), c.acc_no) AS kode,
       c.acc_no AS kode_sistem,
       c.account_name AS nama,
       s.closing_balance AS saldo,
       s.period_end AS periode_akhir,
       s.file_name AS nama_file
  FROM {T_STMT} s
  JOIN {T_COA} c ON c.id = s.bank_coa_id
 WHERE s.client_id = :klien
   AND s.deleted_at IS NULL
   AND (s.period_end IS NULL OR s.period_end <= :batas)
 ORDER BY s.bank_coa_id,
          s.period_end DESC NULLS LAST,
          (s.closing_balance IS NOT NULL) DESC,
          s.created_at DESC
"""

_SQL_ADA_TABEL_FX = text("SELECT to_regclass(:nama) IS NOT NULL")
_SQL_FX = text(f"SELECT coa_id, currency FROM {T_FX} WHERE client_id = :klien")


def peta_valas(session: Any, klien: str) -> Dict[str, str]:
    """{coa_id: kode mata uang} untuk rekening kas/bank valas klien. Database tanpa tabel valas (migration 59 belum
    dijalankan) = belum ada akun valas = {}. Error lain sengaja DILEMPAR: lebih baik kolom Saldo RK kosong daripada
    akun valas dibandingkan seolah-olah rupiah."""
    if not session.execute(_SQL_ADA_TABEL_FX, {"nama": T_FX}).scalar():
        return {}
    return {str(coa): str(cur or "").upper() for coa, cur in session.execute(_SQL_FX, {"klien": klien}).all()}


@router.get("", summary="Saldo akhir rekening koran per akun bank sampai akhir periode laporan")
def saldo_rekening_koran(
    management_client_id: str = Query(..., description="id management_clients (PT yang dipilih di halaman Reports)"),
    year: int = Query(..., ge=2000, le=2100),
    end_month: int = Query(..., ge=1, le=12),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    filter_, error = _filter_pemilik(None, management_client_id, current_user)
    if error is not None:
        return error
    klien = filter_["management_client_id"]
    if not klien:
        return gagal(message="Pilih company terlebih dahulu.", errors={"code": "MANAGEMENT_CLIENT_REQUIRED"}, status_code=400)
    batas = akhir_periode(year, end_month)
    try:
        with dbc.SessionLocal() as s:
            valas = peta_valas(s, klien)
            baris: List[Dict[str, Any]] = [bentuk_baris(dict(r), batas, valas) for r in s.execute(text(_SQL), {"klien": klien, "batas": batas}).mappings()]
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca saldo rekening koran: %s", e)
        return gagal(message="Saldo rekening koran gagal dibaca.", errors={"code": "BANK_BALANCE_ERROR"}, status_code=500)
    return sukses(data={"as_of": batas.isoformat(), "tolerance_days": TOLERANSI_HARI, "accounts": baris}, message="OK")
