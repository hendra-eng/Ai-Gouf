"""
modules/claude_client.py
=========================
Titik masuk TERPUSAT untuk SEMUA panggilan ke Claude API (Anthropic) di
seluruh backend. Dipakai oleh:
- ai_file_reader.py (baca file langsung: PDF/gambar/xlsx/docx)
- akuntansi_ai.py (kategorisasi jurnal, lihat _panggil_ai_batch_json_claude)
- modul baru mana pun yang butuh Claude ke depannya (mis. calk_export.py)

[GABUNG] Sebelumnya DUA tempat berbeda masing-masing bikin
`anthropic.Anthropic()` & logika retry sendiri (ai_file_reader.py dan
akuntansi_ai.py) -- sekarang keduanya lewat modul ini. Yang digabung:
1. Client factory (ambil_client) -- diambil dari pola
   ai_file_reader.py::_ambil_client(), DIPERLUAS supaya bisa menerima
   `timeout`/`max_retries` custom (akuntansi_ai.py butuh timeout_detik
   per pemanggilan & max_retries=0 krn sudah py sendiri manual backoff
   di level chunk -- lihat catatan di ambil_client()).
2. Retry generik (panggil_dengan_retry) -- SAMA PERSIS logika dari
   ai_file_reader.py::_panggil_dengan_retry (bedakan error permanen vs
   transient), sekarang dipakai bersama.
3. Structured output (tool use) + audit trail -- fitur baru, belum ada
   sebelumnya di kedua modul lama.

CATATAN PEMBAGIAN TANGGUNG JAWAB (apa yang SENGAJA TIDAK dipindah ke
sini): logika BISNIS tiap pemanggil -- cara menyusun prompt, parsing
hasil per-nomor di kategorisasi jurnal (akuntansi_ai.py), ekstraksi teks
dari xlsx/docx (ai_file_reader.py) -- TETAP di modul masing-masing. Modul
ini HANYA menyediakan lapisan komunikasi API: client, retry, structured
output, audit trail. Begitu juga retry PARALEL per-chunk di
akuntansi_ai.py (_tunggu_sebelum_retry_chunk, dipakai bersama jalur Groq)
SENGAJA TIDAK dipaksa lewat panggil_dengan_retry() di sini -- itu retry
level-chunk yang juga menangani provider Groq (bukan cuma Claude), beda
tanggung jawab dari retry generik single-call di modul ini.

Butuh ANTHROPIC_API_KEY di .env.
"""

from __future__ import annotations

import os
import random
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import anthropic

from .logging_config import get_module_logger

logger = get_module_logger("claude_client")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_DEFAULT = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")

# [DIUBAH -- GROQ SEPENUHNYA, CLAUDE DIHAPUS DARI JALUR INI] Sebelumnya
# panggil_claude_terstruktur() coba Claude dulu, fallback otomatis ke Groq
# kalau gagal. Sekarang jalur Claude di fungsi itu DIHAPUS TOTAL --
# panggil_claude_terstruktur() (dan 5 fungsi narasi yang memakainya:
# analisis_ringkasan_keuangan_claude, generate_narasi_calk_claude,
# generate_narasi_asumsi_claude, generate_ringkasan_eksekutif_claude,
# jelaskan_temuan_kertas_kerja_claude) SEKARANG SELALU memanggil Groq,
# tidak pernah menyentuh Claude API sama sekali. Nama fungsi tetap
# dipertahankan (masih berakhiran "_claude") supaya seluruh pemanggil di
# main.py/kertas_kerja.py/calk_export.py/dashboard.py tidak perlu diubah --
# tapi secara internal semuanya sekarang murni Groq.
#
# TIDAK memengaruhi panggil_claude_teks()/panggil_dengan_retry()/
# ambil_client() yang dipakai ai_file_reader.py (baca PDF/gambar langsung)
# -- itu tetap jalur Claude asli, di luar scope perubahan ini.
#
# [DIUBAH] User hanya punya 2 API key Groq: GROQ_API_KEY (umum) dan
# GROQ_API_KEY_KATEGORISASI (dipakai kategorisasi jurnal, lihat
# ambil_api_key_groq_kategorisasi di akuntansi_ai.py) -- TIDAK ada
# GROQ_API_KEY_NARASI terpisah. Prioritas: GROQ_API_KEY_KATEGORISASI dulu
# (biar konsisten dgn keputusan sebelumnya), kalau kosong jatuh ke
# GROQ_API_KEY umum. TIDAK di-import langsung dari akuntansi_ai.py supaya
# tidak circular import (akuntansi_ai.py sendiri import dari modul ini).
GROQ_API_KEY = os.environ.get("GROQ_API_KEY_KATEGORISASI") or os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL_NARASI = os.environ.get("GROQ_MODEL_NARASI", "openai/gpt-oss-120b")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# [Digabung dari ai_file_reader.py] Konfigurasi retry generik -- SEMUA
# pemanggil lewat panggil_dengan_retry() pakai angka yang sama, bisa
# dituning lewat env var tanpa ubah kode di modul manapun.
MAX_RETRY = int(os.environ.get("CLAUDE_MAX_RETRY", "5"))
RETRY_BASE_DELAY = float(os.environ.get("CLAUDE_RETRY_BASE_DELAY", "1.0"))
RETRY_MAX_DELAY = float(os.environ.get("CLAUDE_RETRY_MAX_DELAY", "30.0"))

# Cache client per kombinasi (timeout, max_retries) -- BUKAN 1 singleton
# tunggal, supaya pemanggil dgn kebutuhan config beda (mis. akuntansi_ai.py
# butuh timeout_detik=90 & max_retries=0) tidak "berebut" satu instance
# dengan pemanggil lain yang pakai default (mis. ai_file_reader.py).
# Pemanggil dgn config yang SAMA tetap dapat instance yang di-reuse.
_clients: Dict[Tuple[Optional[float], int], anthropic.Anthropic] = {}


class ClaudeError(Exception):
    """Dilempar kalau panggilan ke Claude API gagal atau hasilnya tidak sesuai skema."""


def ambil_client(*, timeout: Optional[float] = None, max_retries: int = 0) -> anthropic.Anthropic:
    """
    Client factory terpusat.

    Default (`timeout=None, max_retries=0`) -- dipakai mayoritas pemanggil
    (mis. ai_file_reader.py, panggil_claude_terstruktur di bawah).
    `max_retries=0` di SDK SENGAJA jadi default di sini (beda dari SDK
    yg default-nya retry 2x sendiri) karena panggil_dengan_retry() di
    bawah SUDAH menangani retry secara eksplisit & bisa di-log -- retry
    ganda (SDK + manual) cuma bikin delay total tidak terduga tanpa
    manfaat tambahan.

    Override `timeout`/`max_retries` untuk kebutuhan khusus (mis.
    akuntansi_ai.py::_panggil_ai_batch_json_claude yang butuh
    timeout_detik per panggilan & sudah py retry manual sendiri di level
    chunk paralel, terpisah dari panggil_dengan_retry() di modul ini).
    """
    if not ANTHROPIC_API_KEY:
        raise ClaudeError(
            "ANTHROPIC_API_KEY belum di-set di .env -- tidak bisa memanggil Claude API."
        )
    key = (timeout, max_retries)
    if key not in _clients:
        kwargs: Dict[str, Any] = {"api_key": ANTHROPIC_API_KEY, "max_retries": max_retries}
        if timeout is not None:
            kwargs["timeout"] = timeout
        _clients[key] = anthropic.Anthropic(**kwargs)
    return _clients[key]


def panggil_dengan_retry(**kwargs) -> anthropic.types.Message:
    """
    [Digabung dari ai_file_reader.py::_panggil_dengan_retry, logika SAMA
    PERSIS] Bungkus client.messages.create() dengan retry eksplisit utk
    error transient:
    - 429 rate_limit_error (akun sendiri kena limit): retry dgn backoff.
    - 529 overloaded_error / 500 / 503 (sisi Anthropic bermasalah): retry
      dgn backoff.
    - 400/401/403/404 (error permanen -- request/auth salah): LANGSUNG
      di-raise ulang, tidak ada gunanya diulang.

    Pakai client default (ambil_client() tanpa argumen). Untuk pemanggil
    yang butuh client dgn config custom, panggil ambil_client(...) sendiri
    lalu client.messages.create(...) langsung -- fungsi ini utk kasus
    umum single-call dengan retry.
    """
    client = ambil_client()
    delay = RETRY_BASE_DELAY
    percobaan_terakhir = MAX_RETRY - 1

    for percobaan in range(MAX_RETRY):
        try:
            return client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            if percobaan == percobaan_terakhir:
                raise
            logger.warning(
                f"⚠️ Rate limit (429) dari akun sendiri, percobaan {percobaan + 1}/{MAX_RETRY} "
                f"-- tunggu {delay:.1f}s sebelum coba lagi."
            )
        except anthropic.APIStatusError as e:
            if e.status_code not in (500, 503, 529) or percobaan == percobaan_terakhir:
                raise
            logger.warning(
                f"⚠️ API Anthropic sedang tidak stabil (status {e.status_code}), "
                f"percobaan {percobaan + 1}/{MAX_RETRY} -- tunggu {delay:.1f}s sebelum coba lagi."
            )
        except anthropic.APIConnectionError:
            if percobaan == percobaan_terakhir:
                raise
            logger.warning(
                f"⚠️ Koneksi ke API Anthropic gagal, percobaan {percobaan + 1}/{MAX_RETRY} "
                f"-- tunggu {delay:.1f}s sebelum coba lagi."
            )

        time.sleep(delay + random.uniform(0, delay * 0.3))
        delay = min(RETRY_MAX_DELAY, delay * 2)

    raise ClaudeError("Gagal memanggil Claude API setelah retry maksimum.")  # tidak akan tercapai


def _catat_audit(
    modul_pemanggil: str,
    client_id: Optional[str],
    aksi: str,
    berhasil: bool,
    keterangan: str = "",
) -> None:
    """
    Catat jejak pemanggilan Claude ke audit trail.

    [TODO] Sambungkan ke modules/audit_activity.py sesuai signature fungsi
    yang sudah ada di sana. Dibungkus try/except supaya kegagalan audit
    TIDAK menggagalkan request AI utama. Sengaja TIDAK menyimpan isi
    prompt/jawaban mentah di sini -- cukup metadata (modul, client_id,
    aksi, status) supaya audit log sendiri tidak ikut menyimpan data
    sensitif client.
    """
    try:
        from .audit_activity import catat_aktivitas  # sesuaikan nama fungsi asli

        catat_aktivitas(
            modul=modul_pemanggil,
            client_id=client_id,
            aksi=f"panggil_claude:{aksi}",
            status="sukses" if berhasil else "gagal",
            keterangan=keterangan,
        )
    except Exception as e:  # pragma: no cover - audit tidak boleh gagalkan flow utama
        logger.warning(f"⚠️ Gagal mencatat audit trail panggilan Claude: {e}")


def _panggil_groq_terstruktur(
    prompt: str, system_prompt: str, tool_schema: Dict[str, Any], *, max_tokens: int = 1024,
) -> Dict[str, Any]:
    """
    [BARU -- FALLBACK GROQ SEMENTARA] Versi Groq dari panggil_claude_terstruktur()
    di bawah -- Groq (lewat endpoint OpenAI-compatible) TIDAK dipaksa pakai
    tool-use asli, cukup diminta jawab JSON sesuai skema langsung di prompt
    (SAMA PERSIS pola yang sudah dipakai & terbukti jalan di
    akuntansi_ai.py::_proses_satu_chunk_ai untuk kategorisasi jurnal) --
    lebih sederhana & tidak butuh terjemahkan skema Anthropic tool-use ke
    format function-calling OpenAI.

    Melempar Exception apa adanya kalau gagal (koneksi/JSON tidak valid/dst)
    -- caller (panggil_claude_terstruktur) yang menangkap & menyatukan pesan
    error dgn kegagalan Claude sebelumnya.
    """
    import json
    import re

    import openai

    if not GROQ_API_KEY:
        raise ClaudeError("GROQ_API_KEY_KATEGORISASI (atau GROQ_API_KEY) belum di-set -- tidak bisa memanggil Groq.")

    skema_str = json.dumps(tool_schema.get("input_schema", {}), ensure_ascii=False, indent=2)
    prompt_json = (
        f"{prompt}\n\n"
        "Jawab HANYA dalam format JSON yang valid (tanpa markdown code fence, tanpa "
        f"teks tambahan apa pun sebelum/sesudahnya), mengikuti skema berikut PERSIS:\n{skema_str}"
    )

    client = openai.OpenAI(api_key=GROQ_API_KEY, base_url=GROQ_BASE_URL, timeout=90.0, max_retries=0)
    resp = client.chat.completions.create(
        model=GROQ_MODEL_NARASI,
        max_tokens=max_tokens,
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_json},
        ],
    )
    teks = resp.choices[0].message.content.strip()
    teks = re.sub(r"^```(json)?|```$", "", teks, flags=re.MULTILINE).strip()
    return json.loads(teks)


def panggil_claude_terstruktur(
    prompt: str,
    system_prompt: str,
    tool_schema: Dict[str, Any],
    *,
    modul_pemanggil: str,
    client_id: Optional[str] = None,
    redaksi_fn: Optional[Callable[[str], str]] = None,
    max_tokens: int = 1024,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    [DIUBAH -- SEKARANG SELALU GROQ, CLAUDE DIHAPUS] Nama fungsi & seluruh
    signature tetap dipertahankan (dipakai oleh 5 fungsi narasi:
    analisis_ringkasan_keuangan_claude, generate_narasi_calk_claude,
    generate_narasi_asumsi_claude, generate_ringkasan_eksekutif_claude,
    jelaskan_temuan_kertas_kerja_claude -- dan lewat mereka, oleh
    main.py/kertas_kerja.py/calk_export.py/dashboard.py) supaya TIDAK ADA
    pemanggil yang perlu diubah. Tapi jalur Claude (panggil_dengan_retry +
    MODEL_DEFAULT) SUDAH DIHAPUS TOTAL dari fungsi ini -- sekarang SELALU
    langsung memanggil Groq (_panggil_groq_terstruktur), tidak pernah
    mencoba Claude API sama sekali, dan `model` param di sini tidak lagi
    dipakai untuk memilih model Claude (dibiarkan ada demi kompatibilitas
    signature, tidak diteruskan ke Groq -- Groq selalu pakai
    GROQ_MODEL_NARASI).

    Args:
        prompt: isi pesan user, HARUS sudah berupa data yang sudah
            disaring pemanggil (bukan dump mentah dari database).
        system_prompt: instruksi peran/batasan untuk model.
        tool_schema: dict dengan key "name", "description", "input_schema"
            (dipakai sebagai skema JSON yang diminta ke Groq).
        modul_pemanggil / client_id: metadata untuk audit trail.
        redaksi_fn: fungsi opsional untuk menyamarkan data sensitif di
            `prompt` sebelum dikirim.
        max_tokens: diteruskan ke Groq.
        model: TIDAK dipakai lagi (Claude dihapus) -- dibiarkan di
            signature supaya pemanggil lama yang masih mengirim argumen
            ini tidak error.

    Returns: dict sesuai tool_schema["input_schema"] (sudah dict Python).
    Lempar ClaudeError kalau GROQ_API_KEY_KATEGORISASI/GROQ_API_KEY
    kosong atau panggilan/parsing Groq gagal.
    """
    tool_name = tool_schema["name"]
    prompt_final = redaksi_fn(prompt) if redaksi_fn else prompt

    try:
        hasil = _panggil_groq_terstruktur(prompt_final, system_prompt, tool_schema, max_tokens=max_tokens)
        _catat_audit(modul_pemanggil, client_id, tool_name, berhasil=True)
        return hasil
    except Exception as error_groq:
        logger.error(f"❌ Gagal memanggil Groq API (structured/{tool_name}): {error_groq}")
        _catat_audit(modul_pemanggil, client_id, tool_name, berhasil=False, keterangan=str(error_groq))
        raise ClaudeError(f"Gagal memanggil Groq API: {error_groq}") from error_groq


def _panggil_groq_teks(content: Any, system_prompt: Optional[str], max_tokens: int) -> str:
    """
    [BARU -- FALLBACK GROQ KATEGORISASI utk panggil_claude_teks()] Versi
    Groq dari panggil_claude_teks() di bawah. KETERBATASAN PENTING: Groq
    (lewat endpoint OpenAI-compatible) TIDAK BISA menerima blok konten
    bertipe "image"/"document" ala Anthropic (mis. PDF/gambar base64
    yang dikirim ai_file_reader.py::siapkan_konten_pesan_dari_file) --
    kalau `content` mengandung blok non-teks, fungsi ini SENGAJA gagal
    dgn ClaudeError yang jelas, BUKAN diam-diam mengirim data yang salah
    format ke Groq. Hanya mendukung `content` berupa string biasa, atau
    list blok yang SEMUANYA bertipe "text".
    """
    import openai

    if not GROQ_API_KEY:
        raise ClaudeError("GROQ_API_KEY_KATEGORISASI (atau GROQ_API_KEY) belum di-set -- tidak bisa fallback ke Groq.")

    if isinstance(content, str):
        teks_user = content
    elif isinstance(content, list):
        tipe_non_teks = sorted({b.get("type") for b in content if isinstance(b, dict) and b.get("type") != "text"})
        if tipe_non_teks:
            raise ClaudeError(
                f"Fallback Groq tidak mendukung konten bertipe {tipe_non_teks} -- "
                "PDF/gambar base64 hanya bisa dibaca lewat Claude API, tidak ada "
                "jalur Groq untuk itu saat ini."
            )
        teks_user = "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    else:
        raise ClaudeError(f"Tipe content tidak dikenali untuk fallback Groq: {type(content)}")

    client = openai.OpenAI(api_key=GROQ_API_KEY, base_url=GROQ_BASE_URL, timeout=90.0, max_retries=0)
    messages: List[Dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": teks_user})

    resp = client.chat.completions.create(
        model=GROQ_MODEL_NARASI,
        max_tokens=max_tokens,
        temperature=0,
        messages=messages,
    )
    return resp.choices[0].message.content.strip()


def panggil_claude_teks(
    content: Any,
    *,
    modul_pemanggil: str,
    client_id: Optional[str] = None,
    system_prompt: Optional[str] = None,
    max_tokens: int = 8192,
    model: Optional[str] = None,
) -> str:
    """
    Untuk kasus yang butuh jawaban teks bebas (BUKAN structured output) --
    dipakai oleh ai_file_reader.py (baca PDF/gambar/xlsx/docx) dan
    akuntansi_ai.py (kategorisasi jurnal batch).

    `content` boleh string biasa (prompt teks) ATAU list of content
    blocks (mis. campuran teks + gambar/PDF base64, format yang sama
    dipakai ai_file_reader.py::siapkan_konten_pesan_dari_file).

    [BARU -- FALLBACK GROQ KATEGORISASI] Kalau panggilan Claude gagal APA
    PUN alasannya (setelah retry internal panggil_dengan_retry() habis),
    otomatis dicoba ulang SEKALI lewat Groq (pakai
    GROQ_API_KEY_KATEGORISASI, fallback ke GROQ_API_KEY umum) SEBELUM
    benar-benar melempar ClaudeError ke pemanggil.

    KETERBATASAN: fallback Groq HANYA berfungsi kalau `content` adalah
    teks murni. Kalau `content` berisi blok gambar/PDF (dipakai
    ai_file_reader.py utk baca file langsung), fallback akan gagal dgn
    pesan jelas -- Groq versi OpenAI-compatible tidak bisa memproses
    gambar/PDF base64 ala Anthropic. Untuk pemanggil teks murni (mis.
    kategorisasi jurnal), fallback berfungsi penuh.
    """
    kwargs: Dict[str, Any] = {
        "model": model or MODEL_DEFAULT,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content}],
    }
    if system_prompt:
        kwargs["system"] = system_prompt

    try:
        resp = panggil_dengan_retry(**kwargs)
        _catat_audit(modul_pemanggil, client_id, "teks_bebas", berhasil=True)
        return resp.content[0].text
    except Exception as error_claude:
        logger.warning(f"⚠️ Claude gagal (teks bebas): {error_claude}")

        if not GROQ_API_KEY:
            logger.error(f"❌ Gagal memanggil Claude API (teks bebas): {error_claude}")
            _catat_audit(modul_pemanggil, client_id, "teks_bebas", berhasil=False, keterangan=str(error_claude))
            raise ClaudeError(f"Gagal memanggil Claude API: {error_claude}") from error_claude

        logger.info(f"↪️ Fallback ke Groq ({GROQ_MODEL_NARASI}) untuk teks bebas (modul: {modul_pemanggil})...")
        try:
            hasil = _panggil_groq_teks(content, system_prompt, max_tokens)
            _catat_audit(
                modul_pemanggil, client_id, "teks_bebas", berhasil=True,
                keterangan=f"Fallback Groq (Claude gagal: {error_claude})",
            )
            return hasil
        except Exception as error_groq:
            logger.error(
                f"❌ Fallback Groq juga gagal (teks bebas): {error_groq} "
                f"(Claude sebelumnya gagal: {error_claude})"
            )
            _catat_audit(
                modul_pemanggil, client_id, "teks_bebas", berhasil=False,
                keterangan=f"Claude gagal: {error_claude}; Groq gagal: {error_groq}",
            )
            raise ClaudeError(
                f"Gagal memanggil Claude ({error_claude}) maupun Groq ({error_groq})."
            ) from error_groq


# ============================================================
# CONTOH PEMAKAIAN structured output -- setara
# ai_analysis.analisis_ringkasan_keuangan(), versi Claude. Hapus/ganti
# sesuai kebutuhan modul yang benar-benar memanggil.
# ============================================================

_TOOL_RINGKASAN_KEUANGAN = {
    "name": "kirim_ringkasan_keuangan",
    "description": "Kirim hasil analisis ringkasan keuangan client",
    "input_schema": {
        "type": "object",
        "properties": {
            "ringkasan": {"type": "string"},
            "temuan_penting": {"type": "array", "items": {"type": "string"}},
            "potensi_masalah": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["ringkasan", "temuan_penting", "potensi_masalah"],
    },
}

_SYSTEM_PROMPT_RINGKASAN = (
    "Kamu adalah asisten akuntan yang menganalisis data hasil pemrosesan "
    "dokumen keuangan sebuah client. Berikan ringkasan singkat, temuan "
    "penting, dan potensi masalah/anomali dalam Bahasa Indonesia yang "
    "jelas dan ringkas."
)


def analisis_ringkasan_keuangan_claude(
    ringkasan_input: List[Dict[str, Any]],
    client_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Setara ai_analysis.analisis_ringkasan_keuangan() tapi lewat Claude.
    `ringkasan_input` HARUS sudah disaring pemanggil.

    Returns dict {"ringkasan": str, "temuan_penting": List[str],
    "potensi_masalah": List[str]} -- field "temuan_penting" &
    "potensi_masalah" inilah yang dipakai untuk mengisi blok baru di
    sheet "Ringkasan" pada export 18-sheet (lihat
    modules/laporan_ai_narasi.py::siapkan_data_ai_untuk_export -- data
    dilewatkan lewat data["ringkasan_analisis"], BUKAN dipanggil dari
    dalam accounting_export.py, supaya penulisan Excel tetap murni
    deterministik & cepat, terpisah dari panggilan network ke Claude)."""
    import json

    prompt = (
        "Berikut data hasil pemrosesan dokumen keuangan sebuah client "
        "(format JSON):\n\n"
        f"{json.dumps(ringkasan_input, ensure_ascii=False, default=str)}\n\n"
        "Analisis data ini dan kirim hasilnya lewat tool yang tersedia."
    )

    return panggil_claude_terstruktur(
        prompt,
        _SYSTEM_PROMPT_RINGKASAN,
        _TOOL_RINGKASAN_KEUANGAN,
        modul_pemanggil="ai_analysis",
        client_id=client_id,
    )


# ============================================================
# NARASI CALK (Catatan atas Laporan Keuangan) -- dipakai sheet "Catatan
# atas Laporan Keuangan" di export 18-sheet. Kerangka CALK punya 7
# catatan baku (susun_calk_otomatis() di laporan_keuangan.py); Catatan
# #3 & #4 (rincian akun Neraca/Laba Rugi) SUDAH terisi angka otomatis
# oleh _tulis_sheet_calk() di accounting_export.py -- yang BELUM terisi
# adalah catatan naratif (mis. "Dasar Penyusunan", "Kebijakan Akuntansi
# Signifikan", "Peristiwa Setelah Tanggal Pelaporan", dst, biasanya
# nomor 1/2/5/6/7). Fungsi ini generate teks kolom "Rincian/Penjelasan"
# untuk catatan-catatan naratif tsb, berdasarkan kerangka + ringkasan
# angka neraca/laba-rugi client -- BUKAN menghitung ulang angkanya
# (angka tetap dari susun_neraca()/susun_laba_rugi(), Claude hanya
# menyusun kalimat penjelasannya).
# ============================================================

_TOOL_NARASI_CALK = {
    "name": "kirim_narasi_calk",
    "description": (
        "Kirim narasi/penjelasan untuk tiap catatan CALK yang bersifat "
        "naratif (bukan tabel rincian akun)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "catatan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "no": {"type": "string", "description": "Nomor catatan, mis. '1', '2', '5'."},
                        "narasi": {
                            "type": "string",
                            "description": (
                                "Isi penjelasan untuk catatan ini, dalam Bahasa Indonesia, "
                                "gaya bahasa laporan keuangan formal, 2-5 kalimat."
                            ),
                        },
                    },
                    "required": ["no", "narasi"],
                },
            },
        },
        "required": ["catatan"],
    },
}

_SYSTEM_PROMPT_NARASI_CALK = (
    "Kamu adalah akuntan yang menyusun Catatan atas Laporan Keuangan (CALK) "
    "untuk laporan keuangan tahunan sebuah badan usaha di Indonesia. Kamu "
    "HANYA menulis narasi penjelasan untuk catatan-catatan yang bersifat "
    "naratif (mis. dasar penyusunan, kebijakan akuntansi signifikan, mata "
    "uang pelaporan, peristiwa setelah tanggal pelaporan) -- JANGAN "
    "mengarang angka atau menghitung ulang saldo apa pun; angka pada "
    "laporan sudah final dan TIDAK berasal dari kamu. Tulis dalam Bahasa "
    "Indonesia formal/baku sesuai gaya laporan keuangan, ringkas dan "
    "faktual berdasarkan data yang diberikan -- kalau data tidak cukup "
    "untuk suatu catatan, tulis kalimat standar/umum yang wajar untuk "
    "kondisi tsb tanpa mengarang detail spesifik yang tidak ada di data."
)


def generate_narasi_calk_claude(
    kerangka_catatan: List[str],
    ringkasan_neraca: Dict[str, Any],
    ringkasan_laba_rugi: Dict[str, Any],
    asumsi: Dict[str, Any],
    *,
    catatan_yang_sudah_ada_angkanya: Optional[List[str]] = None,
    client_id: Optional[str] = None,
) -> Dict[str, str]:
    """Generate narasi utk catatan CALK yang butuh teks (bukan tabel akun).

    Args:
        kerangka_catatan: list judul 7 catatan baku, mis.
            ["1. Dasar Penyusunan Laporan Keuangan", "2. Kebijakan
            Akuntansi Signifikan", ...] -- SAMA PERSIS dengan
            calk["kerangka_catatan"] yang sudah ada.
        ringkasan_neraca / ringkasan_laba_rugi: angka ringkas (total
            aset, total liabilitas, metode penyusutan dari asumsi, dst)
            SUDAH DISARING pemanggil -- jangan kirim seluruh detail akun.
        asumsi: dict asumsi (mata_uang, metode_penyusutan, dst) dari
            data["asumsi"], dipakai supaya narasi kebijakan akuntansi
            konsisten dgn parameter yang dipilih akuntan.
        catatan_yang_sudah_ada_angkanya: nomor catatan yang SUDAH diisi
            tabel angka otomatis (default ["3", "4"]) -- narasi TIDAK
            digenerate untuk nomor ini supaya tidak duplikat/konflik
            dengan tabel yang sudah ada.

    Returns:
        Dict {"1": "narasi...", "2": "narasi...", ...} -- siap dipakai
        sebagai calk["narasi_catatan"] sebelum data dikirim ke
        export_18_sheet_lengkap()/export_18_sheet_sebagai_json().
    """
    import json

    kecuali = set(catatan_yang_sudah_ada_angkanya or ["3", "4"])

    prompt = (
        "Kerangka catatan CALK (7 catatan baku):\n"
        f"{json.dumps(kerangka_catatan, ensure_ascii=False)}\n\n"
        f"Catatan yang SUDAH punya tabel rincian angka (JANGAN dibuatkan "
        f"narasi lagi): {sorted(kecuali)}\n\n"
        "Ringkasan Neraca (untuk konteks, bukan untuk ditulis ulang "
        f"angkanya):\n{json.dumps(ringkasan_neraca, ensure_ascii=False, default=str)}\n\n"
        "Ringkasan Laba Rugi (untuk konteks):\n"
        f"{json.dumps(ringkasan_laba_rugi, ensure_ascii=False, default=str)}\n\n"
        f"Asumsi/parameter laporan:\n{json.dumps(asumsi, ensure_ascii=False, default=str)}\n\n"
        "Susun narasi untuk SETIAP catatan di kerangka SELAIN nomor yang "
        "sudah disebutkan di atas, kirim lewat tool yang tersedia."
    )

    hasil = panggil_claude_terstruktur(
        prompt,
        _SYSTEM_PROMPT_NARASI_CALK,
        _TOOL_NARASI_CALK,
        modul_pemanggil="calk_export",
        client_id=client_id,
        max_tokens=2048,
    )
    return {item["no"]: item["narasi"] for item in hasil.get("catatan", [])}


# ============================================================
# NARASI ASUMSI -- dipakai sheet "Petunjuk & Asumsi". Bagian tabel
# parameter (mata uang, metode penyusutan, saldo awal, dst) TETAP
# angka/formula asli (TIDAK disentuh AI) -- yang digenerate Claude
# HANYA 1 paragraf ringkas yang menjelaskan asumsi tsb dalam bahasa
# naratif, ditempel sebagai catatan tambahan di bawah tabel yang sudah
# ada (lihat _tulis_sheet_petunjuk_asumsi() di accounting_export.py).
# ============================================================

_TOOL_NARASI_ASUMSI = {
    "name": "kirim_narasi_asumsi",
    "description": "Kirim 1 paragraf penjelasan naratif atas asumsi/parameter laporan keuangan.",
    "input_schema": {
        "type": "object",
        "properties": {
            "narasi": {
                "type": "string",
                "description": "1 paragraf (3-6 kalimat), Bahasa Indonesia formal.",
            },
        },
        "required": ["narasi"],
    },
}

_SYSTEM_PROMPT_NARASI_ASUMSI = (
    "Kamu akuntan yang menjelaskan secara naratif asumsi/parameter yang "
    "dipakai dalam penyusunan satu set laporan keuangan (mis. metode "
    "penyusutan, mata uang pelaporan, periode laporan). Tulis 1 paragraf "
    "ringkas Bahasa Indonesia formal untuk pembaca laporan (mis. direksi "
    "atau kantor pajak) -- JANGAN mengarang angka/parameter yang tidak "
    "ada di data yang diberikan."
)


def generate_narasi_asumsi_claude(
    asumsi: Dict[str, Any],
    *,
    client_id: Optional[str] = None,
) -> str:
    """Generate 1 paragraf narasi penjelasan asumsi laporan (dipakai
    sheet "Petunjuk & Asumsi"). `asumsi` = data["asumsi"] yang SUDAH
    disaring pemanggil (mata_uang, metode_penyusutan, periode, dst)."""
    import json

    prompt = (
        "Berikut parameter/asumsi laporan keuangan (format JSON):\n\n"
        f"{json.dumps(asumsi, ensure_ascii=False, default=str)}\n\n"
        "Susun narasi penjelasannya dan kirim lewat tool yang tersedia."
    )

    hasil = panggil_claude_terstruktur(
        prompt,
        _SYSTEM_PROMPT_NARASI_ASUMSI,
        _TOOL_NARASI_ASUMSI,
        modul_pemanggil="asumsi_export",
        client_id=client_id,
        max_tokens=512,
    )
    return hasil.get("narasi", "")


# ============================================================
# RINGKASAN EKSEKUTIF -- setara ai_analysis.buat_ringkasan_eksekutif()
# (sebelumnya DeepSeek), versi Claude. Dipakai endpoint
# POST /api/client/{id}/ringkasan-eksekutif di main.py -- beda dari
# analisis_ringkasan_keuangan_claude() di atas: input di sini SUDAH
# berupa kartu angka ringkas (bukan riwayat mentah), dan output-nya
# HANYA 1 narasi (bukan ringkasan+temuan+masalah terpisah), karena
# fitur ini utk klien NON-AKUNTAN (pemilik bisnis) -- bahasa harus awam,
# fokus ke apa artinya bagi bisnis mereka, bukan istilah teknis akuntansi.
# ============================================================

_TOOL_RINGKASAN_EKSEKUTIF = {
    "name": "kirim_ringkasan_eksekutif",
    "description": "Kirim narasi ringkasan eksekutif untuk pemilik bisnis (klien non-akuntan).",
    "input_schema": {
        "type": "object",
        "properties": {
            "narasi": {
                "type": "string",
                "description": (
                    "Narasi ringkas 2-4 paragraf, Bahasa Indonesia, bahasa AWAM "
                    "(bukan istilah teknis akuntansi tanpa penjelasan), untuk "
                    "pemilik bisnis yang bukan akuntan."
                ),
            },
        },
        "required": ["narasi"],
    },
}

_SYSTEM_PROMPT_RINGKASAN_EKSEKUTIF = (
    "Kamu asisten yang menjelaskan kondisi keuangan bisnis kepada pemilik "
    "usaha yang BUKAN akuntan. Gunakan bahasa awam dan hindari istilah "
    "teknis akuntansi tanpa penjelasan sederhana -- fokus ke apa artinya "
    "bagi bisnis mereka (mis. 'kas cukup untuk operasional bulan depan', "
    "'ada tagihan pelanggan yang belum tertagih cukup besar'), bukan "
    "sekadar mengulang angka mentah. JANGAN mengarang angka atau kondisi "
    "yang tidak ada di data yang diberikan."
)


def generate_ringkasan_eksekutif_claude(
    kartu_utama: Dict[str, Any],
    per_kategori: Dict[str, Any],
    *,
    client_id: Optional[str] = None,
) -> str:
    """Setara ai_analysis.buat_ringkasan_eksekutif() tapi lewat Claude.
    `kartu_utama`/`per_kategori` = hasil dashboard.ringkas_eksekutif_dari_riwayat()
    (lihat _hitung_angka_ringkasan_eksekutif() di main.py) -- SUDAH berupa
    angka ringkas, bukan riwayat mentah, jadi aman dikirim apa adanya.

    Returns: 1 string narasi, siap dipakai langsung sebagai field "narasi"
    di response endpoint ringkasan-eksekutif."""
    import json

    prompt = (
        "Kartu angka utama:\n"
        f"{json.dumps(kartu_utama, ensure_ascii=False, default=str)}\n\n"
        "Rincian per kategori:\n"
        f"{json.dumps(per_kategori, ensure_ascii=False, default=str)}\n\n"
        "Susun narasi ringkasan eksekutif dan kirim lewat tool yang tersedia."
    )

    hasil = panggil_claude_terstruktur(
        prompt,
        _SYSTEM_PROMPT_RINGKASAN_EKSEKUTIF,
        _TOOL_RINGKASAN_EKSEKUTIF,
        modul_pemanggil="ringkasan_eksekutif",
        client_id=client_id,
        max_tokens=1024,
    )
    return hasil.get("narasi", "")


# ============================================================
# REVIEW FINAL KERTAS KERJA -- dipakai
# kertas_kerja.generate_kertas_kerja(pakai_claude_review_final=True).
# BEDA dari perbaiki_gl_dengan_claude_review (di kertas_kerja.py, review
# klasifikasi PER BARIS transaksi): fungsi ini menjelaskan/memprioritaskan
# TEMUAN VALIDASI STRUKTUR & KONSISTENSI yang sudah dihitung kode Python
# biasa di kertas_kerja.jalankan_validasi_otomatis_kertas_kerja() --
# Claude TIDAK diminta menghitung ulang angka atau memutuskan benar/salah,
# HANYA menerjemahkan daftar temuan teknis jadi narasi yang mudah dibaca
# akuntan + urutan prioritas penanganan. Input yang dikirim HANYA daftar
# temuan terstruktur (label/status/pesan) -- TIDAK ada data transaksi
# client mentah, konsisten dgn prinsip audit trail di modul ini.
# ============================================================

_TOOL_REVIEW_FINAL_KK = {
    "name": "kirim_review_final_kertas_kerja",
    "description": (
        "Kirim penjelasan & urutan prioritas atas temuan validasi kertas kerja."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ringkasan": {
                "type": "string",
                "description": (
                    "1-2 kalimat ringkasan kondisi kertas kerja secara umum "
                    "berdasarkan temuan yang diberikan."
                ),
            },
            "prioritas": {
                "type": "array",
                "description": (
                    "Temuan diurutkan dari yang PALING PENTING ditangani akuntan "
                    "lebih dulu."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "area": {
                            "type": "string",
                            "description": "Nilai 'area' persis seperti di input.",
                        },
                        "penjelasan": {
                            "type": "string",
                            "description": (
                                "Jelaskan temuan ini dalam bahasa akuntan yang "
                                "mudah dipahami, maksimal 2 kalimat."
                            ),
                        },
                        "saran_tindak_lanjut": {
                            "type": "string",
                            "description": (
                                "Langkah konkret yang sebaiknya diambil akuntan "
                                "(mis. sheet mana yang perlu dicek, dokumen "
                                "pendukung apa yang perlu diminta) -- maksimal 2 "
                                "kalimat. JANGAN mengarang penyebab yang tidak "
                                "ada dasarnya di temuan yang diberikan."
                            ),
                        },
                    },
                    "required": ["area", "penjelasan", "saran_tindak_lanjut"],
                },
            },
        },
        "required": ["ringkasan", "prioritas"],
    },
}

_SYSTEM_PROMPT_REVIEW_FINAL_KK = (
    "Kamu adalah asisten akuntan senior yang mereview HASIL VALIDASI "
    "(bukan data transaksi mentah) dari sebuah working paper/kertas kerja "
    "laporan keuangan yang digenerate otomatis dari rekening koran. Setiap "
    "temuan yang diberikan SUDAH DIHITUNG oleh kode -- kamu TIDAK perlu "
    "dan TIDAK BOLEH menghitung ulang atau meragukan angkanya. Tugasmu "
    "HANYA: (1) jelaskan tiap temuan dalam bahasa akuntan yang mudah "
    "dipahami, (2) urutkan berdasarkan mana yang paling penting ditangani "
    "lebih dulu, (3) sarankan langkah tindak lanjut yang konkret dan wajar "
    "untuk jenis temuan tsb (mis. 'GL tidak balance' -> sarankan cek baris "
    "mana yang menyebabkan selisih). JANGAN mengarang penyebab spesifik "
    "yang tidak ada dasarnya di temuan yang diberikan -- kalau temuan "
    "tidak cukup detail untuk menyimpulkan penyebab pastinya, katakan "
    "perlu penelusuran manual, jangan menebak."
)


def jelaskan_temuan_kertas_kerja_claude(
    temuan_error: List[Dict[str, Any]],
    *,
    client_id: Optional[str] = None,
) -> str:
    """Kirim daftar temuan validasi (level "error" saja -- disaring oleh
    pemanggil di kertas_kerja.py) ke Claude untuk dijelaskan & diurutkan
    prioritasnya. `temuan_error` = list dict {"level", "area", "pesan"}
    dari kertas_kerja.jalankan_validasi_otomatis_kertas_kerja().

    HANYA mengirim daftar temuan terstruktur (bukan DataFrame/transaksi
    mentah) -- lihat catatan privasi di blok komentar atas fungsi ini.

    Returns: 1 string narasi siap ditampilkan ke user (ringkasan + daftar
    prioritas terformat), disimpan sebagai HasilKertasKerja.catatan_review_final.
    Lempar ClaudeError kalau panggilan API gagal -- pemanggil
    (generate_kertas_kerja) membungkus ini dengan try/except supaya
    kegagalan di sini TIDAK menggagalkan proses generate secara keseluruhan.
    """
    import json

    if not temuan_error:
        return ""

    prompt = (
        "Berikut temuan validasi (hasil hitungan kode, BUKAN untuk dihitung "
        "ulang) dari sebuah kertas kerja laporan keuangan:\n\n"
        f"{json.dumps(temuan_error, ensure_ascii=False, indent=2)}\n\n"
        "Jelaskan & urutkan prioritas temuan ini, kirim lewat tool yang tersedia."
    )

    hasil = panggil_claude_terstruktur(
        prompt,
        _SYSTEM_PROMPT_REVIEW_FINAL_KK,
        _TOOL_REVIEW_FINAL_KK,
        modul_pemanggil="kertas_kerja_review_final",
        client_id=client_id,
        max_tokens=2048,
    )

    ringkasan = hasil.get("ringkasan", "")
    baris_prioritas = []
    for i, item in enumerate(hasil.get("prioritas", []), start=1):
        baris_prioritas.append(
            f"{i}. [{item.get('area', '')}] {item.get('penjelasan', '')}\n"
            f"   -> Saran: {item.get('saran_tindak_lanjut', '')}"
        )
    return ringkasan + ("\n\n" + "\n".join(baris_prioritas) if baris_prioritas else "")