"""
modules/pph_badan.py
=====================
Perhitungan PPh Badan Tarif Pasal 17 + fasilitas pengurangan tarif
Pasal 31E UU PPh (sebagaimana diubah UU HPP).

Modul ini SENGAJA murni (tidak import db_client) -- menerima angka biasa,
mengembalikan dict siap-JSON, mengikuti pola yang sama dengan
modules/laporan_keuangan.py:
1. Mudah diuji tanpa perlu database aktif.
2. Endpoint di main.py bertanggung jawab mengambil laba_rugi_bersih dari
   laporan_keuangan.generate_5_laporan_keuangan() dan koreksi fiskal dari
   akuntansi_ai.proses_aset_tetap()["rekonsiliasi_fiskal"], lalu memanggil
   fungsi di sini.

DASAR HUKUM (per pengetahuan umum UU HPP -- WAJIB diverifikasi ulang ke
peraturan terbaru sebelum dipakai untuk pelaporan resmi, karena ambang
batas/tarif bisa berubah):
- Tarif PPh Badan umum: 22% (Pasal 17 ayat (1) huruf b UU PPh jo. UU HPP)
- Fasilitas Pasal 31E: pengurangan 50% dari tarif umum (jadi tarif efektif
  11%) untuk bagian Penghasilan Kena Pajak dari peredaran bruto sampai
  dengan Rp4.800.000.000 (4,8 miliar)
- Wajib Pajak dengan peredaran bruto di atas Rp50.000.000.000 (50 miliar)
  TIDAK mendapat fasilitas ini sama sekali
- Wajib Pajak dengan peredaran bruto antara Rp4,8 miliar dan Rp50 miliar
  mendapat fasilitas SECARA PROPORSIONAL (bukan seluruh PKP), sesuai
  rumus resmi: (Rp4,8 miliar / peredaran bruto) x PKP = bagian yang
  dapat fasilitas; sisanya kena tarif umum.

CATATAN PENTING: modul ini TIDAK menghitung koreksi fiskal itu sendiri
(itu tanggung jawab modul lain, mis. rekonsiliasi penyusutan komersial
vs fiskal di akuntansi_ai.proses_aset_tetap()) -- di sini koreksi fiskal
positif/negatif HANYA diterima sebagai parameter angka jadi. Perhitungan
ini juga BUKAN pengganti konsultasi ke akuntan pajak bersertifikat untuk
kasus yang berdampak hukum/pajak besar.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

from .logging_config import get_module_logger

logger = get_module_logger("pph_badan")

# ============================================================
# KONSTANTA TARIF & AMBANG BATAS (UU HPP) -- lihat docstring modul
# ============================================================
TARIF_PPH_BADAN_UMUM = 0.22
PERSENTASE_PENGURANGAN_PASAL_31E = 0.5
TARIF_EFEKTIF_FASILITAS = TARIF_PPH_BADAN_UMUM * (1 - PERSENTASE_PENGURANGAN_PASAL_31E)  # 0.11
BATAS_PEREDARAN_BRUTO_FASILITAS_PENUH = 4_800_000_000
BATAS_MAKS_PEREDARAN_BRUTO_FASILITAS = 50_000_000_000

# [BARU] Nilai default field "skema_pajak" -- HANYA skema ini yang berhak
# atas fasilitas tarif Pasal 17/31E di sistem ini. Kalau caller mengirim
# skema_pajak lain (mis. perusahaan pakai PPh Final PP 55/2022 utk UMKM),
# perhitungan fasilitas 31E di bawah SENGAJA di-nolkan dgn status
# peringatan -- bukan dihitung seolah-olah pakai tarif umum -- karena PPh
# Final dan Pasal 17/31E adalah 2 rezim pajak berbeda yang salah kalau
# tercampur (dan modul PPh Final UMKM sistem ini terpisah, tidak di sini).
SKEMA_TARIF_UMUM_31E = "Tarif Umum Pasal 17/31E"


def _angka(v) -> float:
    """
    [FIX-style] Konversi nilai ke float dengan aman -- None/NaN/inf semua
    dianggap 0.0. Pola yang sama seperti _angka() di laporan_keuangan.py &
    accounting_export.py (lihat catatan lengkap NaN-truthy di sana) --
    disalin di sini karena modul ini murni & tidak mengimpor modul lain
    yang membawa dependency pandas.
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


def _bulatkan_ribuan_penuh(nilai: float) -> float:
    """
    PKP dibulatkan ke bawah dalam ribuan penuh (mis. Rp356.500.999 jadi
    Rp356.500.000) -- kebiasaan pembulatan SPT Tahunan Badan. Nilai
    negatif dibulatkan ke 0 (PKP tidak pernah negatif -- kalau rugi
    fiskal, PKP = 0 & kerugian dikompensasikan ke tahun berikutnya).
    """
    if nilai <= 0:
        return 0.0
    return math.floor(nilai / 1000) * 1000


# ============================================================
# 0. TOTAL PEREDARAN BRUTO -- DARI KOMPONEN-KOMPONENNYA
# ============================================================

def hitung_total_peredaran_bruto(
    peredaran_bruto_usaha: float,
    tambahan_peredaran_bruto_lainnya: float = 0.0,
    retur_pengurangan_peredaran_bruto: float = 0.0,
) -> Dict[str, Any]:
    """
    [BARU] Susun TOTAL PEREDARAN BRUTO dari komponen-komponennya, sesuai
    struktur 4-baris pada sheet referensi "PPh Badan 31E" (Peredaran
    Bruto Usaha dari PNL -> Tambahan Peredaran Bruto Lainnya -> Retur/
    Pengurangan -> TOTAL). Sebelumnya modul ini hanya menerima satu
    angka "peredaran_bruto" siap pakai -- dipecah supaya akuntan bisa
    melihat & menyesuaikan tiap komponen per client, bukan angka mentah.

    Args:
        peredaran_bruto_usaha: pendapatan usaha dari Laba Rugi setahun
            (biasanya laporan_keuangan..."total_pendapatan" -- otomatis
            dari sistem, BEDA per perusahaan tergantung jenis usahanya).
        tambahan_peredaran_bruto_lainnya: input manual akuntan, kalau ada
            penghasilan lain yang termasuk objek peredaran bruto Pasal
            31E tapi tidak tercatat sebagai "pendapatan usaha" di Laba
            Rugi. Default 0.
        retur_pengurangan_peredaran_bruto: input manual akuntan, SEBAGAI
            NILAI POSITIF (dikurangkan, bukan negatif). Default 0.

    Returns:
        dict berisi 3 komponen + total (TOTAL PEREDARAN BRUTO tidak
        pernah negatif, mengikuti rumus referensi MAX(0, ...)).
    """
    peredaran_bruto_usaha = _angka(peredaran_bruto_usaha)
    tambahan_peredaran_bruto_lainnya = _angka(tambahan_peredaran_bruto_lainnya)
    retur_pengurangan_peredaran_bruto = _angka(retur_pengurangan_peredaran_bruto)

    total = max(
        0.0,
        peredaran_bruto_usaha + tambahan_peredaran_bruto_lainnya - retur_pengurangan_peredaran_bruto,
    )

    return {
        "peredaran_bruto_usaha": round(peredaran_bruto_usaha, 2),
        "tambahan_peredaran_bruto_lainnya": round(tambahan_peredaran_bruto_lainnya, 2),
        "retur_pengurangan_peredaran_bruto": round(retur_pengurangan_peredaran_bruto, 2),
        "total_peredaran_bruto": round(total, 2),
    }


# ============================================================
# 1. PENGHASILAN KENA PAJAK (PKP) DARI REKONSILIASI FISKAL
# ============================================================

def hitung_pkp(
    laba_bersih_komersial: float,
    koreksi_fiskal_positif: float = 0.0,
    koreksi_fiskal_negatif: float = 0.0,
    kompensasi_kerugian_fiskal: float = 0.0,
) -> Dict[str, Any]:
    """
    Susun Penghasilan Kena Pajak (PKP) dari Laba Bersih Komersial +
    koreksi fiskal, mengikuti struktur Lampiran Rekonsiliasi Fiskal SPT
    Tahunan Badan (Formulir 1771).

    koreksi_fiskal_positif/negatif: HASIL AKHIR (sudah dijumlahkan dari
    semua pos koreksi -- mis. selisih penyusutan komersial vs fiskal dari
    akuntansi_ai.proses_aset_tetap()["rekonsiliasi_fiskal"], beban yang
    tidak boleh dikurangkan menurut UU PPh Pasal 9, dst). Modul ini tidak
    tahu rincian pos-nya, hanya menjumlahkan.
    """
    laba_bersih_komersial = _angka(laba_bersih_komersial)
    koreksi_fiskal_positif = _angka(koreksi_fiskal_positif)
    koreksi_fiskal_negatif = _angka(koreksi_fiskal_negatif)
    kompensasi_kerugian_fiskal = _angka(kompensasi_kerugian_fiskal)

    penghasilan_neto_fiskal = laba_bersih_komersial + koreksi_fiskal_positif - koreksi_fiskal_negatif
    pkp_sebelum_pembulatan = max(penghasilan_neto_fiskal - kompensasi_kerugian_fiskal, 0.0)
    pkp = _bulatkan_ribuan_penuh(pkp_sebelum_pembulatan)

    return {
        "laba_bersih_komersial": round(laba_bersih_komersial, 2),
        "koreksi_fiskal_positif": round(koreksi_fiskal_positif, 2),
        "koreksi_fiskal_negatif": round(koreksi_fiskal_negatif, 2),
        "penghasilan_neto_fiskal": round(penghasilan_neto_fiskal, 2),
        "kompensasi_kerugian_fiskal": round(kompensasi_kerugian_fiskal, 2),
        "pkp_sebelum_pembulatan": round(pkp_sebelum_pembulatan, 2),
        "penghasilan_kena_pajak": pkp,
    }


# ============================================================
# 2. FASILITAS PASAL 31E -- PEMBAGIAN PKP FASILITAS VS NONFASILITAS
# ============================================================

def hitung_pembagian_fasilitas_31e(
    peredaran_bruto: float, pkp: float, skema_pajak: str = SKEMA_TARIF_UMUM_31E,
) -> Dict[str, Any]:
    """
    Tentukan berapa bagian PKP yang mendapat fasilitas tarif 11% (Pasal
    31E) dan berapa yang kena tarif umum 22%, berdasarkan peredaran
    bruto setahun. Empat skenario (0 = [BARU], 1-3 = sudah ada):

    0. skema_pajak != SKEMA_TARIF_UMUM_31E (mis. perusahaan pakai PPh
       Final UMKM) -> fasilitas 31E TIDAK dihitung sama sekali, seluruh
       PKP dilaporkan sebagai "tidak mendapat fasilitas" dengan status
       peringatan -- akuntan harus cek skema pajak client dulu.
    1. peredaran_bruto <= Rp4,8 miliar
       -> SELURUH PKP dapat fasilitas (tarif efektif 11%).
    2. Rp4,8 miliar < peredaran_bruto <= Rp50 miliar
       -> Fasilitas PROPORSIONAL: bagian PKP yang dapat fasilitas =
          (Rp4,8 miliar / peredaran_bruto) x PKP, sisanya tarif umum.
    3. peredaran_bruto > Rp50 miliar
       -> TIDAK dapat fasilitas sama sekali, seluruh PKP tarif umum 22%.
    """
    peredaran_bruto = _angka(peredaran_bruto)
    pkp = _angka(pkp)

    if skema_pajak != SKEMA_TARIF_UMUM_31E:
        status = (
            f"Tidak dihitung -- periksa skema pajak (skema saat ini: \"{skema_pajak}\", "
            f"fasilitas Pasal 31E hanya berlaku utk skema \"{SKEMA_TARIF_UMUM_31E}\")"
        )
        pkp_fasilitas, pkp_nonfasilitas = 0.0, pkp
    elif peredaran_bruto <= 0:
        status = "Peredaran bruto nihil/negatif -- tidak bisa ditentukan fasilitasnya, cek input."
        pkp_fasilitas, pkp_nonfasilitas = 0.0, pkp
    elif peredaran_bruto <= BATAS_PEREDARAN_BRUTO_FASILITAS_PENUH:
        status = "Seluruh PKP mendapat fasilitas 50% tarif (Pasal 31E)"
        pkp_fasilitas, pkp_nonfasilitas = pkp, 0.0
    elif peredaran_bruto <= BATAS_MAKS_PEREDARAN_BRUTO_FASILITAS:
        proporsi = BATAS_PEREDARAN_BRUTO_FASILITAS_PENUH / peredaran_bruto
        pkp_fasilitas = round(proporsi * pkp, 2)
        pkp_nonfasilitas = round(pkp - pkp_fasilitas, 2)
        status = (
            f"Fasilitas proporsional: ({BATAS_PEREDARAN_BRUTO_FASILITAS_PENUH:,.0f} / "
            f"peredaran bruto) x PKP mendapat tarif 11%, sisanya tarif 22%"
        )
    else:
        status = f"Peredaran bruto > Rp{BATAS_MAKS_PEREDARAN_BRUTO_FASILITAS:,.0f} -- tidak mendapat fasilitas Pasal 31E"
        pkp_fasilitas, pkp_nonfasilitas = 0.0, pkp

    return {
        "peredaran_bruto": round(peredaran_bruto, 2),
        "status_fasilitas": status,
        "pkp_mendapat_fasilitas": round(pkp_fasilitas, 2),
        "pkp_tidak_mendapat_fasilitas": round(pkp_nonfasilitas, 2),
    }


# ============================================================
# 3. PPh TERUTANG, KREDIT PAJAK, & KURANG/LEBIH BAYAR
# ============================================================

def hitung_pph_pasal_31e(
    peredaran_bruto: float,
    laba_bersih_komersial: float,
    koreksi_fiskal_positif: float = 0.0,
    koreksi_fiskal_negatif: float = 0.0,
    kompensasi_kerugian_fiskal: float = 0.0,
    kredit_pajak: Optional[Dict[str, float]] = None,
    tahun_pajak: Optional[int] = None,
    nama_perusahaan: Optional[str] = None,
    skema_pajak: str = SKEMA_TARIF_UMUM_31E,
    tambahan_peredaran_bruto_lainnya: float = 0.0,
    retur_pengurangan_peredaran_bruto: float = 0.0,
    keterangan_peredaran_bruto: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fungsi utama: hitung PPh Badan terutang dengan fasilitas Pasal 31E,
    dari Laba Bersih Komersial + koreksi fiskal + peredaran bruto.

    Args:
        peredaran_bruto: KOMPONEN "Peredaran Bruto Usaha dari PNL" --
            pendapatan usaha setahun dari
            laporan_keuangan.susun_laba_rugi()["total_pendapatan"].
            Nama parameter dipertahankan (bukan di-rename) demi kompatibel
            dgn kode lama, tapi sekarang HANYA salah satu dari 3 komponen
            TOTAL PEREDARAN BRUTO -- lihat hitung_total_peredaran_bruto().
        tambahan_peredaran_bruto_lainnya, retur_pengurangan_peredaran_bruto:
            [BARU] 2 komponen lain (default 0 = perilaku identik dgn
            sebelumnya kalau tidak diisi) -- lihat
            hitung_total_peredaran_bruto().
        keterangan_peredaran_bruto: [BARU] opsional, label bebas ttg
            sumber peredaran bruto usaha yg beda-beda per perusahaan
            (mis. "Pendapatan sewa dan mobilisasi", "Pendapatan jasa
            konstruksi") -- ditulis di kolom "Status/Keterangan" sheet
            export. Kalau None, export akan pakai label generik.
        skema_pajak: [BARU] default SKEMA_TARIF_UMUM_31E. Kalau client
            pakai skema lain (mis. PPh Final UMKM), fasilitas 31E
            di-nolkan dgn status peringatan -- lihat
            hitung_pembagian_fasilitas_31e().
        laba_bersih_komersial: dari
            laporan_keuangan.susun_laba_rugi()["laba_rugi_bersih"]
        koreksi_fiskal_positif/negatif: hasil akhir rekonsiliasi fiskal
            (lihat hitung_pkp())
        kompensasi_kerugian_fiskal: sisa rugi fiskal tahun-tahun
            sebelumnya yang masih bisa dikompensasi (input manual akuntan
            -- belum ada sumber otomatis konsisten di sistem ini)
        kredit_pajak: dict opsional, kunci yang dikenali:
            "pph_22", "pph_23", "pph_24", "angsuran_pph_25" -- semua
            default 0 kalau tidak diisi
        tahun_pajak, nama_perusahaan: opsional, hanya untuk label di hasil

    Returns:
        dict siap-JSON dengan struktur yang sejalan dengan sheet
        "PPh Badan 31E" pada model referensi (Petunjuk & Asumsi -> Skema
        -> Peredaran Bruto -> PKP -> fasilitas 31E -> PPh terutang ->
        kredit pajak -> kurang/lebih bayar)
    """
    kredit_pajak = kredit_pajak or {}
    pph_22 = _angka(kredit_pajak.get("pph_22"))
    pph_23 = _angka(kredit_pajak.get("pph_23"))
    pph_24 = _angka(kredit_pajak.get("pph_24"))
    angsuran_pph_25 = _angka(kredit_pajak.get("angsuran_pph_25"))
    total_kredit_pajak = pph_22 + pph_23 + pph_24 + angsuran_pph_25

    peredaran_bruto_detail = hitung_total_peredaran_bruto(
        peredaran_bruto, tambahan_peredaran_bruto_lainnya, retur_pengurangan_peredaran_bruto,
    )
    total_peredaran_bruto = peredaran_bruto_detail["total_peredaran_bruto"]

    rekonsiliasi = hitung_pkp(
        laba_bersih_komersial, koreksi_fiskal_positif, koreksi_fiskal_negatif,
        kompensasi_kerugian_fiskal,
    )
    pkp = rekonsiliasi["penghasilan_kena_pajak"]

    pembagian = hitung_pembagian_fasilitas_31e(total_peredaran_bruto, pkp, skema_pajak)

    pph_atas_pkp_fasilitas = round(pembagian["pkp_mendapat_fasilitas"] * TARIF_EFEKTIF_FASILITAS, 0)
    pph_atas_pkp_nonfasilitas = round(pembagian["pkp_tidak_mendapat_fasilitas"] * TARIF_PPH_BADAN_UMUM, 0)
    pph_badan_terutang = pph_atas_pkp_fasilitas + pph_atas_pkp_nonfasilitas

    # [FIX-ringan] PPh Tanpa Fasilitas 31E: model referensi (=IF(skema<>
    # umum,0,PKP*22%)) menghasilkan 0 kalau skema bukan tarif umum --
    # sebelumnya kode ini selalu menghitung PKP*22% berapa pun skemanya.
    pph_tanpa_fasilitas = 0.0 if skema_pajak != SKEMA_TARIF_UMUM_31E else round(pkp * TARIF_PPH_BADAN_UMUM, 0)
    # [FIX-ringan] model referensi pakai MAX(0, ...) -- penghematan tidak
    # pernah ditampilkan negatif meski secara teori tidak terjadi di jalur
    # normal (fasilitas 31E hanya mengurangi, tidak pernah menambah pajak).
    penghematan_pajak = max(0.0, pph_tanpa_fasilitas - pph_badan_terutang)

    tarif_efektif_riil = (pph_badan_terutang / pkp) if pkp > 0 else 0.0

    selisih = pph_badan_terutang - total_kredit_pajak
    pph_pasal_29_kurang_bayar = round(max(selisih, 0.0), 0)
    pph_pasal_28a_lebih_bayar = round(max(-selisih, 0.0), 0)

    hasil = {
        "nama_perusahaan": nama_perusahaan,
        "tahun_pajak": tahun_pajak,
        "skema_pajak": skema_pajak,
        "persentase_pengurangan_pasal_31e": PERSENTASE_PENGURANGAN_PASAL_31E,
        "tarif_pph_badan_umum": TARIF_PPH_BADAN_UMUM,
        "tarif_efektif_fasilitas": TARIF_EFEKTIF_FASILITAS,
        "batas_peredaran_bruto_fasilitas_penuh": BATAS_PEREDARAN_BRUTO_FASILITAS_PENUH,
        "batas_maks_peredaran_bruto_fasilitas": BATAS_MAKS_PEREDARAN_BRUTO_FASILITAS,
        "peredaran_bruto_detail": peredaran_bruto_detail,
        "keterangan_peredaran_bruto": keterangan_peredaran_bruto,
        "rekonsiliasi_fiskal": rekonsiliasi,
        "fasilitas_31e": pembagian,
        "pph_atas_pkp_fasilitas": pph_atas_pkp_fasilitas,
        "pph_atas_pkp_nonfasilitas": pph_atas_pkp_nonfasilitas,
        "pph_badan_terutang": pph_badan_terutang,
        "pph_tanpa_fasilitas_31e": pph_tanpa_fasilitas,
        "penghematan_pajak_pasal_31e": penghematan_pajak,
        "tarif_pajak_efektif_riil": round(tarif_efektif_riil, 4),
        "kredit_pajak": {
            "pph_22": pph_22, "pph_23": pph_23, "pph_24": pph_24,
            "angsuran_pph_25": angsuran_pph_25, "total": total_kredit_pajak,
        },
        "pph_pasal_29_kurang_bayar": pph_pasal_29_kurang_bayar,
        "pph_pasal_28a_lebih_bayar": pph_pasal_28a_lebih_bayar,
        "status": "KURANG BAYAR" if pph_pasal_29_kurang_bayar > 0 else (
            "LEBIH BAYAR" if pph_pasal_28a_lebih_bayar > 0 else "NIHIL"
        ),
        "catatan": (
            "Perhitungan otomatis berdasarkan tarif Pasal 17 & fasilitas Pasal 31E UU PPh jo. UU HPP. "
            "WAJIB direview akuntan pajak bersertifikat sebelum dipakai untuk pelaporan resmi -- "
            "termasuk verifikasi ulang ambang batas & tarif yang berlaku pada tahun pajak bersangkutan."
        ),
    }

    logger.info(
        f"📊 PPh Badan 31E tahun {tahun_pajak}: PKP={pkp:,.0f}, "
        f"terutang={pph_badan_terutang:,.0f}, status={hasil['status']}"
    )

    return hasil