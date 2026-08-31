"""
modules/embedding.py
Model embedding untuk RAG.

[FIX Tahap 2.1] Sebelumnya versi standar memakai hashing-based bag-of-words
(HashingEmbeddingBackend di bawah) -- deterministik dan tanpa internet, tapi
TIDAK PAHAM MAKNA KALIMAT, cuma cocok kata literal (mis. "PPh 21" dan
"Pajak Penghasilan Pasal 21" dianggap TIDAK mirip walau maknanya sama).
Ini fatal buat RAG begitu jumlah dokumen mulai ribuan.

Sekarang default-nya BAAI/bge-m3 (self-hosted lewat sentence-transformers):
- Paham makna kalimat sungguhan, multilingual (termasuk Indonesia)
- Data klien & isi dokumen pajak TIDAK PERNAH keluar dari server sendiri
  (beda dengan API embedding pihak ketiga) -- penting untuk data keuangan
  klien firma akuntansi
- Gratis per panggilan (vs API yang biayanya numpuk seiring volume
  ribuan dokumen + tanya-jawab harian akuntan)
- Model didownload sekali (~2.2GB) lalu di-cache lokal, setelahnya jalan
  offline

Perlu: pip install sentence-transformers

Kalau nanti butuh kualitas lebih tinggi dan mau bayar per panggilan, upgrade
gampang: buat class baru mewarisi EmbeddingBackend (mis. VoyageEmbeddingBackend
pakai model voyage-law-2 yang dikhususkan teks hukum) lalu ganti di
get_embedding_backend() -- kode pemanggil (tax_rag.py, tax_ingestion.py, dst)
tidak perlu berubah sama sekali.

[PENTING] EMBEDDING_DIM berubah dari 512 (hashing) ke 1024 (BGE-M3) --
kalau sebelumnya ini sempat dipakai untuk ingest data sungguhan pakai
backend lama, WAJIB reindex_document()/reindex_case() ulang semuanya
(lihat modules/tax_ingestion.py, modules/tax_case_ingestion.py) karena
vector lama (512 dim, ruang vektor beda) tidak kompatibel/tidak
bisa dibandingkan dengan vector baru (1024 dim).
"""
from __future__ import annotations

import hashlib
import os
import re
from typing import List, Optional

import numpy as np

EMBEDDING_DIM = 512  # dipertahankan untuk HashingEmbeddingBackend (fallback/test)
_TOKEN_RE = re.compile(r"[a-zA-Z0-9]+")

# Env var buat pilih backend tanpa ubah kode -- default "bge_m3" (produksi),
# bisa di-set "hashing" untuk unit test cepat tanpa download model besar.
_BACKEND_ENV_VAR = "TAX_EMBEDDING_BACKEND"


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(text.lower())


def _hash_token(token: str, dim: int = EMBEDDING_DIM) -> int:
    h = hashlib.md5(token.encode("utf-8")).hexdigest()
    return int(h, 16) % dim


class EmbeddingBackend:
    """Interface embedding. Buat subclass baru untuk pakai API sungguhan."""

    dim: int = EMBEDDING_DIM

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        raise NotImplementedError

    def embed_text(self, text: str) -> np.ndarray:
        return self.embed_texts([text])[0]


class HashingEmbeddingBackend(EmbeddingBackend):
    """
    Embedding sederhana berbasis hashing trick + normalisasi.
    Deterministik, tidak butuh internet/GPU/download model.
    TIDAK paham makna kalimat -- HANYA untuk fallback/unit test cepat,
    JANGAN dipakai untuk ingest data pajak sungguhan (lihat docstring atas).
    """

    dim = EMBEDDING_DIM

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        vectors = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            tokens = _tokenize(text)
            if not tokens:
                continue
            for token in tokens:
                idx = _hash_token(token, self.dim)
                vectors[i, idx] += 1.0
            norm = np.linalg.norm(vectors[i])
            if norm > 0:
                vectors[i] = vectors[i] / norm
        return vectors


class BgeM3EmbeddingBackend(EmbeddingBackend):
    """
    [Tahap 2.1] Model embedding sungguhan: BAAI/bge-m3, self-hosted lewat
    sentence-transformers. Ini backend DEFAULT untuk produksi -- lihat
    alasan pemilihan di docstring atas file ini.
    """

    dim = 1024  # dimensi native BGE-M3

    def __init__(self, model_name: str = "BAAI/bge-m3", device: Optional[str] = None):
        # Import di dalam __init__ (bukan di top-level file) supaya modul ini
        # tetap bisa di-import tanpa sentence-transformers/torch terpasang
        # kalau yang dipakai cuma HashingEmbeddingBackend (mis. di CI/test).
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name, device=device)

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        vectors = self._model.encode(
            texts,
            # normalize_embeddings=True penting: vector_store.py hitung
            # cosine similarity manual -- vector ternormalisasi bikin hasil
            # skor konsisten & lebih stabil secara numerik.
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=16,
        )
        return np.asarray(vectors, dtype=np.float32)


# Lazy singleton -- SENGAJA tidak diinstansiasi di top-level modul, supaya
# import modules.embedding tidak otomatis memicu download model 2.2GB tiap
# kali modul lain (mis. saat unit test) sekadar import fungsi/type dari sini.
_default_backend: Optional[EmbeddingBackend] = None


def get_embedding_backend() -> EmbeddingBackend:
    global _default_backend
    if _default_backend is not None:
        return _default_backend

    backend_name = os.environ.get(_BACKEND_ENV_VAR, "bge_m3").lower()
    if backend_name == "hashing":
        _default_backend = HashingEmbeddingBackend()
    else:
        _default_backend = BgeM3EmbeddingBackend()
    return _default_backend


def embed_texts(texts: List[str]) -> np.ndarray:
    return get_embedding_backend().embed_texts(texts)


def embed_text(text: str) -> np.ndarray:
    return get_embedding_backend().embed_text(text)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)