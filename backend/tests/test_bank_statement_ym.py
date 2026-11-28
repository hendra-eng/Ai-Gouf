"""
tests/test_bank_statement_ym.py
===============================
Uji template YM (PT YONISO MASIKARA): BNI BNIDirect + Mandiri Kopra, Juni-Agustus 2026.
Jalur sama dengan bank_cash_v1.py: bank_statement_parser.ekstrak_rekening_koran(content, filename, None, kandidat).

File contoh TIDAK ikut repo (data rekening asli). Letakkan 6 PDF (YM_BNI_2026xx.pdf, YM_MANDIRI_2026xx.pdf) di satu folder:

    cd backend
    set BANK_SAMPLE_DIR=D:\\contoh_rekening        (Windows)   /  export BANK_SAMPLE_DIR=...
    venv\\Scripts\\python -m pytest tests/test_bank_statement_ym.py -v

Tes yang file contohnya tidak ada di-skip otomatis. Angka acuan = ringkasan RESMI di dokumen masing-masing.
"""

import json
import os
import re
from pathlib import Path

import pytest

from modules.transactions import bank_statement_parser as bsp

SEED = Path(__file__).resolve().parent.parent / "migrations" / "bank_cash" / "seed_template_ym_multi_format_bank_cash.sql"
SAMPLE_DIR = Path(os.environ["BANK_SAMPLE_DIR"]) if os.environ.get("BANK_SAMPLE_DIR") else None

# (file, bank, baris, total debit, total kredit, saldo awal, saldo akhir, no. rekening)
KASUS = [
    ("YM_BNI_202606.pdf", "BNI", 6, 30473.00, 45743413.00, 49716236.00, 95429176.00, "159665205"),
    ("YM_BNI_202607.pdf", "BNI", 22, 95484797.00, 75028309.00, 95429176.00, 74972688.00, "159665205"),
    ("YM_BNI_202608.pdf", "BNI", 22, 102040440.00, 117451205.00, 74972688.00, 90383453.00, "159665205"),
    ("YM_MANDIRI_202606.pdf", "Mandiri", 23, 27199380.19, 2755.95, 31656243.68, 4459619.44, "1450015662063"),
    ("YM_MANDIRI_202607.pdf", "Mandiri", 56, 65594145.00, 61500520.90, 4459619.44, 365995.34, "1450015662063"),
    ("YM_MANDIRI_202608.pdf", "Mandiri", 76, 92559963.00, 92550485.05, 365995.34, 356517.39, "1450015662063"),
]


def _kandidat():
    sql = SEED.read_text(encoding="utf-8")
    mr = json.loads(re.search(r"\$json\$(.*?)\$json\$", sql, re.S).group(1))
    out = []
    for v in mr["variants"]:
        rules = dict(v.get("mapping_rules") or {})
        for k in ("header_row_index", "sheet_name"):
            if rules.get(k) is None and v.get(k) is not None:
                rules[k] = v[k]
        out.append({"id": "t", "name": v.get("variant_name"), "header_columns": v.get("header_columns") or [], "rules": rules})
    return out


def _ekstrak(nama_file: str, nama_upload: str = None):
    if SAMPLE_DIR is None or not (SAMPLE_DIR / nama_file).exists():
        pytest.skip(f"File contoh {nama_file} tidak ada (set BANK_SAMPLE_DIR).")
    return bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama_file).read_bytes(), nama_upload or nama_file, None, _kandidat())


@pytest.mark.parametrize("nama,bank,baris,td,tk,awal,akhir,norek", KASUS)
def test_angka_sesuai_ringkasan_dokumen(nama, bank, baris, td, tk, awal, akhir, norek):
    ex = _ekstrak(nama)
    r = ex["records"]
    assert ex["recognized"] is True
    assert ex["validation"]["status"] == "verified"
    assert len(r) == baris
    assert round(sum(x["debit"] for x in r), 2) == td
    assert round(sum(x["credit"] for x in r), 2) == tk
    assert ex["validation"]["opening_balance"] == pytest.approx(awal)
    assert ex["validation"]["closing_balance"] == pytest.approx(akhir)
    assert ex["account_number"] == norek
    assert ex["bank_name"] == bank


def test_saldo_berjalan_tanpa_selisih():
    for nama, *_ in KASUS:
        ex = _ekstrak(nama)
        prev = ex["validation"]["opening_balance"]
        for x in ex["records"]:
            assert abs(prev - x["debit"] + x["credit"] - x["balance"]) <= 0.015, (nama, x["date"])
            prev = x["balance"]


def test_footer_kopra_tidak_masuk_deskripsi():
    for nama in ("YM_MANDIRI_202606.pdf", "YM_MANDIRI_202607.pdf", "YM_MANDIRI_202608.pdf"):
        for x in _ekstrak(nama)["records"]:
            assert not re.search(r"further questions|Help Center|koprabymandiri", x["description"], re.I), (nama, x["description"])


def test_deteksi_tidak_bergantung_nama_file():
    assert _ekstrak("YM_BNI_202607.pdf", "Rekening Koran BNI Juli.pdf")["template"]["name"].startswith("BNI")
    assert _ekstrak("YM_MANDIRI_202606.pdf", "mutasi (1).pdf")["template"]["name"].startswith("Mandiri")


def test_saldo_tersambung_antar_bulan():
    for bank in ("BNI", "MANDIRI"):
        akhir = {m: _ekstrak(f"YM_{bank}_2026{m}.pdf")["validation"]["closing_balance"] for m in ("06", "07")}
        awal = {m: _ekstrak(f"YM_{bank}_2026{m}.pdf")["validation"]["opening_balance"] for m in ("07", "08")}
        assert akhir["06"] == pytest.approx(awal["07"])
        assert akhir["07"] == pytest.approx(awal["08"])
