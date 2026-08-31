"""
tests/test_tax_rag_citation.py
Test retrieval + presisi sitasi + audit logging ask_tax_question() TANPA
memanggil Claude API sungguhan (di-mock) -- cepat, jalan di CI tiap commit.

Untuk uji kualitas JAWABAN bahasa natural dengan pertanyaan nyata dari
akuntan (butuh API key sungguhan, dinilai manusia), lihat
scripts/eval_tax_questions.py -- fungsinya beda dan saling melengkapi,
bukan saling menggantikan.

Prasyarat: pip install pytest
Jalankan:  pytest tests/test_tax_rag_citation.py -v
"""
import importlib
import os
from unittest.mock import patch

import pytest

# WAJIB di-set SEBELUM modul manapun yang memicu get_embedding_backend()
# di-import/dipanggil -- supaya test tidak mencoba download model BGE-M3
# 2.2GB (lihat modules/embedding.py get_embedding_backend()).
os.environ["TAX_EMBEDDING_BACKEND"] = "hashing"

from modules import tax_ingestion, tax_rag, tax_qa_log
from modules.schemas import DocType, RegulationStatus


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    """
    Tiap test jalan dengan TAX_DATA_DIR terpisah (folder temp pytest) dan
    vector store yang di-reload dari folder kosong itu -- supaya test
    tidak saling mengotori data satu sama lain, dan tidak menyentuh data
    './data' sungguhan di project kamu.
    """
    monkeypatch.setenv("TAX_DATA_DIR", str(tmp_path))

    from modules import storage, vector_store
    importlib.reload(storage)
    importlib.reload(vector_store)

    # tax_rag.py, tax_ingestion.py, dan tax_qa_log.py masing-masing sudah
    # "from modules.vector_store import default_store" / "from modules
    # import storage" di top-level -- reload di atas membuat OBJEK BARU,
    # jadi referensi lama di modul-modul itu perlu ditimpa manual supaya
    # semua modul memakai instance yang sama (folder tmp_path yang sama).
    monkeypatch.setattr(tax_rag, "default_store", vector_store.default_store)
    monkeypatch.setattr(tax_ingestion, "default_store", vector_store.default_store)
    monkeypatch.setattr(tax_qa_log, "storage", storage)

    yield


def _fake_llm_response(text: str):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"content": [{"type": "text", "text": text}]}

    return FakeResp()


def test_retrieval_cites_correct_pasal():
    """Pasal yang dikutip harus persis Pasal yang relevan, bukan pasal lain
    dari dokumen yang sama -- ini bukti nyata chunker Tahap 2 sadar
    struktur pasal (kalau chunker masih potong-per-karakter lama, kutipan
    bisa saja campur antara Pasal 4 dan Pasal 21 dalam satu chunk)."""
    teks = (
        "Pasal 4\n"
        "(1) Yang menjadi subjek pajak adalah orang pribadi.\n"
        "(2) Warisan yang belum terbagi dianggap sebagai subjek pajak.\n"
        "Pasal 21\n"
        "(1) Tarif pajak penghasilan bagi karyawan adalah sesuai lapisan "
        "penghasilan kena pajak.\n"
    )
    tax_ingestion.ingest_document(
        title="UU PPh", doc_type=DocType.UU, full_text=teks, nomor="UU 7/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Tarif PPh 21 diatur di Pasal 21. [Sumber 1]")):
        hasil = tax_rag.ask_tax_question("Berapa tarif PPh 21 untuk karyawan?", top_k=3)

    assert hasil.sumber, "Harus ada sumber yang dikutip"
    cuplikan_semua_sumber = [s["cuplikan"] for s in hasil.sumber]
    assert any("21" in c for c in cuplikan_semua_sumber), (
        f"Diharapkan salah satu sumber mengandung bagian Pasal 21, "
        f"tapi cuplikan sumber yang didapat: {cuplikan_semua_sumber}"
    )


def test_status_dicabut_memicu_peringatan_eksplisit():
    """Dokumen berstatus 'dicabut' HARUS memicu peringatan eksplisit di
    jawaban akhir, TERLEPAS dari apakah LLM menuruti instruksi di prompt
    atau tidak -- ini uji untuk fix Tahap 0.2 (peringatan dibangun di level
    kode, bukan cuma digantungkan ke kepatuhan model)."""
    tax_ingestion.ingest_document(
        title="PMK Lama",
        doc_type=DocType.PMK,
        full_text="Pasal 1\nAturan lama tentang tarif pajak tertentu.",
        nomor="PMK 1/2020",
        status=RegulationStatus.DICABUT,
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban dari model tanpa peringatan apa pun.")):
        hasil = tax_rag.ask_tax_question("Apa isi PMK 1/2020?", top_k=3)

    assert "PERINGATAN" in hasil.jawaban
    assert "DICABUT" in hasil.jawaban.upper()


def test_status_terkini_bukan_snapshot_lama():
    """Kalau status diubah SETELAH dokumen di-index (lewat update_status()),
    jawaban baru harus mencerminkan status TERKINI, bukan snapshot lama
    yang tersimpan di chunk.metadata.status saat index pertama kali --
    ini uji untuk fungsi _status_terkini() di tax_rag.py."""
    doc = tax_ingestion.ingest_document(
        title="PMK Aktif",
        doc_type=DocType.PMK,
        full_text="Pasal 1\nAturan yang saat ini masih berlaku.",
        nomor="PMK 2/2022",
        status=RegulationStatus.BERLAKU,
    )

    # Dokumen dicabut BELAKANGAN, setelah index awal -- chunk.metadata.status
    # yang tersimpan di vector store tetap "berlaku" (snapshot lama).
    tax_ingestion.update_status(doc.id, RegulationStatus.DICABUT, note="Diganti PMK baru")

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban dari model.")):
        hasil = tax_rag.ask_tax_question("Apa isi PMK 2/2022?", top_k=3)

    assert "DICABUT" in hasil.jawaban.upper(), (
        "Status TERKINI (dicabut belakangan) harus terlihat di jawaban, "
        "bukan snapshot 'berlaku' saat index pertama kali."
    )


def test_tidak_ada_dokumen_tetap_ter_log():
    """Pertanyaan tanpa dokumen relevan sama sekali tetap harus masuk audit
    log (Tahap 4.3) -- penting untuk analisis 'jenis pajak apa yang paling
    sering ditanya tapi belum ter-cover di database', bukan cuma di-skip
    diam-diam."""
    hasil = tax_rag.ask_tax_question("Pertanyaan yang sama sekali tidak ada dokumennya")

    assert "Belum ada dokumen" in hasil.jawaban

    logs = tax_qa_log.list_logs(limit=1)
    assert logs, "Audit log harus terisi walau tidak ada dokumen ditemukan"
    assert logs[0]["question"].startswith("Pertanyaan yang sama sekali")
    assert logs[0]["num_sources"] == 0


def test_qa_log_mencatat_user_dan_client_id():
    """user_id/client_id yang diteruskan dari tax_router.py harus tersimpan
    di audit log -- ini yang bikin log bisa di-query per user/client."""
    tax_ingestion.ingest_document(
        title="UU PPh", doc_type=DocType.UU,
        full_text="Pasal 1\nKetentuan umum perpajakan.", nomor="UU 7/2021",
    )

    with patch("modules.tax_rag.ANTHROPIC_API_KEY", "dummy"), \
         patch("modules.tax_rag.requests.post",
               return_value=_fake_llm_response("Jawaban.")):
        tax_rag.ask_tax_question(
            "Apa ketentuan umum perpajakan?",
            user_id="user-123",
            client_id="client-abc",
        )

    logs = tax_qa_log.list_logs(user_id="user-123", limit=1)
    assert logs, "Harus bisa di-query berdasarkan user_id"
    assert logs[0]["client_id"] == "client-abc"