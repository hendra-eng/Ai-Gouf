"""
tests/test_tax_chunker.py
Uji dasar untuk modules/tax_chunker.py.
"""
from modules.tax_chunker import RegulationMetadata, chunk_document


def _metadata(**overrides):
    base = dict(nomor="PMK 168/2023", jenis="PMK", judul="Contoh Peraturan")
    base.update(overrides)
    return RegulationMetadata(**base)


def test_chunk_document_splits_long_text():
    text = "a" * 2500
    chunks = chunk_document(text, _metadata(), max_chars=1000, overlap=150)

    assert len(chunks) >= 3
    assert all(len(c.text) <= 1000 for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_chunk_document_short_text_single_chunk():
    text = "Ini teks pendek."
    chunks = chunk_document(text, _metadata(), max_chars=1000, overlap=150)

    assert len(chunks) == 1
    assert chunks[0].text == text


def test_chunk_document_empty_text_returns_no_chunks():
    assert chunk_document("", _metadata()) == []


def test_chunk_metadata_case_and_document_id_default_none():
    # Field ini ditambahkan supaya chunk bisa ditaut ke kasus/dokumen asal
    # (dipakai modules/tax_prediction.py & modules/tax_ingestion.py).
    metadata = _metadata()
    assert metadata.case_id is None
    assert metadata.document_id is None

    linked = _metadata(case_id="case-123", document_id="doc-456")
    assert linked.case_id == "case-123"
    assert linked.document_id == "doc-456"