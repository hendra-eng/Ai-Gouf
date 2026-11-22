"""
modules/financial_statements/isi_ai_core.py
============================================
Inti logika "Isi AI" untuk tombol Download Excel di halaman Reports.

Tugas yang dibantu AI (semuanya HANYA mengisi sel kosong, tidak mengubah angka):
    party     Kolom "Supplier/Customer" di sheet GL yang kosong        (model ringan / Haiku)
    catatan   Kolom "Notes" di sheet TB untuk akun yang saldonya janggal (model analisis / Sonnet)

Jurnal penyesuaian (ADJ) SENGAJA tidak diisi AI: isinya mengubah angka TB/BS/PNL CF,
jadi tetap lewat Journal Entry bertanda "Adjusting entry" yang disetujui manusia.

Kolom "Category" di sheet COA (account_sub) SENGAJA tidak diisi AI: Category dipakai Neraca dan Arus Kas
untuk memisahkan aset tetap, kas/bank, dan utang jangka panjang, jadi harus berasal dari COA resmi klien
(template industri / COA klien, selalu terisi). Akun yang Category-nya kosong cuma diberi penanda di Excel
supaya diisi di Chart of Accounts. Tugas "kategori" sudah dihapus dari modul ini.

PENGAMAN BIAYA (semua di file ini, supaya tidak ada token yang bocor):
    1. Cache per klien: hasil (termasuk jawaban "tidak ada") disimpan, jadi klik berikutnya tidak memanggil AI lagi.
    2. Dedupe: item dengan kunci sama dalam satu permintaan hanya dikirim sekali.
    3. Anggaran token: batas per unduhan, per hari, dan per bulan (dalam TOKEN, bukan rupiah).
    4. Pemutus (circuit breaker): beberapa kegagalan berturut-turut -> AI dimatikan sementara.
    5. Sakelar darurat: REPORTS_AI_AKTIF=false mematikan semuanya tanpa deploy ulang.
    6. max_tokens keluaran dihitung dari jumlah item (bukan angka besar tetap).
    7. Setiap panggilan mencatat pemakaian token asli (resp.usage) ke _pemakaian.jsonl.

PENGAMAN KUALITAS:
    - party    : nama harus benar-benar ada di teks keterangan (anti-halusinasi), kalau tidak dibuang.
    - catatan  : dipaksa berawalan "Dugaan AI:" dan dipotong pendek.

File ini sengaja TIDAK meng-import FastAPI/anthropic di level atas. Pemanggil model disuntikkan
(`pemanggil`) supaya mudah diuji; default-nya baru meng-import claude_client saat dipakai.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("isi_ai_core")

VERSI_PROMPT = "v1"
FOLDER_DATA = Path(__file__).resolve().parents[2] / "cache_isi_ai_reports"

TUGAS_VALID = ("party", "catatan", "catatan_pnl")

# Batas keras per permintaan HTTP dan per panggilan model.
MAKS_ITEM_PERMINTAAN = 200
UKURAN_BATCH = {"party": 40, "catatan": 12, "catatan_pnl": 4}
MAKS_PANJANG_TEKS = 300          # keterangan dipotong sebelum dikirim
MAKS_PANJANG_NAMA = 80           # nama pihak hasil AI
MAKS_PANJANG_CATATAN = 220       # catatan TB hasil AI

# Perkiraan kasar: 1 token ~ 3 karakter teks Indonesia (sengaja konservatif).
KARAKTER_PER_TOKEN = 3

Pemanggil = Callable[[str, str, str, int], Tuple[str, int, int]]
"""(model, system_prompt, prompt_user, max_tokens) -> (teks_jawaban, token_masuk, token_keluar)"""


# ── Konfigurasi ──────────────────────────────────────────────────────────────

def _env_int(nama: str, default: int) -> int:
    try:
        return int(os.environ.get(nama, "").strip() or default)
    except ValueError:
        return default


@dataclass
class Konfigurasi:
    aktif: bool
    model_ringan: str
    model_analisis: str
    batas_token_unduhan: int
    batas_token_hari: int
    batas_token_bulan: int
    maks_gagal_beruntun: int
    jeda_pemutus_detik: int


def ambil_konfigurasi() -> Konfigurasi:
    """Dibaca ulang tiap permintaan, jadi mengubah .env + restart cukup; sakelar darurat tidak perlu deploy ulang kode."""
    return Konfigurasi(
        aktif=os.environ.get("REPORTS_AI_AKTIF", "true").strip().lower() not in ("false", "0", "off", "no"),
        model_ringan=os.environ.get("REPORTS_AI_MODEL_RINGAN", "claude-haiku-5-5").strip(),
        model_analisis=os.environ.get("REPORTS_AI_MODEL_ANALISIS", "claude-sonnet-5-5").strip(),
        batas_token_unduhan=_env_int("REPORTS_AI_BATAS_TOKEN_UNDUHAN", 60_000),
        batas_token_hari=_env_int("REPORTS_AI_BATAS_TOKEN_HARI", 400_000),
        batas_token_bulan=_env_int("REPORTS_AI_BATAS_TOKEN_BULAN", 6_000_000),
        maks_gagal_beruntun=_env_int("REPORTS_AI_MAKS_GAGAL_BERUNTUN", 3),
        jeda_pemutus_detik=_env_int("REPORTS_AI_JEDA_PEMUTUS_DETIK", 300),
    )


def model_untuk(tugas: str, konfig: Konfigurasi) -> str:
    return konfig.model_analisis if tugas in ("catatan", "catatan_pnl") else konfig.model_ringan


# ── Utilitas teks ────────────────────────────────────────────────────────────

_RE_DIGIT_PANJANG = re.compile(r"\d{3,}")
_RE_SPASI = re.compile(r"\s+")
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_RE_ANGKA_PANJANG = re.compile(r"\d{8,}")


def tanda_tangan_teks(teks: str) -> str:
    """Kunci dedupe: huruf besar, spasi dirapikan, angka panjang (nomor referensi) diseragamkan.
    'TRSF E-BANKING 0105/FTSCY/WS95031 PT ABC 123456' dan versi lain dengan nomor beda -> kunci sama."""
    t = _RE_SPASI.sub(" ", (teks or "").strip().upper())
    return _RE_DIGIT_PANJANG.sub("#", t)


def topeng_teks(teks: str) -> str:
    """Sembunyikan data sensitif sebelum dikirim ke model: email dan deretan angka >= 8 digit (rekening/kartu)."""
    t = _RE_EMAIL.sub("[email]", teks or "")
    t = _RE_ANGKA_PANJANG.sub("#", t)
    return _RE_SPASI.sub(" ", t).strip()[:MAKS_PANJANG_TEKS]


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def nama_ada_di_teks(nama: str, teks: str) -> bool:
    """Anti-halusinasi: nama pihak dari AI harus benar-benar tertulis di keterangan (huruf/angka saja, tanpa tanda baca)."""
    n = _alnum(nama)
    return len(n) >= 3 and n in _alnum(teks)


def _hash(*bagian: Any) -> str:
    return hashlib.sha256("|".join(str(b) for b in bagian).encode("utf-8")).hexdigest()[:32]


# ── Cache ────────────────────────────────────────────────────────────────────

class CacheHasil:
    """Cache hasil AI per (klien, tugas) di satu file JSON. Nilai "" (AI menjawab 'tidak ada') ikut disimpan
    supaya pertanyaan yang sama tidak diajukan lagi."""

    def __init__(self, folder: Path = FOLDER_DATA):
        self.folder = folder
        self._kunci_lock = threading.Lock()

    def _path(self, klien: str, tugas: str) -> Path:
        aman = re.sub(r"[^A-Za-z0-9_-]", "", klien)[:64] or "tanpa_klien"
        return self.folder / f"{aman}__{tugas}.json"

    def muat(self, klien: str, tugas: str) -> Dict[str, str]:
        p = self._path(klien, tugas)
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:  # noqa: BLE001  -- cache rusak/tidak ada = cache-miss
            return {}

    def simpan_banyak(self, klien: str, tugas: str, pasangan: Dict[str, str]) -> None:
        if not pasangan:
            return
        with self._kunci_lock:
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                data = self.muat(klien, tugas)
                data.update(pasangan)
                p = self._path(klien, tugas)
                tmp = p.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                tmp.replace(p)
            except Exception as e:  # noqa: BLE001
                logger.warning("Gagal menyimpan cache isi-AI (%s/%s): %s", klien, tugas, e)


# ── Anggaran token ───────────────────────────────────────────────────────────

class AnggaranToken:
    """Hitungan token terpakai: per unduhan (memori, 1 jam), per hari dan per bulan (file, tahan restart)."""

    def __init__(self, folder: Path = FOLDER_DATA, sekarang: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.folder = folder
        self.sekarang = sekarang
        self._lock = threading.Lock()
        self._unduhan: Dict[str, Tuple[int, float]] = {}

    def _file(self) -> Path:
        return self.folder / "_anggaran.json"

    def _baca(self) -> Dict[str, Any]:
        s = self.sekarang()
        hari, bulan = s.strftime("%Y-%m-%d"), s.strftime("%Y-%m")
        try:
            d = json.loads(self._file().read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            d = {}
        if d.get("hari") != hari:
            d["hari"], d["token_hari"] = hari, 0
        if d.get("bulan") != bulan:
            d["bulan"], d["token_bulan"] = bulan, 0
        d.setdefault("token_hari", 0)
        d.setdefault("token_bulan", 0)
        return d

    def _bersihkan_unduhan(self) -> None:
        batas = time.time() - 3600
        for k in [k for k, (_, ts) in self._unduhan.items() if ts < batas]:
            self._unduhan.pop(k, None)

    def pemakaian(self, id_unduhan: Optional[str] = None) -> Dict[str, int]:
        with self._lock:
            d = self._baca()
            return {
                "token_unduhan": self._unduhan.get(id_unduhan or "", (0, 0))[0],
                "token_hari": int(d["token_hari"]),
                "token_bulan": int(d["token_bulan"]),
            }

    def sisa(self, konfig: Konfigurasi, id_unduhan: Optional[str]) -> Tuple[int, str]:
        """(sisa_token, nama_pembatas). Pembatas = batas yang paling dulu habis."""
        p = self.pemakaian(id_unduhan)
        kandidat = [
            (konfig.batas_token_unduhan - p["token_unduhan"], "batas_unduhan"),
            (konfig.batas_token_hari - p["token_hari"], "batas_hari"),
            (konfig.batas_token_bulan - p["token_bulan"], "batas_bulan"),
        ]
        return min(kandidat, key=lambda x: x[0])

    def catat(self, token: int, id_unduhan: Optional[str]) -> None:
        if token <= 0:
            return
        with self._lock:
            d = self._baca()
            d["token_hari"] = int(d["token_hari"]) + token
            d["token_bulan"] = int(d["token_bulan"]) + token
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                tmp = self._file().with_suffix(".tmp")
                tmp.write_text(json.dumps(d), encoding="utf-8")
                tmp.replace(self._file())
            except Exception as e:  # noqa: BLE001
                logger.warning("Gagal menyimpan anggaran token isi-AI: %s", e)
            if id_unduhan:
                self._bersihkan_unduhan()
                lama = self._unduhan.get(id_unduhan, (0, 0))[0]
                self._unduhan[id_unduhan] = (lama + token, time.time())


class PemutusSirkuit:
    """Setelah N kegagalan berturut-turut, AI dimatikan sementara supaya loop error tidak menguras token/waktu."""

    def __init__(self) -> None:
        self.gagal_beruntun = 0
        self.terbuka_sampai = 0.0
        self._lock = threading.Lock()

    def boleh(self) -> bool:
        with self._lock:
            return time.time() >= self.terbuka_sampai

    def catat_sukses(self) -> None:
        with self._lock:
            self.gagal_beruntun = 0

    def catat_gagal(self, konfig: Konfigurasi) -> None:
        with self._lock:
            self.gagal_beruntun += 1
            if self.gagal_beruntun >= konfig.maks_gagal_beruntun:
                self.terbuka_sampai = time.time() + konfig.jeda_pemutus_detik
                self.gagal_beruntun = 0
                logger.error("Pemutus isi-AI terbuka %s detik setelah kegagalan berturut-turut.", konfig.jeda_pemutus_detik)


_cache_default = CacheHasil()
_anggaran_default = AnggaranToken()
_pemutus_default = PemutusSirkuit()


def catat_pemakaian_log(folder: Path, baris: Dict[str, Any]) -> None:
    try:
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / "_pemakaian.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(baris, ensure_ascii=False) + "\n")
    except Exception as e:  # noqa: BLE001
        logger.warning("Gagal menulis log pemakaian isi-AI: %s", e)


# ── Pemanggil model default ──────────────────────────────────────────────────

def pemanggil_claude(model: str, system_prompt: str, prompt_user: str, max_tokens: int) -> Tuple[str, int, int]:
    """Panggil Claude lewat claude_client (retry transient sudah ditangani di sana). Import malas."""
    from ..claude_client import ambil_teks_dari_response, panggil_dengan_retry  # noqa: WPS433

    resp = panggil_dengan_retry(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt_user}],
    )
    usage = getattr(resp, "usage", None)
    return (
        ambil_teks_dari_response(resp),
        int(getattr(usage, "input_tokens", 0) or 0),
        int(getattr(usage, "output_tokens", 0) or 0),
    )


# ── Item: pembersihan, kunci cache, prompt, validasi ─────────────────────────

def _angka(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def bersihkan_item(tugas: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Ambil hanya field yang dipakai dan potong panjangnya. None = item tidak valid (dilewati)."""
    iid = str(item.get("id", "")).strip()[:64]
    if not iid:
        return None
    if tugas == "party":
        teks = str(item.get("teks", "")).strip()[:MAKS_PANJANG_TEKS]
        return {"id": iid, "teks": teks} if len(teks) >= 3 else None
    if tugas == "catatan_pnl":
        # Catatan untuk baris SELISIH di PNL CF: hanya hitungan ringkas dari data (tanpa angka rupiah, tanpa nama pihak).
        jenis = str(item.get("jenis", "")).strip()[:10]
        if jenis not in ("profit", "kas"):
            return None
        konteks = {}
        for k, v in list((item.get("konteks") or {}).items())[:8]:
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                konteks[str(k)[:40]] = int(v)
        return {"id": iid, "jenis": jenis, "nama": str(item.get("nama", ""))[:80], "konteks": konteks}
    if tugas == "catatan":
        besar = []
        for t in (item.get("transaksi_besar") or [])[:4]:
            if isinstance(t, dict):
                besar.append({"ket": topeng_teks(str(t.get("ket", "")))[:100], "debit": _angka(t.get("debit")), "kredit": _angka(t.get("kredit"))})
        return {
            "id": iid, "kode": str(item.get("kode", ""))[:30], "nama": str(item.get("nama", ""))[:80],
            "grup": str(item.get("grup", ""))[:30], "sisi_normal": str(item.get("sisi_normal", ""))[:8],
            "saldo_awal": _angka(item.get("saldo_awal")), "total_debit": _angka(item.get("total_debit")),
            "total_kredit": _angka(item.get("total_kredit")), "saldo_akhir": _angka(item.get("saldo_akhir")),
            "belum_posted": int(_angka(item.get("belum_posted"))), "di_coa": bool(item.get("di_coa", True)),
            "alasan": [str(a)[:60] for a in (item.get("alasan") or [])][:4], "transaksi_besar": besar,
        }
    return None


def kunci_cache(tugas: str, item: Dict[str, Any], model: str) -> str:
    if tugas == "party":
        return _hash(VERSI_PROMPT, tugas, model, tanda_tangan_teks(item["teks"]))
    if tugas == "catatan_pnl":
        return _hash(VERSI_PROMPT, tugas, model, item["jenis"], json.dumps(item["konteks"], sort_keys=True))
    return _hash(
        VERSI_PROMPT, tugas, model, item["kode"], round(item["saldo_awal"]), round(item["total_debit"]),
        round(item["total_kredit"]), round(item["saldo_akhir"]), item["belum_posted"], item["di_coa"],
    )


_SISTEM = {
    "catatan_pnl": (
        "Kamu asisten akuntan senior. Laporan Laba Rugi dan Arus Kas (PNL CF) punya baris SELISIH terhadap Trial Balance "
        "(jenis 'profit' = selisih laba/rugi, 'kas' = selisih saldo kas/bank). Selisih itu nanti hanya ditampilkan kalau tidak nol. "
        f"Untuk tiap item tulis SATU catatan singkat (maksimal {MAKS_PANJANG_CATATAN} karakter, bahasa Indonesia) berisi DUGAAN penyebab "
        "paling mungkin dan satu hal yang perlu dicek, berdasarkan HANYA hitungan di 'konteks' (jumlah baris belum posted, akun di luar COA, "
        "akun bersaldo berlawanan, baris penyesuaian). Jangan mengarang angka, nama akun, atau transaksi. Awali dengan 'Dugaan AI: '. "
        'Jawab HANYA JSON valid tanpa teks lain: {"hasil":[{"i":<nomor>,"v":"<catatan>"}]}'
    ),
    "party": (
        "Kamu asisten akuntansi Indonesia. Tugas: dari keterangan transaksi, ambil NAMA PIHAK "
        "(pelanggan, pemasok, penerima, atau pengirim) HANYA jika tertulis jelas di teks. Salin persis dari teks, "
        "jangan menebak dan jangan menambah kata. Kalau tidak ada nama pihak yang jelas (biaya bank, bunga, "
        "pembulatan, transfer internal, saldo awal), isi string kosong. "
        'Jawab HANYA JSON valid tanpa teks lain: {"hasil":[{"i":<nomor>,"v":"<nama atau kosong>"}]}'
    ),
    "catatan": (
        "Kamu asisten akuntan senior. Untuk tiap akun Trial Balance yang janggal, tulis SATU catatan singkat "
        f"(maksimal {MAKS_PANJANG_CATATAN} karakter, bahasa Indonesia) berisi DUGAAN penyebab dan satu hal yang perlu dicek. "
        "Gunakan HANYA data yang diberikan; jangan mengarang transaksi, nama, atau angka. Awali dengan 'Dugaan AI: '. "
        'Jawab HANYA JSON valid tanpa teks lain: {"hasil":[{"i":<nomor>,"v":"<catatan>"}]}'
    ),
}


def susun_prompt_user(tugas: str, batch: List[Dict[str, Any]]) -> str:
    baris: List[str] = []
    for n, it in enumerate(batch, start=1):
        if tugas == "party":
            baris.append(f"{n}. {topeng_teks(it['teks'])}")
        elif tugas == "catatan_pnl":
            baris.append(f"{n}. " + json.dumps(
                {k: it[k] for k in ("jenis", "nama", "konteks")}, ensure_ascii=False, separators=(",", ":")))
        else:
            baris.append(f"{n}. " + json.dumps(
                {k: it[k] for k in ("kode", "nama", "grup", "sisi_normal", "saldo_awal", "total_debit", "total_kredit",
                                    "saldo_akhir", "belum_posted", "di_coa", "alasan", "transaksi_besar")},
                ensure_ascii=False, separators=(",", ":")))
    return "Daftar item:\n" + "\n".join(baris)


def perkirakan_token(tugas: str, batch: List[Dict[str, Any]]) -> Tuple[int, int]:
    """(perkiraan_token_masuk, max_tokens_keluar) untuk satu batch."""
    prompt = _SISTEM[tugas] + susun_prompt_user(tugas, batch)
    masuk = len(prompt) // KARAKTER_PER_TOKEN + 20
    keluar = {"party": 30, "catatan": 110, "catatan_pnl": 110}[tugas] * len(batch) + 120
    return masuk, keluar


def urai_json_hasil(teks: str) -> Optional[Dict[int, str]]:
    """Ambil {nomor: nilai} dari jawaban model. None kalau bukan JSON yang sesuai skema."""
    if not teks:
        return None
    bersih = re.sub(r"^```(?:json)?|```$", "", teks.strip(), flags=re.MULTILINE).strip()
    awal, akhir = bersih.find("{"), bersih.rfind("}")
    if awal < 0 or akhir <= awal:
        return None
    try:
        data = json.loads(bersih[awal:akhir + 1])
    except json.JSONDecodeError:
        return None
    daftar = data.get("hasil") if isinstance(data, dict) else None
    if not isinstance(daftar, list):
        return None
    hasil: Dict[int, str] = {}
    for e in daftar:
        if isinstance(e, dict) and isinstance(e.get("i"), int) and isinstance(e.get("v", ""), str):
            hasil[e["i"]] = e.get("v", "")
    return hasil


def validasi_nilai(tugas: str, item: Dict[str, Any], nilai: str) -> str:
    """Kembalikan nilai yang lolos validasi, atau "" kalau ditolak."""
    v = (nilai or "").strip()
    if not v:
        return ""
    if tugas == "party":
        v = v[:MAKS_PANJANG_NAMA]
        return v if nama_ada_di_teks(v, item["teks"]) else ""
    v = _RE_SPASI.sub(" ", v)
    if not v.lower().startswith("dugaan ai"):
        v = "Dugaan AI: " + v
    return v[:MAKS_PANJANG_CATATAN]


# ── Proses utama ─────────────────────────────────────────────────────────────

def proses_permintaan(
    klien_id: str,
    tugas: str,
    items: List[Dict[str, Any]],
    id_unduhan: Optional[str] = None,
    *,
    pemanggil: Pemanggil = pemanggil_claude,
    konfig: Optional[Konfigurasi] = None,
    anggaran: Optional[AnggaranToken] = None,
    cache: Optional[CacheHasil] = None,
    pemutus: Optional[PemutusSirkuit] = None,
) -> Dict[str, Any]:
    """Kerjakan satu permintaan. Item yang tidak terkerjakan TIDAK muncul di `hasil`; alasannya ada di `ringkasan`."""
    if tugas not in TUGAS_VALID:
        raise ValueError(f"tugas harus salah satu dari: {', '.join(TUGAS_VALID)}")
    konfig = konfig or ambil_konfigurasi()
    anggaran = anggaran or _anggaran_default
    cache = cache or _cache_default
    pemutus = pemutus or _pemutus_default

    ringkasan: Dict[str, Any] = {
        "diminta": len(items), "tidak_valid": 0, "dari_cache": 0, "diproses_ai": 0, "ditolak": 0,
        "dilewati": 0, "alasan_dilewati": None, "token_masuk": 0, "token_keluar": 0,
    }
    hasil: Dict[str, str] = {}

    if len(items) > MAKS_ITEM_PERMINTAAN:
        ringkasan["dilewati"] += len(items) - MAKS_ITEM_PERMINTAAN
        ringkasan["alasan_dilewati"] = "terlalu_banyak"
        items = items[:MAKS_ITEM_PERMINTAAN]

    bersih: List[Dict[str, Any]] = []
    for it in items:
        b = bersihkan_item(tugas, it) if isinstance(it, dict) else None
        if b is None:
            ringkasan["tidak_valid"] += 1
        else:
            bersih.append(b)

    if not konfig.aktif:
        ringkasan["dilewati"] += len(bersih)
        ringkasan["alasan_dilewati"] = "dinonaktifkan"
        return {"hasil": hasil, "ringkasan": ringkasan}

    model = model_untuk(tugas, konfig)
    tersimpan = cache.muat(klien_id, tugas)

    # Kelompokkan per kunci cache: item dengan kunci sama hanya diproses sekali.
    per_kunci: Dict[str, List[Dict[str, Any]]] = {}
    for b in bersih:
        per_kunci.setdefault(kunci_cache(tugas, b, model), []).append(b)

    perlu_ai: List[Tuple[str, Dict[str, Any]]] = []
    for kunci, daftar in per_kunci.items():
        if kunci in tersimpan:
            for b in daftar:
                nilai = validasi_nilai(tugas, b, tersimpan[kunci])
                if nilai:
                    hasil[b["id"]] = nilai
            ringkasan["dari_cache"] += len(daftar)
        else:
            perlu_ai.append((kunci, daftar[0]))

    baru_untuk_cache: Dict[str, str] = {}
    ukuran = UKURAN_BATCH[tugas]
    berhenti = False
    for awal in range(0, len(perlu_ai), ukuran):
        potongan = perlu_ai[awal:awal + ukuran]
        jumlah_item_potongan = sum(len(per_kunci[k]) for k, _ in potongan)
        if berhenti:
            ringkasan["dilewati"] += jumlah_item_potongan
            continue

        if not pemutus.boleh():
            ringkasan["dilewati"] += jumlah_item_potongan
            ringkasan["alasan_dilewati"] = "pemutus"
            berhenti = True
            continue

        batch_item = [it for _, it in potongan]
        masuk_perk, keluar_maks = perkirakan_token(tugas, batch_item)
        sisa, pembatas = anggaran.sisa(konfig, id_unduhan)
        if masuk_perk + keluar_maks > sisa:
            ringkasan["dilewati"] += jumlah_item_potongan
            ringkasan["alasan_dilewati"] = pembatas
            berhenti = True
            continue

        urai: Optional[Dict[int, str]] = None
        gagal_sudah_dicatat = False
        for _percobaan in range(2):  # 1x ulang SAJA kalau jawaban bukan JSON yang sesuai skema
            try:
                teks, tm, tk = pemanggil(model, _SISTEM[tugas], susun_prompt_user(tugas, batch_item), keluar_maks)
            except Exception as e:  # noqa: BLE001
                logger.warning("Panggilan model isi-AI gagal (%s): %s", tugas, e)
                pemutus.catat_gagal(konfig)
                gagal_sudah_dicatat = True
                break
            anggaran.catat(tm + tk, id_unduhan)
            ringkasan["token_masuk"] += tm
            ringkasan["token_keluar"] += tk
            catat_pemakaian_log(getattr(cache, "folder", FOLDER_DATA), {
                "waktu": datetime.now(timezone.utc).isoformat(timespec="seconds"), "klien": klien_id, "tugas": tugas,
                "model": model, "item": len(batch_item), "token_masuk": tm, "token_keluar": tk,
            })
            urai = urai_json_hasil(teks)
            if urai is not None:
                pemutus.catat_sukses()
                break
            sisa_lagi, _ = anggaran.sisa(konfig, id_unduhan)
            if masuk_perk + keluar_maks > sisa_lagi:
                break
        if urai is None:
            if not gagal_sudah_dicatat:
                pemutus.catat_gagal(konfig)
            ringkasan["dilewati"] += jumlah_item_potongan
            ringkasan["alasan_dilewati"] = ringkasan["alasan_dilewati"] or "gagal_model"
            continue

        for n, (kunci, wakil) in enumerate(potongan, start=1):
            mentah = urai.get(n, "")
            nilai = validasi_nilai(tugas, wakil, mentah)
            if mentah.strip() and not nilai:
                ringkasan["ditolak"] += 1
            baru_untuk_cache[kunci] = nilai
            ringkasan["diproses_ai"] += len(per_kunci[kunci])
            for b in per_kunci[kunci]:
                v = validasi_nilai(tugas, b, nilai)
                if v:
                    hasil[b["id"]] = v

    cache.simpan_banyak(klien_id, tugas, baru_untuk_cache)
    return {"hasil": hasil, "ringkasan": ringkasan}