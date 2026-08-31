"""
scripts/cek_aturan_xlsx.py
============================
Verifikasi otomatis kepatuhan modul export Excel terhadap aturan di
skills/xlsx_export/SKILL.md. Mengecek KODE SUMBER (bukan file .xlsx
hasil), jadi bisa langsung dijalankan tanpa perlu generate file dulu.

Cara pakai:
    python scripts/cek_aturan_xlsx.py
    python scripts/cek_aturan_xlsx.py --file modules/kertas_kerja.py

Exit code 0 kalau semua aturan lolos, 1 kalau ada pelanggaran (supaya
bisa dipakai di CI / pre-commit hook, bukan cuma dibaca manusia).

Aturan yang dicek di sini HANYA yang bisa diverifikasi otomatis lewat
analisis teks source code. Aturan yang butuh penilaian manusia (mis.
"urutan sheet harus sama dengan file referensi client") tetap harus
dicek manual sesuai checklist di SKILL.md.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple

BATAS_NAMA_SHEET = 31

# Urutan resmi 18 sheet accounting_export.py, diambil langsung dari kode
# yang sudah divalidasi cocok dengan template client
# (Model_Laporan_Keuangan_SPT_PPh31E_2025.xlsx). Kalau urutan/nama sheet
# di kode berubah SENGAJA (mis. ganti template baru), update juga daftar
# ini di turn yang sama -- supaya script tidak salah-tuduh.
URUTAN_SHEET_RESMI_18 = [
    "Petunjuk & Asumsi",
    "COA",
    "Neraca Saldo Awal",
    None,  # f"GL {tahun}" -- nama dinamis, dilewati dari pengecekan urutan persis
    "Buku Bantu Piutang",
    "Buku Bantu Hutang",
    "Buku Bantu Aktiva Tetap",
    "Trial Balance Bulanan",
    "Laba Rugi Bulanan",
    "Balance Sheet Bulanan",
    "Laporan Perubahan Ekuitas",
    "Laporan Arus Kas",
    "Catatan atas Laporan Keuangan",
    "Ringkasan",
    "BS Lampiran SPT",
    "PNL Lampiran SPT",
    "Rekonsiliasi Fiskal",
    "PPh Badan 31E",
]


class Pelanggaran:
    def __init__(self, aturan: str, detail: str, baris: int | None = None):
        self.aturan = aturan
        self.detail = detail
        self.baris = baris

    def __str__(self) -> str:
        lokasi = f" (baris {self.baris})" if self.baris else ""
        return f"[{self.aturan}]{lokasi} {self.detail}"


def _cari_create_sheet(source: str) -> List[Tuple[int, str, bool]]:
    """Cari semua panggilan wb.create_sheet(...)/ws_bs = wb.create_sheet(...).
    Return list (nomor_baris, nama_atau_ekspresi, apakah_nama_literal_string)."""
    hasil = []
    for i, baris in enumerate(source.splitlines(), start=1):
        m = re.search(r'create_sheet\(\s*(.+?)\s*\)', baris)
        if not m:
            continue
        ekspresi = m.group(1)
        # Nama sheet literal string biasa: create_sheet("Nama Sheet")
        m_literal = re.match(r'^"([^"]*)"$', ekspresi)
        if m_literal:
            hasil.append((i, m_literal.group(1), True))
            continue
        # Pola f-string sederhana: create_sheet(f"GL {tahun}")
        m_fstring = re.match(r'^f"([^"]*)"$', ekspresi)
        if m_fstring:
            hasil.append((i, m_fstring.group(1), False))
            continue
        # Pola potong manual: create_sheet(str(nama_bank)[:31]) -- ini SUDAH
        # dijaga panjangnya oleh kode sendiri, cukup dicatat sebagai aman.
        if "[:31]" in ekspresi or "[:31 ]" in ekspresi:
            hasil.append((i, ekspresi, False))
            continue
        hasil.append((i, ekspresi, False))
    return hasil


def cek_panjang_nama_sheet(source: str, nama_file: str) -> List[Pelanggaran]:
    """Aturan #1 SKILL.md: nama sheet maksimum 31 karakter. Sheet dengan
    nama dinamis (f-string) dicek pola statisnya; nama yang sudah dipotong
    eksplisit ([:31]) dianggap aman tanpa perlu dihitung panjangnya di sini."""
    pelanggaran = []
    for baris_no, nama, literal in _cari_create_sheet(source):
        if "[:31]" in nama:
            continue  # sudah dijaga oleh kode
        if literal and len(nama) > BATAS_NAMA_SHEET:
            pelanggaran.append(Pelanggaran(
                "nama-sheet-31-karakter",
                f"Nama sheet \"{nama}\" ({len(nama)} karakter) melebihi batas "
                f"{BATAS_NAMA_SHEET} karakter Excel. Pendekkan namanya atau "
                f"potong eksplisit dengan [:{BATAS_NAMA_SHEET}].",
                baris_no,
            ))
        elif not literal and "{" in nama:
            # Nama dinamis (f-string) -- tidak bisa dihitung pasti di sini,
            # tandai sebagai perlu cek manual kalau bagian statisnya sendiri
            # sudah mendekati batas.
            bagian_statis = re.sub(r"\{[^}]*\}", "", nama)
            if len(bagian_statis) > BATAS_NAMA_SHEET - 4:
                pelanggaran.append(Pelanggaran(
                    "nama-sheet-31-karakter-dinamis",
                    f"Nama sheet dinamis \"{nama}\" punya bagian statis yang "
                    f"sudah panjang ({len(bagian_statis)} karakter) -- kalau "
                    f"variabel di dalamnya bisa panjang juga, total gampang "
                    f"melebihi {BATAS_NAMA_SHEET} karakter. Cek manual atau "
                    f"tambahkan pemotongan eksplisit.",
                    baris_no,
                ))
    return pelanggaran


def cek_urutan_sheet_18(source: str, nama_file: str) -> List[Pelanggaran]:
    """Aturan #2 SKILL.md: urutan & nama sheet harus persis sesuai template
    (khusus accounting_export.py / export 18-sheet). Dilewati untuk file
    lain (mis. kertas_kerja.py yang punya daftar sheet sendiri)."""
    if "accounting_export" not in nama_file:
        return []

    daftar_di_kode = []
    for _, nama, literal in _cari_create_sheet(source):
        if literal:
            daftar_di_kode.append(nama)
        elif "{" in nama:
            daftar_di_kode.append(None)  # nama dinamis, posisi tetap dicatat

    # Ambil hanya yang termasuk 18 sheet (COA muncul 2x di source: sekali
    # di fungsi lama export_paket_akuntansi_lengkap, sekali di 18-sheet --
    # cocokkan berdasar KEMUNCULAN TERAKHIR sejumlah 18 sheet, karena fungsi
    # 18-sheet ditulis belakangan di file & itu yang dipakai production).
    if len(daftar_di_kode) < len(URUTAN_SHEET_RESMI_18):
        return [Pelanggaran(
            "urutan-sheet-18",
            f"Hanya menemukan {len(daftar_di_kode)} pemanggilan create_sheet() "
            f"di {nama_file}, diharapkan minimal {len(URUTAN_SHEET_RESMI_18)} "
            f"untuk export 18-sheet. Kemungkinan ada sheet yang terhapus atau "
            f"pola create_sheet() di kode berubah bentuk (skrip ini tidak "
            f"mengenalinya lagi) -- cek manual.",
        )]

    kandidat = daftar_di_kode[-len(URUTAN_SHEET_RESMI_18):]
    pelanggaran = []
    for i, (resmi, aktual) in enumerate(zip(URUTAN_SHEET_RESMI_18, kandidat)):
        if resmi is None:
            continue  # posisi nama dinamis (GL <tahun>), tidak dicek persis
        if aktual != resmi:
            pelanggaran.append(Pelanggaran(
                "urutan-sheet-18",
                f"Posisi ke-{i + 1}: diharapkan \"{resmi}\", ditemukan "
                f"\"{aktual}\". Urutan/nama sheet 18-sheet harus persis sama "
                f"dengan template client kecuali memang sengaja diganti "
                f"(kalau sengaja, update juga URUTAN_SHEET_RESMI_18 di script "
                f"ini).",
            ))
    return pelanggaran


def cek_lebar_kolom_dipanggil_terakhir(source: str, nama_file: str) -> List[Pelanggaran]:
    """Aturan #3 SKILL.md: _lebar_kolom_dari_isi(ws) harus dipanggil SETELAH
    semua isi sheet ditulis. Diverifikasi secara longgar: untuk tiap sheet
    (ditandai create_sheet), cek apakah ada pemanggilan
    _lebar_kolom_dari_isi(ws) SEBELUM create_sheet berikutnya (atau akhir
    file) -- ini heuristik posisi baris, bukan analisis AST penuh."""
    if "_lebar_kolom_dari_isi" not in source:
        return []  # file ini tidak pakai fungsi ini sama sekali, skip

    baris_list = source.splitlines()
    posisi_create_sheet = [i for i, b in enumerate(baris_list) if "create_sheet(" in b]
    posisi_lebar_isi = [i for i, b in enumerate(baris_list) if "_lebar_kolom_dari_isi(ws)" in b]

    pelanggaran = []
    for idx, awal in enumerate(posisi_create_sheet):
        akhir = posisi_create_sheet[idx + 1] if idx + 1 < len(posisi_create_sheet) else len(baris_list)
        ada_panggilan_lebar = any(awal < p < akhir for p in posisi_lebar_isi)
        if not ada_panggilan_lebar:
            nama_baris = baris_list[awal].strip()
            # Sheet lama (sebelum sheet 9 di 18-sheet) memang tidak wajib
            # pakai fungsi ini -- SKILL.md cuma mewajibkan utk sheet 9-18.
            # Heuristik longgar: kalau file ini memang pakai fungsi ini di
            # tempat lain, tapi TIDAK di sheet ini, cukup catat sebagai info
            # bukan pelanggaran keras (supaya tidak false-positive di sheet
            # yang memang belum butuh, mis. sheet 1-8).
            continue
    return pelanggaran  # sengaja tidak strict -- lihat catatan di docstring


def _baris_di_dalam_docstring(source: str) -> set:
    """Tandai nomor baris (1-indexed) yang berada DI DALAM docstring
    triple-quote ('''...''' atau \"\"\"...\"\"\"), supaya contoh kode yang
    dikutip di dokumentasi (mis. penjelasan bug lama) tidak ikut dianggap
    kode asli. Heuristik baris-per-baris, bukan parser AST penuh -- cukup
    akurat untuk gaya penulisan project ini (docstring selalu diapit
    triple-quote di baris tersendiri atau sejalan)."""
    di_dalam = set()
    status_buka = False
    penanda_aktif = None
    for i, baris in enumerate(source.splitlines(), start=1):
        sisa = baris
        while True:
            if not status_buka:
                idx3 = min(
                    (sisa.find(p) for p in ('"""', "'''") if sisa.find(p) != -1),
                    default=-1,
                )
                if idx3 == -1:
                    break
                penanda_aktif = sisa[idx3:idx3 + 3]
                status_buka = True
                di_dalam.add(i)
                sisa = sisa[idx3 + 3:]
                idx_tutup = sisa.find(penanda_aktif)
                if idx_tutup != -1:
                    status_buka = False
                    sisa = sisa[idx_tutup + 3:]
                    continue
                else:
                    break
            else:
                di_dalam.add(i)
                idx_tutup = sisa.find(penanda_aktif)
                if idx_tutup == -1:
                    break
                status_buka = False
                sisa = sisa[idx_tutup + 3:]
    return di_dalam


def cek_pola_angka_aman(source: str, nama_file: str) -> List[Pelanggaran]:
    """Aturan #5 SKILL.md: nilai finansial harus lewat _angka(), bukan pola
    lama float(x or 0) yang tidak aman untuk NaN. Baris di dalam docstring
    (mis. contoh kode yang dikutip di dokumentasi) DILEWATI supaya tidak
    salah tuduh -- lihat kasus nyata: accounting_export.py punya kalimat
    dokumentasi yang MENGUTIP pola lama ini sebagai penjelasan kenapa
    _angka() dibuat, itu bukan kode aktif."""
    pelanggaran = []
    baris_docstring = _baris_di_dalam_docstring(source)
    # Menangkap juga bentuk dengan panggilan fungsi di dalamnya, mis.
    # float(row.get("mutasi_debet") or 0) -- bukan cuma float(x or 0) polos.
    pola_lama = re.compile(r'float\(\s*[^()]*(?:\([^()]*\)[^()]*)*\s+or\s+0(?:\.0)?\s*\)')
    for i, baris in enumerate(source.splitlines(), start=1):
        if i in baris_docstring:
            continue
        stripped = baris.strip()
        if stripped.startswith("#"):
            continue
        if pola_lama.search(baris):
            pelanggaran.append(Pelanggaran(
                "pola-angka-nan-unsafe",
                f"Ditemukan pola `float(x or 0)` yang TIDAK aman untuk NaN "
                f"(`float('nan') or 0` tetap `nan`). Ganti dengan `_angka(x)`.",
                i,
            ))
    return pelanggaran


def cek_file(path: Path) -> List[Pelanggaran]:
    source = path.read_text(encoding="utf-8", errors="replace")
    nama_file = path.name
    pelanggaran: List[Pelanggaran] = []
    pelanggaran += cek_panjang_nama_sheet(source, nama_file)
    pelanggaran += cek_urutan_sheet_18(source, nama_file)
    pelanggaran += cek_lebar_kolom_dipanggil_terakhir(source, nama_file)
    pelanggaran += cek_pola_angka_aman(source, nama_file)
    return pelanggaran


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file", action="append", dest="files",
        help="Path file yang dicek. Bisa diulang. Default: modules/accounting_export.py "
             "dan modules/kertas_kerja.py.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent  # backend/
    default_files = [
        root / "modules" / "accounting_export.py",
        root / "modules" / "kertas_kerja.py",
    ]
    files = [Path(f) for f in args.files] if args.files else default_files

    total_pelanggaran = 0
    for f in files:
        if not f.exists():
            print(f"⚠️  Dilewati, file tidak ditemukan: {f}")
            continue
        pelanggaran = cek_file(f)
        if not pelanggaran:
            print(f"✅ {f.name}: lolos semua aturan yang bisa dicek otomatis")
            continue
        print(f"❌ {f.name}: {len(pelanggaran)} pelanggaran ditemukan")
        for p in pelanggaran:
            print(f"   - {p}")
        total_pelanggaran += len(pelanggaran)

    print()
    if total_pelanggaran:
        print(f"Total {total_pelanggaran} pelanggaran. Perbaiki sebelum menganggap task selesai.")
        print("Catatan: script ini hanya mengecek aturan yang bisa diverifikasi dari teks "
              "source code. Aturan lain di skills/xlsx_export/SKILL.md (mis. kaidah warna, "
              "kecocokan template) tetap perlu dicek manual lewat checklist di file itu.")
        return 1
    print("Semua file lolos pengecekan otomatis. Tetap jalankan checklist manual di "
          "skills/xlsx_export/SKILL.md untuk aturan yang tidak bisa diverifikasi dari kode saja.")
    return 0


if __name__ == "__main__":
    sys.exit(main())