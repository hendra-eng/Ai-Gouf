"""
tests/test_sales_periode_nama_file.py
=====================================
Uji filter periode dari NAMA FILE (resep filter_periode_nama_file) untuk Sales Source Data:
  - pembaca periode di nama file (_periode_filter_dari_nama_file),
  - penyaring baris (_saring_periode_nama_file),
  - uji ujung-ke-ujung 3 file asli UBD (Juni/Juli/Agustus, semuanya kumulatif Jan..bulan itu).
"""
import datetime as dt
import json
import os
import re
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/db")
os.environ.setdefault("JWT_SECRET_KEY", "test-only")

import modules.transactions.sales_import_v1 as si  # noqa: E402

D = dt.date
ROOT = Path(__file__).parent.parent
SEED = ROOT / "migrations" / "sales" / "seed_template_ubd_multi_format_sales.sql"
DATASET = ROOT.parent / "dataset" / "Sales" / "UBD"


def _p(nama):
    p = si._periode_filter_dari_nama_file(nama)
    return None if p is None else (p["awal"], p["akhir"], p["bulan_penuh"], p["versi"])


@pytest.mark.parametrize("nama,harap", [
    ("UBD_SALES_202608.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, None)),
    ("UBD_monitoring_project_income_202608_roy.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, None)),
    ("UBD_SALES_202602.xlsx", (D(2026, 2, 1), D(2026, 2, 28), True, None)),
    ("UBD_SALES_2026-08.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, None)),
    ("UBD_SALES_20260801-20260815.xlsx", (D(2026, 8, 1), D(2026, 8, 15), False, None)),
    ("UBD_SALES_20260801_20260815.xlsx", (D(2026, 8, 1), D(2026, 8, 15), False, None)),
    ("UBD_SALES_20260815.xlsx", (D(2026, 8, 15), D(2026, 8, 15), False, None)),
    ("UBD_SALES_202608_v2.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, 2)),
    ("UBD_SALES_20260801-20260815_v3.xlsx", (D(2026, 8, 1), D(2026, 8, 15), False, 3)),
    ("sales_by_customer_01-08-2026_31-08-2026.xlsx", (D(2026, 8, 1), D(2026, 8, 31), False, None)),
    ("Report Transaction - 01-07-2026 - 31-07-2026 - All_Outlet - 865077 - 6aa7451c.csv",
     (D(2026, 7, 1), D(2026, 7, 31), False, None)),
    ("UBD_SALES_Agustus_2026.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, None)),
    ("UBD SALES Aug 2026.xlsx", (D(2026, 8, 1), D(2026, 8, 31), True, None)),
    (r"C:\Users\x\Downloads\UBD_SALES_202611.xlsx", (D(2026, 11, 1), D(2026, 11, 30), True, None)),
])
def test_periode_terbaca(nama, harap):
    assert _p(nama) == harap


@pytest.mark.parametrize("nama", [
    "UBD_SALES.xlsx", "laporan penjualan.xlsx", "UBD_SALES_202613.xlsx", "UBD_SALES_20261345.xlsx",
    "UBD_SALES_20260815-20260801.xlsx",  # rentang terbalik
    "Report_865077.csv", "Market_2026.xlsx", "", None,
])
def test_periode_tidak_ada(nama):
    assert _p(nama) is None


def _baris(*tanggal):
    return [{"row_no": i + 1, "tanggal": t, "is_valid": t is not None, "dpp": 1.0, "ppn": 0.0, "total": 1.0,
             "is_duplicate_candidate": False} for i, t in enumerate(tanggal)]


def test_filter_mati_tanpa_flag():
    hasil = _baris(D(2026, 1, 5), D(2026, 8, 5))
    out, info = si._saring_periode_nama_file(hasil, {}, "UBD_SALES_202608.xlsx")
    assert out is hasil and info is None


def test_filter_ambil_bulan_dan_nomori_ulang():
    hasil = _baris(D(2026, 1, 5), D(2026, 8, 5), dt.datetime(2026, 8, 31, 0, 0), D(2026, 9, 1), None)
    out, info = si._saring_periode_nama_file(hasil, {"filter_periode_nama_file": True}, "UBD_SALES_202608.xlsx")
    assert [r["tanggal"] for r in out] == [D(2026, 8, 5), dt.datetime(2026, 8, 31), None]  # tanggal tak terbaca dibawa (invalid)
    assert [r["row_no"] for r in out] == [1, 2, 3]
    assert (info["diambil"], info["dilewati"], info["total_di_file"]) == (3, 2, 5)
    assert info["label"] == "Agustus 2026"


def test_filter_rentang_tanggal():
    hasil = _baris(D(2026, 8, 1), D(2026, 8, 15), D(2026, 8, 16))
    out, info = si._saring_periode_nama_file(hasil, {"filter_periode_nama_file": True}, "UBD_SALES_20260801-20260815.xlsx")
    assert len(out) == 2 and info["dilewati"] == 1 and info["label"] == "01-08-2026 s/d 15-08-2026"


def test_nama_tanpa_periode_ditolak():
    with pytest.raises(ValueError, match="tidak memuat periode"):
        si._saring_periode_nama_file(_baris(D(2026, 8, 5)), {"filter_periode_nama_file": True}, "UBD_SALES.xlsx")


def test_periode_tanpa_transaksi_ditolak():
    with pytest.raises(ValueError, match="Tidak ada transaksi di periode"):
        si._saring_periode_nama_file(_baris(D(2026, 8, 5)), {"filter_periode_nama_file": True}, "UBD_SALES_202609.xlsx")


def test_mapping_rules_file_matikan_kumulatif():
    info = {"label": "Agustus 2026"}
    out = si._mapping_rules_file({"file_kumulatif": True, "x": 1}, info)
    assert "file_kumulatif" not in out and out["periode_filter"] == info and out["x"] == 1
    asli = {"file_kumulatif": True}
    assert si._mapping_rules_file(asli, None) is asli


# ------------------------------------------------ ujung-ke-ujung: 3 file asli UBD

def _varian_ubd():
    teks = SEED.read_text(encoding="utf-8")
    return json.loads(re.search(r"\$json\$(.*?)\$json\$", teks, re.S).group(1))["variants"]


def test_seed_ubd_pakai_filter():
    v = _varian_ubd()
    assert v[0]["mapping_rules"]["filter_periode_nama_file"] is True
    assert not v[0]["mapping_rules"].get("file_kumulatif")


@pytest.mark.skipif(not DATASET.exists(), reason="dataset UBD tidak ada")
@pytest.mark.parametrize("sub,nama_asli,nama_upload,harap", [
    ("Juni", "UBD_monitoring_project_income_202606.xlsx", "UBD_SALES_202606.xlsx", (9, 0)),
    ("Juli", "UBD_monitoring_project_income_202607.xlsx", "UBD_SALES_202607.xlsx", (8, 0)),
    ("Agustus", "UBD_monitoring_project_income_202608_roy.xlsx", "UBD_SALES_202608.xlsx", (4, 0)),
])
def test_ubd_tiga_file_hanya_bulannya(sub, nama_asli, nama_upload, harap):
    si.dbc.list_sales_import_templates = lambda client_id=None, hanya_aktif=True: [
        {"id": "t1", "client_id": "c", "file_type": "Multi", "mapping_rules": {"variants": _varian_ubd()}}]
    isi = (DATASET / sub / nama_asli).read_bytes()
    cocok = si._cocokkan_template(isi, "Excel", "c")
    assert cocok is not None
    template, sumber = cocok
    mentah = si._ekstrak_dengan_template(sumber, template, nama_upload)
    assert len(mentah) > harap[0]  # file asli kumulatif: isinya Jan..bulan itu
    out, info = si._saring_periode_nama_file(mentah, template["mapping_rules"], nama_upload)
    bulan = int(nama_upload[-7:-5])
    assert len(out) == harap[0]
    assert all(r["tanggal"].month == bulan for r in out)
    assert info["diambil"] + info["dilewati"] == len(mentah)
    # tanpa periode di nama -> ditolak
    with pytest.raises(ValueError):
        si._saring_periode_nama_file(mentah, template["mapping_rules"], "UBD_SALES.xlsx")
