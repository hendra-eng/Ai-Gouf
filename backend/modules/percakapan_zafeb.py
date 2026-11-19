"""
modules/percakapan_zafeb.py
===========================
Riwayat percakapan bubble Zake (src/components/ChatWidget.tsx), seperti ChatGPT/Claude:
setiap obrolan tersimpan di database, muncul di layar "Pesan" (tombol back di header chat),
dan bisa dibuka lagi.

Endpoint (kontrak dipakai frontend: src/app/zafeb-ai/lib/api.js):
    POST   /api/percakapan                 -> {id, judul}            buat obrolan baru
    GET    /api/percakapan                 -> {percakapan: [...]}    daftar obrolan milik user, terbaru dulu
    GET    /api/percakapan/{id}/pesan      -> {pesan: [...]}         isi satu obrolan (kronologis)
    POST   /api/percakapan/{id}/pesan      -> {tersimpan: n}         tambah pesan (dipakai jalur baca-gambar)
    DELETE /api/percakapan/{id}            -> {dihapus: true}

Penyimpanan pesan teks dilakukan otomatis oleh chat_zafeb.chat_stream lewat `simpan_pesan()`.

Aturan:
  - Obrolan hanya bisa dilihat/diubah/dihapus oleh pemiliknya (id user dari token).
  - Gagal menyimpan TIDAK boleh menggagalkan chat -> simpan_pesan() menelan error & mengembalikan False.
  - Tabel memakai nama baru `zake_percakapan` / `zake_pesan` (bukan `percakapan`/`pesan_chat`
    lama yang di-drop migrasi 23). Dibuat otomatis oleh db_client.init_db() saat startup,
    karena model ini terdaftar di Base begitu modul ini di-import.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

import db_client as dbc
from modules import auth

logger = logging.getLogger(__name__)
router = APIRouter(tags=["percakapan"])

JUDUL_DEFAULT = "Percakapan Baru"
MAKS_JUDUL = 60
MAKS_ISI_PESAN = 20000
MAKS_DAFTAR = 100
MAKS_PESAN_SEKALI_SIMPAN = 20
CUPLIKAN_PANJANG = 90


def _sekarang() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================
# MODEL
# ============================================================
class ZakePercakapan(dbc.Base):
    __tablename__ = "zake_percakapan"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    id_user = Column(String(128), nullable=False)  # pemilik: id user dari token (atau username)
    client_id = Column(String(64), nullable=True)   # client yang aktif saat obrolan dimulai
    judul = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_sekarang)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_sekarang)

    __table_args__ = (Index("ix_zake_percakapan_user_updated", "id_user", "updated_at"),)


class ZakePesan(dbc.Base):
    __tablename__ = "zake_pesan"

    # Integer di SQLite (autoincrement hanya jalan untuk INTEGER PK), BIGINT di PostgreSQL.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    percakapan_id = Column(
        PG_UUID(as_uuid=False),
        ForeignKey("zake_percakapan.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(16), nullable=False)  # "user" | "assistant"
    isi = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_sekarang)


# ============================================================
# HELPER
# ============================================================
def kunci_pemilik(user: Dict[str, Any]) -> str:
    """Identitas pemilik obrolan. Mode dev tanpa login punya id 0 -> jatuh ke username."""
    uid = user.get("id")
    if uid not in (None, "", 0):
        return str(uid)
    return str(user.get("username") or "anonim")


def id_valid(percakapan_id: Any) -> Optional[str]:
    """Normalisasi id percakapan ke string UUID; None kalau kosong/tidak valid."""
    if percakapan_id in (None, "", 0):
        return None
    try:
        return str(uuid.UUID(str(percakapan_id)))
    except (ValueError, AttributeError, TypeError):
        return None


def _judul_dari_pesan(teks: str) -> str:
    satu_baris = " ".join((teks or "").split())
    if len(satu_baris) <= MAKS_JUDUL:
        return satu_baris or JUDUL_DEFAULT
    return satu_baris[: MAKS_JUDUL - 1].rstrip() + "…"


def _cuplikan(teks: str) -> str:
    satu_baris = " ".join((teks or "").split())
    return satu_baris if len(satu_baris) <= CUPLIKAN_PANJANG else satu_baris[: CUPLIKAN_PANJANG - 1].rstrip() + "…"


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _tambah_pesan(session, perc: ZakePercakapan, pesan: List[Dict[str, str]]) -> int:
    n = 0
    for m in pesan:
        role = m.get("role")
        isi = str(m.get("content") or "").strip()[:MAKS_ISI_PESAN]
        if role not in ("user", "assistant") or not isi:
            continue
        session.add(ZakePesan(percakapan_id=perc.id, role=role, isi=isi, created_at=_sekarang()))
        if role == "user" and (not perc.judul or perc.judul == JUDUL_DEFAULT):
            perc.judul = _judul_dari_pesan(isi)
        n += 1
    if n:
        perc.updated_at = _sekarang()
    return n


def simpan_pesan(percakapan_id: Any, user: Dict[str, Any], role: str, isi: str) -> bool:
    """Simpan satu pesan ke obrolan milik `user`. Tidak pernah melempar error (chat tidak
    boleh gagal gara-gara riwayat). Return True kalau tersimpan."""
    pid = id_valid(percakapan_id)
    if not pid or not (isi or "").strip():
        return False
    session = None
    try:
        session = dbc.SessionLocal()  # membuka sesi pun bisa gagal (DB mati) -> ikut ditelan
        perc = session.get(ZakePercakapan, pid)
        if perc is None or perc.id_user != kunci_pemilik(user):
            return False
        n = _tambah_pesan(session, perc, [{"role": role, "content": isi}])
        session.commit()
        return n > 0
    except Exception:  # noqa: BLE001
        logger.warning("Gagal menyimpan pesan percakapan %s", pid, exc_info=True)
        if session is not None:
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass
        return False
    finally:
        if session is not None:
            session.close()


def _ambil_milik(session, percakapan_id: str, user: Dict[str, Any]) -> ZakePercakapan:
    pid = id_valid(percakapan_id)
    perc = session.get(ZakePercakapan, pid) if pid else None
    # 404 (bukan 403) supaya keberadaan obrolan milik orang lain tidak bocor
    if perc is None or perc.id_user != kunci_pemilik(user):
        raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan.")
    return perc


# ============================================================
# ENDPOINT
# ============================================================
class BuatPercakapanRequest(BaseModel):
    client_id: Optional[str] = None
    judul: Optional[str] = None


class PesanItem(BaseModel):
    role: str
    content: str = Field(..., min_length=1)


class TambahPesanRequest(BaseModel):
    pesan: List[PesanItem] = Field(..., min_length=1, max_length=MAKS_PESAN_SEKALI_SIMPAN)


@router.post("/api/percakapan")
def buat_percakapan(body: BuatPercakapanRequest, user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        perc = ZakePercakapan(
            id_user=kunci_pemilik(user),
            client_id=str(body.client_id) if body.client_id else None,
            judul=(body.judul or "").strip()[:255] or JUDUL_DEFAULT,
        )
        session.add(perc)
        session.commit()
        return {"id": perc.id, "judul": perc.judul}
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Gagal membuat percakapan")
        raise HTTPException(status_code=500, detail="Gagal membuat percakapan baru.")
    finally:
        session.close()


@router.get("/api/percakapan")
def daftar_percakapan(
    client_id: Optional[str] = Query(None),
    jalur: Optional[str] = Query(None),  # dikirim frontend ("client"); belum dibedakan di sini
    user: dict = Depends(auth.get_current_user),
):
    session = dbc.SessionLocal()
    try:
        q = session.query(ZakePercakapan).filter(ZakePercakapan.id_user == kunci_pemilik(user))
        # Obrolan dipisah per client (konteks datanya beda) -- sama dengan perilaku widget,
        # yang memulai obrolan baru tiap client aktif diganti.
        q = q.filter(ZakePercakapan.client_id == str(client_id)) if client_id else q.filter(ZakePercakapan.client_id.is_(None))
        # Obrolan kosong (dibuat tapi belum ada pesan) tidak perlu tampil di riwayat.
        ada_pesan = session.query(ZakePesan.percakapan_id).filter(ZakePesan.percakapan_id == ZakePercakapan.id).exists()
        baris = q.filter(ada_pesan).order_by(ZakePercakapan.updated_at.desc()).limit(MAKS_DAFTAR).all()

        terakhir: Dict[str, str] = {}
        if baris:
            ids = [b.id for b in baris]
            id_pesan_akhir = (
                session.query(func.max(ZakePesan.id))
                .filter(ZakePesan.percakapan_id.in_(ids))
                .group_by(ZakePesan.percakapan_id)
                .subquery()
            )
            for pid, isi in (
                session.query(ZakePesan.percakapan_id, ZakePesan.isi)
                .filter(ZakePesan.id.in_(session.query(id_pesan_akhir)))
                .all()
            ):
                terakhir[pid] = isi

        return {
            "percakapan": [
                {
                    "id": b.id,
                    "judul": b.judul or JUDUL_DEFAULT,
                    "diperbarui_pada": _iso(b.updated_at),
                    "dibuat_pada": _iso(b.created_at),
                    "pesan_terakhir": _cuplikan(terakhir.get(b.id, "")) or None,
                }
                for b in baris
            ]
        }
    finally:
        session.close()


@router.get("/api/percakapan/{percakapan_id}/pesan")
def pesan_percakapan(percakapan_id: str, user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        perc = _ambil_milik(session, percakapan_id, user)
        rows = session.query(ZakePesan).filter(ZakePesan.percakapan_id == perc.id).order_by(ZakePesan.id.asc()).all()
        return {
            "id": perc.id,
            "judul": perc.judul or JUDUL_DEFAULT,
            "pesan": [{"role": r.role, "content": r.isi, "created_at": _iso(r.created_at)} for r in rows],
        }
    finally:
        session.close()


@router.post("/api/percakapan/{percakapan_id}/pesan")
def tambah_pesan(percakapan_id: str, body: TambahPesanRequest, user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        perc = _ambil_milik(session, percakapan_id, user)
        n = _tambah_pesan(session, perc, [{"role": p.role, "content": p.content} for p in body.pesan])
        session.commit()
        return {"tersimpan": n}
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Gagal menambah pesan percakapan")
        raise HTTPException(status_code=500, detail="Gagal menyimpan pesan.")
    finally:
        session.close()


@router.delete("/api/percakapan/{percakapan_id}")
def hapus_percakapan(percakapan_id: str, user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        perc = _ambil_milik(session, percakapan_id, user)
        # hapus pesan eksplisit (tidak bergantung pada ON DELETE CASCADE di semua dialect)
        session.query(ZakePesan).filter(ZakePesan.percakapan_id == perc.id).delete(synchronize_session=False)
        session.delete(perc)
        session.commit()
        return {"dihapus": True}
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Gagal menghapus percakapan")
        raise HTTPException(status_code=500, detail="Gagal menghapus percakapan.")
    finally:
        session.close()
