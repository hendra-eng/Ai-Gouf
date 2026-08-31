"""
tests/test_dashboard.py
========================
Unit test untuk dashboard monitoring
"""

import pytest
import pandas as pd
from datetime import datetime

from modules.dashboard import (
    get_live_stats,
    DashboardStats,
)


class TestDashboardStats:
    """Test DashboardStats class"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.df_bank = pd.DataFrame({
            "bank": ["BCA", "BCA", "BRI"],
            "jml_debet": [100000, 200000, 150000],
            "jml_kredit": [100000, 200000, 150000],
            "sumber_kategori": ["Sesuai Pola", "Sesuai Pola", "Belum Terkategori - perlu review manual"],
        })
        
        self.df_jual = pd.DataFrame({
            "total": [500000, 300000],
            "ppn": [50000, 30000],
            "cara_bayar": ["TUNAI", "KREDIT"],
            "sumber_kategori": ["Sesuai Pola", "Sesuai Pola"],
        })
        
        self.df_coa = pd.DataFrame({
            "no_akun": ["1100", "1200"],
            "nama_akun": ["KAS", "BANK"],
            "kategori": ["ASET", "ASET"],
        })
    
    def test_get_bank_stats(self):
        """Test statistik bank"""
        dashboard = DashboardStats()
        stats = dashboard._get_bank_stats(self.df_bank)
        
        assert stats["total_records"] == 3
        assert stats["total_nominal"] == 450000
        assert len(stats["banks"]) == 2
        assert stats["pending_review"] == 1
        assert bool(stats["balance_status"]) == True
    
    def test_get_penjualan_stats(self):
        """Test statistik penjualan"""
        dashboard = DashboardStats()
        stats = dashboard._get_penjualan_stats(self.df_jual)
        
        assert stats["total_records"] == 2
        assert stats["total_nominal"] == 800000
        assert stats["total_ppn"] == 80000
        assert stats["tunai"] == 1
        assert stats["kredit"] == 1
    
    def test_get_coa_stats(self):
        """Test statistik COA"""
        dashboard = DashboardStats()
        stats = dashboard._get_coa_stats(self.df_coa)
        
        assert stats["total_akun"] == 2
        assert "ASET" in stats["kategori"]
    
    def test_get_live_stats(self):
        """Test get_live_stats function"""
        stats = get_live_stats(
            df_bank=self.df_bank,
            df_jual=self.df_jual,
            df_coa=self.df_coa,
        )
        
        assert "timestamp" in stats
        assert "data" in stats
        assert "summary" in stats
        assert "health" in stats
        
        assert stats["summary"]["total_records"] >= 2
    
    def test_health_score(self):
        """Test health score calculation"""
        stats = get_live_stats(
            df_bank=self.df_bank,
            df_coa=self.df_coa,
        )
        
        health = stats["health"]
        assert health["score"] >= 0
        assert health["score"] <= 100
        assert health["status"] in ["good", "warning", "critical"]


class TestDashboardEmptyData:
    """Test dashboard dengan data kosong"""
    
    def test_empty_bank_stats(self):
        """Test statistik bank kosong"""
        dashboard = DashboardStats()
        stats = dashboard._get_bank_stats(None)
        
        assert stats["total_records"] == 0
        assert stats["total_nominal"] == 0
        assert stats["pending_review"] == 0
        assert bool(stats["balance_status"]) == True
    
    def test_empty_penjualan_stats(self):
        """Test statistik penjualan kosong"""
        dashboard = DashboardStats()
        stats = dashboard._get_penjualan_stats(pd.DataFrame())
        
        assert stats["total_records"] == 0
        assert stats["total_nominal"] == 0
    
    def test_get_live_stats_empty(self):
        """Test get_live_stats dengan data kosong"""
        stats = get_live_stats()
        
        assert stats["summary"]["total_records"] == 0
        assert stats["summary"]["total_nominal"] == 0
        assert stats["health"]["score"] == 0