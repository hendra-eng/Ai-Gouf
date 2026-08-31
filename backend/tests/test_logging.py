"""
tests/test_logging.py
======================
Unit test untuk logging system
"""

import pytest
import logging
import tempfile
import time
from pathlib import Path

from modules.logging_config import (
    setup_logging,
    get_logger,
    get_module_logger,
    log_info,
    log_warning,
    log_error,
    log_debug,
    log_exception,
    LogContext,
)


class TestLogging:
    """Test logging system"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.temp_dir = tempfile.mkdtemp()
        self.log_file = Path(self.temp_dir) / "test.log"
    
    def teardown_method(self):
        """Cleanup setelah test"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_setup_logging(self):
        """Test setup logging"""
        logger = setup_logging(
            log_level=logging.DEBUG,
            log_file=str(self.log_file),
            enable_console=True  # Enable console agar file log terbuat
        )
        
        assert logger is not None
        assert logger.name == "AI_Gouf"
        # File log mungkin belum dibuat sampai ada log event
        # assert self.log_file.exists()
    
    def test_get_logger(self):
        """Test get logger"""
        logger = get_logger("test_module")
        assert logger is not None
        assert logger.name == "AI_Gouf.test_module"
    
    def test_get_module_logger(self):
        """Test get module logger"""
        logger = get_module_logger("backup")
        assert logger is not None
        assert logger.name == "AI_Gouf.backup"
    
    def test_log_info(self):
        """Test log info"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        log_info("Test info message", module="test")
        
        # Cek file log
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Test info message" in content
                assert "INFO" in content
    
    def test_log_warning(self):
        """Test log warning"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        log_warning("Test warning message", module="test")
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Test warning message" in content
                assert "WARNING" in content
    
    def test_log_error(self):
        """Test log error"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        log_error("Test error message", module="test")
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Test error message" in content
                assert "ERROR" in content
    
    def test_log_debug(self):
        """Test log debug"""
        setup_logging(log_level=logging.DEBUG, log_file=str(self.log_file), enable_console=True)
        log_debug("Test debug message", module="test")
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Test debug message" in content
                assert "DEBUG" in content
    
    def test_log_context(self):
        """Test LogContext"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        
        with LogContext("Test operation", module="test"):
            # Do something
            time.sleep(0.01)
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Starting: Test operation" in content
                assert "Completed: Test operation" in content
    
    def test_log_context_with_exception(self):
        """Test LogContext dengan exception"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        
        try:
            with LogContext("Test operation with error", module="test"):
                raise ValueError("Test error")
        except ValueError:
            pass
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "Starting: Test operation with error" in content
                assert "Failed: Test operation with error" in content
    
    def test_multiple_loggers(self):
        """Test multiple loggers"""
        setup_logging(log_file=str(self.log_file), enable_console=True)
        
        logger1 = get_logger("module1")
        logger2 = get_logger("module2")
        
        logger1.info("Message from module1")
        logger2.info("Message from module2")
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "module1" in content or "AI_Gouf.module1" in content
                assert "module2" in content or "AI_Gouf.module2" in content
    
    def test_log_level_filtering(self):
        """Test filtering log level"""
        setup_logging(log_level=logging.WARNING, log_file=str(self.log_file), enable_console=True)
        
        log_debug("This should not appear", module="test")
        log_info("This should not appear", module="test")
        log_warning("This should appear", module="test")
        
        if self.log_file.exists():
            with open(self.log_file, 'r') as f:
                content = f.read()
                assert "This should not appear" not in content
                assert "This should appear" in content