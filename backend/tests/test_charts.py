"""
tests/test_charts.py
=====================
Unit test untuk dashboard visual (modules/charts.py). Hanya mengecek Figure
berhasil dibuat / None secara wajar, tidak mengecek tampilan visualnya.
"""

import pandas as pd
import pytest

from modules.charts import (
    chart_tren_transaksi_harian,
    chart_distribusi_akun,
    chart_perbandingan_bank,
    chart_arus_kas_kumulatif,
    chart_status_kategorisasi,
    buat_semua_chart,
)

plotly = pytest.importorskip("plotly")


@pytest.fixture
def df_bank():
    return pd.DataFrame({
        "tanggal": ["2026-07-01", "2026-07-02", "2026-07-03"],
        "bank": ["BCA", "BCA", "BRI"],
        "nama_akun_debet": ["BEBAN LISTRIK", "BEBAN LISTRIK", "KAS"],
        "jml_debet": [100000, 200000, 150000],
        "jml_kredit": [100000, 200000, 150000],
        "sumber_kategori": ["Sesuai Pola", "AI (DeepSeek)", "Belum Terkategori"],
    })


class TestCharts:
    def test_chart_tren_harian(self, df_bank):
        fig = chart_tren_transaksi_harian(df_bank)
        assert fig is not None

    def test_chart_distribusi_akun(self, df_bank):
        fig = chart_distribusi_akun(df_bank)
        assert fig is not None

    def test_chart_perbandingan_bank(self, df_bank):
        fig = chart_perbandingan_bank(df_bank)
        assert fig is not None

    def test_chart_arus_kas(self, df_bank):
        fig = chart_arus_kas_kumulatif(df_bank)
        assert fig is not None

    def test_chart_status_kategorisasi(self, df_bank):
        fig = chart_status_kategorisasi(df_bank)
        assert fig is not None

    def test_chart_dengan_data_kosong(self):
        assert chart_tren_transaksi_harian(pd.DataFrame()) is None
        assert chart_distribusi_akun(None) is None

    def test_buat_semua_chart(self, df_bank):
        hasil = buat_semua_chart(df_bank)
        assert isinstance(hasil, dict)
        assert "tren_harian" in hasil
        assert "arus_kas" in hasil