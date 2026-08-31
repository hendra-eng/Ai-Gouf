"""
tests/test_tax_memo.py
Uji dasar untuk modules/tax_memo.py.
"""
from modules.schemas import CitedChunk, Chunk, MemoRequest, SourceDocument, DocType, RegulationStatus
from modules.tax_memo import generate_memo


def _cited_chunk(status: RegulationStatus, doc_id: str = "doc-1") -> CitedChunk:
    document = SourceDocument(
        id=doc_id,
        title="Contoh Peraturan",
        doc_type=DocType.PMK,
        nomor="168",
        tahun=2023,
        status=status,
    )
    chunk = Chunk(id="chunk-1", document_id=doc_id, text="isi chunk", chunk_index=0)
    return CitedChunk(chunk=chunk, score=0.9, document=document)


def test_generate_memo_basic_structure():
    request = MemoRequest(
        question="Apakah restitusi PPN bisa diajukan untuk masa pajak yang sudah lewat 3 tahun?",
        answer="Berdasarkan ketentuan yang berlaku, restitusi umumnya dibatasi masa 3 tahun sejak berakhirnya masa pajak.",
        author="Staf Pajak",
        client_id="PT Contoh",
    )
    memo = generate_memo(request)

    assert "Memo Riset Pajak" in memo.title
    assert "## Pertanyaan" in memo.body_markdown
    assert "## Analisis / Jawaban" in memo.body_markdown
    assert "PT Contoh" in memo.body_markdown
    assert "Staf Pajak" in memo.body_markdown


def test_generate_memo_includes_warning_for_dicabut_citation():
    request = MemoRequest(
        question="Apakah aturan lama masih berlaku?",
        answer="Tidak, sudah digantikan aturan baru.",
        citations=[_cited_chunk(RegulationStatus.DICABUT)],
    )
    memo = generate_memo(request)

    assert "## Perhatian" in memo.body_markdown
    assert "DICABUT" in memo.body_markdown
    assert "## Daftar Sumber" in memo.body_markdown


def test_generate_memo_without_citations_has_no_bibliography_section():
    request = MemoRequest(question="Pertanyaan singkat", answer="Jawaban singkat")
    memo = generate_memo(request)

    assert "## Daftar Sumber" not in memo.body_markdown
    assert "## Perhatian" not in memo.body_markdown