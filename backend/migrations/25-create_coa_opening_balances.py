"""
migrations/25-create_coa_opening_balances.py
=============================================
Fitur Management > COA > Opening Balances (saldo awal per tahun buku & cabang).
Menambahkan 2 tabel BARU:

    management_client_coa_opening_balances       header: klien + tahun buku +
        cabang (NULL = tanpa cabang), tanggal cut-off, akun penampung selisih,
        status draft/posted/locked, link ke jurnal Opening Balance.
    management_client_coa_opening_balance_lines  baris: 1 akun COA, debit
        ATAU kredit.

Saat di-post, 1 set menghasilkan 1 jurnal POSTED (source_type "Opening
Balance") di financial_transaction_journal_entry_drafts -- Financial
Statements membacanya sbg saldo awal tanpa perubahan kode FS. Lihat ORM
db_client.py::ManagementClientCoaOpeningBalance(Line) & router
modules/management/opening_balance_v1.py.

Tabel dibuat lewat ORM, lalu constraint tambahan (CHECK & unique index
parsial) dipasang terpisah -- startup main.py (create_all) bisa saja sudah
membuat tabelnya TANPA constraint ini, jadi langkah constraint tetap jalan
walau tabel sudah ada.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\25-create_coa_opening_balances.py
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

TABEL_HEADER = "management_client_coa_opening_balances"
TABEL_BARIS = "management_client_coa_opening_balance_lines"

# (nama, cek_sudah_ada_sql, ddl)
CONSTRAINT = [
    (
        "ck status header",
        "ck_management_client_coa_ob_status",
        f"ALTER TABLE {TABEL_HEADER} ADD CONSTRAINT ck_management_client_coa_ob_status "
        "CHECK (status IN ('draft', 'posted', 'locked'))",
    ),
    (
        "ck tahun buku",
        "ck_management_client_coa_ob_year",
        f"ALTER TABLE {TABEL_HEADER} ADD CONSTRAINT ck_management_client_coa_ob_year "
        "CHECK (fiscal_year BETWEEN 1900 AND 2999)",
    ),
    (
        "ck baris nominal",
        "ck_management_client_coa_ob_line_amount",
        f"ALTER TABLE {TABEL_BARIS} ADD CONSTRAINT ck_management_client_coa_ob_line_amount "
        "CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))",
    ),
]

# 1 set aktif per klien + tahun buku + cabang (NULL dianggap 1 nilai).
INDEX_UNIK = (
    "uq_management_client_coa_ob_client_year_branch",
    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_management_client_coa_ob_client_year_branch "
    f"ON {TABEL_HEADER} (client_id, fiscal_year, COALESCE(branch, '')) WHERE deleted_at IS NULL",
)


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


def _pasang_constraint(connection, label: str, nama: str, ddl: str) -> bool:
    ada = connection.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": nama}).first()
    if ada:
        print(f"⏭️  {label} sudah ada, skip.")
        return True
    try:
        connection.execute(text(ddl))
        connection.commit()
        print(f"✅ {label} terpasang.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"❌ Gagal pasang {label}: {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel opening balance COA")
    print("=" * 60)

    from db_client import ManagementClientCoaOpeningBalance, ManagementClientCoaOpeningBalanceLine

    hasil = {}
    with engine.connect() as connection:
        hasil[f"buat tabel {TABEL_HEADER}"] = _buat_tabel(connection, TABEL_HEADER, ManagementClientCoaOpeningBalance)
        hasil[f"buat tabel {TABEL_BARIS}"] = _buat_tabel(connection, TABEL_BARIS, ManagementClientCoaOpeningBalanceLine)
        if all(hasil.values()):
            for label, nama, ddl in CONSTRAINT:
                hasil[label] = _pasang_constraint(connection, label, nama, ddl)
            try:
                connection.execute(text(INDEX_UNIK[1]))
                connection.commit()
                print("✅ unique index klien + tahun + cabang siap.")
                hasil["unique index klien + tahun + cabang"] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal buat unique index: {e}")
                hasil["unique index klien + tahun + cabang"] = False

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
