"""
tests/test_tax_qa_log_archive.py
[Tahap 4 - retensi] Test untuk mekanisme arsip/rotasi qa_audit_log
(modules/tax_qa_log.py: archive_old_logs, get_log, list_logs,
count_by_status_warning).

Memakai fixture tmp_path + monkeypatch TAX_DATA_DIR + importlib.reload(),
pola yang sama seperti test_tax_rag_citation.py -- supaya modules.storage
(dan tax_qa_log yang bergantung padanya) memakai folder data sementara,
bukan ./data sungguhan.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timedelta

import pytest


@pytest.fixture
def qa_log_module(tmp_path, monkeypatch):
    monkeypatch.setenv("TAX_DATA_DIR", str(tmp_path))

    from modules import storage as storage_module
    importlib.reload(storage_module)

    from modules import tax_qa_log as qa_log_module
    importlib.reload(qa_log_module)

    return qa_log_module


def _seed(module, entry_id: str, created_at, user_id="u1", client_id=None,
          status_warning_count: int = 0):
    from modules import storage
    record = {
        "id": entry_id,
        "question": f"pertanyaan-{entry_id}",
        "answer": "jawaban",
        "sumber": [],
        "top_k": 5,
        "num_sources": 0,
        "status_warning_count": status_warning_count,
        "user_id": user_id,
        "client_id": client_id,
        "created_at": created_at.isoformat() if created_at else None,
    }
    storage.upsert(module.TABLE, entry_id, record)


def test_archive_moves_only_entries_older_than_retention(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))   # ~6.5 bulan
    _seed(qa_log_module, "baru", now - timedelta(days=10))

    result = qa_log_module.archive_old_logs(retention_months=6)

    assert result["archived"] == 1
    from modules import storage
    aktif = storage.list_all(qa_log_module.TABLE)
    assert {r["id"] for r in aktif} == {"baru"}


def test_archive_partitions_by_month(qa_log_module):
    now = datetime.utcnow()
    # Dua entri lama di bulan kalender yang berbeda harus masuk ke dua
    # tabel arsip terpisah.
    _seed(qa_log_module, "bulan-a-1", now - timedelta(days=200))
    _seed(qa_log_module, "bulan-a-2", now - timedelta(days=205))
    _seed(qa_log_module, "bulan-b", now - timedelta(days=260))

    result = qa_log_module.archive_old_logs(retention_months=6)

    assert result["archived"] == 3
    assert len(result["tabel_arsip"]) == 2


def test_archive_skips_entries_without_valid_created_at(qa_log_module):
    _seed(qa_log_module, "tanpa-tanggal", None)

    result = qa_log_module.archive_old_logs(retention_months=6)

    assert result["archived"] == 0
    from modules import storage
    assert "tanpa-tanggal" in storage.read_table(qa_log_module.TABLE)


def test_archive_is_idempotent(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))

    first = qa_log_module.archive_old_logs(retention_months=6)
    second = qa_log_module.archive_old_logs(retention_months=6)

    assert first["archived"] == 1
    assert second["archived"] == 0
    assert second["tabel_arsip"] == []


def test_get_log_finds_archived_entry(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    # Tidak lagi di tabel aktif...
    from modules import storage
    assert storage.get(qa_log_module.TABLE, "lama") is None
    # ...tapi get_log() tetap menemukannya lewat fallback ke tabel arsip.
    found = qa_log_module.get_log("lama")
    assert found is not None
    assert found["id"] == "lama"


def test_get_log_returns_none_for_unknown_id(qa_log_module):
    assert qa_log_module.get_log("tidak-ada") is None


def test_list_logs_default_excludes_archived(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    _seed(qa_log_module, "baru", now - timedelta(days=10))
    qa_log_module.archive_old_logs(retention_months=6)

    default_ids = {r["id"] for r in qa_log_module.list_logs(limit=100)}
    assert default_ids == {"baru"}

    all_ids = {r["id"] for r in qa_log_module.list_logs(limit=100, include_archived=True)}
    assert all_ids == {"lama", "baru"}


def test_list_logs_sort_does_not_crash_with_null_created_at(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "ada-tanggal", now - timedelta(days=1))
    _seed(qa_log_module, "tanpa-tanggal", None)

    # Sebelumnya, mencampur created_at bertipe None dengan str di
    # sort() melempar TypeError -- ini regression test untuk itu.
    hasil = qa_log_module.list_logs(limit=100)
    assert {r["id"] for r in hasil} == {"ada-tanggal", "tanpa-tanggal"}


def test_count_by_status_warning_respects_include_archived(qa_log_module):
    now = datetime.utcnow()
    _seed(qa_log_module, "lama-warn", now - timedelta(days=200), status_warning_count=2)
    _seed(qa_log_module, "baru", now - timedelta(days=10), status_warning_count=0)
    qa_log_module.archive_old_logs(retention_months=6)

    hanya_aktif = qa_log_module.count_by_status_warning()
    assert hanya_aktif["total_pertanyaan"] == 1
    assert hanya_aktif["dengan_peringatan_status"] == 0

    termasuk_arsip = qa_log_module.count_by_status_warning(include_archived=True)
    assert termasuk_arsip["total_pertanyaan"] == 2
    assert termasuk_arsip["dengan_peringatan_status"] == 1


def test_retention_months_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TAX_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TAX_QA_LOG_RETENTION_MONTHS", "1")

    from modules import storage as storage_module
    importlib.reload(storage_module)
    from modules import tax_qa_log as module
    importlib.reload(module)

    assert module.RETENTION_MONTHS_DEFAULT == 1

    now = datetime.utcnow()
    _seed(module, "lebih-dari-1-bulan", now - timedelta(days=45))
    _seed(module, "kurang-dari-1-bulan", now - timedelta(days=10))

    result = module.archive_old_logs()  # pakai default dari env, bukan diisi manual
    assert result["archived"] == 1


# --- [FIX] Regression test untuk race condition ----------------------------

def test_archive_does_not_lose_concurrent_insert(qa_log_module, monkeypatch):
    """
    Regression test untuk bug lost-update: versi archive_old_logs() yang
    LAMA membaca tabel aktif sekali, lalu di akhir MENIMPA SELURUH tabel
    dengan hasil olahan snapshot lama itu -- entri baru yang masuk di
    tengah proses arsip akan HILANG. Test ini mensimulasikan tepat
    skenario itu: entri baru "disisipkan" persis setelah archive_old_logs()
    mengambil snapshot pertamanya, lalu dipastikan entri itu TETAP ADA
    setelah proses arsip selesai.
    """
    from modules import storage

    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))

    original_read_table = storage.read_table
    state = {"sudah_disisip": False}

    def read_table_dengan_race(table):
        hasil = original_read_table(table)
        if table == qa_log_module.TABLE and not state["sudah_disisip"]:
            state["sudah_disisip"] = True
            # Simulasikan staf lain bertanya (log_qa) TEPAT SETELAH
            # archive_old_logs() mengambil snapshot tabel aktif.
            _seed(qa_log_module, "masuk-selagi-arsip-berjalan", now - timedelta(days=1))
        return hasil

    monkeypatch.setattr(storage, "read_table", read_table_dengan_race)

    result = qa_log_module.archive_old_logs(retention_months=6)
    assert result["archived"] == 1  # cuma "lama" yang diarsipkan

    aktif_sesudah = {r["id"] for r in storage.list_all(qa_log_module.TABLE)}
    # Entri yang masuk konkuren HARUS tetap ada -- inilah inti fix-nya.
    assert "masuk-selagi-arsip-berjalan" in aktif_sesudah
    assert "lama" not in aktif_sesudah


# --- [FIX] Index arsip ------------------------------------------------------

def test_archive_creates_index_entries(qa_log_module):
    from modules import storage

    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    result = qa_log_module.archive_old_logs(retention_months=6)

    index = storage.read_table(qa_log_module.ARCHIVE_INDEX_TABLE)
    assert "lama" in index
    assert index["lama"]["table"] in result["tabel_arsip"]


def test_index_table_never_treated_as_archive_partition(qa_log_module):
    """
    Regression test: nama tabel index (qa_audit_log_index) dan pola glob
    yang dipakai _list_archive_tables() (qa_audit_log_archive_*) harus
    TIDAK PERNAH tumpang tindih -- kalau sampai tertangkap, get_log() bisa
    salah mengembalikan isi index (dict {"table": ...}) seolah itu record
    Q&A asli.
    """
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    tabel_arsip = qa_log_module._list_archive_tables()
    assert qa_log_module.ARCHIVE_INDEX_TABLE not in tabel_arsip


def test_get_log_uses_index_without_needing_full_scan(qa_log_module, monkeypatch):
    """Kalau index tersedia & benar, get_log() tidak perlu menyentuh
    _list_archive_tables() sama sekali (lookup langsung lewat index)."""
    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    dipanggil = {"n": 0}
    asli = qa_log_module._list_archive_tables

    def spy():
        dipanggil["n"] += 1
        return asli()

    monkeypatch.setattr(qa_log_module, "_list_archive_tables", spy)

    hasil = qa_log_module.get_log("lama")
    assert hasil is not None
    assert dipanggil["n"] == 0  # index cukup, tidak perlu scan manual


def test_get_log_self_heals_when_index_is_stale(qa_log_module):
    """Kalau index menunjuk ke tabel yang salah/basi, get_log() tetap
    harus BENAR lewat fallback scan manual, bukan malah gagal."""
    from modules import storage

    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    # Rusak index secara sengaja -- arahkan ke tabel yang tidak ada.
    storage.upsert(
        qa_log_module.ARCHIVE_INDEX_TABLE, "lama", {"table": "tabel_tidak_ada"}
    )

    hasil = qa_log_module.get_log("lama")
    assert hasil is not None
    assert hasil["id"] == "lama"


def test_get_log_missing_index_entry_falls_back_to_scan(qa_log_module):
    """Simulasikan entri yang diarsipkan oleh 'versi lama' (sebelum index
    ada) -- tidak ada di index sama sekali, tapi get_log() tetap harus
    menemukannya lewat scan manual."""
    from modules import storage

    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    # Hapus entri index-nya, mensimulasikan data arsip dari versi lama.
    index = storage.read_table(qa_log_module.ARCHIVE_INDEX_TABLE)
    del index["lama"]
    storage.write_table(qa_log_module.ARCHIVE_INDEX_TABLE, index)

    hasil = qa_log_module.get_log("lama")
    assert hasil is not None
    assert hasil["id"] == "lama"


def test_rebuild_archive_index(qa_log_module):
    from modules import storage

    now = datetime.utcnow()
    _seed(qa_log_module, "lama", now - timedelta(days=200))
    qa_log_module.archive_old_logs(retention_months=6)

    # Hapus index sepenuhnya, lalu bangun ulang.
    storage.write_table(qa_log_module.ARCHIVE_INDEX_TABLE, {})
    hasil_rebuild = qa_log_module.rebuild_archive_index()

    assert hasil_rebuild["total_diindeks"] == 1
    index = storage.read_table(qa_log_module.ARCHIVE_INDEX_TABLE)
    assert "lama" in index

    # get_log() harus bisa pakai index yang baru dibangun ulang ini.
    assert qa_log_module.get_log("lama") is not None


def test_rebuild_archive_index_with_no_archives_yet(qa_log_module):
    """Tidak boleh error kalau belum pernah ada arsip sama sekali."""
    hasil = qa_log_module.rebuild_archive_index()
    assert hasil == {"total_diindeks": 0, "jumlah_tabel_arsip": 0}


# --- [FIX] Validasi input ---------------------------------------------------

def test_archive_rejects_negative_retention(qa_log_module):
    with pytest.raises(ValueError):
        qa_log_module.archive_old_logs(retention_months=-1)


# --- storage.py: upsert_many / delete_many ---------------------------------

def test_storage_upsert_many_and_delete_many(tmp_path, monkeypatch):
    monkeypatch.setenv("TAX_DATA_DIR", str(tmp_path))
    from modules import storage as storage_module
    importlib.reload(storage_module)

    storage_module.upsert_many("t", {"a": {"v": 1}, "b": {"v": 2}})
    assert storage_module.list_all("t")
    assert {r["v"] for r in storage_module.list_all("t")} == {1, 2}

    # upsert_many dengan dict kosong tidak boleh menyentuh file sama sekali
    storage_module.upsert_many("t", {})
    assert len(storage_module.list_all("t")) == 2

    dihapus = storage_module.delete_many("t", ["a", "id-tidak-ada"])
    assert dihapus == 1  # cuma "a" yang benar-benar ada & terhapus
    assert set(storage_module.read_table("t").keys()) == {"b"}

    # delete_many dengan list kosong tidak boleh error & tidak mengubah apa pun
    assert storage_module.delete_many("t", []) == 0
    assert set(storage_module.read_table("t").keys()) == {"b"}


# --- Stress test konkurensi SUNGGUHAN (bukan simulasi) ---------------------

def test_concurrent_writes_and_archiving_no_data_loss(qa_log_module):
    """
    Validasi paling ketat: banyak THREAD SUNGGUHAN menulis log baru
    (meniru log_qa() dipanggil banyak staf bersamaan) SAMBIL beberapa
    thread lain menjalankan archive_old_logs() berkali-kali secara
    bersamaan -- bukan simulasi lewat monkeypatch seperti test race
    condition di atas, tapi benar-benar memakai threading.Thread +
    FileLock/threading.Lock sungguhan dari modules/storage.py.

    Yang diverifikasi di akhir: SETIAP entri yang berhasil ditulis (baik
    yang lama maupun yang baru) harus ketemu di SALAH SATU tempat (tabel
    aktif atau salah satu tabel arsip) -- tidak boleh ada yang hilang
    dari keduanya, dan tidak boleh ada exception yang terlempar dari
    thread mana pun selama proses berlangsung.
    """
    import threading

    from modules import storage

    now = datetime.utcnow()
    old_ids = [f"old-{i}" for i in range(5)]
    new_ids = [f"new-{i}" for i in range(30)]

    for oid in old_ids:
        _seed(qa_log_module, oid, now - timedelta(days=200))

    errors: list = []

    def inserter(entry_id: str) -> None:
        try:
            _seed(qa_log_module, entry_id, now - timedelta(days=1))
        except Exception as e:  # pragma: no cover - dilaporkan lewat assert di bawah
            errors.append(e)

    def archiver() -> None:
        try:
            qa_log_module.archive_old_logs(retention_months=6)
        except Exception as e:  # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=inserter, args=(eid,)) for eid in new_ids]
    threads += [threading.Thread(target=archiver) for _ in range(5)]

    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)
        assert not t.is_alive(), "Thread tidak selesai dalam batas waktu (kemungkinan deadlock)"

    assert not errors, f"Ada exception yang terlempar saat konkuren: {errors}"

    # Sapuan terakhir supaya semua entri lama (yang mungkin baru masuk di
    # akhir race dari archiver-archiver sebelumnya) pasti sudah diarsipkan.
    qa_log_module.archive_old_logs(retention_months=6)

    aktif = {r["id"] for r in storage.list_all(qa_log_module.TABLE)}
    arsip: set = set()
    for t in qa_log_module._list_archive_tables():
        arsip |= {r["id"] for r in storage.list_all(t)}

    diharapkan = set(old_ids) | set(new_ids)
    ditemukan = aktif | arsip
    assert ditemukan == diharapkan, f"Data hilang: {diharapkan - ditemukan}"
    assert set(old_ids).issubset(arsip), "Entri lama seharusnya berakhir di arsip"
    assert set(new_ids).issubset(aktif), "Entri baru (belum lewat retensi) seharusnya masih di tabel aktif"