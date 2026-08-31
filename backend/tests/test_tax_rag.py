"""
tests/test_tax_rag.py

Test inti modules/tax_rag.py yang BELUM dicakup oleh dua file test lain:

  - tests/test_tax_rag_citation.py -- fokus presisi sitasi pasal/ayat &
    status TERKINI vs snapshot (Tahap 0.2/2.2), plus audit logging dasar.
  - tests/test_tax_rag_filters.py  -- fokus fitur filter metadata
    (Tahap 4 no.4).

File ini melengkapi dengan: perilaku error (API key kosong, error
jaringan harus diteruskan ke atas), format build_prompt(), top_k di
retrieve_relevant_chunks(), fallback _status_terkini() untuk chunk
putusan pengadilan (case law, tidak punya document_id), dan kasus banyak
sumber bermasalah sekaligus dalam satu jawaban.

Pola fixture isolated_storage SAMA seperti test_tax_rag_citation.py --
lihat file itu untuk penjelasan lengkap kenapa importlib.reload() dipakai.

Prasyarat: pip install pytest
Jalankan:  pytest tests/test_tax_rag.py -v
"""
import importlib
import os
from unittest.mock import patch

import pytest
import requests

os.environ["TAX_EMBEDDING_BACKEND"] = "hashing"

from modules import tax_ingestion, tax_rag
from modules.schemas import DocType, RegulationStatus
from modules.tax_chunker import Chunk, RegulationMetadata


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


# ---------------------------------------------------------------------------
# TaxRagError -- konfigurasi belum lengkap
# ---------------------------------------------------------------------------

def test_error_jelas_saat_api_key_kosong():
    """Tanpa ANTHROPIC_API_KEY, harus TaxRagError dengan pesan jelas -- BUKAN
    error requests yang membingungkan (mis. header 'x-api-key: None').

    [FIX] Sebelumnya test ini TIDAK meng-ingest dokumen apa pun, jadi
    setelah cek "tidak ada dokumen relevan" dipindah ke SEBELUM cek
    ANTHROPIC_API_KEY (lihat catatan urutan di tax_rag.py:ask_tax_question)
    -- pertanyaan apa pun langsung jatuh ke jalur "Belum ada dokumen..."
    yang memang tidak butuh API key sama sekali, TaxRagError tidak pernah
    kepicu. Test ini secara spesifik menguji jalur konfigurasi (API key
    kosong) SETELAH ada dokumen relevan yang ditemukan, jadi harus ada
    dokumen ter-ingest dulu -- sama seperti pola di
    test_error_jaringan_diteruskan_ke_atas_bukan_ditelan() di bawah, yang
    menguji jalur setelah retrieval berhasil juga."""
    tax_ingestion.ingest_document(
        title="UU PPh", doc_type=DocType.UU,
        full_text="Pasal 1\nKetentuan umum perpajakan.", nomor="UU 7/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", None):
        with pytest.raises(tax_rag.TaxRagError) as exc_info:
            tax_rag.ask_tax_question("Apa ketentuan umum perpajakan?")

    assert "ANTHROPIC_API_KEY" in str(exc_info.value)
    # Ini harus TaxRagError "polos" (konfigurasi), BUKAN FilterTidakValid --
    # supaya tax_router.py membalasnya 500 (salah setup), bukan 400 (salah
    # input pengguna).
    assert not isinstance(exc_info.value, tax_rag.FilterTidakValid)


def test_error_jaringan_diteruskan_ke_atas_bukan_ditelan():
    """[Penting] requests.RequestException (mis. timeout/koneksi putus ke
    Claude API) HARUS diteruskan ke atas oleh ask_tax_question(), BUKAN
    ditangkap & ditelan di sini -- tax_router.py:ask() bergantung pada ini
    untuk membalas 502 ke klien (lihat except requests.RequestException di
    sana). Kalau exception ini ditelan/diubah jadi exception lain di
    tax_rag.py, endpoint akan salah membalas 500 generik alih-alih 502
    yang jelas maksudnya 'gagal menghubungi layanan AI'."""
    tax_ingestion.ingest_document(
        title="UU PPh", doc_type=DocType.UU,
        full_text="Pasal 1\nKetentuan umum perpajakan.", nomor="UU 7/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               side_effect=requests.ConnectionError("koneksi putus")):
        with pytest.raises(requests.RequestException):
            tax_rag.ask_tax_question("Apa ketentuan umum perpajakan?")


# ---------------------------------------------------------------------------
# build_prompt() -- format prompt yang dikirim ke LLM
# ---------------------------------------------------------------------------

def test_build_prompt_menyertakan_nomor_sumber_dan_status():
    metadata = RegulationMetadata(
        nomor="PMK 100/2024", jenis="PMK", judul="Judul Contoh", status="berlaku",
    )
    chunk = Chunk(id="c1", text="Isi pasal contoh.", metadata=metadata, chunk_index=0)
    hasil_cari = tax_rag.SearchResult(chunk=chunk, score=0.9)

    prompt = tax_rag.build_prompt(
        "Pertanyaan uji", [hasil_cari], live_statuses=["berlaku"],
    )

    assert "[Sumber 1]" in prompt
    assert "PMK 100/2024" in prompt
    assert "Judul Contoh" in prompt
    assert "status TERKINI: berlaku" in prompt
    assert "Isi pasal contoh." in prompt
    assert "Pertanyaan uji" in prompt


def test_build_prompt_banyak_sumber_bernomor_urut():
    """Tiap sumber harus diberi nomor urut [Sumber N] yang benar, bukan
    semua ke-1 atau tidak bernomor -- ini yang dipakai LLM & pengguna
    untuk mencocokkan klaim jawaban ke sumbernya."""
    chunks = [
        Chunk(
            id=f"c{i}", text=f"Isi {i}",
            metadata=RegulationMetadata(nomor=f"PMK {i}/2024", jenis="PMK", judul=f"J{i}"),
        )
        for i in range(1, 4)
    ]
    hasil = [tax_rag.SearchResult(chunk=c, score=1.0) for c in chunks]

    prompt = tax_rag.build_prompt("Q", hasil, live_statuses=["berlaku"] * 3)

    for i in range(1, 4):
        assert f"[Sumber {i}]" in prompt


# ---------------------------------------------------------------------------
# retrieve_relevant_chunks() -- top_k
# ---------------------------------------------------------------------------

def test_retrieve_relevant_chunks_menghormati_top_k():
    for i in range(5):
        tax_ingestion.ingest_document(
            title=f"PMK {i}", doc_type=DocType.PMK,
            full_text=f"Pasal 1\nKetentuan tarif nomor {i} tentang pajak.",
            nomor=f"PMK {i}/2024",
        )

    hasil = tax_rag.retrieve_relevant_chunks("ketentuan tarif pajak", top_k=2)
    assert len(hasil) == 2


def test_retrieve_relevant_chunks_kosong_kalau_belum_ada_dokumen():
    hasil = tax_rag.retrieve_relevant_chunks("pertanyaan apa saja", top_k=5)
    assert hasil == []


# ---------------------------------------------------------------------------
# _status_terkini() -- fallback untuk chunk putusan (case law)
# ---------------------------------------------------------------------------

def test_status_terkini_fallback_untuk_chunk_putusan():
    """Chunk milik putusan pengadilan (case_id terisi, document_id kosong)
    TIDAK terlacak lewat tax_status_tracker (yang berbasis document_id) --
    _status_terkini() harus fallback ke metadata.status chunk itu sendiri,
    bukan error atau selalu 'tidak_diketahui'."""
    metadata = RegulationMetadata(
        nomor="Put. 123/PP/2023", jenis="Putusan", judul="Sengketa Contoh",
        status="berlaku", case_id="case-abc", document_id=None,
    )
    chunk = Chunk(id="c1", text="Amar putusan.", metadata=metadata)

    assert tax_rag._status_terkini(chunk) == "berlaku"


def test_status_terkini_dokumen_tanpa_entri_tracker_pakai_snapshot():
    """Kalau document_id ADA tapi belum pernah di-set_status() lewat
    tracker (mis. data lama / edge case), get_status() mengembalikan
    TIDAK_DIKETAHUI -- _status_terkini() harus fallback ke snapshot
    metadata.status, bukan mengembalikan 'tidak_diketahui' begitu saja
    (yang tidak berguna untuk menampilkan peringatan)."""
    metadata = RegulationMetadata(
        nomor="PMK 1/2020", jenis="PMK", judul="J",
        status="dicabut", document_id="doc-tanpa-entri-tracker",
    )
    chunk = Chunk(id="c1", text="Isi.", metadata=metadata)

    assert tax_rag._status_terkini(chunk) == "dicabut"


# ---------------------------------------------------------------------------
# Peringatan status -- kasus banyak sumber bermasalah & tidak ada masalah
# ---------------------------------------------------------------------------

def test_banyak_sumber_dicabut_semua_tercantum_di_peringatan():
    tax_ingestion.ingest_document(
        title="PMK Lama 1", doc_type=DocType.PMK,
        full_text="Pasal 1\nAturan lama pertama tentang tarif.",
        nomor="PMK 11/2019", status=RegulationStatus.DICABUT,
    )
    tax_ingestion.ingest_document(
        title="PMK Lama 2", doc_type=DocType.PMK,
        full_text="Pasal 1\nAturan lama kedua tentang tarif.",
        nomor="PMK 22/2019", status=RegulationStatus.DICABUT,
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban model.")):
        hasil = tax_rag.ask_tax_question("Apa ketentuan tarif?", top_k=5)

    assert "2 dari" in hasil.jawaban, (
        f"Harus menyebut jumlah sumber bermasalah (2), jawaban: {hasil.jawaban}"
    )
    assert "PMK 11/2019" in hasil.jawaban
    assert "PMK 22/2019" in hasil.jawaban


def test_status_berlaku_tidak_memicu_peringatan():
    tax_ingestion.ingest_document(
        title="PMK Aktif", doc_type=DocType.PMK,
        full_text="Pasal 1\nAturan yang masih berlaku.",
        nomor="PMK 9/2024", status=RegulationStatus.BERLAKU,
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban model tanpa masalah.")):
        hasil = tax_rag.ask_tax_question("Apa isi PMK 9/2024?", top_k=5)

    assert "PERINGATAN" not in hasil.jawaban


# ---------------------------------------------------------------------------
# Struktur TaxAnswer.sumber
# ---------------------------------------------------------------------------

def test_sumber_score_dibulatkan_3_desimal():
    tax_ingestion.ingest_document(
        title="UU PPh", doc_type=DocType.UU,
        full_text="Pasal 1\nKetentuan umum perpajakan diatur di sini.",
        nomor="UU 7/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban.")):
        hasil = tax_rag.ask_tax_question("Apa ketentuan umum perpajakan?")

    assert hasil.sumber, "Harus ada sumber"
    for s in hasil.sumber:
        assert s["score"] == round(s["score"], 3)


def test_sumber_cuplikan_dibatasi_200_karakter():
    teks_panjang = "Pasal 1\n" + ("Ketentuan umum perpajakan berlaku. " * 20)
    tax_ingestion.ingest_document(
        title="UU Panjang", doc_type=DocType.UU, full_text=teks_panjang, nomor="UU 8/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban.")):
        hasil = tax_rag.ask_tax_question("Apa ketentuan umum perpajakan?")

    assert hasil.sumber
    for s in hasil.sumber:
        assert len(s["cuplikan"]) <= 200