"""
voice_claude.py
===============
Jalur Claude (UTAMA) untuk asisten suara Neo. Groq tetap jadi CADANGAN.

Alur:
1. Setiap permintaan suara dicoba ke Claude dulu (model cepat, default claude-haiku-5-5).
2. Kalau Claude gagal SEBELUM ada token keluar (saldo/kuota habis, key salah, rate limit,
   server sibuk, timeout) -> otomatis lanjut ke jalur Groq yang lama, tanpa error ke user.
3. Kalau errornya soal saldo/kuota/key, Claude "diistirahatkan" beberapa menit supaya
   permintaan berikutnya langsung ke Groq (tidak buang waktu menunggu Claude yang pasti gagal).
4. Kalau Claude gagal di TENGAH jawaban (token sudah keluar), error dilempar apa adanya
   (sama seperti perilaku provider lain: jawaban setengah jadi tidak dilanjut provider lain).
5. [BARU] DATA KLIEN DI JALUR CADANGAN. Groq/DeepSeek adalah pihak ketiga. Supaya data keuangan klien tidak
   ikut keluar saat Claude gagal, pilihannya diatur lewat VOICE_CADANGAN_DATA (lihat pilih_cadangan di bawah):
       tanpa  (default) cadangan menjawab TANPA alat data, TANPA daftar client, TANPA snapshot layar
       penuh  seperti dulu: alat data + daftar client + snapshot layar ikut ke Groq/DeepSeek
       mati   tanpa cadangan: Claude gagal -> Neo bilang tidak bisa menjawab (tidak ada data ke provider lain)
   Kalau Claude memang tidak dikonfigurasi (tanpa ANTHROPIC_API_KEY / VOICE_CLAUDE_AKTIF=0), Groq/DeepSeek adalah
   jalur UTAMA dan tetap berperilaku seperti dulu (alat data aktif).

Pengaturan lewat .env (semua opsional, kecuali ANTHROPIC_API_KEY):
    ANTHROPIC_API_KEY=sk-ant-...
    VOICE_CLAUDE_MODEL=claude-haiku-5-5   # model paling cepat; ganti ke claude-sonnet-5-5 kalau mau lebih pintar
    VOICE_CLAUDE_AKTIF=1                  # 0 = matikan jalur Claude (langsung Groq)
    VOICE_CLAUDE_TIMEOUT=30               # detik
    VOICE_CLAUDE_JEDA_KUOTA=600           # detik istirahat Claude setelah error saldo/kuota/key
    VOICE_CLAUDE_JEDA_SEMENTARA=60        # detik istirahat setelah rate limit/server sibuk/timeout
    VOICE_CADANGAN_DATA=tanpa             # [BARU] tanpa | penuh | mati  (data klien di jalur cadangan, lihat poin 5)
"""
import logging
import os
import time
from typing import Any, Callable, Dict, Generator, List, Optional

logger = logging.getLogger("voice_claude")

MODEL_SUARA = os.environ.get("VOICE_CLAUDE_MODEL", "claude-haiku-5-5").strip() or "claude-haiku-5-5"
TIMEOUT_DETIK = float(os.environ.get("VOICE_CLAUDE_TIMEOUT", "30") or 30)
JEDA_KUOTA_DETIK = int(os.environ.get("VOICE_CLAUDE_JEDA_KUOTA", "600") or 600)
JEDA_SEMENTARA_DETIK = int(os.environ.get("VOICE_CLAUDE_JEDA_SEMENTARA", "60") or 60)

_mati_sampai = 0.0  # epoch detik; selama belum lewat, jalur Claude dilewati
_klien_cache: Dict[str, Any] = {}


def dikonfigurasi() -> bool:
    """True kalau jalur Claude diaktifkan di .env (ada API key dan tidak dimatikan), walau sedang diistirahatkan."""
    if os.environ.get("VOICE_CLAUDE_AKTIF", "1").strip().lower() in ("0", "false", "off", "no"):
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def aktif() -> bool:
    """True kalau jalur Claude boleh dipakai sekarang."""
    return dikonfigurasi() and time.time() >= _mati_sampai


def _klien():
    import anthropic

    kunci = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if _klien_cache.get("kunci") != kunci:
        # max_retries=0: kegagalan langsung dioper ke Groq, bukan menunggu retry SDK
        _klien_cache["klien"] = anthropic.Anthropic(api_key=kunci, max_retries=0, timeout=TIMEOUT_DETIK)
        _klien_cache["kunci"] = kunci
    return _klien_cache["klien"]


def _jeda_untuk_error(e: Exception) -> int:
    """Berapa detik Claude diistirahatkan setelah error ini (0 = jangan diistirahatkan)."""
    import anthropic

    pesan = str(e).lower()
    status = getattr(e, "status_code", None)
    if (
        isinstance(e, (anthropic.AuthenticationError, anthropic.PermissionDeniedError))
        or status in (401, 402, 403)
        or "credit balance" in pesan
        or "billing" in pesan
        or "usage limit" in pesan
    ):
        return JEDA_KUOTA_DETIK
    if (
        isinstance(e, (anthropic.RateLimitError, anthropic.APIConnectionError))
        or status in (429, 500, 502, 503, 504, 529)
    ):
        return JEDA_SEMENTARA_DETIK
    return 0


def _susun_pesan(riwayat: Optional[List[Dict[str, str]]], pesan: str) -> List[Dict[str, Any]]:
    """Format Claude: peran harus selang-seling dan diawali 'user'."""
    hasil: List[Dict[str, Any]] = []
    for m in riwayat or []:
        role = m.get("role")
        isi = (m.get("content") or "").strip()
        if role not in ("user", "assistant") or not isi:
            continue
        if hasil and hasil[-1]["role"] == role:
            hasil[-1]["content"] += "\n" + isi
        else:
            hasil.append({"role": role, "content": isi})
    while hasil and hasil[0]["role"] != "user":
        hasil.pop(0)
    if hasil and hasil[-1]["role"] == "user":
        hasil[-1]["content"] += "\n" + pesan
    else:
        hasil.append({"role": "user", "content": pesan})
    return hasil


def _alat_untuk_claude(neo) -> List[Dict[str, Any]]:
    """Ubah daftar alat format OpenAI (neo.TOOLS) ke format Claude."""
    hasil = []
    for t in neo.TOOLS:
        f = t["function"]
        hasil.append({"name": f["name"], "description": f["description"], "input_schema": f["parameters"]})
    return hasil


def _stream_claude(
    neo, pesan: str, system_prompt: str, riwayat, user, client_id_aktif, max_tokens: int, pakai_alat: bool
) -> Generator[str, None, None]:
    klien = _klien()
    messages = _susun_pesan(riwayat, pesan)
    alat = _alat_untuk_claude(neo) if pakai_alat else None
    ctx = neo.Konteks(user, client_id_aktif) if pakai_alat else None
    maks_putaran = getattr(neo, "MAKS_PUTARAN_ALAT", 3) if pakai_alat else 0

    for putaran in range(maks_putaran + 1):
        kw: Dict[str, Any] = dict(
            model=MODEL_SUARA,
            max_tokens=max_tokens,
            temperature=0.4,
            system=system_prompt,
            messages=messages,
        )
        if alat and putaran < maks_putaran:
            kw["tools"] = alat
        with klien.messages.stream(**kw) as stream:
            for teks in stream.text_stream:
                if teks:
                    yield teks
            akhir = stream.get_final_message()
        if akhir.stop_reason != "tool_use":
            return
        # Claude minta data -> jalankan alat, kirim hasilnya, putar lagi
        messages.append({"role": "assistant", "content": akhir.content})
        hasil_alat = []
        for b in akhir.content:
            if getattr(b, "type", None) == "tool_use":
                args = b.input if isinstance(b.input, dict) else {}
                hasil_alat.append(
                    {"type": "tool_result", "tool_use_id": b.id, "content": neo.jalankan_alat(b.name, args, ctx)}
                )
        messages.append({"role": "user", "content": hasil_alat})


def jawab_dengan_cadangan(
    neo,
    pesan: str,
    system_prompt: str,
    riwayat,
    user,
    client_id_aktif: Optional[str],
    cadangan: Callable[[], Generator[str, None, None]],
    max_tokens: int = 700,
    pakai_alat: bool = False,
) -> Generator[str, None, None]:
    """Generator delta teks: Claude dulu; kalau gagal sebelum ada token -> `cadangan()` (Groq)."""
    global _mati_sampai
    if not aktif():
        yield from cadangan()
        return

    keluar = False
    try:
        for delta in _stream_claude(neo, pesan, system_prompt, riwayat, user, client_id_aktif, max_tokens, pakai_alat):
            keluar = True
            yield delta
        return
    except Exception as e:  # noqa: BLE001
        if keluar:
            raise Exception(f"Error Claude: {e}")
        jeda = _jeda_untuk_error(e)
        if jeda:
            _mati_sampai = time.time() + jeda
        logger.warning("Claude gagal (%s), pakai Groq%s", e, f"; Claude diistirahatkan {jeda} dtk" if jeda else "")
    yield from cadangan()


# ============================================================
# [BARU] Jalur cadangan yang sadar data klien
# ============================================================
CATATAN_MODE_CADANGAN = (
    "\n\n[MODE CADANGAN] Jalur AI utama sedang tidak tersedia, jadi kamu TIDAK punya akses ke data keuangan "
    "client maupun isi layar pengguna. Jangan menyebut atau mengarang angka, saldo, atau nama transaksi. "
    "Kalau pertanyaan butuh data client atau isi layar, katakan singkat bahwa datanya belum bisa dibuka "
    "sekarang dan minta pengguna mencoba lagi sebentar lagi. Pertanyaan umum akuntansi/pajak tetap boleh dijawab."
)

MODE_CADANGAN_VALID = ("tanpa", "penuh", "mati")


def mode_cadangan() -> str:
    """Nilai VOICE_CADANGAN_DATA. Salah ketik / kosong -> 'tanpa' (pilihan yang paling aman)."""
    m = (os.environ.get("VOICE_CADANGAN_DATA", "tanpa") or "tanpa").strip().lower()
    return m if m in MODE_CADANGAN_VALID else "tanpa"


def prompt_cadangan(sistem_dasar_tanpa_data: str) -> str:
    """System prompt untuk cadangan mode 'tanpa': prompt tanpa petunjuk alat data + catatan mode cadangan."""
    return (sistem_dasar_tanpa_data or "") + CATATAN_MODE_CADANGAN


def pilih_cadangan(
    *,
    ak,
    neo,
    pesan: str,
    kwargs: Dict[str, Any],
    user,
    client_id: Optional[str],
    system_cadangan: str,
) -> Generator[str, None, None]:
    """Generator cadangan untuk mode suara, dipanggil saat Claude gagal sebelum ada token (atau Claude tidak aktif).

    kwargs         : argumen asli untuk ak.tanya_ai_stream (system_prompt LENGKAP: ada snapshot layar, dst).
    system_cadangan: system prompt BERSIH (tanpa snapshot layar, tanpa petunjuk alat) + ingatan AI; hanya dipakai
                     di mode 'tanpa'.
    """
    # Claude memang tidak dipakai di instalasi ini -> Groq/DeepSeek adalah jalur utama: perilaku lama dipertahankan.
    mode = mode_cadangan() if dikonfigurasi() else "penuh"

    if mode == "mati":
        logger.warning("Claude tidak tersedia dan VOICE_CADANGAN_DATA=mati: tidak ada jawaban cadangan")

        def _tolak() -> Generator[str, None, None]:
            raise Exception("Jalur AI utama sedang tidak tersedia dan jalur cadangan dimatikan (VOICE_CADANGAN_DATA=mati).")
            yield ""  # membuat fungsi ini generator

        return _tolak()

    if mode == "penuh":
        if neo.aktif():
            return neo.jawab_dengan_alat(
                ak, pesan, kwargs["system_prompt"] + neo.blok_daftar_klien(user, client_id),
                kwargs["riwayat"], user,
                client_id_aktif=client_id, provider_utama=kwargs.get("provider_utama"),
                max_tokens=kwargs.get("max_tokens", 700),
            )
        return ak.tanya_ai_stream(pesan, **kwargs)

    # mode 'tanpa': tidak ada alat data, tidak ada daftar client, tidak ada snapshot layar
    logger.info("Jalur cadangan tanpa data klien (VOICE_CADANGAN_DATA=tanpa)")
    k = dict(kwargs)
    k["system_prompt"] = system_cadangan
    return ak.tanya_ai_stream(pesan, **k)