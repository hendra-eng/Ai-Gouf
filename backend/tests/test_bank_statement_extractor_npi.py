"""
tests/test_bank_statement_extractor_npi.py
==========================================
Regresi ekstraksi rekening koran Bank Feed (modules/transactions/
bank_statement_extractor.py) atas file contoh klien NPI di
dataset/Bank Cash/NPI (OCBC, Mandiri Kopra). Angka acuan = ringkasan resmi
yang tercetak di masing-masing dokumen.

Template + mapping bank hasil analisis ini: migrations/seed_template_npi_bank_cash.sql
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

DATASET = Path(__file__).resolve().parents[2] / "dataset" / "Bank Cash" / "NPI"

KASUS = [
    # file, metode, bank (tanpa template), no rekening, baris, saldo awal, saldo akhir, total debit, total kredit, signature seed
    ("NPI_OCBC.pdf", "grid", None, "163800007094", 60, "23065.00", "728335.00",
     "312921257.00", "313626527.00", "5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4"),
    ("NPI_MANDIRI.pdf", "words", "Mandiri", "1750003319273", 431, "42894694.93", "51408327.55",
     "458401907.91", "466915540.53", "ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31"),
]


@pytest.mark.parametrize("nama,metode,bank,no_rek,jumlah,awal,akhir,debit,kredit,signature", KASUS)
def test_ekstraksi_npi_terverifikasi(nama, metode, bank, no_rek, jumlah, awal, akhir, debit, kredit, signature):
    path = DATASET / nama
    if not path.exists():
        pytest.skip(f"dataset tidak ada: {path}")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), nama)
    assert h is not None
    v = h.validasi
    assert h.metode == metode
    assert h.bank == bank  # OCBC: nama bank hanya logo -> label datang dari template seed
    assert h.no_rekening == no_rek
    assert h.signature == signature
    assert len(h.baris) == jumlah
    assert v["status"] == "verified" and v["rows_low"] == 0 and v["balance_mismatches"] == 0
    assert all(c["ok"] for c in v["checks"]) and v["checks"]
    assert Decimal(str(v["opening_balance"])) == Decimal(awal)
    assert Decimal(str(v["closing_balance"])) == Decimal(akhir)
    assert Decimal(str(v["total_debit"])) == Decimal(debit)
    assert Decimal(str(v["total_credit"])) == Decimal(kredit)
    assert h.periode == (date(2026, 6, 1), date(2026, 6, 30))


def test_mandiri_ekor_keterangan_sebelum_kolom_referensi():
    """'MARIETTA/KKG  DR' -- 'DR' jatuh di zona kolom Reference No. tapi mulai sebelum
    judulnya -> tetap bagian keterangan, urutannya tidak pindah ke belakang."""
    path = DATASET / "NPI_MANDIRI.pdf"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    assert h.baris[1].keterangan == "71669359480/PLAZA MARIETTA/KKG DR 0000029511812 KR 1750003319273 99106"


def test_periode_iso_from_to():
    assert bx._cari_periode("ACCOUNT STATEMENT FROM : 2026-06-01 TO : 2026-06-30") == (date(2026, 6, 1), date(2026, 6, 30))
    assert bx.deteksi_no_rekening("Account No : 163800007094 - IDR Opening Balance : 23,065.00") == "163800007094"
