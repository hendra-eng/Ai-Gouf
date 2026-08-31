"""
tests/test_audit_activity.py

[Tahap 4 - no.5] Test modules/audit_activity.py: query gabungan
tax_history.py (predict/risk-score) + tax_qa_log.py (ask) jadi satu
daftar aktivitas AI terurut waktu, untuk laporan "semua aktivitas AI
oleh staf X" / "semua riset untuk klien Y".

tax_history & tax_qa_log di-mock di sini (bukan pakai storage sungguhan)
supaya test ini fokus HANYA menguji logika penggabungan & pengurutan di
audit_activity.py, terlepas dari benar-tidaknya tax_history.py/
tax_qa_log.py sendiri (yang masing-masing sudah punya test sendiri).

Prasyarat: pip install pytest
Jalankan:  pytest tests/test_audit_activity.py -v
"""
from unittest.mock import patch

from modules import audit_activity
from modules.schemas import HistoryEntry


def _fake_history_entry(id, created_at, question="Prediksi X", answer="Menang"):
    return HistoryEntry(
        id=id, user_id="u1", client_id="c1",
        question=question, answer=answer, created_at=created_at,
    )


def _fake_qa_record(id, created_at, question="Apa itu PPh 21?"):
    return {
        "id": id, "user_id": "u1", "client_id": "c1",
        "question": question, "answer": "Jawaban qa",
        "created_at": created_at, "top_k": 5, "num_sources": 2,
        "status_warning_count": 0, "sumber": [],
    }


def test_gabungan_terurut_terbaru_dulu():
    entri_history = [_fake_history_entry("h1", "2026-08-01T10:00:00")]
    entri_qa = [_fake_qa_record("q1", "2026-08-02T09:00:00")]

    with patch.object(audit_activity.tax_history, "get_history", return_value=entri_history), \
         patch.object(audit_activity.tax_qa_log, "list_logs", return_value=entri_qa):
        hasil = audit_activity.get_combined_activity(user_id="u1", limit=10)

    assert [h["id"] for h in hasil] == ["q1", "h1"], (
        "q1 (2026-08-02) harus lebih dulu daripada h1 (2026-08-01)"
    )
    assert hasil[0]["source"] == audit_activity.SOURCE_TAX_QA_LOG
    assert hasil[1]["source"] == audit_activity.SOURCE_TAX_HISTORY


def test_limit_dihormati_setelah_digabung():
    entri_history = [
        _fake_history_entry("h1", "2026-08-01T10:00:00"),
        _fake_history_entry("h2", "2026-07-01T10:00:00"),
    ]
    entri_qa = [_fake_qa_record("q1", "2026-08-02T09:00:00")]

    with patch.object(audit_activity.tax_history, "get_history", return_value=entri_history), \
         patch.object(audit_activity.tax_qa_log, "list_logs", return_value=entri_qa):
        hasil = audit_activity.get_combined_activity(user_id="u1", limit=2)

    assert len(hasil) == 2
    assert [h["id"] for h in hasil] == ["q1", "h1"], "harus ambil 2 terbaru dari gabungan"


def test_detail_tambahan_qa_log_tetap_ada():
    entri_qa = [_fake_qa_record("q1", "2026-08-02T09:00:00")]

    with patch.object(audit_activity.tax_history, "get_history", return_value=[]), \
         patch.object(audit_activity.tax_qa_log, "list_logs", return_value=entri_qa):
        hasil = audit_activity.get_combined_activity(user_id="u1")

    assert hasil[0]["detail_tambahan"]["top_k"] == 5
    assert hasil[0]["detail_tambahan"]["num_sources"] == 2


def test_include_archived_qa_diteruskan():
    """include_archived_qa harus diteruskan apa adanya ke
    tax_qa_log.list_logs() -- penting untuk laporan audit menyeluruh yang
    perlu menjangkau riwayat lama yang sudah diarsipkan."""
    with patch.object(audit_activity.tax_history, "get_history", return_value=[]) as mock_history, \
         patch.object(audit_activity.tax_qa_log, "list_logs", return_value=[]) as mock_qa:
        audit_activity.get_combined_activity(
            user_id="u1", client_id="c1", limit=25, include_archived_qa=True,
        )

    mock_qa.assert_called_once_with(
        user_id="u1", client_id="c1", limit=25, include_archived=True,
    )
    mock_history.assert_called_once_with(user_id="u1", client_id="c1", limit=25)