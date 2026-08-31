"""
modules/logging_config.py
==========================
Logging terstruktur dengan rotasi file dan multiple output
"""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler, TimedRotatingFileHandler
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

# Buat folder logs jika belum ada
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)

# Konfigurasi default
DEFAULT_LOG_LEVEL = logging.INFO
DEFAULT_LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
DEFAULT_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

_loggers: Dict[str, logging.Logger] = {}
_initialized = False


def setup_logging(
    log_level: int = DEFAULT_LOG_LEVEL,
    log_format: str = DEFAULT_LOG_FORMAT,
    date_format: str = DEFAULT_DATE_FORMAT,
    log_file: Optional[str] = None,
    max_bytes: int = 10_000_000,  # 10MB
    backup_count: int = 5,
    use_timed_rotation: bool = True,
    enable_console: bool = True,
) -> logging.Logger:
    """
    Setup logging dengan rotasi file
    
    Args:
        log_level: Level logging (logging.INFO, logging.DEBUG, dll)
        log_format: Format pesan log
        date_format: Format tanggal
        log_file: Nama file log (default: ai_gouf.log)
        max_bytes: Maksimum ukuran file sebelum rotasi
        backup_count: Jumlah backup file yang disimpan
        use_timed_rotation: Gunakan rotasi berdasarkan waktu (daily)
        enable_console: Tampilkan log di console
    
    Returns:
        Logger utama
    """
    global _initialized
    
    if _initialized:
        return get_logger()
    
    # Logger root
    root_logger = logging.getLogger("AI_Gouf")
    root_logger.setLevel(log_level)
    
    # Hapus handler default jika ada
    root_logger.handlers.clear()
    
    # Console handler
    if enable_console:
        # [FIX] Terminal Windows (cp1252) crash saat log berisi emoji
        # (⚠️❌✅⏳ dll, dipakai di modules/auth.py, LogContext, dll).
        # Reconfigure stdout ke UTF-8 dengan errors='replace' supaya
        # karakter yang tidak didukung diganti '?' alih-alih melempar
        # UnicodeEncodeError. Aman di-skip kalau stream tidak mendukung
        # reconfigure (mis. saat stdout sudah di-redirect ke non-TTY).
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)
        console_formatter = logging.Formatter(log_format, date_format)
        console_handler.setFormatter(console_formatter)
        root_logger.addHandler(console_handler)
    
    # File handler dengan rotasi
    if log_file is None:
        log_file = LOG_DIR / "ai_gouf.log"
    else:
        log_file = Path(log_file)
        log_file.parent.mkdir(parents=True, exist_ok=True)
    
    if use_timed_rotation:
        # Rotasi harian
        file_handler = TimedRotatingFileHandler(
            log_file,
            when="midnight",
            interval=1,
            backupCount=backup_count,
            encoding="utf-8"
        )
        file_handler.suffix = "%Y%m%d"
    else:
        # Rotasi berdasarkan ukuran
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8"
        )
    
    file_handler.setLevel(log_level)
    file_formatter = logging.Formatter(log_format, date_format)
    file_handler.setFormatter(file_formatter)
    root_logger.addHandler(file_handler)
    
    _initialized = True
    
    # Log startup
    root_logger.info("=" * 60)
    root_logger.info(f"AI Gouf Consulting v1.0.0 - Logging initialized")
    root_logger.info(f"Log file: {log_file}")
    root_logger.info(f"Log level: {logging.getLevelName(log_level)}")
    root_logger.info(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    root_logger.info("=" * 60)
    
    return root_logger


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Dapatkan logger dengan nama tertentu
    
    Args:
        name: Nama logger (default: AI_Gouf)
    
    Returns:
        Logger instance
    """
    if name:
        logger_name = f"AI_Gouf.{name}"
    else:
        logger_name = "AI_Gouf"
    
    if logger_name not in _loggers:
        _loggers[logger_name] = logging.getLogger(logger_name)
    
    return _loggers[logger_name]


def get_module_logger(module_name: str) -> logging.Logger:
    """Dapatkan logger untuk module tertentu"""
    return get_logger(module_name)


# Convenience functions
def log_info(message: str, module: Optional[str] = None):
    get_logger(module).info(message)


def log_warning(message: str, module: Optional[str] = None):
    get_logger(module).warning(message)


def log_error(message: str, module: Optional[str] = None, exc_info: bool = False):
    get_logger(module).error(message, exc_info=exc_info)


def log_debug(message: str, module: Optional[str] = None):
    get_logger(module).debug(message)


def log_exception(message: str, module: Optional[str] = None):
    """Log exception dengan traceback lengkap"""
    get_logger(module).exception(message)


class LogContext:
    """Context manager untuk logging dengan konteks"""
    
    def __init__(self, operation: str, module: Optional[str] = None):
        self.operation = operation
        self.module = module
        self.logger = get_logger(module)
    
    def __enter__(self):
        self.logger.info(f"⏳ Starting: {self.operation}")
        self.start_time = datetime.now()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = (datetime.now() - self.start_time).total_seconds()
        if exc_type:
            self.logger.error(f"❌ Failed: {self.operation} (took {duration:.2f}s)")
        else:
            self.logger.info(f"✅ Completed: {self.operation} (took {duration:.2f}s)")


# Auto-initialize jika module diimport
setup_logging()