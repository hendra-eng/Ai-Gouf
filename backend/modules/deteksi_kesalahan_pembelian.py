"""
modules/deteksi_kesalahan_pembelian.py
========================================
"Deteksi & pencegahan kesalahan" untuk siklus Pembelian (PO/Invoice) --
7 pengecekan rule-based (BUKAN AI generatif), sesuai daftar checklist yang
ditawarkan ke akuntan:

  1. cocokkan_po_invoice()        -- Pencocokan PO <-> Invoice
  2. deteksi_pph23_jasa()         -- Deteksi PPh 23 atas jasa
  3. deteksi_harga_tidak_wajar()  -- Deteksi harga tidak wajar (riwayat)
  4. deteksi_supplier_baru()      -- Deteksi supplier baru
  5. validasi_tanggal()           -- Validasi tanggal
  6. rekap_per_supplier()         -- Rekap per Supplier
  7. cross_check_ap_aging()       -- Cross-check ke AP Aging

Plus 1 orkestrator siap-pakai tingkat endpoint:
  8. jalankan_deteksi_kesalahan_pembelian()

Sumber data: DataFrame "df" yang tersimpan di hasil proses_pembelian() /
proses_ap_aging() / proses_bukti_potong() (lihat akuntansi_ai.py) --
diambil lewat db_client.ambil_hasil_client(), sama seperti cross_matching.py.

Kolom df_pembelian yang dipakai (lihat akuntansi_ai.py::parse_sheet_pembelian
& proses_pembelian): jenis_dokumen (PO/INVOICE), nomor_dokumen, tanggal,
nama_supplier, nama_barang, qty, harga_satuan, subtotal_tertulis,
ppn_tertulis, total_tertulis, subtotal_hitung, status.

Kolom df_ap_aging (lihat parse_sheet_ap_aging & proses_ap_aging):
nama_supplier, nomor_invoice, tanggal_invoice, tanggal_jatuh_tempo,
jumlah_utang, jumlah_dibayar, sisa_utang_tertulis, sisa_utang_hitung,
umur_hari, bucket_aging, status.

Kolom df_bukti_potong (lihat parse_sheet_bukti_potong & proses_bukti_potong):
tanggal, masa_pajak, nomor_bukti_potong, jenis_pajak_tersurat,
kode_objek_pajak, nama_pemotong, nama_dipotong, dpp, pph, jenis_pajak
(hasil klasifikasi PPH21/PPH23/PPH4(2)/TIDAK DIKENALI).

PRINSIP PENTING (sama seperti cross_matching.py): semua fungsi di sini
RULE-BASED, hasil "TIDAK_KETEMU"/"PERLU_DICEK"/"SELISIH" WAJIB tetap
direview manusia -- modul ini mempercepat proses cari, bukan menggantikan
keputusan akuntan.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("deteksi_kesalahan_pembelian")


# ============================================================
# HELPER UMUM
# ============================================================

def _ke_tanggal(value) -> Optional[date]:
    try:
        ts = pd.to_datetime(value, errors="coerce")
        if pd.isna(ts):
            return None
        return ts.date()
    except Exception:
        return None


def _gabungkan_df_dari_hasil(daftar_hasil: List[Dict[str, Any]]) -> pd.DataFrame:
    """Gabungkan kolom 'df' dari SEMUA record hasil (dbc.ambil_hasil_client)
    jadi satu DataFrame -- lihat penjelasan yang sama di cross_matching.py
    (fungsi ini SENGAJA diduplikasi di sini, bukan diimpor dari
    cross_matching.py, supaya modul ini tetap berdiri sendiri/tidak
    bergantung pada detail internal modul lain -- konsisten dengan pola
    duplikasi yang sudah dipakai di dedup_transaksi.py)."""
    potongan = []
    for h in daftar_hasil:
        data = h.get("data") or {}
        baris = data.get("df")
        if baris:
            potongan.append(pd.DataFrame(baris))
    if not potongan:
        return pd.DataFrame()
    return pd.concat(potongan, ignore_index=True)


def _normalisasi_teks(teks: Any) -> str:
    if teks is None:
        return ""
    teks = str(teks).strip().lower()
    teks = re.sub(r"[^a-z0-9\s]", " ", teks)
    return re.sub(r"\s+", " ", teks).strip()


def _normalisasi_nama_supplier(teks: Any) -> str:
    """Normalisasi nama supplier lebih longgar (buang PT/CV/Tbk dsb) supaya
    "PT Sinar Jaya" dan "Sinar Jaya" dianggap supplier yang sama."""
    t = _normalisasi_teks(teks)
    kata_buang = {"pt", "cv", "tbk", "persero", "ud"}
    return " ".join(k for k in t.split() if k not in kata_buang)


# Kata kunci umum penanda item PEMBELIAN JASA (bukan barang fisik) -- dipakai
# deteksi_pph23_jasa(). Daftar ini sengaja tidak lengkap (mustahil lengkap
# 100%) -- baris yang tidak cocok kata kunci TIDAK berarti pasti bukan jasa,
# cuma tidak ikut ditandai otomatis, tetap boleh dicek manual oleh akuntan.
_KATA_KUNCI_JASA = [
    "jasa", "service", "servis", "konsultan", "konsultasi", "sewa", "rental",
    "maintenance", "perawatan", "instalasi", "pemasangan", "perbaikan",
    "reparasi", "management fee", "biaya jasa", "outsourcing", "cleaning",
    "security", "keamanan", "training", "pelatihan", "desain", "design",
    "audit", "legal", "notaris", "konsultan pajak", "it support",
    "pengembangan sistem", "software development", "catering", "laundry",
    "event organizer", "eo ", "percetakan jasa",
]


def _kemungkinan_jasa(nama_barang: Any) -> bool:
    teks = _normalisasi_teks(nama_barang)
    return any(k in teks for k in _KATA_KUNCI_JASA)


def _hitung_total_invoice(row: pd.Series) -> float:
    """Total akhir 1 baris invoice: pakai total_tertulis kalau ada,
    fallback ke subtotal (tertulis/hitung) + PPN -- sama seperti logika di
    akuntansi_ai.py::proses_pembelian saat menyusun draf jurnal."""
    total_tertulis = row.get("total_tertulis")
    if total_tertulis is not None and not pd.isna(total_tertulis) and float(total_tertulis) > 0:
        return float(total_tertulis)
    subtotal = row.get("subtotal_tertulis")
    if subtotal is None or pd.isna(subtotal):
        subtotal = row.get("subtotal_hitung") or 0.0
    ppn = row.get("ppn_tertulis") or 0.0
    try:
        return float(subtotal) + float(ppn)
    except (TypeError, ValueError):
        return 0.0


# ============================================================
# 1. PENCOCOKAN PO <-> INVOICE
# ============================================================
# TIDAK ada nomor referensi silang eksplisit antara PO & Invoice di data
# sumber (lihat catatan di akuntansi_ai.py sekitar proses_pembelian: modul
# itu SENGAJA tidak melakukan pencocokan 3-way). Di sini kita cocokkan
# secara heuristik: supplier sama + nama barang mirip + qty & harga dalam
# toleransi + tanggal invoice tidak lebih awal dari tanggal PO (dalam
# rentang wajar). 1 baris PO hanya dipakai untuk 1 baris Invoice.

_TOLERANSI_HARI_PO_KE_INVOICE_DEFAULT = 90
_TOLERANSI_PERSEN_QTY_DEFAULT = 0.05
_TOLERANSI_PERSEN_HARGA_DEFAULT = 0.05


def cocokkan_po_invoice(
    df_pembelian: pd.DataFrame,
    toleransi_hari: int = _TOLERANSI_HARI_PO_KE_INVOICE_DEFAULT,
    toleransi_persen_qty: float = _TOLERANSI_PERSEN_QTY_DEFAULT,
    toleransi_persen_harga: float = _TOLERANSI_PERSEN_HARGA_DEFAULT,
) -> Dict[str, Any]:
    """
    Cocokkan tiap baris INVOICE ke baris PO yang paling mungkin jadi
    asalnya: supplier sama, nama barang mirip (normalized exact match),
    qty & harga satuan dalam toleransi persen, dan tanggal PO <= tanggal
    invoice (dalam rentang toleransi_hari).

    Return dict:
        "hasil": status per baris invoice (MATCHED / PO_TIDAK_DITEMUKAN)
        "po_belum_ada_invoice": baris PO yang belum ketemu invoice-nya
            (masih murni komitmen/pesanan terbuka)
        "ringkasan": rekap angka.
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "po_belum_ada_invoice": [], "ringkasan": {
            "catatan": "Tidak ada data Pembelian (PO/Invoice) untuk dicocokkan.",
        }}

    df = df_pembelian.copy()
    df["_tanggal"] = df["tanggal"].apply(_ke_tanggal)
    df["_supplier_norm"] = df["nama_supplier"].apply(_normalisasi_nama_supplier)
    df["_barang_norm"] = df["nama_barang"].apply(_normalisasi_teks)

    df_po = df[df["jenis_dokumen"] == "PO"]
    df_invoice = df[df["jenis_dokumen"] == "INVOICE"]

    if df_invoice.empty:
        return {"hasil": [], "po_belum_ada_invoice": df_po.to_dict("records"), "ringkasan": {
            "catatan": "Tidak ada baris INVOICE untuk dicocokkan ke PO.",
        }}

    hasil = []
    po_terpakai: set = set()

    # [BARU -- PERBAIKAN PERFORMA] Sebelumnya untuk SETIAP baris invoice,
    # SELURUH df_po di-iterrows() ulang dari nol (nested loop O(n_invoice x
    # n_po)) -- padahal filter pertama yang dicek justru exact-match
    # supplier+barang (baris yang tidak match langsung di-skip). Sekarang
    # df_po dikelompokkan SEKALI di depan berdasarkan (_supplier_norm,
    # _barang_norm) -- untuk tiap invoice, kandidat yang perlu dicek cuma
    # PO dengan supplier+barang SAMA (biasanya segelintir), bukan seluruh
    # PO. Hasil/urutan prioritas pemilihan (skor selisih qty+harga
    # terkecil) TIDAK berubah -- cuma kandidat yang diperiksa lebih sedikit
    # & lebih murah (dict, bukan DataFrame row per iterrows()).
    po_by_key: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for pidx, po in df_po.iterrows():
        key = (po["_supplier_norm"], po["_barang_norm"])
        po_by_key.setdefault(key, []).append({
            "pidx": pidx,
            "qty": float(po.get("qty") or 0),
            "harga_satuan": float(po.get("harga_satuan") or 0),
            "_tanggal": po.get("_tanggal"),
            "nomor_dokumen": po.get("nomor_dokumen"),
        })

    for idx, inv in df_invoice.iterrows():
        qty_inv = float(inv.get("qty") or 0)
        harga_inv = float(inv.get("harga_satuan") or 0)

        kandidat = []
        for po in po_by_key.get((inv["_supplier_norm"], inv["_barang_norm"]), []):
            pidx = po["pidx"]
            if pidx in po_terpakai:
                continue

            qty_po = po["qty"]
            harga_po = po["harga_satuan"]
            selisih_qty_persen = abs(qty_inv - qty_po) / qty_po if qty_po else 1.0
            selisih_harga_persen = abs(harga_inv - harga_po) / harga_po if harga_po else 1.0
            if selisih_qty_persen > toleransi_persen_qty or selisih_harga_persen > toleransi_persen_harga:
                continue

            selisih_hari = None
            if inv["_tanggal"] and po["_tanggal"]:
                selisih_hari = (inv["_tanggal"] - po["_tanggal"]).days
                # invoice SEHARUSNYA terbit setelah/bersamaan dgn PO, dan tidak
                # terlalu lama sesudahnya.
                if selisih_hari < -1 or selisih_hari > toleransi_hari:
                    continue

            kandidat.append((pidx, selisih_qty_persen + selisih_harga_persen, selisih_hari, po))

        terpilih = None
        if kandidat:
            kandidat.sort(key=lambda k: k[1])
            terpilih = kandidat[0]

        if terpilih:
            pidx, _skor, selisih_hari, po = terpilih
            po_terpakai.add(pidx)
            hasil.append({
                "invoice_index": int(idx),
                "po_index": int(pidx),
                "nomor_invoice": inv.get("nomor_dokumen"),
                "nomor_po": po.get("nomor_dokumen"),
                "nama_supplier": inv.get("nama_supplier"),
                "nama_barang": inv.get("nama_barang"),
                "status": "MATCHED",
                "selisih_hari_po_ke_invoice": selisih_hari,
            })
        else:
            hasil.append({
                "invoice_index": int(idx),
                "po_index": None,
                "nomor_invoice": inv.get("nomor_dokumen"),
                "nomor_po": None,
                "nama_supplier": inv.get("nama_supplier"),
                "nama_barang": inv.get("nama_barang"),
                "status": "PO_TIDAK_DITEMUKAN",
                "catatan": "Tidak ditemukan PO yang cocok (supplier/barang/qty/harga/tanggal) -- "
                           "cek apakah pembelian ini memang tanpa PO (mis. pembelian mendadak).",
            })

    po_belum_ada_invoice = [
        {
            "po_index": int(pidx),
            "nomor_po": row.get("nomor_dokumen"),
            "nama_supplier": row.get("nama_supplier"),
            "nama_barang": row.get("nama_barang"),
            "tanggal": row.get("tanggal"),
            "qty": row.get("qty"),
            "harga_satuan": row.get("harga_satuan"),
        }
        for pidx, row in df_po.iterrows() if pidx not in po_terpakai
    ]

    jumlah_matched = sum(1 for h in hasil if h["status"] == "MATCHED")
    ringkasan = {
        "jumlah_invoice": len(df_invoice),
        "jumlah_po": len(df_po),
        "jumlah_matched": jumlah_matched,
        "jumlah_invoice_tanpa_po": len(hasil) - jumlah_matched,
        "jumlah_po_belum_ada_invoice": len(po_belum_ada_invoice),
    }
    return {"hasil": hasil, "po_belum_ada_invoice": po_belum_ada_invoice, "ringkasan": ringkasan}


# ============================================================
# 2. DETEKSI PPh 23 ATAS JASA
# ============================================================

def deteksi_pph23_jasa(
    df_pembelian: pd.DataFrame,
    df_bukti_potong: pd.DataFrame,
    toleransi_rupiah: float = 5000,
) -> Dict[str, Any]:
    """
    Tandai baris INVOICE pembelian yang terindikasi JASA (lihat
    _KATA_KUNCI_JASA), lalu cross-check apakah sudah ada Bukti Potong PPh
    23 (jenis_pajak == "PPH23") untuk supplier & masa pajak yang sama,
    dengan DPP mendekati nilai invoice-nya.

    Return dict:
        "hasil": baris invoice terindikasi jasa + status bukti potongnya
        "ringkasan": rekap angka.
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Pembelian untuk dicek."}}

    df_invoice = df_pembelian[df_pembelian["jenis_dokumen"] == "INVOICE"].copy()
    if df_invoice.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada baris INVOICE untuk dicek."}}

    df_invoice["_jasa"] = df_invoice["nama_barang"].apply(_kemungkinan_jasa)
    df_jasa = df_invoice[df_invoice["_jasa"]]

    if df_jasa.empty:
        return {"hasil": [], "ringkasan": {
            "jumlah_invoice_terindikasi_jasa": 0,
            "catatan": "Tidak ada baris invoice yang terindikasi pembelian jasa (berdasarkan kata kunci deskripsi barang).",
        }}

    df_bp = pd.DataFrame()
    if df_bukti_potong is not None and not df_bukti_potong.empty:
        df_bp = df_bukti_potong[df_bukti_potong.get("jenis_pajak") == "PPH23"].copy() \
            if "jenis_pajak" in df_bukti_potong.columns else pd.DataFrame()
        if not df_bp.empty:
            df_bp["_supplier_norm"] = df_bp["nama_dipotong"].apply(_normalisasi_nama_supplier)
            df_bp["_bulan_tahun"] = df_bp["tanggal"].apply(
                lambda t: (_ke_tanggal(t).month, _ke_tanggal(t).year) if _ke_tanggal(t) else (None, None)
            )

    hasil = []
    for idx, row in df_jasa.iterrows():
        supplier_norm = _normalisasi_nama_supplier(row.get("nama_supplier"))
        tgl = _ke_tanggal(row.get("tanggal"))
        nilai_invoice = _hitung_total_invoice(row)

        bupot_cocok = None
        if not df_bp.empty and tgl:
            kandidat = df_bp[
                (df_bp["_supplier_norm"] == supplier_norm)
                & (df_bp["_bulan_tahun"] == (tgl.month, tgl.year))
            ]
            if not kandidat.empty:
                subtotal = row.get("subtotal_tertulis")
                if subtotal is None or pd.isna(subtotal):
                    subtotal = row.get("subtotal_hitung") or 0.0
                kandidat = kandidat.assign(
                    _selisih_dpp=(kandidat["dpp"].astype(float) - float(subtotal)).abs()
                ).sort_values("_selisih_dpp")
                baris_terdekat = kandidat.iloc[0]
                if baris_terdekat["_selisih_dpp"] <= toleransi_rupiah:
                    bupot_cocok = baris_terdekat

        if bupot_cocok is not None:
            hasil.append({
                "baris": int(idx) + 1,
                "nomor_invoice": row.get("nomor_dokumen"),
                "nama_supplier": row.get("nama_supplier"),
                "nama_barang": row.get("nama_barang"),
                "nilai_invoice": nilai_invoice,
                "status": "OK_ADA_BUKTI_POTONG",
                "nomor_bukti_potong": bupot_cocok.get("nomor_bukti_potong"),
                "dpp_bukti_potong": float(bupot_cocok.get("dpp") or 0),
                "pph_bukti_potong": float(bupot_cocok.get("pph") or 0),
            })
        else:
            hasil.append({
                "baris": int(idx) + 1,
                "nomor_invoice": row.get("nomor_dokumen"),
                "nama_supplier": row.get("nama_supplier"),
                "nama_barang": row.get("nama_barang"),
                "tanggal": row.get("tanggal"),
                "nilai_invoice": nilai_invoice,
                "status": "PERLU_DICEK",
                "catatan": "Item terindikasi JASA (berpotensi objek PPh 23 2%) tapi tidak ditemukan Bukti "
                           "Potong PPh 23 dari supplier & masa pajak yang sama -- cek apakah PPh 23 sudah "
                           "dipotong & disetor, atau memang bukan objek PPh 23 (mis. jasa sudah final/PP 23).",
            })

    jumlah_perlu_dicek = sum(1 for h in hasil if h["status"] == "PERLU_DICEK")
    ringkasan = {
        "jumlah_invoice_terindikasi_jasa": len(hasil),
        "jumlah_ok_ada_bukti_potong": len(hasil) - jumlah_perlu_dicek,
        "jumlah_perlu_dicek": jumlah_perlu_dicek,
        "catatan": (
            "Deteksi jasa berbasis kata kunci deskripsi barang -- tidak sempurna, WAJIB direview "
            "manual. Tidak semua jasa kena PPh 23 (jasa final PPh Final UMKM/PP 23 dikecualikan)."
        ),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 3. DETEKSI HARGA TIDAK WAJAR (RIWAYAT)
# ============================================================

_AMBANG_PERSEN_HARGA_TIDAK_WAJAR_DEFAULT = 0.20  # 20%


def deteksi_harga_tidak_wajar(
    df_pembelian: pd.DataFrame,
    ambang_persen: float = _AMBANG_PERSEN_HARGA_TIDAK_WAJAR_DEFAULT,
) -> Dict[str, Any]:
    """
    Untuk tiap baris (PO maupun INVOICE), bandingkan harga_satuan dengan
    DUA basis pembanding:
      a) riwayat harga item yang SAMA dari SUPPLIER yang sama (baris lain
         milik pasangan supplier+barang ini)
      b) rata-rata harga item yang sama LINTAS SEMUA supplier

    Baris ditandai kalau selisih terhadap salah satu basis > ambang_persen
    (default 20%). Butuh minimal 1 baris pembanding lain (kalau item cuma
    muncul 1x di seluruh riwayat, tidak ada basis pembanding -- dilewati).

    Return dict: "hasil" (baris yang terindikasi tidak wajar), "ringkasan".
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Pembelian untuk dicek."}}

    df = df_pembelian.copy()
    df["_barang_norm"] = df["nama_barang"].apply(_normalisasi_teks)
    df["_supplier_norm"] = df["nama_supplier"].apply(_normalisasi_nama_supplier)
    df["_harga"] = pd.to_numeric(df["harga_satuan"], errors="coerce")
    df = df[df["_harga"] > 0]

    hasil = []
    for idx, row in df.iterrows():
        barang = row["_barang_norm"]
        supplier = row["_supplier_norm"]
        harga = float(row["_harga"])
        if not barang:
            continue

        alasan = []

        # (a) vs riwayat harga supplier yang sama untuk item yang sama
        riwayat_supplier = df[
            (df["_barang_norm"] == barang) & (df["_supplier_norm"] == supplier) & (df.index != idx)
        ]
        if not riwayat_supplier.empty:
            rata_supplier = float(riwayat_supplier["_harga"].mean())
            if rata_supplier > 0:
                selisih_persen = abs(harga - rata_supplier) / rata_supplier
                if selisih_persen > ambang_persen:
                    alasan.append(
                        f"Harga Rp{harga:,.0f} berbeda {selisih_persen:.0%} dari rata-rata riwayat harga "
                        f"item ini dari supplier YANG SAMA (Rp{rata_supplier:,.0f})."
                    )

        # (b) vs rata-rata harga item yang sama lintas SEMUA supplier
        riwayat_semua = df[(df["_barang_norm"] == barang) & (df.index != idx)]
        if not riwayat_semua.empty:
            rata_semua = float(riwayat_semua["_harga"].mean())
            if rata_semua > 0:
                selisih_persen = abs(harga - rata_semua) / rata_semua
                if selisih_persen > ambang_persen:
                    alasan.append(
                        f"Harga Rp{harga:,.0f} berbeda {selisih_persen:.0%} dari rata-rata harga item ini "
                        f"LINTAS SEMUA supplier (Rp{rata_semua:,.0f})."
                    )

        if alasan:
            hasil.append({
                "baris": int(idx) + 1,
                "jenis_dokumen": row.get("jenis_dokumen"),
                "nomor_dokumen": row.get("nomor_dokumen"),
                "nama_supplier": row.get("nama_supplier"),
                "nama_barang": row.get("nama_barang"),
                "harga_satuan": harga,
                "alasan": alasan,
            })

    ringkasan = {
        "jumlah_baris_dicek": len(df),
        "jumlah_terindikasi_tidak_wajar": len(hasil),
        "ambang_persen": ambang_persen,
        "catatan": (
            "Item yang cuma muncul 1x di seluruh riwayat tidak punya basis pembanding, dilewati. "
            "Kenaikan harga bisa jadi wajar (inflasi/spesifikasi beda) -- WAJIB dikonfirmasi ke supplier."
        ),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 4. DETEKSI SUPPLIER BARU
# ============================================================

_AMBANG_HARI_SUPPLIER_BARU_DEFAULT = 30


def deteksi_supplier_baru(
    df_pembelian: pd.DataFrame,
    ambang_hari_baru: int = _AMBANG_HARI_SUPPLIER_BARU_DEFAULT,
    tanggal_acuan: Optional[date] = None,
) -> Dict[str, Any]:
    """
    Tandai supplier yang transaksi PERTAMANYA (paling awal di seluruh
    riwayat pembelian client ini) terjadi dalam ambang_hari_baru hari
    terakhir dari tanggal_acuan (default hari ini) -- indikasi supplier
    baru yang belum lama diajak kerja sama, biasanya butuh verifikasi
    tambahan (legalitas, NPWP, rekening) sebelum pembayaran besar.

    Return dict: "hasil" (daftar supplier baru + transaksi pertamanya), "ringkasan".
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Pembelian untuk dicek."}}

    tanggal_acuan = tanggal_acuan or date.today()
    df = df_pembelian.copy()
    df["_tanggal"] = df["tanggal"].apply(_ke_tanggal)
    df["_supplier_norm"] = df["nama_supplier"].apply(_normalisasi_nama_supplier)
    df = df[df["_supplier_norm"] != ""]

    hasil = []
    for supplier_norm, grup in df.groupby("_supplier_norm"):
        grup_bertanggal = grup.dropna(subset=["_tanggal"])
        if grup_bertanggal.empty:
            continue
        transaksi_pertama = grup_bertanggal.loc[grup_bertanggal["_tanggal"].idxmin()]
        tgl_pertama = transaksi_pertama["_tanggal"]
        umur_hari = (tanggal_acuan - tgl_pertama).days
        if 0 <= umur_hari <= ambang_hari_baru:
            hasil.append({
                "nama_supplier": transaksi_pertama.get("nama_supplier"),
                "tanggal_transaksi_pertama": str(tgl_pertama),
                "umur_hari": umur_hari,
                "jenis_dokumen_pertama": transaksi_pertama.get("jenis_dokumen"),
                "nomor_dokumen_pertama": transaksi_pertama.get("nomor_dokumen"),
                "jumlah_transaksi_total": int(len(grup)),
                "catatan": "Supplier baru -- pastikan legalitas (NPWP/akta), data rekening, dan "
                           "kesepakatan harga/termin sudah diverifikasi sebelum pembayaran.",
            })

    hasil.sort(key=lambda h: h["umur_hari"])
    ringkasan = {
        "jumlah_supplier_total": df["_supplier_norm"].nunique(),
        "jumlah_supplier_baru": len(hasil),
        "ambang_hari": ambang_hari_baru,
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 5. VALIDASI TANGGAL
# ============================================================

def validasi_tanggal(df_pembelian: pd.DataFrame, tanggal_acuan: Optional[date] = None) -> Dict[str, Any]:
    """
    Validasi kewajaran tanggal per baris PO/Invoice:
      - tanggal kosong/tidak terbaca
      - tanggal di MASA DEPAN (setelah tanggal_acuan)
      - tanggal terlalu lampau tanpa penjelasan (>2 tahun) -- indikasi
        salah ketik tahun (mis. "2016" padahal maksud "2026")

    Return dict: "hasil" (baris bermasalah), "ringkasan".
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Pembelian untuk dicek."}}

    tanggal_acuan = tanggal_acuan or date.today()
    df = df_pembelian.copy()

    hasil = []
    for idx, row in df.iterrows():
        tgl_mentah = row.get("tanggal")
        tgl = _ke_tanggal(tgl_mentah)
        alasan = []

        if tgl is None:
            alasan.append("Tanggal kosong atau tidak bisa dibaca sebagai tanggal yang valid.")
        else:
            if tgl > tanggal_acuan:
                alasan.append(f"Tanggal {tgl} berada di MASA DEPAN (setelah hari ini, {tanggal_acuan}).")
            selisih_tahun = (tanggal_acuan - tgl).days / 365.25
            if selisih_tahun > 2:
                alasan.append(
                    f"Tanggal {tgl} lebih dari 2 tahun ke belakang -- cek kemungkinan salah ketik tahun."
                )

        if alasan:
            hasil.append({
                "baris": int(idx) + 1,
                "jenis_dokumen": row.get("jenis_dokumen"),
                "nomor_dokumen": row.get("nomor_dokumen"),
                "nama_supplier": row.get("nama_supplier"),
                "tanggal_tertulis": tgl_mentah,
                "alasan": alasan,
            })

    ringkasan = {
        "jumlah_baris_dicek": len(df),
        "jumlah_bermasalah": len(hasil),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 6. REKAP PER SUPPLIER
# ============================================================

def rekap_per_supplier(df_pembelian: pd.DataFrame) -> Dict[str, Any]:
    """
    Rekap ringkas per supplier: jumlah baris PO/Invoice, total nilai
    PO/Invoice, jumlah item unik, rentang tanggal transaksi, dan jumlah
    baris yang statusnya "PERLU REVIEW" (kolom "status" hasil
    proses_pembelian()).

    Return dict: "hasil" (list per supplier, urut nilai invoice terbesar), "ringkasan".
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Pembelian untuk direkap."}}

    df = df_pembelian.copy()
    df["_tanggal"] = df["tanggal"].apply(_ke_tanggal)
    df["_nilai"] = df.apply(_hitung_total_invoice, axis=1)
    df["_supplier_key"] = df["nama_supplier"].fillna("(tanpa nama supplier)")

    hasil = []
    for supplier, grup in df.groupby("_supplier_key"):
        grup_po = grup[grup["jenis_dokumen"] == "PO"]
        grup_invoice = grup[grup["jenis_dokumen"] == "INVOICE"]
        tanggal_valid = grup["_tanggal"].dropna()
        status_col = grup["status"] if "status" in grup.columns else pd.Series(dtype=object)

        hasil.append({
            "nama_supplier": supplier,
            "jumlah_baris_po": int(len(grup_po)),
            "jumlah_baris_invoice": int(len(grup_invoice)),
            "total_nilai_po": float(grup_po["_nilai"].sum()),
            "total_nilai_invoice": float(grup_invoice["_nilai"].sum()),
            "jumlah_item_unik": int(grup["nama_barang"].nunique()),
            "tanggal_transaksi_pertama": str(tanggal_valid.min()) if not tanggal_valid.empty else None,
            "tanggal_transaksi_terakhir": str(tanggal_valid.max()) if not tanggal_valid.empty else None,
            "jumlah_perlu_review": int((status_col == "PERLU REVIEW").sum()),
        })

    hasil.sort(key=lambda h: h["total_nilai_invoice"], reverse=True)
    ringkasan = {
        "jumlah_supplier": len(hasil),
        "total_nilai_invoice_semua_supplier": sum(h["total_nilai_invoice"] for h in hasil),
        "total_nilai_po_semua_supplier": sum(h["total_nilai_po"] for h in hasil),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 7. CROSS-CHECK KE AP AGING
# ============================================================

def cross_check_ap_aging(
    df_pembelian: pd.DataFrame,
    df_ap_aging: pd.DataFrame,
    toleransi_rupiah: float = 50,
) -> Dict[str, Any]:
    """
    Cocokkan tiap baris INVOICE pembelian ke baris AP Aging (Buku Bantu
    Utang) yang sepasang: supplier sama + nomor invoice sama.

    Return dict:
        "hasil": status per invoice (MATCHED / SELISIH_NOMINAL /
            TIDAK_ADA_DI_AP_AGING -- mungkin sudah lunas & tidak lagi
            tercatat, atau memang belum dimasukkan ke Buku Bantu Utang)
        "ap_aging_tanpa_invoice_pembelian": baris AP Aging yang TIDAK
            ketemu invoice pembelian-nya (mungkin invoice-nya belum
            diupload sama sekali)
        "ringkasan": rekap angka.
    """
    if df_pembelian is None or df_pembelian.empty:
        return {"hasil": [], "ap_aging_tanpa_invoice_pembelian": [], "ringkasan": {
            "catatan": "Tidak ada data Pembelian untuk dicocokkan.",
        }}

    df_invoice = df_pembelian[df_pembelian["jenis_dokumen"] == "INVOICE"].copy()
    if df_invoice.empty:
        return {"hasil": [], "ap_aging_tanpa_invoice_pembelian": [], "ringkasan": {
            "catatan": "Tidak ada baris INVOICE untuk dicocokkan.",
        }}
    df_invoice["_supplier_norm"] = df_invoice["nama_supplier"].apply(_normalisasi_nama_supplier)
    df_invoice["_nomor_norm"] = df_invoice["nomor_dokumen"].apply(lambda x: str(x or "").strip().lower())

    df_ap = pd.DataFrame()
    if df_ap_aging is not None and not df_ap_aging.empty:
        df_ap = df_ap_aging.copy()
        df_ap["_supplier_norm"] = df_ap["nama_supplier"].apply(_normalisasi_nama_supplier)
        df_ap["_nomor_norm"] = df_ap["nomor_invoice"].apply(lambda x: str(x or "").strip().lower())

    hasil = []
    ap_terpakai: set = set()

    # [BARU -- PERBAIKAN PERFORMA] Sebelumnya untuk SETIAP baris invoice,
    # df_ap difilter ULANG lewat boolean mask (3 perbandingan vektor +
    # isin() atas seluruh df_ap) -- untuk n_invoice x n_ap besar, total
    # kerja jadi O(n_invoice x n_ap) operasi pandas berulang. Sekarang
    # df_ap diindeks SEKALI di depan sbg dict {(supplier_norm, nomor_norm):
    # [baris,...]} -- tiap invoice tinggal dict lookup O(1) ke daftar
    # kandidat kecil (biasanya 1 baris), bukan scan ulang seluruh tabel.
    ap_by_key: Dict[Tuple[str, str], List[pd.Series]] = {}
    if not df_ap.empty:
        for apidx, row in df_ap.iterrows():
            key = (row["_supplier_norm"], row["_nomor_norm"])
            ap_by_key.setdefault(key, []).append(row)

    for idx, inv in df_invoice.iterrows():
        nilai_invoice = _hitung_total_invoice(inv)
        baris_ap = None
        for kandidat_row in ap_by_key.get((inv["_supplier_norm"], inv["_nomor_norm"]), []):
            if kandidat_row.name in ap_terpakai:
                continue
            baris_ap = kandidat_row
            break

        if baris_ap is None:
            hasil.append({
                "baris": int(idx) + 1,
                "nomor_invoice": inv.get("nomor_dokumen"),
                "nama_supplier": inv.get("nama_supplier"),
                "nilai_invoice": nilai_invoice,
                "status": "TIDAK_ADA_DI_AP_AGING",
                "catatan": "Invoice ini tidak ditemukan di Buku Bantu Utang (AP Aging) -- kemungkinan "
                           "sudah lunas & tidak lagi tercatat sbg utang, ATAU memang belum dimasukkan.",
            })
            continue

        ap_terpakai.add(baris_ap.name)
        jumlah_utang_ap = float(baris_ap.get("jumlah_utang") or 0)
        selisih = abs(nilai_invoice - jumlah_utang_ap)
        status = "MATCHED" if selisih <= toleransi_rupiah else "SELISIH_NOMINAL"
        entri = {
            "baris": int(idx) + 1,
            "nomor_invoice": inv.get("nomor_dokumen"),
            "nama_supplier": inv.get("nama_supplier"),
            "nilai_invoice": nilai_invoice,
            "jumlah_utang_ap_aging": jumlah_utang_ap,
            "selisih": round(selisih, 2),
            "status": status,
        }
        if status == "SELISIH_NOMINAL":
            entri["catatan"] = (
                f"Nilai invoice (Rp{nilai_invoice:,.0f}) berbeda dgn jumlah utang tercatat di AP Aging "
                f"(Rp{jumlah_utang_ap:,.0f}) -- cek apakah ada pembayaran sebagian/diskon yang belum tercatat."
            )
        hasil.append(entri)

    ap_tanpa_invoice = []
    if not df_ap.empty:
        for apidx, row in df_ap.iterrows():
            if apidx in ap_terpakai:
                continue
            ap_tanpa_invoice.append({
                "nama_supplier": row.get("nama_supplier"),
                "nomor_invoice": row.get("nomor_invoice"),
                "jumlah_utang": row.get("jumlah_utang"),
                "tanggal_jatuh_tempo": row.get("tanggal_jatuh_tempo"),
                "catatan": "Ada di Buku Bantu Utang tapi tidak ditemukan invoice pembelian yang cocok -- "
                           "cek apakah invoice pembelian-nya sudah diupload.",
            })

    jumlah_matched = sum(1 for h in hasil if h["status"] == "MATCHED")
    ringkasan = {
        "jumlah_invoice": len(df_invoice),
        "jumlah_matched": jumlah_matched,
        "jumlah_selisih_nominal": sum(1 for h in hasil if h["status"] == "SELISIH_NOMINAL"),
        "jumlah_tidak_ada_di_ap_aging": sum(1 for h in hasil if h["status"] == "TIDAK_ADA_DI_AP_AGING"),
        "jumlah_ap_aging_tanpa_invoice": len(ap_tanpa_invoice),
    }
    return {"hasil": hasil, "ap_aging_tanpa_invoice_pembelian": ap_tanpa_invoice, "ringkasan": ringkasan}


# ============================================================
# 8. ORKESTRATOR SIAP-PAKAI TINGKAT ENDPOINT
# ============================================================

# Kunci checklist (dipakai frontend & endpoint) -> fungsi & label.
DAFTAR_PENGECEKAN = {
    "po_invoice": "Pencocokan PO ↔ Invoice",
    "pph23_jasa": "Deteksi PPh 23 atas jasa",
    "harga_tidak_wajar": "Deteksi harga tidak wajar (riwayat)",
    "supplier_baru": "Deteksi supplier baru",
    "validasi_tanggal": "Validasi tanggal",
    "rekap_supplier": "Rekap per Supplier",
    "cross_check_ap_aging": "Cross-check ke AP Aging",
}


def jalankan_deteksi_kesalahan_pembelian(
    client_id: int,
    dbc_module,
    checks: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Fungsi siap-pakai tingkat endpoint: tarik data Pembelian (+ Bukti
    Potong Pajak & AP Aging kalau dibutuhkan check-nya) tersimpan untuk 1
    client, lalu jalankan pengecekan yang DIPILIH user (checks) dari
    DAFTAR_PENGECEKAN. checks=None atau [] berarti jalankan SEMUANYA.

    dbc_module: modul db_client, di-PASS sbg parameter (pola sama seperti
    cross_matching.jalankan_rekonsiliasi_lintas_dokumen) supaya tidak
    circular-import dgn db_client.py.

    Return dict: {kode_check: hasil_fungsi, ...} -- hanya utk check yang diminta.
    """
    checks = [c for c in (checks or list(DAFTAR_PENGECEKAN.keys())) if c in DAFTAR_PENGECEKAN]
    if not checks:
        return {}

    df_pembelian = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="pembelian"))

    hasil: Dict[str, Any] = {}

    if "po_invoice" in checks:
        hasil["po_invoice"] = cocokkan_po_invoice(df_pembelian)

    if "pph23_jasa" in checks:
        df_bukti_potong = _gabungkan_df_dari_hasil(
            dbc_module.ambil_hasil_client(client_id, jenis="bukti_potong_pajak")
        )
        hasil["pph23_jasa"] = deteksi_pph23_jasa(df_pembelian, df_bukti_potong)

    if "harga_tidak_wajar" in checks:
        hasil["harga_tidak_wajar"] = deteksi_harga_tidak_wajar(df_pembelian)

    if "supplier_baru" in checks:
        hasil["supplier_baru"] = deteksi_supplier_baru(df_pembelian)

    if "validasi_tanggal" in checks:
        hasil["validasi_tanggal"] = validasi_tanggal(df_pembelian)

    if "rekap_supplier" in checks:
        hasil["rekap_supplier"] = rekap_per_supplier(df_pembelian)

    if "cross_check_ap_aging" in checks:
        df_ap_aging = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="ap_aging"))
        hasil["cross_check_ap_aging"] = cross_check_ap_aging(df_pembelian, df_ap_aging)

    return hasil


# ============================================================
# CATATAN INTEGRASI (tambahkan di main.py)
# ============================================================
# from modules import deteksi_kesalahan_pembelian as dkp
#
# class DeteksiKesalahanPembelianRequest(BaseModel):
#     checks: List[str] = []  # kosong = semua
#
# @app.post("/api/client/{client_id}/deteksi-kesalahan-pembelian")
# def api_deteksi_kesalahan_pembelian(
#     client_id: int,
#     body: DeteksiKesalahanPembelianRequest,
#     user: dict = Depends(auth.get_current_user),
# ):
#     hasil = dkp.jalankan_deteksi_kesalahan_pembelian(client_id, dbc, checks=body.checks)
#     return _bersihkan_untuk_json(hasil)
#
# Di frontend: modal checklist (7 item DAFTAR_PENGECEKAN) mengirim daftar
# kode yang dicentang ke endpoint di atas, hasilnya dirender per-check
# sbg kartu di HasilTerpadu.jsx / bubble chat baru.