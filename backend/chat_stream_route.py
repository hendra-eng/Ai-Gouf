"""
chat_stream_route.py
====================
Endpoint POST /api/chat/stream (SSE) yang dipanggil api.chatStream() di
frontend (halaman Agent AI + VoiceAssistant). Di main.py zip ini route-nya
tidak ada, jadi frontend dapat 404 -> VoiceAssistant menjawab
"Maaf, saya sedang tidak bisa menjawab".

Letakkan file ini di backend/chat_stream_route.py, lalu di main.py tambahkan
(setelah `app = FastAPI(...)` dan import `auth`):

    from chat_stream_route import buat_router_chat
    app.include_router(buat_router_chat(auth))
"""
import asyncio
import json
import os
import threading
from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import akuntansi_ai as ak
import memori_ai as mem


class PesanRiwayat(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    pesan: str
    riwayat: List[PesanRiwayat] = []
    ringkasan_data: List[str] = []
    client_id: Optional[str] = None
    percakapan_id: Optional[str] = None
    # True = dipanggil asisten suara -> jalur cepat (prompt ringkas, Groq dulu, jawaban pendek)
    mode_suara: bool = False
    # [BARU -- MEMORI AI] ucapan pengguna apa adanya (tanpa instruksi tambahan) + id sesi suara
    pesan_asli: Optional[str] = None
    sesi_id: Optional[str] = None


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def buat_router_chat(auth) -> APIRouter:
    router = APIRouter(tags=["chat"])

    @router.post("/api/chat/stream")
    async def chat_stream(
        body: ChatStreamRequest,
        user: dict = Depends(auth.get_current_user),
    ):
        riwayat = [m.dict() for m in body.riwayat if m.role in ("user", "assistant")]
        suara = body.mode_suara
        pakai_prompt_lengkap = os.environ.get("VOICE_PROMPT_LENGKAP", "").strip() in ("1", "true", "yes")
        pemilik = mem.pemilik_dari_user(user)
        ucapan = (body.pesan_asli or body.pesan or "").strip()[:1500]
        sumber = "suara" if suara else "agent-ai"
        kunci = body.sesi_id or body.percakapan_id

        if suara and not pakai_prompt_lengkap:
            # Prompt ringkas -> token pertama keluar jauh lebih cepat
            system_dasar = ak.buat_system_prompt_suara()
            riwayat = riwayat[-8:]
        else:
            system_dasar = ak.buat_system_prompt_akuntansi()
            if body.ringkasan_data:
                system_dasar += ak.buat_ringkasan_konteks_data(body.ringkasan_data, 0, 0)

        loop = asyncio.get_running_loop()
        q: "asyncio.Queue" = asyncio.Queue()
        berhenti = threading.Event()  # di-set saat klien putus (mis. user memotong AI)

        def kirim(item):
            try:
                loop.call_soon_threadsafe(q.put_nowait, item)
            except RuntimeError:  # event loop sudah tertutup (klien putus)
                berhenti.set()

        # tanya_ai_stream itu generator SINKRON/blocking -> jalankan di thread
        # supaya event loop tidak macet. Token dikirim ke event loop lewat
        # call_soon_threadsafe (langsung, tanpa polling sleep).
        def kerja():
            # [MEMORI AI] ambil ingatan relevan (+ tangani "ingat bahwa..." / "lupakan...")
            konteks = mem.siapkan_konteks(pemilik, ucapan)
            kwargs = {"system_prompt": system_dasar + konteks["tambahan_prompt"], "riwayat": riwayat}
            if suara:
                kwargs["provider_utama"] = "Groq"  # Groq dulu; DeepSeek jadi cadangan
                kwargs["max_tokens"] = 700          # jawaban lisan pendek (termasuk token "mikir")
            jawaban = []
            sukses = False
            gen = ak.tanya_ai_stream(body.pesan, **kwargs)
            try:
                for delta in gen:
                    if berhenti.is_set():
                        break
                    jawaban.append(delta)
                    kirim(("delta", delta))
                sukses = True
            except Exception as e:  # noqa: BLE001
                kirim(("error", str(e)))
            finally:
                try:
                    gen.close()  # tutup koneksi ke provider -> berhenti menghabiskan token
                except Exception:  # noqa: BLE001
                    pass
                kirim(("done", None))
            # [MEMORI AI] setelah respons selesai dikirim: catat percakapan & belajar (tidak menambah jeda)
            if sukses and ucapan:
                mem.setelah_jawaban(pemilik, sumber, kunci, ucapan, "".join(jawaban), konteks["fakta_ids"])

        threading.Thread(target=kerja, daemon=True).start()

        async def event_generator():
            try:
                while True:
                    jenis, isi = await q.get()
                    if jenis == "delta":
                        yield _sse({"delta": isi})
                    elif jenis == "error":
                        yield _sse({"error": isi})
                    else:
                        yield "data: [DONE]\n\n"
                        return
            finally:
                berhenti.set()

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router