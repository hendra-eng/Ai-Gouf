"""
tests/test_bank_cash_auto_on_post.py
====================================
Hook auto-match saat invoice Sales/Purchase diposting (modules/transactions/bank_cash_willi.py).
Murni logika -- tanpa database: sesi, kunci klien & auto-match di-monkeypatch.
"""

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.transactions import bank_cash_willi as bc

USER = {"id": "u1", "nama": "Tester"}


class _Query:
    def __init__(self, row):
        self._row = row

    def filter(self, *_a, **_k):
        return self

    def first(self):
        return self._row


class _Session:
    def __init__(self, row):
        self._row = row

    def query(self, *_a, **_k):
        return _Query(self._row)


@pytest.fixture
def pasang(monkeypatch):
    panggilan = []

    def _set(row, hasil=None, error=None):
        monkeypatch.setattr(bc, "_jalankan", lambda fn: fn(_Session(row)))
        monkeypatch.setattr(bc, "_kunci_klien", lambda s, k: None)

        def _auto(session, kid, user):
            panggilan.append((kid, user))
            if error:
                raise error
            return hasil or {"matched": [], "rule_matched": [], "skipped": 0, "low_confidence_skipped": 0}

        monkeypatch.setattr(bc, "_jalankan_auto_match", _auto)
        return panggilan

    return _set


def test_toggle_mati_tidak_menjalankan_auto_match(pasang):
    panggilan = pasang(SimpleNamespace(auto_match_on_upload=False))
    assert bc.auto_match_setelah_invoice_posted("c1", USER) is None
    assert panggilan == []


def test_belum_ada_pengaturan_tidak_menjalankan(pasang):
    panggilan = pasang(None)
    assert bc.auto_match_setelah_invoice_posted("c1", USER) is None
    assert panggilan == []


def test_tanpa_klien_tidak_menjalankan(pasang):
    panggilan = pasang(SimpleNamespace(auto_match_on_upload=True))
    assert bc.auto_match_setelah_invoice_posted(None, USER) is None
    assert panggilan == []


def test_toggle_nyala_menjalankan_dan_meringkas(pasang):
    panggilan = pasang(SimpleNamespace(auto_match_on_upload=True),
                       hasil={"matched": [{"x": 1}], "rule_matched": [{"y": 1}, {"y": 2}], "skipped": 3, "low_confidence_skipped": 1})
    h = bc.auto_match_setelah_invoice_posted("c1", USER)
    assert panggilan == [("c1", USER)]
    assert h == {"matched": 1, "rule_matched": 2, "skipped": 3, "low_confidence_skipped": 1, "auto_approved": 0}


def test_error_tidak_pernah_dilempar(pasang):
    pasang(SimpleNamespace(auto_match_on_upload=True), error=RuntimeError("boom"))
    assert bc.auto_match_setelah_invoice_posted("c1", USER) is None


def test_pesan_ringkas():
    assert bc.pesan_auto_match_ringkas(None) == ""
    assert bc.pesan_auto_match_ringkas({"matched": 0, "rule_matched": 0, "skipped": 4, "low_confidence_skipped": 0}) == ""
    assert "2 mutation(s) matched to invoices, 1 recorded" in bc.pesan_auto_match_ringkas(
        {"matched": 2, "rule_matched": 1, "skipped": 0, "low_confidence_skipped": 0})
