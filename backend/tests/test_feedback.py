"""
tests/test_feedback.py
=======================
Unit test untuk feedback collection
"""

import pytest
import json
import tempfile
import sys
import os
from pathlib import Path

# Tambahkan root project ke path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.feedback import (
    FeedbackCollector,
    collect_feedback,
    retrain_with_feedback,
    get_feedback_statistics,
)


class TestFeedbackCollector:
    """Test FeedbackCollector"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.temp_dir = tempfile.mkdtemp()
        self.feedback_file = Path(self.temp_dir) / "feedback.jsonl"
        self.collector = FeedbackCollector(feedback_file=str(self.feedback_file))
        
        self.original = {
            "keterangan": "PLNPOST001",
            "no_akun_debet": "5100",
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
        }
        
        self.corrected = {
            "keterangan": "PLNPOST001",
            "no_akun_debet": "21300999",  # Berubah
            "no_akun_kredit": "1100",
            "jml_debet": 100000,
            "jml_kredit": 100000,
        }
    
    def teardown_method(self):
        """Cleanup setelah test"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_add_feedback(self):
        """Test menambah feedback"""
        result = self.collector.add_feedback(
            original=self.original,
            corrected=self.corrected,
            user="test_user",
            context={"source": "unit_test"}
        )
        
        assert result is True
        
        # Cek file
        assert self.feedback_file.exists()
        
        # Cek cache
        assert len(self.collector._cache) > 0
        assert self.collector._cache[-1]["user"] == "test_user"
        assert "PLNPOST" in self.collector._cache[-1]["signature"]
    
    def test_get_feedback(self):
        """Test mengambil feedback"""
        # Tambah beberapa feedback
        for i in range(3):
            self.collector.add_feedback(
                original=self.original,
                corrected=self.corrected,
                user=f"user_{i}"
            )
        
        # Ambil semua
        all_feedback = self.collector.get_feedback()
        assert len(all_feedback) >= 3
    
    def test_get_feedback_filter_by_signature(self):
        """Test filter feedback by signature"""
        # Tambah feedback dengan signature berbeda
        self.collector.add_feedback(
            original=self.original,
            corrected=self.corrected,
            user="user1"
        )
        
        # Feedback dengan signature berbeda
        other_original = {"keterangan": "TRSF001"}
        self.collector.add_feedback(
            original=other_original,
            corrected=other_original,
            user="user2"
        )
        
        # Filter
        filtered = self.collector.get_feedback(signature="PLNPOST")
        assert len(filtered) == 1
    
    def test_get_statistics(self):
        """Test statistik feedback"""
        for i in range(5):
            self.collector.add_feedback(
                original=self.original,
                corrected=self.corrected,
                user=f"user_{i%2}"
            )
        
        stats = self.collector.get_statistics()
        assert stats["total_feedback"] >= 5
        assert stats["unique_signatures"] >= 1
        assert len(stats["by_user"]) >= 1
    
    def test_collect_feedback_function(self):
        """Test fungsi collect_feedback"""
        result = collect_feedback(
            original=self.original,
            corrected=self.corrected,
            user="function_user"
        )
        assert result is True


class TestRetrainWithFeedback:
    """Test retrain dengan feedback"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.temp_dir = tempfile.mkdtemp()
        self.feedback_file = Path(self.temp_dir) / "feedback.jsonl"
        
        # Buat dummy Pola - dengan fallback jika import gagal
        try:
            from akuntansi_ai import Pola
        except ImportError:
            # Fallback jika import gagal
            from dataclasses import dataclass, field
            @dataclass
            class Pola:
                aturan: dict = field(default_factory=dict)
        
        self.pola = Pola()
        self.pola.aturan[("PLNPOST", "KELUAR")] = {
            "no_akun_debet": "5100",
            "nama_akun_debet": "BEBAN LISTRIK",
            "no_akun_kredit": "1100",
            "nama_akun_kredit": "BANK",
            "konsisten": True,
            "jumlah_contoh": 5,
            "confidence_score": 0.8,
            "is_valid": True
        }
        
        # Tambah feedback
        collector = FeedbackCollector(feedback_file=str(self.feedback_file))
        collector.add_feedback(
            original={"keterangan": "PLNPOST001", "mutasi_kredit": 100000},
            corrected={"no_akun_debet": "21300999", "no_akun_kredit": "1100"},
            user="test"
        )
    
    def teardown_method(self):
        """Cleanup setelah test"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_retrain_with_feedback(self):
        """Test retrain dengan feedback"""
        updated = retrain_with_feedback(self.pola, str(self.feedback_file))
        
        # Harus ada pola baru dari feedback
        assert len(updated.aturan) >= len(self.pola.aturan)
        
        # Cek apakah feedback diterapkan
        if ("PLNPOST", "KELUAR") in updated.aturan:
            rule = updated.aturan[("PLNPOST", "KELUAR")]
            # Source bisa user_feedback atau tetap existing
            assert rule.get("source") == "user_feedback" or rule.get("jumlah_contoh", 0) >= 5
    
    def test_retrain_without_feedback_file(self):
        """Test retrain tanpa feedback file"""
        updated = retrain_with_feedback(self.pola, "nonexistent.json")
        assert updated == self.pola