"""
tests/test_tax_case_router_history.py
Uji bahwa endpoint /predict & /risk-score di modules/tax_case_router.py
mencatat histori interaksi (Tahap 4 -- TODO lama yang sekarang sudah
dikerjakan) DAN tetap mengembalikan hasil ke user walau pencatatan
histori gagal.

SENGAJA memanggil fungsi endpoint LANGSUNG (predict(payload, user=...),
bukan lewat FastAPI TestClient/HTTP) -- ini menghindari kerumitan setup
JWT/auth sungguhan yang tidak relevan untuk uji ini, karena yang mau
diuji adalah LOGIKA di dalam endpoint, bukan lapisan HTTP/auth-nya
(lapisan auth sudah cukup diuji lewat modules/auth.py sendiri).

SENGAJA me-mock modules.tax_history SECARA PENUH (bukan pakai
implementasi sungguhan) -- supaya test ini TIDAK bergantung pada
signature pasti tax_history.log_interaction() yang belum saya lihat
isinya. Begitu tax_history.py dikonfirmasi, test ini tetap valid tanpa
perlu diubah; yang mungkin perlu disesuaikan hanya kode pemanggilnya di
tax_case_router.py.
"""
from unittest.mock import patch

from modules import tax_case_router
from modules.schemas import PredictionResult, RiskScoreResult


def _fake_user(user_id: str = "staff-1") -> dict:
    return {"id": user_id, "username": "staff", "role": "tahap_3", "nama": "Staff Uji"}


def test_predict_mencatat_histori_dengan_data_lengkap():
    fake_result = PredictionResult(
        query_case_id=None,
        query_text="posisi pajak saya",
        similar_cases=["case-1", "case-2"],
        predicted_outcome="dikabulkan sebagian",
        confidence=0.82,
        reasoning="karena preseden serupa mengabulkan sebagian tuntutan",
    )
    payload = tax_case_router.PredictRequest(
        position_text="posisi pajak saya", top_k=5, client_id="client-abc",
    )

    with patch("modules.tax_case_router.predict_outcome", return_value=fake_result) as mock_predict, \
         patch("modules.tax_case_router.tax_history") as mock_history:
        result = tax_case_router.predict(payload, user=_fake_user("staff-1"))

    # Endpoint tetap memanggil predict_outcome() dengan argumen yang benar.
    mock_predict.assert_called_once_with("posisi pajak saya", top_k=5)

    # Histori HARUS tercatat, dengan user_id, client_id, question, answer
    # yang benar dan LENGKAP (bukan versi terpotong).
    mock_history.log_interaction.assert_called_once()
    _, kwargs = mock_history.log_interaction.call_args
    assert kwargs["user_id"] == "staff-1"
    assert kwargs["client_id"] == "client-abc"
    assert kwargs["question"] == "posisi pajak saya"
    assert "dikabulkan sebagian" in kwargs["answer"]
    assert "case-1" in kwargs["answer"] and "case-2" in kwargs["answer"]
    assert "0.82" in kwargs["answer"]

    # Endpoint tetap mengembalikan hasil prediksi ke caller (response API
    # tidak berubah sama sekali akibat penambahan logging ini).
    assert result is fake_result


def test_risk_score_mencatat_histori_dengan_data_lengkap():
    fake_result = RiskScoreResult(
        position_text="posisi berisiko",
        risk_score=72.5,
        risk_level="tinggi",
        factors=["faktor A", "faktor B"],
        supporting_cases=["case-9"],
    )
    payload = tax_case_router.PredictRequest(
        position_text="posisi berisiko", top_k=5, client_id=None,
    )

    with patch("modules.tax_case_router.score_position", return_value=fake_result) as mock_score, \
         patch("modules.tax_case_router.tax_history") as mock_history:
        result = tax_case_router.risk_score(payload, user=_fake_user("staff-2"))

    mock_score.assert_called_once_with("posisi berisiko", top_k=5)

    mock_history.log_interaction.assert_called_once()
    _, kwargs = mock_history.log_interaction.call_args
    assert kwargs["user_id"] == "staff-2"
    assert kwargs["client_id"] is None
    assert kwargs["question"] == "posisi berisiko"
    assert "72.5" in kwargs["answer"]
    assert "tinggi" in kwargs["answer"]
    assert "faktor A" in kwargs["answer"] and "faktor B" in kwargs["answer"]
    assert "case-9" in kwargs["answer"]

    assert result is fake_result


def test_predict_tetap_sukses_walau_pencatatan_histori_gagal():
    """
    PALING PENTING: kegagalan mencatat histori (mis. disk penuh, storage
    error) TIDAK BOLEH menggagalkan endpoint /predict. Staf tetap harus
    dapat hasil prediksinya.
    """
    fake_result = PredictionResult(
        query_case_id=None, query_text="p", similar_cases=[],
        predicted_outcome="ditolak", confidence=0.4, reasoning="-",
    )
    payload = tax_case_router.PredictRequest(position_text="posisi", top_k=5)

    with patch("modules.tax_case_router.predict_outcome", return_value=fake_result), \
         patch("modules.tax_case_router.tax_history") as mock_history:
        mock_history.log_interaction.side_effect = RuntimeError("disk penuh")
        # Tidak boleh melempar exception apa pun ke atas.
        result = tax_case_router.predict(payload, user=_fake_user())

    assert result is fake_result


def test_predict_mengonversi_user_id_int_ke_str():
    """
    modules/schemas.py HistoryEntry.user_id bertipe Optional[str], tapi
    modules/auth.py bisa mengembalikan user["id"] sebagai int (mis. akun
    fallback punya id=0). Kalau int itu dikirim mentah-mentah ke
    tax_history.log_interaction() (yang membungkusnya ke HistoryEntry
    pydantic), pydantic v2 akan melempar ValidationError -- tertangkap
    oleh try/except di _catat_histori_interaksi(), sehingga logging akan
    diam-diam SELALU gagal tanpa pernah tercatat. Test ini memastikan
    konversi str() tetap ada.
    """
    fake_result = PredictionResult(
        query_case_id=None, query_text="p", similar_cases=[],
        predicted_outcome="dikabulkan", confidence=0.9, reasoning="-",
    )
    payload = tax_case_router.PredictRequest(position_text="posisi", top_k=5)
    user_dengan_id_int = {"id": 0, "username": "admin", "role": "tahap_5", "nama": "Admin"}

    with patch("modules.tax_case_router.predict_outcome", return_value=fake_result), \
         patch("modules.tax_case_router.tax_history") as mock_history:
        tax_case_router.predict(payload, user=user_dengan_id_int)

    _, kwargs = mock_history.log_interaction.call_args
    assert kwargs["user_id"] == "0"
    assert isinstance(kwargs["user_id"], str), (
        "user_id harus sudah dikonversi ke str sebelum dikirim ke "
        "log_interaction() -- HistoryEntry.user_id bertipe Optional[str]"
    )


def test_risk_score_tetap_sukses_walau_pencatatan_histori_gagal():
    """Sama seperti di atas, tapi untuk endpoint /risk-score."""
    fake_result = RiskScoreResult(
        position_text="p", risk_score=10.0, risk_level="rendah",
        factors=[], supporting_cases=[],
    )
    payload = tax_case_router.PredictRequest(position_text="posisi", top_k=5)

    with patch("modules.tax_case_router.score_position", return_value=fake_result), \
         patch("modules.tax_case_router.tax_history") as mock_history:
        mock_history.log_interaction.side_effect = RuntimeError("koneksi storage gagal")
        result = tax_case_router.risk_score(payload, user=_fake_user())

    assert result is fake_result