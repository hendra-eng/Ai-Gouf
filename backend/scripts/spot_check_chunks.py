"""
scripts/spot_check_chunks.py
Sampling acak chunk dari vector store untuk verifikasi manual (Tahap 4.1).

Kenapa ini penting: chunker Tahap 2 sudah sadar struktur Pasal/ayat, tapi
itu tidak menjamin BEBAS BUG -- PDF hasil OCR yang jelek, heading "Pasal N"
yang tidak terbaca rapi, atau dokumen SE/Pengumuman berformat bebas tetap
bisa menghasilkan chunk yang terpotong menyesatkan. Script ini TIDAK
menggantikan review manusia -- tujuannya mempermudah & mempercepat review
itu dengan sampling representatif + red-flag otomatis untuk memprioritaskan
baris mana yang paling perlu dicek duluan.

Output: CSV di ./spot_check_output.csv -- buka di Excel/Sheets, isi kolom
`ok(y/n)` dan `catatan_reviewer` setelah direview manusia.

PRASYARAT: tambahkan method list_all_chunks() di modules/vector_store.py
(lihat vector_store_PATCH.py) sebelum menjalankan script ini.

Cara pakai:
    python scripts/spot_check_chunks.py --n-per-dokumen 3
    python scripts/spot_check_chunks.py --kategori "PPh 21" --n-per-dokumen 5
    python scripts/spot_check_chunks.py --hanya-red-flag
"""
from __future__ import annotations

import argparse
import csv
import random
from collections import defaultdict
from pathlib import Path

from modules import tax_ingestion
from modules.vector_store import default_store

OUTPUT_PATH = Path("spot_check_output.csv")

# Jenis dokumen yang SEHARUSNYA punya struktur pasal/ayat -- kalau chunk
# dari dokumen jenis ini tidak punya label `pasal`, itu red flag (mungkin
# heading "Pasal N" di PDF sumber tidak terbaca / format aneh / hasil OCR
# jelek). SE dan Putusan sengaja TIDAK dimasukkan di sini karena keduanya
# memang lazim berformat bebas tanpa struktur pasal/ayat baku.
JENIS_BERSTRUKTUR_PASAL = {"UU", "PP", "PMK", "PER"}
MIN_CHUNK_LEN = 20  # chunk lebih pendek dari ini kemungkinan sampah/terpotong


def _red_flags(chunk, jenis: str) -> list[str]:
    """
    Heuristik sederhana, BUKAN jaminan -- tujuannya cuma memprioritaskan
    baris mana yang direview manusia duluan, bukan menggantikan review itu
    sendiri. False positive/negative pasti ada (mis. chunk yang memang
    sengaja diawali angka atau kutipan akan salah kena flag "huruf kecil").
    """
    flags = []
    text = chunk.text.strip()

    if len(text) < MIN_CHUNK_LEN:
        flags.append("chunk sangat pendek (kemungkinan sampah)")

    if jenis in JENIS_BERSTRUKTUR_PASAL and not chunk.pasal:
        flags.append("dokumen berstruktur pasal tapi chunk tanpa label pasal")

    if text and text[0].islower():
        flags.append("chunk mulai dengan huruf kecil (mungkin terpotong di tengah kalimat)")

    if text and text[-1] not in ".;:)\"'\u201d":
        flags.append("chunk tidak diakhiri tanda baca wajar (mungkin terpotong)")

    return flags


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n-per-dokumen", type=int, default=3,
                         help="Berapa chunk disampel per dokumen/kasus")
    parser.add_argument("--kategori", type=str, default=None,
                         help="Filter TaxCategory, mis. 'PPh 21' (lihat modules/schemas.py TaxCategory)")
    parser.add_argument("--hanya-red-flag", action="store_true",
                         help="Kalau di-set, hanya masukkan chunk yang kena red flag ke output")
    parser.add_argument("--seed", type=int, default=42,
                         help="Seed random, biar sampling bisa direproduksi ulang")
    args = parser.parse_args()

    random.seed(args.seed)

    # Kelompokkan semua chunk yang sedang ada di memory berdasarkan
    # document_id/case_id-nya, supaya sampling bisa "n chunk per dokumen"
    # (representatif per dokumen), bukan "n chunk random dari total" yang
    # bisa saja kebetulan semuanya dari 1-2 dokumen besar saja.
    all_by_group: dict[str, list] = defaultdict(list)
    for chunk, _vector in default_store.list_all_chunks():
        group_id = chunk.metadata.document_id or chunk.metadata.case_id or "tanpa_grup"
        all_by_group[group_id].append(chunk)

    if not all_by_group:
        print("Vector store kosong -- belum ada dokumen yang di-ingest.")
        return

    rows = []
    for group_id, chunks in all_by_group.items():
        doc = tax_ingestion.get_document(group_id) if group_id != "tanpa_grup" else None

        if args.kategori:
            kategori_doc = doc.kategori_pajak.value if (doc and doc.kategori_pajak) else None
            if kategori_doc != args.kategori:
                continue

        chunks.sort(key=lambda c: c.chunk_index)
        sample_size = min(args.n_per_dokumen, len(chunks))
        sampled = random.sample(chunks, sample_size)

        for chunk in sampled:
            idx_in_list = next(i for i, c in enumerate(chunks) if c.id == chunk.id)
            prev_text = chunks[idx_in_list - 1].text[-80:] if idx_in_list > 0 else ""
            next_text = chunks[idx_in_list + 1].text[:80] if idx_in_list + 1 < len(chunks) else ""

            jenis = chunk.metadata.jenis
            flags = _red_flags(chunk, jenis)

            if args.hanya_red_flag and not flags:
                continue

            rows.append({
                "group_id": group_id,
                "dokumen": chunk.metadata.judul,
                "jenis": jenis,
                "kategori_pajak": doc.kategori_pajak.value if (doc and doc.kategori_pajak) else "",
                "pasal": chunk.pasal or "",
                "chunk_index": chunk.chunk_index,
                "panjang_chunk": len(chunk.text),
                "...konteks_sebelum": prev_text,
                "isi_chunk": chunk.text,
                "konteks_sesudah...": next_text,
                "red_flags_otomatis": "; ".join(flags),
                "ok(y/n)": "",           # diisi manual setelah review
                "catatan_reviewer": "",  # diisi manual setelah review
            })

    if not rows:
        print("Tidak ada chunk yang cocok (cek filter --kategori / --hanya-red-flag, "
              "atau apakah vector store berisi dokumen jenis yang dicari).")
        return

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    n_flagged = sum(1 for r in rows if r["red_flags_otomatis"])
    print(f"Sampel: {len(rows)} chunk dari {len(all_by_group)} dokumen/kasus -> {OUTPUT_PATH}")
    print(f"{n_flagged} dari {len(rows)} chunk kena red flag otomatis -- prioritaskan review baris itu dulu.")


if __name__ == "__main__":
    main()