"""
run_migration.py
================
Jalankan semua migration untuk export 14 sheet dengan satu perintah:

    python run_migration.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv opsional; DATABASE_URL bisa juga sudah di-set di environment

from add_columns_for_14_sheets import main

if __name__ == "__main__":
    sys.exit(main())