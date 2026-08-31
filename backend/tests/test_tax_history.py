"""
tests/test_tax_history.py
Uji dasar untuk modules/tax_history.py.
"""
import pytest

from modules import storage, tax_history


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def test_log_interaction_and_retrieve():
    tax_history.log_interaction("Apa itu PPN?", "PPN adalah...", user_id="u1", client_id="PT A")

    entries = tax_history.get_history(user_id="u1")
    assert len(entries) == 1
    assert entries[0].question == "Apa itu PPN?"


def test_get_history_filters_by_client_id():
    tax_history.log_interaction("Q1", "A1", client_id="PT A")
    tax_history.log_interaction("Q2", "A2", client_id="PT B")

    only_a = tax_history.get_history(client_id="PT A")
    assert len(only_a) == 1
    assert only_a[0].question == "Q1"


def test_get_history_respects_limit():
    for i in range(5):
        tax_history.log_interaction(f"Q{i}", f"A{i}", user_id="u1")

    limited = tax_history.get_history(user_id="u1", limit=2)
    assert len(limited) == 2


def test_delete_entry():
    entry = tax_history.log_interaction("Q", "A", user_id="u1")
    assert tax_history.delete_entry(entry.id) is True
    assert tax_history.get_history(user_id="u1") == []