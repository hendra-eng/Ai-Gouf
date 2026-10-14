"""
modules/finance/receivables_ar_v1.py
====================================
Fitur tambahan Accounts Receivable (UI dataset/picture/Template UI/Account
Receivable/4-8.jpeg), melengkapi receivables_payables_v1.py:

    /api/v1/finance/receivables/customers          master customer (CUST-###, NPWP, alamat, kontak)
    /api/v1/finance/receivables/invoice-form       data form Create Invoice (nomor berikut, customer,
                                                   cabang, proyek, produk dari riwayat item)
    /api/v1/finance/receivables/invoice-entries    Create Invoice: Save Draft / Submit for Approval
    /api/v1/finance/receivables/collections        tab Collections: performa, status follow-up, antrean
    /api/v1/finance/{receivables|payables}/statements   log Customer / Vendor Statement + kirim email

Create Invoice TIDAK membuat buku piutang sendiri: invoice disimpan di
financial_transaction_sales_invoices (dpp, ppn, gross_amount = jumlah item),
item & detail pajak di financial_transaction_sales_invoice_lines/_details
(migrations/38-*.py). Alurnya sama dengan invoice hasil import Sales:
    Save Draft            -> posting_status 'Draft'
    Submit for Approval   -> 'Review' -- disetujui & diposting di Sales > Journal
                             Preview (mapping akun + validasi COA di sana), lalu
                             baru masuk AR (receivables_payables_v1 membaca invoice
                             'Posted') dan GL/FS (sumber "sales").

Collections menyimpan status penagihan per customer (financial_ar_collection_*);
saldo, umur, dan pelunasan tetap dihitung dari buku pembantu AR
(receivables_payables_v1._muat_dokumen).

Email statement memakai SMTP dari environment (SMTP_HOST, SMTP_PORT,
SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_TLS). PDF-nya dibuat di frontend
(jsPDF, sama dengan tombol Download PDF) lalu dikirim ke endpoint email.
"""

from __future__ import annotations

import base64
import os
import re
import smtplib
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from email.message import EmailMessage
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_

import db_client as dbc
from ..api_response import sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_v1 as bc
from . import receivables_payables_v1 as rp

logger = get_module_logger("finance_receivables_ar_v1")

LEVEL_INPUT = rp.LEVEL_INPUT
NOL = rp.NOL
_Gagal = rp._Gagal

SI = dbc.SalesInvoice
DET = dbc.SalesInvoiceDetail
LN = dbc.SalesInvoiceLine
CU = dbc.ArCustomer
CA = dbc.ArCollectionAccount
CV = dbc.ArCollectionActivity
ST = dbc.ArApStatement

TARIF_PAJAK = {"ppn_11": Decimal("0.11"), "ppn_12": Decimal("0.12"), "non_ppn": NOL}
LABEL_PAJAK = {"ppn_11": "PPN 11%", "ppn_12": "PPN 12%", "non_ppn": "Non-PPN"}
TERMIN = ("Due on Receipt", "Net 7", "Net 14", "Net 30", "Net 45", "Net 60", "Net 90")
STATUS_TAGIH = ("to_contact", "promised", "escalated", "resolved")
METODE_KONTAK = ("call", "email", "whatsapp", "visit", "meeting", "letter", "other")
STATUS_BELUM_POSTING = ("draft", "review", "approved")
SATU_SEN = Decimal("0.01")


def _bulat(v: Decimal) -> Decimal:
    return v.quantize(SATU_SEN, rounding=ROUND_HALF_UP)


def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


# ============================================================
# CUSTOMER MASTER
# ============================================================

def _customer_dict(c: Any) -> Dict[str, Any]:
    return {
        "id": c.id, "code": c.code, "name": c.name, "npwp": c.npwp, "billing_address": c.billing_address,
        "phone": c.phone, "email": c.email, "contact_person": c.contact_person, "payment_terms": c.payment_terms,
    }


def _customers(session, kid: str) -> List[Any]:
    return session.query(CU).filter(CU.client_id == kid, CU.deleted_at.is_(None)).order_by(CU.code).all()


def _peta_customer(session, kid: str) -> Dict[str, Any]:
    """{NAMA NORMAL: ArCustomer}"""
    return {rp._norm_pihak(c.name): c for c in _customers(session, kid)}


def _kode_customer_berikut(session, kid: str) -> str:
    kode = [k for (k,) in session.query(CU.code).filter(CU.client_id == kid).all()]
    urut = max((int(m.group(1)) for k in kode if (m := re.fullmatch(r"CUST-(\d+)", k or ""))), default=0)
    return f"CUST-{urut + 1:03d}"


def _cek_customer_unik(session, kid: str, nama: str, kode: str, kecuali: Optional[str] = None) -> None:
    q = session.query(CU).filter(CU.client_id == kid, CU.deleted_at.is_(None),
                                 or_(func.upper(CU.name) == nama.upper(), CU.code == kode))
    if kecuali:
        q = q.filter(CU.id != kecuali)
    lain = q.first()
    if lain is not None:
        sama = "name" if lain.name.upper() == nama.upper() else "code"
        raise _Gagal(f"Another customer already uses this {sama} ({lain.code} - {lain.name}).", kode="CONFLICT", status_code=409)


class CustomerRequest(BaseModel):
    client_id: UUID
    code: Optional[str] = Field(None, max_length=30)
    name: str = Field(..., min_length=1, max_length=255)
    npwp: Optional[str] = Field(None, max_length=30)
    billing_address: Optional[str] = Field(None, max_length=1000)
    phone: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=255)
    contact_person: Optional[str] = Field(None, max_length=255)
    payment_terms: Optional[str] = Field(None, max_length=50)


def _isi_customer(session, kid: str, p: CustomerRequest, user: Dict[str, Any], c: Any = None) -> Any:
    nama = rp._norm_pihak(p.name)
    kode = (_teks(p.code) or (c.code if c is not None else None) or _kode_customer_berikut(session, kid)).upper()
    email = _teks(p.email)
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise _Gagal("Enter a valid email address.")
    _cek_customer_unik(session, kid, nama, kode, c.id if c is not None else None)
    nilai = dict(code=kode, name=nama, npwp=_teks(p.npwp), billing_address=_teks(p.billing_address), phone=_teks(p.phone),
                 email=email, contact_person=_teks(p.contact_person), payment_terms=_teks(p.payment_terms))
    if c is None:
        c = CU(client_id=kid, created_by=user.get("id"), **nilai)
        session.add(c)
    else:
        lama = rp._norm_pihak(c.name)
        if lama != nama:
            # Ganti nama -> invoice & status penagihan customer ini ikut, supaya saldo AR tidak terpecah.
            session.query(SI).filter(SI.management_client_id == kid, func.upper(func.trim(SI.customer_name)) == lama).update(
                {SI.customer_name: nama}, synchronize_session=False)
            session.query(CA).filter(CA.client_id == kid, CA.party == lama).update({CA.party: nama}, synchronize_session=False)
        for k, v in nilai.items():
            setattr(c, k, v)
        c.edited_at, c.edited_by = bc._sekarang(), user.get("id")
    session.flush()
    return c


# ============================================================
# CREATE INVOICE
# ============================================================

class BarisInvoiceIn(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    quantity: float = Field(..., gt=0)
    unit: Optional[str] = Field(None, max_length=30)
    unit_price: float = Field(..., ge=0)
    discount_type: Literal["percent", "amount"] = "percent"
    discount_value: float = Field(0, ge=0)
    tax_code: Literal["ppn_11", "ppn_12", "non_ppn"] = "ppn_11"


class InvoiceEntryRequest(BaseModel):
    client_id: UUID
    invoice_no: Optional[str] = Field(None, max_length=100)
    invoice_date: date
    due_date: Optional[date] = None
    payment_terms: str = Field(..., min_length=1, max_length=50)
    currency: str = Field("IDR", max_length=10)
    branch: str = Field(..., min_length=1, max_length=100)
    project: Optional[str] = Field(None, max_length=255)
    customer_id: Optional[UUID] = None
    customer_name: str = Field(..., min_length=1, max_length=255)
    customer_npwp: Optional[str] = Field(None, max_length=30)
    billing_address: Optional[str] = Field(None, max_length=1000)
    tax_type: Literal["ppn_11", "ppn_12", "non_ppn"] = "ppn_11"
    tax_inclusive: bool = False
    notes: Optional[str] = Field(None, max_length=500)
    lines: List[BarisInvoiceIn] = Field(..., min_length=1, max_length=300)
    submit: bool = False


def hitung_baris(b: BarisInvoiceIn, termasuk_pajak: bool) -> Dict[str, Decimal]:
    """Amount = qty x harga - diskon. Pajak dari Amount (atau sudah di dalamnya kalau tax inclusive)."""
    kotor = _bulat(Decimal(str(b.quantity)) * Decimal(str(b.unit_price)))
    nilai = Decimal(str(b.discount_value))
    if b.discount_type == "percent":
        if nilai > 100:
            raise _Gagal(f"Discount for '{b.product_name}' cannot exceed 100%.")
        diskon = _bulat(kotor * nilai / 100)
    else:
        diskon = _bulat(nilai)
        if diskon > kotor:
            raise _Gagal(f"Discount for '{b.product_name}' cannot exceed the line amount.")
    jumlah = kotor - diskon
    tarif = TARIF_PAJAK[b.tax_code]
    if termasuk_pajak and tarif:
        dpp = _bulat(jumlah / (1 + tarif))
        pajak = jumlah - dpp
    else:
        dpp = jumlah
        pajak = _bulat(jumlah * tarif)
    return {"gross": kotor, "discount": diskon, "amount": jumlah, "dpp": dpp, "tax": pajak, "rate": tarif * 100}


def _nomor_invoice_berikut(session, kid: str, tgl: date) -> str:
    awalan = f"INV/{tgl:%Y}/"
    # Termasuk invoice terhapus: unique constraint (client_id, invoice_no) tidak parsial.
    nomor = [n for (n,) in session.query(SI.invoice_no).filter(SI.management_client_id == kid, SI.invoice_no.like(f"{awalan}%")).all()]
    urut = max((int(n.rsplit("/", 1)[1]) for n in nomor if n.rsplit("/", 1)[1].isdigit()), default=0)
    return f"{awalan}{urut + 1:04d}"


def _jatuh_tempo(tgl: date, due: Optional[date], termin: str) -> date:
    if due:
        if due < tgl:
            raise _Gagal("The due date cannot be earlier than the invoice date.")
        return due
    hari = rp._hari_termin(termin)
    return tgl + timedelta(days=hari or 0)


def _entry_dict(session, inv: Any, det: Any = None, baris: Optional[List[Any]] = None) -> Dict[str, Any]:
    if det is None:
        det = session.query(DET).filter(DET.invoice_id == inv.id).first()
    if baris is None:
        baris = session.query(LN).filter(LN.invoice_id == inv.id).order_by(LN.line_no).all()
    kode = None
    if det is not None and det.customer_id:
        c = session.get(CU, det.customer_id)
        kode = c.code if c is not None else None
    status = inv.posting_status or "Draft"
    return {
        "id": inv.id, "invoice_no": inv.invoice_no, "invoice_date": inv.invoice_date, "due_date": inv.due_date,
        "payment_terms": inv.term_of_payment, "branch": inv.cabang, "project": inv.project_name,
        "customer_id": det.customer_id if det is not None else None, "customer_code": kode,
        "customer_name": inv.customer_name, "customer_npwp": inv.customer_npwp,
        "billing_address": det.billing_address if det is not None else None,
        "currency": det.currency if det is not None else "IDR",
        "tax_type": det.tax_type if det is not None else ("ppn_11" if bc._dec(inv.ppn) > 0 else "non_ppn"),
        "tax_inclusive": bool(det.tax_inclusive) if det is not None else False,
        "notes": inv.description, "status": status,
        "editable": det is not None and status.lower() in ("draft", "review"),
        "created_here": det is not None,
        "subtotal": bc._f(det.subtotal) if det is not None else bc._f(inv.dpp),
        "discount_total": bc._f(det.discount_total) if det is not None else 0.0,
        "dpp": bc._f(inv.dpp), "tax_total": bc._f(inv.ppn), "total": bc._f(inv.gross_amount),
        "created_at": inv.created_at, "created_by_name": det.created_by_name if det is not None else None,
        "submitted_at": det.submitted_at if det is not None else None,
        "submitted_by_name": det.submitted_by_name if det is not None else None,
        "lines": [{
            "line_no": l.line_no, "product_name": l.product_name, "description": l.description,
            "quantity": float(l.quantity), "unit": l.unit, "unit_price": bc._f(l.unit_price),
            "discount_type": l.discount_type, "discount_value": float(l.discount_value),
            "discount_amount": bc._f(l.discount_amount), "tax_code": l.tax_code, "tax_rate": float(l.tax_rate),
            "dpp": bc._f(l.dpp), "tax_amount": bc._f(l.tax_amount), "line_total": bc._f(l.line_total),
        } for l in baris],
    }


def _ambil_invoice(session, kid: str, invoice_id: Any) -> Any:
    inv = session.query(SI).filter(SI.id == str(invoice_id), SI.management_client_id == kid, SI.deleted_at.is_(None)).first()
    if inv is None:
        raise _Gagal("Invoice not found.", kode="NOT_FOUND", status_code=404)
    return inv


def _simpan_invoice(session, kid: str, p: InvoiceEntryRequest, user: Dict[str, Any], inv: Any = None) -> Any:
    if p.currency.upper() != "IDR":
        raise _Gagal("Only IDR is supported for now (the ledger is kept in IDR).")

    # Customer: pakai master yang dipilih, atau buat master baru dari nama yang diketik.
    nama = rp._norm_pihak(p.customer_name)
    c = None
    if p.customer_id:
        c = session.query(CU).filter(CU.id == str(p.customer_id), CU.client_id == kid, CU.deleted_at.is_(None)).first()
        if c is None:
            raise _Gagal("The selected customer was not found.", kode="NOT_FOUND", status_code=404)
        nama = c.name
    else:
        c = _peta_customer(session, kid).get(nama)
    if c is None:
        c = CU(client_id=kid, code=_kode_customer_berikut(session, kid), name=nama, npwp=_teks(p.customer_npwp),
               billing_address=_teks(p.billing_address), payment_terms=p.payment_terms, created_by=user.get("id"))
        session.add(c)
        session.flush()
    else:
        # Lengkapi master yang masih kosong dari isian invoice.
        c.npwp = c.npwp or _teks(p.customer_npwp)
        c.billing_address = c.billing_address or _teks(p.billing_address)

    hitung = [(b, hitung_baris(b, p.tax_inclusive)) for b in p.lines]
    subtotal = sum((h["gross"] for _, h in hitung), NOL)
    diskon = sum((h["discount"] for _, h in hitung), NOL)
    dpp = sum((h["dpp"] for _, h in hitung), NOL)
    pajak = sum((h["tax"] for _, h in hitung), NOL)
    total = dpp + pajak
    if total <= 0:
        raise _Gagal("The invoice total must be greater than zero.")

    nomor = _teks(p.invoice_no)
    if inv is None or (nomor and nomor != inv.invoice_no):
        nomor = nomor or _nomor_invoice_berikut(session, kid, p.invoice_date)
        bentrok = session.query(SI.id).filter(
            or_(SI.management_client_id == kid, SI.client_id == user.get("id")), SI.invoice_no == nomor,
        ).first()
        if bentrok:
            raise _Gagal(f"Invoice number {nomor} is already used. Choose another number.", kode="CONFLICT", status_code=409)

    nilai = dict(
        invoice_date=p.invoice_date, due_date=_jatuh_tempo(p.invoice_date, p.due_date, p.payment_terms),
        customer_name=nama, customer_npwp=_teks(p.customer_npwp) or c.npwp, description=_teks(p.notes),
        transaction_type="Invoice", project_name=_teks(p.project), term_of_payment=p.payment_terms,
        cabang=p.branch.strip(), dpp=dpp, ppn=pajak, pph=NOL, gross_amount=total,
    )
    waktu = bc._sekarang()
    if inv is None:
        inv = SI(client_id=user.get("id"), management_client_id=kid, invoice_no=nomor, paid_amount=NOL,
                 posting_status="Draft", created_by=user.get("id"), **nilai)
        session.add(inv)
        session.flush()
        det = DET(invoice_id=inv.id, client_id=kid, created_by=user.get("id"), created_by_name=bc._nama(user))
        session.add(det)
    else:
        if nomor:
            inv.invoice_no = nomor
        for k, v in nilai.items():
            setattr(inv, k, v)
        inv.posting_status = "Draft"       # diubah -> kembali draft sampai disubmit lagi
        inv.edited_at, inv.edited_by = waktu, user.get("id")
        det = session.query(DET).filter(DET.invoice_id == inv.id).first()
        det.edited_at, det.edited_by = waktu, user.get("id")
        session.query(LN).filter(LN.invoice_id == inv.id).delete(synchronize_session=False)
    det.customer_id, det.currency, det.billing_address = c.id, "IDR", _teks(p.billing_address)
    det.tax_type, det.tax_inclusive = p.tax_type, p.tax_inclusive
    det.subtotal, det.discount_total, det.tax_total = subtotal, diskon, pajak
    if p.submit:
        inv.posting_status = "Review"
        det.submitted_at, det.submitted_by_name = waktu, bc._nama(user)
    for i, (b, h) in enumerate(hitung, start=1):
        session.add(LN(
            invoice_id=inv.id, line_no=i, product_name=b.product_name.strip(), description=_teks(b.description),
            quantity=Decimal(str(b.quantity)), unit=_teks(b.unit), unit_price=Decimal(str(b.unit_price)),
            discount_type=b.discount_type, discount_value=Decimal(str(b.discount_value)), discount_amount=h["discount"],
            tax_code=b.tax_code, tax_rate=h["rate"], dpp=h["dpp"], tax_amount=h["tax"], line_total=h["amount"],
        ))
    session.flush()
    return inv


# ============================================================
# COLLECTIONS
# ============================================================

def prioritas_otomatis(hari_telat_maks: int) -> str:
    if hari_telat_maks > 60:
        return "high"
    if hari_telat_maks > 30:
        return "medium"
    return "low"


def _ringkas_pihak(docs: List[rp.Dok], per: date) -> Dict[str, Dict[str, Any]]:
    hasil: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        if d.tanggal > per:
            continue
        p = hasil.setdefault(d.pihak, {"outstanding": NOL, "overdue": NOL, "max_days": 0, "open_count": 0, "last_payment": None})
        bayar = d.bayar_terakhir(per)
        if bayar and (p["last_payment"] is None or bayar > p["last_payment"]):
            p["last_payment"] = bayar
        s = d.sisa(per)
        if s <= 0:
            continue
        p["outstanding"] += s
        p["open_count"] += 1
        if d.telat(per) > 0:
            p["overdue"] += s
            p["max_days"] = max(p["max_days"], d.telat(per))
    return hasil


def _akun_tagih_dict(party: str, ring: Dict[str, Any], a: Any, c: Any) -> Dict[str, Any]:
    sisa = ring["outstanding"] if ring else NOL
    auto = prioritas_otomatis(ring["max_days"] if ring else 0)
    status = (a.status if a is not None else "to_contact") if sisa > 0 else "resolved"
    janji = bc._dec(a.promise_amount) if a is not None and a.promise_amount is not None else None
    return {
        "party": party, "customer_code": c.code if c is not None else None,
        "email": c.email if c is not None else None, "phone": c.phone if c is not None else None,
        "outstanding": bc._f(sisa), "overdue": bc._f(ring["overdue"] if ring else NOL),
        "open_count": ring["open_count"] if ring else 0, "max_days_overdue": ring["max_days"] if ring else 0,
        "bucket": rp._bucket(ring["max_days"]) if ring and sisa > 0 else None,
        "last_payment_date": ring["last_payment"] if ring else None,
        "priority": (a.priority if a is not None and a.priority else auto), "priority_auto": auto,
        "priority_overridden": bool(a is not None and a.priority),
        "status": status, "stored_status": a.status if a is not None else None,
        "collector_name": a.collector_name if a is not None else None,
        "next_follow_up_date": a.next_follow_up_date if a is not None else None,
        "last_contact_date": a.last_contact_date if a is not None else None,
        "last_contact_method": a.last_contact_method if a is not None else None,
        "promise_amount": bc._f(janji) if janji is not None else None,
        "promise_date": a.promise_date if a is not None else None,
        "notes": a.notes if a is not None else None,
    }


class CollectionAccountRequest(BaseModel):
    client_id: UUID
    party: str = Field(..., min_length=1, max_length=255)
    status: Optional[Literal["to_contact", "promised", "escalated", "resolved"]] = None
    priority: Optional[Literal["high", "medium", "low", "auto"]] = None
    collector_name: Optional[str] = Field(None, max_length=255)
    next_follow_up_date: Optional[date] = None
    clear_next_follow_up: bool = False
    notes: Optional[str] = Field(None, max_length=2000)


class CollectionActivityRequest(BaseModel):
    client_id: UUID
    party: str = Field(..., min_length=1, max_length=255)
    activity_date: date
    method: Literal["call", "email", "whatsapp", "visit", "meeting", "letter", "other"]
    status_after: Literal["to_contact", "promised", "escalated", "resolved"]
    notes: Optional[str] = Field(None, max_length=2000)
    promise_amount: Optional[float] = Field(None, gt=0)
    promise_date: Optional[date] = None
    next_follow_up_date: Optional[date] = None
    collector_name: Optional[str] = Field(None, max_length=255)


def _akun_tagih(session, kid: str, party: str, user: Dict[str, Any]) -> Any:
    a = session.query(CA).filter(CA.client_id == kid, CA.party == party).first()
    if a is None:
        a = CA(client_id=kid, party=party, status="to_contact", created_by=user.get("id"))
        session.add(a)
        session.flush()
    return a


# ============================================================
# STATEMENT LOG & EMAIL
# ============================================================

def _statement_dict(s: Any, c: Any = None) -> Dict[str, Any]:
    return {
        "id": s.id, "side": s.side, "party": s.party, "party_code": c.code if c is not None else None,
        "party_email": c.email if c is not None else None,
        "date_from": s.date_from, "date_to": s.date_to, "currency": s.currency, "open_items_only": s.open_items_only,
        "opening_balance": bc._f(s.opening_balance), "closing_balance": bc._f(s.closing_balance),
        "delivery_method": s.delivery_method, "delivery_status": s.delivery_status, "recipient_email": s.recipient_email,
        "delivered_at": s.delivered_at, "generated_at": s.generated_at, "generated_by_name": s.generated_by_name,
    }


def _konfigurasi_smtp() -> Optional[Dict[str, Any]]:
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        return None
    user = os.getenv("SMTP_USER", "").strip()
    return {
        "host": host, "port": int(os.getenv("SMTP_PORT", "587") or 587), "user": user,
        "password": os.getenv("SMTP_PASSWORD", ""), "from": os.getenv("SMTP_FROM", "").strip() or user,
        "tls": os.getenv("SMTP_TLS", "true").strip().lower() not in ("0", "false", "no"),
    }


def kirim_email(tujuan: List[str], cc: List[str], subjek: str, isi: str, lampiran: Tuple[str, bytes]) -> None:
    cfg = _konfigurasi_smtp()
    if cfg is None:
        raise _Gagal("Email sending is not configured on the server (SMTP_HOST is empty). Download the PDF and send it manually.",
                     kode="EMAIL_NOT_CONFIGURED", status_code=503)
    if not cfg["from"]:
        raise _Gagal("Email sender is not configured on the server (SMTP_FROM).", kode="EMAIL_NOT_CONFIGURED", status_code=503)
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = cfg["from"], ", ".join(tujuan), subjek
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg.set_content(isi)
    msg.add_attachment(lampiran[1], maintype="application", subtype="pdf", filename=lampiran[0])
    if cfg["port"] == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=30)
    else:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=30)
    try:
        if cfg["tls"] and cfg["port"] != 465:
            server.starttls()
        if cfg["user"]:
            server.login(cfg["user"], cfg["password"])
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


_EMAIL = re.compile(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+")


def _daftar_email(teks: Optional[str]) -> List[str]:
    bagian = [x.strip() for x in re.split(r"[,;\s]+", teks or "") if x.strip()]
    salah = [x for x in bagian if not _EMAIL.fullmatch(x)]
    if salah:
        raise _Gagal(f"Invalid email address: {', '.join(salah)}.")
    return bagian


class StatementLogRequest(BaseModel):
    client_id: UUID
    party: str = Field(..., min_length=1, max_length=255)
    date_from: date
    date_to: date
    currency: str = Field("IDR", max_length=10)
    open_items_only: bool = False


class StatementDeliveryRequest(BaseModel):
    client_id: UUID
    method: Literal["download"] = "download"


class StatementEmailRequest(BaseModel):
    client_id: UUID
    to: str = Field(..., min_length=3, max_length=1000)
    cc: Optional[str] = Field(None, max_length=1000)
    subject: str = Field(..., min_length=1, max_length=255)
    message: str = Field("", max_length=5000)
    pdf_base64: str = Field(..., min_length=10)
    file_name: str = Field("statement.pdf", max_length=200)
    save_as_customer_email: bool = False


# ============================================================
# ROUTER
# ============================================================

def _router_statement(sisi: rp.Sisi, prefix: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    def _peta(session, kid: str) -> Dict[str, Any]:
        return _peta_customer(session, kid) if sisi.kode == "ar" else {}

    @router.get("/statements", summary=f"Riwayat statement {sisi.pihak} yang sudah di-generate")
    def daftar(client_id: UUID = Query(...), limit: int = Query(200, ge=1, le=1000),
               _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            peta = _peta(session, kid)
            rows = session.query(ST).filter(ST.client_id == kid, ST.side == sisi.kode, ST.deleted_at.is_(None)).order_by(
                ST.generated_at.desc()).limit(limit).all()
            return [_statement_dict(s, peta.get(s.party)) for s in rows]
        return bc._respon(aksi)

    @router.post("/statements", summary=f"Generate statement {sisi.pihak} (dicatat di riwayat)")
    def buat(payload: StatementLogRequest, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(payload.client_id)

        def aksi(session):
            bc._wajib_klien(kid)
            if payload.date_to < payload.date_from:
                raise _Gagal("The end date cannot be earlier than the start date.")
            if payload.currency.upper() != "IDR":
                raise _Gagal("Only IDR is supported for now (the ledger is kept in IDR).")
            party = rp._norm_pihak(payload.party)
            docs = [d for d in rp._muat_dokumen(session, kid, sisi) if d.pihak == party]
            if not docs:
                raise _Gagal(f"No posted {sisi.dokumen}s found for {party}.", kode="NOT_FOUND", status_code=404)
            s = ST(client_id=kid, side=sisi.kode, party=party, date_from=payload.date_from, date_to=payload.date_to,
                   currency="IDR", open_items_only=payload.open_items_only,
                   opening_balance=rp._total_sisa(docs, payload.date_from - timedelta(days=1)),
                   closing_balance=rp._total_sisa(docs, payload.date_to),
                   generated_by=current_user.get("id"), generated_by_name=bc._nama(current_user))
            session.add(s)
            session.flush()
            return _statement_dict(s, _peta(session, kid).get(party))
        try:
            data = bc._jalankan(aksi)
        except _Gagal as e:
            return bc._respon_gagal(e)
        return sukses(data=data, message="Statement generated.", status_code=201)

    def _ambil(session, kid: str, sid: UUID) -> Any:
        s = session.query(ST).filter(ST.id == str(sid), ST.client_id == kid, ST.side == sisi.kode, ST.deleted_at.is_(None)).first()
        if s is None:
            raise _Gagal("Statement not found.", kode="NOT_FOUND", status_code=404)
        return s

    @router.post("/statements/{statement_id}/delivery", summary="Tandai statement sudah di-download")
    def tandai(statement_id: UUID, payload: StatementDeliveryRequest, _u: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(payload.client_id)

        def aksi(session):
            s = _ambil(session, kid, statement_id)
            if s.delivery_status != "sent":
                s.delivery_method, s.delivery_status, s.delivered_at = "download", "downloaded", bc._sekarang()
            session.flush()
            return _statement_dict(s, _peta(session, kid).get(s.party))
        return bc._respon(aksi)

    @router.post("/statements/{statement_id}/email", summary="Kirim statement (PDF dari frontend) lewat email SMTP")
    def email(statement_id: UUID, payload: StatementEmailRequest, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(payload.client_id)

        def aksi(session):
            s = _ambil(session, kid, statement_id)
            tujuan, cc = _daftar_email(payload.to), _daftar_email(payload.cc)
            if not tujuan:
                raise _Gagal("Enter at least one recipient email.")
            data = payload.pdf_base64.split(",", 1)[1] if payload.pdf_base64.startswith("data:") else payload.pdf_base64
            try:
                pdf = base64.b64decode(data, validate=True)
            except Exception:
                raise _Gagal("The attached PDF is not valid.")
            if len(pdf) > 15 * 1024 * 1024:
                raise _Gagal("The PDF is too large to email (max 15 MB).")
            nama_file = re.sub(r"[^A-Za-z0-9._-]+", "_", payload.file_name) or "statement.pdf"
            try:
                kirim_email(tujuan, cc, payload.subject.strip(), payload.message, (nama_file, pdf))
            except _Gagal:
                raise
            except Exception as e:
                logger.exception("Gagal kirim email statement")
                s.delivery_method, s.delivery_status, s.recipient_email = "email", "failed", ", ".join(tujuan)
                session.commit()
                raise _Gagal(f"The email could not be sent: {e}", kode="EMAIL_FAILED", status_code=502)
            s.delivery_method, s.delivery_status = "email", "sent"
            s.recipient_email, s.delivered_at = ", ".join(tujuan), bc._sekarang()
            c = _peta(session, kid).get(s.party)
            if payload.save_as_customer_email and c is not None:
                c.email = tujuan[0]
                c.edited_at, c.edited_by = bc._sekarang(), current_user.get("id")
            session.flush()
            return _statement_dict(s, c)
        return bc._respon(aksi, "Statement emailed.")

    @router.delete("/statements/{statement_id}", summary="Hapus 1 baris riwayat statement")
    def hapus(statement_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(get_current_user_v1)):
        kid = str(client_id)

        def aksi(session):
            s = _ambil(session, kid, statement_id)
            s.deleted_at, s.deleted_by = bc._sekarang(), current_user.get("id")
            return {"id": s.id}
        return bc._respon(aksi, "Statement removed from history.")

    return router


router_ar = APIRouter(prefix="/api/v1/finance/receivables", tags=["finance-receivables-v1"])


# ---------------- Customers ----------------

@router_ar.get("/customers", summary="Master customer + customer dari invoice Sales yang belum ada di master")
def daftar_customer(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        peta = _peta_customer(session, kid)
        per = rp._hari_ini()
        ring = _ringkas_pihak(rp._muat_dokumen(session, kid, rp.AR), per)
        hasil = []
        for nama, c in peta.items():
            r = ring.get(nama)
            hasil.append({**_customer_dict(c), "in_master": True, "outstanding": bc._f(r["outstanding"] if r else NOL)})
        # Customer yang hanya ada di invoice Sales (mis. hasil import) -- boleh dipilih & otomatis masuk master.
        lain = session.query(func.upper(func.trim(SI.customer_name)), func.max(SI.customer_npwp)).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None)).group_by(func.upper(func.trim(SI.customer_name))).all()
        for nama, npwp in lain:
            n = rp._norm_pihak(nama)
            if n and n not in peta:
                r = ring.get(n)
                hasil.append({"id": None, "code": None, "name": n, "npwp": npwp, "billing_address": None, "phone": None,
                              "email": None, "contact_person": None, "payment_terms": None, "in_master": False,
                              "outstanding": bc._f(r["outstanding"] if r else NOL)})
        hasil.sort(key=lambda x: x["name"])
        return hasil
    return bc._respon(aksi)


@router_ar.post("/customers", summary="Tambah customer ke master (Supervisor+)")
def buat_customer(payload: CustomerRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return _customer_dict(_isi_customer(session, kid, payload, current_user))
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=f"Customer {data['code']} saved.", status_code=201)


@router_ar.put("/customers/{customer_id}", summary="Ubah data customer (Supervisor+)")
def ubah_customer(customer_id: UUID, payload: CustomerRequest,
                  current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        c = session.query(CU).filter(CU.id == str(customer_id), CU.client_id == kid, CU.deleted_at.is_(None)).first()
        if c is None:
            raise _Gagal("Customer not found.", kode="NOT_FOUND", status_code=404)
        return _customer_dict(_isi_customer(session, kid, payload, current_user, c))
    return bc._respon(aksi, "Customer updated.")


# ---------------- Create Invoice ----------------

@router_ar.get("/invoice-form", summary="Data form Create Invoice: nomor berikut, cabang, proyek, produk (riwayat item)")
def data_form_invoice(client_id: UUID = Query(...), invoice_date: Optional[date] = Query(None),
                      _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        tgl = invoice_date or rp._hari_ini()
        cabang = sorted({c.strip() for (c,) in session.query(SI.cabang).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None), SI.cabang.isnot(None)).distinct().all() if c and c.strip()})
        proyek = sorted({p.strip() for (p,) in session.query(SI.project_name).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None), SI.project_name.isnot(None)).distinct().all() if p and p.strip()})
        produk: Dict[str, Dict[str, Any]] = {}
        for l, tgl_inv in session.query(LN, SI.invoice_date).join(SI, SI.id == LN.invoice_id).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None),
        ).order_by(SI.invoice_date.desc(), LN.created_at.desc()).limit(2000).all():
            k = l.product_name.strip().upper()
            if k not in produk:
                produk[k] = {"name": l.product_name, "description": l.description, "unit": l.unit,
                             "unit_price": bc._f(l.unit_price), "tax_code": l.tax_code, "last_used": tgl_inv, "times_used": 0}
            produk[k]["times_used"] += 1
        return {
            "next_number": _nomor_invoice_berikut(session, kid, tgl),
            "branches": cabang, "projects": proyek,
            "products": sorted(produk.values(), key=lambda p: (-p["times_used"], p["name"]))[:300],
            "payment_terms": list(TERMIN),
            "tax_types": [{"code": k, "label": v, "rate": float(TARIF_PAJAK[k] * 100)} for k, v in LABEL_PAJAK.items()],
        }
    return bc._respon(aksi)


@router_ar.get("/invoice-entries", summary="Invoice Sales yang belum diposting (Draft / Review / Approved)")
def daftar_entry(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(SI, DET).outerjoin(DET, DET.invoice_id == SI.id).filter(
            SI.management_client_id == kid, SI.deleted_at.is_(None), func.lower(SI.posting_status).in_(STATUS_BELUM_POSTING),
        ).order_by(SI.invoice_date.desc(), SI.invoice_no.desc()).limit(500).all()
        return [{
            "id": inv.id, "invoice_no": inv.invoice_no, "invoice_date": inv.invoice_date, "due_date": inv.due_date,
            "customer_name": inv.customer_name, "total": bc._f(inv.gross_amount), "status": inv.posting_status,
            "created_here": det is not None,
            "editable": det is not None and (inv.posting_status or "").lower() in ("draft", "review"),
            "created_by_name": det.created_by_name if det is not None else None,
        } for inv, det in rows]
    return bc._respon(aksi)


@router_ar.get("/invoice-entries/{invoice_id}", summary="Detail invoice + item (form edit / preview)")
def detail_entry(invoice_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return bc._respon(lambda s: _entry_dict(s, _ambil_invoice(s, kid, invoice_id)))


def _pesan_invoice(inv: Any) -> str:
    if (inv.posting_status or "").lower() == "review":
        return f"{inv.invoice_no} submitted for approval — approve and post it in Sales > Journal Preview."
    return f"{inv.invoice_no} saved as draft."


@router_ar.post("/invoice-entries", summary="Create Invoice: Save Draft / Submit for Approval (Supervisor+)")
def buat_entry(payload: InvoiceEntryRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        bc._kunci_klien(session, kid)
        inv = _simpan_invoice(session, kid, payload, current_user)
        return _entry_dict(session, inv), _pesan_invoice(inv)
    try:
        data, pesan = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=pesan, status_code=201)


@router_ar.put("/invoice-entries/{invoice_id}", summary="Ubah invoice Draft / Review dari Create Invoice (Supervisor+)")
def ubah_entry(invoice_id: UUID, payload: InvoiceEntryRequest,
               current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._kunci_klien(session, kid)
        inv = _ambil_invoice(session, kid, invoice_id)
        if session.query(DET.id).filter(DET.invoice_id == inv.id).first() is None:
            raise _Gagal(f"{inv.invoice_no} was imported in Sales; edit it there.", kode="CONFLICT", status_code=409)
        if (inv.posting_status or "").lower() not in ("draft", "review"):
            raise _Gagal(f"{inv.invoice_no} is {inv.posting_status}; it can no longer be edited here.", kode="CONFLICT", status_code=409)
        inv = _simpan_invoice(session, kid, payload, current_user, inv)
        return _entry_dict(session, inv), _pesan_invoice(inv)
    try:
        data, pesan = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=pesan)


@router_ar.delete("/invoice-entries/{invoice_id}", summary="Hapus invoice Draft / Review dari Create Invoice (Supervisor+)")
def hapus_entry(invoice_id: UUID, client_id: UUID = Query(...),
                current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        inv = _ambil_invoice(session, kid, invoice_id)
        if session.query(DET.id).filter(DET.invoice_id == inv.id).first() is None:
            raise _Gagal(f"{inv.invoice_no} was imported in Sales; delete it there.", kode="CONFLICT", status_code=409)
        if (inv.posting_status or "").lower() not in ("draft", "review"):
            raise _Gagal(f"{inv.invoice_no} is {inv.posting_status}; it can no longer be deleted.", kode="CONFLICT", status_code=409)
        inv.deleted_at, inv.deleted_by = bc._sekarang(), current_user.get("id")
        return {"id": inv.id}
    return bc._respon(aksi, "Invoice deleted.")


# ---------------- Collections ----------------

@router_ar.get("/collections", summary="Tab Collections: performa penagihan, status follow-up, antrean per customer")
def collections(client_id: UUID = Query(...), as_of: Optional[date] = Query(None),
                month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$", description="Bulan performa (YYYY-MM), default bulan as_of"),
                current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        per = as_of or rp._hari_ini()
        if month:
            awal = date(int(month[:4]), int(month[5:]), 1)
        else:
            awal = per.replace(day=1)
        akhir = min(rp._geser_bulan(awal, 1) - timedelta(days=1), per)
        if akhir < awal:
            akhir = awal
        awal_lalu = rp._geser_bulan(awal, -1)
        akhir_lalu = awal - timedelta(days=1)

        docs = rp._muat_dokumen(session, kid, rp.AR)
        ring = _ringkas_pihak(docs, per)
        akun = {a.party: a for a in session.query(CA).filter(CA.client_id == kid).all()}
        peta = _peta_customer(session, kid)
        pihak = sorted({p for p, r in ring.items() if r["outstanding"] > 0} | {p for p, a in akun.items() if p in ring})
        antrean = [_akun_tagih_dict(p, ring.get(p), akun.get(p), peta.get(p)) for p in pihak]

        total = sum((Decimal(str(a["outstanding"])) for a in antrean), NOL)
        tinggi = [a for a in antrean if a["priority"] == "high" and a["outstanding"] > 0]
        nilai_tinggi = sum((Decimal(str(a["outstanding"])) for a in tinggi), NOL)
        janji = [a for a in antrean if a["status"] == "promised" and a["outstanding"] > 0]
        nilai_janji = sum((min(Decimal(str(a["promise_amount"] or a["outstanding"])), Decimal(str(a["outstanding"]))) for a in janji), NOL)
        hitung = {s: sum(1 for a in antrean if a["status"] == s) for s in STATUS_TAGIH}
        kolektor = sorted({a.collector_name for a in akun.values() if a.collector_name} | ({bc._nama(current_user)} - {""}))
        return {
            "as_of": per, "period": {"month": f"{awal:%Y-%m}", "from": awal, "to": akhir},
            "performance": {
                "collected": bc._f(rp._terkumpul(docs, awal, akhir)),
                "collected_prev": bc._f(rp._terkumpul(docs, awal_lalu, akhir_lalu)),
                "promise_to_pay": bc._f(nilai_janji), "promise_count": len(janji),
                "high_priority_count": len(tinggi), "high_priority_amount": bc._f(nilai_tinggi),
                "high_priority_pct": round(float(nilai_tinggi / total * 100), 1) if total > 0 else 0.0,
                "avg_days_to_collect": rp._rata_hari_tagih(docs, awal, akhir),
                "avg_days_to_collect_prev": rp._rata_hari_tagih(docs, awal_lalu, akhir_lalu),
                "total_outstanding": bc._f(total),
            },
            "follow_up": {"counts": hitung, "total": len(antrean)},
            "queue": antrean,
            "collectors": kolektor,
        }
    return bc._respon(aksi)


@router_ar.put("/collections/account", summary="Ubah status / prioritas / collector / jadwal follow-up 1 customer (Supervisor+)")
def ubah_akun_tagih(payload: CollectionAccountRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        party = rp._norm_pihak(payload.party)
        a = _akun_tagih(session, kid, party, current_user)
        if payload.status:
            a.status = payload.status
            if payload.status != "promised":
                a.promise_amount, a.promise_date = None, None
        if payload.priority:
            a.priority = None if payload.priority == "auto" else payload.priority
        if payload.collector_name is not None:
            a.collector_name = _teks(payload.collector_name)
        if payload.next_follow_up_date or payload.clear_next_follow_up:
            a.next_follow_up_date = None if payload.clear_next_follow_up else payload.next_follow_up_date
        if payload.notes is not None:
            a.notes = _teks(payload.notes)
        a.edited_at, a.edited_by = bc._sekarang(), current_user.get("id")
        session.flush()
        ring = _ringkas_pihak([d for d in rp._muat_dokumen(session, kid, rp.AR) if d.pihak == party], rp._hari_ini())
        return _akun_tagih_dict(party, ring.get(party), a, _peta_customer(session, kid).get(party))
    return bc._respon(aksi, "Collection status updated.")


@router_ar.get("/collections/activities", summary="Riwayat follow-up 1 customer")
def riwayat_tagih(client_id: UUID = Query(...), party: str = Query(..., min_length=1),
                  _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        rows = session.query(CV).join(CA, CA.id == CV.account_id).filter(
            CA.client_id == kid, CA.party == rp._norm_pihak(party)).order_by(CV.activity_date.desc(), CV.created_at.desc()).all()
        return [{
            "id": r.id, "activity_date": r.activity_date, "method": r.method, "status_after": r.status_after, "notes": r.notes,
            "promise_amount": bc._f(r.promise_amount) if r.promise_amount is not None else None, "promise_date": r.promise_date,
            "next_follow_up_date": r.next_follow_up_date, "created_at": r.created_at, "created_by_name": r.created_by_name,
        } for r in rows]
    return bc._respon(aksi)


@router_ar.post("/collections/activities", summary="Catat follow-up penagihan (Supervisor+)")
def catat_tagih(payload: CollectionActivityRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        if payload.activity_date > rp._hari_ini():
            raise _Gagal("The contact date cannot be in the future.")
        if payload.status_after == "promised" and (not payload.promise_amount or not payload.promise_date):
            raise _Gagal("Enter the promised amount and payment date.")
        if payload.next_follow_up_date and payload.next_follow_up_date < payload.activity_date:
            raise _Gagal("The next follow-up date cannot be earlier than the contact date.")
        party = rp._norm_pihak(payload.party)
        a = _akun_tagih(session, kid, party, current_user)
        janji = Decimal(str(payload.promise_amount)) if payload.status_after == "promised" and payload.promise_amount else None
        session.add(CV(
            account_id=a.id, client_id=kid, activity_date=payload.activity_date, method=payload.method,
            status_after=payload.status_after, notes=_teks(payload.notes), promise_amount=janji,
            promise_date=payload.promise_date if janji else None, next_follow_up_date=payload.next_follow_up_date,
            created_by=current_user.get("id"), created_by_name=bc._nama(current_user),
        ))
        if a.last_contact_date is None or payload.activity_date >= a.last_contact_date:
            a.last_contact_date, a.last_contact_method = payload.activity_date, payload.method
        a.status = payload.status_after
        a.promise_amount, a.promise_date = (janji, payload.promise_date) if janji else (None, None)
        a.next_follow_up_date = payload.next_follow_up_date
        if payload.collector_name is not None:
            a.collector_name = _teks(payload.collector_name) or a.collector_name
        if not a.collector_name:
            a.collector_name = bc._nama(current_user) or None
        a.edited_at, a.edited_by = bc._sekarang(), current_user.get("id")
        session.flush()
        ring = _ringkas_pihak([d for d in rp._muat_dokumen(session, kid, rp.AR) if d.pihak == party], rp._hari_ini())
        return _akun_tagih_dict(party, ring.get(party), a, _peta_customer(session, kid).get(party))
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message="Follow-up recorded.", status_code=201)


statement_router_ar = _router_statement(rp.AR, "/api/v1/finance/receivables", "finance-receivables-v1")
statement_router_ap = _router_statement(rp.AP, "/api/v1/finance/payables", "finance-payables-v1")
