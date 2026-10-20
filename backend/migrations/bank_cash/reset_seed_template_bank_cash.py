r"""
migrations/bank_cash/reset_seed_template_bank_cash.py
=====================================================
RESET template import Bank & Cash (Cash & Bank (ekstraksi rekening koran + mapping bank -> akun COA)): kosongkan SEMUA isi tabel
    financial_transaction_bank_cash_bank_mappings
    financial_transaction_bank_cash_import_templates
lalu jalankan SEMUA file seed *.sql di folder ini (urut nama file; file .sql
kosong dilewati). Rujukan FK dari tabel lain (mis. source files / statement
yang sudah di-upload) dilepas, BUKAN dihapus.

bank_mappings dihapus LEBIH DULU (merujuk template). Mapping bank yang dibuat
manual lewat aplikasi juga ikut terhapus -- cek jumlahnya di --dry-run.

Logika lengkap (cek klien, FK, satu transaksi, history): migrations/_reset_seed_template.py.

Cara pakai (dari folder backend):
    venv\Scripts\python migrations\bank_cash\reset_seed_template_bank_cash.py --dry-run
        -> jalankan semuanya lalu ROLLBACK (uji coba, tidak ada yang tersimpan)
    venv\Scripts\python migrations\bank_cash\reset_seed_template_bank_cash.py
        -> jalankan & simpan (minta konfirmasi ketik "yes"; pakai --yes untuk melewati)
    Opsi tambahan: --skip-missing-client (lewati seed yang kliennya belum ada)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _reset_seed_template import jalankan  # noqa: E402

if __name__ == "__main__":
    sys.exit(jalankan(Path(__file__).resolve().parent, "Bank & Cash", [
        "financial_transaction_bank_cash_bank_mappings",
        "financial_transaction_bank_cash_import_templates",
    ]))
