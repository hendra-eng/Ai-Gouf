"""
modules/finance/bank_feed_v1.py
================================
Halaman Cash & Bank > tab "Bank Feed" & "Reconciliation"
(src/app/transactions/bank-cash/bank-feed, .../reconciliation). Sumber
tabel BARU "bank_feed_mutation" (lihat db_client.py::BankFeedMutation +
migrations/12-create_bank_feed_mutation_table.py) -- mutasi rekening
koran MENTAH (sebelum dijurnal), TERPISAH dari
finance_transaction_bank_cash (yang dipakai tab Cash Payment/Cash
Receipt, sudah berbentuk jurnal double-entry).

Ekstraksi file REUSE ak.proses_file_rekening_koran() yang sudah ada
(field mutasi_debet/mutasi_kredit per baris draf_jurnal, arah mutasi
bank yang sudah pasti -- lihat catatan di akuntansi_ai.py) -- tidak ada
parser baru yang ditulis di sini, endpoint import cuma memetakan hasil
itu ke baris bank_feed_mutation lalu menyimpannya.

Frontend: src/app/transactions/bank-cash/context/BankFeedContext.tsx.
"""

from __future__ import annotations

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import akuntansi_ai as ak
import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_bank_feed_v1")

router = APIRouter(prefix="/api/v1/finance/bank-feed", tags=["bank-feed"])


# ============================================================
# SKEMA
# ============================================================

class BankFeedMutationSkema(BaseModel):
    """Satu baris mutasi Bank Feed -- lihat db_client._bank_feed_ke_dict()."""
    id: str
    bankAccount: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None
    debit: float = 0
    credit: float = 0
    balanceAfter: float = 0
    status: str
    matchedTxId: Optional[str] = None
    sourceFile: Optional[str] = None
    uploadedAt: Optional[str] = None


class DaftarBankFeedResponse(BaseModel):
    mutations: List[BankFeedMutationSkema]


class ImportBankFeedResponse(BaseModel):
    berhasil: bool
    diimpor: int
    mutations: List[BankFeedMutationSkema]
    peringatan: List[str] = []


class HapusBankFeedResponse(BaseModel):
    berhasil: bool


class MatchBankFeedRequest(BaseModel):
    tx_id: str


class MatchBankFeedResponse(BaseModel):
    berhasil: bool
    mutation: BankFeedMutationSkema


class UnmatchBankFeedResponse(BaseModel):
    berhasil: bool
    mutation: BankFeedMutationSkema


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/list", response_model=DaftarBankFeedResponse)
def api_daftar_bank_feed(
    client_id: str,
    status: Optional[str] = None,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Daftar mutasi Bank Feed milik client. ?status=unmatched/matched untuk filter
    (dipakai tab Bank Feed & Reconciliation)."""
    if status and status not in dbc.STATUS_BANK_FEED_VALID:
        raise HTTPException(
            status_code=400,
            detail=f"status '{status}' tidak dikenal. Nilai sah: {sorted(dbc.STATUS_BANK_FEED_VALID)}",
        )
    return {"mutations": dbc.daftar_bank_feed_mutasi(client_id, status=status)}


@router.post("/import", response_model=ImportBankFeedResponse)
async def api_import_bank_feed(
    file: UploadFile = File(...),
    client_id: str = Form(...),
    bank_account: str = Form(...),
    pakai_ai: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Upload rekening koran (PDF/Excel), ekstrak mutasi MENTAH-nya (REUSE
    ak.proses_file_rekening_koran -- parser & fallback AI yang sama dengan
    upload rekening koran biasa di halaman Transaksi utama), lalu simpan
    sebagai baris bank_feed_mutation berstatus 'unmatched'. Belum
    dijurnal sama sekali -- itu tetap lewat jalur Cash Payment/Cash
    Receipt yang sudah ada, terpisah dari endpoint ini."""
    isi = await file.read()
    nama_file = file.filename or "rekening-koran.xlsx"

    try:
        hasil = ak.proses_file_rekening_koran(io.BytesIO(isi), nama_file, client_id, pakai_ai)
    except Exception as e:
        logger.exception(f"Gagal ekstrak rekening koran '{nama_file}' untuk Bank Feed: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal memproses file: {e}")

    draf_jurnal = hasil.get("draf_jurnal") or []
    if not draf_jurnal:
        alasan = hasil.get("sheet_dilewati") or []
        raise HTTPException(
            status_code=422,
            detail=" ".join(alasan) if alasan else "Tidak ada baris mutasi yang berhasil dibaca dari file ini.",
        )

    # [BARU] mutasi_debet/mutasi_kredit adalah arah mutasi bank MENTAH yang
    # sudah pasti (lihat catatan di akuntansi_ai.py::proses_file_rekening_koran)
    # -- BUKAN jml_debet/jml_kredit (itu nilai jurnal double-entry, selalu
    # sama besar di kedua sisi, tidak bisa dipakai untuk tahu arah saldo).
    rows_mentah = [
        {
            "tanggal": row.get("tanggal"),
            "keterangan": row.get("keterangan"),
            "debet": row.get("mutasi_debet") or 0,
            "kredit": row.get("mutasi_kredit") or 0,
        }
        for row in draf_jurnal
    ]

    tersimpan = dbc.simpan_bank_feed_mutasi_batch(client_id, bank_account, nama_file, rows_mentah)

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="import_bank_feed",
        detail={"file": nama_file, "bank_account": bank_account, "jumlah_baris": len(tersimpan)},
    )

    return {
        "berhasil": True,
        "diimpor": len(tersimpan),
        "mutations": tersimpan,
        "peringatan": hasil.get("sheet_dilewati") or [],
    }


@router.delete("/{mutation_id}", response_model=HapusBankFeedResponse)
def api_hapus_bank_feed(
    mutation_id: str, client_id: str,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Hapus satu baris mutasi Bank Feed -- dipakai tombol hapus di tab Bank Feed."""
    berhasil = dbc.hapus_bank_feed_mutasi(mutation_id, client_id)
    if not berhasil:
        raise HTTPException(status_code=404, detail="Mutasi Bank Feed tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="hapus_bank_feed_mutasi", detail={"mutation_id": mutation_id},
    )
    return {"berhasil": True}


@router.post("/{mutation_id}/match", response_model=MatchBankFeedResponse)
def api_match_bank_feed(
    mutation_id: str, client_id: str, req: MatchBankFeedRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Cocokkan satu mutasi Bank Feed dengan satu Transaction sistem
    (id berprefix "BC-"/"JE-", lihat bankCashBridge.ts) -- dipakai tab
    Reconciliation, baik lewat kandidat otomatis maupun pilih manual."""
    mutasi = dbc.set_match_bank_feed_mutasi(mutation_id, client_id, req.tx_id)
    if mutasi is None:
        raise HTTPException(status_code=404, detail="Mutasi Bank Feed tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="match_bank_feed_mutasi", detail={"mutation_id": mutation_id, "tx_id": req.tx_id},
    )
    return {"berhasil": True, "mutation": mutasi}


@router.post("/{mutation_id}/unmatch", response_model=UnmatchBankFeedResponse)
def api_unmatch_bank_feed(
    mutation_id: str, client_id: str,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Batalkan pencocokan satu mutasi Bank Feed -- dipakai tombol undo di
    tab Reconciliation, sub-tab Reconciled."""
    mutasi = dbc.set_match_bank_feed_mutasi(mutation_id, client_id, None)
    if mutasi is None:
        raise HTTPException(status_code=404, detail="Mutasi Bank Feed tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="unmatch_bank_feed_mutasi", detail={"mutation_id": mutation_id},
    )
    return {"berhasil": True, "mutation": mutasi}