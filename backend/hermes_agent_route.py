"""
hermes_agent_route.py
=====================
Pintu penuh untuk agen Hermes (Telegram): Hermes bisa memakai SEMUA alat yang dipakai AI suara Neo,
dengan OTAK tetap Claude (ANTHROPIC_API_KEY di backend). Suara tetap lewat /api/tts (Gemini) -- file ini tidak menyentuhnya.

Semua endpoint wajib header  X-Agent-Key: <HERMES_AGENT_KEY>  (minimal 24 karakter).
Hermes bertindak sebagai akun HERMES_AGENT_OWNER dengan ID + ROLE ASLI akun itu di database, jadi hak akses klien-nya
SAMA PERSIS dengan kalau pemilik login sendiri (BUKAN role "agent_hermes" seperti di kantor_tugas_route.py, yang tidak
punya id sehingga alat data akan menjawab "tidak punya akses ke klien mana pun").

Endpoint:
    GET  /api/hermes/alat                 -> daftar alat (format Claude) yang boleh dipakai Hermes
    POST /api/hermes/alat/{nama}          -> jalankan SATU alat: {"args": {...}, "client_id": "..."}  -> {"hasil": {...}}
    POST /api/hermes/chat                 -> otak Claude lengkap (alat data + memori + persona), balas {"jawaban": "..."}
                                             body: {"pesan": "...", "riwayat": [{"role","content"}], "client_id": null,
                                                    "agen": "neo|atlas|zeno", "sesi_id": "telegram-123"}

AGENTIC AI 3D REAL-TIME: saat Hermes memakai alat yang terkait satu halaman (Sales, Purchase, Journal Entry, Cash & Bank,
Other), agen yang diajak bicara (Neo / Atlas / Zeno) dicatat di tabel ai_tugas_kantor dan di Agentic AI 3D ia berjalan ke
mejanya. Frontend membaca tabel itu tiap 5 detik, jadi gerakannya terlihat di aplikasi yang sedang terbuka (HP/PC mana pun);
kalau aplikasi ditutup, posisinya tetap benar saat dibuka lagi (sampai tugas habis: 120 detik, atau selama pipeline file
berjalan). Agen dipilih dari field "agen", atau terdeteksi dari nama di pesan ("Atlas, cek penjualan"), default Neo.

Alat TULIS (proses_file_whatsapp: upload -> approve -> post otomatis) DIMATIKAN secara default lewat pintu ini.
Aktifkan dengan HERMES_TULIS_AKTIF=1 di .env backend kalau memang mau Hermes boleh memposting.

Pasang di main.py (setelah baris buat_router_kantor_tugas):
    from hermes_agent_route import buat_router_hermes
    app.include_router(buat_router_hermes(auth))
"""
import hmac
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text as sql_text

import akuntansi_ai as ak
import db_client as dbc
import memori_ai as mem
import neo_data_tools as neo
import voice_claude as vc
from chat_stream_route import PERSONA_AGEN
from modules.auth.core import ALLOW_ANONYMOUS_DEV, DEFAULT_USER_TANPA_LOGIN
from kantor_tugas_route import AGEN_VALID, _mulai as _mulai_tugas_kantor

logger = logging.getLogger("hermes_agent")

# [BARU -- AR/AP] AI ruang Account Receivable dan Account Payable (belum punya meja di Agentic AI 3D / tabel ai_tugas_kantor).
AGEN_AR = ("Kilo", "Lumen", "Matrix", "Nexus", "Omni")  # [DIUBAH] + AP: Nexus, Omni (juga belum punya meja 3D)

ALAT_TULIS = ("proses_file_whatsapp", "status_proses_file")
MAKS_TOKEN = int(os.environ.get("HERMES_MAX_TOKENS", "1500") or 1500)
CATATAN_KANAL = (
    "\n\n[KANAL: TELEGRAM (TEKS) lewat agen Hermes]\n"
    "Jawaban dibaca sebagai teks di chat, bukan didengar. Tetap ringkas dan akurat. Jangan mengarang angka: "
    "ambil dari alat data. Aksi tulis hanya boleh kalau alatnya tersedia dan pengguna jelas memintanya."
)


# [BARU -- INGATAN AGEN] Ingatan pribadi tiap AI dibaca dari tabel Supabase `ai_agen_ingatan` (satu baris per agen, kolom `isi`).
# Default hanya bagian inti (Identitas/Hierarki/Tugas/Batas + Catatan Tentang Aku) supaya prompt tidak membengkak: pengetahuan
# aplikasi global dan ingatan obrolan sudah dimuat oleh memori_ai (mem.siapkan_konteks). Set env AI_INGATAN_PENUH=1 untuk memuat
# seluruh isi (bisa >100 ribu karakter). Gagal baca DB tidak pernah menggagalkan chat. Cache 60 detik per agen.
_CACHE_INGATAN: Dict[str, Any] = {}
_BAGIAN_BESAR = ("[Pengetahuan Aplikasi]", "[Ingatan dari Obrolan dengan Pengguna]")


def _ingatan_agen(agen: str) -> str:
    kunci = (agen or "").strip().lower()
    if not kunci:
        return ""
    cache = _CACHE_INGATAN.get(kunci)
    if cache and time.time() - cache[0] < 60:
        return cache[1]
    hasil = ""
    try:
        sesi = dbc.SessionLocal()
        try:
            baris = sesi.execute(sql_text(
                "select isi from ai_agen_ingatan where agen = :a and aktif limit 1"), {"a": kunci}).first()
        finally:
            sesi.close()
        isi = (baris[0] if baris else "") or ""
        if isi and os.environ.get("AI_INGATAN_PENUH", "").strip() not in ("1", "true", "ya"):
            # potong bagian besar, tapi pertahankan [Catatan Tentang Aku] (ada di antara dua bagian besar)
            bagian = re.split(r"\n\n(?=\[[^\]\n]+\]\n?)", isi)
            isi = "\n\n".join(b for b in bagian if not b.startswith(_BAGIAN_BESAR))
        isi = isi[:int(os.environ.get("AI_INGATAN_MAKS", "12000") or 12000)]
        if isi:
            hasil = ("\n\n[INGATAN PRIBADIMU (dari database; ini identitas dan pengetahuanmu sendiri)]\n" + isi + "\n")
    except Exception as e:  # noqa: BLE001
        logger.warning("Ingatan agen '%s' gagal dibaca dari ai_agen_ingatan: %s", kunci, e)
    _CACHE_INGATAN[kunci] = (time.time(), hasil)
    return hasil


# alat -> id meja di Agentic AI (= HALAMAN_VALID di kantor_tugas_route.py)
_MEJA_ALAT = {"ringkasan_penjualan": "sales", "umur_piutang": "sales",
              "ringkasan_pembelian": "purchase", "jurnal_terakhir": "journal-entry"}
_MEJA_HALAMAN = {"sales": "sales", "purchase": "purchase", "journal_entry": "journal-entry",
                 "cash_bank": "bank-cash", "other": "other"}
_ALAT_BERHALAMAN = ("status_transaksi", "file_sumber", "daftar_exceptions")
_POLA_AGEN = re.compile(r"\b(neo|atlas|zeno|kilo|lumen|matrix|nexus|omni)\b", re.I)


def _pilih_agen(agen: Optional[str], pesan: str) -> str:
    """Nama agen (kapital seperti di AGEN_VALID): dari field `agen`, lalu dari nama di pesan, default Neo."""
    cocok = _POLA_AGEN.search(pesan or "")
    for kandidat in ((agen or "").strip(), cocok.group(1) if cocok else ""):
        if kandidat.capitalize() in AGEN_VALID or kandidat.capitalize() in AGEN_AR:
            return kandidat.capitalize()
    return "Neo"


def _meja_untuk(nama: str, args: Dict[str, Any]) -> Optional[str]:
    if nama in _MEJA_ALAT:
        return _MEJA_ALAT[nama]
    if nama in _ALAT_BERHALAMAN:
        return _MEJA_HALAMAN.get(str((args or {}).get("halaman") or ""))
    return None


class _NeoPantau:
    """Pembungkus modul neo_data_tools untuk voice_claude._stream_claude: setiap alat yang terkait satu halaman lebih dulu
    memerintahkan agen berjalan ke mejanya di Agentic AI 3D (tabel ai_tugas_kantor). Gagal mencatat tidak pernah menggagalkan alat."""

    def __init__(self, asli, pemilik: str, agen: str):
        self._asli, self._pemilik, self._agen = asli, pemilik, agen

    def __getattr__(self, nama):
        return getattr(self._asli, nama)

    def jalankan_alat(self, nama: str, args: Dict[str, Any], ctx) -> str:
        args = dict(args) if isinstance(args, dict) else {}
        if nama == "proses_file_whatsapp":
            if not args.get("agen") and self._agen not in AGEN_AR:
                args["agen"] = self._agen  # pipeline yang mengatur meja + laporan selesai
        else:
            meja = _meja_untuk(nama, args)
            if meja and self._agen not in AGEN_AR:
                try:
                    _mulai_tugas_kantor(self._pemilik, self._agen, meja, f"Hermes: {nama}"[:300])
                except Exception as e:  # noqa: BLE001
                    logger.warning("Hermes: gagal mencatat tugas Agentic AI (%s): %s", nama, e)
        return self._asli.jalankan_alat(nama, args, ctx)


class AlatRequest(BaseModel):
    args: Dict[str, Any] = {}
    client_id: Optional[str] = None


class PesanRiwayat(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    pesan: str
    riwayat: List[PesanRiwayat] = []
    client_id: Optional[str] = None
    agen: Optional[str] = None
    sesi_id: Optional[str] = None


def _tulis_aktif() -> bool:
    return os.environ.get("HERMES_TULIS_AKTIF", "0").strip().lower() in ("1", "true", "yes", "on")


def _alat_boleh() -> List[Dict[str, Any]]:
    """Alat format OpenAI (neo.TOOLS) yang boleh dipakai Hermes."""
    return [t for t in neo.TOOLS if _tulis_aktif() or t["function"]["name"] not in ALAT_TULIS]


def buat_router_hermes(auth) -> APIRouter:  # noqa: ARG001  (auth tidak dipakai: pintu ini pakai X-Agent-Key)
    router = APIRouter(tags=["hermes"])

    def _pemilik_hermes(x_agent_key: Optional[str] = Header(default=None, alias="X-Agent-Key")) -> Dict[str, Any]:
        kunci = os.getenv("HERMES_AGENT_KEY", "").strip()
        username = os.getenv("HERMES_AGENT_OWNER", "").strip()
        if not x_agent_key or len(kunci) < 24 or not username:
            raise HTTPException(status_code=401, detail="Kunci agen tidak valid.")
        if not hmac.compare_digest(x_agent_key.encode("utf-8"), kunci.encode("utf-8")):
            raise HTTPException(status_code=401, detail="Kunci agen tidak valid.")
        # Frontend-mu memanggil backend TANPA token (token login ada di cookie httpOnly, bukan localStorage), jadi backend
        # menganggap semua request aplikasi sebagai user mode-dev "dashboard-dev". Isi HERMES_AGENT_OWNER=dashboard-dev
        # supaya Hermes memakai identitas yang SAMA dengan aplikasi (tugas Agentic AI, memori AI, file WhatsApp).
        if username == DEFAULT_USER_TANPA_LOGIN["username"]:
            if not ALLOW_ANONYMOUS_DEV:
                raise HTTPException(status_code=403, detail="Mode dev tanpa login (ALLOW_ANONYMOUS_DEV) sedang mati.")
            return DEFAULT_USER_TANPA_LOGIN.copy()
        akun = dbc.get_user_by_username(username)
        if not akun or akun.get("aktif") is False:
            raise HTTPException(status_code=403, detail="Akun HERMES_AGENT_OWNER tidak ditemukan atau nonaktif.")
        return {"id": akun.get("id"), "username": akun.get("username"), "role": akun.get("role"), "nama": akun.get("nama")}

    @router.get("/api/hermes/alat")
    async def daftar_alat(user: dict = Depends(_pemilik_hermes)):
        skema = [{"name": t["function"]["name"], "description": t["function"]["description"],
                  "input_schema": t["function"]["parameters"]} for t in _alat_boleh()]
        return {"alat": skema, "tulis_aktif": _tulis_aktif()}

    @router.post("/api/hermes/alat/{nama}")
    async def jalankan(nama: str, body: AlatRequest, user: dict = Depends(_pemilik_hermes)):
        if nama not in {t["function"]["name"] for t in _alat_boleh()}:
            raise HTTPException(status_code=404, detail="Alat tidak tersedia untuk Hermes.")
        ctx = neo.Konteks(user, body.client_id)
        pantau = _NeoPantau(neo, mem.pemilik_dari_user(user), _pilih_agen(str(body.args.get("agen") or ""), ""))
        mentah = await run_in_threadpool(pantau.jalankan_alat, nama, body.args, ctx)
        try:
            return {"hasil": json.loads(mentah)}
        except Exception:  # noqa: BLE001
            return {"hasil": mentah}

    @router.post("/api/hermes/chat")
    async def chat(body: ChatRequest, user: dict = Depends(_pemilik_hermes)):
        if not vc.dikonfigurasi():
            raise HTTPException(status_code=503, detail="Claude belum dikonfigurasi (ANTHROPIC_API_KEY / VOICE_CLAUDE_AKTIF).")
        ucapan = (body.pesan or "").strip()
        if not ucapan:
            raise HTTPException(status_code=400, detail="Pesan kosong.")
        pemilik = mem.pemilik_dari_user(user)
        riwayat = [m.dict() for m in body.riwayat if m.role in ("user", "assistant")][-10:]
        agen = _pilih_agen(body.agen, ucapan)
        persona = (PERSONA_AGEN.get(agen.lower()) or "") + _ingatan_agen(agen)  # [DIUBAH] + ingatan pribadi dari Supabase

        def kerja() -> str:
            # [BARU -- KESADARAN TERPISAH] ingatan obrolan dibaca & ditulis per agen (Neo / Zeno / dst.), bukan gabungan
            agen_mem = (agen or "neo").strip().lower()[:20] or "neo"
            # [BARU] Riwayat dari bot Telegram TIDAK dipercaya (satu bot bisa melayani beberapa agen dengan satu daftar riwayat).
            # Riwayat jangka pendek dimuat dari database per agen; riwayat kiriman bot hanya dipakai bila memori AI mati.
            riwayat_agen = riwayat
            if mem.aktif():
                riwayat_agen = mem.riwayat_dari_giliran(mem.ambil_giliran_terakhir(pemilik, 0, 0, agen_mem))
            konteks = mem.siapkan_konteks(pemilik, ucapan, riwayat_agen, agen=agen_mem)
            system = (ak.buat_system_prompt_suara(dengan_data=True) + persona + CATATAN_KANAL
                      + konteks["tambahan_prompt"] + neo.blok_daftar_klien(user, body.client_id))
            # Alat tulis ikut disaring: _stream_claude memakai neo.TOOLS, jadi larang lewat `tanpa_alat`.
            larang = frozenset() if _tulis_aktif() else frozenset(ALAT_TULIS)
            # Claude SAJA (tanpa cadangan Groq/DeepSeek) supaya data klien tidak keluar ke pihak ketiga.
            potongan = list(vc._stream_claude(  # noqa: SLF001
                _NeoPantau(neo, pemilik, agen), ucapan, system, riwayat_agen, user, body.client_id, MAKS_TOKEN, True,
                gambar_b64=None, prefix_stabil="", data_prefetch="", tanpa_alat=larang,
            ))
            teks = "".join(potongan).strip()
            if teks:
                mem.setelah_jawaban(pemilik, "hermes", body.sesi_id, ucapan, teks, konteks["fakta_ids"], agen=agen_mem)
            return teks

        try:
            teks = await run_in_threadpool(kerja)
        except Exception as e:  # noqa: BLE001
            logger.warning("Hermes chat gagal: %s", e)
            raise HTTPException(status_code=502, detail="Claude tidak bisa menjawab saat ini.")
        return {"jawaban": teks}

    return router