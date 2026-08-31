"""
modules/cross_matching.py
==========================
Rekonsiliasi lintas-dokumen (cross-matching).

Ini melengkapi modul-modul yang sudah ada di akuntansi_ai.py, yang selama
ini memproses tiap jenis dokumen SECARA TERPISAH (bank, piutang, faktur
pajak, SPT, slip gaji, absensi) tanpa saling mengecek satu sama lain.
Padahal ini persis salah satu kesalahan standar akuntan: "masih banyak uang
masuk sales di bank yang belum ketemu pasangannya", dan catatan eksplisit
di proses_absensi() ("cocokkan manual ke slip gaji") yang selama ini
memang belum ada otomasinya.

3 fungsi utama modul ini:
  1. cocokkan_bank_piutang()        -- mutasi bank masuk <-> piutang lunas
  2. cocokkan_ppn_faktur_spt()      -- PPN Keluaran (faktur pajak) <-> SPT Masa PPN
  3. cocokkan_slip_gaji_absensi()   -- slip gaji <-> rekap absensi

Plus 1 fungsi orkestrator siap-pakai tingkat endpoint:
  4. jalankan_rekonsiliasi_lintas_dokumen()

CATATAN PENTING: semua fungsi di sini RULE-BASED, bukan AI generatif --
karena ini soal pencocokan angka/nama antar dokumen, kepastian & bisa
dijelaskan (explainable) jauh lebih penting daripada "kepintaran". Hasil
"TIDAK_KETEMU" atau "PERLU_DICEK" WAJIB tetap direview manusia -- modul ini
mempercepat proses cari, bukan menggantikan keputusan akuntan.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("cross_matching")


# ============================================================
# HELPER UMUM
# ============================================================

def _ke_tanggal(value) -> Optional[date]:
    """Konversi berbagai format tanggal (string/Excel serial/datetime) ke date. None kalau gagal."""
    try:
        ts = pd.to_datetime(value, errors="coerce")
        if pd.isna(ts):
            return None
        return ts.date()
    except Exception:
        return None


def _gabungkan_df_dari_hasil(daftar_hasil: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Gabungkan kolom 'df' (list of records, hasil _bersihkan_untuk_json di
    main.py) dari SEMUA record hasil (keluaran dbc.ambil_hasil_client) jadi
    satu DataFrame -- supaya cross-matching melihat semua file yang pernah
    diupload utk jenis dokumen ini, bukan cuma upload terakhir.
    """
    potongan = []
    for h in daftar_hasil:
        data = h.get("data") or {}
        baris = data.get("df")
        if baris:
            potongan.append(pd.DataFrame(baris))
    if not potongan:
        return pd.DataFrame()
    return pd.concat(potongan, ignore_index=True)


# ============================================================
# 1. BANK MUTASI <-> PIUTANG LUNAS
# ============================================================
# Kolom yang dipakai (lihat parse_sheet_bank / parse_sheet_piutang di
# akuntansi_ai.py):
#   df_bank    : tanggal, keterangan, mutasi_debet, mutasi_kredit
#   df_piutang : no_transaksi, nama_pelanggan, tanggal, total_akhir

_TOLERANSI_HARI_BANK_PIUTANG_DEFAULT = 5
_TOLERANSI_RUPIAH_BANK_PIUTANG_DEFAULT = 2000  # biaya admin/transfer
_AMBANG_SKOR_NAMA_DEFAULT = 0.3

# Kata umum di keterangan mutasi bank yang TIDAK membantu mencocokkan nama
# (nama bank, kata transfer, dsb) -- dibuang supaya skor kemiripan nama
# lebih akurat.
_STOPWORDS_KETERANGAN_BANK = {
    "tf", "trf", "transfer", "dari", "ke", "pt", "cv", "bank", "bca", "bni",
    "bri", "mandiri", "va", "atas", "nama", "an", "pembayaran", "byr",
}


def _normalisasi_teks(teks) -> str:
    if teks is None:
        return ""
    teks = str(teks).lower()
    teks = re.sub(r"[^a-z0-9\s]", " ", teks)
    kata = [k for k in teks.split() if k not in _STOPWORDS_KETERANGAN_BANK and len(k) > 1]
    return " ".join(kata)


def _kata_ternormalisasi(teks) -> frozenset:
    """[BARU -- PERBAIKAN PERFORMA] Sama seperti _normalisasi_teks, tapi
    langsung return SET kata (bukan string) -- dipakai untuk PRA-HITUNG
    token sekali per baris (lihat cocokkan_bank_piutang), bukan dihitung
    ulang dari raw text tiap kali 1 pasang piutang x mutasi bank dibandingkan."""
    return frozenset(_normalisasi_teks(teks).split())


def _skor_kemiripan_nama_dari_kata(kata_nama: frozenset, kata_keterangan: frozenset) -> float:
    """[BARU -- PERBAIKAN PERFORMA] Versi _skor_kemiripan_nama yang menerima
    SET KATA yang SUDAH dihitung sebelumnya (bukan raw text) -- dipakai di
    hot path cocokkan_bank_piutang supaya tokenisasi (regex + split + buang
    stopword) tidak diulang untuk SETIAP pasangan piutang x mutasi bank yang
    dicoba (bisa ratusan ribu pasangan untuk file setahun penuh)."""
    if not kata_nama:
        return 0.0
    return len(kata_nama & kata_keterangan) / len(kata_nama)


def _skor_kemiripan_nama(nama_pelanggan, keterangan_bank) -> float:
    """Skor 0..1 = proporsi kata di nama_pelanggan yang juga muncul di keterangan_bank.
    Dipertahankan apa adanya untuk pemanggil luar (backward compatible) --
    hot path internal (cocokkan_bank_piutang) sekarang pakai
    _skor_kemiripan_nama_dari_kata dengan token yang sudah dihitung di muka."""
    kata_nama = _kata_ternormalisasi(nama_pelanggan)
    kata_keterangan = _kata_ternormalisasi(keterangan_bank)
    return _skor_kemiripan_nama_dari_kata(kata_nama, kata_keterangan)


@dataclass
class HasilCocokBankPiutang:
    piutang_index: int
    # [BERUBAH - Prioritas #8] Index BARIS ASLI di df_bank yang di-passing ke
    # cocokkan_bank_piutang() -- BUKAN posisi di dalam subset "uang masuk"
    # (sebelumnya bank_index tidak bisa dipakai langsung utk menulis balik
    # ke df_bank pemanggil karena df_bank_masuk di-reset_index; sekarang bisa).
    bank_index: Optional[int]
    no_transaksi: Any
    nama_pelanggan: Any
    total_akhir: float
    status: str  # "MATCHED" | "TIDAK_KETEMU"
    selisih_nominal: Optional[float] = None
    selisih_hari: Optional[int] = None
    skor_kemiripan_nama: Optional[float] = None
    keterangan_bank: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "piutang_index": self.piutang_index,
            "bank_index": self.bank_index,
            "no_transaksi": self.no_transaksi,
            "nama_pelanggan": self.nama_pelanggan,
            "total_akhir": self.total_akhir,
            "status": self.status,
            "selisih_nominal": self.selisih_nominal,
            "selisih_hari": self.selisih_hari,
            "skor_kemiripan_nama": self.skor_kemiripan_nama,
            "keterangan_bank": self.keterangan_bank,
        }


def cocokkan_bank_piutang(
    df_bank: pd.DataFrame,
    df_piutang: pd.DataFrame,
    toleransi_hari: int = _TOLERANSI_HARI_BANK_PIUTANG_DEFAULT,
    toleransi_rupiah: float = _TOLERANSI_RUPIAH_BANK_PIUTANG_DEFAULT,
    ambang_skor_nama: float = _AMBANG_SKOR_NAMA_DEFAULT,
) -> Dict[str, Any]:
    """
    Cocokkan tiap baris piutang (total_akhir) dengan mutasi bank MASUK
    (mutasi_kredit) yang nominalnya mirip (dalam toleransi rupiah), tanggalnya
    dekat (dalam toleransi hari), DAN nama pelanggan cukup mirip dengan
    keterangan mutasi bank (skor >= ambang_skor_nama) -- kecuali selisih
    nominal nyaris 0, di situ nama tidak wajib cocok (kemungkinan besar
    memang pasangannya).

    1 mutasi bank hanya dipakai untuk 1 piutang (tidak boleh dobel-pakai).

    Return dict:
        "hasil": list per baris piutang (status MATCHED/TIDAK_KETEMU)
        "mutasi_bank_masuk_belum_terpakai": mutasi bank masuk yang TIDAK
            ketemu pasangannya di piutang manapun -- ini "uang nyasar" yang
            biasanya jadi temuan review.
        "ringkasan": rekap angka.
    """
    if df_piutang is None or df_piutang.empty:
        return {"hasil": [], "mutasi_bank_masuk_belum_terpakai": [], "ringkasan": {
            "catatan": "Tidak ada data Piutang untuk dicocokkan.",
        }}

    df_bank = df_bank.copy() if df_bank is not None and not df_bank.empty else pd.DataFrame()
    if not df_bank.empty:
        df_bank["_tanggal"] = df_bank["tanggal"].apply(_ke_tanggal)
        # [FIX - Prioritas #8] Uang MASUK ke rekening bank tercatat di
        # mutasi_kredit, BUKAN mutasi_debet -- lihat konvensi yang konsisten
        # dipakai di akuntansi_ai.py (mis. _tentukan_arah_transaksi():
        # `"MASUK" if mutasi_kredit > 0 else "KELUAR"`, dan nominal_col utk
        # arah MASUK selalu 'mutasi_kredit'). Versi lama fungsi ini terbalik
        # (memfilter mutasi_debet > 0 sbg "uang masuk"), jadi SEMUA piutang
        # gagal cocok dgn mutasi bank yang benar (dan kalau kebetulan ada
        # mutasi_debet > 0 di baris yg sama, itu justru uang KELUAR yg salah
        # dicocokkan sbg pelunasan piutang).
        #
        # SENGAJA TIDAK di-reset_index(drop=True) -- index df_bank_masuk
        # dipertahankan SAMA dengan index di df_bank yang di-passing ke
        # fungsi ini, supaya "bank_index" di hasil bisa langsung dipakai
        # pemanggil (mis. accounting_export._cocokkan_supplier_opsional)
        # untuk menulis balik ke baris asal df_bank tanpa perlu pemetaan
        # index tambahan.
        df_bank_masuk = df_bank[df_bank["mutasi_kredit"].fillna(0).astype(float) > 0]
    else:
        df_bank_masuk = pd.DataFrame()

    hasil: List[HasilCocokBankPiutang] = []
    bank_terpakai: set = set()

    # [BARU -- PERBAIKAN PERFORMA] Sebelumnya loop di bawah memanggil
    # `df_bank_masuk.iterrows()` ULANG dari nol untuk SETIAP baris piutang
    # (nested loop O(n_piutang x n_bank), dan tiap `.iterrows()` sendiri
    # mahal -- bikin pandas Series baru per baris) -- DAN tokenisasi teks
    # keterangan bank (_normalisasi_teks -> regex + split) dihitung ULANG
    # untuk pasangan yang sama berkali-kali. Untuk file setahun penuh
    # (ratusan piutang x ribuan mutasi bank), ini bisa jutaan operasi teks
    # yang sebenarnya bisa dihitung SEKALI saja. Sekarang: iterasi
    # df_bank_masuk SEKALI di depan, hasilnya disimpan sbg list of dict
    # biasa (plain Python, jauh lebih murah diakses berulang daripada
    # DataFrame row) DENGAN token nama sudah pra-hitung. Logic
    # pencocokan/urutan prioritas TIDAK berubah sama sekali -- cuma cara
    # menyiapkan datanya.
    daftar_bank_masuk = []
    if not df_bank_masuk.empty:
        for bidx, brow in df_bank_masuk.iterrows():
            daftar_bank_masuk.append({
                "bidx": bidx,
                "mutasi_kredit": float(brow.get("mutasi_kredit") or 0),
                "tanggal": brow.get("_tanggal"),
                "tanggal_asli": brow.get("tanggal"),
                "keterangan": brow.get("keterangan"),
                "kata_keterangan": _kata_ternormalisasi(brow.get("keterangan")),
            })

    for idx, row in df_piutang.iterrows():
        try:
            total_akhir = float(row.get("total_akhir") or 0)
        except (TypeError, ValueError):
            total_akhir = 0.0
        tgl_piutang = _ke_tanggal(row.get("tanggal"))
        nama_pelanggan = row.get("nama_pelanggan")
        kata_nama = _kata_ternormalisasi(nama_pelanggan)

        kandidat: List[Tuple[int, float, Optional[int], float, Any]] = []
        if daftar_bank_masuk and total_akhir > 0:
            for b in daftar_bank_masuk:
                bidx = b["bidx"]
                if bidx in bank_terpakai:
                    continue
                # [FIX - Prioritas #8] uang masuk = mutasi_kredit (lihat catatan di atas)
                selisih_nominal = abs(b["mutasi_kredit"] - total_akhir)
                if selisih_nominal > toleransi_rupiah:
                    continue
                selisih_hari = None
                if tgl_piutang and b["tanggal"]:
                    selisih_hari = abs((b["tanggal"] - tgl_piutang).days)
                    if selisih_hari > toleransi_hari:
                        continue
                skor_nama = _skor_kemiripan_nama_dari_kata(kata_nama, b["kata_keterangan"])
                kandidat.append((bidx, selisih_nominal, selisih_hari, skor_nama, b["keterangan"]))

        terpilih = None
        if kandidat:
            # Utamakan skor nama tertinggi, lalu selisih nominal terkecil.
            kandidat.sort(key=lambda k: (-k[3], k[1]))
            bidx, selisih_nominal, selisih_hari, skor_nama, keterangan = kandidat[0]
            if skor_nama >= ambang_skor_nama or selisih_nominal <= 1:
                terpilih = (bidx, selisih_nominal, selisih_hari, skor_nama, keterangan)

        if terpilih:
            bidx, selisih_nominal, selisih_hari, skor_nama, keterangan = terpilih
            bank_terpakai.add(bidx)
            hasil.append(HasilCocokBankPiutang(
                piutang_index=int(idx), bank_index=int(bidx),
                no_transaksi=row.get("no_transaksi"), nama_pelanggan=nama_pelanggan,
                total_akhir=total_akhir, status="MATCHED",
                selisih_nominal=round(selisih_nominal, 2), selisih_hari=selisih_hari,
                skor_kemiripan_nama=round(skor_nama, 2), keterangan_bank=keterangan,
            ))
        else:
            hasil.append(HasilCocokBankPiutang(
                piutang_index=int(idx), bank_index=None,
                no_transaksi=row.get("no_transaksi"), nama_pelanggan=nama_pelanggan,
                total_akhir=total_akhir, status="TIDAK_KETEMU",
            ))

    mutasi_belum_terpakai = []
    for b in daftar_bank_masuk:
        if b["bidx"] not in bank_terpakai:
            mutasi_belum_terpakai.append({
                "tanggal": b["tanggal_asli"],
                "keterangan": b["keterangan"],
                "nominal": b["mutasi_kredit"],  # [FIX - Prioritas #8] uang masuk = mutasi_kredit
            })

    jumlah_matched = sum(1 for h in hasil if h.status == "MATCHED")
    ringkasan = {
        "jumlah_piutang": len(df_piutang),
        "jumlah_matched": jumlah_matched,
        "jumlah_tidak_ketemu": len(hasil) - jumlah_matched,
        "jumlah_mutasi_bank_masuk_belum_terpakai": len(mutasi_belum_terpakai),
        "total_nominal_bank_masuk_belum_terpakai": sum(float(m["nominal"] or 0) for m in mutasi_belum_terpakai),
    }

    return {
        "hasil": [h.to_dict() for h in hasil],
        "mutasi_bank_masuk_belum_terpakai": mutasi_belum_terpakai,
        "ringkasan": ringkasan,
    }


# ============================================================
# 2. PPN KELUARAN (FAKTUR PAJAK) <-> SPT MASA PPN
# ============================================================
# Kolom yang dipakai (lihat parse_sheet_faktur_pajak / parse_sheet_spt):
#   df_faktur_pajak : tanggal, npwp_penjual, ppn
#   df_spt          : jenis_spt_tersurat, masa_pajak, tahun_pajak, pajak_terutang

_NAMA_BULAN = {
    1: "JANUARI", 2: "FEBRUARI", 3: "MARET", 4: "APRIL", 5: "MEI", 6: "JUNI",
    7: "JULI", 8: "AGUSTUS", 9: "SEPTEMBER", 10: "OKTOBER", 11: "NOVEMBER", 12: "DESEMBER",
}


def _ambil_bulan_tahun(tanggal) -> Tuple[Optional[int], Optional[int]]:
    tgl = _ke_tanggal(tanggal)
    if tgl is None:
        return None, None
    return tgl.month, tgl.year


def cocokkan_ppn_faktur_spt(
    df_faktur_pajak: pd.DataFrame,
    df_spt: pd.DataFrame,
    npwp_perusahaan: Optional[str] = None,
    toleransi_rupiah: float = 5,
) -> Dict[str, Any]:
    """
    Rekap total PPN dari Faktur Pajak per Masa Pajak (bulan+tahun), lalu
    bandingkan dengan Pajak Terutang yang tertulis di SPT Masa PPN untuk
    masa yang sama.

    npwp_perusahaan: kalau diisi, HANYA faktur dengan npwp_penjual == ini
    yang dihitung sbg PPN Keluaran (perusahaan sbg penjual). Kalau None,
    SEMUA baris faktur yang di-pass dianggap Keluaran -- asumsikan file
    yang diproses memang khusus Faktur Pajak Keluaran sesuai alur upload
    per klien. Sesuaikan pemanggilan fungsi ini kalau tidak demikian.

    Return dict:
        "hasil": list per Masa Pajak (status MATCHED/SELISIH/SPT_TIDAK_DITEMUKAN)
        "ringkasan": rekap angka.
    """
    if df_faktur_pajak is None or df_faktur_pajak.empty:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data Faktur Pajak untuk dicocokkan."}}

    df = df_faktur_pajak.copy()
    if npwp_perusahaan:
        npwp_bersih = re.sub(r"\D", "", str(npwp_perusahaan))
        df = df[df["npwp_penjual"].apply(lambda x: re.sub(r"\D", "", str(x or "")) == npwp_bersih)]

    if df.empty:
        return {"hasil": [], "ringkasan": {
            "catatan": "Tidak ada faktur dengan NPWP penjual sesuai npwp_perusahaan.",
        }}

    bulan_tahun = df["tanggal"].apply(_ambil_bulan_tahun)
    df["_bulan"] = bulan_tahun.apply(lambda bt: bt[0])
    df["_tahun"] = bulan_tahun.apply(lambda bt: bt[1])
    df["ppn"] = pd.to_numeric(df["ppn"], errors="coerce").fillna(0)

    rekap_ppn = df.dropna(subset=["_bulan", "_tahun"]).groupby(["_tahun", "_bulan"])["ppn"].sum().reset_index()

    df_spt_ppn = pd.DataFrame()
    if df_spt is not None and not df_spt.empty:
        df_spt_ppn = df_spt[df_spt["jenis_spt_tersurat"].astype(str).str.upper().str.contains("PPN", na=False)]

    hasil = []
    for _, row in rekap_ppn.iterrows():
        tahun, bulan = int(row["_tahun"]), int(row["_bulan"])
        total_ppn_faktur = round(float(row["ppn"]), 2)

        baris_spt = pd.DataFrame()
        if not df_spt_ppn.empty:
            nama_bulan = _NAMA_BULAN.get(bulan, "###")
            baris_spt = df_spt_ppn[
                (df_spt_ppn["tahun_pajak"].astype(str).str.strip() == str(tahun))
                & (
                    df_spt_ppn["masa_pajak"].astype(str).str.contains(str(bulan), na=False)
                    | df_spt_ppn["masa_pajak"].astype(str).str.upper().str.contains(nama_bulan, na=False)
                )
            ]

        if baris_spt.empty:
            hasil.append({
                "tahun": tahun, "bulan": bulan, "total_ppn_faktur": total_ppn_faktur,
                "pajak_terutang_spt": None, "selisih": None,
                "status": "SPT_TIDAK_DITEMUKAN",
                "catatan": "Belum ada SPT Masa PPN yang diupload untuk periode ini -- cek apakah sudah lapor.",
            })
            continue

        pajak_terutang_spt = round(float(baris_spt.iloc[0].get("pajak_terutang") or 0), 2)
        selisih = round(total_ppn_faktur - pajak_terutang_spt, 2)
        status = "MATCHED" if abs(selisih) <= toleransi_rupiah else "SELISIH"
        hasil.append({
            "tahun": tahun, "bulan": bulan, "total_ppn_faktur": total_ppn_faktur,
            "pajak_terutang_spt": pajak_terutang_spt, "selisih": selisih, "status": status,
        })

    ringkasan = {
        "jumlah_periode_dicek": len(hasil),
        "jumlah_matched": sum(1 for h in hasil if h["status"] == "MATCHED"),
        "jumlah_selisih": sum(1 for h in hasil if h["status"] == "SELISIH"),
        "jumlah_tidak_ada_spt": sum(1 for h in hasil if h["status"] == "SPT_TIDAK_DITEMUKAN"),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 3. SLIP GAJI <-> ABSENSI
# ============================================================
# Rule-based (BUKAN AI) karena absensi TIDAK punya kolom potongan rupiah
# eksplisit -- itu baru dihitung di modul Slip Gaji. Fungsi ini hanya
# menandai kandidat yang PERLU DICEK MANUAL, sesuai catatan yang sudah ada
# di proses_absensi() -- bukan memutuskan nominal potongan secara otomatis.

_AMBANG_ALPHA_PERLU_POTONGAN = 1
_AMBANG_MENIT_TELAT_PERLU_REVIEW = 60  # total menit telat sebulan yang dianggap signifikan


def _normalisasi_nama_karyawan(nama) -> str:
    return re.sub(r"\s+", " ", str(nama or "").strip().lower())


def cocokkan_slip_gaji_absensi(
    df_slip_gaji: pd.DataFrame,
    rekap_per_karyawan_absensi: Dict[str, Dict[str, Any]],
    ambang_alpha: int = _AMBANG_ALPHA_PERLU_POTONGAN,
    ambang_menit_telat: int = _AMBANG_MENIT_TELAT_PERLU_REVIEW,
) -> Dict[str, Any]:
    """
    rekap_per_karyawan_absensi: dict ringkasan["rekap_per_karyawan"] dari
    proses_absensi() di akuntansi_ai.py -- key nama_karyawan, value dict
    berisi jumlah_alpha, total_menit_terlambat, dst.

    Untuk tiap karyawan yang absensinya menunjukkan alpha/telat signifikan,
    cek apakah slip gajinya (periode yang sama) punya kolom potongan_lain
    > 0. Kalau 0/kosong, tandai PERLU_DICEK -- kandidat "potongan belum
    dimasukkan", BUKAN kepastian (bisa jadi memang dipotong lewat komponen
    lain, mis. gaji_pokok yang sudah prorata).

    Return dict: "hasil" (hanya karyawan yang perlu perhatian), "ringkasan".
    """
    if not rekap_per_karyawan_absensi:
        return {"hasil": [], "ringkasan": {"catatan": "Tidak ada data absensi untuk dicocokkan."}}

    df_slip = df_slip_gaji.copy() if df_slip_gaji is not None and not df_slip_gaji.empty else pd.DataFrame()
    slip_by_nama: Dict[str, Dict[str, Any]] = {}
    if not df_slip.empty:
        for _, row in df_slip.iterrows():
            key = _normalisasi_nama_karyawan(row.get("nama_karyawan"))
            slip_by_nama[key] = row.to_dict()

    hasil = []
    for nama_karyawan, rekap in rekap_per_karyawan_absensi.items():
        alpha = rekap.get("jumlah_alpha", 0) or 0
        menit_telat = rekap.get("total_menit_terlambat", 0) or 0

        if alpha < ambang_alpha and menit_telat < ambang_menit_telat:
            continue  # absensi karyawan ini normal, tidak perlu dicek silang

        key = _normalisasi_nama_karyawan(nama_karyawan)
        slip = slip_by_nama.get(key)

        if slip is None:
            hasil.append({
                "nama_karyawan": nama_karyawan, "jumlah_alpha": alpha,
                "total_menit_terlambat": menit_telat, "status": "SLIP_TIDAK_DITEMUKAN",
                "catatan": "Absensi menunjukkan alpha/telat signifikan, tapi tidak ada slip gaji "
                           "karyawan ini untuk periode yang sama.",
            })
            continue

        potongan_lain = float(slip.get("potongan_lain") or 0)
        status = "OK_ADA_POTONGAN" if potongan_lain > 0 else "PERLU_DICEK"
        hasil.append({
            "nama_karyawan": nama_karyawan, "jumlah_alpha": alpha,
            "total_menit_terlambat": menit_telat, "potongan_lain_di_slip": potongan_lain,
            "status": status,
            "catatan": None if status == "OK_ADA_POTONGAN" else (
                "Absensi menunjukkan alpha/telat signifikan, tapi kolom 'potongan lain' di slip "
                "gaji karyawan ini 0/kosong -- cek manual apakah sudah dipotong lewat komponen lain."
            ),
        })

    ringkasan = {
        "jumlah_karyawan_absensi_signifikan": len(hasil),
        "jumlah_perlu_dicek_manual": sum(1 for h in hasil if h["status"] != "OK_ADA_POTONGAN"),
    }
    return {"hasil": hasil, "ringkasan": ringkasan}


# ============================================================
# 4. ORKESTRATOR SIAP-PAKAI TINGKAT ENDPOINT
# ============================================================

def jalankan_rekonsiliasi_lintas_dokumen(
    client_id: int,
    dbc_module,
    npwp_perusahaan: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fungsi siap-pakai tingkat endpoint: tarik semua hasil TERSIMPAN (bank,
    piutang, faktur_pajak, spt_masa, slip_gaji, absensi) untuk 1 client dari
    database (dbc.ambil_hasil_client), gabungkan tiap jenis jadi 1
    DataFrame, lalu jalankan ke-3 fungsi cocokkan_* di atas.

    dbc_module: modul db_client, di-PASS sbg parameter (bukan di-import
    langsung di atas file ini) supaya tidak circular-import dgn db_client.py
    -- panggil dari main.py dgn `import modules.db_client as dbc` lalu
    `cross_matching.jalankan_rekonsiliasi_lintas_dokumen(client_id, dbc)`.

    Return dict: "bank_vs_piutang", "ppn_vs_spt", "slip_gaji_vs_absensi".
    """
    df_bank = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="bank"))
    df_piutang = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="piutang"))
    df_faktur_pajak = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="faktur_pajak"))
    df_spt = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="spt_masa"))
    df_slip_gaji = _gabungkan_df_dari_hasil(dbc_module.ambil_hasil_client(client_id, jenis="slip_gaji"))

    # Absensi disimpan sbg RINGKASAN (rekap_per_karyawan), bukan df baris
    # per baris -- ambil dari hasil TERBARU saja (limit=1), karena tiap
    # upload absensi biasanya sudah mewakili 1 periode penuh, beda dgn
    # jenis lain yang perlu digabung lintas-upload.
    hasil_absensi = dbc_module.ambil_hasil_client(client_id, jenis="absensi", limit=1)
    rekap_absensi: Dict[str, Any] = {}
    if hasil_absensi:
        data_absensi = hasil_absensi[0].get("data") or {}
        rekap_absensi = data_absensi.get("ringkasan", {}).get("rekap_per_karyawan", {})

    return {
        "bank_vs_piutang": cocokkan_bank_piutang(df_bank, df_piutang),
        "ppn_vs_spt": cocokkan_ppn_faktur_spt(df_faktur_pajak, df_spt, npwp_perusahaan=npwp_perusahaan),
        "slip_gaji_vs_absensi": cocokkan_slip_gaji_absensi(df_slip_gaji, rekap_absensi),
    }


# ============================================================
# CATATAN INTEGRASI (tambahkan di main.py)
# ============================================================
# from modules import cross_matching
# import modules.db_client as dbc
#
# @app.get("/api/client/{client_id}/rekonsiliasi-lintas-dokumen")
# def api_rekonsiliasi_lintas_dokumen(
#     client_id: int,
#     npwp_perusahaan: Optional[str] = None,
#     user: dict = Depends(auth.get_current_user),
# ):
#     hasil = cross_matching.jalankan_rekonsiliasi_lintas_dokumen(
#         client_id, dbc, npwp_perusahaan=npwp_perusahaan,
#     )
#     return _bersihkan_untuk_json(hasil)
#
# Di frontend, ini bisa jadi tab baru di HasilTerpadu.jsx (mis. "🔗
# Rekonsiliasi Lintas-Dokumen") yang manggil endpoint di atas dan
# menampilkan 3 sub-tab: Bank vs Piutang, PPN vs SPT, Slip Gaji vs Absensi.