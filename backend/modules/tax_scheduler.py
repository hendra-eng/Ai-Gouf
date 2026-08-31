"""
modules/tax_scheduler.py
Penjadwalan tugas berkala untuk fitur riset pajak (mis. cek ulang
peraturan yang statusnya belum diverifikasi, dsb). Berbeda dari
modules/notifikasi.py yang sudah ada (untuk reminder deadline SPT) -
modul ini khusus untuk tugas latar belakang fitur case law/riset.

Pakai APScheduler (pip install apscheduler). Kalau belum terpasang,
modul ini tetap bisa diimpor, tapi start_scheduler() akan melempar
error yang jelas.

[Tahap 5, poin 15] Dua job bulanan baru ditambahkan di sini:

  1. _reminder_pembaruan_tier1() -- KARENA DJP/Kemenkeu tidak punya API
     resmi (lihat rencana Tahap 3, poin 9), job ini TIDAK mencoba
     scraping otomatis. Sebagai gantinya, ini murni REMINDER: baca
     tax_scope.json (prioritas Tahap 1), cek untuk tiap regulasi acuan
     tier 1 apakah sudah pernah diverifikasi statusnya BULAN INI (lihat
     tax_status_tracker.updated_at) -- kalau belum, catat sebagai "perlu
     dicek manual bulan ini" ke tabel storage `monthly_check_report`,
     supaya staf tinggal lihat daftar itu dan cek satu-satu ke
     JDIH/peraturan.go.id/DJP -- sama seperti proses Tahap 3, cuma
     sekarang terjadwal & tidak pernah lupa dijalankan.

  2. _arsipkan_qa_log_bulanan() -- membungkus
     modules.tax_qa_log.archive_old_logs() (fungsi retensi yang sudah
     dibangun di Tahap 4) supaya benar-benar terjadwal otomatis, bukan
     cuma bisa dipanggil manual lewat endpoint admin.

Lihat scripts/monthly_review_report.py untuk cara staf membaca hasil job
#1 (baca tabel `monthly_check_report`, tanpa perlu tahu detail storage.py).
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

try:
    from apscheduler.schedulers.background import BackgroundScheduler
except ImportError:  # pragma: no cover
    BackgroundScheduler = None  # type: ignore

_scheduler: Optional["BackgroundScheduler"] = None

# [Tahap 5] Tabel storage tempat hasil job pengecekan bulanan disimpan --
# satu record per BULAN RUN (bukan per dokumen), supaya staf bisa lihat
# riwayat "bulan Juli kita menemukan X item perlu dicek" vs bulan ini.
TABLE_MONTHLY_REPORT = "monthly_check_report"


def _check_stale_regulations() -> None:
    """Contoh job bawaan: log peraturan dengan status belum diketahui, perlu ditinjau staf."""
    from modules.tax_status_tracker import get_status_tracker
    from modules.schemas import RegulationStatus

    tracker = get_status_tracker()
    unknown = tracker.list_by_status(RegulationStatus.TIDAK_DIKETAHUI)
    if unknown:
        logger.info("Ada %d peraturan berstatus belum diketahui, perlu ditinjau.", len(unknown))


def _muat_tax_scope() -> dict:
    """
    [Tahap 5] Baca modules/tax_scope.json -- path diselesaikan RELATIF ke
    file ini (bukan cwd), supaya job ini tetap menemukan file itu apa pun
    direktori kerja saat proses backend/scheduler dijalankan.
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent / "tax_scope.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _item_tier(scope: dict, tier: int) -> list[dict]:
    for kelompok in scope.get("tier", []):
        if kelompok.get("tier") == tier:
            return kelompok.get("jenis_pajak", [])
    return []


def _reminder_pembaruan_tier1(bulan_toleransi: int = 1) -> dict:
    """
    [Tahap 5, poin 15] Job REMINDER bulanan -- lihat penjelasan panjang di
    docstring modul atas untuk alasan kenapa ini bukan scraping otomatis.

    Untuk tiap nomor regulasi acuan di tier 1 tax_scope.json:
      - Kalau BELUM ADA di database sama sekali (find_by_nomor gagal) ->
        catat "belum di-ingest, prioritas tinggi".
      - Kalau SUDAH ADA, tapi tax_status_tracker.updated_at-nya lebih tua
        dari `bulan_toleransi` bulan -> catat "perlu dicek ulang bulan
        ini" (bisa jadi statusnya sudah berubah tapi belum ketahuan).
      - Kalau sudah dicek dalam `bulan_toleransi` bulan terakhir ->
        tidak dicatat (dianggap masih fresh).

    Hasil ditulis ke tabel TABLE_MONTHLY_REPORT (satu record per
    pemanggilan fungsi ini, key = timestamp run) -- lihat
    scripts/monthly_review_report.py untuk membacanya.

    "TIDAK ADA rules produksi/aturan pajak yang dieksekusi otomatis dari
    hasil job ini" -- ini murni menghasilkan DAFTAR untuk manusia,
    konsisten dengan keputusan Tahap 3 (poin 9) bahwa ingest/verifikasi
    tetap harus lewat proses semi-manual staf, bukan otomatis penuh.
    """
    from datetime import datetime, timedelta

    from modules import storage
    from modules.tax_ingestion import find_by_nomor
    from modules.tax_status_tracker import TABLE as STATUS_TABLE

    scope = _muat_tax_scope()
    items_tier1 = _item_tier(scope, tier=1)
    batas_waktu = datetime.utcnow() - timedelta(days=30 * bulan_toleransi)

    perlu_dicek: list[dict] = []
    for item in items_tier1:
        nama_pajak = item.get("nama", item.get("id", "?"))
        for nomor in item.get("regulasi_acuan_awal", []):
            dokumen = find_by_nomor(nomor)
            if dokumen is None:
                perlu_dicek.append({
                    "nomor": nomor,
                    "jenis_pajak": nama_pajak,
                    "alasan": "belum ada di database sama sekali",
                    "prioritas": "tinggi",
                })
                continue

            record = storage.get(STATUS_TABLE, dokumen.id)
            updated_at_str = record.get("updated_at") if record else None
            try:
                updated_at = datetime.fromisoformat(updated_at_str) if updated_at_str else None
            except (TypeError, ValueError):
                updated_at = None

            if updated_at is None or updated_at < batas_waktu:
                perlu_dicek.append({
                    "nomor": nomor,
                    "jenis_pajak": nama_pajak,
                    "alasan": (
                        "belum pernah diverifikasi statusnya" if updated_at is None
                        else f"terakhir diverifikasi {updated_at.date().isoformat()}, sudah lebih dari {bulan_toleransi} bulan"
                    ),
                    "prioritas": "sedang",
                })

    run_id = datetime.utcnow().strftime("%Y_%m_%d_%H%M%S")
    laporan = {
        "run_id": run_id,
        "dijalankan_pada": datetime.utcnow().isoformat(),
        "total_item_tier1_dicek": sum(len(item.get("regulasi_acuan_awal", [])) for item in items_tier1),
        "jumlah_perlu_review": len(perlu_dicek),
        "item": perlu_dicek,
    }
    storage.upsert(TABLE_MONTHLY_REPORT, run_id, laporan)

    if perlu_dicek:
        logger.info(
            "[Tahap 5] Reminder bulanan: %d regulasi tier-1 perlu dicek manual di JDIH/peraturan.go.id/DJP "
            "(lihat tabel '%s', run_id=%s atau scripts/monthly_review_report.py).",
            len(perlu_dicek), TABLE_MONTHLY_REPORT, run_id,
        )
    else:
        logger.info("[Tahap 5] Reminder bulanan: semua regulasi tier-1 sudah diverifikasi baru-baru ini.")

    return laporan


def _arsipkan_qa_log_bulanan() -> None:
    """
    [Tahap 5] Bungkus modules.tax_qa_log.archive_old_logs() (fungsi
    retensi Tahap 4 yang sebelumnya cuma bisa dipanggil manual lewat
    endpoint admin) supaya benar-benar berjalan otomatis tiap bulan --
    tanpa ini, staf harus ingat memanggil endpoint arsip secara manual,
    yang gampang terlewat.
    """
    from modules.tax_qa_log import archive_old_logs

    hasil = archive_old_logs()
    logger.info("[Tahap 5] Arsip qa_audit_log bulanan: %s", hasil)


def get_scheduler() -> "BackgroundScheduler":
    global _scheduler
    if BackgroundScheduler is None:
        raise RuntimeError("APScheduler belum terpasang. Jalankan: pip install apscheduler")
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone="Asia/Makassar")
    return _scheduler


def add_daily_job(func: Callable, hour: int = 6, minute: int = 0, job_id: Optional[str] = None) -> None:
    scheduler = get_scheduler()
    scheduler.add_job(func, "cron", hour=hour, minute=minute, id=job_id, replace_existing=True)


def add_monthly_job(
    func: Callable,
    day: int = 1,
    hour: int = 6,
    minute: int = 0,
    job_id: Optional[str] = None,
) -> None:
    """
    [Tahap 5] Sama seperti add_daily_job(), tapi cron dengan `day` tetap
    (tanggal tertentu tiap bulan) -- default tanggal 1 jam 06:00
    (Asia/Makassar, sesuai timezone scheduler di get_scheduler()).

    Kalau `day` lebih besar dari jumlah hari bulan tertentu (mis. day=31
    tapi bulan itu cuma 30 hari), APScheduler otomatis melewati bulan itu
    (perilaku bawaan cron) -- untuk job bulanan di sini day=1 dipakai
    sebagai default supaya selalu jalan tiap bulan tanpa pengecualian.
    """
    scheduler = get_scheduler()
    scheduler.add_job(func, "cron", day=day, hour=hour, minute=minute, id=job_id, replace_existing=True)


def start_scheduler() -> None:
    scheduler = get_scheduler()
    add_daily_job(_check_stale_regulations, hour=6, minute=0, job_id="check_stale_regulations")
    # [Tahap 5] Dua job bulanan baru, tanggal 1 jam 07:00 (sengaja beda
    # jam dari job harian di atas supaya tidak numpuk bareng kalau
    # kebetulan tanggal 1).
    add_monthly_job(_reminder_pembaruan_tier1, day=1, hour=7, minute=0, job_id="reminder_pembaruan_tier1")
    add_monthly_job(_arsipkan_qa_log_bulanan, day=1, hour=7, minute=15, job_id="arsipkan_qa_log_bulanan")
    if not scheduler.running:
        scheduler.start()
        logger.info("Tax scheduler dimulai (job harian + 2 job bulanan Tahap 5).")


def stop_scheduler() -> None:
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)