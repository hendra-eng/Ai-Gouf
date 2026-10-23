"""
modules/assets_and_equity/other_transactions_v1.py
==================================================
Other Transactions (tabel grup Assets & Equity, awalan asset_; menu sidebar
Transactions > Other), UI dataset/picture/Template UI/other/1-8.jpeg -- tab
Overview, Categories, Review Queue, Journal Preview, Exceptions, Posted +
Transaction Templates, Import, Export, dan form Create per jenis transaksi.
Endpoint /api/v1/asset/other-transactions/... Tabel:
migrations/48-create_other_transaction_tables.py.

Peristiwa bisnis khusus di luar Sales, Purchase, dan Cash & Bank. Tiap jenis
punya sub jenis dengan aturan jurnal tetap; akun per PERAN diisi dari aturan
template (asset_other_transaction_rules) dan boleh diganti di form:

    main    akun utama (uang muka karyawan, deposit, utang pinjaman, modal saham, ...)
    bank    akun kas / bank
    offset  akun lawan non-kas (biaya saat settlement, akun kredit Other Event)
    extra   porsi tambahan (bunga, tambahan modal disetor) sebesar extra_amount

Status:
    Save Draft        -> draft
    Submit for Review -> pending_review (template butuh approval) / approved (tidak)
    Approve           -> approved (Supervisor+); template auto_post + user Manager+ -> langsung posted
    Reject            -> rejected (bisa diedit lalu diajukan lagi)
    Post              -> posted (Manager+) -> GL/FS sumber "other"
    Reverse           -> reversed (Manager+) -> pembalik RV-<no> di reversal_date

Jurnal OTH- lama (migration 42) disalin migration 48 sebagai jenis other_event
(source 'legacy'): barisnya dipertahankan apa adanya dan tidak bisa diedit.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from ..transactions import bank_cash_helpers as bc

logger = get_module_logger("asset_other_transactions_v1")

router = APIRouter(prefix="/api/v1/asset/other-transactions", tags=["other-transactions"])

LEVEL_INPUT = bc.LEVEL_INPUT
LEVEL_POST = bc.LEVEL_POST
NOL = Decimal("0")
SEN = Decimal("0.01")
MAKS_LAMPIRAN = 10 * 1024 * 1024
_Gagal = bc._Gagal
_f = bc._f
_nama = bc._nama
_sekarang = bc._sekarang

TPL = dbc.OtherTransactionTemplate
RUL = dbc.OtherTransactionRule
TX = dbc.OtherTransaction
TL = dbc.OtherTransactionLine
ATT = dbc.OtherTransactionAttachment
EV = dbc.OtherTransactionEvent
COA = dbc.ManagementClientCoa

PERAN = ("main", "bank", "offset", "extra")
STATUS = ("draft", "pending_review", "approved", "rejected", "posted", "reversed")
LABEL_STATUS = {"draft": "Draft", "pending_review": "Under Review", "approved": "Approved", "rejected": "Rejected",
                "posted": "Posted", "reversed": "Reversed"}


# ============================================================
# DEFINISI JENIS TRANSAKSI
# ============================================================

@dataclass
class Sub:
    label: str
    # (sisi D/C, peran, porsi): porsi total = nominal penuh, main = total - extra, extra = extra_amount
    baris: List[Tuple[str, str, str]]
    extra_label: Optional[str] = None      # label isian extra_amount (None = tidak dipakai)
    # tebakan akun default khusus sub jenis ini (menimpa Jenis.tebak per peran)
    tebak: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = field(default_factory=dict)


@dataclass
class Jenis:
    code: str
    name: str
    description: str
    party: str
    peran: Dict[str, str]
    sub: Dict[str, Sub]
    # tebakan akun default: peran -> (standard_account_code, kata kunci nama akun)
    tebak: Dict[str, Tuple[Tuple[str, ...], Tuple[str, ...]]] = field(default_factory=dict)


# Intercompany: Due From = piutang pihak berelasi, Due To = utang pihak berelasi
_IC_DUE_FROM = {"main": (("std_asset_current_receivable_related_party",),
                         ("piutang afiliasi", "piutang pihak berelasi", "piutang intercompany", "due from"))}
_IC_DUE_TO = {"main": (("std_liability_noncurrent_borrowing_related_party",),
                       ("utang afiliasi", "hutang afiliasi", "utang pihak berelasi", "hutang pihak berelasi",
                        "utang intercompany", "hutang intercompany", "due to"))}

JENIS: Dict[str, Jenis] = {
    "employee_advance": Jenis(
        "EMP-ADV", "Employee Advance", "Advances to employees", "Employee",
        {"main": "Employee Advance Account", "bank": "Payment Account / Bank", "offset": "Expense Account"},
        {"advance_issued": Sub("Advance Issued", [("D", "main", "total"), ("C", "bank", "total")]),
         "advance_settled": Sub("Advance Settlement", [("D", "offset", "total"), ("C", "main", "total")]),
         "advance_returned": Sub("Advance Returned", [("D", "bank", "total"), ("C", "main", "total")])},
        {"main": (("std_asset_current_receivable_employee", "std_asset_current_advance"), ("uang muka karyawan", "employee advance", "piutang karyawan", "kasbon")),
         "offset": (("std_expense_operating_transport_travel", "std_expense_operating_other"), ("perjalanan dinas", "travel"))},
    ),
    "security_deposit": Jenis(
        "SEC-DEP", "Security Deposit", "Deposits paid and deposits received", "Counterparty / Vendor",
        {"main": "Deposit Account / COA", "bank": "Payment Account / Bank", "offset": "Expense Account (forfeited)",
         "extra": "Deposit Liability Account (received)"},
        {"deposit_paid": Sub("Deposit Paid", [("D", "main", "total"), ("C", "bank", "total")]),
         "deposit_refunded": Sub("Deposit Refunded", [("D", "bank", "total"), ("C", "main", "total")]),
         "deposit_forfeited": Sub("Deposit Forfeited", [("D", "offset", "total"), ("C", "main", "total")]),
         # deposit dari penyewa / customer: kewajiban kita, dikembalikan nanti
         "deposit_received": Sub("Deposit Received", [("D", "bank", "total"), ("C", "extra", "total")]),
         "deposit_returned": Sub("Received Deposit Returned", [("D", "extra", "total"), ("C", "bank", "total")])},
        {"main": ((), ("uang jaminan dibayar", "deposit dibayar", "deposit", "jaminan")),
         "offset": (("std_expense_operating_rent", "std_expense_operating_other"), ("sewa", "rent")),
         "extra": ((), ("utang deposit", "hutang deposit", "deposit diterima", "jaminan diterima", "uang jaminan diterima",
                        "titipan", "customer deposit", "deposit received", "deposit liabilit"))},
    ),
    "loan_financing": Jenis(
        "LOAN", "Loan & Financing", "Loan proceeds, repayment, interest", "Lender / Creditor",
        {"main": "Loan Payable Account", "bank": "Bank Account", "extra": "Interest Expense Account"},
        {"loan_received": Sub("Loan Received", [("D", "bank", "total"), ("C", "main", "total")]),
         "loan_repayment": Sub("Loan Repayment", [("D", "main", "main"), ("D", "extra", "extra"), ("C", "bank", "total")], "Interest Portion"),
         "interest_payment": Sub("Interest Payment", [("D", "extra", "total"), ("C", "bank", "total")])},
        {"main": (("std_liability_current_borrowing", "std_liability_noncurrent_borrowing"), ("utang bank", "hutang bank", "pinjaman", "loan")),
         "extra": (("std_other_expense_interest",), ("biaya bunga", "interest expense"))},
    ),
    "capital_injection": Jenis(
        "CAP-INJ", "Capital & Owner Withdrawal", "Owner investment, capital changes, and owner drawings", "Investor / Owner",
        {"main": "Equity Account (Share Capital)", "bank": "Bank Account", "extra": "Additional Paid-in Capital Account",
         "offset": "Owner Drawings Account"},
        {"capital_injection": Sub("Capital Injection", [("D", "bank", "total"), ("C", "main", "main"), ("C", "extra", "extra")],
                                  "Additional Paid-in Capital Portion"),
         "capital_reduction": Sub("Capital Reduction", [("D", "main", "total"), ("C", "bank", "total")]),
         # prive: mengurangi ekuitas lewat akun drawings, bukan modal disetor
         "owner_withdrawal": Sub("Owner Withdrawal", [("D", "offset", "total"), ("C", "bank", "total")])},
        {"main": (("std_equity_share_capital", "std_equity_other"), ("modal saham", "modal disetor", "share capital")),
         "extra": (("std_equity_additional_paid_in_capital",), ("tambahan modal disetor", "agio", "additional paid")),
         "offset": (("std_equity_owner_drawing",), ("prive", "drawing", "penarikan pemilik", "pengambilan pribadi"))},
    ),
    "intercompany": Jenis(
        "INTERCO", "Intercompany", "Transactions between company entities", "Counterparty Entity",
        {"main": "Intercompany Due To / Due From Account", "bank": "Bank / Clearing Account"},
        {"due_from_funding": Sub("Intercompany Funding (Due From)", [("D", "main", "total"), ("C", "bank", "total")], tebak=_IC_DUE_FROM),
         "due_to_funding": Sub("Intercompany Funding (Due To)", [("D", "bank", "total"), ("C", "main", "total")], tebak=_IC_DUE_TO),
         "due_from_settlement": Sub("Settlement Received (Due From)", [("D", "bank", "total"), ("C", "main", "total")], tebak=_IC_DUE_FROM),
         "due_to_settlement": Sub("Settlement Paid (Due To)", [("D", "main", "total"), ("C", "bank", "total")], tebak=_IC_DUE_TO)},
        {"main": (("std_asset_current_receivable_related_party", "std_liability_noncurrent_borrowing_related_party"),
                  ("intercompany", "afiliasi", "berelasi", "related party"))},
    ),
    "refund_reimbursement": Jenis(
        "REF-RMB", "Refund & Reimbursement", "Customer refund, expense reimbursement", "Employee / Beneficiary",
        {"main": "Expense / Refund Account", "bank": "Payment Bank Account"},
        {"employee_reimbursement": Sub("Employee Reimbursement", [("D", "main", "total"), ("C", "bank", "total")]),
         "customer_refund": Sub("Customer Refund", [("D", "main", "total"), ("C", "bank", "total")]),
         "vendor_refund": Sub("Vendor Refund Received", [("D", "bank", "total"), ("C", "main", "total")])},
        {"main": (("std_expense_operating_transport_travel", "std_expense_operating_other"), ("perjalanan dinas", "travel"))},
    ),
    "other_event": Jenis(
        "OTH-EVT", "Other Approved Events", "Miscellaneous business events", "Counterparty",
        {"main": "Default Debit Account", "offset": "Default Credit Account"},
        {"other_event": Sub("Other Approved Events", [("D", "main", "total"), ("C", "offset", "total")])},
        {"main": (("std_expense_operating_other", "std_other_expense_misc"), ("biaya lain", "miscellaneous", "other expense"))},
    ),
}


def _jenis(type_key: str) -> Jenis:
    j = JENIS.get(type_key)
    if j is None:
        raise _Gagal(f"Unknown transaction type: {type_key}.")
    return j


def _sub(type_key: str, subtype: str) -> Sub:
    s = _jenis(type_key).sub.get(subtype)
    if s is None:
        raise _Gagal(f"Unknown transaction subtype {subtype} for {_jenis(type_key).name}.")
    return s


def _peran_dipakai(sub: Sub) -> List[str]:
    return list(dict.fromkeys(r for _, r, _ in sub.baris))


def _peran_wajib(sub: Sub) -> List[str]:
    """Peran yang selalu terisi nominal (porsi extra boleh nol -> akunnya opsional)."""
    return list(dict.fromkeys(r for _, r, porsi in sub.baris if porsi != "extra"))


# ============================================================
# UTIL
# ============================================================

def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _d(v: Any) -> Decimal:
    return bc._dec(v)


def _uang(v: Decimal) -> Decimal:
    return v.quantize(SEN, rounding=ROUND_HALF_UP)


def _awal(d: date) -> date:
    return d.replace(day=1)


def _geser(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def _kunci(session, kid: str) -> None:
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"other-transaction:{kid}"})


def _tanggal_kunci(session, kid: str) -> Optional[date]:
    try:
        with session.begin_nested():
            return session.execute(text("select fn_tanggal_kunci_periode(cast(:c as uuid))"), {"c": kid}).scalar()
    except Exception:
        return None


def _boleh_post(user: Dict[str, Any]) -> bool:
    return auth.role_level(user.get("role")) >= LEVEL_POST


def _peta_akun(session, kid: str) -> Dict[str, Any]:
    return {a.id: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}


def _catat(session, tx_id: str, aksi: str, user: Dict[str, Any], note: Optional[str] = None) -> None:
    session.add(EV(transaction_id=tx_id, action=aksi, note=_teks(note), actor_id=user.get("id"), actor_name=_nama(user)))


def _nomor_berikut(session, kid: str, tgl: date) -> str:
    awalan = f"OT-{tgl.year}-"
    nomor = [n for (n,) in session.query(TX.journal_no).filter(TX.client_id == kid, TX.journal_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


# ============================================================
# TEMPLATE & ATURAN DEFAULT
# ============================================================

def _tebak_akun(akun: List[Any], std: Tuple[str, ...], kata: Tuple[str, ...]) -> Optional[str]:
    aktif = [a for a in akun if a.is_active]
    for s in std:
        for a in aktif:
            if (a.standard_account_code or "") == s:
                return a.id
    for k in kata:
        for a in aktif:
            if k in (a.account_name or "").lower():
                return a.id
    return None


def _bank_default(akun: List[Any]) -> Optional[str]:
    bank = [a for a in akun if a.is_active and bc._jenis_kas(a) == "bank"]
    kas = [a for a in akun if a.is_active and bc._jenis_kas(a) is not None]
    pilihan = bank or kas
    return pilihan[0].id if pilihan else None


def _aturan_default(akun: List[Any], bank: Optional[str], j: Jenis, s: Sub) -> Dict[str, Optional[str]]:
    """Akun default per peran untuk 1 sub jenis (tebakan sub menimpa tebakan jenis)."""
    tebak = j.tebak | s.tebak
    hasil: Dict[str, Optional[str]] = {}
    for p in _peran_dipakai(s):
        hasil[f"{p}_coa_id"] = bank if p == "bank" else (_tebak_akun(akun, *tebak[p]) if p in tebak else None)
    return hasil


def _pastikan_template(session, kid: str) -> None:
    """Template sistem (1 per jenis) + aturan per sub jenis dibuat sekali per klien,
    akun default ditebak dari COA (standard_account_code lalu nama akun). Sub jenis
    yang ditambahkan belakangan ikut dibuatkan aturannya di template yang sudah ada."""
    def _cek():
        semua = session.query(TPL).filter(TPL.client_id == kid).all()
        ts = [t for t in semua if t.deleted_at is None]
        ada_rul = {(t, s) for t, s in session.query(RUL.template_id, RUL.subtype).filter(RUL.client_id == kid).all()}
        sistem = {t.type_key for t in semua if t.is_system}
        kurang = [k for k in JENIS if k not in sistem]
        kurang_sub = [(t, sk) for t in ts if t.type_key in JENIS for sk in JENIS[t.type_key].sub if (t.id, sk) not in ada_rul]
        return ts, sistem, kurang, kurang_sub

    ts, sistem, kurang, kurang_sub = _cek()
    if not kurang and not kurang_sub:
        return
    _kunci(session, kid)
    ts, sistem, kurang, kurang_sub = _cek()
    akun = sorted(_peta_akun(session, kid).values(), key=lambda a: a.acc_no or "")
    bank = _bank_default(akun)
    for urut, (key, j) in enumerate(JENIS.items(), start=1):
        if key in sistem:
            continue
        kode = j.code
        if session.query(TPL.id).filter(TPL.client_id == kid, TPL.code == kode).first() is not None:
            kode = f"{kode}-SYS"
        t = TPL(client_id=kid, type_key=key, code=kode, name=j.name, description=j.description,
                requires_approval=True, auto_post=False, is_active=True, is_system=True, sort_order=urut)
        session.add(t)
        session.flush()
        for sk, s in j.sub.items():
            session.add(RUL(client_id=kid, template_id=t.id, subtype=sk, is_active=True, **_aturan_default(akun, bank, j, s)))
    if kurang_sub:
        for t, sk in kurang_sub:
            j = JENIS[t.type_key]
            session.add(RUL(client_id=kid, template_id=t.id, subtype=sk, is_active=True, **_aturan_default(akun, bank, j, j.sub[sk])))
        # Sekali jalan saat sub jenis baru masuk: aturan sistem yang belum pernah diedit user
        # dan punya tebakan khusus sub (mis. Intercompany Due From / Due To) ditebak ulang.
        ids = [t.id for t in ts if t.is_system and t.type_key in JENIS]
        tipe = {t.id: t.type_key for t in ts}
        for r in session.query(RUL).filter(RUL.template_id.in_(ids), RUL.edited_at.is_(None)).all() if ids else []:
            j = JENIS[tipe[r.template_id]]
            s = j.sub.get(r.subtype)
            if s is None or not s.tebak:
                continue
            for kolom, nilai in _aturan_default(akun, bank, j, s).items():
                if kolom != "bank_coa_id" and nilai:
                    setattr(r, kolom, nilai)
    session.flush()


def _akun_ringkas(a: Any) -> Optional[Dict[str, Any]]:
    return {"id": a.id, "code": a.acc_no, "name": a.account_name} if a is not None else None


def _template_dict(t: Any, aturan: List[Any], akun: Dict[str, Any], pakai: Dict[str, int]) -> Dict[str, Any]:
    j = JENIS[t.type_key]
    per_sub = {r.subtype: r for r in aturan}
    rules = []
    for sk, s in j.sub.items():
        r = per_sub.get(sk)
        dipakai = _peran_dipakai(s)
        rules.append({
            "id": r.id if r else None, "subtype": sk, "label": s.label, "is_active": bool(r.is_active) if r else False,
            "roles": dipakai,
            "accounts": {p: _akun_ringkas(akun.get(getattr(r, f"{p}_coa_id"))) if r else None for p in dipakai},
            "required": _peran_wajib(s),
            "complete": bool(r) and all(getattr(r, f"{p}_coa_id") for p in _peran_wajib(s)),
        })
    return {"id": t.id, "type_key": t.type_key, "type_name": j.name, "code": t.code, "name": t.name, "description": t.description,
            "requires_approval": bool(t.requires_approval), "auto_post": bool(t.auto_post), "is_active": bool(t.is_active),
            "is_system": bool(t.is_system), "sort_order": t.sort_order, "rules": rules, "usage": pakai.get(t.id, 0)}


def _templates(session, kid: str) -> List[Dict[str, Any]]:
    akun = _peta_akun(session, kid)
    ts = session.query(TPL).filter(TPL.client_id == kid, TPL.deleted_at.is_(None)).order_by(TPL.sort_order, TPL.name).all()
    aturan: Dict[str, List[Any]] = defaultdict(list)
    if ts:
        for r in session.query(RUL).filter(RUL.template_id.in_([t.id for t in ts])).all():
            aturan[r.template_id].append(r)
    pakai = dict(session.query(TX.template_id, func.count(TX.id)).filter(TX.client_id == kid, TX.deleted_at.is_(None))
                 .group_by(TX.template_id).all())
    return [_template_dict(t, aturan[t.id], akun, pakai) for t in ts if t.type_key in JENIS]


# ============================================================
# SUSUN JURNAL + CEK
# ============================================================

def _susun(type_key: str, subtype: str, h: Dict[str, Any], akun: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """Baris jurnal (IDR) dari header + aturan sub jenis. h: amount, extra_amount,
    exchange_rate, <peran>_coa_id, counterparty, reference_no."""
    isu: List[Dict[str, str]] = []
    j, s = _jenis(type_key), _sub(type_key, subtype)
    kurs = _d(h.get("exchange_rate") or 1) or Decimal("1")
    total = _uang(_d(h.get("amount")) * kurs)
    extra = _uang(_d(h.get("extra_amount")) * kurs) if s.extra_label else NOL
    porsi = {"total": total, "extra": extra, "main": total - extra}
    if total <= 0:
        isu.append({"code": "zero_amount", "level": "error", "message": "Amount must be greater than zero."})
    if extra > total:
        isu.append({"code": "extra_exceeds", "level": "error", "message": f"{s.extra_label} cannot exceed the total amount."})
    pihak = _teks(h.get("counterparty"))
    ket = s.label + (f" - {pihak}" if pihak else "") + (f" ({h['reference_no']})" if _teks(h.get("reference_no")) else "")
    baris: List[Dict[str, Any]] = []
    for sisi, peran, bagian in s.baris:
        nilai = porsi[bagian]
        if nilai <= 0:
            continue
        coa_id = h.get(f"{peran}_coa_id")
        a = akun.get(str(coa_id)) if coa_id else None
        if a is None:
            isu.append({"code": f"missing_{peran}", "level": "error",
                        "message": f"{j.peran.get(peran, peran)} is required." if not coa_id else
                        f"{j.peran.get(peran, peran)} is not in this client's chart of accounts."})
            continue
        baris.append({"role": peran, "coa_id": a.id, "account_code": a.acc_no, "account_name": a.account_name,
                      "description": ket, "debit": nilai if sisi == "D" else NOL, "credit": nilai if sisi == "C" else NOL})
    return baris, isu


def _cek_akun(baris: List[Dict[str, Any]], akun: Dict[str, Any]) -> List[Dict[str, str]]:
    isu: List[Dict[str, str]] = []
    for b in baris:
        a = akun.get(str(b.get("coa_id"))) if b.get("coa_id") else next((x for x in akun.values() if x.acc_no == b["account_code"]), None)
        if a is None:
            isu.append({"code": "account_missing", "level": "error", "message": f"Account {b['account_code']} is not in the chart of accounts."})
            continue
        if not a.is_active:
            isu.append({"code": "account_inactive", "level": "warning", "message": f"Account {a.acc_no} {a.account_name} is inactive."})
        if not a.standard_account_code:
            isu.append({"code": "account_unmapped", "level": "warning",
                        "message": f"Account {a.acc_no} {a.account_name} is not mapped to a standard account."})
        if b.get("role") == "bank" and bc._jenis_kas(a) is None:
            isu.append({"code": "bank_not_cash", "level": "warning",
                        "message": f"Account {a.acc_no} {a.account_name} is used as the bank account but is not a cash or bank account."})
    return isu


def _unik(isu: List[Dict[str, str]]) -> List[Dict[str, str]]:
    lihat, hasil = set(), []
    for i in isu:
        if i["message"] not in lihat:
            lihat.add(i["message"])
            hasil.append(i)
    return hasil


def _header(t: Any) -> Dict[str, Any]:
    return {"amount": t.amount, "extra_amount": t.extra_amount, "exchange_rate": t.exchange_rate, "counterparty": t.counterparty,
            "reference_no": t.reference_no, **{f"{p}_coa_id": getattr(t, f"{p}_coa_id") for p in PERAN}}


def _evaluasi(t: Any, tersimpan: List[Any], akun: Dict[str, Any], kunci_tgl: Optional[date]) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """Baris jurnal untuk ditampilkan + hasil cek. Posted/reversed & legacy = baris tersimpan;
    lainnya disusun ulang dari aturan (akun yang diganti nama langsung terlihat)."""
    if t.status in ("posted", "reversed") or t.source == "legacy":
        baris = [{"role": l.role, "coa_id": l.coa_id, "account_code": l.account_code, "account_name": l.account_name,
                  "description": l.description, "debit": _d(l.debit), "credit": _d(l.credit)} for l in tersimpan]
        isu: List[Dict[str, str]] = []
        if t.source == "legacy" and t.status not in ("posted", "reversed"):
            if len(baris) < 2:
                isu.append({"code": "few_lines", "level": "error", "message": "A journal needs at least two lines."})
    else:
        baris, isu = _susun(t.type_key, t.subtype, _header(t), akun)
    d = sum((b["debit"] for b in baris), NOL)
    k = sum((b["credit"] for b in baris), NOL)
    if baris and d != k:
        isu.append({"code": "unbalanced", "level": "error", "message": f"Not balanced: debit {d:,.2f} vs credit {k:,.2f}."})
    if t.status not in ("posted", "reversed"):
        isu += _cek_akun(baris, akun)
        if kunci_tgl and t.journal_date <= kunci_tgl:
            isu.append({"code": "period_locked", "level": "error",
                        "message": f"Transaction date falls in a closed period (books closed through {kunci_tgl:%d %b %Y})."})
        if t.due_date and t.due_date < t.journal_date:
            isu.append({"code": "due_before_date", "level": "warning", "message": "The due date is earlier than the transaction date."})
        if not _teks(t.counterparty):
            isu.append({"code": "missing_party", "level": "warning", "message": f"{JENIS[t.type_key].party} is empty."})
        if t.status == "pending_review" and t.submitted_at:
            hari = (date.today() - t.submitted_at.date()).days
            if hari > 3:
                isu.append({"code": "review_overdue", "level": "warning", "message": f"Waiting for review for {hari} days."})
    return baris, _unik(isu)


def _baris_dict(b: Dict[str, Any]) -> Dict[str, Any]:
    return {**b, "debit": _f(b["debit"]), "credit": _f(b["credit"])}


def _tx_dict(t: Any, baris: List[Dict[str, Any]], isu: List[Dict[str, str]], tpl: Dict[str, Any], akun: Dict[str, Any],
             n_lampiran: int = 0) -> Dict[str, Any]:
    j = JENIS[t.type_key]
    s = j.sub.get(t.subtype)
    kurs = _d(t.exchange_rate) or Decimal("1")
    template = tpl.get(t.template_id)
    return {
        "id": t.id, "journal_no": t.journal_no, "journal_date": t.journal_date, "type_key": t.type_key, "type_name": j.name,
        "subtype": t.subtype, "subtype_label": s.label if s else t.subtype,
        "template_id": t.template_id, "template_name": template.name if template is not None else j.name,
        "counterparty": t.counterparty, "counterparty_code": t.counterparty_code, "reference_no": t.reference_no,
        "description": t.description, "currency": t.currency, "exchange_rate": float(kurs),
        "amount": _f(t.amount), "extra_amount": _f(t.extra_amount), "amount_idr": _f(_uang(_d(t.amount) * kurs)),
        "accounts": {p: _akun_ringkas(akun.get(getattr(t, f"{p}_coa_id"))) for p in PERAN},
        **{f"{p}_coa_id": getattr(t, f"{p}_coa_id") for p in PERAN},
        "branch": t.branch, "department": t.department, "project": t.project, "cost_center": t.cost_center,
        "due_date": t.due_date, "period_start": t.period_start, "period_end": t.period_end, "details": t.details or {},
        "notes": t.notes, "requires_approval": bool(t.requires_approval), "source": t.source,
        "status": t.status, "status_label": LABEL_STATUS.get(t.status, t.status),
        "total_debit": _f(sum((b["debit"] for b in baris), NOL)), "total_credit": _f(sum((b["credit"] for b in baris), NOL)),
        "submitted_at": t.submitted_at, "submitted_by_name": t.submitted_by_name,
        "approved_at": t.approved_at, "approved_by_name": t.approved_by_name,
        "rejected_at": t.rejected_at, "rejected_by_name": t.rejected_by_name, "rejected_reason": t.rejected_reason,
        "posted_at": t.posted_at, "posted_by_name": t.posted_by_name,
        "reversal_date": t.reversal_date, "reversal_reason": t.reversal_reason, "reversed_by_name": t.reversed_by_name,
        "created_at": t.created_at, "created_by_name": t.created_by_name, "edited_at": t.edited_at,
        "lines": [_baris_dict(b) for b in baris], "issues": isu,
        "has_error": any(i["level"] == "error" for i in isu), "attachment_count": n_lampiran,
    }


def _muat(session, kid: str, ids: Optional[List[str]] = None) -> Tuple[List[Any], Dict[str, List[Any]]]:
    q = session.query(TX).filter(TX.client_id == kid, TX.deleted_at.is_(None))
    if ids is not None:
        q = q.filter(TX.id.in_(ids or ["00000000-0000-0000-0000-000000000000"]))
    txs = q.order_by(TX.journal_date.desc(), TX.journal_no.desc()).all()
    baris: Dict[str, List[Any]] = defaultdict(list)
    if txs:
        for l in session.query(TL).filter(TL.journal_id.in_([t.id for t in txs])).order_by(TL.line_no).all():
            baris[l.journal_id].append(l)
    return txs, baris


def _semua(session, kid: str, ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    txs, baris = _muat(session, kid, ids)
    if not txs:
        return []
    akun = _peta_akun(session, kid)
    kunci = _tanggal_kunci(session, kid)
    tpl = {t.id: t for t in session.query(TPL).filter(TPL.client_id == kid).all()}
    lampiran = dict(session.query(ATT.transaction_id, func.count(ATT.id)).filter(ATT.client_id == kid).group_by(ATT.transaction_id).all())
    hasil = []
    for t in txs:
        if t.type_key not in JENIS:
            continue
        b, isu = _evaluasi(t, baris[t.id], akun, kunci)
        hasil.append(_tx_dict(t, b, isu, tpl, akun, lampiran.get(t.id, 0)))
    return hasil


def _detail(session, kid: str, tx_id: str) -> Dict[str, Any]:
    hasil = _semua(session, kid, [tx_id])
    if not hasil:
        raise _Gagal("Transaction not found.", kode="NOT_FOUND", status_code=404)
    d = hasil[0]
    d["attachments"] = [{"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "size_bytes": a.size_bytes,
                         "uploaded_at": a.uploaded_at, "uploaded_by_name": a.uploaded_by_name}
                        for a in session.query(ATT.id, ATT.file_name, ATT.content_type, ATT.size_bytes, ATT.uploaded_at, ATT.uploaded_by_name)
                        .filter(ATT.transaction_id == tx_id).order_by(ATT.uploaded_at).all()]
    d["events"] = [{"action": e.action, "note": e.note, "actor_name": e.actor_name, "created_at": e.created_at}
                   for e in session.query(EV).filter(EV.transaction_id == tx_id).order_by(EV.created_at).all()]
    return d


def _ambil(session, kid: str, tx_id: Any) -> Any:
    t = session.get(TX, str(tx_id))
    if t is None or t.deleted_at is not None or str(t.client_id) != kid:
        raise _Gagal("Transaction not found.", kode="NOT_FOUND", status_code=404)
    return t


# ============================================================
# ENDPOINT -- DATA
# ============================================================

def _saran(session, kid: str) -> Dict[str, List[str]]:
    hasil: Dict[str, List[str]] = {}
    for kolom in ("counterparty", "branch", "department", "project", "cost_center"):
        c = getattr(TX, kolom)
        hasil[kolom] = [v for (v,) in session.query(c).filter(TX.client_id == kid, TX.deleted_at.is_(None), c.isnot(None))
                        .group_by(c).order_by(func.count(TX.id).desc()).limit(50).all()]
    return hasil


@router.get("/meta", summary="Jenis transaksi, template + aturan, akun COA, saran isian, entitas, nomor berikutnya")
def meta(client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _pastikan_template(session, kid)
        akun = sorted(_peta_akun(session, kid).values(), key=lambda a: a.acc_no or "")
        entitas = [{"id": c.id, "name": c.nama} for c in session.query(dbc.Client)
                   .filter(dbc.Client.deleted_at.is_(None)).order_by(dbc.Client.nama).all()]
        return {
            "types": [{"key": k, "code": j.code, "name": j.name, "description": j.description, "party_label": j.party, "roles": j.peran,
                       "subtypes": [{"key": sk, "label": s.label, "roles": _peran_dipakai(s), "extra_label": s.extra_label,
                                     "lines": [{"side": a, "role": b, "portion": c} for a, b, c in s.baris]} for sk, s in j.sub.items()]}
                      for k, j in JENIS.items()],
            "templates": _templates(session, kid),
            "accounts": [bc._akun_dict(a) | {"standard_code": a.standard_account_code} for a in akun],
            "suggestions": _saran(session, kid),
            "entities": entitas,
            "client_name": next((e["name"] for e in entitas if str(e["id"]) == kid), None),
            "next_number": _nomor_berikut(session, kid, date.today()),
            "can_post": _boleh_post(current_user),
        }
    return bc._respon(aksi)


@router.get("/transactions", summary="Semua Other Transactions + jurnal + hasil cek")
def daftar(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return bc._respon(lambda session: _semua(session, kid))


@router.get("/transactions/{tx_id}", summary="Detail 1 transaksi + lampiran + riwayat")
def detail(tx_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return bc._respon(lambda session: _detail(session, kid, str(tx_id)))


@router.get("/overview", summary="Overview: KPI, transaksi terbaru, tren bulanan, ringkasan aturan, kategori teratas, antrean review")
def overview(client_id: UUID = Query(...), months: int = Query(6, ge=3, le=24), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _pastikan_template(session, kid)
        txs = _semua(session, kid)
        aktif = [t for t in txs if t["status"] != "rejected"]
        bulan_ini = _awal(date.today())
        tren = []
        for i in range(months - 1, -1, -1):
            m = _geser(bulan_ini, -i)
            xs = [t for t in aktif if _awal(t["journal_date"]) == m]
            tren.append({"month": m.strftime("%Y-%m"), "count": len(xs), "amount": round(sum(t["amount_idr"] for t in xs), 2)})
        per_jenis: Dict[str, Dict[str, Any]] = {}
        for t in aktif:
            p = per_jenis.setdefault(t["type_key"], {"type_key": t["type_key"], "type_name": t["type_name"], "count": 0, "amount": 0.0})
            p["count"] += 1
            p["amount"] += t["amount_idr"]
        n = sum(p["count"] for p in per_jenis.values()) or 1
        top = sorted(per_jenis.values(), key=lambda p: -p["count"])
        for p in top:
            p["share"] = round(p["count"] * 100 / n, 1)
            p["amount"] = round(p["amount"], 2)
        ts = _templates(session, kid)
        return {
            "kpi": {"total": len(txs), "posted": sum(1 for t in txs if t["status"] == "posted"),
                    "pending_review": sum(1 for t in txs if t["status"] == "pending_review"),
                    "approved": sum(1 for t in txs if t["status"] == "approved"),
                    "draft": sum(1 for t in txs if t["status"] == "draft"),
                    "exceptions": sum(1 for t in txs if t["status"] not in ("posted", "reversed") and t["issues"]),
                    "posted_amount": round(sum(t["amount_idr"] for t in txs if t["status"] == "posted"), 2)},
            "recent": txs[:8],
            "trend": tren,
            "rules": {"active_rules": sum(1 for t in ts if t["is_active"] for r in t["rules"] if r["is_active"]),
                      "templates": sum(1 for t in ts if t["is_active"]),
                      "auto_post": sum(1 for t in ts if t["is_active"] and t["auto_post"]),
                      "requires_approval": sum(1 for t in ts if t["is_active"] and t["requires_approval"]),
                      "incomplete": sum(1 for t in ts if t["is_active"] for r in t["rules"] if r["is_active"] and not r["complete"])},
            "top_categories": top[:5],
            "pending": [t for t in txs if t["status"] == "pending_review"][:5],
            "templates": ts,
        }
    return bc._respon(aksi)


@router.get("/categories", summary="Statistik per jenis transaksi (kategori) + template-nya")
def kategori(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        _pastikan_template(session, kid)
        txs = _semua(session, kid)
        ts = _templates(session, kid)
        hasil = []
        for k, j in JENIS.items():
            xs = [t for t in txs if t["type_key"] == k]
            per_sub = []
            for sk, s in j.sub.items():
                ys = [t for t in xs if t["subtype"] == sk and t["status"] != "rejected"]
                per_sub.append({"subtype": sk, "label": s.label, "count": len(ys), "amount": round(sum(t["amount_idr"] for t in ys), 2)})
            hasil.append({
                "type_key": k, "name": j.name, "description": j.description, "code": j.code,
                "count": len(xs), "posted": sum(1 for t in xs if t["status"] == "posted"),
                "in_progress": sum(1 for t in xs if t["status"] in ("draft", "pending_review", "approved", "rejected")),
                "posted_amount": round(sum(t["amount_idr"] for t in xs if t["status"] == "posted"), 2),
                "last_date": max((t["journal_date"] for t in xs), default=None),
                "subtypes": per_sub, "templates": [t for t in ts if t["type_key"] == k],
            })
        return hasil
    return bc._respon(aksi)


# ============================================================
# ENDPOINT -- TEMPLATE
# ============================================================

class AturanIn(BaseModel):
    subtype: str = Field(..., max_length=40)
    is_active: bool = True
    main_coa_id: Optional[UUID] = None
    bank_coa_id: Optional[UUID] = None
    offset_coa_id: Optional[UUID] = None
    extra_coa_id: Optional[UUID] = None


class TemplateRequest(BaseModel):
    client_id: UUID
    type_key: Optional[str] = Field(None, max_length=40)     # wajib saat membuat template baru
    code: Optional[str] = Field(None, max_length=40)
    name: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = Field(None, max_length=2000)
    requires_approval: bool = True
    auto_post: bool = False
    is_active: bool = True
    rules: List[AturanIn] = Field(default_factory=list, max_length=20)


def _isi_template(session, kid: str, t: Any, p: TemplateRequest, user: Dict[str, Any]) -> None:
    j = JENIS[t.type_key]
    akun = _peta_akun(session, kid)
    t.name, t.description = p.name.strip(), _teks(p.description)
    t.requires_approval, t.auto_post, t.is_active = p.requires_approval, p.auto_post, p.is_active
    t.edited_at, t.edited_by = _sekarang(), user.get("id")
    ada = {r.subtype: r for r in session.query(RUL).filter(RUL.template_id == t.id).all()}
    for a in p.rules:
        s = j.sub.get(a.subtype)
        if s is None:
            raise _Gagal(f"Unknown subtype {a.subtype} for {j.name}.")
        r = ada.get(a.subtype)
        if r is None:
            r = RUL(client_id=kid, template_id=t.id, subtype=a.subtype)
            session.add(r)
        dipakai = _peran_dipakai(s)
        for peran in PERAN:
            nilai = getattr(a, f"{peran}_coa_id")
            if nilai is not None and str(nilai) not in akun:
                raise _Gagal(f"{s.label}: {j.peran.get(peran, peran)} is not in this client's chart of accounts.")
            setattr(r, f"{peran}_coa_id", str(nilai) if nilai is not None and peran in dipakai else None)
        r.is_active, r.edited_at, r.edited_by = a.is_active, _sekarang(), user.get("id")
    for sk in j.sub:
        if sk not in ada and sk not in {a.subtype for a in p.rules}:
            session.add(RUL(client_id=kid, template_id=t.id, subtype=sk, is_active=True))


@router.get("/templates", summary="Template transaksi + aturan jurnal")
def daftar_template(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        _pastikan_template(session, kid)
        return _templates(session, kid)
    return bc._respon(aksi)


@router.post("/templates", summary="Template baru berbasis salah satu jenis (Supervisor+)")
def buat_template(payload: TemplateRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        _jenis(payload.type_key or "")
        kode = (_teks(payload.code) or f"{JENIS[payload.type_key].code}-{session.query(func.count(TPL.id)).filter(TPL.client_id == kid).scalar() + 1}").upper()
        if session.query(TPL.id).filter(TPL.client_id == kid, func.upper(TPL.code) == kode).first() is not None:
            raise _Gagal(f"Template code {kode} is already used.", kode="CONFLICT", status_code=409)
        urut = (session.query(func.max(TPL.sort_order)).filter(TPL.client_id == kid).scalar() or 0) + 1
        t = TPL(client_id=kid, type_key=payload.type_key, code=kode, name=payload.name.strip(), is_system=False, sort_order=urut,
                created_by=current_user.get("id"))
        session.add(t)
        session.flush()
        _isi_template(session, kid, t, payload, current_user)
        session.flush()
        return next(x for x in _templates(session, kid) if x["id"] == t.id)
    return bc._respon(aksi, "Template created.")


@router.put("/templates/{template_id}", summary="Ubah template + aturan jurnal (Supervisor+)")
def ubah_template(template_id: UUID, payload: TemplateRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        t = session.get(TPL, str(template_id))
        if t is None or t.deleted_at is not None or str(t.client_id) != kid:
            raise _Gagal("Template not found.", kode="NOT_FOUND", status_code=404)
        _isi_template(session, kid, t, payload, current_user)
        session.flush()
        return next(x for x in _templates(session, kid) if x["id"] == t.id)
    return bc._respon(aksi, "Template saved.")


@router.delete("/templates/{template_id}", summary="Hapus template buatan sendiri (Supervisor+)")
def hapus_template(template_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        t = session.get(TPL, str(template_id))
        if t is None or t.deleted_at is not None or str(t.client_id) != kid:
            raise _Gagal("Template not found.", kode="NOT_FOUND", status_code=404)
        if t.is_system:
            raise _Gagal("Built-in templates cannot be deleted. Deactivate it instead.", kode="CONFLICT", status_code=409)
        t.deleted_at, t.is_active = _sekarang(), False
        return {"id": t.id}
    return bc._respon(aksi, "Template deleted.")


# ============================================================
# ENDPOINT -- TULIS TRANSAKSI
# ============================================================

class TransaksiRequest(BaseModel):
    client_id: UUID
    template_id: Optional[UUID] = None
    type_key: str = Field(..., max_length=40)
    subtype: str = Field(..., max_length=40)
    journal_no: Optional[str] = Field(None, max_length=40)
    journal_date: date
    counterparty: Optional[str] = Field(None, max_length=255)
    counterparty_code: Optional[str] = Field(None, max_length=100)
    reference_no: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    currency: str = Field("IDR", min_length=3, max_length=3)
    exchange_rate: float = Field(1, gt=0)
    amount: float = Field(0, ge=0)
    extra_amount: float = Field(0, ge=0)
    main_coa_id: Optional[UUID] = None
    bank_coa_id: Optional[UUID] = None
    offset_coa_id: Optional[UUID] = None
    extra_coa_id: Optional[UUID] = None
    branch: Optional[str] = Field(None, max_length=150)
    department: Optional[str] = Field(None, max_length=150)
    project: Optional[str] = Field(None, max_length=150)
    cost_center: Optional[str] = Field(None, max_length=150)
    due_date: Optional[date] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = Field(None, max_length=2000)
    requires_approval: Optional[bool] = None
    # draft = simpan saja; submit = simpan lalu ajukan (pending_review / approved)
    action: Literal["draft", "submit"] = "draft"


def _template_untuk(session, kid: str, p: TransaksiRequest) -> Any:
    if p.template_id:
        t = session.get(TPL, str(p.template_id))
        if t is None or t.deleted_at is not None or str(t.client_id) != kid:
            raise _Gagal("Template not found.", kode="NOT_FOUND", status_code=404)
        if t.type_key != p.type_key:
            raise _Gagal("The template does not match the transaction type.")
        return t
    _pastikan_template(session, kid)
    return session.query(TPL).filter(TPL.client_id == kid, TPL.type_key == p.type_key, TPL.is_system.is_(True),
                                     TPL.deleted_at.is_(None)).first()


def _simpan(session, kid: str, p: TransaksiRequest, user: Dict[str, Any], t: Any = None) -> Any:
    _sub(p.type_key, p.subtype)
    tpl = _template_untuk(session, kid, p)
    if t is None and tpl is not None and not tpl.is_active:
        raise _Gagal(f"Template {tpl.name} is inactive.")
    akun = _peta_akun(session, kid)
    for peran in PERAN:
        v = getattr(p, f"{peran}_coa_id")
        if v is not None and str(v) not in akun:
            raise _Gagal(f"{JENIS[p.type_key].peran.get(peran, peran)} is not in this client's chart of accounts.")
    pakai_extra = _sub(p.type_key, p.subtype).extra_label is not None
    if pakai_extra and p.extra_amount > p.amount:
        raise _Gagal(f"{_sub(p.type_key, p.subtype).extra_label} cannot exceed the total amount.")
    if p.period_start and p.period_end and p.period_end < p.period_start:
        raise _Gagal("The period end date cannot be earlier than the start date.")
    nomor = (_teks(p.journal_no) or (t.journal_no if t is not None else None) or _nomor_berikut(session, kid, p.journal_date)).upper()
    lain = session.query(TX.id).filter(TX.client_id == kid, TX.journal_no == nomor)
    if t is not None:
        lain = lain.filter(TX.id != t.id)
    if lain.first() is not None:
        raise _Gagal(f"Transaction number {nomor} is already used.", kode="CONFLICT", status_code=409)
    perlu = p.requires_approval if p.requires_approval is not None else (bool(tpl.requires_approval) if tpl is not None else True)
    nilai = dict(
        template_id=tpl.id if tpl is not None else None, type_key=p.type_key, subtype=p.subtype, journal_no=nomor,
        journal_date=p.journal_date, counterparty=_teks(p.counterparty), counterparty_code=_teks(p.counterparty_code),
        reference_no=_teks(p.reference_no), description=_teks(p.description), currency=p.currency.upper(),
        exchange_rate=Decimal(str(p.exchange_rate)) if p.currency.upper() != "IDR" else Decimal("1"),
        amount=_d(p.amount), extra_amount=_d(p.extra_amount) if pakai_extra else NOL,
        branch=_teks(p.branch), department=_teks(p.department), project=_teks(p.project), cost_center=_teks(p.cost_center),
        due_date=p.due_date, period_start=p.period_start, period_end=p.period_end,
        details={k: v for k, v in (p.details or {}).items() if v not in (None, "")}, notes=_teks(p.notes), requires_approval=perlu,
        **{f"{peran}_coa_id": (str(getattr(p, f"{peran}_coa_id")) if getattr(p, f"{peran}_coa_id") else None) for peran in PERAN},
    )
    if t is None:
        t = TX(client_id=kid, status="draft", source="manual", created_by=user.get("id"), created_by_name=_nama(user), **nilai)
        session.add(t)
        session.flush()
        _catat(session, t.id, "created", user)
    else:
        if t.source == "legacy":
            raise _Gagal(f"{t.journal_no} was migrated from the old Other journal and cannot be edited. Reverse or delete it instead.",
                         kode="CONFLICT", status_code=409)
        if t.status in ("posted", "reversed"):
            raise _Gagal(f"{t.journal_no} is {t.status} and can no longer be edited.", kode="CONFLICT", status_code=409)
        for k, v in nilai.items():
            setattr(t, k, v)
        # Mengubah transaksi yang sudah diajukan / disetujui / ditolak mengembalikannya ke draft.
        t.status, t.submitted_at, t.submitted_by, t.submitted_by_name = "draft", None, None, None
        t.approved_at, t.approved_by, t.approved_by_name = None, None, None
        t.rejected_at, t.rejected_by_name, t.rejected_reason = None, None, None
        t.edited_at, t.edited_by = _sekarang(), user.get("id")
        _catat(session, t.id, "edited", user)
    _tulis_baris(session, t, akun)
    session.flush()
    return t


def _tulis_baris(session, t: Any, akun: Dict[str, Any]) -> List[Dict[str, str]]:
    """Tulis ulang baris jurnal dari aturan; kembalikan isu penyusunan."""
    baris, isu = _susun(t.type_key, t.subtype, _header(t), akun)
    session.query(TL).filter(TL.journal_id == t.id).delete(synchronize_session=False)
    for i, b in enumerate(baris, start=1):
        session.add(TL(journal_id=t.id, line_no=i, **b))
    t.total_debit = sum((b["debit"] for b in baris), NOL)
    t.total_credit = sum((b["credit"] for b in baris), NOL)
    return isu


def _error_tx(session, kid: str, t: Any, akun: Dict[str, Any], kunci: Optional[date]) -> List[str]:
    baris = session.query(TL).filter(TL.journal_id == t.id).order_by(TL.line_no).all()
    _, isu = _evaluasi(t, baris, akun, kunci)
    return [i["message"] for i in isu if i["level"] == "error"]


def _ke_approved(session, kid: str, t: Any, user: Dict[str, Any], tpl: Dict[str, Any], waktu) -> Optional[str]:
    t.status, t.approved_at, t.approved_by, t.approved_by_name = "approved", waktu, user.get("id"), _nama(user)
    t.rejected_at, t.rejected_by_name, t.rejected_reason = None, None, None
    template = tpl.get(t.template_id)
    if template is not None and template.auto_post and _boleh_post(user):
        return _ke_posted(session, kid, t, user, waktu)
    return None


def _ke_posted(session, kid: str, t: Any, user: Dict[str, Any], waktu) -> Optional[str]:
    """Post 1 transaksi (savepoint). Return pesan gagal kunci periode, None kalau berhasil."""
    try:
        with session.begin_nested():
            if t.source != "legacy":
                _tulis_baris(session, t, _peta_akun(session, kid))
            t.status, t.posted_at, t.posted_by, t.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
            if not t.approved_at:
                t.approved_at, t.approved_by, t.approved_by_name = waktu, user.get("id"), _nama(user)
            session.flush()
        _catat(session, t.id, "posted", user)
        return None
    except Exception as e:
        pesan = dbc.pesan_periode_terkunci(e)
        if not pesan:
            raise
        return pesan


def _ajukan(session, kid: str, t: Any, user: Dict[str, Any]) -> Optional[str]:
    """Submit for Review. Return alasan gagal (None = berhasil)."""
    if t.status not in ("draft", "rejected"):
        return f"Status is {LABEL_STATUS.get(t.status, t.status)}."
    err = _error_tx(session, kid, t, _peta_akun(session, kid), _tanggal_kunci(session, kid))
    if err:
        return err[0]
    waktu = _sekarang()
    t.submitted_at, t.submitted_by, t.submitted_by_name = waktu, user.get("id"), _nama(user)
    t.rejected_at, t.rejected_by_name, t.rejected_reason = None, None, None
    _catat(session, t.id, "submitted", user)
    if t.requires_approval:
        t.status = "pending_review"
        return None
    tpl = {x.id: x for x in session.query(TPL).filter(TPL.client_id == kid).all()}
    _catat(session, t.id, "approved", user, "No approval required")
    # Auto-post yang ditolak kunci periode tidak menggagalkan submit: tetap approved.
    if _ke_approved(session, kid, t, user, tpl, waktu):
        t.status = "approved"
    return None


def _pesan_simpan(t: Any, gagal_ajukan: Optional[str], action: str) -> str:
    if action == "draft":
        return f"{t.journal_no} saved as draft."
    if gagal_ajukan:
        return f"{t.journal_no} saved as draft, but could not be submitted: {gagal_ajukan}"
    return {"pending_review": f"{t.journal_no} submitted for review.", "approved": f"{t.journal_no} approved and ready to post.",
            "posted": f"{t.journal_no} posted to the General Ledger."}.get(t.status, f"{t.journal_no} saved.")


@router.post("/preview", summary="Hitung jurnal + hasil cek TANPA menyimpan (Journal Preview di form)")
def preview(payload: TransaksiRequest, _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(payload.client_id)

    def aksi(session):
        akun = _peta_akun(session, kid)
        h = payload.model_dump()
        baris, isu = _susun(payload.type_key, payload.subtype, h, akun)
        isu += _cek_akun(baris, akun)
        kunci = _tanggal_kunci(session, kid)
        if kunci and payload.journal_date <= kunci:
            isu.append({"code": "period_locked", "level": "error",
                        "message": f"Transaction date falls in a closed period (books closed through {kunci:%d %b %Y})."})
        d = sum((b["debit"] for b in baris), NOL)
        k = sum((b["credit"] for b in baris), NOL)
        isu = _unik(isu)
        return {"lines": [_baris_dict(b) for b in baris], "total_debit": _f(d), "total_credit": _f(k),
                "balanced": bool(baris) and d == k, "issues": isu, "has_error": any(i["level"] == "error" for i in isu)}
    return bc._respon(aksi)


@router.post("/transactions", summary="Transaksi baru: Save Draft / Submit for Review (Supervisor+)")
def buat(payload: TransaksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    pesan: Dict[str, str] = {}

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        t = _simpan(session, kid, payload, current_user)
        g = _ajukan(session, kid, t, current_user) if payload.action == "submit" else None
        pesan["m"] = _pesan_simpan(t, g, payload.action)
        session.flush()
        return _detail(session, kid, t.id)
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=pesan["m"])


@router.put("/transactions/{tx_id}", summary="Ubah transaksi yang belum diposting (kembali ke draft; Supervisor+)")
def ubah(tx_id: UUID, payload: TransaksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)
    pesan: Dict[str, str] = {}

    def aksi(session):
        _kunci(session, kid)
        t = _ambil(session, kid, tx_id)
        _simpan(session, kid, payload, current_user, t)
        g = _ajukan(session, kid, t, current_user) if payload.action == "submit" else None
        pesan["m"] = _pesan_simpan(t, g, payload.action)
        session.flush()
        return _detail(session, kid, t.id)
    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    return sukses(data=data, message=pesan["m"])


@router.delete("/transactions/{tx_id}", summary="Hapus transaksi yang belum diposting (Supervisor+)")
def hapus(tx_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        t = _ambil(session, kid, tx_id)
        if t.status in ("posted", "reversed"):
            raise _Gagal("Posted transactions cannot be deleted. Reverse it instead.", kode="CONFLICT", status_code=409)
        t.deleted_at, t.deleted_by = _sekarang(), current_user.get("id")
        _catat(session, t.id, "deleted", current_user)
        return {"id": t.id}
    return bc._respon(aksi, "Transaction deleted.")


class AksiRequest(BaseModel):
    client_id: UUID
    ids: List[UUID] = Field(..., min_length=1, max_length=500)
    reason: Optional[str] = Field(None, max_length=2000)


def _aksi_massal(payload: AksiRequest, user: Dict[str, Any], ke: str, label: str):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        ids = list(dict.fromkeys(str(x) for x in payload.ids))
        txs, _ = _muat(session, kid, ids)
        akun = _peta_akun(session, kid)
        kunci = _tanggal_kunci(session, kid)
        tpl = {x.id: x for x in session.query(TPL).filter(TPL.client_id == kid).all()}
        selesai, gagal_ = [], []

        def tolak(t: Any, alasan: str) -> None:
            gagal_.append({"id": t.id, "journal_no": t.journal_no, "reason": alasan})

        for t in txs:
            waktu = _sekarang()
            status_awal = LABEL_STATUS.get(t.status, t.status)
            if ke == "submit":
                alasan = _ajukan(session, kid, t, user)
                if alasan:
                    tolak(t, alasan)
                    continue
            elif ke == "approve":
                if t.status != "pending_review":
                    tolak(t, f"Status is {status_awal}.")
                    continue
                err = _error_tx(session, kid, t, akun, kunci)
                if err:
                    tolak(t, err[0])
                    continue
                _catat(session, t.id, "approved", user, payload.reason)
                alasan = _ke_approved(session, kid, t, user, tpl, waktu)
                if alasan:
                    # Disetujui, tapi auto-post ditolak kunci periode: tetap approved.
                    t.status = "approved"
            elif ke == "reject":
                if t.status not in ("pending_review", "approved"):
                    tolak(t, f"Status is {status_awal}.")
                    continue
                t.status, t.rejected_at, t.rejected_by_name = "rejected", waktu, _nama(user)
                t.rejected_reason = _teks(payload.reason) or "Rejected"
                t.approved_at, t.approved_by, t.approved_by_name = None, None, None
                _catat(session, t.id, "rejected", user, t.rejected_reason)
            elif ke == "draft":
                if t.status not in ("pending_review", "approved", "rejected"):
                    tolak(t, f"Status is {status_awal}.")
                    continue
                t.status, t.submitted_at, t.submitted_by, t.submitted_by_name = "draft", None, None, None
                t.approved_at, t.approved_by, t.approved_by_name = None, None, None
                _catat(session, t.id, "returned_to_draft", user, payload.reason)
            elif ke == "post":
                if t.status != "approved":
                    tolak(t, f"Status is {status_awal}; only approved transactions can be posted.")
                    continue
                err = _error_tx(session, kid, t, akun, kunci)
                if err:
                    tolak(t, err[0])
                    continue
                alasan = _ke_posted(session, kid, t, user, waktu)
                if alasan:
                    tolak(t, alasan)
                    continue
            t.edited_at, t.edited_by = waktu, user.get("id")
            selesai.append(t.journal_no)
        gagal_ += [{"id": i, "reason": "Not found."} for i in set(ids) - {t.id for t in txs}]
        session.flush()
        return {"done": selesai, "failed": gagal_}

    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    pesan = f"{len(data['done'])} transaction(s) {label}."
    if data["failed"]:
        pesan += f" {len(data['failed'])} skipped: " + "; ".join(f"{f.get('journal_no', f['id'])}: {f['reason']}" for f in data["failed"][:5])
    if not data["done"] and data["failed"]:
        return gagal(message=pesan, errors={"code": "NOTHING_DONE", "detail": data["failed"]}, status_code=422)
    return sukses(data=data, message=pesan)


@router.post("/transactions/submit", summary="Submit for Review (Supervisor+)")
def ajukan(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_massal(payload, current_user, "submit", "submitted")


@router.post("/transactions/approve", summary="Setujui transaksi Under Review (Supervisor+)")
def setujui(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_massal(payload, current_user, "approve", "approved")


@router.post("/transactions/reject", summary="Tolak transaksi Under Review / Approved (Supervisor+)")
def tolak_tx(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_massal(payload, current_user, "reject", "rejected")


@router.post("/transactions/return-to-draft", summary="Kembalikan ke draft (Supervisor+)")
def kembali_draft(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi_massal(payload, current_user, "draft", "returned to draft")


@router.post("/transactions/post", summary="Post transaksi approved ke buku besar (Manager+)")
def posting(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi_massal(payload, current_user, "post", "posted")


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/transactions/{tx_id}/reverse", summary="Balik transaksi posted: pembalik RV- di reversal_date (Manager+)")
def balik(tx_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        t = _ambil(session, kid, tx_id)
        if t.status != "posted":
            raise _Gagal(f"Only posted transactions can be reversed ({t.journal_no} is {LABEL_STATUS.get(t.status, t.status)}).",
                         kode="CONFLICT", status_code=409)
        tgl = payload.reversal_date or date.today()
        if tgl < t.journal_date:
            raise _Gagal("The reversal date cannot be earlier than the transaction date.")
        t.status, t.reversal_date, t.reversal_reason = "reversed", tgl, payload.reason.strip()
        t.reversed_at, t.reversed_by, t.reversed_by_name = _sekarang(), current_user.get("id"), _nama(current_user)
        session.flush()
        _catat(session, t.id, "reversed", current_user, payload.reason)
        return _detail(session, kid, t.id)
    return bc._respon(aksi, "Transaction reversed.")


# ============================================================
# ENDPOINT -- LAMPIRAN
# ============================================================

@router.post("/transactions/{tx_id}/attachments", summary="Upload dokumen pendukung PDF/JPG/PNG maks 10 MB per file (Supervisor+)")
async def upload_lampiran(tx_id: UUID, client_id: str = Form(...), files: List[UploadFile] = File(...),
                          current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    try:
        kid = str(UUID(client_id))
    except ValueError:
        return bc._respon_gagal(_Gagal("client_id must be a valid UUID."))
    isi: List[Tuple[str, Optional[str], bytes]] = []
    for f in files:
        data = await f.read()
        nama = (f.filename or "document").strip()[:255]
        if not data:
            return bc._respon_gagal(_Gagal(f"{nama} is empty."))
        if len(data) > MAKS_LAMPIRAN:
            return bc._respon_gagal(_Gagal(f"{nama} is larger than 10 MB."))
        if not re.search(r"\.(pdf|jpe?g|png)$", nama, re.I):
            return bc._respon_gagal(_Gagal(f"{nama}: only PDF, JPG and PNG files are supported."))
        isi.append((nama, f.content_type, data))

    def aksi(session):
        t = _ambil(session, kid, tx_id)
        for nama, jenis, data in isi:
            session.add(ATT(client_id=kid, transaction_id=t.id, file_name=nama, content_type=jenis, size_bytes=len(data), content=data,
                            uploaded_by=current_user.get("id"), uploaded_by_name=_nama(current_user)))
        _catat(session, t.id, "attachment_added", current_user, ", ".join(n for n, _, _ in isi))
        session.flush()
        return _detail(session, kid, t.id)
    return bc._respon(aksi, f"{len(isi)} file(s) uploaded.")


@router.get("/attachments/{attachment_id}", summary="Unduh 1 dokumen pendukung")
def unduh_lampiran(attachment_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        a = session.get(ATT, str(attachment_id))
        if a is None or str(a.client_id) != str(client_id):
            return gagal(message="Attachment not found.", errors={"code": "NOT_FOUND"}, status_code=404)
        nama = re.sub(r'[\r\n"]', "", a.file_name)
        return Response(content=bytes(a.content), media_type=a.content_type or "application/octet-stream",
                        headers={"Content-Disposition": f'inline; filename="{nama}"'})
    finally:
        session.close()


@router.delete("/attachments/{attachment_id}", summary="Hapus dokumen pendukung (transaksi belum diposting, Supervisor+)")
def hapus_lampiran(attachment_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        a = session.get(ATT, str(attachment_id))
        if a is None or str(a.client_id) != kid:
            raise _Gagal("Attachment not found.", kode="NOT_FOUND", status_code=404)
        t = _ambil(session, kid, a.transaction_id)
        if t.status in ("posted", "reversed"):
            raise _Gagal("Documents of a posted transaction cannot be removed.", kode="CONFLICT", status_code=409)
        _catat(session, t.id, "attachment_removed", current_user, a.file_name)
        session.delete(a)
        session.flush()
        return _detail(session, kid, t.id)
    return bc._respon(aksi, "Attachment removed.")


# ============================================================
# ENDPOINT -- IMPORT
# ============================================================

class BarisImport(BaseModel):
    row: int
    type_key: str
    subtype: Optional[str] = None
    journal_date: Optional[date] = None
    reference_no: Optional[str] = Field(None, max_length=100)
    counterparty: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    amount: float = Field(0, ge=0)
    extra_amount: float = Field(0, ge=0)
    main_account: Optional[str] = Field(None, max_length=50)
    bank_account: Optional[str] = Field(None, max_length=50)
    offset_account: Optional[str] = Field(None, max_length=50)
    extra_account: Optional[str] = Field(None, max_length=50)
    branch: Optional[str] = Field(None, max_length=150)
    department: Optional[str] = Field(None, max_length=150)
    project: Optional[str] = Field(None, max_length=150)
    cost_center: Optional[str] = Field(None, max_length=150)
    due_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)


class ImportRequest(BaseModel):
    client_id: UUID
    rows: List[BarisImport] = Field(..., min_length=1, max_length=1000)


@router.post("/import", summary="Import baris (CSV/Excel diparse di browser) -> transaksi DRAFT; akun kosong = akun aturan template")
def impor(payload: ImportRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        _pastikan_template(session, kid)
        per_kode = {a.acc_no: a for a in _peta_akun(session, kid).values()}
        tpl = {t.type_key: t for t in session.query(TPL).filter(TPL.client_id == kid, TPL.is_system.is_(True), TPL.deleted_at.is_(None)).all()}
        aturan = {(r.template_id, r.subtype): r for r in session.query(RUL).filter(RUL.client_id == kid).all()}
        dibuat, gagal_ = [], []
        for b in payload.rows:
            try:
                with session.begin_nested():
                    j = JENIS.get(b.type_key)
                    if j is None:
                        raise _Gagal(f"Unknown transaction type '{b.type_key}'.")
                    sk = b.subtype or next(iter(j.sub))
                    if sk not in j.sub:
                        raise _Gagal(f"Unknown subtype '{sk}' for {j.name}.")
                    if not b.journal_date:
                        raise _Gagal("Date is required.")
                    t = tpl.get(b.type_key)
                    r = aturan.get((t.id, sk)) if t is not None else None
                    coa: Dict[str, Optional[str]] = {}
                    for peran in PERAN:
                        kode = _teks(getattr(b, f"{peran}_account"))
                        if kode:
                            a = per_kode.get(kode)
                            if a is None:
                                raise _Gagal(f"Account {kode} is not in the chart of accounts.")
                            coa[f"{peran}_coa_id"] = a.id
                        else:
                            coa[f"{peran}_coa_id"] = getattr(r, f"{peran}_coa_id") if r is not None else None
                    p = TransaksiRequest(client_id=payload.client_id, template_id=t.id if t is not None else None, type_key=b.type_key,
                                         subtype=sk, journal_date=b.journal_date, counterparty=b.counterparty, reference_no=b.reference_no,
                                         description=b.description, amount=b.amount, extra_amount=b.extra_amount, branch=b.branch,
                                         department=b.department, project=b.project, cost_center=b.cost_center, due_date=b.due_date,
                                         notes=b.notes, **coa)
                    x = _simpan(session, kid, p, current_user)
                    x.source = "import"
                    session.flush()
                dibuat.append(x.journal_no)
            except _Gagal as e:
                gagal_.append({"row": b.row, "reason": e.message})
            except ValueError as e:   # validasi pydantic TransaksiRequest
                gagal_.append({"row": b.row, "reason": str(e).splitlines()[-1]})
        return {"created": dibuat, "failed": gagal_}

    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    pesan = f"{len(data['created'])} transaction(s) imported as draft."
    if data["failed"]:
        pesan += f" {len(data['failed'])} row(s) skipped."
    if not data["created"]:
        return gagal(message=pesan, errors={"code": "NOTHING_DONE", "detail": data["failed"]}, status_code=422)
    return sukses(data=data, message=pesan)
