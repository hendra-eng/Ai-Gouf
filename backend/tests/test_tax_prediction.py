"""
tests/test_tax_prediction.py
Uji dasar untuk modules/tax_prediction.py.
"""
import pytest

from modules import storage, tax_case_ingestion
from modules.tax_prediction import predict_outcome
from modules.vector_store import default_store


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


@pytest.fixture(autouse=True)
def _reset_vector_store():
    default_store._chunks.clear()
    default_store._vectors.clear()
    yield
    default_store._chunks.clear()
    default_store._vectors.clear()


def test_predict_outcome_with_no_cases_returns_unknown():
    result = predict_outcome("posisi wajib pajak soal kredit pajak masukan", top_k=5)
    assert result.predicted_outcome == "tidak_cukup_data"
    assert result.confidence == 0.0
    assert result.similar_cases == []


def test_predict_outcome_majority_vote_from_similar_cases():
    common_text = (
        "Sengketa mengenai kredit pajak masukan atas faktur pajak yang tidak sesuai "
        "prosedur formal, pemohon banding mendalilkan faktur sudah lengkap secara materiil."
    )
    for i in range(3):
        tax_case_ingestion.ingest_case(
            nomor_putusan=f"PUT-{i}/PP/2026",
            pengadilan="Pengadilan Pajak",
            full_text=common_text,
            jenis_sengketa="PPN",
            amar_putusan="dikabulkan_seluruhnya",
        )
    tax_case_ingestion.ingest_case(
        nomor_putusan="PUT-BEDA/PP/2026",
        pengadilan="Pengadilan Pajak",
        full_text="Sengketa mengenai transfer pricing afiliasi luar negeri, dasar arm's length.",
        jenis_sengketa="PPh Badan",
        amar_putusan="ditolak",
    )

    result = predict_outcome(common_text, top_k=5)

    assert result.predicted_outcome == "dikabulkan_seluruhnya"
    assert result.confidence > 0
    assert len(result.similar_cases) > 0