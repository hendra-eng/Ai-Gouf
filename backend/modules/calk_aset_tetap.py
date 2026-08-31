"""
modules/calk_aset_tetap.py
============================
[Pelengkap Fase 3 -- roadmap CALK] Jembatan antara
modules.akuntansi_ai.proses_aset_tetap() (snapshot penyusutan 1 titik
waktu per aset) dan tulis_note_7_aset_tetap() di calk_export.py (butuh
format MUTASI per kategori: Saldo Awal/Penambahan/Pengurangan/Saldo
Akhir, 2 blok -- Biaya Perolehan & Akumulasi Penyusutan).

CARA KERJA: panggil proses_aset_tetap() 2x dgn tanggal_acuan beda
(tanggal_lalu & tanggal_now), masing2 dgn df yg SUDAH DIFILTER
tanggal_perolehan <= cutoff (proses_aset_tetap() sendiri TIDAK
memfilter ini -- dia menjumlahkan harga_perolehan semua baris di df yg
dikirim apa adanya, terlepas dari tanggal_acuan). Selisih 2 snapshot
per kategori = mutasinya.

[KETERBATASAN JUJUR -- WAJIB dibaca sebelum pakai]
parse_sheet_aset_tetap()/proses_aset_tetap() TIDAK PUNYA field tanggal
pelepasan/disposal aset sama sekali -- jadi kolom "Pengurangan" di
kedua blok SELALU 0 dari fungsi ini. Kalau ada aset yg dijual/
dihapusbukukan selama periode berjalan, itu WAJIB ditangani manual
terpisah (mis. akuntan kurangi manual dari hasil fungsi ini sebelum
dioper ke tulis_note_7_aset_tetap(), atau tambah field tanggal_lepas
ke parse_sheet_aset_tetap() dulu kalau mau diotomatiskan -- BELUM
dilakukan di sini, di luar cakupan file ini).

CARA INTEGRASI (belum ada koneksi otomatis ke orchestrator Fase 3):
    from modules.calk_aset_tetap import siapkan_aset_tetap_untuk_calk

    aset_tetap_calk = siapkan_aset_tetap_untuk_calk(
        df_aset_tetap,              # DataFrame dari parse_sheet_aset_tetap()
        tanggal_lalu=date(2025, 12, 31),
        tanggal_now=date(2026, 7, 31),
    )
    # aset_tetap_calk cocok langsung dioper sbg parameter `aset_tetap`
    # ke susun_dan_tulis_semua_note_calk() (Fase 3, calk_export.py):
    hasil = susun_dan_tulis_semua_note_calk(
        doc, profil=..., neraca_now=..., ...,
        aset_tetap=aset_tetap_calk,
    )
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

import pandas as pd

try:
    # Kasus normal (sesuai struktur project ini): akuntansi_ai.py ada
    # di root backend/, importable sebagai top-level module -- sama
    # seperti pola yang dipakai main.py ("import akuntansi_ai as ak")
    # dan kertas_kerja.py.
    from akuntansi_ai import proses_aset_tetap
except ImportError:
    # Fallback kalau akuntansi_ai.py ikut dipindah ke dalam modules/
    from .akuntansi_ai import proses_aset_tetap

# Label bilingual per kategori -- mengikuti daftar kategori BAKU di
# akuntansi_ai._kategorikan_aset() (TANAH/BANGUNAN/KENDARAAN/MESIN/
# KOMPUTER/FURNITUR/PERALATAN/LAINNYA). Kalau kategori LAINNYA/tidak
# dikenal, fallback title-case nama ID = nama EN (WAJIB direview
# akuntan, sama seperti kategori "tidak dikenal" di calk_mapping.py).
_LABEL_KATEGORI: Dict[str, tuple] = {
    "TANAH": ("Tanah", "Land"),
    "BANGUNAN": ("Bangunan", "Building"),
    "KENDARAAN": ("Kendaraan", "Vehicle"),
    "MESIN": ("Mesin", "Machinery"),
    "KOMPUTER": ("Komputer", "Computer Equipment"),
    "FURNITUR": ("Furnitur dan Perlengkapan", "Furniture and Fixtures"),
    "PERALATAN": ("Peralatan", "Equipment"),
    "LAINNYA": ("Aset Tetap Lainnya", "Other Fixed Assets"),
}


def _filter_sudah_dibeli(df: pd.DataFrame, cutoff: date) -> pd.DataFrame:
    """Baris aset yg tanggal_perolehan-nya <= cutoff -- proses_aset_tetap()
    sendiri TIDAK melakukan filter ini (lihat catatan di kepala modul),
    jadi WAJIB difilter di sini sebelum dikirim ke proses_aset_tetap(),
    supaya aset yg belum dibeli pada tanggal cutoff tidak ikut nyasar
    masuk ke "saldo" titik waktu itu."""
    if df is None or df.empty:
        return df
    tgl = pd.to_datetime(df["tanggal_perolehan"], errors="coerce")
    return df[tgl.notna() & (tgl.dt.date <= cutoff)].copy()


def _rekap_per_kategori(hasil_proses: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
    """{kategori: {"biaya": total harga_perolehan, "akum": total
    akumulasi_penyusutan_seharusnya}} dari 1 hasil proses_aset_tetap()."""
    df = hasil_proses.get("df")
    if df is None or df.empty:
        return {}
    grp = df.groupby("kategori")[["harga_perolehan", "akumulasi_penyusutan_seharusnya"]].sum()
    return {
        str(kat): {"biaya": float(row["harga_perolehan"]),
                   "akum": float(row["akumulasi_penyusutan_seharusnya"])}
        for kat, row in grp.iterrows()
    }


def siapkan_aset_tetap_untuk_calk(
    df_aset_tetap: pd.DataFrame,
    tanggal_lalu: date,
    tanggal_now: date,
    masa_manfaat_min: Optional[int] = None,
    masa_manfaat_maks: Optional[int] = None,
    batas_kapitalisasi_rupiah: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Susun data aset tetap format MUTASI per kategori (siap dioper ke
    parameter `aset_tetap` di susun_dan_tulis_semua_note_calk()) dari
    df hasil parse_sheet_aset_tetap() (akuntansi_ai.py).

    Args:
        df_aset_tetap: DataFrame 1 baris = 1 aset (lihat
            parse_sheet_aset_tetap() -- kolom wajib: kategori,
            tanggal_perolehan, harga_perolehan, nilai_residu,
            masa_manfaat_tahun).
        tanggal_lalu/now: 2 titik waktu neraca (sama dgn dipakai di
            note lain) -- dipakai sbg tanggal_acuan proses_aset_tetap()
            utk masing2 snapshot.
        masa_manfaat_min/maks/batas_kapitalisasi_rupiah: opsional,
            diteruskan apa adanya ke proses_aset_tetap() kalau client
            punya kebijakan beda dari default akuntansi_ai.py.

    Returns:
        {
          "daftar_kategori": [...],   # siap dioper ke tulis_note_7_aset_tetap()
          "nilai_buku_now": float, "nilai_buku_lalu": float,
          "beban_penyusutan_tahun_berjalan": float,
          "peringatan": [str, ...],   # mis. kategori tidak dikenal, atau
                                       # kalau ada indikasi aset dilepas
                                       # (lihat KETERBATASAN di atas modul)
        }
    """
    kwargs = {}
    if masa_manfaat_min is not None:
        kwargs["masa_manfaat_min"] = masa_manfaat_min
    if masa_manfaat_maks is not None:
        kwargs["masa_manfaat_maks"] = masa_manfaat_maks
    if batas_kapitalisasi_rupiah is not None:
        kwargs["batas_kapitalisasi_rupiah"] = batas_kapitalisasi_rupiah

    df_lalu = _filter_sudah_dibeli(df_aset_tetap, tanggal_lalu)
    df_now = _filter_sudah_dibeli(df_aset_tetap, tanggal_now)

    hasil_lalu = proses_aset_tetap(df_lalu, tanggal_acuan=tanggal_lalu, **kwargs)
    hasil_now = proses_aset_tetap(df_now, tanggal_acuan=tanggal_now, **kwargs)

    rekap_lalu = _rekap_per_kategori(hasil_lalu)
    rekap_now = _rekap_per_kategori(hasil_now)

    semua_kategori = sorted(set(rekap_lalu) | set(rekap_now))
    peringatan: List[str] = []
    daftar_kategori: List[Dict[str, Any]] = []

    for kat in semua_kategori:
        lalu = rekap_lalu.get(kat, {"biaya": 0.0, "akum": 0.0})
        now = rekap_now.get(kat, {"biaya": 0.0, "akum": 0.0})

        biaya_saldo_awal, biaya_saldo_akhir = lalu["biaya"], now["biaya"]
        akum_saldo_awal, akum_saldo_akhir = lalu["akum"], now["akum"]

        # [KETERBATASAN] tidak ada data disposal -- kalau biaya TURUN
        # antar 2 snapshot (mis. karena akuntan manual sudah menghapus
        # baris aset yg dijual dari df sebelum tanggal_now), itu artinya
        # ADA pelepasan tapi fungsi ini tidak bisa membedakannya dari
        # "penambahan negatif" -- ditandai sbg peringatan, BUKAN otomatis
        # dimasukkan ke kolom "Pengurangan" (supaya angka tidak diam2
        # salah, akuntan wajib cek manual).
        selisih_biaya = biaya_saldo_akhir - biaya_saldo_awal
        if selisih_biaya < 0:
            peringatan.append(
                f'Kategori "{kat}": biaya perolehan TURUN dari periode lalu ke '
                f'sekarang (indikasi ada aset dilepas/dihapusbukukan) -- fungsi '
                f'ini TIDAK bisa mendeteksi pelepasan otomatis (lihat '
                f'keterbatasan di calk_aset_tetap.py), kolom Pengurangan '
                f'dibiarkan 0. WAJIB dicek & diisi manual oleh akuntan.'
            )

        label_id, label_en = _LABEL_KATEGORI.get(kat, (kat.title(), kat.title()))
        if kat not in _LABEL_KATEGORI:
            peringatan.append(
                f'Kategori aset "{kat}" tidak dikenal di _LABEL_KATEGORI -- '
                f'label ID/EN dipakai apa adanya ("{kat.title()}"), WAJIB '
                f'direview & diterjemahkan manual.'
            )

        daftar_kategori.append({
            "label_id": label_id, "label_en": label_en,
            "biaya_saldo_awal": biaya_saldo_awal,
            "biaya_penambahan": max(selisih_biaya, 0.0),
            "biaya_pengurangan": 0.0,  # lihat [KETERBATASAN]
            "biaya_saldo_akhir": biaya_saldo_akhir,
            "akum_saldo_awal": akum_saldo_awal,
            "akum_penambahan": max(akum_saldo_akhir - akum_saldo_awal, 0.0),
            "akum_pengurangan": 0.0,  # lihat [KETERBATASAN]
            "akum_saldo_akhir": akum_saldo_akhir,
        })

    nilai_buku_now = sum(k["biaya_saldo_akhir"] - k["akum_saldo_akhir"] for k in daftar_kategori)
    nilai_buku_lalu = sum(k["biaya_saldo_awal"] - k["akum_saldo_awal"] for k in daftar_kategori)
    beban_penyusutan_tahun_berjalan = sum(k["akum_penambahan"] for k in daftar_kategori)

    return {
        "daftar_kategori": daftar_kategori,
        "nilai_buku_now": nilai_buku_now,
        "nilai_buku_lalu": nilai_buku_lalu,
        "beban_penyusutan_tahun_berjalan": beban_penyusutan_tahun_berjalan,
        "peringatan": peringatan,
    }