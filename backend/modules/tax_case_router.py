"""
modules/tax_case_router.py
Endpoint API untuk fitur case law, prediksi, risk scoring, memo, histori,
folio, dan diagram (fitur-fitur ala Blue J di atas fondasi RAG yang
sudah ada di modules/tax_router.py & modules/tax_rag.py).

Pasang ke main.py:

    from modules.tax_case_router import router as tax_case_router
    app.include_router(tax_case_router, prefix="/tax/cases", tags=["tax-case-law"])

Permission:
- Endpoint sensitif (/predict, /risk-score, /ingest) butuh auth.require_level(3)
  (Supervisor ke atas), sama seperti endpoint sensitif lain di main.py.
- Endpoint lain (list/get case, memo, diagram, history, folios) cukup
  auth.get_current_user (staf mana pun yang sudah login).

[Tahap 4 - SELESAI] TODO lama "Simpan log_interaction() ke
modules/tax_history.py di endpoint /predict & /risk-score juga" sekarang
sudah dikerjakan -- lihat _catat_histori_interaksi() di bawah dan
pemanggilannya di endpoint predict() & risk_score().

Kenapa ini penting (bukan cuma "supaya TODO hilang"): /predict &
/risk-score menghasilkan opini AI tentang KEMUNGKINAN MENANG/KALAH suatu
posisi pajak di sengketa -- ini output yang JAUH lebih sensitif daripada
sekadar tanya-jawab riset biasa (/tax/ask), karena bisa memengaruhi
keputusan strategi klien firma. Sebelum perbaikan ini, kalau ada prediksi
yang keliru dan baru ketahuan berbulan-bulan kemudian, TIDAK ADA jejak
sama sekali siapa yang meminta prediksi itu, kapan, dan apa isi
lengkapnya -- audit/investigasi jadi mustahil. Sekarang setiap panggilan
/predict & /risk-score tercatat, dengan input & output LENGKAP (bukan
cuma ringkasan), supaya kalau nanti prediksi itu terbukti salah, firma
bisa menelusuri persis apa yang AI katakan dan berdasarkan kasus apa.

PRINSIP KEAMANAN (sama seperti tax_qa_log.py di modules/tax_rag.py):
kegagalan mencatat histori TIDAK BOLEH menggagalkan endpoint. Staf tetap
harus dapat hasil prediksi/risk-score-nya walau, misalnya, penyimpanan
histori sedang bermasalah. Kegagalan logging dicatat ke logger teknis
biasa (modules/logging_config.py), bukan dilempar sebagai error ke user.

[KONFIRMASI] Signature modules/tax_history.py sudah dicek terhadap kode
aslinya:

    def log_interaction(
        question: str,
        answer: str,
        user_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> HistoryEntry: ...

Dipanggil di sini pakai keyword arguments (bukan positional), jadi urutan
parameter yang berbeda dari perkiraan awal TIDAK jadi masalah.

[FIX] Satu penyesuaian diperlukan: HistoryEntry.user_id di schemas.py
bertipe Optional[str], sedangkan modules/auth.py bisa mengembalikan
user["id"] sebagai int (mis. akun fallback punya id=0, dan ID dari
database sungguhan lazimnya integer auto-increment). Pydantic v2 tidak
otomatis mengonversi int->str untuk field bertipe str, jadi
_catat_histori_interaksi() di bawah membungkus user_id dengan str()
sebelum dikirim ke log_interaction() -- tanpa ini, logging akan diam-diam
SELALU gagal (tertangkap try/except, tapi tidak pernah benar-benar
tercatat) kalau id-nya berupa int.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from modules import auth, tax_case_law, tax_case_ingestion, tax_history, tax_folios
from modules.logging_config import get_logger
from modules.schemas import (
    CourtCase,
    PredictionResult,
    RiskScoreResult,
    MemoRequest,
    MemoResponse,
    DiagramRequest,
    DiagramResponse,
    TaxFolio,
)
from modules.tax_prediction import predict_outcome
from modules.risk_scoring import score_position
from modules.tax_memo import generate_memo
from modules.tax_diagram import generate_diagram

router = APIRouter()
logger = get_logger("tax_case_router")


# ---------- Ingest case law ----------
class IngestCaseRequest(BaseModel):
    nomor_putusan: str
    pengadilan: str
    full_text: str
    ringkasan: str = ""
    jenis_sengketa: Optional[str] = None
    amar_putusan: Optional[str] = None


@router.post("/ingest", response_model=CourtCase)
def ingest_case(
    payload: IngestCaseRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    return tax_case_ingestion.ingest_case(**payload.model_dump())


@router.get("", response_model=List[CourtCase])
def list_cases(
    jenis_sengketa: Optional[str] = None,
    user: dict = Depends(auth.get_current_user),
):
    return tax_case_law.list_cases(jenis_sengketa=jenis_sengketa)


# ---------- Histori interaksi sensitif (predict & risk-score) ----------
def _catat_histori_interaksi(
    user: dict,
    client_id: Optional[str],
    question: str,
    answer: str,
    nama_endpoint: str,
) -> None:
    """
    [Tahap 4] Catat interaksi predict/risk-score ke modules/tax_history.py,
    supaya muncul di endpoint GET /history/list yang sudah ada dan bisa
    ditelusuri sama seperti histori tanya-jawab biasa.

    `question` & `answer` di sini SENGAJA disimpan APA ADANYA/LENGKAP
    (bukan ringkasan terpotong) -- kalau nanti ada sengketa soal prediksi
    yang keliru, firma butuh tahu PERSIS apa yang diminta staf dan PERSIS
    apa yang dikatakan AI, bukan versi yang sudah dipangkas.

    Try/except lebar di sini disengaja (bukan kelalaian): endpoint
    predict()/risk_score() HARUS tetap mengembalikan hasilnya ke staf
    walau pencatatan histori gagal karena sebab apa pun (disk penuh, lock
    timeout, tax_history.py error internal, dll). Kegagalan logging bukan
    alasan untuk menggagalkan pekerjaan staf yang sedang butuh jawaban.
    """
    try:
        # [FIX] modules/schemas.py HistoryEntry.user_id bertipe Optional[str],
        # tapi modules/auth.py bisa mengembalikan user["id"] sebagai int
        # (mis. akun fallback _FALLBACK_USER punya "id": 0, dan ID dari
        # database sungguhan lazimnya integer auto-increment). Pydantic v2
        # TIDAK otomatis mengonversi int->str untuk field bertipe str --
        # tanpa str() di sini, log_interaction() akan melempar
        # ValidationError SETIAP KALI dipanggil kalau id-nya int, tertangkap
        # oleh except di bawah, sehingga logging akan diam-diam SELALU
        # gagal (bukan cuma sesekali saat error storage) -- persis
        # kebalikan dari tujuan audit trail ini.
        user_id_raw = user.get("id")
        tax_history.log_interaction(
            user_id=str(user_id_raw) if user_id_raw is not None else None,
            client_id=client_id,
            question=question,
            answer=answer,
        )
    except Exception:
        logger.exception(
            f"Gagal mencatat histori interaksi ({nama_endpoint}) untuk "
            f"user_id={user.get('id')}"
        )


def _format_prediction_untuk_histori(position_text: str, result: PredictionResult) -> str:
    """
    Format PredictionResult jadi teks yang bisa dibaca manusia di histori --
    BUKAN cuma result.predicted_outcome saja, tapi termasuk confidence,
    reasoning, dan kasus-kasus serupa yang jadi rujukan, supaya kalau
    prediksi ini dipertanyakan belakangan, semua konteks yang dipakai AI
    saat itu masih bisa dibaca lengkap dari histori tanpa perlu mengulang
    panggilan predict_outcome() (yang hasilnya bisa saja berbeda kalau
    database kasus sudah berubah sejak saat itu).
    """
    kasus_serupa = ", ".join(result.similar_cases) if result.similar_cases else "-"
    return (
        f"Prediksi: {result.predicted_outcome}\n"
        f"Confidence: {result.confidence:.2f}\n"
        f"Kasus serupa yang dirujuk: {kasus_serupa}\n"
        f"Alasan: {result.reasoning}"
    )


def _format_risk_score_untuk_histori(position_text: str, result: RiskScoreResult) -> str:
    """Sama seperti _format_prediction_untuk_histori() -- simpan konteks
    lengkap (faktor risiko & kasus pendukung), bukan cuma angka skornya."""
    faktor = "; ".join(result.factors) if result.factors else "-"
    kasus_pendukung = ", ".join(result.supporting_cases) if result.supporting_cases else "-"
    return (
        f"Risk score: {result.risk_score:.1f}/100 ({result.risk_level})\n"
        f"Faktor risiko: {faktor}\n"
        f"Kasus pendukung: {kasus_pendukung}"
    )


# ---------- Prediksi & risiko ----------
class PredictRequest(BaseModel):
    position_text: str
    top_k: int = 5
    client_id: Optional[str] = None  # [Tahap 4] opsional, ditaut ke histori


@router.post("/predict", response_model=PredictionResult)
def predict(
    payload: PredictRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    result = predict_outcome(payload.position_text, top_k=payload.top_k)

    _catat_histori_interaksi(
        user=user,
        client_id=payload.client_id,
        question=payload.position_text,
        answer=_format_prediction_untuk_histori(payload.position_text, result),
        nama_endpoint="/tax/cases/predict",
    )

    return result


@router.post("/risk-score", response_model=RiskScoreResult)
def risk_score(
    payload: PredictRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    result = score_position(payload.position_text, top_k=payload.top_k)

    _catat_histori_interaksi(
        user=user,
        client_id=payload.client_id,
        question=payload.position_text,
        answer=_format_risk_score_untuk_histori(payload.position_text, result),
        nama_endpoint="/tax/cases/risk-score",
    )

    return result


# ---------- Memo ----------
@router.post("/memo", response_model=MemoResponse)
def memo(payload: MemoRequest, user: dict = Depends(auth.get_current_user)):
    return generate_memo(payload)


# ---------- Diagram ----------
@router.post("/diagram", response_model=DiagramResponse)
def diagram(payload: DiagramRequest, user: dict = Depends(auth.get_current_user)):
    return generate_diagram(payload)


# ---------- Histori ----------
@router.get("/history/list")
def history(
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(auth.get_current_user),
):
    return tax_history.get_history(user_id=user_id, client_id=client_id, limit=limit)


# ---------- Folio ----------
@router.post("/folios", response_model=TaxFolio)
def create_folio(
    title: str, topic: str, description: str = "",
    user: dict = Depends(auth.get_current_user),
):
    return tax_folios.create_folio(title=title, topic=topic, description=description)


@router.get("/folios", response_model=List[TaxFolio])
def list_folios(topic: Optional[str] = None, user: dict = Depends(auth.get_current_user)):
    return tax_folios.list_folios(topic=topic)


# ---------- Detail kasus (HARUS didaftarkan PALING AKHIR) ----------
# Route dengan path parameter satu-segmen (/{case_id}) akan "menelan" semua
# request GET satu-segmen lain di router ini (mis. /folios, /history akan
# bentrok kalau /{case_id} didaftarkan lebih dulu). FastAPI mencocokkan
# route sesuai urutan didaftarkan, jadi route literal harus selalu di atas
# route dinamis seperti ini.
@router.get("/{case_id}", response_model=CourtCase)
def get_case(case_id: str, user: dict = Depends(auth.get_current_user)):
    case = tax_case_law.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Kasus tidak ditemukan.")
    return case