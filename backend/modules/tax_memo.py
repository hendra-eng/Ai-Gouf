"""
modules/tax_memo.py
Menyusun memo riset pajak otomatis (format markdown) dari hasil tanya-jawab
+ sitasi, siap ditinjau/diedit staf sebelum dikirim ke klien atau
dijadikan dasar posisi resmi.
"""
from __future__ import annotations

from datetime import datetime

from modules.schemas import MemoRequest, MemoResponse
from modules.citation import build_bibliography, validate_citations


def generate_memo(request: MemoRequest) -> MemoResponse:
    bibliography = build_bibliography(request.citations)
    warnings = validate_citations(request.citations)

    title = f"Memo Riset Pajak - {request.question[:60].strip()}"
    if len(request.question) > 60:
        title += "..."

    lines = [f"# {title}", "", f"**Tanggal:** {datetime.utcnow().strftime('%d %B %Y')}"]
    if request.author:
        lines.append(f"**Disusun oleh:** {request.author}")
    if request.client_id:
        lines.append(f"**Klien:** {request.client_id}")

    lines += ["", "## Pertanyaan", request.question, "", "## Analisis / Jawaban", request.answer]

    if warnings:
        lines += ["", "## Perhatian"] + [f"- {w}" for w in warnings]

    if bibliography:
        lines += ["", "## Daftar Sumber"] + [f"{i + 1}. {b}" for i, b in enumerate(bibliography)]

    lines += [
        "",
        "---",
        "*Memo ini dihasilkan otomatis dan perlu ditinjau oleh staf berwenang "
        "sebelum digunakan sebagai dasar posisi resmi ke klien atau otoritas pajak.*",
    ]

    return MemoResponse(title=title, body_markdown="\n".join(lines))