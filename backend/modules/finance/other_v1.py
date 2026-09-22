"""
modules/finance/other_v1.py
=============================
Halaman Other (jurnal umum di luar Purchase/Bank & Cash), sumber tabel
finance_transaction_other (schema Supabase "3_Financial"). Pola endpoint
identik modul Bank & Cash, bedanya operasi update/posting/tolak
dikelompokkan per je_id (bukan per id baris) karena satu entri jurnal
Other = DUA baris (leg debet + leg kredit) -- lihat otherBridge.ts di
frontend utk pemetaan balik ke Transaction.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/finance/__init__.py untuk catatan lengkap.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_other_v1")

router = APIRouter(prefix="/api/v1/transaction", tags=["other"])


# ============================================================
# SKEMA
# ============================================================

class FinanceOtherRowSkema(BaseModel):
    """Satu leg (debet ATAU kredit) entri Other -- lihat _finance_other_ke_dict()."""
    id: str
    tx_id: Optional[str] = None
    je_id: Optional[str] = None
    date: Optional[str] = None
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    description: Optional[str] = None
    debit: float = 0
    credit: float = 0
    reference: Optional[str] = None
    party: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    voucher_no: Optional[str] = None
    saldo_akhir: float = 0
    cek: bool = False
    source_module: Optional[str] = None
    standard_account_code: Optional[str] = None
    account_role: Optional[str] = None
    core_journal_entry_id: Optional[str] = None
    core_journal_line_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DataFinanceOtherResponse(BaseModel):
    finance_other: List[FinanceOtherRowSkema]


class UpdateFinanceOtherResponse(BaseModel):
    berhasil: bool
    finance_other: List[FinanceOtherRowSkema]  # 2 leg (debet + kredit) sekaligus


class BuatFinanceOtherManualResponse(BaseModel):
    berhasil: bool
    je_id: str


class PostingMassalFinanceOtherResponse(BaseModel):
    berhasil: bool
    diposting: int
    dilewati_placeholder: int
    tidak_ditemukan: int


class TolakFinanceOtherResponse(BaseModel):
    berhasil: bool


class FinanceOtherLegUpdate(BaseModel):
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    debit: Optional[float] = None
    credit: Optional[float] = None


class UpdateFinanceOtherRequest(BaseModel):
    """Body PATCH edit satu ENTRI (sepasang leg, dicocokkan lewat je_id) --
    lihat api_update_finance_other()."""
    date: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None
    party: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    voucher_no: Optional[str] = None
    status: Optional[str] = None  # Unposted/Posted/Draft/Reconciled/Voided -- langsung, tanpa terjemahan
    debit_leg: Optional[FinanceOtherLegUpdate] = None
    credit_leg: Optional[FinanceOtherLegUpdate] = None


class BuatFinanceOtherManualRequest(BaseModel):
    """Body POST buat entri Other baru -- lihat api_buat_finance_other_manual()."""
    tanggal: str
    description: str
    account_code_debet: str
    account_name_debet: Optional[str] = None
    jml_debet: float
    account_code_kredit: str
    account_name_kredit: Optional[str] = None
    jml_kredit: float
    reference: Optional[str] = None
    party: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    voucher_no: Optional[str] = None
    status: str = "Unposted"


class PostingMassalFinanceOtherRequest(BaseModel):
    je_ids: List[str]


class TolakFinanceOtherRequest(BaseModel):
    alasan: Optional[str] = None


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getFinanceOther", response_model=DataFinanceOtherResponse)
def api_daftar_finance_other(
    client_id: str,
    status: Optional[str] = None,
    limit: Optional[int] = None,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Daftar seluruh baris (kedua leg) Other milik client (semua status
    secara default). ?status=Unposted/Posted/Draft/Reconciled/Voided untuk filter."""
    return {"finance_other": dbc.daftar_finance_other(client_id, status=status, limit=limit)}


@router.patch("/updateFinanceOther", response_model=UpdateFinanceOtherResponse)
def api_update_finance_other(
    client_id: str, je_id: str, req: UpdateFinanceOtherRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Edit satu entri Other (kedua leg sekaligus) -- dipakai
    TransactionEditModal di halaman Other."""
    fields = req.model_dump(exclude_unset=True)
    if "debit_leg" in fields and fields["debit_leg"] is not None:
        fields["debit_leg"] = {k: v for k, v in fields["debit_leg"].items() if v is not None}
    if "credit_leg" in fields and fields["credit_leg"] is not None:
        fields["credit_leg"] = {k: v for k, v in fields["credit_leg"].items() if v is not None}

    try:
        hasil = dbc.update_finance_other_by_je_id(je_id, client_id, user.get("username", "unknown"), **fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if hasil is None:
        raise HTTPException(status_code=404, detail="Entri Other tidak ditemukan untuk client ini.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="edit_finance_other", detail={"je_id": je_id, **fields},
    )
    return {"berhasil": True, "finance_other": hasil}


@router.post("/addFinanceOtherManual", response_model=BuatFinanceOtherManualResponse)
def api_buat_finance_other_manual(
    client_id: str, req: BuatFinanceOtherManualRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Buat entri Other baru -- dipakai tombol "+ Jurnal Baru" di halaman
    Other. Jurnal harus balance (debet == kredit)."""
    try:
        je_id = dbc.buat_finance_other_manual(
            client_id=client_id, tanggal=req.tanggal, description=req.description,
            account_code_debet=req.account_code_debet, account_name_debet=req.account_name_debet,
            jml_debet=req.jml_debet,
            account_code_kredit=req.account_code_kredit, account_name_kredit=req.account_name_kredit,
            jml_kredit=req.jml_kredit,
            reference=req.reference, party=req.party, category=req.category,
            notes=req.notes, voucher_no=req.voucher_no, status=req.status,
            user=user.get("username", "unknown"),  # [BARU] utk finance_transaction_other_activity_log
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if je_id is None:
        raise HTTPException(status_code=500, detail="Gagal menyimpan entri Other baru.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="buat_finance_other_manual", detail={"je_id": je_id, "description": req.description},
    )
    return {"berhasil": True, "je_id": je_id}


@router.post("/postFinanceOtherBulk", response_model=PostingMassalFinanceOtherResponse)
def api_posting_massal_finance_other(
    client_id: str, req: PostingMassalFinanceOtherRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Posting banyak entri 'Unposted' Other sekaligus jadi 'Posted' --
    dipakai tombol "Posting Semua" di halaman Other."""
    hasil = dbc.posting_massal_finance_other_by_je_ids(client_id, req.je_ids, user.get("username", "unknown"))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="posting_massal_finance_other",
        detail={"jumlah_diminta": len(req.je_ids), **hasil},
    )
    return {"berhasil": True, **hasil}


@router.post("/rejectFinanceOther", response_model=TolakFinanceOtherResponse)
def api_tolak_finance_other(
    client_id: str, je_id: str, req: TolakFinanceOtherRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tolak (hapus) satu entri Other -- dipakai tombol Hapus di halaman Other."""
    berhasil = dbc.tolak_finance_other_by_je_id(je_id, client_id, user.get("username", "unknown"), req.alasan)
    if not berhasil:
        raise HTTPException(status_code=404, detail="Entri Other tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="tolak_finance_other", detail={"je_id": je_id, "alasan": req.alasan},
    )
    return {"berhasil": True}