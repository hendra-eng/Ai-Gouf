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

import asyncio
import io
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

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
    # [BARU] Saldo awal resmi file sumber (dari footer PDF) -- dipakai frontend
    # sebagai saldo pembuka saat menghitung saldo berjalan. None = file tidak
    # punya footer yang terbaca (mis. Excel) -> frontend mulai dari 0 seperti dulu.
    fileOpeningBalance: Optional[float] = None


class DaftarBankFeedResponse(BaseModel):
    mutations: List[BankFeedMutationSkema]


class ImportBankFeedResponse(BaseModel):
    berhasil: bool
    diimpor: int
    mutations: List[BankFeedMutationSkema]
    peringatan: List[str] = []
    saldoAwal: Optional[float] = None
    saldoAkhir: Optional[float] = None


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


def _tanggal_ke_str(v: Any) -> Optional[str]:
    """[FIX] Ekstraksi file Excel mengembalikan tanggal sebagai objek
    datetime.date/datetime, bukan string -- skema respons (date: Optional[str])
    lalu menolaknya ("Input should be a valid string") sehingga endpoint 500
    dan browser hanya melihat "Failed to fetch". Selalu ubah ke string
    YYYY-MM-DD di sini."""
    if v is None or v == "":
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    teks = str(v).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[T ]", teks):
        return teks[:10]
    return teks


def _saldo_dari_footer(ringkasan_footer: Any) -> tuple:
    """[BARU] Ambil (saldo_awal, saldo_akhir) resmi dari ringkasan footer PDF
    (hasil ak.proses_file_rekening_koran, key 'ringkasan_footer', bentuknya
    {nama_sheet: {saldo_awal, mutasi_cr, mutasi_db, saldo_akhir, ...}}).
    Hanya dipakai kalau TEPAT SATU sheet punya saldo_awal -- kalau ada lebih
    dari satu (file multi-sheet) tidak jelas mana yang dimaksud, jadi None
    (frontend mulai dari 0 seperti perilaku lama, bukan menebak)."""
    if not isinstance(ringkasan_footer, dict) or not ringkasan_footer:
        return None, None
    if "saldo_awal" in ringkasan_footer:  # bentuk datar (1 sheet)
        kandidat = [ringkasan_footer]
    else:
        kandidat = [
            v for v in ringkasan_footer.values()
            if isinstance(v, dict) and v.get("saldo_awal") is not None
        ]
    if len(kandidat) != 1:
        return None, None
    try:
        awal = kandidat[0].get("saldo_awal")
        akhir = kandidat[0].get("saldo_akhir")
        return (
            float(awal) if awal is not None else None,
            float(akhir) if akhir is not None else None,
        )
    except (TypeError, ValueError):
        return None, None


def _bangun_mutasi_sementara(
    bank_account: str, source_file: str, rows: List[Dict[str, Any]],
    saldo_awal: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """[BARU] Bentuk baris mutasi Bank Feed TANPA menyimpan ke database --
    dipakai mode simpan=False (Bank Feed sekarang murni sesi browser, lihat
    BankFeedContext.tsx). Bentuk dict-nya sama persis dengan
    dbc._bank_feed_ke_dict() supaya skema respons tidak berubah. Saldo
    berjalan dihitung dari saldo_awal (footer PDF; 0 kalau tidak ada) per file;
    frontend yang menghitung ulang bersambung per akun bank kalau ada beberapa
    file dalam satu sesi."""
    saldo = float(saldo_awal) if saldo_awal is not None else 0.0
    now = datetime.now().isoformat()
    baru: List[Dict[str, Any]] = []
    for r in sorted(rows, key=lambda x: x.get("tanggal") or ""):
        debet = float(r.get("debet") or 0)
        kredit = float(r.get("kredit") or 0)
        saldo = saldo + kredit - debet
        baru.append({
            "id": str(uuid.uuid4()),
            "bankAccount": bank_account,
            "date": r.get("tanggal"),
            "description": r.get("keterangan"),
            "debit": debet,
            "credit": kredit,
            "balanceAfter": saldo,
            "status": "unmatched",
            "matchedTxId": None,
            "sourceFile": source_file,
            "uploadedAt": now,
            "fileOpeningBalance": saldo_awal,
        })
    return list(reversed(baru))  # terbaru dulu, sama seperti versi DB


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
    simpan: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Upload rekening koran (PDF/Excel), ekstrak mutasi MENTAH-nya (REUSE
    ak.proses_file_rekening_koran -- parser & fallback AI yang sama dengan
    upload rekening koran biasa di halaman Transaksi utama), lalu simpan
    sebagai baris bank_feed_mutation berstatus 'unmatched'. Belum
    dijurnal sama sekali -- itu tetap lewat jalur Cash Payment/Cash
    Receipt yang sudah ada, terpisah dari endpoint ini.

    [BARU] simpan=False -> hasil ekstraksi HANYA dikembalikan ke browser,
    TIDAK ditulis ke tabel bank_feed_mutation (mode sesi; dipakai frontend
    Bank Feed sekarang). simpan=True (default) = perilaku lama, tersimpan
    permanen di database."""
    isi = await file.read()
    nama_file = file.filename or "rekening-koran.xlsx"

    try:
        # [FIX -- BUG BESAR] Sebelumnya proses_file_rekening_koran (berat --
        # parsing PDF + puluhan panggilan AI kategorisasi) dipanggil LANGSUNG
        # secara sinkron di dalam endpoint async ini. Karena uvicorn jalan
        # single-thread event loop, ini MEMBEKUKAN SELURUH SERVER selama
        # proses berlangsung -- request lain (bahkan yang tidak berhubungan,
        # mis. GET /coa) ikut macet/timeout ("socket hang up") sampai upload
        # ini selesai. Sekarang dijalankan lewat asyncio.to_thread supaya
        # event loop tetap bisa melayani request lain selama proses ini
        # jalan di background thread.
        #
        # model_kategorisasi="claude-sonnet-5" -- KHUSUS jalur Bank Feed
        # ini supaya proses kategorisasi lebih cepat (sebelumnya default
        # global claude-opus-5 / CLAUDE_MODEL_KATEGORISASI bikin ±8 menit).
        # paralel_maks_kategorisasi=12 -- KHUSUS jalur ini juga, dinaikkan
        # dari default global 6 supaya lebih banyak chunk jalan bersamaan,
        # berguna terutama utk statement BESAR (puluhan-ratusan halaman,
        # ratusan-ribuan baris transaksi). Tidak mengubah default jalur
        # import rekening koran umum di halaman Transaksi -- lihat
        # docstring proses_file_rekening_koran().
        hasil = await asyncio.to_thread(
            ak.proses_file_rekening_koran,
            io.BytesIO(isi), nama_file, client_id, pakai_ai,
            model_kategorisasi="claude-sonnet-5",
            paralel_maks_kategorisasi=12,
        )
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
            "tanggal": _tanggal_ke_str(row.get("tanggal")),
            "keterangan": row.get("keterangan"),
            "debet": row.get("mutasi_debet") or 0,
            "kredit": row.get("mutasi_kredit") or 0,
        }
        for row in draf_jurnal
    ]

    peringatan = list(hasil.get("sheet_dilewati") or [])
    saldo_awal, saldo_akhir = _saldo_dari_footer(hasil.get("ringkasan_footer"))
    if saldo_awal is not None and saldo_akhir is not None:
        hitung_akhir = saldo_awal + sum(float(r["kredit"]) - float(r["debet"]) for r in rows_mentah)
        if abs(hitung_akhir - saldo_akhir) > 1.0:
            peringatan.append(
                f"Saldo akhir hasil ekstraksi ({hitung_akhir:,.2f}) tidak sama dengan saldo akhir di footer "
                f"rekening koran ({saldo_akhir:,.2f}) -- cek apakah ada baris yang terlewat."
            )

    if simpan:
        tersimpan = dbc.simpan_bank_feed_mutasi_batch(client_id, bank_account, nama_file, rows_mentah)
    else:
        tersimpan = _bangun_mutasi_sementara(bank_account, nama_file, rows_mentah, saldo_awal)

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="import_bank_feed",
        detail={"file": nama_file, "bank_account": bank_account, "jumlah_baris": len(tersimpan), "disimpan_ke_db": simpan},
    )

    return {
        "berhasil": True,
        "diimpor": len(tersimpan),
        "mutations": tersimpan,
        "peringatan": peringatan,
        "saldoAwal": saldo_awal,
        "saldoAkhir": saldo_akhir,
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