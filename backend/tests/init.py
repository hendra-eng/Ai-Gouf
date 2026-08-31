"""
tests/__init__.py
==================
Package untuk unit test AI Gouf Consulting

Cara menjalankan:
    pytest tests/ -v
    pytest tests/test_backup.py -v
    pytest tests/ --cov=modules --cov-report=html

Daftar test:
- test_backup.py: Backup & restore data
- test_dashboard.py: Dashboard monitoring
- test_encryption.py: Enkripsi data
- test_export.py: Multi-format export
- test_feedback.py: Feedback collection
- test_rules.py: Validation rules
- test_settings.py: User settings
- test_validation.py: Data validation
- test_progress.py: Progress tracking
- test_logging.py: Logging system
"""

import sys
import os

# Tambahkan root project ke path agar bisa import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

__version__ = "1.0.0"