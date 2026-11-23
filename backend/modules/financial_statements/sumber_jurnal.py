"""Saklar sumber jurnal untuk Balance Sheet, Profit & Loss, Cash Flow, Notes (v1.py, fs_store.py).

Default (sejak 2026-11-23): SAMA dengan General Ledger / Trial Balance / Adjustment -- semua transaksi di
Journal Preview ikut dibaca (draft, pending, approved, posted, reversed). Yang rejected / void / cancelled /
dihapus tetap dikeluarkan (lihat db_client._syarat_status_gl). Jurnal penutup tahun buku tetap TIDAK dibaca
(termasuk_penutup=False), karena laba ditahan dihitung dari akun P&L.

Kembali ke perilaku lama (hanya posted): set environment FS_TERMASUK_BELUM_POSTED=false lalu restart backend.
"""
from __future__ import annotations

import os


def termasuk_belum_posted() -> bool:
    return os.getenv("FS_TERMASUK_BELUM_POSTED", "true").strip().lower() not in ("0", "false", "off", "no")