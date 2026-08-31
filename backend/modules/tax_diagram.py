"""
modules/tax_diagram.py
Menghasilkan diagram alur (format Mermaid) untuk memvisualisasikan proses
atau alur keputusan terkait suatu topik pajak (mis. proses keberatan,
alur restitusi PPN). Versi dasar ini pakai template per topik yang
dikenali; nanti bisa diganti generate dinamis dari hasil RAG
(modules/tax_rag.py) untuk topik yang belum ada templatenya.
"""
from __future__ import annotations

from modules.schemas import DiagramRequest, DiagramResponse

_TEMPLATES = {
    "keberatan": {
        "mermaid": """flowchart TD
    A[SKP diterbitkan] --> B[Wajib Pajak ajukan keberatan ke DJP]
    B --> C{DJP memutuskan dalam 12 bulan}
    C -->|Dikabulkan| D[SKP dikoreksi]
    C -->|Ditolak/Sebagian| E[Wajib Pajak dapat ajukan Banding ke Pengadilan Pajak]
    E --> F{Putusan Pengadilan Pajak}
    F -->|Dikabulkan| G[Selesai, sesuai putusan]
    F -->|Ditolak| H[Dapat ajukan PK ke Mahkamah Agung]""",
        "explanation": "Alur keberatan pajak: dimulai dari SKP, keberatan ke DJP, lalu banding ke "
        "Pengadilan Pajak, dan upaya hukum terakhir Peninjauan Kembali ke MA.",
    },
    "restitusi ppn": {
        "mermaid": """flowchart TD
    A[SPT Masa PPN Lebih Bayar] --> B[Wajib Pajak ajukan restitusi]
    B --> C[DJP lakukan pemeriksaan]
    C --> D{Hasil pemeriksaan}
    D -->|Disetujui| E[SKPLB diterbitkan, dana dikembalikan]
    D -->|Sebagian/Ditolak| F[SKPKB/SKPN diterbitkan]
    F --> G[Wajib Pajak dapat ajukan keberatan]""",
        "explanation": "Alur restitusi PPN: pengajuan restitusi atas lebih bayar, pemeriksaan DJP, "
        "hingga penerbitan SKPLB atau upaya keberatan bila ditolak.",
    },
}

_DEFAULT_TEMPLATE = {
    "mermaid": """flowchart TD
    A[Mulai] --> B[Identifikasi isu pajak]
    B --> C[Kumpulkan dasar hukum & kasus serupa]
    C --> D[Analisis posisi]
    D --> E[Kesimpulan / rekomendasi]""",
    "explanation": "Alur umum riset pajak: identifikasi isu, kumpulkan dasar hukum dan kasus serupa, "
    "analisis, lalu kesimpulan.",
}


def generate_diagram(request: DiagramRequest) -> DiagramResponse:
    key = request.topic.strip().lower()
    template = _TEMPLATES.get(key, _DEFAULT_TEMPLATE)
    explanation = template["explanation"]
    if request.question:
        explanation += f" (konteks pertanyaan: {request.question})"

    return DiagramResponse(
        topic=request.topic,
        mermaid_code=template["mermaid"],
        explanation=explanation,
    )


def available_topics() -> list[str]:
    return list(_TEMPLATES.keys())