"""
modules/transactions/bank_cash_v1.py
====================================
Fitur Transactions > Cash & Bank: /api/v1/transactions/bank-cash/...
(menggantikan modules/finance/bank_reconciliation_v1.py milik
playground-hendra yang bergantung pada tabel yang tidak pernah ada di DB ini).

Tabel (migrations/34-create_bank_cash_tables.py, ORM di db_client.py):
    statements         file rekening koran yang di-upload ke Bank Feed
    mutations          baris mutasi rekening koran (unmatched/matched/ignored)
    transactions       Cash Receipt / Cash Payment (draft -> approved -> posted -> reversed)
    transaction_lines  baris lawan: pelunasan invoice Sales/Purchase atau akun bebas

Alur:
  1. Bank Feed  : POST /statements/preview (baca tanpa simpan) lalu
     POST /statements/upload -> modules/transactions/bank_statement_extractor
     (PDF grid -> posisi kata -> OCR; Excel/CSV) + validasi saldo & confidence
     per baris; format yang lolos validasi / dikoreksi user disimpan sebagai
     template (/import-templates, migration 35). Header tidak dikenali ->
     parser lama akuntansi_ai.muat_workbook. Baris yang sudah pernah tersimpan
     (row_hash sama) dilewati. Baris confidence 'low' dilewati auto-match
     sampai di-review (/mutations/{id}/review).
     Akun tujuan boleh kosong ("Auto-detect"): dipilih dari mapping bank
     (/bank-mappings, migration 36) lewat nomor rekening / kata kunci judul /
     template / nama bank; upload ke akun pilihan manual mencatat mapping baru.
     Seed SAU (BCA/BRI/Mandiri/Kas Kasir): migrations/seed_template_sau_bank_cash.sql.
  2. Reconciliation: mutasi dicocokkan ke invoice outstanding
     (/mutations/{id}/match) atau ke akun bebas (/mutations/{id}/match-account)
     -> transaksi DRAFT. /mutations/suggestions memberi kandidat + skor,
     /mutations/auto-match mencocokkan yang pasti.
  3. Input manual: POST /transactions (kas kecil/tunai atau bank tanpa rekening koran).
  4. Approve (Supervisor+) -> Post (Manager+): transaksi masuk GL/FS
     (db_client.ambil_baris_jurnal_posted_transaksi sumber "cash_bank") &
     pelunasan invoice diterapkan (Sales.paid_amount, Purchase.payment_status).
  5. Reverse (Manager+): jurnal pembalik RV-<no> di tanggal pembalik,
     pelunasan invoice dikembalikan, mutasi bank kembali 'unmatched'.

Sales.posting_status SENGAJA tidak diubah (GL hanya membaca invoice
'posted'); status bayar Sales dibaca dari paid_amount/outstanding_amount.
Purchase.accounts_payable juga tidak diubah (nilai kredit Hutang di GL).

Kunci periode Year-End Closing berlaku lewat trigger DB (migration 34).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import itertools
import json
import math
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from . import bank_statement_extractor as bx

logger = get_module_logger("transactions_bank_cash_v1")

router = APIRouter(prefix="/api/v1/transactions/bank-cash", tags=["transactions-bank-cash-v1"])

LEVEL_INPUT = 3       # Supervisor ke atas: upload, cocokkan, buat/ubah draft, approve
LEVEL_POST = 4        # Manager ke atas: post & reverse
SEN = Decimal("0.01")
NOL = Decimal("0")
TOLERANSI = Decimal("0.50")
MAKS_UKURAN_FILE = 20 * 1024 * 1024

ST = dbc.BankCashStatement
MU = dbc.BankCashMutation
TPL = dbc.BankCashImportTemplate
MAP = dbc.BankCashBankMapping
TX = dbc.BankCashTransaction
TL = dbc.BankCashTransactionLine
COA = dbc.ManagementClientCoa
SI = dbc.SalesInvoice
PT = dbc.PurchaseTransaction

# Jenis akun kas/bank dari standard_account_code COA klien.
_JENIS_KAS = {
    "std_asset_current_cash_bank": "bank",
    "std_asset_current_cash_on_hand": "cash_on_hand",
    "std_asset_current_cash_petty": "petty_cash",
    "std_asset_current_cash_transit": "transit",
}
SUB_AKUN_KAS = "CASH & CASH EQUIVALENTS"
_KATA_BANK = ("bank", "bca", "bri", "bni", "mandiri", "permata", "ocbc", "cimb", "btn", "bjb", "danamon",
              "uob", "niaga", "bpd", "maybank", "panin", "mega", "wise", "escrow", "rekening")

# Kata umum yang tidak dianggap bukti nama pihak saat mencocokkan mutasi ke invoice.
_KATA_ABAIKAN = {
    "pt", "cv", "tbk", "ud", "pd", "persero", "the", "and", "dan", "bank", "transfer", "trf", "trsf",
    "payment", "pembayaran", "bayar", "inv", "invoice", "faktur", "no", "nomor", "ke", "dari", "atas",
    "untuk", "via", "ibanking", "mbanking", "banking", "kliring", "sknbi", "bifast", "fast", "switching",
}

KATEGORI_INVOICE = {"receipt": "Customer Payment", "payment": "Vendor Payment"}


# ============================================================
# ERROR & UTIL
# ============================================================

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


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _token(s: Optional[str]) -> set:
    return {t for t in re.findall(r"[a-z0-9]+", (s or "").lower())
            if len(t) >= 3 and not t.isdigit() and t not in _KATA_ABAIKAN}


def _parse_tanggal(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if hasattr(v, "to_pydatetime"):
        try:
            return v.to_pydatetime().date()
        except (ValueError, TypeError):
            return None
    s = str(v).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s[:10] if fmt == "%Y-%m-%d" else s, fmt).date()
        except ValueError:
            continue
    return None


# ============================================================
# AKUN (COA)
# ============================================================

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


# ============================================================
# INVOICE OUTSTANDING
# ============================================================

def _alokasi_aktif(session, client_id: str, kolom: str, ids: Optional[List[str]] = None,
                   kecuali_tx: Optional[str] = None) -> Dict[str, Dict[str, Decimal]]:
    """Total alokasi transaksi Cash & Bank per invoice: {'posted': .., 'pending': ..}.
    pending = draft/approved (belum mengubah invoice). reversed tidak dihitung."""
    q = session.query(getattr(TL, kolom), TX.status, TX.direction, func.sum(TL.debit), func.sum(TL.credit)).join(
        TX, TX.id == TL.transaction_id
    ).filter(
        TX.client_id == client_id, TX.deleted_at.is_(None), TX.status.in_(("draft", "approved", "posted")),
        getattr(TL, kolom).isnot(None),
    )
    if ids is not None:
        q = q.filter(getattr(TL, kolom).in_(ids))
    if kecuali_tx:
        q = q.filter(TX.id != kecuali_tx)
    hasil: Dict[str, Dict[str, Decimal]] = {}
    for inv_id, status, arah, deb, kre in q.group_by(getattr(TL, kolom), TX.status, TX.direction).all():
        # receipt: piutang di kredit; payment: hutang di debit. Sisi sebaliknya mengurangi.
        nilai = _dec(kre) - _dec(deb) if arah == "receipt" else _dec(deb) - _dec(kre)
        e = hasil.setdefault(str(inv_id), {"posted": NOL, "pending": NOL})
        e["posted" if status == "posted" else "pending"] += nilai
    return hasil


def _akun_piutang(session, inv: Any, cache: Dict[Any, Any]) -> Tuple[str, str]:
    m = session.query(dbc.SalesAccountMapping).filter(
        dbc.SalesAccountMapping.invoice_id == inv.id, dbc.SalesAccountMapping.deleted_at.is_(None)
    ).first()
    if m and m.piutang_account_code:
        return m.piutang_account_code, m.piutang_account_name or ""
    kunci = (inv.management_client_id, (inv.cabang or "").upper())
    if kunci not in cache:
        cache[kunci] = dbc.akun_default_sales(inv.management_client_id, inv.cabang, session=session) or {}
    akun = cache[kunci].get("piutang") or dbc._AKUN_DEFAULT_SALES["piutang"]
    return akun[0], akun[1] or ""


def _invoice_sales_dict(inv: Any, alok: Dict[str, Decimal]) -> Dict[str, Any]:
    total = _dec(inv.gross_amount)
    dibayar = _dec(inv.paid_amount)
    pending = alok.get("pending", NOL)
    return {
        "type": "sales", "id": inv.id, "no": inv.invoice_no, "party": inv.customer_name,
        "date": inv.invoice_date, "due_date": inv.due_date, "description": inv.description,
        "category": inv.transaction_type, "total": _f(total), "paid": _f(dibayar), "in_process": _f(pending),
        "outstanding": _f(max(total - dibayar - pending, NOL)), "status": inv.posting_status,
    }


def _dibayar_purchase(tx: Any, alok: Dict[str, Decimal]) -> Decimal:
    """Purchase tidak punya kolom 'paid': dibayar = alokasi Cash & Bank yang posted.
    Transaksi lama yang ditandai lunas manual (payment_status 'paid') dianggap lunas."""
    total = _dec(tx.accounts_payable if tx.accounts_payable is not None else tx.total)
    dibayar = alok.get("posted", NOL)
    if (tx.payment_status or "").lower() == "paid" and dibayar < total:
        return total
    return min(dibayar, total)


def _invoice_purchase_dict(tx: Any, alok: Dict[str, Decimal]) -> Dict[str, Any]:
    total = _dec(tx.accounts_payable if tx.accounts_payable is not None else tx.total)
    dibayar = _dibayar_purchase(tx, alok)
    pending = alok.get("pending", NOL)
    return {
        "type": "purchase", "id": tx.id, "no": tx.invoice_number or tx.purchase_no, "purchase_no": tx.purchase_no,
        "invoice_number": tx.invoice_number, "party": tx.vendor_name, "date": tx.invoice_date or tx.purchase_date,
        "purchase_date": tx.purchase_date, "due_date": tx.due_date, "description": tx.description,
        "category": tx.category, "total": _f(total), "paid": _f(dibayar), "in_process": _f(pending),
        "outstanding": _f(max(total - dibayar - pending, NOL)), "status": tx.status,
        "payment_status": tx.payment_status,
    }


def _daftar_invoice(session, client_id: str, tipe: str, hanya_terbuka: bool = False) -> List[Dict[str, Any]]:
    if tipe == "sales":
        rows = session.query(SI).filter(
            SI.management_client_id == client_id, SI.deleted_at.is_(None), func.lower(SI.posting_status) == "posted",
        ).order_by(SI.invoice_date.desc()).all()
        alok = _alokasi_aktif(session, client_id, "sales_invoice_id")
        hasil = [_invoice_sales_dict(r, alok.get(str(r.id), {})) for r in rows]
    else:
        rows = session.query(PT).filter(
            PT.management_client_id == client_id, PT.deleted_at.is_(None), func.lower(PT.status) == "posted",
        ).order_by(PT.purchase_date.desc()).all()
        alok = _alokasi_aktif(session, client_id, "purchase_transaction_id")
        hasil = [_invoice_purchase_dict(r, alok.get(str(r.id), {})) for r in rows]
    if hanya_terbuka:
        hasil = [h for h in hasil if h["outstanding"] > float(TOLERANSI)]
    return hasil


# ============================================================
# SUSUN BARIS TRANSAKSI
# ============================================================

class BarisIn(BaseModel):
    type: str = Field(..., pattern="^(sales_invoice|purchase|account)$")
    invoice_id: Optional[UUID] = None
    coa_id: Optional[UUID] = None
    amount: float = Field(..., gt=0)
    side: Optional[str] = Field(None, pattern="^(debit|credit)$")  # akun bebas; default = sisi lawan kas
    description: Optional[str] = Field(None, max_length=1000)


def _sisi_lawan(arah: str) -> str:
    return "credit" if arah == "receipt" else "debit"


def _susun_baris(session, client_id: str, arah: str, baris: List[BarisIn], kecuali_tx: Optional[str] = None
                 ) -> Tuple[List[Dict[str, Any]], Decimal, str, Optional[str]]:
    """Validasi & bentuk baris lawan. Hasil: (baris, nominal kas, jenis, pihak).
    Pelunasan invoice: arah receipt hanya invoice Sales, payment hanya Purchase,
    nominal <= sisa tagihan (di luar alokasi transaksi ini sendiri)."""
    if not baris:
        raise _Gagal("At least one line is required.")
    cache_sales: Dict[Any, Any] = {}
    hasil: List[Dict[str, Any]] = []
    pihak: List[str] = []
    ada_invoice = False
    dipakai: Dict[str, Decimal] = {}
    for b in baris:
        jumlah = _dec(b.amount)
        if b.type == "sales_invoice":
            if arah != "receipt":
                raise _Gagal("Sales invoices can only be settled by a cash receipt.")
            inv = session.get(SI, str(b.invoice_id)) if b.invoice_id else None
            if inv is None or inv.deleted_at is not None or str(inv.management_client_id) != client_id:
                raise _Gagal("Sales invoice not found.", kode="NOT_FOUND", status_code=404)
            if (inv.posting_status or "").lower() != "posted":
                raise _Gagal(f"Sales invoice {inv.invoice_no} is not posted yet.")
            alok = _alokasi_aktif(session, client_id, "sales_invoice_id", [inv.id], kecuali_tx).get(str(inv.id), {})
            sisa = _dec(inv.gross_amount) - _dec(inv.paid_amount) - alok.get("pending", NOL) - dipakai.get(inv.id, NOL)
            if jumlah > sisa + TOLERANSI:
                raise _Gagal(f"Amount {_f(jumlah):,.2f} exceeds the outstanding balance of invoice {inv.invoice_no} ({_f(max(sisa, NOL)):,.2f}).")
            dipakai[inv.id] = dipakai.get(inv.id, NOL) + jumlah
            kode, nama = _akun_piutang(session, inv, cache_sales)
            hasil.append({"line_type": "sales_invoice", "sales_invoice_id": inv.id, "purchase_transaction_id": None,
                          "coa_id": None, "account_code": kode, "account_name": nama,
                          "description": b.description or f"Receipt for {inv.invoice_no}",
                          "debit": NOL, "credit": jumlah})
            pihak.append(inv.customer_name or "")
            ada_invoice = True
        elif b.type == "purchase":
            if arah != "payment":
                raise _Gagal("Purchase invoices can only be settled by a cash payment.")
            tx = session.get(PT, str(b.invoice_id)) if b.invoice_id else None
            if tx is None or tx.deleted_at is not None or str(tx.management_client_id) != client_id:
                raise _Gagal("Purchase transaction not found.", kode="NOT_FOUND", status_code=404)
            if (tx.status or "").lower() != "posted":
                raise _Gagal(f"Purchase {tx.purchase_no} is not posted yet.")
            alok = _alokasi_aktif(session, client_id, "purchase_transaction_id", [tx.id], kecuali_tx).get(str(tx.id), {})
            total = _dec(tx.accounts_payable if tx.accounts_payable is not None else tx.total)
            sisa = total - _dibayar_purchase(tx, alok) - alok.get("pending", NOL) - dipakai.get(tx.id, NOL)
            no = tx.invoice_number or tx.purchase_no
            if jumlah > sisa + TOLERANSI:
                raise _Gagal(f"Amount {_f(jumlah):,.2f} exceeds the outstanding balance of {no} ({_f(max(sisa, NOL)):,.2f}).")
            dipakai[tx.id] = dipakai.get(tx.id, NOL) + jumlah
            kode, nama = dbc.akun_posting_purchase(tx)["ap"]
            hasil.append({"line_type": "purchase", "sales_invoice_id": None, "purchase_transaction_id": tx.id,
                          "coa_id": None, "account_code": kode, "account_name": nama or "",
                          "description": b.description or f"Payment for {no}",
                          "debit": jumlah, "credit": NOL})
            pihak.append(tx.vendor_name or "")
            ada_invoice = True
        else:
            akun = _akun(session, client_id, str(b.coa_id) if b.coa_id else None)
            sisi = b.side or _sisi_lawan(arah)
            hasil.append({"line_type": "account", "sales_invoice_id": None, "purchase_transaction_id": None,
                          "coa_id": akun.id, "account_code": akun.acc_no, "account_name": akun.account_name,
                          "description": b.description, "debit": jumlah if sisi == "debit" else NOL,
                          "credit": jumlah if sisi == "credit" else NOL})

    # Nominal kas = selisih sisi lawan: receipt -> kredit - debit, payment -> debit - kredit.
    tot_d = sum((h["debit"] for h in hasil), NOL)
    tot_k = sum((h["credit"] for h in hasil), NOL)
    nominal = tot_k - tot_d if arah == "receipt" else tot_d - tot_k
    if nominal <= 0:
        raise _Gagal("The lines must result in a positive cash amount. Check the debit/credit side of each line.")
    unik = list(dict.fromkeys(p for p in pihak if p))
    return hasil, nominal, ("invoice" if ada_invoice else "non_invoice"), (", ".join(unik) if unik else None)


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


# ============================================================
# SERIALISASI
# ============================================================

def _tx_dict(session, tx: Any, baris: Optional[List[Any]] = None, mutasi: Any = None) -> Dict[str, Any]:
    if baris is None:
        baris = session.query(TL).filter(TL.transaction_id == tx.id).order_by(TL.line_no).all()
    if mutasi is None and tx.mutation_id:
        mutasi = session.get(MU, tx.mutation_id)
    no_inv: Dict[str, Tuple[str, str]] = {}
    sid = [b.sales_invoice_id for b in baris if b.sales_invoice_id]
    pid = [b.purchase_transaction_id for b in baris if b.purchase_transaction_id]
    if sid:
        for i in session.query(SI.id, SI.invoice_no, SI.customer_name).filter(SI.id.in_(sid)).all():
            no_inv[str(i[0])] = (i[1], i[2])
    if pid:
        for p in session.query(PT.id, PT.invoice_number, PT.purchase_no, PT.vendor_name).filter(PT.id.in_(pid)).all():
            no_inv[str(p[0])] = (p[1] or p[2], p[3])
    jurnal = dbc.baris_jurnal_kas_bank(tx, baris)
    return {
        "id": tx.id, "tx_number": tx.tx_number, "direction": tx.direction, "tx_date": tx.tx_date,
        "bank_coa_id": tx.bank_coa_id, "bank_account_code": tx.bank_account_code, "bank_account_name": tx.bank_account_name,
        "amount": _f(tx.amount), "kind": tx.kind, "category": tx.category, "counterparty": tx.counterparty,
        "description": tx.description, "reference": tx.reference, "source": tx.source,
        "mutation": None if mutasi is None else {
            "id": mutasi.id, "date": mutasi.mutation_date, "description": mutasi.description,
            "debit": _f(mutasi.debit), "credit": _f(mutasi.credit), "statement_id": mutasi.statement_id,
        },
        "status": tx.status,
        "approved_at": tx.approved_at, "approved_by_name": tx.approved_by_name,
        "posted_at": tx.posted_at, "posted_by_name": tx.posted_by_name,
        "reversal_date": tx.reversal_date, "reversal_reason": tx.reversal_reason,
        "reversed_at": tx.reversed_at, "reversed_by_name": tx.reversed_by_name,
        "created_at": tx.created_at, "created_by_name": tx.created_by_name,
        "lines": [{
            "id": b.id, "line_no": b.line_no, "line_type": b.line_type,
            "sales_invoice_id": b.sales_invoice_id, "purchase_transaction_id": b.purchase_transaction_id,
            "invoice_no": no_inv.get(str(b.sales_invoice_id or b.purchase_transaction_id), (None, None))[0],
            "party": no_inv.get(str(b.sales_invoice_id or b.purchase_transaction_id), (None, None))[1],
            "coa_id": b.coa_id, "account_code": b.account_code, "account_name": b.account_name,
            "description": b.description, "debit": _f(b.debit), "credit": _f(b.credit),
            "amount": _f(b.credit - b.debit if tx.direction == "receipt" else b.debit - b.credit),
        } for b in baris],
        "journal": [{"line_no": i, "account_code": j["account_code"], "account_name": j["account_name"],
                     "description": j["description"], "debit": j["debit"], "credit": j["kredit"]}
                    for i, j in enumerate(jurnal, 1)],
    }


def _mutasi_dict(m: Any, akun: Dict[str, Any], tx: Any = None, nama_file: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": m.id, "statement_id": m.statement_id, "bank_coa_id": m.bank_coa_id,
        "bank_account_code": akun.get("code"), "bank_account_name": akun.get("name"),
        "line_no": m.line_no, "date": m.mutation_date, "description": m.description,
        "debit": _f(m.debit), "credit": _f(m.credit), "balance_after": None if m.balance_after is None else _f(m.balance_after),
        "status": m.status, "ignore_reason": m.ignore_reason, "file_name": nama_file,
        "confidence": m.confidence, "confidence_notes": m.confidence_notes or [], "page_no": m.page_no,
        "reviewed_at": m.reviewed_at, "reviewed_by_name": m.reviewed_by_name,
        "transaction": None if tx is None else {
            "id": tx.id, "tx_number": tx.tx_number, "status": tx.status, "kind": tx.kind,
            "category": tx.category, "counterparty": tx.counterparty, "amount": _f(tx.amount),
        },
    }


def _ambil_tx(session, client_id: str, tx_id: Any) -> Any:
    tx = session.get(TX, str(tx_id))
    if tx is None or tx.deleted_at is not None or str(tx.client_id) != client_id:
        raise _Gagal("Cash & bank transaction not found.", kode="NOT_FOUND", status_code=404)
    return tx


def _ambil_mutasi(session, client_id: str, mutation_id: Any) -> Any:
    m = session.get(MU, str(mutation_id))
    if m is None or m.deleted_at is not None or str(m.client_id) != client_id:
        raise _Gagal("Bank mutation not found.", kode="NOT_FOUND", status_code=404)
    return m


# ============================================================
# PELUNASAN INVOICE (saat post / reverse)
# ============================================================

def _terapkan_pelunasan(session, client_id: str, tx: Any, tanda: int) -> None:
    """tanda +1 = post (bayar), -1 = reverse (batalkan bayar)."""
    baris = session.query(TL).filter(TL.transaction_id == tx.id).all()
    for b in baris:
        if b.sales_invoice_id:
            inv = session.get(SI, b.sales_invoice_id)
            if inv is None:
                continue
            nilai = _dec(b.credit) - _dec(b.debit)
            baru = _dec(inv.paid_amount) + nilai * tanda
            if baru > _dec(inv.gross_amount) + TOLERANSI:
                raise _Gagal(f"Posting would overpay sales invoice {inv.invoice_no}.")
            inv.paid_amount = max(baru, NOL)
            inv.reconcile_status = "Reconciled" if _dec(inv.gross_amount) - inv.paid_amount <= TOLERANSI else "Unreconciled"
            inv.edited_at = datetime.now()
    # Purchase: status bayar dihitung ulang dari alokasi posted (session sudah flush status baru tx).
    session.flush()
    pid = list({b.purchase_transaction_id for b in baris if b.purchase_transaction_id})
    if pid:
        alok = _alokasi_aktif(session, client_id, "purchase_transaction_id", pid)
        for p in session.query(PT).filter(PT.id.in_(pid)).all():
            total = _dec(p.accounts_payable if p.accounts_payable is not None else p.total)
            dibayar = alok.get(str(p.id), {}).get("posted", NOL)
            if dibayar > total + TOLERANSI:
                raise _Gagal(f"Posting would overpay purchase {p.invoice_number or p.purchase_no}.")
            if dibayar >= total - TOLERANSI and total > 0:
                p.payment_status = "paid"
            elif dibayar > 0:
                p.payment_status = "partially_paid"
            elif (p.payment_status or "").lower() in ("paid", "partially_paid"):
                p.payment_status = "unpaid"
            p.edited_at = datetime.now()


# ============================================================
# ENDPOINT -- AKUN & INVOICE
# ============================================================

@router.get("/accounts", summary="Akun COA klien + jenis kas (bank/cash_on_hand/petty_cash/transit) untuk dropdown")
def daftar_akun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()
        return [_akun_dict(a) for a in rows]
    return _respon(aksi)


@router.get("/open-invoices", summary="Invoice Sales / Purchase posted beserta total, dibayar, dalam proses & sisa")
def daftar_invoice(
    client_id: UUID = Query(...),
    type: str = Query(..., pattern="^(sales|purchase)$"),
    only_open: bool = Query(False, description="Hanya yang masih ada sisa tagihan"),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    kid = str(client_id)
    return _respon(lambda s: _daftar_invoice(s, kid, type, only_open))


# ============================================================
# ENDPOINT -- BANK FEED (statement & mutasi)
# ============================================================

def _baris_dari_file(isi: bytes, nama_file: str) -> Tuple[List[Dict[str, Any]], Optional[float], Optional[float], List[str]]:
    """Parse rekening koran (PDF/Excel/CSV) -> baris mutasi mentah, saldo awal/akhir footer, peringatan."""
    import akuntansi_ai as ak  # modul berat, dimuat saat dipakai saja
    df, _jual, _nilai, _piutang, _coa, peringatan = ak.muat_workbook(io.BytesIO(isi), nama_file)
    peringatan = [p for p in (peringatan or []) if p]
    if df is None or len(df) == 0:
        return [], None, None, peringatan
    footer = (getattr(df, "attrs", {}) or {}).get("ringkasan_footer_per_sheet") or {}
    kandidat = [v for v in footer.values() if isinstance(v, dict) and v.get("saldo_awal") is not None]
    awal = akhir = None
    if len(kandidat) == 1:
        awal = kandidat[0].get("saldo_awal")
        akhir = kandidat[0].get("saldo_akhir")
    elif len(kandidat) > 1:
        peringatan.append("The file contains more than one account summary; opening balance was not taken from the footer.")
    if "bank" in df.columns and df["bank"].nunique(dropna=True) > 1:
        peringatan.append("The file contains several sheets/accounts; all rows were imported into the selected bank account.")

    hasil: List[Dict[str, Any]] = []
    gagal_tanggal = 0
    for _, r in df.iterrows():
        tgl = _parse_tanggal(r.get("tanggal"))
        debet, kredit = _dec(r.get("mutasi_debet")), _dec(r.get("mutasi_kredit"))
        if debet < 0:
            debet = NOL
        if kredit < 0:
            kredit = NOL
        if debet > 0 and kredit > 0:  # 1 baris berisi dua arah -> pecah jadi dua mutasi
            pasangan = [(debet, NOL), (NOL, kredit)]
        else:
            pasangan = [(debet, kredit)]
        for d, k in pasangan:
            if d == 0 and k == 0:
                continue
            if tgl is None:
                gagal_tanggal += 1
                continue
            saldo = r.get("saldo")
            hasil.append({
                "tanggal": tgl, "keterangan": (str(r.get("keterangan") or "").strip() or None),
                "debit": d, "credit": k,
                "saldo": None if saldo is None or (isinstance(saldo, float) and math.isnan(saldo)) else _dec(saldo),
            })
    if gagal_tanggal:
        peringatan.append(f"{gagal_tanggal} row(s) skipped because the date could not be read.")
    return hasil, (float(awal) if awal is not None else None), (float(akhir) if akhir is not None else None), peringatan


def _hash_baris(bank_coa_id: str, r: Dict[str, Any], ke: int) -> str:
    kunci = f"{bank_coa_id}|{r['tanggal'].isoformat()}|{_norm(r['keterangan'])}|{r['debit']}|{r['credit']}|{ke}"
    return hashlib.sha256(kunci.encode("utf-8")).hexdigest()


@router.get("/statements", summary="Daftar file rekening koran yang sudah di-upload ke Bank Feed")
def daftar_statement(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(ST).filter(ST.client_id == kid, ST.deleted_at.is_(None)).order_by(ST.created_at.desc()).all()
        akun = {a.id: _akun_dict(a) for a in session.query(COA).filter(COA.id.in_([r.bank_coa_id for r in rows])).all()} if rows else {}
        jumlah: Dict[str, Dict[str, int]] = {}
        if rows:
            for sid, st, n in session.query(MU.statement_id, MU.status, func.count()).filter(
                MU.statement_id.in_([r.id for r in rows]), MU.deleted_at.is_(None)
            ).group_by(MU.statement_id, MU.status).all():
                jumlah.setdefault(str(sid), {})[st] = n
        rendah: Dict[str, int] = {}
        templ: Dict[str, str] = {}
        if rows:
            rendah = {str(sid): n for sid, n in session.query(MU.statement_id, func.count()).filter(
                MU.statement_id.in_([r.id for r in rows]), MU.deleted_at.is_(None), MU.status == "unmatched",
                MU.confidence == "low").group_by(MU.statement_id).all()}
            tids = {r.template_id for r in rows if r.template_id}
            if tids:
                templ = {t.id: t.template_name for t in session.query(TPL).filter(TPL.id.in_(tids)).all()}
        return [{
            "id": r.id, "bank_coa_id": r.bank_coa_id, "bank_account_code": akun.get(r.bank_coa_id, {}).get("code"),
            "bank_account_name": akun.get(r.bank_coa_id, {}).get("name"), "file_name": r.file_name,
            "period_start": r.period_start, "period_end": r.period_end,
            "opening_balance": None if r.opening_balance is None else _f(r.opening_balance),
            "closing_balance": None if r.closing_balance is None else _f(r.closing_balance),
            "total_debit": _f(r.total_debit), "total_credit": _f(r.total_credit),
            "line_count": r.line_count, "duplicate_count": r.duplicate_count,
            "matched_count": jumlah.get(str(r.id), {}).get("matched", 0),
            "unmatched_count": jumlah.get(str(r.id), {}).get("unmatched", 0),
            "ignored_count": jumlah.get(str(r.id), {}).get("ignored", 0),
            "warnings": r.warnings or [], "created_at": r.created_at, "created_by_name": r.created_by_name,
            "file_type": r.file_type, "extraction_method": r.extraction_method, "template_id": r.template_id,
            "template_name": templ.get(r.template_id), "validation": r.validation,
            "low_confidence_count": rendah.get(str(r.id), 0),
        } for r in rows]
    return _respon(aksi)


# ------------------------------------------------------------
# Ekstraksi (bank_statement_extractor) + template pola rekening koran
# ------------------------------------------------------------

def _template_dict(t: Any) -> Dict[str, Any]:
    aturan = t.mapping_rules or {}
    return {
        "id": t.id, "template_name": t.template_name, "file_type": t.file_type,
        "column_signature_hash": t.column_signature_hash, "header_columns": t.header_columns or [],
        "mapping_rules": aturan, "method": aturan.get("method"), "bank_name": aturan.get("bank_name"),
        "detected_by": t.detected_by, "verified_pct": None if t.ai_confidence is None else float(t.ai_confidence),
        "is_active": bool(t.is_active), "usage_count": t.usage_count or 0, "last_used_at": t.last_used_at,
        "created_at": t.created_at, "edited_at": t.edited_at,
    }


def _template_aktif(kid: str) -> List[Dict[str, Any]]:
    return _jalankan(lambda s: [_template_dict(t) for t in s.query(TPL).filter(
        TPL.client_id == kid, TPL.deleted_at.is_(None), TPL.is_active.is_(True)).all()])


def _baca_mapping(teks: Optional[str]) -> Optional[Dict[str, Any]]:
    """mapping_rules hasil koreksi user di modal review (JSON string dari form)."""
    if not teks or not teks.strip():
        return None
    try:
        d = json.loads(teks)
    except ValueError:
        raise _Gagal("mapping_rules must be valid JSON.")
    if not isinstance(d, dict) or not isinstance(d.get("columns"), list) or not d["columns"]:
        raise _Gagal("mapping_rules.columns is required.")
    roles = [c.get("role") for c in d["columns"] if isinstance(c, dict)]
    if len(roles) != len(d["columns"]) or any(r not in bx.ROLES for r in roles):
        raise _Gagal("Every column needs a valid role.")
    if roles.count("date") != 1:
        raise _Gagal("Choose exactly one column that holds the transaction date.")
    if "amount" not in roles and not ("debit" in roles and "credit" in roles):
        raise _Gagal("Choose the amount column: either one Amount column, or both a Debit and a Credit column.")
    d["amount_mode"] = "split" if ("debit" in roles and "credit" in roles and "amount" not in roles) else "single"
    return d


def _ekstrak_semua(isi: bytes, nama_file: str, templates: List[Dict[str, Any]],
                   override: Optional[Dict[str, Any]]) -> Optional[bx.HasilEkstraksi]:
    """Ekstraktor bertingkat; kalau header tabel mutasi tidak dikenali sama sekali,
    coba parser lama akuntansi_ai.muat_workbook (format khusus yang sudah didukung
    sebelumnya) -- barisnya tetap divalidasi saldo yang sama."""
    hasil = bx.ekstrak_rekening_koran(isi, nama_file, templates, override)
    if hasil is not None and hasil.baris:
        return hasil
    try:
        rows, awal, akhir, peringatan = _baris_dari_file(isi, nama_file)
    except Exception as e:  # parser lama gagal -> pakai hasil ekstraktor (kalau ada) apa adanya
        logger.info(f"Parser lama juga gagal membaca '{nama_file}': {e}")
        rows, awal, akhir, peringatan = [], None, None, []
    if not rows:
        return hasil  # header dikenali tapi 0 baris -> user masih bisa memperbaiki peran kolom
    baris = [bx.Baris(tanggal=r["tanggal"], keterangan=r["keterangan"] or "", debit=r["debit"], credit=r["credit"],
                      saldo=r["saldo"], halaman=None) for r in rows]
    v = bx.validasi(baris, {"opening": None if awal is None else _dec(awal), "closing": None if akhir is None else _dec(akhir)})
    return bx.HasilEkstraksi(
        file_type=bx.jenis_file(nama_file) or "", metode="legacy", headers=[], signature="", aturan=bx.Aturan(roles=[]),
        baris=baris, validasi=v,
        peringatan=peringatan + ["The column layout was not recognized; the generic parser was used (no extraction template)."],
        bank=None, periode=(None, None), sheet_name=None, header_row_index=1,
    )


def _baris_siap(hasil: bx.HasilEkstraksi, bank_id: str) -> Tuple[List[Dict[str, Any]], int]:
    """Baris hasil ekstraksi -> baris mutasi siap simpan (+ row_hash). Baris berisi
    debit & kredit sekaligus dipecah jadi dua mutasi."""
    rows: List[Dict[str, Any]] = []
    tanpa_tanggal = 0
    for b in hasil.baris:
        if b.tanggal is None:
            tanpa_tanggal += 1
            continue
        pasangan = [(b.debit, NOL), (NOL, b.credit)] if b.debit > 0 and b.credit > 0 else [(b.debit, b.credit)]
        for d, k in pasangan:
            if d == 0 and k == 0:
                continue
            rows.append({"tanggal": b.tanggal, "keterangan": (b.keterangan or "").strip() or None, "debit": d, "credit": k,
                         "saldo": b.saldo, "halaman": b.halaman, "confidence": b.confidence, "catatan": list(b.catatan)})
    rows.sort(key=lambda r: r["tanggal"])  # stabil: urutan asli per tanggal dipertahankan
    ke: Dict[tuple, int] = {}
    for r in rows:
        k = (r["tanggal"], _norm(r["keterangan"]), r["debit"], r["credit"])
        ke[k] = ke.get(k, 0) + 1
        r["hash"] = _hash_baris(bank_id, r, ke[k])
    return rows, tanpa_tanggal


def _nama_template(session, kid: str, hasil: bx.HasilEkstraksi) -> str:
    dasar = f"{hasil.bank or 'Bank statement'} - {hasil.file_type}"
    ada = {n for (n,) in session.query(TPL.template_name).filter(TPL.client_id == kid, TPL.deleted_at.is_(None)).all()}
    if dasar not in ada:
        return dasar
    n = 2
    while f"{dasar} ({n})" in ada:
        n += 1
    return f"{dasar} ({n})"


def _catat_template(session, kid: str, hasil: bx.HasilEkstraksi, override: Optional[Dict[str, Any]],
                    simpan: bool, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Pakai / buat / perbarui template pola rekening koran untuk file yang di-import.
      - template cocok (tanpa koreksi user)          -> usage_count +1
      - user mengoreksi peran kolom & centang simpan  -> template 'manual' (baru / ditimpa)
      - belum ada template & validasi 'verified'      -> template 'auto' (dipelajari otomatis)
    Template yang sengaja DINONAKTIFKAN user tidak dihidupkan lagi secara otomatis."""
    if hasil.metode == "legacy" or not hasil.signature:
        return None
    waktu = _sekarang()
    t = session.query(TPL).filter(TPL.client_id == kid, TPL.file_type == hasil.file_type,
                                  TPL.column_signature_hash == hasil.signature).first()
    if override is None and hasil.template and t is not None and t.is_active and t.deleted_at is None:
        aksi = "used"
    elif override is not None and simpan:
        aksi = "updated" if t is not None and t.deleted_at is None else "created"
    elif override is None and simpan and hasil.validasi.get("status") == "verified" and (t is None or t.deleted_at is not None):
        aksi = "created"
    else:
        return None

    if aksi != "used":
        klien = session.get(dbc.Client, kid)
        nilai = dict(
            client_code=(getattr(klien, "client_code", None) or "")[:50], file_type=hasil.file_type,
            sheet_name=hasil.sheet_name, header_row_index=hasil.header_row_index, data_start_row_index=hasil.header_row_index + 1,
            column_signature_hash=hasil.signature, header_columns=hasil.headers, mapping_rules=hasil.mapping_rules,
            detected_by="manual" if override is not None else "auto",
            ai_confidence=Decimal(str(hasil.validasi.get("verified_pct") or 0)),
            is_active=True, deleted_at=None, deleted_by=None,
        )
        if t is None:
            t = TPL(client_id=kid, template_name=_nama_template(session, kid, hasil), usage_count=0,
                    created_by=user.get("id"), **nilai)
            session.add(t)
        else:
            if t.deleted_at is not None or not t.template_name:
                nilai["template_name"] = _nama_template(session, kid, hasil)
            for k, v in nilai.items():
                setattr(t, k, v)
            t.edited_at, t.edited_by = waktu, user.get("id")
    t.usage_count = (t.usage_count or 0) + 1
    t.last_used_at = waktu
    session.flush()
    return {"id": t.id, "name": t.template_name, "action": aksi, "detected_by": t.detected_by}


# ------------------------------------------------------------
# Mapping bank / rekening -> akun kas-bank COA (migration 36)
# ------------------------------------------------------------

MATCH_BY_LABEL = {"account_number": "account number", "keyword": "document title", "template": "extraction template",
                  "bank_name": "bank name"}


def _digit(s: Optional[str]) -> str:
    return re.sub(r"\D", "", s or "")


def _kunci_rekening(s: Optional[str]) -> str:
    """Nomor rekening untuk pencocokan: digit saja, tanpa nol di depan (export CSV BRI
    "59001001642303" = rekening koran PDF "059001001642303")."""
    return _digit(s).lstrip("0")


def _spasi(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").upper()).strip()


def _mapping_dict(m: Any, akun: Optional[Dict[str, Any]] = None, template_name: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": m.id, "bank_name": m.bank_name, "account_number": m.account_number, "match_keyword": m.match_keyword,
        "bank_coa_id": m.bank_coa_id, "bank_account_code": (akun or {}).get("code"), "bank_account_name": (akun or {}).get("name"),
        "template_id": m.template_id, "template_name": template_name, "notes": m.notes, "is_active": bool(m.is_active),
        "usage_count": m.usage_count or 0, "last_used_at": m.last_used_at, "created_at": m.created_at, "edited_at": m.edited_at,
    }


def _cari_mapping_bank(session, kid: str, hasil: bx.HasilEkstraksi) -> Tuple[Any, Optional[str]]:
    """Mapping aktif yang cocok dengan file: (mapping, cara cocok) atau (None, None).
    Urutan: nomor rekening > kata kunci judul > template ekstraksi > nama bank (unik)."""
    rows = session.query(MAP).filter(MAP.client_id == kid, MAP.deleted_at.is_(None), MAP.is_active.is_(True)).all()
    if not rows:
        return None, None
    no = _kunci_rekening(hasil.no_rekening)
    if no:
        for r in rows:
            if r.account_number and _kunci_rekening(r.account_number) == no:
                return r, "account_number"
    judul = _spasi(hasil.teks_judul)
    kw = [r for r in rows if r.match_keyword and _spasi(r.match_keyword) in judul]
    if len(kw) == 1:
        return kw[0], "keyword"
    tid = (hasil.template or {}).get("id")
    if tid:
        tp = [r for r in rows if r.template_id and str(r.template_id) == str(tid)]
        if len(tp) == 1:
            return tp[0], "template"
    if hasil.bank:
        # Dokumen bernomor rekening tidak dicocokkan ke mapping yang mencatat rekening LAIN di bank yang sama.
        bn = [r for r in rows if _spasi(r.bank_name) == _spasi(hasil.bank) and not (no and r.account_number)]
        if len(bn) == 1:
            return bn[0], "bank_name"
    return None, None


def _tentukan_akun(session, kid: str, bank_id: Optional[str], hasil: bx.HasilEkstraksi) -> Tuple[str, Optional[Dict[str, Any]], List[str]]:
    """Akun tujuan file: pilihan user, atau dari mapping bank kalau user memilih Auto-detect.
    Return (bank_coa_id, info mapping untuk respon, peringatan)."""
    m, cara = _cari_mapping_bank(session, kid, hasil)
    peringatan: List[str] = []
    info = None
    if m is not None:
        akun_map = _akun(session, kid, m.bank_coa_id)
        info = dict(_mapping_dict(m, _akun_dict(akun_map)), match_by=cara)
        if bank_id and str(m.bank_coa_id) != bank_id:
            akun_pilih = _akun(session, kid, bank_id)
            peringatan.append(
                f"Bank mapping \"{m.bank_name}\" (matched by {MATCH_BY_LABEL.get(cara, cara)}) points to {akun_map.acc_no} "
                f"{akun_map.account_name}, but {akun_pilih.acc_no} {akun_pilih.account_name} was selected.")
            info["conflict"] = True
    if bank_id:
        return bank_id, info, peringatan
    if m is None:
        ciri = ", ".join(x for x in (hasil.bank, f"account {hasil.no_rekening}" if hasil.no_rekening else None) if x)
        raise _Gagal(
            f"No bank mapping matches this file{f' ({ciri})' if ciri else ''}. Select the target account and upload again "
            "-- the mapping is saved on import, so the next file is detected automatically.",
            kode="BANK_ACCOUNT_REQUIRED", status_code=422,
            data={"bank_name": hasil.bank, "account_number": hasil.no_rekening})
    _akun_kas(session, kid, m.bank_coa_id)
    return str(m.bank_coa_id), info, peringatan


def _catat_mapping(session, kid: str, bank_id: str, hasil: bx.HasilEkstraksi, info: Optional[Dict[str, Any]],
                   template: Optional[Dict[str, Any]], user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Setelah import: mapping yang dipakai -> usage_count +1; file dengan nomor rekening / nama
    bank yang belum ter-mapping & akunnya dipilih manual -> mapping baru (dipelajari)."""
    waktu = _sekarang()
    if info is not None and not info.get("conflict"):
        m = session.get(MAP, str(info["id"]))
        if m is not None:
            m.usage_count = (m.usage_count or 0) + 1
            m.last_used_at = waktu
            if not m.template_id and template and template.get("id"):
                m.template_id = template["id"]
        return dict(info, action="used")
    if info is not None or not (hasil.no_rekening or hasil.bank):
        return None  # konflik: biarkan mapping lama, user yang memutuskan di daftar mapping
    if hasil.no_rekening and any(
            _kunci_rekening(r.account_number) == _kunci_rekening(hasil.no_rekening)
            for r in session.query(MAP).filter(MAP.client_id == kid, MAP.deleted_at.is_(None), MAP.account_number.isnot(None))):
        return None  # mapping rekening ini ada tapi nonaktif -> jangan dihidupkan diam-diam
    klien = session.get(dbc.Client, kid)
    m = MAP(client_id=kid, client_code=(getattr(klien, "client_code", None) or "")[:50],
            bank_name=(hasil.bank or "Bank")[:100], account_number=hasil.no_rekening, bank_coa_id=bank_id,
            template_id=(template or {}).get("id"), is_active=True, usage_count=1, last_used_at=waktu,
            notes="Learned automatically from an imported statement.", created_by=user.get("id"))
    session.add(m)
    session.flush()
    akun = _akun(session, kid, bank_id)
    return dict(_mapping_dict(m, _akun_dict(akun)), match_by=None, action="created")


async def _terima_file(client_id: str, bank_coa_id: Optional[str], file: UploadFile) -> Tuple[str, Optional[str], bytes, str]:
    """bank_coa_id kosong = "Auto-detect": akun ditentukan dari mapping bank setelah file dibaca."""
    try:
        kid = str(UUID(client_id))
        bank_id = str(UUID(bank_coa_id)) if (bank_coa_id or "").strip() else None
    except ValueError:
        raise _Gagal("client_id and bank_coa_id must be valid UUIDs.")
    isi = await file.read()
    nama_file = (file.filename or "statement").strip()[:255]
    if not isi:
        raise _Gagal("The file is empty.")
    if len(isi) > MAKS_UKURAN_FILE:
        raise _Gagal("The file is larger than 20 MB.")
    if not re.search(r"\.(pdf|xlsx|xlsm|xls|csv)$", nama_file, re.I):
        raise _Gagal("Only PDF, Excel (.xlsx/.xls) or CSV bank statements are supported.")
    # Validasi klien & akun dulu (murah) sebelum parsing (bisa beberapa detik).
    _jalankan(lambda s: (_wajib_klien(kid), _akun_kas(s, kid, bank_id) if bank_id else None))
    return kid, bank_id, isi, nama_file


async def _ekstrak_async(isi: bytes, nama_file: str, kid: str, override: Optional[Dict[str, Any]]):
    templates = _template_aktif(kid)
    # Parsing PDF/OCR berat & sinkron -> thread terpisah supaya server tidak macet.
    return await asyncio.to_thread(_ekstrak_semua, isi, nama_file, templates, override)


def _gagal_ekstraksi(e: Exception, nama_file: str):
    if isinstance(e, bx.EkstraksiGagal):
        return gagal(message=str(e), errors={"code": e.kode}, status_code=422)
    logger.exception(f"Gagal membaca rekening koran '{nama_file}'")
    return gagal(message=f"The bank statement could not be read: {e}", errors={"code": "PARSE_ERROR"}, status_code=422)


@router.post("/statements/preview", summary="Baca rekening koran TANPA menyimpan: kolom terdeteksi, template, validasi saldo & confidence per baris")
async def preview_statement(
    client_id: str = Form(...),
    bank_coa_id: Optional[str] = Form(None, description="Kosong = Auto-detect dari mapping bank"),
    file: UploadFile = File(...),
    mapping_rules: Optional[str] = Form(None),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT)),
):
    try:
        kid, bank_id, isi, nama_file = await _terima_file(client_id, bank_coa_id, file)
        override = _baca_mapping(mapping_rules)
    except _Gagal as e:
        return _respon_gagal(e)
    try:
        hasil = await _ekstrak_async(isi, nama_file, kid, override)
    except Exception as e:
        return _gagal_ekstraksi(e, nama_file)
    if hasil is None:
        return gagal(message="No bank statement table was found in this file (no header with Date, Description and Amount columns).",
                     errors={"code": "NO_ROWS"}, status_code=422)

    file_hash = hashlib.sha256(isi).hexdigest()

    def aksi(session):
        akun_id, mapping, peringatan_map = _tentukan_akun(session, kid, bank_id, hasil)
        baris, tanpa_tanggal = _baris_siap(hasil, akun_id)
        sama = session.query(ST).filter(ST.client_id == kid, ST.bank_coa_id == akun_id, ST.file_hash == file_hash,
                                        ST.deleted_at.is_(None)).first()
        sudah = 0
        if baris:
            sudah = session.query(func.count()).select_from(MU).filter(
                MU.client_id == kid, MU.bank_coa_id == akun_id, MU.deleted_at.is_(None),
                MU.row_hash.in_([r["hash"] for r in baris])).scalar() or 0
        akun = _akun_dict(_akun(session, kid, akun_id))
        return dict(akun_id=akun_id, akun=akun, mapping=mapping, peringatan=peringatan_map, baris=baris,
                    tanpa_tanggal=tanpa_tanggal, sudah_upload=(sama.created_at if sama is not None else None), sudah=sudah)

    try:
        r = _jalankan(aksi)
    except _Gagal as e:
        return _respon_gagal(e)
    baris, tanpa_tanggal, sudah_upload, sudah = r["baris"], r["tanpa_tanggal"], r["sudah_upload"], r["sudah"]
    data = hasil.ringkas()
    data["warnings"] = r["peringatan"] + list(data.get("warnings") or [])
    data.update({
        "bank_coa_id": r["akun_id"], "bank_account_code": r["akun"]["code"], "bank_account_name": r["akun"]["name"],
        "bank_mapping": r["mapping"],
        "file_name": nama_file,
        "recognized": hasil.metode != "legacy",
        "template_matched": bool(hasil.template) and override is None,
        "will_learn_template": (hasil.metode != "legacy" and not hasil.template and override is None
                                and hasil.validasi.get("status") == "verified"),
        "already_uploaded_on": sudah_upload,
        "importable": len(baris), "already_in_feed": sudah, "without_date": tanpa_tanggal,
    })
    return sukses(data=data, message=f"{len(hasil.baris)} line(s) read from {nama_file}.")


@router.post("/statements/upload", summary="Upload rekening koran (PDF/Excel/CSV) ke Bank Feed untuk 1 akun bank (Supervisor+)")
async def upload_statement(
    client_id: str = Form(...),
    bank_coa_id: Optional[str] = Form(None, description="Kosong = Auto-detect dari mapping bank"),
    file: UploadFile = File(...),
    mapping_rules: Optional[str] = Form(None),
    save_template: bool = Form(True),
    save_mapping: bool = Form(True, description="Catat mapping bank baru kalau rekening/bank file ini belum ter-mapping"),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT)),
):
    try:
        kid, bank_id_dipilih, isi, nama_file = await _terima_file(client_id, bank_coa_id, file)
        override = _baca_mapping(mapping_rules)
    except _Gagal as e:
        return _respon_gagal(e)
    try:
        hasil = await _ekstrak_async(isi, nama_file, kid, override)
    except Exception as e:
        return _gagal_ekstraksi(e, nama_file)
    if hasil is None or not hasil.baris:
        pesan = " ".join(hasil.peringatan) if hasil is not None and hasil.peringatan else ""
        return gagal(message=pesan or "No transaction rows could be read from this file.", errors={"code": "NO_ROWS"}, status_code=422)

    v = hasil.validasi
    awal, akhir = v.get("opening_balance"), v.get("closing_balance")
    file_hash = hashlib.sha256(isi).hexdigest()

    def aksi(session):
        _kunci_klien(session, kid)
        bank_id, mapping, peringatan_map = _tentukan_akun(session, kid, bank_id_dipilih, hasil)
        peringatan = peringatan_map + [p for p in hasil.peringatan if p]
        baris, tanpa_tanggal = _baris_siap(hasil, bank_id)
        if tanpa_tanggal:
            peringatan.append(f"{tanpa_tanggal} line(s) without a readable date were not imported.")
        if not baris:
            raise _Gagal(" ".join(peringatan) or "No transaction rows could be read from this file.", kode="NO_ROWS", status_code=422)
        akun = _akun_kas(session, kid, bank_id)
        # Laporan kas tunai (kas kasir / kas kecil) wajar masuk ke akun kas; yang aneh hanya akun transit.
        if _jenis_kas(akun) == "transit":
            peringatan.append(f"{akun.acc_no} {akun.account_name} is a transit/clearing account, not a bank or cash account.")
        sama = session.query(ST).filter(ST.client_id == kid, ST.bank_coa_id == bank_id, ST.file_hash == file_hash,
                                        ST.deleted_at.is_(None)).first()
        if sama is not None:
            raise _Gagal(f"This file was already uploaded for this account on {sama.created_at:%d %b %Y}.", kode="DUPLICATE_FILE", status_code=409)

        sudah = {h for (h,) in session.query(MU.row_hash).filter(
            MU.client_id == kid, MU.bank_coa_id == bank_id, MU.deleted_at.is_(None),
            MU.row_hash.in_([r["hash"] for r in baris]),
        ).all()}
        baru = [r for r in baris if r["hash"] not in sudah]
        if not baru:
            raise _Gagal("All rows in this file are already in the Bank Feed for this account.", kode="DUPLICATE_FILE", status_code=409)

        # Saldo berjalan: dari saldo awal resmi kalau ada; kalau tidak, pakai saldo rekening koran per baris.
        saldo = _dec(awal) if awal is not None else None
        for r in baris:
            if saldo is not None:
                saldo = saldo + r["credit"] - r["debit"]
                r["saldo_hitung"] = saldo
            else:
                r["saldo_hitung"] = r["saldo"]
        if awal is not None and akhir is not None and abs(float(saldo) - akhir) > 1:
            peringatan.append(f"Closing balance from the rows ({float(saldo):,.2f}) differs from the statement ({akhir:,.2f}). Some rows may be missing.")

        template = _catat_template(session, kid, hasil, override, save_template, current_user)
        mapping_hasil = _catat_mapping(session, kid, bank_id, hasil, mapping, template, current_user) \
            if (save_mapping or mapping is not None) else None
        validasi_simpan = dict(v, method=hasil.metode, template=template, bank_name=hasil.bank,
                               account_number=hasil.no_rekening, bank_mapping=mapping_hasil)
        st = ST(
            client_id=kid, bank_coa_id=bank_id, file_name=nama_file, file_hash=file_hash,
            period_start=hasil.periode[0] or baris[0]["tanggal"], period_end=hasil.periode[1] or baris[-1]["tanggal"],
            opening_balance=_dec(awal) if awal is not None else None, closing_balance=_dec(akhir) if akhir is not None else None,
            total_debit=sum((r["debit"] for r in baru), NOL), total_credit=sum((r["credit"] for r in baru), NOL),
            line_count=len(baru), duplicate_count=len(baris) - len(baru), warnings=peringatan or None,
            file_type=hasil.file_type, extraction_method=hasil.metode, template_id=(template or {}).get("id"),
            validation=json.loads(json.dumps(validasi_simpan, default=str)),
            created_by=current_user.get("id"), created_by_name=_nama(current_user),
        )
        session.add(st)
        session.flush()
        for no, r in enumerate(baru, 1):
            session.add(MU(
                client_id=kid, statement_id=st.id, bank_coa_id=bank_id, line_no=no, mutation_date=r["tanggal"],
                description=r["keterangan"], debit=r["debit"], credit=r["credit"], balance_after=r["saldo_hitung"],
                row_hash=r["hash"], status="unmatched", confidence=r["confidence"], confidence_notes=r["catatan"] or None,
                page_no=r["halaman"],
            ))
        session.flush()
        jml = {k: sum(1 for r in baru if r["confidence"] == k) for k in ("high", "medium", "low")}
        return {
            "statement_id": st.id, "file_name": nama_file, "imported": len(baru), "duplicates": len(baris) - len(baru),
            "period_start": st.period_start, "period_end": st.period_end,
            "opening_balance": awal, "closing_balance": akhir, "warnings": peringatan,
            "method": hasil.metode, "validation_status": v.get("status"), "template": template,
            "confidence": jml, "bank_coa_id": bank_id, "bank_account_code": akun.acc_no, "bank_account_name": akun.account_name,
            "bank_mapping": mapping_hasil,
        }

    try:
        hasil_simpan = _jalankan(aksi)
    except _Gagal as e:
        return _respon_gagal(e)
    pesan = f"{hasil_simpan['imported']} row(s) imported from {nama_file}."
    if hasil_simpan["duplicates"]:
        pesan += f" {hasil_simpan['duplicates']} row(s) already existed and were skipped."
    if hasil_simpan["confidence"]["low"]:
        pesan += f" {hasil_simpan['confidence']['low']} row(s) need review."
    return sukses(data=hasil_simpan, message=pesan, status_code=201)


# ------------------------------------------------------------
# Template pola rekening koran
# ------------------------------------------------------------

@router.get("/import-templates", summary="Template ekstraksi rekening koran milik klien (aktif & nonaktif)")
def daftar_template(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda s: [_template_dict(t) for t in s.query(TPL).filter(
        TPL.client_id == kid, TPL.deleted_at.is_(None)).order_by(TPL.last_used_at.desc().nullslast(), TPL.created_at.desc()).all()])


class UbahTemplateRequest(BaseModel):
    client_id: UUID
    template_name: Optional[str] = Field(None, min_length=1, max_length=150)
    is_active: Optional[bool] = None


def _ambil_template(session, kid: str, template_id: Any) -> Any:
    t = session.get(TPL, str(template_id))
    if t is None or t.deleted_at is not None or str(t.client_id) != kid:
        raise _Gagal("Extraction template not found.", kode="NOT_FOUND", status_code=404)
    return t


@router.put("/import-templates/{template_id}", summary="Ganti nama / aktifkan / nonaktifkan template ekstraksi (Supervisor+)")
def ubah_template(template_id: UUID, payload: UbahTemplateRequest,
                  current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        t = _ambil_template(session, kid, template_id)
        if payload.template_name is not None:
            t.template_name = payload.template_name.strip()
        if payload.is_active is not None:
            t.is_active = payload.is_active
        t.edited_at, t.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        return _template_dict(t)
    return _respon(aksi, "Extraction template updated.")


@router.delete("/import-templates/{template_id}", summary="Hapus template ekstraksi (file berikutnya dideteksi ulang dari nol)")
def hapus_template(template_id: UUID, client_id: UUID = Query(...),
                   current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        t = _ambil_template(session, kid, template_id)
        t.deleted_at, t.deleted_by, t.is_active = _sekarang(), current_user.get("id"), False
        return {"id": t.id}
    return _respon(aksi, "Extraction template deleted.")


# ------------------------------------------------------------
# Mapping bank / rekening -> akun kas-bank COA
# ------------------------------------------------------------

class MappingBankRequest(BaseModel):
    client_id: UUID
    bank_name: str = Field(..., min_length=1, max_length=100)
    bank_coa_id: UUID
    account_number: Optional[str] = Field(None, max_length=50)
    match_keyword: Optional[str] = Field(None, max_length=255)
    template_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_active: bool = True


def _ambil_mapping(session, kid: str, mapping_id: Any) -> Any:
    m = session.get(MAP, str(mapping_id))
    if m is None or m.deleted_at is not None or str(m.client_id) != kid:
        raise _Gagal("Bank mapping not found.", kode="NOT_FOUND", status_code=404)
    return m


def _daftar_mapping(session, kid: str) -> List[Dict[str, Any]]:
    rows = session.query(MAP).filter(MAP.client_id == kid, MAP.deleted_at.is_(None)).order_by(MAP.bank_name, MAP.created_at).all()
    akun = {a.id: _akun_dict(a) for a in session.query(COA).filter(COA.id.in_([r.bank_coa_id for r in rows])).all()} if rows else {}
    tids = [r.template_id for r in rows if r.template_id]
    templ = {t.id: t.template_name for t in session.query(TPL).filter(TPL.id.in_(tids)).all()} if tids else {}
    return [_mapping_dict(r, akun.get(r.bank_coa_id), templ.get(r.template_id)) for r in rows]


def _isi_mapping(session, kid: str, m: Any, payload: MappingBankRequest) -> None:
    _akun_kas(session, kid, str(payload.bank_coa_id))
    no = _digit(payload.account_number) or None
    if payload.account_number and not no:
        raise _Gagal("Account number must contain digits.")
    keyword = (payload.match_keyword or "").strip() or None
    if no:
        q = session.query(MAP).filter(MAP.client_id == kid, MAP.deleted_at.is_(None), MAP.account_number.isnot(None))
        lain = next((r for r in (q.filter(MAP.id != m.id) if m.id else q)
                     if _kunci_rekening(r.account_number) == _kunci_rekening(no)), None)
        if lain is not None:
            raise _Gagal(f"Account number {no} is already mapped ({lain.bank_name}).", kode="DUPLICATE", status_code=409)
    if payload.template_id:
        t = session.get(TPL, str(payload.template_id))
        if t is None or t.deleted_at is not None or str(t.client_id) != kid:
            raise _Gagal("Extraction template not found.", kode="NOT_FOUND", status_code=404)
    m.bank_name = payload.bank_name.strip()
    m.bank_coa_id = str(payload.bank_coa_id)
    m.account_number = no
    m.match_keyword = keyword
    m.template_id = str(payload.template_id) if payload.template_id else None
    m.notes = (payload.notes or "").strip() or None
    m.is_active = payload.is_active


@router.get("/bank-mappings", summary="Mapping bank/rekening -> akun kas-bank COA milik klien")
def daftar_mapping_bank(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda s: _daftar_mapping(s, kid))


@router.post("/bank-mappings", summary="Tambah mapping bank/rekening -> akun COA (Supervisor+)")
def buat_mapping_bank(payload: MappingBankRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _wajib_klien(kid)
        klien = session.get(dbc.Client, kid)
        m = MAP(client_id=kid, client_code=(getattr(klien, "client_code", None) or "")[:50], usage_count=0,
                created_by=current_user.get("id"))
        _isi_mapping(session, kid, m, payload)
        session.add(m)
        session.flush()
        return next(x for x in _daftar_mapping(session, kid) if x["id"] == m.id)
    return _respon(aksi, "Bank mapping saved.")


@router.put("/bank-mappings/{mapping_id}", summary="Ubah mapping bank (Supervisor+)")
def ubah_mapping_bank(mapping_id: UUID, payload: MappingBankRequest,
                      current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        m = _ambil_mapping(session, kid, mapping_id)
        _isi_mapping(session, kid, m, payload)
        m.edited_at, m.edited_by = _sekarang(), current_user.get("id")
        session.flush()
        return next(x for x in _daftar_mapping(session, kid) if x["id"] == m.id)
    return _respon(aksi, "Bank mapping updated.")


@router.delete("/bank-mappings/{mapping_id}", summary="Hapus mapping bank (Supervisor+)")
def hapus_mapping_bank(mapping_id: UUID, client_id: UUID = Query(...),
                       current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        m = _ambil_mapping(session, kid, mapping_id)
        m.deleted_at, m.deleted_by, m.is_active = _sekarang(), current_user.get("id"), False
        return {"id": m.id}
    return _respon(aksi, "Bank mapping deleted.")


@router.delete("/statements/{statement_id}", summary="Hapus 1 file rekening koran beserta mutasinya (hanya kalau belum ada yang dicocokkan)")
def hapus_statement(statement_id: UUID, client_id: UUID = Query(...),
                    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        st = session.get(ST, str(statement_id))
        if st is None or st.deleted_at is not None or str(st.client_id) != kid:
            raise _Gagal("Bank statement not found.", kode="NOT_FOUND", status_code=404)
        cocok = session.query(func.count()).select_from(MU).filter(
            MU.statement_id == st.id, MU.deleted_at.is_(None), MU.status == "matched").scalar()
        if cocok:
            raise _Gagal(f"{cocok} row(s) of this statement are already matched. Unmatch them first.", kode="IN_USE", status_code=409)
        waktu = _sekarang()
        session.query(MU).filter(MU.statement_id == st.id, MU.deleted_at.is_(None)).update(
            {"deleted_at": waktu, "deleted_by": current_user.get("id")}, synchronize_session=False)
        st.deleted_at, st.deleted_by = waktu, current_user.get("id")
        return {"id": st.id}
    return _respon(aksi, "Bank statement deleted.")


@router.get("/mutations", summary="Mutasi Bank Feed (filter status / akun bank / statement)")
def daftar_mutasi(
    client_id: UUID = Query(...),
    status: Optional[str] = Query(None, pattern="^(unmatched|matched|ignored)$"),
    bank_coa_id: Optional[UUID] = Query(None),
    statement_id: Optional[UUID] = Query(None),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    kid = str(client_id)

    def aksi(session):
        q = session.query(MU, ST.file_name).join(ST, ST.id == MU.statement_id).filter(
            MU.client_id == kid, MU.deleted_at.is_(None), ST.deleted_at.is_(None))
        if status:
            q = q.filter(MU.status == status)
        if bank_coa_id:
            q = q.filter(MU.bank_coa_id == str(bank_coa_id))
        if statement_id:
            q = q.filter(MU.statement_id == str(statement_id))
        rows = q.order_by(MU.mutation_date.desc(), MU.line_no.desc()).all()
        akun = {a.id: _akun_dict(a) for a in session.query(COA).filter(COA.id.in_({m.bank_coa_id for m, _ in rows})).all()} if rows else {}
        tx_ids = [m.transaction_id for m, _ in rows if m.transaction_id]
        txs = {t.id: t for t in session.query(TX).filter(TX.id.in_(tx_ids)).all()} if tx_ids else {}
        return [_mutasi_dict(m, akun.get(m.bank_coa_id, {}), txs.get(m.transaction_id), f) for m, f in rows]
    return _respon(aksi)


class AbaikanRequest(BaseModel):
    client_id: UUID
    reason: Optional[str] = Field(None, max_length=1000)


@router.post("/mutations/{mutation_id}/ignore", summary="Abaikan 1 mutasi (bukan transaksi yang perlu dibukukan)")
def abaikan_mutasi(mutation_id: UUID, payload: AbaikanRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        m = _ambil_mutasi(session, kid, mutation_id)
        if m.status == "matched":
            raise _Gagal("This mutation is matched to a transaction. Unmatch it first.", kode="IN_USE", status_code=409)
        m.status, m.ignore_reason = "ignored", (payload.reason or "").strip() or None
        m.edited_at, m.edited_by = _sekarang(), current_user.get("id")
        return {"id": m.id, "status": m.status}
    return _respon(aksi, "Mutation ignored.")


@router.post("/mutations/{mutation_id}/restore", summary="Kembalikan mutasi yang diabaikan ke status unmatched")
def pulihkan_mutasi(mutation_id: UUID, payload: AbaikanRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        m = _ambil_mutasi(session, kid, mutation_id)
        if m.status != "ignored":
            raise _Gagal("Only ignored mutations can be restored.")
        m.status, m.ignore_reason = "unmatched", None
        m.edited_at, m.edited_by = _sekarang(), current_user.get("id")
        return {"id": m.id, "status": m.status}
    return _respon(aksi, "Mutation restored.")


class ReviewMutasiRequest(BaseModel):
    client_id: UUID
    mutation_date: Optional[date] = None
    description: Optional[str] = Field(None, max_length=2000)
    debit: Optional[Decimal] = Field(None, ge=0)
    credit: Optional[Decimal] = Field(None, ge=0)
    balance_after: Optional[Decimal] = None


@router.post("/mutations/{mutation_id}/review", summary="Koreksi baris hasil ekstraksi (tanggal/keterangan/nominal/saldo) & tandai sudah direview")
def review_mutasi(mutation_id: UUID, payload: ReviewMutasiRequest,
                  current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        m = _ambil_mutasi(session, kid, mutation_id)
        if m.status == "matched":
            raise _Gagal("This line is matched to a transaction. Unmatch it first.", kode="IN_USE", status_code=409)
        debit = _dec(payload.debit) if payload.debit is not None else m.debit
        credit = _dec(payload.credit) if payload.credit is not None else m.credit
        if (debit > 0) == (credit > 0):
            raise _Gagal("Fill in either money in or money out (one of them, greater than zero).")
        diubah = []
        if payload.mutation_date is not None and payload.mutation_date != m.mutation_date:
            m.mutation_date = payload.mutation_date
            diubah.append("date")
        if payload.description is not None and payload.description.strip() != (m.description or ""):
            m.description = payload.description.strip() or None
            diubah.append("description")
        if debit != m.debit or credit != m.credit:
            m.debit, m.credit = debit, credit
            diubah.append("amount")
        if payload.balance_after is not None and _dec(payload.balance_after) != m.balance_after:
            m.balance_after = _dec(payload.balance_after)
            diubah.append("balance")
        # row_hash sengaja TIDAK diubah: upload ulang file yang sama tetap dikenali sebagai duplikat.
        waktu, nama = _sekarang(), _nama(current_user)
        m.confidence = "high"
        m.confidence_notes = [f"Reviewed by {nama or 'a user'}" + (f" (corrected: {', '.join(diubah)})" if diubah else "") + "."]
        m.reviewed_at, m.reviewed_by_name = waktu, nama or None
        m.edited_at, m.edited_by = waktu, current_user.get("id")
        session.flush()
        akun = _akun_dict(session.get(COA, m.bank_coa_id))
        st = session.get(ST, m.statement_id)
        return _mutasi_dict(m, akun, None, st.file_name if st else None)
    return _respon(aksi, "Bank line reviewed.")


@router.delete("/mutations/{mutation_id}", summary="Hapus 1 baris mutasi (belum dicocokkan)")
def hapus_mutasi(mutation_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        m = _ambil_mutasi(session, kid, mutation_id)
        if m.status == "matched":
            raise _Gagal("This mutation is matched to a transaction. Unmatch it first.", kode="IN_USE", status_code=409)
        m.deleted_at, m.deleted_by = _sekarang(), current_user.get("id")
        return {"id": m.id}
    return _respon(aksi, "Mutation deleted.")


# ------------------------------------------------------------
# Saran pencocokan mutasi -> invoice
# ------------------------------------------------------------

def _kandidat_invoice(session, client_id: str) -> Dict[str, List[Dict[str, Any]]]:
    hasil: Dict[str, List[Dict[str, Any]]] = {"sales": [], "purchase": []}
    for tipe in ("sales", "purchase"):
        for inv in _daftar_invoice(session, client_id, tipe, hanya_terbuka=True):
            refs = [x for x in (inv["no"], inv.get("purchase_no"), inv.get("invoice_number")) if x]
            hasil[tipe].append({**inv, "refs": list(dict.fromkeys(refs)), "outstanding_dec": _dec(inv["outstanding"]),
                                "date_obj": _parse_tanggal(inv["date"]), "due_obj": _parse_tanggal(inv["due_date"])})
    return hasil


def _skor(nominal: Decimal, tgl: date, deskripsi: str, c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sisa = c["outstanding_dec"]
    if nominal > sisa + TOLERANSI:
        return None
    exact = abs(sisa - nominal) <= TOLERANSI
    desk = _norm(deskripsi)
    ref_hit = any(len(_norm(r)) >= 4 and _norm(r) in desk for r in c["refs"])
    tok_pihak = _token(c["party"])
    rasio = (len(tok_pihak & _token(deskripsi)) / len(tok_pihak)) if tok_pihak else 0.0
    skor = (0.60 if exact else 0.15) + (0.30 if ref_hit else 0) + 0.15 * min(rasio, 1.0)
    if c["date_obj"] and tgl >= c["date_obj"]:
        skor += 0.05
    if c["due_obj"] and abs((tgl - c["due_obj"]).days) <= 14:
        skor += 0.05
    return {"exact": exact, "ref_hit": ref_hit, "party_ratio": round(rasio, 2), "score": round(min(skor, 1.0), 2)}


def _alokasi(c: Dict[str, Any], jumlah: Decimal) -> Dict[str, Any]:
    return {"type": "sales_invoice" if c["type"] == "sales" else "purchase", "invoice_id": c["id"],
            "invoice_no": c["no"], "party": c["party"], "outstanding": c["outstanding"], "amount": _f(jumlah)}


def _saran_mutasi(m: Any, kandidat: Dict[str, List[Dict[str, Any]]], maks: int = 5) -> Dict[str, Any]:
    keluar = _dec(m.debit) > 0
    nominal = _dec(m.debit) if keluar else _dec(m.credit)
    pool = kandidat["purchase" if keluar else "sales"]
    deskripsi = m.description or ""
    daftar: List[Dict[str, Any]] = []
    for c in pool:
        n = _skor(nominal, m.mutation_date, deskripsi, c)
        if n is None or (not n["exact"] and not n["ref_hit"] and n["party_ratio"] < 0.5):
            continue
        daftar.append({"kind": "single", **n, "allocations": [_alokasi(c, nominal)]})

    # 1 transfer melunasi 2-4 invoice pihak yang sama (total pas).
    if not any(d["exact"] for d in daftar):
        pool_kombo = sorted([
            c for c in pool if c["outstanding_dec"] < nominal and (
                _token(c["party"]) & _token(deskripsi)
                or any(len(_norm(r)) >= 4 and _norm(r) in _norm(deskripsi) for r in c["refs"]))
        ], key=lambda x: x["outstanding_dec"], reverse=True)[:12]
        for ukuran in (2, 3, 4):
            for kombo in itertools.combinations(pool_kombo, ukuran):
                if abs(sum(x["outstanding_dec"] for x in kombo) - nominal) <= TOLERANSI:
                    daftar.append({"kind": "combo", "exact": True, "ref_hit": False, "party_ratio": 1.0, "score": 0.70,
                                   "allocations": [_alokasi(x, x["outstanding_dec"]) for x in kombo]})
            if len(daftar) >= maks * 2:
                break

    daftar.sort(key=lambda d: (d["score"], d["exact"]), reverse=True)
    daftar = daftar[:maks]
    # Auto-match hanya kalau kandidat teratas 1 invoice, nominal pas, ada bukti, dan tidak ada pesaing setara.
    auto = False
    if daftar and daftar[0]["kind"] == "single" and daftar[0]["exact"] and (daftar[0]["ref_hit"] or daftar[0]["party_ratio"] >= 0.5):
        auto = not [d for d in daftar[1:] if d["exact"] and (d["ref_hit"] or d["party_ratio"] >= 0.5)
                    and d["score"] >= daftar[0]["score"] - 0.10]
    return {"mutation_id": m.id, "direction": "payment" if keluar else "receipt", "amount": _f(nominal),
            "candidates": daftar, "auto_match": auto}


@router.get("/mutations/suggestions", summary="Kandidat invoice untuk tiap mutasi unmatched (tidak menulis apa pun)")
def saran_mutasi(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        mutasi = session.query(MU).join(ST, ST.id == MU.statement_id).filter(
            MU.client_id == kid, MU.deleted_at.is_(None), ST.deleted_at.is_(None), MU.status == "unmatched").all()
        if not mutasi:
            return []
        kandidat = _kandidat_invoice(session, kid)
        return [_saran_mutasi(m, kandidat) for m in mutasi]
    return _respon(aksi)


# ------------------------------------------------------------
# Cocokkan mutasi -> transaksi draft
# ------------------------------------------------------------

def _buat_tx_dari_mutasi(session, kid: str, m: Any, baris_in: List[BarisIn], user: Dict[str, Any], *,
                         kategori: Optional[str], pihak: Optional[str], deskripsi: Optional[str]) -> Any:
    if m.status != "unmatched":
        raise _Gagal("This mutation is already matched or ignored.", kode="CONFLICT", status_code=409)
    arah = "payment" if _dec(m.debit) > 0 else "receipt"
    nominal_mutasi = _dec(m.debit) if arah == "payment" else _dec(m.credit)
    akun_bank = _akun_kas(session, kid, m.bank_coa_id)
    baris, nominal, jenis, pihak_inv = _susun_baris(session, kid, arah, baris_in)
    if abs(nominal - nominal_mutasi) > TOLERANSI:
        raise _Gagal(f"The lines total {_f(nominal):,.2f} but the bank mutation is {_f(nominal_mutasi):,.2f}.")
    tx = TX(
        client_id=kid, tx_number=_nomor_baru(session, kid, arah, m.mutation_date), direction=arah,
        tx_date=m.mutation_date, bank_coa_id=akun_bank.id, bank_account_code=akun_bank.acc_no,
        bank_account_name=akun_bank.account_name, amount=nominal_mutasi, kind=jenis,
        category=(kategori or "").strip() or (KATEGORI_INVOICE[arah] if jenis == "invoice" else "Other"),
        counterparty=(pihak or "").strip() or pihak_inv, description=(deskripsi or "").strip() or m.description,
        reference=None, source="bank_feed", mutation_id=m.id, status="draft",
        created_by=user.get("id"), created_by_name=_nama(user),
    )
    session.add(tx)
    session.flush()
    _tulis_baris(session, tx, baris)
    m.status, m.transaction_id = "matched", tx.id
    m.edited_at, m.edited_by = _sekarang(), user.get("id")
    session.flush()
    return tx


class CocokkanInvoiceRequest(BaseModel):
    client_id: UUID
    allocations: List[BarisIn] = Field(..., min_length=1)
    description: Optional[str] = Field(None, max_length=2000)


@router.post("/mutations/{mutation_id}/match", summary="Cocokkan mutasi ke 1..n invoice -> transaksi DRAFT (Supervisor+)")
def cocokkan_invoice(mutation_id: UUID, payload: CocokkanInvoiceRequest,
                     current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    if any(a.type == "account" for a in payload.allocations):
        return gagal(message="Use /match-account for account lines.", errors={"code": "VALIDATION_ERROR"}, status_code=400)

    def aksi(session):
        _kunci_klien(session, kid)
        m = _ambil_mutasi(session, kid, mutation_id)
        tx = _buat_tx_dari_mutasi(session, kid, m, payload.allocations, current_user,
                                  kategori=None, pihak=None, deskripsi=payload.description)
        return _tx_dict(session, tx, mutasi=m)
    return _respon(aksi, "Mutation matched. The transaction is saved as draft.")


class CocokkanAkunRequest(BaseModel):
    client_id: UUID
    category: str = Field(..., min_length=1, max_length=100)
    counterparty: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    lines: List[BarisIn] = Field(..., min_length=1)


@router.post("/mutations/{mutation_id}/match-account", summary="Catat mutasi tanpa invoice ke akun lawan (biaya admin, bunga, transfer, ...) -> DRAFT")
def cocokkan_akun(mutation_id: UUID, payload: CocokkanAkunRequest,
                  current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        m = _ambil_mutasi(session, kid, mutation_id)
        tx = _buat_tx_dari_mutasi(session, kid, m, payload.lines, current_user, kategori=payload.category,
                                  pihak=payload.counterparty, deskripsi=payload.description)
        return _tx_dict(session, tx, mutasi=m)
    return _respon(aksi, "Mutation recorded. The transaction is saved as draft.")


class KlienRequest(BaseModel):
    client_id: UUID


@router.post("/mutations/auto-match", summary="Cocokkan otomatis semua mutasi yang kandidat invoicenya pasti (Supervisor+)")
def auto_cocokkan(payload: KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        mutasi = session.query(MU).join(ST, ST.id == MU.statement_id).filter(
            MU.client_id == kid, MU.deleted_at.is_(None), ST.deleted_at.is_(None), MU.status == "unmatched",
        ).order_by(MU.mutation_date, MU.line_no).all()
        # Baris yang ekstraksinya meragukan wajib direview manusia dulu (skills/pdf-reading).
        perlu_review = sum(1 for m in mutasi if m.confidence == "low")
        mutasi = [m for m in mutasi if m.confidence != "low"]
        cocok, dilewati = [], 0
        for m in mutasi:
            # Kandidat dihitung ulang tiap mutasi supaya sisa tagihan ikut berkurang.
            saran = _saran_mutasi(m, _kandidat_invoice(session, kid))
            if not saran["auto_match"]:
                dilewati += 1
                continue
            alok = saran["candidates"][0]["allocations"]
            try:
                with session.begin_nested():
                    tx = _buat_tx_dari_mutasi(
                        session, kid, m,
                        [BarisIn(type=a["type"], invoice_id=a["invoice_id"], amount=a["amount"]) for a in alok],
                        current_user, kategori=None, pihak=None, deskripsi=None)
                cocok.append({"mutation_id": m.id, "tx_number": tx.tx_number, "invoices": [a["invoice_no"] for a in alok]})
            except _Gagal:
                dilewati += 1
        return {"matched": cocok, "skipped": dilewati, "low_confidence_skipped": perlu_review}

    try:
        hasil = _jalankan(aksi)
    except _Gagal as e:
        return _respon_gagal(e)
    pesan = f"{len(hasil['matched'])} mutation(s) matched automatically; {hasil['skipped']} need review."
    if hasil["low_confidence_skipped"]:
        pesan += f" {hasil['low_confidence_skipped']} low-confidence line(s) were skipped until reviewed in the Bank Feed tab."
    return sukses(data=hasil, message=pesan)


@router.post("/mutations/{mutation_id}/unmatch", summary="Batalkan pencocokan: transaksi draft/approved dihapus, mutasi kembali unmatched")
def batal_cocok(mutation_id: UUID, payload: KlienRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        m = _ambil_mutasi(session, kid, mutation_id)
        if m.status != "matched" or not m.transaction_id:
            raise _Gagal("This mutation is not matched.")
        tx = session.get(TX, m.transaction_id)
        if tx is not None and tx.deleted_at is None:
            if tx.status == "posted":
                raise _Gagal(f"{tx.tx_number} is already posted. Reverse it from the Posted tab instead.", kode="POSTED", status_code=409)
            tx.deleted_at, tx.deleted_by = _sekarang(), current_user.get("id")
        m.status, m.transaction_id = "unmatched", None
        m.edited_at, m.edited_by = _sekarang(), current_user.get("id")
        return {"id": m.id, "status": m.status}
    return _respon(aksi, "Match removed.")


# ============================================================
# ENDPOINT -- TRANSAKSI
# ============================================================

@router.get("/transactions", summary="Daftar transaksi Cash & Bank")
def daftar_transaksi(
    client_id: UUID = Query(...),
    status: Optional[str] = Query(None, description="draft/approved/posted/reversed, boleh dipisah koma"),
    direction: Optional[str] = Query(None, pattern="^(receipt|payment)$"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    kid = str(client_id)

    def aksi(session):
        q = session.query(TX).filter(TX.client_id == kid, TX.deleted_at.is_(None))
        if status:
            q = q.filter(TX.status.in_([s.strip() for s in status.split(",") if s.strip()]))
        if direction:
            q = q.filter(TX.direction == direction)
        if date_from:
            q = q.filter(TX.tx_date >= date_from)
        if date_to:
            q = q.filter(TX.tx_date <= date_to)
        txs = q.order_by(TX.tx_date.desc(), TX.tx_number.desc()).all()
        if not txs:
            return []
        ids = [t.id for t in txs]
        baris: Dict[str, List[Any]] = {}
        for b in session.query(TL).filter(TL.transaction_id.in_(ids)).order_by(TL.line_no).all():
            baris.setdefault(b.transaction_id, []).append(b)
        mids = [t.mutation_id for t in txs if t.mutation_id]
        mutasi = {m.id: m for m in session.query(MU).filter(MU.id.in_(mids)).all()} if mids else {}
        return [_tx_dict(session, t, baris.get(t.id, []), mutasi.get(t.mutation_id)) for t in txs]
    return _respon(aksi)


@router.get("/transactions/{tx_id}", summary="Detail 1 transaksi Cash & Bank + jurnalnya")
def detail_transaksi(tx_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return _respon(lambda s: _tx_dict(s, _ambil_tx(s, kid, tx_id)))


class TransaksiRequest(BaseModel):
    client_id: UUID
    direction: str = Field(..., pattern="^(receipt|payment)$")
    tx_date: date
    bank_coa_id: UUID
    category: Optional[str] = Field(None, max_length=100)
    counterparty: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    reference: Optional[str] = Field(None, max_length=255)
    lines: List[BarisIn] = Field(..., min_length=1)


@router.post("/transactions", summary="Buat transaksi Cash Receipt / Cash Payment manual (DRAFT)")
def buat_transaksi(payload: TransaksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _wajib_klien(kid)
        _kunci_klien(session, kid)
        akun_bank = _akun_kas(session, kid, str(payload.bank_coa_id))
        baris, nominal, jenis, pihak = _susun_baris(session, kid, payload.direction, payload.lines)
        tx = TX(
            client_id=kid, tx_number=_nomor_baru(session, kid, payload.direction, payload.tx_date),
            direction=payload.direction, tx_date=payload.tx_date, bank_coa_id=akun_bank.id,
            bank_account_code=akun_bank.acc_no, bank_account_name=akun_bank.account_name, amount=nominal, kind=jenis,
            category=(payload.category or "").strip() or (KATEGORI_INVOICE[payload.direction] if jenis == "invoice" else "Other"),
            counterparty=(payload.counterparty or "").strip() or pihak, description=(payload.description or "").strip() or None,
            reference=(payload.reference or "").strip() or None, source="manual", status="draft",
            created_by=current_user.get("id"), created_by_name=_nama(current_user),
        )
        session.add(tx)
        session.flush()
        _tulis_baris(session, tx, baris)
        return _tx_dict(session, tx)

    try:
        return sukses(data=_jalankan(aksi), message="Transaction saved as draft.", status_code=201)
    except _Gagal as e:
        return _respon_gagal(e)


@router.put("/transactions/{tx_id}", summary="Ubah transaksi DRAFT (dari Bank Feed: arah, tanggal, akun bank & nominal mengikuti mutasi)")
def ubah_transaksi(tx_id: UUID, payload: TransaksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        tx = _ambil_tx(session, kid, tx_id)
        if tx.status != "draft":
            raise _Gagal(f"{tx.tx_number} is {tx.status}; only draft transactions can be edited.", kode="CONFLICT", status_code=409)
        if tx.source == "bank_feed":
            if payload.direction != tx.direction or payload.tx_date != tx.tx_date or str(payload.bank_coa_id) != tx.bank_coa_id:
                raise _Gagal("Direction, date and bank account of a bank-feed transaction follow the bank mutation and cannot be changed.")
        akun_bank = _akun_kas(session, kid, str(payload.bank_coa_id))
        baris, nominal, jenis, pihak = _susun_baris(session, kid, payload.direction, payload.lines, kecuali_tx=tx.id)
        if tx.source == "bank_feed" and abs(nominal - _dec(tx.amount)) > TOLERANSI:
            raise _Gagal(f"The lines total {_f(nominal):,.2f} but the bank mutation is {_f(tx.amount):,.2f}.")
        if tx.source == "manual" and (payload.direction != tx.direction or payload.tx_date.strftime("%y%m") != tx.tx_date.strftime("%y%m")):
            tx.tx_number = _nomor_baru(session, kid, payload.direction, payload.tx_date)
        tx.direction, tx.tx_date = payload.direction, payload.tx_date
        tx.bank_coa_id, tx.bank_account_code, tx.bank_account_name = akun_bank.id, akun_bank.acc_no, akun_bank.account_name
        tx.amount, tx.kind = nominal, jenis
        tx.category = (payload.category or "").strip() or (KATEGORI_INVOICE[payload.direction] if jenis == "invoice" else "Other")
        tx.counterparty = (payload.counterparty or "").strip() or pihak
        tx.description = (payload.description or "").strip() or tx.description
        tx.reference = (payload.reference or "").strip() or None
        tx.edited_at, tx.edited_by = _sekarang(), current_user.get("id")
        _tulis_baris(session, tx, baris)
        return _tx_dict(session, tx)
    return _respon(aksi, "Transaction updated.")


@router.delete("/transactions/{tx_id}", summary="Hapus transaksi draft/approved (mutasi Bank Feed-nya kembali unmatched)")
def hapus_transaksi(tx_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        tx = _ambil_tx(session, kid, tx_id)
        if tx.status not in ("draft", "approved"):
            raise _Gagal(f"{tx.tx_number} is {tx.status}; reverse it instead of deleting.", kode="CONFLICT", status_code=409)
        tx.deleted_at, tx.deleted_by = _sekarang(), current_user.get("id")
        if tx.mutation_id:
            m = session.get(MU, tx.mutation_id)
            if m is not None and m.transaction_id == tx.id:
                m.status, m.transaction_id = "unmatched", None
                m.edited_at, m.edited_by = _sekarang(), current_user.get("id")
        return {"id": tx.id}
    return _respon(aksi, "Transaction deleted.")


class AksiStatusRequest(BaseModel):
    client_id: UUID
    ids: List[UUID] = Field(..., min_length=1, max_length=500)


def _aksi_status(payload: AksiStatusRequest, user: Dict[str, Any], dari: Tuple[str, ...], ke: str, label: str):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        hasil, gagal_ = [], []
        for i in dict.fromkeys(str(x) for x in payload.ids):
            tx = session.get(TX, i)
            if tx is None or tx.deleted_at is not None or str(tx.client_id) != kid:
                gagal_.append({"id": i, "reason": "Not found."})
                continue
            if tx.status not in dari:
                gagal_.append({"id": i, "tx_number": tx.tx_number, "reason": f"Status is {tx.status}."})
                continue
            waktu = _sekarang()
            if ke == "approved":
                tx.status, tx.approved_at, tx.approved_by, tx.approved_by_name = "approved", waktu, user.get("id"), _nama(user)
            elif ke == "draft":
                tx.status, tx.approved_at, tx.approved_by, tx.approved_by_name = "draft", None, None, None
            elif ke == "posted":
                try:
                    with session.begin_nested():
                        _akun_kas(session, kid, tx.bank_coa_id)
                        tx.status, tx.posted_at, tx.posted_by, tx.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
                        session.flush()
                        _terapkan_pelunasan(session, kid, tx, +1)
                        session.flush()
                except _Gagal as e:
                    gagal_.append({"id": i, "tx_number": tx.tx_number, "reason": e.message})
                    continue
                except Exception as e:
                    pesan = dbc.pesan_periode_terkunci(e)
                    if not pesan:
                        raise
                    gagal_.append({"id": i, "tx_number": tx.tx_number, "reason": pesan})
                    continue
            tx.edited_at, tx.edited_by = waktu, user.get("id")
            hasil.append(tx.tx_number)
        session.flush()
        return {"done": hasil, "failed": gagal_}

    try:
        data = _jalankan(aksi)
    except _Gagal as e:
        return _respon_gagal(e)
    pesan = f"{len(data['done'])} transaction(s) {label}."
    if data["failed"]:
        pesan += f" {len(data['failed'])} skipped: " + "; ".join(f"{f.get('tx_number', f['id'])}: {f['reason']}" for f in data["failed"][:5])
    if not data["done"] and data["failed"]:
        return gagal(message=pesan, errors={"code": "NOTHING_DONE", "detail": data["failed"]}, status_code=422)
    return sukses(data=data, message=pesan)


@router.post("/transactions/approve", summary="Approve transaksi draft (Supervisor+)")
def approve_transaksi(payload: AksiStatusRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_status(payload, current_user, ("draft",), "approved", "approved")


@router.post("/transactions/return-to-draft", summary="Kembalikan transaksi approved ke draft (Supervisor+)")
def kembali_draft(payload: AksiStatusRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_status(payload, current_user, ("approved",), "draft", "returned to draft")


@router.post("/transactions/post", summary="Post transaksi approved ke buku besar + terapkan pelunasan invoice (Manager+)")
def post_transaksi(payload: AksiStatusRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_status(payload, current_user, ("approved",), "posted", "posted")


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/transactions/{tx_id}/reverse", summary="Balik transaksi posted: jurnal pembalik + pelunasan invoice dibatalkan (Manager+)")
def balik_transaksi(tx_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci_klien(session, kid)
        tx = _ambil_tx(session, kid, tx_id)
        if tx.status != "posted":
            raise _Gagal(f"Only posted transactions can be reversed ({tx.tx_number} is {tx.status}).", kode="CONFLICT", status_code=409)
        tanggal = payload.reversal_date or date.today()
        if tanggal < tx.tx_date:
            raise _Gagal("The reversal date cannot be earlier than the transaction date.")
        waktu = _sekarang()
        tx.status, tx.reversal_date, tx.reversal_reason = "reversed", tanggal, payload.reason.strip()
        tx.reversed_at, tx.reversed_by, tx.reversed_by_name = waktu, current_user.get("id"), _nama(current_user)
        tx.edited_at, tx.edited_by = waktu, current_user.get("id")
        session.flush()
        _terapkan_pelunasan(session, kid, tx, -1)
        # Mutasi bank-nya tetap terjadi di rekening -> kembali unmatched supaya bisa dicocokkan ulang dengan benar.
        if tx.mutation_id:
            m = session.get(MU, tx.mutation_id)
            if m is not None and m.transaction_id == tx.id:
                m.status, m.transaction_id = "unmatched", None
                m.edited_at, m.edited_by = waktu, current_user.get("id")
        session.flush()
        return _tx_dict(session, tx)
    return _respon(aksi, "Transaction reversed.")


# ============================================================
# ENDPOINT -- OVERVIEW
# ============================================================

@router.get("/overview", summary="Ringkasan Cash & Bank: saldo buku vs bank per akun, arus kas bulanan, pipeline")
def overview(client_id: UUID = Query(...), year: Optional[int] = Query(None, ge=1900, le=2999),
             _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        akun_kas = [a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()
                    if _jenis_kas(a)]
        kode_kas = {a.acc_no for a in akun_kas}
        saldo_buku: Dict[str, float] = {}
        for b in dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=kid):
            if b["account_code"] in kode_kas:
                saldo_buku[b["account_code"]] = saldo_buku.get(b["account_code"], 0.0) + b["debit"] - b["kredit"]

        # Saldo bank = saldo baris mutasi terakhir (yang punya saldo) per akun.
        saldo_bank: Dict[str, Dict[str, Any]] = {}
        for bank_id, tgl, saldo in session.execute(text("""
            select distinct on (bank_coa_id) bank_coa_id::text, mutation_date, balance_after
              from financial_transaction_bank_cash_mutations
             where client_id = cast(:c as uuid) and deleted_at is null and balance_after is not null
             order by bank_coa_id, mutation_date desc, created_at desc, line_no desc
        """), {"c": kid}).all():
            saldo_bank[bank_id] = {"date": tgl, "balance": _f(saldo)}
        belum = dict(session.query(MU.bank_coa_id, func.count()).filter(
            MU.client_id == kid, MU.deleted_at.is_(None), MU.status == "unmatched").group_by(MU.bank_coa_id).all())

        tahun = year or date.today().year
        bulanan = [{"month": i + 1, "cash_in": 0.0, "cash_out": 0.0} for i in range(12)]
        for arah, bln, total in session.execute(text("""
            select direction, extract(month from tx_date)::int, sum(amount)
              from financial_transaction_bank_cash_transactions
             where client_id = cast(:c as uuid) and deleted_at is null and status in ('posted', 'reversed')
               and extract(year from tx_date) = :y
             group by 1, 2
        """), {"c": kid, "y": tahun}).all():
            bulanan[bln - 1]["cash_in" if arah == "receipt" else "cash_out"] += _f(total)
        # Transaksi yang dibalik dinetralkan di bulan tanggal pembaliknya.
        for arah, bln, total in session.execute(text("""
            select direction, extract(month from reversal_date)::int, sum(amount)
              from financial_transaction_bank_cash_transactions
             where client_id = cast(:c as uuid) and deleted_at is null and status = 'reversed'
               and extract(year from reversal_date) = :y
             group by 1, 2
        """), {"c": kid, "y": tahun}).all():
            bulanan[bln - 1]["cash_in" if arah == "receipt" else "cash_out"] -= _f(total)

        pipeline = {s: {"count": 0, "amount": 0.0} for s in ("draft", "approved", "posted", "reversed")}
        for st, n, total in session.query(TX.status, func.count(), func.sum(TX.amount)).filter(
                TX.client_id == kid, TX.deleted_at.is_(None)).group_by(TX.status).all():
            pipeline[st] = {"count": n, "amount": _f(total)}
        mutasi = dict(session.query(MU.status, func.count()).join(ST, ST.id == MU.statement_id).filter(
            MU.client_id == kid, MU.deleted_at.is_(None), ST.deleted_at.is_(None)).group_by(MU.status).all())

        return {
            "year": tahun,
            "accounts": [{
                **_akun_dict(a), "book_balance": _f(saldo_buku.get(a.acc_no, 0.0)),
                "bank_balance": saldo_bank.get(a.id, {}).get("balance"), "bank_balance_date": saldo_bank.get(a.id, {}).get("date"),
                "unmatched_count": int(belum.get(a.id, 0)),
            } for a in akun_kas],
            "monthly": bulanan,
            "pipeline": pipeline,
            "mutations": {"unmatched": int(mutasi.get("unmatched", 0)), "matched": int(mutasi.get("matched", 0)),
                          "ignored": int(mutasi.get("ignored", 0))},
        }
    return _respon(aksi)
