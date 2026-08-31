"""
tax_rag.py

Dasar: logic inti tanya-jawab pajak.
Alur: pertanyaan user -> embed -> cari chunk relevan -> kirim ke LLM
      dengan instruksi jawab HANYA dari chunk yang diberikan -> jawaban
      + daftar sumber -> catat ke audit log (Tahap 4.3).

[FIX] Sebelumnya file ini punya fungsi embed_text() sendiri (placeholder
hash kata) yang TERPISAH dari modules/embedding.py yang dipakai saat
ingest dokumen (tax_case_ingestion.py, tax_ingestion.py) maupun saat
prediksi (tax_prediction.py). Akibatnya vector pertanyaan & vector
dokumen berada di ruang vektor yang berbeda -> pencarian kemiripan jadi
tidak bermakna. Sekarang pakai modules.embedding.embed_text yang sama,
supaya query & dokumen konsisten satu ruang vektor.

[Tahap 4.3] Logging pertanyaan & jawaban SEKARANG SUDAH ADA (sebelumnya
cuma TODO comment) -- lihat modules/tax_qa_log.py. Dipanggil di KEDUA
jalur return ask_tax_question() (ada hasil retrieval maupun tidak),
supaya pertanyaan yang gagal dijawab karena dokumen belum ada pun tetap
tercatat untuk audit & analisis kesenjangan database.

[Tahap 5, poin 16] Peringatan status "dicabut"/"diubah" sekarang juga
menyertakan info dokumen PENGGANTI (kalau sudah ditandai lewat
modules.tax_ingestion.tandai_digantikan()) -- lihat _info_pengganti() &
pemakaiannya di ask_tax_question(). Sebelumnya akuntan cuma dikasih tahu
"sumber ini sudah tidak berlaku" tanpa tahu aturan mana yang
menggantikannya, jadi tetap harus cari manual.

TODO nanti (versi serius lanjutan):
- Tambah rate limiting / caching
- Tambah re-ranking hasil retrieval sebelum dikirim ke LLM
"""

import os
import time
from dataclasses import dataclass
from typing import Optional

from modules.embedding import embed_text as _embed_text
from modules.vector_store import default_store, SearchResult
from modules.tax_status_tracker import get_status_tracker
from modules.schemas import RegulationStatus
from modules.tax_qa_log import log_qa

# [BARU -- PINDAH KE DEEPSEEK] Sebelumnya modul ini manggil Claude API
# langsung untuk tanya-jawab pajak, tidak konsisten dengan pemisahan tugas
# Claude/DeepSeek yang dipakai di modules/akuntansi_ai.py (lihat komentar
# "[BARU -- PEMISAHAN TUGAS CLAUDE/DEEPSEEK]" di sana): Claude khusus
# olah/ekstrak file, DeepSeek khusus tanya-jawab interaktif. Modul RAG
# pajak ini SECARA FUNGSI adalah tanya-jawab interaktif (user mengetik
# pertanyaan, dapat jawaban) -- bukan tahap "olah file", jadi disamakan
# ke DeepSeek supaya konsisten & biayanya masuk kategori yang sama dengan
# chat biasa (murah per panggilan, cocok untuk dipanggil tiap kali user
# bertanya, bukan cuma sekali per dokumen seperti tahap ingestion).
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

# [Tahap 0.2] Status yang WAJIB memicu peringatan eksplisit ke pengguna.
STATUS_PERINGATAN = {"dicabut", "diubah"}

# [BARU -- RETRY] Konfigurasi retry utk error transient. Pola SAMA dengan
# modules/akuntansi_ai.py::_panggil_deepseek_dengan_retry (dipakai
# tanya_ai/tanya_ai_stream) -- error sesaat (timeout/koneksi/rate limit/
# server error) di-retry dengan exponential backoff, error permanen
# (auth salah, model tidak ada, dst) LANGSUNG di-raise ulang tanpa
# diulang, karena request yang sama akan gagal lagi persis sama.
MAX_RETRY = 3
RETRY_BASE_DELAY = 0.5   # detik -- disamakan dgn akuntansi_ai.py (0.5 * 2^n)


class TaxRagError(Exception):
    """Dilempar kalau konfigurasi/panggilan RAG pajak gagal (mis. API key belum diset)."""


# [Tahap 4 - no.4] Field RegulationMetadata (lihat modules/tax_chunker.py)
# yang boleh dipakai untuk filter pencarian. "kategori_pajak" SENGAJA belum
# masuk daftar ini -- RegulationMetadata belum punya field itu sama sekali
# (baru ada di schemas.SourceDocument.kategori_pajak, yang levelnya dokumen,
# bukan level chunk di vector store). Kalau nanti fitur "tanya khusus dalam
# kategori PPN saja" mau dibuat, kategori_pajak perlu ditambah dulu ke
# RegulationMetadata & diisi saat chunking/ingest -- baru field ini bisa
# ditambah ke daftar di bawah.
FILTER_FIELDS_VALID = {"jenis", "status", "document_id", "case_id", "nomor"}


class FilterTidakValid(TaxRagError):
    """Dilempar kalau AskRequest.filters mengandung field yang tidak
    dikenali/tidak bisa difilter -- supaya salah ketik nama field (mis.
    "kategori" alih-alih "jenis") ketahuan sebagai error yang jelas,
    bukan diam-diam menghasilkan 0 hasil pencarian yang membingungkan."""


@dataclass
class TaxAnswer:
    jawaban: str
    sumber: list[dict]


def _validasi_filters(filters: Optional[dict]) -> dict:
    """
    [Tahap 4 - no.4] AskRequest.filters sebelumnya diterima tapi tidak
    pernah benar-benar dipakai untuk membatasi pencarian -- sekarang
    dipakai, tapi divalidasi dulu di sini (bukan di vector_store.py, yang
    tidak tahu konteks pemanggil) supaya field yang salah ketik/tidak
    dikenal menghasilkan error yang JELAS ke pengguna API, bukan diam-diam
    ter-filter jadi 0 hasil (getattr(chunk.metadata, "field_ngasal", None)
    di vector_store.py tidak akan pernah cocok dengan apa pun).
    """
    if not filters:
        return {}
    field_tidak_dikenal = set(filters) - FILTER_FIELDS_VALID
    if field_tidak_dikenal:
        raise FilterTidakValid(
            f"Field filter tidak dikenal: {sorted(field_tidak_dikenal)}. "
            f"Field yang didukung: {sorted(FILTER_FIELDS_VALID)}."
        )
    return filters


def retrieve_relevant_chunks(
    query: str, top_k: int = 5, filters: Optional[dict] = None
) -> list[SearchResult]:
    """
    [Tahap 4 - no.4] Parameter `filters` BARU -- opsional, dict field->value
    yang dicocokkan PERSIS terhadap metadata tiap chunk (lihat
    modules/tax_chunker.py:RegulationMetadata untuk field yang tersedia,
    dan FILTER_FIELDS_VALID di atas untuk yang didukung lewat parameter
    ini). Default None/{} berarti tidak ada filter -- perilaku persis
    seperti sebelumnya, jadi caller lama yang belum kirim filters tetap
    jalan tanpa berubah.
    """
    filters = _validasi_filters(filters)
    # [FIX] embed_text di sini SEKARANG konsisten dengan yang dipakai saat
    # ingest (lihat modules/embedding.py) -- lihat catatan di docstring atas.
    query_vector = _embed_text(query).tolist()
    return default_store.search(query_vector, top_k=top_k, filters=filters)


def _status_terkini(chunk) -> str:
    """
    [FIX Tahap 0.2] chunk.metadata.status adalah SNAPSHOT status pada saat
    chunk itu di-index. Untuk dokumen (tax_ingestion.py), metadata.status
    ditulis "berlaku" saat pertama kali index dan TIDAK PERNAH ikut berubah
    walau update_status() dipanggil belakangan -- vector store menyimpan
    salinan lama itu selamanya sampai dokumennya di-reindex ulang. Kalau
    validasi cuma baca metadata.status, AI bisa terus bilang suatu aturan
    "berlaku" padahal sebenarnya sudah dicabut minggu lalu.

    Makanya di sini kita selalu cek status TERKINI dari tax_status_tracker
    (single source of truth yang di-update lewat update_status()) kalau
    chunk itu berasal dari dokumen. Untuk chunk putusan pengadilan
    (case_id, bukan document_id), status belum dilacak lewat tracker --
    fallback ke metadata chunk apa adanya.
    """
    meta = chunk.metadata
    doc_id = getattr(meta, "document_id", None)
    if doc_id:
        status = get_status_tracker().get_status(doc_id)
        if status != RegulationStatus.TIDAK_DIKETAHUI:
            return status.value
    return meta.status


def _info_pengganti(document_id: Optional[str]) -> Optional[str]:
    """
    [Tahap 5, poin 16] Kalau `document_id` sudah ditandai digantikan lewat
    modules.tax_ingestion.tandai_digantikan(), kembalikan string ringkas
    identitas dokumen penggantinya (mis. "PMK 168/2024 - Perubahan atas
    PMK ...") untuk ditampilkan di peringatan status.

    Import tax_ingestion dilakukan DI DALAM fungsi (bukan top-level) untuk
    menghindari import siklik -- modules/tax_ingestion.py tidak mengimpor
    tax_rag.py, tapi banyak modul lain di project ini mengimpor keduanya,
    dan pola "import di dalam fungsi" ini sudah dipakai di tempat lain di
    project (mis. scripts/batch_ingest_pajak.py mengimpor tax_ingestion di
    dalam main() dengan alasan serupa) -- konsisten dengan itu.

    Return None kalau document_id kosong, dokumen tidak ditemukan,
    dokumen tidak punya digantikan_oleh, ATAU dokumen penggantinya sendiri
    ternyata tidak ditemukan (mis. id-nya salah ketik saat
    tandai_digantikan() dipanggil) -- semua kasus itu fallback diam-diam
    ke "tidak ada info pengganti" daripada melempar error, supaya satu
    data pengganti yang rusak tidak menggagalkan seluruh pertanyaan.
    """
    if not document_id:
        return None

    from modules.tax_ingestion import get_document

    dokumen = get_document(document_id)
    if not dokumen or not dokumen.digantikan_oleh:
        return None

    pengganti = get_document(dokumen.digantikan_oleh)
    if not pengganti:
        return None

    identitas_nomor = pengganti.nomor or pengganti.id
    return f"{pengganti.doc_type.value} {identitas_nomor} - {pengganti.title}"


def _panggil_deepseek_dengan_retry(prompt: str) -> str:
    """
    [BARU -- PINDAH KE DEEPSEEK] Panggil DeepSeek (lewat SDK `openai`,
    base_url DeepSeek -- sama pola dengan modules/akuntansi_ai.py &
    modules/ai_analysis.py) dengan retry manual utk error transient.

    - Timeout/koneksi/rate-limit/server error (5xx): di-retry dengan
      exponential backoff -- error sesaat begini biasanya pulih sendiri
      dalam hitungan detik.
    - Error permanen (auth salah, model tidak ada, dst): LANGSUNG
      di-raise ulang tanpa retry, karena mengulang request yang sama
      akan gagal lagi persis sama.

    Melempar TaxRagError kalau tetap gagal setelah MAX_RETRY percobaan.
    Return: teks jawaban mentah (str), bukan dict -- beda dari respons
    Claude yang berbentuk content blocks, respons OpenAI-compatible
    DeepSeek sudah berupa 1 string langsung di
    response.choices[0].message.content.
    """
    import openai

    client = openai.OpenAI(
        api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL,
        timeout=60.0, max_retries=0,  # retry manual di sini, bukan bawaan SDK
    )
    error_sementara = (
        openai.APITimeoutError,
        openai.APIConnectionError,
        openai.RateLimitError,
        openai.InternalServerError,
    )

    error_terakhir: Optional[Exception] = None
    for percobaan in range(MAX_RETRY):
        try:
            response = client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                max_tokens=1000,
                temperature=0.2,  # rendah -- jawaban riset pajak butuh presisi, bukan kreativitas
                messages=[{"role": "user", "content": prompt}],
            )
            return response.choices[0].message.content or ""
        except error_sementara as e:
            error_terakhir = e
            if percobaan < MAX_RETRY - 1:
                time.sleep(RETRY_BASE_DELAY * (2 ** percobaan))
                continue
            raise TaxRagError(
                f"Gagal memanggil DeepSeek API setelah {MAX_RETRY} percobaan: {e}"
            ) from e
        except Exception as e:
            # Error permanen (auth/argumen salah/dst) -- jangan diulang.
            raise TaxRagError(f"DeepSeek API mengembalikan error: {e}") from e

    # Tidak akan tercapai (loop di atas selalu return atau raise), tapi
    # dijaga eksplisit demi kejelasan.
    raise TaxRagError(
        f"Gagal memanggil DeepSeek API setelah {MAX_RETRY} percobaan: {error_terakhir}"
    )


def build_prompt(query: str, results: list[SearchResult], live_statuses: list[str]) -> str:
    context_blocks = []
    for i, (r, status) in enumerate(zip(results, live_statuses), start=1):
        meta = r.chunk.metadata
        context_blocks.append(
            f"[Sumber {i}] {meta.jenis} {meta.nomor} - {meta.judul} "
            f"(status TERKINI: {status})\n{r.chunk.text}"
        )

    context_text = "\n\n".join(context_blocks)

    return f"""Kamu adalah asisten riset pajak internal untuk firma akuntansi.
Jawab pertanyaan HANYA berdasarkan sumber-sumber di bawah ini.
Jika sumber tidak cukup untuk menjawab, katakan dengan jelas bahwa
informasi tidak ditemukan dalam sumber yang tersedia — jangan mengarang.

Selalu sertakan referensi [Sumber N] di setiap klaim yang kamu buat.
Jika ada sumber yang berstatus "dicabut" atau "diubah", beri peringatan
eksplisit ke pengguna.

Sumber:
{context_text}

Pertanyaan: {query}

Jawaban:"""


def ask_tax_question(
    query: str,
    top_k: int = 5,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    filters: Optional[dict] = None,
) -> TaxAnswer:
    """
    [Tahap 4.3] Parameter user_id/client_id BARU -- opsional, dipakai untuk
    audit log (siapa tanya apa). Diteruskan dari modules/tax_router.py
    (user["id"] hasil auth.get_current_user, dan client_id dari body
    request kalau ada). Tidak wajib diisi supaya kode lama yang memanggil
    ask_tax_question(query) tanpa argumen tambahan tetap jalan.

    [Tahap 4 - no.4] Parameter `filters` BARU -- opsional, diteruskan apa
    adanya ke retrieve_relevant_chunks() (lihat FILTER_FIELDS_VALID di
    atas untuk field yang didukung). FilterTidakValid dilempar SEBELUM
    embedding/pencarian dijalankan kalau ada field yang tidak dikenal --
    caller (tax_router.py) menangkapnya sebagai TaxRagError (FilterTidakValid
    adalah subclass-nya) dan mengembalikan 400, bukan 500, karena ini
    kesalahan input pengguna, bukan kesalahan konfigurasi server.
    """
    # [Tahap 4 - no.4, FIX] Validasi filters dilakukan PALING AWAL, SEBELUM
    # pengecekan DEEPSEEK_API_KEY di bawah. Ditemukan lewat test sungguhan
    # (tests/test_tax_rag_filters.py) -- urutan semula (API key dicek
    # duluan) membuat filter yang salah ketik ikut "tertutupi" oleh error
    # "API key belum di-set" kalau kebetulan server memang belum
    # dikonfigurasi, padahal FilterTidakValid murni soal INPUT PENGGUNA
    # yang salah, tidak ada hubungannya dengan konfigurasi server sama
    # sekali -- jadi urutannya seharusnya tidak bergantung pada itu.
    # Ditaruh di sini (bukan cuma di dalam retrieve_relevant_chunks(), yang
    # baru dipanggil belakangan) supaya validasinya benar-benar terjadi
    # sebelum ada pengecekan lain apa pun.
    filters = _validasi_filters(filters)

    results = retrieve_relevant_chunks(query, top_k=top_k, filters=filters)

    if not results:
        # [FIX] Kalau tidak ada dokumen relevan sama sekali, kita tidak
        # pernah perlu memanggil DeepSeek API -- jadi cek ini HARUS terjadi
        # SEBELUM cek DEEPSEEK_API_KEY di bawah, sama seperti alasan
        # _validasi_filters() dipindah ke depan (lihat catatan di
        # docstring). Urutan lama (API key dicek duluan) membuat
        # pertanyaan tanpa dokumen ikut gagal dengan TaxRagError walau
        # sebenarnya tidak butuh API key sama sekali untuk kasus ini.
        jawaban = "Belum ada dokumen di database untuk menjawab pertanyaan ini."
        log_qa(
            question=query,
            answer=jawaban,
            sumber=[],
            top_k=top_k,
            status_warning_count=0,
            user_id=user_id,
            client_id=client_id,
        )
        return TaxAnswer(jawaban=jawaban, sumber=[])

    # [FIX] Sebelumnya kalau API key belum di-set, request tetap dikirim
    # dan gagal dengan error yang membingungkan (bukan pesan yang jelas
    # untuk staf/di log). Cek ini ditaruh SETELAH cek "tidak ada dokumen"
    # di atas, karena baru di titik ini kita benar-benar akan memanggil
    # DeepSeek API.
    if not DEEPSEEK_API_KEY:
        raise TaxRagError(
            "DEEPSEEK_API_KEY belum di-set di .env -- tidak bisa memanggil "
            "DeepSeek API untuk menjawab pertanyaan pajak."
        )

    live_statuses = [_status_terkini(r.chunk) for r in results]
    prompt = build_prompt(query, results, live_statuses)

    # [BARU -- PINDAH KE DEEPSEEK] Sebelumnya requests.post() ke Claude API
    # langsung di sini tanpa retry apa pun. Sekarang lewat
    # _panggil_deepseek_dengan_retry() (lihat di atas) -- konsisten dengan
    # pemisahan tugas Claude (olah file)/DeepSeek (tanya-jawab interaktif)
    # yang dipakai modules/akuntansi_ai.py & modules/ai_analysis.py.
    jawaban_text = _panggil_deepseek_dengan_retry(prompt)

    # [FIX Tahap 0.2] Peringatan status TIDAK digantungkan ke kepatuhan LLM
    # terhadap instruksi di prompt saja (model bisa lupa/lewat) -- dibangun
    # eksplisit di sini di level kode, jadi selalu muncul kalau ada sumber
    # bermasalah, apa pun isi jawaban dari model.
    sumber_bermasalah = [
        (i, r, status)
        for i, (r, status) in enumerate(zip(results, live_statuses), start=1)
        if status in STATUS_PERINGATAN
    ]
    if sumber_bermasalah:
        baris_peringatan_list = []
        for i, r, status in sumber_bermasalah:
            doc_id = getattr(r.chunk.metadata, "document_id", None)
            pengganti_text = _info_pengganti(doc_id)
            baris = (
                f"- [Sumber {i}] {r.chunk.metadata.jenis} {r.chunk.metadata.nomor} "
                f"berstatus **{status.upper()}** -- jangan dijadikan dasar tanpa "
                f"verifikasi lebih lanjut."
            )
            # [Tahap 5, poin 16] Kalau sudah diketahui dokumen penggantinya,
            # sebutkan eksplisit -- jauh lebih actionable buat akuntan
            # daripada cuma "sudah tidak berlaku" tanpa tahu harus lihat ke mana.
            if pengganti_text:
                baris += f" Kemungkinan digantikan oleh: {pengganti_text}."
            baris_peringatan_list.append(baris)
        baris_peringatan = "\n".join(baris_peringatan_list)
        jawaban_text = (
            f"⚠️ PERINGATAN: {len(sumber_bermasalah)} dari {len(results)} sumber "
            f"yang dipakai untuk menjawab pertanyaan ini berstatus TIDAK BERLAKU "
            f"lagi:\n{baris_peringatan}\n\n{jawaban_text}"
        )

    sumber = [
        {
            "nomor": r.chunk.metadata.nomor,
            "jenis": r.chunk.metadata.jenis,
            "judul": r.chunk.metadata.judul,
            "status": status,  # status TERKINI (tracker), bukan snapshot chunk
            "digantikan_oleh": _info_pengganti(getattr(r.chunk.metadata, "document_id", None)),
            "cuplikan": r.chunk.text[:200],
            "score": round(r.score, 3),
        }
        for r, status in zip(results, live_statuses)
    ]

    log_qa(
        question=query,
        answer=jawaban_text,
        sumber=sumber,
        top_k=top_k,
        status_warning_count=len(sumber_bermasalah),
        user_id=user_id,
        client_id=client_id,
    )

    return TaxAnswer(jawaban=jawaban_text, sumber=sumber)