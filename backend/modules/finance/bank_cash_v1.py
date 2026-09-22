"""
modules/finance/bank_cash_v1.py
=================================
Halaman Cash Payment & Cash Receipt, sumber tabel
finance_transaction_bank_cash (schema Supabase "3_Financial"). Pola
endpoint SENGAJA identik dengan jurnal-posting umum di main.py (skema
tabel sama persis) -- lihat bankCashBridge.ts di frontend utk pemetaan
balik ke Transaction.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/finance/__init__.py untuk catatan lengkap.

Catatan _map_status_frontend_ke_backend: fungsi & dict di bawah ini
SENGAJA duplikat dari main.py (isinya sama persis), karena endpoint
jurnal-posting umum (/api/client/{id}/jurnal-posting/{id}, modul
Transaction umum yang BELUM dipindah dari main.py) juga masih
memakainya di sana. Kalau nanti modul itu ikut dipindah (mis. ke
modules/transactions/), pindahkan definisi aslinya ke satu tempat
dan import dari situ supaya tidak dobel.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_bank_cash_v1")

router = APIRouter(prefix="/api/v1/transaction", tags=["bank-cash"])


# ============================================================
# Terjemahan status ala frontend (Transaction['status'] di
# transactionData.ts) -> salah satu dari 3 nilai sah backend (lihat
# db_client.STATUS_JURNAL_VALID). 'Draft' TIDAK dipetakan secara sengaja
# -- backend tidak punya status "draft pending approval" yang beda dari
# "draft belum diposting", jadi 'Draft' dari frontend (kalau memang
# dikirim) diperlakukan sama seperti 'Unposted': tetap 'draft' di
# backend. Nilai yang tidak dikenal (typo dsb) ditolak 400, bukan diam-
# diam dijadikan draft.
# ============================================================
_STATUS_FRONTEND_KE_BACKEND = {
    "Unposted": "draft",
    "Draft": "draft",
    "Posted": "terposting",
    "Reconciled": "terposting",
    "Voided": "ditolak",
}


def _map_status_frontend_ke_backend(status_frontend: Optional[str]) -> Optional[str]:
    if status_frontend is None:
        return None
    hasil = _STATUS_FRONTEND_KE_BACKEND.get(status_frontend)
    if hasil is None:
        raise HTTPException(
            status_code=400,
            detail=f"Status '{status_frontend}' tidak dikenal. Nilai sah: {list(_STATUS_FRONTEND_KE_BACKEND.keys())}",
        )
    return hasil


# ============================================================
# SKEMA
# ============================================================

class BankCashRowSkema(BaseModel):
    """Satu baris Cash Payment/Cash Receipt -- lihat _bank_cash_ke_dict()."""
    id: str
    hasil_id: Optional[int] = None
    jenis_dokumen: Optional[str] = None
    tanggal: Optional[str] = None
    keterangan: Optional[str] = None
    lawan_transaksi: Optional[str] = None
    no_dokumen: Optional[str] = None
    project_unit: Optional[str] = None
    jatuh_tempo: Optional[str] = None
    no_akun_debet: Optional[str] = None
    nama_akun_debet: Optional[str] = None
    jml_debet: float = 0
    no_akun_kredit: Optional[str] = None
    nama_akun_kredit: Optional[str] = None
    jml_kredit: float = 0
    status: Optional[str] = None
    sumber_placeholder: Optional[bool] = None
    voucher: Optional[str] = None
    periode_voucher: Optional[str] = None
    payment_status: Optional[str] = None
    paid_amount: Optional[float] = None
    diposting_oleh: Optional[str] = None
    diposting_at: Optional[str] = None
    dibuat_at: Optional[str] = None


class DaftarBankCashResponse(BaseModel):
    bank_cash: List[BankCashRowSkema]


class UpdateBankCashResponse(BaseModel):
    berhasil: bool
    bank_cash: BankCashRowSkema


class BuatBankCashManualResponse(BaseModel):
    berhasil: bool
    bank_cash_id: str


class PostingMassalHasilSkema(BaseModel):
    """Hasil operasi posting/update massal -- dipakai bank-cash & other."""
    diposting: Optional[int] = None
    dilewati_placeholder: Optional[int] = None
    tidak_ditemukan: int = 0


class PostingMassalBankCashResponse(BaseModel):
    berhasil: bool
    diposting: int
    dilewati_placeholder: int
    tidak_ditemukan: int


class TolakBankCashResponse(BaseModel):
    berhasil: bool


class UpdateBankCashRequest(BaseModel):
    """Body PATCH edit satu baris Bank & Cash -- lihat api_update_bank_cash()."""
    tanggal: Optional[str] = None
    keterangan: Optional[str] = None
    lawan_transaksi: Optional[str] = None
    no_dokumen: Optional[str] = None
    project_unit: Optional[str] = None
    jatuh_tempo: Optional[str] = None
    no_akun_debet: Optional[str] = None
    nama_akun_debet: Optional[str] = None
    jml_debet: Optional[float] = None
    no_akun_kredit: Optional[str] = None
    nama_akun_kredit: Optional[str] = None
    jml_kredit: Optional[float] = None
    status: Optional[str] = None  # ala frontend (Unposted/Posted/dst) -- diterjemahkan sebelum disimpan
    payment_status: Optional[str] = None
    paid_amount: Optional[float] = None


class BuatBankCashManualRequest(BaseModel):
    """Body POST buat entri Bank & Cash baru -- lihat api_buat_bank_cash_manual()."""
    jenis_dokumen: str  # 'cash_payment' | 'cash_receipt'
    tanggal: str
    keterangan: str
    no_akun_debet: str
    nama_akun_debet: Optional[str] = None
    jml_debet: float
    no_akun_kredit: str
    nama_akun_kredit: Optional[str] = None
    jml_kredit: float
    lawan_transaksi: Optional[str] = None
    no_dokumen: Optional[str] = None
    project_unit: Optional[str] = None
    jatuh_tempo: Optional[str] = None
    status: str = "Unposted"  # ala frontend, diterjemahkan sebelum disimpan
    payment_status: Optional[str] = None
    paid_amount: Optional[float] = None


class PostingMassalBankCashRequest(BaseModel):
    ids: List[int]


class TolakBankCashRequest(BaseModel):
    alasan: Optional[str] = None


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getBankCash", response_model=DaftarBankCashResponse)
def api_daftar_bank_cash(
    client_id: str,
    status: Optional[str] = None,
    limit: Optional[int] = None,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Daftar seluruh baris Cash Payment + Cash Receipt milik client (semua
    status secara default). ?status=draft/terposting/ditolak untuk filter."""
    return {"bank_cash": dbc.daftar_bank_cash(client_id, status=status, limit=limit)}


@router.patch("/updateBankCash", response_model=UpdateBankCashResponse)
def api_update_bank_cash(
    client_id: str, bank_cash_id: str, req: UpdateBankCashRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Edit satu baris Bank & Cash yang sudah ada -- dipakai TransactionEditModal
    di halaman Cash Payment/Cash Receipt. Pola identik api_update_jurnal_posting()."""
    fields = req.model_dump(exclude_unset=True)
    if "status" in fields:
        fields["status"] = _map_status_frontend_ke_backend(fields["status"])

    try:
        hasil = dbc.update_bank_cash(bank_cash_id, client_id, user.get("username", "unknown"), **fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if hasil is None:
        raise HTTPException(status_code=404, detail="Baris Bank & Cash tidak ditemukan untuk client ini.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="edit_bank_cash", detail={"bank_cash_id": bank_cash_id, **fields},
    )
    return {"berhasil": True, "bank_cash": hasil}


@router.post("/addBankCashManual", response_model=BuatBankCashManualResponse)
def api_buat_bank_cash_manual(
    client_id: str, req: BuatBankCashManualRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Buat entri Bank & Cash baru -- dipakai tombol "+ Jurnal Baru" di
    halaman Cash Payment/Cash Receipt. Jurnal harus balance (debet == kredit),
    sama seperti api_buat_jurnal_manual()."""
    if req.jenis_dokumen not in dbc.JENIS_DOKUMEN_BANK_CASH_VALID:
        raise HTTPException(
            status_code=400,
            detail=f"jenis_dokumen '{req.jenis_dokumen}' tidak dikenal. Nilai sah: {sorted(dbc.JENIS_DOKUMEN_BANK_CASH_VALID)}",
        )
    if round(req.jml_debet, 2) != round(req.jml_kredit, 2):
        raise HTTPException(
            status_code=400,
            detail=f"Jurnal tidak balance: Debet Rp{req.jml_debet:,.0f} vs Kredit Rp{req.jml_kredit:,.0f}.",
        )
    if req.jml_debet <= 0:
        raise HTTPException(status_code=400, detail="Nominal jurnal harus lebih besar dari 0.")

    status_backend = _map_status_frontend_ke_backend(req.status) or "draft"

    try:
        bank_cash_id = dbc.buat_bank_cash_manual(
            client_id=client_id, user=user.get("username", "unknown"),
            jenis_dokumen=req.jenis_dokumen,
            tanggal=req.tanggal, keterangan=req.keterangan,
            no_akun_debet=req.no_akun_debet, nama_akun_debet=req.nama_akun_debet, jml_debet=req.jml_debet,
            no_akun_kredit=req.no_akun_kredit, nama_akun_kredit=req.nama_akun_kredit, jml_kredit=req.jml_kredit,
            lawan_transaksi=req.lawan_transaksi, no_dokumen=req.no_dokumen, project_unit=req.project_unit,
            jatuh_tempo=req.jatuh_tempo,
            status=status_backend, payment_status=req.payment_status, paid_amount=req.paid_amount,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if bank_cash_id is None:
        raise HTTPException(status_code=500, detail="Gagal menyimpan entri Bank & Cash baru.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="buat_bank_cash_manual", detail={"bank_cash_id": bank_cash_id, "keterangan": req.keterangan},
    )
    return {"berhasil": True, "bank_cash_id": bank_cash_id}


@router.post("/postBankCashBulk", response_model=PostingMassalBankCashResponse)
def api_posting_massal_bank_cash(
    client_id: str, req: PostingMassalBankCashRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Posting banyak baris 'draft' Bank & Cash sekaligus jadi 'terposting' --
    dipakai tombol "Posting Semua" di halaman Cash Payment/Cash Receipt."""
    hasil = dbc.posting_massal_bank_cash_by_ids(client_id, req.ids, user.get("username", "unknown"))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="posting_massal_bank_cash",
        detail={"jumlah_diminta": len(req.ids), **hasil},
    )
    return {"berhasil": True, **hasil}


@router.post("/rejectBankCash", response_model=TolakBankCashResponse)
def api_tolak_bank_cash(
    client_id: str, bank_cash_id: str, req: TolakBankCashRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tolak (hapus) satu baris Bank & Cash -- dipakai tombol Hapus di
    halaman Cash Payment/Cash Receipt. Pola identik api_tolak_posting()."""
    berhasil = dbc.tolak_bank_cash(bank_cash_id, client_id, user.get("username", "unknown"), req.alasan)
    if not berhasil:
        raise HTTPException(status_code=404, detail="Baris Bank & Cash tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="tolak_bank_cash", detail={"bank_cash_id": bank_cash_id, "alasan": req.alasan},
    )
    return {"berhasil": True}