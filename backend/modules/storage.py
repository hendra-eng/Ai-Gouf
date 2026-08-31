"""
modules/storage.py
Persistensi sederhana berbasis file JSON.
File ini BARU (belum ada di daftar awal) - dipakai sebagai "database" versi
standar/dev oleh modul-modul lain (documents, cases, folios, history, dst).
Untuk produksi, ganti isi fungsi di sini dengan PostgreSQL/MongoDB dsb -
tanda tangan fungsi (function signature) di modul lain tidak perlu berubah.

[FIX Tahap 0.3] Dua masalah dibenarkan di sini:

1. Lock sebelumnya (threading.Lock) cuma mencegah race ANTAR-THREAD dalam
   SATU proses Python. Kalau backend dijalankan dengan >1 worker proses
   (uvicorn --workers N, atau beberapa proses gunicorn), tiap proses punya
   threading.Lock sendiri-sendiri yang tidak saling kenal -- dua proses
   bisa baca+tulis file JSON yang sama bersamaan dan saling menimpa data.
   Sekarang pakai FileLock (package `filelock`, cross-platform Windows &
   Linux) yang lock-nya di level filesystem, jadi valid ANTAR PROSES juga.
   Perlu: pip install filelock

2. upsert()/delete() sebelumnya read_table() lalu write_table() sebagai DUA
   operasi lock terpisah -- ada celah waktu di antaranya. Kalau 2 request
   nulis ke tabel yang sama nyaris bersamaan (bisa juga cuma 2 thread dalam
   1 proses, jadi ini relevan WALAU single-worker), yang belakangan bisa
   menimpa balik dengan data lama ("lost update"). Sekarang read+modify+
   write digabung dalam SATU lock scope.

   Ditambah penulisan atomik (tulis ke file .tmp dulu, baru os.replace()
   yang atomik di level OS) supaya kalau proses mati di tengah penulisan,
   file lama tidak ikut korup jadi JSON setengah jadi.

3. [FIX Tahap 4] upsert_many()/delete_many() -- versi batch dari #2 di
   atas, untuk operasi massal (mis. modules/tax_qa_log.py:
   archive_old_logs() yang mengarsipkan banyak entri sekaligus).
   delete_many() KHUSUSNYA membaca tabel FRESH tepat sebelum menghapus,
   supaya operasi arsip/rotasi yang berlangsung lama (baca snapshot ->
   proses -> baru hapus) tidak menimpa balik record baru yang masuk di
   tengah-tengah prosesnya -- caller cukup kirim ID spesifik yang mau
   dihapus, bukan "sisa" dari snapshot lama.

CATATAN: kalau backend-mu selamanya cuma 1 worker, fix #1 murni jaring
pengaman ekstra (biaya kecil). Fix #2 tetap relevan bahkan di 1 worker
karena FastAPI/uvicorn tetap multi-thread untuk request bersamaan.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

from filelock import FileLock

DATA_DIR = Path(os.environ.get("TAX_DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Lock antar-thread dalam 1 proses (cepat, dicek duluan sebelum file lock
# yang lebih mahal karena harus syscall ke filesystem).
_thread_lock = threading.Lock()


def _path(table: str) -> Path:
    return DATA_DIR / f"{table}.json"


def _lockfile_path(table: str) -> Path:
    return DATA_DIR / f"{table}.lock"


def _file_lock(table: str) -> FileLock:
    # timeout=10 -- kalau lock tidak didapat dalam 10 detik (mis. proses lain
    # macet sambil pegang lock), lempar Timeout daripada nge-hang selamanya.
    return FileLock(str(_lockfile_path(table)), timeout=10)


def _read_unlocked(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def _write_unlocked(path: Path, data: Dict[str, Any]) -> None:
    tmp_path = path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    os.replace(tmp_path, path)  # atomik di level OS (Windows & Linux)


def read_table(table: str) -> Dict[str, Any]:
    with _thread_lock, _file_lock(table):
        return _read_unlocked(_path(table))


def write_table(table: str, data: Dict[str, Any]) -> None:
    with _thread_lock, _file_lock(table):
        _write_unlocked(_path(table), data)


def upsert(table: str, record_id: str, record: Dict[str, Any]) -> None:
    path = _path(table)
    with _thread_lock, _file_lock(table):
        data = _read_unlocked(path)
        data[record_id] = record
        _write_unlocked(path, data)


def get(table: str, record_id: str) -> Optional[Dict[str, Any]]:
    return read_table(table).get(record_id)


def delete(table: str, record_id: str) -> bool:
    path = _path(table)
    with _thread_lock, _file_lock(table):
        data = _read_unlocked(path)
        if record_id in data:
            del data[record_id]
            _write_unlocked(path, data)
            return True
        return False


def list_all(table: str) -> List[Dict[str, Any]]:
    return list(read_table(table).values())


def upsert_many(table: str, records: Dict[str, Dict[str, Any]]) -> None:
    """
    [FIX Tahap 4] Simpan BANYAK record dalam SATU lock scope (read+modify+
    write), sama seperti upsert() untuk satu record. Dipakai oleh operasi
    massal seperti modules/tax_qa_log.py: archive_old_logs().

    Kenapa perlu (bukan cuma dipanggil `for r in records: upsert(...)`):
    memanggil upsert() berkali-kali berarti berkali-kali BUKA-TUTUP lock
    terpisah -- kalau ada penulis lain menyisip DI ANTARA dua panggilan
    upsert() tersebut, tidak masalah untuk kebenaran datanya (tiap upsert
    tetap atomik sendiri-sendiri), tapi jadi lebih lambat (N kali lock
    acquire/release untuk N record) dan TIDAK memberi jaminan "semua N
    record ini terlihat sebagai satu perubahan" -- pembaca lain bisa
    melihat status setengah-jadi (baru separuh record ter-upsert). Untuk
    kebutuhan seperti menulis satu partisi arsip sekaligus, itu tidak
    ideal. Fungsi ini menggabungkan semuanya jadi satu baca+tulis.
    """
    if not records:
        return
    path = _path(table)
    with _thread_lock, _file_lock(table):
        data = _read_unlocked(path)
        data.update(records)
        _write_unlocked(path, data)


def delete_many(table: str, record_ids: Iterable[str]) -> int:
    """
    [FIX Tahap 4] Hapus BANYAK record dalam SATU lock scope, dengan
    tabel dibaca ULANG (fresh) tepat sebelum dihapus -- bukan dihapus
    dari snapshot lama yang dibaca caller sebelumnya.

    Ini krusial untuk kebenaran operasi seperti archive_old_logs(): kalau
    caller membaca tabel aktif, memutuskan record mana yang mau
    diarsipkan, lalu (mis. setelah menulis ke tabel arsip yang makan
    waktu) balik lagi untuk MENGHAPUS record yang sudah diarsipkan itu --
    delete_many() di sini membaca ulang tabel PERSIS sebelum menghapus,
    jadi record BARU yang mungkin masuk di antara waktu itu (mis. ada
    staf lain bertanya lewat log_qa() SELAGI proses arsip berjalan) TIDAK
    ikut kehapus, karena kita cuma menghapus ID yang secara eksplisit
    diminta -- bukan menimpa seluruh tabel dengan versi "yang tersisa"
    dari snapshot basi.

    Return: jumlah record yang benar-benar terhapus (bisa lebih kecil
    dari len(record_ids) kalau sebagian ID sudah tidak ada lagi -- mis.
    sudah dihapus/diarsipkan proses lain secara konkuren; itu BUKAN
    error, cuma informasi).
    """
    record_ids = set(record_ids)
    if not record_ids:
        return 0
    path = _path(table)
    with _thread_lock, _file_lock(table):
        data = _read_unlocked(path)
        removed = 0
        for rid in record_ids:
            if rid in data:
                del data[rid]
                removed += 1
        if removed:
            _write_unlocked(path, data)
        return removed


def query(table: str, predicate: Callable[[Dict[str, Any]], bool]) -> List[Dict[str, Any]]:
    return [r for r in list_all(table) if predicate(r)]