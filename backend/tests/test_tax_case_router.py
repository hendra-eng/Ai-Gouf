"""
tests/test_tax_case_router.py
Uji endpoint modules/tax_case_router.py lewat FastAPI TestClient.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules import auth, storage
from modules.tax_case_router import router
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


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(router, prefix="/tax/cases")

    # Endpoint di router ini butuh login (get_current_user) dan sebagian
    # butuh require_level(3). require_level() sendiri internally memanggil
    # Depends(get_current_user), jadi cukup override get_current_user di
    # satu tempat -- otomatis berlaku juga untuk endpoint yang pakai
    # require_level. User dummy di sini pakai role tahap_5 (level tertinggi)
    # supaya lolos endpoint level berapa pun tanpa perlu bikin token JWT asli.
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "id": 1,
        "username": "test-user",
        "role": "tahap_5",
        "nama": "Test User",
    }

    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


def test_ingest_and_get_case(client):
    payload = {
        "nomor_putusan": "PUT-200/PP/2026",
        "pengadilan": "Pengadilan Pajak",
        "full_text": "Pemohon banding mendalilkan Pasal 9 UU PPN sudah dipenuhi.",
        "jenis_sengketa": "PPN",
        "amar_putusan": "dikabulkan_seluruhnya",
    }
    resp = client.post("/tax/cases/ingest", json=payload)
    assert resp.status_code == 200
    case_id = resp.json()["id"]

    get_resp = client.get(f"/tax/cases/{case_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["nomor_putusan"] == "PUT-200/PP/2026"


def test_ingest_requires_supervisor_level():
    # Test terpisah (tidak pakai fixture client) untuk memastikan endpoint
    # /ingest benar-benar menolak user di bawah tahap_3.
    app = FastAPI()
    app.include_router(router, prefix="/tax/cases")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "id": 2,
        "username": "junior",
        "role": "tahap_1",
        "nama": "Junior Staff",
    }
    low_level_client = TestClient(app)

    resp = low_level_client.post(
        "/tax/cases/ingest",
        json={
            "nomor_putusan": "PUT-999/PP/2026",
            "pengadilan": "Pengadilan Pajak",
            "full_text": "Teks singkat.",
        },
    )
    assert resp.status_code == 403


def test_get_unknown_case_returns_404(client):
    resp = client.get("/tax/cases/tidak-ada")
    assert resp.status_code == 404


def test_predict_endpoint_without_data_returns_unknown(client):
    resp = client.post("/tax/cases/predict", json={"position_text": "posisi apa saja", "top_k": 3})
    assert resp.status_code == 200
    assert resp.json()["predicted_outcome"] == "tidak_cukup_data"


def test_diagram_endpoint(client):
    resp = client.post("/tax/cases/diagram", json={"topic": "keberatan"})
    assert resp.status_code == 200
    assert "SKP diterbitkan" in resp.json()["mermaid_code"]


def test_folio_create_and_list(client):
    create_resp = client.post(
        "/tax/cases/folios", params={"title": "Folio Uji", "topic": "PPN"}
    )
    assert create_resp.status_code == 200

    list_resp = client.get("/tax/cases/folios", params={"topic": "PPN"})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1