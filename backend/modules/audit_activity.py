"""
modules/audit_activity.py

[Tahap 4 - no.5] Ada dua sistem "histori" terpisah dan mirip namanya:

  - modules/tax_history.py  -> dipakai tax_case_router.py untuk /predict
    & /risk-score (prediksi outcome sengketa & risk scoring).
  - modules/tax_qa_log.py   -> dipakai tax_rag.py/tax_router.py untuk
    /tax/ask (tanya-jawab riset pajak biasa), sudah termasuk mekanisme
    retensi/arsip bulanan (Tahap 4).

Ini SENGAJA dibiarkan terpisah (bukan bug) karena melayani endpoint yang
beda karakteristiknya: tax_qa_log.py perlu arsip/rotasi karena volume
pemakaian /tax/ask jauh lebih tinggi daripada /predict & /risk-score, dan
strukturnya pun agak beda (qa_log punya top_k/status_warning_count/sumber,
tax_history cuma question/answer polos). Menggabungkan keduanya jadi satu
tabel fisik akan memaksa salah satu ikut memikul kebutuhan yang lain tanpa
perlu (mis. tax_history jadi ikut butuh arsip padahal volumenya jauh lebih
kecil, atau qa_log kehilangan field top_k/sumber yang spesifik untuknya).

Modul ini TIDAK menggabungkan penyimpanannya -- ia cuma menyediakan lapisan
QUERY GABUNGAN di atas keduanya, untuk kebutuhan seperti "semua aktivitas
AI oleh staf X" atau "semua riset (tanya-jawab + prediksi + risk-score)
untuk klien Y". Kalau nanti volume/kebutuhan compliance berubah drastis dan
memang perlu satu tabel fisik gabungan, modul ini jadi titik satu-satunya
yang perlu diubah -- pemanggil (endpoint) tidak perlu tahu ada 2 sumber
data di baliknya.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from modules import tax_history, tax_qa_log

# Nilai "source" yang muncul di tiap entri hasil get_combined_activity() --
# dipakai UI/laporan untuk tahu entri ini berasal dari jalur mana & bisa
# menampilkan detail tambahan yang spesifik per sumber (mis. field "sumber"
# dokumen cuma ada untuk source="tax_qa_log").
SOURCE_TAX_HISTORY = "tax_history"
SOURCE_TAX_QA_LOG = "tax_qa_log"


def _dari_tax_history(entry) -> Dict[str, Any]:
    """
    Normalisasi satu HistoryEntry (modules/schemas.py) jadi bentuk gabungan.
    HistoryEntry.question/answer untuk endpoint /predict & /risk-score
    sudah diformat jadi teks lengkap oleh
    tax_case_router.py:_format_prediction_untuk_histori() /
    _format_risk_score_untuk_histori() -- bukan cuma ringkasan, jadi tidak
    ada info yang hilang saat ditampilkan di sini apa adanya.
    """
    return {
        "source": SOURCE_TAX_HISTORY,
        "id": entry.id,
        "user_id": entry.user_id,
        "client_id": entry.client_id,
        "question": entry.question,
        "answer": entry.answer,
        "created_at": entry.created_at.isoformat()
        if hasattr(entry.created_at, "isoformat")
        else entry.created_at,
    }


def _dari_qa_log(record: dict) -> Dict[str, Any]:
    """Normalisasi satu record qa_audit_log jadi bentuk gabungan. Field
    yang spesifik untuk qa_log (top_k, num_sources, status_warning_count,
    sumber) TETAP disertakan apa adanya di bawah key "detail_tambahan" --
    tidak dibuang, cuma dipisah dari field umum supaya bentuk gabungan
    tetap seragam/gampang dibaca lintas sumber."""
    return {
        "source": SOURCE_TAX_QA_LOG,
        "id": record.get("id"),
        "user_id": record.get("user_id"),
        "client_id": record.get("client_id"),
        "question": record.get("question"),
        "answer": record.get("answer"),
        "created_at": record.get("created_at"),
        "detail_tambahan": {
            "top_k": record.get("top_k"),
            "num_sources": record.get("num_sources"),
            "status_warning_count": record.get("status_warning_count"),
            "sumber": record.get("sumber"),
        },
    }


def get_combined_activity(
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 50,
    include_archived_qa: bool = False,
) -> List[Dict[str, Any]]:
    """
    Gabungkan entri dari tax_history.py (predict/risk-score) +
    tax_qa_log.py (ask), urut created_at TERBARU dulu, dibatasi `limit`
    entri TOTAL setelah digabung (bukan `limit` per sumber -- supaya
    perilakunya konsisten dengan get_history()/list_logs() yang masing-
    masing juga membatasi total, bukan per-kategori internal).

    `include_archived_qa` diteruskan apa adanya ke tax_qa_log.list_logs()
    -- False (default) cuma baca qa_audit_log aktif (cepat, cocok untuk
    tinjauan rutin); True ikut baca semua arsip bulanan (lebih lambat,
    dipakai untuk laporan audit menyeluruh "semua riwayat client X sejak
    awal"). tax_history.py sendiri belum punya mekanisme arsip terpisah
    (volumenya jauh lebih kecil daripada qa_log, lihat catatan di
    docstring modul ini) jadi get_history() selalu baca tabel penuh.

    Catatan limit: tax_history.get_history() & tax_qa_log.list_logs()
    masing-masing dipanggil dengan `limit` yang SAMA (bukan limit/2 dst)
    supaya kalau salah satu sumber jauh lebih sedikit entrinya daripada
    yang lain, hasil gabungan tetap terisi penuh sampai `limit` dari
    sumber yang lebih banyak -- baru dipotong ke `limit` yang sebenarnya
    setelah digabung & diurutkan ulang di bawah.
    """
    entri_history = tax_history.get_history(
        user_id=user_id, client_id=client_id, limit=limit
    )
    entri_qa = tax_qa_log.list_logs(
        user_id=user_id,
        client_id=client_id,
        limit=limit,
        include_archived=include_archived_qa,
    )

    gabungan = [_dari_tax_history(e) for e in entri_history] + [
        _dari_qa_log(r) for r in entri_qa
    ]

    # `or ""` sengaja (bukan cuma default .get()/getattr) -- konsisten
    # dengan alasan yang sama seperti di tax_qa_log.list_logs(): kalau
    # created_at ADA tapi nilainya None/kosong, sort() akan crash
    # (TypeError) karena membandingkan None dengan str di entri lain.
    gabungan.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return gabungan[:limit]