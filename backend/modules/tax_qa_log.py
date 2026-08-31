"""
modules/tax_qa_log.py
Audit log tanya-jawab pajak (Tahap 4.3) -- SIAPA tanya APA, dijawab pakai
SUMBER apa, KAPAN. Terpisah dari logging_config.py (yang untuk debug
teknis/error ke file .log), karena log ini butuh bisa DI-QUERY per
user/client (mis. "tunjukkan semua pertanyaan client X bulan ini"), bukan
cuma dibaca sebagai teks. Disimpan lewat modules/storage.py, konsisten
dengan pola modules/tax_status_tracker.py.

PENTING: kegagalan menyimpan log TIDAK BOLEH menggagalkan jawaban ke user
-- staf/akuntan tetap harus dapat jawabannya walau, misalnya, disk penuh
atau file lock timeout. Error di sini selalu ditelan & dicatat ke logger
teknis biasa saja, tidak pernah dilempar ke atas (raise).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from modules import storage
from modules.logging_config import get_logger

TABLE = "qa_audit_log"
logger = get_logger("tax_qa_log")

# --- [Tahap 4 - retensi/arsip] ---------------------------------------------
# storage.list_all(TABLE) memuat SELURUH isi qa_audit_log.json ke memory
# setiap kali dipanggil (lihat list_logs() di bawah). Untuk firma dengan
# pemakaian harian, file itu akan terus membesar tanpa batas kalau tidak
# pernah dibersihkan -- lama-lama list_logs() (dan tiap request ke
# GET /tax/qa-log) jadi lambat & makan memory.
#
# Solusi: entri yang lebih tua dari RETENTION_MONTHS_DEFAULT bulan
# dipindahkan (bukan dihapus -- tetap harus bisa diaudit) ke tabel arsip
# TERPISAH, dipartisi PER BULAN (qa_audit_log_archive_YYYY_MM.json).
# Partisi per bulan (bukan satu file arsip besar) supaya arsip pun tidak
# ikut membesar tanpa batas -- tiap file arsip cuma berisi ~1 bulan data.
ARCHIVE_TABLE_PREFIX = "qa_audit_log_archive"
RETENTION_MONTHS_DEFAULT = int(os.environ.get("TAX_QA_LOG_RETENTION_MONTHS", "6"))

# [FIX] Index entry_id -> nama tabel arsip, supaya get_log() untuk 1 ID
# lama tidak perlu membuka SEMUA file arsip satu per satu (bisa puluhan
# file setelah bertahun-tahun). PENTING: nama tabel index ini SENGAJA
# TIDAK diawali "qa_audit_log_archive_" -- kalau diawali begitu, dia akan
# ikut "tertangkap" oleh pola glob yang dipakai _list_archive_tables() di
# bawah (qa_audit_log_archive_*.json) dan dianggap seolah-olah salah satu
# PARTISI DATA arsip, padahal isinya cuma mapping id->nama-tabel, bukan
# entri Q&A -- kalau sampai tertangkap, get_log() bisa salah mengembalikan
# isi index (dict {"table": ...}) sebagai kalau itu record Q&A asli.
ARCHIVE_INDEX_TABLE = "qa_audit_log_index"


def _archive_table_for(dt: datetime) -> str:
    """Nama tabel arsip untuk bulan tertentu, mis. qa_audit_log_archive_2026_02."""
    return f"{ARCHIVE_TABLE_PREFIX}_{dt.strftime('%Y_%m')}"


def _parse_created_at(record: Dict[str, Any]) -> Optional[datetime]:
    raw = record.get("created_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None


def _months_ago(n: int) -> datetime:
    """Titik waktu N bulan sebelum sekarang (UTC), tanpa dependensi
    tambahan (dateutil dsb) -- cuma pakai stdlib. Hari-dalam-bulan
    disesuaikan kalau bulan tujuan lebih pendek (mis. dari 31 Jan mundur
    1 bulan -> akhir Desember tahun sebelumnya, bukan error)."""
    import calendar

    now = datetime.utcnow()
    total_bulan = now.year * 12 + (now.month - 1) - n
    year, month = divmod(total_bulan, 12)
    month += 1
    hari = min(now.day, calendar.monthrange(year, month)[1])
    return now.replace(year=year, month=month, day=hari)


def _list_archive_tables() -> List[str]:
    """Semua tabel arsip yang sudah ada di DATA_DIR, terurut dari yang
    PALING BARU dulu (nama tabel mengandung YYYY_MM, jadi urutan string
    sama dengan urutan waktu).

    Filter `!= ARCHIVE_INDEX_TABLE` di sini murni jaring pengaman kedua
    (defense in depth) -- secara nama, ARCHIVE_INDEX_TABLE memang sudah
    sengaja dibuat tidak mungkin cocok dengan pola glob di bawah (lihat
    komentar di definisinya), tapi kalau suatu saat nama itu diganti
    orang lain tanpa sadar akan aturan ini, baris ini mencegah index
    ikut kebaca sebagai tabel data biasa."""
    files = storage.DATA_DIR.glob(f"{ARCHIVE_TABLE_PREFIX}_*.json")
    names = (f.stem for f in files if f.stem != ARCHIVE_INDEX_TABLE)
    return sorted(names, reverse=True)


def archive_old_logs(retention_months: Optional[int] = None) -> dict:
    """
    [Tahap 4 - retensi] Pindahkan entri qa_audit_log yang lebih tua dari
    `retention_months` bulan (default RETENTION_MONTHS_DEFAULT, diatur
    lewat env TAX_QA_LOG_RETENTION_MONTHS) ke tabel arsip bulanan
    (qa_audit_log_archive_YYYY_MM), supaya tabel aktif tetap kecil.

    Idempotent -- aman dipanggil berulang kali. Entri yang sudah
    diarsipkan tidak akan diarsipkan lagi karena sudah tidak ada lagi di
    tabel aktif saat fungsi ini dipanggil lagi. Cocok dipanggil manual
    lewat endpoint admin (lihat tax_router.py: POST /tax/qa-log/archive)
    atau dijadwalkan berkala (mis. lewat modules/tax_scheduler.py).

    Entri tanpa created_at yang valid TIDAK diarsipkan (dibiarkan di
    tabel aktif) -- lebih aman salah "diam di tempat lama" daripada
    salah "hilang" ke tabel arsip yang keliru/tidak bisa ditelusuri lagi.

    [FIX - race condition] Versi sebelumnya membaca tabel aktif SEKALI di
    awal, lalu di akhir MENIMPA SELURUH tabel aktif dengan hasil olahan
    dari snapshot lama itu -- kalau ada log_qa() baru masuk di
    tengah-tengah proses arsip (yang bisa makan waktu, karena menulis
    beberapa partisi arsip), entri baru itu ikut TERTIMPA/HILANG karena
    tidak ada di snapshot lama. Ini persis masalah "lost update" yang
    modules/storage.py sendiri sudah tangani untuk operasi 1-record
    (lihat upsert()/delete() di sana), tapi belum konsisten diterapkan di
    level operasi BANYAK-record seperti ini.

    Sekarang: tabel aktif hanya dibaca untuk MEMUTUSKAN id mana yang
    layak diarsipkan (tidak masalah kalau snapshot ini agak basi -- itu
    cuma memengaruhi id mana yang KITA proses kali ini, bukan
    kebenarannya). Penghapusan dari tabel aktif memakai
    storage.delete_many(), yang membaca tabel FRESH tepat sebelum
    menghapus dan HANYA menghapus id yang eksplisit kita minta -- entri
    baru yang masuk di tengah proses (dengan id berbeda) tidak pernah
    disentuh sama sekali.

    Urutan penulisan tetap disengaja: partisi ARSIP + INDEX ditulis dulu,
    tabel AKTIF dibersihkan PALING TERAKHIR. Kalau proses gagal di tengah
    jalan (mis. disk penuh), entri lama paling buruk DUPLIKAT (masih ada
    di tabel aktif + sudah ada di arsip) -- aman dijalankan ulang,
    idempotent -- bukan HILANG dari keduanya.
    """
    months = RETENTION_MONTHS_DEFAULT if retention_months is None else retention_months
    if months < 0:
        raise ValueError(f"retention_months tidak boleh negatif, dapat: {months}")
    cutoff = _months_ago(months)

    active = storage.read_table(TABLE)  # snapshot -- lihat catatan FIX di atas
    to_archive: Dict[str, Dict[str, Any]] = {}  # arch_table -> {id: record}
    for entry_id, record in active.items():
        dt = _parse_created_at(record)
        if dt is None or dt >= cutoff:
            continue
        arch_table = _archive_table_for(dt)
        to_archive.setdefault(arch_table, {})[entry_id] = record

    if not to_archive:
        logger.info(f"Arsip qa_audit_log: tidak ada entri lebih tua dari {cutoff.isoformat()}")
        return {"archived": 0, "tabel_arsip": [], "cutoff": cutoff.isoformat()}

    archived_ids: List[str] = []
    tabel_tersentuh: List[str] = []
    index_updates: Dict[str, Dict[str, str]] = {}
    try:
        for arch_table, entries in to_archive.items():
            storage.upsert_many(arch_table, entries)
            tabel_tersentuh.append(arch_table)
            for entry_id in entries:
                archived_ids.append(entry_id)
                index_updates[entry_id] = {"table": arch_table}

        # Index ditulis SEBELUM entri dihapus dari tabel aktif -- kalau
        # proses gagal PERSIS di sini, get_log() masih menemukan entri
        # lewat tabel aktif (belum terhapus), tidak pernah kehilangan
        # jejak walau index belum lengkap.
        storage.upsert_many(ARCHIVE_INDEX_TABLE, index_updates)

        # Baru sekarang hapus dari tabel aktif -- lihat penjelasan FIX di
        # docstring: delete_many() aman terhadap entri baru yang masuk
        # konkuren selama proses ini berjalan.
        removed = storage.delete_many(TABLE, archived_ids)
    except Exception:
        logger.exception(
            "Gagal mengarsipkan qa_audit_log -- entri yang belum sempat "
            "dipindah tetap ada di tabel aktif, aman dijalankan ulang."
        )
        raise

    if removed != len(archived_ids):
        # BUKAN error -- kemungkinan besar proses lain (mis. archive_old_logs()
        # lain berjalan konkuren, atau retry dari kegagalan sebelumnya) sudah
        # menghapus sebagian id yang sama lebih dulu. Datanya tetap aman di
        # tabel arsip; ini cuma catatan untuk observability.
        logger.warning(
            f"archive_old_logs: {len(archived_ids)} id ditandai untuk "
            f"diarsipkan, tapi cuma {removed} yang masih ada & terhapus dari "
            f"tabel aktif (selisih kemungkinan sudah diproses konkuren oleh "
            f"pemanggilan lain -- datanya tetap aman di tabel arsip)."
        )

    logger.info(
        f"Arsip qa_audit_log: {len(archived_ids)} entri dipindah ke "
        f"{tabel_tersentuh} (cutoff={cutoff.isoformat()})"
    )
    return {
        "archived": len(archived_ids),
        "tabel_arsip": tabel_tersentuh,
        "cutoff": cutoff.isoformat(),
    }


def rebuild_archive_index() -> dict:
    """
    [Tahap 4 - retensi] Bangun ulang qa_audit_log_index dari NOL dengan
    men-scan seluruh tabel arsip yang ada di disk.

    Berguna untuk dua situasi:
    (a) MIGRASI -- kalau backend sempat menjalankan versi archive_old_logs()
        lama (sebelum index ini ditambahkan), entri yang sudah terlanjur
        diarsipkan TIDAK punya entri index. get_log() tetap akan
        menemukannya lewat fallback scan manual (lebih lambat, lihat
        get_log() di bawah), tapi jalankan fungsi ini sekali setelah
        upgrade supaya lookup berikutnya cepat lagi.
    (b) RECOVERY -- kalau index dicurigai tidak sinkron/korup (mis. file
        qa_audit_log_index.json terhapus manual secara tidak sengaja).

    AMAN dijalankan berulang kali & sambil sistem tetap berjalan --
    ini cuma MEMBACA tabel arsip (tidak pernah menulis/menghapus data
    Q&A apa pun) dan menimpa index dengan hasil scan terbaru.
    """
    tabel_arsip = _list_archive_tables()
    index: Dict[str, Dict[str, str]] = {}
    for arch_table in tabel_arsip:
        for entry_id in storage.read_table(arch_table).keys():
            index[entry_id] = {"table": arch_table}

    if index:
        # Timpa index secara PENUH (bukan upsert_many biasa yang cuma
        # menambah/menimpa key yang dikirim) -- kalau ada entri arsip yang
        # sudah tidak ada lagi (mis. tabel arsipnya dihapus manual), entri
        # index basi untuknya juga harus ikut hilang, bukan tertinggal.
        storage.write_table(ARCHIVE_INDEX_TABLE, index)
    else:
        storage.write_table(ARCHIVE_INDEX_TABLE, {})

    logger.info(
        f"rebuild_archive_index: {len(index)} entri diindeks dari "
        f"{len(tabel_arsip)} tabel arsip."
    )
    return {"total_diindeks": len(index), "jumlah_tabel_arsip": len(tabel_arsip)}


def log_qa(
    question: str,
    answer: str,
    sumber: list[dict],
    top_k: int,
    status_warning_count: int = 0,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
) -> str:
    """
    Simpan satu entri audit Q&A. Selalu dipanggil dari ask_tax_question(),
    di KEDUA jalur return (baik ada hasil retrieval maupun tidak) --
    supaya pertanyaan yang "gagal dijawab karena dokumen belum ada" pun
    tetap tercatat (penting untuk tahu jenis pajak apa yang paling sering
    ditanya tapi belum ter-cover di database).

    Return entry_id (string) supaya caller bisa, kalau perlu, menaut ID
    ini ke fitur lain (mis. modules/tax_history.py atau feedback.py).
    """
    entry_id = str(uuid.uuid4())
    record = {
        "id": entry_id,
        "question": question,
        "answer": answer,
        "sumber": sumber,
        "top_k": top_k,
        "num_sources": len(sumber),
        "status_warning_count": status_warning_count,
        "user_id": user_id,
        "client_id": client_id,
        "created_at": datetime.utcnow().isoformat(),
    }
    try:
        storage.upsert(TABLE, entry_id, record)
    except Exception:
        # Sengaja except Exception yang luas + exception() (bukan error())
        # supaya traceback lengkap masuk log teknis, tapi ask_tax_question()
        # tetap bisa lanjut mengembalikan jawaban ke user.
        logger.exception(f"Gagal menyimpan QA audit log id={entry_id}")
    else:
        logger.info(
            f"QA logged id={entry_id} user={user_id} client={client_id} "
            f"sumber={len(sumber)} peringatan_status={status_warning_count}"
        )
    return entry_id


def get_log(entry_id: str) -> Optional[dict]:
    """Cari entri di tabel aktif dulu; kalau tidak ada (kemungkinan sudah
    dipindah oleh archive_old_logs()), lanjut cari lewat qa_audit_log_index
    (cepat -- langsung tahu tabel arsip mana tanpa perlu buka semua file).

    Kalau index tidak punya entrinya (mis. diarsipkan oleh versi lama
    sebelum index ada, atau index tidak sinkron), fallback ke scan manual
    semua tabel arsip -- lebih lambat, tapi tetap BENAR, dan hasilnya
    dicatat sebagai warning supaya ketahuan kalau index perlu dibangun
    ulang lewat rebuild_archive_index()."""
    record = storage.get(TABLE, entry_id)
    if record is not None:
        return record

    index_entry = storage.get(ARCHIVE_INDEX_TABLE, entry_id)
    if index_entry:
        arch_table = index_entry.get("table")
        if arch_table:
            record = storage.get(arch_table, entry_id)
            if record is not None:
                return record
            logger.warning(
                f"get_log: index menunjuk id={entry_id} ke tabel "
                f"{arch_table}, tapi entrinya tidak ada di sana -- index "
                f"kemungkinan basi. Lanjut ke scan manual, pertimbangkan "
                f"menjalankan rebuild_archive_index()."
            )

    for arch_table in _list_archive_tables():
        record = storage.get(arch_table, entry_id)
        if record is not None:
            logger.warning(
                f"get_log: id={entry_id} ditemukan lewat scan manual di "
                f"{arch_table}, bukan lewat index -- pertimbangkan "
                f"menjalankan rebuild_archive_index() supaya lookup "
                f"berikutnya lebih cepat."
            )
            return record
    return None


def list_logs(
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 50,
    include_archived: bool = False,
) -> list[dict]:
    """Ambil entri terbaru dulu (descending created_at), opsional difilter
    per user/client -- dipakai untuk laporan audit & review kualitas.

    include_archived=False (default): hanya baca tabel aktif -- ini yang
    dipakai untuk pemakaian sehari-hari (mis. spot-check terbaru), supaya
    tetap cepat walau ada banyak bulan arsip menumpuk.

    include_archived=True: tabel aktif + SEMUA tabel arsip ikut dibaca --
    lebih lambat (baca banyak file), dipakai untuk laporan audit
    menyeluruh (mis. "semua riwayat client X sejak awal"), bukan untuk
    tampilan rutin.
    """
    records: list[dict] = list(storage.list_all(TABLE))
    if include_archived:
        for arch_table in _list_archive_tables():
            records.extend(storage.list_all(arch_table))
    if user_id:
        records = [r for r in records if r.get("user_id") == user_id]
    if client_id:
        records = [r for r in records if r.get("client_id") == client_id]
    # `or ""` (bukan cuma default di .get()) sengaja dipakai -- kalau
    # created_at ADA sebagai key tapi nilainya None (bukan hilang), .get()
    # dengan default tidak akan kepakai, dan sort() akan crash (TypeError)
    # karena membandingkan None dengan str di entri lain.
    records.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return records[:limit]


def count_by_status_warning(include_archived: bool = False) -> dict:
    """
    Ringkasan cepat: berapa banyak pertanyaan yang jawabannya memicu
    peringatan status (dicabut/diubah) vs tidak -- indikator kesehatan
    database (kalau angkanya tinggi terus, berarti banyak dokumen basi
    yang masih sering ke-retrieve, mungkin perlu di-update_status()).

    include_archived=False (default): cuma tabel aktif -- cukup untuk
    pantauan rutin karena data terbaru selalu ada di tabel aktif.
    include_archived=True: ikut hitung seluruh arsip, untuk laporan
    jangka panjang.
    """
    records: list[dict] = list(storage.list_all(TABLE))
    if include_archived:
        for arch_table in _list_archive_tables():
            records.extend(storage.list_all(arch_table))
    total = len(records)
    dengan_peringatan = sum(1 for r in records if r.get("status_warning_count", 0) > 0)
    return {
        "total_pertanyaan": total,
        "dengan_peringatan_status": dengan_peringatan,
        "tanpa_peringatan_status": total - dengan_peringatan,
    }