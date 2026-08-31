"""
modules/settings.py
====================
User preferences & settings management
"""

import json
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Optional

from .logging_config import get_module_logger

logger = get_module_logger("settings")

SETTINGS_FILE = "user_settings.json"
DEFAULT_SETTINGS = {
    "ai": {
        "confidence_threshold": 0.6,
        "max_tokens": 1200,
        "temperature": 0.3,
        "model": "deepseek-chat",
    },
    "app": {
        "theme": "dark",
        "language": "id",
        "auto_save_interval": 300,  # 5 menit
        "max_file_size": 50,  # MB
        "max_rows_per_file": 10000,
        "show_debug": False,
    },
    "processing": {
        "auto_correct_enabled": True,
        "mask_pii": True,
        "min_samples": 3,
        "confidence_threshold": 0.7,
        "batch_size": 100,
    },
    "backup": {
        "auto_backup_enabled": True,
        "backup_interval": 3600,  # 1 jam
        "retention_days": 30,
        "max_backups": 50,
        "compress_backup": True,
    },
    "database": {
        "auto_save": True,
        "max_records": 10000,
    },
}


@dataclass
class UserSettings:
    """User settings untuk AI Gouf Consulting"""
    
    # AI Settings
    confidence_threshold: float = 0.6
    max_tokens: int = 1200
    temperature: float = 0.3
    model: str = "deepseek-chat"
    
    # App Settings
    theme: str = "dark"
    language: str = "id"
    auto_save_interval: int = 300
    max_file_size: int = 50
    max_rows_per_file: int = 10000
    show_debug: bool = False
    
    # Processing Settings
    auto_correct_enabled: bool = True
    mask_pii: bool = True
    min_samples: int = 3
    processing_confidence_threshold: float = 0.7
    batch_size: int = 100
    
    # Backup Settings
    auto_backup_enabled: bool = True
    backup_interval: int = 3600
    retention_days: int = 30
    max_backups: int = 50
    compress_backup: bool = True
    
    # Database Settings
    auto_save_db: bool = True
    max_db_records: int = 10000
    
    # Custom settings (extra fields)
    custom: Dict[str, Any] = field(default_factory=dict)
    
    @classmethod
    def load(cls, path: Optional[str] = None) -> "UserSettings":
        """Load settings from file"""
        if path is None:
            path = SETTINGS_FILE
        
        if not os.path.exists(path):
            logger.info("Settings file not found, using defaults")
            return cls()
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Handle nested structure
            settings = cls()
            
            # AI settings
            ai = data.get("ai", {})
            settings.confidence_threshold = ai.get("confidence_threshold", settings.confidence_threshold)
            settings.max_tokens = ai.get("max_tokens", settings.max_tokens)
            settings.temperature = ai.get("temperature", settings.temperature)
            settings.model = ai.get("model", settings.model)
            
            # App settings
            app = data.get("app", {})
            settings.theme = app.get("theme", settings.theme)
            settings.language = app.get("language", settings.language)
            settings.auto_save_interval = app.get("auto_save_interval", settings.auto_save_interval)
            settings.max_file_size = app.get("max_file_size", settings.max_file_size)
            settings.max_rows_per_file = app.get("max_rows_per_file", settings.max_rows_per_file)
            settings.show_debug = app.get("show_debug", settings.show_debug)
            
            # Processing settings
            proc = data.get("processing", {})
            settings.auto_correct_enabled = proc.get("auto_correct_enabled", settings.auto_correct_enabled)
            settings.mask_pii = proc.get("mask_pii", settings.mask_pii)
            settings.min_samples = proc.get("min_samples", settings.min_samples)
            settings.processing_confidence_threshold = proc.get("confidence_threshold", settings.processing_confidence_threshold)
            settings.batch_size = proc.get("batch_size", settings.batch_size)
            
            # Backup settings
            backup = data.get("backup", {})
            settings.auto_backup_enabled = backup.get("auto_backup_enabled", settings.auto_backup_enabled)
            settings.backup_interval = backup.get("backup_interval", settings.backup_interval)
            settings.retention_days = backup.get("retention_days", settings.retention_days)
            settings.max_backups = backup.get("max_backups", settings.max_backups)
            settings.compress_backup = backup.get("compress_backup", settings.compress_backup)
            
            # Database settings
            db = data.get("database", {})
            settings.auto_save_db = db.get("auto_save", settings.auto_save_db)
            settings.max_db_records = db.get("max_records", settings.max_db_records)
            
            # Custom settings
            settings.custom = data.get("custom", {})
            
            logger.info("✅ Settings loaded successfully")
            return settings
            
        except Exception as e:
            logger.error(f"❌ Failed to load settings: {e}")
            return cls()
    
    def save(self, path: Optional[str] = None) -> bool:
        """Save settings to file"""
        if path is None:
            path = SETTINGS_FILE
        
        try:
            data = {
                "ai": {
                    "confidence_threshold": self.confidence_threshold,
                    "max_tokens": self.max_tokens,
                    "temperature": self.temperature,
                    "model": self.model,
                },
                "app": {
                    "theme": self.theme,
                    "language": self.language,
                    "auto_save_interval": self.auto_save_interval,
                    "max_file_size": self.max_file_size,
                    "max_rows_per_file": self.max_rows_per_file,
                    "show_debug": self.show_debug,
                },
                "processing": {
                    "auto_correct_enabled": self.auto_correct_enabled,
                    "mask_pii": self.mask_pii,
                    "min_samples": self.min_samples,
                    "confidence_threshold": self.processing_confidence_threshold,
                    "batch_size": self.batch_size,
                },
                "backup": {
                    "auto_backup_enabled": self.auto_backup_enabled,
                    "backup_interval": self.backup_interval,
                    "retention_days": self.retention_days,
                    "max_backups": self.max_backups,
                    "compress_backup": self.compress_backup,
                },
                "database": {
                    "auto_save": self.auto_save_db,
                    "max_records": self.max_db_records,
                },
                "custom": self.custom,
                "version": "1.0.0",
                "updated_at": __import__('datetime').datetime.now().isoformat(),
            }
            
            # Backup old settings
            if os.path.exists(path):
                backup_path = path + ".bak"
                try:
                    import shutil
                    shutil.copy2(path, backup_path)
                except:
                    pass
            
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            logger.info("✅ Settings saved successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to save settings: {e}")
            return False
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get setting by key (supports dot notation)"""
        keys = key.split('.')
        current = self.__dict__
        
        try:
            for k in keys:
                if isinstance(current, dict):
                    current = current.get(k, default)
                else:
                    current = getattr(current, k, default)
            return current
        except:
            return default
    
    def set(self, key: str, value: Any) -> bool:
        """Set setting by key (supports dot notation)"""
        keys = key.split('.')
        
        if len(keys) == 1:
            if hasattr(self, key):
                setattr(self, key, value)
                return True
        else:
            # Nested setting
            current = self.__dict__
            for k in keys[:-1]:
                if isinstance(current, dict):
                    current = current.get(k, {})
                else:
                    current = getattr(current, k, {})
            
            if isinstance(current, dict):
                current[keys[-1]] = value
                return True
        
        return False


# Convenience functions
def load_settings() -> UserSettings:
    """Load user settings"""
    return UserSettings.load()


def save_settings(settings: UserSettings) -> bool:
    """Save user settings"""
    return settings.save()


def get_setting(key: str, default: Any = None) -> Any:
    """Get a single setting"""
    settings = load_settings()
    return settings.get(key, default)