"""
whatsapp_masuk_route.py
=======================
Mencatat FILE yang masuk ke nomor WhatsApp pengguna, supaya Neo (Agentic AI) sadar ada file masuk.
Tahap awal: hanya METADATA (pengirim, nama file, jenis, ukuran, waktu). Isi file belum diproses / disimpan.

Endpoint:
    POST /api/whatsapp/fonnte?kunci=<WA_WEBHOOK_SECRET>  -> URL webhook yang ditempel di Fonnte (Device -> Edit -> Webhook)
    POST /api/whatsapp/masuk        -> bentuk umum (header X-WA-Secret = env WA_WEBHOOK_SECRET), untuk tes / konektor lain
    GET  /api/whatsapp/file-masuk   -> daftar file masuk terbaru milik user yang login

ATURAN: yang dicatat HANYA file yang DITERIMA, yaitu dikirim oleh nomor LAIN ke nomor WhatsApp pemilik. Pesan yang pengirimnya
nomor pemilik sendiri (nomor device Fonnte, atau ditandai fromMe) diabaikan: tidak dicatat, jadi tidak masuk database dan
tidak terbaca Neo/AI.

Env backend/.env:
    WA_WEBHOOK_SECRET=<string acak panjang>
    WA_PEMILIK=<username aplikasi pemilik nomor WhatsApp itu>
    WA_NOMOR=<opsional: nomor WhatsApp pemilik, pisahkan koma kalau lebih dari satu; format 08.. atau 628..>

Pasang di main.py:
    from whatsapp_masuk_route import buat_router_wa_masuk
    app.include_router(buat_router_wa_masuk(auth))
Tabel: migrations/whatsapp/create_wa_file_masuk.sql
"""
import hashlib
import hmac
import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text

import db_client as dbc
import memori_ai as mem

logger = logging.getLogger("whatsapp_masuk")


def _normal_nomor(v: Any) -> str:
    """Hanya digit, awalan 0 -> 62 (081927506969 dan 6281927506969 dianggap sama). '@lid'/'@s.whatsapp.net' dibuang."""
    d = "".join(ch for ch in str(v or "").split("@")[0] if ch.isdigit())
    if d.startswith("0"):
        d = "62" + d[1:]
    return d


def _nomor_pemilik(d: Optional[Dict[str, Any]] = None) -> set:
    """Nomor milik pemilik: dari env WA_NOMOR + field 'device'/'username' di payload Fonnte (= nomor device yang tersambung)."""
    n = {_normal_nomor(x) for x in os.environ.get("WA_NOMOR", "").split(",")}
    if d:
        n |= {_normal_nomor(d.get("device")), _normal_nomor(d.get("username"))}
    n.discard("")
    return n


def _dari_pemilik_sendiri(d: Dict[str, Any]) -> bool:
    """True kalau pesan ini dikirim oleh pemilik sendiri (bukan diterima dari orang lain)."""
    if str(d.get("fromMe") or d.get("from_me") or "").lower() in ("1", "true", "yes"):
        return True
    pengirim = _normal_nomor(d.get("sender") or d.get("pengirim"))
    return bool(pengirim) and pengirim in _nomor_pemilik(d)


def _id_pesan(d: Dict[str, Any]) -> Optional[str]:
    """ID unik pesan untuk cegah dobel. Fonnte sering mengirim inboxid=0 (tidak unik), jadi kalau id kosong/0 dipakai sidik jari
    dari link file (unik per file) atau, kalau tidak ada, dari pengirim + waktu + nama file. Kiriman ulang (retry) = id sama."""
    asli = str(d.get("inboxid") or d.get("id") or "").strip()
    if asli and asli != "0":
        return asli
    bahan = str(d.get("url") or "") or "|".join(str(d.get(k) or "") for k in ("sender", "timestamp", "filename"))
    if not bahan.strip("|"):
        return None
    return "fonnte:" + hashlib.sha1(bahan.encode("utf-8")).hexdigest()


class FileMasuk(BaseModel):
    pengirim: Optional[str] = None
    nama_file: Optional[str] = None
    mime: Optional[str] = None
    ukuran_byte: Optional[int] = None
    pesan: Optional[str] = None
    message_id: Optional[str] = None
    url_file: Optional[str] = None  # [BARU] link file dari Fonnte, dipakai Neo untuk memproses isi file


def _simpan(pemilik: str, b: FileMasuk) -> Optional[int]:
    """Return id baris baru, atau None kalau pesan itu sudah pernah dicatat."""
    with dbc.engine.begin() as conn:
        r = conn.execute(text("""
            insert into wa_file_masuk (pemilik, pengirim, nama_file, mime, ukuran_byte, pesan, wa_message_id, url_file)
            values (:p, :pg, :nf, :mi, :uk, :ps, :mid, :url)
            on conflict (wa_message_id) do nothing
            returning id
        """), {"p": pemilik, "pg": (b.pengirim or "")[:40] or None, "nf": (b.nama_file or "")[:255] or None,
               "mi": (b.mime or "")[:100] or None, "uk": b.ukuran_byte, "ps": (b.pesan or "")[:500] or None,
               "mid": (b.message_id or "")[:200] or None, "url": (b.url_file or "")[:2000] or None}).first()
    return r[0] if r is not None else None


_JENIS_KATA = [
    ("penjualan", ("sales", "penjualan", "customer", "pelanggan")),
    ("pembelian", ("purchase", "pembelian", "vendor", "supplier")),
    ("rekening koran", ("bank", "rekening", "mutasi", "statement")),
    ("jurnal", ("jurnal", "journal")),
]
_JENIS_EKSTENSI = {
    "jpg": "gambar", "jpeg": "gambar", "png": "gambar", "webp": "gambar",
    "pdf": "dokumen PDF", "xlsx": "file spreadsheet", "xls": "file spreadsheet", "csv": "file spreadsheet",
}


def jenis_file(nama: Optional[str], ekstensi: Optional[str]) -> str:
    """Jenis file dari kata kunci di nama file (penjualan, pembelian, ...); kalau tidak ketemu, dari ekstensi. Nama file tidak dibacakan."""
    n = (nama or "").lower()
    for jenis, kata in _JENIS_KATA:
        if any(k in n for k in kata):
            return jenis
    return _JENIS_EKSTENSI.get((ekstensi or "").lower().lstrip("."), "file")


def ringkas_file(file: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Kelompokkan per jenis: [{"jenis": "penjualan", "jumlah": 1, "menit_terbaru": 6}], tanpa nama file."""
    grup: Dict[str, Dict[str, Any]] = {}
    for f in file:
        j = jenis_file(f.get("nama_file"), f.get("mime"))
        menit = int(f.get("menit_lalu") or 0)
        g = grup.setdefault(j, {"jenis": j, "jumlah": 0, "menit_terbaru": menit})
        g["jumlah"] += 1
        g["menit_terbaru"] = min(g["menit_terbaru"], menit)
    return sorted(grup.values(), key=lambda g: g["menit_terbaru"])


# Dipakai alat Neo `file_whatsapp_masuk` (neo_data_tools.py): "ada file apa saja" vs "file yang tadi kukirim sudah masuk belum".
JAM_RIWAYAT = 24 * 30   # riwayat yang dibaca: 30 hari
MENIT_BARU = 10         # file yang masuk dalam 10 menit terakhir dianggap BARU (baru saja dikirim); sisanya LAMA


def teks_lalu(menit: int) -> str:
    """Menit -> teks lisan: 'baru saja', '5 menit lalu', '2 jam lalu', '3 hari lalu'."""
    m = max(int(menit or 0), 0)
    if m < 1:
        return "baru saja"
    if m < 60:
        return f"{m} menit lalu"
    if m < 60 * 24:
        return f"{m // 60} jam lalu"
    return f"{m // (60 * 24)} hari lalu"


def pisah_baru_lama(file: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pisahkan daftar file (kunci 'menit_lalu') jadi BARU (<= MENIT_BARU menit) dan LAMA, masing-masing diringkas per jenis
    tanpa nama file. Angka total dihitung dari file, bukan dari ringkasan."""
    baru = [f for f in file if int(f.get("menit_lalu") or 0) <= MENIT_BARU]
    lama = [f for f in file if int(f.get("menit_lalu") or 0) > MENIT_BARU]
    return {
        "jumlah_total": len(file),
        "jumlah_baru": len(baru),
        "jumlah_lama": len(lama),
        "baru": ringkas_file(baru),
        "lama": ringkas_file(lama),
    }


# Saat server jalan tanpa login (mode dev), user dianggap "dashboard-dev"/"anon", bukan pemilik nomor WhatsApp.
# Untuk kasus itu, daftar file dibaca atas nama WA_PEMILIK (pemilik nomor WhatsApp).
_PEMILIK_TANPA_LOGIN = ("dashboard-dev", "anon")


def pemilik_wa(pemilik_user: str) -> str:
    wa = os.environ.get("WA_PEMILIK", "").strip()
    if wa and pemilik_user in _PEMILIK_TANPA_LOGIN:
        return wa
    return pemilik_user


def daftar_file_masuk(pemilik: str, jam: int = 24, batas: int = 10) -> List[Dict[str, Any]]:
    pemilik_asli = pemilik
    pemilik = pemilik_wa(pemilik)
    hasil = _ambil_file_masuk(pemilik, jam, batas)
    if not hasil:  # tolong diagnosa: tampilkan pemilik yang dipakai saat daftar kosong
        logger.warning("wa daftar KOSONG pemilik_login=%r pemilik_dipakai=%r WA_PEMILIK=%r",
                       pemilik_asli, pemilik, os.environ.get("WA_PEMILIK", ""))
    return hasil


def _ambil_file_masuk(pemilik: str, jam: int, batas: int) -> List[Dict[str, Any]]:
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select nama_file, mime, ukuran_byte, pengirim, pesan, diterima_at, status_proses,
                   floor(extract(epoch from (now() - diterima_at)) / 60)::int as menit_lalu
              from wa_file_masuk
             where pemilik = :p and diterima_at > now() - make_interval(hours => :j)
             order by diterima_at desc limit :b
        """), {"p": pemilik, "j": jam, "b": batas}).mappings().all()
    return [dict(b) for b in baris]


# [BARU] File yang SUDAH tersimpan tetapi BELUM berhasil diupload/diposting ("file apa yang kamu pegang tapi belum diupload?").
# Himpunannya sama dengan file yang diambil neo_wa_pipeline._mulai_inti: baru, gagal, perlu_template (boleh dicoba lagi setelah
# template dibuat), atau 'diproses' yang macet (> MENIT_MACET menit). Hanya CSV/Excel/PDF karena hanya itu yang bisa diproses.
MENIT_MACET = 30


def nama_lisan(nama: Optional[str]) -> str:
    """'Penjualan_Okt-2026.xlsx' -> 'Penjualan Okt 2026' (tanpa ekstensi, enak dibacakan)."""
    n = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", nama or "")
    n = re.sub(r"[_\-.]+", " ", n)
    return re.sub(r"\s+", " ", n).strip()[:70]


def daftar_file_belum_upload(pemilik: str, batas: int = 20) -> List[Dict[str, Any]]:
    """Terbaru dulu. Kunci: nama_file (asli), lisan, status, menit_lalu. Nama file SENGAJA ikut (pengguna memintanya)."""
    pemilik = pemilik_wa(pemilik)
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select id, nama_file, coalesce(status_proses, 'baru') as status,
                   floor(extract(epoch from (now() - diterima_at)) / 60)::int as menit_lalu
              from wa_file_masuk
             where pemilik = :p and diterima_at > now() - make_interval(hours => :j)
               and (coalesce(status_proses, 'baru') in ('baru', 'gagal', 'perlu_template')
                    or (status_proses = 'diproses' and proses_mulai_at < now() - make_interval(mins => :m)))
               and lower(coalesce(nama_file, '')) ~ '\\.(csv|xlsx|xls|pdf)$'
             order by diterima_at desc limit :b
        """), {"p": pemilik, "j": JAM_RIWAYAT, "m": MENIT_MACET, "b": batas}).mappings().all()
    hasil = []
    for b in baris:
        d = dict(b)
        d["lisan"] = nama_lisan(d.get("nama_file"))
        hasil.append(d)
    return hasil


# [BARU] Cari file WhatsApp berdasarkan NAMA yang diucapkan pengguna (semua status: belum diproses, sedang, selesai, gagal).
# Pencocokan tidak peduli huruf besar/kecil, spasi, garis bawah, atau ekstensi: "data penjualan wsi" cocok dengan "Data_Penjualan_WSI.xlsx".
STATUS_LISAN = {
    None: "belum diproses", "baru": "belum diproses", "diproses": "sedang diproses", "selesai": "sudah diproses",
    "selesai_sebagian": "sudah diproses sebagian (ada yang tidak terposting)", "gagal": "pernah dicoba tapi gagal",
    "perlu_template": "menunggu template kolom",
}


def _norm_cari(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def cari_file_nama(pemilik: str, kata: str, batas: int = 8) -> List[Dict[str, Any]]:
    """File WhatsApp (30 hari terakhir) yang namanya cocok dengan kata yang diucapkan. Terbaik dulu: persis > semua kata > sebagian kata."""
    pemilik = pemilik_wa(pemilik)
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select id, nama_file, status_proses, client_id, source_file_id,
                   floor(extract(epoch from (now() - diterima_at)) / 60)::int as menit_lalu
              from wa_file_masuk
             where pemilik = :p and diterima_at > now() - make_interval(hours => :j) and nama_file is not null
             order by diterima_at desc limit 300
        """), {"p": pemilik, "j": JAM_RIWAYAT}).mappings().all()
    kunci = _norm_cari(re.sub(r"\.[A-Za-z0-9]{2,5}$", "", kata or ""))
    token = [t for t in re.split(r"[^a-z0-9]+", (kata or "").lower()) if t]
    hasil: List[Dict[str, Any]] = []
    for b in baris:
        n = _norm_cari(b["nama_file"])
        if kunci and kunci in n:
            skor, cocok = 3, "persis"
        elif token and all(t in n for t in token):
            skor, cocok = 2, "semua kata cocok"
        elif len(token) >= 3 and sum(t in n for t in token) >= -(-2 * len(token) // 3):
            skor, cocok = 1, "sebagian kata cocok"
        else:
            continue
        d = dict(b)
        d.update({"skor": skor, "cocok": cocok, "lisan": nama_lisan(b["nama_file"]), "status_lisan": STATUS_LISAN.get(b["status_proses"], str(b["status_proses"]))})
        hasil.append(d)
    hasil.sort(key=lambda x: (-x["skor"], x["menit_lalu"]))
    return hasil[:batas]


def _unduh_isi(wa_id: int, url: Optional[str], nama: Optional[str]) -> None:
    try:
        from neo_wa_pipeline import simpan_isi_dari_url
        simpan_isi_dari_url(wa_id, url, nama)
    except Exception as e:  # noqa: BLE001
        logger.warning("wa unduh isi id=%s gagal: %s", wa_id, e)


def buat_router_wa_masuk(auth) -> APIRouter:
    router = APIRouter(tags=["whatsapp"])

    @router.post("/api/whatsapp/masuk")
    async def masuk(body: FileMasuk, background: BackgroundTasks, x_wa_secret: str = Header(default="")):
        rahasia = os.environ.get("WA_WEBHOOK_SECRET", "")
        pemilik = os.environ.get("WA_PEMILIK", "").strip()
        if not rahasia or not pemilik:
            raise HTTPException(status_code=503, detail="WhatsApp belum dikonfigurasi di server.")
        if not hmac.compare_digest(x_wa_secret.encode(), rahasia.encode()):
            raise HTTPException(status_code=401, detail="Rahasia salah.")
        if _dari_pemilik_sendiri({"pengirim": body.pengirim}):  # hanya file dari nomor lain yang diterima
            return {"ok": True, "abaikan": "dikirim pemilik sendiri"}
        id_baru = await run_in_threadpool(_simpan, pemilik, body)
        baru = id_baru is not None
        logger.info("wa file masuk nama=%s baru=%s", body.nama_file, baru)
        if baru and body.url_file:
            background.add_task(_unduh_isi, id_baru, body.url_file, body.nama_file)
        return {"ok": True, "baru": baru}

    @router.post("/api/whatsapp/fonnte")
    async def fonnte(request: Request, background: BackgroundTasks, kunci: str = ""):
        rahasia = os.environ.get("WA_WEBHOOK_SECRET", "")
        pemilik = os.environ.get("WA_PEMILIK", "").strip()
        if not rahasia or not pemilik:
            raise HTTPException(status_code=503, detail="WhatsApp belum dikonfigurasi di server.")
        if not hmac.compare_digest(kunci.encode(), rahasia.encode()):
            raise HTTPException(status_code=401, detail="Kunci salah.")
        try:
            d = await request.json()
        except Exception:  # noqa: BLE001  (Fonnte juga bisa kirim form)
            d = dict(await request.form())
        if isinstance(d, dict):  # bantu tes paket Free: lihat field apa saja yang Fonnte kirim
            logger.info("fonnte webhook kolom=%s pesan=%r", sorted(d.keys()), str(d.get("message") or "")[:100])
        if isinstance(d, dict):  # [BARU] catat isi payload non-teks apa adanya (tanpa rahasia) untuk diagnosa
            _tipe = str(d.get("type") or d.get("messageType") or "").lower()
            if d.get("url") or d.get("filename") or d.get("extension") or _tipe not in ("", "text"):
                logger.info("fonnte payload non-teks: %s", {k: str(v)[:80] for k, v in d.items() if k not in ("message",)})
        # [DIUBAH] Dulu: tanpa field "url" -> dibuang sebagai "bukan file", sehingga file yang dikirim tanpa link
        # (mis. paket Free) tidak pernah tercatat dan Neo bilang tidak ada file. Sekarang file tetap dicatat (metadata)
        # selama ada tanda file: url, filename, extension, atau type bukan teks. Isinya baru bisa diunduh kalau ada url.
        _tipe = str((d or {}).get("type") or (d or {}).get("messageType") or "").lower() if isinstance(d, dict) else ""
        ada_tanda_file = isinstance(d, dict) and bool(d.get("url") or d.get("filename") or d.get("extension") or _tipe not in ("", "text"))
        if not ada_tanda_file:
            return {"ok": True, "abaikan": "bukan file"}  # pesan teks biasa tidak dicatat
        if _dari_pemilik_sendiri(d):  # hanya file dari nomor LAIN yang diterima; kiriman pemilik sendiri dibuang
            logger.info("fonnte file diabaikan: dikirim pemilik sendiri")
            return {"ok": True, "abaikan": "dikirim pemilik sendiri"}
        nama = str(d.get("filename") or "").strip()
        ext = str(d.get("extension") or "").strip().lstrip(".")
        if ext and not nama.lower().endswith("." + ext.lower()):
            nama = f"{nama or 'file'}.{ext}"
        b = FileMasuk(pengirim=str(d.get("sender") or ""), nama_file=nama or None, mime=ext or None,
                      pesan=str(d.get("message") or "") or None,
                      message_id=_id_pesan(d), url_file=str(d.get("url") or "") or None)
        id_baru = await run_in_threadpool(_simpan, pemilik, b)
        baru = id_baru is not None
        if baru and b.url_file:  # [BARU] simpan salinan isi file di server supaya Neo bisa memprosesnya (link Fonnte bisa kedaluwarsa)
            background.add_task(_unduh_isi, id_baru, b.url_file, nama)
        logger.info("fonnte file masuk nama=%s baru=%s", nama, baru)
        return {"ok": True, "baru": baru}

    @router.get("/api/whatsapp/file-masuk")
    async def daftar(user: dict = Depends(auth.get_current_user)):
        return {"file": await run_in_threadpool(daftar_file_masuk, mem.pemilik_dari_user(user))}

    return router