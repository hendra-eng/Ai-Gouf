"""
tests/test_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku.py
===============================================================
[BARU] Test untuk
modules/laporan_keuangan.py::susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku()
-- fungsi yang menyusun sheet "PNL Lampiran SPT" (sheet ke-13 export
14-sheet) dengan struktur kolom BAKU (Kode, Uraian, Komersial, Koreksi
Positif, Koreksi Negatif, Fiskal, Keterangan) yang selalu sama untuk
semua client, tapi isi barisnya menyesuaikan data akun Pendapatan/Beban
client masing-masing.

Mengikuti pola tests/test_neraca_lampiran_spt_baku.py (sheet 12) --
fungsi murni, tidak butuh database, angka disusun mengikuti contoh file
"LABA RUGI & REKONSILIASI FISKAL -- LAMPIRAN SPT TAHUNAN BADAN" yang
jadi acuan format sheet ini (perusahaan rental excavator/scaffolding).
"""

from modules import laporan_keuangan as lapkeu
from modules import pph_badan


# ============================================================
# Helper: data dasar -- dari contoh file acuan (excavator/scaffolding)
# ============================================================

def _laba_rugi_dasar():
    return {
        "pendapatan": [
            {"no_akun": "4101", "nama_akun": "Pendapatan Sewa Excavator",
             "sub_kategori": None, "saldo_akhir": 455_000_000},
            {"no_akun": "4102", "nama_akun": "Pendapatan Sewa Stager/Scaffolding",
             "sub_kategori": None, "saldo_akhir": 260_000_000},
        ],
        "beban": [
            {"no_akun": "5101", "nama_akun": "Beban BBM & Pelumas",
             "sub_kategori": "HPP", "saldo_akhir": 62_000_000},
            {"no_akun": "5102", "nama_akun": "Beban Operator Lapangan",
             "sub_kategori": "HPP", "saldo_akhir": 79_000_000},
            {"no_akun": "5103", "nama_akun": "Beban Perbaikan Excavator",
             "sub_kategori": "HPP", "saldo_akhir": 33_000_000},
            {"no_akun": "5104", "nama_akun": "Beban Perbaikan Stager/Scaffolding",
             "sub_kategori": "HPP", "saldo_akhir": 11_000_000},
            {"no_akun": "5201", "nama_akun": "Beban Gaji Administrasi",
             "sub_kategori": None, "saldo_akhir": 34_000_000},
            {"no_akun": "5202", "nama_akun": "Beban Sewa Kantor/Gudang",
             "sub_kategori": None, "saldo_akhir": 12_000_000},
            {"no_akun": "5203", "nama_akun": "Beban Listrik, Air & Internet",
             "sub_kategori": None, "saldo_akhir": 2_000_000},
            {"no_akun": "5205", "nama_akun": "Beban Administrasi Bank",
             "sub_kategori": None, "saldo_akhir": 500_000},
            {"no_akun": "5301", "nama_akun": "Beban Penyusutan Excavator",
             "sub_kategori": "Penyusutan", "saldo_akhir": 75_000_000},
            {"no_akun": "5302", "nama_akun": "Beban Penyusutan Stager/Scaffolding",
             "sub_kategori": "Penyusutan", "saldo_akhir": 50_000_000},
        ],
        "total_pendapatan": 715_000_000,
        "total_beban": 358_500_000,
        "laba_rugi_bersih": 356_500_000,
    }


def _cari_baris(baris, uraian=None, kode=None):
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
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025)
    for field in ("tahun", "baris", "laba_bersih_komersial", "penghasilan_kena_pajak", "catatan"):
        assert field in hasil


def test_setiap_baris_akun_punya_7_kolom_baku():
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025)
    for b in hasil["baris"]:
        if b["tipe"] == "judul":
            assert "uraian" in b
            continue
        assert "uraian" in b
        assert "komersial" in b
        assert "fiskal" in b
        if b["tipe"] == "akun":
            assert "kode" in b
            assert "koreksi_positif" in b
            assert "koreksi_negatif" in b
            assert "keterangan" in b


def test_urutan_seksi_sesuai_template():
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025)
    urutan_subtotal = [b["uraian"] for b in hasil["baris"] if b["tipe"] == "subtotal"]
    urutan_wajib = [
        "JUMLAH PENDAPATAN USAHA", "JUMLAH BEBAN LANGSUNG", "LABA KOTOR",
        "JUMLAH BEBAN OPERASIONAL", "EBITDA", "JUMLAH BEBAN PENYUSUTAN", "LABA USAHA",
        "LABA BERSIH KOMERSIAL", "TOTAL KOREKSI FISKAL POSITIF", "TOTAL KOREKSI FISKAL NEGATIF",
        "PENGHASILAN NETO FISKAL", "KOMPENSASI KERUGIAN FISKAL",
        "PENGHASILAN KENA PAJAK SEBELUM PEMBULATAN", "PENGHASILAN KENA PAJAK -- RIBUAN PENUH",
    ]
    assert urutan_subtotal == urutan_wajib


# ============================================================
# Angka HARUS cocok dengan template referensi (LABA RUGI & REKONSILIASI
# FISKAL -- LAMPIRAN SPT TAHUNAN BADAN, contoh excavator/scaffolding).
# ============================================================

def test_angka_cocok_dengan_template_referensi():
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025)

    jml_pendapatan = _cari_baris(hasil["baris"], uraian="JUMLAH PENDAPATAN USAHA")
    assert jml_pendapatan["komersial"] == 715_000_000

    jml_beban_langsung = _cari_baris(hasil["baris"], uraian="JUMLAH BEBAN LANGSUNG")
    assert jml_beban_langsung["komersial"] == 185_000_000

    laba_kotor = _cari_baris(hasil["baris"], uraian="LABA KOTOR")
    assert laba_kotor["komersial"] == 530_000_000

    jml_beban_operasional = _cari_baris(hasil["baris"], uraian="JUMLAH BEBAN OPERASIONAL")
    assert jml_beban_operasional["komersial"] == 48_500_000

    ebitda = _cari_baris(hasil["baris"], uraian="EBITDA")
    assert ebitda["komersial"] == 481_500_000

    jml_penyusutan = _cari_baris(hasil["baris"], uraian="JUMLAH BEBAN PENYUSUTAN")
    assert jml_penyusutan["komersial"] == 125_000_000

    laba_usaha = _cari_baris(hasil["baris"], uraian="LABA USAHA")
    assert laba_usaha["komersial"] == 356_500_000

    assert hasil["laba_bersih_komersial"] == 356_500_000


def test_fiskal_sama_dengan_komersial_kalau_tanpa_koreksi_per_akun():
    """Koreksi Positif/Negatif per akun default 0 -> Fiskal = Komersial,
    persis seperti semua baris D/E di file contoh yang isinya 0."""
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025)
    for b in hasil["baris"]:
        if b["tipe"] == "akun":
            assert b["koreksi_positif"] == 0.0
            assert b["koreksi_negatif"] == 0.0
            assert b["fiskal"] == b["komersial"]


# ============================================================
# Jumlah baris per seksi HARUS menyesuaikan jumlah akun client -- ini
# inti kebutuhan sheet 13: kolom tetap, jumlah baris dinamis.
# ============================================================

def test_jumlah_baris_pendapatan_usaha_menyesuaikan_jumlah_akun():
    laba_rugi = _laba_rugi_dasar()
    laba_rugi["pendapatan"].append(
        {"no_akun": "4103", "nama_akun": "Pendapatan Mobilisasi/Demobilisasi",
         "sub_kategori": None, "saldo_akhir": 0}
    )
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(laba_rugi, 2025)
    baris_p = [b for b in hasil["baris"] if b["tipe"] == "akun" and b.get("kode", "").startswith("P0")]
    assert len(baris_p) == 3
    assert _cari_baris(hasil["baris"], kode="P03")["uraian"] == "Pendapatan Mobilisasi/Demobilisasi"


def test_client_tanpa_beban_penyusutan_tetap_tampil_1_baris_placeholder():
    """Client yang belum punya akun BEBAN sub_kategori 'Penyusutan' --
    seksi BEBAN PENYUSUTAN tetap harus punya baris BP01 placeholder,
    bukan seksi kosong tanpa baris sama sekali (struktur Excel tidak
    berubah-ubah bentuk antar client)."""
    laba_rugi = _laba_rugi_dasar()
    laba_rugi["beban"] = [a for a in laba_rugi["beban"] if a["sub_kategori"] != "Penyusutan"]
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(laba_rugi, 2025)
    bp01 = _cari_baris(hasil["baris"], kode="BP01")
    assert bp01 is not None
    assert bp01["komersial"] == 0.0
    jml_penyusutan = _cari_baris(hasil["baris"], uraian="JUMLAH BEBAN PENYUSUTAN")
    assert jml_penyusutan["komersial"] == 0.0


def test_akun_pendapatan_lain_lain_masuk_seksi_terpisah():
    laba_rugi = _laba_rugi_dasar()
    laba_rugi["pendapatan"].append(
        {"no_akun": "6101", "nama_akun": "Pendapatan Bunga Bank",
         "sub_kategori": "Lain-lain", "saldo_akhir": 5_000_000}
    )
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(laba_rugi, 2025)
    pl01 = _cari_baris(hasil["baris"], kode="PL01")
    assert pl01["uraian"] == "Pendapatan Bunga Bank"
    assert pl01["komersial"] == 5_000_000
    # Tidak ikut ke JUMLAH PENDAPATAN USAHA (itu cuma pendapatan usaha)
    jml_pendapatan = _cari_baris(hasil["baris"], uraian="JUMLAH PENDAPATAN USAHA")
    assert jml_pendapatan["komersial"] == 715_000_000
    # Tapi ikut nambah LABA BERSIH KOMERSIAL
    assert hasil["laba_bersih_komersial"] == 356_500_000 + 5_000_000


# ============================================================
# Integrasi dengan pph_badan.hitung_pkp() -- rekonsiliasi_pkp opsional
# ============================================================

def test_rekonsiliasi_pkp_dari_pph_badan_dipakai_apa_adanya():
    rekon = pph_badan.hitung_pkp(
        laba_bersih_komersial=356_500_000,
        koreksi_fiskal_positif=10_000_000,
        koreksi_fiskal_negatif=2_000_000,
        kompensasi_kerugian_fiskal=0,
    )
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(
        _laba_rugi_dasar(), 2025, rekonsiliasi_pkp=rekon,
    )
    positif = _cari_baris(hasil["baris"], uraian="TOTAL KOREKSI FISKAL POSITIF")
    negatif = _cari_baris(hasil["baris"], uraian="TOTAL KOREKSI FISKAL NEGATIF")
    neto_fiskal = _cari_baris(hasil["baris"], uraian="PENGHASILAN NETO FISKAL")
    pkp = _cari_baris(hasil["baris"], uraian="PENGHASILAN KENA PAJAK -- RIBUAN PENUH")

    assert positif["komersial"] == 10_000_000
    assert negatif["komersial"] == 2_000_000
    assert neto_fiskal["komersial"] == 356_500_000 + 10_000_000 - 2_000_000
    assert pkp["komersial"] == 364_500_000
    assert hasil["penghasilan_kena_pajak"] == rekon["penghasilan_kena_pajak"]
    assert "FALLBACK" not in hasil["catatan"]


def test_tanpa_rekonsiliasi_pkp_fallback_tanpa_koreksi():
    """rekonsiliasi_pkp=None (PPh Badan belum pernah digenerate) -> sheet
    tetap lengkap, koreksi dianggap 0, dan catatan menandai fallback --
    supaya tidak diam-diam menampilkan angka final yang salah."""
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(_laba_rugi_dasar(), 2025, None)
    positif = _cari_baris(hasil["baris"], uraian="TOTAL KOREKSI FISKAL POSITIF")
    assert positif["komersial"] == 0.0
    assert hasil["penghasilan_kena_pajak"] == 356_500_000
    assert "FALLBACK" in hasil["catatan"]


def test_kompensasi_kerugian_fiskal_mengurangi_pkp():
    rekon = pph_badan.hitung_pkp(
        laba_bersih_komersial=356_500_000,
        kompensasi_kerugian_fiskal=100_000_000,
    )
    hasil = lapkeu.susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(
        _laba_rugi_dasar(), 2025, rekonsiliasi_pkp=rekon,
    )
    assert hasil["penghasilan_kena_pajak"] == 256_500_000