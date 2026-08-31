"""
modules/export.py
==================
Multi-format export (Excel, CSV, JSON, PDF)

[CATATAN STATUS -- PENTING] Modul ini SAAT INI TIDAK di-import dari
main.py (cek `from modules import (...)` di main.py -- 'export' tidak
ada di daftar itu) dan tidak dipanggil dari endpoint mana pun. Jalur
export yang BENAR-BENAR dipakai produksi ada di modul lain:
  - accounting_export.py -- xlsx (openpyxl)
  - calk_export.py       -- docx (python-docx) + PDF (convert via
                             LibreOffice headless/soffice)
  - kertas_kerja.py       -- xlsx (openpyxl)

Modul ini dibiarkan ada sbg utility generik/serbaguna (mis. utk dipakai
manual dari script/notebook, atau kalau nanti ada kebutuhan export
DataFrame ad-hoc di luar 3 jalur di atas), BUKAN "mati" karena bug --
semua kesalahan di bawah sudah diperbaiki supaya modul ini aman dipakai
kapan pun dibutuhkan, tanpa jadi jebakan kalau suatu saat ada yang mulai
memanggilnya tanpa sadar statusnya belum terhubung ke endpoint mana pun.
"""

import io
import json
import pandas as pd
from pathlib import Path
from typing import Dict, Any, Optional, List, Union
from datetime import datetime

try:
    from fpdf import FPDF
except ImportError:
    FPDF = None

from .logging_config import get_module_logger

logger = get_module_logger("export")

# [FIX -- BUG NYATA: CRASH PDF UTK TEKS NON-LATIN1] `fpdf` (bukan fpdf2)
# pakai font bawaan "Arial"/Helvetica yang HANYA mendukung encoding
# Latin-1 -- baris `pdf.output(dest='S').encode('latin1')` akan melempar
# UnicodeEncodeError kalau ada 1 saja karakter di luar Latin-1 (dash
# panjang "–"/"—", kutip pintar "'"/"'"/"""/""", elipsis "…", bullet "•",
# non-breaking space, dll) -- SANGAT umum muncul di teks yang di-copy
# dari Word/laporan Indonesia. Sebelumnya TIDAK ADA sanitasi sama sekali
# sebelum di-encode, jadi export PDF bisa gagal total di tengah proses
# hanya gara-gara 1 karakter "aneh" di 1 sel data, tanpa pesan error yang
# jelas ke pemanggil (exception ketangkep di except Exception generik,
# cuma dicatat log lalu return None -- pemanggil cuma tahu "PDF gagal",
# tidak tahu kenapa).
#
# Fix: normalisasi teks dulu (translate padanan ASCII utk tanda baca
# umum) SEBELUM di-encode, supaya kasus paling sering (tanda baca pintar
# dari Word) tidak bikin gagal sama sekali. Untuk karakter yang TETAP
# tidak bisa direpresentasikan di Latin-1 setelah itu (mis. huruf non-
# Latin macam Kanji/Arab/Cyrillic), diganti '?' (errors="replace") --
# TIDAK melempar exception, PDF tetap ke-generate (mendingan tampil '?'
# di 1-2 karakter daripada export gagal total).
_PADANAN_ASCII_UNTUK_PDF = {
    "\u2018": "'", "\u2019": "'",   # kutip tunggal pintar ‘ ’
    "\u201c": '"', "\u201d": '"',   # kutip ganda pintar “ ”
    "\u2013": "-", "\u2014": "-",   # en dash – / em dash —
    "\u2026": "...",                 # elipsis …
    "\u2022": "-",                   # bullet •
    "\u00a0": " ",                   # non-breaking space
}


def _sanitasi_teks_untuk_pdf(teks: Any) -> str:
    """[FIX -- BUG NYATA] Siapkan string apa pun (termasuk non-str, mis.
    angka/Timestamp dari sel DataFrame) supaya AMAN di-encode ke Latin-1
    oleh fpdf, TANPA PERNAH melempar exception -- lihat catatan lengkap
    di atas modul. Dipanggil untuk SEMUA teks yang masuk ke PDF (title,
    header kolom, isi sel), bukan cuma sebagian, supaya konsisten."""
    s = str(teks)
    for asli, pengganti in _PADANAN_ASCII_UNTUK_PDF.items():
        s = s.replace(asli, pengganti)
    # Karakter non-Latin1 yang TERSISA (bukan tanda baca umum di atas) --
    # diganti '?' lewat errors="replace", bukan dibiarkan melempar
    # UnicodeEncodeError. encode->decode balik supaya hasil akhirnya
    # tetap objek `str` biasa (fpdf yang akan encode ulang ke latin1 saat
    # render, jadi di sini cukup pastikan isinya representable).
    return s.encode("latin-1", errors="replace").decode("latin-1")


class ExportManager:
    """Manager untuk export data dalam berbagai format"""
    
    def __init__(self):
        self.supported_formats = ["excel", "csv", "json", "pdf", "html"]
    
    def export(
        self,
        df: pd.DataFrame,
        format_type: str = "excel",
        filename: Optional[str] = None,
        **kwargs
    ) -> Union[bytes, str, Dict]:
        """
        Export DataFrame ke berbagai format
        
        Args:
            df: DataFrame yang diexport
            format_type: "excel", "csv", "json", "pdf", "html"
            filename: Nama file (optional)
            **kwargs: Argumen tambahan untuk masing-masing format
        
        Returns:
            Bytes atau string dari file yang diexport
        """
        if df is None or df.empty:
            logger.warning("DataFrame kosong, tidak bisa export")
            return None
        
        format_type = format_type.lower()
        
        if format_type == "excel":
            return self._export_excel(df, **kwargs)
        elif format_type == "csv":
            return self._export_csv(df, **kwargs)
        elif format_type == "json":
            return self._export_json(df, **kwargs)
        elif format_type == "pdf":
            return self._export_pdf(df, **kwargs)
        elif format_type == "html":
            return self._export_html(df, **kwargs)
        else:
            raise ValueError(f"Format tidak didukung: {format_type}")
    
    def _export_excel(self, df: pd.DataFrame, **kwargs) -> bytes:
        """Export ke Excel dengan multiple sheets"""
        buffer = io.BytesIO()
        sheet_name = kwargs.get("sheet_name", "Sheet1")
        
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name=sheet_name[:31], index=kwargs.get("index", False))
            
            # Tambahan sheet untuk summary jika diminta
            if kwargs.get("include_summary", False):
                summary = self._create_summary(df)
                summary.to_excel(writer, sheet_name="Summary", index=False)
        
        buffer.seek(0)
        logger.info(f"✅ Excel exported: {len(df)} rows")
        return buffer.getvalue()
    
    def _export_csv(self, df: pd.DataFrame, **kwargs) -> str:
        """Export ke CSV"""
        separator = kwargs.get("sep", ",")
        result = df.to_csv(sep=separator, index=kwargs.get("index", False))
        logger.info(f"✅ CSV exported: {len(df)} rows")
        return result
    
    def _export_json(self, df: pd.DataFrame, **kwargs) -> Dict:
        """Export ke JSON"""
        orient = kwargs.get("orient", "records")
        result = json.loads(df.to_json(orient=orient, date_format="iso"))
        logger.info(f"✅ JSON exported: {len(df)} rows")
        return result
    
    def _export_pdf(self, df: pd.DataFrame, **kwargs) -> Optional[bytes]:
        """Export ke PDF"""
        if FPDF is None:
            logger.warning("fpdf not installed, PDF export disabled")
            return None
        
        try:
            pdf = FPDF()
            pdf.add_page()
            
            # Set font
            pdf.set_font("Arial", size=8)
            
            # Header
            # [FIX] Sanitasi title -- lihat _sanitasi_teks_untuk_pdf().
            title = _sanitasi_teks_untuk_pdf(kwargs.get("title", "Laporan Jurnal"))
            pdf.set_font("Arial", style="B", size=14)
            pdf.cell(200, 10, title, ln=True, align="C")
            pdf.ln(5)
            
            # Column headers
            pdf.set_font("Arial", style="B", size=8)
            cols = kwargs.get("columns", df.columns.tolist())
            col_widths = self._calculate_col_widths(df, cols, kwargs.get("max_width", 40))
            
            for col in cols:
                # [FIX] Sanitasi nama kolom juga -- header sama rentannya
                # thd karakter non-Latin1 (mis. nama kolom "Selisih (–)").
                pdf.cell(col_widths[col], 8, _sanitasi_teks_untuk_pdf(col), border=1)
            pdf.ln()
            
            # Data rows
            pdf.set_font("Arial", size=7)
            max_rows = kwargs.get("max_rows", 50)
            
            for _, row in df.head(max_rows).iterrows():
                for col in cols:
                    # [FIX] Sanitasi SEBELUM dipotong 50 karakter -- urutan
                    # ini penting: kalau dipotong dulu baru disanitasi,
                    # panjang tampilan akhir bisa beda2 tergantung berapa
                    # karakter pengganti multi-huruf ("..." dari "…") yang
                    # kena potong di titik itu. Sanitasi dulu, baru potong,
                    # supaya hasil akhirnya konsisten & dapat diprediksi.
                    val = _sanitasi_teks_untuk_pdf(row.get(col, ""))[:50]
                    pdf.cell(col_widths[col], 7, val, border=1)
                pdf.ln()
            
            if len(df) > max_rows:
                pdf.cell(200, 7, f"... dan {len(df) - max_rows} baris lainnya", ln=True)
            
            # Footer
            pdf.set_y(-15)
            pdf.set_font("Arial", size=6)
            pdf.cell(200, 10, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", align="C")
            
            # [FIX] .encode('latin1') sekarang AMAN -- semua teks yang
            # masuk ke pdf.cell() di atas sudah lewat _sanitasi_teks_untuk_pdf(),
            # jadi tidak ada lagi karakter yang bisa bikin encode ini gagal.
            return pdf.output(dest='S').encode('latin1')
            
        except Exception as e:
            logger.error(f"❌ PDF export failed ({type(e).__name__}): {e}")
            return None
    
    def _export_html(self, df: pd.DataFrame, **kwargs) -> str:
        """Export ke HTML"""
        html = df.to_html(
            classes=kwargs.get("classes", "table table-striped"),
            index=kwargs.get("index", False),
            border=0,
        )
        logger.info(f"✅ HTML exported: {len(df)} rows")
        return html
    
    def _create_summary(self, df: pd.DataFrame) -> pd.DataFrame:
        """Buat summary DataFrame"""
        summary = {}
        
        if "jml_debet" in df.columns:
            summary["Total Debet"] = [df["jml_debet"].sum()]
        if "jml_kredit" in df.columns:
            summary["Total Kredit"] = [df["jml_kredit"].sum()]
        
        if "sumber_kategori" in df.columns:
            summary["Sumber Kategori"] = [df["sumber_kategori"].value_counts().to_dict()]
        
        summary["Total Baris"] = [len(df)]
        summary["Tanggal Export"] = [datetime.now().strftime("%Y-%m-%d %H:%M")]
        
        return pd.DataFrame([summary])
    
    def _calculate_col_widths(self, df: pd.DataFrame, cols: List[str], max_width: int = 40) -> Dict:
        """Hitung lebar kolom untuk PDF.

        [FIX -- BUG NYATA] Kalau `df` punya NAMA KOLOM DUPLIKAT (jarang
        tapi mungkin terjadi, mis. hasil join/concat yang belum
        dibersihkan), `df[col]` mengembalikan DataFrame (bukan Series) --
        `.str` accessor CUMA ada di Series, jadi `.astype(str).str.len()`
        melempar AttributeError & fungsi ini crash total, menggagalkan
        SELURUH export PDF cuma gara-gara 1 kolom duplikat. Dibungkus
        try/except per-kolom: kalau gagal hitung lebar berdasar isi data,
        fallback ke lebar berdasar panjang nama header saja (tetap
        menghasilkan PDF yang valid, cuma lebar kolom itu kurang optimal,
        bukan gagal total)."""
        widths = {}
        for col in cols:
            header_len = len(str(col))
            max_len = header_len
            if col in df.columns:
                try:
                    nilai = df[col].astype(str).str.len().max()
                    if nilai is not None:
                        max_len = max(header_len, int(nilai))
                except (AttributeError, TypeError) as e:
                    logger.warning(
                        f"⚠️ Gagal hitung lebar kolom '{col}' dari isi data "
                        f"({type(e).__name__}: {e}) -- kemungkinan nama kolom "
                        "duplikat di DataFrame. Fallback ke lebar header saja."
                    )
            width = min(max_len + 2, max_width)
            widths[col] = width * 0.9  # Konversi ke mm
        return widths


# Convenience functions
def export_jurnal(
    df: pd.DataFrame,
    format_type: str = "excel",
    filename: Optional[str] = None,
    **kwargs
) -> Union[bytes, str, Dict, None]:
    """
    Export jurnal dengan format yang dipilih
    
    Args:
        df: DataFrame jurnal
        format_type: "excel", "csv", "json", "pdf", "html"
        filename: Nama file (optional)
        **kwargs: Argumen tambahan
    
    Returns:
        Data yang diexport
    """
    manager = ExportManager()
    return manager.export(df, format_type, filename, **kwargs)


def export_to_excel(df: pd.DataFrame, **kwargs) -> bytes:
    """Export ke Excel"""
    return export_jurnal(df, "excel", **kwargs)


def export_to_csv(df: pd.DataFrame, **kwargs) -> str:
    """Export ke CSV"""
    return export_jurnal(df, "csv", **kwargs)


def export_to_json(df: pd.DataFrame, **kwargs) -> Dict:
    """Export ke JSON"""
    return export_jurnal(df, "json", **kwargs)


def export_to_pdf(df: pd.DataFrame, **kwargs) -> Optional[bytes]:
    """Export ke PDF"""
    return export_jurnal(df, "pdf", **kwargs)


def export_to_html(df: pd.DataFrame, **kwargs) -> str:
    """Export ke HTML"""
    return export_jurnal(df, "html", **kwargs)


def export_all_formats(df: pd.DataFrame, base_filename: str = "export") -> Dict[str, Union[bytes, str]]:
    """
    Export ke semua format sekaligus -- BEST EFFORT per format (lihat
    catatan FIX di bawah).

    Args:
        df: DataFrame yang diexport
        base_filename: Nama dasar file
    
    Returns:
        Dict dengan hasil export yang BERHASIL saja -- format yang gagal
        tidak muncul sbg key di dict ini (bukan exception yang harus
        ditangkap caller). Cek `len(results) < 5` kalau perlu tahu ada
        yang gagal.

    [FIX -- BUG NYATA] Sebelumnya SEMUA format dibungkus 1 try/except
    BESAR -- kalau format PERTAMA yang gagal (mis. "excel") melempar
    exception, SELURUH proses berhenti di situ: csv/json/pdf/html yang
    harusnya independen (tidak saling bergantung) ikut TIDAK PERNAH
    dicoba sama sekali, padahal semuanya bisa saja berhasil kalau dicoba
    sendiri-sendiri. Fix: tiap format dibungkus try/except SENDIRI --
    1 format gagal cuma bikin format itu absen dari hasil, format
    lainnya tetap jalan & dikembalikan seperti biasa ("best effort",
    bukan "all or nothing").
    """
    results: Dict[str, Union[bytes, str, Dict]] = {}

    def _coba(nama_format: str, fungsi) -> None:
        try:
            hasil = fungsi()
            if hasil is not None:
                results[nama_format] = hasil
        except Exception as e:  # noqa: BLE001 -- 1 format gagal tidak boleh menghentikan format lain
            logger.error(f"❌ Export format '{nama_format}' gagal ({type(e).__name__}): {e}")

    _coba("excel", lambda: export_to_excel(df, sheet_name=base_filename[:31]))
    _coba("csv", lambda: export_to_csv(df))
    _coba("json", lambda: export_to_json(df))
    _coba("pdf", lambda: export_to_pdf(df, title=base_filename))
    _coba("html", lambda: export_to_html(df))

    if len(results) < 5:
        logger.warning(f"⚠️ Sebagian format gagal -- {len(results)}/5 format berhasil diexport.")
    else:
        logger.info(f"✅ All formats exported: {len(results)} formats")

    return results