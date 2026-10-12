"""
tests/test_bank_statement_extractor_nbm.py
==========================================
Regresi ekstraksi rekening koran Bank Feed (modules/transactions/
bank_statement_extractor.py) atas file contoh klien NBM di
dataset/Bank Cash/NBM: BCA (PDF rekening koran + CSV KlikBCA) dan BRI (PDF IBBIZ +
CSV export core banking). Angka acuan = ringkasan resmi di dokumen (CSV BRI tanpa
ringkasan: saldo sebelum transaksi pertama & saldo sesudah transaksi terakhir).

Template + mapping bank hasil analisis ini: migrations/seed_template_nbm_bank_cash.sql
(signature di sana harus sama dengan signature hasil ekstraksi di bawah).

File dataset tidak ikut repo di semua mesin -> test di-skip kalau tidak ada.
"""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.transactions import bank_statement_extractor as bx  # noqa: E402

DATASET = Path(__file__).resolve().parents[2] / "dataset" / "Bank Cash" / "NBM"
JUNI = (date(2026, 6, 1), date(2026, 6, 30))

KASUS = [
    # file, metode, bank (tanpa template), no rekening, baris, saldo awal, saldo akhir, total debit, total kredit, periode, signature seed
    ("NBM_BCA.pdf", "words", "BCA", "5325107836", 34, "50536392.99", "59299617.95", "40010175.99", "48773400.95",
     JUNI, "6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0"),
    ("NBM_BCA.csv", "table", None, "1350838208", 344, "19233714.86", "18907777.71", "318567713.55", "318241776.40",
     JUNI, "f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9"),
    ("NBM__BRI.pdf", "words", "BRI", "059001001642303", 80, "44315363.60", "40371281.60", "131272114.00", "127328032.00",
     JUNI, "a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457"),
    ("NBM__BRI.csv", "table", None, "59001001642303", 103, "63834752.60", "58801680.60", "169318044.00", "164284972.00",
     (date(2026, 8, 1), date(2026, 8, 31)), "dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf"),
]


@pytest.mark.parametrize("nama,metode,bank,no_rek,jumlah,awal,akhir,debit,kredit,periode,signature", KASUS)
def test_ekstraksi_nbm_terverifikasi(nama, metode, bank, no_rek, jumlah, awal, akhir, debit, kredit, periode, signature):
    path = DATASET / nama
    if not path.exists():
        pytest.skip(f"dataset tidak ada: {path}")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), nama)
    assert h is not None
    v = h.validasi
    assert h.metode == metode
    assert h.bank == bank  # CSV: nama bank tidak tercetak -> label datang dari template seed
    assert h.no_rekening == no_rek
    assert h.signature == signature
    assert len(h.baris) == jumlah
    assert v["status"] == "verified" and v["rows_low"] == 0 and v["rows_medium"] == 0 and v["balance_mismatches"] == 0
    assert Decimal(str(v["opening_balance"])) == Decimal(awal)
    assert Decimal(str(v["closing_balance"])) == Decimal(akhir)
    assert Decimal(str(v["total_debit"])) == Decimal(debit)
    assert Decimal(str(v["total_credit"])) == Decimal(kredit)
    assert all(c["ok"] for c in v["checks"])
    assert h.periode == periode


def test_bri_pdf_ringkasan_tidak_menempel_ke_transaksi_terakhir():
    path = DATASET / "NBM__BRI.pdf"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    assert h.baris[-1].keterangan == "QRISOffUs_3_260629_001999490260_FAS.A.FA BRIMTXDT"


def test_bri_csv_saldo_sebelum_dan_keterangan():
    """SALDO_AWAL_MUTASI = saldo sebelum transaksi (bukan saldo berjalan); REMARK_CUSTOM
    yang sudah ada di DESK_TRAN & SEQ "0" tidak diulang di keterangan."""
    path = DATASET / "NBM__BRI.csv"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    peran = dict(zip(h.headers, h.aturan.roles))
    assert peran["SALDO_AWAL_MUTASI"] == "balance_before" and peran["SALDO_AKHIR_MUTASI"] == "balance"
    assert peran["DESK_TRAN"] == "description"
    assert h.baris[0].keterangan == "OffUs 1 260731 001999490260 FAS.A.FAS BA AMT:1.705.700,00MDR:21.741,00"
    assert h.baris[0].credit == Decimal("1683959.00") and h.baris[0].saldo == Decimal("65518711.60")


def test_bca_csv_spasi_ganda_dirapatkan():
    path = DATASET / "NBM_BCA.csv"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    assert h.baris[2].keterangan == "SWITCHING CR TRF DR 002 NAWASANGA BERTATAP IB BISNIS 0998"


def test_peran_header_saldo_sebelum():
    assert bx.peran_header("SALDO_AWAL_MUTASI") == "balance_before"
    assert bx.peran_header("Balance Before Transaction") == "balance_before"
    assert bx.peran_header("SALDO_AKHIR_MUTASI") == "balance"
    assert bx.peran_header("Saldo") == "balance"
