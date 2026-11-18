r"""
migrations/61-je_number_unique_per_client.py
============================================
Nomor jurnal (je_number) unik PER KLIEN, bukan per user.

Constraint lama uq_je_drafts_client_number = UNIQUE (client_id, je_number), padahal
financial_transaction_journal_entry_drafts.client_id berisi id USER yang login
(FK management_users). Akibatnya 1 user yang mem-post opening balance 2 klien sama-sama
tanpa branch (keduanya OB-<FY>-HO) kena UniqueViolation -> 500 (kasus NBM vs SAU di VPS),
dan nomor yang sama di klien lain juga ikut bentrok untuk user yang sama.

Pengganti: unique index uq_je_drafts_mclient_number = (management_client_id, je_number)
WHERE deleted_at IS NULL -- sama dengan pre-check db_client.get_je_draft_by_client_and_number
(jurnal yang sudah dihapus tidak menahan nomornya).

Migration DIBATALKAN (tidak mengubah apa pun) kalau masih ada nomor dobel dalam 1 klien;
daftar dobelnya dicetak supaya dibereskan dulu.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\61-je_number_unique_per_client.py
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

from sqlalchemy import text

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_journal_entry_drafts"

SQL_CEK_DOBEL = f"""
    SELECT management_client_id, je_number, count(*) AS n
    FROM {TABEL}
    WHERE deleted_at IS NULL AND management_client_id IS NOT NULL
    GROUP BY management_client_id, je_number
    HAVING count(*) > 1
    ORDER BY n DESC
    LIMIT 50
"""

SQL = [
    f"ALTER TABLE {TABEL} DROP CONSTRAINT IF EXISTS uq_je_drafts_client_number",
    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_je_drafts_mclient_number ON {TABEL} (management_client_id, je_number) "
    "WHERE deleted_at IS NULL",
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: je_number unik per klien (management_client_id)")
    print("=" * 60)
    ok = False
    with engine.connect() as connection:
        try:
            dobel = connection.execute(text(SQL_CEK_DOBEL)).fetchall()
            if dobel:
                print("❌ Masih ada je_number dobel dalam 1 klien -- bereskan dulu, lalu jalankan ulang:")
                for mcid, no, n in dobel:
                    print(f"   - klien {mcid}: {no} ({n}x)")
            else:
                for q in SQL:
                    connection.execute(text(q))
                connection.commit()
                print("✅ Constraint lama dihapus, unique index (management_client_id, je_number) siap.")
                ok = True
        except Exception as e:
            connection.rollback()
            print(f"❌ Gagal: {e}")

    print("=" * 60)
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
