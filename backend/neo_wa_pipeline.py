"""
neo_wa_pipeline.py
==================
Neo memproses FILE WhatsApp otomatis sampai Posted untuk halaman SALES, PURCHASE, dan JOURNAL ENTRY:
Upload -> Buat transaksi (promote) -> Approve -> Post. Cash & Bank: upload rekening koran -> auto-match -> Approve -> Post.
Other: baca CSV/Excel -> import jadi draft -> Submit -> Approve -> Post.

Dipanggil dari alat Neo `proses_file_whatsapp` (neo_data_tools.py). Prosesnya jalan di BACKGROUND THREAD karena
file besar (ratusan invoice) butuh beberapa menit; Neo langsung menjawab "sedang diproses" dan progresnya
dibaca lewat alat `status_proses_file`.

Langkahnya SAMA dengan yang dilakukan pengguna di layar (memakai fungsi backend yang sama, bukan jalan pintas):
  1. upload_source_file          (template klien dicocokkan; tidak cocok -> berhenti, status perlu_template)
  2. promote_source_file_to_invoices   (hanya baris valid & nomor invoice belum dipakai)
  3. per invoice Draft: pastikan_mapping_sales -> validasi_posting_sales -> Approved -> Posted (+ activity log JOURNAL_SYNC)
     Invoice yang akunnya tidak lolos validasi TIDAK diposting; dilaporkan alasannya.

Pengaman: minimal level Supervisor (sama seperti tombol di layar), hanya klien yang boleh diakses user, proses bisa
diulang tanpa dobel (file tidak diupload ulang, invoice yang sudah ada dilewati), semua posting tercatat di activity log.
Matikan dengan NEO_TULIS_AKTIF=0 di backend/.env.
"""
import asyncio
import io
import ipaddress
import json
import logging
import os
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text

import db_client as dbc

logger = logging.getLogger("neo_wa_pipeline")

EKSTENSI_BOLEH = ("csv", "xlsx", "xls", "pdf")
MAKS_BYTE = 50 * 1024 * 1024
MENIT_BASI = 30          # status 'diproses' lebih lama dari ini dianggap macet (server restart) dan boleh diulang
DETAK_AGEN_DETIK = 60    # selama pipeline berjalan, agen dijaga tetap duduk di meja kerja: masa tugas diperpanjang tiap sekian detik
# [BARU] Tugas yang gagal/selesai sangat cepat (mis. 3 detik karena template belum ada) tetap harus TERLIHAT di scene 3D:
# agen berdiri dari meja meeting, berjalan ke meja halaman, duduk sebentar, baru pulang. Karena itu baris tugas ditahan
# 'berjalan' minimal sekian detik sejak dimulai (perjalanan ~10 dtk + polling frontend 5 dtk + duduk sebentar).
MIN_TAMPIL_AGEN_DETIK = 22
LEVEL_MINIMAL = 3        # Supervisor, sama seperti upload/Buat Invoice/Approve/Post di layar (Sales)
# Purchase & Journal Entry: Approve boleh Supervisor, tapi POST di layar harus Manager ke atas -> Neo ikut aturan yang sama.
LEVEL_HALAMAN = {"sales": 3, "purchase": 4, "journal_entry": 4, "cash_bank": 4, "other": 4}
NAMA_HALAMAN = {"sales": "Sales", "purchase": "Purchase", "journal_entry": "Journal Entry",
                "cash_bank": "Cash dan Bank", "other": "Other"}
HALAMAN_DIDUKUNG = tuple(LEVEL_HALAMAN)
BATCH_POST = 25
AGEN_UPLOAD_SALES = "Atlas"   # [ATURAN MUTLAK] di halaman Sales SEMUA upload dikerjakan Atlas (master expert accounting); Neo/Zeno menyerahkan ke Atlas, bukan menolak


def aktif() -> bool:
    return os.environ.get("NEO_TULIS_AKTIF", "1").strip().lower() not in ("0", "false", "no", "off")


class _Berhenti(Exception):
    def __init__(self, status: str, pesan: str):
        super().__init__(pesan)
        self.status, self.pesan = status, pesan


# ============================================================
# PENYIMPANAN ISI FILE (dipanggil webhook WhatsApp)
# ============================================================
def folder_file() -> str:
    d = os.environ.get("WA_FILE_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "wa_files")
    os.makedirs(d, exist_ok=True)
    return d


def _aman(nama: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", nama or "file")[:120] or "file"


def _host_publik(host: str) -> bool:
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True
    except Exception:  # noqa: BLE001
        return False


_ALASAN_UNDUH: Dict[int, str] = {}  # alasan gagal unduh terakhir per id file (untuk pesan error yang jujur)


def _konteks_ssl():
    """Konteks SSL dengan bundel sertifikat certifi. Python di Windows sering tidak punya sertifikat root lengkap -> CERTIFICATE_VERIFY_FAILED."""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001  (certifi tidak ada -> pakai bawaan sistem)
        return ssl.create_default_context()


def simpan_isi_dari_url(wa_id: int, url: Optional[str], nama: Optional[str]) -> Optional[str]:
    """Unduh file dari link Fonnte ke server, catat path-nya. Gagal -> None; alasan asli disimpan di _ALASAN_UNDUH[wa_id]
    dan dicatat di log (dulu gagal diam-diam). Dicoba sampai 3x karena link Fonnte kadang lambat/putus sesaat."""
    import time
    import urllib.error
    if not url:
        _ALASAN_UNDUH[wa_id] = "link file dari Fonnte kosong (webhook tidak mengirim field 'url' - cek paket/pengaturan Fonnte)"
        logger.warning("wa unduh file id=%s gagal: %s", wa_id, _ALASAN_UNDUH[wa_id])
        return None
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        _ALASAN_UNDUH[wa_id] = f"link file tidak valid: {url[:80]}"
        logger.warning("wa unduh file id=%s gagal: %s", wa_id, _ALASAN_UNDUH[wa_id])
        return None
    if not _host_publik(u.hostname):
        _ALASAN_UNDUH[wa_id] = f"host {u.hostname} tidak bisa di-resolve DNS / dianggap bukan host publik (cek internet server)"
        logger.warning("wa unduh file id=%s gagal: %s", wa_id, _ALASAN_UNDUH[wa_id])
        return None
    alasan = ""
    for percobaan in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Neo-WA)"})
            with urllib.request.urlopen(req, timeout=60, context=_konteks_ssl()) as r:  # [DIUBAH] pakai sertifikat certifi (Windows sering gagal CERTIFICATE_VERIFY_FAILED)
                data = r.read(MAKS_BYTE + 1)
            if not data:
                alasan = "link terbuka tapi isinya kosong"
            elif len(data) > MAKS_BYTE:
                _ALASAN_UNDUH[wa_id] = f"file lebih besar dari batas {MAKS_BYTE // (1024 * 1024)} MB"
                logger.warning("wa unduh file id=%s gagal: %s", wa_id, _ALASAN_UNDUH[wa_id])
                return None
            else:
                path = os.path.join(folder_file(), f"{wa_id}_{_aman(nama or 'file')}")
                with open(path, "wb") as f:
                    f.write(data)
                with dbc.engine.begin() as conn:
                    conn.execute(text("update wa_file_masuk set path_lokal = :p where id = :i"), {"p": path, "i": wa_id})
                _ALASAN_UNDUH.pop(wa_id, None)
                logger.info("wa unduh file id=%s OK (%s byte)", wa_id, len(data))
                return path
        except urllib.error.HTTPError as e:
            alasan = f"link ditolak HTTP {e.code}" + (" (link sudah kedaluwarsa)" if e.code in (403, 404, 410) else "")
            if e.code in (403, 404, 410):  # percuma diulang
                break
        except Exception as e:  # noqa: BLE001
            alasan = f"{type(e).__name__}: {e}"
        logger.warning("wa unduh file id=%s percobaan %s/3 gagal: %s", wa_id, percobaan, alasan)
        time.sleep(2 * percobaan)
    _ALASAN_UNDUH[wa_id] = alasan or "gagal tidak diketahui"
    logger.warning("wa unduh file id=%s GAGAL: %s", wa_id, _ALASAN_UNDUH[wa_id])
    return None


# ============================================================
# STATUS
# ============================================================
def _catat(wa_id: int, status: str, hasil: Dict[str, Any], selesai: bool = False, **kolom: Any) -> None:
    sets = ["status_proses = :s", "hasil_proses = :h"]
    p: Dict[str, Any] = {"s": status, "h": json.dumps(hasil, ensure_ascii=False, default=str), "i": wa_id}
    if selesai:
        sets.append("proses_selesai_at = now()")
    for k, v in kolom.items():
        sets.append(f"{k} = :{k}")
        p[k] = v
    with dbc.engine.begin() as conn:
        conn.execute(text(f"update wa_file_masuk set {', '.join(sets)} where id = :i"), p)


def status_terbaru(pemilik: str, batas: int = 3) -> List[Dict[str, Any]]:
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select status_proses, hasil_proses, mime,
                   floor(extract(epoch from (now() - coalesce(proses_selesai_at, proses_mulai_at))) / 60)::int as menit_lalu
              from wa_file_masuk
             where pemilik = :p and status_proses is not null
             order by proses_mulai_at desc nulls last limit :b
        """), {"p": pemilik, "b": batas}).mappings().all()
    hasil = []
    for b in baris:
        try:
            rinci = json.loads(b["hasil_proses"]) if b["hasil_proses"] else {}
        except ValueError:
            rinci = {}
        hasil.append({"status": b["status_proses"], "menit_lalu": b["menit_lalu"], "rincian": rinci})
    return hasil


# ============================================================
# MULAI PROSES (sinkron, cepat) -> kerja berat di background
# ============================================================
MEJA_DARI_HALAMAN = {"sales": "sales", "purchase": "purchase", "journal_entry": "journal-entry",
                     "cash_bank": "bank-cash", "other": "other"}   # kunci halaman -> id meja di Agentic AI
AGEN_KANTOR = ("Neo", "Atlas", "Zeno")


def _user_valid(user: Dict[str, Any], pemilik: str) -> Dict[str, Any]:
    """[BARU] User tanpa login (mode dev, ALLOW_ANONYMOUS_DEV=true) punya id=0 (angka), padahal kolom uploaded_by/created_by
    di database bertipe UUID -> INSERT ditolak ("cannot cast type integer to uuid") dan Neo bilang "Gagal menyimpan source file".
    Kalau id user bukan UUID, pakai akun pemilik WhatsApp yang asli (username = WA_PEMILIK) dari management_users."""
    import uuid
    try:
        uuid.UUID(str(user.get("id")))
        return user  # sudah UUID asli (user login biasa): tidak diubah
    except (ValueError, TypeError, AttributeError):
        pass
    try:
        with dbc.engine.begin() as conn:
            r = conn.execute(text(
                "select id, username, nama_user, role from management_users "
                "where username = :u and deleted_at is null and coalesce(is_active, true)"), {"u": pemilik}).mappings().first()
    except Exception:  # noqa: BLE001
        logger.exception("neo_wa_pipeline _user_valid gagal mencari pemilik=%r", pemilik)
        return user
    if not r:
        logger.warning("neo_wa_pipeline user id=%r bukan UUID dan pemilik %r tidak ada di management_users", user.get("id"), pemilik)
        return user
    return {**user, "id": str(r["id"]), "username": r["username"], "nama": r["nama_user"] or r["username"], "role": r["role"]}


def mulai(user: Dict[str, Any], klien: Dict[str, Any], pemilik: str, nama_mengandung: Optional[str] = None,
          halaman: str = "sales", agen: Optional[str] = None) -> Dict[str, Any]:
    """Tanpa `agen`: perilaku lama (alat Neo di chat). Dengan `agen` (Neo/Atlas/Zeno): agen itu berjalan ke meja halaman,
    memegangnya selama proses, lalu pulang ke meja rapat dan hasilnya dilaporkan Neo (lihat kantor_tugas_route.py)."""
    if halaman == "sales":
        # [ATURAN MUTLAK] Upload file Sales SELALU dikerjakan Atlas, siapa pun yang diminta pengguna (Neo, Zeno, atau tanpa nama).
        # Agen lain TIDAK ditolak: pekerjaannya diserahkan ke Atlas, supaya selalu lewat pemeriksaan Atlas sebelum Approve/Post.
        if agen and agen != AGEN_UPLOAD_SALES:
            logger.info("upload Sales diminta ke %s; diserahkan ke %s", agen, AGEN_UPLOAD_SALES)
        agen = AGEN_UPLOAD_SALES
    if not agen:
        return _mulai_inti(user, klien, pemilik, nama_mengandung, halaman)
    if agen not in AGEN_KANTOR:
        return {"error": "Agen tidak dikenal."}
    if halaman not in LEVEL_HALAMAN:
        return {"error": "Halaman itu belum didukung pemrosesan otomatis."}
    from modules.auth import core as auth
    import kantor_tugas_route as kt
    import memori_ai as mem
    # Cek level SEBELUM agen berjalan ke meja, supaya akun yang tidak boleh posting tidak melihat agen berangkat lalu pulang.
    if auth.role_level(user.get("role")) < LEVEL_HALAMAN[halaman]:
        return _mulai_inti(user, klien, pemilik, nama_mengandung, halaman)
    pemilik_kantor = mem.pemilik_dari_user(user)
    meja = MEJA_DARI_HALAMAN[halaman]
    pegang = kt.mulai_tugas_wa(pemilik_kantor, agen, meja,
                               f"{agen} memproses file {NAMA_HALAMAN[halaman]} klien {klien.get('client_code')}")
    if not pegang["ok"]:
        return {"meja_dipakai": pegang["pemakai"], "status": "meja_dipakai"}
    try:
        hasil = _mulai_inti(user, klien, pemilik, nama_mengandung, halaman,
                            agen=agen, tugas_id=pegang["id"], pemilik_kantor=pemilik_kantor)
    except Exception:
        kt.batalkan_tugas_wa(pemilik_kantor, pegang["id"])
        raise
    if hasil.get("status") != "dimulai":      # tidak ada file / sudah berjalan / ditolak: agen tidak jadi berangkat
        kt.batalkan_tugas_wa(pemilik_kantor, pegang["id"])
    return hasil


def _norm_nama(s: Optional[str]) -> str:
    """Huruf kecil tanpa spasi/tanda baca: 'Penjualan_Okt 2026.xlsx' cocok dengan 'penjualan okt 2026' yang diucapkan."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


STATUS_BISA_DIULANG = ("baru", "gagal", "perlu_template")   # perlu_template: boleh dicoba lagi setelah template dibuat


def _mulai_inti(user: Dict[str, Any], klien: Dict[str, Any], pemilik: str, nama_mengandung: Optional[str] = None,
                halaman: str = "sales", agen: Optional[str] = None, tugas_id: Optional[str] = None,
                pemilik_kantor: Optional[str] = None) -> Dict[str, Any]:
    from modules.auth import core as auth
    if halaman not in LEVEL_HALAMAN:
        return {"error": "Halaman itu belum didukung pemrosesan otomatis."}
    butuh = LEVEL_HALAMAN[halaman]
    if auth.role_level(user.get("role")) < butuh:
        nama_level = "Supervisor" if butuh <= 3 else "Manager"
        return {"error": f"Akun ini di bawah level {nama_level}, jadi tidak boleh memposting transaksi {NAMA_HALAMAN[halaman]} (aturannya sama seperti tombol di layar). Katakan itu apa adanya."}
    user = _user_valid(user, pemilik)  # [BARU] id user dev (0) bukan UUID -> pakai akun pemilik WhatsApp asli

    with dbc.engine.begin() as conn:
        kandidat = conn.execute(text("""
            select id, nama_file, status_proses,
                   (proses_mulai_at is not null and proses_mulai_at > now() - make_interval(mins => :m)) as masih_baru
              from wa_file_masuk
             where pemilik = :p and diterima_at > now() - interval '30 days'
               and coalesce(status_proses, 'baru') in ('baru', 'gagal', 'perlu_template', 'diproses')
               and lower(coalesce(nama_file, '')) ~ '\\.(csv|xlsx|xls|pdf)$'
             order by diterima_at desc limit 30
        """), {"p": pemilik, "m": MENIT_BASI}).mappings().all()
    if nama_mengandung:
        kunci = _norm_nama(nama_mengandung)
        semua = kandidat
        kandidat = [k for k in semua if kunci and kunci in _norm_nama(k["nama_file"])]
        if not kandidat:
            return {"error": f"Tidak ada file bernama \"{str(nama_mengandung)[:60]}\" yang belum diproses di WhatsApp (30 hari terakhir). Tanyakan lagi daftar file yang belum diupload."}
    sedang = [k for k in kandidat if k["status_proses"] == "diproses" and k["masih_baru"]]
    siap = [k for k in kandidat if not (k["status_proses"] == "diproses" and k["masih_baru"])]
    if not siap:
        if sedang:
            return {"status": "sudah_berjalan", "petunjuk": "Ada file yang sedang diproses. Katakan itu; progres dicek dengan alat status_proses_file."}
        return {"error": "Tidak ada file CSV, Excel, atau PDF yang belum diproses di WhatsApp (30 hari terakhir). Minta pengguna mengirim filenya."}

    if nama_mengandung and len({_norm_nama(k["nama_file"]) for k in siap}) > 1:
        daftar = [str(k["nama_file"])[:70] for k in siap[:5]]
        return {"status": "nama_ambigu", "kandidat": daftar,
                "petunjuk": "Ada beberapa file yang cocok dengan nama itu. Sebut daftarnya dan minta pengguna menyebut nama yang lebih lengkap."}

    pilih = siap[0]
    with dbc.engine.begin() as conn:
        diklaim = conn.execute(text("""
            update wa_file_masuk
               set status_proses = 'diproses', proses_mulai_at = now(), proses_selesai_at = null, hasil_proses = :hp,
                   source_file_id = case when client_id = :c then source_file_id else null end, client_id = :c
             where id = :i
               and (coalesce(status_proses, 'baru') in ('baru', 'gagal', 'perlu_template')
                    or (status_proses = 'diproses' and proses_mulai_at < now() - make_interval(mins => :m)))
            returning id
        """), {"c": klien["id"], "i": pilih["id"], "m": MENIT_BASI,
               "hp": json.dumps({"halaman": halaman, "klien": klien.get("client_code")}, ensure_ascii=False)}).first()
    if diklaim is None:
        return {"status": "sudah_berjalan", "petunjuk": "File itu baru saja diambil proses lain."}

    if agen and tugas_id and pemilik_kantor:
        threading.Thread(target=_jalankan_terpantau, args=(pilih["id"], dict(user), dict(klien), halaman, agen, pemilik_kantor, tugas_id),
                         daemon=True, name=f"neo-wa-{pilih['id']}").start()
    else:
        threading.Thread(target=_jalankan, args=(pilih["id"], dict(user), dict(klien), halaman), daemon=True, name=f"neo-wa-{pilih['id']}").start()
    return {
        "status": "dimulai", "halaman": NAMA_HALAMAN[halaman], "klien": klien.get("client_code"), "file_lain_menunggu": max(len(siap) - 1, 0),
        "petunjuk": (
            "File diterima dan sedang diproses otomatis: upload, buat transaksi, approve, lalu post. Katakan SINGKAT bahwa prosesnya dimulai untuk klien dan halaman ini; "
            "JANGAN bilang sudah selesai. Kalau pengguna bertanya progres atau hasil, panggil status_proses_file. "
            "Kalau file_lain_menunggu lebih dari 0, tawarkan memproses file berikutnya setelah ini selesai."
        ),
    }


# ============================================================
# KERJA BERAT (background)
# ============================================================
def _json(resp: Any) -> Dict[str, Any]:
    try:
        return json.loads(resp.body)
    except Exception:  # noqa: BLE001
        return {}


def _pastikan_lokal(wa_id: int) -> str:
    with dbc.engine.begin() as conn:
        r = conn.execute(text("select nama_file, url_file, path_lokal from wa_file_masuk where id = :i"), {"i": wa_id}).mappings().first()
    if not r:
        raise _Berhenti("gagal", "Data file WhatsApp tidak ditemukan.")
    if r["path_lokal"] and os.path.exists(r["path_lokal"]):
        return r["path_lokal"]
    path = simpan_isi_dari_url(wa_id, r["url_file"], r["nama_file"])
    if not path:
        sebab = _ALASAN_UNDUH.get(wa_id, "tidak diketahui")
        raise _Berhenti("gagal", f"Isi file tidak bisa diambil dari WhatsApp: {sebab}. Minta pengguna mengirim ulang filenya ke WhatsApp.")
    return path


def _modul(halaman: str):
    """(modul import, fungsi upload, fungsi promote) -- fungsi backend yang SAMA dengan tombol di layar."""
    if halaman == "purchase":
        from modules.transactions import purchase_import_v1 as m
        return m, m.upload_purchase_import, m.promote_source_file_to_transactions
    if halaman == "journal_entry":
        from modules.transactions import journal_entry_import_v1 as m
        return m, m.upload_journal_entry_import, m.promote_source_file_to_journals
    from modules.transactions import sales_import_v1 as m
    return m, m.upload_source_file, m.promote_source_file_to_invoices


def _n(rinci: Dict[str, Any], kunci: str) -> int:
    try:
        return int(rinci.get(kunci) or 0)
    except (TypeError, ValueError):
        return 0


def _alasan_utama(rinci: Dict[str, Any]) -> str:
    daftar = rinci.get("alasan_tidak_diposting") or []
    try:
        alasan, jumlah = daftar[0][0], daftar[0][1]
        return f" Alasan terbanyak: {str(alasan)[:90]} ({jumlah})."
    except (IndexError, TypeError, KeyError):
        return ""


def _kalimat_atlas(rinci: Dict[str, Any], bersih_jika_kosong: bool) -> str:
    """[BARU] Kalimat laporan Atlas untuk Neo. Tidak pernah melempar error (laporan suara tidak boleh gagal gara-gara ini), dan
    "tidak menemukan kejanggalan" hanya diucapkan kalau pemeriksaan Atlas benar-benar berjalan dan tidak error."""
    try:
        from atlas_audit_sales import kalimat_laporan
        k = kalimat_laporan(rinci)
    except Exception:  # noqa: BLE001
        logger.exception("kalimat laporan Atlas gagal")
        return ""
    if k:
        return " " + k
    a = rinci.get("atlas")
    if bersih_jika_kosong and isinstance(a, dict) and not a.get("error"):
        return " Atlas sudah memeriksa dan tidak menemukan kejanggalan."
    return ""


def _ringkas_hasil(status: Optional[str], rinci: Dict[str, Any], halaman: str, kode_klien: Optional[str]) -> tuple:
    """(kode, kalimat) untuk diucapkan Neo. kode: ok | sebagian | gagal. Angka diambil apa adanya dari hasil_proses."""
    nama = NAMA_HALAMAN.get(halaman, halaman)
    untuk = f"{nama} klien {kode_klien}" if kode_klien else nama
    dipost, tidak = _n(rinci, "diposting"), _n(rinci, "tidak_diposting")
    if status == "selesai":
        if halaman == "cash_bank":
            return "ok", f"Rekening koran {untuk} selesai: {_n(rinci, 'mutasi_diimpor')} mutasi diimpor, {_n(rinci, 'dicocokkan_otomatis')} dicocokkan, {dipost} diposting."
        kalimat = f"Selesai untuk {untuk}: {dipost} transaksi sudah diposting."
        if halaman == "sales":
            kalimat += _kalimat_atlas(rinci, bersih_jika_kosong=True)
        return "ok", kalimat
    if status == "selesai_sebagian":
        kalimat = f"{untuk}: {dipost} diposting, {tidak} belum diposting." + _alasan_utama(rinci)
        if halaman == "sales":
            tambah = _kalimat_atlas(rinci, bersih_jika_kosong=False).strip()
            if tambah:   # alasan Atlas sudah memuat semua jenis masalah; jangan dobel dengan alasan terbanyak
                kalimat = f"{untuk}: {dipost} diposting. " + tambah
        if halaman == "cash_bank" and _n(rinci, "mutasi_belum_cocok"):
            kalimat += f" {_n(rinci, 'mutasi_belum_cocok')} mutasi butuh akun lawan di tab Reconciliation."
        if halaman == "other" and _n(rinci, "baris_gagal_impor"):
            kalimat += f" {_n(rinci, 'baris_gagal_impor')} baris gagal diimpor."
        return "sebagian", kalimat
    if status == "perlu_template":
        return "gagal", f"Belum bisa untuk {untuk}. {str(rinci.get('pesan') or 'File belum bisa dibaca; template kolomnya belum ada.')[:160]}"
    return "gagal", f"Gagal untuk {untuk}. {str(rinci.get('pesan') or 'Prosesnya berhenti sebelum selesai.')[:160]}"


def _jalankan_terpantau(wa_id: int, user: Dict[str, Any], klien: Dict[str, Any], halaman: str,
                        agen: str, pemilik_kantor: str, tugas_id: str) -> None:
    """Menjalankan _jalankan() apa adanya; setelah selesai (apa pun hasilnya) agen dipulangkan ke meja rapat
    dan ringkasan hasil dititipkan untuk diumumkan Neo."""
    kode, kalimat = "gagal", "Proses selesai tetapi hasilnya tidak terbaca. Cek tab Posted halaman itu."
    # [ATURAN MUTLAK] Agen duduk di meja kerja SELAMA pipeline berjalan, berapa lama pun, walau aplikasi di-reload/ditutup:
    # detak jantung memperpanjang masa tugas tiap 60 detik selagi thread hidup. Berhenti begitu pipeline selesai.
    selesai = threading.Event()
    mulai_mono = time.monotonic()

    def _detak() -> None:
        import kantor_tugas_route as kt_
        while not selesai.wait(DETAK_AGEN_DETIK):
            try:
                kt_.perpanjang_tugas_wa(pemilik_kantor, tugas_id)
            except Exception:  # noqa: BLE001
                logger.exception("neo_wa_pipeline detak agen gagal id=%s", wa_id)

    threading.Thread(target=_detak, daemon=True, name=f"neo-wa-detak-{wa_id}").start()
    try:
        _jalankan(wa_id, user, klien, halaman)
    except BaseException:  # noqa: BLE001  (thread: jangan sampai agen tersangkut di meja)
        logger.exception("neo_wa_pipeline terpantau id=%s halaman=%s", wa_id, halaman)
    finally:
        selesai.set()
    try:
        with dbc.engine.begin() as conn:
            r = conn.execute(text("select status_proses, hasil_proses from wa_file_masuk where id = :i"), {"i": wa_id}).mappings().first()
        status = r["status_proses"] if r else None
        rinci = json.loads(r["hasil_proses"]) if r and r["hasil_proses"] else {}
        if status == "diproses":      # _jalankan berhenti tanpa status akhir
            status, rinci = "gagal", {**rinci, "pesan": "Prosesnya berhenti sebelum selesai."}
        kode, kalimat = _ringkas_hasil(status, rinci, halaman, klien.get("client_code"))
    except Exception:  # noqa: BLE001
        logger.exception("neo_wa_pipeline ringkasan id=%s", wa_id)
    # [BARU] Tahan agen di meja kerja sampai cukup lama supaya perjalanan dari meja meeting terlihat; setelah itu baru pulang.
    sisa = MIN_TAMPIL_AGEN_DETIK - (time.monotonic() - mulai_mono)
    if sisa > 0:
        try:
            time.sleep(sisa)
        except Exception:  # noqa: BLE001
            pass
    try:
        import kantor_tugas_route as kt
        awal = {"ok": f"{agen} sudah selesai.", "sebagian": f"{agen} selesai, tapi tidak semuanya terposting.",
                "gagal": f"{agen} tidak bisa menyelesaikannya."}[kode]
        kt.akhiri_tugas_wa(pemilik_kantor, tugas_id, kode, klien.get("client_code"), f"{awal} {kalimat}")
    except Exception:  # noqa: BLE001
        logger.exception("neo_wa_pipeline gagal memulangkan agen id=%s", wa_id)


def _jalankan(wa_id: int, user: Dict[str, Any], klien: Dict[str, Any], halaman: str = "sales") -> None:
    hasil: Dict[str, Any] = {"halaman": halaman, "klien": klien.get("client_code"), "tahap": "mulai"}
    if halaman == "cash_bank":
        return _jalankan_bank(wa_id, user, klien, hasil)
    if halaman == "other":
        return _jalankan_other(wa_id, user, klien, hasil)
    try:
        from starlette.datastructures import UploadFile
        _, f_upload, f_promote = _modul(halaman)

        with dbc.engine.begin() as conn:
            r = conn.execute(text("select nama_file, source_file_id from wa_file_masuk where id = :i"), {"i": wa_id}).mappings().first()
        nama, sf_id = (r["nama_file"] or "file"), r["source_file_id"]

        # 1) UPLOAD
        if not sf_id:
            hasil["tahap"] = "upload"; _catat(wa_id, "diproses", hasil)
            path = _pastikan_lokal(wa_id)
            with open(path, "rb") as f:
                isi = f.read()
            resp = asyncio.run(f_upload(file=UploadFile(file=io.BytesIO(isi), filename=nama),
                                        management_client_id=klien["id"], current_user=user))
            body = _json(resp)
            if resp.status_code >= 400 or body.get("status") == "error":
                raise _Berhenti("gagal", f"Upload ditolak: {body.get('message') or resp.status_code}")
            d = body.get("data") or {}
            sf_id = str(d.get("id") or "")
            if not sf_id:
                raise _Berhenti("gagal", "Upload selesai tetapi id file di Source Data tidak terbaca.")
            _catat(wa_id, "diproses", hasil, source_file_id=sf_id)
            hasil["baris_terbaca"] = d.get("rows_extracted")
            if not d.get("template_matched") or not d.get("rows_extracted"):
                raise _Berhenti("perlu_template",
                                "File sudah tersimpan di Source Data tetapi belum ada template kolom yang cocok untuk klien ini, jadi barisnya belum terbaca. "
                                "Template harus dibuat dulu (untuk PDF: harus punya teks, bukan hasil scan).")
            if d.get("status_ekstraksi") == "Gagal":
                raise _Berhenti("gagal", "Template ditemukan tetapi ekstraksi file gagal.")

        # 2) BUAT TRANSAKSI (promote)
        hasil["tahap"] = "buat_transaksi"; _catat(wa_id, "diproses", hasil)
        resp = f_promote(sf_id, user)
        body = _json(resp)
        if resp.status_code >= 400 or body.get("status") == "error":
            raise _Berhenti("gagal", f"Pembuatan transaksi gagal: {body.get('message') or resp.status_code}")
        hasil["buat_transaksi"] = body.get("data") or {}

        # 3) APPROVE + POST
        hasil["tahap"] = "posting"
        if halaman == "sales":
            _posting(wa_id, user, klien, sf_id, hasil)
        else:
            _posting_massal(wa_id, user, sf_id, halaman, hasil)
    except _Berhenti as b:
        hasil["pesan"] = b.pesan
        _catat(wa_id, b.status, hasil, selesai=True)
    except Exception as e:  # noqa: BLE001
        logger.exception("neo_wa_pipeline id=%s halaman=%s gagal", wa_id, halaman)
        hasil["pesan"] = f"Error tak terduga: {str(e)[:150]}"
        _catat(wa_id, "gagal", hasil, selesai=True)


def _posting_cepat(user: Dict[str, Any], klien: Dict[str, Any], daftar: List[Dict[str, Any]],
                   hasil: Dict[str, Any], wa_id: int) -> tuple:
    """[BARU] Approve + Post MASSAL ("select all"): satu query per tahap, bukan ~10 query per invoice.
    Aturannya sama dengan pastikan_mapping_sales + validasi_posting_sales (dihitung di memori), lalu satu UPDATE per
    potongan invoice. Return (diposting, gagal, alasan_hitung, sisa) -- `sisa` = invoice yang tidak bisa diproses
    massal (mis. potongan error) dan harus diulang oleh jalur lama per invoice."""
    uid = user.get("id")
    pelaku = f"{AGEN_UPLOAD_SALES} ({user.get('nama') or user.get('username') or 'pengguna'})"
    ids = [x["id"] for x in daftar]
    diposting, gagal, alasan_hitung, sisa = 0, 0, {}, []
    if not ids:
        return diposting, gagal, alasan_hitung, sisa

    def _alasan(k: str, n: int = 1) -> None:
        k = k[:120]
        alasan_hitung[k] = alasan_hitung.get(k, 0) + n

    with dbc.engine.begin() as conn:
        inv = {r["id"]: dict(r) for r in conn.execute(text("""
            select CAST(id AS text) as id, CAST(management_client_id AS text) as mc, cabang,
                   coalesce(dpp,0) as dpp, coalesce(ppn,0) as ppn
              from financial_transaction_sales_invoices where CAST(id AS text) = ANY(:ids)"""), {"ids": ids}).mappings().all()}
        mapping = {r["invoice_id"]: dict(r) for r in conn.execute(text("""
            select CAST(invoice_id AS text) as invoice_id, piutang_account_code, pendapatan_account_code,
                   ppn_account_code, pph_account_code
              from financial_transaction_sales_account_mappings
             where CAST(invoice_id AS text) = ANY(:ids) and deleted_at is null"""), {"ids": ids}).mappings().all()}
        coa_per_klien: Dict[str, set] = {}
        for mc in {v["mc"] for v in inv.values() if v["mc"]}:
            coa_per_klien[mc] = {r[0] for r in conn.execute(text(
                "select acc_no from management_client_coa where CAST(client_id AS text) = :c and deleted_at is null"), {"c": mc}).all()}

    # mapping yang belum ada: dibuat sekali per (klien, cabang), lalu di-insert massal
    akun_cache: Dict[tuple, Any] = {}
    baru = []
    for i in ids:
        v = inv.get(i)
        if not v or i in mapping:
            continue
        kunci = (v["mc"], (v["cabang"] or ""))
        if kunci not in akun_cache:
            akun_cache[kunci] = dbc.akun_default_sales(v["mc"], v["cabang"])
        a = akun_cache[kunci]
        if not a:
            continue
        baru.append({"c": klien["id"], "i": i, "pc": a["piutang"][0], "pn": a["piutang"][1],
                     "rc": a["pendapatan"][0], "rn": a["pendapatan"][1],
                     "xc": a["ppn"][0] if a["ppn"] else None, "xn": a["ppn"][1] if a["ppn"] else None, "u": uid})
        mapping[i] = {"invoice_id": i, "piutang_account_code": a["piutang"][0], "pendapatan_account_code": a["pendapatan"][0],
                      "ppn_account_code": a["ppn"][0] if a["ppn"] else None, "pph_account_code": None}
    for k in range(0, len(baru), 500):
        with dbc.engine.begin() as conn:
            conn.execute(text("""
                insert into financial_transaction_sales_account_mappings
                  (client_id, invoice_id, piutang_account_code, piutang_account_name, pendapatan_account_code,
                   pendapatan_account_name, ppn_account_code, ppn_account_name, is_ai_suggested, mapped_by, created_by)
                values (CAST(:c AS uuid), CAST(:i AS uuid), :pc, :pn, :rc, :rn, :xc, :xn, false, CAST(:u AS uuid), CAST(:u AS uuid))
                on conflict (invoice_id) do nothing"""), baru[k:k + 500])

    # validasi di memori (sama dengan validasi_posting_sales)
    lolos = []
    ppn_default = dbc._AKUN_DEFAULT_SALES["ppn"][0]
    for i in ids:
        v = inv.get(i)
        if not v:
            gagal += 1; _alasan("invoice tidak ditemukan"); continue
        coa = coa_per_klien.get(v["mc"] or "", set())
        if coa:
            m = mapping.get(i)
            if not m:
                gagal += 1; _alasan("Accounts are not mapped yet -- set the accounts in Journal Preview first."); continue
            dipakai = {m["piutang_account_code"], m["pendapatan_account_code"]}
            if float(v["ppn"]) > 0 or not float(v["dpp"]):
                dipakai.add(m.get("ppn_account_code") or ppn_default)
            if m.get("pph_account_code"):
                dipakai.add(m["pph_account_code"])
            hilang = sorted(k for k in dipakai if k and k not in coa)
            if hilang:
                gagal += 1; _alasan(f"Account(s) not found in the client's chart of accounts: {', '.join(hilang)}."); continue
        lolos.append(i)

    # Approved + Posted + activity log: satu UPDATE & satu INSERT per potongan
    nomor = {x["id"]: x["invoice_no"] for x in daftar}
    for k in range(0, len(lolos), 500):
        potong = lolos[k:k + 500]
        try:
            with dbc.engine.begin() as conn:
                conn.execute(text("""
                    update financial_transaction_sales_invoices
                       set posting_status = 'Posted', journal_sync_status = 'Synced', posted_at = now(),
                           posted_by = CAST(:u AS uuid), edited_at = now(), edited_by = CAST(:u AS uuid)
                     where CAST(id AS text) = ANY(:ids) and deleted_at is null"""), {"ids": potong, "u": uid})
                conn.execute(text("""
                    insert into financial_transaction_sales_activity_log
                      (client_id, invoice_id, event_type, description, reference_no, performed_by, created_by)
                    values (CAST(:c AS uuid), CAST(:i AS uuid), 'JOURNAL_SYNC',
                            'Jurnal disinkronkan ke General Ledger otomatis oleh Atlas (dari file WhatsApp, sudah diperiksa Atlas)', :n, :p, CAST(:u AS uuid))"""),
                    [{"c": klien["id"], "i": i, "n": nomor.get(i), "p": pelaku, "u": uid} for i in potong])
            diposting += len(potong)
        except Exception as e:  # noqa: BLE001
            logger.warning("posting massal sales gagal (potongan %s): %s -- diulang per invoice", k, e)
            sisa += [x for x in daftar if x["id"] in set(potong)]
        hasil.update({"diposting": diposting, "tidak_diposting": gagal})
        _catat(wa_id, "diproses", hasil)
    return diposting, gagal, alasan_hitung, sisa


def _posting(wa_id: int, user: Dict[str, Any], klien: Dict[str, Any], sf_id: str, hasil: Dict[str, Any]) -> None:
    uid = user.get("id")
    pelaku = f"{AGEN_UPLOAD_SALES} ({user.get('nama') or user.get('username') or 'pengguna'})"
    with dbc.engine.begin() as conn:
        daftar = conn.execute(text("""
            select CAST(i.id AS text) as id, i.invoice_no, i.posting_status
              from financial_transaction_sales_invoices i
              join financial_transaction_sales_source_rows r on r.id = i.source_row_id
             where r.source_file_id::text = :f and i.client_id = CAST(:c AS uuid) and i.deleted_at is null
               and i.posting_status in ('Draft', 'Review', 'Approved')
             order by i.invoice_date, i.invoice_no
        """), {"f": sf_id, "c": klien["id"]}).mappings().all()

    total, diposting, gagal = len(daftar), 0, 0
    alasan_hitung: Dict[str, int] = {}
    hasil.update({"menunggu_posting": total, "diposting": 0, "tidak_diposting": 0})

    # [BARU] ATLAS MEMERIKSA dulu sebelum Approve/Post (lihat atlas_audit_sales.py): invoice janggal ditahan di Draft,
    # yang bersih lanjut. FAIL-CLOSED: kalau pemeriksaan Atlas sendiri error, TIDAK ADA invoice yang diposting (semua tetap di
    # Draft) dan Neo melaporkannya. Memposting tanpa pemeriksaan lebih berbahaya daripada menunda.
    ids_semua = [x["id"] for x in daftar]
    try:
        import atlas_audit_sales as atlas
        hasil["tahap"] = "pemeriksaan_atlas"; _catat(wa_id, "diproses", hasil)
        paket = atlas.analisa(klien, ids_semua, sf_id, hasil.get("buat_transaksi"), hasil.get("baris_terbaca"))
        tahan = paket["tahan"]
        log_ok = atlas.catat_penahanan(klien, user, paket["temuan"], paket["putusan"]["tahan_semua"], ids_semua)
        for t in paket["temuan"]:
            if t["tingkat"] in ("blokir", "tinjau"):
                k = ("Atlas: " + t["pesan"])[:120]
                alasan_hitung[k] = alasan_hitung.get(k, 0) + 1
        if paket["putusan"]["tahan_semua"]:
            alasan_hitung["Atlas: seluruh file ditahan (terlalu banyak invoice janggal)"] = len(ids_semua)
        daftar = [x for x in daftar if x["id"] not in tahan]
        gagal += len(tahan)
        hasil["atlas"] = paket["hasil_atlas"]
        if log_ok is False:
            hasil["atlas"]["log_gagal"] = True      # invoice tetap ditahan; hanya catatan di activity log yang gagal tertulis
        hasil.update({"tidak_diposting": gagal})
        _catat(wa_id, "diproses", hasil)
    except Exception:  # noqa: BLE001
        logger.exception("pemeriksaan Atlas gagal id=%s; SEMUA invoice ditahan di Draft (tidak diposting)", wa_id)
        gagal += len(daftar)
        if daftar:
            alasan_hitung["Atlas gagal memeriksa file ini; invoice ditahan di Draft"] = len(daftar)
        hasil["atlas"] = {"error": "pemeriksaan Atlas gagal dijalankan", "total": len(ids_semua), "ditahan": len(daftar),
                          "tahan_semua": False, "gagal_periksa": True, "ringkas": [], "catatan_file": [], "catatan_kode": []}
        daftar = []
        hasil.update({"tidak_diposting": gagal})
        try:
            _catat(wa_id, "diproses", hasil)
        except Exception:  # noqa: BLE001
            logger.exception("gagal mencatat status setelah Atlas error id=%s", wa_id)

    # [BARU] jalur cepat (massal); jalur lama per invoice di bawah hanya untuk sisa yang gagal massal
    try:
        _gagal_atlas = gagal
        diposting, gagal, alasan_hitung_cepat, daftar = _posting_cepat(user, klien, daftar, hasil, wa_id)
        gagal += _gagal_atlas
        for k_, n_ in alasan_hitung_cepat.items():
            alasan_hitung[k_] = alasan_hitung.get(k_, 0) + n_
        hasil.update({"tidak_diposting": gagal})
    except Exception as e:  # noqa: BLE001
        logger.warning("jalur cepat posting sales gagal total, pakai jalur per invoice: %s", e)

    for n, inv in enumerate(daftar, 1):
        alasan: List[str] = []
        try:
            dbc.pastikan_mapping_sales(inv["id"], dibuat_oleh=uid)
            alasan = dbc.validasi_posting_sales(inv["id"])
            if not alasan:
                if inv["posting_status"] != "Approved":
                    if dbc.update_sales_invoice(inv["id"], {"posting_status": "Approved"}, updated_by=uid) is None:
                        alasan = ["gagal menyimpan status Approved"]
            if not alasan:
                ok = dbc.update_sales_invoice(inv["id"], {
                    "posting_status": "Posted", "journal_sync_status": "Synced",
                    "posted_at": datetime.now(), "posted_by": uid,
                }, updated_by=uid)
                if ok is None:
                    alasan = ["gagal menyimpan status Posted"]
                else:
                    dbc.create_sales_activity_log({
                        "client_id": klien["id"], "invoice_id": inv["id"], "event_type": "JOURNAL_SYNC",
                        "description": "Jurnal disinkronkan ke General Ledger otomatis oleh Atlas (dari file WhatsApp, sudah diperiksa Atlas)",
                        "reference_no": inv["invoice_no"], "performed_by": pelaku,
                    }, created_by=uid)
        except Exception as e:  # noqa: BLE001
            logger.warning("posting invoice %s gagal: %s", inv["invoice_no"], e)
            alasan = ["error saat memposting"]
        if alasan:
            gagal += 1
            k = alasan[0][:120]
            alasan_hitung[k] = alasan_hitung.get(k, 0) + 1
        else:
            diposting += 1
        if n % 10 == 0:
            hasil.update({"diposting": diposting, "tidak_diposting": gagal})
            _catat(wa_id, "diproses", hasil)

    try:   # [BARU] Atlas menguraikan jurnal yang terbentuk & memastikan Debit = Kredit
        import atlas_audit_sales as atlas
        atlas.tambah_jurnal(hasil, klien, ids_semua)
    except Exception:  # noqa: BLE001
        logger.exception("atlas uraian jurnal gagal id=%s", wa_id)
    hasil.update({"tahap": "selesai", "diposting": diposting, "tidak_diposting": gagal,
                  "alasan_tidak_diposting": sorted(alasan_hitung.items(), key=lambda x: -x[1])[:3]})
    _catat(wa_id, "selesai_sebagian" if gagal else "selesai", hasil, selesai=True)


# ============================================================
# POSTING PURCHASE & JOURNAL ENTRY (fungsi db yang sama dengan tombol Approve / Post di layar)
# ============================================================
_KONFIG_MASSAL = {
    "purchase": {
        "sql": """
            select CAST(t.id AS text) as id, t.status, t.purchase_no as nomor
              from financial_transaction_purchase_source_rows r
              join financial_transaction_purchase_transactions t on t.id = r.transaction_id
             where r.source_file_id::text = :f and r.deleted_at is null and t.deleted_at is null
             order by t.purchase_date nulls last, t.purchase_no""",
        "ubah": lambda ids, aksi, nama, uid: dbc.ubah_status_purchase_transactions(ids, aksi, nama, oleh_id=uid),
        "bisa_approve": ("draft", "pending_review", "exception"),
    },
    "journal_entry": {
        "sql": """
            select CAST(d.id AS text) as id, d.status, d.je_number as nomor
              from financial_transaction_journal_entry_source_rows r
              join financial_transaction_journal_entry_drafts d on d.id = r.draft_id
             where r.source_file_id::text = :f and r.deleted_at is null and d.deleted_at is null
             order by d.entry_date, d.je_number""",
        "ubah": lambda ids, aksi, nama, uid: dbc.ubah_status_je_drafts(ids, aksi, nama, oleh_id=uid),
        "bisa_approve": ("draft", "pending", "pending_review", "exception"),
    },
}
_BISA_POST = ("approved", "pending_posting")


def _posting_massal(wa_id: int, user: Dict[str, Any], sf_id: str, halaman: str, hasil: Dict[str, Any]) -> None:
    cfg = _KONFIG_MASSAL[halaman]
    uid = user.get("id")
    pelaku = f"Neo ({user.get('nama') or user.get('username') or 'pengguna'})"
    with dbc.engine.begin() as conn:
        daftar = [dict(x) for x in conn.execute(text(cfg["sql"]), {"f": sf_id}).mappings().all()]
    belum = [x for x in daftar if x["status"] != "posted"]

    diposting = sum(1 for x in daftar if x["status"] == "posted")   # sisa proses sebelumnya (diulang)
    gagal = 0
    alasan_hitung: Dict[str, int] = {}
    hasil.update({"total": len(daftar), "menunggu_posting": len(belum), "diposting": diposting, "tidak_diposting": 0})

    def _catat_alasan(daftar_skip: List[Dict[str, Any]]) -> int:
        for sk in daftar_skip:
            k = str(sk.get("reason") or "tidak diketahui")[:120]
            alasan_hitung[k] = alasan_hitung.get(k, 0) + 1
        return len(daftar_skip)

    for i in range(0, len(belum), BATCH_POST):
        potong = belum[i:i + BATCH_POST]
        siap_post = [x["id"] for x in potong if x["status"] in _BISA_POST]
        mau_approve = [x["id"] for x in potong if x["status"] in cfg["bisa_approve"]]
        lain = [x for x in potong if x["status"] not in _BISA_POST and x["status"] not in cfg["bisa_approve"]]
        for x in lain:  # mis. rejected: bukan tugas Neo membukanya kembali
            gagal += _catat_alasan([{"reason": f"status '{x['status']}' tidak bisa diproses otomatis"}])
        try:
            if mau_approve:
                r = cfg["ubah"](mau_approve, "approve", pelaku, uid)
                siap_post += [str(d.get("id")) for d in r.get("done", [])]
                gagal += _catat_alasan(r.get("skipped", []))
            if siap_post:
                r = cfg["ubah"](siap_post, "post", pelaku, uid)
                diposting += len(r.get("done", []))
                gagal += _catat_alasan(r.get("skipped", []))
        except Exception as e:  # noqa: BLE001
            logger.warning("posting massal %s gagal: %s", halaman, e)
            gagal += _catat_alasan([{"reason": "error saat approve/post"} for _ in (siap_post or mau_approve)])
        hasil.update({"diposting": diposting, "tidak_diposting": gagal})
        _catat(wa_id, "diproses", hasil)

    hasil.update({"tahap": "selesai", "diposting": diposting, "tidak_diposting": gagal,
                  "alasan_tidak_diposting": sorted(alasan_hitung.items(), key=lambda x: -x[1])[:3]})
    _catat(wa_id, "selesai_sebagian" if gagal else "selesai", hasil, selesai=True)


# ============================================================
# UTIL: baca respons JSON dari fungsi endpoint
# ============================================================
def _hitung_aksi(resp: Any) -> tuple:
    """(jumlah berhasil, daftar gagal [{reason}]) dari respons endpoint approve/post/submit."""
    b = _json(resp)
    if b.get("status") == "success":
        d = b.get("data") or {}
        return len(d.get("done") or []), list(d.get("failed") or d.get("skipped") or [])
    det = (b.get("errors") or {}).get("detail") if isinstance(b.get("errors"), dict) else None
    if det:
        return 0, list(det)
    return 0, [{"reason": str(b.get("message") or "gagal")[:120]}]


def _tambah_alasan(hitung: Dict[str, int], daftar: List[Dict[str, Any]]) -> int:
    for sk in daftar:
        k = str(sk.get("reason") or "tidak diketahui")[:120]
        hitung[k] = hitung.get(k, 0) + 1
    return len(daftar)


def _baca_file(wa_id: int) -> tuple:
    with dbc.engine.begin() as conn:
        r = conn.execute(text("select nama_file, source_file_id from wa_file_masuk where id = :i"), {"i": wa_id}).mappings().first()
    return (r["nama_file"] or "file"), (r["source_file_id"] if r else None)


# ============================================================
# CASH & BANK: upload rekening koran -> auto-match -> Approve -> Post
# ============================================================
def _jalankan_bank(wa_id: int, user: Dict[str, Any], klien: Dict[str, Any], hasil: Dict[str, Any]) -> None:
    try:
        from modules.transactions import bank_cash_willi as bcw
        from starlette.datastructures import UploadFile
        nama, st_id = _baca_file(wa_id)
        kid = klien["id"]

        # 1) UPLOAD (sama seperti layar Source Data: hanya langsung diimport kalau pola dikenal & saldo cocok)
        if not st_id:
            hasil["tahap"] = "upload"; _catat(wa_id, "diproses", hasil)
            path = _pastikan_lokal(wa_id)
            with open(path, "rb") as f:
                isi = f.read()

            def _file() -> Any:
                return UploadFile(file=io.BytesIO(isi), filename=nama)

            resp = asyncio.run(bcw.preview_statement(client_id=kid, bank_coa_id=None, file=_file(), mapping_rules=None, current_user=user))
            pv = _json(resp)
            if resp.status_code >= 400 or pv.get("status") == "error":
                raise _Berhenti("gagal", f"Rekening koran tidak terbaca: {pv.get('message') or resp.status_code}")
            d = pv.get("data") or {}
            if d.get("already_uploaded_on"):
                raise _Berhenti("gagal", "Rekening koran ini sudah pernah diunggah untuk akun tersebut.")
            if not (d.get("template_matched") and (d.get("validation") or {}).get("status") == "verified"
                    and not (d.get("bank_mapping") or {}).get("conflict")):
                raise _Berhenti("perlu_template",
                                "Rekening koran belum dikenali polanya, saldonya belum cocok, atau akun banknya belum jelas. Neo tidak mengimpor file seperti ini; "
                                "harus dicek manual di tab Source Data (Cash dan Bank) dulu.")
            resp = asyncio.run(bcw.upload_statement(client_id=kid, bank_coa_id=d.get("bank_coa_id"), file=_file(), mapping_rules=None,
                                                    save_template=True, save_mapping=True, current_user=user))
            body = _json(resp)
            if resp.status_code >= 400 or body.get("status") == "error":
                raise _Berhenti("gagal", f"Upload ditolak: {body.get('message') or resp.status_code}")
            d = body.get("data") or {}
            st_id = str(d.get("statement_id") or "")
            if not st_id:
                raise _Berhenti("gagal", "Upload selesai tetapi id rekening koran tidak terbaca.")
            _catat(wa_id, "diproses", hasil, source_file_id=st_id)
            hasil["mutasi_diimpor"] = d.get("imported")
            hasil["baris_perlu_review"] = (d.get("confidence") or {}).get("low", 0)

        # 2) AUTO-MATCH (hanya mutasi yang kandidat invoicenya pasti; sama seperti tombol Auto-match)
        hasil["tahap"] = "cocokkan"; _catat(wa_id, "diproses", hasil)
        resp = bcw.auto_cocokkan(bcw.KlienRequest(client_id=kid), user)
        body = _json(resp)
        if resp.status_code >= 400 or body.get("status") == "error":
            raise _Berhenti("gagal", f"Auto-match gagal: {body.get('message') or resp.status_code}")
        hasil["dicocokkan_otomatis"] = len((body.get("data") or {}).get("matched") or [])

        # 3) APPROVE + POST transaksi hasil pencocokan DARI rekening koran ini saja
        hasil["tahap"] = "posting"; _catat(wa_id, "diproses", hasil)
        pelaku = user
        with dbc.engine.begin() as conn:
            hasil["mutasi_belum_cocok"] = conn.execute(text(
                "select count(*) from financial_transaction_bank_cash_mutations "
                "where statement_id::text = :s and deleted_at is null and status = 'unmatched'"), {"s": st_id}).scalar() or 0
            daftar = [dict(x) for x in conn.execute(text("""
                select CAST(t.id AS text) as id, t.status
                  from financial_transaction_bank_cash_transactions t
                  join financial_transaction_bank_cash_mutations m on m.id = t.mutation_id
                 where m.statement_id::text = :s and t.deleted_at is null and t.status in ('draft', 'approved')
                 order by t.tx_date, t.tx_number"""), {"s": st_id}).mappings().all()]
        diposting, gagal, alasan = 0, 0, {}
        hasil.update({"menunggu_posting": len(daftar), "diposting": 0, "tidak_diposting": 0})
        for i in range(0, len(daftar), BATCH_POST):
            potong = daftar[i:i + BATCH_POST]
            ids_draft = [x["id"] for x in potong if x["status"] == "draft"]
            siap = [x["id"] for x in potong if x["status"] == "approved"]
            if ids_draft:
                ok, bad = _hitung_aksi(bcw.approve_transaksi(bcw.AksiStatusRequest(client_id=kid, ids=ids_draft), pelaku))
                gagal += _tambah_alasan(alasan, bad)
                with dbc.engine.begin() as conn:
                    siap += [r[0] for r in conn.execute(text(
                        "select CAST(id AS text) from financial_transaction_bank_cash_transactions where id::text = any(:ids) and status = 'approved'"),
                        {"ids": ids_draft}).all()]
            if siap:
                ok, bad = _hitung_aksi(bcw.post_transaksi(bcw.AksiStatusRequest(client_id=kid, ids=siap), pelaku))
                diposting += ok
                gagal += _tambah_alasan(alasan, bad)
            hasil.update({"diposting": diposting, "tidak_diposting": gagal})
            _catat(wa_id, "diproses", hasil)
        hasil.update({"tahap": "selesai", "diposting": diposting, "tidak_diposting": gagal,
                      "alasan_tidak_diposting": sorted(alasan.items(), key=lambda x: -x[1])[:3]})
        sebagian = bool(gagal or hasil.get("mutasi_belum_cocok") or hasil.get("baris_perlu_review"))
        _catat(wa_id, "selesai_sebagian" if sebagian else "selesai", hasil, selesai=True)
    except _Berhenti as b:
        hasil["pesan"] = b.pesan
        _catat(wa_id, b.status, hasil, selesai=True)
    except Exception as e:  # noqa: BLE001
        logger.exception("neo_wa_pipeline bank id=%s gagal", wa_id)
        hasil["pesan"] = f"Error tak terduga: {str(e)[:150]}"
        _catat(wa_id, "gagal", hasil, selesai=True)


# ============================================================
# OTHER: baca CSV/Excel -> import draft -> Submit -> Approve -> Post
# (parser meniru OtherImportModal.tsx di layar)
# ============================================================
def _norm(h: Any) -> str:
    return re.sub(r"[_\s./]+", "", str(h or "").strip().lower())


_KOLOM_OTHER = [
    ("type_key", ["type", "transaction type", "jenis"], True),
    ("subtype", ["subtype", "sub type", "transaction subtype"], False),
    ("journal_date", ["date", "transaction date", "tanggal"], True),
    ("reference_no", ["reference", "reference no", "ref"], False),
    ("counterparty", ["counterparty", "party", "employee", "vendor", "lender", "investor"], False),
    ("description", ["description", "purpose", "keterangan"], False),
    ("amount", ["amount", "nominal", "total"], True),
    ("extra_amount", ["extra amount", "interest portion", "apic portion", "interest"], False),
    ("main_account", ["main account", "account", "debit account"], False),
    ("bank_account", ["bank account", "bank", "cash account"], False),
    ("offset_account", ["offset account", "credit account", "expense account"], False),
    ("extra_account", ["extra account", "interest account", "apic account"], False),
    ("branch", ["branch", "cabang"], False), ("department", ["department", "departemen"], False),
    ("project", ["project", "proyek"], False), ("cost_center", ["cost center", "cost centre"], False),
    ("due_date", ["due date", "maturity date", "settlement due date"], False), ("notes", ["notes", "catatan"], False),
]


def _tanggal(v: Any) -> Optional[str]:
    from datetime import date as _d, datetime as _dt
    if v is None or v == "":
        return None
    if isinstance(v, _dt):
        return v.date().isoformat()
    if isinstance(v, _d):
        return v.isoformat()
    if isinstance(v, (int, float)):
        try:
            return (_dt(1899, 12, 30) + __import__("datetime").timedelta(days=float(v))).date().isoformat()
        except Exception:  # noqa: BLE001
            return None
    t = str(v).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", t):
        return t[:10]
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", t)
    return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}" if m else None


def _angka(v: Any) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    t = re.sub(r"[^\d,.-]", "", str(v or "").strip())
    if not t:
        return 0.0
    t = t.replace(".", "").replace(",", ".") if re.search(r",\d{1,2}$", t) else t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _baca_tabel(path: str) -> List[Dict[str, Any]]:
    ext = path.lower().rsplit(".", 1)[-1]
    if ext == "csv":
        import csv
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
            contoh = f.read(4096); f.seek(0)
            try:
                dialek = csv.Sniffer().sniff(contoh, delimiters=",;\t")
            except csv.Error:
                dialek = csv.excel
            return [dict(r) for r in csv.DictReader(f, dialect=dialek)]
    if ext in ("xlsx", "xls"):
        import pandas as pd
        df = pd.read_excel(path, sheet_name=0, dtype=object).fillna("")
        return df.to_dict("records")
    raise _Berhenti("gagal", "Halaman Other hanya menerima file CSV atau Excel, bukan PDF.")


def _jalankan_other(wa_id: int, user: Dict[str, Any], klien: Dict[str, Any], hasil: Dict[str, Any]) -> None:
    try:
        from modules.assets_and_equity import other_transactions_v1 as ot
        nama, _ = _baca_file(wa_id)
        kid = klien["id"]
        hasil["tahap"] = "baca_file"; _catat(wa_id, "diproses", hasil)
        json_rows = _baca_tabel(_pastikan_lokal(wa_id))
        if not json_rows:
            raise _Berhenti("gagal", "File tidak berisi baris data.")
        header = list(json_rows[0].keys())
        peta: Dict[str, Any] = {}
        for fld, alias, _w in _KOLOM_OTHER:
            cocok = {_norm(a) for a in alias + [fld]}
            h = next((x for x in header if _norm(x) in cocok), None)
            if h is not None:
                peta[fld] = h
        kurang = [fld for fld, _a, wajib in _KOLOM_OTHER if wajib and fld not in peta]
        if kurang:
            raise _Berhenti("perlu_template", "Kolom wajib tidak ada di file: " + ", ".join(kurang) + ". Kolom yang dibutuhkan: Type, Date, Amount.")

        jenis: Dict[str, Any] = {}
        for k, j in ot.JENIS.items():
            subs = {}
            for sk, sv in j.sub.items():
                subs[_norm(sk)] = sk; subs[_norm(sv.label)] = sk
            for nm in (k, j.name, j.code):
                jenis[_norm(nm)] = (k, subs)

        ambil = lambda r, f: r.get(peta[f], "") if f in peta else ""
        teks = lambda r, f: (str(ambil(r, f) if ambil(r, f) is not None else "").strip() or None)
        baris, gagal_baca = [], []
        for i, r in enumerate(json_rows):
            err = []
            j = jenis.get(_norm(ambil(r, "type_key")))
            if not j:
                err.append("Unknown type")
            sub_raw = teks(r, "subtype")
            sub = j[1].get(_norm(sub_raw)) if (sub_raw and j) else None
            if sub_raw and j and not sub:
                err.append("Unknown subtype")
            tgl = _tanggal(ambil(r, "journal_date"))
            if not tgl:
                err.append("Invalid date")
            amt = _angka(ambil(r, "amount"))
            if amt <= 0:
                err.append("Amount must be > 0")
            if err:
                gagal_baca.append({"row": i + 2, "reason": ", ".join(err)})
                continue
            baris.append({"row": i + 2, "type_key": j[0], "subtype": sub, "journal_date": tgl, "reference_no": teks(r, "reference_no"),
                          "counterparty": teks(r, "counterparty"), "description": teks(r, "description"), "amount": amt,
                          "extra_amount": _angka(ambil(r, "extra_amount")), **{f: teks(r, f) for f in
                          ("main_account", "bank_account", "offset_account", "extra_account", "branch", "department", "project", "cost_center", "notes")},
                          "due_date": _tanggal(ambil(r, "due_date"))})
        hasil["baris_terbaca"] = len(json_rows)
        if not baris:
            raise _Berhenti("gagal", "Tidak ada baris yang valid. Contoh masalah: " + "; ".join(f"baris {g['row']}: {g['reason']}" for g in gagal_baca[:3]))

        # lewati baris yang sudah pernah diimpor (proses bisa diulang tanpa dobel)
        tgl_min, tgl_maks = min(b["journal_date"] for b in baris), max(b["journal_date"] for b in baris)
        with dbc.engine.begin() as conn:
            ada = {(x[0], str(x[1]), round(float(x[2]), 2), x[3] or "", x[4] or "") for x in conn.execute(text("""
                select type_key, journal_date, amount, coalesce(reference_no, ''), coalesce(counterparty, '')
                  from asset_other_transactions
                 where client_id = CAST(:c AS uuid) and deleted_at is null and journal_date between :a and :b"""),
                {"c": kid, "a": tgl_min, "b": tgl_maks}).all()}
        baru = [b for b in baris if (b["type_key"], b["journal_date"], round(b["amount"], 2), b["reference_no"] or "", b["counterparty"] or "") not in ada]
        hasil["sudah_ada_dilewati"] = len(baris) - len(baru)

        # IMPORT -> draft
        nomor: List[str] = []
        alasan_impor: Dict[str, int] = {}
        hasil["tahap"] = "import"; _catat(wa_id, "diproses", hasil)
        for i in range(0, len(baru), 500):
            potong = baru[i:i + 500]
            try:
                req = ot.ImportRequest(client_id=kid, rows=[ot.BarisImport(**b) for b in potong])
            except Exception as e:  # noqa: BLE001
                raise _Berhenti("gagal", f"Isi file tidak lolos validasi: {str(e).splitlines()[-1][:120]}")
            resp = ot.impor(req, user)
            body = _json(resp)
            if body.get("status") == "success":
                d = body.get("data") or {}
                nomor += list(d.get("created") or [])
                _tambah_alasan(alasan_impor, d.get("failed") or [])
            else:
                det = (body.get("errors") or {}).get("detail") if isinstance(body.get("errors"), dict) else None
                _tambah_alasan(alasan_impor, det or [{"reason": body.get("message")}])
        _tambah_alasan(alasan_impor, gagal_baca)
        hasil["draft_dibuat"] = len(nomor)
        hasil["baris_gagal_impor"] = sum(alasan_impor.values())

        # SUBMIT -> APPROVE -> POST per batch
        hasil["tahap"] = "posting"; _catat(wa_id, "diproses", hasil)
        alasan: Dict[str, int] = {}
        diposting = gagal = 0
        hasil.update({"menunggu_posting": len(nomor), "diposting": 0, "tidak_diposting": 0})
        for i in range(0, len(nomor), BATCH_POST):
            nos = nomor[i:i + BATCH_POST]
            def _status() -> Dict[str, str]:
                with dbc.engine.begin() as conn:
                    return {r[0]: r[1] for r in conn.execute(text(
                        "select CAST(id AS text), status from asset_other_transactions where client_id = CAST(:c AS uuid) and journal_no = any(:n) and deleted_at is null"),
                        {"c": kid, "n": nos}).all()}
            for status_awal, fungsi in (("draft", ot.ajukan), ("pending_review", ot.setujui), ("approved", ot.posting)):
                ids = [k for k, v in _status().items() if v == status_awal]
                if ids:
                    _hitung_aksi(fungsi(ot.AksiRequest(client_id=kid, ids=ids), user))  # alasan gagal dibaca dari status tersisa
            sisa = _status()
            diposting += sum(1 for v in sisa.values() if v == "posted")
            for k, v in sisa.items():
                if v != "posted":
                    gagal += 1
                    _tambah_alasan(alasan, [{"reason": f"berhenti di status '{v}' (cek tab Review Queue atau Journal Preview)"}])
            hasil.update({"diposting": diposting, "tidak_diposting": gagal})
            _catat(wa_id, "diproses", hasil)

        gabung = dict(alasan)
        for k, v in alasan_impor.items():
            gabung[k] = gabung.get(k, 0) + v
        hasil.update({"tahap": "selesai", "diposting": diposting, "tidak_diposting": gagal + hasil["baris_gagal_impor"],
                      "alasan_tidak_diposting": sorted(gabung.items(), key=lambda x: -x[1])[:3]})
        _catat(wa_id, "selesai_sebagian" if hasil["tidak_diposting"] else "selesai", hasil, selesai=True)
    except _Berhenti as b:
        hasil["pesan"] = b.pesan
        _catat(wa_id, b.status, hasil, selesai=True)
    except Exception as e:  # noqa: BLE001
        logger.exception("neo_wa_pipeline other id=%s gagal", wa_id)
        hasil["pesan"] = f"Error tak terduga: {str(e)[:150]}"
        _catat(wa_id, "gagal", hasil, selesai=True)