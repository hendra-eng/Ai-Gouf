"""
migrations/purchase/33-create_purchase_source_files_rows.py
============================================================
Menambahkan 2 tabel BARU untuk tab "Source Data" Purchase -- versi Purchase
dari financial_transaction_sales_source_files / _source_rows:

  - financial_transaction_purchase_source_files : 1 baris = 1 file yang diupload
    (status ekstraksi/mapping, jumlah baris, total DPP/PPN/Grand Total, template_id).
  - financial_transaction_purchase_source_rows  : 1 baris = 1 transaksi pembelian
    hasil parsing (staging sebelum jadi Purchase Transaction resmi lewat tombol
    "Buat Transaksi"); kolom `payload` menyimpan header+item lengkap.

Tabel lama financial_transaction_purchase_source_records (registri dokumen
PO/Invoice/GR) TIDAK disentuh.

Tabel dibuat dari ORM db_client.py (PurchaseSourceFile / PurchaseSourceRow, disalin dari branch hendra).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ada di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\purchase\\33-create_purchase_source_files_rows.py
"""

import sys
from pathlib import Path

# File ini ada di migrations/purchase/ -> _history ada di migrations/, db_client & .env di backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine


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


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel purchase_source_files + purchase_source_rows")
    print("=" * 60)

    from db_client import PurchaseSourceFile, PurchaseSourceRow

    hasil = {}
    with engine.connect() as connection:
        # Urutan penting: source_rows punya FK ke source_files.
        hasil["tabel financial_transaction_purchase_source_files"] = _buat_tabel(
            connection, "financial_transaction_purchase_source_files", PurchaseSourceFile
        )
        hasil["tabel financial_transaction_purchase_source_rows"] = _buat_tabel(
            connection, "financial_transaction_purchase_source_rows", PurchaseSourceRow
        )

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<60}: {'✅' if v else '❌'}")
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
