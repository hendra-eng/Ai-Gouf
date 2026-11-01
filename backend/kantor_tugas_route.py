"""
kantor_tugas_route.py
=====================
Tugas agen Agentic AI 3D (Neo / Atlas / Zeno) disimpan di DATABASE (tabel ai_tugas_kantor), bukan di browser.
Monitor meja menyala & agen duduk di meja kerja HANYA kalau ada baris status='berjalan' yang belum lewat waktu.
Refresh / keluar-masuk aplikasi / ganti perangkat tidak me-reset apa pun: posisi dihitung ulang dari tabel ini.

Endpoint (semua butuh login, per pemilik):
    GET    /api/kantor-tugas              -> {"tugas": {"Neo": {"halaman": "journal-entry", "sisa_ms": 91000, "mulai_ms_lalu": 29000} | null, ...}}
    PUT    /api/kantor-tugas/{agen}       -> body {"halaman": "journal-entry", "deskripsi": "..."}; 409 kalau halaman dipakai agen lain
    DELETE /api/kantor-tugas/{agen}       -> tugas selesai/dibatalkan, agen kembali ke meja rapat

Pasang di main.py:
    from kantor_tugas_route import buat_router_kantor_tugas
    app.include_router(buat_router_kantor_tugas(auth))
Tabel dibuat lewat migration `create_ai_tugas_kantor` (sudah ada di Supabase).
"""
import hmac
import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text

import db_client as dbc
import memori_ai as mem

logger = logging.getLogger("kantor_tugas")

AGEN_VALID = ("Neo", "Atlas", "Zeno")
HALAMAN_VALID = ("sales", "purchase", "journal-entry", "bank-cash", "other")  # = HALAMAN_MEJA di src/lib/tugasKantor.ts
DURASI_KERJA_DETIK = 120  # = DURASI_KERJA_MS di tugasKantor.ts
# Browser boleh ditutup selama tugas berjalan, jadi heartbeat TIDAK dipakai untuk mematikan tugas; hanya berakhir_at.
# Angka ini cuma pengaman terakhir kalau berakhir_at entah bagaimana rusak.
STALE_DETIK = 86400


class MulaiRequest(BaseModel):
    halaman: str
    deskripsi: Optional[str] = None


class ProsesFileRequest(BaseModel):
    halaman: str                       # id meja: sales | purchase | journal-entry | bank-cash | other
    klien: str                         # kode / nama klien, WAJIB (Neo tidak menebak klien)
    nama_mengandung: Optional[str] = None


# id meja (Agentic AI) -> kunci halaman di neo_wa_pipeline.py
HALAMAN_PIPELINE = {"sales": "sales", "purchase": "purchase", "journal-entry": "journal_entry",
                    "bank-cash": "cash_bank", "other": "other"}
# Tugas dari pipeline file WhatsApp memegang meja selama prosesnya berjalan (bukan 120 detik seperti tugas "cek halaman").
# Sama dengan MENIT_BASI di neo_wa_pipeline.py: lewat ini proses dianggap macet.
DURASI_PIPELINE_DETIK = 1800
_POLA_LAPORAN = re.compile(r"^\[WA:(ok|sebagian|gagal)(?::([A-Za-z0-9_\-]+))?\]\s*(.*)$", re.S)


def _reap(conn, pemilik: str) -> None:
    conn.execute(text("select ai_tugas_kantor_reap(:p, :s)"), {"p": pemilik, "s": STALE_DETIK})


def _daftar(pemilik: str) -> Dict[str, Any]:
    with dbc.engine.begin() as conn:
        _reap(conn, pemilik)
        baris = conn.execute(text("""
            select agen, halaman,
                   greatest(0, floor(extract(epoch from (berakhir_at - now())) * 1000))::bigint as sisa_ms,
                   greatest(0, floor(extract(epoch from (now() - mulai_at)) * 1000))::bigint as mulai_ms_lalu
              from ai_tugas_kantor
             where pemilik = :p and status = 'berjalan'
        """), {"p": pemilik}).mappings().all()
    hasil: Dict[str, Any] = {a: None for a in AGEN_VALID}
    for b in baris:
        hasil[b["agen"]] = {"halaman": b["halaman"], "sisa_ms": int(b["sisa_ms"]), "mulai_ms_lalu": int(b["mulai_ms_lalu"])}
    return {"tugas": hasil}


def _mulai(pemilik: str, agen: str, halaman: str, deskripsi: Optional[str]) -> Dict[str, Any]:
    with dbc.engine.begin() as conn:
        _reap(conn, pemilik)
        # satu meja hanya boleh dipakai satu agen
        pakai = conn.execute(text("""
            select agen from ai_tugas_kantor
             where pemilik = :p and status = 'berjalan' and halaman = :h and agen <> :a limit 1
        """), {"p": pemilik, "h": halaman, "a": agen}).first()
        if pakai:
            return {"ok": False, "pemakai": pakai[0]}
        ada = conn.execute(text("""
            update ai_tugas_kantor
               set berakhir_at = greatest(berakhir_at, now() + make_interval(secs => :d)), heartbeat_at = now()
             where pemilik = :p and agen = :a and status = 'berjalan' and halaman = :h
         returning id
        """), {"p": pemilik, "a": agen, "h": halaman, "d": DURASI_KERJA_DETIK}).first()
        if not ada:
            # pindah halaman / tugas baru: tutup tugas lama agen ini, lalu mulai yang baru
            conn.execute(text("""
                update ai_tugas_kantor set status = 'dibatalkan', selesai_at = now()
                 where pemilik = :p and agen = :a and status = 'berjalan'
            """), {"p": pemilik, "a": agen})
            conn.execute(text("""
                insert into ai_tugas_kantor (pemilik, agen, halaman, deskripsi, berakhir_at)
                values (:p, :a, :h, :desk, now() + make_interval(secs => :d))
            """), {"p": pemilik, "a": agen, "h": halaman, "desk": deskripsi, "d": DURASI_KERJA_DETIK})
    return {"ok": True}


def _selesai(pemilik: str, agen: str) -> None:
    with dbc.engine.begin() as conn:
        conn.execute(text("""
            update ai_tugas_kantor set status = 'selesai', selesai_at = now()
             where pemilik = :p and agen = :a and status = 'berjalan'
        """), {"p": pemilik, "a": agen})


# ---------------------------------------------------------------------------------------------------------------------
# Tugas dari pipeline file WhatsApp (neo_wa_pipeline.py): agen berjalan ke meja halaman, bekerja sampai file diposting,
# lalu kembali ke meja rapat. Hasilnya dititipkan di kolom `deskripsi` baris tugas (tanpa migrasi database):
#   berjalan : "[WA] ..."          selesai : "[WA:ok|sebagian|gagal:KODE] <ringkasan satu-dua kalimat>"
# Frontend membacanya lewat GET /api/kantor-tugas/laporan lalu Neo mengumumkannya sekali.
# ---------------------------------------------------------------------------------------------------------------------
def mulai_tugas_wa(pemilik: str, agen: str, halaman: str, deskripsi: str) -> Dict[str, Any]:
    """Agen duduk di meja `halaman` selama pipeline. Return {"ok": True, "id": ...} atau {"ok": False, "pemakai": agen_lain}."""
    with dbc.engine.begin() as conn:
        _reap(conn, pemilik)
        pakai = conn.execute(text("""
            select agen from ai_tugas_kantor
             where pemilik = :p and status = 'berjalan' and halaman = :h and agen <> :a limit 1
        """), {"p": pemilik, "h": halaman, "a": agen}).first()
        if pakai:
            return {"ok": False, "pemakai": pakai[0]}
        conn.execute(text("""
            update ai_tugas_kantor set status = 'dibatalkan', selesai_at = now()
             where pemilik = :p and agen = :a and status = 'berjalan'
        """), {"p": pemilik, "a": agen})
        baris = conn.execute(text("""
            insert into ai_tugas_kantor (pemilik, agen, halaman, deskripsi, berakhir_at)
            values (:p, :a, :h, :desk, now() + make_interval(secs => :d))
            returning id::text
        """), {"p": pemilik, "a": agen, "h": halaman, "desk": ("[WA] " + deskripsi)[:300], "d": DURASI_PIPELINE_DETIK}).first()
    return {"ok": True, "id": baris[0]}


def batalkan_tugas_wa(pemilik: str, tugas_id: str) -> None:
    """Proses ternyata tidak jadi dimulai (tidak ada file, level kurang, dst): lepaskan meja tanpa laporan."""
    with dbc.engine.begin() as conn:
        conn.execute(text("""
            update ai_tugas_kantor set status = 'dibatalkan', selesai_at = now(), deskripsi = null
             where id::text = :i and pemilik = :p and status = 'berjalan'
        """), {"i": str(tugas_id), "p": pemilik})


def akhiri_tugas_wa(pemilik: str, tugas_id: str, kode: str, klien: Optional[str], ringkasan: str) -> None:
    """Pipeline selesai: agen pulang ke meja rapat (status -> selesai) dan ringkasan disimpan untuk diumumkan Neo."""
    kode = kode if kode in ("ok", "sebagian", "gagal") else "gagal"
    tanda = f"[WA:{kode}:{klien}]" if klien else f"[WA:{kode}]"
    with dbc.engine.begin() as conn:
        conn.execute(text("""
            update ai_tugas_kantor
               set status = case when status = 'berjalan' then 'selesai' else status end,
                   selesai_at = coalesce(selesai_at, now()),
                   deskripsi = :d
             where id::text = :i and pemilik = :p
        """), {"i": str(tugas_id), "p": pemilik, "d": f"{tanda} {ringkasan}"[:300]})


def _laporan(pemilik: str, menit: int) -> List[Dict[str, Any]]:
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select id::text as id, agen, halaman, deskripsi,
                   greatest(0, floor(extract(epoch from (now() - coalesce(selesai_at, now()))) * 1000))::bigint as ms_lalu
              from ai_tugas_kantor
             where pemilik = :p and left(deskripsi, 4) = '[WA:'
               and coalesce(selesai_at, now()) > now() - make_interval(mins => :m)
             order by selesai_at desc nulls last limit 10
        """), {"p": pemilik, "m": menit}).mappings().all()
    hasil: List[Dict[str, Any]] = []
    for b in baris:
        m = _POLA_LAPORAN.match(b["deskripsi"] or "")
        if not m:
            continue
        hasil.append({"id": b["id"], "agen": b["agen"], "halaman": b["halaman"], "hasil": m.group(1),
                      "klien": m.group(2), "ringkasan": m.group(3).strip(), "ms_lalu": int(b["ms_lalu"])})
    return hasil


def _bersihkan_pesan(pesan: str) -> str:
    """Pesan dari neo_wa_pipeline ditulis untuk model ('Katakan itu apa adanya', 'Minta pengguna ...'); di sini dibaca manusia."""
    pesan = (pesan or "").replace(" Katakan itu apa adanya.", "")
    return pesan.replace("Minta pengguna mengirim filenya.", "Kirim filenya ke WhatsApp dulu.")


def _proses_file(user: Dict[str, Any], agen: str, halaman_meja: str, klien: str, nama: Optional[str]) -> Dict[str, Any]:
    import neo_data_tools as ndt
    import neo_wa_pipeline as pipa
    from whatsapp_masuk_route import pemilik_wa
    if not pipa.aktif():
        return {"ok": False, "pesan": "Fitur proses file otomatis sedang dimatikan di server."}
    k, err = ndt.Konteks(user, None).pilih(klien)
    if err:
        return {"ok": False, "pesan": _bersihkan_pesan(err.get("error") or "Klien tidak dikenal.")}
    hasil = pipa.mulai(user, k, pemilik_wa(mem.pemilik_dari_user(user)), (nama or "").strip() or None,
                       halaman=HALAMAN_PIPELINE[halaman_meja], agen=agen)
    if hasil.get("error"):
        return {"ok": False, "pesan": _bersihkan_pesan(hasil["error"])}
    if hasil.get("status") == "nama_ambigu":
        return {"ok": False, "pesan": "Ada beberapa file yang cocok: " + "; ".join(hasil.get("kandidat") or []) + ". Sebut nama yang lebih lengkap."}
    if hasil.get("status") == "sudah_berjalan":
        return {"ok": False, "pesan": "File itu sedang diproses. Tunggu sampai selesai."}
    if hasil.get("meja_dipakai"):
        return {"ok": False, "pesan": f"Meja {halaman_meja} sedang dipakai {hasil['meja_dipakai']}.", "pemakai": hasil["meja_dipakai"]}
    return {"ok": True, "klien": k.get("client_code"), "halaman": halaman_meja, "file_lain_menunggu": hasil.get("file_lain_menunggu", 0)}


def buat_router_kantor_tugas(auth) -> APIRouter:
    router = APIRouter(tags=["kantor-tugas"])
    _bearer = HTTPBearer(auto_error=False)

    def _user_atau_agen(
        x_agent_key: Optional[str] = Header(default=None, alias="X-Agent-Key"),
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    ) -> Dict[str, Any]:
        """[BARU] Pintu untuk agen Hermes (Telegram): header X-Agent-Key = HERMES_AGENT_KEY di .env backend, bertindak
        sebagai akun HERMES_AGENT_OWNER. HANYA dipakai di GET daftar, PUT mulai, DELETE selesai (tidak untuk proses-file).
        Tanpa header itu, perilaku lama (Bearer token login) tidak berubah."""
        if x_agent_key is not None:
            kunci = os.getenv("HERMES_AGENT_KEY", "").strip()
            pemilik = os.getenv("HERMES_AGENT_OWNER", "").strip()
            if len(kunci) >= 24 and pemilik and hmac.compare_digest(x_agent_key.encode("utf-8"), kunci.encode("utf-8")):
                return {"username": pemilik, "role": "agent_hermes"}
            raise HTTPException(status_code=401, detail="Kunci agen tidak valid.")
        return auth.get_current_user(credentials)

    def _cek_agen(agen: str) -> str:
        if agen not in AGEN_VALID:
            raise HTTPException(status_code=400, detail="Agen tidak dikenal.")
        return agen

    @router.get("/api/kantor-tugas")
    async def daftar(user: dict = Depends(_user_atau_agen)):
        return await run_in_threadpool(_daftar, mem.pemilik_dari_user(user))

    @router.put("/api/kantor-tugas/{agen}")
    async def mulai(agen: str, body: MulaiRequest, user: dict = Depends(_user_atau_agen)):
        _cek_agen(agen)
        if body.halaman not in HALAMAN_VALID:
            raise HTTPException(status_code=400, detail="Halaman tidak dikenal.")
        deskripsi = (body.deskripsi or "").strip()[:300] or None
        hasil = await run_in_threadpool(_mulai, mem.pemilik_dari_user(user), agen, body.halaman, deskripsi)
        if not hasil["ok"]:
            raise HTTPException(status_code=409, detail={"pemakai": hasil["pemakai"]})
        return hasil

    @router.post("/api/kantor-tugas/{agen}/proses-file")
    async def proses_file(agen: str, body: ProsesFileRequest, user: dict = Depends(auth.get_current_user)):
        """Agen memproses file WhatsApp terbaru: berjalan ke mejanya, upload -> buat transaksi -> Approve -> Post (di background),
        lalu pulang ke meja rapat. Aturan level, hak akses klien, dan validasi posting SAMA dengan alat `proses_file_whatsapp` Neo."""
        _cek_agen(agen)
        if body.halaman not in HALAMAN_PIPELINE:
            raise HTTPException(status_code=400, detail="Halaman tidak dikenal.")
        if not (body.klien or "").strip():
            return {"ok": False, "pesan": "Klien belum disebut."}
        return await run_in_threadpool(_proses_file, user, agen, body.halaman, body.klien, body.nama_mengandung)

    @router.get("/api/kantor-tugas/file-belum-diupload")
    async def file_belum_diupload(user: dict = Depends(auth.get_current_user)):
        """[BARU] File WhatsApp yang tersimpan tapi belum berhasil diupload/diposting (dengan nama), untuk dibacakan Neo."""
        from whatsapp_masuk_route import daftar_file_belum_upload
        file = await run_in_threadpool(daftar_file_belum_upload, mem.pemilik_dari_user(user), 20)
        return {"file": [{"nama": f["nama_file"], "lisan": f["lisan"], "menit_lalu": int(f.get("menit_lalu") or 0), "status": f["status"]} for f in file]}

    @router.get("/api/kantor-tugas/laporan")
    async def laporan(menit: int = 30, user: dict = Depends(auth.get_current_user)):
        """Laporan tugas file WhatsApp yang baru selesai (untuk diumumkan Neo). Frontend mengingat id yang sudah diumumkan."""
        return {"laporan": await run_in_threadpool(_laporan, mem.pemilik_dari_user(user), max(1, min(menit, 240)))}

    @router.delete("/api/kantor-tugas/{agen}")
    async def selesai(agen: str, user: dict = Depends(_user_atau_agen)):
        _cek_agen(agen)
        await run_in_threadpool(_selesai, mem.pemilik_dari_user(user), agen)
        return {"ok": True}

    return router