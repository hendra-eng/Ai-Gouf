"""
tests/test_tax_status_tracker.py
Uji dasar untuk modules/tax_status_tracker.py.
"""
import pytest

from modules import storage
from modules.schemas import RegulationStatus
from modules.tax_status_tracker import get_status_tracker


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def test_unknown_document_defaults_to_tidak_diketahui():
    tracker = get_status_tracker()
    assert tracker.get_status("doc-tidak-ada") == RegulationStatus.TIDAK_DIKETAHUI


def test_set_and_get_status():
    tracker = get_status_tracker()
    tracker.set_status("doc-1", RegulationStatus.DICABUT, note="Dicabut oleh PMK baru")

    assert tracker.get_status("doc-1") == RegulationStatus.DICABUT
    assert tracker.get_note("doc-1") == "Dicabut oleh PMK baru"


def test_list_by_status():
    tracker = get_status_tracker()
    tracker.set_status("doc-a", RegulationStatus.DIUBAH)
    tracker.set_status("doc-b", RegulationStatus.DIUBAH)
    tracker.set_status("doc-c", RegulationStatus.BERLAKU)

    diubah = tracker.list_by_status(RegulationStatus.DIUBAH)
    assert {r["document_id"] for r in diubah} == {"doc-a", "doc-b"}