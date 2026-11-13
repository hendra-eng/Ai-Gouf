"""
migrations/33-create_purchase_source_files_rows.py
===================================================
Menambahkan 2 tabel BARU untuk tab "Source Data" Purchase -- versi Purchase
dari financial_transaction_sales_source_files / _source_rows:

  - financial_transaction_purchase_source_files : 1 baris = 1 file yang diupload
    (status ekstraksi/mapping, jumlah baris, total DPP/PPN/Grand Total, template_id).
  - financial_transaction_purchase_source_rows  : 1 baris = 1 transaksi pembelian
    hasil parsing (staging sebelum jadi Purchase Transaction resmi lewat tombol
    "Buat Transaksi"); kolom `payload` menyimpan header+item lengkap.

Tabel lama financial_transaction_purchase_source_records (registri dokumen
PO/Invoice/GR) TIDAK disentuh.

WAJIB dijalankan SEBELUM backend yang baru dipakai (upload Purchase sekarang
menulis ke 2 tabel ini). Urutan: 15 (template) -> seed template -> 33 (ini).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ada di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\33-create_purchase_source_files_rows.py
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


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


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


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel purchase_source_files + purchase_source_rows")
    print("=" * 60)

    from db_client import PurchaseSourceFile, PurchaseSourceRow

    hasil = {}
    with engine.connect() as connection:
        # Urutan penting: source_rows punya FK ke source_files.
        hasil["buat tabel financial_transaction_purchase_source_files"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_purchase_source_files", PurchaseSourceFile
        )
        hasil["buat tabel financial_transaction_purchase_source_rows"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_purchase_source_rows", PurchaseSourceRow
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
