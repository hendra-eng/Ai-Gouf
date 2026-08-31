"""
modules/charts.py
==================
Dashboard visual (grafik) untuk AI Gouf Consulting, memakai Plotly.

Semua fungsi di sini murni: menerima DataFrame, mengembalikan objek
`plotly.graph_objects.Figure` (atau None kalau data tidak cukup). Rendering
ke Streamlit (st.plotly_chart) dilakukan di app.py, supaya modul ini tetap
bisa diuji tanpa Streamlit.
"""

from __future__ import annotations

from typing import Optional

import pandas as pd

try:
    import plotly.express as px
    import plotly.graph_objects as go
except ImportError:
    px = None
    go = None

from .logging_config import get_module_logger

logger = get_module_logger("charts")


def _plotly_tersedia() -> bool:
    if px is None or go is None:
        logger.warning("plotly belum terinstall - grafik dinonaktifkan. "
                        "Jalankan: pip install plotly --break-system-packages")
        return False
    return True


def chart_tren_transaksi_harian(df: pd.DataFrame) -> Optional["go.Figure"]:
    """Line chart: total debet & kredit per tanggal."""
    if not _plotly_tersedia() or df is None or df.empty or "tanggal" not in df.columns:
        return None

    d = df.copy()
    d["tanggal"] = pd.to_datetime(d["tanggal"], errors="coerce")
    d = d.dropna(subset=["tanggal"])
    if d.empty:
        return None

    agg = {}
    if "jml_debet" in d.columns:
        agg["Debet"] = "jml_debet"
    if "jml_kredit" in d.columns:
        agg["Kredit"] = "jml_kredit"
    if not agg:
        return None

    harian = d.groupby(d["tanggal"].dt.date).agg(
        **{label: (col, "sum") for label, col in agg.items()}
    ).reset_index().rename(columns={"tanggal": "Tanggal"})

    fig = go.Figure()
    for label in agg:
        fig.add_trace(go.Scatter(x=harian["Tanggal"], y=harian[label], mode="lines+markers", name=label))
    fig.update_layout(title="Tren Transaksi Harian", xaxis_title="Tanggal", yaxis_title="Nominal (Rp)",
                       hovermode="x unified", legend_title_text="")
    return fig


def chart_distribusi_akun(df: pd.DataFrame, kolom_akun: str = "nama_akun_debet") -> Optional["go.Figure"]:
    """Pie chart: distribusi jumlah transaksi per akun (debet by default)."""
    if not _plotly_tersedia() or df is None or df.empty or kolom_akun not in df.columns:
        return None

    counts = df[kolom_akun].fillna("Belum terkategori").value_counts().head(12)
    if counts.empty:
        return None

    fig = px.pie(values=counts.values, names=counts.index, title="Distribusi Transaksi per Akun (Top 12)")
    fig.update_traces(textposition="inside", textinfo="percent+label")
    return fig


def chart_perbandingan_bank(df: pd.DataFrame) -> Optional["go.Figure"]:
    """Bar chart: total nominal per bank."""
    if not _plotly_tersedia() or df is None or df.empty or "bank" not in df.columns:
        return None

    kolom_nominal = "jml_debet" if "jml_debet" in df.columns else None
    if kolom_nominal is None:
        return None

    per_bank = df.groupby("bank")[kolom_nominal].sum().reset_index().sort_values(kolom_nominal, ascending=False)
    if per_bank.empty:
        return None

    fig = px.bar(per_bank, x="bank", y=kolom_nominal, title="Total Nominal per Bank",
                 labels={"bank": "Bank", kolom_nominal: "Total Nominal (Rp)"})
    return fig


def chart_arus_kas_kumulatif(df: pd.DataFrame) -> Optional["go.Figure"]:
    """Area chart: arus kas kumulatif (debet - kredit) berjalan sepanjang waktu."""
    if not _plotly_tersedia() or df is None or df.empty or "tanggal" not in df.columns:
        return None

    d = df.copy()
    d["tanggal"] = pd.to_datetime(d["tanggal"], errors="coerce")
    d = d.dropna(subset=["tanggal"]).sort_values("tanggal")
    if d.empty:
        return None

    debet = d["jml_debet"] if "jml_debet" in d.columns else 0
    kredit = d["jml_kredit"] if "jml_kredit" in d.columns else 0
    d["arus_bersih"] = (debet.fillna(0) if hasattr(debet, "fillna") else debet) - \
                        (kredit.fillna(0) if hasattr(kredit, "fillna") else kredit)
    d["kumulatif"] = d["arus_bersih"].cumsum()

    fig = go.Figure()
    fig.add_trace(go.Scatter(x=d["tanggal"], y=d["kumulatif"], mode="lines", fill="tozeroy", name="Arus Kas Kumulatif"))
    fig.update_layout(title="Arus Kas Kumulatif", xaxis_title="Tanggal", yaxis_title="Rp")
    return fig


def chart_status_kategorisasi(df: pd.DataFrame) -> Optional["go.Figure"]:
    """Donut chart: proporsi transaksi Sesuai Pola vs AI vs Belum Terkategori."""
    if not _plotly_tersedia() or df is None or df.empty or "sumber_kategori" not in df.columns:
        return None

    counts = df["sumber_kategori"].fillna("Tidak diketahui").value_counts()
    if counts.empty:
        return None

    fig = px.pie(values=counts.values, names=counts.index, hole=0.45,
                 title="Status Kategorisasi Transaksi")
    fig.update_traces(textinfo="percent+label")
    return fig


def buat_semua_chart(df_bank: Optional[pd.DataFrame]) -> dict:
    """
    Buat semua chart dashboard sekaligus dari df_bank (hasil rekening koran).
    Return dict {nama_chart: Figure|None} supaya app.py tinggal render yang ada isinya.
    """
    return {
        "tren_harian": chart_tren_transaksi_harian(df_bank),
        "distribusi_akun": chart_distribusi_akun(df_bank),
        "perbandingan_bank": chart_perbandingan_bank(df_bank),
        "arus_kas": chart_arus_kas_kumulatif(df_bank),
        "status_kategorisasi": chart_status_kategorisasi(df_bank),
    }