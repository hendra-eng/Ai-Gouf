"""
modules/tax_prediction.py
Prediksi kemungkinan hasil sengketa pajak berdasarkan kemiripan dengan
putusan-putusan sebelumnya (case law) yang sudah diindeks di vector store.

Versi dasar ini pakai voting berbobot skor kemiripan - bukan model machine
learning terlatih. Cukup untuk MVP; nanti bisa diganti classifier
sungguhan (dilatih di atas modules/tax_case_features.py) tanpa mengubah
signature predict_outcome(), karena dipakai langsung oleh
modules/risk_scoring.py.
"""
from __future__ import annotations

from collections import defaultdict

from modules.schemas import PredictionResult
from modules.embedding import embed_text
from modules.vector_store import default_store
from modules import tax_case_law

_OUTCOME_UNKNOWN = "tidak_cukup_data"


def predict_outcome(query_text: str, top_k: int = 5) -> PredictionResult:
    query_vector = embed_text(query_text).tolist()
    # Ambil lebih banyak chunk dulu karena beberapa chunk bisa berasal dari kasus yang sama.
    results = default_store.search(query_vector, top_k=top_k * 3)

    best_score_per_case: dict[str, float] = {}
    for r in results:
        case_id = getattr(r.chunk.metadata, "case_id", None)
        if not case_id:
            continue
        if case_id not in best_score_per_case or r.score > best_score_per_case[case_id]:
            best_score_per_case[case_id] = r.score

    ranked_case_ids = sorted(best_score_per_case, key=best_score_per_case.get, reverse=True)[:top_k]

    if not ranked_case_ids:
        return PredictionResult(
            query_text=query_text,
            similar_cases=[],
            predicted_outcome=_OUTCOME_UNKNOWN,
            confidence=0.0,
            reasoning="Belum ada kasus serupa yang cukup mirip di database untuk dijadikan dasar prediksi.",
        )

    outcome_weight: dict[str, float] = defaultdict(float)
    case_summaries = []
    for case_id in ranked_case_ids:
        case = tax_case_law.get_case(case_id)
        if not case or not case.amar_putusan:
            continue
        weight = best_score_per_case[case_id]
        outcome_weight[case.amar_putusan] += weight
        case_summaries.append(f"{case.nomor_putusan} ({case.amar_putusan}, skor {weight:.2f})")

    if not outcome_weight:
        return PredictionResult(
            query_text=query_text,
            similar_cases=ranked_case_ids,
            predicted_outcome=_OUTCOME_UNKNOWN,
            confidence=0.0,
            reasoning="Kasus serupa ditemukan tapi belum punya label amar_putusan yang lengkap.",
        )

    total_weight = sum(outcome_weight.values())
    predicted_outcome = max(outcome_weight, key=outcome_weight.get)
    confidence = outcome_weight[predicted_outcome] / total_weight if total_weight else 0.0

    reasoning = f"Berdasarkan {len(ranked_case_ids)} kasus paling mirip: " + "; ".join(case_summaries)

    return PredictionResult(
        query_text=query_text,
        similar_cases=ranked_case_ids,
        predicted_outcome=predicted_outcome,
        confidence=round(confidence, 3),
        reasoning=reasoning,
    )