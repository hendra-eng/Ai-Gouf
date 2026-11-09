"""
profil_agen_db.py
=================
Kesadaran tiap AI (Neo / Atlas / Zeno, dan AI lain) tentang DIRINYA SENDIRI, dibaca dari database Supabase:

  - ai_agen_daftar   : nama, wujud, ruangan, bagian (jabatan), atasan, halaman kerja, skill, catatan
  - ai_agen_ingatan  : ingatan pribadi (Identitas, Hierarki, Catatan Tentang Aku, dan Pengetahuan Aplikasi yang panjang)
  - ai_tugas_kantor  : tugas yang SEDANG berjalan (agen ini dan rekan-rekannya)

Dipakai chat_stream_route.py (suara di halaman Agentic AI) supaya tiap AI tahu tugas, bagian, atasan, rekan, halaman
kerja, dan tugas yang sedang berjalan, serta mendapat rincian halaman kerjanya (diambil dari ingatan pribadinya, hanya
baris yang nyambung dengan ucapan pengguna, supaya prompt tidak membengkak).

blok_agen(agen, pemilik, ucapan) -> (profil, pengetahuan)
    profil      : blok singkat (selalu dipakai)
    pengetahuan : rincian halaman kerja yang relevan dengan ucapan ("" kalau tidak ada yang nyambung)
Gagal baca database TIDAK PERNAH menggagalkan chat: hasilnya tetap string (mungkin kosong).
"""
import logging
import os
import re
import time
from typing import Any, Dict, List, Tuple

from sqlalchemy import text as sql_text

import db_client as dbc

logger = logging.getLogger("profil_agen_db")

_TTL_STATIS = 60.0   # detik: data profil + ingatan hampir tidak berubah
_TTL_TUGAS = 8.0     # detik: tugas berjalan lebih sering berubah
_cache_statis: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_cache_tugas: Dict[Tuple[str, str], Tuple[float, List[Dict[str, Any]]]] = {}

_BAGIAN_BESAR = ("[Pengetahuan Aplikasi]", "[Ingatan dari Obrolan dengan Pengguna]")

# path halaman kerja (kolom halaman_kerja) -> nama yang enak diucapkan
_NAMA_HALAMAN = {
    "/transactions/sales": "Sales",
    "/transactions/purchase": "Purchase",
    "/transactions/journal-entry": "Journal Entry",
    "/transactions/bank-cash": "Cash & Bank",
    "/transactions/other": "Other",
}
# id meja di ai_tugas_kantor.halaman -> nama
_NAMA_MEJA = {"sales": "Sales", "purchase": "Purchase", "journal-entry": "Journal Entry", "bank-cash": "Cash & Bank", "other": "Other"}

# kata kunci tiap halaman, untuk memilih baris Pengetahuan Aplikasi yang relevan
_KATA_HALAMAN = {
    "sales": ("sales", "penjualan", "invoice"),
    "purchase": ("purchase", "pembelian", "bill", "vendor"),
    "journal": ("journal", "jurnal"),
    "cash": ("cash", "bank", "kas", "rekening"),
    "other": ("other",),
}
_STOP = {
    "yang", "dan", "atau", "ini", "itu", "kamu", "aku", "saya", "tolong", "dengar", "dengan", "untuk", "dari", "pada", "apa",
    "bagaimana", "kenapa", "mengapa", "bisa", "tidak", "sudah", "belum", "mau", "ada", "adalah", "juga", "lagi", "dong", "ya",
    "nih", "deh", "halaman", "jelaskan", "ceritakan", "kerjaan", "tugas", "tugasmu", "kerjaanmu", "bagian", "bagianmu",
}


def _rapikan_atasan(atasan: str) -> str:
    a = (atasan or "").strip()
    if not a:
        return ""
    if a.lower() == "owner":
        return "owner (pemilik perusahaan)"
    return a.capitalize()


def _muat_statis(kode: str) -> Dict[str, Any]:
    cache = _cache_statis.get(kode)
    if cache and time.time() - cache[0] < _TTL_STATIS:
        return cache[1]
    data: Dict[str, Any] = {}
    try:
        sesi = dbc.SessionLocal()
        try:
            d = sesi.execute(sql_text(
                "select nama, hewan, ruangan, bagian, atasan, halaman_kerja, skill, catatan "
                "from ai_agen_daftar where kode = :a and aktif limit 1"), {"a": kode}).mappings().first()
            if d:
                data["daftar"] = dict(d)
                rekan = sesi.execute(sql_text(
                    "select nama, bagian from ai_agen_daftar where ruangan = :r and kode <> :a and aktif order by id"),
                    {"r": d["ruangan"], "a": kode}).all()
                data["rekan"] = [(r[0], r[1]) for r in rekan]
            ing = sesi.execute(sql_text(
                "select isi from ai_agen_ingatan where agen = :a and aktif limit 1"), {"a": kode}).first()
            data["isi"] = (ing[0] if ing else "") or ""
        finally:
            sesi.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("Profil agen '%s' gagal dibaca dari database: %s", kode, e)
    _cache_statis[kode] = (time.time(), data)
    return data


def _muat_tugas(pemilik: str) -> List[Dict[str, Any]]:
    kunci = (pemilik or "", "tugas")
    cache = _cache_tugas.get(kunci)
    if cache and time.time() - cache[0] < _TTL_TUGAS:
        return cache[1]
    baris: List[Dict[str, Any]] = []
    try:
        sesi = dbc.SessionLocal()
        try:
            hasil = sesi.execute(sql_text(
                "select lower(agen) as agen, halaman, deskripsi from ai_tugas_kantor "
                "where pemilik = :p and status = 'berjalan' and berakhir_at > now()"), {"p": pemilik}).mappings().all()
            baris = [dict(h) for h in hasil]
        finally:
            sesi.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("Tugas berjalan gagal dibaca dari ai_tugas_kantor: %s", e)
    _cache_tugas[kunci] = (time.time(), baris)
    return baris


def _bagian_ingatan(isi: str) -> List[str]:
    return re.split(r"\n\n(?=\[[^\]\n]+\]\n?)", isi or "")


# Catatan Tentang Aku dibuat otomatis dari obrolan lama, jadi baris yang menyebut keadaan SESAAT ("sedang", "diarahkan", ...)
# bisa sudah basi. Keadaan sekarang hanya diambil dari ai_tugas_kantor (di profil), bukan dari baris-baris ini.
_POLA_SESAAT = re.compile(r"\b(sedang|saat ini|diarahkan|perintahkan|menanyakan|mengucapkan|kata kunci)\b", re.I)


def _catatan_tentang_aku(isi: str) -> str:
    for b in _bagian_ingatan(isi):
        if b.startswith("[Catatan Tentang Aku]"):
            baris = [x.strip() for x in b.splitlines()[1:] if x.strip().startswith("- ") and not _POLA_SESAAT.search(x)]
            return "\n".join(baris)[:1500]
    return ""


def _inti_identitas(isi: str) -> str:
    for b in _bagian_ingatan(isi):
        if b.startswith("[Identitas]"):
            return b.strip()[:1200]
    return ""


def _token(ucapan: str) -> List[str]:
    kata = re.findall(r"[a-z0-9&]+", (ucapan or "").lower())
    return [k for k in dict.fromkeys(kata) if len(k) >= 4 and k not in _STOP]


def _pengetahuan_relevan(isi: str, ucapan: str, maks_karakter: int, maks_baris: int) -> str:
    """Baris '- ...' dari [Pengetahuan Aplikasi] milik agen ini yang paling nyambung dengan ucapan (bobot lebih untuk nama halaman)."""
    token = _token(ucapan)
    if not token:
        return ""
    kata_halaman = [k for ks in _KATA_HALAMAN.values() for k in ks if k in (ucapan or "").lower()]
    sumber: List[str] = []
    for b in _bagian_ingatan(isi):
        if b.startswith("[Pengetahuan Aplikasi]"):
            sumber = [x.strip() for x in b.splitlines()[1:] if x.strip().startswith("- ")]
            break
    nilai: List[Tuple[int, int, str]] = []
    for i, baris in enumerate(sumber):
        low = baris.lower()
        skor = sum(2 for t in token if t in low) + sum(3 for k in kata_halaman if k in low)
        if skor >= 3:
            nilai.append((skor, -i, baris))
    nilai.sort(reverse=True)
    hasil: List[str] = []
    total = 0
    for _, _, baris in nilai[:maks_baris]:
        if total + len(baris) > maks_karakter:
            break
        hasil.append(baris)
        total += len(baris)
    if not hasil:
        return ""
    return ("\n\n[RINCIAN HALAMAN KERJAKU (dari ingatan pribadiku di database; pakai ini untuk menjawab, jangan mengarang)]\n"
            + "\n".join(hasil))


def blok_agen(agen: str, pemilik: str, ucapan: str = "") -> Tuple[str, str]:
    kode = (agen or "").strip().lower()
    if not kode:
        return "", ""
    data = _muat_statis(kode)
    d = data.get("daftar")
    if not d:
        return "", ""

    halaman = [_NAMA_HALAMAN.get(p, p) for p in (d.get("halaman_kerja") or [])]
    skill = ", ".join(d.get("skill") or [])
    rekan = data.get("rekan") or []
    tugas = _muat_tugas(pemilik)
    milikku = [t for t in tugas if t["agen"] == kode]
    tugas_rekan = [t for t in tugas if t["agen"] != kode]

    baris = ["\n\n[PROFIL & TUGASKU (dari database; ini fakta tentang dirimu, bukan karangan)]"]
    baris.append(
        f"- Namaku {d['nama']}; wujudku {d.get('hewan') or '-'}; ruanganku {d.get('ruangan') or '-'}; "
        f"bagianku (jabatan) {d.get('bagian') or '-'}; atasanku {_rapikan_atasan(d.get('atasan')) or '-'}."
    )
    if rekan:
        baris.append("- Rekan satu ruanganku: " + ", ".join(f"{n} ({b})" for n, b in rekan) + ".")
    if halaman:
        baris.append(
            "- Halaman kerjaku: " + ", ".join(halaman) + ". Tiap halaman punya tab Overview, Source Data, Transaction, "
            "Journal Preview, Exceptions, dan Posted (alur: Source Data -> Transaction -> Journal Preview -> Exceptions -> Posted; "
            "hanya jurnal Posted yang masuk ke General Ledger dan laporan)."
        )
    if skill:
        baris.append(f"- Skill yang kumiliki: {skill}.")
    if d.get("catatan"):
        baris.append(f"- Catatan tentang peranku: {str(d['catatan']).strip()[:600]}")
    inti = _inti_identitas(data.get("isi", ""))
    if inti:
        baris.append("- Identitas & hierarki dari ingatan pribadiku: " + inti.replace("\n", " "))
    catatan = _catatan_tentang_aku(data.get("isi", ""))
    if catatan:
        baris.append("- Catatan tentang aku (dari obrolan lama):\n" + catatan)

    if milikku:
        t = milikku[0]
        baris.append(
            f"- SAAT INI aku sedang bertugas di meja {_NAMA_MEJA.get(t['halaman'], t['halaman'])}"
            + (f" ({str(t['deskripsi']).strip()[:160]})" if t.get("deskripsi") else "") + "."
        )
    else:
        baris.append("- SAAT INI aku tidak sedang mengerjakan tugas di meja halaman mana pun (kalau ditanya, jawab jujur begitu).")
    if tugas_rekan:
        baris.append("- Rekan yang sedang bertugas: " + ", ".join(
            f"{t['agen'].capitalize()} di meja {_NAMA_MEJA.get(t['halaman'], t['halaman'])}" for t in tugas_rekan) + ".")
    baris.append(
        "- Kalau pengguna menanyakan tugas, bagian, atasan, rekan, halaman kerja, atau apa yang sedang kukerjakan, jawab dari fakta "
        "di atas dengan singkat dan runtut. Jangan mengarang tugas yang tidak tercantum; kalau memang tidak tahu, bilang jujur."
    )
    profil = "\n".join(baris)

    pengetahuan = _pengetahuan_relevan(
        data.get("isi", ""), ucapan,
        int(os.environ.get("AI_RINCIAN_MAKS", "4500") or 4500), int(os.environ.get("AI_RINCIAN_BARIS", "10") or 10),
    )
    return profil, pengetahuan