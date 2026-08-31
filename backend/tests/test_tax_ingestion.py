"""
tests/test_tax_ingestion.py
Uji dasar untuk modules/tax_ingestion.py (ingest dokumen peraturan).
"""
import pytest

from modules import storage
from modules.schemas import DocType, RegulationStatus
from modules.tax_ingestion import (
    get_document,
    ingest_document,
    list_documents,
    update_status,
)


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def _ingest(**overrides):
    base = dict(
        title="Ketentuan Faktur Pajak",
        doc_type=DocType.UU,
        full_text="Pasal 13 mengatur kewajiban membuat Faktur Pajak.",
        nomor="UU No. 42 Tahun 2009",
        tahun=2009,
    )
    base.update(overrides)
    return ingest_document(**base)


def test_ingest_document_creates_and_persists():
    document = _ingest()

    assert document.id
    assert document.title == "Ketentuan Faktur Pajak"
    assert document.doc_type == DocType.UU
    assert document.status == RegulationStatus.BERLAKU

    fetched = get_document(document.id)
    assert fetched is not None
    assert fetched.nomor == "UU No. 42 Tahun 2009"


def test_get_document_not_found_returns_none():
    assert get_document("tidak-ada") is None


def test_list_documents_filtered_by_doc_type():
    _ingest(title="UU A", doc_type=DocType.UU)
    _ingest(title="PMK B", doc_type=DocType.PMK, nomor="PMK 1/2024")

    uu_docs = list_documents(doc_type=DocType.UU)
    assert len(uu_docs) == 1
    assert uu_docs[0].title == "UU A"

    assert len(list_documents()) == 2


def test_ingest_document_empty_text_still_saved_without_indexing():
    # Dokumen dengan full_text kosong tetap tersimpan; hanya proses
    # chunking/embedding (_index_document) yang dilewati.
    document = _ingest(full_text="")
    assert get_document(document.id) is not None


def test_update_status_changes_status():
    document = _ingest()
    update_status(document.id, RegulationStatus.DICABUT, note="Digantikan aturan baru")

    fetched = get_document(document.id)
    assert fetched is not None
    assert fetched.status == RegulationStatus.DICABUT


def test_update_status_nonexistent_document_is_noop():
    # Tidak boleh melempar error walau document_id tidak ada.
    update_status("tidak-ada", RegulationStatus.DICABUT)