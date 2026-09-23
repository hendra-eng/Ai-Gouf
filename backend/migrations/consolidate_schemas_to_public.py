"""
migrations/consolidate_schemas_to_public.py
============================================
Migration untuk konsolidasi seluruh tabel yang sebelumnya tersebar di 7
schema bernomor (dibuat manual lewat Supabase Table Editor) menjadi satu
schema `public` saja:

    1_app            -> public   (7 tabel:  coa, journal_lines,
                                   journal_entries, management_users,
                                   management_audit_trails,
                                   management_clients, core_sync_state)
    2_Overview       -> public   (2 tabel:  overview_management_branches,
                                   overview_financial_budget)
    3_Financial      -> public   (20 tabel: seluruh finance_transaction_*,
                                   finance_account_receivable_*,
                                   finance_account_payable_*,
                                   finance_financial_statement_*)
    4_Assets_Equity  -> public   (1 tabel:  asset_fixed_assets)
    5_Planning       -> public   (4 tabel:  planning_budget_forecast_*,
                                   planning_tax_compliance_*)
    6_Intelligence   -> public   (4 tabel:  intelligence_audit_*)
    7_Management     -> public   (3 tabel:  management_report_registry,
                                   management_report_schedule,
                                   management_documents)

Latar belakang: db_client.py sudah diubah supaya SEMUA model SQLAlchemy
tidak lagi menunjuk ke schema bernomor (lihat __table_args__ /
ForeignKey yang sudah tidak ada prefix "1_app."/"3_Financial."/dst) --
sekarang semuanya mengasumsikan tabel ada di `public`. Migration ini
yang menyesuaikan struktur database SUPABASE-nya supaya cocok dengan
kode tersebut. Kalau migration ini belum dijalankan di database kamu,
backend akan error "relation does not exist" begitu db_client.py versi
baru dipakai.

CATATAN KHUSUS constraint name collision:
    Tabel "3_Financial".finance_transaction_purchase_journal_lines
    ternyata primary key-nya salah diberi nama "journal_entries_pkey"
    (bentrok persis dengan pkey asli tabel journal_entries). Kalau
    dua-duanya dipindah ke schema yang sama, Postgres menolak karena
    nama constraint harus unik per-schema. Migration ini rename pkey
    journal_entries -> "journal_entries_pkey_app" dulu sebelum
    memindahkan tabelnya (aman, sekadar ganti nama constraint, tidak
    menyentuh data).

Operasi yang dipakai: ALTER TABLE ... SET SCHEMA public. Ini murni
operasi metadata Postgres -- TIDAK menyalin ulang baris data, TIDAK
mengubah isi tabel, dan foreign key antar tabel tetap valid apa pun
schema-nya. Setelah semua tabel dipindah, ketujuh schema lama (yang
jadi kosong) ikut dihapus.

AMAN DIPANGGIL BERKALI-KALI (idempoten):
    - Tabel yang sudah ada di public (baik karena memang sudah dipindah
      duluan, atau memang dari awal sudah di public) otomatis di-skip.
    - Schema yang sudah tidak ada (sudah pernah dihapus run sebelumnya)
      juga di-skip, tidak dianggap error.

Cara pakai:
    cd backend
    python migrations/consolidate_schemas_to_public.py
    (atau di Windows: venv\\Scripts\\python migrations\\consolidate_schemas_to_public.py)
"""

import sys
from pathlib import Path

# Bisa dijalankan langsung dari root backend (file ini sejajar dengan
# db_client.py) ATAU dari dalam folder migrations/ -- kedua kasus
# ditangani dengan menambahkan folder parent ke sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


# (schema_lama, nama_tabel) -> akan dipindah ke public
TABEL_YANG_DIPINDAH = [
    # 1_app
    ("1_app", "coa"),
    ("1_app", "journal_lines"),
    ("1_app", "journal_entries"),
    ("1_app", "management_users"),
    ("1_app", "management_audit_trails"),
    ("1_app", "management_clients"),
    ("1_app", "core_sync_state"),
    # 2_Overview
    ("2_Overview", "overview_management_branches"),
    ("2_Overview", "overview_financial_budget"),
    # 3_Financial
    ("3_Financial", "finance_transaction_purchase_vendor"),
    ("3_Financial", "finance_transaction_purchase_transaction"),
    ("3_Financial", "finance_transaction_purchase_source_data"),
    ("3_Financial", "finance_transaction_purchase_line_items"),
    ("3_Financial", "finance_transaction_purchase_journal_lines"),
    ("3_Financial", "finance_transaction_purchase_exceptions"),
    ("3_Financial", "finance_transaction_purchase_activity_log"),
    ("3_Financial", "finance_transaction_bank_cash"),
    ("3_Financial", "finance_transaction_bank_cash_activity_log"),
    ("3_Financial", "finance_transaction_other"),
    ("3_Financial", "finance_transaction_other_activity_log"),
    ("3_Financial", "finance_account_receivable_ar_customer"),
    ("3_Financial", "finance_account_receivable_ar_invoice"),
    ("3_Financial", "finance_account_receivable_ar_payment"),
    ("3_Financial", "finance_account_receivable_ar_collection_note"),
    ("3_Financial", "finance_account_payable_ap_payment"),
    ("3_Financial", "finance_account_payable_ap_note"),
    ("3_Financial", "finance_financial_statement_profit_loss_insights"),
    ("3_Financial", "finance_financial_statement_cash_flow_forecast"),
    ("3_Financial", "finance_financial_statement_profit_loss_budget_line"),
    # 4_Assets_Equity
    ("4_Assets_Equity", "asset_fixed_assets"),
    # 5_Planning
    ("5_Planning", "planning_budget_forecast_assumption"),
    ("5_Planning", "planning_budget_forecast_scenario"),
    ("5_Planning", "planning_tax_compliance_fiscal_correction"),
    ("5_Planning", "planning_tax_compliance_task"),
    # 6_Intelligence
    ("6_Intelligence", "intelligence_audit_finding"),
    ("6_Intelligence", "intelligence_audit_stage"),
    ("6_Intelligence", "intelligence_audit_activity"),
    ("6_Intelligence", "intelligence_audit_evidence"),
    # 7_Management
    ("7_Management", "management_report_registry"),
    ("7_Management", "management_report_schedule"),
    ("7_Management", "management_documents"),
]

SCHEMA_LAMA = [
    "1_app", "2_Overview", "3_Financial",
    "4_Assets_Equity", "5_Planning", "6_Intelligence", "7_Management",
]


def _tabel_ada_di_schema(connection, schema: str, table: str) -> bool:
    row = connection.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = :schema AND table_name = :table"
        ),
        {"schema": schema, "table": table},
    ).first()
    return row is not None


def _constraint_ada(connection, schema: str, conname: str) -> bool:
    row = connection.execute(
        text(
            "SELECT 1 FROM pg_constraint con "
            "JOIN pg_class c ON c.oid = con.conrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = :schema AND con.conname = :conname"
        ),
        {"schema": schema, "conname": conname},
    ).first()
    return row is not None


def _fix_pkey_collision(connection) -> None:
    """Rename pkey journal_entries di 1_app sebelum dipindah, supaya
    tidak bentrok dengan pkey (yang salah nama) milik
    finance_transaction_purchase_journal_lines saat keduanya jadi satu
    schema."""
    if not _tabel_ada_di_schema(connection, "1_app", "journal_entries"):
        return  # sudah dipindah / tidak ada -> tidak relevan lagi
    if _constraint_ada(connection, "1_app", "journal_entries_pkey_app"):
        return  # rename sudah pernah dijalankan
    if not _constraint_ada(connection, "1_app", "journal_entries_pkey"):
        return  # nama constraint sudah berbeda dari asumsi -- skip, jangan tebak
    try:
        connection.execute(
            text('ALTER TABLE "1_app".journal_entries RENAME CONSTRAINT journal_entries_pkey TO journal_entries_pkey_app')
        )
        connection.commit()
        print("✅ Rename constraint 'journal_entries_pkey' -> 'journal_entries_pkey_app' (hindari bentrok nama).")
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"⚠️  Gagal rename constraint journal_entries_pkey: {e}")


def _pindahkan_tabel(connection, schema: str, table: str) -> bool:
    if _tabel_ada_di_schema(connection, "public", table) and not _tabel_ada_di_schema(connection, schema, table):
        print(f"⏭️  '{table}' sudah di public, skip.")
        return True
    if not _tabel_ada_di_schema(connection, schema, table):
        print(f"⏭️  '{schema}.{table}' tidak ditemukan (mungkin sudah dipindah atau memang tidak ada), skip.")
        return True
    try:
        connection.execute(text(f'ALTER TABLE "{schema}".{table} SET SCHEMA public'))
        connection.commit()
        print(f"✅ '{schema}.{table}' -> 'public.{table}'")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"❌ Gagal pindahkan '{schema}.{table}': {e}")
        return False


def _hapus_schema_kosong(connection, schema: str) -> bool:
    row = connection.execute(
        text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :schema"),
        {"schema": schema},
    ).first()
    if row is None:
        print(f"⏭️  Schema '{schema}' sudah tidak ada, skip.")
        return True
    sisa = connection.execute(
        text("SELECT count(*) FROM information_schema.tables WHERE table_schema = :schema"),
        {"schema": schema},
    ).scalar()
    if sisa and sisa > 0:
        print(f"⚠️  Schema '{schema}' masih punya {sisa} tabel tersisa, TIDAK dihapus (cek manual).")
        return False
    try:
        connection.execute(text(f'DROP SCHEMA "{schema}" RESTRICT'))
        connection.commit()
        print(f"✅ Schema '{schema}' dihapus (sudah kosong).")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"⚠️  Gagal hapus schema '{schema}' (mungkin masih ada objek lain seperti sequence/view): {e}")
        return False


def main() -> int:
    print("=" * 70)
    print("🔄 MIGRATION: Konsolidasi schema 1_app..7_Management -> public")
    print("=" * 70)

    hasil_pindah = {}
    with engine.connect() as connection:
        _fix_pkey_collision(connection)
        for schema, table in TABEL_YANG_DIPINDAH:
            hasil_pindah[f"{schema}.{table}"] = _pindahkan_tabel(connection, schema, table)

        print()
        print("-" * 70)
        print("🗑️  Menghapus schema lama yang sudah kosong...")
        print("-" * 70)
        hasil_hapus = {}
        for schema in SCHEMA_LAMA:
            hasil_hapus[schema] = _hapus_schema_kosong(connection, schema)

    print()
    print("=" * 70)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 70)
    gagal_pindah = [k for k, v in hasil_pindah.items() if not v]
    gagal_hapus = [k for k, v in hasil_hapus.items() if not v]
    print(f"Tabel dipindah  : {len(hasil_pindah) - len(gagal_pindah)}/{len(hasil_pindah)} berhasil")
    print(f"Schema dihapus  : {len(hasil_hapus) - len(gagal_hapus)}/{len(hasil_hapus)} berhasil")
    if gagal_pindah:
        print(f"❌ Tabel gagal dipindah: {gagal_pindah}")
    if gagal_hapus:
        print(f"⚠️  Schema belum terhapus: {gagal_hapus}")
    print("=" * 70)

    if not gagal_pindah and not gagal_hapus:
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada langkah yang gagal/perlu dicek manual. Lihat log di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())