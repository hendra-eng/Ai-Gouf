"""
tests/test_settings.py
=======================
Unit test untuk user settings
"""

import pytest
import json
import tempfile
import os
from pathlib import Path

from modules.settings import (
    UserSettings,
    load_settings,
    save_settings,
    get_setting,
    DEFAULT_SETTINGS,
)


class TestUserSettings:
    """Test UserSettings class"""
    
    def test_default_settings(self):
        """Test default settings"""
        settings = UserSettings()
        
        assert settings.confidence_threshold == 0.6
        assert settings.theme == "dark"
        assert settings.language == "id"
        assert settings.auto_correct_enabled is True
        assert settings.auto_backup_enabled is True
    
    def test_load_settings_from_file(self):
        """Test load settings dari file"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            
            # Buat file settings
            test_data = {
                "ai": {"confidence_threshold": 0.8},
                "app": {"theme": "light"},
                "processing": {"auto_correct_enabled": False}
            }
            with open(settings_path, 'w') as f:
                json.dump(test_data, f)
            
            # Load
            settings = UserSettings.load(str(settings_path))
            assert settings.confidence_threshold == 0.8
            assert settings.theme == "light"
            assert settings.auto_correct_enabled is False
    
    def test_load_settings_default_on_error(self):
        """Test load settings dengan file error"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            
            # Buat file invalid
            with open(settings_path, 'w') as f:
                f.write("invalid json {")
            
            settings = UserSettings.load(str(settings_path))
            assert settings.confidence_threshold == 0.6  # Default
    
    def test_save_settings(self):
        """Test save settings"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            
            settings = UserSettings()
            settings.confidence_threshold = 0.9
            settings.theme = "light"
            
            result = settings.save(str(settings_path))
            assert result is True
            assert settings_path.exists()
            
            # Load kembali
            loaded = UserSettings.load(str(settings_path))
            assert loaded.confidence_threshold == 0.9
            assert loaded.theme == "light"
    
    def test_get_setting(self):
        """Test get setting"""
        settings = UserSettings()
        settings.confidence_threshold = 0.75
        
        assert settings.get("confidence_threshold") == 0.75
        assert settings.get("nonexistent", "default") == "default"
    
    def test_set_setting(self):
        """Test set setting"""
        settings = UserSettings()
        
        assert settings.set("confidence_threshold", 0.85) is True
        assert settings.confidence_threshold == 0.85
        
        assert settings.set("nonexistent", "value") is False
    
    def test_get_setting_function(self):
        """Test fungsi get_setting"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            os.chdir(tmpdir)
            
            # Buat settings
            settings = UserSettings()
            settings.confidence_threshold = 0.7
            settings.save("user_settings.json")
            
            value = get_setting("confidence_threshold", 0.5)
            assert value == 0.7


class TestSettingsPersistence:
    """Test persistensi settings"""
    
    def test_settings_persistence(self):
        """Test settings persistensi roundtrip"""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            os.chdir(tmpdir)
            
            # Buat settings
            settings = UserSettings()
            settings.confidence_threshold = 0.95
            settings.theme = "light"
            settings.auto_correct_enabled = False
            settings.auto_backup_enabled = False
            
            save_settings(settings)
            
            # Load kembali
            loaded = load_settings()
            assert loaded.confidence_threshold == 0.95
            assert loaded.theme == "light"
            assert loaded.auto_correct_enabled is False
            assert loaded.auto_backup_enabled is False