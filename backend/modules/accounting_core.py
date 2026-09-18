"""
Accounting Core untuk Gouf Accounting.

Tujuan modul ini adalah menambahkan ledger resmi bertipe header/detail TANPA
menghapus tabel legacy ``jurnal_posting``. Tabel legacy tetap menjadi review /
compatibility queue; ``journal_entries`` + ``journal_lines`` menjadi struktur
accounting resmi yang dapat menampung jurnal 2, 3, atau lebih banyak baris.

Prinsip utama:
    Source Transaction -> Journal Entry -> Journal Lines -> General Ledger

Hanya JournalEntry berstatus POSTED yang boleh dipakai laporan Actual.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

import db_client as dbc

MONEY_QUANT = Decimal("0.01")

LEGACY_STATUS_TO_CORE = {
    "draft": "DRAFT",
    "terposting": "POSTED",
    "ditolak": "REJECTED",
}
CORE_STATUS_VALID = {"DRAFT", "REVIEW", "APPROVED", "POSTED", "REVERSED", "REJECTED"}

# Taxonomy awal bersifat universal/broad. Client tetap memiliki nomor/nama
# akun sendiri; mapping ke kode ini dilakukan lewat CoaStandardMapping.
DEFAULT_STANDARD_ACCOUNTS = [
    ("STD.ASSET.CASH", "Cash and Cash Equivalents", "ASET", "Kas & Bank", "DEBET", "BALANCE_SHEET", "Current Assets", "Cash and Cash Equivalents"),
    ("STD.ASSET.AR", "Trade Accounts Receivable", "ASET", "Piutang", "DEBET", "BALANCE_SHEET", "Current Assets", "Trade Receivables"),
    ("STD.ASSET.INVENTORY", "Inventory", "ASET", "Persediaan", "DEBET", "BALANCE_SHEET", "Current Assets", "Inventories"),
    ("STD.ASSET.PREPAID", "Prepaid Expenses", "ASET", "Biaya Dibayar Dimuka", "DEBET", "BALANCE_SHEET", "Current Assets", "Prepayments"),
    ("STD.ASSET.FIXED", "Property Plant and Equipment", "ASET", "Aset Tetap", "DEBET", "BALANCE_SHEET", "Non-current Assets", "Property Plant and Equipment"),
    ("STD.ASSET.ACCUM_DEP", "Accumulated Depreciation", "ASET", "Akumulasi Penyusutan", "KREDIT", "BALANCE_SHEET", "Non-current Assets", "Accumulated Depreciation"),
    ("STD.ASSET.TAX_PREPAID", "Prepaid Taxes", "ASET", "Pajak Dibayar Dimuka", "DEBET", "BALANCE_SHEET", "Current Assets", "Prepaid Taxes"),
    ("STD.ASSET.VAT_INPUT", "Input VAT", "ASET", "PPN Masukan", "DEBET", "BALANCE_SHEET", "Current Assets", "Recoverable Taxes"),
    ("STD.LIABILITY.AP", "Trade Accounts Payable", "LIABILITAS", "Hutang Usaha", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Trade Payables"),
    ("STD.LIABILITY.VAT_OUTPUT", "Output VAT Payable", "LIABILITAS", "Pajak", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Taxes Payable"),
    ("STD.LIABILITY.WHT", "Withholding Tax Payable", "LIABILITAS", "Pajak", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Taxes Payable"),
    ("STD.LIABILITY.ACCRUED", "Accrued Expenses", "LIABILITAS", "Akrual", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Accrued Expenses"),
    ("STD.EQUITY.CAPITAL", "Paid-in Capital", "EKUITAS", "Modal", "KREDIT", "BALANCE_SHEET", "Equity", "Paid-in Capital"),
    ("STD.EQUITY.RETAINED", "Retained Earnings", "EKUITAS", "Saldo Laba", "KREDIT", "BALANCE_SHEET", "Equity", "Retained Earnings"),
    ("STD.REVENUE.PRODUCT", "Product Revenue", "PENDAPATAN", "Pendapatan Produk", "KREDIT", "PROFIT_LOSS", "Revenue", "Product Revenue"),
    ("STD.REVENUE.SERVICE", "Service Revenue", "PENDAPATAN", "Pendapatan Jasa", "KREDIT", "PROFIT_LOSS", "Revenue", "Service Revenue"),
    ("STD.EXPENSE.COGS", "Cost of Goods Sold", "BEBAN", "HPP", "DEBET", "PROFIT_LOSS", "Cost of Revenue", "Cost of Goods Sold"),
    ("STD.EXPENSE.PAYROLL", "Payroll Expense", "BEBAN", "Beban Gaji", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Payroll"),
    ("STD.EXPENSE.RENT", "Rent Expense", "BEBAN", "Beban Sewa", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Rent"),
    ("STD.EXPENSE.SOFTWARE", "Software and Subscription Expense", "BEBAN", "Beban Software", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Software and Subscriptions"),
    ("STD.EXPENSE.DEP", "Depreciation Expense", "BEBAN", "Penyusutan", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Depreciation"),
    ("STD.OTHER.FX_GAIN", "Foreign Exchange Gain", "PENDAPATAN", "Pendapatan Lain", "KREDIT", "PROFIT_LOSS", "Other Income", "Foreign Exchange Gain"),
    ("STD.OTHER.FX_LOSS", "Foreign Exchange Loss", "BEBAN", "Beban Lain", "DEBET", "PROFIT_LOSS", "Other Expenses", "Foreign Exchange Loss"),
]

DEFAULT_ACCOUNT_ROLES = [
    ("CASH_DEFAULT", "Default Cash Account", "Default akun kas"),
    ("BANK_DEFAULT", "Default Bank Account", "Default akun bank"),
    ("AR_CONTROL", "Accounts Receivable Control", "Control account piutang usaha"),
    ("AP_CONTROL", "Accounts Payable Control", "Control account hutang usaha"),
    ("INPUT_VAT", "Input VAT", "PPN Masukan"),
    ("OUTPUT_VAT", "Output VAT", "PPN Keluaran"),
    ("INVENTORY_CONTROL", "Inventory Control", "Control account persediaan"),
    ("PREPAID_EXPENSE", "Prepaid Expense", "Biaya dibayar dimuka"),
    ("FIXED_ASSET_DEFAULT", "Default Fixed Asset", "Default akun aktiva tetap"),
    ("ACCUM_DEPRECIATION", "Accumulated Depreciation", "Akumulasi penyusutan"),
    ("DEPRECIATION_EXPENSE", "Depreciation Expense", "Beban penyusutan"),
    ("PREPAID_TAX", "Prepaid Tax", "Pajak dibayar dimuka"),
    ("WHT_PAYABLE", "Withholding Tax Payable", "Hutang PPh/withholding"),
    ("RETAINED_EARNINGS", "Retained Earnings", "Saldo laba"),
    ("CURRENT_YEAR_EARNINGS", "Current Year Earnings", "Laba/rugi tahun berjalan"),
    ("FX_GAIN", "FX Gain", "Keuntungan selisih kurs"),
    ("FX_LOSS", "FX Loss", "Kerugian selisih kurs"),
]


def _money(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        import pandas as pd
        parsed = pd.to_datetime(text, errors="coerce", dayfirst=True)
        if not pd.isna(parsed):
            return parsed.date()
    except Exception:
        pass
    return None


def _source_module(jenis_dokumen: Optional[str]) -> str:
    s = (jenis_dokumen or "").strip().lower()
    if any(x in s for x in ("jual", "sales", "penjualan")):
        return "SALES"
    if any(x in s for x in ("beli", "purchase", "pembelian", "expense")):
        return "PURCHASE"
    if any(x in s for x in ("rekening", "bank", "cash", "kas")):
        return "CASH"
    if "manual" in s:
        return "GENERAL_JOURNAL"
    return (jenis_dokumen or "OTHER").upper().replace(" ", "_")


def ensure_seed_data() -> None:
    """Seed taxonomy/account-role universal. Aman dipanggil berkali-kali."""
    session = dbc.SessionLocal()
    try:
        existing_std = {x.standard_code for x in session.query(dbc.StandardAccount).all()}
        for row in DEFAULT_STANDARD_ACCOUNTS:
            if row[0] in existing_std:
                continue
            session.add(dbc.StandardAccount(
                standard_code=row[0], standard_name=row[1], account_class=row[2],
                account_subtype=row[3], normal_balance=row[4], fs_statement=row[5],
                fs_group=row[6], fs_line=row[7], active=True,
            ))
        existing_roles = {x.role_code for x in session.query(dbc.AccountRole).all()}
        for code, name, description in DEFAULT_ACCOUNT_ROLES:
            if code not in existing_roles:
                session.add(dbc.AccountRole(role_code=code, role_name=name, description=description, active=True))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _account_metadata(session: Session, client_id: str, account_code: str) -> Dict[str, Any]:
    coa = session.query(dbc.Coa).filter(
        dbc.Coa.client_id == client_id,
        dbc.Coa.no_akun == str(account_code),
    ).first()
    if coa is None:
        return {"coa_id": None, "standard_account_id": None, "standard_account_code": None, "account_role": None}

    mapping = session.query(dbc.CoaStandardMapping).filter(
        dbc.CoaStandardMapping.client_id == client_id,
        dbc.CoaStandardMapping.coa_id == coa.id,
        dbc.CoaStandardMapping.active.is_(True),
    ).first()
    standard = None
    if mapping:
        standard = session.query(dbc.StandardAccount).filter(dbc.StandardAccount.id == mapping.standard_account_id).first()

    role_row = session.query(dbc.CompanyAccountRole, dbc.AccountRole).join(
        dbc.AccountRole, dbc.CompanyAccountRole.role_id == dbc.AccountRole.id
    ).filter(
        dbc.CompanyAccountRole.client_id == client_id,
        dbc.CompanyAccountRole.coa_id == coa.id,
        dbc.CompanyAccountRole.active.is_(True),
        dbc.AccountRole.active.is_(True),
    ).first()
    role_code = role_row[1].role_code if role_row else None
    return {
        "coa_id": coa.id,
        "standard_account_id": standard.id if standard else None,
        "standard_account_code": standard.standard_code if standard else None,
        "account_role": role_code,
    }


def validate_lines(client_id: str, lines: Sequence[Dict[str, Any]], session: Optional[Session] = None) -> Dict[str, Any]:
    own_session = session is None
    session = session or dbc.SessionLocal()
    try:
        if len(lines) < 2:
            raise ValueError("Journal entry minimal memiliki 2 journal lines.")
        total_debit = Decimal("0.00")
        total_credit = Decimal("0.00")
        errors: List[str] = []
        for idx, line in enumerate(lines, 1):
            code = str(line.get("account_code") or "").strip()
            debit = _money(line.get("debit"))
            credit = _money(line.get("credit"))
            if not code:
                errors.append(f"Line {idx}: account_code wajib diisi.")
                continue
            coa = session.query(dbc.Coa).filter(
                dbc.Coa.client_id == client_id, dbc.Coa.no_akun == code, dbc.Coa.aktif.is_(True)
            ).first()
            if coa is None:
                errors.append(f"Line {idx}: akun {code} tidak ditemukan/aktif pada COA client.")
            if debit < 0 or credit < 0:
                errors.append(f"Line {idx}: debit/credit tidak boleh negatif.")
            if debit > 0 and credit > 0:
                errors.append(f"Line {idx}: satu line tidak boleh memiliki debit dan credit sekaligus.")
            if debit == 0 and credit == 0:
                errors.append(f"Line {idx}: debit atau credit harus lebih dari 0.")
            total_debit += debit
            total_credit += credit
        if total_debit != total_credit:
            errors.append(f"Journal tidak balance: debit={total_debit} credit={total_credit}.")
        if total_debit <= 0:
            errors.append("Total jurnal harus lebih dari 0.")
        if errors:
            raise ValueError(" ".join(errors))
        return {"total_debit": total_debit, "total_credit": total_credit}
    finally:
        if own_session:
            session.close()


def sync_legacy_to_core(client_id: str, posting_ids: Optional[Iterable[int]] = None) -> int:
    """Mirror jurnal_posting ke JournalEntry/JournalLine. Idempotent.

    Ini compatibility layer supaya struktur lama tetap berfungsi. Setiap kali
    UI membaca Accounting Core, perubahan legacy terbaru akan disinkronkan.
    """
    session = dbc.SessionLocal()
    count = 0
    try:
        query = session.query(dbc.JurnalPosting).filter(dbc.JurnalPosting.client_id == client_id)
        if posting_ids is not None:
            ids = [int(x) for x in posting_ids]
            if not ids:
                return 0
            query = query.filter(dbc.JurnalPosting.id.in_(ids))
        rows = query.all()
        for j in rows:
            entry = session.query(dbc.JournalEntry).filter(
                dbc.JournalEntry.client_id == client_id,
                dbc.JournalEntry.legacy_posting_id == j.id,
            ).first()
            if entry is None:
                entry = dbc.JournalEntry(
                    client_id=client_id,
                    journal_no=j.voucher or f"JE-LEGACY-{j.id:08d}",
                    source_module=_source_module(j.jenis_dokumen),
                    source_transaction_id=f"JP-{j.id}",
                    legacy_posting_id=j.id,
                    created_by=j.diposting_oleh or "legacy-sync",
                    created_at=j.dibuat_at or datetime.now(),
                )
                session.add(entry)
                session.flush()
            entry.journal_no = j.voucher or entry.journal_no or f"JE-LEGACY-{j.id:08d}"
            entry.source_module = _source_module(j.jenis_dokumen)
            entry.document_date = _parse_date(j.tanggal)
            entry.posting_date = _parse_date(j.tanggal)
            entry.description = j.keterangan
            entry.reference = j.no_dokumen or j.voucher
            entry.status = LEGACY_STATUS_TO_CORE.get(j.status, "DRAFT")
            entry.posted_by = j.diposting_oleh if entry.status == "POSTED" else None
            entry.posted_at = j.diposting_at if entry.status == "POSTED" else None
            entry.updated_at = datetime.now()

            # Recreate lines so edits on legacy queue are reflected exactly.
            session.query(dbc.JournalLine).filter(dbc.JournalLine.journal_entry_id == entry.id).delete()
            debit_meta = _account_metadata(session, client_id, j.no_akun_debet)
            credit_meta = _account_metadata(session, client_id, j.no_akun_kredit)
            session.add(dbc.JournalLine(
                journal_entry_id=entry.id, client_id=client_id, line_no=1,
                coa_id=debit_meta["coa_id"], account_code=j.no_akun_debet,
                account_name=j.nama_akun_debet, standard_account_id=debit_meta["standard_account_id"],
                standard_account_code=debit_meta["standard_account_code"], account_role=debit_meta["account_role"],
                description=j.keterangan, debit=_money(j.jml_debet), credit=Decimal("0.00"),
                partner_name=j.lawan_transaksi, project=j.project_unit,
            ))
            session.add(dbc.JournalLine(
                journal_entry_id=entry.id, client_id=client_id, line_no=2,
                coa_id=credit_meta["coa_id"], account_code=j.no_akun_kredit,
                account_name=j.nama_akun_kredit, standard_account_id=credit_meta["standard_account_id"],
                standard_account_code=credit_meta["standard_account_code"], account_role=credit_meta["account_role"],
                description=j.keterangan, debit=Decimal("0.00"), credit=_money(j.jml_kredit),
                partner_name=j.lawan_transaksi, project=j.project_unit,
            ))
            count += 1
        session.commit()
        return count
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _entry_dict(entry: "dbc.JournalEntry", lines: Sequence["dbc.JournalLine"]) -> Dict[str, Any]:
    return {
        "id": entry.id,
        "client_id": entry.client_id,
        "journal_no": entry.journal_no,
        "source_module": entry.source_module,
        "source_transaction_id": entry.source_transaction_id,
        "legacy_posting_id": entry.legacy_posting_id,
        "document_date": entry.document_date.isoformat() if entry.document_date else None,
        "posting_date": entry.posting_date.isoformat() if entry.posting_date else None,
        "description": entry.description,
        "reference": entry.reference,
        "status": entry.status,
        "currency": entry.currency,
        "exchange_rate": float(entry.exchange_rate or 1),
        "created_by": entry.created_by,
        "posted_by": entry.posted_by,
        "posted_at": entry.posted_at.isoformat() if entry.posted_at else None,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "lines": [
            {
                "id": line.id,
                "line_no": line.line_no,
                "account_code": line.account_code,
                "account_name": line.account_name,
                "standard_account_code": line.standard_account_code,
                "account_role": line.account_role,
                "description": line.description,
                "debit": float(line.debit or 0),
                "credit": float(line.credit or 0),
                "partner_name": line.partner_name,
                "tax_code": line.tax_code,
                "branch": line.branch,
                "department": line.department,
                "cost_center": line.cost_center,
                "project": line.project,
                "reconciliation_no": line.reconciliation_no,
            }
            for line in sorted(lines, key=lambda x: x.line_no)
        ],
    }


def list_journal_entries(client_id: str, status: Optional[str] = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    sync_legacy_to_core(client_id)
    session = dbc.SessionLocal()
    try:
        query = session.query(dbc.JournalEntry).filter(dbc.JournalEntry.client_id == client_id)
        if status:
            query = query.filter(dbc.JournalEntry.status == status.upper())
        query = query.order_by(dbc.JournalEntry.posting_date.desc(), dbc.JournalEntry.id.desc())
        if limit and limit > 0:
            query = query.limit(limit)
        entries = query.all()
        if not entries:
            return []
        ids = [e.id for e in entries]
        all_lines = session.query(dbc.JournalLine).filter(dbc.JournalLine.journal_entry_id.in_(ids)).all()
        by_entry: Dict[int, List[Any]] = defaultdict(list)
        for line in all_lines:
            by_entry[line.journal_entry_id].append(line)
        return [_entry_dict(e, by_entry[e.id]) for e in entries]
    finally:
        session.close()


def list_posted_lines(client_id: str, tanggal_mulai: Optional[str] = None,
                      tanggal_akhir: Optional[str] = None) -> List[Dict[str, Any]]:
    """Flat journal lines untuk GL/TB/FS. Hanya POSTED."""
    sync_legacy_to_core(client_id)
    session = dbc.SessionLocal()
    try:
        query = session.query(dbc.JournalLine, dbc.JournalEntry).join(
            dbc.JournalEntry, dbc.JournalLine.journal_entry_id == dbc.JournalEntry.id
        ).filter(
            dbc.JournalEntry.client_id == client_id,
            dbc.JournalEntry.status == "POSTED",
        )
        d1 = _parse_date(tanggal_mulai)
        d2 = _parse_date(tanggal_akhir)
        if d1:
            query = query.filter(dbc.JournalEntry.posting_date >= d1)
        if d2:
            query = query.filter(dbc.JournalEntry.posting_date <= d2)
        rows = query.order_by(dbc.JournalEntry.posting_date, dbc.JournalEntry.id, dbc.JournalLine.line_no).all()
        result = []
        for line, entry in rows:
            result.append({
                "journal_entry_id": entry.id,
                "journal_no": entry.journal_no,
                "source_module": entry.source_module,
                "source_transaction_id": entry.source_transaction_id,
                "legacy_posting_id": entry.legacy_posting_id,
                "tanggal": entry.posting_date.isoformat() if entry.posting_date else None,
                "keterangan": line.description or entry.description,
                "reference": entry.reference,
                "account_code": line.account_code,
                "account_name": line.account_name,
                "standard_account_code": line.standard_account_code,
                "account_role": line.account_role,
                "debit": float(line.debit or 0),
                "credit": float(line.credit or 0),
                "partner_name": line.partner_name,
                "tax_code": line.tax_code,
                "branch": line.branch,
                "department": line.department,
                "cost_center": line.cost_center,
                "project": line.project,
                "reconciliation_no": line.reconciliation_no,
                "status": entry.status,
            })
        return result
    finally:
        session.close()


def create_journal_entry(client_id: str, *, source_module: str, posting_date: Any,
                         description: str, lines: Sequence[Dict[str, Any]], created_by: str,
                         status: str = "DRAFT", source_transaction_id: Optional[str] = None,
                         reference: Optional[str] = None, currency: str = "IDR") -> Dict[str, Any]:
    """Native multi-line journal API untuk modul baru. Tidak mengganti legacy UI."""
    status = (status or "DRAFT").upper()
    if status not in CORE_STATUS_VALID:
        raise ValueError(f"Status journal tidak dikenal: {status}")
    session = dbc.SessionLocal()
    try:
        totals = validate_lines(client_id, lines, session=session)
        pdate = _parse_date(posting_date)
        if pdate is None:
            raise ValueError("posting_date tidak valid.")
        entry = dbc.JournalEntry(
            client_id=client_id,
            journal_no="TEMP",
            source_module=(source_module or "GENERAL_JOURNAL").upper(),
            source_transaction_id=source_transaction_id,
            document_date=pdate,
            posting_date=pdate,
            description=description,
            reference=reference,
            status=status,
            currency=currency or "IDR",
            exchange_rate=Decimal("1.000000"),
            created_by=created_by,
            posted_by=created_by if status == "POSTED" else None,
            posted_at=datetime.now() if status == "POSTED" else None,
        )
        session.add(entry)
        session.flush()
        entry.journal_no = f"JE-{pdate.year}-{entry.id:08d}"
        for idx, payload in enumerate(lines, 1):
            code = str(payload.get("account_code") or "").strip()
            meta = _account_metadata(session, client_id, code)
            coa = session.query(dbc.Coa).filter(dbc.Coa.id == meta["coa_id"]).first() if meta["coa_id"] else None
            session.add(dbc.JournalLine(
                journal_entry_id=entry.id, client_id=client_id, line_no=idx,
                coa_id=meta["coa_id"], account_code=code,
                account_name=payload.get("account_name") or (coa.nama_akun if coa else code),
                standard_account_id=meta["standard_account_id"],
                standard_account_code=meta["standard_account_code"],
                account_role=payload.get("account_role") or meta["account_role"],
                description=payload.get("description") or description,
                debit=_money(payload.get("debit")), credit=_money(payload.get("credit")),
                partner_name=payload.get("partner_name"), tax_code=payload.get("tax_code"),
                branch=payload.get("branch"), department=payload.get("department"),
                cost_center=payload.get("cost_center"), project=payload.get("project"),
                reconciliation_no=payload.get("reconciliation_no"),
            ))
        session.commit()
        session.refresh(entry)
        saved_lines = session.query(dbc.JournalLine).filter(dbc.JournalLine.journal_entry_id == entry.id).all()
        return _entry_dict(entry, saved_lines)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def post_journal_entry(client_id: str, journal_entry_id: int, user: str) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        entry = session.query(dbc.JournalEntry).filter(
            dbc.JournalEntry.id == journal_entry_id, dbc.JournalEntry.client_id == client_id
        ).first()
        if entry is None:
            raise ValueError("Journal entry tidak ditemukan.")
        if entry.status == "POSTED":
            lines = session.query(dbc.JournalLine).filter(dbc.JournalLine.journal_entry_id == entry.id).all()
            return _entry_dict(entry, lines)
        if entry.status in {"REJECTED", "REVERSED"}:
            raise ValueError(f"Journal status {entry.status} tidak dapat diposting.")
        lines = session.query(dbc.JournalLine).filter(dbc.JournalLine.journal_entry_id == entry.id).all()
        validate_lines(client_id, [
            {"account_code": x.account_code, "debit": x.debit, "credit": x.credit}
            for x in lines
        ], session=session)
        entry.status = "POSTED"
        entry.posted_by = user
        entry.posted_at = datetime.now()
        entry.updated_at = datetime.now()
        session.commit()
        session.refresh(entry)
        return _entry_dict(entry, lines)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def set_coa_mapping(client_id: str, coa_id: int, standard_code: str, user: str) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        coa = session.query(dbc.Coa).filter(dbc.Coa.id == coa_id, dbc.Coa.client_id == client_id).first()
        if coa is None:
            raise ValueError("COA tidak ditemukan untuk client ini.")
        standard = session.query(dbc.StandardAccount).filter(
            dbc.StandardAccount.standard_code == standard_code, dbc.StandardAccount.active.is_(True)
        ).first()
        if standard is None:
            raise ValueError("Standard account tidak ditemukan.")
        mapping = session.query(dbc.CoaStandardMapping).filter(
            dbc.CoaStandardMapping.client_id == client_id, dbc.CoaStandardMapping.coa_id == coa_id
        ).first()
        if mapping is None:
            mapping = dbc.CoaStandardMapping(client_id=client_id, coa_id=coa_id, standard_account_id=standard.id, active=True, mapped_by=user)
            session.add(mapping)
        else:
            mapping.standard_account_id = standard.id
            mapping.active = True
            mapping.mapped_by = user
            mapping.updated_at = datetime.now()
        session.commit()
        return {"coa_id": coa_id, "standard_code": standard.standard_code, "standard_name": standard.standard_name}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def set_company_account_role(client_id: str, role_code: str, coa_id: int, user: str) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        coa = session.query(dbc.Coa).filter(dbc.Coa.id == coa_id, dbc.Coa.client_id == client_id).first()
        if coa is None:
            raise ValueError("COA tidak ditemukan untuk client ini.")
        role = session.query(dbc.AccountRole).filter(dbc.AccountRole.role_code == role_code, dbc.AccountRole.active.is_(True)).first()
        if role is None:
            raise ValueError("Account role tidak ditemukan.")
        row = session.query(dbc.CompanyAccountRole).filter(
            dbc.CompanyAccountRole.client_id == client_id, dbc.CompanyAccountRole.role_id == role.id
        ).first()
        if row is None:
            row = dbc.CompanyAccountRole(client_id=client_id, role_id=role.id, coa_id=coa_id, active=True, assigned_by=user)
            session.add(row)
        else:
            row.coa_id = coa_id
            row.active = True
            row.assigned_by = user
            row.updated_at = datetime.now()
        session.commit()
        return {"role_code": role_code, "coa_id": coa_id, "account_code": coa.no_akun, "account_name": coa.nama_akun}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def mapping_health(client_id: str) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        coas = session.query(dbc.Coa).filter(dbc.Coa.client_id == client_id, dbc.Coa.aktif.is_(True)).all()
        mapped_ids = {x.coa_id for x in session.query(dbc.CoaStandardMapping).filter(
            dbc.CoaStandardMapping.client_id == client_id, dbc.CoaStandardMapping.active.is_(True)
        ).all()}
        role_rows = session.query(dbc.CompanyAccountRole, dbc.AccountRole, dbc.Coa).join(
            dbc.AccountRole, dbc.CompanyAccountRole.role_id == dbc.AccountRole.id
        ).join(dbc.Coa, dbc.CompanyAccountRole.coa_id == dbc.Coa.id).filter(
            dbc.CompanyAccountRole.client_id == client_id, dbc.CompanyAccountRole.active.is_(True)
        ).all()
        role_map = {role.role_code: {"coa_id": coa.id, "account_code": coa.no_akun, "account_name": coa.nama_akun} for _, role, coa in role_rows}
        important_roles = ["AR_CONTROL", "AP_CONTROL", "INPUT_VAT", "OUTPUT_VAT", "RETAINED_EARNINGS"]
        return {
            "total_active_coa": len(coas),
            "mapped_coa": len(mapped_ids),
            "unmapped_coa": [
                {"id": c.id, "no_akun": c.no_akun, "nama_akun": c.nama_akun}
                for c in coas if c.id not in mapped_ids
            ],
            "account_roles": role_map,
            "missing_important_roles": [r for r in important_roles if r not in role_map],
            "ready_for_posting": len([r for r in important_roles if r not in role_map]) == 0,
        }
    finally:
        session.close()