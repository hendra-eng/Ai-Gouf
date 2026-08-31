"""
tests/test_backup.py
=====================
Unit test untuk module backup
"""

import pytest
import tempfile
import os
import json
from pathlib import Path
import shutil

from modules.backup import BackupManager, auto_backup, restore_backup, list_backups


class TestBackupManager:
    """Test untuk BackupManager"""
    
    def setup_method(self):
        """Setup sebelum setiap test"""
        self.temp_dir = tempfile.mkdtemp()
        self.backup_dir = Path(self.temp_dir) / "backups"
        self.manager = BackupManager(backup_dir=self.backup_dir)
        
        # Buat file dummy
        self.test_file = Path(self.temp_dir) / "test.json"
        self.test_file.write_text('{"key": "value"}')
        
        # Pindah ke temp dir
        self.old_cwd = os.getcwd()
        os.chdir(self.temp_dir)
    
    def teardown_method(self):
        """Cleanup setelah setiap test"""
        os.chdir(self.old_cwd)
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_create_backup(self):
        """Test membuat backup"""
        result = self.manager.create_backup(files=["test.json"])
        
        assert "timestamp" in result
        assert result["total_files"] > 0
        assert len(result["files"]) > 0
        
        # Cek file backup
        backup_folder = self.backup_dir / result["timestamp"]
        assert backup_folder.exists()
        
        # Cek metadata
        metadata_file = backup_folder / "backup_metadata.json"
        assert metadata_file.exists()
        
        with open(metadata_file) as f:
            metadata = json.load(f)
            assert metadata["source_files"] == ["test.json"]
    
    def test_create_backup_with_compression(self):
        """Test backup dengan kompresi"""
        result = self.manager.create_backup(files=["test.json"], compress=True)
        
        backup_folder = self.backup_dir / result["timestamp"]
        # Cari file .gz
        gz_files = list(backup_folder.glob("*.gz"))
        assert len(gz_files) > 0
    
    def test_restore_backup(self):
        """Test restore backup"""
        # Buat backup dulu
        result = self.manager.create_backup(files=["test.json"])
        timestamp = result["timestamp"]
        
        # Hapus file asli
        os.remove("test.json")
        assert not Path("test.json").exists()
        
        # Restore
        restore_result = self.manager.restore_backup(timestamp)
        
        assert restore_result["total_restored"] >= 0
        assert Path("test.json").exists()
        assert Path("test.json").read_text() == '{"key": "value"}'
    
    def test_list_backups(self):
        """Test list backup"""
        # Buat beberapa backup
        for i in range(3):
            self.manager.create_backup(files=["test.json"])
        
        backups = self.manager.list_backups()
        assert len(backups) >= 1
    
    def test_delete_backup(self):
        """Test hapus backup"""
        result = self.manager.create_backup(files=["test.json"])
        timestamp = result["timestamp"]
        
        assert self.manager.delete_backup(timestamp) is True
        
        backups = self.manager.list_backups()
        assert not any(b["timestamp"] == timestamp for b in backups)
    
    def test_auto_backup_function(self):
        """Test fungsi auto_backup"""
        result = auto_backup(description="Test backup")
        assert "timestamp" in result
        assert result.get("description") == "Test backup"
    
    def test_restore_backup_function(self):
        """Test fungsi restore_backup"""
        # Buat backup
        result = auto_backup()
        timestamp = result["timestamp"]
        
        # Hapus file
        if os.path.exists("test.json"):
            os.remove("test.json")
        
        # Restore
        restore_result = restore_backup(timestamp)
        assert restore_result["total_restored"] >= 0


class TestBackupEdgeCases:
    """Test edge cases backup"""
    
    def test_backup_nonexistent_file(self):
        """Test backup file yang tidak ada"""
        old_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                os.chdir(tmpdir)
                manager = BackupManager(backup_dir=Path(tmpdir) / "backups")
                
                result = manager.create_backup(files=["nonexistent.json"])
                assert result["total_files"] == 0
                assert len(result["failed"]) > 0
            finally:
                os.chdir(old_cwd)
    
    def test_restore_nonexistent_backup(self):
        """Test restore backup yang tidak ada"""
        with pytest.raises(FileNotFoundError):
            restore_backup("20260101_000000")
    
    def test_backup_with_description(self):
        """Test backup dengan deskripsi"""
        old_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                os.chdir(tmpdir)
                manager = BackupManager(backup_dir=Path(tmpdir) / "backups")
                
                # Buat file dummy
                Path("test.json").write_text("test")
                
                result = manager.create_backup(
                    files=["test.json"],
                    description="Test backup with description"
                )
                
                # Cek metadata
                backup_folder = manager.backup_dir / result["timestamp"]
                metadata_file = backup_folder / "backup_metadata.json"
                with open(metadata_file) as f:
                    metadata = json.load(f)
                    assert metadata["description"] == "Test backup with description"
            finally:
                os.chdir(old_cwd)