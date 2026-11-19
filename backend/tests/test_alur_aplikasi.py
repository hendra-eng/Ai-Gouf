"""Tes pemuatan alur proses Zake (modules/peta_aplikasi.py + data/alur_aplikasi.md)."""
from modules import peta_aplikasi as peta


def test_alur_terbaca_dan_punya_metadata():
    alur = peta.muat_alur()
    assert alur, "data/alur_aplikasi.md kosong / tidak terbaca"
    sales = next(a for a in alur if "Sales" in a["judul"])
    assert "/transactions/sales" in sales["rute"]
    assert "posting" in sales["kata"]
    assert "Journal Preview" in sales["isi"]


def test_pertanyaan_alur_sales_memuat_alur():
    _, dinamis = peta.bangun_konteks("setelah upload file sales harus ngapain sampai posted?", None, [])
    assert "ALUR PROSES APLIKASI" in dinamis
    assert "Buat Invoice" in dinamis


def test_halaman_sales_memuat_alur_walau_pertanyaan_umum():
    _, dinamis = peta.bangun_konteks("jelaskan halaman ini", "/transactions/sales", [])
    assert "Alur: Sales" in dinamis


def test_pertanyaan_tak_terkait_tidak_memuat_alur():
    _, dinamis = peta.bangun_konteks("apa itu PPN keluaran?", "/settings", [])
    assert "Alur: Sales" not in dinamis