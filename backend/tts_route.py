"""
tts_route.py
============
Suara Neo untuk VoiceAssistant.

[DIUBAH] Gemini sekarang SEMUANYA STREAMING lewat POST /api/tts/stream. Jalur Gemini non-streaming (generateContent) DIHAPUS.
POST /api/tts tinggal untuk Edge TTS (gratis, TANPA API key) atau Azure: cadangan terakhir kalau Gemini habis.

ALUR POST /api/tts/stream (per kalimat, TTS_PROVIDER=auto):
  Model 1 (urutan GEMINI_TTS_STREAM_MODELS): kunci #1 -> #2 -> ... -> terakhir
        - kunci yang sedang istirahat (limit) DILEWATI tanpa dicoba
        - ada kunci yang bisa -> suara Gemini mulai terdengar
        - SEMUA kunci kena limit / istirahat -> pindah ke Model 2 (kunci #1 lagi dari awal)
  Model 2: sama seperti Model 1
  Model N: sama
  Semua model habis -> 503 -> frontend minta POST /api/tts -> Edge TTS
  Begitu ada kunci/model yang pulih (limit per menit lewat / reset harian), kalimat berikutnya otomatis kembali ke Model 1.
  Model yang ditolak server (400/404 = nama model salah / tidak mendukung streaming) dilewati GEMINI_TTS_MODEL_MATI detik.
  Kuota Gemini dihitung PER MODEL (dan per project Google), jadi pindah model = dapat jatah baru.

Pasang di backend/.env (SEMUA opsional):
       TTS_PROVIDER=auto                # auto (default: Gemini lalu Edge) | gemini (strict: hanya Gemini, tidak pernah Edge) | edge | azure
       GEMINI_API_KEYS=kunci1,kunci2    # banyak kunci (pisah koma/spasi/baris baru); atau GEMINI_API_KEY / GOOGLE_API_KEY
       GEMINI_TTS_STREAM=1              # 1 = Gemini aktif (streaming); 0 = matikan Gemini sepenuhnya (langsung Edge)
       GEMINI_TTS_STREAM_MODELS=gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts   # URUTAN model: yang pertama dipakai dulu
       GEMINI_TTS_STREAM_MODEL=         # (lama) kalau GEMINI_TTS_STREAM_MODELS kosong: model ini jadi model 1, lalu gemini-3.8-flash-tts
       GEMINI_TTS_MODEL_MATI=600        # detik sebuah model dilewati setelah server menolaknya (400/404)
       GEMINI_TTS_VOICE=Sulafat         # perempuan: Kore, Zephyr, Leda, Aoede | laki-laki: Puck, Charon, Orus, Fenrir
       GEMINI_TTS_GAYA=Ucapkan dengan santai, hangat, dan natural seperti ngobrol dengan teman   # dikirim sebagai `style`, bukan digabung ke teks
       GEMINI_TTS_JEDA=300              # detik istirahat kunci setelah limit PER MENIT (limit harian: istirahat sampai reset 00:05 waktu Pasifik)
       GEMINI_TTS_BATAS=6               # batas TOTAL detik untuk satu kalimat di Gemini (semua kunci + semua model); lewat -> Edge
       GEMINI_TTS_JEDA_LAMBAT=60        # detik Gemini dilewati setelah kena batas waktu, supaya kalimat berikutnya langsung ke Edge
       GEMINI_TTS_CEK_PARALEL=0         # saat banyak kunci habis: cek kunci segar SEKALIGUS. 0 = semua (default), 1 = matikan, N = N kunci
       GEMINI_TTS_PARALEL_PICU=2        # cek paralel baru jalan setelah sekian kunci BERTURUT-TURUT kena limit di satu model
       GEMINI_TTS_PAKSA_HARIAN=0        # (hanya mode strict) 1 = kunci yang kuota hariannya habis ikut dipaksa jalan
       GEMINI_TTS_PAKSA_MAKS=2          # (hanya mode strict) maks kunci yang DIPAKSA jalan per model saat semua kunci istirahat
       GEMINI_TTS_STATUS_FILE=          # opsional: lokasi file status istirahat kunci (default backend/.gemini_tts_status.json)
       TTS_EDGE_TIMEOUT=8               # batas detik untuk Edge TTS
       TTS_VOICE=id-ID-GadisNeural      # Edge: perempuan; atau id-ID-ArdiNeural (laki-laki)
       TTS_RATE=+5%                     # Edge: kecepatan -10% ... +15%
       TTS_PITCH=+0Hz                   # Edge: nada, mis. +2Hz / -2Hz
Restart backend setelah mengubah .env.

Catatan: edge-tts adalah library tidak resmi (memakai layanan baca-suara Edge). Gratis & tanpa batas kuota resmi,
tapi tanpa SLA. Kalau gagal, VoiceAssistant mencoba ulang / melewati kalimat itu.
GEMINI_TTS_MODEL, GEMINI_TTS_MODEL_CADANGAN_LIMIT dan GEMINI_TTS_SUHU TIDAK dipakai lagi (khusus jalur non-streaming yang sudah dihapus).
"""
import asyncio
import base64
import json
import logging
import os
import hashlib
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor
from concurrent.futures import wait as _tunggu_futures
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("tts")

# [BARU] Koneksi ke Google DIPAKAI ULANG (keep-alive). Dulu tiap percobaan kunci membuka koneksi + handshake TLS baru
# (paling terasa dari Bali: jarak ke server Google jauh). Dengan Session, percobaan kunci berikutnya hanya 1x bolak-balik.
_sesi = requests.Session()
_sesi.mount("https://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=40, max_retries=0))


def _hangatkan_koneksi() -> None:
    """[BARU] Buka koneksi ke Google saat aplikasi start, supaya suara PERTAMA tidak menanggung handshake. Gagal = abaikan."""
    try:
        _sesi.head("https://generativelanguage.googleapis.com/", timeout=5)
    except Exception:  # noqa: BLE001
        pass


threading.Thread(target=_hangatkan_koneksi, daemon=True).start()
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
_giliran: dict = {}  # [DIUBAH] model -> indeks kunci yang sedang aktif (tiap model punya giliran sendiri)


_kunci_harian_habis_sampai: dict = {}  # [BARU] (model|kunci) -> epoch detik; kuota HARIAN habis (reset tengah malam waktu Pasifik)
_gagal_beruntun: dict = {}  # [BARU] (model|kunci) -> berapa kali 429 berturut-turut (makin sering gagal, istirahat makin lama)
_kunci_lock = threading.RLock()  # [BARU] request berjalan di threadpool: status kunci dijaga supaya tidak balapan
# [BARU] Status istirahat disimpan ke file supaya TIDAK hilang saat aplikasi di-restart (isinya hanya sidik jari kunci, bukan kunci asli)
_FILE_STATUS = Path(os.environ.get("GEMINI_TTS_STATUS_FILE") or (Path(__file__).resolve().parent / ".gemini_tts_status.json"))


def _paksa_harian() -> bool:
    """GEMINI_TTS_PAKSA_HARIAN=1 -> kunci yang kuota hariannya habis ikut dipaksa jalan lagi (biasanya sia-sia)."""
    return os.environ.get("GEMINI_TTS_PAKSA_HARIAN", "0").strip().lower() in ("1", "true", "ya")


def _ck(kunci: str, model: str = "") -> str:
    """[DIUBAH] Kuota Gemini dihitung PER MODEL. Pengenal = model + sidik jari kunci (bukan kunci asli, aman disimpan di file)."""
    return f"{model}|{hashlib.sha256(kunci.encode('utf-8')).hexdigest()[:12]}"


def _simpan_status() -> None:
    """Dipanggil di dalam _kunci_lock. Gagal menulis file tidak boleh mengganggu suara."""
    try:
        sekarang = time.time()
        mati = {k: v for k, v in _kunci_mati_sampai.items() if v > sekarang}
        data = {
            "mati": mati,
            "harian": {k: v for k, v in _kunci_harian_habis_sampai.items() if v > sekarang},
            "gagal": {k: v for k, v in _gagal_beruntun.items() if k in mati},
        }
        tmp = _FILE_STATUS.with_name(_FILE_STATUS.name + ".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, _FILE_STATUS)
    except Exception as e:  # noqa: BLE001
        logger.warning("Gemini TTS: gagal menyimpan status kunci: %s", e)


def _muat_status() -> None:
    try:
        if not _FILE_STATUS.exists():
            return
        data = json.loads(_FILE_STATUS.read_text(encoding="utf-8"))
        sekarang = time.time()
        for nama, tujuan in (("mati", _kunci_mati_sampai), ("harian", _kunci_harian_habis_sampai)):
            for k, v in (data.get(nama) or {}).items():
                if float(v) > sekarang:
                    tujuan[k] = float(v)
        for k, v in (data.get("gagal") or {}).items():
            if k in _kunci_mati_sampai:
                _gagal_beruntun[k] = int(v)
        if _kunci_mati_sampai:
            logger.info("Gemini TTS: %d pasangan (model, kunci) masih istirahat, dipulihkan dari %s",
                        len(_kunci_mati_sampai), _FILE_STATUS.name)
    except Exception as e:  # noqa: BLE001
        logger.warning("Gemini TTS: status kunci lama tidak terbaca, mulai dari nol: %s", e)


def _set_giliran(model: str, indeks: int) -> None:
    with _kunci_lock:
        _giliran[model] = indeks


def _kunci_tersedia(paksa: bool = False, model: str = "") -> list:
    """Daftar kunci (urut mulai dari kunci aktif milik model itu). Dipakai _gemini_siap().
    paksa=False: hanya yang tidak istirahat. paksa=True: semua yang valid, paling lama istirahat dulu."""
    semua = _semua_kunci_gemini()
    if not semua:
        return []
    with _kunci_lock:
        sekarang = time.time()
        mulai = _giliran.get(model, 0) % len(semua)
        urut = semua[mulai:] + semua[:mulai]
        urut = [k for k in urut if sekarang >= _kunci_ditolak_sampai.get(k, 0.0)]
        if not paksa:
            return [k for k in urut if sekarang >= _kunci_mati_sampai.get(_ck(k, model), 0.0)]
        if not _paksa_harian():
            urut = [k for k in urut if sekarang >= _kunci_harian_habis_sampai.get(_ck(k, model), 0.0)]
        return sorted(urut, key=lambda k: _kunci_mati_sampai.get(_ck(k, model), 0.0))


def _pilih_kunci(model: str, dicoba: set):
    """[BARU] Pilih kunci BERIKUTNYA berdasarkan status TERKINI (bukan daftar yang dibuat di awal request).
    Kunci yang sedang istirahat dilewati begitu saja, tanpa dicoba. Mengembalikan (kunci, dipaksa) atau (None, False).
    dipaksa=True: semua kunci sedang istirahat -> ambil yang PALING LAMA istirahat (kunci 1 lebih dulu bila berurutan)."""
    semua = _semua_kunci_gemini()
    if not semua:
        return None, False
    with _kunci_lock:
        sekarang = time.time()
        mulai = _giliran.get(model, 0) % len(semua)
        urut = semua[mulai:] + semua[:mulai]
        layak = [k for k in urut if k not in dicoba and sekarang >= _kunci_ditolak_sampai.get(k, 0.0)]
        for k in layak:
            if sekarang >= _kunci_mati_sampai.get(_ck(k, model), 0.0):
                dilewati = [semua.index(x) + 1 for x in layak[:layak.index(k)] if x not in dicoba]
                if dilewati and not dicoba:
                    logger.info("Gemini TTS [%s]: kunci #%s sedang istirahat, langsung pakai kunci #%d",
                                model or "-", ",#".join(str(n) for n in dilewati), semua.index(k) + 1)
                return k, False
        if not _paksa_harian():
            layak = [k for k in layak if sekarang >= _kunci_harian_habis_sampai.get(_ck(k, model), 0.0)]
        if not layak:
            return None, False
        return min(layak, key=lambda k: _kunci_mati_sampai.get(_ck(k, model), 0.0)), True


def _iter_kunci(model: str, izinkan_paksa: bool = False):
    """[BARU] Generator: tiap iterasi memilih kunci berdasarkan status terbaru, tiap kunci maksimal sekali per request.
    [DIUBAH] Paksa-jalan (semua kunci istirahat) HANYA kalau izinkan_paksa=True (mode strict, putaran kedua);
    dibatasi GEMINI_TTS_PAKSA_MAKS kunci per model, supaya satu request tidak menyapu 14 kunci yang hampir pasti masih limit.
    Mode biasa: kunci istirahat dilewati begitu saja, lalu pindah model."""
    dicoba: set = set()
    dipaksa_n = 0
    maks_paksa = int(os.environ.get("GEMINI_TTS_PAKSA_MAKS", "2") or 2)
    while True:
        kunci, dipaksa = _pilih_kunci(model, dicoba)
        if kunci is None:
            return
        if dipaksa:
            if not izinkan_paksa or dipaksa_n >= maks_paksa:
                return
            dipaksa_n += 1
        dicoba.add(kunci)
        yield kunci


def _tandai_sukses(kunci: str, model: str = "") -> None:
    """[BARU] Kunci berhasil -> hapus catatan gagal/istirahatnya."""
    ck = _ck(kunci, model)
    with _kunci_lock:
        if ck in _gagal_beruntun or ck in _kunci_mati_sampai or ck in _kunci_harian_habis_sampai:
            _gagal_beruntun.pop(ck, None)
            _kunci_mati_sampai.pop(ck, None)
            _kunci_harian_habis_sampai.pop(ck, None)
            _simpan_status()


def _detik_sampai_reset_harian() -> int:
    """Detik sampai reset kuota harian Gemini (tengah malam waktu Pasifik, +5 menit pengaman)."""
    try:
        from zoneinfo import ZoneInfo
        sekarang = datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:  # noqa: BLE001 (tzdata belum terpasang di Windows) -> pakai PST tetap UTC-8
        sekarang = datetime.now(timezone(timedelta(hours=-8)))
    reset = (sekarang + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return max(60, int((reset - sekarang).total_seconds()))


def _detik_dari_pesan(low: str):
    """Baca waktu tunggu dari pesan Google, mis. "retry in 13h38m45s" atau "retryDelay": "13s". None kalau tidak ada."""
    m = re.search(r"retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?", low)
    if m and any(m.groups()):
        return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(float(m.group(3) or 0))
    m = re.search(r"retrydelay\"?\s*:\s*\"?(\d+(?:\.\d+)?)s", low)
    if m:
        return int(float(m.group(1)))
    return None


def _tandai_limit(kunci: str, resp, jeda_default: int, nomor: int, model: str = "") -> None:
    """Dipanggil saat 429: baca isi error Google, bedakan limit harian vs per menit, istirahatkan kunci UNTUK MODEL ITU SAJA.
    [BARU] Kalau kunci terus kena 429 berturut-turut tanpa petunjuk waktu, istirahatnya digandakan (jeda, 2x, 4x ... maks 30 menit)
    supaya kunci yang sebenarnya habis harian tidak dicoba ulang tiap menit."""
    try:
        teks = resp.text[:3000]
    except Exception:  # noqa: BLE001
        teks = ""
    low = teks.lower()
    harian = ("perday" in low) or ("per day" in low) or ("limit: 0" in low)
    tunggu = _detik_dari_pesan(low)
    ck = _ck(kunci, model)
    with _kunci_lock:
        n = _gagal_beruntun.get(ck, 0) + 1
        _gagal_beruntun[ck] = n
        if harian:
            detik = (tunggu + 5) if tunggu else _detik_sampai_reset_harian()
            _kunci_harian_habis_sampai[ck] = time.time() + detik
        elif tunggu:
            detik = max(tunggu + 2, jeda_default)
        else:
            detik = min(jeda_default * (2 ** min(n - 1, 10)), 1800)
        _kunci_mati_sampai[ck] = time.time() + detik
        _simpan_status()
    logger.warning(
        "Gemini TTS: kunci #%d kena limit (%s) di model %s, istirahat %d dtk (gagal berturut-turut: %d) | %s",
        nomor, "harian" if harian else "per menit", model or "-", detik, n, " ".join(teks.split())[:240],
    )  # hanya nomor urut + isi error Google yang dicatat, JANGAN pernah mencatat isi kunci


_muat_status()


_kolam = ThreadPoolExecutor(max_workers=32, thread_name_prefix="gemini-cek")  # [BARU] thread untuk cek kunci paralel


def _cek_paralel_n() -> int:
    """[BARU] GEMINI_TTS_CEK_PARALEL: 0 = semua kunci segar sekaligus (default), 1 = matikan cek paralel, N>=2 = N kunci sekaligus."""
    try:
        return max(0, int(os.environ.get("GEMINI_TTS_CEK_PARALEL", "0") or 0))
    except ValueError:
        return 0


def _picu_paralel() -> int:
    """[BARU] GEMINI_TTS_PARALEL_PICU (default 2): cek paralel baru jalan setelah sekian kunci BERTURUT-TURUT kena limit di request ini.
    Jadi saat satu kunci habis di tengah hari, kunci berikutnya dicoba biasa (tanpa kuota terbuang); paralel hanya untuk kondisi
    banyak kunci habis sekaligus (mis. baru restart / pertama kali)."""
    try:
        return max(1, int(os.environ.get("GEMINI_TTS_PARALEL_PICU", "2") or 2))
    except ValueError:
        return 2


def _sedang_istirahat(kunci: str, model: str = "") -> bool:
    with _kunci_lock:
        sekarang = time.time()
        return sekarang < _kunci_mati_sampai.get(_ck(kunci, model), 0.0) or sekarang < _kunci_ditolak_sampai.get(kunci, 0.0)


def _arahkan_giliran(model: str) -> None:
    """[BARU] Setelah gelombang paralel statusnya sudah kelihatan: giliran diarahkan ke kunci SEGAR PALING DEPAN
    (nomor terkecil setelah kunci-kunci yang istirahat), bukan ke kunci yang kebetulan paling cepat membalas."""
    semua = _semua_kunci_gemini()
    if not semua:
        return
    with _kunci_lock:
        sekarang = time.time()
        mulai = _giliran.get(model, 0) % len(semua)
        for geser in range(len(semua)):
            i = (mulai + geser) % len(semua)
            k = semua[i]
            if sekarang >= _kunci_ditolak_sampai.get(k, 0.0) and sekarang >= _kunci_mati_sampai.get(_ck(k, model), 0.0):
                _giliran[model] = i
                return


def _gelombang_paralel(model: str, kirim_satu, buang, jumlah: int, tunggu_maks: float):
    """[BARU] Cek banyak kunci SEKALIGUS. kirim_satu(kunci) -> (kategori, hasil); kategori: "ok" | "limit" | "ditolak" | "404" | "lain".
    Tiap kunci langsung mencatat statusnya sendiri (429 -> istirahat, dst.), jadi begitu gelombang selesai kelihatan mana yang
    istirahat dan mana yang segar. Hasil sukses PERTAMA dipakai; sukses lain dibuang lewat buang(hasil) (kuotanya tetap terpakai).
    Mengembalikan ((kunci, hasil) atau None, himpunan kategori)."""
    kandidat: list = []
    dicoba: set = set()
    batas_n = jumlah if jumlah and jumlah > 0 else 10 ** 6
    while len(kandidat) < batas_n:
        k, dipaksa = _pilih_kunci(model, dicoba)
        if k is None or dipaksa:  # hanya kunci SEGAR; kunci istirahat tidak ikut dicoba
            break
        dicoba.add(k)
        kandidat.append(k)
    if len(kandidat) < 2:
        return None, set()
    semua = _semua_kunci_gemini()
    logger.info("Gemini TTS [%s]: mengecek %d kunci SEKALIGUS (#%s)", model or "-", len(kandidat),
                ",#".join(str(semua.index(k) + 1) for k in kandidat))
    kunci_menang = threading.Lock()
    status = {"menang": None, "selesai": False}

    def kerja(k: str) -> str:
        try:
            kat, hasil = kirim_satu(k)
        except Exception as e:  # noqa: BLE001
            logger.warning("Gemini TTS: cek paralel gagal untuk satu kunci: %s", e)
            return "lain"
        if kat != "ok":
            return kat
        with kunci_menang:
            if status["menang"] is None and not status["selesai"]:
                status["menang"] = (k, hasil)
                return "ok"
        buang(hasil)  # sudah ada pemenang: hasil ini dibuang (kuota kunci ini terlanjur terpakai)
        return "dibuang"

    pending = {_kolam.submit(kerja, k) for k in kandidat}
    kategori: set = set()
    akhir = time.monotonic() + max(0.5, tunggu_maks)
    while pending and status["menang"] is None:
        sisa = akhir - time.monotonic()
        if sisa <= 0:
            break
        selesai, pending = _tunggu_futures(pending, timeout=sisa, return_when=FIRST_COMPLETED)
        for f in selesai:
            kategori.add(f.result())
    with kunci_menang:
        status["selesai"] = True  # hasil sukses yang datang terlambat akan dibuang sendiri oleh kerja()
        menang = status["menang"]
    return menang, kategori


# [BARU] Gemini lambat/macet (kena batas waktu) -> dilewati sementara; tanpa ini tiap kalimat jawaban menunggu sampai batas habis.
_gemini_lambat = {"sampai": 0.0}


def _stream_aktif() -> bool:
    """GEMINI_TTS_STREAM=0 -> Gemini dimatikan sepenuhnya (tidak ada lagi jalur Gemini non-streaming)."""
    return os.environ.get("GEMINI_TTS_STREAM", "1").strip().lower() not in ("0", "false", "off", "tidak")


def _daftar_model_stream() -> list:
    """[BARU] URUTAN model Gemini TTS streaming. GEMINI_TTS_STREAM_MODELS=model1,model2,... (model 1 dipakai dulu).
    Kosong -> [GEMINI_TTS_STREAM_MODEL (default gemini-3.8-flash-lite-tts), gemini-3.8-flash-tts]."""
    mentah = (os.environ.get("GEMINI_TTS_STREAM_MODELS") or "").strip()
    if mentah:
        hasil = [m.strip() for m in re.split(r"[,\s;]+", mentah) if m.strip()]
    else:
        utama = (os.environ.get("GEMINI_TTS_STREAM_MODEL") or "gemini-3.8-flash-lite-tts").strip()
        hasil = [utama, "gemini-3.8-flash-tts"]
    return list(dict.fromkeys(hasil))


_model_tak_didukung_sampai: dict = {}  # [BARU] model -> epoch detik; server menolak (400/404): dilewati sementara
_model_terakhir_dipakai = {"nama": None}  # [BARU] hanya untuk log: kapan suara pindah model


def _model_aktif(model: str) -> bool:
    with _kunci_lock:
        return time.time() >= _model_tak_didukung_sampai.get(model, 0.0)


def _tandai_model_tak_didukung(model: str, status: int, rincian: str) -> None:
    detik = int(os.environ.get("GEMINI_TTS_MODEL_MATI", "600") or 600)
    with _kunci_lock:
        _model_tak_didukung_sampai[model] = time.time() + detik
    logger.warning(
        "Gemini TTS: model %s ditolak server (HTTP %d), dilewati %d dtk | %s",
        model, status, detik, " ".join((rincian or "").split())[:200],
    )


def _model_gemini_semua() -> list:
    """[DIUBAH] Model Gemini TTS streaming yang BOLEH dicoba sekarang, sesuai urutan prioritas."""
    if not _stream_aktif():
        return []
    return [m for m in _daftar_model_stream() if _model_aktif(m)]


def _gemini_siap() -> bool:
    if _gemini_strict():  # strict: selama ada kunci yang valid di salah satu model, Gemini selalu dicoba (tidak ada Edge)
        return any(_kunci_tersedia(paksa=True, model=m) for m in _model_gemini_semua())
    if time.time() < _gemini_lambat["sampai"]:
        return False
    return any(_kunci_tersedia(model=m) for m in _model_gemini_semua())


# ====================== GEMINI TTS STREAMING (satu-satunya jalur Gemini) ======================
# Gemini 3.8 TTS streaming lewat Interactions API (POST /v1beta/interactions, "stream": true).
# Audio datang sebagai potongan PCM mentah 16-bit, 24 kHz, mono, jadi frontend bisa mulai memutar sebelum kalimat selesai dibuat.
# GEMINI_TTS_GAYA dikirim sebagai `style` (bukan digabung ke teks, supaya tidak ikut terbaca).
# Semua model memakai badan permintaan yang sama; hanya nama modelnya yang berganti (lihat _daftar_model_stream).


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


def _badan_stream(teks: str, model: str) -> dict:
    gaya = (os.environ.get("GEMINI_TTS_GAYA") or "Ucapkan dengan santai, hangat, dan natural seperti ngobrol dengan teman").strip()
    suara = (os.environ.get("GEMINI_TTS_VOICE") or "Sulafat").strip()
    anotasi = [{"type": "speech_metadata", "style": gaya}] if gaya else []
    teks_item = {"type": "text", "text": teks}
    if anotasi:
        teks_item["annotations"] = anotasi
    return {
        "model": model,
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


def _coba_kunci_stream(kunci: str, model: str, badan: dict, batas: float, semua: list, jeda: int):
    """[BARU] SATU kunci di SATU model. Mengembalikan (kategori, hasil).
    kategori: "ok" | "limit" (429) | "ditolak" (401/403) | "404" (model ditolak server: 400/404) | "waktu" | "lain".
    hasil (kalau ok) = (potongan_pertama, iterator_sisa, tutup, nomor_kunci)."""
    nomor = semua.index(kunci) + 1  # hanya nomor urut yang dicatat di log, JANGAN pernah mencatat isi kunci
    sisa_k = batas - time.monotonic()
    if sisa_k < 1.0:
        return "waktu", None
    try:
        r = _sesi.post(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            headers={"x-goog-api-key": kunci, "Content-Type": "application/json"},
            json=badan,
            stream=True,
            timeout=(3.05, min(20.0, max(2.0, sisa_k))),
        )
    except requests.RequestException as e:
        logger.warning("Gemini TTS [%s]: koneksi kunci #%d gagal: %s", model, nomor, e)
        return "lain", None
    if r.status_code == 429:
        _tandai_limit(kunci, r, jeda, nomor, model)
        r.close()
        return "limit", None
    if r.status_code in (401, 403):
        _kunci_ditolak_sampai[kunci] = time.time() + 3600
        logger.warning("Gemini TTS [%s]: kunci #%d ditolak (%d)", model, nomor, r.status_code)
        r.close()
        return "ditolak", None
    if r.status_code in (400, 404):  # nama model salah / tidak mendukung format streaming ini: kunci lain tidak akan menolong
        try:
            rincian = r.text[:300]
        except Exception:  # noqa: BLE001
            rincian = ""
        r.close()
        _tandai_model_tak_didukung(model, r.status_code, rincian)
        return "404", None
    if r.status_code != 200:
        logger.warning("Gemini TTS [%s]: kunci #%d HTTP %d", model, nomor, r.status_code)
        r.close()
        return "lain", None

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
        logger.warning("Gemini TTS [%s]: kunci #%d stream selesai tanpa audio", model, nomor)
        return "lain", None
    except Exception as e:  # noqa: BLE001
        tutup()
        logger.warning("Gemini TTS [%s]: kunci #%d stream putus sebelum audio: %s", model, nomor, e)
        return "lain", None
    _tandai_sukses(kunci, model)
    return "ok", (pertama, gen, tutup, nomor)


def _coba_model_stream(model: str, teks: str, batas: float, semua: list, jeda: int, izinkan_paksa: bool):
    """[BARU] Coba SEMUA kunci di SATU model (kunci istirahat dilewati). Mengembalikan (status, hasil):
    "ok" (hasil = (pertama, iterator, tutup)) | "limit" (semua kunci yang dicoba kena limit) | "tak_ada_kunci" (semua kunci
    sedang istirahat, tidak ada yang dicoba) | "404" (model ditolak server) | "lain" (gagal sebab lain).
    Raise HTTPException 504 kalau batas waktu total habis."""
    badan = _badan_stream(teks, model)

    def kirim(kunci):
        return _coba_kunci_stream(kunci, model, badan, batas, semua, jeda)

    dicoba = 0
    limit_beruntun = 0
    lain_beruntun = 0
    ada_limit = False
    gelombang_sudah = False
    for kunci in _iter_kunci(model, izinkan_paksa):
        dicoba += 1
        nomor = semua.index(kunci) + 1
        # Sudah beberapa kunci berturut-turut kena limit -> cek SEMUA kunci segar di model ini sekaligus
        if limit_beruntun >= _picu_paralel() and not gelombang_sudah and _cek_paralel_n() != 1:
            gelombang_sudah = True
            menang, kategori = _gelombang_paralel(model, kirim, lambda h: h[2](), _cek_paralel_n(), batas - time.monotonic())
            if menang is not None:
                pertama_m, gen_m, tutup_m, _nomor_m = menang[1]
                _arahkan_giliran(model)
                return "ok", (pertama_m, gen_m, tutup_m)
            if "404" in kategori:
                return "404", None
            if _sedang_istirahat(kunci, model):
                continue
        kat, hasil = kirim(kunci)
        if kat == "ok":
            pertama, gen, tutup, nomor_ok = hasil
            _set_giliran(model, nomor_ok - 1)  # tetap di kunci ini sampai kena limit
            return "ok", (pertama, gen, tutup)
        if kat == "waktu":
            raise HTTPException(status_code=504, detail="Gemini TTS (stream) melewati batas waktu.")
        if kat == "404":
            return "404", None
        if kat == "limit":
            _set_giliran(model, nomor % len(semua))  # giliran pindah ke kunci berikutnya (setelah terakhir -> kunci 1)
            ada_limit = True
            limit_beruntun += 1
            lain_beruntun = 0
            continue
        if kat == "ditolak":
            _set_giliran(model, nomor % len(semua))
            continue
        lain_beruntun += 1  # "lain": 5xx / koneksi / stream kosong. Dua kali berturut-turut -> menyerah di model ini
        if lain_beruntun >= 2:
            return "lain", None
    if dicoba == 0:
        return "tak_ada_kunci", None
    return ("limit" if ada_limit else "lain"), None


def _buka_stream_gemini(teks: str, batas: float):
    """[DIUBAH] Buka stream Gemini dengan ALUR MODEL BERURUTAN dan tunggu potongan audio PERTAMA.
    Model 1: semua kunci (#1 -> terakhir). Semua kunci kena limit/istirahat -> Model 2: semua kunci. Dst.
    Mengembalikan (potongan_pertama, iterator_sisa, tutup).
    Raise HTTPException: 503 = semua model/kunci habis (frontend lanjut ke Edge), 502 = gagal sebab lain, 504 = batas waktu."""
    semua = _semua_kunci_gemini()
    if not semua:
        raise HTTPException(status_code=503, detail="Tidak ada kunci Gemini yang tersedia (belum diisi).")
    daftar = _model_gemini_semua()
    if not daftar:
        raise HTTPException(status_code=503, detail="Tidak ada model Gemini TTS yang aktif.")
    jeda = int(os.environ.get("GEMINI_TTS_JEDA", "300") or 300)
    hasil_per_model: dict = {}
    # Putaran 1: hanya kunci SEGAR. Putaran 2 (hanya mode strict): kunci istirahat ikut dipaksa jalan, karena strict tidak punya Edge.
    for izinkan_paksa in ([False, True] if _gemini_strict() else [False]):
        for indeks, model in enumerate(daftar):
            status, hasil = _coba_model_stream(model, teks, batas, semua, jeda, izinkan_paksa)
            if status == "ok":
                with _kunci_lock:
                    berganti = _model_terakhir_dipakai["nama"] != model
                    _model_terakhir_dipakai["nama"] = model
                if berganti:
                    logger.info("Gemini TTS: suara sekarang memakai model %s%s", model,
                                "" if indeks == 0 else " (model cadangan nomor %d)" % (indeks + 1))
                return hasil
            hasil_per_model[model] = status
            if status == "limit":  # "tak_ada_kunci" (masih istirahat dari kalimat sebelumnya) tidak dicatat lagi: cukup sekali
                lanjut = daftar[indeks + 1] if indeks + 1 < len(daftar) else None
                logger.warning("Gemini TTS: semua kunci di model %s kena limit/istirahat -> %s", model,
                               ("pindah ke model " + lanjut) if lanjut else "tidak ada model lagi")
    rangkum = ", ".join("%s=%s" % (m, s) for m, s in hasil_per_model.items())
    if all(s in ("limit", "tak_ada_kunci", "404") for s in hasil_per_model.values()):
        raise HTTPException(status_code=503, detail="Gemini TTS habis di semua model (%s)." % rangkum)
    raise HTTPException(status_code=502, detail="Gemini TTS stream gagal (%s)." % rangkum)


_peralihan = {"edge": False}


def _catat_peralihan(siap: bool) -> None:
    """[BARU] Catat di log saat suara pindah ke Edge (semua kunci Gemini istirahat) dan saat kembali ke Gemini (ada kunci pulih)."""
    if _gemini_strict():
        return
    if not siap and not _peralihan["edge"]:
        _peralihan["edge"] = True
        logger.warning("Semua kunci Gemini sedang istirahat -> suara sementara memakai Edge TTS")
    elif siap and _peralihan["edge"]:
        _peralihan["edge"] = False
        logger.info("Ada kunci Gemini yang sudah selesai istirahat -> kembali memakai Gemini TTS")


def buat_router_tts(auth) -> APIRouter:
    router = APIRouter(tags=["tts"])

    @router.post("/api/tts")
    async def tts(body: TtsRequest, user: dict = Depends(auth.get_current_user)):
        """[DIUBAH] Tidak lagi memanggil Gemini (semua Gemini lewat /api/tts/stream). Hanya Edge TTS (default) atau Azure.
        Dipanggil frontend kalau /api/tts/stream menjawab 502/503/504 (Gemini habis di semua model)."""
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
        if provider == "gemini":  # strict: jangan pindah suara ke Edge
            raise HTTPException(status_code=502, detail="Mode strict (TTS_PROVIDER=gemini): suara hanya dari Gemini lewat /api/tts/stream, tanpa Edge.")
        audio = await _sintesis_edge(teks, bahasa)
        return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    @router.post("/api/tts/stream")
    async def tts_stream(body: TtsRequest, user: dict = Depends(auth.get_current_user)):
        """Audio Gemini streaming: PCM mentah 16-bit, 24 kHz, mono (audio/l16). Header baru dikirim setelah audio pertama
        siap, jadi status non-200 berarti belum ada audio sama sekali (frontend boleh mencoba ulang / minta /api/tts)."""
        teks = (body.teks or "").strip()
        if not teks:
            raise HTTPException(status_code=400, detail="Teks kosong.")
        if len(teks) > MAKS_KARAKTER:
            raise HTTPException(status_code=413, detail=f"Teks terlalu panjang ({len(teks)} > {MAKS_KARAKTER} karakter). Pecah per kalimat.")
        siap_stream = _gemini_siap()
        _catat_peralihan(siap_stream)
        if not siap_stream:
            # 503 = "Gemini sedang habis" (semua model, semua kunci): frontend langsung meminta /api/tts (Edge)
            raise HTTPException(status_code=503, detail="Gemini TTS tidak tersedia (semua model/kunci istirahat, kosong, atau ditolak).")
        total = float(os.environ.get("GEMINI_TTS_BATAS", "6") or 6)
        batas = time.monotonic() + max(2.0, total)
        try:
            pertama, sisa, tutup = await run_in_threadpool(_buka_stream_gemini, teks, batas)
        except HTTPException as e:
            if e.status_code == 504 and not _gemini_strict():
                jeda_lambat = int(os.environ.get("GEMINI_TTS_JEDA_LAMBAT", "60") or 60)
                _gemini_lambat["sampai"] = time.time() + jeda_lambat
                logger.warning("Gemini TTS melewati batas waktu, dilewati %d dtk (langsung Edge)", jeda_lambat)
            raise

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