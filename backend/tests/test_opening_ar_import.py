"""
tests/test_opening_ar_import.py
===============================
Uji import Opening AR format Debit/Credit (keputusan bisnis 2026-11-09): file memuat SEMUA invoice
sampai cut-off -- lunas maupun belum -- dalam bentuk mutasi (baris ber-Debit = invoice, baris
ber-Credit = pembayarannya, 1 Reference bisa banyak baris). Yang diuji: pembacaan file (termasuk
sisa format sampai baris 1 juta), penjumlahan per Reference, invoice lunas diterima, semua error /
warning di panduan template, dan template AR yang dibuat server bisa diisi lalu dibaca balik.

Database tidak dipakai: helper yang membaca master customer / akun / invoice terdaftar diganti stub.
"""

import datetime as dt
import io
import os
import types
from decimal import Decimal

import openpyxl
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/db")
os.environ.setdefault("JWT_SECRET_KEY", "test-only")

import modules.management.opening_balance_import_v1 as M  # noqa: E402

CUT = dt.date(2026, 5, 31)
HEADER = ["Date", "No Akun", "Akun", "Source", "Description", "Reference", "Currency", "Debit", "Credit",
          "D/C", "Reklas", "Aging", "Nama Customer", "AR Control Account"]


class _Akun:
    def __init__(self, id, acc_no, name, aktif=True):
        self.id, self.acc_no, self.account_name, self.is_active = id, acc_no, name, aktif


AR = _Akun("coa-ar", "130001", "Accounts Receivable")
KAS = _Akun("coa-kas", "110001", "Cash")


@pytest.fixture
def ob(monkeypatch):
    monkeypatch.setattr(M, "_pihak_master", lambda s, cid, m: [("CUST-001", "Sibarita", "")])
    monkeypatch.setattr(M, "_akun_kontrol", lambda s, cid, m: [AR])
    monkeypatch.setattr(M, "_akun_klien", lambda s, cid: [AR, KAS])
    monkeypatch.setattr(M, "_akun_default_dok", lambda s, cid, m: AR)
    monkeypatch.setattr(M, "_dokumen_terdaftar", lambda s, cid, m: {"SUDAH-ADA"})
    return types.SimpleNamespace(client_id="c1", as_of_date=CUT, fiscal_year=2026, branch=None)


def _baris(tgl, ref, debit=0, kredit=0, cust="Sibarita", akun="130001", dc=None, sumber="Receivable Invoice", ket="X"):
    return [tgl, "1 - 2001", "Accounts Receivable", sumber, ket, ref, "IDR", debit, kredit, dc, "Reklas", None, cust, akun]


def _xlsx(baris, judul=True, sisa_format=0):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    if judul:
        for t in ("AR Transactions", "PT Contoh", "For the period 1 January 2026 to 30 May 2026"):
            ws.append([t])
    ws.append(HEADER)
    for b in baris:
        ws.append(b)
    for _ in range(sisa_format):          # sisa format: Currency & AR Control Account terisi default
        ws.append([None] * 6 + ["IDR"] + [None] * 6 + [130001])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _jalankan(ob, baris, **kw):
    isi = _xlsx(baris, **kw)
    header, data = M._baca_tabel(isi, "ar.xlsx", header_wajib="Reference", kolom_data=M.KOLOM_DATA_AR)
    return M._validasi_ar(None, ob, header, data)


def _pesan(h):
    return [p["message"] for p in h["messages"]]


D = dt.datetime


def test_invoice_lunas_dan_belum_lunas_sama_sama_diterima(ob):
    hasil = _jalankan(ob, [
        _baris(D(2026, 1, 1), "INV-LUNAS", debit=1000),
        _baris(D(2026, 1, 1), "INV-LUNAS", kredit=1000, sumber="Receivable Payment"),
        _baris(D(2026, 1, 2), "INV-SEBAGIAN", debit=2000),
        _baris(D(2026, 1, 3), "INV-SEBAGIAN", kredit=500, sumber="Receivable Payment"),
        _baris(D(2026, 1, 4), "INV-BELUM", debit=300),
    ])
    per = {h["data"]["doc_no"]: h for h in hasil}
    assert [per[k]["status"] for k in ("INV-LUNAS", "INV-SEBAGIAN", "INV-BELUM")] == ["valid"] * 3
    assert per["INV-LUNAS"]["data"]["outstanding"] == 0 and per["INV-LUNAS"]["debit"] == Decimal("0")
    assert per["INV-SEBAGIAN"]["data"]["outstanding"] == 1500 and per["INV-SEBAGIAN"]["debit"] == Decimal("1500")
    assert per["INV-BELUM"]["data"]["paid"] == 0 and per["INV-BELUM"]["data"]["outstanding"] == 300
    assert sum(h["debit"] for h in hasil) == Decimal("1800")     # saldo awal AR = outstanding saja


def test_baris_dijumlah_per_reference(ob):
    hasil = _jalankan(ob, [
        _baris(D(2026, 5, 20), "DELI-1483", debit=2632000, cust="Deli Sales"),
        _baris(D(2026, 5, 20), "DELI-1483", kredit=732500, cust="Deli Sales", sumber="Receivable Payment"),
        _baris(D(2026, 5, 20), "DELI-1483", kredit=1826018, cust="Deli Sales", sumber="Receivable Payment"),
    ])
    assert len(hasil) == 1
    h = hasil[0]
    assert (h["data"]["original"], h["data"]["paid"], h["data"]["outstanding"]) == (2632000, 2558518, 73482)
    assert h["data"]["invoice_rows"] == 1 and h["data"]["payment_rows"] == 2
    assert h["data"]["doc_date"] == "2026-05-20" and h["row_no"] == 5      # baris pertama Reference (judul 3 + header)
    assert h["status"] == "warning" and "New customer" in _pesan(h)[0]    # Deli Sales belum ada di master


def test_pembayaran_tanpa_invoice_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 14), "INV-0993", kredit=335000, sumber="Receivable Payment")])[0]
    assert h["status"] == "error" and h["data"]["original"] is None and h["debit"] == Decimal("0")
    assert any("No invoice row" in m for m in _pesan(h))


def test_credit_melebihi_debit_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "A", debit=100), _baris(D(2026, 1, 2), "A", kredit=150)])[0]
    assert h["status"] == "error" and any("more than total Debit" in m for m in _pesan(h))


def test_customer_dan_akun_beda_dalam_satu_reference_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "A", debit=100, cust="Sibarita"),
                       _baris(D(2026, 1, 1), "A", kredit=100, cust="Lain")])[0]
    assert h["status"] == "error" and any("different customers" in m for m in _pesan(h))
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "B", debit=100), _baris(D(2026, 1, 1), "B", kredit=100, akun="110001")])[0]
    assert h["status"] == "error" and any("different AR Control Accounts" in m for m in _pesan(h))


def test_tanggal_setelah_cutoff_dan_kosong_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 6, 1), "A", debit=100)])[0]
    assert h["status"] == "error" and any("after the cut-off" in m for m in _pesan(h))
    h = _jalankan(ob, [_baris(None, "B", debit=100)])[0]
    assert h["status"] == "error" and any("Date is required" in m for m in _pesan(h))


def test_reference_sudah_terdaftar_dan_kosong_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "sudah-ada", debit=100)])[0]
    assert h["status"] == "error" and any("already exists" in m for m in _pesan(h))
    h = _jalankan(ob, [_baris(D(2026, 1, 1), None, debit=100)])[0]
    assert h["status"] == "error" and any("Reference is required" in m for m in _pesan(h))


def test_debit_dan_credit_di_satu_baris_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "A", debit=100, kredit=100)])[0]
    assert h["status"] == "error" and any("both Debit and Credit" in m for m in _pesan(h))


def test_akun_bukan_kontrol_ar_error(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "A", debit=100, akun="110001")])[0]
    assert h["status"] == "error" and any("not an AR control account" in m for m in _pesan(h))
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "B", debit=100, akun="999")])[0]
    assert h["status"] == "error" and any("not in this client" in m for m in _pesan(h))


def test_dc_angka_boleh_dc_teks_lain_warning(ob):
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "A", debit=100, dc=100), _baris(D(2026, 1, 2), "A", kredit=100, dc=-100)])[0]
    assert h["status"] == "valid"                  # D/C berisi nilai bertanda seperti file legacy = informasi saja
    h = _jalankan(ob, [_baris(D(2026, 1, 1), "B", debit=100, dc="X")])[0]
    assert h["status"] == "warning" and any("D/C is not D or C" in m for m in _pesan(h))


def test_pembayaran_sebelum_invoice_dan_invoice_ganda_warning(ob):
    h = _jalankan(ob, [_baris(D(2026, 3, 2), "A", debit=100), _baris(D(2026, 3, 1), "A", kredit=100)])[0]
    assert h["status"] == "warning" and any("before the invoice date" in m for m in _pesan(h))
    h = _jalankan(ob, [_baris(D(2026, 3, 2), "B", debit=100), _baris(D(2026, 3, 1), "B", debit=50),
                       _baris(D(2026, 3, 3), "B", kredit=150)])[0]
    assert h["data"]["original"] == 150 and h["data"]["doc_date"] == "2026-03-01"
    assert any("invoice rows share" in m for m in _pesan(h))


def test_sisa_format_tidak_dihitung_sebagai_data(ob):
    isi = _xlsx([_baris(D(2026, 1, 1), "A", debit=100)], sisa_format=5000)
    header, data = M._baca_tabel(isi, "ar.xlsx", header_wajib="Reference", kolom_data=M.KOLOM_DATA_AR)
    assert [n for n, _ in data] == [5]            # 3 judul + header = baris 4 -> data baris 5; 5000 baris sisa diabaikan


def test_template_ar_bisa_diisi_lalu_dibaca_balik(ob):
    isi = M.buat_template_ar(M.SISI_AR, "PT Contoh", [("CUST-001", "Sibarita", "")], [AR], AR, ob)
    wb = openpyxl.load_workbook(io.BytesIO(isi))
    ws = wb[M.SISI_AR.sheet]
    assert [c.value for c in ws[M.BARIS_HEADER]][:14] == HEADER
    assert ws["N5"].value == "130001" and ws["G5"].value == "IDR"
    assert ws["Q10"].value.date() == CUT and "Belum Jatuh Tempo" in ws["L5"].value and "$Q$10" in ws["L5"].value
    assert "Total Invoices" in [c.value for c in ws["P"]]
    assert wb[M.SHEET_REFERENSI_DOK].sheet_state == "hidden" and M.SHEET_PANDUAN in wb.sheetnames
    assert len(ws.data_validations.dataValidation) == 3

    # Template kosong = tidak ada data (baris default IDR / akun tidak dihitung).
    header, data = M.__dict__["_baca_tabel"](isi, "t.xlsx", header_wajib="Reference", kolom_data=M.KOLOM_DATA_AR)
    assert data == []

    # Isi 3 baris (invoice + 2 pembayaran) lalu baca balik.
    ws["A5"], ws["F5"], ws["H5"], ws["M5"] = D(2026, 5, 20), "INV-1", 1000, "Sibarita"
    ws["A6"], ws["F6"], ws["I6"], ws["M6"] = D(2026, 5, 21), "INV-1", 400, "Sibarita"
    ws["A7"], ws["F7"], ws["I7"], ws["M7"] = D(2026, 5, 22), "INV-1", 600, "Sibarita"
    buf = io.BytesIO()
    wb.save(buf)
    header, data = M._baca_tabel(buf.getvalue(), "t.xlsx", header_wajib="Reference", kolom_data=M.KOLOM_DATA_AR)
    hasil = M._validasi_ar(None, ob, header, data)
    assert len(hasil) == 1 and hasil[0]["status"] == "valid"
    assert hasil[0]["data"]["outstanding"] == 0 and hasil[0]["data"]["paid"] == 1000


def test_kolom_wajib_hilang_ditolak(ob):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Reference", "Debit"])
    ws.append(["A", 100])
    buf = io.BytesIO()
    wb.save(buf)
    header, data = M._baca_tabel(buf.getvalue(), "x.xlsx", header_wajib="Reference", kolom_data=M.KOLOM_DATA_AR)
    with pytest.raises(M._Gagal):
        M._validasi_ar(None, ob, header, data)
