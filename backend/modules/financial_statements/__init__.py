"""
modules/financial_statements/__init__.py
==========================================
Paket "financial_statements" -- REST API standar /api/v1/financial-statements/...
untuk halaman src/app/financial-statements/* (Laba Rugi, Neraca, Arus Kas,
Perubahan Ekuitas, CALK), pola sama dengan modules/transactions/.

    modules/financial_statements/core.py -- mesin hitung (tanpa DB).
    modules/financial_statements/v1.py   -- router endpoint.

Sumber datanya tabel fitur Transactions yang sudah POSTED (lihat
db_client.ambil_baris_jurnal_posted_transaksi).
"""

from . import v1  # noqa: F401
