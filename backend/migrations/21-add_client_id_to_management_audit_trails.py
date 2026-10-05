"""
migrations/21-add_client_id_to_management_audit_trails.py
==========================================================
Menambah kolom client_id (company, FK management_clients) ke
management_audit_trails.

Hasil merge playground-hendra: model AuditLog di db_client.py sekarang
memetakan tabel management_audit_trails dan menyimpan client_id supaya
riwayat "aksi di client mana" tidak hilang (log_audit / get_audit_history).
Di Supabase playground-hendra kolom ini sudah ada; di DB playground-willi
belum, sehingga setiap insert audit trail gagal diam-diam.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- ADD COLUMN IF NOT EXISTS, tidak
ada data yang diubah. Baris lama tetap client_id NULL.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\21-add_client_id_to_management_audit_trails.py
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

TABEL = "management_audit_trails"
LANGKAH = [
    ("kolom client_id",
     f"ALTER TABLE {TABEL} ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES management_clients(id)"),
    ("index client_id",
     f"CREATE INDEX IF NOT EXISTS idx_management_audit_trails_client_id ON {TABEL} (client_id)"),
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: client_id di management_audit_trails")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada -- jalankan dulu 5-sync_management_tables_ddl.py.")
            return 1
        for nama, sql in LANGKAH:
            try:
                connection.execute(text(sql))
                connection.commit()
                print(f"✅ {nama} siap.")
                hasil[nama] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal {nama}: {e}")
                hasil[nama] = False

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
