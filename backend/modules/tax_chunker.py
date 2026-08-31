"""
tax_chunker.py

Dasar: memecah dokumen peraturan pajak (UU, PMK, PER, SE, putusan) jadi
potongan teks (chunk) kecil yang siap di-embed dan disimpan ke vector store.

[FIX Tahap 2.2] Sebelumnya chunk_document() cuma potong teks per N karakter
dengan overlap -- gampang motong DI TENGAH kalimat atau bahkan di tengah
"Pasal 4 ayat (2)", sehingga chunk yang dikutip AI bisa menyesatkan (mis.
kata "tidak" di ayat sebelumnya kepotong, jadi maknanya kebalik).

Sekarang chunking coba mengenali struktur "Pasal N" (heading yang berdiri
sendiri di satu baris -- BUKAN referensi silang di tengah kalimat seperti
"...sebagaimana dimaksud dalam Pasal 4 ayat (2)") lalu memecah tiap pasal
per ayat kalau masih kepanjangan. Tiap chunk sekarang punya field `pasal`
terisi (mis. "Pasal 4 ayat (2)") -- dipakai untuk sitasi yang presisi ke
akuntan, bukan cuma "potongan teks entah dari mana".

Kalau suatu bagian dokumen TIDAK punya struktur pasal/ayat yang bisa
dideteksi (mis. SE/Pengumuman berformat bebas, atau bagian
Menimbang/Mengingat sebelum Pasal 1), otomatis fallback ke cara lama
(potong-per-karakter + overlap) HANYA untuk bagian itu, supaya tidak ada
teks yang hilang.

TODO nanti (versi serius lanjutan):
- Deteksi otomatis status peraturan (masih berlaku / dicabut / diubah)
- Deduplikasi chunk antar versi dokumen yang mirip
- Deteksi struktur "BAB"/"Bagian" untuk konteks tambahan di atas Pasal
"""

import re
import uuid
from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass
class RegulationMetadata:
    """Metadata yang menempel di setiap dokumen peraturan."""
    nomor: str                     # contoh: "PMK 168/2023"
    jenis: str                     # "UU" | "PMK" | "PER" | "SE" | "Putusan"
    judul: str
    tanggal_berlaku: Optional[str] = None
    status: str = "berlaku"        # "berlaku" | "dicabut" | "diubah"
    sumber_url: Optional[str] = None
    # Dua field ini dipakai modules/tax_case_ingestion.py (case_id) dan
    # modules/tax_ingestion.py (document_id) untuk menaut tiap chunk balik
    # ke kasus/dokumen asalnya.
    case_id: Optional[str] = None
    document_id: Optional[str] = None


@dataclass
class Chunk:
    id: str
    text: str
    metadata: RegulationMetadata
    pasal: Optional[str] = None    # referensi pasal/ayat jika ada
    chunk_index: int = 0


# "Pasal 4" atau "Pasal 18A" yang BERDIRI SENDIRI di satu baris (format
# baku dokumen peraturan Indonesia) -- bukan disebut di tengah kalimat.
_PASAL_HEADING_RE = re.compile(r"^[ \t]*Pasal\s+(\d+[A-Za-z]?)[ \t]*$", re.MULTILINE)

# "(1)", "(2)", "(2a)" dst di awal baris -- penanda ayat baku.
_AYAT_RE = re.compile(r"^[ \t]*\((\d+[a-zA-Z]?)\)", re.MULTILINE)


def chunk_document(
    text: str,
    metadata: RegulationMetadata,
    max_chars: int = 1000,
    overlap: int = 150,
) -> list[Chunk]:
    """
    Pecah dokumen jadi chunk, sadar struktur Pasal/ayat kalau ada.
    Fallback ke potong-per-karakter untuk bagian yang tidak berstruktur.
    """
    chunks: List[Chunk] = []
    index = 0

    for pasal_no, pasal_text in _split_by_pasal(text):
        pasal_text = pasal_text.strip()
        if not pasal_text:
            continue

        if len(pasal_text) <= max_chars:
            chunks.append(
                Chunk(
                    id=str(uuid.uuid4()),
                    text=pasal_text,
                    metadata=metadata,
                    pasal=_format_pasal_label(pasal_no, None),
                    chunk_index=index,
                )
            )
            index += 1
            continue

        # Pasal kepanjangan -- coba pecah per ayat dulu.
        ayat_parts = _split_pasal_by_ayat(pasal_text)
        if ayat_parts is None:
            # Tidak ada penanda ayat terdeteksi -- fallback potong-per-
            # karakter, tapi label pasal-nya tetap tercatat di tiap chunk.
            for piece in _split_fixed(pasal_text, max_chars, overlap):
                chunks.append(
                    Chunk(
                        id=str(uuid.uuid4()),
                        text=piece,
                        metadata=metadata,
                        pasal=_format_pasal_label(pasal_no, None),
                        chunk_index=index,
                    )
                )
                index += 1
            continue

        for ayat_no, ayat_text in ayat_parts:
            ayat_text = ayat_text.strip()
            if not ayat_text:
                continue
            if len(ayat_text) <= max_chars:
                chunks.append(
                    Chunk(
                        id=str(uuid.uuid4()),
                        text=ayat_text,
                        metadata=metadata,
                        pasal=_format_pasal_label(pasal_no, ayat_no),
                        chunk_index=index,
                    )
                )
                index += 1
            else:
                # Satu ayat sendiri masih kepanjangan (jarang, tapi bisa
                # terjadi) -- fallback potong-per-karakter DI DALAM ayat
                # ini saja, supaya label pasal+ayat tetap presisi.
                for piece in _split_fixed(ayat_text, max_chars, overlap):
                    chunks.append(
                        Chunk(
                            id=str(uuid.uuid4()),
                            text=piece,
                            metadata=metadata,
                            pasal=_format_pasal_label(pasal_no, ayat_no),
                            chunk_index=index,
                        )
                    )
                    index += 1

    return chunks


def _split_by_pasal(text: str) -> List[Tuple[Optional[str], str]]:
    """
    Potong teks jadi blok per Pasal berdasarkan heading "Pasal N" yang
    berdiri sendiri di satu baris. Kalau tidak ada heading Pasal sama
    sekali (mis. dokumen SE/Pengumuman tanpa struktur pasal), kembalikan
    seluruh teks sebagai satu blok (pasal_no=None) supaya tetap ter-chunk
    lewat jalur fallback.
    """
    matches = list(_PASAL_HEADING_RE.finditer(text))
    if not matches:
        return [(None, text)]

    blocks: List[Tuple[Optional[str], str]] = []

    # Teks sebelum "Pasal 1" (mis. bagian Menimbang/Mengingat/Menetapkan)
    # -- tetap disimpan sebagai blok tersendiri, bukan dibuang.
    if matches[0].start() > 0:
        pembuka = text[: matches[0].start()].strip()
        if pembuka:
            blocks.append((None, pembuka))

    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        nomor = m.group(1)
        blocks.append((nomor, text[start:end]))

    return blocks


def _split_pasal_by_ayat(pasal_text: str) -> Optional[List[Tuple[Optional[str], str]]]:
    """
    Pecah satu blok pasal jadi per-ayat berdasarkan penanda "(1)", "(2)",
    dst di awal baris. Return None kalau tidak ada penanda ayat terdeteksi
    (caller lalu fallback ke potong-per-karakter untuk blok ini).
    """
    matches = list(_AYAT_RE.finditer(pasal_text))
    if not matches:
        return None

    parts: List[Tuple[Optional[str], str]] = []

    # Buang baris heading "Pasal N" dari kepala -- kalau setelah dibuang
    # nggak ada sisa teks substantif, jangan bikin chunk kosong yang cuma
    # berisi judul pasal doang tanpa isi.
    kepala_raw = pasal_text[: matches[0].start()]
    kepala = _PASAL_HEADING_RE.sub("", kepala_raw).strip()
    if kepala:
        parts.append((None, kepala))

    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(pasal_text)
        ayat_no = m.group(1)
        parts.append((ayat_no, pasal_text[start:end]))

    return parts


def _split_fixed(text: str, max_chars: int, overlap: int) -> List[str]:
    """Fallback lama: potong-per-N-karakter dengan overlap sederhana --
    dipakai HANYA untuk bagian teks yang tidak punya struktur pasal/ayat
    yang bisa dideteksi, atau yang masih kepanjangan setelah dipecah
    per-ayat."""
    pieces: List[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        start += max_chars - overlap
    return pieces


def _format_pasal_label(pasal_no: Optional[str], ayat_no: Optional[str]) -> Optional[str]:
    if pasal_no is None:
        return None
    label = f"Pasal {pasal_no}"
    if ayat_no is not None:
        label += f" ayat ({ayat_no})"
    return label