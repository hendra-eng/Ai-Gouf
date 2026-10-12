"""
migrations/35-create_bank_cash_import_templates.py
==================================================
Ekstraksi rekening koran Bank Feed (Cash & Bank) dengan template + validasi:

    financial_transaction_bank_cash_import_templates   BARU -- pola ekstraksi
        rekening koran per klien (versi Cash & Bank dari Sales/Purchase/Journal
        Entry Import Template, lihat root/SALES_IMPORT_TEMPLATES.md)

    financial_transaction_bank_cash_statements  + file_type, extraction_method,
        template_id (FK template, ON DELETE SET NULL), validation (JSONB)

    financial_transaction_bank_cash_mutations   + confidence (high/medium/low),
        confidence_notes (JSONB), page_no, reviewed_at, reviewed_by_name

Lihat ORM db_client.py::BankCashImportTemplate, ekstraktor
modules/transactions/bank_statement_extractor.py & router
modules/transactions/bank_cash_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\35-create_bank_cash_import_templates.py
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

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL_TEMPLATE = "financial_transaction_bank_cash_import_templates"
TABEL_STATEMENT = "financial_transaction_bank_cash_statements"
TABEL_MUTASI = "financial_transaction_bank_cash_mutations"

KOLOM_BARU = [
    (TABEL_STATEMENT, "file_type", "VARCHAR(20)"),
    (TABEL_STATEMENT, "extraction_method", "VARCHAR(20)"),
    (TABEL_STATEMENT, "template_id", "UUID"),
    (TABEL_STATEMENT, "validation", "JSONB"),
    (TABEL_MUTASI, "confidence", "VARCHAR(10)"),
    (TABEL_MUTASI, "confidence_notes", "JSONB"),
    (TABEL_MUTASI, "page_no", "INTEGER"),
    (TABEL_MUTASI, "reviewed_at", "TIMESTAMPTZ"),
    (TABEL_MUTASI, "reviewed_by_name", "VARCHAR(255)"),
]

CONSTRAINT = [
    (
        "fk statement -> template",
        "fk_bank_cash_statement_template",
        f"ALTER TABLE {TABEL_STATEMENT} ADD CONSTRAINT fk_bank_cash_statement_template "
        f"FOREIGN KEY (template_id) REFERENCES {TABEL_TEMPLATE}(id) ON DELETE SET NULL",
    ),
    (
        "ck confidence mutasi",
        "ck_bank_cash_mutation_confidence",
        f"ALTER TABLE {TABEL_MUTASI} ADD CONSTRAINT ck_bank_cash_mutation_confidence "
        "CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low'))",
    ),
    (
        "ck detected_by template",
        "ck_bank_cash_import_template_detected_by",
        f"ALTER TABLE {TABEL_TEMPLATE} ADD CONSTRAINT ck_bank_cash_import_template_detected_by "
        "CHECK (detected_by IN ('auto', 'manual'))",
    ),
]


def _buat_tabel(connection, nama: str, orm_class) -> bool:
    if nama in inspect(connection).get_table_names():
        print(f"⏭️  Tabel '{nama}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{nama}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        if "already exists" in str(e).lower():
            print(f"⏭️  Tabel '{nama}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{nama}': {e}")
        return False


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Cursor & commit lewat koneksi DBAPI mentah -- lihat catatan di migration 34
    # (connection.commit() SQLAlchemy tidak meng-commit DDL dari cursor mentah).
    raw = connection.connection
    try:
        with raw.cursor() as cur:
            cur.execute(sql)
        raw.commit()
        print(f"✅ {label} siap.")
        return True
    except Exception as e:
        raw.rollback()
        print(f"❌ Gagal {label}: {e}")
        return False


def _pasang_constraint(connection, label: str, nama: str, ddl: str) -> bool:
    ada = connection.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": nama}).first()
    if ada:
        print(f"⏭️  {label} sudah ada, skip.")
        return True
    return _jalankan_sql(connection, label, ddl)


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: Cash & Bank import template + confidence ekstraksi")
    print("=" * 60)

    from db_client import BankCashImportTemplate

    hasil = {}
    with engine.connect() as connection:
        if TABEL_STATEMENT not in inspect(connection).get_table_names():
            print("❌ Tabel Cash & Bank belum ada -- jalankan dulu migrations/34-create_bank_cash_tables.py.")
            return 1

        hasil[f"buat tabel {TABEL_TEMPLATE}"] = _buat_tabel(connection, TABEL_TEMPLATE, BankCashImportTemplate)

        for tabel, kolom, tipe in KOLOM_BARU:
            label = f"kolom {tabel}.{kolom}"
            hasil[label] = _jalankan_sql(connection, label, f"ALTER TABLE {tabel} ADD COLUMN IF NOT EXISTS {kolom} {tipe}")

        if all(hasil.values()):
            for label, nama, ddl in CONSTRAINT:
                hasil[label] = _pasang_constraint(connection, label, nama, ddl)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
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
