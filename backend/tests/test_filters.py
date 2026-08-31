"""
tests/test_filters.py
======================
Unit test untuk filter & pencarian lanjutan (modules/filters.py).
"""

import pandas as pd
import pytest

from modules.filters import filter_dataframe, opsi_bank, opsi_sumber_kategori


@pytest.fixture
def df_transaksi():
    return pd.DataFrame({
        "tanggal": ["2026-07-01", "2026-07-15", "2026-08-01"],
        "keterangan": ["PLNPOST001", "TRANSFER MASUK GAJI", "PLNPOST002"],
        "bank": ["BCA", "BRI", "BCA"],
        "jml_debet": [100000, 0, 5_000_000],
        "jml_kredit": [0, 3_000_000, 0],
        "sumber_kategori": ["Sesuai Pola", "AI (DeepSeek)", "Belum Terkategori"],
    })


class TestFilterNominal:
    def test_filter_nominal_min(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, nominal_min=1_000_000)
        assert len(hasil) == 2  # gaji 3jt & PLN 5jt

    def test_filter_nominal_max(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, nominal_max=200000)
        assert len(hasil) == 1


class TestFilterTanggal:
    def test_filter_rentang_tanggal(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, tanggal_mulai="2026-07-10", tanggal_akhir="2026-07-31")
        assert len(hasil) == 1


class TestFilterKataKunci:
    def test_pencarian_kata_kunci(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, kata_kunci="PLN")
        assert len(hasil) == 2

    def test_pencarian_case_insensitive(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, kata_kunci="pln")
        assert len(hasil) == 2


class TestFilterBankDanSumber:
    def test_filter_bank(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, bank=["BCA"])
        assert len(hasil) == 2

    def test_filter_sumber_kategori(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, sumber_kategori=["Belum Terkategori"])
        assert len(hasil) == 1

    def test_opsi_bank(self, df_transaksi):
        assert set(opsi_bank(df_transaksi)) == {"BCA", "BRI"}

    def test_opsi_sumber_kategori(self, df_transaksi):
        assert "Sesuai Pola" in opsi_sumber_kategori(df_transaksi)


class TestFilterGabungan:
    def test_kombinasi_filter(self, df_transaksi):
        hasil = filter_dataframe(df_transaksi, bank=["BCA"], kata_kunci="PLN", nominal_min=1_000_000)
        assert len(hasil) == 1

    def test_data_kosong(self):
        assert filter_dataframe(pd.DataFrame()).empty
        assert filter_dataframe(None) is None