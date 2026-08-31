"""
conftest.py
============
Konfigurasi pytest untuk AI Gouf Consulting
"""

import sys
import os
from pathlib import Path

# Tambahkan root project ke sys.path
# Root adalah folder di atas tests (ai accounting)
root_dir = Path(__file__).parent.parent
sys.path.insert(0, str(root_dir))

# Optional: print untuk debugging
print(f"✅ Root directory added to path: {root_dir}")