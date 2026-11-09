"""
atlas_audit_sales.py
====================
Atlas = "master expert accounting" untuk upload file di halaman SALES.

Atlas TIDAK hanya upload -> approve -> post. Sebelum Approve/Post, Atlas memeriksa invoice yang baru dibuat dari file itu
seperti auditor: angka tidak masuk akal, tanggal janggal, dobel, tarif PPN aneh, nilai pencilan, dan selisih total
antara isi file dengan invoice yang terbentuk.

Prinsip "langkah terbaik" (konservatif, sesuai praktik akuntansi):
  * Atlas TIDAK PERNAH mengubah angka / tanggal / customer diam-diam.
  * Invoice yang bersih tetap lanjut Approve -> Post (pekerjaan tidak terhenti karena satu baris bermasalah).
  * Invoice yang janggal DITAHAN di status Draft (tidak di-approve, tidak diposting) + dicatat di activity log
    (event ATLAS_HOLD) supaya manusia yang memutuskan.
  * Kalau terlalu banyak invoice janggal (> BATAS_FILE_CURIGA), seluruh file ditahan: kemungkinan salah klien,
    salah periode, atau salah format template, dan memposting sisanya justru berbahaya.
  * Semua temuan masuk hasil_proses (kunci `temuan_atlas`) dan diumumkan Neo.

Semua pemeriksaan deterministik (bisa diaudit & diulang), tanpa memanggil model bahasa.

[V2] Atlas bekerja seperti akuntan: ia mengerjakan BUKU KERJA bertahap dan paham alasan akuntansi tiap tahap:
  1 Penerimaan file & template        5 Pajak (PPN)
  2 Pembentukan invoice               6 Klasifikasi akun (Piutang=ASSET, Pendapatan=REVENUE, PPN=LIABILITY)
  3 Periode & cut-off (periode ditutup) 7 Review analitis (bandingkan riwayat klien, pencilan, Benford)
  4 Validitas dokumen                 8 Keputusan -> 9 Jurnal (Dr = Cr)
Hasilnya (`hasil["atlas"]["langkah"]`) bisa dijelaskan Atlas/Neo: apa yang dikerjakan, kenapa, dan hasilnya.
"""
import difflib
import logging
import math
import re
import statistics
import uuid
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import text

import db_client as dbc

logger = logging.getLogger("atlas_audit_sales")

NAMA_AGEN = "Atlas"
TOLERANSI_RUPIAH = 1.0          # selisih pembulatan yang dimaklumi
BATAS_FILE_CURIGA = 0.30        # > 30% invoice janggal (minimal MIN_FILE_CURIGA invoice) => seluruh file ditahan
MIN_FILE_CURIGA = 5
MIN_UNTUK_OUTLIER = 8
BATAS_USIA_HARI = 366           # invoice lebih tua dari ini => minta ditinjau
TARIF_PPN_WAJAR = (0.0, 0.11, 0.12)
TARIF_PPN_LAMA = (0.0, 0.10)    # sebelum 1 April 2022 tarif PPN 10%
TGL_PPN_11 = date(2022, 4, 1)
RIWAYAT_HARI = 400
MIN_RIWAYAT_BULAN = 3           # review analitis butuh minimal sekian bulan riwayat Posted
MIN_RIWAYAT_INVOICE = 30        # perbandingan customer / PPN butuh minimal sekian invoice Posted
BENFORD_MIN = 100
BENFORD_KRITIS = 20.09          # chi-square, df=8, alpha=0.01
# Customer "generik" = penjualan kasir/POS: satu nama customer dipakai untuk ratusan struk per hari, jadi nilai kembar itu wajar
# (bukan dobel). Dikenali dari awalan namanya ATAU dari kebiasaan data: >= MIN_STRUK_HARIAN invoice customer yang sama di hari yang sama.
GENERIK_AWALAN = ("penjualan pos", "penjualan harian", "penjualan tunai", "penjualan retail", "penjualan kasir", "pos -", "pos-",
                  "cash sales", "walk in", "walk-in", "customer umum", "pelanggan umum", "umum")
MIN_STRUK_HARIAN = 5
# Tarif pajak di luar 0/11/12% dianggap wajar kalau itu kebiasaan klien (mis. pajak restoran/PB1 ~10%): minimal sekian % dari riwayat
# Posted ber-pajak jatuh di tarif itu (dibulatkan 1 poin persen), dan tarif invoice baru berada dalam +-TOLERANSI_TARIF_POIN dari tarif itu.
SHARE_TARIF_KEBIASAAN = 0.05
TOLERANSI_TARIF_POIN = 1.0
CUSTOMER_KOSONG = {"", "-", "--", "n/a", "na", "null", "none", "unknown", "tanpa nama", "tidak ada"}

# kode temuan -> (tingkat, kalimat pendek untuk laporan)
KODE = {
    "total_tidak_cocok": ("blokir", "total tidak sama dengan DPP + PPN"),
    "nilai_nol": ("blokir", "nilai invoice nol"),
    "tanggal_masa_depan": ("blokir", "tanggal invoice di masa depan"),
    "nilai_negatif": ("tinjau", "nilai negatif (retur / credit note?)"),
    "tanggal_terlalu_lama": ("tinjau", "tanggal invoice lebih dari setahun lalu"),
    "customer_kosong": ("tinjau", "nama customer kosong atau tidak jelas"),
    "tarif_ppn_janggal": ("tinjau", "tarif PPN bukan 0%, 11%, atau 12%"),
    "nilai_pencilan": ("tinjau", "nilai jauh di atas invoice lain di file ini"),
    "dobel_dalam_file": ("tinjau", "mirip invoice lain di file yang sama (customer, tanggal, nilai sama)"),
    "dobel_sudah_posted": ("tinjau", "mirip invoice yang sudah diposting (customer, tanggal, nilai sama)"),
    "periode_terkunci": ("blokir", "tanggal invoice jatuh di periode yang sudah ditutup (Year-End Closing)"),
    "jatuh_tempo_sebelum_invoice": ("tinjau", "jatuh tempo lebih awal dari tanggal invoice"),
    "akun_salah_klasifikasi": ("blokir", "akun jurnal tidak sesuai jenisnya"),
    "akun_nonaktif": ("blokir", "akun jurnal berstatus nonaktif di COA klien"),
    "ppn_tidak_biasa": ("tinjau", "perlakuan PPN berbeda dari kebiasaan klien ini"),
    "customer_baru_nilai_besar": ("tinjau", "customer baru dengan nilai jauh di atas kebiasaan klien"),
    "cutoff_periode": ("tinjau", "tanggal jauh di luar periode utama file (cut-off)"),
}


# label SINGKAT untuk diucapkan Neo (laporan suara dibatasi ~300 karakter)
SINGKAT = {
    "total_tidak_cocok": "total tidak cocok", "nilai_nol": "nilai nol", "tanggal_masa_depan": "tanggal masa depan",
    "nilai_negatif": "nilai negatif", "tanggal_terlalu_lama": "tanggal terlalu lama", "customer_kosong": "customer kosong",
    "tarif_ppn_janggal": "tarif PPN janggal", "nilai_pencilan": "nilai terlalu besar", "dobel_dalam_file": "dobel di file",
    "dobel_sudah_posted": "mirip yang sudah posted",
    "periode_terkunci": "periode sudah ditutup", "jatuh_tempo_sebelum_invoice": "jatuh tempo janggal",
    "akun_salah_klasifikasi": "akun salah jenis", "akun_nonaktif": "akun nonaktif", "ppn_tidak_biasa": "PPN tidak biasa",
    "customer_baru_nilai_besar": "customer baru nilai besar", "cutoff_periode": "cut-off periode",
    "total_menyimpang_riwayat": "total menyimpang dari riwayat", "selisih_total_file": "selisih total file",
    "pola_angka_tidak_wajar": "pola angka tidak wajar", "lompatan_nomor": "nomor invoice terlewat",
    "npwp_kosong_ppn": "NPWP customer kosong", "nama_customer_mirip": "nama customer mirip",
}


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _rp(v: float) -> str:
    return "Rp " + f"{round(v):,}".replace(",", ".")


def _tarif_wajar(dpp: float, ppn: float, tgl: Optional[date] = None) -> bool:
    toleransi = max(TOLERANSI_RUPIAH, dpp * 0.002)
    tarif = TARIF_PPN_LAMA if isinstance(tgl, date) and tgl < TGL_PPN_11 else TARIF_PPN_WAJAR
    return any(abs(ppn - dpp * t) <= toleransi for t in tarif)


def _temuan(inv: Dict[str, Any], kode: str, rinci: str = "") -> Dict[str, Any]:
    tingkat, kalimat = KODE[kode]
    return {"invoice_id": inv["id"], "invoice_no": inv.get("invoice_no"), "kode": kode, "tingkat": tingkat,
            "pesan": kalimat + (f" ({rinci})" if rinci else "")}


def _ambil_invoice(ids: List[str]) -> List[Dict[str, Any]]:
    with dbc.engine.begin() as conn:
        rows = conn.execute(text("""
            select CAST(id AS text) as id, invoice_no, invoice_date, due_date, customer_name, customer_npwp, cabang,
                   coalesce(dpp, 0) as dpp, coalesce(ppn, 0) as ppn, coalesce(pph, 0) as pph,
                   coalesce(gross_amount, 0) as gross
              from financial_transaction_sales_invoices
             where CAST(id AS text) = ANY(:ids) and deleted_at is null
             order by invoice_no
        """), {"ids": ids}).mappings().all()
    return [dict(r) for r in rows]


def _dobel_sudah_posted(klien_id: str, ids: List[str]) -> Dict[str, str]:
    """{id invoice baru: nomor invoice Posted yang mirip}."""
    with dbc.engine.begin() as conn:
        rows = conn.execute(text("""
            select CAST(i.id AS text) as id, min(p.invoice_no) as no_lain
              from financial_transaction_sales_invoices i
              join financial_transaction_sales_invoices p
                on p.client_id = i.client_id
               and lower(coalesce(p.customer_name, '')) = lower(coalesce(i.customer_name, ''))
               and p.invoice_date = i.invoice_date
               and p.gross_amount = i.gross_amount
               and p.posting_status = 'Posted' and p.deleted_at is null
               and coalesce(p.is_opening_balance, false) = false
               and p.id <> i.id
             where CAST(i.id AS text) = ANY(:ids) and i.client_id = CAST(:c AS uuid) and i.gross_amount <> 0
             group by i.id
        """), {"ids": ids, "c": klien_id}).mappings().all()
    return {r["id"]: r["no_lain"] for r in rows}


def _customer_generik(nama: Any) -> bool:
    n = str(nama or "").strip().lower()
    return bool(n) and n.startswith(GENERIK_AWALAN)


def _customer_harian_banyak(klien_id: str) -> set:
    """Nama customer (huruf kecil) yang di riwayat Posted klien punya >= MIN_STRUK_HARIAN invoice pada satu tanggal (ciri penjualan kasir)."""
    with dbc.engine.begin() as conn:
        rows = conn.execute(text("""
            select lower(trim(coalesce(customer_name, ''))) as c
              from financial_transaction_sales_invoices
             where client_id = CAST(:c AS uuid) and posting_status = 'Posted' and deleted_at is null
               and coalesce(is_opening_balance, false) = false
             group by lower(trim(coalesce(customer_name, ''))), invoice_date
            having count(*) >= :n
        """), {"c": klien_id, "n": MIN_STRUK_HARIAN}).all()
    return {r[0] for r in rows if r[0]}


def _tarif_kebiasaan(riw: Optional[List[Dict[str, Any]]]) -> List[float]:
    """Tarif pajak (persen, dibulatkan 1 poin) yang lazim di riwayat Posted klien. Kosong kalau riwayat kurang."""
    if not riw or len(riw) < MIN_RIWAYAT_INVOICE:
        return []
    hitung: Counter = Counter()
    total = 0
    for r in riw:
        g, p = _f(r.get("g")), _f(r.get("p"))
        dpp = g - p
        if p > 0 and dpp > 0:
            hitung[round(p / dpp * 100)] += 1
            total += 1
    if total < MIN_RIWAYAT_INVOICE:
        return []
    return sorted(float(k) for k, v in hitung.items() if v / total >= SHARE_TARIF_KEBIASAAN)


def _tarif_lazim_klien(ppn: float, dpp: float, tarif_klien: List[float]) -> bool:
    if dpp <= 0:
        return False
    t = ppn / dpp * 100
    return any(abs(t - c) <= TOLERANSI_TARIF_POIN for c in tarif_klien)


def _tanggal_kunci(klien_id: str) -> Optional[date]:
    """Tanggal akhir periode yang sudah ditutup (Year-End Closing): transaksi s.d. tanggal ini tidak boleh diubah/diposting."""
    with dbc.engine.begin() as conn:
        return conn.execute(text(
            "select max(period_end) from management_client_fiscal_closings where CAST(client_id AS text) = :c and status = 'closed'"),
            {"c": klien_id}).scalar()


def _riwayat(klien_id: str, ids: List[str]) -> List[Dict[str, Any]]:
    """Invoice Posted klien (di luar file ini) setahun lebih terakhir: bahan review analitis."""
    with dbc.engine.begin() as conn:
        rows = conn.execute(text("""
            select lower(trim(coalesce(customer_name, ''))) as c, coalesce(gross_amount, 0) as g, coalesce(ppn, 0) as p, invoice_date as d
              from financial_transaction_sales_invoices
             where client_id = CAST(:c AS uuid) and posting_status = 'Posted' and deleted_at is null
               and coalesce(is_opening_balance, false) = false and CAST(id AS text) <> ALL(:ids)
               and invoice_date >= :dari
             order by invoice_date desc limit 20000
        """), {"c": klien_id, "ids": ids, "dari": date.today() - timedelta(days=RIWAYAT_HARI)}).mappings().all()
    return [dict(r) for r in rows]


def _periksa_klasifikasi(klien: Dict[str, Any], invoices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Akuntan memastikan akun di jurnal sesuai jenisnya: Piutang = ASSET, Pendapatan = REVENUE/OTHER INCOME, PPN Keluaran = LIABILITY,
    dan akunnya masih aktif. (Akun yang tidak ada di COA sudah ditangani validasi posting lama.)"""
    hasil: List[Dict[str, Any]] = []
    ids = [i["id"] for i in invoices]
    with dbc.engine.begin() as conn:
        mp = {r["invoice_id"]: dict(r) for r in conn.execute(text("""
            select CAST(invoice_id AS text) as invoice_id, piutang_account_code as pi, pendapatan_account_code as pe, ppn_account_code as pp
              from financial_transaction_sales_account_mappings
             where CAST(invoice_id AS text) = ANY(:ids) and deleted_at is null"""), {"ids": ids}).mappings().all()}
    default_cabang: Dict[Any, Any] = {}
    for inv in invoices:
        if inv["id"] in mp:
            continue
        if inv.get("cabang") not in default_cabang:
            try:
                a = dbc.akun_default_sales(klien["id"], inv.get("cabang"))
            except Exception:  # noqa: BLE001
                a = None
            default_cabang[inv.get("cabang")] = a
        a = default_cabang[inv.get("cabang")]
        if a:
            mp[inv["id"]] = {"invoice_id": inv["id"], "pi": a["piutang"][0], "pe": a["pendapatan"][0], "pp": a["ppn"][0] if a["ppn"] else None}
    kode = sorted({v for m in mp.values() for v in (m["pi"], m["pe"], m["pp"]) if v})
    if not kode:
        return hasil
    with dbc.engine.begin() as conn:
        coa = {r["acc_no"]: dict(r) for r in conn.execute(text("""
            select acc_no, upper(account_classification) as klas, coalesce(is_active, true) as aktif, account_name
              from management_client_coa
             where CAST(client_id AS text) = :c and deleted_at is null and acc_no = ANY(:k)"""), {"c": str(klien["id"]), "k": kode}).mappings().all()}
    aturan = (("pi", "Piutang", ("ASSET",)), ("pe", "Pendapatan", ("REVENUE", "OTHER INCOME")), ("pp", "PPN Keluaran", ("LIABILITY",)))
    for inv in invoices:
        m = mp.get(inv["id"])
        if not m:
            continue
        for kunci, peran, boleh in aturan:
            kd = m.get(kunci)
            if not kd or kd not in coa:
                continue
            if kunci == "pp" and not _f(inv["ppn"]):
                continue
            a = coa[kd]
            if not a["aktif"]:
                hasil.append(_temuan(inv, "akun_nonaktif", f"akun {peran} {kd}"))
            elif a["klas"] not in boleh:
                hasil.append(_temuan(inv, "akun_salah_klasifikasi", f"akun {peran} {kd} bertipe {a['klas'].title()}, seharusnya {'/'.join(b.title() for b in boleh)}"))
    return hasil


def _bulan(d: date) -> int:
    return d.year * 12 + d.month - 1


def _norm_nama(n: str) -> str:
    n = re.sub(r"[^a-z0-9 ]+", " ", (n or "").lower())
    n = re.sub(r"\b(pt|cv|ud|tbk|persero|the|co|ltd|pte|inc)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def periksa_invoice(klien: Dict[str, Any], ids: List[str], _invoices: Optional[List[Dict[str, Any]]] = None,
                    _riwayat_data: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """Temuan per invoice (daftar dict: invoice_id, invoice_no, kode, tingkat, pesan)."""
    invoices = _invoices if _invoices is not None else _ambil_invoice(ids)
    hasil: List[Dict[str, Any]] = []
    hari_ini = date.today()
    try:
        kunci = _tanggal_kunci(str(klien["id"]))
    except Exception:  # noqa: BLE001
        logger.exception("atlas tanggal kunci gagal klien=%s", klien.get("client_code"))
        kunci = None

    # riwayat Posted dimuat sekali di awal: dipakai cek tarif pajak (kebiasaan klien) dan review analitis di bawah
    try:
        riw = _riwayat_data if _riwayat_data is not None else _riwayat(str(klien["id"]), ids)
    except Exception:  # noqa: BLE001
        logger.exception("atlas riwayat gagal klien=%s", klien.get("client_code"))
        riw = []
    tarif_klien = _tarif_kebiasaan(riw)

    for inv in invoices:
        dpp, ppn, pph, gross = _f(inv["dpp"]), _f(inv["ppn"]), _f(inv["pph"]), _f(inv["gross"])
        tgl = inv.get("invoice_date")
        if gross == 0:
            hasil.append(_temuan(inv, "nilai_nol"))
        elif gross < 0:
            hasil.append(_temuan(inv, "nilai_negatif", _rp(gross)))
        if dpp and abs(gross - (dpp + ppn)) > TOLERANSI_RUPIAH and abs(gross - (dpp + ppn - pph)) > TOLERANSI_RUPIAH:
            hasil.append(_temuan(inv, "total_tidak_cocok", f"DPP+PPN {_rp(dpp + ppn)}, total {_rp(gross)}"))
        if isinstance(tgl, date):
            if kunci and tgl <= kunci:
                hasil.append(_temuan(inv, "periode_terkunci", f"{tgl.isoformat()} <= tutup buku {kunci.isoformat()}"))
            if tgl > hari_ini + timedelta(days=1):
                hasil.append(_temuan(inv, "tanggal_masa_depan", tgl.isoformat()))
            elif tgl < hari_ini - timedelta(days=BATAS_USIA_HARI):
                hasil.append(_temuan(inv, "tanggal_terlalu_lama", tgl.isoformat()))
            jt = inv.get("due_date")
            if isinstance(jt, date) and jt < tgl:
                hasil.append(_temuan(inv, "jatuh_tempo_sebelum_invoice", f"jatuh tempo {jt.isoformat()}, invoice {tgl.isoformat()}"))
        nama = str(inv.get("customer_name") or "").strip().lower()
        if nama in CUSTOMER_KOSONG or nama.replace(".", "").replace(",", "").isdigit():
            hasil.append(_temuan(inv, "customer_kosong"))
        if dpp > 0 and ppn > 0 and not _tarif_wajar(dpp, ppn, tgl if isinstance(tgl, date) else None) \
                and not _tarif_lazim_klien(ppn, dpp, tarif_klien):
            hasil.append(_temuan(inv, "tarif_ppn_janggal", f"{ppn / dpp * 100:.1f}%"))

    # cut-off: bulan dominan file (>= 70% invoice) vs invoice yang jauh di luarnya
    tgls = [i["invoice_date"] for i in invoices if isinstance(i.get("invoice_date"), date)]
    if len(tgls) >= 10:
        (bln, jml), = Counter(_bulan(t) for t in tgls).most_common(1)
        if jml / len(tgls) >= 0.7:
            for inv in invoices:
                t = inv.get("invoice_date")
                if isinstance(t, date) and abs(_bulan(t) - bln) >= 2:
                    hasil.append(_temuan(inv, "cutoff_periode", t.isoformat()))

    # pencilan nilai (hanya kalau file cukup besar supaya statistiknya berarti)
    positif = sorted(_f(i["gross"]) for i in invoices if _f(i["gross"]) > 0)
    if len(positif) >= MIN_UNTUK_OUTLIER:
        q1 = positif[len(positif) // 4]
        q3 = positif[(len(positif) * 3) // 4]
        batas = 10 * statistics.median(positif)
        if q3 > q1:
            batas = max(batas, q3 + 3 * (q3 - q1))
        for inv in invoices:
            if _f(inv["gross"]) > batas:
                hasil.append(_temuan(inv, "nilai_pencilan", f"{_rp(_f(inv['gross']))}, wajarnya di bawah {_rp(batas)}"))

    # dobel di dalam file: customer + tanggal + nilai sama, nomor invoice beda
    # Customer generik (kasir/POS) dilewati: nilai kembar antar struk itu wajar.
    per_hari: Counter = Counter((str(i.get("customer_name") or "").strip().lower(), i.get("invoice_date")) for i in invoices)
    try:
        generik_klien = _customer_harian_banyak(str(klien["id"]))
    except Exception:  # noqa: BLE001
        logger.exception("atlas customer harian gagal klien=%s", klien.get("client_code"))
        generik_klien = set()

    def _generik(inv: Dict[str, Any]) -> bool:
        n = str(inv.get("customer_name") or "").strip().lower()
        return _customer_generik(n) or n in generik_klien or per_hari[(n, inv.get("invoice_date"))] >= MIN_STRUK_HARIAN

    kelompok: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)
    for inv in invoices:
        if _f(inv["gross"]) != 0 and not _generik(inv):
            kelompok[(str(inv.get("customer_name") or "").strip().lower(), inv.get("invoice_date"), round(_f(inv["gross"]), 2))].append(inv)
    for grup in kelompok.values():
        for inv in grup[1:]:                       # yang pertama dianggap asli, sisanya ditahan
            hasil.append(_temuan(inv, "dobel_dalam_file", f"mirip {grup[0].get('invoice_no')}"))

    # dobel terhadap invoice yang sudah diposting sebelumnya
    try:
        for id_inv, no_lain in _dobel_sudah_posted(str(klien["id"]), ids).items():
            inv = next((i for i in invoices if i["id"] == id_inv), None)
            if inv and not _generik(inv):
                hasil.append(_temuan(inv, "dobel_sudah_posted", f"mirip {no_lain}"))
    except Exception:  # noqa: BLE001  (pemeriksaan tambahan: gagal tidak boleh menghentikan proses)
        logger.exception("atlas dobel_sudah_posted gagal klien=%s", klien.get("client_code"))

    # klasifikasi akun jurnal
    try:
        hasil += _periksa_klasifikasi(klien, invoices)
    except Exception:  # noqa: BLE001
        logger.exception("atlas klasifikasi akun gagal klien=%s", klien.get("client_code"))

    # review analitis terhadap kebiasaan klien (butuh riwayat Posted)
    try:
        if len(riw) >= MIN_RIWAYAT_INVOICE:
            pelanggan = {r["c"] for r in riw if r["c"]}
            g_pos = sorted(_f(r["g"]) for r in riw if _f(r["g"]) > 0)
            median_riw = statistics.median(g_pos) if g_pos else 0
            share_ppn = sum(1 for r in riw if _f(r["p"]) > 0) / len(riw)
            for inv in invoices:
                dpp, ppn, gross = _f(inv["dpp"]), _f(inv["ppn"]), _f(inv["gross"])
                if dpp > 0 and ppn == 0 and share_ppn >= 0.8:
                    hasil.append(_temuan(inv, "ppn_tidak_biasa", f"{share_ppn * 100:.0f}% invoice klien ini biasanya ber-PPN, yang ini tanpa PPN"))
                elif ppn > 0 and share_ppn <= 0.1:
                    hasil.append(_temuan(inv, "ppn_tidak_biasa", "invoice klien ini biasanya tanpa PPN, yang ini ber-PPN"))
                c = str(inv.get("customer_name") or "").strip().lower()
                if c and c not in pelanggan and median_riw and gross > 5 * median_riw:
                    hasil.append(_temuan(inv, "customer_baru_nilai_besar", f"{_rp(gross)} vs nilai tengah riwayat {_rp(median_riw)}"))
    except Exception:  # noqa: BLE001
        logger.exception("atlas review analitis gagal klien=%s", klien.get("client_code"))
    return hasil


def _benford(nilai: List[float]) -> Optional[float]:
    """Chi-square digit pertama vs hukum Benford (df=8). None kalau data kurang."""
    digit = [int(str(int(abs(v)))[0]) for v in nilai if abs(v) >= 1]
    if len(digit) < BENFORD_MIN:
        return None
    n = len(digit)
    cnt = Counter(digit)
    return sum((cnt.get(d, 0) - n * math.log10(1 + 1 / d)) ** 2 / (n * math.log10(1 + 1 / d)) for d in range(1, 10))


def _lompatan_nomor(nomor: List[str]) -> List[str]:
    """Nomor invoice yang terlewat dalam urutan yang sama (kontrol kelengkapan: invoice hilang / dihapus?)."""
    grup: Dict[str, List[int]] = defaultdict(list)
    for no in nomor:
        m = re.match(r"^(.*?)(\d+)$", str(no or "").strip())
        if m:
            grup[m.group(1)].append(int(m.group(2)))
    hilang: List[str] = []
    for pre, angka in grup.items():
        angka = sorted(set(angka))
        if len(angka) < 10 or (angka[-1] - angka[0]) > len(angka) * 3:
            continue
        ada = set(angka)
        hilang += [f"{pre}{n}" for n in range(angka[0], angka[-1] + 1) if n not in ada]
    return hilang


def periksa_file(sf_id: str, hasil_buat_transaksi: Optional[Dict[str, Any]], klien: Optional[Dict[str, Any]] = None,
                 invoices: Optional[List[Dict[str, Any]]] = None, riwayat: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """Temuan tingkat FILE (bukan per invoice): baris terbuang saat membuat invoice, selisih total sumber vs invoice,
    kontinuitas nomor, kelengkapan NPWP, kemiripan nama customer, total vs riwayat bulanan, dan pola angka (Benford)."""
    temuan: List[Dict[str, Any]] = []
    b = hasil_buat_transaksi or {}
    tidak_valid = int(b.get("dilewati_tidak_valid") or 0)
    bentrok = int(b.get("dilewati_invoice_no_bentrok") or 0)
    if tidak_valid:
        temuan.append({"kode": "baris_tidak_valid", "tingkat": "info",
                       "pesan": f"{tidak_valid} baris di file tidak valid dan tidak dijadikan invoice"})
    if bentrok:
        temuan.append({"kode": "nomor_invoice_bentrok", "tingkat": "info",
                       "pesan": f"{bentrok} baris dilewati karena nomor invoicenya sudah dipakai (file ini mungkin sudah pernah diupload)"})
    try:
        with dbc.engine.begin() as conn:
            r = conn.execute(text("""
                select coalesce(sum(r.total) filter (where r.is_valid), 0) as sumber,
                       coalesce(sum(i.gross_amount), 0) as invoice
                  from financial_transaction_sales_source_rows r
                  left join financial_transaction_sales_invoices i on i.source_row_id = r.id and i.deleted_at is null
                 where r.source_file_id::text = :f and r.deleted_at is null
            """), {"f": sf_id}).mappings().first()
        if r:
            selisih = _f(r["sumber"]) - _f(r["invoice"])
            if abs(selisih) > TOLERANSI_RUPIAH:
                temuan.append({"kode": "selisih_total_file", "tingkat": "tinjau",
                               "pesan": f"total baris valid di file {_rp(_f(r['sumber']))} tetapi invoice yang terbentuk {_rp(_f(r['invoice']))} (selisih {_rp(selisih)})"})
    except Exception:  # noqa: BLE001
        logger.exception("atlas selisih_total_file gagal sf=%s", sf_id)

    if not invoices:
        return temuan
    try:
        hilang = _lompatan_nomor([i.get("invoice_no") for i in invoices])
        if hilang:
            temuan.append({"kode": "lompatan_nomor", "tingkat": "info",
                           "pesan": f"{len(hilang)} nomor invoice terlewat dalam urutan (mis. {', '.join(hilang[:3])}); pastikan tidak ada invoice yang hilang"})
        tanpa_npwp = [i for i in invoices if _f(i["ppn"]) > 0 and not str(i.get("customer_npwp") or "").strip()]
        if tanpa_npwp:
            temuan.append({"kode": "npwp_kosong_ppn", "tingkat": "info",
                           "pesan": f"{len(tanpa_npwp)} invoice ber-PPN tanpa NPWP customer (faktur pajak keluaran butuh NPWP/NIK pembeli)"})
        chi = _benford([_f(i["gross"]) for i in invoices if _f(i["gross"]) > 0])
        if chi is not None and chi > BENFORD_KRITIS:
            temuan.append({"kode": "pola_angka_tidak_wajar", "tingkat": "info",
                           "pesan": f"sebaran digit pertama nilai invoice menyimpang dari pola alami (Benford, chi-square {chi:.1f}); disarankan sampling manual"})
        if riwayat is not None:
            nama_riw = {}
            for r_ in riwayat:
                if r_["c"]:
                    nama_riw.setdefault(_norm_nama(r_["c"]), r_["c"])
            baru = {str(i.get("customer_name") or "").strip() for i in invoices}
            mirip: List[str] = []
            for n in list(baru)[:150]:
                nn = _norm_nama(n)
                if not nn:
                    continue
                asli = nama_riw.get(nn)
                if asli and asli != n.strip().lower():
                    mirip.append(f"{n} ~ {asli}")
            if mirip:
                temuan.append({"kode": "nama_customer_mirip", "tingkat": "info",
                               "pesan": f"{len(mirip)} nama customer mirip customer yang sudah ada (mis. {mirip[0]}); subledger piutang bisa terpecah"})
            # total file vs rata-rata bulanan riwayat
            per_bulan: Dict[int, float] = defaultdict(float)
            for r_ in riwayat:
                if isinstance(r_["d"], date):
                    per_bulan[_bulan(r_["d"])] += _f(r_["g"])
            if len(per_bulan) >= MIN_RIWAYAT_BULAN:
                rata = sum(per_bulan.values()) / len(per_bulan)
                tgls = [i["invoice_date"] for i in invoices if isinstance(i.get("invoice_date"), date)]
                if tgls and rata > 0:
                    rentang = max((max(tgls) - min(tgls)).days + 1, 7)
                    harapan = rata * min(rentang, 31) / 30
                    total = sum(_f(i["gross"]) for i in invoices)
                    rasio = total / harapan
                    if rasio > 3 or rasio < 0.25:
                        temuan.append({"kode": "total_menyimpang_riwayat", "tingkat": "tinjau",
                                       "pesan": f"total file {_rp(total)} sekitar {rasio:.1f}x dari perkiraan normal klien ini ({_rp(harapan)} untuk rentang yang sama)"})
    except Exception:  # noqa: BLE001
        logger.exception("atlas pemeriksaan file lanjutan gagal sf=%s", sf_id)
    return temuan


def putusan(total_invoice: int, temuan_invoice: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Tentukan langkah terbaik: id yang ditahan, apakah seluruh file ditahan, dan ringkasan temuan per kode."""
    ditahan = {t["invoice_id"] for t in temuan_invoice if t["tingkat"] in ("blokir", "tinjau")}
    tahan_semua = total_invoice >= MIN_FILE_CURIGA and len(ditahan) / max(total_invoice, 1) > BATAS_FILE_CURIGA
    per_kode: Dict[str, Dict[str, Any]] = {}
    for t in temuan_invoice:
        k = per_kode.setdefault(t["kode"], {"kode": t["kode"], "jumlah": 0, "contoh": t.get("invoice_no"), "pesan": KODE[t["kode"]][1]})
        k["jumlah"] += 1
    ringkas = sorted(per_kode.values(), key=lambda x: -x["jumlah"])
    return {"ditahan": ditahan, "tahan_semua": tahan_semua, "ringkas": ringkas}


def catat_penahanan(klien: Dict[str, Any], user: Dict[str, Any], temuan_invoice: List[Dict[str, Any]], tahan_semua: bool,
                    ids_semua: List[str]) -> bool:
    """Jejak audit: satu baris activity log ATLAS_HOLD per invoice yang ditahan (alasan Atlas tertulis di deskripsi).
    Return True kalau tercatat (atau tidak ada yang perlu dicatat), False kalau gagal. Kegagalan mencatat TIDAK membatalkan penahanan."""
    uid = user.get("id")
    try:
        uid = str(uuid.UUID(str(uid)))
    except (ValueError, TypeError, AttributeError):
        uid = None   # id user bukan UUID (mis. mode dev): kolom created_by boleh kosong, jangan sampai insert gagal karenanya
    alasan: Dict[str, List[str]] = defaultdict(list)
    nomor: Dict[str, Any] = {}
    for t in temuan_invoice:
        if t["tingkat"] in ("blokir", "tinjau"):
            alasan[t["invoice_id"]].append(t["pesan"])
            nomor[t["invoice_id"]] = t.get("invoice_no")
    if tahan_semua:
        for i in ids_semua:
            alasan.setdefault(i, [])
    if not alasan:
        return True
    baris = []
    for id_inv, daftar in alasan.items():
        isi = "; ".join(daftar) if daftar else "file ditahan seluruhnya karena terlalu banyak invoice janggal"
        if tahan_semua and daftar:
            isi += " (seluruh file ditahan)"
        baris.append({"c": klien["id"], "i": id_inv, "n": nomor.get(id_inv),
                      "d": f"Atlas menahan invoice ini sebelum Approve/Post: {isi}"[:900],
                      "p": f"{NAMA_AGEN} ({user.get('nama') or user.get('username') or 'pengguna'})", "u": uid})
    try:
        with dbc.engine.begin() as conn:
            for k in range(0, len(baris), 500):
                conn.execute(text("""
                    insert into financial_transaction_sales_activity_log
                      (client_id, invoice_id, event_type, description, reference_no, performed_by, created_by)
                    values (CAST(:c AS uuid), CAST(:i AS uuid), 'ATLAS_HOLD', :d, :n, :p, CAST(:u AS uuid))
                """), baris[k:k + 500])
        return True
    except Exception:  # noqa: BLE001
        logger.exception("atlas gagal mencatat penahanan klien=%s", klien.get("client_code"))
        return False


# kode -> tahap buku kerja
TAHAP = {
    "periode_terkunci": 3, "tanggal_masa_depan": 3, "tanggal_terlalu_lama": 3, "cutoff_periode": 3,
    "nilai_nol": 4, "nilai_negatif": 4, "total_tidak_cocok": 4, "customer_kosong": 4, "jatuh_tempo_sebelum_invoice": 4,
    "dobel_dalam_file": 4, "dobel_sudah_posted": 4,
    "tarif_ppn_janggal": 5, "ppn_tidak_biasa": 5,
    "akun_salah_klasifikasi": 6, "akun_nonaktif": 6,
    "nilai_pencilan": 7, "customer_baru_nilai_besar": 7,
}
TAHAP_FILE = {"lompatan_nomor": 4, "npwp_kosong_ppn": 5, "nama_customer_mirip": 7, "total_menyimpang_riwayat": 7,
              "pola_angka_tidak_wajar": 7, "selisih_total_file": 2, "baris_tidak_valid": 2, "nomor_invoice_bentrok": 2}
NAMA_TAHAP = {
    3: ("Periode & cut-off", "pendapatan harus dicatat di periode yang benar dan periode yang sudah ditutup tidak boleh disentuh"),
    4: ("Validitas dokumen", "invoice harus utuh: total = DPP + PPN, tidak nol, customer jelas, tidak dobel"),
    5: ("Pajak PPN", "tarif PPN harus sesuai ketentuan dan konsisten dengan kebiasaan klien"),
    6: ("Klasifikasi akun", "Piutang = Aset, Pendapatan = Revenue, PPN Keluaran = Liabilitas"),
    7: ("Review analitis", "bandingkan dengan riwayat klien untuk menangkap angka yang tidak wajar"),
}


def susun_langkah(total: int, temuan_invoice: List[Dict[str, Any]], catatan: List[Dict[str, Any]], ditahan: int, tahan_semua: bool,
                  baris_terbaca: Any, buat: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Buku kerja Atlas: tiap tahap berisi apa yang diperiksa, alasan akuntansinya, dan hasilnya (lolos / catatan / tahan)."""
    langkah: List[Dict[str, Any]] = []
    b = buat or {}
    langkah.append({"tahap": "1. Penerimaan file", "status": "lolos",
                    "ket": f"file dibaca dengan template klien, {baris_terbaca if baris_terbaca is not None else 'beberapa'} baris terbaca"})
    cat2 = [c for c in catatan if TAHAP_FILE.get(c["kode"]) == 2]
    langkah.append({"tahap": "2. Pembentukan invoice", "status": "catatan" if cat2 else "lolos",
                    "ket": f"{b.get('invoice_dibuat', total)} invoice Draft dibuat" + ("; " + "; ".join(c["pesan"] for c in cat2) if cat2 else "")})
    for no in (3, 4, 5, 6, 7):
        nama, alasan = NAMA_TAHAP[no]
        ti = [t for t in temuan_invoice if TAHAP.get(t["kode"]) == no]
        cf = [c for c in catatan if TAHAP_FILE.get(c["kode"]) == no]
        if ti:
            ring = Counter(t["kode"] for t in ti)
            ket = "; ".join(f"{KODE[k][1]} ({n})" for k, n in ring.most_common(3))
            status = "tahan" if any(t["tingkat"] in ("blokir", "tinjau") for t in ti) else "catatan"
        elif cf:
            ket, status = "; ".join(c["pesan"] for c in cf[:2]), "catatan"
        else:
            ket, status = "tidak ada kejanggalan", "lolos"
        if ti and cf:
            ket += "; " + cf[0]["pesan"]
        langkah.append({"tahap": f"{no}. {nama}", "status": status, "alasan": alasan, "ket": ket[:300]})
    if tahan_semua:
        putus = f"seluruh file ditahan di Draft ({ditahan} dari {total} invoice janggal)"
    elif ditahan:
        putus = f"{ditahan} invoice ditahan di Draft untuk ditinjau, {total - ditahan} lanjut Approve dan Post"
    else:
        putus = f"semua {total} invoice lanjut Approve dan Post"
    langkah.append({"tahap": "8. Keputusan", "status": "tahan" if ditahan else "lolos", "ket": putus})
    return langkah


def analisa(klien: Dict[str, Any], ids: List[str], sf_id: str, hasil_buat: Optional[Dict[str, Any]], baris_terbaca: Any = None) -> Dict[str, Any]:
    """Satu pintu pemeriksaan Atlas. Return {temuan, catatan, putusan, hasil_atlas} (hasil_atlas disimpan di hasil_proses['atlas'])."""
    invoices = _ambil_invoice(ids)
    try:
        riwayat = _riwayat(str(klien["id"]), ids)
    except Exception:  # noqa: BLE001
        logger.exception("atlas riwayat gagal klien=%s", klien.get("client_code"))
        riwayat = None
    temuan = periksa_invoice(klien, ids, _invoices=invoices, _riwayat_data=riwayat)
    catatan = periksa_file(sf_id, hasil_buat, klien, invoices, riwayat)
    p = putusan(len(ids), temuan)
    tahan = set(ids) if p["tahan_semua"] else p["ditahan"]
    langkah = susun_langkah(len(ids), temuan, catatan, len(tahan), p["tahan_semua"], baris_terbaca, hasil_buat)
    hasil_atlas = {
        "total": len(ids), "ditahan": len(tahan), "tahan_semua": p["tahan_semua"], "ringkas": p["ringkas"],
        "detail": [{"invoice_no": t.get("invoice_no"), "masalah": t["pesan"]} for t in temuan if t["tingkat"] in ("blokir", "tinjau")][:25],
        "catatan_file": [c["pesan"] for c in catatan if c["tingkat"] != "info"],
        "catatan_kode": [c["kode"] for c in catatan if c["tingkat"] != "info"],
        "info_file": [c["pesan"] for c in catatan if c["tingkat"] == "info"],
        "langkah": langkah,
    }
    return {"temuan": temuan, "catatan": catatan, "putusan": p, "tahan": tahan, "hasil_atlas": hasil_atlas}


def tambah_jurnal(hasil: Dict[str, Any], klien: Dict[str, Any], ids: List[str]) -> None:
    """Setelah posting: Atlas menguraikan jurnal yang terbentuk (Dr Piutang; Cr Pendapatan; Cr PPN Keluaran) dan memastikan Debit = Kredit."""
    a = hasil.get("atlas")
    if not isinstance(a, dict) or a.get("error"):
        return
    with dbc.engine.begin() as conn:
        baris = conn.execute(text("""
            select m.piutang_account_code as pi, m.pendapatan_account_code as pe, m.ppn_account_code as pp,
                   coalesce(i.gross_amount, 0) as gross, coalesce(i.dpp, 0) as dpp, coalesce(i.ppn, 0) as ppn
              from financial_transaction_sales_invoices i
              left join financial_transaction_sales_account_mappings m on m.invoice_id = i.id and m.deleted_at is null
             where CAST(i.id AS text) = ANY(:ids) and i.posting_status = 'Posted' and i.deleted_at is null
        """), {"ids": ids}).mappings().all()
    if not baris:
        return
    dr: Dict[str, float] = defaultdict(float)
    cr: Dict[str, float] = defaultdict(float)
    for r in baris:
        gross, ppn = _f(r["gross"]), _f(r["ppn"])
        dpp = _f(r["dpp"]) or (gross - ppn)
        dr[f"{r['pi'] or 'Piutang'}"] += gross
        cr[f"{r['pe'] or 'Pendapatan'}"] += dpp
        if ppn:
            cr[f"{r['pp'] or 'PPN Keluaran'}"] += ppn
    total_dr, total_cr = sum(dr.values()), sum(cr.values())
    seimbang = abs(total_dr - total_cr) <= TOLERANSI_RUPIAH * max(len(baris), 1)
    a["jurnal"] = ([{"akun": k, "posisi": "Debit", "jumlah": round(v, 2)} for k, v in sorted(dr.items(), key=lambda x: -x[1])[:4]]
                   + [{"akun": k, "posisi": "Kredit", "jumlah": round(v, 2)} for k, v in sorted(cr.items(), key=lambda x: -x[1])[:4]])
    a["jurnal_seimbang"] = seimbang
    a.setdefault("langkah", []).append({
        "tahap": "9. Jurnal", "status": "lolos" if seimbang else "tahan",
        "ket": (f"{len(baris)} invoice diposting; total Debit {_rp(total_dr)} = total Kredit {_rp(total_cr)}" if seimbang
                else f"PERHATIAN: Debit {_rp(total_dr)} tidak sama dengan Kredit {_rp(total_cr)}, periksa di Journal Preview")})


def kalimat_laporan(rinci: Dict[str, Any]) -> str:
    """Kalimat singkat untuk dibacakan Neo dari hasil_proses['atlas'] (kosong = Atlas tidak menemukan apa-apa)."""
    a = rinci.get("atlas") or {}
    if a.get("error"):   # pemeriksaan Atlas sendiri gagal: semua invoice dibiarkan di Draft, jangan diucapkan seolah bersih
        n = int(a.get("ditahan") or a.get("total") or 0)
        return (f"Atlas gagal memeriksa file ini, jadi {n} invoice dibiarkan di Draft Sales dan belum ada yang diposting. "
                "Cek log backend lalu coba lagi.")
    ditahan = int(a.get("ditahan") or 0)
    if not ditahan and not a.get("tahan_semua") and not a.get("catatan_file") and a.get("jurnal_seimbang", True):
        return ""
    bagian: List[str] = []
    if a.get("tahan_semua"):
        bagian.append(f"Atlas menahan seluruh file di Draft: {ditahan} dari {a.get('total')} invoice janggal, mungkin salah klien, periode, atau format")
    elif ditahan:
        bagian.append(f"Atlas menaruh {ditahan} invoice di Draft Sales untuk ditinjau")
    ringkas = a.get("ringkas") or []
    if ringkas:   # SEMUA jenis masalah, singkat, supaya muat dalam laporan suara
        bagian.append("Masalah: " + ", ".join(f"{SINGKAT.get(x['kode'], x.get('pesan') or x['kode'])} ({x['jumlah']})" for x in ringkas[:5]))
    if a.get("catatan_kode"):
        bagian.append("Catatan file: " + ", ".join(SINGKAT.get(k, k) for k in a["catatan_kode"][:3]))
    if a.get("jurnal_seimbang") is False:
        bagian.append("Jurnal tidak seimbang, cek Journal Preview")
    if a.get("log_gagal"):
        bagian.append("Catatan penahanan di activity log gagal tertulis, tapi invoice tetap di Draft")
    return " ".join(s.rstrip(".") + "." for s in bagian)
