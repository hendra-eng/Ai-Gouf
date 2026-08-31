"""
tax_router.py

Dasar: endpoint API untuk fitur riset pajak.
Asumsi framework: FastAPI (menyesuaikan pola project kamu di main.py).

Cara pasang ke main.py yang sudah ada:

    from modules.tax_router import router as tax_router
    app.include_router(tax_router, prefix="/tax", tags=["tax-research"])

[Tahap 4.3] client_id ditambahkan di request body (opsional) supaya audit
log (modules/tax_qa_log.py) bisa menaut pertanyaan ke klien tertentu, bukan
cuma ke user staf yang bertanya -- berguna untuk laporan "riset apa saja
yang sudah dilakukan untuk klien X".

user_id diambil dari auth.get_current_user (field "id" -- lihat
modules/auth.py: decode_token() mengembalikan dict dengan key "id").

TODO nanti (versi serius):
- Tambah endpoint /tax/regulations untuk browse peraturan mentah
- Tambah endpoint /tax/cases untuk cari putusan pengadilan

[Tahap 4 - rapi-rapi] Import modules.tax_qa_log sebelumnya sengaja ditaruh
di DALAM tiap fungsi endpoint (bukan di atas file bersama import lain) --
alasan aslinya cuma "cepat waktu itu", bukan ada alasan teknis (mis. tidak
ada circular import antara tax_router.py <-> tax_qa_log.py). Sekarang
dirapikan jadi import biasa di atas seperti modules lain di file ini.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import requests

from modules import auth
from modules.tax_rag import ask_tax_question, TaxRagError, FilterTidakValid
from modules.tax_qa_log import list_logs, archive_old_logs, rebuild_archive_index
from modules.audit_activity import get_combined_activity

router = APIRouter()


class TaxQuestionRequest(BaseModel):
    query: str
    top_k: int = 5
    client_id: Optional[str] = None  # [Tahap 4.3] opsional, untuk audit log
    # [Tahap 4 - no.4] BARU -- sebelumnya schemas.AskRequest sudah punya
    # field "filters" tapi endpoint /tax/ask ini sebenarnya memakai
    # TaxQuestionRequest (class lokal ini), BUKAN schemas.AskRequest, jadi
    # filters di AskRequest itu efektif tidak pernah tersambung ke mana pun.
    # Field ini yang sekarang benar-benar dipakai. Key yang didukung:
    # "jenis" (mis. "PMK"/"UU"/"PER"/"SE"/"Putusan"), "status"
    # (mis. "berlaku"/"dicabut"/"diubah"), "document_id", "case_id", "nomor"
    # -- lihat modules/tax_rag.py:FILTER_FIELDS_VALID. Contoh body request:
    # {"query": "...", "filters": {"jenis": "PMK", "status": "berlaku"}}
    filters: dict = Field(default_factory=dict)


class SourceItem(BaseModel):
    nomor: str
    jenis: str
    judul: str
    status: str
    cuplikan: str
    score: float


class TaxAnswerResponse(BaseModel):
    jawaban: str
    sumber: list[SourceItem]


@router.post("/ask", response_model=TaxAnswerResponse)
def ask(payload: TaxQuestionRequest, user: dict = Depends(auth.get_current_user)):
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="Pertanyaan tidak boleh kosong.")

    try:
        result = ask_tax_question(
            payload.query,
            top_k=payload.top_k,
            user_id=user.get("id"),
            client_id=payload.client_id,
            filters=payload.filters,
        )
    except FilterTidakValid as e:
        # [Tahap 4 - no.4] Field filter salah ketik/tidak dikenal -- ini
        # kesalahan INPUT USER, bukan kesalahan setup server, jadi 400 (dan
        # ditangani SEBELUM except TaxRagError umum di bawah, karena
        # FilterTidakValid adalah subclass TaxRagError -- kalau urutannya
        # dibalik, except TaxRagError akan menangkapnya duluan dan salah
        # mengembalikan 500).
        raise HTTPException(status_code=400, detail=str(e))
    except TaxRagError as e:
        # Konfigurasi belum lengkap (mis. ANTHROPIC_API_KEY belum di-set) --
        # ini salah setup, bukan salah user, jadi 500 dengan pesan jelas.
        raise HTTPException(status_code=500, detail=str(e))
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal menghubungi layanan AI untuk menjawab pertanyaan: {e}",
        )
    return TaxAnswerResponse(jawaban=result.jawaban, sumber=result.sumber)


@router.get("/qa-log")
def qa_log(
    client_id: Optional[str] = None,
    limit: int = 50,
    include_archived: bool = False,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [Tahap 4.3] Endpoint untuk staf Supervisor+ meninjau audit log Q&A --
    dipakai untuk spot-check kualitas jawaban AI (Tahap 4.2) langsung dari
    riwayat pemakaian sungguhan, bukan cuma dari pertanyaan uji manual.

    [Tahap 4 - retensi] include_archived=False (default) cuma baca log
    aktif (cepat, cocok untuk spot-check rutin). include_archived=True
    ikut baca semua tabel arsip bulanan -- lebih lambat, dipakai untuk
    laporan audit menyeluruh yang perlu menjangkau riwayat lama yang
    sudah dipindah oleh /tax/qa-log/archive.
    """
    return list_logs(client_id=client_id, limit=limit, include_archived=include_archived)


@router.get("/activity")
def activity(
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 50,
    include_archived_qa: bool = False,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [Tahap 4 - no.5] Laporan gabungan SEMUA aktivitas AI oleh staf/untuk
    klien tertentu -- menggabungkan modules/tax_history.py (hasil
    /tax/cases/predict & /tax/cases/risk-score) dengan
    modules/tax_qa_log.py (hasil /tax/ask), diurut waktu terbaru dulu.

    Dipisah dari GET /tax/qa-log (yang HANYA berisi tanya-jawab biasa) --
    endpoint ini untuk kebutuhan audit/compliance yang perlu melihat
    SELURUH jejak interaksi AI seorang staf atau untuk seorang klien
    dalam satu tampilan, termasuk prediksi outcome sengketa & risk score
    yang levelnya lebih sensitif (lihat penjelasan di
    modules/tax_case_router.py kenapa /predict & /risk-score juga wajib
    ter-log).

    Level akses sama seperti /tax/qa-log (Supervisor ke atas) karena data
    gabungan ini bisa memuat opini AI soal kemungkinan menang/kalah
    sengketa klien -- lebih sensitif daripada tanya-jawab riset biasa.
    """
    return get_combined_activity(
        user_id=user_id,
        client_id=client_id,
        limit=limit,
        include_archived_qa=include_archived_qa,
    )


@router.post("/qa-log/archive")
def qa_log_archive(
    retention_months: Optional[int] = None,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [Tahap 4 - retensi] Pindahkan entri qa_audit_log yang lebih tua dari
    `retention_months` bulan (default: env TAX_QA_LOG_RETENTION_MONTHS,
    fallback 6 bulan -- lihat modules/tax_qa_log.py) ke tabel arsip
    bulanan, supaya qa_audit_log.json tidak terus membesar tanpa batas
    seiring pemakaian harian.

    Aman dipanggil berulang kali (idempotent) dan aman dipanggil sambil
    ada staf lain sedang bertanya lewat /tax/ask (tidak akan kehilangan
    entri yang baru masuk selagi proses arsip berjalan). Untuk pemakaian
    rutin, jadwalkan panggilan endpoint ini (mis. sekali sebulan lewat
    modules/tax_scheduler.py atau cron eksternal) alih-alih memanggilnya
    manual terus-menerus.
    """
    try:
        return archive_old_logs(retention_months=retention_months)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/qa-log/rebuild-index")
def qa_log_rebuild_index(user: dict = Depends(auth.require_level(3))):  # Supervisor ke atas
    """
    [Tahap 4 - retensi] Bangun ulang index pencarian arsip
    (qa_audit_log_index) dari nol dengan men-scan seluruh tabel arsip.

    Jalankan ini SEKALI setelah upgrade ke versi archive_old_logs() yang
    memakai index (entri lama yang sudah terlanjur diarsipkan sebelumnya
    belum punya index -- get_log() tetap benar untuknya, cuma lebih
    lambat, sampai index ini dibangun). Juga berguna untuk recovery kalau
    index dicurigai tidak sinkron. Aman dijalankan berulang & sambil
    sistem tetap berjalan -- fungsi ini cuma MEMBACA tabel arsip, tidak
    pernah mengubah data Q&A yang sudah ada.
    """
    return rebuild_archive_index()