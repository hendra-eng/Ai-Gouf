"""
migrations/58-create_fx_revaluation_runs.py
===========================================
Fase 3A fitur kurs: REVALUASI akhir periode saldo AR/AP valas -- modul
modules/finance/fx_revaluation_v1.py (/api/v1/finance/fx-revaluation/...).

Membuat tabel finance_fx_revaluation_runs (dari ORM FxRevaluationRun di db_client.py): riwayat run revaluasi
(jurnal revaluasi + jurnal pembalik otomatis tersimpan di financial_transaction_journal_entry_drafts,
source_type 'Revaluation'). Hanya satu run 'posted' per (klien, tanggal) -- dijaga unique index parsial.

Prasyarat: migration 56 (kurs master) dan 57 (kolom valas AR/AP).
Akun untung/rugi belum terealisasi diatur di Settings > Account Mapping > Foreign Exchange.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\58-create_fx_revaluation_runs.py
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

from sqlalchemy import inspect

from _history import catat_history
from db_client import engine

TABEL = "finance_fx_revaluation_runs"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: revaluasi kurs (finance_fx_revaluation_runs)")
    print("=" * 60)

    from db_client import Base, FxRevaluationRun

    with engine.connect() as connection:
        if TABEL in inspect(connection).get_table_names():
            print(f"⏭️  Tabel '{TABEL}' sudah ada, skip.")
            ok = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[FxRevaluationRun.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL}' berhasil dibuat.")
                ok = True
            except Exception as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL}': {e}")
                ok = False

    print("=" * 60)
    if ok:
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Migration gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
