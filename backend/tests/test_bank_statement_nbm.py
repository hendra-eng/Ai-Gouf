"""
tests/test_bank_statement_nbm.py
================================
Uji seed NBM (migrations/bank_cash/seed_template_nbm_multi_format_bank_cash.sql) lewat jalur yang SAMA dengan
bank_cash_v1.py: bank_statement_parser.ekstrak_rekening_koran(content, filename, None, kandidat_template).

File contoh TIDAK ikut repo (data rekening asli). Letakkan 12 file NBM Juni-Agustus 2026 di satu folder, lalu:

    cd backend
    set BANK_SAMPLE_DIR=D:\\contoh_rekening        (Windows)   /  export BANK_SAMPLE_DIR=...
    venv\\Scripts\\python -m pytest tests/test_bank_statement_nbm.py -v

Angka yang diharapkan dibaca dari seed itu sendiri (validation_expected.samples), jadi seed dan tes tidak bisa
berbeda diam-diam. Tes yang file contohnya tidak ada di-skip otomatis.
"""

import json
import os
import re
from pathlib import Path

import pytest

from modules.transactions import bank_statement_parser as bsp

SEED = Path(__file__).resolve().parent.parent / "migrations" / "bank_cash" / "seed_template_nbm_multi_format_bank_cash.sql"
SAMPLE_DIR = Path(os.environ["BANK_SAMPLE_DIR"]) if os.environ.get("BANK_SAMPLE_DIR") else None


def _mr():
    sql = SEED.read_text(encoding="utf-8")
    return json.loads(sql[sql.index("$json$") + 6: sql.index("$json$::jsonb")])


def _kandidat(tipe: str):
    """Bentuk sama dengan bank_cash_v1._kandidat_template (baris Multi dipecah per varian)."""
    return [
        {"id": "tpl-nbm", "name": v["variant_name"], "header_columns": v["header_columns"], "rules": v["mapping_rules"]}
        for v in _mr()["variants"] if v["file_type"].lower() == tipe.lower()
    ]


KASUS = [(v["variant_name"], s) for v in _mr()["variants"] for s in v["mapping_rules"]["validation_expected"]["samples"]]


@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
def test_file_cocok_dengan_seed(varian, s):
    nama = s["file"]
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip(f"file contoh {nama} tidak ada di BANK_SAMPLE_DIR")
    tipe = "PDF" if nama.lower().endswith(".pdf") else "CSV"
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, None, _kandidat(tipe))
    v = ex["validation"]
    assert ex["recognized"] and ex["template"]["id"] == "tpl-nbm", "template NBM harus ter-identifikasi"
    assert v["status"] == "verified", v
    assert v["balance_mismatches"] == 0 and v["rows_low"] == 0 and v["rows_medium"] == 0
    assert v["opening_balance"] == pytest.approx(float(s["opening_balance"]), abs=0.005)
    assert v["closing_balance"] == pytest.approx(float(s["closing_balance"]), abs=0.005)
    assert v["total_debit"] == pytest.approx(float(s["total_debit"]), abs=0.005)
    assert v["total_credit"] == pytest.approx(float(s["total_credit"]), abs=0.005)
    if "rows" in s:
        assert len(ex["records"]) == s["rows"]
    if "count_debit" in s:
        assert sum(1 for r in ex["records"] if r["debit"] > 0) == s["count_debit"]
        assert sum(1 for r in ex["records"] if r["credit"] > 0) == s["count_credit"]


def test_resep_hanya_di_pdf_bca_dan_bri():
    rec = {v["variant_name"]: v["mapping_rules"].get("recipe") for v in _mr()["variants"]}
    assert rec["BCA - Rekening Tahapan Xpresi (PDF)"] == "bca_pdf"
    assert rec["BRI - Laporan Transaksi Finansial IBBIZ (PDF)"] == "bri_pdf"
    assert rec["BCA - KlikBCA Mutasi Rekening (CSV)"] is None and rec["BRI - Export Mutasi Core Banking (CSV)"] is None


def test_hash_varian_dan_baris_konsisten():
    mr = _mr()
    sql = SEED.read_text(encoding="utf-8")
    import hashlib
    hs = []
    for v in mr["variants"]:
        assert v["column_signature_hash"] == bsp.signature(v["header_columns"]), v["variant_name"]
        hs.append(v["column_signature_hash"])
    assert hashlib.sha256(":".join(hs).encode()).hexdigest() in sql


# ---- pemetaan akun: file BRI TIDAK boleh masuk ke akun BCA (keterangan BRI memuat nomor rekening BCA NBM) ----
MAPPING = [("BCA", "5325107836"), ("BCA", "1350838208"), ("BRI", "059001001642303"), ("BRI", "059001001757302")]


@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
@pytest.mark.parametrize("nama_netral", [False, True], ids=["nama-asli", "nama-netral"])
def test_pemetaan_akun_benar(varian, s, nama_netral):
    bank_cash_v1 = pytest.importorskip("modules.transactions.bank_cash_v1")
    nama = s["file"]
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip(f"file contoh {nama} tidak ada di BANK_SAMPLE_DIR")
    ext = os.path.splitext(nama)[1]
    tipe = "PDF" if ext.lower() == ".pdf" else "CSV"
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), "unduhan" + ext if nama_netral else nama, None, _kandidat(tipe))
    mappings = [dict(id=str(i), bank_name=b, account_number=n, match_keyword=None, bank_coa_id=str(i), template_id=None, is_active=True)
                for i, (b, n) in enumerate(MAPPING)]
    m, by = bank_cash_v1._cari_mapping(mappings, ex, None)
    benar = re.search(r"(\d{10,15})", nama).group(1)
    assert m and m["account_number"].lstrip("0") == benar.lstrip("0"), (m, by)