"""Fungsi bantu yang diambil otomatis dari bank_cash_v1 versi Willi."""
from __future__ import annotations
import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from pydantic import BaseModel, Field
from sqlalchemy import func, text
import db_client as dbc
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("transactions_bank_cash_v1")


LEVEL_INPUT = 3       # Supervisor ke atas: upload, cocokkan, buat/ubah draft, approve


LEVEL_POST = 4        # Manager ke atas: post & reverse


SEN = Decimal("0.01")


NOL = Decimal("0")


TX = dbc.BankCashTransaction


TL = dbc.BankCashTransactionLine


COA = dbc.ManagementClientCoa


_JENIS_KAS = {
    "std_asset_current_cash_bank": "bank",
    "std_asset_current_cash_on_hand": "cash_on_hand",
    "std_asset_current_cash_petty": "petty_cash",
    "std_asset_current_cash_transit": "transit",
}


SUB_AKUN_KAS = "CASH & CASH EQUIVALENTS"


_KATA_BANK = ("bank", "bca", "bri", "bni", "mandiri", "permata", "ocbc", "cimb", "btn", "bjb", "danamon",
              "uob", "niaga", "bpd", "maybank", "panin", "mega", "wise", "escrow", "rekening")


class _Gagal(Exception):
    def __init__(self, message: str, kode: str = "VALIDATION_ERROR", status_code: int = 400, data: Any = None):
        super().__init__(message)
        self.message, self.kode, self.status_code, self.data = message, kode, status_code, data


def _respon_gagal(e: _Gagal):
    errors: Dict[str, Any] = {"code": e.kode}
    if e.data is not None:
        errors["detail"] = e.data
    return gagal(message=e.message, errors=errors, status_code=e.status_code)


def _jalankan(fn):
    """Jalankan fn(session) dalam 1 transaksi DB. Error kunci periode -> 409."""
    session = dbc.SessionLocal()
    try:
        hasil = fn(session)
        session.commit()
        return hasil
    except _Gagal:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        pesan = dbc.pesan_periode_terkunci(e)
        if pesan:
            raise _Gagal(pesan, kode="PERIOD_LOCKED", status_code=409)
        logger.exception("Gagal memproses Cash & Bank")
        raise
    finally:
        session.close()


def _respon(fn, pesan: str = "OK"):
    try:
        return sukses(data=_jalankan(fn), message=pesan)
    except _Gagal as e:
        return _respon_gagal(e)


def _dec(v: Any) -> Decimal:
    if v is None:
        return NOL
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return NOL
    return Decimal(str(v)).quantize(SEN)


def _f(v: Any) -> float:
    return round(float(v or 0), 2) + 0.0


def _nama(user: Dict[str, Any]) -> str:
    return user.get("nama") or user.get("username") or ""


def _sekarang() -> datetime:
    return datetime.now().astimezone()


def _wajib_klien(client_id: str) -> None:
    if dbc.get_management_client_by_id(client_id) is None:
        raise _Gagal("Client not found.", kode="NOT_FOUND", status_code=404)


def _kunci_klien(session, client_id: str) -> None:
    """Serialkan aksi tulis per klien (penomoran & pelunasan invoice tidak balapan)."""
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"bank-cash:{client_id}"})


def _jenis_kas(akun: Any) -> Optional[str]:
    """bank / cash_on_hand / petty_cash / transit untuk akun Kas & Setara Kas; None untuk akun lain."""
    kode = (akun.standard_account_code or "").strip().lower()
    if kode in _JENIS_KAS:
        return _JENIS_KAS[kode]
    if (akun.account_sub or "").strip().upper() != SUB_AKUN_KAS:
        return None
    nama = (akun.account_name or "").lower()
    if "transit" in nama or "perjalanan" in nama or "clearing" in nama:
        return "transit"
    if "kecil" in nama or "petty" in nama:
        return "petty_cash"
    return "bank" if any(k in nama for k in _KATA_BANK) else "cash_on_hand"


def _akun_dict(a: Any) -> Dict[str, Any]:
    return {
        "id": a.id, "code": a.acc_no, "name": a.account_name, "classification": a.account_classification,
        "sub": a.account_sub, "cash_type": _jenis_kas(a), "is_active": bool(a.is_active),
    }


def _akun(session, client_id: str, coa_id: Optional[str]) -> Any:
    if not coa_id:
        raise _Gagal("Account is required.")
    a = session.get(COA, str(coa_id))
    if a is None or a.deleted_at is not None or str(a.client_id) != client_id:
        raise _Gagal("Account not found in this client's chart of accounts.", kode="NOT_FOUND", status_code=404)
    return a


def _akun_kas(session, client_id: str, coa_id: Optional[str]) -> Any:
    a = _akun(session, client_id, coa_id)
    if _jenis_kas(a) is None:
        raise _Gagal(f"Account {a.acc_no} {a.account_name} is not a cash or bank account.")
    return a


def _tulis_baris(session, tx: Any, baris: List[Dict[str, Any]]) -> None:
    session.query(TL).filter(TL.transaction_id == tx.id).delete(synchronize_session=False)
    for no, b in enumerate(baris, 1):
        session.add(TL(transaction_id=tx.id, line_no=no, **b))
    session.flush()


def _nomor_baru(session, client_id: str, arah: str, tanggal: date) -> str:
    awalan = f"{'CR' if arah == 'receipt' else 'CP'}-{tanggal:%y%m}-"
    terakhir = session.query(func.max(TX.tx_number)).filter(
        TX.client_id == client_id, TX.tx_number.like(f"{awalan}%")
    ).scalar()
    urut = int(terakhir.rsplit("-", 1)[1]) + 1 if terakhir and terakhir.rsplit("-", 1)[1].isdigit() else 1
    return f"{awalan}{urut:04d}"


class KlienRequest(BaseModel):
    client_id: UUID


