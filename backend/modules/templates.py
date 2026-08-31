"""
modules/templates.py
=====================
Template & preset jurnal untuk transaksi yang sering berulang, supaya user
tidak perlu memilih akun debet/kredit dari nol setiap kali.

Template disimpan sebagai file JSON lokal (`jurnal_templates.json`) supaya
gampang di-edit user tanpa perlu database.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .logging_config import get_module_logger

logger = get_module_logger("templates")

TEMPLATE_FILE = Path("jurnal_templates.json")

# Template bawaan yang sudah umum dipakai di UMKM/consulting Indonesia.
DEFAULT_TEMPLATES: List[Dict[str, Any]] = [
    {
        "nama": "Pembayaran Listrik/PLN",
        "no_akun_debet": "6100", "nama_akun_debet": "BEBAN LISTRIK & AIR",
        "no_akun_kredit": "1100", "nama_akun_kredit": "KAS/BANK",
        "kata_kunci": ["PLN", "LISTRIK", "TOKEN"],
    },
    {
        "nama": "Penerimaan Piutang Usaha",
        "no_akun_debet": "1100", "nama_akun_debet": "KAS/BANK",
        "no_akun_kredit": "1200", "nama_akun_kredit": "PIUTANG USAHA",
        "kata_kunci": ["TRANSFER MASUK", "PELUNASAN", "PIUTANG"],
    },
    {
        "nama": "Biaya Administrasi Bank",
        "no_akun_debet": "6300", "nama_akun_debet": "BEBAN ADMINISTRASI BANK",
        "no_akun_kredit": "1100", "nama_akun_kredit": "KAS/BANK",
        "kata_kunci": ["ADM", "BIAYA ADMIN", "ADMINISTRASI"],
    },
    {
        "nama": "Penjualan Tunai",
        "no_akun_debet": "1100", "nama_akun_debet": "KAS/BANK",
        "no_akun_kredit": "4100", "nama_akun_kredit": "PENJUALAN",
        "kata_kunci": ["PENJUALAN", "SETORAN TUNAI"],
    },
]


def _muat_semua() -> List[Dict[str, Any]]:
    if not TEMPLATE_FILE.exists():
        return list(DEFAULT_TEMPLATES)
    try:
        with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else list(DEFAULT_TEMPLATES)
    except Exception as e:
        logger.warning(f"Gagal baca {TEMPLATE_FILE}, pakai default. ({e})")
        return list(DEFAULT_TEMPLATES)


def _simpan_semua(templates: List[Dict[str, Any]]) -> bool:
    try:
        with open(TEMPLATE_FILE, "w", encoding="utf-8") as f:
            json.dump(templates, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Gagal menyimpan template: {e}")
        return False


def daftar_template() -> List[Dict[str, Any]]:
    """Ambil semua template (default + custom yang sudah disimpan)."""
    return _muat_semua()


def tambah_template(template: Dict[str, Any]) -> bool:
    """Tambah template baru. Wajib ada: nama, no_akun_debet, no_akun_kredit."""
    wajib = {"nama", "no_akun_debet", "no_akun_kredit"}
    if not wajib.issubset(template.keys()):
        logger.error(f"Template tidak lengkap, wajib ada: {wajib}")
        return False

    templates = _muat_semua()
    templates = [t for t in templates if t["nama"] != template["nama"]]  # replace kalau nama sama
    templates.append(template)
    return _simpan_semua(templates)


def hapus_template(nama: str) -> bool:
    templates = _muat_semua()
    baru = [t for t in templates if t["nama"] != nama]
    if len(baru) == len(templates):
        return False
    return _simpan_semua(baru)


def cari_template_cocok(keterangan: str) -> Optional[Dict[str, Any]]:
    """Cari template yang kata_kunci-nya cocok dengan keterangan transaksi."""
    if not keterangan:
        return None
    teks = str(keterangan).upper()
    for template in _muat_semua():
        for kw in template.get("kata_kunci", []):
            if kw.upper() in teks:
                return template
    return None


def terapkan_template(row: Dict[str, Any], template: Dict[str, Any]) -> Dict[str, Any]:
    """Terapkan template ke satu baris transaksi, return baris yang sudah diupdate."""
    hasil = dict(row)
    hasil["no_akun_debet"] = template["no_akun_debet"]
    hasil["nama_akun_debet"] = template.get("nama_akun_debet", "")
    hasil["no_akun_kredit"] = template["no_akun_kredit"]
    hasil["nama_akun_kredit"] = template.get("nama_akun_kredit", "")
    hasil["sumber_kategori"] = f"Template: {template['nama']}"
    return hasil