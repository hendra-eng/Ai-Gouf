"""
tests/test_skill_compliance.py
================================
Menghubungkan scripts/cek_aturan_xlsx.py ke test suite (pytest), supaya
kepatuhan terhadap skills/xlsx_export/SKILL.md ikut kecek otomatis tiap
kali test dijalankan -- bukan cuma waktu diingat untuk dijalankan manual.

Test ini SENGAJA memisahkan tiap aturan jadi test case sendiri (bukan
satu test besar yang manggil main()) supaya kalau ada yang gagal, pytest
langsung menunjukkan aturan MANA yang dilanggar tanpa perlu baca log
panjang.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import cek_aturan_xlsx as cek  # noqa: E402

FILE_EXPORT_18 = ROOT / "modules" / "accounting_export.py"
FILE_KERTAS_KERJA = ROOT / "modules" / "kertas_kerja.py"


def _baca(path: Path) -> str:
    if not path.exists():
        pytest.skip(f"File tidak ditemukan: {path} -- lewati test ini")
    return path.read_text(encoding="utf-8", errors="replace")


class TestAturanNamaSheet:
    """Aturan #1 SKILL.md: nama sheet maksimum 31 karakter."""

    def test_accounting_export_nama_sheet_valid(self):
        source = _baca(FILE_EXPORT_18)
        pelanggaran = cek.cek_panjang_nama_sheet(source, FILE_EXPORT_18.name)
        assert not pelanggaran, (
            "Ada nama sheet yang melebihi 31 karakter di accounting_export.py:\n"
            + "\n".join(str(p) for p in pelanggaran)
        )

    def test_kertas_kerja_nama_sheet_valid(self):
        source = _baca(FILE_KERTAS_KERJA)
        pelanggaran = cek.cek_panjang_nama_sheet(source, FILE_KERTAS_KERJA.name)
        assert not pelanggaran, (
            "Ada nama sheet yang melebihi 31 karakter di kertas_kerja.py:\n"
            + "\n".join(str(p) for p in pelanggaran)
        )


class TestAturanUrutanSheet18:
    """Aturan #2 SKILL.md: urutan & nama 18 sheet harus persis sesuai
    template client. Kalau test ini gagal SETELAH kamu SENGAJA mengganti
    urutan/nama sheet (mis. ganti template baru), update juga
    URUTAN_SHEET_RESMI_18 di scripts/cek_aturan_xlsx.py -- jangan langsung
    anggap test ini salah."""

    def test_urutan_18_sheet_sesuai_template(self):
        source = _baca(FILE_EXPORT_18)
        pelanggaran = cek.cek_urutan_sheet_18(source, FILE_EXPORT_18.name)
        assert not pelanggaran, (
            "Urutan/nama 18 sheet tidak sesuai daftar resmi:\n"
            + "\n".join(str(p) for p in pelanggaran)
        )


class TestAturanPolaAngkaAman:
    """Aturan #5 SKILL.md: nilai finansial harus lewat _angka(), bukan
    pola lama float(x or 0) yang tidak aman untuk NaN.

    Riwayat: kertas_kerja.py sempat punya 14 titik pola lama (ditemukan
    saat skill ini dibuat) -- sudah dibersihkan semua, diganti ke _angka()
    lokal yang didefinisikan di file itu sendiri (tidak import dari
    accounting_export.py, supaya kertas_kerja.py tetap berdiri sendiri
    sesuai catatan integrasi di docstring atas file itu)."""

    def test_accounting_export_pola_angka_aman(self):
        source = _baca(FILE_EXPORT_18)
        pelanggaran = cek.cek_pola_angka_aman(source, FILE_EXPORT_18.name)
        assert not pelanggaran, (
            "Ditemukan pola float(x or 0) yang tidak aman untuk NaN di "
            "accounting_export.py:\n" + "\n".join(str(p) for p in pelanggaran)
        )

    def test_kertas_kerja_pola_angka_aman(self):
        source = _baca(FILE_KERTAS_KERJA)
        pelanggaran = cek.cek_pola_angka_aman(source, FILE_KERTAS_KERJA.name)
        assert not pelanggaran, (
            "Ditemukan pola float(x or 0) yang tidak aman untuk NaN di "
            "kertas_kerja.py:\n" + "\n".join(str(p) for p in pelanggaran)
        )


def test_ringkasan_semua_file():
    """Test ringkasan -- menjalankan pengecekan penuh (semua aturan,
    semua file default) sekali lagi lewat cek.cek_file(), supaya ada satu
    titik yang mencerminkan persis output `python scripts/cek_aturan_xlsx.py`.
    Test ini INFORMATIF (tidak fail) -- detail per-aturan sudah dicek
    ketat oleh test class di atas; ini cuma untuk print ringkasan ke log
    pytest -v supaya gampang dibaca manusia."""
    for f in (FILE_EXPORT_18, FILE_KERTAS_KERJA):
        if not f.exists():
            continue
        pelanggaran = cek.cek_file(f)
        print(f"\n{f.name}: {len(pelanggaran)} pelanggaran")
        for p in pelanggaran:
            print(f"  - {p}")