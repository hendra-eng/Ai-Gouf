"""
tests/test_receivables_payables.py
==================================
Logika buku pembantu Accounts Receivable / Payable
(modules/finance/receivables_payables_v1.py) yang tidak butuh database:
saldo per tanggal (as_of) termasuk pelunasan yang dibalik, bucket aging,
status, dan jatuh tempo dari termin.

Alur penuh (endpoint + posting + GL) sudah diuji end-to-end di salinan DB
saat fitur dibangun -- lihat laporan di task-claude.md.
"""

from datetime import date
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.finance import receivables_payables_v1 as rp  # noqa: E402


def _dok(**kw):
    dasar = dict(id="1", no="INV-1", ref_no=None, pihak="PT A", npwp=None, tanggal=date(2026, 5, 1),
                 jatuh_tempo=date(2026, 5, 31), tempo_perkiraan=False, total=Decimal("20000000"),
                 akun_kode="1120", akun_nama="Piutang", keterangan=None)
    dasar.update(kw)
    return rp.Dok(**dasar)


def test_saldo_per_tanggal_dengan_pembalikan():
    d = _dok()
    d.pelunasan.append(rp.Pelunasan(date(2026, 10, 1), Decimal("15000000"), "t1", "RCV/2026/0001", "reversed", date(2026, 10, 5)))
    d.pelunasan.append(rp.Pelunasan(date(2026, 10, 7), Decimal("5000000"), "t2", "RCV/2026/0002", "posted", None))
    assert d.sisa(date(2026, 4, 30)) == 0                       # belum terbit
    assert d.sisa(date(2026, 9, 30)) == Decimal("20000000")
    assert d.sisa(date(2026, 10, 3)) == Decimal("5000000")      # sesudah receipt, sebelum dibalik
    assert d.sisa(date(2026, 10, 5)) == Decimal("20000000")     # dibalik
    assert d.sisa(date(2026, 10, 8)) == Decimal("15000000")
    assert d.bayar_terakhir(date(2026, 10, 8)) == date(2026, 10, 7)
    assert d.bayar_terakhir(date(2026, 10, 6)) is None


def test_lunas_di_luar_kas_dianggap_di_tanggal_dokumen():
    d = _dok(lain=Decimal("20000000"))
    assert d.sisa(date(2026, 5, 1)) == 0
    assert rp._status(d, date(2026, 12, 31)) == "paid"


def test_status_dan_bucket():
    d = _dok()
    assert rp._status(d, date(2026, 5, 20)) == "open"
    assert rp._status(d, date(2026, 6, 1)) == "overdue"
    d.pelunasan.append(rp.Pelunasan(date(2026, 5, 10), Decimal("1000"), "t", "RCV", "posted", None))
    assert rp._status(d, date(2026, 5, 20)) == "partial"
    assert [rp._bucket(h) for h in (-3, 0, 1, 30, 31, 60, 61, 90, 91)] == [
        "current", "current", "1_30", "1_30", "31_60", "31_60", "61_90", "61_90", "91_plus"]


def test_jatuh_tempo_dari_termin():
    t = date(2026, 8, 20)
    assert rp._jatuh_tempo(t, date(2026, 9, 1), "Net 30") == (date(2026, 9, 1), False)
    assert rp._jatuh_tempo(t, None, "Net 30") == (date(2026, 9, 19), True)
    assert rp._jatuh_tempo(t, None, "14 days") == (date(2026, 9, 3), True)
    assert rp._jatuh_tempo(t, None, "COD") == (t, True)
    assert rp._jatuh_tempo(t, None, None) == (t, True)


def test_geser_bulan_dan_nama_pihak():
    assert rp._geser_bulan(date(2026, 1, 15), -1) == date(2025, 12, 1)
    assert rp._geser_bulan(date(2026, 12, 3), 1) == date(2027, 1, 1)
    assert rp._norm_pihak("  pt maju   bersama ") == "PT MAJU BERSAMA"
