"""
modules/dashboard.py
=====================
Dashboard monitoring real-time untuk AI Gouf Consulting
"""

import pandas as pd
from datetime import datetime
from typing import Dict, Any, Optional, List

from .logging_config import get_module_logger
from .settings import load_settings

logger = get_module_logger("dashboard")


class DashboardStats:
    """Class untuk mengelola statistik dashboard"""
    
    def __init__(self):
        self.data = {}
        self.last_update = None
    
    def update(self, **kwargs):
        """Update semua statistik"""
        self.data = self._collect_stats(**kwargs)
        self.last_update = datetime.now()
        return self.data
    
    def _collect_stats(
        self,
        df_bank: Optional[pd.DataFrame] = None,
        df_jual: Optional[pd.DataFrame] = None,
        df_penilaian: Optional[pd.DataFrame] = None,
        df_piutang: Optional[pd.DataFrame] = None,
        pola=None,
        df_coa: Optional[pd.DataFrame] = None,
    ) -> Dict[str, Any]:
        """Koleksi semua statistik"""
        
        stats = {
            "timestamp": datetime.now().isoformat(),
            "data": {
                "bank": self._get_bank_stats(df_bank),
                "penjualan": self._get_penjualan_stats(df_jual),
                "penilaian": self._get_penilaian_stats(df_penilaian),
                "piutang": self._get_piutang_stats(df_piutang),
                "coa": self._get_coa_stats(df_coa),
                "pola": self._get_pola_stats(pola),
            },
            "summary": {},
            "health": {},
        }
        
        # Hitung summary
        total_records = 0
        total_nominal = 0
        total_pending = 0
        total_errors = 0
        
        for key, data in stats["data"].items():
            if isinstance(data, dict):
                total_records += data.get("total_records", 0)
                total_nominal += data.get("total_nominal", 0)
                total_pending += data.get("pending_review", 0)
                total_errors += data.get("errors", 0)
        
        stats["summary"] = {
            "total_records": total_records,
            "total_nominal": total_nominal,
            "total_pending": total_pending,
            "total_errors": total_errors,
        }
        
        # Health score
        stats["health"] = self._calculate_health(stats)
        
        return stats
    
    def _get_bank_stats(self, df: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """Statistik rekening koran"""
        if df is None or df.empty:
            return {
                "total_records": 0,
                "total_nominal": 0,
                "pending_review": 0,
                "banks": [],
                "balance_status": True,
                "errors": 0,
            }
        
        stats = {
            "total_records": len(df),
            "total_nominal": df["jml_debet"].sum() if "jml_debet" in df.columns else 0,
            "banks": df["bank"].unique().tolist() if "bank" in df.columns else [],
            "balance_status": self._check_balance(df),
            "errors": 0,
        }
        
        if "sumber_kategori" in df.columns:
            stats["pending_review"] = df[
                df["sumber_kategori"].str.contains("review|Belum Terkategori", case=False, na=False)
            ].shape[0]
        
        # Per bank
        if "bank" in df.columns and "jml_debet" in df.columns:
            stats["per_bank"] = df.groupby("bank")["jml_debet"].sum().to_dict()
        
        return stats
    
    def _get_penjualan_stats(self, df: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """Statistik data penjualan"""
        if df is None or df.empty:
            return {"total_records": 0, "total_nominal": 0, "pending_review": 0, "errors": 0}
        
        stats = {
            "total_records": len(df),
            "total_nominal": df["total"].sum() if "total" in df.columns else 0,
            "total_ppn": df["ppn"].sum() if "ppn" in df.columns else 0,
            "errors": 0,
        }
        
        if "cara_bayar" in df.columns:
            stats["tunai"] = df[df["cara_bayar"] == "TUNAI"].shape[0]
            stats["kredit"] = df[df["cara_bayar"] == "KREDIT"].shape[0]
        
        if "sumber_kategori" in df.columns:
            stats["pending_review"] = df[
                df["sumber_kategori"].str.contains("review|Belum Terkategori", case=False, na=False)
            ].shape[0]
        
        return stats
    
    def _get_penilaian_stats(self, df: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """Statistik penilaian klien/maker"""
        if df is None or df.empty:
            return {"total_records": 0, "total_klien": 0, "avg_score": 0, "errors": 0}
        
        stats = {
            "total_records": len(df),
            "errors": 0,
        }
        
        if "jenis_baris" in df.columns:
            df_klien = df[df["jenis_baris"] == "klien"]
            stats["total_klien"] = len(df_klien)
            stats["avg_score"] = df_klien["score"].mean() if "score" in df_klien.columns else 0
            stats["min_score"] = df_klien["score"].min() if "score" in df_klien.columns else 0
            stats["max_score"] = df_klien["score"].max() if "score" in df_klien.columns else 0
        
        return stats
    
    def _get_piutang_stats(self, df: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """Statistik buku bantu piutang"""
        if df is None or df.empty:
            return {"total_records": 0, "total_akhir": 0, "errors": 0}
        
        stats = {
            "total_records": len(df),
            "total_akhir": df["total_akhir"].sum() if "total_akhir" in df.columns else 0,
            "errors": 0,
        }
        
        if "tanggal" in df.columns:
            stats["date_range"] = {
                "min": df["tanggal"].min(),
                "max": df["tanggal"].max(),
            }
        
        return stats
    
    def _get_coa_stats(self, df: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """Statistik COA"""
        if df is None or df.empty:
            return {"total_akun": 0, "kategori": {}, "errors": 0}
        
        stats = {
            "total_akun": len(df),
            "errors": 0,
        }
        
        if "kategori" in df.columns:
            stats["kategori"] = df["kategori"].value_counts().to_dict()
        
        return stats
    
    def _get_pola_stats(self, pola) -> Dict[str, Any]:
        """Statistik pola yang dipelajari"""
        if pola is None or not hasattr(pola, "aturan"):
            return {"total_pola": 0, "konsisten": 0, "errors": 0}
        
        aturan = pola.aturan
        stats = {
            "total_pola": len(aturan),
            "konsisten": sum(1 for v in aturan.values() if v.get("konsisten", False)),
            "errors": 0,
        }
        
        if aturan:
            confidences = [v.get("confidence_score", 0) for v in aturan.values()]
            stats["confidence_avg"] = sum(confidences) / len(confidences)
            stats["confidence_min"] = min(confidences)
            stats["confidence_max"] = max(confidences)
        
        return stats
    
    def _check_balance(self, df: pd.DataFrame) -> bool:
        """Cek keseimbangan jurnal"""
        try:
            total_debet = df["jml_debet"].sum() if "jml_debet" in df.columns else 0
            total_kredit = df["jml_kredit"].sum() if "jml_kredit" in df.columns else 0
            
            if "jml_kredit_ppn" in df.columns:
                total_kredit += df["jml_kredit_ppn"].sum()
            
            return abs(total_debet - total_kredit) < 1.0
        except:
            return False
    
    def _calculate_health(self, stats: Dict[str, Any]) -> Dict[str, Any]:
        """Hitung health score"""
        score = 100
        warnings = []
        errors = []
        
        # Penalti untuk pending review
        pending = stats["summary"].get("total_pending", 0)
        if pending > 0:
            penalty = min(30, pending * 2)
            score -= penalty
            warnings.append(f"{pending} transaksi pending review")
        
        # Penalti untuk jurnal tidak balance
        bank_stats = stats["data"].get("bank", {})
        if not bank_stats.get("balance_status", True):
            score -= 20
            errors.append("Jurnal tidak balance")
        
        # Penalti untuk pola kurang
        pola_stats = stats["data"].get("pola", {})
        total_pola = pola_stats.get("total_pola", 0)
        if total_pola < 5:
            score -= 10
            warnings.append("Pola kurang dari 5")
        
        # Penalti untuk COA kosong
        coa_stats = stats["data"].get("coa", {})
        if coa_stats.get("total_akun", 0) == 0:
            score -= 10
            warnings.append("COA kosong")
        
        # Penalti untuk data kosong
        if stats["summary"]["total_records"] == 0:
            score = 0
            errors.append("Tidak ada data")
        
        score = max(0, min(100, score))
        
        # Status
        if score >= 80:
            status = "good"
        elif score >= 60:
            status = "warning"
        else:
            status = "critical"
        
        return {
            "score": score,
            "status": status,
            "warnings": warnings,
            "errors": errors,
        }


def get_live_stats(**kwargs) -> Dict[str, Any]:
    """
    Dapatkan statistik real-time
    
    Args:
        **kwargs: df_bank, df_jual, df_penilaian, df_piutang, pola, df_coa
    
    Returns:
        Dict dengan semua statistik
    """
    dashboard = DashboardStats()
    return dashboard.update(**kwargs)


# ============================================================
# LIVE DASHBOARD (versi FastAPI/React) -- dihitung dari riwayat tersimpan
# ============================================================
# [BARU] get_live_stats() di atas dirancang untuk era Streamlit: butuh
# DataFrame MENTAH (df_bank dengan kolom jml_debet, bank, sumber_kategori,
# dst) yang di-hold di st.session_state selagi app jalan.
#
# Di backend FastAPI (main.py), setiap request /api/proses-file berdiri
# sendiri -- DataFrame mentah itu TIDAK pernah disimpan ke mana pun setelah
# response dikirim. Yang disimpan ke database (lihat db_client.simpan_hasil)
# cuma bentuk yang SUDAH diringkas: {ringkasan, masalah, draf_jurnal} per
# jenis dokumen (lihat _PEMROSES_DOKUMEN & _bersihkan_untuk_json di
# main.py).
#
# Supaya Live Dashboard tetap bisa jalan tanpa nyimpen DataFrame mentah
# tambahan (nambah beban storage) atau menebak-nebak nama kolom
# draf_jurnal yang beda-beda di 15 jenis dokumen, fungsi ini HANYA
# memakai angka yang sudah pasti konsisten di semua jenis dokumen:
# panjang `draf_jurnal` (jumlah baris jurnal) dan panjang `masalah`
# (jumlah yang perlu direview).
#
# Input `riwayat` adalah list dengan bentuk yang sama seperti yang
# dikembalikan oleh /api/client/{client_id}/riwayat di main.py:
#   [{"jenis_dokumen": str, "hasil": {"ringkasan": {}, "masalah": [],
#     "draf_jurnal": []}, "nama_file": str, "tanggal": str}, ...]

def ringkas_dashboard_dari_riwayat(riwayat: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Ringkas Live Dashboard dari riwayat hasil proses yang sudah tersimpan
    di database untuk satu client.

    Returns dict siap-JSON:
        {
            "total_dokumen_diproses": int,
            "total_baris_jurnal": int,
            "total_perlu_review": int,
            "per_kategori": [{"jenis_dokumen", "jumlah_dokumen",
                               "jumlah_baris_jurnal", "jumlah_perlu_review"}],
            "health": {"score": int, "status": "good"|"warning"|"critical",
                       "catatan": [str]},
        }
    """
    if not riwayat:
        return {
            "total_dokumen_diproses": 0,
            "total_baris_jurnal": 0,
            "total_perlu_review": 0,
            "per_kategori": [],
            "health": {"score": 0, "status": "critical", "catatan": ["Belum ada dokumen yang diproses."]},
        }

    per_kategori: Dict[str, Dict[str, int]] = {}
    for item in riwayat:
        kategori = item.get("jenis_dokumen") or "lainnya"
        hasil = item.get("hasil") or {}
        jumlah_baris = len(hasil.get("draf_jurnal") or [])
        jumlah_masalah = len(hasil.get("masalah") or [])

        entri = per_kategori.setdefault(kategori, {
            "jenis_dokumen": kategori, "jumlah_dokumen": 0,
            "jumlah_baris_jurnal": 0, "jumlah_perlu_review": 0,
        })
        entri["jumlah_dokumen"] += 1
        entri["jumlah_baris_jurnal"] += jumlah_baris
        entri["jumlah_perlu_review"] += jumlah_masalah

    total_dokumen = len(riwayat)
    total_baris = sum(v["jumlah_baris_jurnal"] for v in per_kategori.values())
    total_review = sum(v["jumlah_perlu_review"] for v in per_kategori.values())

    # Health score sederhana: mulai dari 100, dikurangi proporsi yang
    # masih perlu direview (maks penalti 40 poin).
    catatan: List[str] = []
    score = 100
    if total_baris > 0:
        proporsi_review = total_review / max(total_baris, 1)
        penalti = min(40, round(proporsi_review * 100 * 0.4))
        score -= penalti
        if total_review > 0:
            catatan.append(f"{total_review} baris masih perlu direview.")
    elif total_review > 0:
        score -= 30
        catatan.append(f"{total_review} item masih perlu direview.")

    score = max(0, min(100, score))
    status = "good" if score >= 80 else ("warning" if score >= 60 else "critical")
    if not catatan:
        catatan.append("Semua data yang diproses sudah bersih, tidak ada yang perlu direview.")

    logger.info(f"📊 Dashboard dihitung: {total_dokumen} dokumen, {total_review} perlu review, skor {score}")

    return {
        "total_dokumen_diproses": total_dokumen,
        "total_baris_jurnal": total_baris,
        "total_perlu_review": total_review,
        "per_kategori": list(per_kategori.values()),
        "health": {"score": score, "status": status, "catatan": catatan},
    }


# ============================================================
# [BARU] RINGKASAN EKSEKUTIF (#4) -- angka utama utk klien non-akuntan
# ============================================================
# Beda dari ringkas_dashboard_dari_riwayat() di atas (dipakai Live
# Dashboard internal akuntan): fungsi ini menyaring jadi cuma beberapa
# ANGKA UTAMA yang gampang dimengerti klien awam. Total finansial (uang
# masuk/keluar/penjualan) HANYA ditarik dari jenis dokumen yang field
# ringkasannya sudah pasti konsisten -- rekening_koran & penjualan, 2
# jenis yang dipelajari lewat pola per client (lihat
# main._JENIS_DENGAN_POLA_PER_CLIENT) -- supaya tidak ikut kena bug lama
# "field ringkasan salah mapping antar 15 jenis dokumen" (item #7 di
# backlog, belum diperbaiki di frontend).

def ringkas_eksekutif_dari_riwayat(riwayat: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Ringkas riwayat hasil (bentuk sama seperti input
    ringkas_dashboard_dari_riwayat) jadi angka-angka utama siap tampil
    sbg kartu ringkasan eksekutif, sekaligus jadi input prompt ke
    modules.ai_analysis.buat_ringkasan_eksekutif().

    Returns dict siap-JSON:
        {
            "total_dokumen_diproses": int,
            "kartu_utama": [{"label": str, "nilai": float, "satuan": "rupiah"|"jumlah"}],
            "per_kategori": [...],  # sama seperti ringkas_dashboard_dari_riwayat
            "kesehatan": {...},     # sama seperti ringkas_dashboard_dari_riwayat (key "health")
            "periode": {"dari": str|None, "sampai": str|None},
        }
    """
    dasar = ringkas_dashboard_dari_riwayat(riwayat)

    total_uang_masuk = 0.0
    total_uang_keluar = 0.0
    total_penjualan = 0.0
    tanggal_semua: List[str] = []

    for item in riwayat:
        kategori = item.get("jenis_dokumen") or ""
        hasil = item.get("hasil") or {}
        ringkasan = hasil.get("ringkasan") or {}
        tanggal = item.get("tanggal")
        if tanggal:
            tanggal_semua.append(str(tanggal))

        if kategori == "rekening_koran":
            total_uang_masuk += float(ringkasan.get("total_kredit") or 0)
            total_uang_keluar += float(ringkasan.get("total_debet") or 0)
        elif kategori == "penjualan":
            total_penjualan += float(ringkasan.get("total_penjualan") or 0)

    kartu_utama = [
        {"label": "Uang Masuk (Bank)", "nilai": round(total_uang_masuk, 2), "satuan": "rupiah"},
        {"label": "Uang Keluar (Bank)", "nilai": round(total_uang_keluar, 2), "satuan": "rupiah"},
        {"label": "Total Penjualan", "nilai": round(total_penjualan, 2), "satuan": "rupiah"},
        {"label": "Dokumen Diproses", "nilai": dasar["total_dokumen_diproses"], "satuan": "jumlah"},
        {"label": "Perlu Ditinjau Akuntan", "nilai": dasar["total_perlu_review"], "satuan": "jumlah"},
    ]

    periode = {
        "dari": min(tanggal_semua) if tanggal_semua else None,
        "sampai": max(tanggal_semua) if tanggal_semua else None,
    }

    logger.info(
        f"📄 Ringkasan eksekutif dihitung: masuk {total_uang_masuk}, "
        f"keluar {total_uang_keluar}, penjualan {total_penjualan}"
    )

    return {
        "total_dokumen_diproses": dasar["total_dokumen_diproses"],
        "kartu_utama": kartu_utama,
        "per_kategori": dasar["per_kategori"],
        "kesehatan": dasar["health"],
        "periode": periode,
    }

# ============================================================
# [BARU] KONTEKS UNTUK TANYA-JAWAB NATURAL LANGUAGE (AI Chat)
# ============================================================
# Beda dari ringkas_eksekutif_dari_riwayat() di atas (cuma 3 angka utk
# kartu klien awam): fungsi2 di bawah ini menyaring ANGKA ASLI dari
# `ringkasan` tiap jenis dokumen APA ADANYA (field-nya sama persis dgn
# yang dipakai lib/documentTypes.js di frontend), supaya bisa disuntikkan
# ke system_prompt AI chat (lihat main.py::chat_stream) dan AI bisa jawab
# pertanyaan spesifik spt "berapa total piutang klien X bulan ini?" tanpa
# mengarang angka.
#
# ASUMSI PENTING: `riwayat` di sini HARUS terurut TERBARU LEBIH DULU
# (itu urutan default dbc.ambil_hasil_client(), lihat db_client.py --
# order_by(Hasil.dibuat_at.desc())). Untuk tiap jenis dokumen, hanya
# ringkasan TERBARU yang diambil (bukan dijumlah lintas upload) -- karena
# setiap upload piutang/faktur/slip gaji/penilaian biasanya sudah
# representasi PENUH 1 periode, beda kasus dgn bank/penjualan yang
# memang diproses bertahap (utk itu tetap pakai
# ringkas_eksekutif_dari_riwayat yang menjumlahkan).

def bangun_kpi_kunci_dari_riwayat(riwayat: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Ambil ringkasan TERBARU per jenis_dokumen dari riwayat hasil SATU
    client. Return dict: {jenis_dokumen: ringkasan_dict}.

    Kalau riwayat kosong, return {} -- pemanggil (main.py) tinggal skip
    nambahin konteks ini ke system_prompt kalau kosong.
    """
    terbaru_per_jenis: Dict[str, Dict[str, Any]] = {}
    for item in riwayat:
        kategori = item.get("jenis_dokumen") or "lainnya"
        if kategori in terbaru_per_jenis:
            continue  # sudah ada yang lebih baru (riwayat terurut desc)
        hasil = item.get("hasil") or {}
        ringkasan = hasil.get("ringkasan") or {}
        if ringkasan:
            terbaru_per_jenis[kategori] = ringkasan
    return terbaru_per_jenis


# Field per jenis dokumen yang dianggap "headline" utk perbandingan
# LINTAS CLIENT (dipakai bangun_ringkasan_lintas_client). Sengaja hanya
# beberapa field paling sering ditanya per jenis -- bukan semua field di
# lib/documentTypes.js -- supaya prompt lintas-client (yang isinya N
# client sekaligus) tidak meledak ukurannya.
FIELD_HEADLINE_LINTAS_CLIENT: Dict[str, List[str]] = {
    "penilaian": ["rata_rata_score", "status_global", "total_temuan"],
    "piutang": ["total_piutang", "jumlah_pelanggan"],
    "faktur_pajak": ["ppn_keluaran", "ppn_masukan"],
    "ap_aging": ["total_sisa_utang", "jumlah_lewat_90_hari"],
    "spt_masa": ["total_kurang_bayar", "total_lebih_bayar"],
}


def bangun_ringkasan_lintas_client(
    daftar_client: List[Dict[str, Any]],
    ambil_hasil_client_fn,
    jenis: str,
) -> List[Dict[str, Any]]:
    """
    Bangun tabel ringkasan 1 jenis dokumen utk SEMUA client sekaligus --
    dipakai utk pertanyaan lintas-client spt "klien mana yang score-nya
    di bawah 70?" (jenis="penilaian").

    daftar_client: hasil db_client.daftar_client() -- list of {"id", "nama", ...}
    ambil_hasil_client_fn: fungsi db_client.ambil_hasil_client (di-PASS
        sbg parameter, bukan di-import langsung, supaya modul ini tidak
        perlu import db_client.py -- hindari circular import).
    jenis: salah satu key di FIELD_HEADLINE_LINTAS_CLIENT.

    Return list [{"client": nama, **field_headline_terbaru}, ...] --
    hanya client yang PUNYA data jenis ini yang masuk daftar.
    """
    field_penting = FIELD_HEADLINE_LINTAS_CLIENT.get(jenis)
    if not field_penting:
        return []

    hasil_lintas_client: List[Dict[str, Any]] = []
    for client in daftar_client:
        try:
            hasil_client = ambil_hasil_client_fn(client["id"], jenis=jenis, limit=1)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"⚠️ Gagal ambil hasil '{jenis}' utk client {client.get('id')}: {e}")
            continue
        if not hasil_client:
            continue
        ringkasan = (hasil_client[0].get("data") or {}).get("ringkasan") or {}
        if not ringkasan:
            continue
        entri = {"client": client.get("nama")}
        for f in field_penting:
            entri[f] = ringkasan.get(f)
        hasil_lintas_client.append(entri)

    return hasil_lintas_client