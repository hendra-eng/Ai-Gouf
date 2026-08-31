"""
modules/fiscal_reconciliation.py
=================================
[BARU] Jembatan antara hasil Aset Tetap (akuntansi_ai.proses_aset_tetap())
dan perhitungan PPh Badan Pasal 31E (modules/pph_badan.py).

Modul ini SENGAJA murni (tidak import db_client, tidak import pandas) --
menerima dict hasil yang sudah tersimpan di database (kolom "data" pada
tabel hasil, lihat db_client.ambil_hasil_client), mengembalikan dict/list
siap-JSON, mengikuti pola yang sama dengan modules/pph_badan.py.

Dua fungsi di sini:
- ringkas_rekonsiliasi_fiskal_dari_aset_tetap(): dipakai endpoint
  /pph-badan/generate di main.py, untuk mengisi parameter
  koreksi_fiskal_positif/negatif di pph_badan.hitung_pph_pasal_31e().
- ringkas_penyusutan_fiskal_per_bulan(): rekap ringan per-aset (angka
  bulanan + akumulasi awal tahun saja, TANPA breakdown 12 baris/bulan)
  langsung dari data tersimpan, tanpa perlu proses ulang file Excel.
  CATATAN: ini BUKAN pengganti "jadwal_penyusutan_bulanan" (12 baris per
  bulan lengkap dgn akumulasi berjalan) yang sudah otomatis dihasilkan &
  disimpan oleh akuntansi_ai.proses_aset_tetap() itu sendiri -- kalau
  butuh jadwal 12-kolom lengkap, ambil langsung dari situ
  (hasil_aset["jadwal_penyusutan_bulanan"]), jangan hitung ulang di sini.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

from .logging_config import get_module_logger

logger = get_module_logger("fiscal_reconciliation")


def _angka(v) -> float:
    """Sama seperti _angka() di pph_badan.py/laporan_keuangan.py -- None/NaN/inf jadi 0.0."""
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(f) or math.isinf(f):
        return 0.0
    return f


def ringkas_rekonsiliasi_fiskal_dari_aset_tetap(hasil_aset: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ambil list "rekonsiliasi_fiskal" dari hasil tersimpan
    proses_aset_tetap(), jumlahkan selisih penyusutan per tahun menjadi:
      - koreksi_fiskal_positif: penyusutan KOMERSIAL > FISKAL -- kelebihan
        beban komersial tidak boleh dikurangkan menurut pajak, ditambahkan
        kembali ke laba (koreksi POSITIF).
      - koreksi_fiskal_negatif: penyusutan FISKAL > KOMERSIAL -- fiskal
        mengakui penyusutan lebih besar, mengurangi penghasilan neto
        fiskal (koreksi NEGATIF).

    Args:
        hasil_aset: dict hasil tersimpan proses_aset_tetap() -- isi kolom
            "data" pada 1 baris tabel "hasil" berjenis "aset_tetap".

    Returns:
        dict {koreksi_fiskal_positif, koreksi_fiskal_negatif,
        jumlah_aset_direkonsiliasi} -- siap dipakai sebagai parameter
        koreksi_fiskal_positif/koreksi_fiskal_negatif di
        pph_badan.hitung_pph_pasal_31e().
    """
    rekon = (hasil_aset or {}).get("rekonsiliasi_fiskal") or []
    positif = 0.0
    negatif = 0.0

    for item in rekon:
        selisih = _angka(item.get("selisih_penyusutan_per_tahun"))
        if selisih > 0:
            positif += selisih
        elif selisih < 0:
            negatif += abs(selisih)

    hasil = {
        "koreksi_fiskal_positif": round(positif, 2),
        "koreksi_fiskal_negatif": round(negatif, 2),
        "jumlah_aset_direkonsiliasi": len(rekon),
    }

    logger.info(
        f"📊 Rekonsiliasi fiskal dari Aset Tetap: {len(rekon)} aset, "
        f"koreksi(+)={positif:,.0f}, koreksi(-)={negatif:,.0f}"
    )

    return hasil


def ringkas_penyusutan_fiskal_per_bulan(hasil_aset: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Rekap ringan penyusutan fiskal per aset (angka bulanan + akumulasi
    awal tahun) dari hasil tersimpan proses_aset_tetap()["df"] -- TANPA
    breakdown 12 baris/bulan (lihat catatan modul di atas kalau butuh
    yang lengkap 12-kolom).

    Args:
        hasil_aset: dict hasil tersimpan proses_aset_tetap() -- field
            "df" di sini sudah berupa LIST OF DICT (hasil serialisasi
            _bersihkan_untuk_json() di main.py saat disimpan), bukan
            pandas DataFrame lagi.
    """
    df = (hasil_aset or {}).get("df") or []
    if not df:
        return []

    hasil = []
    for row in df:
        kategori = str(row.get("kategori") or "").strip().upper()
        if not kategori or kategori == "TANAH":
            continue

        hasil.append({
            "kode_aset": row.get("kode_aset"),
            "nama_aset": row.get("nama_aset"),
            "kategori": row.get("kategori"),
            "golongan_fiskal": row.get("golongan_fiskal"),
            "harga_perolehan": _angka(row.get("harga_perolehan")),
            "penyusutan_fiskal_per_bulan": _angka(row.get("penyusutan_fiskal_per_bulan")),
            "akumulasi_fiskal_awal_tahun": _angka(row.get("akumulasi_penyusutan_fiskal_seharusnya")),
        })

    return hasil