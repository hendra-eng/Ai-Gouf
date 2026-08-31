#!/usr/bin/env python3
"""
scripts/verify_output.py
=========================
Verifikasi VISUAL dokumen docx/PDF yang baru digenerate -- mengikuti pola
yang sudah dipakai Claude sendiri untuk skill docx bawaan (lihat
/mnt/skills/public/docx/SKILL.md, bagian "Verify the output"):

    1. Kalau input .docx: convert ke PDF dulu (LibreOffice headless) --
       pakai pola YANG SAMA dengan _convert_docx_ke_pdf() di
       modules/calk_export.py (profil LibreOffice unik per konversi,
       supaya aman dipanggil bersamaan dengan proses generate CALK yang
       sungguhan sedang berjalan di server).
    2. Convert tiap halaman PDF jadi gambar JPEG (pdftoppm, resolusi cukup
       untuk baca teks/tabel dengan jelas).
    3. Cetak daftar path gambar yang dihasilkan -- LANGKAH SETELAH INI
       (membaca gambar satu-satu) dilakukan oleh AI/Claude yang memanggil
       script ini, BUKAN oleh script ini sendiri (script cuma render).

KENAPA INI PENTING UNTUK CALK/dokumen dwibahasa: kesalahan seperti kolom
tabel kepotong, teks tumpang tindih, font tidak konsisten, atau baris
yang salah align TIDAK KELIHATAN dari membaca kode python-docx -- kode
bisa "benar secara logis" (tidak ada exception, semua data terisi) tapi
hasil visualnya tetap rusak. Satu-satunya cara memastikan itu adalah
benar-benar MELIHAT halaman yang sudah dirender, sama seperti akuntan
yang akan membaca dokumen ini nanti.

Cara pakai:
    python scripts/verify_output.py CALK_client5_2026-07.docx
    python scripts/verify_output.py CALK_client5_2026-07.pdf --pages 1,2,3
    python scripts/verify_output.py CALK_client5_2026-07.docx --dpi 150

Setelah dijalankan, baca (view) file page-*.jpg satu per satu -- JANGAN
anggap dokumen selesai hanya karena script ini keluar tanpa error.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


def convert_docx_ke_pdf(path_docx: Path, output_dir: Path) -> Path:
    """Convert .docx -> .pdf via LibreOffice headless, profil unik per
    panggilan (pola sama dengan modules/calk_export.py::_convert_docx_ke_pdf,
    supaya aman dipanggil bersamaan dengan proses generate lain di server
    yang sama tanpa rebutan lock profil LibreOffice)."""
    profil_temp = Path(tempfile.gettempdir()) / f"lo_profile_verify_{uuid.uuid4().hex}"
    try:
        hasil = subprocess.run(
            ["soffice",
             f"-env:UserInstallation=file://{profil_temp}",
             "--headless", "--convert-to", "pdf",
             "--outdir", str(output_dir), str(path_docx)],
            capture_output=True, text=True, timeout=120, check=True,
        )
        if hasil.stdout.strip():
            print(f"[soffice] {hasil.stdout.strip()}", file=sys.stderr)
    except FileNotFoundError:
        print(
            "❌ 'soffice' (LibreOffice) tidak ditemukan di PATH -- "
            "tidak bisa convert docx ke PDF untuk verifikasi. "
            "Install LibreOffice atau jalankan script ini di server yang punya soffice.",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"❌ soffice gagal convert: {e.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("❌ soffice timeout (>120 detik) -- dokumen mungkin terlalu besar/kompleks.", file=sys.stderr)
        sys.exit(1)
    finally:
        shutil.rmtree(profil_temp, ignore_errors=True)

    path_pdf = output_dir / f"{path_docx.stem}.pdf"
    if not path_pdf.exists():
        print(f"❌ soffice sukses tapi PDF tidak ditemukan di {path_pdf}.", file=sys.stderr)
        sys.exit(1)
    return path_pdf


def render_pdf_ke_gambar(path_pdf: Path, output_dir: Path, dpi: int, pages: str | None) -> list[Path]:
    """pdftoppm -jpeg -r <dpi> file.pdf output_dir/page -- otomatis
    zero-pad nomor halaman sesuai jumlah halaman total (page-01.jpg,
    page-02.jpg, dst untuk <100 halaman; page-001.jpg dst kalau lebih)."""
    prefix = output_dir / "page"
    cmd = ["pdftoppm", "-jpeg", "-r", str(dpi)]
    if pages:
        awal, _, akhir = pages.partition(",")
        if akhir:
            cmd += ["-f", awal, "-l", akhir]
        else:
            cmd += ["-f", awal, "-l", awal]
    cmd += [str(path_pdf), str(prefix)]

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True)
    except FileNotFoundError:
        print(
            "❌ 'pdftoppm' (Poppler) tidak ditemukan di PATH -- "
            "install poppler-utils untuk render PDF ke gambar.",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"❌ pdftoppm gagal: {e.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    return sorted(output_dir.glob("page-*.jpg"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Verifikasi visual dokumen docx/PDF (render -> gambar).")
    parser.add_argument("path_file", help="Path ke file .docx atau .pdf yang mau diverifikasi")
    parser.add_argument("--dpi", type=int, default=100, help="Resolusi render gambar (default 100, cukup untuk baca teks)")
    parser.add_argument("--pages", default=None, help="Rentang halaman, mis. '1,3' untuk halaman 1-3. Default: semua halaman.")
    parser.add_argument("--outdir", default=None, help="Folder output gambar. Default: folder temp baru.")
    args = parser.parse_args()

    path_file = Path(args.path_file).resolve()
    if not path_file.exists():
        print(f"❌ File tidak ditemukan: {path_file}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.outdir) if args.outdir else Path(tempfile.mkdtemp(prefix="verify_output_"))
    output_dir.mkdir(parents=True, exist_ok=True)

    if path_file.suffix.lower() == ".docx":
        print(f"→ Convert {path_file.name} ke PDF...", file=sys.stderr)
        path_pdf = convert_docx_ke_pdf(path_file, output_dir)
    elif path_file.suffix.lower() == ".pdf":
        path_pdf = path_file
    else:
        print(f"❌ Ekstensi tidak didukung: {path_file.suffix} (harus .docx atau .pdf)", file=sys.stderr)
        sys.exit(1)

    print(f"→ Render {path_pdf.name} ke gambar (dpi={args.dpi})...", file=sys.stderr)
    daftar_gambar = render_pdf_ke_gambar(path_pdf, output_dir, args.dpi, args.pages)

    if not daftar_gambar:
        print("❌ Tidak ada gambar dihasilkan -- cek apakah PDF punya halaman.", file=sys.stderr)
        sys.exit(1)

    print(f"\n✅ {len(daftar_gambar)} halaman dirender ke: {output_dir}")
    for g in daftar_gambar:
        print(g)
    print(
        "\n⚠️  LANGKAH WAJIB SELANJUTNYA: buka/lihat (view) file gambar di atas "
        "satu per satu -- jangan anggap dokumen ini selesai hanya karena script "
        "ini tidak error. Perhatikan: tabel tidak kepotong, teks tidak "
        "tumpang tindih, kolom Indonesia/Inggris sejajar, angka tidak ada "
        "yang '#####' (kolom terlalu sempit), dan halaman terakhir tidak "
        "terpotong aneh.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()