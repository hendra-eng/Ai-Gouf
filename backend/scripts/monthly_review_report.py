"""
scripts/monthly_review_report.py

[Tahap 5, poin 15] Baca hasil job reminder bulanan
(modules.tax_scheduler._reminder_pembaruan_tier1(), tersimpan di tabel
storage `monthly_check_report`) dan tampilkan sebagai daftar yang mudah
dibaca staf -- daftar regulasi tier-1 (tax_scope.json) yang perlu dicek
manual bulan ini ke JDIH Kemenkeu/peraturan.go.id/situs DJP.

Ini BUKAN pengganti proses cek manual itu sendiri -- cuma mempermudah
staf tahu nomor regulasi mana saja yang harus diprioritaskan, tanpa perlu
buka file JSON storage mentah atau baca log server.

Cara pakai:
    python scripts/monthly_review_report.py
        -> tampilkan laporan run TERBARU

    python scripts/monthly_review_report.py --run-id 2026_08_01_070000
        -> tampilkan laporan run tertentu (lihat daftar run dulu kalau
           tidak tahu run_id-nya, lewat --list-runs)

    python scripts/monthly_review_report.py --list-runs
        -> tampilkan semua run_id yang tersimpan, terurut terbaru dulu

    python scripts/monthly_review_report.py --csv laporan_bulan_ini.csv
        -> selain tampil di terminal, tulis juga ke CSV untuk dibagikan/
           diisi checklist oleh staf lain
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules import storage  # noqa: E402
from modules.tax_scheduler import TABLE_MONTHLY_REPORT  # noqa: E402


def _semua_laporan() -> list[dict]:
    laporan = storage.list_all(TABLE_MONTHLY_REPORT)
    laporan.sort(key=lambda r: r.get("run_id", ""), reverse=True)
    return laporan


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run-id", default=None, help="Tampilkan laporan run tertentu (default: run terbaru)")
    p.add_argument("--list-runs", action="store_true", help="Tampilkan semua run_id yang tersimpan")
    p.add_argument("--csv", default=None, help="Path opsional untuk juga menulis laporan ke CSV")
    args = p.parse_args()

    semua = _semua_laporan()
    if not semua:
        print(
            "Belum ada laporan tersimpan di tabel 'monthly_check_report' -- job bulanan "
            "belum pernah jalan (cek apakah start_scheduler() sudah dipanggil saat server start)."
        )
        return

    if args.list_runs:
        print(f"{len(semua)} laporan tersimpan (terbaru dulu):")
        for r in semua:
            print(f"  {r['run_id']}  |  dijalankan: {r.get('dijalankan_pada','?')}  |  "
                  f"perlu review: {r.get('jumlah_perlu_review', 0)}")
        return

    if args.run_id:
        laporan = next((r for r in semua if r.get("run_id") == args.run_id), None)
        if laporan is None:
            print(f"run_id '{args.run_id}' tidak ditemukan. Coba --list-runs untuk lihat yang tersedia.")
            sys.exit(1)
    else:
        laporan = semua[0]

    print(f"Laporan run_id={laporan['run_id']} (dijalankan {laporan.get('dijalankan_pada','?')})")
    print(f"Total regulasi acuan tier-1 dicek: {laporan.get('total_item_tier1_dicek', 0)}")
    print(f"Perlu direview manual bulan ini: {laporan.get('jumlah_perlu_review', 0)}\n")

    item = laporan.get("item", [])
    if not item:
        print("Tidak ada item yang perlu direview -- semua regulasi tier-1 masih fresh.")
    else:
        for baris in item:
            print(
                f"  [{baris.get('prioritas','?').upper()}] {baris.get('nomor','?')} "
                f"({baris.get('jenis_pajak','?')}) -- {baris.get('alasan','')}"
            )

    if args.csv and item:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            fieldnames = ["nomor", "jenis_pajak", "alasan", "prioritas", "sudah_dicek(y/n)", "catatan_reviewer"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for baris in item:
                writer.writerow({
                    "nomor": baris.get("nomor", ""),
                    "jenis_pajak": baris.get("jenis_pajak", ""),
                    "alasan": baris.get("alasan", ""),
                    "prioritas": baris.get("prioritas", ""),
                    "sudah_dicek(y/n)": "",
                    "catatan_reviewer": "",
                })
        print(f"\nJuga ditulis ke {args.csv} -- isi kolom sudah_dicek(y/n) & catatan_reviewer setelah staf cek manual.")


if __name__ == "__main__":
    main()