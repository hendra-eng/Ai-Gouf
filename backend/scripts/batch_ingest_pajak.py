"""
scripts/batch_ingest_pajak.py

[Tahap 3] Pipeline semi-otomatis untuk memasukkan dokumen peraturan pajak
ke sistem, sesuai rencana poin 9-11:

  9. Bukan live-scraping saat AI ditanya -- ini proses TERPISAH yang staf
     jalankan manual/berkala: cari & download PDF dari JDIH Kemenkeu /
     peraturan.go.id / situs DJP per dokumen, taruh di satu folder, isi
     manifest CSV, baru jalankan script ini.
  10. Ekstraksi teks (termasuk fallback OCR untuk PDF hasil scan) ditangani
      modules/tax_pdf_extractor.py.
  11. Tiap dokumen wajib metadata lengkap -- manifest CSV mewajibkan semua
      kolom kecuali tanggal_terbit & status.

KENAPA CSV manifest, bukan "download otomatis dari URL":
  - JDIH/peraturan.go.id/DJP tidak punya API resmi & seringkali pakai
    proteksi (captcha, JS rendering) yang bikin download otomatis rapuh
    dan gampang dianggap scraping berlebihan oleh situs mereka.
  - Manifest CSV = staf yang sudah tahu dokumen mana yang relevan (hasil
    Tahap 1: prioritas PPh 21/23/26/29, PPN, dst) cukup catat metadata +
    simpan PDF manual, robust terhadap perubahan struktur situs sumber.

[Tahap 5, poin 16] Script yang SAMA ini sekarang juga dipakai untuk proses
update bulanan -- bukan cuma ingest awal (Tahap 3). Dua kolom manifest
OPSIONAL baru:

  - `mencabut_nomor`: nomor dokumen LAMA (sudah ada di database) yang
    DIGANTIKAN oleh dokumen di baris ini. Kalau diisi, begitu dokumen baru
    di baris ini berhasil di-ingest, script otomatis memanggil
    modules.tax_ingestion.tandai_digantikan() untuk dokumen lama itu --
    sekaligus mengupdate statusnya (lihat `status_lama` di bawah) DAN
    menaut digantikan_oleh-nya ke dokumen baru, dalam satu langkah,
    supaya keduanya tidak pernah tidak-sinkron.
  - `status_lama`: status baru untuk dokumen lama tsb -- "dicabut" atau
    "diubah" (default "dicabut" kalau kolom ini kosong tapi
    `mencabut_nomor` diisi). Diabaikan kalau `mencabut_nomor` kosong.

  Kalau dokumen lama yang dirujuk `mencabut_nomor` TIDAK ditemukan di
  database (mis. salah ketik nomor, atau dokumen itu memang belum pernah
  di-ingest), baris tetap dianggap SUKSES untuk ingest dokumen barunya --
  cuma bagian "tandai lama sebagai digantikan" dilewati & dicatat di
  kolom `catatan` supaya staf tahu perlu dicek manual. Ini supaya satu
  nomor rujukan yang salah ketik tidak menggagalkan ingest dokumen baru
  yang sebetulnya valid.

  Untuk proses bulanan MURNI update-status (tanpa dokumen pengganti baru,
  mis. staf cuma perlu menandai "PMK X dicabut" tanpa PMK pengganti yang
  jelas), gunakan scripts/update_status_manual.py -- lebih sederhana
  daripada memaksa isi manifest ingest lengkap untuk kasus yang tidak
  butuh ingest dokumen baru sama sekali.

CARA PAKAI:
  1. Siapkan folder berisi PDF, mis. ./pdf_pajak/pmk_168_2023.pdf
  2. Isi manifest.csv (lihat manifest_contoh.csv di folder yang sama untuk
     format & header kolom yang wajib)
  3. Jalankan:
       python scripts/batch_ingest_pajak.py \
           --manifest manifest.csv \
           --pdf-dir ./pdf_pajak \
           --report hasil_ingest.csv

     Tambahkan --dry-run dulu untuk cuma menguji ekstraksi PDF (cek apakah
     ada yang butuh OCR / gagal dibaca) TANPA benar-benar meng-ingest ke
     database -- disarankan selalu dry-run dulu untuk manifest baru.

     [Tahap 5] --dry-run JUGA melewati langkah tandai_digantikan() (sama
     seperti melewati ingest sungguhan) -- dry run murni untuk cek
     ekstraksi PDF, tidak menyentuh database sama sekali.

Baris yang gagal (PDF tidak ketemu, ekstraksi gagal, dsb) TIDAK menghentikan
seluruh batch -- dicatat di kolom `status` & `catatan` pada file laporan,
supaya staf tinggal perbaiki baris yang bermasalah lalu re-run manifest yang
sudah dipangkas ke baris gagal saja.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import logging
import sys
import time
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# Backend project root harus ada di sys.path supaya "modules.xxx" bisa
# di-import saat script ini dijalankan langsung (bukan lewat -m).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.schemas import DocType, RegulationStatus, TaxCategory  # noqa: E402
from modules.tax_pdf_extractor import extract_text  # noqa: E402

# Kolom wajib di manifest.csv -- lihat manifest_contoh.csv untuk contoh isi.
KOLOM_WAJIB = ["nomor", "jenis", "judul", "kategori_pajak", "url_sumber", "pdf_filename"]
# [Tahap 5] mencabut_nomor & status_lama ditambahkan di sini -- lihat
# catatan panjang di docstring atas untuk perilakunya.
KOLOM_OPSIONAL = ["tanggal_terbit", "status", "mencabut_nomor", "status_lama"]

# [Tahap 5] Status default untuk dokumen LAMA kalau `mencabut_nomor` diisi
# tapi `status_lama` dikosongkan -- kasus paling umum (PMK baru MENCABUT
# PMK lama sepenuhnya) daripada "diubah sebagian".
STATUS_LAMA_DEFAULT = RegulationStatus.DICABUT

logger = logging.getLogger("batch_ingest_pajak")


def _setup_logging(log_path: str) -> None:
    """
    [Robustness] Batch ini bisa jalan lama (ratusan/ribuan dokumen) dan
    sering dijalankan lewat terminal yang nanti ditutup -- kalau cuma
    print() ke stdout, jejaknya hilang. Semua yang tampil di terminal juga
    ditulis ke file log dengan timestamp, supaya kalau ada masalah besok/
    minggu depan (mis. AI mengutip dokumen yang ternyata salah proses),
    staf bisa telusuri balik kapan & bagaimana dokumen itu di-ingest.
    """
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(console_handler)


@dataclass
class HasilBaris:
    nomor: str
    judul: str
    pdf_filename: str
    status_proses: str  # "sukses_baru" | "sukses_update" | "dilewati_tidak_berubah" | "gagal" | "dilewati_dry_run"
    document_id: str = ""
    used_ocr: bool = False
    is_encrypted: bool = False
    mojibake_suspect: bool = False
    perlu_review_manual: bool = False
    # [Tahap 5] Ringkasan hasil tandai_digantikan() untuk baris ini, kalau
    # `mencabut_nomor` diisi -- "" berarti kolom itu kosong di manifest
    # (baris ini bukan bagian dari alur supersede Tahap 5).
    penggantian_status_lama: str = ""
    catatan: str = ""


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _format_durasi(detik: float) -> str:
    """Format detik jadi string ringkas & tidak ambigu: '45dtk', '3mnt 12dtk',
    '2jam 5mnt', '1hari 3jam'."""
    detik = int(detik)
    if detik < 60:
        return f"{detik}dtk"
    menit, detik = divmod(detik, 60)
    if menit < 60:
        return f"{menit}mnt {detik}dtk"
    jam, menit = divmod(menit, 60)
    if jam < 24:
        return f"{jam}jam {menit}mnt"
    hari, jam = divmod(jam, 24)
    return f"{hari}hari {jam}jam"


class ProgressTracker:
    """
    [Robustness] Batch ribuan dokumen bisa jalan berjam-jam, dan durasi per
    dokumen SANGAT bervariasi (dokumen ber-teks: <1 detik; dokumen hasil
    scan yang lewat OCR: puluhan detik). Rata-rata dari SELURUH histori
    tidak representatif kalau composisi OCR/non-OCR berubah di tengah
    batch (mis. 500 dokumen pertama semua ber-teks, 500 berikutnya semua
    hasil scan) -- makanya dipakai rolling window (default 20 dokumen
    terakhir), bukan rata-rata keseluruhan, supaya ETA menyesuaikan diri
    kalau kecepatan pemrosesan berubah di tengah jalan.
    """

    def __init__(self, total: int, window: int = 20):
        self.total = total
        self.selesai = 0
        self.mulai = time.time()
        self._durasi_terakhir: deque[float] = deque(maxlen=window)

    def catat(self, durasi_baris: float) -> None:
        self.selesai += 1
        self._durasi_terakhir.append(durasi_baris)

    def status_line(self) -> str:
        sisa = self.total - self.selesai
        elapsed = time.time() - self.mulai
        if self._durasi_terakhir:
            rata2 = sum(self._durasi_terakhir) / len(self._durasi_terakhir)
            eta = rata2 * sisa
            return (
                f"({self.selesai}/{self.total}, {rata2:.1f}d/dokumen rata-rata, "
                f"berjalan {_format_durasi(elapsed)}, perkiraan sisa {_format_durasi(eta)})"
            )
        return f"({self.selesai}/{self.total}, berjalan {_format_durasi(elapsed)})"


def main() -> None:
    args = _parse_args()
    _setup_logging(args.log)

    baris_manifest = _baca_manifest(args.manifest)
    logger.info(f"Manifest dibaca: {len(baris_manifest)} baris.")

    _peringatkan_duplikat_di_manifest(baris_manifest)

    tandai_digantikan_fn = None
    if not args.dry_run:
        # Import di sini (bukan top-level) supaya --dry-run tetap bisa
        # jalan walau embedding.py belum siap (mis. sentence-transformers
        # belum ter-install di mesin staf yang cuma mau cek ekstraksi PDF).
        from modules.tax_ingestion import (
            upsert_document_by_nomor,
            find_by_nomor,
            tandai_digantikan,
        )
        tandai_digantikan_fn = tandai_digantikan

    hasil_semua: list[HasilBaris] = []
    tracker = ProgressTracker(total=len(baris_manifest))
    for i, baris in enumerate(baris_manifest, start=1):
        t0 = time.time()
        logger.info(f"[{i}/{len(baris_manifest)}] {baris.get('nomor','')} -- {baris.get('pdf_filename','')}")
        hasil = _proses_satu_baris(
            baris,
            pdf_dir=Path(args.pdf_dir),
            dry_run=args.dry_run,
            upsert_fn=None if args.dry_run else upsert_document_by_nomor,
            find_fn=None if args.dry_run else find_by_nomor,
            tandai_digantikan_fn=tandai_digantikan_fn,
        )
        hasil_semua.append(hasil)
        tracker.catat(time.time() - t0)

        keterangan = f"    -> {hasil.status_proses}"
        if hasil.document_id:
            keterangan += f" (id={hasil.document_id})"
        if hasil.penggantian_status_lama:
            keterangan += f" | {hasil.penggantian_status_lama}"
        if hasil.perlu_review_manual:
            keterangan += f" | PERLU REVIEW: {hasil.catatan}"
        elif hasil.status_proses == "gagal":
            keterangan += f" | {hasil.catatan}"
        logger.info(keterangan)

        # ETA ditampilkan tiap baris untuk batch kecil, tiap 10 baris untuk
        # batch besar -- supaya log tidak banjir baris ETA untuk ribuan
        # dokumen tapi tetap informatif untuk batch kecil.
        interval = 1 if len(baris_manifest) <= 50 else 10
        if i % interval == 0 or i == len(baris_manifest):
            logger.info(f"    {tracker.status_line()}")

    total_waktu = time.time() - tracker.mulai
    _tulis_laporan(args.report, hasil_semua)

    sukses_baru = sum(1 for h in hasil_semua if h.status_proses == "sukses_baru")
    sukses_update = sum(1 for h in hasil_semua if h.status_proses == "sukses_update")
    dilewati_sama = sum(1 for h in hasil_semua if h.status_proses == "dilewati_tidak_berubah")
    gagal = sum(1 for h in hasil_semua if h.status_proses == "gagal")
    perlu_review = sum(1 for h in hasil_semua if h.perlu_review_manual)
    n_penggantian = sum(1 for h in hasil_semua if h.penggantian_status_lama)
    logger.info(
        f"\nSelesai dalam {_format_durasi(total_waktu)}. Dokumen baru: {sukses_baru}, Diperbarui: {sukses_update}, "
        f"Dilewati (PDF sama persis, tidak ada perubahan): {dilewati_sama}, "
        f"Gagal: {gagal}, Perlu spot-check manual (Tahap 4): {perlu_review}, "
        f"Dokumen lama ditandai digantikan (Tahap 5): {n_penggantian}. "
        f"Detail lengkap ada di {args.report}, log lengkap di {args.log}"
    )
    if args.dry_run:
        logger.info("Ini DRY RUN -- belum ada yang benar-benar masuk ke database.")
    if gagal:
        sys.exit(1)  # exit code != 0 supaya kalau dipanggil dari script/cron lain, kegagalan tidak lolos diam-diam


def _proses_satu_baris(
    baris: dict,
    pdf_dir: Path,
    dry_run: bool,
    upsert_fn,
    find_fn,
    tandai_digantikan_fn=None,
) -> HasilBaris:
    nomor = (baris.get("nomor") or "").strip()
    judul = (baris.get("judul") or "").strip()
    pdf_filename = (baris.get("pdf_filename") or "").strip()
    pdf_path = pdf_dir / pdf_filename

    hasil = HasilBaris(nomor=nomor, judul=judul, pdf_filename=pdf_filename, status_proses="gagal")

    if not nomor or not judul or not pdf_filename:
        hasil.catatan = "Kolom nomor/judul/pdf_filename kosong -- baris dilewati."
        return hasil

    if not pdf_path.exists():
        hasil.catatan = f"File PDF tidak ditemukan di {pdf_path}"
        return hasil

    # [Tahap 5] Validasi awal kolom mencabut_nomor/status_lama DI SINI,
    # SEBELUM ekstraksi PDF (yang bisa mahal, apalagi kalau OCR) --
    # supaya typo status_lama ketahuan cepat, bukan setelah proses PDF
    # yang lama baru gagal di akhir.
    mencabut_nomor = (baris.get("mencabut_nomor") or "").strip()
    status_lama_raw = (baris.get("status_lama") or "").strip()
    status_lama_val = STATUS_LAMA_DEFAULT
    if mencabut_nomor and status_lama_raw:
        try:
            status_lama_val = RegulationStatus(status_lama_raw)
        except ValueError:
            hasil.catatan = (
                f"status_lama '{status_lama_raw}' bukan salah satu dari "
                f"{[e.value for e in RegulationStatus]}"
            )
            return hasil
        if status_lama_val == RegulationStatus.BERLAKU:
            hasil.catatan = (
                "status_lama tidak boleh 'berlaku' kalau mencabut_nomor diisi -- "
                "dokumen yang digantikan seharusnya 'dicabut' atau 'diubah'."
            )
            return hasil

    # [Performance] Skip ekstraksi+embedding kalau nomor sudah ada di
    # database DAN isi file PDF-nya identik (hash sama) dengan yang sudah
    # di-ingest -- penting untuk ribuan dokumen: ekstraksi (apalagi OCR) dan
    # embedding jauh lebih mahal daripada sekadar hash file. Tanpa ini,
    # rerun manifest yang sama untuk ribuan dokumen akan makan waktu sama
    # lamanya dengan run pertama walau tidak ada yang berubah.
    pdf_hash = _hash_file(pdf_path)
    if find_fn is not None:
        existing = find_fn(nomor)
        if existing is not None and existing.metadata.get("pdf_hash") == pdf_hash:
            hasil.status_proses = "dilewati_tidak_berubah"
            hasil.document_id = existing.id
            hasil.catatan = "PDF identik dengan yang sudah di-ingest sebelumnya -- dilewati."
            # [Tahap 5] Baris dilewati karena PDF sama -- tapi kalau
            # mencabut_nomor diisi, tetap proses penggantiannya (mis. staf
            # menambahkan mencabut_nomor belakangan untuk dokumen yang
            # sudah pernah di-ingest sebelumnya, tanpa mengubah PDF-nya).
            if mencabut_nomor and tandai_digantikan_fn is not None and find_fn is not None:
                hasil.penggantian_status_lama = _proses_penggantian(
                    mencabut_nomor, status_lama_val, existing.id, find_fn, tandai_digantikan_fn
                )
            return hasil

    try:
        jenis = DocType(baris["jenis"].strip())
    except ValueError:
        hasil.catatan = f"jenis '{baris['jenis']}' bukan salah satu dari {[e.value for e in DocType]}"
        return hasil

    try:
        kategori = TaxCategory(baris["kategori_pajak"].strip())
    except ValueError:
        hasil.catatan = (
            f"kategori_pajak '{baris['kategori_pajak']}' bukan salah satu dari "
            f"{[e.value for e in TaxCategory]}"
        )
        return hasil

    status_val = RegulationStatus.BERLAKU
    status_raw = (baris.get("status") or "").strip()
    if status_raw:
        try:
            status_val = RegulationStatus(status_raw)
        except ValueError:
            hasil.catatan = f"status '{status_raw}' bukan salah satu dari {[e.value for e in RegulationStatus]}"
            return hasil

    tanggal_terbit: Optional[datetime] = None
    tanggal_raw = (baris.get("tanggal_terbit") or "").strip()
    if tanggal_raw:
        try:
            tanggal_terbit = datetime.strptime(tanggal_raw, "%Y-%m-%d")
        except ValueError:
            hasil.catatan = f"tanggal_terbit '{tanggal_raw}' harus format YYYY-MM-DD"
            return hasil

    url_sumber = (baris.get("url_sumber") or "").strip()
    if not url_sumber.startswith(("http://", "https://")):
        hasil.catatan = f"url_sumber '{url_sumber}' sepertinya bukan URL valid (harus mulai http:// atau https://)"
        return hasil

    # --- Ekstraksi teks PDF (poin 10) ---
    try:
        ekstraksi = extract_text(pdf_path)
    except Exception as e:
        hasil.catatan = f"Ekstraksi PDF gagal: {e}"
        logger.exception(f"Ekstraksi PDF gagal untuk {pdf_path}")
        return hasil

    hasil.used_ocr = ekstraksi.used_ocr
    hasil.is_encrypted = ekstraksi.is_encrypted
    hasil.mojibake_suspect = ekstraksi.mojibake_suspect
    hasil.perlu_review_manual = ekstraksi.is_suspicious
    if ekstraksi.warnings:
        hasil.catatan = "; ".join(ekstraksi.warnings)
    elif ekstraksi.used_ocr:
        hasil.catatan = "Diekstrak via OCR -- wajib spot-check manual (Tahap 4) sebelum dipercaya."

    if len(ekstraksi.text.strip()) < 50:
        hasil.status_proses = "gagal"
        hasil.catatan = (hasil.catatan + "; " if hasil.catatan else "") + "Hasil ekstraksi nyaris kosong."
        return hasil

    if dry_run:
        hasil.status_proses = "dilewati_dry_run"
        return hasil

    # --- Ingest sungguhan, idempotent by nomor (poin 11: metadata lengkap) ---
    try:
        tahun = tanggal_terbit.year if tanggal_terbit else _tahun_dari_nomor(nomor)
        document, is_baru = upsert_fn(
            title=judul,
            doc_type=jenis,
            full_text=ekstraksi.text,
            nomor=nomor,
            tahun=tahun,
            url_sumber=url_sumber,
            tanggal_terbit=tanggal_terbit,
            kategori_pajak=kategori,
            status=status_val,
            status_note="Diingest via batch_ingest_pajak.py" + (" (teks hasil OCR)" if ekstraksi.used_ocr else ""),
            metadata={"pdf_hash": pdf_hash},
        )
    except Exception as e:
        hasil.status_proses = "gagal"
        hasil.catatan = (hasil.catatan + "; " if hasil.catatan else "") + f"upsert_document_by_nomor() error: {e}"
        logger.exception(f"Ingest gagal untuk nomor={nomor}")
        return hasil

    hasil.status_proses = "sukses_baru" if is_baru else "sukses_update"
    hasil.document_id = document.id

    # [Tahap 5, poin 16] Kalau baris ini menggantikan dokumen lama, tandai
    # setelah dokumen BARU berhasil tersimpan (butuh document.id-nya) --
    # ini SENGAJA dilakukan paling akhir, setelah ingest dokumen baru
    # sukses, supaya kalau ingest gagal di tengah, dokumen lama tidak
    # terlanjur ditandai "digantikan" oleh dokumen yang ternyata tidak
    # pernah benar-benar tersimpan.
    if mencabut_nomor and tandai_digantikan_fn is not None and find_fn is not None:
        hasil.penggantian_status_lama = _proses_penggantian(
            mencabut_nomor, status_lama_val, document.id, find_fn, tandai_digantikan_fn
        )

    return hasil


def _proses_penggantian(mencabut_nomor: str, status_lama_val, document_id_baru: str, find_fn, tandai_digantikan_fn) -> str:
    """
    [Tahap 5, poin 16] Cari dokumen lama by nomor, lalu tandai sebagai
    digantikan oleh document_id_baru. Return string ringkas untuk kolom
    laporan `penggantian_status_lama` -- TIDAK pernah melempar exception
    ke pemanggil (kegagalan di sini tidak boleh menggagalkan ingest
    dokumen baru yang sudah berhasil).
    """
    try:
        dokumen_lama = find_fn(mencabut_nomor)
        if dokumen_lama is None:
            return (
                f"mencabut_nomor='{mencabut_nomor}' TIDAK DITEMUKAN di database -- "
                f"dokumen baru tetap ter-ingest, tapi status dokumen lama TIDAK diupdate. Cek manual."
            )
        tandai_digantikan_fn(
            document_id_lama=dokumen_lama.id,
            document_id_baru=document_id_baru,
            status_baru=status_lama_val,
            note="Digantikan via batch_ingest_pajak.py (Tahap 5, kolom mencabut_nomor)",
        )
        return f"'{mencabut_nomor}' ditandai {status_lama_val.value} & ditaut ke dokumen baru ini."
    except Exception as e:  # noqa: BLE001 -- lihat catatan docstring: tidak boleh menggagalkan baris
        logger.exception(f"Gagal menandai penggantian untuk mencabut_nomor='{mencabut_nomor}'")
        return f"GAGAL menandai '{mencabut_nomor}' sebagai digantikan: {e}. Cek manual."


def _peringatkan_duplikat_di_manifest(baris_manifest: list[dict]) -> None:
    """
    [Robustness] Cek duplikat DI DALAM manifest itu sendiri -- ini beda
    dari dedup by nomor di database (upsert_document_by_nomor). Kasus ini
    menangkap kesalahan copy-paste staf: dua baris manifest dengan `nomor`
    yang sama (bakal saling menimpa saat diproses, baris pertama sia-sia)
    atau `pdf_filename` yang sama dipakai untuk dua nomor berbeda (hampir
    pasti typo). Tidak menghentikan proses -- cuma diperingatkan, karena
    bisa jadi memang disengaja (mis. update dokumen yang sama).
    """
    dilihat_nomor: dict[str, int] = {}
    dilihat_file: dict[str, int] = {}
    for i, baris in enumerate(baris_manifest, start=1):
        nomor = (baris.get("nomor") or "").strip().lower()
        pdf_filename = (baris.get("pdf_filename") or "").strip().lower()
        if nomor and nomor in dilihat_nomor:
            logger.warning(
                f"[PERINGATAN manifest] baris {i}: nomor '{baris.get('nomor')}' "
                f"sudah muncul di baris {dilihat_nomor[nomor]} -- baris terakhir yang akan menang."
            )
        else:
            dilihat_nomor[nomor] = i
        if pdf_filename and pdf_filename in dilihat_file:
            logger.warning(
                f"[PERINGATAN manifest] baris {i}: pdf_filename '{baris.get('pdf_filename')}' "
                f"sudah dipakai di baris {dilihat_file[pdf_filename]} -- kemungkinan typo copy-paste."
            )
        else:
            dilihat_file[pdf_filename] = i

        # [Tahap 5] mencabut_nomor yang menunjuk ke nomor DIRINYA SENDIRI
        # hampir pasti typo (dokumen tidak bisa menggantikan dirinya
        # sendiri) -- diperingatkan, tidak menghentikan proses.
        mencabut_nomor = (baris.get("mencabut_nomor") or "").strip().lower()
        if mencabut_nomor and mencabut_nomor == nomor:
            logger.warning(
                f"[PERINGATAN manifest] baris {i}: mencabut_nomor sama persis dengan "
                f"nomor dokumen itu sendiri ('{baris.get('nomor')}') -- kemungkinan typo."
            )


def _tahun_dari_nomor(nomor: str) -> Optional[int]:
    """Coba tebak tahun dari format nomor umum, mis. 'PMK 168/2023' -> 2023.
    Kalau tidak ketemu, biarkan None -- bukan hal fatal, cuma metadata
    pelengkap."""
    import re

    m = re.search(r"(19|20)\d{2}", nomor)
    return int(m.group(0)) if m else None


def _baca_manifest(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        contoh = f.read(4096)
        f.seek(0)

        # [Robustness] Excel versi region Indonesia default nyimpen "CSV"
        # pakai delimiter titik-koma (;), bukan koma -- kebiasaan umum
        # kalau staf isi manifest di Excel lalu "Save As > CSV". Kalau ini
        # tidak dideteksi, seluruh baris akan kebaca sebagai SATU kolom
        # raksasa dan validasi kolom wajib akan gagal dengan pesan yang
        # membingungkan ("kolom X hilang" padahal isinya ada, cuma
        # delimiter-nya salah).
        try:
            dialect = csv.Sniffer().sniff(contoh, delimiters=",;")
        except csv.Error:
            dialect = csv.excel  # fallback ke koma standar

        reader = csv.DictReader(f, dialect=dialect)
        if reader.fieldnames is None:
            raise ValueError("manifest.csv kosong atau tidak punya header.")
        hilang = [k for k in KOLOM_WAJIB if k not in reader.fieldnames]
        if hilang:
            raise ValueError(
                f"Kolom wajib hilang di manifest.csv: {hilang}. Header yang terbaca: "
                f"{reader.fieldnames}. Kalau header ini terlihat seperti SATU kolom "
                f"panjang berisi koma, kemungkinan delimiter CSV kamu tidak biasa -- "
                f"cek ulang cara Excel/Sheets menyimpannya."
            )
        return list(reader)


def _tulis_laporan(path: str, hasil_semua: list[HasilBaris]) -> None:
    fieldnames = list(asdict(hasil_semua[0]).keys()) if hasil_semua else [
        "nomor", "judul", "pdf_filename", "status_proses", "document_id",
        "used_ocr", "is_encrypted", "mojibake_suspect", "perlu_review_manual",
        "penggantian_status_lama", "catatan",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for h in hasil_semua:
            writer.writerow(asdict(h))


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Batch ingest dokumen peraturan pajak dari manifest CSV + folder PDF.")
    p.add_argument("--manifest", required=True, help="Path ke manifest.csv")
    p.add_argument("--pdf-dir", required=True, help="Folder tempat file-file PDF disimpan")
    p.add_argument("--report", default="hasil_ingest.csv", help="Path output laporan hasil (default: hasil_ingest.csv)")
    p.add_argument("--log", default="batch_ingest.log", help="Path file log lengkap dengan timestamp (default: batch_ingest.log)")
    p.add_argument("--dry-run", action="store_true", help="Cuma uji ekstraksi PDF, tidak benar-benar ingest ke database")
    return p.parse_args()


if __name__ == "__main__":
    main()