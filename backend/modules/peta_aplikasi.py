"""
modules/peta_aplikasi.py
========================
Pengetahuan Zake tentang aplikasi (halaman, komponen, tombol, tab, hak akses).

Sumber data: data/peta_aplikasi.json, dibuat OTOMATIS dari kode frontend oleh
`python scripts/buat_peta_aplikasi.py`. Jalankan ulang script itu setiap ada
halaman/tombol baru -- file JSON dibaca ulang otomatis begitu berubah (tanpa restart).

Strategi prompt (supaya Zake "paham 100%" tapi hemat token):
  1. INDEKS  (selalu ada, ±6-8 ribu token, di-cache Anthropic): jumlah halaman, menu,
     hak akses per role, komponen global, dan satu baris per halaman.
  2. DETAIL  (dinamis, per pertanyaan): daftar lengkap komponen + SEMUA tombol/tab/link/isian
     untuk halaman yang paling relevan (halaman yang sedang dibuka user + hasil pencocokan
     kata kunci pertanyaan).
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PATH_JSON = Path(__file__).resolve().parent.parent / "data" / "peta_aplikasi.json"
MAKS_HALAMAN_DETAIL = 3
MAKS_KARAKTER_DETAIL = 24000

_cache: Dict[str, Any] = {"mtime": None, "data": None}

# Padanan istilah sehari-hari (Indonesia) -> kata yang ada di nama menu/route.
SINONIM = {
    "penjualan": ["sales", "invoice"], "jual": ["sales"], "pembelian": ["purchase", "bill"],
    "beli": ["purchase"], "piutang": ["receivable"], "hutang": ["payable"], "utang": ["payable"],
    "labarugi": ["profit", "loss"], "laba": ["profit", "loss"], "rugi": ["profit", "loss"],
    "neraca": ["balance", "sheet"], "aruskas": ["cash", "flow"], "arus": ["cash", "flow"],
    "kas": ["cash", "bank"], "bank": ["bank", "cash"], "rekening": ["bank", "cash"],
    "jurnal": ["journal"], "aset": ["assets", "fixed"], "persediaan": ["inventory"],
    "stok": ["inventory"], "pajak": ["tax"], "anggaran": ["budget"], "gaji": ["payroll"],
    "pengaturan": ["settings"], "pengguna": ["users"], "user": ["users"], "kurs": ["exchange", "fx"],
    "valas": ["fx"], "tutup": ["closing", "year-end"], "akun": ["coa"], "perusahaan": ["company", "clients"],
    "klien": ["clients"], "dokumen": ["documents"], "audit": ["audit"], "ekuitas": ["equity"],
    "modal": ["equity"], "kewajiban": ["liabilities"], "liabilitas": ["liabilities"],
    "laporan": ["reports", "statements"], "anggaran": ["budget"], "saldo": ["opening", "balances"],
    "rekonsiliasi": ["reconciliation"], "mapping": ["mapping"], "pemetaan": ["mapping"],
    "catatan": ["notes"], "analis": ["analyst", "analytics"], "analitik": ["analytics"],
    "memori": ["memori"], "agen": ["agentic"], "ekspor": ["export"], "impor": ["import"],
    "cetak": ["print"], "faktur": ["invoice"], "tagihan": ["bill", "invoice"],
}
STOP = set("yang dan di ke dari untuk apa ada itu ini saya aku kamu bisa cara bagaimana gimana berapa "
           "semua setiap tolong jelaskan sebutkan tombol halaman menu aplikasi fungsi fungsinya apakah "
           "dengan atau pada dalam saat sedang buka membuka lihat melihat kalau jika kenapa mengapa dong sih "
           "the and for what how page button".split())


# --------------------------------------------------------------------------- muat
def muat() -> Optional[Dict[str, Any]]:
    """Baca JSON peta (di-cache; otomatis dibaca ulang kalau file berubah)."""
    try:
        mtime = PATH_JSON.stat().st_mtime
    except OSError:
        return None
    if _cache["mtime"] != mtime:
        try:
            _cache["data"] = json.loads(PATH_JSON.read_text(encoding="utf-8"))
            _cache["mtime"] = mtime
        except Exception:  # noqa: BLE001
            logger.warning("Gagal membaca %s", PATH_JSON, exc_info=True)
            return None
    return _cache["data"]


# --------------------------------------------------------------------------- format
def _fmt_tombol(t: Dict[str, Any]) -> str:
    extra: List[str] = []
    if t.get("tujuan"):
        extra.append("→ " + t["tujuan"])
    if t.get("tipe") == "submit":
        extra.append("submit form")
    if t.get("nonaktif"):
        extra.append("bisa nonaktif sesuai kondisi")
    return f"- {t['label']}" + (f" ({'; '.join(extra)})" if extra else "")


def teks_halaman(h: Dict[str, Any]) -> str:
    """Detail LENGKAP satu halaman."""
    judul = h.get("menu") or (h["judul"][0] if h.get("judul") else h["rute"])
    L = [f"### `{h['rute']}` — {judul}"]
    L.append(f"Grup menu: {h['grup_menu']}" if h.get("grup_menu")
             else "Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).")
    if h.get("catatan"):
        L.append(f"Catatan: {h['catatan']}")
    if h.get("judul"):
        L.append("Judul/seksi di halaman: " + "; ".join(h["judul"]))
    if h.get("tab"):
        L.append("Tab di halaman (termasuk tab di panel detail): " + "; ".join(h["tab"]))
    if h.get("label_lain"):
        L.append("Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): " + "; ".join(h["label_lain"]))
    if h.get("komponen"):
        L.append(f"Komponen ({len(h['komponen'])}): " + ", ".join(h["komponen"]))
    if h.get("hak_akses"):
        L.append("Pembatasan hak akses di halaman ini: " + "; ".join(h["hak_akses"]))
    if h.get("tombol"):
        L.append(f"Tombol/aksi ({len(h['tombol'])}):")
        L.extend(_fmt_tombol(t) for t in h["tombol"])
    if h.get("link"):
        L.append("Link ke halaman lain: " + "; ".join(
            (f"{l['label']} → {l['href']}" if l.get("label") else l["href"]) for l in h["link"][:25]))
    if h.get("field"):
        L.append("Isian/filter: " + "; ".join(h["field"][:30]))
    return "\n".join(L)


def _baris_indeks(h: Dict[str, Any]) -> str:
    nama = h.get("menu") or (h["judul"][0] if h.get("judul") else "")
    bagian = [f"`{h['rute']}`" + (f" {nama}" if nama else "")]
    if h.get("tab"):
        bagian.append("tab: " + ", ".join(h["tab"][:8]))
    bagian.append(f"{len(h.get('tombol', []))} tombol")
    if h.get("catatan"):
        bagian.append("(" + h["catatan"] + ")")
    return "- " + " | ".join(bagian)


def _teks_umum(d: Dict[str, Any]) -> List[str]:
    r = d["ringkas"]
    tambahan = [h for h in d["halaman"] if not h.get("menu")]
    L = [
        "## Ringkasan angka (dihitung dari kode)",
        f"- Total halaman (URL): {r['jumlah_halaman']}, terdiri dari {len(d['halaman']) - len(tambahan)} halaman yang "
        f"ada di menu sidebar dan {len(tambahan)} halaman tambahan (form baru, pratinjau, exceptions, posted, dst.) "
        f"yang dibuka dari tombol/tab di halaman lain.",
        f"- Entri menu sidebar: {r['jumlah_menu']} dalam {r['jumlah_grup_menu']} grup.",
        f"- File komponen UI (.tsx): {r['jumlah_file_tsx']}.",
        f"- Tag <button> di source code: {r.get('jumlah_tag_button', '?')}. Entri tombol berlabel yang tercatat per halaman: "
        f"{r['total']['tombol']} (komponen bersama seperti tabel/modal dihitung di tiap halaman yang memakainya); "
        f"link antarhalaman: {r['total']['link']}.",
        "",
        "## Menu sidebar (urutan tampil)",
    ]
    g = None
    for m in d["menu"]:
        if m["grup"] != g:
            g = m["grup"]
            L.append(f"**{g}**")
        L.append(f"{'  - ' if m.get('anak') else '- '}{m['label']} → `{m['href']}`")
    L += ["", "## Hak akses per role (tombol bisa nonaktif/tersembunyi sesuai level)"]
    for p in d.get("peran", []):
        L.append(f"- {p['role']} = level {p['level']}: {p['label']}")
    for nama, arti in d.get("arti_level", {}).items():
        if nama in d.get("nilai_level", {}):
            L.append(f"- Aksi level {d['nilai_level'][nama]}+ ({nama}): {arti}")
    L += ["", "## Komponen global (ada di semua halaman)", "Tombol/aksi global: " + "; ".join(d["global"]["tombol"])]
    return L


def teks_indeks(d: Dict[str, Any]) -> str:
    L = ["# PETA APLIKASI DASHBOARDORI (sumber kebenaran, dibuat otomatis dari kode)", ""]
    L += _teks_umum(d)
    L += ["", "## Indeks semua halaman (route | tab | jumlah tombol)"]
    L += [_baris_indeks(h) for h in d["halaman"]]
    return "\n".join(L)


def teks_lengkap(d: Dict[str, Any]) -> str:
    """Seluruh peta (untuk file .md yang dibaca manusia)."""
    L = ["# PETA APLIKASI DASHBOARDORI (dibuat otomatis dari kode)",
         f"Dibuat: {d['ringkas']['dibuat']}. Jangan diedit manual; jalankan `python scripts/buat_peta_aplikasi.py`.", ""]
    L += _teks_umum(d)
    L += ["", "## Daftar halaman (satu per satu)", ""]
    for h in d["halaman"]:
        L.append(teks_halaman(h))
        L.append("")
    return "\n".join(L)


# --------------------------------------------------------------------------- pemilihan
def cocokkan_rute(d: Dict[str, Any], path: Optional[str]) -> Optional[str]:
    """Ubah path nyata (/coa/12/edit) ke pola route di peta (/coa/:id/edit)."""
    if not path:
        return None
    path = path.split("?")[0].split("#")[0].rstrip("/") or "/"
    for h in d["halaman"]:
        if h["rute"] == path:
            return h["rute"]
    for h in d["halaman"]:
        if ":" in h["rute"]:
            pola = "^" + re.sub(r":[^/]+", "[^/]+", h["rute"]) + "$"
            if re.match(pola, path):
                return h["rute"]
    return None



def _token(teks: str) -> List[str]:
    out: List[str] = []
    for w in re.findall(r"[a-z0-9]+", teks.lower()):
        if len(w) < 3 or w in STOP:
            continue
        out.append(w)
        out.extend(SINONIM.get(w, []))
    return out


def pilih_halaman(d: Dict[str, Any], pesan: str, halaman_aktif: Optional[str] = None,
                  riwayat: Optional[List[Dict[str, str]]] = None, maks: int = MAKS_HALAMAN_DETAIL) -> List[Dict[str, Any]]:
    kata = _token(pesan)
    # beri bobot kecil pada pertanyaan sebelumnya (pertanyaan lanjutan seperti "kalau yang itu?")
    kata_lama = _token(" ".join(m.get("content", "") for m in (riwayat or [])[-2:] if m.get("role") == "user"))
    skor: List[Tuple[float, Dict[str, Any]]] = []
    for h in d["halaman"]:
        nama = f"{h.get('menu') or ''} {h['rute'].replace('/', ' ').replace('-', ' ')}".lower()
        isi_judul = " ".join(h.get("judul", []) + h.get("tab", [])).lower()
        isi_tombol = " ".join(t["label"] for t in h.get("tombol", [])).lower()
        isi_komp = " ".join(h.get("komponen", [])).lower()
        s = 0.0
        for w in kata:
            if w in nama:
                s += 5
            if w in isi_judul:
                s += 2
            if w in isi_tombol:
                s += 1
            if w in isi_komp:
                s += 1
        for w in kata_lama:
            if w in nama:
                s += 1.5
        if halaman_aktif and h["rute"] == halaman_aktif:
            s += 4
        if s > 0:
            skor.append((s, h))
    skor.sort(key=lambda x: -x[0])
    return [h for _, h in skor[:maks]]


# --------------------------------------------------------------------------- publik
def bangun_konteks(pesan: str, halaman_aktif: Optional[str] = None,
                   riwayat: Optional[List[Dict[str, str]]] = None) -> Tuple[str, str]:
    """Return (indeks_statis, detail_dinamis). Keduanya string kosong kalau peta belum dibuat."""
    d = muat()
    if not d:
        return "", ""
    halaman_aktif = cocokkan_rute(d, halaman_aktif)
    statis = teks_indeks(d)
    terpilih = pilih_halaman(d, pesan, halaman_aktif, riwayat)
    detail, total = [], 0
    for h in terpilih:
        t = teks_halaman(h)
        if total + len(t) > MAKS_KARAKTER_DETAIL and detail:
            break
        detail.append(t)
        total += len(t)
    dinamis = ""
    if halaman_aktif:
        dinamis += f"Halaman yang sedang dibuka pengguna: `{halaman_aktif}`.\n"
    if detail:
        dinamis += "DETAIL LENGKAP halaman yang relevan dengan pertanyaan ini:\n\n" + "\n\n".join(detail)
    return statis, dinamis


ATURAN_PETA = (
    "PENGETAHUAN APLIKASI:\n"
    "- Peta aplikasi di bawah dibuat otomatis dari kode dan adalah SATU-SATUNYA sumber kebenaran tentang "
    "halaman, komponen, tombol, tab, dan hak akses di Dashboardori. Jawab pertanyaan tentang aplikasi hanya "
    "dari peta itu; jangan mengarang halaman, tombol, atau fitur yang tidak tertulis.\n"
    "- Untuk pertanyaan jumlah (halaman, menu, tombol), pakai angka dari 'Ringkasan angka'; kalau perlu hitung "
    "tombol satu halaman, hitung dari daftar detailnya.\n"
    "- Kalau pertanyaan menyangkut halaman yang detailnya belum tampil, pakai indeks untuk menyebut route-nya "
    "dan sarankan pengguna bertanya lebih spesifik tentang halaman itu (detail lengkap akan dimuat).\n"
    "- Nama tombol/tab di peta adalah teks sumber di kode (umumnya Inggris); di layar bisa tampil terjemahan "
    "Indonesia sesuai pengaturan bahasa. Sebut nama aslinya dan jelaskan fungsinya.\n"
    "- Tombol bernama 'Post', 'Reverse', 'Submit', 'Delete', dsb. bisa nonaktif/tersembunyi tergantung role "
    "pengguna (lihat 'Hak akses per role'). Backend tetap penentu akhir izin. Jelaskan fungsi tombol dari "
    "nama, tujuan navigasi, dan konteks halamannya; jika fungsinya tidak jelas dari peta, katakan terus terang.\n"
    "- Kalau pertanyaan di luar isi peta (mis. data keuangan perusahaan), ikuti aturan data di atas."
)
