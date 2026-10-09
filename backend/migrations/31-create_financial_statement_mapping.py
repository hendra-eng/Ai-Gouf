"""
migrations/31-create_financial_statement_mapping.py
=====================================================
Fitur Financial Statements (Task Plan 16-20): tabel BARU untuk mapping
laporan keuangan & framework CALK.

    management_fs_mapping_rules          aturan default per prefix standard_account_code
                                         (cash flow, komponen ekuitas, note CALK) -- global
    management_client_fs_mappings        mapping per akun COA per klien ("master per client")
    management_fs_note_templates         template note CALK -- global
    management_client_fs_notes           note CALK per klien (salinan template / custom)
    management_client_fs_note_contents   isi note per periode (narasi + status)
    management_client_fs_note_overrides  override angka note ber-alasan (soft-delete)
    management_client_fs_note_audit      audit trail CALK (append-only)

Model ORM: db_client.py (ManagementFsMappingRule dst). Isi default:
    venv\\Scripts\\python migrations\\run_seed.py seed_fs_mapping_rules.sql
    venv\\Scripts\\python migrations\\run_seed.py seed_fs_note_templates.sql

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ada di-skip,
tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\31-create_financial_statement_mapping.py
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
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel mapping Financial Statements & CALK")
    print("=" * 60)

    from db_client import (
        Base,
        ManagementClientFsMapping,
        ManagementClientFsNote,
        ManagementClientFsNoteAudit,
        ManagementClientFsNoteContent,
        ManagementClientFsNoteOverride,
        ManagementFsMappingRule,
        ManagementFsNoteTemplate,
    )

    # Urutan penting: tabel yang di-FK harus dibuat lebih dulu.
    model_urut = [
        ManagementFsMappingRule,
        ManagementClientFsMapping,
        ManagementFsNoteTemplate,
        ManagementClientFsNote,
        ManagementClientFsNoteContent,
        ManagementClientFsNoteOverride,
        ManagementClientFsNoteAudit,
    ]

    hasil = {}
    with engine.connect() as connection:
        ada = set(inspect(connection).get_table_names())
        for model in model_urut:
            tabel = model.__tablename__
            label = f"buat tabel {tabel}"
            if tabel in ada:
                print(f"⏭️  Tabel '{tabel}' sudah ada, skip.")
                hasil[label] = True
                continue
            try:
                # create_all ikut membuat index di __table_args__ (termasuk partial unique index override).
                Base.metadata.create_all(bind=connection.engine, tables=[model.__table__])
                connection.commit()
                print(f"✅ Tabel '{tabel}' berhasil dibuat.")
                hasil[label] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{tabel}': {e}")
                hasil[label] = False
                break  # tabel berikutnya bisa bergantung ke tabel ini

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if hasil and all(hasil.values()) and len(hasil) == len(model_urut):
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
