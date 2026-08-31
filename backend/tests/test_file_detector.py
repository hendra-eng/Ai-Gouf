"""
tests/test_file_detector.py
============================
Unit test untuk deteksi jenis file (modules/file_detector.py):
- SALES_JOURNAL (Jurnal Penjualan)
- CASH_RECONCILIATION (Rekonsiliasi Kas Masuk vs Sales)
- POS_TRANSACTION (Rekap Transaksi POS)

Setiap test membuat file .xlsx dummy dengan struktur sheet/header yang
meniru pola asli, TAPI dengan nama outlet/PT yang berbeda-beda -- untuk
membuktikan deteksi bekerja independen dari nama PT.
"""

import tempfile
from pathlib import Path

import openpyxl
import pytest

from modules.file_detector import (
    deteksi_jenis_file,
    deteksi_banyak_file,
    JENIS_SALES_JOURNAL,
    JENIS_CASH_RECONCILIATION,
    JENIS_POS_TRANSACTION,
    JENIS_TIDAK_DIKENALI,
)


def _buat_xlsx(tmp_path: Path, nama_file: str, sheets: dict) -> Path:
    """Helper: buat file .xlsx dengan beberapa sheet & baris header/data."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sheet_name, rows in sheets.items():
        ws = wb.create_sheet(sheet_name)
        for row in rows:
            ws.append(row)
    path = tmp_path / nama_file
    wb.save(path)
    return path


class TestDeteksiSalesJournal:
    """Jurnal Penjualan harus terdeteksi terlepas dari nama outlet/PT."""

    def test_deteksi_sales_journal_outlet_a(self, tmp_path):
        path = _buat_xlsx(tmp_path, "PT_A_Sales_Jurnal_OutletA.xlsx", {
            "SALES": [["TGL", "CATEGORY", "QTY", "ESB"]],
            "REKAP SALES ESB": [["Sales Number", "Bill Number", "Menu Category"]],
            "input xero": [["DATE", "PAID GROSS", "PAID EX. SVC+TAX"]],
            "REKAP UNPAID": [["ORDER NO", "DATE", "CUSTOMER NAME", "TOTAL AMOUNT"]],
            "PHR OutletA": [["DATE", "NET REVENUE", "SERVICE CHARGE", "PB 1"]],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_SALES_JOURNAL
        assert hasil.confidence > 0.5

    def test_deteksi_sales_journal_outlet_b_pt_berbeda(self, tmp_path):
        """PT/nama outlet sengaja dibuat berbeda total dari test sebelumnya."""
        path = _buat_xlsx(tmp_path, "PT_XYZ_Laporan_Toko_Baru_2027.xlsx", {
            "SALES": [["TGL", "CATEGORY", "QTY", "ESB"]],
            "REKAP SALES ESB": [["Sales Number", "Bill Number", "Menu Category"]],
            "input xero": [["DATE", "PAID GROSS"]],
            "REKAP UNPAID": [["ORDER NO", "DATE"]],
            "PHR Toko Baru": [["DATE", "NET REVENUE"]],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_SALES_JOURNAL


class TestDeteksiCashReconciliation:
    def test_deteksi_uang_masuk_vs_sales(self, tmp_path):
        path = _buat_xlsx(tmp_path, "PT_B_KK_Payment.xlsx", {
            "uang masuk VS Sales": [
                ["Row Labels", "Sum of OUTLET1", "Sum of OUTLET2", "Data Sales ESB"]
            ],
            "Uang Masuk ": [
                ["DATA ESB", None, None, "DATA PAYMENT BU ASTITI"],
                ["Tanggal", "Payment Method Name", "OUTLET1", "OUTLET2", "Selisih"],
            ],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_CASH_RECONCILIATION
        assert hasil.confidence > 0.3


class TestDeteksiPosTransaction:
    def test_deteksi_report_transaction(self, tmp_path):
        path = _buat_xlsx(tmp_path, "PT_C_Toko_Retail.xlsx", {
            "Report Transaction - 01-07-2026": [
                ["Outlet", "Date", "Time", "Gross Sales", "Discounts", "Refunds",
                 "Net Sales", "Receipt Number", "Collected By", "Served By",
                 "Payment Method"]
            ],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_POS_TRANSACTION

    def test_deteksi_pivot_gross_sales(self, tmp_path):
        """Pivot table (Sheet2-style) tanpa nama sheet 'Report Transaction'."""
        path = _buat_xlsx(tmp_path, "PT_D_Pivot.xlsx", {
            "Sheet2": [
                ["Sum of Gross Sales", "Column Labels"],
                ["Row Labels", "Bank Transfer", "Cash", "Grand Total"],
            ],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_POS_TRANSACTION


class TestDeteksiTidakDikenali:
    def test_file_tanpa_pola_dikenali_dikembalikan_unknown(self, tmp_path):
        path = _buat_xlsx(tmp_path, "random.xlsx", {
            "Sheet1": [["kolom_a", "kolom_b"], [1, 2]],
        })
        hasil = deteksi_jenis_file(path)
        assert hasil.jenis == JENIS_TIDAK_DIKENALI
        assert hasil.confidence == 0.0

    def test_file_tidak_ada_melempar_error(self):
        with pytest.raises(FileNotFoundError):
            deteksi_jenis_file("file_yang_tidak_ada_sama_sekali.xlsx")


class TestDeteksiBanyakFile:
    def test_deteksi_banyak_file_sekaligus(self, tmp_path):
        path1 = _buat_xlsx(tmp_path, "sales1.xlsx", {
            "REKAP SALES ESB": [["Sales Number", "Bill Number"]],
        })
        path2 = _buat_xlsx(tmp_path, "kas1.xlsx", {
            "Uang Masuk ": [["DATA ESB", "DATA PAYMENT"]],
        })
        hasil = deteksi_banyak_file([path1, path2])
        assert len(hasil) == 2
        jenis_terdeteksi = {h.jenis for h in hasil}
        assert JENIS_SALES_JOURNAL in jenis_terdeteksi
        assert JENIS_CASH_RECONCILIATION in jenis_terdeteksi

    def test_file_hilang_dilewati_tanpa_error(self, tmp_path):
        path_valid = _buat_xlsx(tmp_path, "valid.xlsx", {
            "REKAP SALES ESB": [["Sales Number"]],
        })
        hasil = deteksi_banyak_file([path_valid, "tidak_ada.xlsx"])
        assert len(hasil) == 1  # yang hilang dilewati, bukan bikin exception