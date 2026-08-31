"""
modules/tax_case_ingestion.py
Pipeline memasukkan putusan pengadilan pajak ke sistem:
simpan metadata kasus -> pecah teks jadi chunk -> buat embedding ->
simpan ke vector store (ditaut ke case_id) -> ekstrak fitur kasus.

CATATAN PENTING: fungsi ini butuh field `case_id` di
modules.tax_chunker.RegulationMetadata supaya tiap chunk bisa ditelusuri
balik ke kasus asalnya (dipakai modules/tax_prediction.py). Lihat catatan
di akhir pesan untuk tambahan 1 baris di tax_chunker.py.
"""
from __future__ import annotations

from typing import Optional

from modules.schemas import CourtCase
from modules.tax_chunker import RegulationMetadata, chunk_document
from modules.embedding import embed_texts
from modules.vector_store import default_store
from modules import tax_case_law
from modules.tax_case_features import extract_features


def ingest_case(
    nomor_putusan: str,
    pengadilan: str,
    full_text: str,
    ringkasan: str = "",
    jenis_sengketa: Optional[str] = None,
    amar_putusan: Optional[str] = None,
    **kwargs,
) -> CourtCase:
    """Simpan satu putusan lengkap ke case law store + index ke vector store."""
    case = tax_case_law.create_case(
        nomor_putusan=nomor_putusan,
        pengadilan=pengadilan,
        ringkasan=ringkasan,
        full_text=full_text,
        jenis_sengketa=jenis_sengketa,
        amar_putusan=amar_putusan,
        **kwargs,
    )

    _index_case_text(case)
    extract_features(case)

    return case


def _index_case_text(case: CourtCase) -> None:
    # [FIX Tahap 0.1] chunk_document() selalu bikin id baru tiap dipanggil,
    # jadi PersistentVectorStore.add() tidak pernah nimpa chunk lama milik
    # case ini -- tanpa baris ini, tiap reindex_case() dipanggil ulang
    # (mis. setelah teks putusan direvisi, atau nanti setelah embedding/
    # chunker diganti di Tahap 2), chunk lama menumpuk selamanya di
    # samping chunk baru dan AI bisa mengutip potongan teks yang sudah
    # basi/duplikat. Selalu bersihkan dulu, baik case masih ada teksnya
    # atau tidak, supaya tidak ada sisa chunk basi kalau full_text
    # dikosongkan.
    default_store.hapus_by_metadata("case_id", case.id)

    if not case.full_text.strip():
        return

    metadata = RegulationMetadata(
        nomor=case.nomor_putusan,
        jenis="Putusan",
        judul=case.ringkasan or case.nomor_putusan,
        status="berlaku",
        case_id=case.id,
    )
    chunks = chunk_document(case.full_text, metadata)
    if not chunks:
        return

    vectors = embed_texts([c.text for c in chunks])
    for chunk, vector in zip(chunks, vectors):
        default_store.add(chunk, vector.tolist())


def reindex_case(case_id: str) -> Optional[CourtCase]:
    """Panggil ulang indexing untuk kasus yang sudah ada (mis. setelah teks diperbarui)."""
    case = tax_case_law.get_case(case_id)
    if case:
        _index_case_text(case)
    return case