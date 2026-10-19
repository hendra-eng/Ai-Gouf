"""
migrations/37-create_bank_cash_statements_and_mutations.py
==========================================================
Membuat 2 tabel untuk Cash & Bank > Source Data:
  - financial_transaction_bank_cash_statements  (1 baris = 1 file rekening koran yang diimport)
  - financial_transaction_bank_cash_mutations   (1 baris = 1 mutasi / baris rekening koran)

WAJIB sesudah migration 36 (butuh tabel template & bank mapping). IDEMPOTEN (CREATE ... IF NOT EXISTS).
Catatan: bank_cash_v1.py juga membuat tabel ini otomatis saat endpoint pertama dipanggil, jadi
menjalankan file ini opsional -- berguna kalau mau tabelnya ada sebelum backend dijalankan.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\37-create_bank_cash_statements_and_mutations.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass


def main() -> int:
    from modules.transactions import bank_cash_v1

    try:
        bank_cash_v1.pastikan_tabel()
    except Exception as e:  # noqa: BLE001
        print(f"❌ Gagal: {getattr(e, 'msg', e)}")
        return 1
    print("✅ Tabel financial_transaction_bank_cash_statements & _mutations siap.")
    try:
        from _history import catat_history
        catat_history(Path(__file__).name)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())