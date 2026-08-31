"""
modules/kertas_kerja_router.py
================================
Endpoint API untuk fitur "Kertas Kerja Laporan Keuangan" (working paper
14-sheet), dibangun DI ATAS modules/kertas_kerja.py (generate_kertas_kerja +
tulis_kertas_kerja_excel). Mengikuti pola tax_router.py yang sudah ada.

Cara pasang ke main.py:

    from modules.kertas_kerja_router import router as kertas_kerja_router
    app.include_router(kertas_kerja_router, prefix="/kertas-kerja", tags=["kertas-kerja"])

Alur endpoint utama (POST /kertas-kerja/generate):
    1. Terima N file PDF rekening koran (berapapun jumlah bulan/bank --
       lihat catatan di susun_gl_dari_pdf_rekening_koran, tidak ada batas
       "harus 12 bulan").
    2. Ambil COA client dari database (db_client.ambil_coa_client) ->
       bangun_coa_kertas_kerja_dari_db(). Kalau client belum punya kolom
       Statement/FS Group/Notes lengkap, tetap lanjut TAPI peringatan
       dikembalikan ke user (bukan gagal keras) -- lihat kertas_kerja.py.
    3. generate_kertas_kerja() -> HasilKertasKerja (GL/Bank_Control/dst).
    4. tentukan_tahun_dari_gl() -> tahun otomatis dari transaksi.
    5. tulis_kertas_kerja_excel() -> bytes .xlsx 14-sheet.
    6. Kembalikan sebagai StreamingResponse (download langsung) DAN catat
       ringkasan (jumlah transaksi/peringatan) di header response supaya
       frontend bisa tampilkan tanpa parse ulang file Excel-nya.

TODO INTEGRASI (sesuaikan dengan project kamu, ditandai jelas di bawah):
    - `db_client.ambil_coa_client(client_id)` -- ganti sesuai nama modul DB
      COA client yang sebenarnya kalau berbeda (lihat docstring
      bangun_coa_kertas_kerja_dari_db di kertas_kerja.py, itu asumsi
      penamaan yang dipakai di sana).
    - Endpoint ini TIDAK menyimpan hasil ke DB/storage -- kalau kamu mau
      working paper tersimpan (supaya bisa diambil ulang tanpa upload PDF
      lagi), tambahkan pemanggilan modules/storage.py setelah langkah 5.
"""

from __future__ import annotations

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from modules import auth
from modules.logging_config import get_module_logger
from modules.kertas_kerja import (
    generate_kertas_kerja,
    tulis_kertas_kerja_excel,
    tentukan_tahun_dari_gl,
    bangun_coa_kertas_kerja_dari_db,
    ringkasan_status_kertas_kerja,
)

# TODO INTEGRASI: sesuaikan import ini dengan modul DB client yang
# sebenarnya dipakai project kamu untuk ambil COA per client.
try:
    from modules import db_client
except ImportError:  # pragma: no cover
    db_client = None

logger = get_module_logger("kertas_kerja_router")

router = APIRouter()


class KertasKerjaRingkasanResponse(BaseModel):
    """Dipakai kalau frontend cuma mau ringkasan dulu (tanpa download
    langsung) -- lihat endpoint /kertas-kerja/preview."""
    tahun: int
    jumlah_transaksi: int
    confidence_count: dict
    status_per_bulan: dict
    jumlah_peringatan: int
    peringatan: List[str]


def _validasi_dan_baca_pdf(files: List[UploadFile]) -> List[tuple]:
    """Validasi ekstensi + baca semua UploadFile ke memory sebagai
    (file_like, nama_file) -- format yang diharapkan
    susun_gl_dari_pdf_rekening_koran(). File non-PDF ditolak lebih awal
    (400) supaya tidak menyamarkan error jadi 'gagal diekstrak' di
    tahap parsing PDF."""
    if not files:
        raise HTTPException(
            status_code=400,
            detail="Tidak ada file PDF rekening koran yang diupload.",
        )

    daftar_file_pdf = []
    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"'{f.filename}' bukan file PDF -- hanya rekening koran PDF yang diterima.",
            )
        isi = f.file.read()
        if not isi:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' kosong (0 byte).")
        daftar_file_pdf.append((io.BytesIO(isi), f.filename))
    return daftar_file_pdf


def _ambil_coa_client(client_id: int):
    """TODO INTEGRASI: sesuaikan dengan cara project kamu menyimpan/ambil
    COA client. Saat ini mengasumsikan modules/db_client.py dengan fungsi
    ambil_coa_client(client_id) -> List[dict] (lihat docstring
    bangun_coa_kertas_kerja_dari_db di kertas_kerja.py untuk skema dict
    yang diharapkan: no_akun/nama_akun/kategori/normal_saldo/keterangan)."""
    if db_client is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Modul db_client belum tersedia/terpasang -- lengkapi import "
                "di modules/kertas_kerja_router.py (_ambil_coa_client) sesuai "
                "modul DB COA client project ini."
            ),
        )
    try:
        daftar_akun_db = db_client.ambil_coa_client(client_id)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Gagal ambil COA client {client_id} dari database: {e}")
        daftar_akun_db = []

    df_coa, peringatan_coa = bangun_coa_kertas_kerja_dari_db(daftar_akun_db)
    if df_coa.empty:
        # [BARU] Tidak lagi menghentikan proses -- kertas kerja tetap
        # digenerate dari PDF, sheet yang butuh COA (BS/PNL/dst) akan
        # kosong sampai COA client diisi.
        peringatan_coa.append(
            "COA client kosong -- kertas kerja tetap digenerate dari PDF, "
            "tapi sheet yang butuh data COA (BS_Monthly/PNL_Monthly/dst) "
            "akan KOSONG sampai COA client diisi."
        )
    return df_coa, peringatan_coa


@router.post("/generate")
def generate(
    client_id: int = Form(...),
    pakai_ai: bool = Form(True),
    pakai_claude_review: bool = Form(False),
    files: List[UploadFile] = File(...),
    user: dict = Depends(auth.get_current_user),
):
    """
    Terima berapapun jumlah file PDF rekening koran (1 s.d. 12 bulan,
    boleh multi-bank -- tidak ada batas jumlah file, lihat catatan di
    susun_gl_dari_pdf_rekening_koran) + client_id, generate working paper
    14-sheet, dan kembalikan file .xlsx langsung sebagai download.

    pakai_claude_review: [BARU] default False (OPSIONAL, hemat kredit).
    Kalau True, baris GL confidence non-High direview lewat Claude API
    (dibatch) sebelum sheet lain disusun -- lihat
    kertas_kerja.perbaiki_gl_dengan_claude_review(). Menambah sheet
    "Status" di file .xlsx hasil kalau ada baris yang direview.

    Ringkasan (jumlah transaksi, peringatan, dst) dikembalikan di header
    response `X-Kertas-Kerja-Ringkasan` (JSON string) supaya frontend bisa
    tampilkan tanpa perlu parse ulang file Excel-nya.
    """
    daftar_file_pdf = _validasi_dan_baca_pdf(files)
    df_coa, peringatan_coa = _ambil_coa_client(client_id)

    try:
        hasil, peringatan = generate_kertas_kerja(
            daftar_file_pdf=daftar_file_pdf,
            df_coa=df_coa,
            client_id=client_id,
            pakai_ai=pakai_ai,
            pakai_claude_review=pakai_claude_review,
            peringatan_awal=peringatan_coa,
        )
    except ValueError as e:
        # Kasus terduga: semua PDF gagal diekstrak (lihat ValueError di
        # generate_kertas_kerja) -- 400, bukan 500, karena ini soal input
        # user (PDF rusak/format tak dikenal), bukan bug server.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Gagal generate kertas kerja untuk client {client_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Gagal generate kertas kerja: {e}"
        )

    tahun, peringatan_tahun = tentukan_tahun_dari_gl(hasil.gl)
    hasil.peringatan.extend(peringatan_tahun)

    ringkasan = ringkasan_status_kertas_kerja(hasil)
    ringkasan["tahun"] = tahun

    xlsx_bytes = tulis_kertas_kerja_excel(hasil, tahun=tahun, identitas=None)

    nama_file = f"Kertas_Kerja_Laporan_Keuangan_{tahun}.xlsx"
    logger.info(
        f"✅ Kertas kerja {tahun} untuk client {client_id} digenerate "
        f"({ringkasan['jumlah_transaksi']} transaksi, "
        f"{ringkasan['jumlah_peringatan']} peringatan)"
    )

    import json as _json

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{nama_file}"',
            "X-Kertas-Kerja-Ringkasan": _json.dumps(ringkasan, default=str),
        },
    )


@router.post("/preview", response_model=KertasKerjaRingkasanResponse)
def preview(
    client_id: int = Form(...),
    pakai_ai: bool = Form(True),
    pakai_claude_review: bool = Form(False),
    files: List[UploadFile] = File(...),
    user: dict = Depends(auth.get_current_user),
):
    """
    Sama seperti /generate, tapi TIDAK menulis file Excel -- cuma
    mengembalikan ringkasan (jumlah transaksi, confidence, status per
    bulan, peringatan) sebagai JSON. Berguna untuk frontend menampilkan
    preview/konfirmasi ke user SEBELUM benar-benar generate & download
    file besar, terutama untuk batch banyak bulan/bank.

    pakai_claude_review: [BARU] sama seperti di /generate -- kalau True,
    ringkasan confidence_count yang dikembalikan sudah mencerminkan hasil
    review Claude (baris yang berhasil diperbaiki dihitung sebagai High),
    bukan hasil klasifikasi mentah.
    """
    daftar_file_pdf = _validasi_dan_baca_pdf(files)
    df_coa, peringatan_coa = _ambil_coa_client(client_id)

    try:
        hasil, peringatan = generate_kertas_kerja(
            daftar_file_pdf=daftar_file_pdf,
            df_coa=df_coa,
            client_id=client_id,
            pakai_ai=pakai_ai,
            pakai_claude_review=pakai_claude_review,
            peringatan_awal=peringatan_coa,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Gagal preview kertas kerja untuk client {client_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal preview kertas kerja: {e}")

    tahun, peringatan_tahun = tentukan_tahun_dari_gl(hasil.gl)
    hasil.peringatan.extend(peringatan_tahun)

    ringkasan = ringkasan_status_kertas_kerja(hasil)
    ringkasan["tahun"] = tahun
    return ringkasan