"""
tests/test_bank_statement_recipes.py
====================================
Uji resep bank (bank_statement_recipes.py) lewat jalur yang SAMA dengan bank_cash_v1.py:
bank_statement_parser.ekstrak_rekening_koran(content, filename, None, kandidat_template).

File contoh TIDAK ikut repo (data rekening asli). Letakkan 4 file SAU Agustus 2026 di satu folder lalu:

    cd backend
    set BANK_SAMPLE_DIR=D:\\contoh_rekening        (Windows)   /  export BANK_SAMPLE_DIR=...
    venv\\Scripts\\python -m pytest tests/test_bank_statement_recipes.py -v

Tes yang file contohnya tidak ada di-skip otomatis.
Angka yang diharapkan = ringkasan RESMI di dalam dokumen masing-masing.
"""

import json
import os
import re
from pathlib import Path

import pytest

from modules.transactions import bank_statement_parser as bsp

SEED = Path(__file__).resolve().parent.parent / "migrations" / "bank_cash" / "seed_template_sau_multi_format_bank_cash.sql"
SAMPLE_DIR = Path(os.environ.get("BANK_SAMPLE_DIR", "")) if os.environ.get("BANK_SAMPLE_DIR") else None

# (nama file, tipe, bank, jumlah baris, total debit, total kredit, saldo awal, saldo akhir, no. rekening di dokumen)
KASUS = [
    ("SAU_BCA_06281900118_202608.pdf", "PDF", "BCA", 1364, 13600320170.05, 13148496472.18, 1726047117.43, 1274223419.56, "6281900118"),
    ("SAU_BRI_1751950554900542085_202608.pdf", "PDF", "BRI", 325, 912673668.00, 1402670230.00, 322212643.67, 812209205.67, "140301000103562"),
    ("SAU_MANDIRI_1290011863475_202608.pdf", "PDF", "Mandiri", 309, 1186794228.96, 910510712.80, 1102947795.47, 826664279.31, "1290011863475"),
    ("Laporan_Data_Kas_Kasir_Finance_Agustus_2026.xlsx", "Excel", "Kas Kasir", 1193, 6429824247.0, 6496399337.0, 445641438.0, 512216528.0, None),
]


def _kandidat(tipe: str):
    """Bentuk sama dengan bank_cash_v1._kandidat_template (baris Multi dipecah per varian)."""
    sql = SEED.read_text(encoding="utf-8")
    mr = json.loads(sql[sql.index("$json$") + 6: sql.index("$json$::jsonb")])
    return [
        {"id": "tpl-sau", "name": v["variant_name"], "header_columns": v["header_columns"], "rules": v["mapping_rules"]}
        for v in mr["variants"] if v["file_type"].lower() == tipe.lower()
    ]


@pytest.mark.parametrize("nama,tipe,bank,n,td,tk,awal,akhir,rek", KASUS)
def test_resep_cocok_dengan_ringkasan_dokumen(nama, tipe, bank, n, td, tk, awal, akhir, rek):
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip(f"file contoh {nama} tidak ada di BANK_SAMPLE_DIR")
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, None, _kandidat(tipe))
    v = ex["validation"]
    assert ex["recognized"] and ex["template"]["id"] == "tpl-sau", "resep harus yang menangani file ini"
    assert ex["bank_name"] == bank and ex["method"] in ("words", "table")
    assert len(ex["records"]) == n
    assert v["status"] == "verified", v
    assert v["balance_mismatches"] == 0 and v["rows_low"] == 0 and v["rows_medium"] == 0
    assert v["total_debit"] == pytest.approx(td, abs=0.005) and v["total_credit"] == pytest.approx(tk, abs=0.005)
    assert v["opening_balance"] == pytest.approx(awal, abs=0.005) and v["closing_balance"] == pytest.approx(akhir, abs=0.005)
    assert all(c["ok"] for c in v["checks"])
    if rek:
        assert ex["account_number"] == rek


def test_kas_kasir_modal_awal_bukan_mutasi():
    nama = "Laporan_Data_Kas_Kasir_Finance_Agustus_2026.xlsx"
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip("file contoh Kas Kasir tidak ada")
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, None, _kandidat("Excel"))
    assert not any("modal awal bulan" in (r["description"] or "").lower() for r in ex["records"])


def test_mandiri_remark_tumpah_ke_atas_header_halaman_berikut():
    nama = "SAU_MANDIRI_1290011863475_202608.pdf"
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip("file contoh Mandiri tidak ada")
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, None, _kandidat("PDF"))
    # transaksi 02 Aug 13:06:29 (FLIPTECH LENTERA) remark-nya menyambung ke halaman 3
    r = next(r for r in ex["records"] if r["credit"] == 478000.0 and "FLIPTECH" in r["description"])
    assert "260802130448286362199" in r["description"].replace(" ", "")


def test_tanpa_resep_parser_generik_tetap_jalan():
    nama = "SAU_BRI_1751950554900542085_202608.pdf"
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip("file contoh BRI tidak ada")
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, None, [])  # tanpa template
    assert ex["recognized"] and ex["template"] is None and len(ex["records"]) > 0


def test_peran_kolom_manual_user_melewati_resep():
    nama = "SAU_BRI_1751950554900542085_202608.pdf"
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip("file contoh BRI tidak ada")
    rules_user = {"columns": [], "number_format": "en", "date_order": "dmy"}
    ex = bsp.ekstrak_rekening_koran((SAMPLE_DIR / nama).read_bytes(), nama, rules_user, _kandidat("PDF"))
    assert ex["template"] is None or ex["method"] != "recipe"


def test_seed_hash_varian_sesuai_signature():
    sql = SEED.read_text(encoding="utf-8")
    mr = json.loads(sql[sql.index("$json$") + 6: sql.index("$json$::jsonb")])
    for v in mr["variants"]:
        assert v["column_signature_hash"] == bsp.signature(v["header_columns"]), v["variant_name"]
        assert v["mapping_rules"].get("recipe"), v["variant_name"]