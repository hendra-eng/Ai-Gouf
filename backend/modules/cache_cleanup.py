"""
modules/cache_cleanup.py
=========================
[BARU] Pembersih terjadwal untuk cache ekstraksi file di disk:

  - modules/cache_ekstraksi_pdf/      (kertas_kerja.py -- cache hasil
    ekstraksi PDF rekening koran, per hash isi file + client_id)
  - modules/cache_ekstraksi_office/   (ai_file_reader.py -- cache hasil
    ekstraksi xlsx/xlsm/docx/pptx/xls/doc, per hash isi file)

Kenapa modul terpisah (bukan taruh logic ini di kertas_kerja.py atau
ai_file_reader.py masing-masing): kedua cache itu punya pola file yang
identik (pickle, atomic write via .tmp+replace, cache-miss = None bukan
exception) jadi cukup 1 implementasi generik dipakai untuk keduanya,
dan supaya scheduler-nya bisa didaftarkan dari satu tempat di main.py.

Sebelumnya TIDAK ADA mekanisme ini sama sekali di kedua cache -- file
`.pkl` disimpan permanen tanpa TTL, tanpa batas ukuran folder, tanpa
LRU. Kalau server jalan lama & banyak client upload file beda-beda tiap
hari, disk bisa habis pelan-pelan. Modul ini menutup gap itu dengan 2
mekanisme independen (boleh jalan salah satu atau keduanya):

  1. TTL (Time To Live): file cache yang tidak "disentuh" (dibaca ATAU
     ditulis) lebih dari CACHE_TTL_HARI hari dianggap kadaluarsa dan
     dihapus.
  2. Batas ukuran folder + LRU: kalau total ukuran folder cache melebihi
     CACHE_MAX_UKURAN_MB, file yang PALING LAMA TIDAK DIAKSES dihapus
     duluan sampai total ukuran kembali di bawah batas.

Keduanya memakai mtime (waktu modifikasi) file sebagai proxy "terakhir
diakses" -- BUKAN atime (banyak sistem/filesystem mount dengan
`relatime`/`noatime` yang membuat atime tidak bisa diandalkan). Supaya
mtime benar-benar mencerminkan "terakhir dipakai" (bukan cuma "terakhir
ditulis"), kertas_kerja.py & ai_file_reader.py di-update supaya saat
CACHE-HIT (baca sukses) mereka juga menyentuh (touch) mtime file cache
itu -- lihat `_muat_cache_ekstraksi_pdf` di kertas_kerja.py dan
`_muat_cache_ekstraksi_office` di ai_file_reader.py.

Dipasang sebagai cron job harian lewat APScheduler yang SUDAH dipakai
main.py (pola sama seperti `_scheduler` reminder SPT / `tax_scheduler`)
-- lihat `daftarkan_job_pembersihan_cache()` di bawah, dipanggil dari
main.py saat startup.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import List

from .logging_config import get_module_logger

logger = get_module_logger("cache_cleanup")

# [BARU] Bisa diatur lewat .env, dikasih default yang wajar utk kantor
# akuntan kecil-menengah -- longgar tapi tidak tak terbatas.
CACHE_TTL_HARI = int(os.environ.get("CACHE_EKSTRAKSI_TTL_HARI", "90"))
CACHE_MAX_UKURAN_MB = int(os.environ.get("CACHE_EKSTRAKSI_MAX_UKURAN_MB", "500"))

# Folder cache yang dikelola modul ini -- ditulis sebagai path relatif
# terhadap modules/ (sama seperti _FOLDER_CACHE_EKSTRAKSI_PDF/
# _FOLDER_CACHE_EKSTRAKSI_OFFICE di modul aslinya) supaya tidak perlu
# import kertas_kerja.py/ai_file_reader.py di sini (menghindari import
# siklik & membuat modul ini ringan/berdiri sendiri).
_FOLDER_CACHE_PDF = Path(__file__).parent / "cache_ekstraksi_pdf"
_FOLDER_CACHE_OFFICE = Path(__file__).parent / "cache_ekstraksi_office"

# [BARU] Folder cache base64 PDF (ai_file_reader.py -- lihat
# _encode_pdf_base64_dengan_cache) -- BEDA dari _FOLDER_CACHE_PDF di atas
# (itu punya kertas_kerja.py, isinya hasil EKSTRAKSI TEKS PDF, format
# .pkl). Folder ini isinya PDF yang sudah di-encode base64 SIAP KIRIM ke
# Claude API, disimpan sbg teks polos (bukan pickle) dgn ekstensi .b64 --
# perlu didaftarkan terpisah di sini karena kalau tidak, foldernya tidak
# pernah dibersihkan sama sekali (tumbuh terus tanpa TTL/batas ukuran).
_FOLDER_CACHE_PDF_ENCODED = Path(__file__).parent / "cache_pdf_encoded"


def _daftar_file_cache(folder: Path, ekstensi: str = ".pkl") -> List[Path]:
    """File ber-ekstensi `ekstensi` di folder (skip .tmp -- file yang
    sedang ditulis lewat atomic-write pattern, jangan sampai ikut
    terhapus/terhitung di tengah proses tulis). Default ".pkl" (cache
    pickle di kertas_kerja.py/_ekstraksi_office) -- folder cache PDF
    base64 (ai_file_reader.py) pakai ".b64", lihat pemanggilan di
    jalankan_pembersihan_cache()."""
    if not folder.exists():
        return []
    return [p for p in folder.iterdir() if p.is_file() and p.suffix == ekstensi]


def bersihkan_cache_kadaluarsa(folder: Path, ttl_hari: int = CACHE_TTL_HARI, ekstensi: str = ".pkl") -> int:
    """Hapus file cache (ber-ekstensi `ekstensi`) yang mtime-nya lebih tua
    dari `ttl_hari` hari. Return jumlah file yang dihapus. Tidak pernah
    melempar error -- file individual yang gagal dihapus (mis. race
    condition dengan proses lain) cuma dicatat sebagai warning, tidak
    menghentikan proses pembersihan file lainnya."""
    batas_waktu = time.time() - (ttl_hari * 86400)
    dihapus = 0
    for path in _daftar_file_cache(folder, ekstensi):
        try:
            if path.stat().st_mtime < batas_waktu:
                path.unlink()
                dihapus += 1
        except OSError as e:
            logger.warning(f"⚠️ Gagal menghapus cache kadaluarsa {path.name}: {e}")
    if dihapus:
        logger.info(f"🧹 {dihapus} file cache kadaluarsa (> {ttl_hari} hari) dihapus dari {folder.name}/")
    return dihapus


def terapkan_batas_ukuran_cache(folder: Path, max_ukuran_mb: int = CACHE_MAX_UKURAN_MB, ekstensi: str = ".pkl") -> int:
    """Kalau total ukuran folder (utk file ber-ekstensi `ekstensi`) >
    max_ukuran_mb, hapus file PALING LAMA TIDAK DIAKSES (mtime terkecil
    = LRU) satu-satu sampai total ukuran kembali <= batas. Return jumlah
    file yang dihapus."""
    max_bytes = max_ukuran_mb * 1024 * 1024
    file_dgn_info = []
    total_ukuran = 0
    for path in _daftar_file_cache(folder, ekstensi):
        try:
            info = path.stat()
        except OSError:
            continue
        file_dgn_info.append((path, info.st_mtime, info.st_size))
        total_ukuran += info.st_size

    if total_ukuran <= max_bytes:
        return 0

    # Urutkan dari yang PALING LAMA diakses (mtime terkecil) -- itu yang
    # dihapus duluan (LRU: least recently used dibuang duluan).
    file_dgn_info.sort(key=lambda x: x[1])

    dihapus = 0
    for path, _mtime, ukuran in file_dgn_info:
        if total_ukuran <= max_bytes:
            break
        try:
            path.unlink()
            total_ukuran -= ukuran
            dihapus += 1
        except OSError as e:
            logger.warning(f"⚠️ Gagal menghapus cache (LRU) {path.name}: {e}")

    if dihapus:
        logger.info(
            f"🧹 {dihapus} file cache dihapus (LRU) dari {folder.name}/ -- "
            f"folder melebihi batas {max_ukuran_mb} MB."
        )
    return dihapus


def jalankan_pembersihan_cache() -> None:
    """Titik masuk tunggal dipanggil scheduler (lihat main.py) -- jalankan
    TTL + LRU untuk KETIGA folder cache (PDF ekstraksi teks, Office
    ekstraksi teks, PDF base64-encoded). Dibungkus try/except per folder
    supaya kegagalan di satu folder tidak menghentikan pembersihan
    folder lainnya."""
    # (folder, ekstensi file cache-nya) -- .pkl utk cache pickle (PDF
    # ekstraksi teks & Office), .b64 utk cache PDF base64-encoded (lihat
    # catatan _FOLDER_CACHE_PDF_ENCODED di atas -- format penyimpanannya
    # beda, teks polos bukan pickle).
    target = (
        (_FOLDER_CACHE_PDF, ".pkl"),
        (_FOLDER_CACHE_OFFICE, ".pkl"),
        (_FOLDER_CACHE_PDF_ENCODED, ".b64"),
    )
    for folder, ekstensi in target:
        try:
            bersihkan_cache_kadaluarsa(folder, ekstensi=ekstensi)
            terapkan_batas_ukuran_cache(folder, ekstensi=ekstensi)
        except Exception as e:  # noqa: BLE001 -- job scheduler, tidak boleh crash proses
            logger.error(f"❌ Gagal membersihkan cache di {folder}: {e}")


def daftarkan_job_pembersihan_cache(scheduler, jam: int = 3, menit: int = 0) -> None:
    """[BARU] Daftarkan job harian ke instance APScheduler yang sudah ada
    (dipakai bareng scheduler reminder SPT di main.py, BUKAN bikin
    scheduler baru -- 1 proses BackgroundScheduler cukup utk semua job
    terjadwal aplikasi ini). Default jam 03:00 WIB -- di luar jam kerja
    kantor, supaya tidak bentrok I/O disk dengan traffic upload/generate
    kertas kerja siang hari.

    Dipanggil dari main.py:
        from modules.cache_cleanup import daftarkan_job_pembersihan_cache
        daftarkan_job_pembersihan_cache(_scheduler)
    (taruh di dalam @app.on_event("startup") yang sama dengan yang
    mendaftarkan job reminder SPT, SEBELUM _scheduler.start() dipanggil).
    """
    scheduler.add_job(
        jalankan_pembersihan_cache,
        "cron",
        hour=jam,
        minute=menit,
        id="bersihkan_cache_ekstraksi",
        replace_existing=True,
    )
    logger.info(f"🧹 Job pembersihan cache ekstraksi terdaftar, jalan tiap hari jam {jam:02d}:{menit:02d}.")