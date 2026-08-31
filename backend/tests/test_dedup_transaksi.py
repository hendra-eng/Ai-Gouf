"""
tests/test_dedup_transaksi.py
===============================
Test murni utk modules/dedup_transaksi.py. Bagian yang butuh koneksi DB
(evaluasi_upload_rekening_koran, yang import db_client di dalam fungsi)
di-mock lewat monkeypatch sys.modules["db_client"] -- supaya test ini
TETAP bisa jalan tanpa DATABASE_URL/Supabase aktif, konsisten dgn
tests/conftest.py yang sudah ada di project ini (test lain jg tidak
butuh DB sungguhan).
"""

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules import dedup_transaksi as dt  # noqa: E402


# ============================================================
# FIXTURE: mock db_client
# ============================================================

class _FakeDbClient:
    """Pengganti minimal db_client utk test -- cuma mengimplementasikan
    fungsi-fungsi yang dipanggil evaluasi_upload_rekening_koran()."""

    def __init__(self):
        self.hash_aktif = {}     # {(client_id, kode_bank, periode): set(hash)}
        self.batch_aktif = {}    # {(client_id, kode_bank, periode): dict}
        self.file_hash_ada = {}  # {(client_id, file_hash): dict}

    def ambil_hash_transaksi_aktif(self, client_id, kode_bank, periode):
        return self.hash_aktif.get((client_id, kode_bank, periode), set())

    def ambil_batch_aktif(self, client_id, kode_bank, periode):
        return self.batch_aktif.get((client_id, kode_bank, periode))

    def cari_upload_batch_by_file_hash(self, client_id, file_hash):
        return self.file_hash_ada.get((client_id, file_hash))


@pytest.fixture
def fake_dbc(monkeypatch):
    fake = _FakeDbClient()
    modul_palsu = types.ModuleType("db_client")
    for nama in ("ambil_hash_transaksi_aktif", "ambil_batch_aktif", "cari_upload_batch_by_file_hash"):
        setattr(modul_palsu, nama, getattr(fake, nama))
    monkeypatch.setitem(sys.modules, "db_client", modul_palsu)
    return fake


def _baris(tanggal="2026-07-01", bank="BRI", keterangan="TRANSFER MASUK PT ABC",
           jml_debet=1000000, jml_kredit=0, saldo=5000000):
    return {
        "baris": 1, "tanggal": tanggal, "bank": bank, "keterangan": keterangan,
        "no_akun_debet": "1110", "nama_akun_debet": "Bank BRI",
        "jml_debet": jml_debet,
        "no_akun_kredit": "4100", "nama_akun_kredit": "Pendapatan",
        "jml_kredit": jml_kredit, "saldo": saldo,
        "sumber_kategori": "Kata kunci COA", "catatan": None,
    }


# ============================================================
# TEST: fingerprint / hashing
# ============================================================

def test_signature_stabil_utk_baris_identik():
    b1 = _baris()
    b2 = _baris()
    assert dt.buat_signature_baris(b1) == dt.buat_signature_baris(b2)


def test_signature_beda_kalau_nominal_beda():
    b1 = _baris(jml_debet=1000000)
    b2 = _baris(jml_debet=2000000)
    assert dt.buat_signature_baris(b1) != dt.buat_signature_baris(b2)


def test_signature_beda_kalau_keterangan_beda():
    b1 = _baris(keterangan="TRANSFER MASUK PT ABC")
    b2 = _baris(keterangan="TRANSFER MASUK PT XYZ")
    assert dt.buat_signature_baris(b1) != dt.buat_signature_baris(b2)


def test_signature_tidak_terpengaruh_kategori_akun():
    """Fingerprint HARUS sama walau akun debet/kredit dikoreksi manual
    antar 2 upload -- karena identitas transaksi ditentukan dari data
    mentah (tanggal/bank/keterangan/nominal/saldo), bukan hasil
    kategorisasi yang bisa berubah."""
    b1 = _baris()
    b2 = _baris()
    b2["no_akun_debet"] = "1120"
    b2["nama_akun_debet"] = "Bank Mandiri (dikoreksi manual)"
    assert dt.buat_signature_baris(b1) == dt.buat_signature_baris(b2)


def test_signature_beda_kalau_keterangan_beda_spasi_saja_tetap_sama():
    """Normalisasi whitespace: "A   B" vs "A B" harus tetap dianggap sama."""
    b1 = _baris(keterangan="TRANSFER   MASUK    PT ABC")
    b2 = _baris(keterangan="transfer masuk pt abc")
    assert dt.buat_signature_baris(b1) == dt.buat_signature_baris(b2)


def test_hitung_file_hash_konsisten():
    isi = b"contoh isi file excel"
    assert dt.hitung_file_hash(isi) == dt.hitung_file_hash(isi)
    assert dt.hitung_file_hash(isi) != dt.hitung_file_hash(isi + b"x")


# ============================================================
# TEST: pengelompokan per (kode_bank, periode)
# ============================================================

def test_kelompokkan_draf_jurnal_multi_bank_multi_bulan():
    draf = [
        _baris(tanggal="2026-07-05", bank="BANK BRI"),
        _baris(tanggal="2026-07-15", bank="BANK BRI"),
        _baris(tanggal="2026-08-01", bank="BANK BRI"),
        _baris(tanggal="2026-07-10", bank="MANDIRI"),
    ]
    kelompok = dt.kelompokkan_draf_jurnal(draf)
    assert set(kelompok.keys()) == {("BRI", "0726"), ("BRI", "0826"), ("MANDIRI", "0726")}
    assert len(kelompok[("BRI", "0726")]) == 2


# ============================================================
# TEST: evaluasi_upload_rekening_koran -- skenario BARU
# ============================================================

def test_evaluasi_baru_tidak_perlu_konfirmasi(fake_dbc):
    draf = [_baris(keterangan=f"TRANSFER {i}") for i in range(5)]
    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=draf, file_hash="hash_baru")
    assert hasil.status_keseluruhan == dt.STATUS_BARU
    assert hasil.perlu_konfirmasi is False
    assert len(hasil.baris_baru_saja) == 5


# ============================================================
# TEST: evaluasi_upload_rekening_koran -- skenario FILE_IDENTIK
# ============================================================

def test_evaluasi_file_identik(fake_dbc):
    fake_dbc.file_hash_ada[(1, "hash_sama")] = {
        "id": 99, "nama_file": "rekening_juli.xlsx", "dibuat_at": "2026-07-20T10:00:00",
    }
    draf = [_baris()]
    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=draf, file_hash="hash_sama")
    assert hasil.status_keseluruhan == dt.STATUS_FILE_IDENTIK
    assert hasil.perlu_konfirmasi is True
    assert "rekening_juli.xlsx" in hasil.pesan


# ============================================================
# TEST: evaluasi_upload_rekening_koran -- skenario DUPLIKAT_PENUH
# ============================================================

def test_evaluasi_duplikat_penuh(fake_dbc):
    draf = [_baris(keterangan=f"TRANSFER {i}") for i in range(10)]
    hash_semua = {dt.buat_signature_baris(b) for b in draf}
    fake_dbc.hash_aktif[(1, "BRI", "0726")] = hash_semua

    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=draf, file_hash="hash_lain")
    assert hasil.status_keseluruhan == dt.STATUS_DUPLIKAT_PENUH
    assert hasil.perlu_konfirmasi is True
    assert len(hasil.baris_baru_saja) == 0


# ============================================================
# TEST: evaluasi_upload_rekening_koran -- skenario REVISI_SEBAGIAN
# ============================================================

def test_evaluasi_revisi_sebagian(fake_dbc):
    draf_lama = [_baris(keterangan=f"TRANSFER {i}") for i in range(8)]
    draf_baru_tambahan = [_baris(keterangan=f"TRANSFER BARU {i}") for i in range(2)]
    draf = draf_lama + draf_baru_tambahan

    hash_lama = {dt.buat_signature_baris(b) for b in draf_lama}
    fake_dbc.hash_aktif[(1, "BRI", "0726")] = hash_lama

    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=draf, file_hash="hash_lain")
    assert hasil.status_keseluruhan == dt.STATUS_REVISI_SEBAGIAN
    assert hasil.perlu_konfirmasi is True
    assert len(hasil.baris_baru_saja) == 2
    assert {b["keterangan"] for b in hasil.baris_baru_saja} == {"TRANSFER BARU 0", "TRANSFER BARU 1"}


# ============================================================
# TEST: overlap kecil (kebetulan) TIDAK memicu konfirmasi
# ============================================================

def test_evaluasi_overlap_kecil_dianggap_wajar(fake_dbc):
    """1 dari 10 baris (10%) kebetulan sama -- di bawah AMBANG_REVISI
    (30%), jadi TIDAK boleh memicu prompt konfirmasi (supaya akuntan
    tidak di-spam utk kasus normal, mis. 2 transfer nominal sama di hari
    berbeda kebetulan match)."""
    draf = [_baris(keterangan=f"TRANSFER {i}") for i in range(10)]
    hash_lama = {dt.buat_signature_baris(draf[0])}
    fake_dbc.hash_aktif[(1, "BRI", "0726")] = hash_lama

    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=draf, file_hash="hash_lain")
    assert hasil.status_keseluruhan == dt.STATUS_BARU
    assert hasil.perlu_konfirmasi is False


# ============================================================
# TEST: file kosong
# ============================================================

def test_evaluasi_draf_jurnal_kosong(fake_dbc):
    hasil = dt.evaluasi_upload_rekening_koran(client_id=1, draf_jurnal=[], file_hash="apa_saja")
    assert hasil.status_keseluruhan == dt.STATUS_BARU
    assert hasil.perlu_konfirmasi is False


# ============================================================
# TEST: hapus_kolom_internal
# ============================================================

def test_hapus_kolom_internal_membuang_hash():
    draf = [_baris()]
    draf[0]["_hash"] = "abc123"
    hasil = dt.hapus_kolom_internal(draf)
    assert "_hash" not in hasil[0]
    assert "_hash" in draf[0]  # tidak memutasi input asli