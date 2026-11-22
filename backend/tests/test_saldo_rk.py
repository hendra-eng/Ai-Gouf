"""
Tes kolom "Saldo RK" di sheet TB (Download Excel, halaman Reports).

Logika status ada di modules/financial_statements/saldo_rk_core.py (pustaka standar saja), jadi dimuat langsung dari
file-nya: tes ini tidak butuh database, FastAPI, maupun seluruh aplikasi.
Query SQL-nya dicek sebagai teks (aturan pemilihan rekening koran); perilakunya sudah diuji ke PostgreSQL sungguhan
saat fitur ini dibuat.

Jalankan (dari folder backend):
    venv\\Scripts\\python -m pytest tests/test_saldo_rk.py -q
"""

import importlib.util
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
_CORE = _BACKEND / "modules" / "financial_statements" / "saldo_rk_core.py"
_V1 = _BACKEND / "modules" / "financial_statements" / "saldo_rk_v1.py"

_spec = importlib.util.spec_from_file_location("saldo_rk_core_untuk_tes", _CORE)
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)

BATAS = date(2026, 10, 31)


# ── akhir_periode ────────────────────────────────────────────────────────────

def test_akhir_periode_hari_terakhir_bulan():
    assert core.akhir_periode(2026, 10) == date(2026, 10, 31)
    assert core.akhir_periode(2026, 2) == date(2026, 2, 28)
    assert core.akhir_periode(2028, 2) == date(2028, 2, 29)  # tahun kabisat


# ── tentukan_status ──────────────────────────────────────────────────────────

def test_status_ok_bila_rk_berakhir_di_akhir_periode():
    assert core.tentukan_status(1000.0, date(2026, 10, 31), BATAS) == core.STATUS_OK


def test_status_ok_dalam_toleransi_dan_belum_akhir_setelahnya():
    t = core.TOLERANSI_HARI
    batas_ok = date(2026, 10, 31).replace(day=31 - t)  # persis t hari sebelum akhir periode
    assert core.tentukan_status(1.0, batas_ok, BATAS) == core.STATUS_OK
    assert core.tentukan_status(1.0, date(2026, 10, 30 - t), BATAS) == core.STATUS_BELUM_AKHIR  # t + 1 hari


def test_status_rk_bulan_lalu_belum_akhir_periode():
    assert core.tentukan_status(700.0, date(2026, 9, 30), BATAS) == core.STATUS_BELUM_AKHIR


def test_saldo_nol_adalah_saldo_valid_bukan_tidak_terbaca():
    # Rekening kosong (saldo 0) sah dibandingkan; hanya None yang berarti tidak terbaca.
    assert core.tentukan_status(0.0, date(2026, 10, 31), BATAS) == core.STATUS_OK


def test_status_saldo_tidak_terbaca():
    assert core.tentukan_status(None, date(2026, 10, 31), BATAS) == core.STATUS_SALDO_TIDAK_TERBACA


def test_status_periode_tidak_terbaca():
    assert core.tentukan_status(400.0, None, BATAS) == core.STATUS_PERIODE_TIDAK_TERBACA


def test_status_valas_mengalahkan_status_lain():
    assert core.tentukan_status(10000.0, date(2026, 10, 31), BATAS, "USD") == core.STATUS_VALAS
    assert core.tentukan_status(None, None, BATAS, "USD") == core.STATUS_VALAS
    assert core.tentukan_status(1.0, date(2026, 1, 31), BATAS, "EUR") == core.STATUS_VALAS


def test_prioritas_saldo_tidak_terbaca_di_atas_periode_dan_telat():
    assert core.tentukan_status(None, None, BATAS) == core.STATUS_SALDO_TIDAK_TERBACA
    assert core.tentukan_status(None, date(2026, 1, 31), BATAS) == core.STATUS_SALDO_TIDAK_TERBACA


# ── bentuk_baris ─────────────────────────────────────────────────────────────

def _baris(**o):
    r = {"coa_id": "coa-1", "kode": "BCA-01", "kode_sistem": "1101", "nama": "Bank BCA", "saldo": Decimal("1234567.50"),
         "periode_akhir": date(2026, 10, 31), "nama_file": "okt.pdf"}
    r.update(o)
    return r


def test_bentuk_baris_normal():
    b = core.bentuk_baris(_baris(), BATAS, {})
    assert b == {"kode": "BCA-01", "kode_sistem": "1101", "nama": "Bank BCA", "saldo": 1234567.5,
                 "periode_akhir": "2026-10-31", "nama_file": "okt.pdf", "mata_uang": "",
                 "status": "ok", "selisih_hari": 0}


def test_bentuk_baris_valas_dari_peta_coa():
    b = core.bentuk_baris(_baris(coa_id="coa-usd"), BATAS, {"coa-usd": "usd"})
    assert b["mata_uang"] == "USD" and b["status"] == "valas"
    # akun lain di klien yang sama tetap rupiah
    assert core.bentuk_baris(_baris(coa_id="coa-idr"), BATAS, {"coa-usd": "USD"})["status"] == "ok"


def test_bentuk_baris_idr_dianggap_rupiah():
    assert core.bentuk_baris(_baris(), BATAS, {"coa-1": "IDR"})["status"] == "ok"
    assert core.bentuk_baris(_baris(), BATAS, {"coa-1": " "})["mata_uang"] == ""


def test_bentuk_baris_saldo_kosong_tetap_json_aman():
    b = core.bentuk_baris(_baris(saldo=None), BATAS, {})
    assert b["saldo"] is None and b["status"] == "saldo_tidak_terbaca"


def test_bentuk_baris_saldo_nan_atau_tidak_valid_dianggap_kosong():
    assert core.bentuk_baris(_baris(saldo=float("nan")), BATAS, {})["saldo"] is None
    assert core.bentuk_baris(_baris(saldo=float("inf")), BATAS, {})["saldo"] is None
    assert core.bentuk_baris(_baris(saldo="abc"), BATAS, {})["saldo"] is None


def test_bentuk_baris_tanggal_kosong_dan_hari_selisih():
    b = core.bentuk_baris(_baris(periode_akhir=None), BATAS, {})
    assert b["periode_akhir"] == "" and b["selisih_hari"] is None and b["status"] == "periode_tidak_terbaca"
    b = core.bentuk_baris(_baris(periode_akhir=date(2026, 9, 30)), BATAS, {})
    assert b["selisih_hari"] == 31 and b["status"] == "belum_akhir_periode"


@pytest.mark.parametrize("nilai", [datetime(2026, 10, 31, 23, 59), "2026-10-31", "2026-10-31T00:00:00"])
def test_bentuk_baris_menerima_datetime_dan_string_tanggal(nilai):
    assert core.bentuk_baris(_baris(periode_akhir=nilai), BATAS, {})["periode_akhir"] == "2026-10-31"


def test_semua_status_ada_di_daftar():
    assert set(core.SEMUA_STATUS) == {"ok", "belum_akhir_periode", "saldo_tidak_terbaca", "periode_tidak_terbaca", "valas"}


# ── aturan pemilihan rekening koran di query (dicek sebagai teks) ────────────

@pytest.fixture(scope="module")
def sumber_v1():
    return _V1.read_text(encoding="utf-8")


def test_query_tidak_membuang_rk_terbaru_yang_saldonya_kosong(sumber_v1):
    # Dulu: "AND s.closing_balance IS NOT NULL" -> RK terbaru yang kosong dilewati dan saldo bulan lama dipakai diam-diam.
    assert "AND s.closing_balance IS NOT NULL" not in sumber_v1
    assert "AND s.period_end IS NOT NULL" not in sumber_v1


def test_query_urutan_dan_filter(sumber_v1):
    assert "DISTINCT ON (s.bank_coa_id)" in sumber_v1
    assert "s.period_end DESC NULLS LAST" in sumber_v1
    assert "(s.closing_balance IS NOT NULL) DESC" in sumber_v1  # period_end sama: yang saldonya terisi didahulukan
    assert "s.deleted_at IS NULL" in sumber_v1
    assert "s.period_end <= :batas" in sumber_v1
    assert "s.client_id = :klien" in sumber_v1


def test_query_valas_dibatasi_klien_dan_aman_tanpa_tabel(sumber_v1):
    assert "finance_fx_bank_accounts" in sumber_v1
    assert "WHERE client_id = :klien" in sumber_v1
    assert "to_regclass" in sumber_v1
