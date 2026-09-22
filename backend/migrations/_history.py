"""
migrations/_history.py
======================
Pencatat "file migration/seed mana saja yang sudah dijalankan" ke
migrations/history-migration.md -- supaya tidak bingung kalau file
migration & seed sudah banyak (mana yang sudah dijalankan di database ini?).

Format file catatan: daftar polos, SATU NAMA FILE PER BARIS (mengikuti
format yang sudah ada di history-migration.md). Aturan:

- Nama file yang sudah ada di daftar TIDAK ditulis dobel (migration di sini
  idempoten, jadi sering dijalankan ulang).
- Gaya line ending file (CRLF/LF) dipertahankan.
- Pencatatan yang gagal (mis. file terkunci) TIDAK menggagalkan migration --
  cuma menampilkan peringatan.

Dipanggil dari tiap script migration & dari run_seed.py, hanya kalau
script-nya BERHASIL:

    from _history import catat_history
    catat_history(Path(__file__).name)
"""

from pathlib import Path
from typing import Optional

FILE_HISTORY = Path(__file__).resolve().parent / "history-migration.md"


def catat_history(nama_file: str, path: Optional[Path] = None) -> bool:
    """Tambahkan `nama_file` ke history-migration.md kalau belum tercatat.
    Return True kalau baris baru ditulis, False kalau sudah ada / gagal."""
    target = Path(path) if path else FILE_HISTORY
    try:
        isi = target.read_bytes().decode("utf-8") if target.exists() else ""
        if nama_file in [baris.strip() for baris in isi.splitlines()]:
            print(f"📝 '{nama_file}' sudah tercatat di {target.name}, skip.")
            return False

        nl = "\r\n" if "\r\n" in isi or not isi else "\n"
        awalan = "" if (not isi or isi.endswith("\n")) else nl  # file lama bisa tanpa newline di akhir
        with open(target, "ab") as f:
            f.write((awalan + nama_file + nl).encode("utf-8"))
        print(f"📝 '{nama_file}' dicatat ke {target.name}.")
        return True
    except Exception as e:  # noqa: BLE001 -- pencatatan tidak boleh menggagalkan migration
        print(f"⚠️  Gagal mencatat '{nama_file}' ke {target.name}: {e}")
        return False
