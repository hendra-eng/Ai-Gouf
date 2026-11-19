"""
modules/chat_zafeb.py
=====================
Endpoint chat untuk bubble Zake (src/components/ChatWidget.tsx).

    POST /api/chat/stream   -- balasan AI, streaming SSE (atau 1 JSON kalau tanpa_stream)

Kontrak yang dipakai frontend (src/app/zafeb-ai/lib/api.js::chatStream):
  - Mode stream : baris `data: {"delta": "..."}` dipisah baris kosong, ditutup `data: [DONE]`.
                  Error di tengah jalan dikirim sebagai `data: {"error": "..."}`.
  - tanpa_stream: respons JSON `{"jawaban": "..."}` (untuk tunnel yang tidak mendukung SSE).

Model: Claude Haiku lewat ANTHROPIC_API_KEY (ganti model dengan env CHAT_CLAUDE_MODEL,
default "claude-haiku-5-5"). Kalau key Claude kosong atau Claude gagal sebelum jawaban
mulai, otomatis jatuh ke provider lama (DeepSeek/Groq) di akuntansi_ai.py.

Pengetahuan aplikasi: Zake membaca "peta aplikasi" (modules/peta_aplikasi.py, data dari
data/peta_aplikasi.json) -- jumlah halaman, komponen, tombol, tab, dan hak akses. Peta dibuat
otomatis dari kode frontend: jalankan `python scripts/buat_peta_aplikasi.py` setiap ada
halaman/tombol baru. Frontend mengirim `halaman` (path yang sedang dibuka) agar jawaban
dan detail yang dimuat sesuai halaman itu.

Catatan: AI di sini belum membaca data keuangan client dari database -- prompt-nya
sengaja melarang mengarang angka.

Riwayat percakapan: kalau frontend mengirim `percakapan_id` (hasil POST /api/percakapan),
pesan user & jawaban AI disimpan otomatis ke tabel zake_percakapan/zake_pesan
(lihat modules/percakapan_zafeb.py). Gagal menyimpan tidak menggagalkan chat.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Iterator, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

import akuntansi_ai as ak
import db_client as dbc
from modules import auth
from modules import peta_aplikasi as peta
from modules import percakapan_zafeb as riwayat_chat

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

CLAUDE_MODEL = os.environ.get("CHAT_CLAUDE_MODEL", "claude-haiku-5-5")
MAKS_TOKEN_JAWABAN = 3000  # daftar tombol satu halaman bisa panjang
MAKS_RIWAYAT = 20       # jumlah pesan terakhir yang ikut dikirim sebagai konteks
MAKS_PANJANG_PESAN = 8000


class ChatRequest(BaseModel):
    # field lain dari frontend (mode_suara, agen, dst) diterima tapi diabaikan
    model_config = ConfigDict(extra="allow")

    pesan: str = Field(..., min_length=1)
    riwayat: List[Dict[str, Any]] = Field(default_factory=list)
    client_id: Optional[str] = None
    percakapan_id: Optional[Any] = None
    halaman: Optional[str] = None  # path halaman yang sedang dibuka user (mis. "/transactions/sales")
    tanpa_stream: bool = False


def _nama_client(client_id: Optional[str]) -> Optional[str]:
    if not client_id:
        return None
    try:
        c = dbc.ambil_client(str(client_id))
        return (c or {}).get("nama")
    except Exception:  # noqa: BLE001 -- nama client hanya pelengkap, jangan gagalkan chat
        logger.warning("Gagal mengambil nama client %s", client_id, exc_info=True)
        return None


def _system_prompt(nama_client: Optional[str]) -> str:
    konteks = f"Pengguna sedang membuka data perusahaan: {nama_client}." if nama_client else ""
    return (
        "Kamu adalah Zake, asisten keuangan dan akuntansi di dalam aplikasi Dashboardori.\n"
        f"{konteks}\n"
        "Jawab dalam Bahasa Indonesia yang ringkas, jelas, dan sopan. Gunakan markdown ringan "
        "(daftar, **tebal**, tabel) hanya kalau membantu.\n"
        "ATURAN PENTING:\n"
        "- Kamu BELUM terhubung ke data transaksi atau laporan keuangan perusahaan ini. JANGAN "
        "mengarang angka, saldo, piutang, atau laba. Kalau pengguna menanyakan angka spesifik, "
        "katakan terus terang bahwa kamu belum bisa membacanya, lalu arahkan ke halaman terkait "
        "di aplikasi (mis. Sales, Purchase, Financial Statements) atau jelaskan cara menghitungnya.\n"
        "- Untuk pertanyaan konsep (akuntansi, pajak Indonesia, jurnal, analisis laporan), jawab "
        "sebaik mungkin. Untuk aturan pajak yang bisa berubah, sarankan memeriksa peraturan terbaru.\n"
        "- Kalau pertanyaan tidak jelas, ajukan satu pertanyaan klarifikasi singkat."
    ).strip()


def _susun_sistem(nama_client: Optional[str], pesan: str, halaman: Optional[str],
                  riwayat: List[Dict[str, str]]) -> Tuple[List[Dict[str, Any]], str]:
    """Return (blok_system_untuk_claude, teks_gabungan_untuk_provider_cadangan).

    Blok 1 (statis: aturan + peta ringkas) diberi cache_control -> dihitung murah di pertanyaan
    berikutnya. Blok 2 (dinamis: client, halaman aktif, detail halaman relevan) berubah tiap pesan.
    """
    dasar = _system_prompt(nama_client)
    statis_peta, dinamis_peta = "", ""
    try:
        statis_peta, dinamis_peta = peta.bangun_konteks(pesan, halaman, riwayat)
    except Exception:  # noqa: BLE001 -- peta hanya pelengkap, jangan gagalkan chat
        logger.warning("Gagal menyusun peta aplikasi", exc_info=True)
    if not statis_peta:
        return [{"type": "text", "text": dasar}], dasar

    blok_statis = f"{dasar}\n\n{peta.ATURAN_PETA}\n\n{statis_peta}"
    blok: List[Dict[str, Any]] = [{"type": "text", "text": blok_statis, "cache_control": {"type": "ephemeral"}}]
    teks = blok_statis
    if dinamis_peta:
        blok.append({"type": "text", "text": dinamis_peta})
        teks += "\n\n" + dinamis_peta
    return blok, teks


def _riwayat_bersih(riwayat: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    hasil: List[Dict[str, str]] = []
    for m in riwayat[-MAKS_RIWAYAT:]:
        role = m.get("role")
        isi = str(m.get("content") or "").strip()
        if role in ("user", "assistant") and isi:
            hasil.append({"role": role, "content": isi[:MAKS_PANJANG_PESAN]})
    return hasil


def _pesan_claude(riwayat: List[Dict[str, str]], pesan: str) -> List[Dict[str, str]]:
    """Claude menuntut pesan selang-seling user/assistant dan diawali user."""
    msgs: List[Dict[str, str]] = []
    for m in riwayat + [{"role": "user", "content": pesan}]:
        if msgs and msgs[-1]["role"] == m["role"]:
            msgs[-1]["content"] += "\n\n" + m["content"]
        else:
            msgs.append(dict(m))
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


def _klien_claude():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    import anthropic
    return anthropic.Anthropic(api_key=key, max_retries=2)


def _jawab_claude_stream(system_prompt: Any, riwayat: List[Dict[str, str]], pesan: str) -> Iterator[str]:
    client = _klien_claude()
    if client is None:
        raise RuntimeError("ANTHROPIC_API_KEY belum diisi")
    with client.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=MAKS_TOKEN_JAWABAN,
        system=system_prompt,
        messages=_pesan_claude(riwayat, pesan),
    ) as stream:
        for teks in stream.text_stream:
            if teks:
                yield teks


def _jawab_claude(system_prompt: Any, riwayat: List[Dict[str, str]], pesan: str) -> str:
    client = _klien_claude()
    if client is None:
        raise RuntimeError("ANTHROPIC_API_KEY belum diisi")
    res = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=MAKS_TOKEN_JAWABAN,
        system=system_prompt,
        messages=_pesan_claude(riwayat, pesan),
    )
    return "".join(b.text for b in res.content if getattr(b, "type", "") == "text")


def _sse(obj: Any) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/api/chat/stream")
def chat_stream(body: ChatRequest, user: dict = Depends(auth.get_current_user)):
    pesan = body.pesan.strip()[:MAKS_PANJANG_PESAN]
    if not pesan:
        raise HTTPException(status_code=400, detail="Pesan kosong.")

    riwayat = _riwayat_bersih(body.riwayat)
    system_blok, system_teks = _susun_sistem(_nama_client(body.client_id), pesan, body.halaman, riwayat)

    # Simpan pesan user SEBELUM AI menjawab, supaya tetap tercatat walau jawaban gagal/dihentikan.
    pid = riwayat_chat.id_valid(body.percakapan_id)
    if pid:
        riwayat_chat.simpan_pesan(pid, user, "user", pesan)

    if body.tanpa_stream:
        try:
            try:
                jawaban = _jawab_claude(system_blok, riwayat, pesan)
            except Exception:  # noqa: BLE001 -- cadangan: provider lama
                logger.warning("Claude gagal (tanpa stream), pakai cadangan", exc_info=True)
                jawaban = ak.tanya_ai(pesan, system_prompt=system_teks, riwayat=riwayat)
        except Exception as e:  # noqa: BLE001
            logger.exception("chat (tanpa stream) gagal")
            return {"error": str(e)}
        if pid:
            riwayat_chat.simpan_pesan(pid, user, "assistant", jawaban)
        return {"jawaban": jawaban}

    def generator() -> Iterator[str]:
        sudah_ada_token = False
        potongan_jawaban: List[str] = []
        tersimpan = False

        def simpan_jawaban() -> None:
            # Dipanggil SEBELUM "[DONE]" dikirim supaya riwayat sudah lengkap begitu frontend
            # selesai menerima stream (user bisa langsung klik back). Juga dipanggil dari
            # `finally` kalau koneksi diputus/di-Stop di tengah jalan -> jawaban parsial ikut tersimpan.
            nonlocal tersimpan
            if tersimpan or not pid:
                return
            tersimpan = True
            teks = "".join(potongan_jawaban).strip()
            if teks:
                riwayat_chat.simpan_pesan(pid, user, "assistant", teks)

        try:
            try:
                try:
                    for potongan in _jawab_claude_stream(system_blok, riwayat, pesan):
                        sudah_ada_token = True
                        potongan_jawaban.append(potongan)
                        yield _sse({"delta": potongan})
                except Exception:  # noqa: BLE001
                    if sudah_ada_token:
                        raise  # jawaban sudah terlanjur terkirim sebagian -- jangan pindah provider
                    logger.warning("Claude gagal sebelum token pertama, pakai cadangan", exc_info=True)
                    for potongan in ak.tanya_ai_stream(pesan, system_prompt=system_teks, riwayat=riwayat):
                        potongan_jawaban.append(potongan)
                        yield _sse({"delta": potongan})
            except Exception as e:  # noqa: BLE001
                logger.exception("chat stream gagal")
                yield _sse({"error": str(e)})
            simpan_jawaban()
            yield "data: [DONE]\n\n"
        finally:
            simpan_jawaban()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
