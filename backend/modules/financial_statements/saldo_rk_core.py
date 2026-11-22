"""
modules/financial_statements/saldo_rk_core.py
=============================================
Logika murni (tanpa DB, tanpa FastAPI) untuk kolom "Saldo RK" di sheet TB pada Download Excel halaman Reports.
Router + query ada di saldo_rk_v1.py; file ini sengaja hanya memakai pustaka standar supaya mudah diuji.

Tiap akun bank yang punya rekening koran (RK) diberi STATUS, supaya Excel tidak menampilkan selisih yang menyesatkan:

    ok                     RK terbaru berakhir di (atau dekat) akhir periode laporan dan saldonya terbaca -> selisih dihitung.
    belum_akhir_periode    RK terbaru berakhir lebih dari TOLERANSI_HARI sebelum akhir periode (mis. RK bulan lalu saja
                           yang sudah diunggah) -> selisih TIDAK dihitung, karena akan tampak besar hanya karena telat unggah.
    saldo_tidak_terbaca    File RK tersimpan, tetapi saldo akhirnya kosong (closing_balance NULL) -> tidak ada yang dibandingkan.
    periode_tidak_terbaca  Saldo ada, tetapi tanggal akhir periode RK kosong -> tidak bisa dipastikan sampai kapan.
    valas                  Akun adalah rekening valas (finance_fx_bank_accounts). Saldo RK dalam mata uang rekening, sedangkan
                           TB dalam rupiah -> tidak bisa dikurangkan langsung.

Urutan prioritas bila beberapa kondisi sekaligus: valas > saldo_tidak_terbaca > periode_tidak_terbaca > belum_akhir_periode > ok.
"""

from __future__ import annotations

import math
from calendar import monthrange
from datetime import date, datetime
from typing import Any, Dict, Optional

# Rekening koran bank biasanya berakhir di hari kerja terakhir (bisa 2-3 hari sebelum tanggal 31, lebih lama saat libur
# panjang). Selisih sampai TOLERANSI_HARI hari masih dianggap "akhir periode".
TOLERANSI_HARI = 5

STATUS_OK = "ok"
STATUS_BELUM_AKHIR = "belum_akhir_periode"
STATUS_SALDO_TIDAK_TERBACA = "saldo_tidak_terbaca"
STATUS_PERIODE_TIDAK_TERBACA = "periode_tidak_terbaca"
STATUS_VALAS = "valas"

SEMUA_STATUS = (STATUS_OK, STATUS_BELUM_AKHIR, STATUS_SALDO_TIDAK_TERBACA, STATUS_PERIODE_TIDAK_TERBACA, STATUS_VALAS)


def akhir_periode(tahun: int, bulan_akhir: int) -> date:
    """Hari terakhir bulan akhir periode laporan (1 Januari s.d. akhir bulan ini)."""
    return date(tahun, bulan_akhir, monthrange(tahun, bulan_akhir)[1])


def _ke_tanggal(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v.strip():
        try:
            return date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _ke_angka(v: Any) -> Optional[float]:
    """Numeric/Decimal/str -> float; kosong atau tidak valid (NaN/inf) -> None."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _mata_uang(v: Any) -> str:
    """'usd ' -> 'USD'. Kosong atau IDR -> '' (rupiah)."""
    m = str(v or "").strip().upper()
    return "" if m in ("", "IDR") else m


def tentukan_status(saldo: Optional[float], periode_akhir: Optional[date], batas: date, mata_uang: str = "") -> str:
    """Status satu akun bank. `batas` = akhir periode laporan."""
    if mata_uang:
        return STATUS_VALAS
    if saldo is None:
        return STATUS_SALDO_TIDAK_TERBACA
    if periode_akhir is None:
        return STATUS_PERIODE_TIDAK_TERBACA
    if (batas - periode_akhir).days > TOLERANSI_HARI:
        return STATUS_BELUM_AKHIR
    return STATUS_OK


def bentuk_baris(r: Dict[str, Any], batas: date, valas_per_coa: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Satu baris hasil query -> JSON untuk frontend. Saldo float atau None; tanggal ISO atau ''."""
    pe = _ke_tanggal(r.get("periode_akhir"))
    saldo = _ke_angka(r.get("saldo"))
    mu = _mata_uang((valas_per_coa or {}).get(str(r.get("coa_id") or "")))
    return {
        "kode": str(r.get("kode") or ""),
        "kode_sistem": str(r.get("kode_sistem") or ""),
        "nama": str(r.get("nama") or ""),
        "saldo": saldo,
        "periode_akhir": pe.isoformat() if pe else "",
        "nama_file": str(r.get("nama_file") or ""),
        "mata_uang": mu,
        "status": tentukan_status(saldo, pe, batas, mu),
        "selisih_hari": (batas - pe).days if pe else None,
    }
