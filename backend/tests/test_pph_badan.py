"""
tests/test_pph_badan.py
========================
[BARU] Test untuk modules/pph_badan.py -- belum ada sebelumnya padahal
modul ini menghitung angka pajak yang langsung dipakai akuntan (risiko
regresi tinggi kalau logika 3-skenario fasilitas Pasal 31E berubah tanpa
sadar). Modul yang diuji SENGAJA murni (tidak butuh database/mock),
jadi test ini juga murni fungsi-ke-fungsi tanpa fixture DB.
"""

import math

import pytest

from modules import pph_badan


# ============================================================
# _angka() -- konversi aman
# ============================================================

def test_angka_none_jadi_nol():
    assert pph_badan._angka(None) == 0.0


def test_angka_nan_dan_inf_jadi_nol():
    assert pph_badan._angka(float("nan")) == 0.0
    assert pph_badan._angka(float("inf")) == 0.0
    assert pph_badan._angka(float("-inf")) == 0.0


def test_angka_string_tidak_valid_jadi_nol():
    assert pph_badan._angka("abc") == 0.0


def test_angka_string_angka_valid_dikonversi():
    assert pph_badan._angka("1500000") == 1500000.0


# ============================================================
# _bulatkan_ribuan_penuh()
# ============================================================

def test_pembulatan_ribuan_ke_bawah():
    assert pph_badan._bulatkan_ribuan_penuh(356_500_999) == 356_500_000


def test_pembulatan_nilai_negatif_jadi_nol():
    assert pph_badan._bulatkan_ribuan_penuh(-1_000_000) == 0.0


def test_pembulatan_nilai_nol():
    assert pph_badan._bulatkan_ribuan_penuh(0) == 0.0


# ============================================================
# hitung_pkp()
# ============================================================

def test_pkp_dasar_tanpa_koreksi():
    hasil = pph_badan.hitung_pkp(laba_bersih_komersial=1_000_000_000)
    assert hasil["penghasilan_neto_fiskal"] == 1_000_000_000
    assert hasil["penghasilan_kena_pajak"] == 1_000_000_000


def test_pkp_dengan_koreksi_positif_dan_negatif():
    hasil = pph_badan.hitung_pkp(
        laba_bersih_komersial=1_000_000_000,
        koreksi_fiskal_positif=200_000_000,
        koreksi_fiskal_negatif=50_000_000,
    )
    # neto fiskal = 1.000jt + 200jt - 50jt = 1.150jt
    assert hasil["penghasilan_neto_fiskal"] == 1_150_000_000
    assert hasil["penghasilan_kena_pajak"] == 1_150_000_000


def test_pkp_rugi_fiskal_tidak_pernah_negatif():
    hasil = pph_badan.hitung_pkp(laba_bersih_komersial=-500_000_000)
    assert hasil["penghasilan_kena_pajak"] == 0.0


def test_pkp_dengan_kompensasi_kerugian():
    hasil = pph_badan.hitung_pkp(
        laba_bersih_komersial=1_000_000_000,
        kompensasi_kerugian_fiskal=300_000_000,
    )
    assert hasil["pkp_sebelum_pembulatan"] == 700_000_000
    assert hasil["penghasilan_kena_pajak"] == 700_000_000


# ============================================================
# hitung_pembagian_fasilitas_31e() -- 3 skenario resmi
# ============================================================

def test_fasilitas_skenario_1_peredaran_bruto_kecil_seluruh_pkp_dapat_fasilitas():
    """peredaran_bruto <= 4,8 miliar -> SELURUH PKP dapat fasilitas."""
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(
        peredaran_bruto=2_000_000_000, pkp=500_000_000,
    )
    assert hasil["pkp_mendapat_fasilitas"] == 500_000_000
    assert hasil["pkp_tidak_mendapat_fasilitas"] == 0.0


def test_fasilitas_skenario_1_batas_tepat_4_8_miliar():
    """Tepat di batas 4,8 miliar -- masih skenario 1 (<=), bukan proporsional."""
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(
        peredaran_bruto=4_800_000_000, pkp=1_000_000_000,
    )
    assert hasil["pkp_mendapat_fasilitas"] == 1_000_000_000
    assert hasil["pkp_tidak_mendapat_fasilitas"] == 0.0


def test_fasilitas_skenario_2_proporsional():
    """4,8 miliar < peredaran_bruto <= 50 miliar -> proporsional."""
    peredaran_bruto = 10_000_000_000
    pkp = 1_000_000_000
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(peredaran_bruto, pkp)

    proporsi_seharusnya = 4_800_000_000 / peredaran_bruto
    fasilitas_seharusnya = round(proporsi_seharusnya * pkp, 2)

    assert hasil["pkp_mendapat_fasilitas"] == fasilitas_seharusnya
    assert hasil["pkp_tidak_mendapat_fasilitas"] == round(pkp - fasilitas_seharusnya, 2)
    # bagian fasilitas + non-fasilitas harus balik ke total PKP
    assert math.isclose(
        hasil["pkp_mendapat_fasilitas"] + hasil["pkp_tidak_mendapat_fasilitas"],
        pkp, rel_tol=1e-6,
    )


def test_fasilitas_skenario_3_di_atas_50_miliar_tidak_dapat_fasilitas():
    """peredaran_bruto > 50 miliar -> TIDAK dapat fasilitas sama sekali."""
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(
        peredaran_bruto=60_000_000_000, pkp=1_000_000_000,
    )
    assert hasil["pkp_mendapat_fasilitas"] == 0.0
    assert hasil["pkp_tidak_mendapat_fasilitas"] == 1_000_000_000


def test_fasilitas_batas_tepat_50_miliar_masih_proporsional():
    """Tepat di batas 50 miliar -- masih skenario 2 (<=), bukan skenario 3."""
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(
        peredaran_bruto=50_000_000_000, pkp=1_000_000_000,
    )
    assert hasil["pkp_mendapat_fasilitas"] > 0.0


def test_fasilitas_peredaran_bruto_nihil():
    hasil = pph_badan.hitung_pembagian_fasilitas_31e(peredaran_bruto=0, pkp=500_000_000)
    assert hasil["pkp_mendapat_fasilitas"] == 0.0
    assert hasil["pkp_tidak_mendapat_fasilitas"] == 500_000_000


# ============================================================
# hitung_pph_pasal_31e() -- fungsi utama end-to-end
# ============================================================

def test_pph_31e_umkm_kecil_full_fasilitas():
    """Peredaran bruto 2 miliar, laba 500 juta -- seluruh PKP kena tarif efektif 11%."""
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=2_000_000_000,
        laba_bersih_komersial=500_000_000,
        tahun_pajak=2026,
    )
    assert hasil["fasilitas_31e"]["pkp_mendapat_fasilitas"] == 500_000_000
    assert hasil["pph_atas_pkp_nonfasilitas"] == 0
    # tarif efektif fasilitas = 11%
    assert hasil["pph_badan_terutang"] == round(500_000_000 * 0.11, 0)
    assert hasil["status"] in ("KURANG BAYAR", "NIHIL", "LEBIH BAYAR")


def test_pph_31e_perusahaan_besar_tanpa_fasilitas():
    """Peredaran bruto 100 miliar -- di atas ambang, seluruh PKP tarif umum 22%."""
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=100_000_000_000,
        laba_bersih_komersial=5_000_000_000,
        tahun_pajak=2026,
    )
    assert hasil["fasilitas_31e"]["pkp_mendapat_fasilitas"] == 0.0
    assert hasil["pph_badan_terutang"] == hasil["pph_tanpa_fasilitas_31e"]
    assert hasil["penghematan_pajak_pasal_31e"] == 0


def test_pph_31e_dengan_koreksi_fiskal_dari_aset_tetap():
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=3_000_000_000,
        laba_bersih_komersial=500_000_000,
        koreksi_fiskal_positif=50_000_000,
        koreksi_fiskal_negatif=10_000_000,
        tahun_pajak=2026,
    )
    # PKP = 500jt + 50jt - 10jt = 540jt
    assert hasil["rekonsiliasi_fiskal"]["penghasilan_kena_pajak"] == 540_000_000


def test_pph_31e_kredit_pajak_menentukan_kurang_atau_lebih_bayar():
    hasil_kurang_bayar = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=2_000_000_000,
        laba_bersih_komersial=500_000_000,
        kredit_pajak={"pph_25": 0},
    )
    assert hasil_kurang_bayar["pph_pasal_29_kurang_bayar"] > 0
    assert hasil_kurang_bayar["pph_pasal_28a_lebih_bayar"] == 0
    assert hasil_kurang_bayar["status"] == "KURANG BAYAR"

    pph_terutang = hasil_kurang_bayar["pph_badan_terutang"]
    hasil_lebih_bayar = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=2_000_000_000,
        laba_bersih_komersial=500_000_000,
        kredit_pajak={"angsuran_pph_25": pph_terutang + 10_000_000},
    )
    assert hasil_lebih_bayar["pph_pasal_28a_lebih_bayar"] > 0
    assert hasil_lebih_bayar["pph_pasal_29_kurang_bayar"] == 0
    assert hasil_lebih_bayar["status"] == "LEBIH BAYAR"


def test_pph_31e_pkp_nol_status_nihil():
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=1_000_000_000,
        laba_bersih_komersial=0,
    )
    assert hasil["rekonsiliasi_fiskal"]["penghasilan_kena_pajak"] == 0.0
    assert hasil["pph_badan_terutang"] == 0
    assert hasil["status"] == "NIHIL"


def test_pph_31e_rugi_komersial_tidak_menghasilkan_pph_negatif():
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=1_000_000_000,
        laba_bersih_komersial=-200_000_000,
    )
    assert hasil["pph_badan_terutang"] == 0
    assert hasil["status"] == "NIHIL"


def test_pph_31e_kredit_pajak_kunci_tidak_dikenal_diabaikan_bukan_error():
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=1_000_000_000,
        laba_bersih_komersial=200_000_000,
        kredit_pajak={"kunci_asing_tidak_dikenal": 999},
    )
    assert hasil["kredit_pajak"]["total"] == 0


def test_pph_31e_label_opsional_diteruskan_apa_adanya():
    hasil = pph_badan.hitung_pph_pasal_31e(
        peredaran_bruto=1_000_000_000,
        laba_bersih_komersial=200_000_000,
        tahun_pajak=2025,
        nama_perusahaan="PT Contoh Sejahtera",
    )
    assert hasil["tahun_pajak"] == 2025
    assert hasil["nama_perusahaan"] == "PT Contoh Sejahtera"