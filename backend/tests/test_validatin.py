"""
tests/test_validation.py
=========================
Unit test untuk data validation
"""

import pytest
import pandas as pd
from datetime import datetime

from modules.validation import (
    validate_coa,
    validate_transaction,
    DataValidator,
    COA_SCHEMA,
)


class TestCOAValidation:
    """Test validasi COA"""
    
    def test_validate_coa_valid(self):
        """Test COA valid"""
        df = pd.DataFrame({
            "no_akun": ["1100", "1200", "1300"],
            "nama_akun": ["KAS", "BANK", "PIUTANG USAHA"],
            "kategori": ["ASET", "ASET", "ASET"]
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is True
        assert len(errors) == 0
    
    def test_validate_coa_missing_column(self):
        """Test COA tanpa kolom wajib"""
        df = pd.DataFrame({
            "no_akun": ["1100", "1200"],
            # "nama_akun" tidak ada
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is False
        assert any("Kolom wajib" in err for err in errors)
    
    def test_validate_coa_duplicate(self):
        """Test COA dengan no_akun duplikat"""
        df = pd.DataFrame({
            "no_akun": ["1100", "1100", "1300"],
            "nama_akun": ["KAS", "KAS", "PIUTANG USAHA"]
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is False
        assert any("duplikat" in err.lower() for err in errors)
    
    def test_validate_coa_empty_values(self):
        """Test COA dengan nilai kosong"""
        df = pd.DataFrame({
            "no_akun": ["1100", None, "1300"],
            "nama_akun": ["KAS", "", "PIUTANG USAHA"]
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is False
        assert any("kosong" in err.lower() for err in errors)
    
    def test_validate_coa_with_kategori(self):
        """Test COA dengan kategori yang valid"""
        df = pd.DataFrame({
            "no_akun": ["1100", "2100", "3100"],
            "nama_akun": ["KAS", "HUTANG USAHA", "MODAL"],
            "kategori": ["ASET", "LIABILITAS", "EKUITAS"]
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is True
    
    def test_validate_coa_invalid_kategori(self):
        """Test COA dengan kategori tidak valid"""
        df = pd.DataFrame({
            "no_akun": ["1100", "2100"],
            "nama_akun": ["KAS", "HUTANG USAHA"],
            "kategori": ["INVALID", "LIABILITAS"]
        })
        is_valid, errors = validate_coa(df)
        assert is_valid is True  # Kategori tidak wajib
        assert any("tidak standar" in err.lower() for err in errors)
    
    def test_validate_coa_empty_dataframe(self):
        """Test COA kosong"""
        df = pd.DataFrame()
        is_valid, errors = validate_coa(df)
        assert is_valid is False
        assert any("tidak boleh kosong" in err.lower() for err in errors)


class TestTransactionValidation:
    """Test validasi transaksi"""
    
    def test_validate_transaction_valid(self):
        """Test transaksi valid"""
        row = {
            "tanggal": "2026-07-01",
            "keterangan": "Pembayaran listrik",
            "no_akun_debet": "5100",
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
            "mutasi_debet": 100000,
            "mutasi_kredit": 0,
        }
        is_valid, errors = validate_transaction(row)
        assert is_valid is True
        assert len(errors) == 0
    
    def test_validate_transaction_negative_nominal(self):
        """Test transaksi dengan nominal negatif"""
        row = {
            "tanggal": "2026-07-01",
            "keterangan": "Pembayaran listrik",
            "no_akun_debet": "5100",
            "no_akun_kredit": "1100",
            "jml_debet": -100000,
            "jml_kredit": 100000,
        }
        is_valid, errors = validate_transaction(row)
        assert is_valid is False
        assert any("negatif" in err.lower() for err in errors)
    
    def test_validate_transaction_same_account(self):
        """Test transaksi dengan akun debet dan kredit sama"""
        row = {
            "tanggal": "2026-07-01",
            "keterangan": "Pembayaran listrik",
            "no_akun_debet": "1100",
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
        }
        is_valid, errors = validate_transaction(row)
        assert is_valid is False
        assert any("sama" in err.lower() for err in errors)
    
    def test_validate_transaction_empty_keterangan(self):
        """Test transaksi dengan keterangan kosong"""
        row = {
            "tanggal": "2026-07-01",
            "keterangan": "",
            "no_akun_debet": "5100",
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
        }
        is_valid, errors = validate_transaction(row)
        assert is_valid is True  # Keterangan hanya warning
        assert any("kosong" in err.lower() for err in errors)
    
    def test_validate_transaction_invalid_date(self):
        """Test transaksi dengan tanggal tidak valid"""
        row = {
            "tanggal": "invalid-date",
            "keterangan": "Pembayaran listrik",
            "no_akun_debet": "5100",
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
        }
        is_valid, errors = validate_transaction(row)
        assert is_valid is True  # Tanggal hanya warning
        assert any("Format tanggal" in err for err in errors)


class TestDataValidator:
    """Test DataValidator"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.valid_df = pd.DataFrame({
            "tanggal": ["2026-07-01", "2026-07-02"],
            "keterangan": ["Transaksi 1", "Transaksi 2"],
            "no_akun_debet": ["5100", "5200"],
            "no_akun_kredit": ["1100", "1100"],
            "jml_debet": [100000, 200000],
            "jml_kredit": [100000, 200000],
        })
        
        self.invalid_df = pd.DataFrame({
            "tanggal": ["2026-07-01", "invalid"],
            "keterangan": ["Transaksi 1", ""],
            "no_akun_debet": ["5100", "5200"],
            "no_akun_kredit": ["1100", "1100"],
            "jml_debet": [100000, -200000],
            "jml_kredit": [100000, 200000],
        })
    
    def test_validate_all_valid(self):
        """Test validasi semua data valid"""
        validator = DataValidator(self.valid_df)
        result = validator.validate_all()
        
        assert result["is_valid"] is True
        assert result["stats"]["error_rows"] == 0
    
    def test_validate_all_invalid(self):
        """Test validasi data invalid"""
        validator = DataValidator(self.invalid_df)
        result = validator.validate_all()
        
        assert result["is_valid"] is False
        assert result["stats"]["error_rows"] > 0
    
    def test_check_duplicates(self):
        """Test deteksi duplikat"""
        df = pd.DataFrame({
            "tanggal": ["2026-07-01", "2026-07-01"],
            "keterangan": ["Transaksi", "Transaksi"],
            "mutasi_debet": [100000, 100000],
            "mutasi_kredit": [0, 0],
        })
        validator = DataValidator(df)
        result = validator.validate_all()
        
        assert len(result["warnings"]) > 0
        assert any("duplikat" in str(w).lower() for w in result["warnings"])
    
    def test_check_balance(self):
        """Test cek balance jurnal"""
        df = pd.DataFrame({
            "jml_debet": [100000, 50000],
            "jml_kredit": [100000, 40000],
        })
        validator = DataValidator(df)
        result = validator.validate_all()
        
        assert any("balance" in str(w).lower() for w in result["warnings"])