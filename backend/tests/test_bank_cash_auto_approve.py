"""
tests/test_bank_cash_auto_approve.py
====================================
Auto-approve per aturan (migration 54) di modules/transactions/bank_cash_willi.py.
Murni logika -- tanpa database.
"""

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.transactions import bank_cash_willi as bc

USER = {"id": "u1", "nama": "Tester"}


def _aturan(**kw):
    dasar = dict(auto_approve=True, amounts=[2500, 6500], max_amount=None)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


def _tx(status="draft"):
    return SimpleNamespace(status=status, approved_at=None, approved_by=None, approved_by_name=None,
                           edited_at=None, edited_by=None, posted_at=None)


def test_approve_otomatis_menyetujui_draft_tapi_tidak_post():
    tx = _tx()
    assert bc._approve_otomatis(tx, _aturan(), USER) is True
    assert tx.status == "approved"
    assert tx.approved_by == "u1"
    assert tx.approved_by_name.endswith("(auto rule)")
    assert tx.posted_at is None


def test_aturan_tanpa_auto_approve_tetap_draft():
    tx = _tx()
    assert bc._approve_otomatis(tx, _aturan(auto_approve=False), USER) is False
    assert tx.status == "draft"


def test_aturan_batas_maksimum_tidak_pernah_auto_approve():
    tx = _tx()
    assert bc._approve_otomatis(tx, _aturan(amounts=None, max_amount=10000), USER) is False
    assert tx.status == "draft"


def test_transaksi_bukan_draft_tidak_diubah():
    tx = _tx(status="approved")
    assert bc._approve_otomatis(tx, _aturan(), USER) is False


def _req(**kw):
    dasar = dict(name="Biaya admin", direction="payment", keywords="biaya adm", amounts=[2500], max_amount=None,
                 bank_coa_id=None, counter_coa_id="c1", category="Bank admin fee", counterparty=None,
                 is_active=True, auto_approve=True)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


@pytest.fixture
def isi(monkeypatch):
    monkeypatch.setattr(bc, "_akun", lambda *a, **k: None)
    monkeypatch.setattr(bc, "_akun_kas", lambda *a, **k: None)
    return lambda r, p: bc._isi_aturan(None, "k1", r, p)


def test_simpan_auto_approve_dengan_nominal_persis_ok(isi):
    r = SimpleNamespace()
    isi(r, _req())
    assert r.auto_approve is True


def test_simpan_auto_approve_dengan_batas_maksimum_ditolak(isi):
    with pytest.raises(bc._Gagal):
        isi(SimpleNamespace(), _req(amounts=None, max_amount=10000))


def test_default_mati(isi):
    r = SimpleNamespace()
    isi(r, _req(auto_approve=False))
    assert r.auto_approve is False
