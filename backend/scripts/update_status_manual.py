"""
scripts/update_status_manual.py

[Tahap 5, poin 16] Alat bantu RINGAN untuk proses update bulanan, khusus
kasus yang TIDAK butuh ingest dokumen baru sekaligus -- misalnya staf
sedang cek JDIH Kemenkeu/peraturan.go.id bulan ini (mengikuti prioritas
tax_scope.json), menemukan bahwa suatu PMK sudah dicabut, tapi PDF
pengganti resminya belum sempat didownload/di-ingest.

Beda dengan scripts/batch_ingest_pajak.py (yang WAJIB ada PDF + metadata
lengkap untuk tiap baris, karena tujuan utamanya ingest dokumen), script
ini HANYA mengubah status dokumen yang SUDAH ADA di database -- tidak
butuh PDF, tidak butuh folder pdf_dir. Begitu PDF pengganti sudah siap,
staf tetap harus jalankan batch_ingest_pajak.py (dengan kolom
mencabut_nomor) untuk benar-benar meng-ingest teksnya -- script ini cuma
mencegah AI terus mengutip aturan yang sudah diketahui basi SAMBIL
menunggu proses ingest dokumen penggantinya.

Format manifest CSV (lihat perubahan_status_contoh.csv):
  Kolom wajib:
    - nomor           : nomor dokumen LAMA yang sudah ada di database
                         (mis. "PMK 168/2023")
    - status_baru      : "dicabut" atau "diubah"
  Kolom opsional:
    - digantikan_oleh_nomor : nomor dokumen PENGGANTI, KALAU dokumen itu
                               SUDAH ada di database (sudah pernah
                               di-ingest sebelumnya, mis. dari batch lain).
                               Kalau kosong, status tetap diupdate tapi
                               tidak ada link ke pengganti (bisa ditaut
                               belakangan lewat batch_ingest_pajak.py atau
                               dengan menjalankan ulang script ini setelah
                               dokumen penggantinya di-ingest).
    - catatan          : alasan/konteks singkat, masuk ke status_note.

Baris yang gagal (nomor tidak ditemukan, status_baru tidak valid, dst)
TIDAK menghentikan seluruh manifest -- dicatat di laporan, sama seperti
pola batch_ingest_pajak.py.

CARA PAKAI:
    python scripts/update_status_manual.py \
        --manifest perubahan_status.csv \
        --report hasil_update_status.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.schemas import RegulationStatus  # noqa: E402

KOLOM_WAJIB = ["nomor", "status_baru"]
KOLOM_OPSIONAL = ["digantikan_oleh_nomor", "catatan"]


@dataclass
class HasilBaris:
    nomor: str
    status_baru: str
    hasil: str  # "sukses" | "gagal"
    digantikan_oleh_nomor: str = ""
    catatan: str = ""


def _proses_satu_baris(baris: dict, update_status_fn, find_fn, tandai_digantikan_fn) -> HasilBaris:
    nomor = (baris.get("nomor") or "").strip()
    status_baru_raw = (baris.get("status_baru") or "").strip()
    digantikan_oleh_nomor = (baris.get("digantikan_oleh_nomor") or "").strip()
    catatan_input = (baris.get("catatan") or "").strip()

    hasil = HasilBaris(
        nomor=nomor,
        status_baru=status_baru_raw,
        digantikan_oleh_nomor=digantikan_oleh_nomor,
        hasil="gagal",
    )

    if not nomor or not status_baru_raw:
        hasil.catatan = "Kolom nomor/status_baru kosong -- baris dilewati."
        return hasil

    try:
        status_baru = RegulationStatus(status_baru_raw)
    except ValueError:
        hasil.catatan = f"status_baru '{status_baru_raw}' bukan salah satu dari {[e.value for e in RegulationStatus]}"
        return hasil

    dokumen_lama = find_fn(nomor)
    if dokumen_lama is None:
        hasil.catatan = f"Dokumen dengan nomor '{nomor}' tidak ditemukan di database."
        return hasil

    if digantikan_oleh_nomor:
        dokumen_baru = find_fn(digantikan_oleh_nomor)
        if dokumen_baru is None:
            hasil.catatan = (
                f"digantikan_oleh_nomor '{digantikan_oleh_nomor}' tidak ditemukan di database -- "
                f"status TETAP diupdate untuk '{nomor}', tapi TANPA link ke pengganti. "
                f"Jalankan ulang baris ini setelah dokumen pengganti di-ingest."
            )
            update_status_fn(dokumen_lama.id, status_baru, note=catatan_input or None)
            hasil.hasil = "sukses"
            return hasil

        tandai_digantikan_fn(
            document_id_lama=dokumen_lama.id,
            document_id_baru=dokumen_baru.id,
            status_baru=status_baru,
            note=catatan_input or "Diupdate via update_status_manual.py (Tahap 5)",
        )
        hasil.hasil = "sukses"
        hasil.catatan = f"Ditaut ke '{digantikan_oleh_nomor}'."
        return hasil

    update_status_fn(dokumen_lama.id, status_baru, note=catatan_input or None)
    hasil.hasil = "sukses"
    return hasil


def _baca_manifest(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        contoh = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(contoh, delimiters=",;")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(f, dialect=dialect)
        if reader.fieldnames is None:
            raise ValueError("Manifest kosong atau tidak punya header.")
        hilang = [k for k in KOLOM_WAJIB if k not in reader.fieldnames]
        if hilang:
            raise ValueError(f"Kolom wajib hilang: {hilang}. Header yang terbaca: {reader.fieldnames}")
        return list(reader)


def _tulis_laporan(path: str, hasil_semua: list[HasilBaris]) -> None:
    fieldnames = list(asdict(hasil_semua[0]).keys()) if hasil_semua else [
        "nomor", "status_baru", "hasil", "digantikan_oleh_nomor", "catatan",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for h in hasil_semua:
            writer.writerow(asdict(h))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", required=True, help="Path ke CSV perubahan status")
    p.add_argument("--report", default="hasil_update_status.csv", help="Path laporan hasil")
    args = p.parse_args()

    from modules.tax_ingestion import update_status, find_by_nomor, tandai_digantikan

    baris_manifest = _baca_manifest(args.manifest)
    print(f"Manifest dibaca: {len(baris_manifest)} baris.")

    hasil_semua = []
    for i, baris in enumerate(baris_manifest, start=1):
        hasil = _proses_satu_baris(baris, update_status, find_by_nomor, tandai_digantikan)
        hasil_semua.append(hasil)
        print(f"[{i}/{len(baris_manifest)}] {hasil.nomor} -> {hasil.hasil}" + (f" | {hasil.catatan}" if hasil.catatan else ""))

    _tulis_laporan(args.report, hasil_semua)
    n_sukses = sum(1 for h in hasil_semua if h.hasil == "sukses")
    n_gagal = len(hasil_semua) - n_sukses
    print(f"\nSelesai: {n_sukses} sukses, {n_gagal} gagal. Detail di {args.report}")
    if n_gagal:
        sys.exit(1)


if __name__ == "__main__":
    main()