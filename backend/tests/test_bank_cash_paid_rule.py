"""
tests/test_bank_cash_paid_rule.py
=================================
Aturan tunggal "sudah dibayar" Sales & Purchase di modules/transactions/bank_cash_willi.py
(dipakai tab Cash Payment/Receipt, validasi pencocokan Reconciliation, dan sama dengan halaman AR/AP).
Murni logika -- tanpa database.

Jalankan: pytest tests/test_bank_cash_paid_rule.py
"""

import os
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.transactions import bank_cash_willi as bc

D = Decimal


def _sales(gross=1000, paid=0, **kw):
    dasar = dict(id="s1", invoice_no="INV-1", customer_name="Cust", invoice_date=None, due_date=None,
                 description="", transaction_type="Sales", gross_amount=gross, paid_amount=paid,
                 posting_status="Posted", currency="IDR", foreign_amount=None, exchange_rate=None)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


def _purchase(total=1000, ap=None, status="unpaid", opening=False, **kw):
    dasar = dict(id="p1", purchase_no="PUR-1", invoice_number="BILL-1", vendor_name="Vendor", invoice_date=None,
                 purchase_date=None, due_date=None, description="", category="Other", total=total,
                 accounts_payable=ap if ap is not None else total, status="posted", payment_status=status,
                 is_opening_balance=opening, currency="IDR", foreign_amount=None, exchange_rate=None)
    dasar.update(kw)
    return SimpleNamespace(**dasar)


def _alok(posted=0, pending=0):
    return {"posted": D(posted), "pending": D(pending)}


# ---------------- Sales ----------------

def test_sales_belum_dibayar():
    d = bc._invoice_sales_dict(_sales(1000, 0), _alok())
    assert (d["paid"], d["outstanding"], d["in_process"]) == (0.0, 1000.0, 0.0)
    assert d["paid_via_cash_bank"] == 0.0 and d["paid_outside_cash_bank"] == 0.0
    assert d["paid_cache_mismatch"] is False


def test_sales_lunas_lewat_cash_bank():
    d = bc._invoice_sales_dict(_sales(1000, 1000), _alok(posted=1000))
    assert (d["paid"], d["outstanding"]) == (1000.0, 0.0)
    assert d["paid_via_cash_bank"] == 1000.0 and d["paid_outside_cash_bank"] == 0.0


def test_sales_dibayar_di_luar_cash_bank_saldo_awal_atau_tunai():
    # paid_amount 400 tidak dijelaskan alokasi mana pun (Opening AR / penjualan tunai saat import)
    d = bc._invoice_sales_dict(_sales(1000, 400), _alok())
    assert d["paid"] == 400.0 and d["outstanding"] == 600.0
    assert d["paid_outside_cash_bank"] == 400.0 and d["paid_via_cash_bank"] == 0.0


def test_sales_campuran_di_luar_plus_cash_bank():
    d = bc._invoice_sales_dict(_sales(1000, 700), _alok(posted=300))
    assert d["paid"] == 700.0 and d["outstanding"] == 300.0
    assert d["paid_via_cash_bank"] == 300.0 and d["paid_outside_cash_bank"] == 400.0


def test_sales_cache_tertinggal_alokasi_yang_menang():
    # paid_amount (cache) 0 padahal ada pelunasan posted 500 -> angka mengikuti alokasi + ditandai mismatch
    d = bc._invoice_sales_dict(_sales(1000, 0), _alok(posted=500))
    assert d["paid"] == 500.0 and d["outstanding"] == 500.0
    assert d["paid_cache_mismatch"] is True


def test_sales_selisih_di_bawah_toleransi_diabaikan():
    d = bc._invoice_sales_dict(_sales(1000, "300.30"), _alok(posted=300))
    assert d["paid"] == 300.0 and d["paid_outside_cash_bank"] == 0.0


def test_sales_dibayar_tidak_melebihi_total():
    d = bc._invoice_sales_dict(_sales(1000, 1200), _alok())
    assert d["paid"] == 1000.0 and d["outstanding"] == 0.0


def test_sales_dalam_proses_mengurangi_sisa_bukan_dibayar():
    d = bc._invoice_sales_dict(_sales(1000, 200), _alok(posted=0, pending=300))
    assert d["paid"] == 200.0 and d["in_process"] == 300.0 and d["outstanding"] == 500.0


# ---------------- Purchase ----------------

def test_purchase_dibayar_sebagian_lewat_cash_bank():
    d = bc._invoice_purchase_dict(_purchase(1000), _alok(posted=250))
    assert (d["paid"], d["outstanding"]) == (250.0, 750.0)
    assert d["paid_via_cash_bank"] == 250.0 and d["paid_outside_cash_bank"] == 0.0


def test_purchase_ditandai_lunas_manual_dianggap_lunas():
    d = bc._invoice_purchase_dict(_purchase(1000, status="paid"), _alok())
    assert (d["paid"], d["outstanding"]) == (1000.0, 0.0)
    assert d["paid_outside_cash_bank"] == 1000.0


def test_purchase_lunas_manual_sebagian_via_cash_bank():
    d = bc._invoice_purchase_dict(_purchase(1000, status="paid"), _alok(posted=300))
    assert d["paid"] == 1000.0
    assert d["paid_via_cash_bank"] == 300.0 and d["paid_outside_cash_bank"] == 700.0


def test_purchase_lunas_lewat_cash_bank_bukan_di_luar():
    d = bc._invoice_purchase_dict(_purchase(1000, status="paid"), _alok(posted=1000))
    assert d["paid"] == 1000.0 and d["paid_outside_cash_bank"] == 0.0


def test_purchase_saldo_awal_total_nilai_awal_dan_bagian_dibayar_sebelum_cutoff():
    # bill awal 1000, sisa per cut-off 600 (400 sudah dibayar sebelum cut-off), lalu dibayar 100 lewat Cash & Bank
    d = bc._invoice_purchase_dict(_purchase(1000, ap=600, opening=True), _alok(posted=100))
    assert d["total"] == 1000.0 and d["paid"] == 500.0
    assert d["paid_via_cash_bank"] == 100.0 and d["paid_outside_cash_bank"] == 400.0
    assert d["outstanding"] == 500.0  # = accounts_payable (600) - 100, sama seperti sebelum aturan tunggal


def test_purchase_bukan_saldo_awal_memakai_accounts_payable_sebagai_total():
    d = bc._invoice_purchase_dict(_purchase(1000, ap=800), _alok(posted=100))
    assert d["total"] == 800.0 and d["paid"] == 100.0 and d["outstanding"] == 700.0


def test_purchase_dibayar_tidak_melebihi_total():
    d = bc._invoice_purchase_dict(_purchase(1000), _alok(posted=1500))
    assert d["paid"] == 1000.0 and d["outstanding"] == 0.0


def test_pembungkus_lama_dibayar_purchase_tetap_ada():
    assert bc._dibayar_purchase(_purchase(1000, status="paid"), _alok()) == D("1000.00")


# ---------------- Konsistensi antar sisi ----------------

@pytest.mark.parametrize("via, luar", [(0, 0), (300, 0), (0, 400), (300, 400), (1000, 0)])
def test_sales_dan_purchase_skenario_sama_hasilnya_sama(via, luar):
    """Skenario pelunasan yang sama harus menghasilkan paid/outstanding yang sama di Sales dan Purchase."""
    s = bc._invoice_sales_dict(_sales(1000, via + luar), _alok(posted=via))
    # bagian "di luar Cash & Bank" di Purchase = bill saldo awal yang sebagian sudah dibayar sebelum cut-off
    tx = _purchase(1000, ap=1000 - luar, opening=True) if luar else _purchase(1000)
    p = bc._invoice_purchase_dict(tx, _alok(posted=via))
    assert s["paid"] == p["paid"]
    assert s["outstanding"] == p["outstanding"]


def test_validasi_pencocokan_memakai_angka_yang_sama_dengan_tampilan():
    """_hitung_dibayar_* dipakai baik oleh daftar invoice maupun validasi sisa saat membuat transaksi."""
    inv = _sales(1000, 700)
    assert bc._hitung_dibayar_sales(inv, _alok(posted=300))[0] == D("700.00")
    tx = _purchase(1000, ap=600, opening=True)
    total, dibayar, via, luar = bc._hitung_dibayar_purchase(tx, _alok(posted=100))
    assert (total, dibayar, via, luar) == (D("1000.00"), D("500.00"), D("100.00"), D("400.00"))
