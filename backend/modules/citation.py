"""
modules/citation.py
Validasi & format sitasi, cek status sumber (berlaku/dicabut/diubah).
"""
from __future__ import annotations

from typing import List

from modules.schemas import CitedChunk, RegulationStatus


def format_citation(cited: CitedChunk) -> str:
    doc = cited.document
    if doc is None:
        return f"[Sumber tidak diketahui] (skor {cited.score:.2f})"

    label = f"{doc.doc_type.value} No. {doc.nomor or '-'}"
    if doc.tahun:
        label += f" Tahun {doc.tahun}"
    label += f" - {doc.title}"

    # Pakai status yang menempel di dokumen itu sendiri (doc.status), bukan
    # tracker terpisah -- doc.status sudah mencerminkan status terkini kalau
    # dokumen di-update lewat modules.tax_ingestion.update_status() (fungsi
    # itu memperbarui keduanya: record dokumen DAN tracker). Membaca
    # langsung dari objek yang sedang dikutip lebih tepercaya karena tidak
    # bergantung pada state global lain yang harus disinkronkan manual.
    status = doc.status
    if status == RegulationStatus.DICABUT:
        label += " [DICABUT - hati-hati, kemungkinan sudah tidak berlaku]"
    elif status == RegulationStatus.DIUBAH:
        label += " [DIUBAH - periksa versi/peraturan perubahannya]"

    return label


def validate_citations(cited_chunks: List[CitedChunk]) -> List[str]:
    """Kembalikan daftar peringatan (mis. sumber dicabut) untuk ditampilkan ke user."""
    warnings: List[str] = []
    for cited in cited_chunks:
        if cited.document is None:
            continue
        status = cited.document.status
        if status == RegulationStatus.DICABUT:
            warnings.append(
                f"Perhatian: '{cited.document.title}' sudah DICABUT dan mungkin tidak lagi berlaku."
            )
        elif status == RegulationStatus.DIUBAH:
            warnings.append(
                f"Perhatian: '{cited.document.title}' telah DIUBAH sebagian - periksa peraturan perubahannya."
            )
    return warnings


def build_bibliography(cited_chunks: List[CitedChunk]) -> List[str]:
    seen = set()
    bibliography: List[str] = []
    for cited in cited_chunks:
        label = format_citation(cited)
        if label not in seen:
            seen.add(label)
            bibliography.append(label)
    return bibliography