"""
tests/test_tax_folios.py
Uji dasar untuk modules/tax_folios.py.
"""
import pytest

from modules import storage, tax_folios


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def test_create_and_get_folio():
    folio = tax_folios.create_folio(title="Sengketa PPN Klien X", topic="PPN")
    fetched = tax_folios.get_folio(folio.id)

    assert fetched is not None
    assert fetched.title == "Sengketa PPN Klien X"


def test_add_document_and_case_are_idempotent():
    folio = tax_folios.create_folio(title="Folio A", topic="PPh")

    tax_folios.add_document(folio.id, "doc-1")
    tax_folios.add_document(folio.id, "doc-1")  # duplikat, tidak boleh nambah dua kali
    tax_folios.add_case(folio.id, "case-1")

    updated = tax_folios.get_folio(folio.id)
    assert updated.document_ids == ["doc-1"]
    assert updated.case_ids == ["case-1"]


def test_list_folios_filtered_by_topic():
    tax_folios.create_folio(title="A", topic="PPN")
    tax_folios.create_folio(title="B", topic="PPh")

    ppn_folios = tax_folios.list_folios(topic="PPN")
    assert len(ppn_folios) == 1
    assert ppn_folios[0].title == "A"


def test_delete_folio():
    folio = tax_folios.create_folio(title="C", topic="PPN")
    assert tax_folios.delete_folio(folio.id) is True
    assert tax_folios.get_folio(folio.id) is None


def test_mutate_unknown_folio_returns_none():
    assert tax_folios.add_document("tidak-ada", "doc-1") is None