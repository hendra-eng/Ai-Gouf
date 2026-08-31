"""
tests/test_tax_rag_filters.py

[Tahap 4 - no.4] Test bahwa AskRequest.filters/TaxQuestionRequest.filters
sekarang BENAR-BENAR membatasi hasil pencarian di /tax/ask, dan bahwa
field filter yang tidak dikenal ditolak dengan error yang jelas (bukan
diam-diam menghasilkan 0 hasil).

Pola fixture isolated_storage sama seperti
tests/test_tax_rag_citation.py -- lihat file itu untuk penjelasan kenapa
importlib.reload() dipakai (supaya test tidak menyentuh ./data sungguhan).

Prasyarat: pip install pytest
Jalankan:  pytest tests/test_tax_rag_filters.py -v
"""
import importlib
import os
from unittest.mock import patch

import pytest

os.environ["TAX_EMBEDDING_BACKEND"] = "hashing"

from modules import tax_ingestion, tax_rag
from modules.schemas import DocType


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("TAX_DATA_DIR", str(tmp_path))

    from modules import storage, vector_store
    importlib.reload(storage)
    importlib.reload(vector_store)

    monkeypatch.setattr(tax_rag, "default_store", vector_store.default_store)
    monkeypatch.setattr(tax_ingestion, "default_store", vector_store.default_store)

    from modules import tax_qa_log
    monkeypatch.setattr(tax_qa_log, "storage", storage)

    yield


def _fake_llm_response(text: str):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"content": [{"type": "text", "text": text}]}

    return FakeResp()


def _ingest_dua_dokumen():
    tax_ingestion.ingest_document(
        title="PMK Tarif",
        doc_type=DocType.PMK,
        full_text="Pasal 1\nKetentuan tarif PPN diatur di sini.",
        nomor="PMK 66/2024",
    )
    tax_ingestion.ingest_document(
        title="UU Umum",
        doc_type=DocType.UU,
        full_text="Pasal 1\nKetentuan umum perpajakan diatur di sini.",
        nomor="UU 7/2021",
    )


def test_filter_jenis_membatasi_hasil():
    """filters={"jenis": "UU"} harus cuma mengambil chunk dari dokumen
    berjenis UU, walau dokumen PMK sebenarnya lebih relevan secara teks."""
    _ingest_dua_dokumen()

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban.")):
        hasil = tax_rag.ask_tax_question(
            "Apa ketentuannya?", top_k=5, filters={"jenis": "UU"},
        )

    assert hasil.sumber, "Harus tetap ada sumber (dokumen UU cocok filter)"
    for s in hasil.sumber:
        assert s["jenis"] == "UU", f"Sumber jenis lain lolos filter: {s}"


def test_filter_tidak_valid_ditolak_walau_api_key_belum_diset():
    """
    [Regresi] Ditemukan lewat test sungguhan saat pertama kali menjalankan
    test file ini: urutan semula di ask_tax_question() mengecek
    ANTHROPIC_API_KEY DULU baru validasi filters -- akibatnya kalau kedua-
    duanya bermasalah (API key belum di-set DAN filter salah ketik),
    pengguna dapat pesan "API key belum di-set" yang MENYESATKAN, padahal
    filter yang mereka kirim juga salah dan itu murni salah INPUT mereka,
    tidak ada hubungannya dengan konfigurasi server.

    FilterTidakValid harus tetap terlempar duluan di sini WALAU
    ANTHROPIC_API_KEY tidak di-patch/di-set sama sekali (beda dari test
    lain di file ini yang selalu patch ANTHROPIC_API_KEY="dummy" dulu)."""
    _ingest_dua_dokumen()

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", None):
        with pytest.raises(tax_rag.FilterTidakValid):
            tax_rag.ask_tax_question(
                "Apa ketentuannya?", filters={"field_ngasal": "x"},
            )


def test_filter_field_tidak_dikenal_ditolak():
    """Field filter yang salah ketik/tidak didukung harus melempar error
    jelas (FilterTidakValid), bukan diam-diam menghasilkan 0 hasil."""
    _ingest_dua_dokumen()

    with pytest.raises(tax_rag.FilterTidakValid):
        tax_rag.ask_tax_question(
            "Apa ketentuannya?", filters={"kategori_pajak": "PPN"},
        )


def test_tanpa_filter_perilaku_lama_tidak_berubah():
    """Caller lama yang tidak mengirim filters sama sekali harus tetap
    mendapat semua dokumen relevan, persis seperti sebelum fitur filter
    ditambahkan."""
    _ingest_dua_dokumen()

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban.")):
        hasil = tax_rag.ask_tax_question("Apa ketentuannya?", top_k=5)

    jenis_ditemukan = {s["jenis"] for s in hasil.sumber}
    assert jenis_ditemukan == {"PMK", "UU"}, (
        f"Tanpa filter harus dapat kedua jenis dokumen, dapat: {jenis_ditemukan}"
    )