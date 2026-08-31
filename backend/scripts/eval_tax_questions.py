"""
scripts/eval_tax_questions.py
Uji ask_tax_question() dengan pertanyaan NYATA dari akuntan (Tahap 4.2).

Beda dengan tests/test_tax_rag_citation.py: script ini memanggil Claude API
SUNGGUHAN (butuh ANTHROPIC_API_KEY di .env & dokumen sudah di-ingest ke
database), dan hasilnya untuk DINILAI MANUSIA -- benar/salahnya jawaban
bahasa natural tidak realistis dicek otomatis dengan assert sederhana.

WAJIB: ganti daftar PERTANYAAN_UJI di bawah dengan pertanyaan nyata dari
akuntan kamu (yang di bawah cuma contoh placeholder), idealnya termasuk
pertanyaan yang PERNAH bikin sistem lama salah jawab, supaya evaluasi ini
juga jadi regression test buat kasus yang sudah pernah bermasalah.

Cara pakai:
    python scripts/eval_tax_questions.py
    -> hasil tersimpan di eval_results.csv
    -> minta akuntan isi kolom skor_manual(1-5) & catatan_reviewer
    -> simpan file itu (mis. commit ke repo tanggal per tanggal) supaya
       bisa dibandingkan lagi setelah database/model di-update nanti
"""
from __future__ import annotations

import csv
from pathlib import Path

from modules.tax_rag import ask_tax_question, TaxRagError

OUTPUT_PATH = Path("eval_results.csv")

# ============================================================
# GANTI INI dengan pertanyaan nyata dari akuntan-akuntan kamu.
#
# `nomor_diharapkan`: isi kalau kamu TAHU PERSIS dokumen mana yang
# seharusnya dikutip (mis. "PMK 168/2023") -- script akan otomatis
# menandai TIDAK COCOK kalau jawaban tidak mengutip nomor itu, supaya
# kamu tidak perlu baca satu-satu untuk kasus yang jelas salah kutip.
# Boleh dikosongkan (None) untuk pertanyaan open-ended yang jawabannya
# memang perlu dibaca manual.
# ============================================================
PERTANYAAN_UJI = [
    {
        "pertanyaan": "Berapa tarif PPh 21 untuk karyawan tetap dengan penghasilan di atas 500 juta setahun?",
        "kategori": "PPh 21",
        "nomor_diharapkan": None,
    },
    {
        "pertanyaan": "Apakah UMKM dengan omzet di bawah 500 juta wajib bayar PPh Final?",
        "kategori": "PPh Final UMKM",
        "nomor_diharapkan": None,
    },
    {
        "pertanyaan": "Kapan batas waktu pelaporan SPT Masa PPN?",
        "kategori": "PPN",
        "nomor_diharapkan": None,
    },
    {
        "pertanyaan": "Berapa tarif PPh 23 untuk jasa konsultan?",
        "kategori": "PPh 23",
        "nomor_diharapkan": None,
    },
    # tambahkan lebih banyak pertanyaan nyata dari akuntan kamu di sini...
]


def main():
    if not PERTANYAAN_UJI:
        print("PERTANYAAN_UJI kosong -- isi dulu daftar pertanyaan di file ini.")
        return

    rows = []
    for i, kasus in enumerate(PERTANYAAN_UJI, start=1):
        print(f"[{i}/{len(PERTANYAAN_UJI)}] Menguji: {kasus['pertanyaan']}")
        try:
            hasil = ask_tax_question(kasus["pertanyaan"], top_k=5)
            jawaban = hasil.jawaban
            sumber_nomor = [s["nomor"] for s in hasil.sumber]
            if kasus["nomor_diharapkan"]:
                sumber_ok = "YA" if kasus["nomor_diharapkan"] in sumber_nomor else "TIDAK - cek manual"
            else:
                sumber_ok = ""
        except TaxRagError as e:
            jawaban = f"[ERROR KONFIGURASI] {e}"
            sumber_nomor = []
            sumber_ok = ""
        except Exception as e:  # noqa: BLE001 -- sengaja tangkap luas, ini script eval, bukan endpoint
            jawaban = f"[ERROR TAK TERDUGA] {type(e).__name__}: {e}"
            sumber_nomor = []
            sumber_ok = ""

        rows.append({
            "no": i,
            "pertanyaan": kasus["pertanyaan"],
            "kategori": kasus["kategori"],
            "jawaban": jawaban,
            "sumber_dikutip": "; ".join(sumber_nomor),
            "sumber_sesuai_ekspektasi": sumber_ok,
            "skor_manual(1-5)": "",   # diisi akuntan setelah review
            "catatan_reviewer": "",   # diisi akuntan setelah review
        })

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    n_tidak_cocok = sum(1 for r in rows if r["sumber_sesuai_ekspektasi"] == "TIDAK - cek manual")
    print(f"\n{len(rows)} pertanyaan diuji -> hasil di {OUTPUT_PATH}")
    if n_tidak_cocok:
        print(f"⚠️ {n_tidak_cocok} pertanyaan TIDAK mengutip nomor_diharapkan -- cek baris itu dulu.")
    print("Minta akuntan kamu isi kolom skor_manual(1-5) & catatan_reviewer.")


if __name__ == "__main__":
    main()