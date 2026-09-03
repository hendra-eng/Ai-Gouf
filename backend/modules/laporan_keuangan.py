"""
modules/laporan_keuangan.py
============================
Generator 5 Laporan Keuangan Standar (Neraca, Laba Rugi, Perubahan
Ekuitas, Arus Kas, CALK) dari JURNAL YANG SUDAH TERPOSTING (bukan draf
mentah -- lihat modules/history.py & db_client.JurnalPosting untuk alasan
kenapa harus lewat status "terposting" dulu) dan COA permanen client
(db_client.Coa).

Modul ini SENGAJA murni (tidak import db_client) -- menerima
list-of-dict biasa, mengembalikan dict siap-JSON -- supaya:
1. Mudah diuji tanpa perlu database aktif.
2. Endpoint di main.py yang bertanggung jawab mengambil data dari
   db_client lalu memanggil fungsi di sini, mengikuti pola yang sama
   seperti modules/accounting_export.py.

INPUT UTAMA:
- jurnal: list of dict, tiap dict minimal punya:
    no_akun_debet, jml_debet, no_akun_kredit, jml_kredit, tanggal (opsional)
  (bentuk yang sama seperti db_client.ambil_jurnal_terposting())
- coa: list of dict, tiap dict minimal punya:
    no_akun, nama_akun, kategori (ASET/LIABILITAS/EKUITAS/PENDAPATAN/BEBAN)
  (bentuk yang sama seperti db_client.ambil_coa_client())

CATATAN PENTING soal Arus Kas & CALK:
Arus Kas di sini dibuat dengan METODE LANGSUNG SEDERHANA berdasarkan
heuristik kategori akun lawan (lihat _klasifikasi_arus_kas) -- ini
titik awal yang wajar untuk 90% transaksi rutin (kas <-> pendapatan/
beban/piutang/utang = operasi, kas <-> aset tetap = investasi, kas <->
ekuitas/utang jangka panjang = pendanaan), TAPI tetap perlu direview
akuntan untuk transaksi tidak lazim -- makanya hasilnya ditandai
"draft" & disertai daftar transaksi yang klasifikasinya tidak yakin.
CALK dibuat sebagai KERANGKA otomatis (angka + template catatan umum),
BUKAN narasi lengkap siap-cetak -- bagian kebijakan akuntansi & catatan
kualitatif tetap perlu diisi/diverifikasi akuntan.
"""

from __future__ import annotations

import math
from collections import defaultdict, OrderedDict
from datetime import date
from typing import Any, Dict, List, Optional

from .logging_config import get_module_logger

logger = get_module_logger("laporan_keuangan")

KATEGORI_VALID = {"ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"}


def _angka(v) -> float:
    """
    [FIX] Konversi nilai ke float dengan aman -- None/NaN/inf/string kosong
    semua dianggap 0.0.

    Kode lama di modul ini pakai pola `float(x.get("jml_debet") or 0)`.
    Pola itu TERLIHAT aman tapi TIDAK aman untuk NaN: di Python,
    `float('nan') or 0` mengembalikan `nan` itu sendiri (NaN dianggap truthy,
    beda dengan None/0/""), jadi fallback "or 0"-nya tidak pernah kepakai
    kalau nilainya NaN. Begitu satu NaN masuk ke total_debet/total_kredit
    (mulai dari 0.0), SETIAP penjumlahan berikutnya ikut jadi NaN
    (nan + apa pun = nan) -- jadi 1 baris jurnal dengan jml_debet/jml_kredit
    kosong (yang lolos jadi NaN, bukan None murni, setelah lewat
    pandas/DataFrame di db_client.py) bisa MERACUNI saldo_akhir akun itu,
    lalu ikut meracuni total_aset/total_ekuitas/laba_rugi di Neraca & Laba
    Rugi -- semua secara DIAM-DIAM (tidak ada error yang muncul), akuntan
    baru sadar kalau kebetulan lihat "balance: false" atau angka aneh.

    Ini pola bug yang sama seperti yang sudah ditemukan & diperbaiki di
    akuntansi_ai.py (NaT/NaN yang lolos dari "is None") -- di sini
    manifestasinya di operasi aritmetika, bukan pengecekan kosong.
    """
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(f) or math.isinf(f):
        return 0.0
    return f

# Kategori dengan saldo normal DEBET vs KREDIT -- dipakai kalau
# normal_saldo tidak diisi eksplisit di COA.
_NORMAL_SALDO_DEFAULT = {
    "ASET": "DEBET", "BEBAN": "DEBET",
    "LIABILITAS": "KREDIT", "EKUITAS": "KREDIT", "PENDAPATAN": "KREDIT",
}


# ============================================================
# 1. PEMETAAN AKUN & SALDO
# ============================================================

def peta_akun_dari_coa(coa: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Ubah list COA jadi dict {no_akun: info_akun} untuk lookup cepat."""
    peta = {}
    for akun in coa or []:
        no_akun = str(akun.get("no_akun") or "").strip()
        if not no_akun:
            continue
        kategori = (akun.get("kategori") or "").strip().upper() or None
        peta[no_akun] = {
            "nama_akun": akun.get("nama_akun") or no_akun,
            "kategori": kategori if kategori in KATEGORI_VALID else None,
            "sub_kategori": akun.get("sub_kategori"),
            "normal_saldo": (akun.get("normal_saldo") or "").strip().upper() or None,
            # [FIX -- rantai keterangan COA -> CALK] Sebelumnya field
            # "keterangan" (catatan bebas per akun, diisi akuntan lewat
            # AkunCoaRequest.keterangan di main.py) DI-DROP di sini --
            # tidak pernah masuk ke peta lookup ini sama sekali, jadi
            # tidak mungkin sampai ke hitung_saldo_per_akun(), apalagi
            # ke modules/calk_mapping.py & modules/calk_export.py yang
            # memang butuh field ini utk catatan per-akun di CALK (lihat
            # terjemahkan_id_ke_en() di calk_export.py). Ditambahkan
            # ADDITIVE -- key baru, tidak mengubah/menghapus key lain,
            # jadi aman utk semua pemanggil peta_akun_dari_coa() yang
            # sudah ada.
            "keterangan": akun.get("keterangan"),
            # [BARU -- POINT 3] "saldo_awal" ditambahkan ke sini supaya
            # hitung_saldo_per_akun() bisa lookup O(1) lewat dict ini,
            # BUKAN scan linear ke list `coa` mentah per akun (lihat
            # catatan _entri() di hitung_saldo_per_akun() di bawah --
            # sebelumnya, tiap akun baru yang ditemui melakukan
            # `for akun in coa: ...` sendiri buat cari saldo_awal-nya,
            # padahal peta_coa/dict ini sudah dibangun sekali di awal
            # fungsi tsb). Additive juga -- tidak mengubah key lain,
            # aman utk semua pemanggil peta_akun_dari_coa() yang sudah ada.
            "saldo_awal": _angka(akun.get("saldo_awal")),
        }
    return peta


def hitung_saldo_per_akun(jurnal: List[Dict[str, Any]], coa: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Rekap saldo akhir per akun = SALDO AWAL (kolom saldo_awal di COA,
    kalau diisi) + pergerakan debet/kredit dari jurnal terposting periode
    ini. Semua akun COA disertakan meski tidak ada pergerakan (supaya
    saldo awal yang belum bergerak tetap tampil di Neraca) -- akun yang
    dipakai di jurnal tapi TIDAK ADA di COA tetap dimasukkan juga
    (kategori=None) supaya kelihatan di 'akun_tidak_dikenal' -- bukan
    diam-diam dibuang, karena itu tandanya COA client belum lengkap.
    """
    peta_coa = peta_akun_dari_coa(coa)
    saldo: Dict[str, Dict[str, Any]] = {}

    def _entri(no_akun: str, nama_akun_fallback: Optional[str] = None):
        if no_akun not in saldo:
            info = peta_coa.get(no_akun, {})
            # [FIX -- POINT 3, N+1 di dalam memori] Sebelumnya di sini ada
            # `for akun in coa or []: ...` -- scan linear ke SELURUH list
            # coa mentah, per akun BARU yang ditemui di jurnal, cuma buat
            # cari saldo_awal-nya satu nilai. Untuk COA besar (ratusan
            # akun) dipanggil dari fungsi yang sendirinya dipanggil 12x
            # (susun_laporan_bulanan_setahun), ini O(jumlah_akun_unik x
            # jumlah_akun_coa x 12) yang sebenarnya tidak perlu -- peta_coa
            # (dict, dibangun sekali di atas lewat peta_akun_dari_coa())
            # SUDAH punya "saldo_awal" per no_akun (lihat perubahan di
            # peta_akun_dari_coa() di atas), jadi cukup 1x lookup dict.
            saldo_awal_akun = info.get("saldo_awal", 0.0)
            saldo[no_akun] = {
                "no_akun": no_akun,
                "nama_akun": info.get("nama_akun") or nama_akun_fallback or no_akun,
                "kategori": info.get("kategori"),
                "sub_kategori": info.get("sub_kategori"),
                "normal_saldo": info.get("normal_saldo") or _NORMAL_SALDO_DEFAULT.get(info.get("kategori"), "DEBET"),
                "saldo_awal": saldo_awal_akun,
                "total_debet": 0.0,
                "total_kredit": 0.0,
                "dikenal_di_coa": no_akun in peta_coa,
                # [FIX -- rantai keterangan COA -> CALK] Diteruskan dari
                # peta_akun_dari_coa() (lihat catatan [FIX] di sana) --
                # None kalau akun tidak dikenal di COA atau memang tidak
                # diisi. Field ini murni pass-through, TIDAK dipakai
                # perhitungan saldo apa pun di fungsi ini.
                "keterangan": info.get("keterangan"),
                # [BARU] Sejak hanya_terposting=False dipakai di laporan-keuangan/
                # generate, pph-badan/generate & laporan-bulanan/generate (lihat
                # main.py) -- baris draft (termasuk yg akunnya masih placeholder,
                # pola "/" di kode akun, sama seperti _status_validasi_gl() di
                # accounting_export.py) ikut masuk apa adanya, tidak ada lagi gate
                # "harus posting manual dulu". 2 field di bawah menghitung berapa
                # banyak & berapa nominal baris placeholder yang nyumbang ke saldo
                # akun ini, dipakai untuk isi "keterangan_perlu_dikoreksi" di akhir
                # fungsi ini -- murni catatan audit, BUKAN validasi yang memblokir.
                "jumlah_baris_placeholder": 0,
                "nominal_placeholder": 0.0,
            }
        return saldo[no_akun]

    # Sertakan dulu SEMUA akun COA (supaya akun bersaldo awal tapi belum
    # bergerak periode ini tetap tampil di Neraca).
    for akun in coa or []:
        no_akun = str(akun.get("no_akun") or "").strip()
        if no_akun:
            _entri(no_akun)

    for baris in jurnal or []:
        no_debet = str(baris.get("no_akun_debet") or "").strip()
        no_kredit = str(baris.get("no_akun_kredit") or "").strip()
        jml_debet = _angka(baris.get("jml_debet"))  # [FIX] NaN-safe, lihat _angka()
        jml_kredit = _angka(baris.get("jml_kredit")) or jml_debet

        if no_debet:
            entri = _entri(no_debet, baris.get("nama_akun_debet"))
            entri["total_debet"] += jml_debet
            if "/" in no_debet:
                entri["jumlah_baris_placeholder"] += 1
                entri["nominal_placeholder"] += jml_debet
        if no_kredit:
            entri = _entri(no_kredit, baris.get("nama_akun_kredit"))
            entri["total_kredit"] += jml_kredit
            if "/" in no_kredit:
                entri["jumlah_baris_placeholder"] += 1
                entri["nominal_placeholder"] += jml_kredit

    for entri in saldo.values():
        pergerakan = entri["total_debet"] - entri["total_kredit"]
        if entri["normal_saldo"] == "KREDIT":
            entri["saldo_akhir"] = entri["saldo_awal"] - pergerakan
        else:
            entri["saldo_akhir"] = entri["saldo_awal"] + pergerakan

        # [BARU] Isi "keterangan_perlu_dikoreksi" -- None kalau akun ini bersih
        # (tidak ada baris placeholder yang nyumbang saldonya), atau teks
        # ringkas "apa yang perlu dikoreksi" kalau ada. Ini pengganti gate lama
        # ("harus posting manual dulu supaya masuk laporan") -- data tetap masuk
        # laporan apa adanya, cuma ditandai di sini supaya akuntan tahu akun mana
        # yang masih perlu ditelusuri akun lawannya.
        if entri["jumlah_baris_placeholder"] > 0:
            entri["keterangan_perlu_dikoreksi"] = (
                f'Perlu dikoreksi: {entri["jumlah_baris_placeholder"]} baris jurnal '
                f'(Rp{entri["nominal_placeholder"]:,.0f}) ke akun "{entri["no_akun"]}" '
                f'masih placeholder -- tentukan akun lawan sebenarnya.'
            )
        else:
            entri["keterangan_perlu_dikoreksi"] = None

    return saldo


# ============================================================
# 2. NERACA (BALANCE SHEET)
# ============================================================

def susun_neraca(saldo_per_akun: Dict[str, Dict[str, Any]], laba_rugi_berjalan: float,
                  penyesuaian_ekuitas_manual: float = 0.0) -> Dict[str, Any]:
    """
    Susun Neraca dari saldo per akun. Saldo awal tiap akun (termasuk akun
    Ekuitas) SUDAH otomatis ikut lewat hitung_saldo_per_akun() (dari
    kolom saldo_awal di COA) -- jadi TIDAK perlu input saldo awal ekuitas
    manual lagi di sini. Laba/rugi periode berjalan (dari susun_laba_rugi())
    ditambahkan sebagai baris terpisah di sisi Ekuitas ("Laba (Rugi) Tahun
    Berjalan") supaya Neraca balance tanpa perlu akun penutup manual.

    penyesuaian_ekuitas_manual: opsional, untuk koreksi manual akuntan
    kalau ada -- default 0 (tidak dipakai kalau COA sudah lengkap & benar).
    """
    aset = [a for a in saldo_per_akun.values() if a["kategori"] == "ASET"]
    liabilitas = [a for a in saldo_per_akun.values() if a["kategori"] == "LIABILITAS"]
    ekuitas = [a for a in saldo_per_akun.values() if a["kategori"] == "EKUITAS"]
    tidak_dikenal = [a for a in saldo_per_akun.values() if a["kategori"] is None]

    def _nilai_penambah_aset(akun: Dict[str, Any]) -> float:
        """
        [FIX] Akun KONTRA-ASET (mis. Akumulasi Penyusutan -- kategori ASET
        tapi saldo normal KREDIT) harus MENGURANGI total aset, bukan
        menambah. hitung_saldo_per_akun() sengaja menyimpan saldo_akhir
        akun kredit-normal sebagai angka POSITIF (representasi saldo dalam
        arah normalnya, dipakai apa adanya untuk LIABILITAS/EKUITAS/
        PENDAPATAN) -- tapi begitu akun itu dikategorikan ASET (kontra-aset),
        angka positif yang sama harus dibalik tandanya di sini sebelum
        dijumlahkan ke total_aset. Tanpa ini, Akumulasi Penyusutan malah
        menambah nilai aset alih-alih menguranginya, sehingga Neraca tidak
        balance tepat sebesar 2x nilai akumulasi penyusutan (pernah terjadi:
        Rp850jt aset tetap kotor + Rp125jt akumulasi penyusutan malah
        terbaca Rp975jt, padahal seharusnya Rp725jt neto).
        """
        if akun["normal_saldo"] == "KREDIT":
            return -akun["saldo_akhir"]
        return akun["saldo_akhir"]

    total_aset = sum(_nilai_penambah_aset(a) for a in aset)
    total_liabilitas = sum(a["saldo_akhir"] for a in liabilitas)
    total_ekuitas_akun = sum(a["saldo_akhir"] for a in ekuitas)
    total_ekuitas = total_ekuitas_akun + laba_rugi_berjalan + penyesuaian_ekuitas_manual

    selisih = round(total_aset - (total_liabilitas + total_ekuitas), 2)

    return {
        "aset": sorted(aset, key=lambda a: a["no_akun"]),
        "liabilitas": sorted(liabilitas, key=lambda a: a["no_akun"]),
        "ekuitas": sorted(ekuitas, key=lambda a: a["no_akun"]),
        "ekuitas_tambahan": [
            {"label": "Laba (Rugi) Tahun Berjalan", "nilai": round(laba_rugi_berjalan, 2)},
            {"label": "Penyesuaian Manual Akuntan", "nilai": round(penyesuaian_ekuitas_manual, 2)},
        ],
        "total_aset": round(total_aset, 2),
        "total_liabilitas": round(total_liabilitas, 2),
        "total_ekuitas": round(total_ekuitas, 2),
        "total_liabilitas_dan_ekuitas": round(total_liabilitas + total_ekuitas, 2),
        "selisih": selisih,
        "balance": abs(selisih) <= 1.0,
        "akun_tidak_dikenal_di_coa": sorted(tidak_dikenal, key=lambda a: a["no_akun"]),
    }


# ============================================================
# 3. LABA RUGI (INCOME STATEMENT)
# ============================================================

def susun_laba_rugi(saldo_per_akun: Dict[str, Dict[str, Any]], periode: str) -> Dict[str, Any]:
    """Susun Laba Rugi: Pendapatan - Beban = Laba/Rugi Bersih."""
    pendapatan = [a for a in saldo_per_akun.values() if a["kategori"] == "PENDAPATAN"]
    beban = [a for a in saldo_per_akun.values() if a["kategori"] == "BEBAN"]

    total_pendapatan = sum(a["saldo_akhir"] for a in pendapatan)
    total_beban = sum(a["saldo_akhir"] for a in beban)
    laba_bersih = total_pendapatan - total_beban

    return {
        "periode": periode,
        "pendapatan": sorted(pendapatan, key=lambda a: a["no_akun"]),
        "beban": sorted(beban, key=lambda a: a["no_akun"]),
        "total_pendapatan": round(total_pendapatan, 2),
        "total_beban": round(total_beban, 2),
        "laba_rugi_bersih": round(laba_bersih, 2),
        "status": "LABA" if laba_bersih >= 0 else "RUGI",
    }


# ============================================================
# 4. PERUBAHAN EKUITAS (STATEMENT OF CHANGES IN EQUITY)
# ============================================================

def susun_perubahan_ekuitas(saldo_per_akun: Dict[str, Dict[str, Any]], laba_rugi_bersih: float,
                             prive_atau_dividen: float = 0.0, setoran_modal_baru: float = 0.0,
                             periode: str = "", penyesuaian_ekuitas_manual: float = 0.0) -> Dict[str, Any]:
    """
    Susun Laporan Perubahan Ekuitas periode berjalan. Saldo awal ekuitas
    diambil OTOMATIS dari jumlah kolom saldo_awal semua akun berkategori
    EKUITAS di COA (bukan input manual lagi) -- konsisten dengan Neraca.
    prive/dividen & setoran modal baru TETAP input manual karena belum
    ada penanda otomatis yang konsisten di 15 pipeline untuk membedakan
    "setoran modal" dari transaksi kas masuk lain.

    [FIX] Parameter `penyesuaian_ekuitas_manual` ditambahkan supaya konsisten
    dengan susun_neraca() -- sebelumnya susun_neraca() menambahkan angka ini ke
    total_ekuitas Neraca, tapi fungsi ini (Perubahan Ekuitas) sama sekali tidak
    menerima/memakainya. Akibatnya begitu akuntan mengisi penyesuaian_ekuitas_manual
    != 0, saldo_akhir Perubahan Ekuitas & total_ekuitas Neraca selisih persis
    sebesar angka itu -- padahal kedua laporan ini WAJIB tie out (sama persis)
    secara akuntansi. Sekarang angka ini ikut ditambahkan ke saldo_akhir &
    ditampilkan sbg baris tersendiri, sama seperti di Neraca (ekuitas_tambahan).
    """
    saldo_awal_ekuitas = sum(
        a.get("saldo_awal", 0) for a in saldo_per_akun.values() if a.get("kategori") == "EKUITAS"
    )
    saldo_akhir = (
        saldo_awal_ekuitas + laba_rugi_bersih + setoran_modal_baru
        - prive_atau_dividen + penyesuaian_ekuitas_manual
    )
    return {
        "periode": periode,
        "saldo_awal": round(saldo_awal_ekuitas, 2),
        "laba_rugi_bersih": round(laba_rugi_bersih, 2),
        "setoran_modal_baru": round(setoran_modal_baru, 2),
        "prive_atau_dividen": round(prive_atau_dividen, 2),
        "penyesuaian_ekuitas_manual": round(penyesuaian_ekuitas_manual, 2),
        "saldo_akhir": round(saldo_akhir, 2),
        "catatan": (
            "Saldo awal ekuitas diambil otomatis dari COA (kolom saldo_awal akun EKUITAS). "
            "Setoran modal baru, prive/dividen, & penyesuaian manual tetap perlu diinput manual -- "
            "verifikasi ke akuntan sebelum laporan difinalkan."
        ),
    }


# ============================================================
# 5. ARUS KAS (CASH FLOW) -- metode langsung sederhana, heuristik
# ============================================================

_PENANDA_AKUN_KAS = ("KAS", "BANK")


def _akun_kas(info_akun: Dict[str, Any]) -> bool:
    nama = (info_akun.get("nama_akun") or "").upper()
    return info_akun.get("kategori") == "ASET" and any(p in nama for p in _PENANDA_AKUN_KAS)


def _klasifikasi_arus_kas(kategori_lawan: Optional[str], sub_kategori_lawan: Optional[str]) -> str:
    """Heuristik: kategori akun LAWAN (bukan akun kas itu sendiri) menentukan
    aktivitas operasi/investasi/pendanaan. Default 'operasi' kalau tidak
    yakin (paling aman & paling sering benar untuk transaksi rutin)."""
    sub = (sub_kategori_lawan or "").upper()
    if "ASET TETAP" in sub or "INVESTASI" in sub:
        return "investasi"
    if kategori_lawan == "EKUITAS" or "JANGKA PANJANG" in sub or "PINJAMAN" in sub:
        return "pendanaan"
    return "operasi"


def susun_arus_kas_sederhana(jurnal: List[Dict[str, Any]], peta_coa: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Susun Arus Kas metode langsung sederhana: telusuri tiap baris jurnal
    yang salah satu sisinya akun Kas/Bank, klasifikasikan ke Operasi/
    Investasi/Pendanaan berdasarkan akun lawannya. Baris jurnal yang
    TIDAK melibatkan akun kas sama sekali (mis. penjualan kredit) tidak
    memengaruhi arus kas & dilewati -- ini benar secara akuntansi.
    """
    aktivitas = {"operasi": 0.0, "investasi": 0.0, "pendanaan": 0.0}
    rincian = defaultdict(list)
    perlu_review = []

    for baris in jurnal or []:
        no_debet = str(baris.get("no_akun_debet") or "").strip()
        no_kredit = str(baris.get("no_akun_kredit") or "").strip()
        info_debet = peta_coa.get(no_debet, {})
        info_kredit = peta_coa.get(no_kredit, {})
        jml_debet = _angka(baris.get("jml_debet"))  # [FIX] NaN-safe, lihat _angka()
        jml_kredit = _angka(baris.get("jml_kredit")) or jml_debet

        debet_kas = _akun_kas(info_debet)
        kredit_kas = _akun_kas(info_kredit)

        if debet_kas and not kredit_kas:
            # Kas MASUK (debet kas), lawan di kredit menentukan aktivitas
            aktivitas_ = _klasifikasi_arus_kas(info_kredit.get("kategori"), info_kredit.get("sub_kategori"))
            aktivitas[aktivitas_] += jml_debet
            rincian[aktivitas_].append({
                "tanggal": baris.get("tanggal"), "keterangan": baris.get("keterangan"),
                "arah": "masuk", "nominal": jml_debet, "akun_lawan": no_kredit,
            })
            if info_kredit.get("kategori") is None:
                perlu_review.append(baris)
        elif kredit_kas and not debet_kas:
            # Kas KELUAR (kredit kas), lawan di debet menentukan aktivitas
            aktivitas_ = _klasifikasi_arus_kas(info_debet.get("kategori"), info_debet.get("sub_kategori"))
            aktivitas[aktivitas_] -= jml_kredit
            rincian[aktivitas_].append({
                "tanggal": baris.get("tanggal"), "keterangan": baris.get("keterangan"),
                "arah": "keluar", "nominal": jml_kredit, "akun_lawan": no_debet,
            })
            if info_debet.get("kategori") is None:
                perlu_review.append(baris)
        # kalau debet_kas dan kredit_kas dua-duanya True/False -> transfer
        # antar kas/bank atau tidak melibatkan kas -> tidak memengaruhi
        # arus kas neto, dilewati (benar secara akuntansi).

    total_arus_kas_bersih = sum(aktivitas.values())

    return {
        "arus_kas_operasi": round(aktivitas["operasi"], 2),
        "arus_kas_investasi": round(aktivitas["investasi"], 2),
        "arus_kas_pendanaan": round(aktivitas["pendanaan"], 2),
        "total_arus_kas_bersih": round(total_arus_kas_bersih, 2),
        "rincian": dict(rincian),
        "jumlah_transaksi_perlu_review": len(perlu_review),
        "status": "draft",
        "catatan": (
            "Arus kas ini hasil klasifikasi OTOMATIS berdasarkan kategori akun "
            "lawan (heuristik) -- WAJIB direview akuntan, terutama "
            f"{len(perlu_review)} transaksi yang akun lawannya belum dikenal di COA."
        ),
    }


# ============================================================
# 6. CALK (CATATAN ATAS LAPORAN KEUANGAN) -- kerangka otomatis
# ============================================================

def susun_calk_otomatis(peta_coa: Dict[str, Dict[str, Any]], saldo_per_akun: Dict[str, Dict[str, Any]],
                         periode: str) -> Dict[str, Any]:
    """
    Buat KERANGKA CALK otomatis: rincian saldo tiap akun besar, plus
    daftar catatan wajib yang masih kosong (placeholder) untuk diisi
    akuntan. Ini BUKAN CALK siap-cetak -- kebijakan akuntansi & narasi
    kualitatif tetap tanggung jawab akuntan.

    [REVISI -- lebih dekat ke struktur CALK formal] Sebelumnya semua akun
    (termasuk Pendapatan/Beban) dilempar rata ke SATU keranjang
    "rincian_per_kategori" tanpa pemisahan pos Neraca vs Laba Rugi, dan
    tanpa pengelompokan sub-kategori -- tidak lazim: CALK yang benar
    memisahkan catatan pos Neraca (Aset/Liabilitas/Ekuitas) dari catatan
    pos Laporan Laba Rugi (Pendapatan/Beban), dan tiap pos besar (mis.
    "Kas dan Setara Kas", "Piutang Usaha", "Aset Tetap") biasanya
    punya rincian sendiri, bukan cuma dilabeli kategori besarnya saja.

    Sekarang mengembalikan 2 struktur kategori->sub_kategori->[akun]
    terpisah:
    - "rincian_neraca"    : ASET -> LIABILITAS -> EKUITAS (urutan tetap,
      cocok Catatan #3 "Rincian akun-akun neraca")
    - "rincian_laba_rugi" : PENDAPATAN -> BEBAN (urutan tetap, cocok
      Catatan #4 "Rincian akun-akun laporan laba rugi")
    Akun yang kategorinya TIDAK dikenal di COA (kategori=None) TIDAK
    dibuang -- dikumpulkan terpisah di "akun_tidak_dikenal_kategori"
    supaya tetap kelihatan & bisa ditindaklanjuti (COA client belum
    lengkap), bukan diam-diam hilang dari CALK.

    Tiap baris akun menyertakan "normal_saldo" -- dipakai penulis sheet
    CALK (accounting_export._tulis_sheet_calk) untuk membalik tanda akun
    KONTRA (mis. Akumulasi Penyusutan: kategori ASET tapi normal_saldo
    KREDIT) sebelum dijumlahkan ke subtotal, PERSIS pola
    _nilai_penambah_aset() di susun_neraca() di atas -- supaya subtotal
    di CALK selalu tie-out dengan Total Aset/Liabilitas/Ekuitas di sheet
    Neraca dan Total Pendapatan/Beban di sheet Laba Rugi.
    """
    def _baris_akun(akun: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "no_akun": akun["no_akun"], "nama_akun": akun["nama_akun"],
            "saldo_akhir": round(akun["saldo_akhir"], 2),
            "normal_saldo": akun["normal_saldo"],
        }

    def _kelompokkan(daftar_kategori: List[str]) -> "OrderedDict[str, Dict[str, List[Dict[str, Any]]]]":
        """kategori -> sub_kategori -> list akun, urutan kategori mengikuti
        `daftar_kategori` (bukan urutan dict/hash yang tidak stabil), dan
        urutan sub_kategori mengikuti urutan kemunculan pertama di
        saldo_per_akun (stabil selama COA client stabil)."""
        hasil: "OrderedDict[str, Dict[str, List[Dict[str, Any]]]]" = OrderedDict()
        for kategori in daftar_kategori:
            per_sub: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
            for akun in sorted(saldo_per_akun.values(), key=lambda a: a["no_akun"]):
                if akun["kategori"] != kategori:
                    continue
                sub = (akun.get("sub_kategori") or "").strip() or "Lainnya"
                per_sub.setdefault(sub, []).append(_baris_akun(akun))
            if per_sub:
                hasil[kategori] = per_sub
        return hasil

    rincian_neraca = _kelompokkan(["ASET", "LIABILITAS", "EKUITAS"])
    rincian_laba_rugi = _kelompokkan(["PENDAPATAN", "BEBAN"])
    akun_tidak_dikenal_kategori = [
        _baris_akun(a) for a in sorted(saldo_per_akun.values(), key=lambda a: a["no_akun"])
        if a["kategori"] is None
    ]

    catatan_wajib_kosong = [
        "1. Umum -- gambaran entitas, kegiatan usaha, periode pelaporan.",
        "2. Ikhtisar Kebijakan Akuntansi Penting (standar yang dipakai: PSAK/SAK EMKM, dasar pengukuran, dsb).",
        "3. Rincian & penjelasan akun-akun signifikan Neraca (Aset/Liabilitas/Ekuitas) -- isi otomatis di 'rincian_neraca' di bawah, narasi tambahan perlu diisi.",
        "4. Rincian & penjelasan akun-akun signifikan Laporan Laba Rugi (Pendapatan/Beban) -- isi otomatis di 'rincian_laba_rugi' di bawah, narasi tambahan perlu diisi.",
        "5. Transaksi & saldo dengan pihak berelasi (jika ada) -- TIDAK terdeteksi otomatis, isi manual.",
        "6. Ikatan/komitmen & kontinjensi (jika ada) -- TIDAK terdeteksi otomatis, isi manual.",
        "7. Peristiwa setelah tanggal pelaporan (jika ada) -- TIDAK terdeteksi otomatis, isi manual.",
    ]

    return {
        "periode": periode,
        "rincian_neraca": {k: dict(v) for k, v in rincian_neraca.items()},
        "rincian_laba_rugi": {k: dict(v) for k, v in rincian_laba_rugi.items()},
        "akun_tidak_dikenal_kategori": akun_tidak_dikenal_kategori,
        "kerangka_catatan": catatan_wajib_kosong,
        "status": "draft",
        "catatan": "Kerangka otomatis -- kebijakan akuntansi & narasi kualitatif wajib dilengkapi akuntan sebelum difinalkan.",
    }


# ============================================================
# 7. ORKESTRASI -- panggil semua di atas sekaligus
# ============================================================

def generate_5_laporan_keuangan(
    jurnal: List[Dict[str, Any]],
    coa: List[Dict[str, Any]],
    periode: str,
    prive_atau_dividen: float = 0.0,
    setoran_modal_baru: float = 0.0,
    penyesuaian_ekuitas_manual: float = 0.0,
) -> Dict[str, Any]:
    """
    Fungsi utama: susun 5 Laporan Keuangan Standar sekaligus dari jurnal
    terposting + COA satu client untuk satu periode.

    Args:
        jurnal: list dict jurnal terposting (dari db_client.ambil_jurnal_terposting)
        coa: list dict COA client (dari db_client.ambil_coa_client) -- kolom
            saldo_awal di sini otomatis jadi saldo awal Neraca & Perubahan Ekuitas
        periode: label periode, mis. "2026-07"
        prive_atau_dividen / setoran_modal_baru / penyesuaian_ekuitas_manual:
            input manual dari akuntan (belum ada sumber otomatis konsisten)

    Returns:
        dict {neraca, laba_rugi, perubahan_ekuitas, arus_kas, calk, meta}
    """
    if not coa:
        logger.warning("⚠️ COA client kosong -- semua akun akan masuk 'akun_tidak_dikenal_di_coa'.")

    peta_coa = peta_akun_dari_coa(coa)
    saldo_per_akun = hitung_saldo_per_akun(jurnal, coa)

    laba_rugi = susun_laba_rugi(saldo_per_akun, periode)
    neraca = susun_neraca(saldo_per_akun, laba_rugi["laba_rugi_bersih"], penyesuaian_ekuitas_manual)
    perubahan_ekuitas = susun_perubahan_ekuitas(
        saldo_per_akun, laba_rugi["laba_rugi_bersih"], prive_atau_dividen, setoran_modal_baru, periode,
        penyesuaian_ekuitas_manual=penyesuaian_ekuitas_manual,
    )
    arus_kas = susun_arus_kas_sederhana(jurnal, peta_coa)
    calk = susun_calk_otomatis(peta_coa, saldo_per_akun, periode)

    meta = {
        "periode": periode,
        "jumlah_baris_jurnal_terposting": len(jurnal or []),
        "jumlah_akun_coa": len(coa or []),
        "jumlah_akun_tidak_dikenal_di_coa": len(neraca["akun_tidak_dikenal_di_coa"]),
        "neraca_balance": neraca["balance"],
        "peringatan": [],
    }
    if not jurnal:
        meta["peringatan"].append("Belum ada jurnal berstatus 'terposting' untuk periode ini.")
    if not neraca["balance"]:
        meta["peringatan"].append(
            f"Neraca TIDAK balance (selisih {neraca['selisih']:,.0f}) -- cek akun tidak dikenal & saldo awal ekuitas."
        )
    if neraca["akun_tidak_dikenal_di_coa"]:
        meta["peringatan"].append(
            f"{len(neraca['akun_tidak_dikenal_di_coa'])} akun dipakai di jurnal tapi belum terdaftar di COA client."
        )
    # [BARU] Safety-net: Neraca (total_ekuitas) & Perubahan Ekuitas (saldo_akhir)
    # WAJIB tie out (sama persis) secara akuntansi -- kalau ada penambahan field
    # baru di salah satu fungsi susun_neraca()/susun_perubahan_ekuitas() nanti dan
    # lupa disamakan di sisi lainnya (persis bug penyesuaian_ekuitas_manual yang
    # baru diperbaiki), selisihnya akan langsung ketahuan di sini alih-alih diam2
    # lolos ke laporan final.
    selisih_ekuitas = round(neraca["total_ekuitas"] - perubahan_ekuitas["saldo_akhir"], 2)
    if abs(selisih_ekuitas) > 1.0:
        meta["peringatan"].append(
            f"Total Ekuitas di Neraca ({neraca['total_ekuitas']:,.0f}) tidak sama dengan "
            f"Saldo Akhir di Perubahan Ekuitas ({perubahan_ekuitas['saldo_akhir']:,.0f}) -- "
            f"selisih {selisih_ekuitas:,.0f}. Kedua laporan ini wajib tie out; cek ulang input manual."
        )

    logger.info(
        f"📊 Laporan keuangan periode {periode} disusun: "
        f"balance={neraca['balance']}, laba/rugi={laba_rugi['laba_rugi_bersih']:,.0f}"
    )

    return {
        "neraca": neraca,
        "laba_rugi": laba_rugi,
        "perubahan_ekuitas": perubahan_ekuitas,
        "arus_kas": arus_kas,
        "calk": calk,
        "meta": meta,
    }


# ============================================================
# 8. SERI BULANAN (TRIAL BALANCE / LABA RUGI / BALANCE SHEET
#    JAN-DES DALAM SATU TABEL) -- meniru sheet "Trial Balance Bulanan",
#    "Laba Rugi Bulanan", "Balance Sheet Bulanan" pada model referensi.
# ============================================================

def _akhir_bulan(tahun: int, bulan: int):
    """Tanggal akhir bulan (mis. 2025-02 -> 2025-02-28)."""
    import calendar
    from datetime import date
    hari_terakhir = calendar.monthrange(tahun, bulan)[1]
    return date(tahun, bulan, hari_terakhir)


def _tanggal_jurnal(baris: Dict[str, Any]):
    """Ambil tanggal jurnal sbg objek date -- toleran terhadap string/None."""
    from datetime import date, datetime as dt_
    t = baris.get("tanggal")
    if t is None:
        return None
    if isinstance(t, date) and not isinstance(t, dt_):
        return t
    if isinstance(t, dt_):
        return t.date()
    try:
        import datetime as _dt_mod
        return _dt_mod.date.fromisoformat(str(t)[:10])
    except (ValueError, TypeError):
        return None


def susun_laporan_bulanan_setahun(
    jurnal: List[Dict[str, Any]],
    coa: List[Dict[str, Any]],
    tahun: int,
    sertakan_saldo_per_bulan: bool = False,
) -> Dict[str, Any]:
    """
    Susun Trial Balance, Laba Rugi, dan Balance Sheet untuk Jan-Des dalam
    SATU tabel per laporan (12 kolom bulan), dengan setiap bulan bersifat
    KUMULATIF sejak awal tahun (Trial Balance & Balance Sheet = saldo per
    akhir bulan itu; Laba Rugi = akumulasi tahun berjalan / YTD) -- pola
    yang sama seperti sheet "Trial Balance Bulanan" / "Laba Rugi Bulanan"
    (baris LABA BERSIH YTD) / "Balance Sheet Bulanan" pada model referensi.

    Cara kerja: filter jurnal dgn tanggal <= akhir bulan ke-N, lalu
    panggil ulang hitung_saldo_per_akun()/susun_laba_rugi()/susun_neraca()
    yang SUDAH ADA -- tidak menduplikasi logika perhitungan saldo, hanya
    memanggilnya 12x dengan potongan jurnal yang berbeda. Baris jurnal
    tanpa tanggal (tanggal=None) DIHITUNG DI SEMUA BULAN (asumsi paling
    aman: lebih baik ganda tampil drpd hilang -- akuntan bisa lihat dari
    'jumlah_baris_tanpa_tanggal' di meta kalau ada baris begini).

    Args:
        sertakan_saldo_per_bulan: [BARU -- POINT 3] default False (tidak
            mengubah perilaku/skema output lama sama sekali). Kalau True,
            hasil hitung_saldo_per_akun() UNTUK TIAP 12 BULAN (yang sudah
            pasti dihitung di dalam fungsi ini) ikut disertakan di return
            dict lewat key "_saldo_per_akun_per_bulan" (list, 12 elemen,
            index 0 = Januari). Ini SEMATA-MATA supaya pemanggil yang
            butuh data per-bulan yang sama (mis. main.py, untuk mengisi
            tabel riwayat_saldo_bulanan) bisa PAKAI ULANG hasil ini,
            BUKAN menghitung ulang hitung_saldo_per_akun() 12x lagi dari
            nol -- lihat catatan panjang di main.py pada
            api_generate_laporan_bulanan() & _susun_data_export_18_sheet()
            soal duplikasi ini.

            PENTING utk pemanggil: key "_saldo_per_akun_per_bulan" diberi
            underscore di depan & SENGAJA TIDAK didokumentasikan di
            docstring "Returns" di bawah karena ini BUKAN bagian dari
            skema output permanen -- kalau dict hasil fungsi ini akan
            disimpan ke database (dbc.simpan_hasil_analisis, lihat
            main.py), pemanggil WAJIB .pop("_saldo_per_akun_per_bulan")
            key ini dulu SEBELUM disimpan, supaya snapshot yang tersimpan
            permanen di DB tidak membengkak berisi data mentah per-akun
            yang sebetulnya turunan (bisa dihitung ulang kapan saja dari
            jurnal+coa) -- bukan bagian dari laporan itu sendiri.

    Returns:
        dict {
            "trial_balance_bulanan": {no_akun: {nama_akun, kategori, per_bulan: [12 saldo_akhir]}},
            "laba_rugi_bulanan": {"pendapatan_ytd": [...], "beban_ytd": [...], "laba_bersih_ytd": [...], "laba_bersih_bulanan": [...], "total_pendapatan_bulanan": [...]},
            "balance_sheet_bulanan": {"total_aset": [...], "total_liabilitas": [...], "total_ekuitas": [...], "balance": [...]},
            "meta": {...}
        }
    """
    jurnal = jurnal or []
    jumlah_tanpa_tanggal = sum(1 for b in jurnal if _tanggal_jurnal(b) is None)

    per_bulan_laba_rugi = []
    per_bulan_neraca = []
    per_bulan_saldo = []

    laba_bersih_bulan_sebelumnya = 0.0
    for bulan in range(1, 13):
        batas = _akhir_bulan(tahun, bulan)
        jurnal_sd_bulan_ini = [
            b for b in jurnal
            if (_tanggal_jurnal(b) is None or _tanggal_jurnal(b) <= batas)
        ]
        saldo_per_akun = hitung_saldo_per_akun(jurnal_sd_bulan_ini, coa)
        laba_rugi_ytd = susun_laba_rugi(saldo_per_akun, periode=f"{tahun}-{bulan:02d}")
        neraca = susun_neraca(saldo_per_akun, laba_rugi_ytd["laba_rugi_bersih"])

        laba_rugi_ytd["laba_bersih_bulanan"] = round(
            laba_rugi_ytd["laba_rugi_bersih"] - laba_bersih_bulan_sebelumnya, 2
        )
        laba_bersih_bulan_sebelumnya = laba_rugi_ytd["laba_rugi_bersih"]

        per_bulan_saldo.append(saldo_per_akun)
        per_bulan_laba_rugi.append(laba_rugi_ytd)
        per_bulan_neraca.append(neraca)

    # --- Trial Balance Bulanan: gabung semua akun yang pernah muncul di 12 bulan ---
    semua_no_akun = set()
    for saldo in per_bulan_saldo:
        semua_no_akun.update(saldo.keys())

    trial_balance_bulanan: Dict[str, Any] = {}
    for no_akun in sorted(semua_no_akun):
        info_pertama = next(
            (saldo[no_akun] for saldo in per_bulan_saldo if no_akun in saldo), {}
        )
        # [BARU] "keterangan_perlu_dikoreksi" diambil dari bulan TERAKHIR akun ini
        # muncul (bukan info_pertama/bulan pertama) -- karena tiap bulan dihitung
        # dari potongan jurnal kumulatif sejak awal tahun (lihat docstring fungsi
        # ini), bulan terakhir mencerminkan status koreksi paling lengkap/terbaru
        # sepanjang tahun tsb, bukan cuma bulan pertama akun itu kebetulan muncul.
        info_terakhir = next(
            (saldo[no_akun] for saldo in reversed(per_bulan_saldo) if no_akun in saldo), {}
        )
        trial_balance_bulanan[no_akun] = {
            "nama_akun": info_pertama.get("nama_akun", no_akun),
            "kategori": info_pertama.get("kategori"),
            "per_bulan": [
                round(saldo.get(no_akun, {}).get("saldo_akhir", 0.0), 2)
                for saldo in per_bulan_saldo
            ],
            "keterangan_perlu_dikoreksi": info_terakhir.get("keterangan_perlu_dikoreksi"),
        }

    # [BARU] "total_pendapatan_bulanan" -- pergerakan pendapatan PER BULAN
    # (bukan YTD), dihitung sama seperti "laba_bersih_bulanan" (delta
    # antar nilai YTD berurutan). Dibutuhkan sheet "Ringkasan" (baris
    # tren "Pendapatan" per bulan) yang butuh angka bulan berjalan, bukan
    # akumulasi -- sebelumnya cuma "total_pendapatan_ytd" yang tersedia.
    _pendapatan_ytd_list = [lr["total_pendapatan"] for lr in per_bulan_laba_rugi]
    total_pendapatan_bulanan = []
    _pendapatan_bulan_sebelumnya = 0.0
    for _v in _pendapatan_ytd_list:
        total_pendapatan_bulanan.append(round(_v - _pendapatan_bulan_sebelumnya, 2))
        _pendapatan_bulan_sebelumnya = _v

    laba_rugi_bulanan = {
        "total_pendapatan_ytd": _pendapatan_ytd_list,
        "total_beban_ytd": [lr["total_beban"] for lr in per_bulan_laba_rugi],
        "laba_bersih_ytd": [lr["laba_rugi_bersih"] for lr in per_bulan_laba_rugi],
        "laba_bersih_bulanan": [lr["laba_bersih_bulanan"] for lr in per_bulan_laba_rugi],
        "total_pendapatan_bulanan": total_pendapatan_bulanan,
    }

    balance_sheet_bulanan = {
        "total_aset": [n["total_aset"] for n in per_bulan_neraca],
        "total_liabilitas": [n["total_liabilitas"] for n in per_bulan_neraca],
        "total_ekuitas": [n["total_ekuitas"] for n in per_bulan_neraca],
        "balance": [n["balance"] for n in per_bulan_neraca],
    }

    bulan_tidak_balance = [i + 1 for i, ok in enumerate(balance_sheet_bulanan["balance"]) if not ok]

    hasil: Dict[str, Any] = {
        "tahun": tahun,
        "trial_balance_bulanan": trial_balance_bulanan,
        "laba_rugi_bulanan": laba_rugi_bulanan,
        "balance_sheet_bulanan": balance_sheet_bulanan,
        "meta": {
            "jumlah_baris_jurnal": len(jurnal),
            "jumlah_baris_tanpa_tanggal": jumlah_tanpa_tanggal,
            "bulan_tidak_balance": bulan_tidak_balance,
            "peringatan": (
                [f"{jumlah_tanpa_tanggal} baris jurnal tidak punya tanggal -- dihitung di semua bulan."]
                if jumlah_tanpa_tanggal else []
            ) + (
                [f"Balance Sheet tidak balance di bulan: {bulan_tidak_balance}"]
                if bulan_tidak_balance else []
            ),
        },
    }
    if sertakan_saldo_per_bulan:
        # [BARU -- POINT 3] Lihat docstring param sertakan_saldo_per_bulan
        # di atas -- WAJIB di-pop oleh pemanggil sebelum hasil ini disimpan
        # permanen ke database (dbc.simpan_hasil_analisis).
        hasil["_saldo_per_akun_per_bulan"] = per_bulan_saldo
    return hasil

# ============================================================
# 9. LAMPIRAN SPT TAHUNAN BADAN (A01-A09 / L01-L05 / E01-E04)
# ============================================================

def susun_lampiran_spt_bs(
    neraca: Dict[str, Any],
    periode: str,
) -> Dict[str, Any]:
    """
    Susun Lampiran A01-A09 (Neraca) format SPT Tahunan Badan, dari output
    susun_neraca() / generate_5_laporan_keuangan()["neraca"].

    Output format:
      - A01: Kas & Bank
      - A02: Piutang
      - A03: Persediaan
      - A04: Aset Lancar Lainnya
      - A05: Aset Tetap
      - A06: Akumulasi Penyusutan
      - A07: Aset Lainnya
      - A08: Total Aset
      - A09: Total Liabilitas & Ekuitas
    """
    def _total_kategori(kategori: str, sub_kategori: Optional[str] = None) -> float:
        total = 0.0
        for a in neraca.get("aset", []):
            if a.get("kategori") != kategori:
                continue
            if sub_kategori and a.get("sub_kategori") != sub_kategori:
                continue
            total += a.get("saldo_akhir", 0)
        return round(total, 2)

    def _total_liabilitas_ekuitas() -> tuple:
        total_liab = sum(a.get("saldo_akhir", 0) for a in neraca.get("liabilitas", []))
        total_ekuitas = sum(a.get("saldo_akhir", 0) for a in neraca.get("ekuitas", []))
        laba_rugi = 0.0
        for tambahan in neraca.get("ekuitas_tambahan", []):
            if tambahan.get("label") == "Laba (Rugi) Tahun Berjalan":
                laba_rugi = tambahan.get("nilai", 0)
                break
        return round(total_liab, 2), round(total_ekuitas + laba_rugi, 2)

    total_liab, total_ekuitas = _total_liabilitas_ekuitas()

    return {
        "periode": periode,
        "A01_Kas_dan_Bank": _total_kategori("ASET", "Kas"),
        "A02_Piutang": _total_kategori("ASET", "Piutang"),
        "A03_Persediaan": _total_kategori("ASET", "Persediaan"),
        "A04_Aset_Lancar_Lainnya": _total_kategori("ASET", "Aset Lancar"),
        "A05_Aset_Tetap": _total_kategori("ASET", "Aset Tetap"),
        "A06_Akumulasi_Penyusutan": -_total_kategori("ASET", "Akumulasi Penyusutan"),
        "A07_Aset_Lainnya": _total_kategori("ASET", "Aset Lainnya"),
        "A08_Total_Aset": neraca.get("total_aset", 0),
        "A09_Total_Liabilitas_dan_Ekuitas": total_liab + total_ekuitas,
        "total_liabilitas": total_liab,
        "total_ekuitas": total_ekuitas,
        "balance": abs(neraca.get("total_aset", 0) - (total_liab + total_ekuitas)) <= 1.0,
        "catatan": (
            "A01-A07 dikelompokkan lewat field 'sub_kategori' pada tiap akun COA -- "
            "WAJIB pastikan sub_kategori COA client memakai label persis: 'Kas', "
            "'Piutang', 'Persediaan', 'Aset Lancar', 'Aset Tetap', 'Akumulasi Penyusutan', "
            "'Aset Lainnya'. Akun dengan sub_kategori lain/kosong tidak ikut terhitung "
            "di baris manapun, walau tetap masuk A08_Total_Aset."
        ),
    }


def susun_lampiran_spt_pnl(
    laba_rugi: Dict[str, Any],
    periode: str,
) -> Dict[str, Any]:
    """
    Susun Lampiran L01-L05 (Laba Rugi) format SPT Tahunan Badan, dari
    output susun_laba_rugi() / generate_5_laporan_keuangan()["laba_rugi"].

    Output format:
      - L01: Pendapatan Usaha
      - L02: Harga Pokok Penjualan
      - L03: Beban Usaha
      - L04: Pendapatan Lain-lain
      - L05: Beban Lain-lain
    """
    def _total_kategori(kategori: str) -> float:
        return sum(a.get("saldo_akhir", 0) for a in laba_rugi.get(kategori, []))

    def _total_sub_kategori(kategori: str, sub_kategori: str) -> float:
        return sum(
            a.get("saldo_akhir", 0)
            for a in laba_rugi.get(kategori, [])
            if a.get("sub_kategori") == sub_kategori
        )

    return {
        "periode": periode,
        "L01_Pendapatan_Usaha": _total_kategori("pendapatan"),
        "L02_Harga_Pokok_Penjualan": _total_sub_kategori("beban", "HPP"),
        "L03_Beban_Usaha": _total_kategori("beban") - _total_sub_kategori("beban", "HPP"),
        "L04_Pendapatan_Lain_lain": 0.0,  # Belum ada pemisahan otomatis
        "L05_Beban_Lain_lain": 0.0,       # Belum ada pemisahan otomatis
        "total_pendapatan": laba_rugi.get("total_pendapatan", 0),
        "total_beban": laba_rugi.get("total_beban", 0),
        "laba_rugi_bersih": laba_rugi.get("laba_rugi_bersih", 0),
        "catatan": (
            "L02 (HPP) dihitung dari akun BEBAN dengan sub_kategori='HPP' -- pastikan "
            "COA client memberi label ini pada akun HPP. L04/L05 belum otomatis "
            "(pendapatan/beban lain-lain masih tergabung di L01/L03) -- isi manual bila perlu."
        ),
    }


def susun_lampiran_spt_ekuitas(
    perubahan_ekuitas: Dict[str, Any],
    periode: str,
) -> Dict[str, Any]:
    """
    Susun Lampiran E01-E04 (Perubahan Ekuitas) format SPT Tahunan Badan,
    dari output susun_perubahan_ekuitas() / generate_5_laporan_keuangan()["perubahan_ekuitas"].
    """
    return {
        "periode": periode,
        "E01_Saldo_Awal": perubahan_ekuitas.get("saldo_awal", 0),
        "E02_Tambahan_Modal": perubahan_ekuitas.get("setoran_modal_baru", 0),
        "E03_Laba_Rugi_Berjalan": perubahan_ekuitas.get("laba_rugi_bersih", 0),
        "E04_Pengurangan_Modal": -abs(perubahan_ekuitas.get("prive_atau_dividen", 0)),
        "saldo_akhir": perubahan_ekuitas.get("saldo_akhir", 0),
    }


def susun_lampiran_spt_lengkap(laporan: Dict[str, Any]) -> Dict[str, Any]:
    """
    Gabungkan ketiga lampiran (BS/PNL/Ekuitas) sekaligus dari output
    generate_5_laporan_keuangan() -- dipanggil langsung dari endpoint
    main.py tanpa perlu memanggil 3 fungsi terpisah.
    """
    periode = laporan.get("meta", {}).get("periode") or laporan.get("neraca", {}).get("periode", "")
    return {
        "periode": periode,
        "lampiran_bs": susun_lampiran_spt_bs(laporan.get("neraca", {}), periode),
        "lampiran_pnl": susun_lampiran_spt_pnl(laporan.get("laba_rugi", {}), periode),
        "lampiran_ekuitas": susun_lampiran_spt_ekuitas(laporan.get("perubahan_ekuitas", {}), periode),
    }
# ============================================================
# 10. LAMPIRAN SPT TAHUNAN BADAN - RINCI PER KODE AKUN
# ============================================================
# [BARU] Versi rinci dari susun_lampiran_spt_bs/pnl/ekuitas() di atas.
# Bedanya: alih-alih mengembalikan satu ANGKA TOTAL per baris (A01, A02,
# dst), fungsi *_rinci() ini mengembalikan LIST akun individual (no_akun,
# nama_akun, saldo) di tiap baris, sesuai kebutuhan sheet "Lampiran SPT
# BS/PNL" pada export 14-sheet -- karena SPT Tahunan Badan yang sesungguhnya
# memang meminta rincian per kode akun, bukan cuma total per kategori.
# Fungsi lama (total per kategori) TETAP dipertahankan untuk kompatibilitas
# mundur (dipakai tempat lain yang hanya butuh angka ringkas).

def susun_lampiran_spt_bs_rinci(
    neraca: Dict[str, Any],
    periode: str,
    tahun_sebelumnya: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Versi RINCI dari susun_lampiran_spt_bs(): tiap baris (A01-A07, A09)
    berisi LIST akun individual {no_akun, nama_akun, saldo}, bukan cuma
    total. A08 & total liabilitas/ekuitas tetap berupa angka ringkas.
    """
    def _akun_kategori(kategori: str, sub_kategori: Optional[str] = None) -> List[Dict[str, Any]]:
        hasil = []
        for a in neraca.get("aset", []):
            if a.get("kategori") != kategori:
                continue
            if sub_kategori and a.get("sub_kategori") != sub_kategori:
                continue
            hasil.append({
                "no_akun": a.get("no_akun"),
                "nama_akun": a.get("nama_akun"),
                "saldo": round(a.get("saldo_akhir", 0), 2),
            })
        return sorted(hasil, key=lambda x: str(x["no_akun"] or ""))

    liab = sorted(
        [{"no_akun": a.get("no_akun"), "nama_akun": a.get("nama_akun"),
          "saldo": round(a.get("saldo_akhir", 0), 2)} for a in neraca.get("liabilitas", [])],
        key=lambda x: str(x["no_akun"] or ""),
    )
    ekuitas = sorted(
        [{"no_akun": a.get("no_akun"), "nama_akun": a.get("nama_akun"),
          "saldo": round(a.get("saldo_akhir", 0), 2)} for a in neraca.get("ekuitas", [])],
        key=lambda x: str(x["no_akun"] or ""),
    )

    laba_rugi = 0.0
    for tambahan in neraca.get("ekuitas_tambahan", []):
        if tambahan.get("label") == "Laba (Rugi) Tahun Berjalan":
            laba_rugi = tambahan.get("nilai", 0)
            break
    if laba_rugi:
        ekuitas.append({
            "no_akun": "-",
            "nama_akun": "Laba (Rugi) Tahun Berjalan",
            "saldo": round(laba_rugi, 2),
        })

    total_liab = round(sum(a["saldo"] for a in liab), 2)
    total_ekuitas = round(sum(a["saldo"] for a in ekuitas), 2)
    total_aset = neraca.get("total_aset", 0)

    return {
        "periode": periode,
        "tahun_sebelumnya": tahun_sebelumnya,
        "A01_Kas_dan_Bank": _akun_kategori("ASET", "Kas"),
        "A02_Piutang": _akun_kategori("ASET", "Piutang"),
        "A03_Persediaan": _akun_kategori("ASET", "Persediaan"),
        "A04_Aset_Lancar_Lainnya": _akun_kategori("ASET", "Aset Lancar"),
        "A05_Aset_Tetap": _akun_kategori("ASET", "Aset Tetap"),
        "A06_Akumulasi_Penyusutan": _akun_kategori("ASET", "Akumulasi Penyusutan"),
        "A07_Aset_Lainnya": _akun_kategori("ASET", "Aset Lainnya"),
        "A08_Total_Aset": round(total_aset, 2),
        "A09_Liabilitas": liab,
        "A09_Ekuitas": ekuitas,
        "total_liabilitas": total_liab,
        "total_ekuitas": total_ekuitas,
        "total_liabilitas_dan_ekuitas": round(total_liab + total_ekuitas, 2),
        "balance": abs(total_aset - (total_liab + total_ekuitas)) <= 1.0,
        "catatan": (
            "Lampiran SPT Neraca (A01-A09) rinci per kode akun. Pengelompokan "
            "A01-A07 memakai field 'sub_kategori' pada tiap akun COA -- lihat "
            "catatan di susun_lampiran_spt_bs()."
        ),
    }


def susun_lampiran_spt_pnl_rinci(
    laba_rugi: Dict[str, Any],
    periode: str,
    tahun_sebelumnya: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Versi RINCI dari susun_lampiran_spt_pnl(): tiap baris (L01-L05) berisi
    LIST akun individual {no_akun, nama_akun, saldo}.
    """
    def _akun(kategori: str) -> List[Dict[str, Any]]:
        hasil = [
            {"no_akun": a.get("no_akun"), "nama_akun": a.get("nama_akun"),
             "saldo": round(a.get("saldo_akhir", 0), 2)}
            for a in laba_rugi.get(kategori, [])
        ]
        return sorted(hasil, key=lambda x: str(x["no_akun"] or ""))

    l02, l03 = [], []
    for a in laba_rugi.get("beban", []):
        item = {"no_akun": a.get("no_akun"), "nama_akun": a.get("nama_akun"),
                 "saldo": round(a.get("saldo_akhir", 0), 2)}
        if a.get("sub_kategori") == "HPP":
            l02.append(item)
        else:
            l03.append(item)
    l02 = sorted(l02, key=lambda x: str(x["no_akun"] or ""))
    l03 = sorted(l03, key=lambda x: str(x["no_akun"] or ""))

    return {
        "periode": periode,
        "tahun_sebelumnya": tahun_sebelumnya,
        "L01_Pendapatan_Usaha": _akun("pendapatan"),
        "L02_Harga_Pokok_Penjualan": l02,
        "L03_Beban_Usaha": l03,
        "L04_Pendapatan_Lain_lain": [],  # belum ada pemisahan otomatis
        "L05_Beban_Lain_lain": [],       # belum ada pemisahan otomatis
        "total_pendapatan": round(laba_rugi.get("total_pendapatan", 0), 2),
        "total_beban": round(laba_rugi.get("total_beban", 0), 2),
        "laba_rugi_bersih": round(laba_rugi.get("laba_rugi_bersih", 0), 2),
        "catatan": (
            "Lampiran SPT Laba Rugi (L01-L05) rinci per kode akun. L02 diambil dari "
            "akun BEBAN dengan sub_kategori='HPP'; L04/L05 belum otomatis."
        ),
    }


def susun_lampiran_spt_ekuitas_rinci(
    perubahan_ekuitas: Dict[str, Any],
    periode: str,
    tahun_sebelumnya: Optional[int] = None,
    coa: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Versi RINCI dari susun_lampiran_spt_ekuitas(), dengan parameter
    tambahan `tahun_sebelumnya` (untuk kolom pembanding di Excel) dan
    `coa` (opsional) untuk merinci saldo awal per akun ekuitas jika tersedia.
    """
    saldo_awal_rinci: List[Dict[str, Any]] = []
    if coa:
        for a in coa:
            if a.get("kategori") == "EKUITAS":
                saldo = a.get("saldo_awal", 0) or 0
                if saldo:
                    saldo_awal_rinci.append({
                        "no_akun": a.get("no_akun"),
                        "nama_akun": a.get("nama_akun"),
                        "saldo": round(saldo, 2),
                    })
    if not saldo_awal_rinci:
        saldo_awal_rinci.append({
            "no_akun": "-",
            "nama_akun": "Total Ekuitas Awal",
            "saldo": round(perubahan_ekuitas.get("saldo_awal", 0), 2),
        })

    setoran_modal = perubahan_ekuitas.get("setoran_modal_baru", 0) or 0
    tambahan_modal_rinci = (
        [{"no_akun": "-", "nama_akun": "Setoran Modal Baru", "saldo": round(setoran_modal, 2)}]
        if setoran_modal else []
    )

    laba_rugi = perubahan_ekuitas.get("laba_rugi_bersih", 0) or 0
    laba_rugi_rinci = [{"no_akun": "-", "nama_akun": "Laba (Rugi) Tahun Berjalan", "saldo": round(laba_rugi, 2)}]

    prive = perubahan_ekuitas.get("prive_atau_dividen", 0) or 0
    penyesuaian = perubahan_ekuitas.get("penyesuaian_ekuitas_manual", 0) or 0
    pengurangan_modal_rinci = []
    if prive:
        pengurangan_modal_rinci.append({"no_akun": "-", "nama_akun": "Prive/Dividen", "saldo": round(prive, 2)})
    if penyesuaian:
        pengurangan_modal_rinci.append({"no_akun": "-", "nama_akun": "Penyesuaian Manual", "saldo": round(penyesuaian, 2)})

    return {
        "periode": periode,
        "tahun_sebelumnya": tahun_sebelumnya,
        "E01_Saldo_Awal": saldo_awal_rinci,
        "E02_Tambahan_Modal": tambahan_modal_rinci,
        "E03_Laba_Rugi_Berjalan": laba_rugi_rinci,
        "E04_Pengurangan_Modal": pengurangan_modal_rinci,
        "total_saldo_awal": round(perubahan_ekuitas.get("saldo_awal", 0), 2),
        "total_tambahan_modal": round(setoran_modal, 2),
        "total_laba_rugi": round(laba_rugi, 2),
        "total_pengurangan_modal": round(prive + penyesuaian, 2),
        "saldo_akhir": round(perubahan_ekuitas.get("saldo_akhir", 0), 2),
        "catatan": "Lampiran SPT Ekuitas (E01-E04) rinci per kode akun.",
    }


def susun_lampiran_spt_lengkap_rinci(
    laporan: Dict[str, Any],
    tahun_sebelumnya: Optional[int] = None,
    coa: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Versi RINCI dari susun_lampiran_spt_lengkap() -- dipakai endpoint
    export 14-sheet untuk menghasilkan sheet "Lampiran SPT BS/PNL/Ekuitas".
    """
    periode = laporan.get("meta", {}).get("periode") or laporan.get("neraca", {}).get("periode", "")
    return {
        "periode": periode,
        "tahun_sebelumnya": tahun_sebelumnya,
        "lampiran_bs": susun_lampiran_spt_bs_rinci(laporan.get("neraca", {}), periode, tahun_sebelumnya),
        "lampiran_pnl": susun_lampiran_spt_pnl_rinci(laporan.get("laba_rugi", {}), periode, tahun_sebelumnya),
        "lampiran_ekuitas": susun_lampiran_spt_ekuitas_rinci(
            laporan.get("perubahan_ekuitas", {}), periode, tahun_sebelumnya, coa
        ),
    }


# ============================================================
# 10b. NERACA LAMPIRAN SPT -- FORMAT BAKU (sheet ke-12 export 14-sheet,
#      "BS Lampiran SPT") -- kolom SELALU sama, baris menyesuaikan client
# ============================================================
# [BARU] Beda dari susun_lampiran_spt_bs_rinci() (section 10 di atas):
# fungsi itu mengembalikan dict per-bucket (dipakai sheet lama yang
# kolomnya "Kode/No Akun/Nama Akun/Saldo Tahun Ini/Saldo Tahun Lalu").
# Fungsi baru ini mengembalikan LIST BARIS siap-tulis-Excel dengan
# STRUKTUR KOLOM BAKU yang diminta: Kode, Uraian, saldo tahun berjalan,
# saldo tahun lalu/Saldo Awal, Keterangan -- persis mengikuti template
# referensi "NERACA -- LAMPIRAN SPT TAHUNAN BADAN (DALAM RUPIAH)".
#
# Yang TETAP di semua client: 5 kolom di atas, urutan seksi
# ASET -> LIABILITAS -> EKUITAS, dan baris subtotal/JUMLAH/CHECK BALANCE.
#
# Yang MENYESUAIKAN otomatis per client:
#   - ASET: dikelompokkan lewat sub_kategori COA (bucket TETAP ada
#     walau nilainya 0 kalau client tidak punya akun di bucket itu --
#     supaya kode A01..A08 & posisi barisnya identik di semua client).
#     Bucket ini pakai label sub_kategori yang SAMA seperti
#     susun_lampiran_spt_bs_rinci() (section 10) -- "Kas", "Piutang",
#     "Persediaan", "Aset Lancar" (utk aset lancar lain-lain), "Aset
#     Tetap", "Akumulasi Penyusutan", "Aset Lainnya" -- supaya TIDAK
#     perlu tag sub_kategori baru di COA client yang sudah ada.
#   - LIABILITAS & EKUITAS: SATU baris per akun individual (kode
#     L01, L02, ... / E01, E02, ...) -- jumlah baris otomatis mengikuti
#     jumlah akun yang benar-benar dipakai client (mis. 2 pemilik modal
#     -> 2 baris E; 5 pemilik -> 5 baris), tanpa perlu bucket manual.
#     "Laba (Rugi) Tahun Berjalan" ditambahkan sebagai baris E terakhir
#     (bukan akun COA, tapi hasil Laba Rugi periode ini -- sama seperti
#     yang sudah dilakukan susun_lampiran_spt_ekuitas_rinci()).

_BUCKET_ASET_LANCAR_BAKU = [
    ("Kas", "Kas dan Setara Kas"),
    ("Piutang", "Piutang Usaha"),
    ("Piutang Lain-lain", "Piutang Lain-lain"),
    ("Persediaan", "Persediaan"),
    ("Uang Muka", "Uang Muka dan Biaya Dibayar Dimuka"),
]
# [FIX] Sebelumnya cuma 4 bucket (Kas/Piutang/Persediaan/"Aset Lancar"
# gabungan) -- template referensi "NERACA -- LAMPIRAN SPT TAHUNAN BADAN"
# punya 5 baris terpisah A01-A05 persis label di atas. sub_kategori baru
# "Piutang Lain-lain" & "Uang Muka" ditambahkan di sini; kalau akun COA
# client belum pernah ditag dgn label ini, baris itu otomatis tampil 0/
# placeholder (lihat _bucket() -- "Tidak ada akun di COA untuk bucket
# ini") -- PERSIS seperti baris A03/A05 di file referensi yang isinya "-".


def susun_neraca_lampiran_spt_baku(
    neraca: Dict[str, Any],
    coa: List[Dict[str, Any]],
    tahun: Any,
    tahun_sebelumnya: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Susun Neraca -- Lampiran SPT Tahunan Badan dengan STRUKTUR KOLOM BAKU
    (Kode, Uraian, saldo tahun berjalan, saldo tahun lalu/Saldo Awal,
    Keterangan) -- dipakai sheet "BS Lampiran SPT" (sheet ke-12 export
    14-sheet). Lihat catatan section 10b di atas untuk aturan penyesuaian
    per client.

    Args:
        neraca: output susun_neraca() / generate_5_laporan_keuangan()["neraca"]
        coa: list COA client (untuk lookup saldo_awal per akun)
        tahun: label tahun berjalan (mis. 2026 atau "2026")
        tahun_sebelumnya: label tahun lalu (opsional, hanya untuk header kolom)

    Returns:
        dict {"tahun", "tahun_sebelumnya", "baris": [...], "total_aset",
        "total_liabilitas_dan_ekuitas", "balance", "catatan"}.
        Tiap item "baris" salah satu dari 4 tipe:
          {"tipe": "judul", "uraian"}                     -- header seksi
          {"tipe": "akun", "kode", "uraian",
           "nilai_ini", "nilai_lalu", "keterangan",
           "sumber": "hitung"|"manual",                   -- "hitung" = nilai
              beneran dihitung dari akun COA client (tampil hijau di Excel),
              "manual" = bucket kosong/placeholder nihil (tampil biru + fill
              kuning, meniru sel "Input jika ada" di file referensi)
           "gaya": "subtotal"|"header_pertama" (opsional)} -- baris "akun"
              yang perlu gaya visual KHUSUS meski tetap tipe "akun": "subtotal"
              dipakai utk "Aset Tetap Neto" (A08, tampil boxed spt subtotal),
              "header_pertama" dipakai utk item liabilitas/ekuitas PERTAMA
              (L01/E01, tampil spt baris kategori)
          {"tipe": "subtotal", "uraian", "nilai_ini", "nilai_lalu"}
          {"tipe": "check", "uraian", "nilai_ini", "nilai_lalu", "keterangan"}
    """
    def _saldo_awal_akun(no_akun) -> float:
        for a in coa or []:
            if str(a.get("no_akun") or "") == str(no_akun or ""):
                return _angka(a.get("saldo_awal"))
        return 0.0

    def _bucket(list_akun: List[Dict[str, Any]], sub_kategori: str) -> tuple:
        akun_bucket = [a for a in list_akun if (a.get("sub_kategori") or "") == sub_kategori]
        nilai_ini = round(sum(a.get("saldo_akhir", 0) for a in akun_bucket), 2)
        nilai_lalu = round(sum(_saldo_awal_akun(a.get("no_akun")) for a in akun_bucket), 2)
        keterangan = (
            "Akun: " + ", ".join(str(a.get("no_akun")) for a in akun_bucket)
            if akun_bucket else "Tidak ada akun di COA untuk bucket ini"
        )
        # [FIX] "sumber" dipakai ws sheet Excel-nya (accounting_export.py) untuk
        # menentukan warna kolom nilai persis template referensi: hijau kalau
        # nilai benar2 dihitung dari akun COA client ("hitung"), biru+fill
        # kuning kalau bucket kosong/nihil jadi murni placeholder ("manual") --
        # sama seperti pola warna di file model "NERACA -- LAMPIRAN SPT
        # TAHUNAN BADAN".
        sumber = "hitung" if akun_bucket else "manual"
        return nilai_ini, nilai_lalu, keterangan, sumber

    aset = neraca.get("aset", [])
    liabilitas = sorted(neraca.get("liabilitas", []), key=lambda a: str(a.get("no_akun") or ""))
    ekuitas = sorted(neraca.get("ekuitas", []), key=lambda a: str(a.get("no_akun") or ""))

    baris: List[Dict[str, Any]] = []

    # ---------------- ASET ----------------
    baris.append({"tipe": "judul", "uraian": "ASET"})
    baris.append({"tipe": "judul", "uraian": "Aset Lancar"})
    kode_urut = 1
    total_lancar_ini = total_lancar_lalu = 0.0
    for sub_kat, label in _BUCKET_ASET_LANCAR_BAKU:
        nilai_ini, nilai_lalu, ket, sumber = _bucket(aset, sub_kat)
        baris.append({"tipe": "akun", "kode": f"A{kode_urut:02d}", "uraian": label,
                       "nilai_ini": nilai_ini, "nilai_lalu": nilai_lalu, "keterangan": ket,
                       "sumber": sumber})
        total_lancar_ini += nilai_ini
        total_lancar_lalu += nilai_lalu
        kode_urut += 1
    baris.append({"tipe": "subtotal", "uraian": "JUMLAH ASET LANCAR",
                   "nilai_ini": round(total_lancar_ini, 2), "nilai_lalu": round(total_lancar_lalu, 2)})

    baris.append({"tipe": "judul", "uraian": "Aset Tidak Lancar"})
    aset_tetap_ini, aset_tetap_lalu, ket_tetap, sumber_tetap = _bucket(aset, "Aset Tetap")
    baris.append({"tipe": "akun", "kode": f"A{kode_urut:02d}", "uraian": "Harga Perolehan Aset Tetap",
                   "nilai_ini": aset_tetap_ini, "nilai_lalu": aset_tetap_lalu, "keterangan": ket_tetap,
                   "sumber": sumber_tetap})
    kode_urut += 1
    akum_ini, akum_lalu, ket_akum, sumber_akum = _bucket(aset, "Akumulasi Penyusutan")
    baris.append({"tipe": "akun", "kode": f"A{kode_urut:02d}", "uraian": "Akumulasi Penyusutan",
                   "nilai_ini": akum_ini, "nilai_lalu": akum_lalu,
                   "keterangan": "Disajikan sebagai nilai pengurang. " + ket_akum,
                   "sumber": sumber_akum})
    kode_urut += 1
    # [FIX] "Aset Tetap Neto" (A08) BUKAN diikuti baris "JUMLAH ASET TIDAK
    # LANCAR" terpisah -- di template referensi baris A08 ITU SENDIRI yang
    # tampil dengan gaya subtotal (bold, fill, border ganda di bawah),
    # persis seperti "JUMLAH ASET LANCAR"/"JUMLAH ASET". Ditandai lewat
    # "gaya": "subtotal" supaya ws sheet-nya (accounting_export.py) tahu
    # cara mewarnainya walau tipe-nya tetap "akun" (masih punya "kode").
    aset_tetap_neto_ini = round(aset_tetap_ini - akum_ini, 2)
    aset_tetap_neto_lalu = round(aset_tetap_lalu - akum_lalu, 2)
    # [FIX] Kolom Keterangan (E) baris A08 di file referensi KOSONG (bukan
    # diisi rumus/penjelasan) -- disamakan di sini.
    baris.append({"tipe": "akun", "kode": f"A{kode_urut:02d}", "uraian": "Aset Tetap Neto",
                   "nilai_ini": aset_tetap_neto_ini, "nilai_lalu": aset_tetap_neto_lalu,
                   "keterangan": "",
                   "gaya": "subtotal"})
    kode_urut += 1
    lain_ini, lain_lalu, ket_lain, sumber_lain = _bucket(aset, "Aset Lainnya")
    baris.append({"tipe": "akun", "kode": f"A{kode_urut:02d}", "uraian": "Aset Lainnya",
                   "nilai_ini": lain_ini, "nilai_lalu": lain_lalu, "keterangan": ket_lain,
                   "sumber": sumber_lain})
    kode_urut += 1

    total_aset_ini = round(total_lancar_ini + aset_tetap_neto_ini + lain_ini, 2)
    total_aset_lalu = round(total_lancar_lalu + aset_tetap_neto_lalu + lain_lalu, 2)
    baris.append({"tipe": "subtotal", "uraian": "JUMLAH ASET",
                   "nilai_ini": total_aset_ini, "nilai_lalu": total_aset_lalu})

    # ---------------- LIABILITAS: satu baris per akun ----------------
    baris.append({"tipe": "judul", "uraian": "LIABILITAS"})
    kode_urut = 1
    total_liab_ini = total_liab_lalu = 0.0
    # [FIX] Baris L01 (item liabilitas PERTAMA) ditandai "gaya":
    # "header_pertama" -- di template referensi baris ini tampil dgn fill
    # biru muda #D9EAF7 + bold + warna teks navy #17365D, PERSIS gaya baris
    # kategori (LIABILITAS/EKUITAS), bukan gaya item biasa. Sama untuk E01
    # di seksi EKUITAS di bawah.
    if not liabilitas:
        baris.append({"tipe": "akun", "kode": "L01", "uraian": "(Tidak ada akun liabilitas di COA)",
                       "nilai_ini": 0.0, "nilai_lalu": 0.0, "keterangan": "",
                       "sumber": "manual", "gaya": "header_pertama"})
    for a in liabilitas:
        nilai_ini = round(a.get("saldo_akhir", 0), 2)
        nilai_lalu = round(_saldo_awal_akun(a.get("no_akun")), 2)
        baris.append({"tipe": "akun", "kode": f"L{kode_urut:02d}",
                       "uraian": a.get("nama_akun") or str(a.get("no_akun")),
                       "nilai_ini": nilai_ini, "nilai_lalu": nilai_lalu,
                       "keterangan": f"Akun {a.get('no_akun')}",
                       "sumber": "hitung",
                       "gaya": "header_pertama" if kode_urut == 1 else "normal"})
        total_liab_ini += nilai_ini
        total_liab_lalu += nilai_lalu
        kode_urut += 1
    baris.append({"tipe": "subtotal", "uraian": "JUMLAH LIABILITAS",
                   "nilai_ini": round(total_liab_ini, 2), "nilai_lalu": round(total_liab_lalu, 2)})

    # ---------------- EKUITAS: satu baris per akun + Laba Berjalan ----------------
    baris.append({"tipe": "judul", "uraian": "EKUITAS"})
    kode_urut = 1
    total_ekuitas_ini = total_ekuitas_lalu = 0.0
    for a in ekuitas:
        nilai_ini = round(a.get("saldo_akhir", 0), 2)
        nilai_lalu = round(_saldo_awal_akun(a.get("no_akun")), 2)
        baris.append({"tipe": "akun", "kode": f"E{kode_urut:02d}",
                       "uraian": a.get("nama_akun") or str(a.get("no_akun")),
                       "nilai_ini": nilai_ini, "nilai_lalu": nilai_lalu,
                       "keterangan": f"Akun {a.get('no_akun')}",
                       "sumber": "hitung",
                       "gaya": "header_pertama" if kode_urut == 1 else "normal"})
        total_ekuitas_ini += nilai_ini
        total_ekuitas_lalu += nilai_lalu
        kode_urut += 1

    laba_berjalan = 0.0
    penyesuaian_manual = 0.0
    for t in neraca.get("ekuitas_tambahan", []):
        if t.get("label") == "Laba (Rugi) Tahun Berjalan":
            laba_berjalan = _angka(t.get("nilai"))
        elif t.get("label") == "Penyesuaian Manual Akuntan":
            penyesuaian_manual = _angka(t.get("nilai"))

    baris.append({"tipe": "akun", "kode": f"E{kode_urut:02d}", "uraian": "Laba (Rugi) Tahun Berjalan",
                   "nilai_ini": round(laba_berjalan, 2), "nilai_lalu": 0.0,
                   "keterangan": "Dari Laporan Laba Rugi periode berjalan, bukan akun COA",
                   "sumber": "hitung"})
    total_ekuitas_ini += laba_berjalan
    kode_urut += 1

    if abs(penyesuaian_manual) > 0.0:
        baris.append({"tipe": "akun", "kode": f"E{kode_urut:02d}", "uraian": "Penyesuaian Manual Akuntan",
                       "nilai_ini": round(penyesuaian_manual, 2), "nilai_lalu": 0.0, "keterangan": "",
                       "sumber": "manual"})
        total_ekuitas_ini += penyesuaian_manual
        kode_urut += 1

    baris.append({"tipe": "subtotal", "uraian": "JUMLAH EKUITAS",
                   "nilai_ini": round(total_ekuitas_ini, 2), "nilai_lalu": round(total_ekuitas_lalu, 2)})

    total_liab_ekuitas_ini = round(total_liab_ini + total_ekuitas_ini, 2)
    total_liab_ekuitas_lalu = round(total_liab_lalu + total_ekuitas_lalu, 2)
    baris.append({"tipe": "subtotal", "uraian": "JUMLAH LIABILITAS DAN EKUITAS",
                   "nilai_ini": total_liab_ekuitas_ini, "nilai_lalu": total_liab_ekuitas_lalu})

    selisih_ini = round(total_aset_ini - total_liab_ekuitas_ini, 2)
    selisih_lalu = round(total_aset_lalu - total_liab_ekuitas_lalu, 2)
    baris.append({"tipe": "check", "uraian": "CHECK BALANCE",
                   "nilai_ini": selisih_ini, "nilai_lalu": selisih_lalu, "keterangan": "Harus nihil"})

    return {
        "tahun": tahun,
        "tahun_sebelumnya": tahun_sebelumnya,
        "baris": baris,
        "total_aset": total_aset_ini,
        "total_liabilitas_dan_ekuitas": total_liab_ekuitas_ini,
        "balance": abs(selisih_ini) <= 1.0,
        "catatan": (
            "Struktur kolom (Kode/Uraian/Tahun Ini/Tahun Lalu-Saldo Awal/Keterangan) baku "
            "untuk semua client, PERSIS 5 kolom & urutan seksi file referensi 'NERACA -- "
            "LAMPIRAN SPT TAHUNAN BADAN (DALAM RUPIAH)'. Baris ASET dikelompokkan lewat "
            "sub_kategori COA (bucket tetap A01-A09 tampil walau nilainya 0 kalau client tidak "
            "punya akun di bucket itu; A08 'Aset Tetap Neto' adalah baris subtotal boxed, TANPA "
            "baris 'JUMLAH ASET TIDAK LANCAR' terpisah). Baris LIABILITAS (L01..) & EKUITAS "
            "(E01..) satu baris per akun -- jumlah baris menyesuaikan otomatis sesuai akun "
            "liabilitas/ekuitas client (mis. jumlah pemilik modal); L01/E01 tampil dgn gaya "
            "kategori (fill navy muda + bold)."
        ),
    }



# ============================================================
# 10c. LABA RUGI & REKONSILIASI FISKAL -- LAMPIRAN SPT BAKU (sheet ke-13
#      export 14-sheet, "PNL Lampiran SPT") -- kolom SELALU sama, baris
#      menyesuaikan client. Pasangan langsung dari
#      susun_neraca_lampiran_spt_baku() (section 10b) di atas -- pola
#      IDENTIK, cuma sisi Laba Rugi + rekonsiliasi fiskal Pasal 31E,
#      bukan Neraca.
# ============================================================
# [BARU] Struktur kolom BAKU yang diminta: Kode, Uraian, Komersial
# <tahun>, Koreksi Positif, Koreksi Negatif, Fiskal <tahun>, Keterangan --
# persis mengikuti template referensi "LABA RUGI & REKONSILIASI FISKAL --
# LAMPIRAN SPT TAHUNAN BADAN".
#
# Yang TETAP di semua client: 7 kolom di atas, urutan seksi PENDAPATAN
# USAHA -> BEBAN LANGSUNG -> LABA KOTOR -> BEBAN OPERASIONAL -> EBITDA ->
# BEBAN PENYUSUTAN -> LABA USAHA -> Pendapatan Lain-lain -> Beban
# Lain-lain -> LABA BERSIH KOMERSIAL -> blok rekonsiliasi fiskal (TOTAL
# KOREKSI POSITIF/NEGATIF -> PENGHASILAN NETO FISKAL -> KOMPENSASI
# KERUGIAN FISKAL -> PKP SEBELUM PEMBULATAN -> PKP RIBUAN PENUH).
#
# Yang MENYESUAIKAN otomatis per client:
#   - Tiap seksi (PENDAPATAN USAHA, BEBAN LANGSUNG, BEBAN OPERASIONAL,
#     BEBAN PENYUSUTAN, Pendapatan Lain-lain, Beban Lain-lain): SATU
#     baris per akun individual (kode P01.., BL01.., BO01.., BP01..,
#     PL01.., BLL01..) -- jumlah baris otomatis mengikuti jumlah akun
#     PENDAPATAN/BEBAN yang benar-benar dipakai client. Seksi itu SENDIRI
#     tetap selalu tampil (dgn 1 baris placeholder "(tidak ada akun)")
#     walau client tidak punya akun di seksi itu -- supaya struktur
#     sheet tidak berubah bentuk antar client (sama seperti pola L01 di
#     susun_neraca_lampiran_spt_baku()).
#   - Pengelompokan seksi memakai field 'sub_kategori' pada akun COA:
#       * BEBAN, sub_kategori == "HPP"        -> BEBAN LANGSUNG
#       * BEBAN, sub_kategori == "Penyusutan" -> BEBAN PENYUSUTAN
#       * PENDAPATAN/BEBAN, sub_kategori == "Lain-lain"
#             -> Pendapatan Lain-lain / Beban Lain-lain
#       * BEBAN lainnya (sub_kategori apa pun/kosong selain 3 di atas)
#             -> BEBAN OPERASIONAL
#       * PENDAPATAN lainnya -> PENDAPATAN USAHA
#     Akun BEBAN/PENDAPATAN yang belum diberi sub_kategori otomatis
#     masuk BEBAN OPERASIONAL / PENDAPATAN USAHA (default paling umum),
#     BUKAN hilang -- supaya tidak ada akun yang diam-diam tidak terhitung.
#   - Koreksi Positif/Negatif PER AKUN pada baris di atas defaultnya 0
#     (kolom itu memang tempat INPUT MANUAL akuntan kalau ada koreksi
#     fiskal yang menempel ke akun tertentu, mengikuti template
#     referensi -- semua baris D/E di file itu juga 0). Angka koreksi
#     fiskal AGREGAT yang benar-benar dipakai untuk menghitung PKP TIDAK
#     diambil dari penjumlahan kolom ini, tapi dari parameter
#     `rekonsiliasi_pkp` (hasil pph_badan.hitung_pkp(), sumbernya al.
#     modules.fiscal_reconciliation -- lihat catatan baris "TOTAL KOREKSI
#     FISKAL POSITIF/NEGATIF" di bawah) -- PERSIS pola file referensi user
#     (baris C33/D33 mengambil dari sheet lain, bukan SUM kolom D di atas).

_SUB_KATEGORI_HPP = "HPP"
_SUB_KATEGORI_PENYUSUTAN = "Penyusutan"
_SUB_KATEGORI_LAIN_LAIN = "Lain-lain"


def susun_laba_rugi_rekonsiliasi_fiskal_lampiran_spt_baku(
    laba_rugi: Dict[str, Any],
    tahun: Any,
    rekonsiliasi_pkp: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Susun Laba Rugi & Rekonsiliasi Fiskal -- Lampiran SPT Tahunan Badan
    dengan STRUKTUR KOLOM BAKU (Kode, Uraian, Komersial, Koreksi Positif,
    Koreksi Negatif, Fiskal, Keterangan) -- dipakai sheet "PNL Lampiran
    SPT" (sheet ke-13 export 14-sheet). Lihat catatan section 10c di atas
    untuk aturan penyesuaian per client.

    Args:
        laba_rugi: output susun_laba_rugi() / generate_5_laporan_keuangan()
            ["laba_rugi"] -- list "pendapatan"/"beban" tiap akun WAJIB
            punya no_akun, nama_akun, sub_kategori, saldo_akhir.
        tahun: label tahun berjalan (mis. 2026 atau "2026").
        rekonsiliasi_pkp: dict hasil pph_badan.hitung_pkp() (atau
            pph_hasil["rekonsiliasi_fiskal"] dari
            pph_badan.hitung_pph_pasal_31e()) -- field yang dipakai:
            laba_bersih_komersial, koreksi_fiskal_positif,
            koreksi_fiskal_negatif, penghasilan_neto_fiskal,
            kompensasi_kerugian_fiskal, pkp_sebelum_pembulatan,
            penghasilan_kena_pajak. Opsional -- kalau tidak dikirim (mis.
            PPh Badan belum pernah digenerate untuk tahun ini), blok
            rekonsiliasi fiskal dihitung fallback TANPA koreksi apa pun
            (koreksi positif/negatif = 0) memakai laba_rugi_bersih dari
            `laba_rugi` -- supaya sheet tetap terbentuk lengkap, bukan
            error/kosong, dan `catatan` menandai kalau ini fallback.

    Returns:
        dict {"tahun", "baris": [...], "laba_bersih_komersial",
        "penghasilan_kena_pajak", "catatan"}.
        Tiap item "baris" salah satu dari 3 tipe:
          {"tipe": "judul", "uraian"}                        -- header seksi
          {"tipe": "akun", "kode", "uraian", "komersial",
           "koreksi_positif", "koreksi_negatif", "fiskal",
           "keterangan"}                                     -- baris akun.
              [FIX] "kode" = nomor akun COA ASLI (a["no_akun"]), BUKAN
              lagi kode buatan urut per seksi (dulu "P01"/"BL01"/dst) --
              supaya baris tertelusur ke sheet COA/GL/Trial Balance,
              konsisten dgn sheet lain. Fallback ke kode buatan HANYA
              kalau akun kebetulan tidak punya no_akun / seksi kosong.
          {"tipe": "subtotal", "uraian", "komersial", "fiskal",
           "keterangan"}                                     -- JUMLAH/EBITDA/dst
    """
    # [FIX -- match 100% referensi LABA_RUGI___REKONSILIASI.xlsx] Teks
    # keterangan standar yang muncul di SEMUA baris akun/judul seksi
    # (kolom G), persis kata-per-kata seperti file referensi -- lihat
    # audit sel-demi-sel di _tulis_sheet_pnl_lampiran_spt_baku()
    # (modules/accounting_export.py) untuk baris mana saja yang memakainya.
    _KET_STANDAR = "Koreksi fiskal diinput pada bagian rekonsiliasi sheet Laba Rugi Bulanan"

    def _seksi_akun(list_akun: List[Dict[str, Any]], kode_prefix: str,
                     label_kosong: str, arah: str) -> tuple:
        """Satu baris per akun -- pola sama seperti L01../E01.. di
        susun_neraca_lampiran_spt_baku(). Koreksi per akun default 0
        (kolom input manual, lihat catatan section 10c).

        arah: "pendapatan" atau "beban" -- dipakai exporter utk menentukan
        tanda formula kolom Fiskal (pendapatan: =Komersial+Positif-Negatif,
        beban: =Komersial-Positif+Negatif), PERSIS pola file referensi
        (baris 4101 pakai C+D-E, baris 5101 pakai C-D+E).

        [FIX] Kolom "kode" SEBELUMNYA selalu kode buatan urut per seksi
        (mis. "P01", "BL01", "BO03") -- BEDA dari kolom "Kode" di sheet
        lain (Trial Balance/GL/Buku Besar/COA) yang selalu memakai nomor
        akun COA ASLI. Akibatnya sheet "PNL Lampiran SPT" & "Rekonsiliasi
        Fiskal" (dua-duanya pakai fungsi ini lewat `pnl_baku`) TIDAK bisa
        ditelusuri balik ke akun COA/GL mana pun -- padahal di sini
        (beda dari susun_neraca_lampiran_spt_baku() yg satu baris = satu
        BUCKET berisi banyak akun) satu baris memang persis satu akun,
        jadi nomor akun asli selalu tersedia & bisa langsung dipakai
        sebagai "Kode" tanpa kehilangan info apa pun. Prefix kode lama
        (kode_prefix) TETAP dipakai sbg fallback kalau no_akun kosong,
        supaya baris tidak pernah punya "Kode" benar-benar kosong."""
        baris_seksi: List[Dict[str, Any]] = []
        total_komersial = 0.0
        akun_terurut = sorted(list_akun, key=lambda a: str(a.get("no_akun") or ""))
        if not akun_terurut:
            baris_seksi.append({
                "tipe": "akun", "kode": f"{kode_prefix}01", "uraian": label_kosong,
                "arah": arah, "komersial": 0.0, "koreksi_positif": 0.0,
                "koreksi_negatif": 0.0, "fiskal": 0.0, "keterangan": _KET_STANDAR,
            })
            return baris_seksi, 0.0
        for i, a in enumerate(akun_terurut, start=1):
            komersial = round(_angka(a.get("saldo_akhir")), 2)
            no_akun = a.get("no_akun")
            kode_baris = str(no_akun) if no_akun not in (None, "") else f"{kode_prefix}{i:02d}"
            baris_seksi.append({
                "tipe": "akun", "kode": kode_baris,
                "uraian": a.get("nama_akun") or str(a.get("no_akun")),
                "arah": arah, "komersial": komersial, "koreksi_positif": 0.0,
                "koreksi_negatif": 0.0,
                "fiskal": komersial,  # Fiskal = Komersial +/- 0 (belum ada koreksi per akun)
                "keterangan": _KET_STANDAR,
            })
            total_komersial += komersial
        return baris_seksi, round(total_komersial, 2)

    def _subtotal(uraian: str, komersial: float, fiskal: float,
                  keterangan: str = "", d: Optional[float] = None,
                  e: Optional[float] = None) -> Dict[str, Any]:
        """d/e: HANYA dipakai baris "TOTAL KOREKSI FISKAL POSITIF/NEGATIF"
        -- persis file referensi, baris itu satu-satunya subtotal yang juga
        mengisi kolom Koreksi Positif (D) / Koreksi Negatif (E) dengan
        angka yang sama seperti kolom Komersial (C)."""
        out = {"tipe": "subtotal", "uraian": uraian,
               "komersial": round(_angka(komersial), 2), "fiskal": round(_angka(fiskal), 2),
               "keterangan": keterangan}
        if d is not None:
            out["koreksi_positif"] = round(_angka(d), 2)
        if e is not None:
            out["koreksi_negatif"] = round(_angka(e), 2)
        return out

    pendapatan = laba_rugi.get("pendapatan", []) or []
    beban = laba_rugi.get("beban", []) or []

    pendapatan_usaha = [a for a in pendapatan if (a.get("sub_kategori") or "") != _SUB_KATEGORI_LAIN_LAIN]
    pendapatan_lain = [a for a in pendapatan if (a.get("sub_kategori") or "") == _SUB_KATEGORI_LAIN_LAIN]
    beban_langsung = [a for a in beban if (a.get("sub_kategori") or "") == _SUB_KATEGORI_HPP]
    beban_penyusutan = [a for a in beban if (a.get("sub_kategori") or "") == _SUB_KATEGORI_PENYUSUTAN]
    beban_lain = [a for a in beban if (a.get("sub_kategori") or "") == _SUB_KATEGORI_LAIN_LAIN]
    beban_operasional = [
        a for a in beban
        if (a.get("sub_kategori") or "") not in (_SUB_KATEGORI_HPP, _SUB_KATEGORI_PENYUSUTAN, _SUB_KATEGORI_LAIN_LAIN)
    ]

    baris: List[Dict[str, Any]] = []

    # ---------------- PENDAPATAN USAHA ----------------
    baris.append({"tipe": "judul", "uraian": "PENDAPATAN USAHA", "keterangan": _KET_STANDAR})
    b, jml_pendapatan = _seksi_akun(pendapatan_usaha, "P", "(Tidak ada akun pendapatan usaha di COA)", "pendapatan")
    baris += b
    baris.append(_subtotal("JUMLAH PENDAPATAN USAHA", jml_pendapatan, jml_pendapatan, _KET_STANDAR))

    # ---------------- BEBAN LANGSUNG ----------------
    baris.append({"tipe": "judul", "uraian": "BEBAN LANGSUNG", "keterangan": _KET_STANDAR})
    b, jml_beban_langsung = _seksi_akun(beban_langsung, "BL", "(Tidak ada akun beban langsung/HPP di COA)", "beban")
    baris += b
    baris.append(_subtotal("JUMLAH BEBAN LANGSUNG", jml_beban_langsung, jml_beban_langsung, _KET_STANDAR))

    laba_kotor = round(jml_pendapatan - jml_beban_langsung, 2)
    baris.append(_subtotal("LABA KOTOR", laba_kotor, laba_kotor, _KET_STANDAR))

    # ---------------- BEBAN OPERASIONAL ----------------
    baris.append({"tipe": "judul", "uraian": "BEBAN OPERASIONAL", "keterangan": _KET_STANDAR})
    b, jml_beban_operasional = _seksi_akun(beban_operasional, "BO", "(Tidak ada akun beban operasional di COA)", "beban")
    baris += b
    baris.append(_subtotal("JUMLAH BEBAN OPERASIONAL", jml_beban_operasional, jml_beban_operasional, _KET_STANDAR))

    ebitda = round(laba_kotor - jml_beban_operasional, 2)
    baris.append(_subtotal("EBITDA", ebitda, ebitda, _KET_STANDAR))

    # ---------------- BEBAN PENYUSUTAN ----------------
    baris.append({"tipe": "judul", "uraian": "BEBAN PENYUSUTAN", "keterangan": _KET_STANDAR})
    b, jml_beban_penyusutan = _seksi_akun(beban_penyusutan, "BP", "(Tidak ada akun beban penyusutan di COA)", "beban")
    baris += b
    baris.append(_subtotal("JUMLAH BEBAN PENYUSUTAN", jml_beban_penyusutan, jml_beban_penyusutan, _KET_STANDAR))

    laba_usaha = round(ebitda - jml_beban_penyusutan, 2)
    baris.append(_subtotal("LABA USAHA", laba_usaha, laba_usaha, _KET_STANDAR))

    # ---------------- PENDAPATAN & BEBAN LAIN-LAIN ----------------
    b, jml_pendapatan_lain = _seksi_akun(pendapatan_lain, "PL", "(Tidak ada akun pendapatan lain-lain di COA)", "pendapatan")
    baris += b
    b, jml_beban_lain = _seksi_akun(beban_lain, "BLL", "(Tidak ada akun beban lain-lain di COA)", "beban")
    baris += b

    laba_bersih_komersial = round(laba_usaha + jml_pendapatan_lain - jml_beban_lain, 2)
    # [FIX] Baris "LABA BERSIH KOMERSIAL" di file referensi kolom G-nya
    # KOSONG (beda dari subtotal2 di atas yang semua terisi _KET_STANDAR)
    # -- lihat audit sel G32 pada file referensi.
    baris.append(_subtotal("LABA BERSIH KOMERSIAL", laba_bersih_komersial, laba_bersih_komersial, ""))

    # ---------------- REKONSILIASI FISKAL -> PKP ----------------
    # [FIX-fallback] Kalau rekonsiliasi_pkp tidak dikirim (PPh Badan belum
    # pernah digenerate utk tahun ini), pakai fallback TANPA koreksi
    # apa pun -- sheet tetap lengkap, bukan kosong/error, tapi ditandai
    # jelas di 'catatan' supaya akuntan tahu ini bukan angka final.
    fallback = rekonsiliasi_pkp is None
    r = rekonsiliasi_pkp or {}
    koreksi_positif = round(_angka(r.get("koreksi_fiskal_positif")), 2)
    koreksi_negatif = round(_angka(r.get("koreksi_fiskal_negatif")), 2)
    penghasilan_neto_fiskal = round(_angka(r.get("penghasilan_neto_fiskal")) if not fallback
                                     else (laba_bersih_komersial + koreksi_positif - koreksi_negatif), 2)
    kompensasi_kerugian_fiskal = round(_angka(r.get("kompensasi_kerugian_fiskal")), 2)
    pkp_sebelum_pembulatan = round(
        _angka(r.get("pkp_sebelum_pembulatan")) if not fallback
        else max(penghasilan_neto_fiskal - kompensasi_kerugian_fiskal, 0.0), 2
    )
    if fallback:
        penghasilan_kena_pajak = math.floor(pkp_sebelum_pembulatan / 1000) * 1000 if pkp_sebelum_pembulatan > 0 else 0.0
    else:
        penghasilan_kena_pajak = round(_angka(r.get("penghasilan_kena_pajak")), 2)

    ket_rincian = ("Rincian terdapat pada sheet Laba Rugi Bulanan" if not fallback
                   else "Belum ada data PPh Badan untuk tahun ini -- generate PPh Badan 31E dulu untuk angka final")

    # [FIX] Persis file referensi: baris "TOTAL KOREKSI FISKAL POSITIF"
    # mengisi D (koreksi_positif) dengan angka yang SAMA seperti C
    # (komersial) -- begitu juga baris NEGATIF mengisi E. Baris-baris
    # sesudahnya (Penghasilan Neto Fiskal s.d. PKP Ribuan Penuh) kolom G
    # KOSONG di file referensi (beda dari subtotal2 di bagian atas sheet).
    baris.append(_subtotal("TOTAL KOREKSI FISKAL POSITIF", koreksi_positif, koreksi_positif,
                            ket_rincian, d=koreksi_positif))
    baris.append(_subtotal("TOTAL KOREKSI FISKAL NEGATIF", koreksi_negatif, koreksi_negatif,
                            ket_rincian, e=koreksi_negatif))
    baris.append(_subtotal("PENGHASILAN NETO FISKAL", penghasilan_neto_fiskal, penghasilan_neto_fiskal, ""))
    baris.append(_subtotal("KOMPENSASI KERUGIAN FISKAL", kompensasi_kerugian_fiskal, kompensasi_kerugian_fiskal, ""))
    baris.append(_subtotal("PENGHASILAN KENA PAJAK SEBELUM PEMBULATAN", pkp_sebelum_pembulatan, pkp_sebelum_pembulatan, ""))
    baris.append(_subtotal("PENGHASILAN KENA PAJAK -- RIBUAN PENUH", penghasilan_kena_pajak, penghasilan_kena_pajak, ""))

    return {
        "tahun": tahun,
        "baris": baris,
        "laba_bersih_komersial": laba_bersih_komersial,
        "penghasilan_kena_pajak": penghasilan_kena_pajak,
        "catatan": (
            "Struktur kolom (Kode/Uraian/Komersial/Koreksi Positif/Koreksi Negatif/Fiskal/"
            "Keterangan) baku untuk semua client. Baris PENDAPATAN/BEBAN satu baris per akun "
            "COA, dikelompokkan lewat sub_kategori ('HPP'->Beban Langsung, "
            "'Penyusutan'->Beban Penyusutan, 'Lain-lain'->Pendapatan/Beban Lain-lain, sisanya "
            "->Beban Operasional/Pendapatan Usaha) -- jumlah baris menyesuaikan otomatis sesuai "
            "akun client. Koreksi fiskal per baris akun adalah kolom INPUT MANUAL (default 0); "
            "angka TOTAL KOREKSI FISKAL POSITIF/NEGATIF yang dipakai menghitung PKP diambil dari "
            "parameter rekonsiliasi_pkp (pph_badan.hitung_pkp()), bukan dari SUM kolom itu."
            + (" [FALLBACK: rekonsiliasi_pkp tidak dikirim -- koreksi fiskal dianggap 0]" if fallback else "")
        ),
    }

# ============================================================
# 11. JADWAL PENYUSUTAN BULANAN (12 KOLOM) -- sheet "Buku Bantu Aktiva Tetap"
# ============================================================
# [BARU] Susun breakdown penyusutan 12 bulan per aset dari output
# akuntansi_ai.proses_aset_tetap(), memakai angka yang SUDAH dihitung di
# sana (penyusutan_per_bulan / penyusutan_fiskal_per_bulan, akumulasi
# seharusnya s.d. hari ini) -- fungsi ini HANYA menyusun ulang jadi
# jadwal 12-bulan siap render Excel, tidak menghitung ulang tarif/metode.

def _tanggal_untuk_jadwal(nilai):
    """
    [BARU] Ambil tanggal sbg objek date -- toleran terhadap string/date/
    datetime/None. Dipakai susun_jadwal_penyusutan_bulanan() utk baca
    "mulai_digunakan"/"tanggal_perolehan" (beda sumber field dgn
    _tanggal_jurnal() yang khusus baris jurnal, jadi dipisah supaya tidak
    tercampur konteksnya).
    """
    from datetime import date, datetime as dt_
    if nilai is None:
        return None
    if isinstance(nilai, dt_):
        return nilai.date()
    if isinstance(nilai, date):
        return nilai
    try:
        return dt_.fromisoformat(str(nilai)[:10]).date()
    except (ValueError, TypeError):
        return None


def susun_jadwal_penyusutan_bulanan(
    aset_tetap: List[Dict[str, Any]],
    tahun: int,
    metode: str = "komersial",
) -> Dict[str, Any]:
    """
    Susun jadwal penyusutan 12 bulan per aset untuk sheet
    "Buku Bantu Aktiva Tetap".

    Args:
        aset_tetap: list baris dari proses_aset_tetap()["df"] (list of dict
            atau DataFrame.to_dict("records")) -- tiap baris punya kolom
            harga_perolehan, kategori, golongan_fiskal,
            penyusutan_per_bulan / penyusutan_fiskal_per_bulan, dst
            (lihat akuntansi_ai.py::proses_aset_tetap()).
        tahun: tahun jadwal yang diinginkan (mis. 2026).
        metode: "komersial" (garis lurus, dasar harga - residu) atau
            "fiskal" (dasar harga penuh, tarif per golongan PMK 96/2009).

    Returns:
        dict siap render ke Excel: {"aset": [...], "total_per_bulan": [12],
        "total_per_tahun": ..., "tahun": ..., "metode": ...}
    """
    if not aset_tetap:
        return {
            "aset": [], "total_per_bulan": [0.0] * 12, "total_per_tahun": 0.0,
            "tahun": tahun, "metode": metode,
            "catatan": "Tidak ada data aset tetap.",
        }

    kolom_penyusutan_bulan = (
        "penyusutan_fiskal_per_bulan" if metode == "fiskal" else "penyusutan_per_bulan"
    )
    kolom_akumulasi_awal = (
        "akumulasi_penyusutan_fiskal_seharusnya" if metode == "fiskal"
        else "akumulasi_penyusutan_seharusnya"
    )

    hasil_aset: List[Dict[str, Any]] = []
    total_per_bulan = [0.0] * 12

    for i, aset in enumerate(aset_tetap):
        kategori = str(aset.get("kategori") or "").strip().upper()
        if kategori == "TANAH":
            continue

        penyusutan_bulan = _angka(aset.get(kolom_penyusutan_bulan))
        if penyusutan_bulan <= 0:
            continue

        harga_perolehan = _angka(aset.get("harga_perolehan"))
        nilai_residu = _angka(aset.get("nilai_residu"))
        dasar_penyusutan = harga_perolehan if metode == "fiskal" else max(harga_perolehan - nilai_residu, 0)
        akumulasi_awal = min(_angka(aset.get(kolom_akumulasi_awal)), dasar_penyusutan)
        akumulasi_awal = max(akumulasi_awal, 0)

        # [BARU] Bulan mulai disusutkan -- konvensi: bulan perolehan/mulai
        # digunakan TIDAK dibebankan penyusutan (0), penyusutan penuh mulai
        # bulan BERIKUTNYA (lihat contoh file
        # BUKU_BANTU_AKTIVA_TETAP___JADWAL_PENYUSUTAN_2025.xlsx: aset mulai
        # digunakan 1 Jan 2025 -> kolom Jan-25 = 0, penyusutan penuh mulai
        # Feb-25). Dipakai "mulai_digunakan" kalau ada di data (field baru,
        # lihat parse_sheet_aset_tetap()), fallback ke "tanggal_perolehan"
        # kalau tidak ada (kasus paling umum: aset langsung dipakai saat
        # diperoleh). Kalau aset diperoleh SEBELUM tahun berjalan (mis. aset
        # lama), tidak ada bulan yang di-nol-kan sama sekali -- penyusutan
        # sudah berjalan dari tahun sebelumnya, tercermin di akumulasi_awal.
        tanggal_mulai = _tanggal_untuk_jadwal(aset.get("mulai_digunakan") or aset.get("tanggal_perolehan"))
        bulan_mulai = tanggal_mulai.month if (tanggal_mulai and tanggal_mulai.year == tahun) else None

        jadwal_bulanan = []
        akumulasi = akumulasi_awal
        for bulan in range(1, 13):
            if bulan_mulai is not None and bulan <= bulan_mulai:
                # Belum diperoleh/dipakai, atau ini bulan perolehannya sendiri
                # (bulan perolehan tidak dibebankan penyusutan).
                penyusutan_bulan_ini = 0.0
            else:
                sisa = dasar_penyusutan - akumulasi
                penyusutan_bulan_ini = 0.0 if sisa <= 0 else min(penyusutan_bulan, sisa)
                akumulasi += penyusutan_bulan_ini
            jadwal_bulanan.append({
                "bulan": bulan,
                "penyusutan_bulan_ini": round(penyusutan_bulan_ini, 2),
                "akumulasi_sampai_bulan": round(akumulasi, 2),
                "nilai_buku": round(harga_perolehan - akumulasi, 2),
            })
            total_per_bulan[bulan - 1] += penyusutan_bulan_ini

        hasil_aset.append({
            "kode_aset": aset.get("kode_aset") or f"ASET-{i + 1}",
            "nama_aset": aset.get("nama_aset") or "Aset",
            "kategori": aset.get("kategori"),
            "golongan_fiskal": aset.get("golongan_fiskal"),
            "harga_perolehan": round(harga_perolehan, 2),
            "nilai_residu": round(nilai_residu, 2),
            "penyusutan_per_bulan": round(penyusutan_bulan, 2),
            "penyusutan_per_tahun": round(penyusutan_bulan * 12, 2),
            "akumulasi_awal_tahun": round(akumulasi_awal, 2),
            "akumulasi_akhir_tahun": round(akumulasi, 2),
            "nilai_buku_akhir_tahun": round(harga_perolehan - akumulasi, 2),
            "jadwal_bulanan": jadwal_bulanan,
            "metode": metode,
            # [FIX - export 14 sheet] Field ini sebelumnya TIDAK diteruskan
            # sama sekali ke output -- sheet "Buku Bantu Aktiva Tetap" di
            # accounting_export.py butuh kolom-kolom ini tapi selalu
            # kosong karena tidak pernah dikirim dari sini. Diteruskan
            # apa adanya pakai .get() (aman kalau field ini memang belum
            # ada di sumber aset_tetap -- akan tetap None seperti sebelumnya).
            "tanggal_perolehan": aset.get("tanggal_perolehan"),
            "mulai_digunakan": aset.get("mulai_digunakan"),
            "umur_tahun": aset.get("umur_tahun"),
            "kode_akun_aset": aset.get("kode_akun_aset"),
            "kode_akum_penyusutan": aset.get("kode_akum_penyusutan"),
            "kode_beban_penyusutan": aset.get("kode_beban_penyusutan"),
        })

    hasil_aset.sort(key=lambda x: str(x["kode_aset"]))

    return {
        "aset": hasil_aset,
        "total_per_bulan": [round(t, 2) for t in total_per_bulan],
        "total_per_tahun": round(sum(total_per_bulan), 2),
        "tahun": tahun,
        "metode": metode,
        "jumlah_aset": len(hasil_aset),
        "catatan": f"Jadwal penyusutan {metode} untuk {len(hasil_aset)} aset pada tahun {tahun}.",
    }

# ============================================================
# 11. KPI BENTO DASHBOARD (8 kartu ringkas utk halaman Dashboard utama
#     -- dipakai komponen frontend KPIBentoGrid.tsx lewat endpoint
#     GET /api/client/{client_id}/kpi-bento di main.py)
# ============================================================
#
# [BARU] Sebelumnya KPIBentoGrid.tsx 100% pakai angka & sparkline
# hardcoded (mock) di frontend, TIDAK terhubung ke backend sama sekali.
# Fungsi ini menghitung 8 KPI yang dibutuhkan grid tsb (Total Revenue,
# Net Profit, Gross Profit, Cash & Bank, Accounts Receivable, Accounts
# Payable, EBITDA, Tax Payable) LANGSUNG dari jurnal+COA client yang
# sama seperti generate_5_laporan_keuangan()/susun_laporan_bulanan_setahun()
# -- tidak menduplikasi logika hitung saldo, hanya memakai ulang
# susun_laporan_bulanan_setahun(sertakan_saldo_per_bulan=True) lalu
# menyaring/menjumlahkan per kategori & sub_kategori COA per bulan.
#
# CATATAN PENTING soal keterbatasan (WAJIB dibaca sebelum dipakai):
# 1. Accounts Payable & Tax Payable: COA di modul ini TIDAK punya
#    sub_kategori baku utk LIABILITAS (beda dgn ASET yang sudah punya
#    label baku 'Kas'/'Piutang'/dst -- lihat susun_lampiran_spt_bs()).
#    Jadi kedua kartu ini disaring pakai HEURISTIK nama akun (lihat
#    _KATA_KUNCI_UTANG_USAHA / _KATA_KUNCI_PAJAK di bawah). Kalau nama
#    akun COA client tidak memuat kata kunci itu, akun tsb TIDAK akan
#    terhitung -- meta["akun_tidak_terklasifikasi"] mencatat semua akun
#    LIABILITAS yang tidak cocok ke salah satu heuristik, supaya
#    akuntan bisa cek/rapikan nama akun COA kalau kartu tampak 0 padahal
#    seharusnya ada saldo.
# 2. EBITDA didekati sbg (Laba Bersih + Beban Penyusutan) -- TIDAK
#    menambahkan kembali bunga & pajak penghasilan secara terpisah
#    karena modul ini belum punya sub_kategori baku utk akun Beban
#    Bunga/Beban Pajak. Kalau butuh EBITDA presisi, tambahkan
#    sub_kategori 'Beban Bunga' & 'Beban Pajak' di COA lalu perluas
#    fungsi ini.
# 3. "Perubahan %" dihitung SEBULAN vs SEBULAN SEBELUMNYA (bulan
#    terakhir yang ada datanya vs bulan sebelumnya), BUKAN vs periode
#    yang sama tahun lalu -- karena fungsi ini hanya mengambil 1 tahun
#    jurnal sekaligus (pola yang sama dgn susun_laporan_bulanan_setahun).
# 4. Kartu "Accounts Receivable"/"Accounts Payable" TIDAK menyertakan
#    rincian umur piutang/utang (aging/overdue) -- itu sumber data
#    terpisah (modul accounts_receivable/accounts_payable, belum
#    disatukan di sini).

_KATA_KUNCI_UTANG_USAHA = ("utang usaha", "hutang usaha", "utang dagang", "hutang dagang")
_KATA_KUNCI_PAJAK = ("pajak", "pph", "ppn")


def _cocok_kata_kunci(nama_akun: Optional[str], kata_kunci: tuple) -> bool:
    n = (nama_akun or "").lower()
    return any(k in n for k in kata_kunci)


def _jumlah_saldo_per_bulan(
    per_bulan_saldo: List[Dict[str, Dict[str, Any]]],
    kategori: str,
    sub_kategori: Optional[str] = None,
    kata_kunci_nama: Optional[tuple] = None,
    kecuali_kata_kunci_nama: Optional[tuple] = None,
) -> List[float]:
    """
    Jumlahkan saldo_akhir semua akun yang cocok kategori (+ opsional
    sub_kategori dan/atau kata kunci nama akun), untuk TIAP bulan di
    `per_bulan_saldo` (list hasil hitung_saldo_per_akun(), 1 elemen per
    bulan -- lihat susun_laporan_bulanan_setahun(sertakan_saldo_per_bulan=True)).
    """
    hasil = []
    for saldo_bulan_ini in per_bulan_saldo:
        total = 0.0
        for akun in saldo_bulan_ini.values():
            if akun.get("kategori") != kategori:
                continue
            if sub_kategori is not None and (akun.get("sub_kategori") or "") != sub_kategori:
                continue
            if kata_kunci_nama and not _cocok_kata_kunci(akun.get("nama_akun"), kata_kunci_nama):
                continue
            if kecuali_kata_kunci_nama and _cocok_kata_kunci(akun.get("nama_akun"), kecuali_kata_kunci_nama):
                continue
            total += akun.get("saldo_akhir", 0.0)
        hasil.append(round(total, 2))
    return hasil


def _akun_liabilitas_tidak_terklasifikasi(per_bulan_saldo: List[Dict[str, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Daftar akun LIABILITAS (unik, dari bulan manapun) yang namanya
    tidak cocok ke heuristik Accounts Payable maupun Tax Payable --
    dipakai meta utk memberi tahu akuntan kalau ada saldo yang
    "tidak masuk kartu manapun"."""
    ditemukan: Dict[str, Dict[str, Any]] = {}
    for saldo_bulan_ini in per_bulan_saldo:
        for no_akun, akun in saldo_bulan_ini.items():
            if akun.get("kategori") != "LIABILITAS":
                continue
            nama = akun.get("nama_akun")
            if _cocok_kata_kunci(nama, _KATA_KUNCI_UTANG_USAHA) or _cocok_kata_kunci(nama, _KATA_KUNCI_PAJAK):
                continue
            if abs(akun.get("saldo_akhir", 0.0)) < 0.01:
                continue
            ditemukan[no_akun] = {"no_akun": no_akun, "nama_akun": nama}
    return sorted(ditemukan.values(), key=lambda a: a["no_akun"])


def _kartu_kpi_bento(label: str, per_bulan: List[float], satuan: str = "rupiah",
                      per_bulan_margin_basis: Optional[List[float]] = None) -> Dict[str, Any]:
    """
    Bentuk satu kartu KPI siap-JSON dari deret nilai bulanan (Jan..bulan
    terakhir yang dihitung).

    - nilai: nilai bulan TERAKHIR (paling baru).
    - perubahan_persen: nilai bulan terakhir vs bulan sebelumnya (0 kalau
      cuma ada 1 bulan data, atau bulan sebelumnya kebetulan 0).
    - sparkline: sampai 8 titik terakhir (grid frontend pakai 8 titik).
    - margin_persen: opsional, nilai / per_bulan_margin_basis bulan yang
      sama x100 (dipakai utk subtitle margin Net/Gross Profit & EBITDA
      thd Total Revenue bulan yang sama).
    """
    per_bulan = per_bulan or [0.0]
    nilai_sekarang = per_bulan[-1]
    nilai_sebelumnya = per_bulan[-2] if len(per_bulan) >= 2 else None
    if nilai_sebelumnya:
        perubahan_persen = round((nilai_sekarang - nilai_sebelumnya) / abs(nilai_sebelumnya) * 100, 1)
    else:
        perubahan_persen = 0.0

    margin_persen = None
    if per_bulan_margin_basis:
        basis = per_bulan_margin_basis[-1]
        if basis:
            margin_persen = round(nilai_sekarang / basis * 100, 1)

    return {
        "label": label,
        "nilai": round(nilai_sekarang, 2),
        "satuan": satuan,
        "perubahan_persen": perubahan_persen,
        "margin_persen": margin_persen,
        "sparkline": per_bulan[-8:],
    }


def susun_kpi_bento_dashboard(
    jurnal: List[Dict[str, Any]],
    coa: List[Dict[str, Any]],
    tahun: Optional[int] = None,
    bulan_sampai: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Hitung 8 KPI utk KPIBentoGrid.tsx: Total Revenue, Net Profit, Gross
    Profit, Cash & Bank, Accounts Receivable, Accounts Payable, EBITDA,
    Tax Payable -- masing2 dgn nilai bulan terakhir, perubahan % vs
    bulan sebelumnya, dan sparkline (s/d 8 titik bulanan).

    Args:
        jurnal: jurnal terposting client (SATU tahun -- lihat `tahun`),
            bentuk sama seperti db_client.ambil_jurnal_terposting().
        coa: COA client, bentuk sama seperti db_client.ambil_coa_client().
        tahun: tahun yang dihitung, default tahun berjalan (now).
        bulan_sampai: hitung s/d bulan ke berapa (1-12), default bulan
            berjalan (now) kalau `tahun` == tahun berjalan, atau 12
            kalau `tahun` tahun lampau/depan.

    Returns dict siap-JSON:
        {
            "tahun": int, "bulan_sampai": int,
            "kartu": [ {label, nilai, satuan, perubahan_persen,
                        margin_persen, sparkline}, ... 8 item ],
            "meta": {"jumlah_baris_jurnal": int, "akun_liabilitas_tidak_terklasifikasi": [...], "peringatan": [...]}
        }
    """
    hari_ini = date.today()
    tahun = tahun or hari_ini.year
    if bulan_sampai is None:
        bulan_sampai = hari_ini.month if tahun == hari_ini.year else 12
    bulan_sampai = max(1, min(bulan_sampai, 12))

    hasil_tahunan = susun_laporan_bulanan_setahun(jurnal, coa, tahun, sertakan_saldo_per_bulan=True)
    per_bulan_saldo_penuh = hasil_tahunan.pop("_saldo_per_akun_per_bulan", [])
    laba_rugi_bulanan = hasil_tahunan["laba_rugi_bulanan"]

    per_bulan_saldo = per_bulan_saldo_penuh[:bulan_sampai]
    pendapatan_bulanan = list(laba_rugi_bulanan["total_pendapatan_bulanan"][:bulan_sampai])
    laba_bersih_bulanan = list(laba_rugi_bulanan["laba_bersih_bulanan"][:bulan_sampai])

    hpp_bulanan = _jumlah_saldo_per_bulan(per_bulan_saldo, "BEBAN", sub_kategori="HPP")
    penyusutan_bulanan = _jumlah_saldo_per_bulan(per_bulan_saldo, "BEBAN", sub_kategori="Penyusutan")
    gross_profit_bulanan = [round(p - h, 2) for p, h in zip(pendapatan_bulanan, hpp_bulanan)]
    # [Lihat catatan #2 di atas soal EBITDA] pendekatan: Laba Bersih + Penyusutan.
    ebitda_bulanan = [round(lb + d, 2) for lb, d in zip(laba_bersih_bulanan, penyusutan_bulanan)]

    kas_bulanan = _jumlah_saldo_per_bulan(per_bulan_saldo, "ASET", sub_kategori="Kas")
    piutang_bulanan = _jumlah_saldo_per_bulan(per_bulan_saldo, "ASET", sub_kategori="Piutang")
    ap_bulanan = _jumlah_saldo_per_bulan(
        per_bulan_saldo, "LIABILITAS", kata_kunci_nama=_KATA_KUNCI_UTANG_USAHA,
    )
    pajak_bulanan = _jumlah_saldo_per_bulan(
        per_bulan_saldo, "LIABILITAS", kata_kunci_nama=_KATA_KUNCI_PAJAK,
    )

    kartu = [
        _kartu_kpi_bento("Total Revenue", pendapatan_bulanan),
        _kartu_kpi_bento("Net Profit", laba_bersih_bulanan, per_bulan_margin_basis=pendapatan_bulanan),
        _kartu_kpi_bento("Gross Profit", gross_profit_bulanan, per_bulan_margin_basis=pendapatan_bulanan),
        _kartu_kpi_bento("Cash & Bank", kas_bulanan),
        _kartu_kpi_bento("Accounts Receivable", piutang_bulanan),
        _kartu_kpi_bento("Accounts Payable", ap_bulanan),
        _kartu_kpi_bento("EBITDA", ebitda_bulanan, per_bulan_margin_basis=pendapatan_bulanan),
        _kartu_kpi_bento("Tax Payable", pajak_bulanan),
    ]

    akun_tidak_terklasifikasi = _akun_liabilitas_tidak_terklasifikasi(per_bulan_saldo)

    peringatan = []
    if not jurnal:
        peringatan.append(f"Belum ada jurnal untuk tahun {tahun}.")
    if not any(kas_bulanan):
        peringatan.append(
            "Tidak ada akun ASET dengan sub_kategori='Kas' yang punya saldo -- "
            "kartu 'Cash & Bank' akan tampil 0."
        )
    if not any(piutang_bulanan):
        peringatan.append(
            "Tidak ada akun ASET dengan sub_kategori='Piutang' yang punya saldo -- "
            "kartu 'Accounts Receivable' akan tampil 0."
        )
    if akun_tidak_terklasifikasi:
        peringatan.append(
            f"{len(akun_tidak_terklasifikasi)} akun LIABILITAS tidak cocok heuristik nama "
            "'Accounts Payable' maupun 'Tax Payable' (lihat meta.akun_liabilitas_tidak_terklasifikasi) "
            "-- saldo akun ini tidak ikut kartu manapun."
        )

    logger.info(
        f"📊 KPI Bento dashboard dihitung: tahun={tahun}, bulan_sampai={bulan_sampai}, "
        f"revenue={pendapatan_bulanan[-1] if pendapatan_bulanan else 0}"
    )

    return {
        "tahun": tahun,
        "bulan_sampai": bulan_sampai,
        "kartu": kartu,
        "meta": {
            "jumlah_baris_jurnal": len(jurnal or []),
            "akun_liabilitas_tidak_terklasifikasi": akun_tidak_terklasifikasi,
            "peringatan": peringatan,
        },
    }
