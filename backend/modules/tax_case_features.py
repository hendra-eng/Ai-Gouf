"""
modules/tax_case_features.py
Ekstraksi fitur terstruktur dari putusan (CaseFeatures): argumen pemohon,
argumen termohon, dasar hukum yang dipakai, dan kata kunci. Dipakai
sebagai dasar prediksi hasil sengketa (modules/tax_prediction.py).

Versi dasar ini pakai heuristik & regex sederhana (deteksi kata kunci
"pemohon banding", pola "Pasal ... UU/PMK ...", dsb). Untuk akurasi lebih
tinggi, ganti isi extract_features() dengan pemanggilan LLM (mis. lewat
modules/ai_analysis.py yang sudah ada) tanpa perlu mengubah signature.
"""
from __future__ import annotations

import re
from typing import List, Optional

from modules.schemas import CaseFeatures, CourtCase
from modules import storage

TABLE = "case_features"

_DASAR_HUKUM_RE = re.compile(
    r"(?:Pasal\s+\d+[A-Za-z]?(?:\s+ayat\s*\(\d+\))?\s+(?:UU|PP|PMK|PER|SE)[^.,;\n]{0,40}|"
    r"(?:UU|PP|PMK|PER|SE)\s+No\.?\s*[\w./-]+\s*(?:Tahun\s*\d{4})?)",
    re.IGNORECASE,
)

_PEMOHON_MARKERS = ["pemohon banding", "menurut pemohon", "wajib pajak berpendapat", "dalil pemohon"]
_TERMOHON_MARKERS = ["terbanding", "menurut terbanding", "dirjen pajak berpendapat", "dalil terbanding"]

_STOPWORDS = {"dengan", "adalah", "tersebut", "sebagai", "kepada", "menurut", "dalam", "untuk"}


def _extract_sentences_near(text: str, markers: List[str], max_items: int = 5) -> List[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    lowered_markers = [m.lower() for m in markers]
    hits: List[str] = []
    for s in sentences:
        low = s.lower()
        if any(m in low for m in lowered_markers):
            hits.append(s.strip())
        if len(hits) >= max_items:
            break
    return hits


def _extract_keywords(text: str, top_n: int = 10) -> List[str]:
    words = re.findall(r"[a-zA-Z]{5,}", text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w in _STOPWORDS:
            continue
        freq[w] = freq.get(w, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)
    return [w for w, _ in ranked[:top_n]]


def extract_features(case: CourtCase) -> CaseFeatures:
    text = case.full_text or case.ringkasan
    features = CaseFeatures(
        case_id=case.id,
        jenis_sengketa=case.jenis_sengketa,
        argumen_pemohon=_extract_sentences_near(text, _PEMOHON_MARKERS),
        argumen_termohon=_extract_sentences_near(text, _TERMOHON_MARKERS),
        dasar_hukum=list(dict.fromkeys(_DASAR_HUKUM_RE.findall(text)))[:15],
        hasil=case.amar_putusan,
        keywords=_extract_keywords(text),
    )
    storage.upsert(TABLE, case.id, features.model_dump(mode="json"))
    return features


def get_features(case_id: str) -> Optional[CaseFeatures]:
    record = storage.get(TABLE, case_id)
    return CaseFeatures(**record) if record else None


def list_features() -> List[CaseFeatures]:
    return [CaseFeatures(**r) for r in storage.list_all(TABLE)]