r"""
migrations/sales/reset_seed_template_sales.py
=============================================
RESET template import Sales (Transactions > Sales > Source Data): kosongkan SEMUA isi tabel
    financial_transaction_sales_import_templates
lalu jalankan SEMUA file seed *.sql di folder ini (urut nama file; file .sql
kosong dilewati). Rujukan FK dari tabel lain (mis. source files / statement
yang sudah di-upload) dilepas, BUKAN dihapus.

Logika lengkap (cek klien, FK, satu transaksi, history): migrations/_reset_seed_template.py.

Cara pakai (dari folder backend):
    venv\Scripts\python migrations\sales\reset_seed_template_sales.py --dry-run
        -> jalankan semuanya lalu ROLLBACK (uji coba, tidak ada yang tersimpan)
    venv\Scripts\python migrations\sales\reset_seed_template_sales.py
        -> jalankan & simpan (minta konfirmasi ketik "yes"; pakai --yes untuk melewati)
    Opsi tambahan: --skip-missing-client (lewati seed yang kliennya belum ada)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _reset_seed_template import jalankan  # noqa: E402

if __name__ == "__main__":
    sys.exit(jalankan(Path(__file__).resolve().parent, "Sales", [
        "financial_transaction_sales_import_templates",
    ]))
