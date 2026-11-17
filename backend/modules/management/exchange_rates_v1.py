"""
modules/management/exchange_rates_v1.py
=======================================
Master kurs -> /api/v1/management/exchange-rates/...  (menu Management > Exchange Rates).

Tabel: management_exchange_rates (migration 56) -- GLOBAL (dipakai semua klien).
1 baris = nilai tukar 1 unit mata uang asing dalam IDR pada satu tanggal.

    rate_type  middle (kurs tengah / BI), buy, sell, tax (kurs pajak KMK)
    source     manual (input / tempel) atau auto (tarik dari penyedia kurs)

Endpoint:
    GET    /meta                 daftar mata uang, jenis kurs, penyedia kurs otomatis
    GET    ""                    daftar kurs (filter mata uang / jenis / tanggal / sumber)
    GET    /latest               kurs terbaru per mata uang + perubahan dari kurs sebelumnya
    GET    /lookup               kurs untuk 1 mata uang pada 1 tanggal (tidak ada -> kurs terakhir
                                 sebelum tanggal itu; `exact` = false). Dipakai form transaksi.
    POST   ""                    simpan 1 kurs (tanggal+mata uang+jenis sudah ada -> ditimpa)
    POST   /bulk                 simpan banyak kurs sekaligus (impor tempel)
    PUT    /{id}                 ubah 1 kurs
    DELETE /{id}                 hapus 1 kurs
    POST   /fetch                tarik kurs otomatis dari penyedia

Baca: semua user login. Tulis: Manager ke atas (LEVEL_POST) -- kurs master mempengaruhi nilai
jurnal, jadi ikut level yang sama dengan Post.

Tarik otomatis (default): Frankfurter (kurs referensi ECB), https://api.frankfurter.dev/v1.
Ini BUKAN kurs JISDOR Bank Indonesia / kurs pajak KMK -- untuk keduanya input manual jenis
'middle' (BI) atau 'tax'. URL penyedia bisa diganti lewat env FX_PROVIDER_URL (format respons
yang sama dengan Frankfurter).

Job harian (opsional): daftarkan_job_tarik_kurs(scheduler) di main.py, aktif kalau
FX_AUTO_FETCH=1. Mata uang lewat FX_AUTO_CURRENCIES (default "USD,SGD"), jam lewat FX_FETCH_JAM
(default 23, zona Asia/Jakarta -- ECB menerbitkan sekitar 16:00 CET).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_helpers as bc

logger = get_module_logger("management_exchange_rates_v1")

router = APIRouter(prefix="/api/v1/management/exchange-rates", tags=["exchange-rates"])

LEVEL_TULIS = bc.LEVEL_POST

MATA_UANG = [
    ("USD", "US Dollar"), ("SGD", "Singapore Dollar"), ("EUR", "Euro"), ("JPY", "Japanese Yen"),
    ("AUD", "Australian Dollar"), ("GBP", "Pound Sterling"), ("CNY", "Chinese Yuan"),
    ("MYR", "Malaysian Ringgit"), ("HKD", "Hong Kong Dollar"),
]
JENIS_KURS = [
    ("middle", "Middle rate (BI / reference)"), ("buy", "Buy rate"), ("sell", "Sell rate"), ("tax", "Tax rate (KMK)"),
]
_KODE_JENIS = {k for k, _ in JENIS_KURS}
URL_PENYEDIA = os.environ.get("FX_PROVIDER_URL", "https://api.frankfurter.dev/v1").rstrip("/")
NAMA_PENYEDIA = "Frankfurter (ECB)"
BATAS_MASA_DEPAN_HARI = 14
BATAS_KURS = Decimal("1000000000")
MAKS_BULK = 500


class _Gagal(Exception):
    def __init__(self, message: str, kode: str = "BAD_REQUEST", status_code: int = 400):
        super().__init__(message)
        self.message, self.kode, self.status_code = message, kode, status_code


def _jalankan(fn):
    session = dbc.SessionLocal()
    try:
        hasil = fn(session)
        session.commit()
        return hasil
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _respon(fn, pesan: str = "OK"):
    try:
        return sukses(data=_jalankan(fn), message=pesan)
    except _Gagal as e:
        return gagal(message=e.message, errors={"code": e.kode}, status_code=e.status_code)


def _nama(user: Dict[str, Any]) -> str:
    return user.get("nama") or user.get("username") or ""


def _f(v: Any) -> float:
    return float(v or 0)


def _kode_mata_uang(v: Any) -> str:
    kode = str(v or "").strip().upper()
    if len(kode) != 3 or not kode.isalpha():
        raise _Gagal("Currency must be a 3-letter code, e.g. USD.")
    if kode == "IDR":
        raise _Gagal("IDR is the base currency and has no exchange rate.")
    return kode


def _jenis(v: Any) -> str:
    j = str(v or "middle").strip().lower()
    if j not in _KODE_JENIS:
        raise _Gagal(f"Unknown rate type '{v}'. Use: {', '.join(sorted(_KODE_JENIS))}.")
    return j


def _nilai_kurs(v: Any) -> Decimal:
    try:
        d = Decimal(str(v).strip().replace(",", ""))
    except (InvalidOperation, AttributeError):
        raise _Gagal("Rate must be a number.")
    if d <= 0 or d >= BATAS_KURS:
        raise _Gagal("Rate must be greater than zero.")
    return d.quantize(Decimal("0.000001"))


def _cek_tanggal(d: date) -> None:
    if d > date.today() + timedelta(days=BATAS_MASA_DEPAN_HARI):
        raise _Gagal(f"Rate date cannot be more than {BATAS_MASA_DEPAN_HARI} days in the future.")


def _baris(r: Any) -> Dict[str, Any]:
    return {
        "id": r.id, "currency": r.currency, "rate_date": r.rate_date, "rate_type": r.rate_type, "rate": _f(r.rate),
        "source": r.source, "source_name": r.source_name, "notes": r.notes,
        "created_at": r.created_at, "created_by_name": r.created_by_name,
        "edited_at": r.edited_at, "edited_by_name": r.edited_by_name,
    }


# ============================================================
# INTI: SIMPAN & CARI KURS (juga dipakai modul lain)
# ============================================================

def simpan_kurs(session, currency: str, rate_date: date, rate_type: str, rate: Decimal, *, source: str = "manual",
                source_name: Optional[str] = None, notes: Optional[str] = None,
                user: Optional[Dict[str, Any]] = None) -> Tuple[Any, bool]:
    """Upsert 1 kurs. Return (baris, dibuat_baru)."""
    ER = dbc.ExchangeRate
    r = session.query(ER).filter(ER.currency == currency, ER.rate_date == rate_date, ER.rate_type == rate_type).one_or_none()
    user = user or {}
    if r is None:
        r = ER(currency=currency, rate_date=rate_date, rate_type=rate_type, rate=rate, source=source,
               source_name=source_name, notes=notes, created_by=user.get("id"), created_by_name=_nama(user) or None)
        session.add(r)
        session.flush()
        return r, True
    r.rate, r.source, r.source_name = rate, source, source_name
    if notes is not None:
        r.notes = notes
    r.edited_at, r.edited_by, r.edited_by_name = datetime.now().astimezone(), user.get("id"), _nama(user) or None
    session.flush()
    return r, False


def cari_kurs(session, currency: str, tanggal: date, rate_type: str = "middle") -> Optional[Dict[str, Any]]:
    """Kurs pada `tanggal`; kalau tidak ada, kurs TERAKHIR sebelum tanggal itu (akhir pekan / libur).
    None kalau belum ada kurs sama sekali sampai tanggal itu. IDR selalu 1."""
    kode = str(currency or "").strip().upper()
    if kode == "IDR":
        return {"currency": "IDR", "rate_type": rate_type, "rate": 1.0, "rate_date": tanggal, "requested_date": tanggal,
                "exact": True, "days_old": 0, "source": "manual", "source_name": None}
    ER = dbc.ExchangeRate
    r = (session.query(ER).filter(ER.currency == kode, ER.rate_type == rate_type, ER.rate_date <= tanggal)
         .order_by(ER.rate_date.desc()).first())
    if r is None:
        return None
    return {"currency": r.currency, "rate_type": r.rate_type, "rate": _f(r.rate), "rate_date": r.rate_date,
            "requested_date": tanggal, "exact": r.rate_date == tanggal, "days_old": (tanggal - r.rate_date).days,
            "source": r.source, "source_name": r.source_name}


# ============================================================
# TARIK OTOMATIS
# ============================================================

def _ambil_dari_penyedia(currency: str, tanggal: Optional[date]) -> Tuple[date, Decimal]:
    """1 mata uang -> IDR dari penyedia. Return (tanggal_kurs_dari_penyedia, kurs).
    Tanggal akhir pekan/libur dijawab penyedia dengan hari kerja terakhir, jadi tanggal yang
    DISIMPAN adalah tanggal dari penyedia, bukan tanggal yang diminta."""
    jalur = tanggal.isoformat() if tanggal else "latest"
    url = f"{URL_PENYEDIA}/{jalur}?" + urllib.parse.urlencode({"base": currency, "symbols": "IDR"})
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "dashboardori-fx/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise _Gagal(f"Rate provider returned HTTP {e.code} for {currency}.", kode="PROVIDER_ERROR", status_code=502)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        raise _Gagal(f"Could not reach the rate provider: {e}", kode="PROVIDER_UNREACHABLE", status_code=502)
    try:
        return date.fromisoformat(str(data["date"])), _nilai_kurs(data["rates"]["IDR"])
    except (KeyError, TypeError, ValueError, _Gagal):
        raise _Gagal(f"Unexpected response from the rate provider for {currency}.", kode="PROVIDER_ERROR", status_code=502)


def tarik_kurs(session, currencies: List[str], tanggal: Optional[date], user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Tarik & simpan kurs 'middle' (source auto). Tiap mata uang berdiri sendiri: yang gagal
    dilaporkan, yang berhasil tetap disimpan."""
    hasil: List[Dict[str, Any]] = []
    for kode in currencies:
        try:
            kode = _kode_mata_uang(kode)
            tgl, kurs = _ambil_dari_penyedia(kode, tanggal)
            r, baru = simpan_kurs(session, kode, tgl, "middle", kurs, source="auto", source_name=NAMA_PENYEDIA, user=user)
            hasil.append({"currency": kode, "ok": True, "rate_date": tgl, "rate": _f(r.rate), "created": baru})
        except _Gagal as e:
            hasil.append({"currency": str(kode), "ok": False, "error": e.message})
    return {"provider": NAMA_PENYEDIA, "results": hasil,
            "saved": sum(1 for h in hasil if h["ok"]), "failed": sum(1 for h in hasil if not h["ok"])}


def tarik_kurs_harian() -> None:
    """Dipanggil scheduler. Gagal jaringan hanya dicatat -- tidak menjatuhkan aplikasi."""
    kode = [c.strip() for c in os.environ.get("FX_AUTO_CURRENCIES", "USD,SGD").split(",") if c.strip()]
    session = dbc.SessionLocal()
    try:
        h = tarik_kurs(session, kode, None)
        session.commit()
        logger.info("Tarik kurs harian: %s tersimpan, %s gagal", h["saved"], h["failed"])
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Tarik kurs harian gagal")
    finally:
        session.close()


def daftarkan_job_tarik_kurs(scheduler) -> bool:
    """Daftarkan job harian ke APScheduler. Hanya aktif kalau FX_AUTO_FETCH=1."""
    if os.environ.get("FX_AUTO_FETCH", "0") != "1":
        return False
    jam = int(os.environ.get("FX_FETCH_JAM", "23"))
    scheduler.add_job(tarik_kurs_harian, "cron", hour=jam, minute=0, id="fx_tarik_kurs_harian", replace_existing=True)
    return True


# ============================================================
# ENDPOINT -- BACA
# ============================================================

@router.get("/meta", summary="Mata uang, jenis kurs, penyedia kurs otomatis")
def meta(_u: Dict[str, Any] = Depends(get_current_user_v1)):
    def aksi(session):
        ER = dbc.ExchangeRate
        ada = [r[0] for r in session.query(ER.currency).distinct().all()]
        kode = {k for k, _ in MATA_UANG}
        return {
            "base_currency": "IDR",
            "currencies": [{"code": k, "name": n} for k, n in MATA_UANG] + [{"code": k, "name": k} for k in sorted(set(ada) - kode)],
            "rate_types": [{"key": k, "label": n} for k, n in JENIS_KURS],
            "provider": {"name": NAMA_PENYEDIA, "note": "Reference rate (ECB). Not BI JISDOR or the KMK tax rate."},
            "auto_fetch_enabled": os.environ.get("FX_AUTO_FETCH", "0") == "1",
            "can_write_level": LEVEL_TULIS,
        }
    return _respon(aksi)


@router.get("", summary="Daftar kurs")
def daftar(
    currency: Optional[str] = Query(None, max_length=3),
    rate_type: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    def aksi(session):
        ER = dbc.ExchangeRate
        q = session.query(ER)
        if currency:
            q = q.filter(ER.currency == currency.strip().upper())
        if rate_type:
            q = q.filter(ER.rate_type == _jenis(rate_type))
        if source in ("manual", "auto"):
            q = q.filter(ER.source == source)
        if date_from:
            q = q.filter(ER.rate_date >= date_from)
        if date_to:
            q = q.filter(ER.rate_date <= date_to)
        total = q.count()
        rows = q.order_by(ER.rate_date.desc(), ER.currency, ER.rate_type).offset(offset).limit(limit).all()
        return {"total": total, "items": [_baris(r) for r in rows]}
    return _respon(aksi)


@router.get("/latest", summary="Kurs terbaru per mata uang + perubahan dari kurs sebelumnya")
def terbaru(rate_type: str = Query("middle"), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    def aksi(session):
        jenis = _jenis(rate_type)
        ER = dbc.ExchangeRate
        rows = session.query(ER).filter(ER.rate_type == jenis).order_by(ER.currency, ER.rate_date.desc()).all()
        per: Dict[str, List[Any]] = {}
        for r in rows:
            if len(per.setdefault(r.currency, [])) < 2:
                per[r.currency].append(r)
        hari_ini = date.today()
        hasil = []
        for kode, (baru, *lama) in per.items():
            sebelum = lama[0] if lama else None
            selisih = _f(baru.rate) - _f(sebelum.rate) if sebelum else None
            hasil.append({
                "currency": kode, "rate_type": jenis, "rate": _f(baru.rate), "rate_date": baru.rate_date,
                "source": baru.source, "source_name": baru.source_name, "days_old": (hari_ini - baru.rate_date).days,
                "previous_rate": _f(sebelum.rate) if sebelum else None, "previous_date": sebelum.rate_date if sebelum else None,
                "change": selisih, "change_pct": (selisih / _f(sebelum.rate) * 100) if sebelum and _f(sebelum.rate) else None,
            })
        urut = {k: i for i, (k, _) in enumerate(MATA_UANG)}
        hasil.sort(key=lambda x: (urut.get(x["currency"], 99), x["currency"]))
        return hasil
    return _respon(aksi)


@router.get("/lookup", summary="Kurs 1 mata uang pada 1 tanggal (carry-forward kalau tanggalnya kosong)")
def lookup(
    currency: str = Query(..., max_length=3),
    on_date: date = Query(..., alias="date"),
    rate_type: str = Query("middle"),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    def aksi(session):
        hasil = cari_kurs(session, currency, on_date, _jenis(rate_type))
        return {"found": hasil is not None, "rate": hasil}
    return _respon(aksi)


# ============================================================
# ENDPOINT -- TULIS
# ============================================================

class KursRequest(BaseModel):
    currency: str = Field(..., min_length=3, max_length=3)
    rate_date: date
    rate_type: str = Field("middle", max_length=10)
    rate: float
    source_name: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)


class KursBulkRequest(BaseModel):
    rows: List[KursRequest] = Field(..., min_length=1, max_length=MAKS_BULK)


class FetchRequest(BaseModel):
    currencies: List[str] = Field(..., min_length=1, max_length=20)
    rate_date: Optional[date] = None


def _simpan_manual(session, p: KursRequest, user: Dict[str, Any]) -> Tuple[Any, bool]:
    kode, jenis, kurs = _kode_mata_uang(p.currency), _jenis(p.rate_type), _nilai_kurs(p.rate)
    _cek_tanggal(p.rate_date)
    return simpan_kurs(session, kode, p.rate_date, jenis, kurs, source="manual",
                       source_name=(p.source_name or "").strip() or None, notes=(p.notes or "").strip() or None, user=user)


@router.post("", summary="Simpan 1 kurs (tanggal + mata uang + jenis sama -> ditimpa)")
def simpan(payload: KursRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_TULIS))):
    def aksi(session):
        r, baru = _simpan_manual(session, payload, current_user)
        return {**_baris(r), "created": baru}
    return _respon(aksi, "Exchange rate saved.")


@router.post("/bulk", summary="Simpan banyak kurs sekaligus; baris yang salah dilaporkan, sisanya tetap tersimpan")
def simpan_banyak(payload: KursBulkRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_TULIS))):
    def aksi(session):
        dibuat = diubah = 0
        galat: List[Dict[str, Any]] = []
        for i, p in enumerate(payload.rows, start=1):
            try:
                with session.begin_nested():
                    _, baru = _simpan_manual(session, p, current_user)
                dibuat, diubah = dibuat + int(baru), diubah + int(not baru)
            except _Gagal as e:
                galat.append({"row": i, "currency": p.currency, "rate_date": p.rate_date, "error": e.message})
        return {"created": dibuat, "updated": diubah, "failed": len(galat), "errors": galat}
    return _respon(aksi, "Exchange rates processed.")


@router.put("/{rate_id}", summary="Ubah 1 kurs")
def ubah(rate_id: UUID, payload: KursRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_TULIS))):
    def aksi(session):
        ER = dbc.ExchangeRate
        r = session.get(ER, str(rate_id))
        if r is None:
            raise _Gagal("Exchange rate not found.", kode="NOT_FOUND", status_code=404)
        kode, jenis, kurs = _kode_mata_uang(payload.currency), _jenis(payload.rate_type), _nilai_kurs(payload.rate)
        _cek_tanggal(payload.rate_date)
        bentrok = session.query(ER).filter(ER.currency == kode, ER.rate_date == payload.rate_date, ER.rate_type == jenis,
                                           ER.id != r.id).first()
        if bentrok is not None:
            raise _Gagal("A rate for this currency, date and type already exists.", kode="CONFLICT", status_code=409)
        r.currency, r.rate_date, r.rate_type, r.rate = kode, payload.rate_date, jenis, kurs
        r.source, r.source_name, r.notes = "manual", (payload.source_name or "").strip() or None, (payload.notes or "").strip() or None
        r.edited_at, r.edited_by, r.edited_by_name = datetime.now().astimezone(), current_user.get("id"), _nama(current_user) or None
        session.flush()
        return _baris(r)
    return _respon(aksi, "Exchange rate updated.")


@router.delete("/{rate_id}", summary="Hapus 1 kurs")
def hapus(rate_id: UUID, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_TULIS))):
    def aksi(session):
        r = session.get(dbc.ExchangeRate, str(rate_id))
        if r is None:
            raise _Gagal("Exchange rate not found.", kode="NOT_FOUND", status_code=404)
        session.delete(r)
        return {"id": str(rate_id)}
    return _respon(aksi, "Exchange rate deleted.")


@router.post("/fetch", summary="Tarik kurs otomatis dari penyedia (kurs middle)")
def tarik(payload: FetchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_TULIS))):
    def aksi(session):
        if payload.rate_date is not None:
            _cek_tanggal(payload.rate_date)
        return tarik_kurs(session, payload.currencies, payload.rate_date, current_user)
    return _respon(aksi, "Rate fetch finished.")
