"""
modules/transactions/purchase_bill_v1.py
=========================================
Fitur "Create Bill" (input manual 1 tagihan vendor) di Transactions > Purchase.
Router: /api/v1/transactions/purchase/bills/...

Posisinya di alur Purchase yang SUDAH ada (tidak membuat alur baru):

    Create Bill (modul ini)  -> financial_transaction_purchase_transactions + _lines
         status 'draft' (Save Draft) atau 'pending_review' (Submit for Approval)
    -> tab Purchase Transaction : bill tampil di daftar (sama seperti hasil import)
    -> tab Purchase Preview     : Approve (Supervisor+) -> Post (Manager+)
                                   lewat /transactions/approve & /transactions/post
                                   (dbc.ubah_status_purchase_transactions -- TIDAK diubah)
    -> tab Posted / Financial Statements / Accounts Payable membaca transaksi
       berstatus 'posted' -- otomatis, tanpa kode tambahan di sini.

Yang DIKERJAKAN modul ini (tidak ada di endpoint CRUD lama):
  1. GET  /bills/form-options  -> nomor Purchase berikutnya, daftar vendor yang pernah dipakai,
                                  COA aktif klien, akun default dari Settings > Account Mapping.
  2. GET  /bills/check-invoice -> cek duplikat (vendor + nomor invoice vendor) untuk 1 klien.
  3. POST /bills               -> buat bill. Angka (DPP, PPN, total, AP) DIHITUNG ULANG di server
                                  dari qty/harga/diskon/kode pajak -- angka kiriman browser tidak dipercaya.
  4. GET  /bills/{id}          -> header + baris (untuk mode edit).
  5. PUT  /bills/{id}          -> edit bill selama masih draft/pending_review/rejected/exception;
                                  baris lama diganti baris baru dalam 1 transaksi DB.

Konvensi angka baris (HARUS sama dengan import & _validasi_posting_purchase):
    subtotal = nilai sebelum diskon (DPP + diskon), discount = nominal diskon (Rp),
    tax_amount = PPN baris, total = subtotal - discount + tax_amount.
    Debit jurnal = SUM(subtotal - discount) + tax_amount  ==  accounts_payable = SUM(total).
Kalau harga "tax inclusive", harga/diskon dikonversi ke DPP dulu (dibagi 1+tarif) sebelum disimpan,
jadi seluruh baris di DB selalu dalam bentuk exclusive.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("transactions_purchase_bill_v1")

router = APIRouter(prefix="/api/v1/transactions/purchase/bills", tags=["transactions-purchase-bill-v1"])

TARIF_PAJAK = {"ppn_11": Decimal("0.11"), "ppn_12": Decimal("0.12"), "non_ppn": Decimal("0")}
STATUS_BISA_DIEDIT = ("draft", "pending_review", "rejected", "exception")
_BULAN_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_DUA = Decimal("0.01")


def _require_level_v1(min_tahap: int):
    def _dependency(current_user: Dict[str, Any] = Depends(get_current_user_v1)) -> Dict[str, Any]:
        if auth.role_level(current_user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. Akun kamu: {auth.role_label(current_user.get('role'))}.",
            )
        return current_user

    return _dependency


# ============================================================
# Skema request
# ============================================================

class BillLineIn(BaseModel):
    item_code: Optional[str] = Field(None, max_length=50)
    description: str = Field("", max_length=2000)
    account_code: Optional[str] = Field(None, max_length=50)
    quantity: float = 0
    unit: Optional[str] = Field(None, max_length=20)
    unit_price: float = 0
    discount_type: str = Field("percent", pattern="^(percent|amount)$")
    discount_value: float = 0
    tax_code: str = Field("ppn_11", pattern="^(ppn_11|ppn_12|non_ppn)$")


class BillIn(BaseModel):
    management_client_id: str
    purchase_no: str = Field(..., min_length=1, max_length=100)
    purchase_date: date
    invoice_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    vendor_name: str = Field(..., min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_doc_type: str = Field("Manual", max_length=30)
    source_ref: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    currency: str = Field("IDR", max_length=10)
    payment_terms: Optional[str] = Field(None, max_length=50)
    due_date: Optional[date] = None
    tax_inclusive: bool = False
    ap_account_code: Optional[str] = Field(None, max_length=50)
    tax_account_code: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=500)
    submit: bool = Field(False, description="False = Save Draft ('draft'); True = Submit for Approval ('pending_review').")
    lines: List[BillLineIn] = Field(..., min_length=1)


# ============================================================
# Helper
# ============================================================

def _d(v: Any) -> Decimal:
    return Decimal(str(v if v is not None else 0))


def _q(v: Decimal) -> Decimal:
    return v.quantize(_DUA, rounding=ROUND_HALF_UP)


def _period_label(d: date) -> str:
    return f"{_BULAN_EN[d.month - 1]} {d.year}"


def _nama_user(u: Dict[str, Any]) -> Optional[str]:
    return u.get("nama") or u.get("username")


def hitung_baris(line: BillLineIn, inklusif: bool) -> Dict[str, Any]:
    """Angka 1 baris -> dict siap simpan (bentuk exclusive)."""
    qty, harga = _d(line.quantity), _d(line.unit_price)
    kotor = qty * harga
    if line.discount_type == "percent":
        diskon = kotor * min(_d(line.discount_value), Decimal(100)) / Decimal(100)
    else:
        diskon = min(_d(line.discount_value), kotor)
    bersih = kotor - diskon
    tarif = TARIF_PAJAK[line.tax_code]
    if inklusif and tarif > 0:
        dpp = bersih / (1 + tarif)
        diskon_dpp = diskon / (1 + tarif)
    else:
        dpp, diskon_dpp = bersih, diskon
    dpp, diskon_dpp = _q(dpp), _q(diskon_dpp)
    pajak = _q(dpp * tarif)
    subtotal = dpp + diskon_dpp
    return {
        "item_code": (line.item_code or "").strip() or None,
        "description": line.description.strip(),
        "quantity": qty,
        "unit": (line.unit or "").strip() or None,
        "unit_price": _q(subtotal / qty) if qty > 0 else _q(harga),
        "discount": diskon_dpp,
        "tax_rate": _q(tarif * 100),
        "tax_amount": pajak,
        "subtotal": subtotal,
        "total": dpp + pajak,
        "account_code": (line.account_code or "").strip(),
    }


def _coa_aktif(session, management_client_id: str) -> Dict[str, Dict[str, Any]]:
    rows = session.query(dbc.ManagementClientCoa).filter(
        dbc.ManagementClientCoa.client_id == management_client_id,
        dbc.ManagementClientCoa.deleted_at.is_(None),
    ).order_by(dbc.ManagementClientCoa.acc_no).all()
    return {
        r.acc_no: {
            "acc_no": r.acc_no,
            "account_name": r.account_name,
            "account_classification": getattr(r, "account_classification", None),
            "is_active": bool(getattr(r, "is_active", True)),
        }
        for r in rows
    }


def _duplikat_invoice(session, management_client_id: str, vendor: str, invoice_no: str, exclude_id: Optional[str]) -> Optional[Any]:
    PT = dbc.PurchaseTransaction
    q = session.query(PT).filter(
        PT.management_client_id == management_client_id,
        PT.deleted_at.is_(None),
        PT.status.notin_(("cancelled", "rejected")),
        func.lower(func.trim(PT.vendor_name)) == vendor.strip().lower(),
        func.lower(func.trim(PT.invoice_number)) == invoice_no.strip().lower(),
    )
    if exclude_id:
        q = q.filter(PT.id != exclude_id)
    return q.first()


def _nomor_berikut(session, management_client_id: str, tanggal: date) -> str:
    """PUR-YYYY-MM-#### -- urutan berikutnya per klien & bulan."""
    prefix = f"PUR-{tanggal.year}-{tanggal.month:02d}-"
    PT = dbc.PurchaseTransaction
    nomor = [
        r[0] for r in session.query(PT.purchase_no).filter(
            PT.management_client_id == management_client_id, PT.purchase_no.like(f"{prefix}%"),  # termasuk yang soft-deleted
        ).all()
    ]
    terbesar = 0
    for n in nomor:
        akhir = n[len(prefix):]
        if akhir.isdigit():
            terbesar = max(terbesar, int(akhir))
    return f"{prefix}{terbesar + 1:04d}"


def _validasi_dan_susun(session, payload: BillIn, exclude_id: Optional[str]) -> Dict[str, Any]:
    """Validasi bisnis + hitung ulang. Return {"errors": [...]} atau {"header":..., "lines":[...]}."""
    errors: List[Dict[str, str]] = []

    def err(field: str, msg: str) -> None:
        errors.append({"field": field, "message": msg})

    mcid = payload.management_client_id
    vendor = payload.vendor_name.strip()
    invoice_no = (payload.invoice_number or "").strip()
    if not invoice_no:
        err("invoice_number", "Vendor invoice number is required.")
    elif _duplikat_invoice(session, mcid, vendor, invoice_no, exclude_id):
        err("invoice_number", f"Invoice {invoice_no} from {vendor} already exists for this company.")

    PT = dbc.PurchaseTransaction
    # Constraint unik (client_id, purchase_no) di DB tidak peduli soft-delete -> nomor milik bill terhapus tetap terpakai.
    q = session.query(PT.id).filter(PT.management_client_id == mcid, PT.purchase_no == payload.purchase_no.strip())
    if exclude_id:
        q = q.filter(PT.id != exclude_id)
    if q.first():
        err("purchase_no", f"Purchase number {payload.purchase_no} is already used.")

    if payload.invoice_date and payload.due_date and payload.due_date < payload.invoice_date:
        err("due_date", "Due date cannot be earlier than the invoice date.")
    if payload.source_doc_type == "Purchase Order" and not (payload.po_number or "").strip():
        err("po_number", "PO number is required when the source document is a Purchase Order.")

    isi = [l for l in payload.lines if (l.description or "").strip() or l.unit_price]
    if not isi:
        err("lines", "Add at least one bill item.")
    for i, l in enumerate(isi, start=1):
        if not (l.description or "").strip():
            err(f"lines.{i}", f"Item {i}: description is required.")
        if not (l.quantity > 0):
            err(f"lines.{i}", f"Item {i}: quantity must be greater than zero.")
        if not (l.unit_price > 0):
            err(f"lines.{i}", f"Item {i}: unit price must be greater than zero.")
        if l.discount_type == "percent" and l.discount_value > 100:
            err(f"lines.{i}", f"Item {i}: discount cannot exceed 100%.")

    baris = [hitung_baris(l, payload.tax_inclusive) for l in isi]

    # Akun: yang kosong diisi dari Settings > Account Mapping (aturan yang sama dgn import).
    setting = dbc.akun_purchase_setting(mcid, session=session)
    header_akun: Dict[str, Any] = {
        "ap_account_code": (payload.ap_account_code or "").strip() or None,
        "tax_account_code": (payload.tax_account_code or "").strip() or None,
    }
    dbc.lengkapi_akun_purchase(header_akun, baris, setting)
    total_pajak = sum((b["tax_amount"] for b in baris), Decimal(0))

    coa = _coa_aktif(session, mcid)
    if not header_akun.get("ap_account_code"):
        err("ap_account_code", "Choose the Accounts Payable account (or set it in Settings > Account Mapping).")
    if total_pajak > 0 and not header_akun.get("tax_account_code"):
        err("tax_account_code", "Choose the Input VAT account (or set it in Settings > Account Mapping).")
    for i, b in enumerate(baris, start=1):
        if not b["account_code"]:
            err(f"lines.{i}", f"Item {i}: choose a GL account.")
    if coa:
        dipakai = {b["account_code"] for b in baris if b["account_code"]}
        if header_akun.get("ap_account_code"):
            dipakai.add(header_akun["ap_account_code"])
        if total_pajak > 0 and header_akun.get("tax_account_code"):
            dipakai.add(header_akun["tax_account_code"])
        hilang = sorted(k for k in dipakai if k not in coa)
        if hilang:
            err("accounts", f"Account(s) not found in this company's chart of accounts: {', '.join(hilang)}.")
        nonaktif = sorted(k for k in dipakai if k in coa and not coa[k]["is_active"])
        if nonaktif:
            err("accounts", f"Inactive account(s): {', '.join(nonaktif)}.")

    if errors:
        return {"errors": errors}

    for b in baris:
        b["account_name"] = (coa.get(b["account_code"]) or {}).get("account_name")
    for kunci in ("ap", "tax"):
        kode = header_akun.get(f"{kunci}_account_code")
        if kode:
            header_akun[f"{kunci}_account_name"] = (coa.get(kode) or {}).get("account_name") or (setting.get(kunci) or {}).get("account_name")

    subtotal = sum((b["subtotal"] for b in baris), Decimal(0))
    diskon = sum((b["discount"] for b in baris), Decimal(0))
    total = sum((b["total"] for b in baris), Decimal(0))
    header = {
        "client_id": mcid,  # kolom client_id Purchase = FK management_clients (pola sama dgn import)
        "management_client_id": mcid,
        "purchase_no": payload.purchase_no.strip(),
        "purchase_date": payload.purchase_date,
        "invoice_date": payload.invoice_date,
        "invoice_number": invoice_no,
        "po_number": (payload.po_number or "").strip() or None,
        "vendor_name": vendor,
        "vendor_code": (payload.vendor_code or "").strip() or None,
        "source_doc_type": payload.source_doc_type,
        "source_ref": (payload.source_ref or "").strip() or None,
        "category": payload.category,
        "description": (payload.description or "").strip() or None,
        "subtotal": subtotal,
        "discount": diskon,
        "tax_amount": total_pajak,
        "total": total,
        "accounts_payable": total,
        "currency": payload.currency,
        "payment_terms": payload.payment_terms,
        "due_date": payload.due_date,
        "period_label": _period_label(payload.purchase_date),
        "notes": (payload.notes or "").strip() or None,
        "ap_account_code": header_akun.get("ap_account_code"),
        "ap_account_name": header_akun.get("ap_account_name"),
        "tax_account_code": header_akun.get("tax_account_code"),
        "tax_account_name": header_akun.get("tax_account_name"),
    }
    return {"header": header, "lines": baris}


def _ke_dict(obj: Any, fields: List[str]) -> Dict[str, Any]:
    return dbc._purchase_row_ke_dict(obj, fields)


def _detail(session, tx: Any) -> Dict[str, Any]:
    hasil = _ke_dict(tx, dbc.CRUD_FIELDS_PURCHASE_TRANSACTION)
    PL = dbc.PurchaseTransactionLine
    hasil["lines"] = [
        _ke_dict(l, dbc.CRUD_FIELDS_PURCHASE_TRANSACTION_LINE)
        for l in session.query(PL).filter(PL.transaction_id == tx.id, PL.deleted_at.is_(None)).order_by(PL.line_no).all()
    ]
    return hasil


def _gagal_validasi(errors: List[Dict[str, str]]):
    return gagal(message=errors[0]["message"], errors={"code": "VALIDATION_FAILED", "details": errors}, status_code=422)


# ============================================================
# Endpoints
# ============================================================

@router.get("/form-options", summary="Opsi form Create Bill: nomor berikutnya, vendor, COA, akun default")
def form_options(
    management_client_id: str = Query(...),
    purchase_date: Optional[date] = Query(None),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    tanggal = purchase_date or date.today()
    session = dbc.SessionLocal()
    try:
        PT = dbc.PurchaseTransaction
        baris = session.query(PT.vendor_name, PT.vendor_code, PT.payment_terms, PT.category).filter(
            PT.management_client_id == management_client_id, PT.deleted_at.is_(None),
        ).order_by(PT.purchase_date.desc()).all()
        vendors: Dict[str, Dict[str, Any]] = {}
        for nama, kode, termin, kategori in baris:  # terbaru menang
            kunci = (nama or "").strip().upper()
            if kunci and kunci not in vendors:
                vendors[kunci] = {"name": nama.strip(), "code": kode, "payment_terms": termin, "category": kategori}
        setting = dbc.akun_purchase_setting(management_client_id, session=session)
        coa = _coa_aktif(session, management_client_id)
        return sukses(data={
            "next_number": _nomor_berikut(session, management_client_id, tanggal),
            "vendors": sorted(vendors.values(), key=lambda v: v["name"]),
            "accounts": [a for a in coa.values() if a["is_active"]],
            "defaults": {k: (setting.get(k) or None) for k in ("ap", "tax", "line", "biaya")},
        }, message="OK")
    except Exception:  # noqa: BLE001
        logger.exception("Gagal memuat form-options Create Bill")
        return gagal(message="Failed to load form options (database error).", status_code=500)
    finally:
        session.close()


@router.get("/check-invoice", summary="Cek duplikat vendor + nomor invoice vendor")
def check_invoice(
    management_client_id: str = Query(...),
    vendor_name: str = Query(...),
    invoice_number: str = Query(...),
    exclude_id: Optional[str] = Query(None),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        ada = _duplikat_invoice(session, management_client_id, vendor_name, invoice_number, exclude_id)
        return sukses(data={"duplicate": bool(ada), "purchase_no": ada.purchase_no if ada else None}, message="OK")
    finally:
        session.close()


@router.post("", summary="Buat bill (khusus Supervisor ke atas)", status_code=201)
def buat_bill(payload: BillIn, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    session = dbc.SessionLocal()
    try:
        hasil = _validasi_dan_susun(session, payload, exclude_id=None)
        if "errors" in hasil:
            return _gagal_validasi(hasil["errors"])
        header, baris = hasil["header"], hasil["lines"]
        tx = dbc.PurchaseTransaction(
            **header,
            status="pending_review" if payload.submit else "draft",
            payment_status="unpaid",
            created_by_name=_nama_user(current_user),
            created_by=current_user.get("id"),
        )
        session.add(tx)
        session.flush()
        for idx, b in enumerate(baris, start=1):
            session.add(dbc.PurchaseTransactionLine(
                **b, transaction_id=tx.id, client_id=tx.client_id, line_no=idx, created_by=current_user.get("id"),
            ))
        session.commit()
        session.refresh(tx)
        return sukses(
            data=_detail(session, tx),
            message="Bill submitted for approval." if payload.submit else "Bill saved as draft.",
            status_code=201,
        )
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Gagal membuat bill")
        return gagal(message="Failed to create bill (database error).", status_code=500)
    finally:
        session.close()


@router.get("/{transaction_id}", summary="Detail bill + baris (untuk mode edit)")
def detail_bill(transaction_id: str, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        tx = session.query(dbc.PurchaseTransaction).filter(
            dbc.PurchaseTransaction.id == transaction_id, dbc.PurchaseTransaction.deleted_at.is_(None),
        ).first()
        if tx is None:
            return gagal(message="Bill not found.", errors={"code": "NOT_FOUND"}, status_code=404)
        return sukses(data=_detail(session, tx), message="OK")
    finally:
        session.close()


@router.put("/{transaction_id}", summary="Edit bill yang belum di-approve (khusus Supervisor ke atas)")
def edit_bill(transaction_id: str, payload: BillIn, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    session = dbc.SessionLocal()
    try:
        tx = session.query(dbc.PurchaseTransaction).filter(
            dbc.PurchaseTransaction.id == transaction_id, dbc.PurchaseTransaction.deleted_at.is_(None),
        ).with_for_update().first()
        if tx is None:
            return gagal(message="Bill not found.", errors={"code": "NOT_FOUND"}, status_code=404)
        if (tx.status or "").lower() not in STATUS_BISA_DIEDIT:
            return gagal(
                message=f"A bill with status '{tx.status}' can no longer be edited.",
                errors={"code": "NOT_EDITABLE"}, status_code=409,
            )
        if tx.management_client_id and tx.management_client_id != payload.management_client_id:
            return gagal(message="This bill belongs to another company.", errors={"code": "WRONG_COMPANY"}, status_code=409)

        hasil = _validasi_dan_susun(session, payload, exclude_id=tx.id)
        if "errors" in hasil:
            return _gagal_validasi(hasil["errors"])
        header, baris = hasil["header"], hasil["lines"]

        for kolom, nilai in header.items():
            setattr(tx, kolom, nilai)
        tx.status = "pending_review" if payload.submit else "draft"
        tx.edited_at = datetime.now()
        tx.edited_by = current_user.get("id")

        # Baris lama diganti seluruhnya. HARD delete (bukan soft-delete): constraint unik
        # (transaction_id, line_no) tidak peduli deleted_at, jadi baris lama yg hanya di-soft-delete
        # akan menabrak baris baru ber-line_no sama. Aman karena bill masih draft/belum diposting.
        PL = dbc.PurchaseTransactionLine
        session.query(PL).filter(PL.transaction_id == tx.id).delete(synchronize_session=False)
        for idx, b in enumerate(baris, start=1):
            session.add(PL(**b, transaction_id=tx.id, client_id=tx.client_id, line_no=idx, created_by=current_user.get("id")))
        session.commit()
        session.refresh(tx)
        return sukses(
            data=_detail(session, tx),
            message="Bill submitted for approval." if payload.submit else "Bill saved as draft.",
        )
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Gagal mengedit bill")
        return gagal(message="Failed to update bill (database error).", status_code=500)
    finally:
        session.close()
