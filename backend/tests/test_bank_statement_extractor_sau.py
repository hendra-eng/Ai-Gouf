"""
tests/test_bank_statement_extractor_sau.py
==========================================
Regresi ekstraksi rekening koran Bank Feed (modules/transactions/
bank_statement_extractor.py) atas file contoh klien SAU di
dataset/Bank Cash/SAU (BCA, BRI, Mandiri, Laporan Kas Kasir). Angka acuan =
ringkasan resmi yang tercetak di masing-masing dokumen.

Template + mapping bank hasil analisis ini: migrations/seed_template_sau_bank_cash.sql
(signature di sana harus sama dengan signature hasil ekstraksi di bawah).

File dataset tidak ikut repo di semua mesin -> test di-skip kalau tidak ada.
"""

from decimal import Decimal
from pathlib import Path

import pytest

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.transactions import bank_statement_extractor as bx  # noqa: E402

DATASET = Path(__file__).resolve().parents[2] / "dataset" / "Bank Cash" / "SAU"

KASUS = [
    # file, metode, bank, no rekening, baris, saldo awal, saldo akhir, total debit, total kredit, signature seed
    ("SAU_BCA.pdf", "words", "BCA", "6281900118", 1422, "1754636519.17", "1253226731.28",
     "14509248283.34", "14007838495.45", "6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0"),
    ("SAU_BRI.pdf", "words", "BRI", "140301000103562", 288, "358569812.67", "384245578.67",
     "1099559581.00", "1125235347.00", "a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457"),
    ("SAU_MANDIRI.pdf", "words", "Mandiri", "1290011863475", 302, "959450372.76", "1215267719.01",
     "666420916.81", "922238263.06", "ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31"),
    ("Laporan Data Kas Kasir Finance Juni 2026.xlsx", "table", None, None, 1286, "1274590096", "985362866",
     "7023330350", "6734103120", "8dba4029b3cd2f33bd6e029efe6421766c2fd5baf786df2e55abad25390f4331"),
]


@pytest.mark.parametrize("nama,metode,bank,no_rek,jumlah,awal,akhir,debit,kredit,signature", KASUS)
def test_ekstraksi_sau_terverifikasi(nama, metode, bank, no_rek, jumlah, awal, akhir, debit, kredit, signature):
    path = DATASET / nama
    if not path.exists():
        pytest.skip(f"dataset tidak ada: {path}")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), nama)
    assert h is not None
    v = h.validasi
    assert h.metode == metode
    assert h.bank == bank
    assert h.no_rekening == no_rek
    assert h.signature == signature
    assert len(h.baris) == jumlah
    assert v["status"] == "verified" and v["rows_low"] == 0 and v["balance_mismatches"] == 0
    assert all(c["ok"] for c in v["checks"]) and v["checks"]
    assert Decimal(str(v["opening_balance"])) == Decimal(awal)
    assert Decimal(str(v["closing_balance"])) == Decimal(akhir)
    assert Decimal(str(v["total_debit"])) == Decimal(debit)
    assert Decimal(str(v["total_credit"])) == Decimal(kredit)
    assert h.periode[0] is not None and h.periode[0].isoformat() == "2026-06-01"


def test_mandiri_blok_rata_tengah_keterangan_utuh():
    """Sel rata-tengah vertikal: keterangan di atas & bawah baris nominal tetap 1 transaksi."""
    path = DATASET / "SAU_MANDIRI.pdf"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    pertama, kedua = h.baris[0], h.baris[1]
    assert pertama.keterangan.startswith("71149002440/SUMBER PETSHOP/JKT")
    assert pertama.credit == Decimal("4048419.00")
    assert kedua.keterangan == "MCM InhouseTrf DARI SITI DHARWATI M 99101"


def test_kas_kasir_saldo_pindahan_bukan_mutasi():
    """Baris 'Modal Awal Bulan' (nominal = saldo) jadi saldo awal, bukan uang masuk."""
    path = DATASET / "Laporan Data Kas Kasir Finance Juni 2026.xlsx"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    assert not any(b.keterangan.upper().startswith("MODAL AWAL BULAN") for b in h.baris)
    assert h.baris[0].keterangan == "Modal Awal Kasir"  # kolom ACCOUNT sama dengan keterangan -> tidak diulang
    assert h.baris[0].debit == Decimal("2400000.00")


def test_ringkasan_blok_kolom():
    r = {}
    bx._baca_ringkasan_kolom([
        "Saldo Awal Total Transaksi Debet Total Transaksi Kredit Saldo Akhir",
        "Opening Balance Total Debit Transaction Total Credit Transaction Closing Balance",
        "358,569,812.67 1,099,559,581.00 1,125,235,347.00 384,245,578.67",
    ], "en", r)
    assert r == {"opening": Decimal("358569812.67"), "total_debit": Decimal("1099559581.00"),
                 "total_credit": Decimal("1125235347.00"), "closing": Decimal("384245578.67")}


def test_deteksi_no_rekening():
    assert bx.deteksi_no_rekening("SUMBER ALODIE UTAMA CV NO. REKENING : 6281900118 CIRACAS") == "6281900118"
    assert bx.deteksi_no_rekening("Account No. Account Name Alias 1290011863475 SUMBER ALODIE") == "1290011863475"
    assert bx.deteksi_no_rekening("tanpa nomor") is None


def test_signature_abaikan_kolom_kosong_di_ujung():
    assert bx.signature_header(["Tanggal", "Saldo", "", ""]) == bx.signature_header(["Tanggal", "Saldo"])
