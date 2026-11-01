"""
migrations/50-add_coa_source_acc_no.py
======================================
Source Account Code (kode akun sistem lama klien) di master COA:

    management_client_coa.source_acc_no  varchar(50) NULL

Diisi dari kolom "Source Account Code" saat batch Import Legacy COA di-approve
(modules/management/opening_balance_import_v1.py) atau lewat form COA. Kode
yang DITAMPILKAN di seluruh sistem = source_acc_no, kosong -> acc_no (kode
ZAFEB). acc_no tetap kunci internal (posting jurnal, mapping, laporan).

+ UNIQUE INDEX kode tampilan per klien: lower(coalesce(source_acc_no, acc_no))
  untuk akun yang belum dihapus -- 2 akun tidak boleh tampil dengan kode sama.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\50-add_coa_source_acc_no.py
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

from _history import catat_history
from db_client import engine

KOLOM = """
ALTER TABLE management_client_coa ADD COLUMN IF NOT EXISTS source_acc_no varchar(50);
CREATE UNIQUE INDEX IF NOT EXISTS uq_management_client_coa_display_code
    ON management_client_coa (client_id, lower(coalesce(source_acc_no, acc_no)))
    WHERE deleted_at IS NULL AND client_id IS NOT NULL;
"""


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Commit lewat koneksi DBAPI mentah (lihat catatan di migration 34).
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


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: Source Account Code di master COA")
    print("=" * 60)
    with engine.connect() as connection:
        ok = _jalankan_sql(connection, "kolom source_acc_no + unique kode tampilan", KOLOM)
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
