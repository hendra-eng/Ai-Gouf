"""
modules/management/nav_badges_v1.py
===================================
Badge angka di menu Sidebar -> /api/v1/notifications/nav-badges?client_id=<company>

Menggantikan angka palsu yang dulu ditulis tetap di Sidebar.tsx (mis. "248" di Transactions
dan "3" di Accounts Receivable). Sekarang setiap angka dihitung dari database untuk company
aktif, dan hanya menghitung hal yang MEMANG perlu dicek orang -- bukan sekadar total data:

    nav-tx-sales          exception Sales berstatus Open (belum ditangani)
    nav-tx-purchase       exception Purchase berstatus Open
    nav-tx-journal-entry  jurnal menunggu review / ditolak / bermasalah (pending, rejected, exception)
    nav-tx-bank-cash      mutasi bank yang belum dicocokkan (unmatched)
    nav-tx-other          transaksi Other menunggu review / ditolak (pending_review, rejected)
    nav-transactions      jumlah kelima sub-menu di atas
    nav-ar                invoice jatuh tempo yang masih ada sisa (pakai mesin aging AR)
    nav-ap                bill jatuh tempo yang masih ada sisa (pakai mesin aging AP)
    nav-assets            batch penyusutan aset yang belum diposting (draft / approved)
    nav-inventory         item aktif dengan stok <= stok minimum (min_stock > 0)
    nav-tax               temuan pajak yang belum selesai (open / in_review / on_hold)

Aturan:
- Hanya baris yang count-nya > 0 yang dikembalikan; menu tanpa badge = tidak ada yang perlu dicek.
- Satu sinyal gagal dihitung (mis. tabel belum dimigrasi) tidak menggagalkan yang lain: sinyal itu
  dilewati dan dicatat di log.
- Baca saja (tidak mengubah data); cukup token valid seperti endpoint overview lainnya.
- severity: "warning" (perlu dicek) atau "negative" (mendesak: AR/AP telat > 60 hari, temuan pajak High).
"""

from __future__ import annotations

from datetime import date
from typing import Any, Callable, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..finance import receivables_payables_v1 as rp
from ..logging_config import get_module_logger
from ..transactions import bank_cash_willi as bc

logger = get_module_logger("management_nav_badges_v1")

router = APIRouter(prefix="/api/v1/notifications", tags=["nav-badges-v1"])

# Telat lebih dari ini (hari) = badge AR/AP dianggap mendesak.
HARI_MENDESAK = 60


def _item(count: int, label: str, severity: str = "warning") -> Optional[Dict[str, Any]]:
    """Satu badge; None kalau tidak ada yang perlu dicek."""
    if count <= 0:
        return None
    return {"count": int(count), "severity": severity, "label": label}


def _jamak(n: int, satu: str, banyak: str) -> str:
    return f"{n} {satu if n == 1 else banyak}"


# ============================================================
# SINYAL (masing-masing menerima session + id company, mengembalikan badge atau None)
# ============================================================

def _sales(session, kid: str) -> Optional[Dict[str, Any]]:
    # Helper yang sama dengan tab Exceptions Sales -> angka badge = isi tab.
    n = len(dbc.list_sales_exceptions(status="Open", management_client_id=kid))
    return _item(n, f"{_jamak(n, 'sales exception', 'sales exceptions')} open")


def _purchase(session, kid: str) -> Optional[Dict[str, Any]]:
    n = len(dbc.list_purchase_exceptions(status="Open", management_client_id=kid))
    return _item(n, f"{_jamak(n, 'purchase exception', 'purchase exceptions')} open")


def _journal(session, kid: str) -> Optional[Dict[str, Any]]:
    JE = dbc.JournalEntryDraft
    n = session.query(func.count(JE.id)).filter(
        JE.management_client_id == kid, JE.deleted_at.is_(None),
        JE.status.in_(("pending", "rejected", "exception")),
    ).scalar() or 0
    return _item(n, f"{_jamak(n, 'journal entry', 'journal entries')} awaiting review or needing fixes")


def _bank_cash(session, kid: str) -> Optional[Dict[str, Any]]:
    MU, ST = dbc.BankCashMutation, dbc.BankCashStatement
    n = session.query(func.count(MU.id)).join(ST, ST.id == MU.statement_id).filter(
        MU.client_id == kid, MU.deleted_at.is_(None), ST.deleted_at.is_(None), MU.status == "unmatched",
    ).scalar() or 0
    return _item(n, f"{_jamak(n, 'bank mutation', 'bank mutations')} not yet matched")


def _other(session, kid: str) -> Optional[Dict[str, Any]]:
    OT = dbc.OtherTransaction
    n = session.query(func.count(OT.id)).filter(
        OT.client_id == kid, OT.deleted_at.is_(None), OT.status.in_(("pending_review", "rejected")),
    ).scalar() or 0
    return _item(n, f"{_jamak(n, 'other transaction', 'other transactions')} awaiting review or rejected")


def _jatuh_tempo(session, kid: str, sisi: "rp.Sisi") -> Optional[Dict[str, Any]]:
    per = date.today()
    telat = [d for d in rp._muat_dokumen(session, kid, sisi) if d.sisa(per) > 0 and d.telat(per) > 0]
    n = len(telat)
    if n == 0:
        return None
    mendesak = max(d.telat(per) for d in telat) > HARI_MENDESAK
    kata = ("invoice", "invoices") if sisi.kode == "ar" else ("bill", "bills")
    label = f"{_jamak(n, *kata)} overdue" + (f" (some more than {HARI_MENDESAK} days)" if mendesak else "")
    return _item(n, label, "negative" if mendesak else "warning")


def _ar(session, kid: str) -> Optional[Dict[str, Any]]:
    return _jatuh_tempo(session, kid, rp.AR)


def _ap(session, kid: str) -> Optional[Dict[str, Any]]:
    return _jatuh_tempo(session, kid, rp.AP)


def _assets(session, kid: str) -> Optional[Dict[str, Any]]:
    RUN = dbc.FixedAssetDepreciationRun
    n = session.query(func.count(RUN.id)).filter(
        RUN.client_id == kid, RUN.deleted_at.is_(None), RUN.status.in_(("draft", "approved")),
    ).scalar() or 0
    return _item(n, f"{_jamak(n, 'depreciation batch', 'depreciation batches')} not yet posted")


def _inventory(session, kid: str) -> Optional[Dict[str, Any]]:
    IT, MV = dbc.InventoryItem, dbc.InventoryMovement
    batas = {
        str(i): m for i, m in session.query(IT.id, IT.min_stock).filter(
            IT.client_id == kid, IT.deleted_at.is_(None), IT.status == "active", IT.min_stock > 0,
        ).all()
    }
    if not batas:
        return None
    stok = {
        str(i): q for i, q in session.query(
            MV.item_id, func.coalesce(func.sum(MV.qty_in), 0) - func.coalesce(func.sum(MV.qty_out), 0),
        ).filter(MV.client_id == kid, MV.item_id.in_(list(batas))).group_by(MV.item_id).all()
    }
    n = sum(1 for i, m in batas.items() if stok.get(i, 0) <= m)
    return _item(n, f"{_jamak(n, 'item', 'items')} at or below minimum stock")


def _tax(session, kid: str) -> Optional[Dict[str, Any]]:
    EXC = dbc.TaxException
    rows = session.query(EXC.severity, func.count(EXC.id)).filter(
        EXC.client_id == kid, EXC.deleted_at.is_(None), EXC.status.in_(("open", "in_review", "on_hold")),
    ).group_by(EXC.severity).all()
    n = sum(c for _, c in rows)
    tinggi = sum(c for s, c in rows if (s or "").lower() == "high")
    if n == 0:
        return None
    label = f"{_jamak(n, 'tax finding', 'tax findings')} not yet resolved" + (f" ({tinggi} high priority)" if tinggi else "")
    return _item(n, label, "negative" if tinggi else "warning")


SINYAL: Dict[str, Callable[[Any, str], Optional[Dict[str, Any]]]] = {
    "nav-tx-sales": _sales,
    "nav-tx-purchase": _purchase,
    "nav-tx-journal-entry": _journal,
    "nav-tx-bank-cash": _bank_cash,
    "nav-tx-other": _other,
    "nav-ar": _ar,
    "nav-ap": _ap,
    "nav-assets": _assets,
    "nav-inventory": _inventory,
    "nav-tax": _tax,
}

# Menu induk = jumlah anak-anaknya.
INDUK = {
    "nav-transactions": ("nav-tx-sales", "nav-tx-purchase", "nav-tx-journal-entry", "nav-tx-bank-cash", "nav-tx-other"),
}


def hitung_badges(session, kid: str) -> Dict[str, Dict[str, Any]]:
    hasil: Dict[str, Dict[str, Any]] = {}
    for kunci, fn in SINYAL.items():
        try:
            b = fn(session, kid)
        except Exception:
            # Satu sinyal rusak tidak boleh menjatuhkan seluruh sidebar.
            session.rollback()
            logger.exception("Gagal menghitung badge %s", kunci)
            continue
        if b:
            hasil[kunci] = b
    for induk, anak in INDUK.items():
        ada = [hasil[a] for a in anak if a in hasil]
        if ada:
            total = sum(b["count"] for b in ada)
            hasil[induk] = {
                "count": total,
                "severity": "negative" if any(b["severity"] == "negative" for b in ada) else "warning",
                "label": f"{total} items need attention in Transactions",
            }
    return hasil


@router.get("/nav-badges", summary="Badge urgent per menu Sidebar untuk company aktif (dihitung dari database)")
def nav_badges(client_id: UUID = Query(..., description="Company aktif (management_clients.id)"),
               _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        return {"as_of": date.today(), "badges": hitung_badges(session, kid)}

    return bc._respon(aksi)
