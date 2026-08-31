"""
modules/schemas.py
Shared Pydantic models dipakai di seluruh modules backend.
File ini BARU (belum ada di daftar awal) tapi dibutuhkan supaya semua
modul lain punya struktur data yang konsisten dan bisa saling terhubung.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class DocType(str, Enum):
    UU = "UU"
    PP = "PP"
    PMK = "PMK"
    PER = "PER"
    SE = "SE"
    PUTUSAN_PP = "PUTUSAN_PENGADILAN_PAJAK"
    PUTUSAN_MA = "PUTUSAN_MA"
    LAINNYA = "LAINNYA"


class RegulationStatus(str, Enum):
    BERLAKU = "berlaku"
    DICABUT = "dicabut"
    DIUBAH = "diubah"
    TIDAK_DIKETAHUI = "tidak_diketahui"


class TaxCategory(str, Enum):
    """
    [Tahap 3] Kategori/jenis pajak -- daftar prioritas dari Tahap 1, dipakai
    untuk filter & spot-check per jenis pajak (Tahap 4). Ini beda dari
    DocType (level dokumen: UU/PP/PMK/dst) -- satu PMK bisa saja mengatur
    lebih dari satu jenis pajak di dunia nyata, tapi untuk versi awal ini
    cukup satu kategori dominan per dokumen. Kalau nanti perlu banyak
    kategori sekaligus per dokumen, ganti field ini jadi
    List[TaxCategory] di SourceDocument (dan manifest CSV dipisah titik-koma).
    """
    PPH_21 = "PPh 21"
    PPH_23 = "PPh 23"
    PPH_26 = "PPh 26"
    PPH_29 = "PPh 29"
    PPH_FINAL_UMKM = "PPh Final UMKM"
    PPN = "PPN"
    PPNBM = "PPnBM"
    PBB = "PBB"
    BEA_METERAI = "Bea Meterai"
    LAINNYA = "Lainnya"


class SourceDocument(BaseModel):
    id: str
    title: str
    doc_type: DocType
    nomor: Optional[str] = None
    tahun: Optional[int] = None
    tanggal_terbit: Optional[datetime] = None
    kategori_pajak: Optional[TaxCategory] = None
    status: RegulationStatus = RegulationStatus.TIDAK_DIKETAHUI
    status_note: Optional[str] = None
    url_sumber: Optional[str] = None
    full_text: str = ""
    metadata: dict = Field(default_factory=dict)

    # [Tahap 5, poin 16] ID dokumen (SourceDocument.id) lain di sistem ini
    # yang MENGGANTIKAN dokumen ini -- diisi lewat
    # modules.tax_ingestion.tandai_digantikan() saat proses update bulanan
    # menemukan PMK/PER baru yang mencabut/mengubah aturan lama.
    #
    # Sengaja disimpan sebagai link SATU ARAH (dokumen lama -> dokumen
    # baru), bukan dua arah -- dokumen baru tidak perlu tahu "aku
    # menggantikan siapa" sebagai field permanen, itu cukup ditelusuri
    # balik lewat pencarian document_id yang punya digantikan_oleh == id
    # dokumen baru, kalau suatu saat dibutuhkan (mis. utk laporan "riwayat
    # perubahan aturan X"). Field ini HANYA relevan/diisi kalau status
    # sudah DICABUT atau DIUBAH -- untuk dokumen berstatus BERLAKU,
    # nilainya selalu None.
    digantikan_oleh: Optional[str] = None


class Chunk(BaseModel):
    id: str
    document_id: str
    text: str
    chunk_index: int
    metadata: dict = Field(default_factory=dict)


class CitedChunk(BaseModel):
    chunk: Chunk
    score: float
    document: Optional[SourceDocument] = None


class AskRequest(BaseModel):
    """
    [Tahap 4 - no.4, catatan] Model ini TIDAK dipakai langsung sebagai
    request body endpoint POST /tax/ask -- endpoint itu memakai
    TaxQuestionRequest (class lokal di modules/tax_router.py, field beda:
    "query" bukan "question", tidak ada "user_id" karena diambil dari
    auth). Field `filters` yang benar-benar tersambung ke pencarian ada di
    TaxQuestionRequest.filters (lihat modules/tax_router.py &
    modules/tax_rag.py:FILTER_FIELDS_VALID). Kalau class ini nanti mau
    dipakai sungguhan menggantikan TaxQuestionRequest, samakan dulu nama
    fieldnya.
    """
    question: str
    top_k: int = 5
    filters: dict = Field(default_factory=dict)
    user_id: Optional[str] = None
    client_id: Optional[str] = None


class AskResponse(BaseModel):
    answer: str
    citations: List[CitedChunk]
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CourtCase(BaseModel):
    id: str
    nomor_putusan: str
    pengadilan: str  # "Pengadilan Pajak" / "Mahkamah Agung"
    tanggal_putusan: Optional[datetime] = None
    para_pihak: Optional[str] = None
    jenis_sengketa: Optional[str] = None
    ringkasan: str = ""
    full_text: str = ""
    amar_putusan: Optional[str] = None  # dikabulkan / ditolak / dst
    url_sumber: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class CaseFeatures(BaseModel):
    case_id: str
    jenis_sengketa: Optional[str] = None
    argumen_pemohon: List[str] = Field(default_factory=list)
    argumen_termohon: List[str] = Field(default_factory=list)
    dasar_hukum: List[str] = Field(default_factory=list)
    hasil: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)


class PredictionResult(BaseModel):
    query_case_id: Optional[str] = None
    query_text: str
    similar_cases: List[str]
    predicted_outcome: str
    confidence: float
    reasoning: str


class RiskScoreResult(BaseModel):
    position_text: str
    risk_score: float  # 0-100
    risk_level: str  # rendah / sedang / tinggi
    factors: List[str]
    supporting_cases: List[str] = Field(default_factory=list)


class TaxFolio(BaseModel):
    id: str
    title: str
    topic: str
    description: str = ""
    document_ids: List[str] = Field(default_factory=list)
    case_ids: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DiagramRequest(BaseModel):
    topic: str
    question: Optional[str] = None


class DiagramResponse(BaseModel):
    topic: str
    mermaid_code: str
    explanation: str


class MemoRequest(BaseModel):
    question: str
    answer: str
    citations: List[CitedChunk] = Field(default_factory=list)
    client_id: Optional[str] = None
    author: Optional[str] = None


class MemoResponse(BaseModel):
    title: str
    body_markdown: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class HistoryEntry(BaseModel):
    id: str
    user_id: Optional[str] = None
    client_id: Optional[str] = None
    question: str
    answer: str
    created_at: datetime = Field(default_factory=datetime.utcnow)