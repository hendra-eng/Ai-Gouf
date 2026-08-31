"""
modules/tax_ingestion.py
Pipeline memasukkan dokumen peraturan (UU/PP/PMK/PER/SE) ke sistem:
simpan metadata dokumen -> pecah jadi chunk -> buat embedding ->
simpan ke vector store (ditaut ke document_id).

Untuk putusan pengadilan, pakai modules/tax_case_ingestion.py, bukan
modul ini - keduanya sengaja dipisah karena struktur datanya berbeda
(SourceDocument vs CourtCase).

CATATAN: fungsi ini butuh field `document_id` di
modules.tax_chunker.RegulationMetadata. Lihat catatan di akhir pesan.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from modules.schemas import SourceDocument, DocType, RegulationStatus, TaxCategory
from modules.tax_chunker import RegulationMetadata, chunk_document
from modules.embedding import embed_texts
from modules.vector_store import default_store
from modules.tax_status_tracker import get_status_tracker
from modules import storage

TABLE = "documents"


def ingest_document(
    title: str,
    doc_type: DocType,
    full_text: str,
    nomor: Optional[str] = None,
    tahun: Optional[int] = None,
    url_sumber: Optional[str] = None,
    tanggal_terbit: Optional[datetime] = None,
    kategori_pajak: Optional[TaxCategory] = None,
    status: RegulationStatus = RegulationStatus.BERLAKU,
    status_note: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> SourceDocument:
    """
    [Tahap 3] tanggal_terbit & kategori_pajak ditambahkan supaya dokumen hasil
    batch-ingest (lihat scripts/batch_ingest_pajak.py) punya metadata lengkap
    & bisa ditelusuri balik -- syarat dari Tahap 3 poin 11 di rencana.

    status default tetap BERLAKU (kasus paling umum: kita ingest aturan yang
    sedang berlaku), tapi bisa di-override -- mis. saat batch-ingest sengaja
    memasukkan versi lama sebuah PMK yang sudah "diubah"/"dicabut" untuk
    konteks historis (biar AI tetap bisa jawab "aturan lama begini, sekarang
    diganti begitu" tanpa AI keliru bilang itu masih berlaku).

    `metadata` -- dict bebas (mis. {"pdf_hash": "..."}) dipakai
    batch_ingest_pajak.py untuk cek "apakah PDF ini sudah pernah di-ingest
    dengan isi persis sama" tanpa perlu ekstrak+embed ulang.
    """
    document = SourceDocument(
        id=str(uuid.uuid4()),
        title=title,
        doc_type=doc_type,
        nomor=nomor,
        tahun=tahun,
        url_sumber=url_sumber,
        tanggal_terbit=tanggal_terbit,
        kategori_pajak=kategori_pajak,
        full_text=full_text,
        status=status,
        status_note=status_note,
        metadata=metadata or {},
    )
    storage.upsert(TABLE, document.id, document.model_dump(mode="json"))
    get_status_tracker().set_status(document.id, status, note=status_note)

    _index_document(document)
    return document


def _index_document(document: SourceDocument) -> None:
    # [FIX Tahap 0.1] Sama seperti reindex_case() -- chunk_document() selalu
    # bikin id baru, jadi tanpa baris ini, index ulang dokumen yang sama
    # (mis. lewat reindex_document() di bawah, yang nanti dipakai di Tahap 2
    # setelah embedding.py/tax_chunker.py diganti) akan menumpuk chunk lama
    # + chunk baru selamanya, bukan menggantikannya.
    default_store.hapus_by_metadata("document_id", document.id)

    if not document.full_text.strip():
        return

    metadata = RegulationMetadata(
        nomor=document.nomor or document.id,
        jenis=document.doc_type.value,
        judul=document.title,
        status=document.status.value,
        sumber_url=document.url_sumber,
        document_id=document.id,
    )
    chunks = chunk_document(document.full_text, metadata)
    if not chunks:
        return

    vectors = embed_texts([c.text for c in chunks])
    for chunk, vector in zip(chunks, vectors):
        default_store.add(chunk, vector.tolist())


def reindex_document(document_id: str) -> Optional[SourceDocument]:
    """
    Panggil ulang indexing untuk dokumen yang sudah ada -- dipakai kalau
    full_text-nya diperbarui, atau nanti massal di Tahap 2 setelah
    embedding.py/tax_chunker.py diganti (semua chunk lama harus di-reindex
    karena vector lama tidak cocok lagi dengan model embedding baru).
    Aman dipanggil berkali-kali: _index_document() sudah membersihkan chunk
    lama dulu sebelum index ulang, jadi tidak menumpuk duplikat.
    """
    document = get_document(document_id)
    if document:
        _index_document(document)
    return document


def get_document(document_id: str) -> Optional[SourceDocument]:
    record = storage.get(TABLE, document_id)
    return SourceDocument(**record) if record else None


def find_by_nomor(nomor: str) -> Optional[SourceDocument]:
    """
    [Tahap 3 robustness] Cari dokumen yang sudah ada berdasarkan `nomor`
    (mis. "PMK 168/2023") -- dipakai untuk cek duplikat sebelum ingest.
    Perbandingan case-insensitive & whitespace-trimmed karena staf yang
    mengisi manifest CSV manual gampang beda kapitalisasi/spasi
    ("PMK 168/2023" vs "pmk 168 / 2023 ") padahal maksudnya dokumen yang
    sama persis.
    """
    if not nomor:
        return None
    target = _normalisasi_nomor(nomor)
    records = storage.query(TABLE, lambda r: _normalisasi_nomor(r.get("nomor") or "") == target)
    return SourceDocument(**records[0]) if records else None


def _normalisasi_nomor(nomor: str) -> str:
    return " ".join(nomor.strip().lower().split())


def upsert_document_by_nomor(
    title: str,
    doc_type: DocType,
    full_text: str,
    nomor: str,
    tahun: Optional[int] = None,
    url_sumber: Optional[str] = None,
    tanggal_terbit: Optional[datetime] = None,
    kategori_pajak: Optional[TaxCategory] = None,
    status: RegulationStatus = RegulationStatus.BERLAKU,
    status_note: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> tuple[SourceDocument, bool]:
    """
    [Tahap 3 robustness] Idempotent version dari ingest_document(): kalau
    sudah ada dokumen dengan `nomor` yang sama, TIMPA record & chunk-nya
    (bukan bikin dokumen baru) -- supaya menjalankan ulang manifest yang
    sama (mis. karena batch sebelumnya crash di tengah, atau staf sengaja
    re-run setelah PDF diganti versi yang lebih bersih) tidak pernah
    menghasilkan duplikat di database maupun di vector store.

    Return (document, is_baru) -- is_baru=False berarti ini update dari
    dokumen yang sudah ada sebelumnya (berguna untuk laporan batch, biar
    staf tahu mana yang benar-benar baru vs cuma di-refresh).
    """
    existing = find_by_nomor(nomor)
    is_baru = existing is None
    document_id = existing.id if existing else str(uuid.uuid4())
    # [Tahap 5] existing.digantikan_oleh dipertahankan kalau sudah ada --
    # upsert_document_by_nomor() dipakai untuk refresh dokumen yang SAMA
    # (nomor tidak berubah), bukan untuk menandai penggantian oleh dokumen
    # LAIN -- itu urusan tandai_digantikan() di bawah. Tanpa baris ini,
    # refresh manifest biasa (mis. PDF diganti versi lebih bersih) akan
    # diam-diam menghapus tautan penggantian yang sudah pernah diset.
    digantikan_oleh = existing.digantikan_oleh if existing else None

    document = SourceDocument(
        id=document_id,
        title=title,
        doc_type=doc_type,
        nomor=nomor,
        tahun=tahun,
        url_sumber=url_sumber,
        tanggal_terbit=tanggal_terbit,
        kategori_pajak=kategori_pajak,
        full_text=full_text,
        status=status,
        status_note=status_note,
        metadata=metadata or {},
        digantikan_oleh=digantikan_oleh,
    )
    storage.upsert(TABLE, document.id, document.model_dump(mode="json"))
    get_status_tracker().set_status(document.id, status, note=status_note)

    _index_document(document)  # sudah bersihkan chunk lama dulu (lihat _index_document)
    return document, is_baru


def list_documents(doc_type: Optional[DocType] = None):
    if doc_type:
        records = storage.query(TABLE, lambda r: r.get("doc_type") == doc_type.value)
    else:
        records = storage.list_all(TABLE)
    return [SourceDocument(**r) for r in records]


def update_status(document_id: str, status: RegulationStatus, note: Optional[str] = None) -> None:
    """Perbarui status peraturan (mis. saat DJP mencabut/mengubah aturan)."""
    record = storage.get(TABLE, document_id)
    if not record:
        return
    record["status"] = status.value
    storage.upsert(TABLE, document_id, record)
    get_status_tracker().set_status(document_id, status, note=note)


def tandai_digantikan(
    document_id_lama: str,
    document_id_baru: str,
    status_baru: RegulationStatus = RegulationStatus.DICABUT,
    note: Optional[str] = None,
) -> Optional[SourceDocument]:
    """
    [Tahap 5, poin 16] Tandai bahwa `document_id_lama` sudah DIGANTIKAN oleh
    `document_id_baru` -- dipanggil dari proses update bulanan (lihat
    scripts/batch_ingest_pajak.py, kolom manifest opsional `mencabut_nomor`
    / `status_lama`) begitu staf mengonfirmasi ada PMK/PER baru yang
    mencabut atau mengubah aturan lama.

    Ini melakukan DUA hal sekaligus, supaya keduanya selalu konsisten (tidak
    pernah status ter-update tapi link pengganti ketinggalan, atau sebaliknya):
      1. update_status(document_id_lama, status_baru, note) -- perilaku lama
         tetap sama persis seperti sebelumnya (RegulationStatus tersimpan di
         record dokumen + di tax_status_tracker, yang jadi sumber kebenaran
         status TERKINI dipakai tax_rag.py -- lihat _status_terkini() di sana).
      2. Set document_id_lama.digantikan_oleh = document_id_baru, supaya
         tax_rag.py bisa menampilkan "digantikan oleh <nomor dokumen baru>"
         di peringatan, bukan cuma "berstatus DICABUT" tanpa konteks apa
         penggantinya -- jauh lebih berguna buat akuntan yang baca jawaban AI.

    Sengaja TIDAK memvalidasi bahwa document_id_baru benar-benar ada di
    database (mis. kalau typo document_id) -- kalau id itu keliru, konsumen
    di sisi tax_rag.py (lewat get_document()) cukup dapat None dan diam-diam
    tidak menampilkan info pengganti (fallback aman), bukan meledakkan
    seluruh proses batch update yang sedang memproses banyak baris lain.
    Kalau perlu validasi ketat, cek balik hasil get_document(document_id_baru)
    di sisi pemanggil sebelum memanggil fungsi ini.

    document_id_lama yang tidak ditemukan -> tidak melakukan apa-apa,
    return None (konsisten dengan update_status() yang juga diam-diam
    no-op kalau record tidak ada).
    """
    record = storage.get(TABLE, document_id_lama)
    if not record:
        return None

    record["status"] = status_baru.value
    record["digantikan_oleh"] = document_id_baru
    storage.upsert(TABLE, document_id_lama, record)
    get_status_tracker().set_status(document_id_lama, status_baru, note=note)

    return SourceDocument(**record)