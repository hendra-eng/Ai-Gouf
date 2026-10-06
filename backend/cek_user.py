"""
cek_user.py
===========
Script sederhana untuk melihat isi tabel 'users' di database SQLite
(ai_gouf.db). Berguna untuk mengecek username yang sudah pernah dibuat
lewat buat_admin_awal.py.

CATATAN: Kolom password akan tampil dalam bentuk hash terenkripsi
(bukan teks asli), karena memang begitu cara password disimpan demi
keamanan. Hash TIDAK BISA dibalik jadi password asli.

Cara pakai:
    cd backend
    python cek_user.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "ai_gouf.db"


def main() -> None:
    if not DB_PATH.exists():
        print(f"[GAGAL] File database tidak ditemukan di: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. Tampilkan semua tabel yang ada (buat info tambahan)
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tabel_list = [row[0] for row in cur.fetchall()]
    print("Daftar tabel di database:")
    print(tabel_list)
    print()

    # 2. Cek isi tabel 'users'
    if "users" not in tabel_list:
        print("[GAGAL] Tabel 'users' tidak ditemukan di database.")
        conn.close()
        return

    cur.execute("SELECT * FROM users;")
    kolom = [desc[0] for desc in cur.description]
    baris_list = cur.fetchall()

    print("Kolom tabel 'users':")
    print(kolom)
    print()

    if not baris_list:
        print("Tabel 'users' masih kosong, belum ada data.")
    else:
        print(f"Jumlah user ditemukan: {len(baris_list)}")
        print("-" * 60)
        for baris in baris_list:
            data = dict(zip(kolom, baris))
            for key, value in data.items():
                print(f"{key}: {value}")
            print("-" * 60)

    conn.close()


if __name__ == "__main__":
    main()