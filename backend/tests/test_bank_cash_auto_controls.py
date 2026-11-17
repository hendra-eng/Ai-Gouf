"""
tests/test_bank_cash_auto_controls.py
=====================================
Kontrol auto-rekonsil yang bisa diatur accounting (migration 55) di modules/transactions/bank_cash_willi.py:
on/off per jenis, auto-approve match invoice, aturan invoice (counterparty / referensi / toleransi),
kondisi tambahan aturan akun, dan baris confidence rendah. Murni logika -- tanpa database.
"""

import os
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.transactions import bank_cash_willi as bc

USER = {"id": "u1", "nama": "Tester"}
SETELAN = dict(bc.SETELAN_AUTO, auto_match_on_upload=False)


def _m(desk, debit=0, credit=0, conf="high", bank="b1", skip=False):
    return SimpleNamespace(id="m1", description=desk, debit=debit, credit=credit, confidence=conf,
                           bank_coa_id=bank, auto_rule_skip=skip, mutation_date=date(2026, 5, 20))


def _r(**kw):
    dasar = dict(id="r1", name="Rule", kind="account", direction="payment", keywords="biaya adm", amounts=[2500],
                 max_amount=None, bank_coa_id=None, counter_coa_id="c1", auto_approve=False, keyword_mode="any",
                 exclude_keywords=None, reference_keywords=None, counterparty_keywords=None, min_amount=None,
                 amount_tolerance=None, priority=100)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


def _inv(tipe="purchase", no="PINV-001", party="PT Sinar Jaya", sisa=1_000_000, id="i1"):
    return {"id": id, "no": no, "party": party, "type": tipe, "outstanding": float(sisa), "outstanding_dec": Decimal(sisa),
            "refs": [no], "date_obj": date(2026, 5, 1), "due_obj": date(2026, 5, 31)}


def _kand(purchase=(), sales=()):
    return {"purchase": list(purchase), "sales": list(sales)}


ADJ_MATI = {"enabled": False, "limit": Decimal(0), "accounts": {}, "category_accounts": {}}
ADJ_SIAP = {"enabled": True, "limit": Decimal(5000), "category_accounts": {},
            "accounts": {"expense": SimpleNamespace(id="a1", acc_no="6999", account_name="Selisih"),
                         "income": SimpleNamespace(id="a2", acc_no="7999", account_name="Selisih")}}


# ---------- kondisi aturan akun ----------

def test_aturan_akun_lama_tetap_jalan_tanpa_atribut_baru():
    r = SimpleNamespace(direction="payment", keywords="biaya adm", amounts=[2500], max_amount=None, bank_coa_id=None)
    assert bc._cocok_aturan(_m("BIAYA ADM BULANAN", debit=2500), [r]) is r


def test_mode_all_butuh_semua_kata_kunci():
    r = _r(keywords="biaya; adm", keyword_mode="all")
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=2500), [r]) is r
    assert bc._cocok_aturan(_m("BIAYA LAIN", debit=2500), [r]) is None


def test_kata_pengecualian_membatalkan_aturan():
    r = _r(exclude_keywords="reversal")
    assert bc._cocok_aturan(_m("BIAYA ADM REVERSAL", debit=2500), [r]) is None


def test_nomor_referensi_dan_pihak_wajib_ada():
    r = _r(reference_keywords="TRX-77", counterparty_keywords="bca")
    assert bc._cocok_aturan(_m("BIAYA ADM TRX-77 BCA", debit=2500), [r]) is r
    assert bc._cocok_aturan(_m("BIAYA ADM BCA", debit=2500), [r]) is None
    assert bc._cocok_aturan(_m("BIAYA ADM TRX-77", debit=2500), [r]) is None


def test_toleransi_nominal_aturan_akun():
    r = _r(amounts=[6500], amount_tolerance=50)
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=6540), [r]) is r
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=6600), [r]) is None


def test_rentang_min_max():
    r = _r(amounts=None, max_amount=10000, min_amount=1000)
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=500), [r]) is None
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=5000), [r]) is r
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=20000), [r]) is None


def test_prioritas_angka_kecil_menang_urutan_list_dipertahankan_query():
    a, b = _r(id="a", priority=1), _r(id="b", priority=2)
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=2500), [a, b]).id == "a"


def test_baris_yang_pernah_dibatalkan_tidak_diproses_aturan():
    assert bc._cocok_aturan(_m("BIAYA ADM", debit=2500, skip=True), [_r()]) is None


# ---------- keputusan auto-match ----------

def test_invoice_pas_dengan_bukti_jadi_auto_match_dan_bisa_auto_approve():
    kand = _kand(purchase=[_inv()])
    m = _m("TRF PINV-001 SINAR JAYA", debit=1_000_000)
    d = bc._putuskan(m, [], kand, SETELAN, ADJ_MATI)
    assert d["jenis"] == "invoice" and d["approve"] is False
    d = bc._putuskan(m, [], kand, {**SETELAN, "auto_approve_ap": True}, ADJ_MATI)
    assert d["approve"] is True and d["label"] == "auto match"


def test_auto_approve_ar_tidak_mempengaruhi_ap():
    kand = _kand(purchase=[_inv()])
    d = bc._putuskan(_m("PINV-001", debit=1_000_000), [], kand, {**SETELAN, "auto_approve_ar": True}, ADJ_MATI)
    assert d["approve"] is False


def test_matikan_auto_match_ap_membiarkan_baris_manual_dan_tidak_ditelan_aturan_akun():
    kand = _kand(purchase=[_inv()])
    aturan = [_r(keywords="pinv", amounts=None, max_amount=5_000_000)]
    d = bc._putuskan(_m("PINV-001", debit=1_000_000), aturan, kand, {**SETELAN, "auto_match_ap": False}, ADJ_MATI)
    assert d == {"jenis": None, "alasan": "invoice_off"}


def test_matikan_aturan_akun():
    d = bc._putuskan(_m("BIAYA ADM", debit=2500), [_r()], _kand(), {**SETELAN, "auto_match_rules": False}, ADJ_MATI)
    assert d["alasan"] == "no_match"
    assert bc._putuskan(_m("BIAYA ADM", debit=2500), [_r()], _kand(), SETELAN, ADJ_MATI)["jenis"] == "rule"


def test_baris_confidence_rendah_dilewati_secara_bawaan():
    d = bc._putuskan(_m("BIAYA ADM", debit=2500, conf="low"), [_r(auto_approve=True)], _kand(), SETELAN, ADJ_MATI)
    assert d == {"jenis": None, "alasan": "low_confidence"}


def test_confidence_rendah_diproses_tapi_tidak_pernah_auto_approve():
    s = {**SETELAN, "auto_include_low_confidence": True}
    d = bc._putuskan(_m("BIAYA ADM", debit=2500, conf="low"), [_r(auto_approve=True)], _kand(), s, ADJ_MATI)
    assert d["jenis"] == "rule" and d["approve"] is False
    kand = _kand(purchase=[_inv()])
    d = bc._putuskan(_m("PINV-001", debit=1_000_000, conf="low"), [], kand, {**s, "auto_approve_ap": True}, ADJ_MATI)
    assert d["jenis"] == "invoice" and d["approve"] is False


def test_aturan_akun_auto_approve_hanya_nominal_persis():
    d = bc._putuskan(_m("BIAYA ADM", debit=2500), [_r(auto_approve=True)], _kand(), SETELAN, ADJ_MATI)
    assert d["approve"] is True
    d = bc._putuskan(_m("BIAYA ADM", debit=2500), [_r(auto_approve=True, amounts=None, max_amount=9999)], _kand(), SETELAN, ADJ_MATI)
    assert d["approve"] is False


# ---------- aturan invoice ----------

def _r_inv(**kw):
    dasar = dict(kind="invoice", keywords="", counter_coa_id=None, amounts=None, counterparty_keywords="sinar jaya")
    dasar.update(kw)
    return _r(**dasar)


def test_aturan_invoice_counterparty_cukup_sebagai_bukti():
    kand = _kand(purchase=[_inv(no="X-9")])   # nomor invoice tidak muncul di keterangan, pihak ada
    d = bc._putuskan(_m("TRF KE SINAR JAYA", debit=1_000_000), [_r_inv()], kand, SETELAN, ADJ_MATI)
    assert d["jenis"] == "invoice_rule"
    assert d["pilihan"]["allocations"][0]["invoice_no"] == "X-9"


def test_aturan_invoice_pihak_lain_tidak_dipakai():
    kand = _kand(purchase=[_inv(party="PT Lain Lagi")])
    d = bc._putuskan(_m("TRF KE SINAR JAYA", debit=1_000_000), [_r_inv()], kand, SETELAN, ADJ_MATI)
    assert d["jenis"] != "invoice_rule"


def test_aturan_invoice_auto_approve_per_aturan():
    kand = _kand(purchase=[_inv()])
    m = _m("TRF SINAR JAYA", debit=1_000_000)
    assert bc._putuskan(m, [_r_inv()], kand, SETELAN, ADJ_MATI)["approve"] is False
    assert bc._putuskan(m, [_r_inv(auto_approve=True)], kand, SETELAN, ADJ_MATI)["approve"] is True


def test_aturan_invoice_dua_invoice_sama_nominal_ambigu_manual():
    kand = _kand(purchase=[_inv(id="i1", no="A-1"), _inv(id="i2", no="A-2")])
    assert bc._pilih_invoice_aturan(_m("TRF SINAR JAYA", debit=1_000_000), _r_inv(), kand, ADJ_MATI) is None


def test_aturan_invoice_toleransi_butuh_adjustment_siap():
    kand = _kand(purchase=[_inv()])
    m = _m("TRF SINAR JAYA", debit=999_900)   # kurang 100 dari sisa
    r = _r_inv(amount_tolerance=200)
    assert bc._pilih_invoice_aturan(m, r, kand, ADJ_MATI) is None
    p = bc._pilih_invoice_aturan(m, r, kand, ADJ_SIAP)
    assert p is not None and p["exact"] is False and p["adjustment"] is not None
    assert p["allocations"][0]["amount"] == 1_000_000.0
    # selisih di atas toleransi aturan -> tidak dipilih
    assert bc._pilih_invoice_aturan(_m("TRF SINAR JAYA", debit=999_000), r, kand, ADJ_SIAP) is None


def test_aturan_invoice_dengan_selisih_tidak_pernah_auto_approve():
    kand = _kand(purchase=[_inv()])
    d = bc._putuskan(_m("TRF SINAR JAYA", debit=999_900), [_r_inv(amount_tolerance=200, auto_approve=True)], kand, SETELAN, ADJ_SIAP)
    assert d["jenis"] == "invoice_rule" and d["approve"] is False


def test_arah_aturan_invoice_receipt_pakai_invoice_sales():
    kand = _kand(sales=[_inv(tipe="sales", no="SINV-1", party="PT Maju Terus")])
    r = _r_inv(direction="receipt", counterparty_keywords="maju terus")
    d = bc._putuskan(_m("MAJU TERUS", credit=1_000_000), [r], kand, SETELAN, ADJ_MATI)
    assert d["jenis"] == "invoice_rule"


# ---------- validasi simpan aturan ----------

@pytest.fixture
def isi(monkeypatch):
    monkeypatch.setattr(bc, "_akun", lambda *a, **k: None)
    monkeypatch.setattr(bc, "_akun_kas", lambda *a, **k: None)
    return lambda r, p: bc._isi_aturan(None, "k1", r, p)


def _req(**kw):
    dasar = dict(name="Aturan", direction="payment", keywords="biaya adm", amounts=[2500], max_amount=None,
                 bank_coa_id=None, counter_coa_id="c1", category="Bank admin fee", counterparty=None, is_active=True,
                 auto_approve=False, kind="account", keyword_mode="any", exclude_keywords=None, reference_keywords=None,
                 counterparty_keywords=None, min_amount=None, amount_tolerance=None, priority=100)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


def test_simpan_aturan_invoice_tanpa_akun_lawan_dan_tanpa_nominal(isi):
    r = SimpleNamespace()
    isi(r, _req(kind="invoice", keywords="", amounts=None, counter_coa_id=None, counterparty_keywords="sinar jaya", auto_approve=True))
    assert r.kind == "invoice" and r.counter_coa_id is None and r.auto_approve is True


def test_aturan_invoice_tanpa_kondisi_teks_ditolak(isi):
    with pytest.raises(bc._Gagal):
        isi(SimpleNamespace(), _req(kind="invoice", keywords="", amounts=None, counter_coa_id=None))


def test_aturan_akun_wajib_akun_lawan(isi):
    with pytest.raises(bc._Gagal):
        isi(SimpleNamespace(), _req(counter_coa_id=None))


def test_min_di_atas_max_ditolak(isi):
    with pytest.raises(bc._Gagal):
        isi(SimpleNamespace(), _req(amounts=None, max_amount=1000, min_amount=5000))


def test_simpan_kondisi_tambahan_tercatat(isi):
    r = SimpleNamespace()
    isi(r, _req(keyword_mode="all", exclude_keywords=" reversal ", reference_keywords="TRX", amount_tolerance=25, priority=5))
    assert (r.keyword_mode, r.exclude_keywords, r.reference_keywords, r.priority) == ("all", "reversal", "TRX", 5)
    assert r.amount_tolerance == Decimal("25")
