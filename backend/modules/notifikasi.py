"""
modules/notifikasi.py
======================
Sistem reminder/deadline proaktif untuk kewajiban SPT (lapor & setor).

File ini SEBELUMNYA TIDAK ADA di folder modules/ -- padahal main.py sudah
mereferensikannya (scheduler harian + endpoint /api/notifikasi/jalankan-
sekarang), sehingga backend gagal start dengan ImportError. Modul ini
melengkapi 2 fungsi yang dipanggil main.py:

    1. ekstrak_item_reminder_dari_df(df)
       Dipanggil tiap kali file SPT selesai diproses (lihat main.py,
       endpoint /api/proses-file). Mengubah DataFrame hasil
       ak.proses_spt() jadi list item siap disimpan lewat
       dbc.simpan_reminder_deadline_spt().

    2. jalankan_pengecekan_reminder_spt()
       Dipanggil scheduler harian (jam diatur lewat REMINDER_JAM_CEK di
       .env) DAN endpoint manual /api/notifikasi/jalankan-sekarang.
       Mengecek semua kewajiban yang mendekati/lewat jatuh tempo lewat
       dbc.ambil_reminder_jatuh_tempo(), kirim WA (via Fonnte) + catat
       alert in-app (dbc.buat_alert_anomali), lalu tandai milestone yang
       sudah terkirim (dbc.tandai_milestone_terkirim) supaya TIDAK
       dikirim ulang tiap hari.

Konfigurasi (isi di file .env):
    FONNTE_TOKEN=<token API Fonnte kamu>   -- kalau kosong, WA dilewati
                                               (fallback ke in-app saja),
                                               TIDAK melempar exception.

Kenapa milestone H-3 / H-1 / H0 (bukan cuma "kurang dari N hari"):
    Supaya user diingatkan bertahap (belum mendesak -> mendesak -> sudah
    lewat), dan supaya `milestone_terkirim` (kolom JSON di tabel
    reminder_deadline_spt) bisa dipakai mencegah pesan yang SAMA
    terkirim berkali-kali tiap scheduler jalan harian.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("notifikasi")

FONNTE_TOKEN = os.environ.get("FONNTE_TOKEN", "").strip()
FONNTE_URL = "https://api.fonnte.com/send"

# (label_milestone, hari_dari, hari_sampai) -- dicek berurutan dari yang
# paling awal (H-3) ke yang paling mendesak (lewat jatuh tempo).
# hari_dari/hari_sampai dihitung relatif ke hari ini (lihat
# dbc.ambil_reminder_jatuh_tempo).
_JADWAL_MILESTONE = [
    ("h-3", 2, 3),      # jatuh tempo 2-3 hari lagi
    ("h-1", 0, 1),      # jatuh tempo hari ini/besok
    ("h0-lewat", -9999, -1),  # sudah lewat jatuh tempo, belum selesai
]


# ============================================================
# 1) EKSTRAK ITEM REMINDER DARI HASIL proses_spt()
# ============================================================

def _ke_tanggal(nilai) -> Optional[date]:
    """Normalisasi berbagai bentuk nilai tanggal (Timestamp/str/date/None)
    dari DataFrame jadi objek `date` biasa."""
    if nilai is None:
        return None
    if isinstance(nilai, pd.Timestamp):
        if pd.isna(nilai):
            return None
        return nilai.date()
    if isinstance(nilai, datetime):
        return nilai.date()
    if isinstance(nilai, date):
        return nilai
    if isinstance(nilai, str) and nilai.strip():
        try:
            return pd.to_datetime(nilai).date()
        except Exception:
            return None
    return None


def ekstrak_item_reminder_dari_df(df: Optional[pd.DataFrame]) -> List[Dict[str, Any]]:
    """
    Ubah DataFrame hasil ak.proses_spt() (kolom: npwp, kategori_spt,
    jenis_spt, bulan_pajak, tahun_pajak_terbaca, status_bayar,
    tanggal_batas_setor, tanggal_batas_lapor, sudah_lapor) jadi list
    dict item reminder -- SATU baris SPT bisa menghasilkan SAMPAI 2 item
    (kewajiban "lapor" DAN kewajiban "setor"), karena keduanya punya
    tanggal jatuh tempo & status selesai yang berbeda.

    Kewajiban "setor" hanya dibuat kalau status_bayar == "KURANG BAYAR"
    (NIHIL/LEBIH BAYAR tidak perlu setor). Kewajiban "lapor" selalu
    dibuat selama tanggal_batas_lapor ada, karena SPT tetap wajib
    dilaporkan walau nihil.

    Return list dict siap dioper ke dbc.simpan_reminder_deadline_spt().
    """
    if df is None or len(df) == 0:
        return []

    kolom_wajib = {"npwp", "kategori_spt", "jenis_spt", "bulan_pajak", "tahun_pajak_terbaca"}
    if not kolom_wajib.issubset(set(df.columns)):
        logger.warning(
            "ekstrak_item_reminder_dari_df: DataFrame tidak punya kolom yang "
            "diharapkan dari proses_spt() (%s) -- dilewati.",
            kolom_wajib - set(df.columns),
        )
        return []

    item_list: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        npwp = row.get("npwp")
        kategori_spt = row.get("kategori_spt")
        jenis_spt_label = row.get("jenis_spt")
        bulan_pajak = row.get("bulan_pajak")
        tahun_pajak = row.get("tahun_pajak_terbaca")
        status_bayar = row.get("status_bayar")

        if not npwp or not kategori_spt or kategori_spt == "TIDAK DIKENALI":
            # Tanpa NPWP/kategori yang jelas, tidak bisa di-upsert secara
            # konsisten (lihat kunci unik di dbc.simpan_reminder_deadline_spt).
            continue

        tgl_lapor = _ke_tanggal(row.get("tanggal_batas_lapor"))
        if tgl_lapor:
            item_list.append({
                "npwp": npwp,
                "kategori_spt": kategori_spt,
                "jenis_spt_label": jenis_spt_label,
                "bulan_pajak": int(bulan_pajak) if bulan_pajak else None,
                "tahun_pajak": int(tahun_pajak) if tahun_pajak else None,
                "jenis_deadline": "lapor",
                "tanggal_batas": tgl_lapor,
                "selesai": bool(row.get("sudah_lapor", False)),
            })

        tgl_setor = _ke_tanggal(row.get("tanggal_batas_setor"))
        if tgl_setor and status_bayar == "KURANG BAYAR":
            item_list.append({
                "npwp": npwp,
                "kategori_spt": kategori_spt,
                "jenis_spt_label": jenis_spt_label,
                "bulan_pajak": int(bulan_pajak) if bulan_pajak else None,
                "tahun_pajak": int(tahun_pajak) if tahun_pajak else None,
                "jenis_deadline": "setor",
                "tanggal_batas": tgl_setor,
                # Belum ada kolom "sudah_setor" dari proses_spt() -- anggap
                # belum selesai selama masih berstatus KURANG BAYAR (baris
                # ini cuma dibuat kalau status_bayar == "KURANG BAYAR").
                "selesai": False,
            })

    return item_list


# ============================================================
# 2) KIRIM WA (FONNTE) -- dipisah sendiri supaya gampang di-mock saat testing
# ============================================================

def _kirim_wa(nomor_wa: str, pesan: str) -> bool:
    """Kirim 1 pesan WA lewat Fonnte. Return False (bukan exception) kalau
    token belum di-set atau pengiriman gagal -- reminder in-app tetap
    harus jalan walau WA gagal/belum dikonfigurasi."""
    if not FONNTE_TOKEN:
        logger.info("FONNTE_TOKEN belum di-set di .env -- reminder WA dilewati (in-app tetap jalan).")
        return False
    if not nomor_wa:
        return False

    try:
        import requests
    except ImportError:
        logger.warning("Library 'requests' belum terinstall -- reminder WA dilewati. Jalankan: pip install requests")
        return False

    try:
        resp = requests.post(
            FONNTE_URL,
            headers={"Authorization": FONNTE_TOKEN},
            data={"target": nomor_wa, "message": pesan},
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning(f"Fonnte membalas status {resp.status_code} utk nomor {nomor_wa}: {resp.text[:200]}")
            return False
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Gagal kirim WA reminder ke {nomor_wa}: {e}")
        return False


def _susun_pesan(label_milestone: str, item: Dict[str, Any]) -> str:
    jenis = "lapor" if item["jenis_deadline"] == "lapor" else "setor"
    tgl = item["tanggal_batas"]
    tgl_str = tgl.strftime("%d-%m-%Y") if hasattr(tgl, "strftime") else str(tgl)

    if label_milestone == "h0-lewat":
        awalan = "⚠️ SUDAH LEWAT jatuh tempo"
    elif label_milestone == "h-1":
        awalan = "🔴 Jatuh tempo BESOK/HARI INI"
    else:
        awalan = "🟡 Jatuh tempo 2-3 hari lagi"

    return (
        f"{awalan}: kewajiban {jenis} {item['jenis_spt_label']} "
        f"periode {item['bulan_pajak']}/{item['tahun_pajak']} "
        f"(NPWP {item['npwp']}), batas {tgl_str}."
    )


# ============================================================
# 3) PENGECEKAN HARIAN -- dipanggil scheduler & endpoint manual
# ============================================================

def jalankan_pengecekan_reminder_spt() -> Dict[str, Any]:
    """
    Cek semua kewajiban SPT yang mendekati/lewat jatuh tempo (H-3, H-1,
    lewat jatuh tempo), kirim WA + catat alert in-app untuk milestone
    yang BELUM pernah terkirim, lalu tandai supaya tidak dikirim ulang.

    Return ringkasan hasil (dipakai endpoint /api/notifikasi/jalankan-
    sekarang untuk verifikasi manual).
    """
    import db_client as dbc  # lazy import -- ikuti pola modul lain di sini

    ringkasan = {"dicek": 0, "wa_terkirim": 0, "inapp_dibuat": 0, "dilewati_sudah_terkirim": 0, "error": []}

    for label_milestone, hari_dari, hari_sampai in _JADWAL_MILESTONE:
        try:
            daftar = dbc.ambil_reminder_jatuh_tempo(hari_dari, hari_sampai)
        except Exception as e:  # noqa: BLE001
            logger.error(f"Gagal ambil reminder jatuh tempo ({label_milestone}): {e}")
            ringkasan["error"].append(f"{label_milestone}: {e}")
            continue

        for item in daftar:
            ringkasan["dicek"] += 1
            sudah_terkirim = label_milestone in (item.get("milestone_terkirim") or [])
            if sudah_terkirim:
                ringkasan["dilewati_sudah_terkirim"] += 1
                continue

            pesan = _susun_pesan(label_milestone, item)

            wa_ok = _kirim_wa(item.get("nomor_wa"), pesan)
            if wa_ok:
                ringkasan["wa_terkirim"] += 1
                try:
                    dbc.tandai_milestone_terkirim(item["id"], f"{label_milestone}_wa")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Gagal tandai milestone WA terkirim (id={item['id']}): {e}")

            try:
                dbc.buat_alert_anomali(
                    client_id=item["client_id"],
                    jenis="reminder_spt",
                    tipe_alert=label_milestone,
                    pesan=pesan,
                    konteks={
                        "npwp": item.get("npwp"),
                        "kategori_spt": item.get("kategori_spt"),
                        "jenis_deadline": item.get("jenis_deadline"),
                        "tanggal_batas": item.get("tanggal_batas"),
                    },
                )
                ringkasan["inapp_dibuat"] += 1
                dbc.tandai_milestone_terkirim(item["id"], f"{label_milestone}_inapp")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Gagal buat alert in-app reminder (id={item.get('id')}): {e}")
                ringkasan["error"].append(f"item {item.get('id')}: {e}")

    logger.info(f"Pengecekan reminder deadline SPT selesai: {ringkasan}")
    return ringkasan