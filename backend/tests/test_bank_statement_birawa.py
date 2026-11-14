"""
tests/test_bank_statement_birawa.py
===================================
Uji seed Birawa (migrations/bank_cash/seed_template_birawa_multi_format_bank_cash.sql) + recipe `permata_pdf`
(bank_statement_recipes.py) lewat jalur yang SAMA dengan bank_cash_v1.py:
bank_statement_parser.ekstrak_rekening_koran(content, filename, None, kandidat_template).

File contoh TIDAK ikut repo (data rekening asli). Letakkan 3 PDF Permata Birawa Juni-Agustus 2026 di satu folder, lalu:

    cd backend
    set BANK_SAMPLE_DIR=D:\\contoh_rekening        (Windows)   /  export BANK_SAMPLE_DIR=...
    venv\\Scripts\\python -m pytest tests/test_bank_statement_birawa.py -v

Angka yang diharapkan dibaca dari seed itu sendiri (validation_expected.samples), jadi seed dan tes tidak bisa
berbeda diam-diam. Tes yang file contohnya tidak ada di-skip otomatis.
"""

import hashlib
import json
import os
import re
from pathlib import Path

import pytest

from modules.transactions import bank_statement_parser as bsp
from modules.transactions import bank_statement_recipes as resep

SEED = Path(__file__).resolve().parent.parent / "migrations" / "bank_cash" / "seed_template_birawa_multi_format_bank_cash.sql"
SAMPLE_DIR = Path(os.environ["BANK_SAMPLE_DIR"]) if os.environ.get("BANK_SAMPLE_DIR") else None


def _mr():
    sql = SEED.read_text(encoding="utf-8")
    return json.loads(sql[sql.index("$json$") + 6: sql.index("$json$::jsonb")])


def _kandidat(tipe: str, tanpa_resep: bool = False):
    """Bentuk sama dengan bank_cash_v1._kandidat_template (baris Multi dipecah per varian)."""
    out = []
    for v in _mr()["variants"]:
        if v["file_type"].lower() != tipe.lower():
            continue
        rules = dict(v["mapping_rules"])
        if tanpa_resep:
            rules.pop("recipe", None)
        out.append({"id": "tpl-birawa", "name": v["variant_name"], "header_columns": v["header_columns"], "rules": rules})
    return out


KASUS = [(v["variant_name"], s) for v in _mr()["variants"] for s in v["mapping_rules"]["validation_expected"]["samples"]]


def _baca(nama: str) -> bytes:
    if not SAMPLE_DIR or not (SAMPLE_DIR / nama).exists():
        pytest.skip(f"file contoh {nama} tidak ada di BANK_SAMPLE_DIR")
    return (SAMPLE_DIR / nama).read_bytes()


# ---- 1) file contoh -> hasil baca cocok dengan angka di seed ----
@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
def test_file_cocok_dengan_seed(varian, s):
    nama = s["file"]
    ex = bsp.ekstrak_rekening_koran(_baca(nama), nama, None, _kandidat("PDF"))
    v = ex["validation"]
    assert ex["recognized"] and ex["template"]["id"] == "tpl-birawa", "template Birawa harus ter-identifikasi"
    assert v["status"] == "verified", v
    assert v["balance_mismatches"] == 0 and v["rows_low"] == 0 and v["rows_medium"] == 0
    assert ex["warnings"] == []
    assert ex["bank_name"] == "Permata"
    assert ex["account_number"].lstrip("0") == s["account"].lstrip("0")
    assert len(ex["records"]) == s["rows"]
    assert v["opening_balance"] == pytest.approx(float(s["opening_balance"]), abs=0.005)
    assert v["closing_balance"] == pytest.approx(float(s["closing_balance"]), abs=0.005)
    assert v["total_debit"] == pytest.approx(float(s["total_debit"]), abs=0.005)
    assert v["total_credit"] == pytest.approx(float(s["total_credit"]), abs=0.005)


@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
def test_nama_file_tidak_dipakai_untuk_deteksi(varian, s):
    """Nama file Birawa tidak seragam -> hasil harus sama walau file diunduh dengan nama netral."""
    ex = bsp.ekstrak_rekening_koran(_baca(s["file"]), "unduhan.pdf", None, _kandidat("PDF"))
    assert ex["validation"]["status"] == "verified" and len(ex["records"]) == s["rows"]
    assert ex["account_number"].lstrip("0") == s["account"].lstrip("0")


def test_tanpa_resep_parser_generik_tidak_cukup():
    """Bukti bahwa recipe memang diperlukan (generik: Juli hanya terbaca sebagian)."""
    s = KASUS[1][1]  # Juli: 72 baris
    ex = bsp.ekstrak_rekening_koran(_baca(s["file"]), s["file"], None, _kandidat("PDF", tanpa_resep=True))
    assert len(ex["records"]) != s["rows"] or ex["validation"]["status"] != "verified"


@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
def test_isi_baris_masuk_akal(varian, s):
    ex = bsp.ekstrak_rekening_koran(_baca(s["file"]), s["file"], None, _kandidat("PDF"))
    rec = ex["records"]
    assert all((r["debit"] > 0) != (r["credit"] > 0) or r["debit"] == r["credit"] == 0 for r in rec), "tiap baris hanya debit ATAU kredit"
    assert all("BBii" not in (r["description"] or "") for r in rec), "teks dobel harus sudah dibuang"
    assert rec[-1]["balance"] == pytest.approx(float(s["closing_balance"]), abs=0.005)
    assert {r["date"].year for r in rec} == {2026}
    assert any("PAJAK ATAS BUNGA" in (r["description"] or "") and r["debit"] > 0 for r in rec)
    assert any("PENDAPATAN" in (r["description"] or "") and r["credit"] > 0 for r in rec)


# ---- 2) seed konsisten (tanpa file contoh) ----
def test_resep_permata_pdf_terdaftar():
    assert _mr()["variants"][0]["mapping_rules"]["recipe"] == "permata_pdf"
    assert "permata_pdf" in resep.RESEP


def test_hash_varian_dan_baris_konsisten():
    mr = _mr()
    sql = SEED.read_text(encoding="utf-8")
    hs = []
    for v in mr["variants"]:
        assert v["column_signature_hash"] == bsp.signature(v["header_columns"]), v["variant_name"]
        hs.append(v["column_signature_hash"])
    assert hashlib.sha256(":".join(hs).encode()).hexdigest() in sql


def test_saldo_antar_bulan_tersambung():
    """Saldo akhir bulan N = saldo awal bulan N+1 (Juni -> Juli -> Agustus), dan awal + kredit - debit = akhir."""
    s = [x for _, x in KASUS]
    for a, b in zip(s, s[1:]):
        assert a["closing_balance"] == b["opening_balance"], (a["file"], b["file"])
    for x in s:
        hitung = round(float(x["opening_balance"]) + float(x["total_credit"]) - float(x["total_debit"]), 2)
        assert hitung == pytest.approx(float(x["closing_balance"]), abs=0.005), x["file"]


def test_header_harus_berurutan_di_halaman_pertama():
    kol = [resep.norm_header(c) for c in _mr()["variants"][0]["header_columns"]]
    kata = [{"text": t, "x0": i * 10.0, "x1": i * 10.0 + 9, "top": 100.0}
            for i, t in enumerate(["No.", "Post", "Date", "Eff", "Date", "Ref", "No", "Description", "Debit", "Credit"])]
    assert resep._urutan_ada(resep._teks_halaman_norm({"kata": kata}), kol)
    assert not resep._urutan_ada(resep.norm_header("Credit Debit Description"), kol)


# ---- 3) unit: kolom No menempel ke Post Date ----
@pytest.mark.parametrize("teks,no,tgl", [
    ("101-Jun-2026", "1", "01-Jun-2026"),
    ("1002-Jul-2026", "10", "02-Jul-2026"),
    ("6531-Aug-2026", "65", "31-Aug-2026"),
])
def test_pisah_no_dan_tanggal(teks, no, tgl):
    m = resep._PM_NOTGL.match(teks)
    assert m and m.group(1) == no and m.group(2) == tgl
    assert resep._pm_tgl(tgl).year == 2026


# ---- 4) pemetaan akun (butuh bank_cash_v1 -> di-skip bila dependensi API tidak terpasang) ----
@pytest.mark.parametrize("varian,s", KASUS, ids=[k[1]["file"] for k in KASUS])
@pytest.mark.parametrize("nama_netral", [False, True], ids=["nama-asli", "nama-netral"])
def test_pemetaan_akun_benar(varian, s, nama_netral):
    bank_cash_v1 = pytest.importorskip("modules.transactions.bank_cash_v1")
    nama = s["file"]
    ex = bsp.ekstrak_rekening_koran(_baca(nama), "unduhan.pdf" if nama_netral else nama, None, _kandidat("PDF"))
    mappings = [dict(id="0", bank_name="Permata", account_number="00702328993", match_keyword=None,
                     bank_coa_id="0", template_id=None, is_active=True)]
    m, by = bank_cash_v1._cari_mapping(mappings, ex, None)
    assert m and re.sub(r"\D", "", m["account_number"]).lstrip("0") == "702328993", (m, by)
    assert by == "account_number"