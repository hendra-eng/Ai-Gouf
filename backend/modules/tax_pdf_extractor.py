"""
modules/tax_pdf_extractor.py

[Tahap 3] Ekstraksi teks dari PDF peraturan pajak untuk dimasukkan ke
ingest_document(). Banyak PMK/PER/SE di JDIH Kemenkeu itu PDF hasil scan
(foto dokumen fisik dipindai) atau PDF dengan lapisan teks yang rusak --
pdftotext/pypdf polos akan mengembalikan string kosong atau teks acak
untuk kasus itu.

Strategi di sini SELALU coba jalur cepat dulu (lapisan teks asli kalau
ada), baru fallback ke OCR (pytesseract) kalau perlu -- karena OCR jauh
lebih lambat (rasterize tiap halaman ke gambar dulu) dan kadang salah
mengenali karakter, terutama untuk dokumen lama.

Setiap hasil ekstraksi disertai info `used_ocr` -- WAJIB dipakai untuk
menandai dokumen itu "perlu spot-check manual" di Tahap 4, karena OCR
bisa salah kutip angka/kata (mis. "5%" terbaca "S%", atau nomor pasal
salah baca) tanpa ada error yang kelihatan.

Perlu: pip install pypdf pdfplumber pytesseract pdf2image
Perlu binary: poppler-utils (untuk pdf2image) + tesseract-ocr terpasang
di OS (bukan cuma package Python-nya).
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

# Ambang batas: kalau rata-rata karakter per halaman dari lapisan teks
# asli di bawah ini, dianggap "lapisan teks tidak bisa diandalkan" (mis.
# PDF hasil scan yang kebetulan punya sedikit teks OCR bawaan yang jelek,
# atau font tidak ter-embed dengan benar) -> fallback ke OCR.
MIN_CHARS_PER_PAGE = 20

# [BARU -- PERBAIKAN PERFORMA] Sebelumnya OCR jalan SEQUENTIAL, 1 halaman
# per 1 halaman (for image in images: pytesseract.image_to_string(...)) --
# untuk dokumen puluhan halaman, waktu totalnya = jumlah halaman dikali
# waktu OCR per halaman. pytesseract sebenarnya memanggil BINARY tesseract
# lewat subprocess (bukan murni Python) -- GIL DILEPAS selagi menunggu
# proses eksternal itu, jadi ThreadPoolExecutor (bukan harus
# ProcessPoolExecutor) SUDAH cukup untuk paralelisasi nyata di sini,
# analog "pemilihan tool yang tepat per jenis kerja" -- I/O/subprocess-
# bound pakai thread, CPU-bound murni Python pakai proses (lihat pola yang
# sama di ai_file_reader.py/excel_export_worker.py).
OCR_WORKER_MAKS = int(os.environ.get("TAX_PDF_OCR_WORKER_MAKS", "4"))


@dataclass
class PdfExtractionResult:
    text: str
    used_ocr: bool
    page_count: int
    warnings: List[str] = field(default_factory=list)
    is_encrypted: bool = False
    mojibake_suspect: bool = False

    @property
    def is_suspicious(self) -> bool:
        """True kalau hasil ekstraksi patut dicurigai & perlu spot-check
        manual (Tahap 4) sebelum dipakai akuntan -- dipakai script batch
        untuk menandai baris mana di laporan yang perlu direview manusia."""
        return (
            self.used_ocr
            or bool(self.warnings)
            or self.mojibake_suspect
            or len(self.text.strip()) < 200
        )


def extract_text(pdf_path: str | Path) -> PdfExtractionResult:
    """Titik masuk utama. Coba lapisan teks asli dulu, fallback OCR kalau perlu."""
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF tidak ditemukan: {pdf_path}")

    warnings: List[str] = []

    is_encrypted, unlocked_with_empty_password = _cek_enkripsi(pdf_path)
    if is_encrypted and not unlocked_with_empty_password:
        # PDF butuh password sungguhan yang tidak kita punya -- jangan coba
        # ekstrak apa pun, laporkan sebagai gagal yang jelas ke staf supaya
        # mereka buka manual di Adobe/browser, simpan ulang tanpa password.
        return PdfExtractionResult(
            text="",
            used_ocr=False,
            page_count=0,
            warnings=[
                "PDF ini terkunci password -- tidak bisa diekstrak otomatis. "
                "Buka manual, simpan ulang (Save As) tanpa password, lalu coba lagi."
            ],
            is_encrypted=True,
        )

    text, page_count = _extract_native_text(pdf_path)
    avg_chars = (len(text) / page_count) if page_count else 0

    if page_count == 0:
        warnings.append("Tidak bisa membaca jumlah halaman PDF (file mungkin korup).")

    if avg_chars >= MIN_CHARS_PER_PAGE:
        mojibake = _deteksi_mojibake(text)
        if mojibake:
            warnings.append(
                "Teks hasil ekstraksi mengandung banyak karakter aneh/rusak "
                "(kemungkinan masalah encoding font PDF) -- perlu dicek manual."
            )
        return PdfExtractionResult(
            text=_bersihkan_teks(text),
            used_ocr=False,
            page_count=page_count,
            warnings=warnings,
            is_encrypted=is_encrypted,
            mojibake_suspect=mojibake,
        )

    # Lapisan teks asli kosong/terlalu sedikit -> kemungkinan besar hasil
    # scan. Fallback ke OCR untuk SELURUH dokumen (bukan cuma halaman yang
    # kosong -- lebih konsisten daripada mencampur dua sumber teks berbeda
    # kualitas di satu dokumen).
    try:
        ocr_text, ocr_page_count = _extract_via_ocr(pdf_path)
    except Exception as e:  # pytesseract/poppler belum terpasang, dll.
        warnings.append(
            f"Lapisan teks asli kosong/minim (kemungkinan PDF hasil scan) DAN "
            f"OCR gagal dijalankan: {e}. Dokumen ini TIDAK bisa diekstrak "
            f"otomatis -- perlu ditangani manual."
        )
        return PdfExtractionResult(
            text=_bersihkan_teks(text),
            used_ocr=False,
            page_count=page_count,
            warnings=warnings,
        )

    if len(ocr_text.strip()) < MIN_CHARS_PER_PAGE:
        warnings.append(
            "OCR sudah dicoba tapi hasilnya nyaris kosong -- dokumen mungkin "
            "berkualitas scan sangat buruk, perlu ditangani manual."
        )

    mojibake = _deteksi_mojibake(ocr_text)
    if mojibake:
        warnings.append(
            "Hasil OCR mengandung banyak karakter aneh/tidak terbaca -- "
            "kualitas scan mungkin rendah, wajib dicek manual."
        )

    return PdfExtractionResult(
        text=_bersihkan_teks(ocr_text),
        used_ocr=True,
        page_count=ocr_page_count,
        warnings=warnings,
        is_encrypted=is_encrypted,
        mojibake_suspect=mojibake,
    )


def _cek_enkripsi(pdf_path: Path) -> tuple[bool, bool]:
    """
    Return (is_encrypted, bisa_dibuka_tanpa_password). Banyak PDF hasil
    scan/download dari situs pemerintah dikunci "owner password" (mencegah
    edit) tapi tetap bisa dibaca tanpa password -- itu tetap dianggap
    "encrypted=True" secara teknis tapi TIDAK menghalangi ekstraksi, jadi
    dibedakan dari PDF yang benar-benar butuh password untuk dibuka.
    """
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(pdf_path))
        if not reader.is_encrypted:
            return False, True
        try:
            reader.decrypt("")  # coba password kosong (kasus paling umum)
            # Kalau setelah decrypt("") kita masih tidak bisa baca halaman
            # pertama, berarti butuh password sungguhan.
            _ = len(reader.pages)
            return True, True
        except Exception:
            return True, False
    except Exception:
        # Gagal buka sama sekali (bukan soal password) -- biarkan alur
        # normal (_extract_native_text) yang menangani & melaporkan errornya.
        return False, True


def _deteksi_mojibake(text: str) -> bool:
    """
    Heuristik sederhana: kalau proporsi karakter "aneh" (bukan huruf/angka/
    tanda baca/whitespace umum) terlalu tinggi, kemungkinan besar ada
    masalah encoding font (karakter jadi simbol acak) atau hasil OCR yang
    berantakan. Tidak sempurna (bahasa Indonesia formal jarang pakai
    simbol matematika/kontrol), tapi cukup untuk menyaring kasus jelas
    rusak tanpa staf perlu baca seluruh dokumen satu-satu.
    """
    sample = text[:5000]  # cukup sampel awal, dokumen bisa ratusan halaman
    if len(sample.strip()) < 50:
        return False

    aneh = sum(
        1 for ch in sample
        if not (ch.isalnum() or ch.isspace() or ch in ".,;:()[]{}\"'%-/\\°&@#$§")
        and ord(ch) > 127  # huruf non-ASCII (mis. simbol mojibake umum)
    )
    replacement_char = sample.count("\ufffd")

    proporsi_aneh = aneh / len(sample)
    return proporsi_aneh > 0.03 or replacement_char > 3


def _extract_native_text(pdf_path: Path) -> tuple[str, int]:
    """Coba pdfplumber dulu (lebih rapi untuk layout dua kolom/tabel),
    fallback ke pypdf kalau pdfplumber gagal open (mis. PDF korup ringan)."""
    try:
        import pdfplumber

        parts = []
        with pdfplumber.open(str(pdf_path)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n\n".join(parts), page_count
    except Exception:
        pass

    try:
        from pypdf import PdfReader

        reader = PdfReader(str(pdf_path))
        page_count = len(reader.pages)
        parts = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(parts), page_count
    except Exception:
        return "", 0


def _ocr_satu_halaman(image, lang: str = "ind+eng") -> str:
    """Top-level (bukan closure) supaya jelas & mudah dites terpisah --
    dijalankan per-halaman di dalam ThreadPoolExecutor oleh
    _extract_via_ocr."""
    import pytesseract

    return pytesseract.image_to_string(image, lang=lang)


def _extract_via_ocr(pdf_path: Path) -> tuple[str, int]:
    """
    [DIPERBAIKI -- PERFORMA] OCR tiap halaman PARALEL (lihat OCR_WORKER_MAKS
    di atas), bukan satu-satu berurutan -- untuk dokumen 20 halaman dengan
    4 worker, ini kira-kira 4x lebih cepat dibanding versi sequential lama.
    Urutan hasil TETAP mengikuti urutan halaman asli (executor.map menjaga
    urutan output = urutan input walau thread selesai tidak berurutan),
    jadi teks gabungan akhir sama persis strukturnya dengan versi lama --
    cuma lebih cepat.
    """
    from pdf2image import convert_from_path

    images = convert_from_path(str(pdf_path), dpi=300)
    if not images:
        return "", 0

    n_worker = max(1, min(OCR_WORKER_MAKS, len(images)))
    with ThreadPoolExecutor(max_workers=n_worker) as executor:
        parts = list(executor.map(_ocr_satu_halaman, images))
    return "\n\n".join(parts), len(images)


def _bersihkan_teks(text: str) -> str:
    """Rapikan whitespace berlebih tanpa mengubah isi -- baris kosong
    berulang dari header/footer tiap halaman PDF jadi tidak menumpuk."""
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned: List[str] = []
    kosong_beruntun = 0
    for line in lines:
        if line.strip() == "":
            kosong_beruntun += 1
            if kosong_beruntun > 1:
                continue
        else:
            kosong_beruntun = 0
        cleaned.append(line)
    return "\n".join(cleaned).strip()