"""
modules/dedup_transaksi.py
===========================
Deteksi upload ulang / revisi rekening koran supaya TIDAK dobel hitung &
TIDAK dobel voucher.

KONTEKS: /api/proses-file (main.py) sudah menarik draf_jurnal ke antrean
jurnal_posting secara OTOMATIS setiap kali file diproses (lihat
db_client.tarik_draf_jurnal_ke_posting()), dan VoucherCounter memberi
nomor voucher permanen SAAT itu juga. Sebelum modul ini ada, kalau
akuntan tidak sengaja upload rekening koran bulan yang sama dua kali
(atau upload versi revisi yang isinya sebagian besar sama dengan file
sebelumnya), SEMUA baris di file kedua ikut ditarik ke jurnal_posting
lagi -> transaksi dobel hitung di Laporan Keuangan, dan nomor voucher
baru dibakar untuk baris yang sebenarnya sudah ada vouchernya.

STRATEGI (3 lapis, dari paling murah/pasti ke paling mahal/tidak pasti):
  1. FILE_IDENTIK   -- hash SHA-256 seluruh file sama persis dengan
                        upload sebelumnya utk client ini. Paling murah,
                        paling pasti ini upload ulang tidak sengaja.
  2. DUPLIKAT_PENUH  -- fingerprint (tanggal+bank+keterangan+nominal+saldo)
                        hampir semua baris (>= AMBANG_DUPLIKAT_PENUH) SUDAH
                        ada di jurnal_posting aktif utk kombinasi bank+
                        periode yang sama.
  3. REVISI_SEBAGIAN -- sebagian baris (>= AMBANG_REVISI, tapi belum
                        DUPLIKAT_PENUH) sudah ada -- ini pola khas "revisi":
                        akuntan upload ulang rekening koran yang sama tapi
                        dengan tambahan transaksi baru (mis. bank baru
                        update mutasi beberapa hari terakhir).

Baris dengan overlap KECIL (di bawah AMBANG_REVISI) dianggap wajar
(kebetulan ada 1-2 transaksi mirip, mis. dua transfer nominal sama di
hari yang sama) dan TIDAK memicu konfirmasi -- supaya akuntan tidak
di-spam prompt konfirmasi untuk kasus yang sebenarnya normal.

PRINSIP PENTING: modul ini TIDAK PERNAH memutuskan sendiri untuk buang
data. Kalau ada indikasi duplikat/revisi, keputusan akhir (lanjutkan
semua / hanya baris baru / batalkan) tetap di tangan akuntan lewat
endpoint konfirmasi (lihat main.py::konfirmasi_upload_batch). Modul ini
hanya MENAHAN baris yang mencurigakan supaya tidak otomatis ikut
ditarik ke jurnal_posting sebelum dikonfirmasi.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .accounting_export import _kode_bank_dari_nama
from .logging_config import get_module_logger

logger = get_module_logger("dedup_transaksi")


# ============================================================
# STATUS EVALUASI
# ============================================================
STATUS_BARU = "BARU"
STATUS_REVISI_SEBAGIAN = "REVISI_SEBAGIAN"
STATUS_DUPLIKAT_PENUH = "DUPLIKAT_PENUH"
STATUS_FILE_IDENTIK = "FILE_IDENTIK"

_URUTAN_KEPARAHAN = {
    STATUS_BARU: 0,
    STATUS_REVISI_SEBAGIAN: 1,
    STATUS_DUPLIKAT_PENUH: 2,
    STATUS_FILE_IDENTIK: 3,
}

LABEL_STATUS: Dict[str, str] = {
    STATUS_BARU: "Baru",
    STATUS_REVISI_SEBAGIAN: "Revisi Sebagian (ada transaksi lama & baru)",
    STATUS_DUPLIKAT_PENUH: "Duplikat Penuh (hampir semua transaksi sudah pernah diupload)",
    STATUS_FILE_IDENTIK: "File Identik (persis sama dengan upload sebelumnya)",
}

# >=95% baris di kelompok (bank+periode) yang sama sudah ada -> dianggap
# duplikat penuh (upload ulang file yang sama / setara).
AMBANG_DUPLIKAT_PENUH = 0.95

# >=30% baris overlap (tapi belum penuh) -> dianggap pola revisi, perlu
# konfirmasi. Di bawah ambang ini overlap dianggap kebetulan wajar.
AMBANG_REVISI = 0.30


# ============================================================
# FINGERPRINT / HASHING
# ============================================================

def _normalisasi_keterangan(teks: Any) -> str:
    """Lowercase + rapikan spasi, TIDAK membuang kata (beda dgn
    cross_matching._normalisasi_teks yang buang stopword) -- untuk
    fingerprint kita justru mau setiap perbedaan kecil tetap kebaca,
    bukan disamakan."""
    if teks is None:
        return ""
    teks = str(teks).strip().lower()
    teks = re.sub(r"\s+", " ", teks)
    return teks


def _format_nominal(nilai: Any) -> str:
    """Format nominal jadi string 2 desimal yang stabil -- None/NaN/""
    semua dianggap 0 supaya representasi selalu konsisten antar baris."""
    try:
        if nilai is None or (isinstance(nilai, float) and pd.isna(nilai)):
            return "0.00"
        return f"{float(nilai):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _format_tanggal(nilai: Any) -> str:
    t = pd.to_datetime(nilai, errors="coerce")
    if pd.isna(t):
        return str(nilai or "")
    return t.strftime("%Y-%m-%d")


def buat_signature_baris(baris: Dict[str, Any]) -> str:
    """
    Fingerprint SHA-256 satu baris draf_jurnal rekening koran.

    Komponen SENGAJA dipilih dari data yang tidak berubah walau
    kategorisasi AI/akun berbeda antar run (tanggal, bank, keterangan
    mentah, nominal, saldo) -- BUKAN dari no_akun_debet/no_akun_kredit,
    supaya 2 baris yang sebenarnya transaksi yang sama tetap dikenali
    kembar walau akuntan sempat mengoreksi kategorinya di antara 2 upload.

    "saldo" (kalau ada di baris -- lihat catatan di akuntansi_ai.py::
    proses_file_rekening_koran) sangat memperkuat fingerprint karena
    saldo berjalan hampir selalu unik per posisi baris di rekening koran
    asli, jadi 2 transaksi kebetulan sama nominal & keterangan di hari
    yang sama tetap bisa dibedakan.

    [PENTING] Logika ini SENGAJA diduplikasi (bukan dipanggil lewat
    import) di db_client.py sebagai _buat_transaction_hash_baris(),
    karena db_client.py tidak boleh import dari modules/ (risiko
    circular import -- lihat catatan yang sama di
    db_client._kode_bank_dari_nama_lokal()). KALAU FORMULA INI DIUBAH,
    formula kembarannya di db_client.py WAJIB diubah juga, supaya hash
    yang dihitung di sini (saat evaluasi, sebelum baris disimpan) selalu
    identik dengan hash yang disimpan permanen di kolom
    jurnal_posting.transaction_hash (saat baris benar-benar ditarik ke
    posting oleh tarik_draf_jurnal_ke_posting()).
    """
    bagian = [
        _format_tanggal(baris.get("tanggal")),
        str(baris.get("bank") or "").strip().upper(),
        _normalisasi_keterangan(baris.get("keterangan")),
        _format_nominal(baris.get("jml_debet")),
        _format_nominal(baris.get("jml_kredit")),
        _format_nominal(baris.get("saldo")),
    ]
    mentah = "|".join(bagian)
    return hashlib.sha256(mentah.encode("utf-8")).hexdigest()


def hitung_file_hash(isi_file: bytes) -> str:
    """Hash SHA-256 seluruh byte file -- deteksi upload ulang file yang
    PERSIS SAMA (paling murah & paling pasti, dicek pertama sebelum
    fingerprint per baris)."""
    return hashlib.sha256(isi_file).hexdigest()


def _periode_dari_tanggal(tanggal_str: Any) -> str:
    """Format "MMYY" dari tanggal baris -- SENGAJA sama persis dengan
    db_client._periode_voucher_dari_tanggal() supaya kelompok (bank,
    periode) yang dipakai evaluasi di sini konsisten dengan kelompok
    yang dipakai reservasi nomor voucher."""
    t = pd.to_datetime(tanggal_str, errors="coerce")
    if pd.isna(t):
        sekarang = pd.Timestamp.now()
        return f"{sekarang.month:02d}{str(sekarang.year)[-2:]}"
    return f"{t.month:02d}{str(t.year)[-2:]}"


# ============================================================
# HASIL EVALUASI
# ============================================================

@dataclass
class KelompokEvaluasi:
    """Hasil evaluasi utk satu kombinasi (kode_bank, periode) di dalam
    file yang diupload -- satu file bisa berisi beberapa bank/periode
    sekaligus (rekening koran multi-sheet)."""
    kode_bank: str
    periode: str
    jumlah_baris_total: int
    jumlah_baris_baru: int
    jumlah_baris_overlap: int
    persentase_overlap: float
    status: str
    batch_sebelumnya: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kode_bank": self.kode_bank,
            "periode": self.periode,
            "jumlah_baris_total": self.jumlah_baris_total,
            "jumlah_baris_baru": self.jumlah_baris_baru,
            "jumlah_baris_overlap": self.jumlah_baris_overlap,
            "persentase_overlap": round(self.persentase_overlap, 3),
            "status": self.status,
            "label_status": LABEL_STATUS.get(self.status, self.status),
            "batch_sebelumnya": self.batch_sebelumnya,
        }


@dataclass
class HasilEvaluasiDuplikasi:
    status_keseluruhan: str
    perlu_konfirmasi: bool
    pesan: str
    kelompok: List[KelompokEvaluasi] = field(default_factory=list)
    # Gabungan semua baris (dari SEMUA kelompok) yang fingerprint-nya
    # BELUM pernah ada -- dipakai kalau akuntan pilih aksi
    # "hanya_baris_baru" saat konfirmasi.
    baris_baru_saja: List[Dict[str, Any]] = field(default_factory=list)
    file_hash: str = ""
    batch_file_sama: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status_keseluruhan": self.status_keseluruhan,
            "label_status": LABEL_STATUS.get(self.status_keseluruhan, self.status_keseluruhan),
            "perlu_konfirmasi": self.perlu_konfirmasi,
            "pesan": self.pesan,
            "kelompok": [k.to_dict() for k in self.kelompok],
            "jumlah_baris_baru_saja": len(self.baris_baru_saja),
            "batch_file_sama": self.batch_file_sama,
        }


def _susun_pesan(kelompok: List[KelompokEvaluasi], status_terburuk: str) -> str:
    if status_terburuk == STATUS_BARU:
        return "Tidak ada indikasi duplikat -- semua transaksi baru."

    bagian_bermasalah = [
        k for k in kelompok
        if k.status in (STATUS_DUPLIKAT_PENUH, STATUS_REVISI_SEBAGIAN)
    ]
    detail = "; ".join(
        f"{k.kode_bank} periode {k.periode}: {k.jumlah_baris_overlap}/{k.jumlah_baris_total} "
        f"baris ({k.persentase_overlap:.0%}) sudah pernah diupload"
        for k in bagian_bermasalah
    )
    if status_terburuk == STATUS_DUPLIKAT_PENUH:
        return (
            f"Sebagian besar transaksi di file ini SUDAH PERNAH diupload sebelumnya. "
            f"{detail}. Kemungkinan ini upload ulang rekening koran bulan yang sama."
        )
    return (
        f"Sebagian transaksi di file ini sudah pernah diupload, sebagian lagi baru "
        f"(pola khas revisi). {detail}. Pilih apakah mau lanjutkan hanya baris baru, "
        f"lanjutkan semua (kalau memang transaksi ganda yang sah), atau batalkan."
    )


def kelompokkan_draf_jurnal(draf_jurnal: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    """Kelompokkan baris draf_jurnal rekening koran per (kode_bank, periode)."""
    kelompok: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for baris in draf_jurnal:
        kode_bank = _kode_bank_dari_nama(baris.get("bank") or "BANK")
        periode = _periode_dari_tanggal(baris.get("tanggal"))
        kelompok.setdefault((kode_bank, periode), []).append(baris)
    return kelompok


def evaluasi_upload_rekening_koran(
    client_id: int,
    draf_jurnal: List[Dict[str, Any]],
    file_hash: str,
) -> HasilEvaluasiDuplikasi:
    """
    Evaluasi apakah upload rekening koran ini duplikat/revisi dari upload
    sebelumnya milik client yang sama.

    Dipanggil dari main.py::proses_file() SEBELUM draf_jurnal ditarik ke
    jurnal_posting (lihat db_client.tarik_draf_jurnal_ke_posting()) --
    supaya baris yang mencurigakan bisa DITAHAN dulu (tidak dobel hitung
    & tidak membakar nomor voucher) sebelum akuntan mengonfirmasi.

    Butuh koneksi database aktif (import db_client di dalam fungsi,
    bukan di top-level, supaya modul ini tetap bisa dipakai/di-test
    tanpa DB tersambung selama fungsi lain yang murni tidak dipanggil).
    """
    import db_client as dbc  # local import -- lihat docstring

    if not draf_jurnal:
        return HasilEvaluasiDuplikasi(
            status_keseluruhan=STATUS_BARU, perlu_konfirmasi=False,
            pesan="Tidak ada baris transaksi untuk dievaluasi.", file_hash=file_hash,
        )

    # --- Lapis 1: file identik (paling murah, dicek dulu) ---
    # [FIX] Sebelumnya fungsi RETURN LANGSUNG di sini begitu file identik
    # ketemu, tanpa sempat menghitung kelompok (bank, periode) sama sekali
    # -- akibatnya evaluasi.kelompok selalu KOSONG untuk kasus ini, dan
    # main.py (yang me-loop evaluasi.kelompok untuk membuat UploadBatch
    # berstatus 'menunggu_konfirmasi') TIDAK PERNAH membuat batch utk kasus
    # FILE_IDENTIK. Akibatnya /api/upload-batch/{id}/konfirmasi tidak bisa
    # dipakai sama sekali utk kasus ini -- beda perilaku dgn
    # REVISI_SEBAGIAN/DUPLIKAT_PENUH (yang batch-nya tersimpan & bisa
    # dikonfirmasi belakangan tanpa upload ulang file).
    #
    # Sekarang: deteksi file identik TETAP dicek pertama (paling murah),
    # tapi tidak langsung return -- statusnya "dipromosikan" jadi
    # STATUS_FILE_IDENTIK di akhir, SETELAH kelompok (bank, periode) tetap
    # dihitung seperti biasa. Jadi UploadBatch tetap dibuat & bisa
    # dikonfirmasi lewat endpoint yang sama, konsisten dgn 2 status lain.
    batch_file_sama = dbc.cari_upload_batch_by_file_hash(client_id, file_hash)
    if batch_file_sama:
        logger.warning(f"🔁 File identik terdeteksi utk client {client_id}: {batch_file_sama.get('nama_file')}")

    # --- Lapis 2 & 3: fingerprint per baris, per kelompok (bank, periode) ---
    kelompok_baris = kelompokkan_draf_jurnal(draf_jurnal)

    semua_kelompok: List[KelompokEvaluasi] = []
    baris_baru_saja: List[Dict[str, Any]] = []
    status_terburuk = STATUS_BARU

    for (kode_bank, periode), baris_list in kelompok_baris.items():
        hash_lama = dbc.ambil_hash_transaksi_aktif(client_id, kode_bank, periode)
        batch_sebelumnya = dbc.ambil_batch_aktif(client_id, kode_bank, periode)

        for b in baris_list:
            b["_hash"] = buat_signature_baris(b)

        overlap = [b for b in baris_list if b["_hash"] in hash_lama]
        baru = [b for b in baris_list if b["_hash"] not in hash_lama]
        total = len(baris_list)
        persen = (len(overlap) / total) if total else 0.0

        if not hash_lama or persen < AMBANG_REVISI:
            status = STATUS_BARU
        elif persen >= AMBANG_DUPLIKAT_PENUH:
            status = STATUS_DUPLIKAT_PENUH
        else:
            status = STATUS_REVISI_SEBAGIAN

        semua_kelompok.append(KelompokEvaluasi(
            kode_bank=kode_bank,
            periode=periode,
            jumlah_baris_total=total,
            jumlah_baris_baru=len(baru),
            jumlah_baris_overlap=len(overlap),
            persentase_overlap=persen,
            status=status,
            batch_sebelumnya=batch_sebelumnya,
        ))
        baris_baru_saja.extend(baru)

        if _URUTAN_KEPARAHAN[status] > _URUTAN_KEPARAHAN[status_terburuk]:
            status_terburuk = status

    # [FIX] File identik SELALU jadi status akhir kalau terdeteksi -- ini
    # sinyal paling kuat (byte-for-byte sama), harus "menang" dibanding
    # status per-kelompok apa pun (mis. kalaupun overlap per baris
    # kebetulan dihitung sbg BARU/REVISI_SEBAGIAN krn alasan lain, file
    # yang sama persis tetap harus diperlakukan sbg FILE_IDENTIK).
    if batch_file_sama:
        status_terburuk = STATUS_FILE_IDENTIK

    perlu_konfirmasi = status_terburuk in (STATUS_DUPLIKAT_PENUH, STATUS_REVISI_SEBAGIAN, STATUS_FILE_IDENTIK)

    if status_terburuk == STATUS_FILE_IDENTIK:
        pesan = (
            f"File ini PERSIS SAMA (byte-for-byte) dengan file yang sudah diupload "
            f"sebelumnya: \"{batch_file_sama.get('nama_file')}\" pada "
            f"{batch_file_sama.get('dibuat_at')}. Ini kemungkinan besar upload ulang "
            f"yang tidak disengaja."
        )
    else:
        pesan = _susun_pesan(semua_kelompok, status_terburuk)

    if perlu_konfirmasi:
        logger.warning(
            f"⚠️ Indikasi {status_terburuk} utk client {client_id}: "
            f"{sum(k.jumlah_baris_overlap for k in semua_kelompok)} baris overlap"
        )

    return HasilEvaluasiDuplikasi(
        status_keseluruhan=status_terburuk,
        perlu_konfirmasi=perlu_konfirmasi,
        pesan=pesan,
        kelompok=semua_kelompok,
        baris_baru_saja=baris_baru_saja,
        file_hash=file_hash,
        batch_file_sama=batch_file_sama,
    )


def hapus_kolom_internal(draf_jurnal: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Buang key "_hash" yang ditempel evaluasi_upload_rekening_koran()
    sebelum draf_jurnal dikirim balik sbg response JSON ke frontend
    (key ini murni internal, tidak perlu -- dan tidak semua encoder JSON
    di main.py tahu cara menangani key berawalan underscore)."""
    return [{k: v for k, v in baris.items() if k != "_hash"} for baris in draf_jurnal]