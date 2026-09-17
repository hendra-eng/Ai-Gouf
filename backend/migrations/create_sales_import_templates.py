"""
migrations/create_sales_import_templates.py
=============================================
Menambahkan fitur "belajar pola" import file laporan penjualan (CSV/Excel)
-- lihat root/SALES_IMPORT_TEMPLATES.md untuk alur lengkapnya. Migration ini
mengerjakan 3 hal:

1. Tabel BARU `financial_transaction_sales_import_templates` -- pola kolom
   (mapping_rules) yang sudah "dipelajari" per klien+format file, supaya
   file berikutnya dari klien+format yang sama langsung diekstrak tanpa
   panggil AI lagi.
2. Kolom BARU di `financial_transaction_sales_source_files`:
   - `management_client_id` (UUID NOT NULL -> management_clients.id) --
     klien yang laporannya sedang diupload, WAJIB dipilih user lewat
     dropdown saat upload. Tabel ini masih kosong di semua environment
     yang sudah menjalankan migration sebelumnya (create_financial_
     transaction_sales_tables.py), jadi NOT NULL aman ditambahkan
     langsung -- migration ini akan BERHENTI dengan pesan error yang
     jelas (bukan diam-diam gagal) kalau ternyata sudah ada baris.
   - `template_id` (UUID, nullable -> financial_transaction_sales_import_
     templates.id) -- template mana yang dipakai/cocok untuk file ini.
3. Foreign key + index untuk kedua kolom baru itu.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel/kolom/constraint yang
sudah ada di-skip, tidak ada data yang dihapus atau ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\create_sales_import_templates.py
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

from db_client import engine


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _kolom_ada(connection, table: str, kolom: str) -> bool:
    if not _tabel_ada(connection, table):
        return False
    inspector = inspect(connection)
    return kolom in [c["name"] for c in inspector.get_columns(table)]


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
    if _tabel_ada(connection, table_name):
        print(f"⏭️  Tabel '{table_name}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{table_name}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        connection.rollback()
        return False


def _tambah_kolom_jika_belum_ada(connection, table: str, kolom: str, ddl_type: str) -> bool:
    if _kolom_ada(connection, table, kolom):
        print(f"⏭️  Kolom '{table}.{kolom}' sudah ada, skip.")
        return True
    if not _tabel_ada(connection, table):
        print(f"⏭️  Tabel '{table}' belum ada, skip tambah kolom '{kolom}'.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {kolom} {ddl_type}"))
        connection.commit()
        print(f"✅ Kolom '{table}.{kolom}' ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"⏭️  Kolom '{table}.{kolom}' sudah ada (terdeteksi via error), skip.")
            connection.rollback()
            return True
        print(f"❌ Gagal tambah kolom '{table}.{kolom}': {e}")
        connection.rollback()
        return False


def _tambah_fk_jika_belum_ada(connection, table: str, column: str, constraint_name: str, ddl_fk: str) -> bool:
    """[FIX] Sebelumnya cek "sudah ada" dengan mencocokkan conname PERSIS ke
    constraint_name yang diminta -- tapi nama tabel+kolom di fitur ini
    ("financial_transaction_sales_source_files_management_client_id_fkey",
    dst) lebih panjang dari batas identifier Postgres (NAMEDATALEN 63
    byte), jadi constraint yang BENERAN dibuat (baik oleh SQLAlchemy
    create_all ATAU oleh ALTER TABLE di sini) otomatis TERPOTONG oleh
    Postgres, dan potongannya TIDAK PERNAH cocok dengan constraint_name asli
    yang dicari SELECT-nya. Akibatnya check ini selalu bilang "belum ada"
    padahal FK-nya sudah ada (dibuat inline saat CREATE TABLE), lalu ALTER
    TABLE di bawah membuat constraint KEDUA yang redundan (nama potongannya
    beda lagi, jadi tidak konflik/error, tapi tetap dua FK utk relasi yang
    sama). Sekarang dicek berdasarkan KOLOM (ada/tidaknya FK apa pun di
    kolom itu), bukan nama constraint -- kebal terhadap pemotongan nama."""
    try:
        # [FIX] "CAST(:tabel AS regclass)", BUKAN ":tabel::regclass" --
        # sintaks "::" Postgres bentrok dengan cara SQLAlchemy text()
        # mem-parsing placeholder ":nama" (dianggap bagian dari nama
        # placeholder itu sendiri), bikin query gagal parse setiap kali
        # dipanggil -- lolos diam-diam karena except di bawah menangkap
        # ProgrammingError apa pun (termasuk salah dialect) sebagai
        # "skip diam-diam" tanpa print, jadi tidak kelihatan sebagai galat.
        sudah_ada = connection.execute(text("""
            SELECT 1
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = CAST(:tabel AS regclass)
              AND c.contype = 'f'
              AND a.attname = :kolom
        """), {"tabel": table, "kolom": column}).first()
    except (OperationalError, ProgrammingError):
        connection.rollback()
        return True  # bukan Postgres (mis. SQLite lokal) -- skip diam-diam
    if sudah_ada:
        print(f"⏭️  Constraint '{constraint_name}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {constraint_name} {ddl_fk}"))
        connection.commit()
        print(f"✅ Constraint '{constraint_name}' ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Constraint '{constraint_name}' sudah ada (terdeteksi via error), skip.")
            connection.rollback()
            return True
        print(f"❌ Gagal tambah constraint '{constraint_name}': {e}")
        connection.rollback()
        return False


def _tambah_index_jika_belum_ada(connection, index_name: str, ddl_index: str) -> bool:
    try:
        ada = connection.execute(text(
            "SELECT 1 FROM pg_indexes WHERE indexname = :nama"
        ), {"nama": index_name}).first()
    except (OperationalError, ProgrammingError):
        connection.rollback()
        return True
    if ada:
        print(f"⏭️  Index '{index_name}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(ddl_index))
        connection.commit()
        print(f"✅ Index '{index_name}' ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Index '{index_name}' sudah ada (terdeteksi via error), skip.")
            connection.rollback()
            return True
        print(f"❌ Gagal tambah index '{index_name}': {e}")
        connection.rollback()
        return False


def _pastikan_source_files_kosong_atau_batal(connection) -> bool:
    """management_client_id ditambahkan sebagai NOT NULL -- ini HANYA aman
    kalau financial_transaction_sales_source_files masih kosong (tidak ada
    baris lama yang otomatis harus diisi entah dengan apa). Kalau tabelnya
    belum ada sama sekali, aman juga (kolom NOT NULL ikut terbentuk begitu
    tabel dibuat lewat migration create_financial_transaction_sales_tables.py
    berikutnya)."""
    if not _tabel_ada(connection, "financial_transaction_sales_source_files"):
        return True
    if _kolom_ada(connection, "financial_transaction_sales_source_files", "management_client_id"):
        return True  # kolomnya sudah pernah ditambahkan sebelumnya, tidak perlu cek ulang
    jumlah = connection.execute(text(
        "SELECT COUNT(*) FROM financial_transaction_sales_source_files"
    )).scalar()
    if jumlah and jumlah > 0:
        print(
            f"❌ financial_transaction_sales_source_files sudah punya {jumlah} baris data, "
            "tidak bisa menambahkan kolom management_client_id sebagai NOT NULL begitu saja "
            "(baris lama tidak tahu harus diisi klien mana). Isi manual dulu kolom itu untuk "
            "baris yang sudah ada, atau tambahkan kolomnya sebagai NULLABLE dulu lalu enforce "
            "NOT NULL belakangan setelah semua baris terisi."
        )
        return False
    return True


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: fitur Sales Import Templates (belajar pola kolom file laporan)")
    print("=" * 60)

    from db_client import SalesImportTemplate

    hasil = {}
    with engine.connect() as connection:
        if not _pastikan_source_files_kosong_atau_batal(connection):
            return 1

        # 1) Tabel baru financial_transaction_sales_import_templates --
        #    HARUS dibuat duluan karena source_files.template_id (langkah 2)
        #    punya FK ke tabel ini.
        hasil["buat tabel financial_transaction_sales_import_templates"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_sales_import_templates", SalesImportTemplate
        )

        # 2) Kolom baru di financial_transaction_sales_source_files
        hasil["source_files.management_client_id"] = _tambah_kolom_jika_belum_ada(
            connection, "financial_transaction_sales_source_files", "management_client_id",
            "uuid NOT NULL",
        )
        hasil["source_files.template_id"] = _tambah_kolom_jika_belum_ada(
            connection, "financial_transaction_sales_source_files", "template_id", "uuid",
        )

        # 3) Foreign key & index
        hasil["FK source_files.management_client_id -> management_clients.id"] = _tambah_fk_jika_belum_ada(
            connection,
            "financial_transaction_sales_source_files",
            "management_client_id",
            "financial_transaction_sales_source_files_management_client_id_fkey",
            "FOREIGN KEY (management_client_id) REFERENCES management_clients(id)",
        )
        hasil["FK source_files.template_id -> import_templates.id"] = _tambah_fk_jika_belum_ada(
            connection,
            "financial_transaction_sales_source_files",
            "template_id",
            "financial_transaction_sales_source_files_template_id_fkey",
            "FOREIGN KEY (template_id) REFERENCES financial_transaction_sales_import_templates(id)",
        )
        hasil["index source_files.management_client_id"] = _tambah_index_jika_belum_ada(
            connection,
            "idx_sales_source_files_management_client",
            "CREATE INDEX idx_sales_source_files_management_client ON financial_transaction_sales_source_files(management_client_id)",
        )
        hasil["index source_files.template_id"] = _tambah_index_jika_belum_ada(
            connection,
            "idx_sales_source_files_template",
            "CREATE INDEX idx_sales_source_files_template ON financial_transaction_sales_source_files(template_id)",
        )

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
