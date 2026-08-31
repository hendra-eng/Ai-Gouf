"""
tests/test_integration.py
==========================
Integration test (E2E) untuk alur LENGKAP: data mentah -> proses/kategorisasi
-> validasi -> export ke format akuntansi standar.

Tidak menyentuh Streamlit atau API eksternal (DeepSeek) sama sekali -- murni
memanggil fungsi-fungsi di akuntansi_ai.py dan modules/ secara langsung,
persis seperti yang dilakukan app.py di baliknya.
"""

import pandas as pd
import pytest

import akuntansi_ai as ak
from modules.accounting_export import (
    generate_jurnal_umum,
    generate_neraca_saldo,
    generate_buku_besar,
    cek_neraca_saldo_balance,
    export_paket_akuntansi_lengkap,
)
from modules.filters import filter_dataframe
from modules.validation import validate_coa
from modules.rules import validate_all_rules


@pytest.fixture
def df_coa():
    return pd.DataFrame({
        "no_akun": ["1100", "5100", "4100"],
        # "BANK BCA" (bukan "KAS/BANK") -- akuntansi_ai._cari_akun_bank_di_coa()
        # mencari nama bank (mis. "BCA", sesuai kolom `bank` di df_bank_mentah)
        # sebagai substring nama_akun. COA sungguhan pasti mencantumkan nama
        # banknya (mis. "BANK BCA", "BANK MANDIRI"), bukan label generik --
        # nama generik bikin pencarian akun bank gagal & menimpa jurnal yang
        # sudah valid dari data asli dengan None (lihat proses_dataframe
        # tahap kata-kunci di akuntansi_ai.py).
        "nama_akun": ["BANK BCA", "BEBAN LISTRIK", "PENJUALAN"],
        "kategori": ["ASET", "BEBAN", "PENDAPATAN"],
    })


@pytest.fixture
def df_bank_mentah():
    """Data rekening koran mentah, sebagian sudah ada jurnal (contoh pola), sebagian belum."""
    return pd.DataFrame({
        "tanggal": ["2026-07-01", "2026-07-02", "2026-07-03"],
        "keterangan": ["PLNPOST001", "PLNPOST002", "SETORAN TUNAI"],
        "bank": ["BCA", "BCA", "BCA"],
        "no_akun_debet": ["5100", None, None],
        "nama_akun_debet": ["BEBAN LISTRIK", None, None],
        "no_akun_kredit": ["1100", None, None],
        "nama_akun_kredit": ["KAS/BANK", None, None],
        "jml_debet": [100000, 150000, 0],
        "jml_kredit": [100000, 0, 500000],
        # mutasi_debet/mutasi_kredit = kolom mentah rekening koran (dipakai oleh
        # ak.proses_dataframe untuk menghitung nominal & arah transaksi) --
        # uang keluar di mutasi_debet, uang masuk di mutasi_kredit.
        "mutasi_debet": [100000, 150000, 0],
        "mutasi_kredit": [0, 0, 500000],
        "sumber_kategori": ["Contoh Historis", None, None],
    })


class TestAlurLengkapUploadProsesExport:
    """E2E: upload (df mentah) -> proses (pola + kategorisasi) -> validasi -> export"""

    def test_validasi_coa_lolos(self, df_coa):
        is_valid, errors = validate_coa(df_coa)
        assert is_valid is True

    def test_proses_dataframe_menghasilkan_jurnal(self, df_bank_mentah, df_coa):
        pola = ak.Pola()
        hasil = ak.proses_dataframe(
            df_bank_mentah, df_coa, pola,
            pakai_ai=False, mask_pii=False, ambang_confidence=0.5,
        )
        assert hasil is not None
        assert len(hasil) == len(df_bank_mentah)
        assert "sumber_kategori" in hasil.columns

    def test_validasi_rules_setelah_proses(self, df_bank_mentah, df_coa):
        pola = ak.Pola()
        hasil = ak.proses_dataframe(
            df_bank_mentah, df_coa, pola,
            pakai_ai=False, mask_pii=False, ambang_confidence=0.5,
        )
        laporan = validate_all_rules(hasil)
        assert "summary" in laporan
        assert laporan["total_rows"] == len(hasil)

    def test_filter_setelah_proses(self, df_bank_mentah, df_coa):
        pola = ak.Pola()
        hasil = ak.proses_dataframe(
            df_bank_mentah, df_coa, pola,
            pakai_ai=False, mask_pii=False, ambang_confidence=0.5,
        )
        difilter = filter_dataframe(hasil, kata_kunci="PLN")
        assert len(difilter) <= len(hasil)
        assert all("PLN" in str(k).upper() for k in difilter["keterangan"])

    def test_export_jurnal_umum_dari_data_lengkap(self, df_bank_mentah):
        jurnal_umum = generate_jurnal_umum(df_bank_mentah)
        assert not jurnal_umum.empty
        assert "no_bukti" in jurnal_umum.columns
        # Total debet harus sama dengan total kredit di data asli (balance)
        assert abs(jurnal_umum["debet"].sum() - jurnal_umum["kredit"].sum()) < 1.0

    def test_export_neraca_saldo_balance(self, df_bank_mentah, df_coa):
        neraca = generate_neraca_saldo(df_bank_mentah, df_coa)
        assert not neraca.empty
        assert cek_neraca_saldo_balance(neraca) is True

    def test_export_buku_besar_per_akun(self, df_bank_mentah, df_coa):
        buku_besar = generate_buku_besar(df_bank_mentah, df_coa)
        assert "1100" in buku_besar  # akun KAS/BANK harus muncul (dipakai di semua transaksi)

    def test_export_paket_lengkap_menghasilkan_file_excel(self, df_bank_mentah, df_coa):
        hasil_excel = export_paket_akuntansi_lengkap(df_bank_mentah, df_coa)
        assert isinstance(hasil_excel, bytes)
        assert len(hasil_excel) > 0

    def test_alur_penuh_upload_proses_filter_export(self, df_bank_mentah, df_coa):
        """Simulasi alur penuh dari awal sampai akhir dalam satu test."""
        # 1. Validasi COA (seperti saat upload sheet COA)
        is_valid, _ = validate_coa(df_coa)
        assert is_valid

        # 2. Proses data mentah -> jurnal terisi
        pola = ak.Pola()
        hasil = ak.proses_dataframe(
            df_bank_mentah, df_coa, pola,
            pakai_ai=False, mask_pii=False, ambang_confidence=0.5,
        )
        assert len(hasil) == 3

        # 3. Filter & cari transaksi tertentu
        hasil_filter = filter_dataframe(hasil, nominal_min=100000)
        assert len(hasil_filter) >= 1

        # 4. Export ke format akuntansi standar
        neraca = generate_neraca_saldo(hasil, df_coa)
        assert not neraca.empty

        paket = export_paket_akuntansi_lengkap(hasil, df_coa)
        assert isinstance(paket, bytes) and len(paket) > 0