"""
migrations/23-drop_legacy_and_finance_tables.py
================================================
Bersih-bersih DB (task-claude.md, 2026-10-04): DROP tabel legacy &
tabel `finance_*` (kerjaan playground-hendra -- akan dibangun ulang).

Kode BE-nya SUDAH dibongkar di commit yang sama (ORM model di
db_client.py, fungsi CRUD-nya, router & endpoint yang memakainya). Ini
PENTING: startup main.py menjalankan Base.metadata.create_all(), jadi
kalau model-nya masih ada, tabel yang di-drop di sini akan dibuat ulang
(kosong) begitu backend restart.

Tabel yang SENGAJA DIPERTAHANKAN (inti auth & posting engine):
    user_client_access, standard_accounts, account_roles,
    coa_standard_mapping, company_account_roles
FK dari tabel-tabel ini ke `clients`/`coa` ikut hilang (DROP ... CASCADE
hanya membuang CONSTRAINT FK-nya, bukan tabel/kolom yang merujuk). Begitu
juga FK journal_entry_id di financial_transaction_sales_invoices /
_journal_entry_drafts / _purchase_transactions -> journal_entries
(kolomnya tetap ada, nilainya memang selalu NULL di DB ini).

PENGAMAN: migration BERHENTI (tidak ada yang di-drop) kalau ada tabel
target yang masih berisi data, kecuali:
- `users` (login lama) -- boleh berisi, ASAL semua username-nya sudah ada
  di management_users (sama dengan pengaman migration 13).
Untuk tetap men-drop tabel berisi data, jalankan dengan argumen --paksa.

Semua DROP dijalankan dalam SATU transaksi: gagal satu, batal semua.
AMAN DIPANGGIL BERKALI-KALI (idempoten) -- DROP TABLE IF EXISTS.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\23-drop_legacy_and_finance_tables.py
    venv\\Scripts\\python migrations\\23-drop_legacy_and_finance_tables.py --paksa
"""

import sys
from pathlib import Path

# Console Windows default-nya cp1252 -> print() emoji melempar
# UnicodeEncodeError. Paksa UTF-8 (pola sama dengan migration lain).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import os
if not os.environ.get("DATABASE_URL"):
    sys.exit(
        "❌ DATABASE_URL tidak terbaca dari backend/.env.\n"
        "   Jalankan pakai Python venv project (butuh python-dotenv):\n"
        "   venv\\Scripts\\python migrations\\23-drop_legacy_and_finance_tables.py"
    )

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine
from _history import catat_history

# Tabel non-`finance_` yang di-drop. Semua tabel ber-awalan `finance_`
# dicari otomatis dari database (lihat _daftar_target()).
TABEL_DROP = [
    "alert_anomali",
    "audit_log",
    "bank_feed_mutation",
    "clients",
    "coa",
    "esb_accounts",
    "hasil",
    "hasil_analisis",
    "hasil_esb",
    "intelligence_audit_activity",
    "intelligence_audit_evidence",
    "intelligence_audit_finding",
    "intelligence_audit_stage",
    "journal_entries",
    "journal_lines",
    "jurnal_posting",  # di task tertulis "journal_posting" -- yang ada di DB jurnal_posting (dikonfirmasi user)
    "laporan_keuangan",
    "overview_financial_budget",
    "overview_management_branches",
    "percakapan",
    "pertanyaan_klarifikasi",
    "pesan_chat",
    "planning_budget_forecast_assumption",
    "planning_budget_forecast_scenario",
    "planning_tax_compliance_fiscal_correction",
    "planning_tax_compliance_task",
    "pola_augmentasi",
    "reminder_deadline_spt",
    "riwayat_saldo_bulanan",
    "upload_batches",
    "users",
    "voucher_counter",
]

TABEL_DIPERTAHANKAN = {
    "user_client_access", "standard_accounts", "account_roles",
    "coa_standard_mapping", "company_account_roles",
}


def _daftar_target(connection) -> list:
    ada = set(inspect(connection).get_table_names())
    finance = sorted(t for t in ada if t.startswith("finance_"))
    target = [t for t in TABEL_DROP + finance if t in ada]
    assert not (set(target) & TABEL_DIPERTAHANKAN)
    return target


def _cek_aman(connection, target: list, paksa: bool) -> bool:
    berisi = {}
    for t in target:
        n = connection.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
        if n:
            berisi[t] = n

    if "users" in berisi:
        belum = connection.execute(text(
            "SELECT u.username FROM users u "
            "WHERE NOT EXISTS (SELECT 1 FROM management_users m WHERE m.username = u.username)"
        )).fetchall()
        if belum and not paksa:
            print(f"❌ {len(belum)} user di tabel 'users' lama belum ada di management_users: "
                  f"{', '.join(r[0] for r in belum)}")
            print("   Jalankan dulu migrations/2-add_management_users_auth.py.")
            return False
        berisi.pop("users")

    if berisi and not paksa:
        print("❌ Tabel berikut MASIH BERISI DATA -- tidak ada yang di-drop:")
        for t, n in berisi.items():
            print(f"   - {t}: {n} baris")
        print("   Backup dulu kalau perlu, lalu jalankan ulang dengan --paksa.")
        return False
    for t, n in berisi.items():
        print(f"⚠️  --paksa: '{t}' di-drop beserta {n} baris datanya.")
    return True


def main() -> int:
    paksa = "--paksa" in sys.argv[1:]
    print("=" * 60)
    print("🔄 MIGRATION: drop tabel legacy & finance_*")
    print("=" * 60)

    with engine.connect() as connection:
        target = _daftar_target(connection)
        if not target:
            print("⏭️  Semua tabel target sudah tidak ada, skip.")
            catat_history(Path(__file__).name)
            return 0

        print(f"🎯 {len(target)} tabel akan di-drop:")
        for t in target:
            print(f"   - {t}")

        if not _cek_aman(connection, target, paksa):
            connection.rollback()
            return 1

        try:
            daftar = ", ".join(f'"{t}"' for t in target)
            connection.execute(text(f"DROP TABLE IF EXISTS {daftar} CASCADE"))
            connection.commit()
        except (OperationalError, ProgrammingError) as e:
            connection.rollback()
            print(f"❌ Gagal drop (semua dibatalkan): {e}")
            return 1

        sisa = [t for t in target if t in set(inspect(connection).get_table_names())]

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    if sisa:
        print(f"❌ Masih ada tabel tersisa: {', '.join(sisa)}")
        return 1
    print(f"✅ {len(target)} tabel berhasil di-drop.")
    catat_history(Path(__file__).name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
