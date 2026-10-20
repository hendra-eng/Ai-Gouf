"""
modules/transactions/purchase_bill_v1.py
========================================
Purchase > Purchase Transaction > **Create Bill** (form manual tagihan vendor,
layout dataset/picture/Template UI/Purchase/1-2.png).

Bill = 1 Purchase Transaction + baris itemnya (tabel yang sama dengan hasil
import, jadi ikut alur Approve -> Post di Purchase Preview, tab Posted,
Financial Statements & Accounts Payable tanpa perubahan apa pun).

    GET    /api/v1/transactions/purchase/bills/form-options   nomor berikut, vendor, akun COA, akun default
    GET    /api/v1/transactions/purchase/bills/check-duplicate invoice vendor sudah pernah dipakai?
    GET    /api/v1/transactions/purchase/bills/{id}            bill + baris (mode edit)
    POST   /api/v1/transactions/purchase/bills                 simpan draft / submit (pending_review)
    PUT    /api/v1/transactions/purchase/bills/{id}            ubah bill draft / pending_review / rejected / exception

Angka dihitung ULANG di sini (hitung_baris), bukan dipercaya dari client:
    gross    = qty x unit_price
    diskon   = persen (maks 100%) atau rupiah (maks gross)
    net      = gross - diskon
    exclusive: DPP = net,             PPN = DPP x tarif
    inclusive: DPP = net / (1+tarif), PPN = net - DPP
Baris disimpan dengan subtotal - discount = DPP (inclusive: subtotal & diskon
dibagi 1+tarif) supaya jurnal posting (Dr akun item + Dr PPN Masukan = Cr AP)
tetap balance -- lihat db_client._validasi_posting_purchase.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from .purchase_v1 import _require_level_v1

logger = get_module_logger("transactions_purchase_bill_v1")

router = APIRouter(prefix="/api/v1/transactions/purchase", tags=["transactions-purchase-v1"])

LEVEL_INPUT_BILL = 3
STATUS_BISA_DIUBAH = ("draft", "pending_review", "rejected", "exception")
TARIF_PAJAK = {"ppn_11": Decimal("0.11"), "ppn_12": Decimal("0.12"), "non_ppn": Decimal("0")}
LABEL_PAJAK = {"ppn_11": "PPN 11%", "ppn_12": "PPN 12%", "non_ppn": "Non-PPN"}
TERMIN = ["Due on Receipt", "Net 7", "Net 14", "Net 30", "Net 45", "Net 60", "Net 90"]
KATEGORI = ["Inventory", "Office Supplies", "IT Equipment", "Professional Services", "Utilities", "Maintenance",
            "Marketing", "Travel", "Fixed Assets", "Raw Materials", "Logistics", "Other"]
SUMBER = ["Manual", "Purchase Order", "Vendor Invoice", "Goods Receipt", "Service Receipt", "Supplier Bill",
          "Expense Claim", "Recurring Purchase"]
_BULAN_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

TaxType = Literal["ppn_11", "ppn_12", "non_ppn"]
DiscountType = Literal["percent", "amount"]


class _Gagal(Exception):
    def __init__(self, pesan: str, status_code: int = 400, kode: str = "VALIDATION_ERROR", detail: Optional[List[str]] = None):
        super().__init__(pesan)
        self.pesan, self.status_code, self.kode, self.detail = pesan, status_code, kode, detail


# ============================================================
# SKEMA REQUEST
# ============================================================

class BillLineRequest(BaseModel):
    item_code: Optional[str] = Field(None, max_length=50)
    description: str = Field("", max_length=2000)
    account_code: str = Field("", max_length=50)
    quantity: float = 0
    unit: Optional[str] = Field(None, max_length=20)
    unit_price: float = 0
    discount_type: DiscountType = "percent"
    discount_value: float = 0
    tax_type: TaxType = "ppn_11"


class BillRequest(BaseModel):
    management_client_id: str
    purchase_no: Optional[str] = Field(None, max_length=100)
    vendor_name: str = Field("", max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    invoice_number: str = Field("", max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    invoice_date: date
    purchase_date: date
    due_date: date
    payment_terms: str = Field("Net 30", max_length=50)
    currency: str = Field("IDR", max_length=10)
    source_doc_type: str = Field("Manual", max_length=30)
    source_ref: Optional[str] = Field(None, max_length=100)
    category: str = Field("Other", max_length=50)
    description: Optional[str] = Field(None, max_length=2000)
    tax_type: TaxType = "ppn_11"
    tax_inclusive: bool = False
    ap_account_code: str = Field("", max_length=50)
    tax_account_code: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=500)
    submit: bool = False
    lines: List[BillLineRequest] = Field(default_factory=list, max_length=500)


# ============================================================
# HITUNG & VALIDASI
# ============================================================

def _sen(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def hitung_baris(l: BillLineRequest, inklusif: bool) -> Dict[str, Decimal]:
    """Sama dengan computeInvoiceLine di frontend (receivablesPayablesStore.ts)."""
    gross = _sen(Decimal(str(l.quantity or 0)) * Decimal(str(l.unit_price or 0)))
    nilai = Decimal(str(l.discount_value or 0))
    diskon = _sen(gross * min(nilai, Decimal(100)) / 100) if l.discount_type == "percent" else min(_sen(nilai), gross)
    net = gross - diskon
    tarif = TARIF_PAJAK[l.tax_type]
    if inklusif and tarif:
        dpp = _sen(net / (1 + tarif))
        pajak = net - dpp
        # subtotal & diskon ikut "dikeluarkan" pajaknya supaya subtotal - diskon = DPP.
        subtotal = _sen(gross / (1 + tarif))
        diskon_simpan = subtotal - dpp
    else:
        dpp, pajak = net, _sen(net * tarif)
        subtotal, diskon_simpan = gross, diskon
    return {"gross": gross, "diskon": diskon, "subtotal": subtotal, "diskon_simpan": diskon_simpan,
            "dpp": dpp, "pajak": pajak, "total": dpp + pajak, "tarif": tarif}


def _akun_coa(session, kid: str) -> Dict[str, str]:
    return {
        acc: nama for acc, nama in session.query(dbc.ManagementClientCoa.acc_no, dbc.ManagementClientCoa.account_name).filter(
            dbc.ManagementClientCoa.client_id == kid, dbc.ManagementClientCoa.deleted_at.is_(None),
        ).all()
    }


def _invoice_dobel(session, kid: str, vendor: str, invoice: str, kecuali_id: Optional[str] = None) -> Optional[str]:
    """purchase_no bill lain milik vendor yang sama dengan nomor invoice yang sama."""
    if not vendor.strip() or not invoice.strip():
        return None
    T = dbc.PurchaseTransaction
    q = session.query(T.purchase_no).filter(
        T.management_client_id == kid, T.deleted_at.is_(None),
        func.upper(func.trim(T.vendor_name)) == vendor.strip().upper(),
        func.upper(func.trim(T.invoice_number)) == invoice.strip().upper(),
        T.status != "cancelled",
    )
    if kecuali_id:
        q = q.filter(T.id != kecuali_id)
    r = q.first()
    return r[0] if r else None


def _validasi(session, p: BillRequest, kecuali_id: Optional[str]) -> List[Dict[str, Any]]:
    """Daftar cek yang SAMA dengan panel Validation di form (ok/warning/error)."""
    coa = _akun_coa(session, p.management_client_id)
    baris = [l for l in p.lines if l.description.strip() or l.unit_price or l.account_code.strip()]
    hasil_baris = [hitung_baris(l, p.tax_inclusive) for l in baris]
    total_pajak = sum((h["pajak"] for h in hasil_baris), Decimal(0))
    dobel = _invoice_dobel(session, p.management_client_id, p.vendor_name, p.invoice_number, kecuali_id)
    akun_baris_ok = bool(baris) and all(l.account_code.strip() and (not coa or l.account_code.strip() in coa) for l in baris)
    # (key, label panel Validation, lolos?, level, pesan error kalau gagal)
    cek = [
        ("vendor", "Vendor selected", bool(p.vendor_name.strip()), "error", "Choose a vendor"),
        ("invoice", "Vendor invoice number filled", bool(p.invoice_number.strip()), "error", "Enter the vendor invoice number"),
        ("duplicate", "Invoice number not used before for this vendor (Duplicate Invoice)", dobel is None, "error",
         f"Invoice {p.invoice_number.strip()} from this vendor is already recorded in {dobel}"),
        ("po", "PO number filled for Purchase Order source", p.source_doc_type != "Purchase Order" or bool((p.po_number or "").strip()), "error",
         "Enter the PO number (source document is Purchase Order)"),
        ("items", "Every item has description, qty and unit price",
         bool(baris) and all(l.description.strip() and l.quantity > 0 and l.unit_price > 0 for l in baris), "error",
         "Every item needs a description, a quantity and a unit price"),
        ("gl", "Every item has a GL account", akun_baris_ok, "error", "Choose a GL account from the chart of accounts for every item"),
        ("ap", "Accounts Payable account chosen", bool(p.ap_account_code.strip()) and (not coa or p.ap_account_code.strip() in coa), "error",
         "Choose the Accounts Payable account"),
        ("vat", "Input VAT account chosen (tax is charged)",
         total_pajak <= 0 or (bool((p.tax_account_code or "").strip()) and (not coa or p.tax_account_code.strip() in coa)), "error",
         "Choose the Input VAT account (tax is charged)"),
        ("due", "Due date is not before invoice date", p.due_date >= p.invoice_date, "error", "The due date cannot be earlier than the invoice date"),
        ("tax", "Tax is charged on at least one item (Tax Mismatch)", p.tax_type == "non_ppn" or total_pajak > 0, "warning", ""),
    ]
    hasil = [{"key": k, "label": label, "ok": ok, "level": lvl, "message": pesan} for k, label, ok, lvl, pesan in cek]
    return hasil


def _period_label(d: date) -> str:
    return f"{_BULAN_EN[d.month - 1]} {d.year}"


def _nomor_berikut(session, kid: str, d: date) -> str:
    awalan = f"PUR-{d.year}-{d.month:02d}-"
    nomor = [n for (n,) in session.query(dbc.PurchaseTransaction.purchase_no).filter(
        dbc.PurchaseTransaction.management_client_id == kid, dbc.PurchaseTransaction.purchase_no.like(f"{awalan}%"),
    ).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(re.escape(awalan) + r"(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


def _ke_dict(tx, lines) -> Dict[str, Any]:
    data = dbc._purchase_row_ke_dict(tx, dbc.CRUD_FIELDS_PURCHASE_TRANSACTION)
    data["lines"] = [dbc._purchase_row_ke_dict(l, dbc.CRUD_FIELDS_PURCHASE_TRANSACTION_LINE) for l in lines]
    data["editable"] = (tx.status or "").lower() in STATUS_BISA_DIUBAH
    return data


def _simpan(p: BillRequest, current_user: Dict[str, Any], bill_id: Optional[str] = None) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        T, L = dbc.PurchaseTransaction, dbc.PurchaseTransactionLine
        tx = None
        if bill_id:
            tx = session.query(T).filter(T.id == bill_id, T.deleted_at.is_(None)).first()
            if tx is None or tx.management_client_id != p.management_client_id:
                raise _Gagal("Bill not found.", 404, "NOT_FOUND")
            if (tx.status or "").lower() not in STATUS_BISA_DIUBAH:
                raise _Gagal(f"{tx.purchase_no} is {tx.status} and can no longer be edited.", 409, "CONFLICT")

        cek = _validasi(session, p, bill_id)
        salah = [c for c in cek if not c["ok"] and c["level"] == "error"]
        if salah:
            raise _Gagal(salah[0]["message"] + ".", detail=[c["message"] for c in salah])

        nomor = (p.purchase_no or "").strip().upper() or (tx.purchase_no if tx else _nomor_berikut(session, p.management_client_id, p.purchase_date))
        bentrok = session.query(T.id).filter(T.management_client_id == p.management_client_id, T.purchase_no == nomor, T.deleted_at.is_(None))
        if tx:
            bentrok = bentrok.filter(T.id != tx.id)
        if bentrok.first():
            raise _Gagal(f"Purchase No. {nomor} is already used.", 409, "DUPLICATE_PURCHASE_NO")

        coa = _akun_coa(session, p.management_client_id)
        baris = [l for l in p.lines if l.description.strip() or l.unit_price or l.account_code.strip()]
        hitung = [hitung_baris(l, p.tax_inclusive) for l in baris]
        subtotal = sum((h["subtotal"] for h in hitung), Decimal(0))
        diskon = sum((h["diskon_simpan"] for h in hitung), Decimal(0))
        pajak = sum((h["pajak"] for h in hitung), Decimal(0))
        total = sum((h["total"] for h in hitung), Decimal(0))
        nama = current_user.get("nama") or current_user.get("username")
        sekarang = datetime.now()
        kode_pajak = (p.tax_account_code or "").strip() or None

        header = dict(
            management_client_id=p.management_client_id, purchase_no=nomor, purchase_date=p.purchase_date,
            invoice_date=p.invoice_date, invoice_number=p.invoice_number.strip(), po_number=(p.po_number or "").strip() or None,
            vendor_name=p.vendor_name.strip().upper(), vendor_code=(p.vendor_code or "").strip() or None,
            source_doc_type=p.source_doc_type, source_ref=(p.source_ref or "").strip() or None,
            description=(p.description or "").strip() or None, category=p.category,
            subtotal=subtotal, discount=diskon, tax_amount=pajak, total=total, accounts_payable=total,
            currency=p.currency, payment_status="unpaid", payment_terms=p.payment_terms, due_date=p.due_date,
            status="pending_review" if p.submit else "draft", period_label=_period_label(p.purchase_date),
            notes=(p.notes or "").strip() or None, tax_type=p.tax_type, tax_inclusive=p.tax_inclusive,
            ap_account_code=p.ap_account_code.strip(), ap_account_name=coa.get(p.ap_account_code.strip()),
            tax_account_code=kode_pajak, tax_account_name=coa.get(kode_pajak) if kode_pajak else None,
        )
        if tx is None:
            tx = T(**header, client_id=current_user.get("id"), created_by=current_user.get("id"), created_by_name=nama)
            session.add(tx)
            session.flush()
        else:
            for k, v in header.items():
                setattr(tx, k, v)
            # Disimpan ulang = keluar dari status penolakan / approval lama.
            tx.approved_by_name, tx.approved_at = None, None
            tx.edited_at, tx.edited_by = sekarang, current_user.get("id")
            session.query(L).filter(L.transaction_id == tx.id).delete(synchronize_session=False)

        for i, (l, h) in enumerate(zip(baris, hitung), start=1):
            kode = l.account_code.strip()
            session.add(L(
                transaction_id=tx.id, client_id=tx.client_id, line_no=i,
                item_code=(l.item_code or "").strip() or None, description=l.description.strip(),
                quantity=Decimal(str(l.quantity)), unit=(l.unit or "").strip() or None, unit_price=Decimal(str(l.unit_price)),
                discount=h["diskon_simpan"], tax_rate=h["tarif"] * 100, tax_amount=h["pajak"],
                subtotal=h["subtotal"], total=h["total"], account_code=kode, account_name=coa.get(kode),
                discount_type=l.discount_type, discount_value=Decimal(str(l.discount_value or 0)),
                created_by=current_user.get("id"),
            ))
        session.commit()
        session.refresh(tx)
        lines = session.query(L).filter(L.transaction_id == tx.id, L.deleted_at.is_(None)).order_by(L.line_no).all()
        return _ke_dict(tx, lines)
    except _Gagal:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        logger.exception("Gagal menyimpan bill")
        raise _Gagal("Failed to save the bill (database error).", 500, "DB_ERROR")
    finally:
        session.close()


def _jawab_gagal(e: _Gagal):
    return gagal(message=e.pesan, errors={"code": e.kode, "details": e.detail} if e.detail else {"code": e.kode}, status_code=e.status_code)


# ============================================================
# ENDPOINT
# ============================================================

@router.get("/bills/form-options", summary="Opsi form Create Bill: nomor berikut, vendor, akun COA, akun default Account Mapping")
def opsi_form_bill(
    management_client_id: str = Query(...),
    purchase_date: Optional[date] = Query(None),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        kid = management_client_id
        T = dbc.PurchaseTransaction
        vendor: Dict[str, Dict[str, Any]] = {}
        for nama, kode, termin, tgl in session.query(T.vendor_name, T.vendor_code, T.payment_terms, T.purchase_date).filter(
            T.management_client_id == kid, T.deleted_at.is_(None),
        ).order_by(T.purchase_date.desc()).all():
            k = (nama or "").strip().upper()
            if not k:
                continue
            v = vendor.setdefault(k, {"name": k, "code": kode, "payment_terms": termin, "bills": 0, "last_date": tgl})
            v["bills"] += 1
            v["code"] = v["code"] or kode
        akun = [
            {"code": c.acc_no, "name": c.account_name, "classification": c.account_classification}
            for c in session.query(dbc.ManagementClientCoa).filter(
                dbc.ManagementClientCoa.client_id == kid, dbc.ManagementClientCoa.deleted_at.is_(None),
                dbc.ManagementClientCoa.is_active.isnot(False),
            ).order_by(dbc.ManagementClientCoa.acc_no).all()
        ]
        default = dbc.akun_purchase_setting(kid, session=session)
        return sukses(data={
            "next_number": _nomor_berikut(session, kid, purchase_date or date.today()),
            "vendors": sorted(vendor.values(), key=lambda v: v["name"]),
            "accounts": akun,
            "defaults": {k: (v["account_code"] if v else None) for k, v in default.items()},
            "payment_terms": TERMIN, "categories": KATEGORI, "source_types": SUMBER,
            "tax_types": [{"key": k, "label": LABEL_PAJAK[k], "rate": float(r)} for k, r in TARIF_PAJAK.items()],
        }, message="OK")
    finally:
        session.close()


@router.get("/bills/check-duplicate", summary="Cek nomor invoice vendor sudah dipakai bill lain (Duplicate Invoice)")
def cek_invoice_dobel(
    management_client_id: str = Query(...),
    vendor_name: str = Query(""),
    invoice_number: str = Query(""),
    exclude_id: Optional[str] = Query(None),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        dobel = _invoice_dobel(session, management_client_id, vendor_name, invoice_number, exclude_id)
        return sukses(data={"duplicate": dobel is not None, "purchase_no": dobel}, message="OK")
    finally:
        session.close()


@router.get("/bills/{bill_id}", summary="Detail 1 bill + baris item (mode edit)")
def detail_bill(bill_id: str, management_client_id: str = Query(...), _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        T, L = dbc.PurchaseTransaction, dbc.PurchaseTransactionLine
        tx = session.query(T).filter(T.id == bill_id, T.management_client_id == management_client_id, T.deleted_at.is_(None)).first()
        if tx is None:
            return gagal(message="Bill not found.", errors={"code": "NOT_FOUND"}, status_code=404)
        lines = session.query(L).filter(L.transaction_id == tx.id, L.deleted_at.is_(None)).order_by(L.line_no).all()
        return sukses(data=_ke_dict(tx, lines), message="OK")
    finally:
        session.close()


@router.post("/bills", summary="Create Bill: simpan draft, atau submit (pending_review) untuk di-approve di Purchase Preview (Supervisor+)")
def buat_bill(payload: BillRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT_BILL))):
    try:
        data = _simpan(payload, current_user)
    except _Gagal as e:
        return _jawab_gagal(e)
    pesan = f"{data['purchase_no']} submitted for approval." if payload.submit else f"{data['purchase_no']} saved as draft."
    return sukses(data=data, message=pesan, status_code=201)


@router.put("/bills/{bill_id}", summary="Ubah bill draft / pending_review / rejected / exception (kembali draft kecuali submit)")
def ubah_bill(bill_id: str, payload: BillRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT_BILL))):
    try:
        data = _simpan(payload, current_user, bill_id)
    except _Gagal as e:
        return _jawab_gagal(e)
    pesan = f"{data['purchase_no']} submitted for approval." if payload.submit else f"{data['purchase_no']} saved as draft."
    return sukses(data=data, message=pesan)
