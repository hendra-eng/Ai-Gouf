"""
tests/test_fiscal_reconciliation.py
====================================
[BARU] Test untuk modules/fiscal_reconciliation.py -- belum ada
sebelumnya. Modul ini adalah jembatan murni antara hasil tersimpan
akuntansi_ai.proses_aset_tetap() dan pph_badan.hitung_pph_pasal_31e(),
jadi test di sini pakai dict hasil_aset TIRUAN (bentuknya sama seperti
yang benar-benar disimpan ke tabel "hasil" -- lihat catatan struktur di
modules/fiscal_reconciliation.py & akuntansi_ai.proses_aset_tetap()).
"""

from modules import fiscal_reconciliation as fr


# ============================================================
# ringkas_rekonsiliasi_fiskal_dari_aset_tetap()
# ============================================================

def test_rekonsiliasi_kosong_jika_tidak_ada_data():
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap({})
    assert hasil["koreksi_fiskal_positif"] == 0.0
    assert hasil["koreksi_fiskal_negatif"] == 0.0
    assert hasil["jumlah_aset_direkonsiliasi"] == 0


def test_rekonsiliasi_none_tidak_error():
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap(None)
    assert hasil["koreksi_fiskal_positif"] == 0.0
    assert hasil["jumlah_aset_direkonsiliasi"] == 0


def test_rekonsiliasi_selisih_positif_terjumlah_benar():
    """selisih > 0 -> penyusutan KOMERSIAL > FISKAL -- koreksi POSITIF."""
    hasil_aset = {
        "rekonsiliasi_fiskal": [
            {"kode_aset": "A001", "selisih_penyusutan_per_tahun": 5_000_000},
            {"kode_aset": "A002", "selisih_penyusutan_per_tahun": 3_000_000},
        ]
    }
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap(hasil_aset)
    assert hasil["koreksi_fiskal_positif"] == 8_000_000
    assert hasil["koreksi_fiskal_negatif"] == 0.0
    assert hasil["jumlah_aset_direkonsiliasi"] == 2


def test_rekonsiliasi_selisih_negatif_terjumlah_sebagai_absolut():
    """selisih < 0 -> penyusutan FISKAL > KOMERSIAL -- koreksi NEGATIF (nilai absolut)."""
    hasil_aset = {
        "rekonsiliasi_fiskal": [
            {"kode_aset": "A001", "selisih_penyusutan_per_tahun": -4_000_000},
        ]
    }
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap(hasil_aset)
    assert hasil["koreksi_fiskal_positif"] == 0.0
    assert hasil["koreksi_fiskal_negatif"] == 4_000_000


def test_rekonsiliasi_campuran_positif_dan_negatif():
    hasil_aset = {
        "rekonsiliasi_fiskal": [
            {"kode_aset": "A001", "selisih_penyusutan_per_tahun": 5_000_000},
            {"kode_aset": "A002", "selisih_penyusutan_per_tahun": -2_000_000},
            {"kode_aset": "A003", "selisih_penyusutan_per_tahun": 0},
        ]
    }
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap(hasil_aset)
    assert hasil["koreksi_fiskal_positif"] == 5_000_000
    assert hasil["koreksi_fiskal_negatif"] == 2_000_000
    assert hasil["jumlah_aset_direkonsiliasi"] == 3


def test_rekonsiliasi_nilai_none_dianggap_nol():
    hasil_aset = {
        "rekonsiliasi_fiskal": [
            {"kode_aset": "A001", "selisih_penyusutan_per_tahun": None},
        ]
    }
    hasil = fr.ringkas_rekonsiliasi_fiskal_dari_aset_tetap(hasil_aset)
    assert hasil["koreksi_fiskal_positif"] == 0.0
    assert hasil["koreksi_fiskal_negatif"] == 0.0
    assert hasil["jumlah_aset_direkonsiliasi"] == 1


# ============================================================
# ringkas_penyusutan_fiskal_per_bulan()
# ============================================================

def test_penyusutan_bulanan_kosong_jika_tidak_ada_df():
    assert fr.ringkas_penyusutan_fiskal_per_bulan({}) == []
    assert fr.ringkas_penyusutan_fiskal_per_bulan(None) == []


def test_penyusutan_bulanan_tanah_dikecualikan():
    hasil_aset = {
        "df": [
            {"kode_aset": "T001", "nama_aset": "Tanah Gudang", "kategori": "TANAH",
             "harga_perolehan": 500_000_000},
            {"kode_aset": "M001", "nama_aset": "Mesin Produksi", "kategori": "Mesin",
             "golongan_fiskal": "II", "harga_perolehan": 100_000_000,
             "penyusutan_fiskal_per_bulan": 1_041_667,
             "akumulasi_penyusutan_fiskal_seharusnya": 5_000_000},
        ]
    }
    hasil = fr.ringkas_penyusutan_fiskal_per_bulan(hasil_aset)
    assert len(hasil) == 1
    assert hasil[0]["kode_aset"] == "M001"
    assert hasil[0]["golongan_fiskal"] == "II"
    assert hasil[0]["penyusutan_fiskal_per_bulan"] == 1_041_667
    assert hasil[0]["akumulasi_fiskal_awal_tahun"] == 5_000_000


def test_penyusutan_bulanan_kategori_kosong_dikecualikan():
    hasil_aset = {
        "df": [
            {"kode_aset": "X001", "nama_aset": "Tidak Jelas", "kategori": "",
             "harga_perolehan": 10_000_000},
        ]
    }
    hasil = fr.ringkas_penyusutan_fiskal_per_bulan(hasil_aset)
    assert hasil == []


def test_penyusutan_bulanan_nilai_kosong_dikonversi_nol():
    hasil_aset = {
        "df": [
            {"kode_aset": "M002", "nama_aset": "Mesin B", "kategori": "Mesin",
             "harga_perolehan": None, "penyusutan_fiskal_per_bulan": None,
             "akumulasi_penyusutan_fiskal_seharusnya": None},
        ]
    }
    hasil = fr.ringkas_penyusutan_fiskal_per_bulan(hasil_aset)
    assert len(hasil) == 1
    assert hasil[0]["harga_perolehan"] == 0.0
    assert hasil[0]["penyusutan_fiskal_per_bulan"] == 0.0
    assert hasil[0]["akumulasi_fiskal_awal_tahun"] == 0.0