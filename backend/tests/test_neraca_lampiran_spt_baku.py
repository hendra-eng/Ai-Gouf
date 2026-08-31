"""
tests/test_neraca_lampiran_spt_baku.py
=======================================
[BARU] Test untuk modules/laporan_keuangan.py::susun_neraca_lampiran_spt_baku()
-- fungsi yang menyusun sheet "BS Lampiran SPT" (sheet ke-12 export
14-sheet) dengan struktur kolom BAKU (Kode, Uraian, Tahun Ini, Tahun
Lalu/Saldo Awal, Keterangan) yang selalu sama untuk semua client, tapi
isi barisnya menyesuaikan data COA/neraca client masing-masing.

Mengikuti pola tests/test_pph_badan.py: fungsi yang diuji murni (tidak
butuh database), jadi test ini juga murni fungsi-ke-fungsi tanpa
fixture DB -- cukup susun dict neraca/coa manual mirip output
lapkeu.susun_neraca().
"""

import pytest

from modules import laporan_keuangan as lapkeu


# ============================================================
# Helper: data dasar dipakai berulang -- disusun persis mengikuti
# angka contoh file "NERACA -- LAMPIRAN SPT TAHUNAN BADAN (DALAM
# RUPIAH)" yang jadi acuan format sheet ini, supaya test langsung
# jadi bukti angka fungsi ini cocok dengan template resmi.
# ============================================================

def _coa_dasar():
    return [
        {"no_akun": "1100", "nama_akun": "Kas", "kategori": "ASET",
         "sub_kategori": "Kas", "saldo_awal": 100_000_000},
        {"no_akun": "1200", "nama_akun": "Bank BCA", "kategori": "ASET",
         "sub_kategori": "Kas", "saldo_awal": 50_000_000},
        {"no_akun": "1300", "nama_akun": "Piutang Usaha", "kategori": "ASET",
         "sub_kategori": "Piutang", "saldo_awal": 0},
        {"no_akun": "1500", "nama_akun": "Excavator", "kategori": "ASET",
         "sub_kategori": "Aset Tetap", "saldo_awal": 850_000_000},
        {"no_akun": "1590", "nama_akun": "Akumulasi Penyusutan", "kategori": "ASET",
         "sub_kategori": "Akumulasi Penyusutan", "saldo_awal": 0},
        {"no_akun": "2100", "nama_akun": "Hutang Usaha", "kategori": "LIABILITAS",
         "sub_kategori": None, "saldo_awal": 0},
        {"no_akun": "3100", "nama_akun": "Modal Tuan A", "kategori": "EKUITAS",
         "sub_kategori": None, "saldo_awal": 300_000_000},
        {"no_akun": "3200", "nama_akun": "Modal Tuan B", "kategori": "EKUITAS",
         "sub_kategori": None, "saldo_awal": 700_000_000},
    ]


def _neraca_dasar():
    return {
        "aset": [
            {"no_akun": "1100", "nama_akun": "Kas", "kategori": "ASET",
             "sub_kategori": "Kas", "saldo_akhir": 400_000_000},
            {"no_akun": "1200", "nama_akun": "Bank BCA", "kategori": "ASET",
             "sub_kategori": "Kas", "saldo_akhir": 145_500_000},
            {"no_akun": "1300", "nama_akun": "Piutang Usaha", "kategori": "ASET",
             "sub_kategori": "Piutang", "saldo_akhir": 95_000_000},
            {"no_akun": "1500", "nama_akun": "Excavator", "kategori": "ASET",
             "sub_kategori": "Aset Tetap", "saldo_akhir": 850_000_000},
            {"no_akun": "1590", "nama_akun": "Akumulasi Penyusutan", "kategori": "ASET",
             "sub_kategori": "Akumulasi Penyusutan", "saldo_akhir": 125_000_000},
        ],
        "liabilitas": [
            {"no_akun": "2100", "nama_akun": "Hutang Usaha", "kategori": "LIABILITAS",
             "saldo_akhir": 9_000_000},
        ],
        "ekuitas": [
            {"no_akun": "3100", "nama_akun": "Modal Tuan A", "kategori": "EKUITAS",
             "saldo_akhir": 300_000_000},
            {"no_akun": "3200", "nama_akun": "Modal Tuan B", "kategori": "EKUITAS",
             "saldo_akhir": 700_000_000},
        ],
        "ekuitas_tambahan": [
            {"label": "Laba (Rugi) Tahun Berjalan", "nilai": 356_500_000},
            {"label": "Penyesuaian Manual Akuntan", "nilai": 0},
        ],
        "total_aset": 1_365_500_000,
    }


def _cari_baris(baris, kode=None, uraian=None):
    """Helper: cari satu baris berdasarkan kode ATAU uraian persis."""
    for b in baris:
        if kode is not None and b.get("kode") == kode:
            return b
        if uraian is not None and b.get("uraian") == uraian:
            return b
    return None


# ============================================================
# Kolom & struktur baku -- HARUS selalu sama, tidak peduli data client
# ============================================================

def test_output_punya_field_wajib():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    for field in ("tahun", "tahun_sebelumnya", "baris", "total_aset",
                  "total_liabilitas_dan_ekuitas", "balance", "catatan"):
        assert field in hasil


def test_setiap_baris_akun_punya_5_kolom_baku():
    """Kode, Uraian, nilai tahun ini, nilai tahun lalu, Keterangan --
    kolom ini WAJIB selalu ada di tiap baris tipe 'akun', 'subtotal',
    'check' terlepas dari data client apa pun (kolom baku, isi dinamis)."""
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    for b in hasil["baris"]:
        if b["tipe"] == "judul":
            assert "uraian" in b
            continue
        assert "uraian" in b
        assert "nilai_ini" in b
        assert "nilai_lalu" in b
        if b["tipe"] == "akun":
            assert "kode" in b
            assert "keterangan" in b


def test_urutan_seksi_aset_liabilitas_ekuitas():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    uraian_judul = [b["uraian"] for b in hasil["baris"] if b["tipe"] == "judul"]
    assert uraian_judul.index("ASET") < uraian_judul.index("LIABILITAS") < uraian_judul.index("EKUITAS")


def test_aset_lancar_selalu_4_bucket_walau_sebagian_kosong():
    """A01-A04 (aset lancar) HARUS selalu muncul walau client tidak
    punya akun Persediaan/Aset Lancar Lainnya -- bucket tampil dgn nilai
    0, bukan hilang, supaya posisi kode tetap konsisten antar client."""
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    for kode in ("A01", "A02", "A03", "A04"):
        b = _cari_baris(hasil["baris"], kode=kode)
        assert b is not None, f"Bucket {kode} harus tetap ada"
    persediaan = _cari_baris(hasil["baris"], kode="A03")
    assert persediaan["nilai_ini"] == 0
    assert persediaan["nilai_lalu"] == 0


# ============================================================
# Angka HARUS cocok dengan template referensi (NERACA -- LAMPIRAN SPT
# TAHUNAN BADAN (DALAM RUPIAH)) yang jadi acuan format sheet ini.
# ============================================================

def test_angka_cocok_dengan_template_referensi():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)

    a01 = _cari_baris(hasil["baris"], kode="A01")
    assert a01["nilai_ini"] == 545_500_000
    assert a01["nilai_lalu"] == 150_000_000

    jml_aset_lancar = _cari_baris(hasil["baris"], uraian="JUMLAH ASET LANCAR")
    assert jml_aset_lancar["nilai_ini"] == 640_500_000
    assert jml_aset_lancar["nilai_lalu"] == 150_000_000

    aset_tetap_neto = _cari_baris(hasil["baris"], uraian="Aset Tetap Neto")
    assert aset_tetap_neto["nilai_ini"] == 725_000_000
    assert aset_tetap_neto["nilai_lalu"] == 850_000_000

    jml_aset = _cari_baris(hasil["baris"], uraian="JUMLAH ASET")
    assert jml_aset["nilai_ini"] == 1_365_500_000
    assert jml_aset["nilai_lalu"] == 1_000_000_000

    jml_liab = _cari_baris(hasil["baris"], uraian="JUMLAH LIABILITAS")
    assert jml_liab["nilai_ini"] == 9_000_000

    jml_ekuitas = _cari_baris(hasil["baris"], uraian="JUMLAH EKUITAS")
    assert jml_ekuitas["nilai_ini"] == 1_356_500_000
    assert jml_ekuitas["nilai_lalu"] == 1_000_000_000

    jml_liab_ekuitas = _cari_baris(hasil["baris"], uraian="JUMLAH LIABILITAS DAN EKUITAS")
    assert jml_liab_ekuitas["nilai_ini"] == 1_365_500_000

    assert hasil["total_aset"] == 1_365_500_000
    assert hasil["total_liabilitas_dan_ekuitas"] == 1_365_500_000
    assert hasil["balance"] is True

    check_balance = _cari_baris(hasil["baris"], uraian="CHECK BALANCE")
    assert check_balance["nilai_ini"] == 0
    assert check_balance["keterangan"] == "Harus nihil"


def test_laba_tahun_berjalan_masuk_sebagai_baris_ekuitas_terakhir():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    laba_berjalan = _cari_baris(hasil["baris"], uraian="Laba (Rugi) Tahun Berjalan")
    assert laba_berjalan is not None
    assert laba_berjalan["nilai_ini"] == 356_500_000
    assert laba_berjalan["kode"] == "E03"  # setelah E01, E02 (2 pemilik modal)


# ============================================================
# Baris LIABILITAS & EKUITAS harus MENYESUAIKAN jumlah akun client --
# ini inti kebutuhan sheet 12: kolom tetap, jumlah baris dinamis.
# ============================================================

def test_jumlah_baris_ekuitas_menyesuaikan_jumlah_pemilik_modal():
    """3 pemilik modal -> harus muncul E01, E02, E03 (masing2 pemilik)
    + 1 baris tambahan utk Laba Tahun Berjalan (E04) -- total 4 baris
    'akun' di seksi EKUITAS, bukan jumlah tetap seperti template asal
    (yang cuma py 2 pemilik)."""
    coa = _coa_dasar() + [
        {"no_akun": "3300", "nama_akun": "Modal Tuan C", "kategori": "EKUITAS",
         "sub_kategori": None, "saldo_awal": 200_000_000},
    ]
    neraca = _neraca_dasar()
    neraca["ekuitas"].append(
        {"no_akun": "3300", "nama_akun": "Modal Tuan C", "kategori": "EKUITAS", "saldo_akhir": 200_000_000}
    )

    hasil = lapkeu.susun_neraca_lampiran_spt_baku(neraca, coa, 2025, 2024)
    baris_ekuitas_akun = [
        b for b in hasil["baris"]
        if b["tipe"] == "akun" and b.get("kode", "").startswith("E")
    ]
    assert len(baris_ekuitas_akun) == 4  # 3 pemilik + Laba Tahun Berjalan
    assert _cari_baris(hasil["baris"], kode="E03")["uraian"] == "Modal Tuan C"
    assert _cari_baris(hasil["baris"], kode="E04")["uraian"] == "Laba (Rugi) Tahun Berjalan"


def test_jumlah_baris_liabilitas_menyesuaikan_jumlah_akun_hutang():
    coa = _coa_dasar() + [
        {"no_akun": "2200", "nama_akun": "Hutang Pajak", "kategori": "LIABILITAS",
         "sub_kategori": None, "saldo_awal": 0},
        {"no_akun": "2300", "nama_akun": "Hutang Bank", "kategori": "LIABILITAS",
         "sub_kategori": None, "saldo_awal": 0},
    ]
    neraca = _neraca_dasar()
    neraca["liabilitas"] += [
        {"no_akun": "2200", "nama_akun": "Hutang Pajak", "kategori": "LIABILITAS", "saldo_akhir": 5_000_000},
        {"no_akun": "2300", "nama_akun": "Hutang Bank", "kategori": "LIABILITAS", "saldo_akhir": 20_000_000},
    ]

    hasil = lapkeu.susun_neraca_lampiran_spt_baku(neraca, coa, 2025, 2024)
    baris_liab_akun = [
        b for b in hasil["baris"]
        if b["tipe"] == "akun" and b.get("kode", "").startswith("L")
    ]
    assert len(baris_liab_akun) == 3
    jml_liab = _cari_baris(hasil["baris"], uraian="JUMLAH LIABILITAS")
    assert jml_liab["nilai_ini"] == 9_000_000 + 5_000_000 + 20_000_000


def test_client_tanpa_liabilitas_tetap_tampil_1_baris_placeholder():
    """Client yang belum punya akun LIABILITAS sama sekali (mis. usaha
    baru, semua modal sendiri) -- sheet tetap harus punya baris L01,
    bukan seksi kosong tanpa baris sama sekali (supaya struktur Excel
    tidak berubah-ubah bentuk antar client)."""
    neraca = _neraca_dasar()
    neraca["liabilitas"] = []
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(neraca, _coa_dasar(), 2025, 2024)
    l01 = _cari_baris(hasil["baris"], kode="L01")
    assert l01 is not None
    assert l01["nilai_ini"] == 0.0
    jml_liab = _cari_baris(hasil["baris"], uraian="JUMLAH LIABILITAS")
    assert jml_liab["nilai_ini"] == 0.0


# ============================================================
# Penyesuaian manual akuntan -- hanya muncul kalau nilainya != 0,
# supaya sheet tidak dipenuhi baris 0 yang tidak relevan.
# ============================================================

def test_penyesuaian_manual_muncul_kalau_tidak_nol():
    neraca = _neraca_dasar()
    neraca["ekuitas_tambahan"] = [
        {"label": "Laba (Rugi) Tahun Berjalan", "nilai": 356_500_000},
        {"label": "Penyesuaian Manual Akuntan", "nilai": 15_000_000},
    ]
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(neraca, _coa_dasar(), 2025, 2024)
    penyesuaian = _cari_baris(hasil["baris"], uraian="Penyesuaian Manual Akuntan")
    assert penyesuaian is not None
    assert penyesuaian["nilai_ini"] == 15_000_000

    jml_ekuitas = _cari_baris(hasil["baris"], uraian="JUMLAH EKUITAS")
    assert jml_ekuitas["nilai_ini"] == 1_356_500_000 + 15_000_000


def test_penyesuaian_manual_tidak_muncul_kalau_nol():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, 2024)
    assert _cari_baris(hasil["baris"], uraian="Penyesuaian Manual Akuntan") is None


# ============================================================
# CHECK BALANCE harus mendeteksi Neraca yang TIDAK balance
# ============================================================

def test_check_balance_mendeteksi_selisih():
    neraca = _neraca_dasar()
    # Rusak Neraca dengan sengaja: tambah aset tanpa penyeimbang di sisi
    # liabilitas/ekuitas -> harus balance=False & CHECK BALANCE != 0.
    neraca["aset"].append(
        {"no_akun": "1999", "nama_akun": "Aset Tidak Wajar", "kategori": "ASET",
         "sub_kategori": "Aset Lainnya", "saldo_akhir": 1_000_000}
    )
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(neraca, _coa_dasar(), 2025, 2024)
    assert hasil["balance"] is False
    check_balance = _cari_baris(hasil["baris"], uraian="CHECK BALANCE")
    assert check_balance["nilai_ini"] == 1_000_000


# ============================================================
# tahun_sebelumnya opsional -- fungsi tidak boleh error kalau None
# (mis. dipanggil tanpa tahun pajak lalu yang jelas)
# ============================================================

def test_tanpa_tahun_sebelumnya_tidak_error():
    hasil = lapkeu.susun_neraca_lampiran_spt_baku(_neraca_dasar(), _coa_dasar(), 2025, None)
    assert hasil["tahun_sebelumnya"] is None
    assert hasil["balance"] is True