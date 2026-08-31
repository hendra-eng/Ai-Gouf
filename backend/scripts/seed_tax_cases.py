"""
scripts/seed_tax_cases.py
Mengisi data contoh (putusan pengadilan pajak + peraturan) supaya fitur
prediksi/risk-scoring/diagram bisa langsung dicoba tanpa harus input
manual dulu. Mengikuti pola scripts/seed_initial_data.py yang sudah ada.

Jalankan dari folder backend:
    python -m scripts.seed_tax_cases
"""
from __future__ import annotations

from modules import tax_case_ingestion, tax_ingestion
from modules.schemas import DocType

SAMPLE_CASES = [
    dict(
        nomor_putusan="PUT-001/PP/M.VIA/16/2026",
        pengadilan="Pengadilan Pajak",
        jenis_sengketa="PPN",
        ringkasan="Sengketa kredit pajak masukan atas faktur pajak yang dianggap tidak lengkap.",
        full_text=(
            "Pemohon banding berpendapat bahwa faktur pajak masukan telah memenuhi "
            "ketentuan formal sesuai Pasal 13 UU PPN. Menurut terbanding, faktur pajak "
            "tidak mencantumkan identitas pembeli secara lengkap sehingga tidak dapat "
            "dikreditkan. Majelis berpendapat kekurangan tersebut bersifat administratif "
            "dan tidak menghilangkan substansi transaksi."
        ),
        amar_putusan="dikabulkan_sebagian",
    ),
    dict(
        nomor_putusan="PUT-002/PP/M.VIA/16/2026",
        pengadilan="Pengadilan Pajak",
        jenis_sengketa="PPN",
        ringkasan="Sengketa kredit pajak masukan, faktur pajak lengkap dan sah.",
        full_text=(
            "Pemohon banding mendalilkan bahwa seluruh faktur pajak masukan telah "
            "diterbitkan sesuai Pasal 13 UU PPN dan didukung bukti pembayaran yang sah. "
            "Terbanding tidak dapat membuktikan adanya cacat formal maupun materiil "
            "pada faktur pajak tersebut."
        ),
        amar_putusan="dikabulkan_seluruhnya",
    ),
    dict(
        nomor_putusan="PUT-003/PP/M.IIA/15/2026",
        pengadilan="Pengadilan Pajak",
        jenis_sengketa="PPh Badan",
        ringkasan="Sengketa transfer pricing atas transaksi afiliasi luar negeri.",
        full_text=(
            "Pemohon banding berpendapat harga transaksi dengan pihak afiliasi telah "
            "sesuai prinsip kewajaran (arm's length principle). Menurut terbanding, "
            "dokumen penentuan harga transfer (TP Doc) tidak memadai untuk membuktikan "
            "kewajaran harga. Majelis sependapat dengan terbanding karena pembanding "
            "yang digunakan tidak sebanding."
        ),
        amar_putusan="ditolak",
    ),
]

SAMPLE_REGULATIONS = [
    dict(
        title="Faktur Pajak",
        doc_type=DocType.UU,
        nomor="UU No. 42 Tahun 2009",
        tahun=2009,
        full_text=(
            "Pasal 13 mengatur bahwa Pengusaha Kena Pajak wajib membuat Faktur Pajak "
            "untuk setiap penyerahan Barang Kena Pajak dan/atau Jasa Kena Pajak, "
            "memuat keterangan identitas penjual dan pembeli secara lengkap."
        ),
    ),
    dict(
        title="Ketentuan Dokumen Penentuan Harga Transfer",
        doc_type=DocType.PMK,
        nomor="PMK 172/2023",
        tahun=2023,
        full_text=(
            "Peraturan ini mengatur kewajiban penyusunan dokumen penentuan harga "
            "transfer (TP Documentation) bagi Wajib Pajak yang melakukan transaksi "
            "afiliasi, termasuk analisis kesebandingan dan penerapan prinsip "
            "kewajaran dan kelaziman usaha (arm's length principle)."
        ),
    ),
]


def seed_cases() -> int:
    count = 0
    for case_data in SAMPLE_CASES:
        tax_case_ingestion.ingest_case(**case_data)
        count += 1
    return count


def seed_regulations() -> int:
    count = 0
    for reg_data in SAMPLE_REGULATIONS:
        tax_ingestion.ingest_document(**reg_data)
        count += 1
    return count


def main() -> None:
    n_cases = seed_cases()
    n_regs = seed_regulations()
    print(f"Selesai: {n_cases} putusan contoh dan {n_regs} peraturan contoh berhasil diisi.")


if __name__ == "__main__":
    main()