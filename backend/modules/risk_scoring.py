"""
modules/risk_scoring.py
Skoring risiko posisi pajak tertentu, berdasarkan hasil prediksi + kasus serupa.
"""
from __future__ import annotations

from modules.schemas import RiskScoreResult
from modules.tax_prediction import predict_outcome

# Bobot risiko dasar per kemungkinan hasil sengketa (0 = risiko rendah, 100 = risiko tinggi).
OUTCOME_RISK_WEIGHT = {
    "dikabulkan_seluruhnya": 20,   # posisi wajib pajak umumnya kuat -> risiko rendah
    "dikabulkan_sebagian": 45,
    "ditolak": 80,                  # posisi wajib pajak umumnya lemah -> risiko tinggi
    "tidak_dapat_diterima": 60,
    "tidak_cukup_data": 50,
}


def _risk_level(score: float) -> str:
    if score < 34:
        return "rendah"
    if score < 67:
        return "sedang"
    return "tinggi"


def score_position(position_text: str, top_k: int = 5) -> RiskScoreResult:
    prediction = predict_outcome(position_text, top_k=top_k)

    base_score = OUTCOME_RISK_WEIGHT.get(prediction.predicted_outcome, 50)
    # Confidence tinggi memperkuat (menjauhkan dari titik tengah 50) skor risiko dasar.
    adjustment = (prediction.confidence - 0.5) * 20
    if base_score >= 50:
        score = min(100, base_score + adjustment * 2)
    else:
        score = max(0, base_score - adjustment * 2)

    factors = [
        f"Prediksi hasil paling mungkin: {prediction.predicted_outcome} "
        f"(keyakinan {prediction.confidence * 100:.0f}% dari {len(prediction.similar_cases)} kasus serupa).",
    ]
    if prediction.predicted_outcome == "tidak_cukup_data":
        factors.append("Data kasus serupa masih terbatas - hasil bersifat indikatif.")

    return RiskScoreResult(
        position_text=position_text,
        risk_score=round(score, 1),
        risk_level=_risk_level(score),
        factors=factors,
        supporting_cases=prediction.similar_cases,
    )
