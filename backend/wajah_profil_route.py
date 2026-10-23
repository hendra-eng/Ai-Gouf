"""
wajah_profil_route.py
=====================
Profil wajah pengguna untuk sapaan Neo, disimpan di DATABASE (bukan browser), jadi sama di semua browser/perangkat.

Yang disimpan per pengguna (satu baris per pemilik): nama panggilan + "embedding" wajah (128 angka per sampel,
dihitung di browser). FOTO TIDAK PERNAH DISIMPAN. Embedding dienkripsi (Fernet, modules/encryption.py) sebelum masuk DB,
dan tabel memakai Row Level Security seperti tabel memori AI. Usia / tanggal lahir tidak disimpan.

Pencocokan dilakukan di SERVER: browser mengirim satu embedding, server membandingkannya dengan profil milik pengguna
yang sedang login SAJA (1 lawan 1), lalu membalas {dikenali, nama}. Embedding tersimpan tidak pernah dikirim balik ke browser.

Endpoint (semua butuh login):
    GET    /api/wajah/status      -> {"ada": bool, "nama": str|null}
    PUT    /api/wajah/profil      -> simpan/ganti profil   body: {"nama": str, "embeddings": [[128 angka], ...]}
    POST   /api/wajah/cocokkan    -> body: {"embedding": [128 angka]} -> {"dikenali": bool, "nama": str|null}
    DELETE /api/wajah/profil      -> hapus profil milik pengguna ini

Hanya untuk MENYAPA. Jangan dipakai sebagai login/otorisasi.

Pasang di main.py:
    from wajah_profil_route import buat_router_wajah_profil
    app.include_router(buat_router_wajah_profil(auth))
Tabel dibuat otomatis saat endpoint pertama dipanggil (create_all), tidak perlu migration manual.
"""
import logging
import math
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import Session

import db_client as dbc
import memori_ai as mem
from modules.encryption import decrypt_data, encrypt_data

logger = logging.getLogger("wajah_profil")

PANJANG_EMBEDDING = 128
MAKS_SAMPEL = 12
AMBANG_JARAK = 0.5  # sama dengan frontend dulu; makin kecil makin ketat (standar face-api 0.6)


def _sekarang() -> datetime:
    return datetime.now(timezone.utc)


class WajahProfil(dbc.Base):
    __tablename__ = "ai_face_profiles"
    id = Column(Integer, primary_key=True, autoincrement=True)
    pemilik = Column(String(100), nullable=False, unique=True, index=True)  # sama dengan memori AI: username/id
    nama = Column(String(30), nullable=False)
    embeddings_terenkripsi = Column(Text, nullable=False)  # Fernet(JSON list of list[128 float])
    created_at = Column(DateTime(timezone=True), nullable=False, default=_sekarang)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_sekarang)


_tabel_siap = False
_kunci_tabel = threading.Lock()


def ensure_tabel() -> None:
    global _tabel_siap
    if _tabel_siap:
        return
    with _kunci_tabel:
        if _tabel_siap:
            return
        dbc.Base.metadata.create_all(dbc.engine, tables=[WajahProfil.__table__])
        if dbc.engine.dialect.name == "postgresql":
            try:
                with dbc.engine.begin() as conn:
                    conn.exec_driver_sql(f'ALTER TABLE "{WajahProfil.__tablename__}" ENABLE ROW LEVEL SECURITY')
            except Exception as e:  # noqa: BLE001
                logger.warning("Gagal ENABLE ROW LEVEL SECURITY untuk tabel profil wajah: %s", e)
        _tabel_siap = True


class SimpanProfilRequest(BaseModel):
    nama: str
    embeddings: List[List[float]]


class CocokkanRequest(BaseModel):
    embedding: List[float]


def _vektor_valid(v: List[float]) -> bool:
    return len(v) == PANJANG_EMBEDDING and all(isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 10 for x in v)


def _jarak(a: List[float], b: List[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _status(pemilik: str) -> Dict[str, Any]:
    ensure_tabel()
    with Session(dbc.engine) as s:
        baris = s.query(WajahProfil).filter(WajahProfil.pemilik == pemilik).first()
        return {"ada": bool(baris), "nama": baris.nama if baris else None}


def _simpan(pemilik: str, nama: str, embeddings: List[List[float]]) -> None:
    ensure_tabel()
    data = encrypt_data(embeddings)
    with Session(dbc.engine) as s:
        baris = s.query(WajahProfil).filter(WajahProfil.pemilik == pemilik).first()
        if baris:
            baris.nama, baris.embeddings_terenkripsi, baris.updated_at = nama, data, _sekarang()
        else:
            s.add(WajahProfil(pemilik=pemilik, nama=nama, embeddings_terenkripsi=data))
        s.commit()


def _cocokkan(pemilik: str, embedding: List[float]) -> Dict[str, Any]:
    ensure_tabel()
    with Session(dbc.engine) as s:
        baris = s.query(WajahProfil).filter(WajahProfil.pemilik == pemilik).first()
        if not baris:
            return {"dikenali": False, "nama": None}
        try:
            tersimpan = decrypt_data(baris.embeddings_terenkripsi)
        except Exception:  # noqa: BLE001 -- kunci enkripsi berubah / data rusak: anggap tidak cocok
            logger.warning("Profil wajah tidak bisa didekripsi (kunci berubah?)")
            return {"dikenali": False, "nama": None}
        jarak_valid = [_jarak(v, embedding) for v in tersimpan if _vektor_valid(v)]
        if not jarak_valid:  # semua vektor tersimpan rusak/tidak valid: anggap tidak cocok, jangan 500
            logger.warning("Profil wajah tidak punya vektor valid")
            return {"dikenali": False, "nama": None}
        terdekat = min(jarak_valid)
        return {"dikenali": terdekat < AMBANG_JARAK, "nama": baris.nama if terdekat < AMBANG_JARAK else None}


def _hapus(pemilik: str) -> None:
    ensure_tabel()
    with Session(dbc.engine) as s:
        s.query(WajahProfil).filter(WajahProfil.pemilik == pemilik).delete()
        s.commit()


def buat_router_wajah_profil(auth) -> APIRouter:
    router = APIRouter(tags=["wajah"])

    @router.get("/api/wajah/status")
    async def status(user: dict = Depends(auth.get_current_user)):
        return await run_in_threadpool(_status, mem.pemilik_dari_user(user))

    @router.put("/api/wajah/profil")
    async def simpan(body: SimpanProfilRequest, user: dict = Depends(auth.get_current_user)):
        nama = "".join(ch for ch in body.nama if ch >= " ").strip()[:30]
        if not nama:
            raise HTTPException(status_code=400, detail="Nama kosong.")
        if not (3 <= len(body.embeddings) <= MAKS_SAMPEL) or not all(_vektor_valid(v) for v in body.embeddings):
            raise HTTPException(status_code=400, detail="Data wajah tidak valid.")
        await run_in_threadpool(_simpan, mem.pemilik_dari_user(user), nama, body.embeddings)
        return {"ok": True, "sampel": len(body.embeddings)}

    @router.post("/api/wajah/cocokkan")
    async def cocokkan(body: CocokkanRequest, user: dict = Depends(auth.get_current_user)):
        if not _vektor_valid(body.embedding):
            raise HTTPException(status_code=400, detail="Data wajah tidak valid.")
        return await run_in_threadpool(_cocokkan, mem.pemilik_dari_user(user), body.embedding)

    @router.delete("/api/wajah/profil")
    async def hapus(user: dict = Depends(auth.get_current_user)):
        await run_in_threadpool(_hapus, mem.pemilik_dari_user(user))
        return {"ok": True}

    return router