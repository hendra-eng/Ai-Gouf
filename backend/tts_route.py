"""
tts_route.py
============
Endpoint POST /api/tts -> audio MP3 suara neural Indonesia untuk VoiceAssistant (Neo).

[DIUBAH] Azure tidak lagi jadi default. Urutan sekarang (TTS_PROVIDER=auto, default):
  1) GEMINI TTS (gratis dari Google AI Studio, paling mirip manusia) -- hanya kalau GEMINI_API_KEY / GEMINI_API_KEYS diisi.
     Limit gratisnya kecil: kena 429 -> kunci itu diistirahatkan, giliran pindah ke kunci berikutnya (berputar, setelah kunci terakhir kembali ke kunci 1); semua kunci istirahat -> Edge.
  2) EDGE TTS (gratis, TANPA API key) lewat library `edge-tts` (id-ID-GadisNeural / ArdiNeural).
  3) Gagal semua -> frontend memakai suara browser.
Azure tetap bisa dipakai kalau suatu saat mau: TTS_PROVIDER=azure. Hanya Edge: TTS_PROVIDER=edge.

Pasang:
1) pip install edge-tts   (sudah ada di requirements.txt; kalau error di kemudian hari: pip install -U edge-tts)
2) Di backend/.env (SEMUA opsional):
       TTS_PROVIDER=auto                # auto (default: Gemini lalu Edge) | gemini (strict: hanya Gemini, kunci diputar 1->2->...->terakhir->1) | edge | azure
       GEMINI_API_KEY=...               # kunci gratis dari https://aistudio.google.com/apikey
       GEMINI_API_KEYS=kunci1,kunci2    # [BARU] banyak kunci; kunci 1 dipakai sampai limit, lalu kunci 2, dst, setelah kunci terakhir kembali ke kunci 1
       GEMINI_TTS_VOICE=Sulafat            # perempuan: Kore, Zephyr, Leda, Aoede | laki-laki: Puck, Charon, Orus, Fenrir
       GEMINI_TTS_GAYA=Ucapkan dengan santai, hangat, dan natural seperti ngobrol dengan teman
       GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview   # model preview; kalau 404 otomatis coba gemini-2.5-flash-preview-tts
       GEMINI_TTS_SUHU=0.3              # 0-2; makin kecil suara makin konsisten (makin besar makin ekspresif)
       GEMINI_TTS_JEDA=300              # detik istirahat Gemini setelah limit/kuota habis
       GEMINI_TTS_STREAM=1              # [BARU] 1 = audio Gemini streaming lewat /api/tts/stream (0 = matikan)
       GEMINI_TTS_STREAM_MODEL=gemini-3.8-flash-lite-tts   # [BARU] model streaming (3.1-preview belum terdokumentasi mendukung streaming)
       GEMINI_TTS_BATAS=6               # [BARU] batas TOTAL detik untuk satu kalimat di Gemini (semua kunci + model + retry); lewat -> Edge
       GEMINI_TTS_JEDA_LAMBAT=60        # [BARU] detik Gemini dilewati setelah kena batas waktu, supaya kalimat berikutnya langsung ke Edge
       TTS_EDGE_TIMEOUT=8               # [BARU] batas detik untuk Edge TTS
       TTS_VOICE=id-ID-GadisNeural      # perempuan; atau id-ID-ArdiNeural (laki-laki)
       TTS_RATE=+5%                     # kecepatan: -10% lebih pelan ... +15% lebih cepat
       TTS_PITCH=+0Hz                   # nada: mis. +2Hz / -2Hz
3) Restart backend.

Catatan: edge-tts adalah library tidak resmi (memakai layanan baca-suara Edge). Gratis & tanpa batas kuota resmi,
tapi tanpa SLA. Kalau gagal, VoiceAssistant otomatis memakai suara browser untuk kalimat itu.
"""
import asyncio
import base64
import io
import json
import logging
import os
import re
import time
import wave
from xml.sax.saxutils import escape

import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("tts")
# [DIUBAH] Batas SATU permintaan /api/tts. Teks yang lebih panjang TIDAK lagi dipotong diam-diam: ditolak dengan 413.
# Frontend (VoiceAssistant.tsx) memecah jawaban panjang per kalimat/klausa (<= 300 karakter) sebelum meminta suara,
# jadi 413 hampir tidak pernah terjadi; kalau terjadi, frontend membacakan seluruh teksnya dengan suara browser.
MAKS_KARAKTER = 700
# [DIUBAH] Batas waktu dipangkas supaya total (Gemini + Edge) < 15 dtk, batas tunggu di frontend (VoiceAssistant.tsx).
TIMEOUT_EDGE_DETIK = float(os.environ.get("TTS_EDGE_TIMEOUT", "8") or 8)


class TtsRequest(BaseModel):
    teks: str
    bahasa: str = "id"  # [BARU] "id" (default) atau "en": VoiceAssistant mengikuti bahasa yang kamu pakai


def _suara(bahasa: str = "id") -> str:
    if bahasa == "en":  # [BARU] suara bahasa Inggris (ubah lewat TTS_VOICE_EN, mis. en-US-GuyNeural)
        return (os.environ.get("TTS_VOICE_EN") or "en-US-AriaNeural").strip()
    return (os.environ.get("TTS_VOICE") or os.environ.get("AZURE_TTS_VOICE") or "id-ID-GadisNeural").strip()


def _laju() -> str:
    return (os.environ.get("TTS_RATE") or os.environ.get("AZURE_TTS_RATE") or "+0%").strip()


async def _sintesis_edge(teks: str, bahasa: str = "id") -> bytes:
    try:
        import edge_tts
    except ImportError:
        # 503 -> frontend memakai suara browser; pasang dulu: pip install edge-tts
        raise HTTPException(status_code=503, detail="Library edge-tts belum terpasang (pip install edge-tts).")

    async def _kumpulkan() -> bytes:
        komunikasi = edge_tts.Communicate(
            teks, _suara(bahasa), rate=_laju(), pitch=(os.environ.get("TTS_PITCH") or "+0Hz").strip()
        )
        potongan = []
        async for chunk in komunikasi.stream():
            if chunk.get("type") == "audio":
                potongan.append(chunk["data"])
        return b"".join(potongan)

    try:
        audio = await asyncio.wait_for(_kumpulkan(), timeout=TIMEOUT_EDGE_DETIK)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=502, detail="Edge TTS terlalu lama menjawab.")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Edge TTS gagal: {e}")
    if not audio:
        raise HTTPException(status_code=502, detail="Edge TTS tidak menghasilkan audio.")
    return audio


def _sintesis_azure(teks: str, bahasa: str = "id") -> bytes:
    kunci = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    region = os.environ.get("AZURE_SPEECH_REGION", "").strip()
    if not kunci or not region:
        raise HTTPException(status_code=503, detail="Azure TTS belum dikonfigurasi (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION).")
    suara = _suara(bahasa)
    laju = _laju()

    ssml = (
        f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{'en-US' if bahasa == 'en' else 'id-ID'}'>"
        f"<voice name='{escape(suara)}'><prosody rate='{escape(laju)}'>{escape(teks)}</prosody></voice>"
        "</speak>"
    )
    try:
        r = requests.post(
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": kunci,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
                "User-Agent": "gouf-dashboard-tts",
            },
            data=ssml.encode("utf-8"),
            timeout=20,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Gagal menghubungi Azure TTS: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Azure TTS menolak ({r.status_code}): {r.text[:200]}")
    return r.content


_kunci_mati_sampai: dict = {}  # kunci -> epoch detik; kena limit (429): dilewati selama masih ada kunci lain yang segar
_kunci_ditolak_sampai: dict = {}  # [BARU] kunci -> epoch detik; ditolak (401/403) = kunci salah, TIDAK ikut diputar ulang


def _gemini_strict() -> bool:
    """[BARU] TTS_PROVIDER=gemini -> hanya Gemini: tidak pernah pindah ke Edge. Semua kunci kena limit -> putar lagi dari kunci 1."""
    return os.environ.get("TTS_PROVIDER", "auto").strip().lower() == "gemini"


def _semua_kunci_gemini() -> list:
    """Semua kunci Gemini sesuai urutan: GEMINI_API_KEYS (pisah koma/spasi/baris baru),
    lalu GEMINI_API_KEY, lalu GOOGLE_API_KEY. Tanpa duplikat."""
    mentah = " ".join(filter(None, [os.environ.get("GEMINI_API_KEYS"), os.environ.get("GEMINI_API_KEY"), os.environ.get("GOOGLE_API_KEY")]))
    hasil: list = []
    for k in re.split(r"[,\s;]+", mentah):
        k = k.strip().strip("\"'")
        if k and k not in hasil:
            hasil.append(k)
    return hasil


# Giliran berputar: tetap memakai kunci yang sedang aktif sampai kena limit, lalu pindah ke kunci berikutnya;
# setelah kunci terakhir kembali ke kunci 1, dst. Kunci yang sedang istirahat dilewati.
_giliran = {"i": 0}


def _kunci_tersedia(paksa: bool = False) -> list:
    """Kunci yang boleh dicoba sekarang, diurutkan mulai dari kunci yang sedang aktif lalu berputar.
    paksa=True [BARU]: abaikan istirahat limit, jadi setelah kunci terakhir kembali lagi ke kunci 1 (kunci yang ditolak tetap dilewati)."""
    semua = _semua_kunci_gemini()
    if not semua:
        return []
    sekarang = time.time()
    mulai = _giliran["i"] % len(semua)
    urut = semua[mulai:] + semua[:mulai]
    urut = [k for k in urut if sekarang >= _kunci_ditolak_sampai.get(k, 0.0)]
    if paksa:
        return urut
    return [k for k in urut if sekarang >= _kunci_mati_sampai.get(k, 0.0)]


# [BARU] Gemini lambat/macet (kena batas waktu) -> dilewati sementara; tanpa ini tiap kalimat jawaban menunggu sampai batas habis.
_gemini_lambat = {"sampai": 0.0}


def _gemini_siap() -> bool:
    if _gemini_strict():  # [BARU] strict: selama ada kunci yang valid, Gemini selalu dicoba (tidak ada Edge sebagai tempat lari)
        return bool(_kunci_tersedia(paksa=True))
    return time.time() >= _gemini_lambat["sampai"] and bool(_kunci_tersedia())


def _pcm_ke_wav(pcm: bytes, laju: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(laju)
        w.writeframes(pcm)
    return buf.getvalue()


def _sintesis_gemini_inti(teks: str, batas: float, paksa: bool = False) -> bytes:
    """Gemini TTS (Google AI Studio). Mengembalikan WAV. Raise HTTPException kalau gagal.
    Banyak kunci: kena limit (429) / ditolak (401, 403) -> kunci itu diistirahatkan dan langsung dicoba kunci berikutnya."""
    # [BARU] semua kunci sedang istirahat -> tetap dicoba berurutan dari giliran sekarang (setelah kunci terakhir -> kunci 1)
    kunci_list = _kunci_tersedia(paksa=paksa) or _kunci_tersedia(paksa=True)
    if not kunci_list:
        raise HTTPException(status_code=503, detail="Tidak ada kunci Gemini yang tersedia (belum diisi / semua sedang diistirahatkan).")
    semua = _semua_kunci_gemini()
    jeda = int(os.environ.get("GEMINI_TTS_JEDA", "300") or 300)
    suhu = float(os.environ.get("GEMINI_TTS_SUHU", "0.3") or 0.3)
    gaya = (os.environ.get("GEMINI_TTS_GAYA") or "Ucapkan dengan santai, hangat, dan natural seperti ngobrol dengan teman").strip()
    suara = (os.environ.get("GEMINI_TTS_VOICE") or "Sulafat").strip()
    model_utama = (os.environ.get("GEMINI_TTS_MODEL") or "gemini-3.1-flash-tts-preview").strip()
    daftar_model = [model_utama] + [m for m in ("gemini-2.5-flash-preview-tts",) if m != model_utama]
    body = {
        "contents": [{"parts": [{"text": f"{gaya}: {teks}"}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": suara}}},
            "temperature": suhu,  # rendah = suara lebih konsisten antar kalimat/sesi
        },
    }
    terakhir = "tidak ada jawaban"
    for kunci in kunci_list:
        nomor = semua.index(kunci) + 1  # hanya nomor urut yang dicatat di log, JANGAN pernah mencatat isi kunci
        kunci_habis = False
        # [KONSISTEN] Model hanya berganti kalau modelnya TIDAK ADA (404). Error sesaat (5xx, 400, tanpa audio)
        # dicoba ulang SEKALI di model yang sama -- supaya suara tidak berganti-ganti antar model.
        for model in daftar_model:
            pindah_model = False
            for _percobaan in range(2):
                sisa = batas - time.monotonic()  # [BARU] sisa waktu TOTAL; habis -> berhenti, jangan lanjut ke kunci/model lain
                if sisa < 1.0:
                    raise HTTPException(status_code=504, detail="Gemini TTS melewati batas waktu.")
                try:
                    r = requests.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                        headers={"x-goog-api-key": kunci, "Content-Type": "application/json"},
                        json=body,
                        timeout=(3.05, sisa),
                    )
                except requests.RequestException as e:
                    terakhir = f"koneksi gagal: {e}"
                    continue
                if r.status_code == 429:  # limit kunci ini habis -> istirahatkan, lanjut kunci berikutnya
                    _kunci_mati_sampai[kunci] = time.time() + jeda
                    _giliran["i"] = nomor % len(semua)  # giliran pindah ke kunci berikutnya (setelah terakhir -> kunci 1)
                    logger.warning("Gemini TTS: kunci #%d kena limit, pindah ke kunci berikutnya (jika ada)", nomor)
                    terakhir = "limit Gemini TTS habis"
                    kunci_habis = True
                    break
                if r.status_code in (401, 403):  # key salah / tidak punya akses -> jangan dicoba terus
                    _kunci_ditolak_sampai[kunci] = time.time() + 3600
                    _giliran["i"] = nomor % len(semua)
                    logger.warning("Gemini TTS: kunci #%d ditolak (%d), pindah ke kunci berikutnya (jika ada)", nomor, r.status_code)
                    terakhir = "kunci Gemini ditolak"
                    kunci_habis = True
                    break
                if r.status_code == 404:  # nama model tidak ada -> coba model berikutnya
                    terakhir = f"{model}: tidak ditemukan"
                    pindah_model = True
                    break
                if r.status_code != 200:
                    terakhir = f"{model}: HTTP {r.status_code} {r.text[:120]}"
                    continue
                try:
                    inline = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
                    pcm = base64.b64decode(inline["data"])
                    cocok = re.search(r"rate=(\d+)", inline.get("mimeType", "") or "")
                    laju = int(cocok.group(1)) if cocok else 24000
                except Exception:  # noqa: BLE001 (mis. model membalas teks, bukan audio)
                    terakhir = f"{model}: respons tanpa audio"
                    continue
                if not pcm:
                    terakhir = f"{model}: audio kosong"
                    continue
                _giliran["i"] = nomor - 1  # tetap di kunci ini sampai kena limit
                return _pcm_ke_wav(pcm, laju)
            if kunci_habis or not pindah_model:
                break
        if not kunci_habis:
            break  # gagal karena sebab lain (bukan limit/kunci): kunci lain tidak akan menolong
    raise HTTPException(status_code=502, detail=f"Gemini TTS gagal: {terakhir}")


def _sintesis_gemini(teks: str) -> bytes:
    """Gemini TTS dengan batas waktu TOTAL (GEMINI_TTS_BATAS, default 6 dtk) untuk satu kalimat.
    Dulu: tiap request 20 dtk x 2 percobaan x tiap model x tiap kunci -> bisa puluhan detik sebelum jatuh ke Edge.
    Kena batas -> Gemini dilewati GEMINI_TTS_JEDA_LAMBAT detik (kalimat berikutnya langsung ke Edge)."""
    total = float(os.environ.get("GEMINI_TTS_BATAS", "6") or 6)
    batas = time.monotonic() + max(2.0, total)
    try:
        try:
            return _sintesis_gemini_inti(teks, batas)
        except HTTPException as e:
            # [BARU] semua kunci kena limit di putaran pertama -> putaran kedua mulai lagi dari kunci 1 (hanya mode strict)
            if _gemini_strict() and e.status_code == 502 and "limit" in str(e.detail) and time.monotonic() + 1.5 < batas:
                time.sleep(0.8)
                return _sintesis_gemini_inti(teks, batas, paksa=True)
            raise
    except HTTPException as e:
        if e.status_code == 504 and not _gemini_strict():
            jeda = int(os.environ.get("GEMINI_TTS_JEDA_LAMBAT", "60") or 60)
            _gemini_lambat["sampai"] = time.time() + jeda
            logger.warning("Gemini TTS melewati batas waktu, dilewati %d dtk (langsung Edge)", jeda)
        raise


# ====================== [BARU] GEMINI TTS STREAMING ======================
# Gemini 3.8 TTS mendukung streaming lewat Interactions API (POST /v1beta/interactions, "stream": true).
# Audio datang sebagai potongan PCM mentah 16-bit, 24 kHz, mono, jadi frontend bisa mulai memutar sebelum kalimat selesai dibuat.
# Model streaming dipisah dari GEMINI_TTS_MODEL: GEMINI_TTS_STREAM_MODEL (default gemini-3.8-flash-lite-tts).
# Suara tetap GEMINI_TTS_VOICE (Sulafat). GEMINI_TTS_GAYA dikirim sebagai `style` (bukan digabung ke teks, supaya tidak ikut terbaca).
# Gagal sebelum ada audio (model/format tidak didukung) -> jatuh ke Gemini non-streaming (generateContent), TETAP Gemini, bukan Edge.


def _stream_aktif() -> bool:
    return os.environ.get("GEMINI_TTS_STREAM", "1").strip().lower() not in ("0", "false", "off", "tidak")


def _ekstrak_audio_sse(baris: bytes):
    """Satu baris SSE -> bytes PCM (atau None). Format: data: {"event_type":"step.delta","delta":{"type":"audio","data":"<base64>"}}"""
    if not baris or not baris.startswith(b"data:"):
        return None
    mentah = baris[5:].strip()
    if not mentah or mentah == b"[DONE]":
        return None
    try:
        evt = json.loads(mentah)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(evt, dict) or evt.get("event_type") not in (None, "step.delta"):
        return None
    delta = evt.get("delta")
    if not isinstance(delta, dict) or delta.get("type") != "audio":
        return None
    data = delta.get("data")
    if not data:
        return None
    try:
        return base64.b64decode(data)
    except Exception:  # noqa: BLE001
        return None


def _badan_stream(teks: str) -> dict:
    gaya = (os.environ.get("GEMINI_TTS_GAYA") or "Ucapkan dengan santai, hangat, dan natural seperti ngobrol dengan teman").strip()
    suara = (os.environ.get("GEMINI_TTS_VOICE") or "Sulafat").strip()
    anotasi = [{"type": "speech_metadata", "style": gaya}] if gaya else []
    teks_item = {"type": "text", "text": teks}
    if anotasi:
        teks_item["annotations"] = anotasi
    return {
        "model": (os.environ.get("GEMINI_TTS_STREAM_MODEL") or "gemini-3.8-flash-lite-tts").strip(),
        "input": [{"type": "user_input", "content": [teks_item]}],
        "response_format": {"type": "audio", "mime_type": "audio/l16", "sample_rate": 24000},
        "generation_config": {"speech_config": [{"voice": suara}]},
        "stream": True,
    }


def _potongan_pcm_genap():
    """Pembungkus status: potongan PCM harus kelipatan 2 byte (16-bit). Sisa 1 byte dibawa ke potongan berikutnya."""
    sisa = {"b": b""}

    def proses(potongan: bytes) -> bytes:
        gabung = sisa["b"] + potongan
        n = len(gabung) - (len(gabung) % 2)
        sisa["b"] = gabung[n:]
        return gabung[:n]

    return proses


def _buka_stream_gemini(teks: str, batas: float):
    """Buka stream Gemini dan tunggu potongan audio PERTAMA. Kunci kena limit (429) -> pindah ke kunci berikutnya
    (berputar sampai kunci 1 lagi). Mengembalikan (potongan_pertama, iterator_sisa, tutup).
    Raise HTTPException 502 kalau model/format streaming tidak didukung (pemanggil boleh jatuh ke non-streaming)."""
    badan = _badan_stream(teks)
    semua = _semua_kunci_gemini()
    jeda = int(os.environ.get("GEMINI_TTS_JEDA", "300") or 300)
    terakhir = "tidak ada jawaban"
    for putaran in range(2):  # putaran ke-2: ulang dari kunci 1 setelah kunci terakhir kena limit
        kunci_list = _kunci_tersedia(paksa=(putaran == 1)) or _kunci_tersedia(paksa=True)
        if not kunci_list:
            raise HTTPException(status_code=503, detail="Tidak ada kunci Gemini yang tersedia.")
        ada_limit = False
        for kunci in kunci_list:
            nomor = semua.index(kunci) + 1
            sisa_waktu = batas - time.monotonic()
            if sisa_waktu < 1.0:
                raise HTTPException(status_code=504, detail="Gemini TTS (stream) melewati batas waktu.")
            try:
                r = requests.post(
                    "https://generativelanguage.googleapis.com/v1beta/interactions",
                    headers={"x-goog-api-key": kunci, "Content-Type": "application/json"},
                    json=badan,
                    stream=True,
                    timeout=(3.05, min(20.0, max(2.0, sisa_waktu))),
                )
            except requests.RequestException as e:
                terakhir = f"koneksi gagal: {e}"
                continue
            if r.status_code == 429:
                _kunci_mati_sampai[kunci] = time.time() + jeda
                _giliran["i"] = nomor % len(semua)
                logger.warning("Gemini TTS stream: kunci #%d kena limit, pindah ke kunci berikutnya", nomor)
                r.close()
                terakhir = "limit Gemini TTS habis"
                ada_limit = True
                continue
            if r.status_code in (401, 403):
                _kunci_ditolak_sampai[kunci] = time.time() + 3600
                _giliran["i"] = nomor % len(semua)
                logger.warning("Gemini TTS stream: kunci #%d ditolak (%d)", nomor, r.status_code)
                r.close()
                terakhir = "kunci Gemini ditolak"
                continue
            if r.status_code != 200:
                terakhir = f"HTTP {r.status_code} {r.text[:160]}"
                logger.warning("Gemini TTS stream tidak bisa dipakai: %s", terakhir)
                r.close()
                # 400/404 = model atau format streaming tidak dikenali: kunci lain tidak akan menolong
                raise HTTPException(status_code=502, detail=f"Gemini TTS stream gagal: {terakhir}")
            genap = _potongan_pcm_genap()
            baris_iter = r.iter_lines(chunk_size=1024)

            def tutup(resp=r):
                try:
                    resp.close()
                except Exception:  # noqa: BLE001
                    pass

            def aliran(it=baris_iter, genap=genap):
                for baris in it:
                    pcm = _ekstrak_audio_sse(baris)
                    if pcm:
                        out = genap(pcm)
                        if out:
                            yield out

            gen = aliran()
            try:
                pertama = next(gen)
            except StopIteration:
                tutup()
                terakhir = "stream selesai tanpa audio"
                continue
            except Exception as e:  # noqa: BLE001
                tutup()
                terakhir = f"stream putus sebelum audio: {e}"
                continue
            _giliran["i"] = nomor - 1  # tetap di kunci ini sampai kena limit
            return pertama, gen, tutup
        if not ada_limit:
            break
        time.sleep(0.5)
    raise HTTPException(status_code=502, detail=f"Gemini TTS stream gagal: {terakhir}")


def buat_router_tts(auth) -> APIRouter:
    router = APIRouter(tags=["tts"])

    @router.post("/api/tts")
    async def tts(body: TtsRequest, user: dict = Depends(auth.get_current_user)):
        teks = (body.teks or "").strip()
        bahasa = "en" if (body.bahasa or "").strip().lower().startswith("en") else "id"
        if not teks:
            raise HTTPException(status_code=400, detail="Teks kosong.")
        if len(teks) > MAKS_KARAKTER:
            raise HTTPException(
                status_code=413,
                detail=f"Teks terlalu panjang untuk satu permintaan suara ({len(teks)} > {MAKS_KARAKTER} karakter). Pecah per kalimat.",
            )
        provider = os.environ.get("TTS_PROVIDER", "auto").strip().lower()
        if provider == "azure":
            audio = await run_in_threadpool(_sintesis_azure, teks, bahasa)
            return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
        if provider in ("auto", "gemini") and _gemini_siap():
            try:
                audio = await run_in_threadpool(_sintesis_gemini, teks)
                return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
            except Exception as e:  # noqa: BLE001 -> jatuh ke Edge
                logger.warning("Gemini TTS gagal, pakai Edge: %s", getattr(e, "detail", e))
                if provider == "gemini":  # [BARU] strict: jangan pindah suara
                    raise HTTPException(status_code=502, detail="Gemini TTS gagal di semua kunci (mode strict, tanpa Edge).")
        if provider == "gemini":
            raise HTTPException(status_code=502, detail="Gemini TTS tidak tersedia (kunci kosong/ditolak). Mode strict, tanpa Edge.")
        audio = await _sintesis_edge(teks, bahasa)
        return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    @router.post("/api/tts/stream")
    async def tts_stream(body: TtsRequest, user: dict = Depends(auth.get_current_user)):
        """[BARU] Audio Gemini streaming: PCM mentah 16-bit, 24 kHz, mono (audio/l16). Header baru dikirim setelah audio pertama
        siap, jadi status non-200 berarti belum ada audio sama sekali (frontend boleh mencoba ulang)."""
        teks = (body.teks or "").strip()
        if not teks:
            raise HTTPException(status_code=400, detail="Teks kosong.")
        if len(teks) > MAKS_KARAKTER:
            raise HTTPException(status_code=413, detail=f"Teks terlalu panjang ({len(teks)} > {MAKS_KARAKTER} karakter). Pecah per kalimat.")
        if not _gemini_siap():
            raise HTTPException(status_code=502, detail="Gemini TTS tidak tersedia (kunci kosong/ditolak).")
        total = float(os.environ.get("GEMINI_TTS_BATAS", "6") or 6)
        batas = time.monotonic() + max(2.0, total)

        def siapkan():
            """Coba streaming; kalau model/format streaming tidak didukung -> Gemini non-streaming (tetap suara Gemini)."""
            if _stream_aktif():
                try:
                    return _buka_stream_gemini(teks, batas)
                except HTTPException as e:
                    if e.status_code == 504:
                        raise
                    logger.warning("Gemini TTS stream gagal (%s), coba Gemini non-streaming", getattr(e, "detail", e))
            wav = _sintesis_gemini(teks)  # WAV: 44 byte header + PCM 16-bit 24 kHz mono
            pcm = wav[44:] if wav[:4] == b"RIFF" else wav
            return pcm, iter(()), (lambda: None)

        pertama, sisa, tutup = await run_in_threadpool(siapkan)

        def isi():
            try:
                yield pertama
                for potongan in sisa:
                    yield potongan
            except Exception as e:  # noqa: BLE001 putus di tengah: kirim yang sudah ada saja
                logger.warning("Gemini TTS stream putus di tengah: %s", e)
            finally:
                tutup()

        return StreamingResponse(
            isi(),
            media_type="audio/l16;rate=24000",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    return router