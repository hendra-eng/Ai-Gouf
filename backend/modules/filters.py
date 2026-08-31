"""
modules/filters.py
===================
Filter & pencarian lanjutan untuk DataFrame jurnal:
- Rentang nominal (min-max)
- Rentang periode (tanggal mulai - akhir)
- Full-text search di kolom keterangan (atau kolom lain yang dipilih)
- Filter per bank / sumber kategori

Didesain murni (tanpa Streamlit) supaya mudah diuji; UI-nya (widget filter)
dirender langsung di app.py memakai fungsi `filter_dataframe` di bawah.
"""

from __future__ import annotations

from typing import Optional, List

import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("filters")


def filter_dataframe(
    df: pd.DataFrame,
    nominal_min: Optional[float] = None,
    nominal_max: Optional[float] = None,
    tanggal_mulai=None,
    tanggal_akhir=None,
    kata_kunci: Optional[str] = None,
    kolom_pencarian: Optional[List[str]] = None,
    bank: Optional[List[str]] = None,
    sumber_kategori: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Terapkan semua filter yang diisi (None/kosong = tidak difilter).

    Args:
        df: DataFrame jurnal
        nominal_min/max: rentang nominal (dicek terhadap jml_debet ATAU jml_kredit)
        tanggal_mulai/akhir: rentang tanggal (kolom 'tanggal')
        kata_kunci: teks pencarian bebas (case-insensitive)
        kolom_pencarian: kolom yang dicari kata_kunci-nya (default: ['keterangan'])
        bank: list nama bank yang di-include
        sumber_kategori: list sumber kategori yang di-include

    Returns:
        DataFrame hasil filter (copy, tidak mengubah df asli)
    """
    if df is None or df.empty:
        return df

    hasil = df.copy()

    # Filter nominal
    if nominal_min is not None or nominal_max is not None:
        kolom_nominal = [c for c in ["jml_debet", "jml_kredit"] if c in hasil.columns]
        if kolom_nominal:
            nominal_terbesar = hasil[kolom_nominal].max(axis=1)
            if nominal_min is not None:
                hasil = hasil[nominal_terbesar >= nominal_min]
                nominal_terbesar = nominal_terbesar[hasil.index]
            if nominal_max is not None:
                hasil = hasil[nominal_terbesar <= nominal_max]

    # Filter tanggal
    if "tanggal" in hasil.columns and (tanggal_mulai is not None or tanggal_akhir is not None):
        tgl = pd.to_datetime(hasil["tanggal"], errors="coerce")
        if tanggal_mulai is not None:
            hasil = hasil[tgl >= pd.to_datetime(tanggal_mulai)]
            tgl = tgl[hasil.index]
        if tanggal_akhir is not None:
            hasil = hasil[tgl <= pd.to_datetime(tanggal_akhir)]

    # Full-text search
    if kata_kunci:
        kolom_pencarian = kolom_pencarian or ["keterangan"]
        kolom_pencarian = [c for c in kolom_pencarian if c in hasil.columns]
        if kolom_pencarian:
            mask = pd.Series(False, index=hasil.index)
            for col in kolom_pencarian:
                mask = mask | hasil[col].astype(str).str.contains(kata_kunci, case=False, na=False)
            hasil = hasil[mask]

    # Filter bank
    if bank and "bank" in hasil.columns:
        hasil = hasil[hasil["bank"].isin(bank)]

    # Filter sumber kategori
    if sumber_kategori and "sumber_kategori" in hasil.columns:
        hasil = hasil[hasil["sumber_kategori"].isin(sumber_kategori)]

    logger.info(f"🔎 Filter diterapkan: {len(df)} -> {len(hasil)} baris")
    return hasil


def opsi_bank(df: pd.DataFrame) -> List[str]:
    """Daftar nilai unik kolom 'bank' untuk dipakai sebagai opsi filter."""
    if df is None or df.empty or "bank" not in df.columns:
        return []
    return sorted(df["bank"].dropna().unique().tolist())


def opsi_sumber_kategori(df: pd.DataFrame) -> List[str]:
    """Daftar nilai unik kolom 'sumber_kategori' untuk dipakai sebagai opsi filter."""
    if df is None or df.empty or "sumber_kategori" not in df.columns:
        return []
    return sorted(df["sumber_kategori"].dropna().unique().tolist())