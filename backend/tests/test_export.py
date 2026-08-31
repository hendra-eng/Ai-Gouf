"""
tests/test_export.py
=====================
Unit test untuk multi-format export
"""

import pytest
import pandas as pd
import json
from pathlib import Path

from modules.export import (
    ExportManager,
    export_jurnal,
    export_to_excel,
    export_to_csv,
    export_to_json,
    export_to_pdf,
    export_to_html,
    export_all_formats,
)


class TestExport:
    """Test export data"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.df = pd.DataFrame({
            "tanggal": ["2026-07-01", "2026-07-02"],
            "keterangan": ["Transaksi A", "Transaksi B"],
            "no_akun_debet": ["5100", "5200"],
            "no_akun_kredit": ["1100", "1100"],
            "jml_debet": [100000, 200000],
            "jml_kredit": [100000, 200000],
            "sumber_kategori": ["AI (DeepSeek)", "Sesuai Pola"],
        })
        
        self.manager = ExportManager()
    
    def test_export_csv(self):
        """Test export CSV"""
        csv_data = export_to_csv(self.df)
        assert isinstance(csv_data, str)
        assert "tanggal" in csv_data
        assert "Transaksi A" in csv_data
        assert "Transaksi B" in csv_data
    
    def test_export_csv_with_separator(self):
        """Test export CSV dengan separator khusus"""
        csv_data = export_to_csv(self.df, sep=";")
        assert ";" in csv_data
        assert "," not in csv_data.split("\n")[0]
    
    def test_export_json(self):
        """Test export JSON"""
        json_data = export_to_json(self.df)
        assert isinstance(json_data, list)
        assert len(json_data) == 2
        assert json_data[0]["keterangan"] == "Transaksi A"
    
    def test_export_json_with_orient(self):
        """Test export JSON dengan orient berbeda"""
        json_data = export_to_json(self.df, orient="split")
        assert "columns" in json_data
        assert "data" in json_data
        assert len(json_data["data"]) == 2
    
    def test_export_excel(self):
        """Test export Excel"""
        excel_data = export_to_excel(self.df)
        assert isinstance(excel_data, bytes)
        assert len(excel_data) > 0
    
    def test_export_excel_with_summary(self):
        """Test export Excel dengan summary"""
        excel_data = export_to_excel(self.df, include_summary=True)
        assert isinstance(excel_data, bytes)
    
    def test_export_html(self):
        """Test export HTML"""
        html_data = export_to_html(self.df)
        assert isinstance(html_data, str)
        assert "<table" in html_data.lower()
        assert "Transaksi A" in html_data
    
    def test_export_pdf(self):
        """Test export PDF"""
        pdf_data = export_to_pdf(self.df, title="Test Report")
        if pdf_data is not None:
            assert isinstance(pdf_data, bytes)
            assert len(pdf_data) > 0
        else:
            pytest.skip("PDF export not available (fpdf not installed)")
    
    def test_export_all_formats(self):
        """Test export semua format"""
        results = export_all_formats(self.df, base_filename="test")
        
        assert "excel" in results
        assert "csv" in results
        assert "json" in results
        assert "html" in results
        
        if results.get("pdf"):
            assert isinstance(results["pdf"], bytes)
    
    def test_export_empty_dataframe(self):
        """Test export DataFrame kosong"""
        df_empty = pd.DataFrame()
        result = export_jurnal(df_empty, "csv")
        assert result is None
    
    def test_export_unsupported_format(self):
        """Test format tidak didukung"""
        with pytest.raises(ValueError):
            export_jurnal(self.df, "xml")
    
    def test_export_manager_methods(self):
        """Test ExportManager methods"""
        # Test langsung lewat manager
        csv_data = self.manager.export(self.df, "csv")
        assert isinstance(csv_data, str)
        
        json_data = self.manager.export(self.df, "json")
        assert isinstance(json_data, list)
        
        html_data = self.manager.export(self.df, "html")
        assert isinstance(html_data, str)