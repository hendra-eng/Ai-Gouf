"""
tests/test_saldo_rk_v1.py
=========================
Saldo Rekening Koran untuk kolom "Saldo RK" di sheet TB (modules/financial_statements/saldo_rk_v1.py).
Murni logika -- tanpa database: yang diuji hanya penentuan batas periode, bentuk JSON, dan isi query.
"""

import os
from datetime import date
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

from modules.financial_statements import saldo_rk_v1 as rk


def test_akhir_periode_hari_terakhir_bulan():
    assert rk.akhir_periode(2026, 10) == date(2026, 10, 31)
    assert rk.akhir_periode(2026, 2) == date(2026, 2, 28)
    assert rk.akhir_periode(2028, 2) == date(2028, 2, 29)  # tahun kabisat


def test_bentuk_baris_saldo_angka_dan_tanggal_iso():
    b = rk.bentuk_baris({"kode": "1110", "kode_sistem": "1-1110", "nama": "Bank BCA", "saldo": Decimal("1234567.50"),
                         "periode_akhir": date(2026, 10, 31), "nama_file": "bca_okt.pdf"})
    assert b["saldo"] == 1234567.5 and isinstance(b["saldo"], float)
    assert b["periode_akhir"] == "2026-10-31"
    assert b["kode"] == "1110" and b["kode_sistem"] == "1-1110"


def test_query_hanya_rekening_koran_aktif_sampai_batas_dan_terbaru_per_akun():
    q = rk._SQL
    assert "deleted_at IS NULL" in q            # rekening koran yang dihapus tidak dipakai
    assert "period_end <= :batas" in q          # tidak melewati akhir periode laporan
    assert "DISTINCT ON (s.bank_coa_id)" in q   # satu baris per akun bank
    assert "period_end DESC" in q               # yang terbaru dulu
    assert "closing_balance IS NOT NULL" in q   # saldo yang tidak terbaca tidak dipakai


def test_router_terdaftar_di_path_yang_benar():
    assert [r.path for r in rk.router.routes] == ["/api/v1/reports/bank-statement-balances"]
