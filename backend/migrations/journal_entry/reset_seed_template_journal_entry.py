r"""
migrations/journal_entry/reset_seed_template_journal_entry.py
=============================================================
RESET template import Journal Entry (Transactions > Journal Entry (import)): kosongkan SEMUA isi tabel
    financial_transaction_journal_entry_import_templates
lalu jalankan SEMUA file seed *.sql di folder ini (urut nama file; file .sql
kosong dilewati). Rujukan FK dari tabel lain (mis. source files / statement
yang sudah di-upload) dilepas, BUKAN dihapus.

Logika lengkap (cek klien, FK, satu transaksi, history): migrations/_reset_seed_template.py.

Cara pakai (dari folder backend):
    venv\Scripts\python migrations\journal_entry\reset_seed_template_journal_entry.py --dry-run
        -> jalankan semuanya lalu ROLLBACK (uji coba, tidak ada yang tersimpan)
    venv\Scripts\python migrations\journal_entry\reset_seed_template_journal_entry.py
        -> jalankan & simpan (minta konfirmasi ketik "yes"; pakai --yes untuk melewati)
    Opsi tambahan: --skip-missing-client (lewati seed yang kliennya belum ada)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _reset_seed_template import jalankan  # noqa: E402

if __name__ == "__main__":
    sys.exit(jalankan(Path(__file__).resolve().parent, "Journal Entry", [
        "financial_transaction_journal_entry_import_templates",
    ]))
