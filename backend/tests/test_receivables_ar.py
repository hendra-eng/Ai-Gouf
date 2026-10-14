"""
tests/test_receivables_ar.py
============================
Perhitungan Create Invoice & prioritas Collections
(modules/finance/receivables_ar_v1.py) yang tidak butuh database.
"""

from decimal import Decimal
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.finance import receivables_ar_v1 as ar  # noqa: E402


def _baris(**kw):
    dasar = dict(product_name="Jasa", quantity=1, unit_price=0, discount_type="percent", discount_value=0, tax_code="ppn_11")
    dasar.update(kw)
    return ar.BarisInvoiceIn(**dasar)


def test_contoh_desain_create_invoice():
    # Template UI 4.jpeg: subtotal 94.500.000, PPN 11% 10.395.000, grand total 104.895.000.
    hasil = [ar.hitung_baris(b, False) for b in (
        _baris(quantity=40, unit_price=750_000),
        _baris(quantity=60, unit_price=1_000_000, discount_value=5),
        _baris(quantity=5, unit_price=1_500_000),
    )]
    assert [h["amount"] for h in hasil] == [Decimal("30000000"), Decimal("57000000"), Decimal("7500000")]
    assert sum(h["dpp"] for h in hasil) == Decimal("94500000")
    assert sum(h["tax"] for h in hasil) == Decimal("10395000")
    assert hasil[1]["discount"] == Decimal("3000000")


def test_diskon_nominal_pajak_termasuk_dan_non_ppn():
    h = ar.hitung_baris(_baris(quantity=2, unit_price=500_000, discount_type="amount", discount_value=100_000), False)
    assert (h["amount"], h["dpp"], h["tax"]) == (Decimal("900000"), Decimal("900000"), Decimal("99000"))
    h = ar.hitung_baris(_baris(unit_price=1_110_000), True)
    assert (h["dpp"], h["tax"], h["dpp"] + h["tax"]) == (Decimal("1000000"), Decimal("110000"), Decimal("1110000"))
    h = ar.hitung_baris(_baris(unit_price=1_000_000, tax_code="non_ppn"), False)
    assert h["tax"] == 0 and h["dpp"] == Decimal("1000000")
    h = ar.hitung_baris(_baris(unit_price=1_000_000, tax_code="ppn_12"), False)
    assert h["tax"] == Decimal("120000")


def test_diskon_melebihi_nilai_ditolak():
    with pytest.raises(ar._Gagal):
        ar.hitung_baris(_baris(unit_price=100, discount_value=101), False)
    with pytest.raises(ar._Gagal):
        ar.hitung_baris(_baris(unit_price=100, discount_type="amount", discount_value=150), False)


def test_prioritas_otomatis():
    assert [ar.prioritas_otomatis(h) for h in (0, 30, 31, 60, 61, 120)] == ["low", "low", "medium", "medium", "high", "high"]
