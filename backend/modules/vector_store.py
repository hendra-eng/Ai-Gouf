"""
vector_store.py

Dasar: wrapper sederhana untuk menyimpan & mencari chunk peraturan
berdasarkan kemiripan makna (embedding similarity).

[PERSISTEN] Sebelumnya `default_store` cuma in-memory (InMemoryVectorStore)
-- semua dokumen pajak yang sudah di-ingest hilang total tiap server
restart. Sekarang `default_store` adalah PersistentVectorStore, yang
menulis tiap chunk+vector ke modules/storage.py (tabel "vector_chunks",
file JSON di DATA_DIR/vector_chunks.json) dan otomatis memuatnya balik ke
memory saat instance dibuat -- jadi survive restart, tanpa perlu install
database baru (pgvector/Qdrant/dst), konsisten dengan pola storage.py yang
sudah dipakai modul lain (documents, cases, dst).

InMemoryVectorStore (class asli, murni di memory, TIDAK persisten) masih
dipertahankan apa adanya di bawah -- untuk unit test atau kalau ada kode
lain yang mengimpornya langsung.

[Tahap 4.1] Tambahan method list_all_chunks() -- dipakai
scripts/spot_check_chunks.py untuk membaca seluruh isi vector store demi
verifikasi manual, tanpa perlu mengakses field/fungsi private modul ini
langsung dari luar.

TODO nanti (versi serius, kalau data sudah banyak / butuh multi-worker):
- Ganti file JSON dengan pgvector / Qdrant / Pinecone (pencarian jadi
  index-based, bukan cosine similarity manual over semua vector)
- Tambah filtering by metadata (jenis peraturan, status, tanggal) di level
  storage, bukan cuma setelah dimuat ke memory
- Tambah re-ranking hasil pencarian
- storage.py sendiri belum aman untuk multi-proses/multi-worker (lock-nya
  cuma per-proses) -- kalau nanti backend dijalankan dengan >1 worker
  proses (mis. uvicorn --workers 4), tiap worker punya salinan memory
  sendiri dan bisa saling menimpa file JSON saat ingest bersamaan.
"""

from __future__ import annotations

import dataclasses
import math
import threading
from typing import Optional

import numpy as np

from modules.tax_chunker import Chunk, RegulationMetadata
from modules import storage

TABLE_VECTOR_CHUNKS = "vector_chunks"

# [BARU -- PERBAIKAN PERFORMA] Sebelumnya _cosine_similarity() dipanggil
# SATU-SATU per chunk lewat Python for-loop murni (sum(x*y for x,y in
# zip(...)) + math.sqrt manual) -- untuk RAG dengan ribuan chunk, ini jadi
# ribuan pemanggilan fungsi Python + loop interpreted per elemen vector
# (1024 dim tiap chunk kalau pakai BGE-M3, lihat embedding.py). numpy
# menjalankan operasi yang SAMA PERSIS (dot product + normalisasi) sebagai
# 1 operasi matrix yang dikompilasi C/BLAS -- untuk 5000 chunk x 1024 dim,
# ini bisa >50x lebih cepat daripada loop Python murni. Hasil AKHIR
# (urutan & skor top_k) TIDAK berubah, cuma cara menghitungnya.


@dataclasses.dataclass
class SearchResult:
    chunk: Chunk
    score: float


class InMemoryVectorStore:
    """Versi dasar, murni di memory (TIDAK persisten -- lihat
    PersistentVectorStore di bawah untuk versi yang disimpan ke disk)."""

    def __init__(self):
        self._chunks: list[Chunk] = []
        self._vectors: list[list[float]] = []

    def add(self, chunk: Chunk, vector: list[float]) -> None:
        self._chunks.append(chunk)
        self._vectors.append(vector)

    def add_many(self, items: list[tuple[Chunk, list[float]]]) -> None:
        for chunk, vector in items:
            self.add(chunk, vector)

    def search(
        self,
        query_vector: list[float],
        top_k: int = 5,
        filters: Optional[dict] = None,
    ) -> list[SearchResult]:
        """
        [Tahap 4 - no.4] `filters` opsional: dict field->value yang harus
        cocok PERSIS (exact match) dengan atribut RegulationMetadata milik
        tiap chunk sebelum ikut dinilai kemiripannya, mis.
        {"jenis": "PMK"} atau {"status": "berlaku"} atau
        {"document_id": "..."}. None/{} (default) berarti tidak ada
        filter -- perilaku persis seperti sebelumnya, jadi caller lama
        yang belum kirim filters tetap jalan tanpa berubah.

        Filter diterapkan SEBELUM cosine similarity dihitung -- lebih
        murah (tidak menghitung skor untuk chunk yang toh akan dibuang)
        dan hasilnya lebih benar (top_k dihitung dari kandidat yang sudah
        difilter, bukan top_k dari semua chunk lalu difilter belakangan
        yang bisa menghasilkan kurang dari top_k hasil akhir).

        Pengecekan field mana saja yang valid untuk difilter TIDAK
        dilakukan di sini (vector_store.py tidak tahu konteks pemanggil) --
        itu tanggung jawab caller (lihat tax_rag.py: validasi dilakukan di
        sana sebelum search() dipanggil, supaya pesan error yang salah
        ketik nama field bisa jelas untuk pengguna API).
        """
        kandidat = zip(self._chunks, self._vectors)
        if filters:
            kandidat = [
                (chunk, vec)
                for chunk, vec in kandidat
                if all(
                    getattr(chunk.metadata, field, None) == nilai
                    for field, nilai in filters.items()
                )
            ]
        else:
            kandidat = list(kandidat)

        if not kandidat:
            return []

        # [BARU -- PERBAIKAN PERFORMA] Hitung SEMUA skor sekaligus lewat
        # matrix multiply numpy, bukan loop Python per chunk (lihat
        # catatan di atas file). query dinormalisasi sekali; kalau
        # vector chunk yang tersimpan SUDAH ternormalisasi (default utk
        # BgeM3EmbeddingBackend, lihat embedding.py: normalize_embeddings=
        # True), dot product = cosine similarity langsung tanpa perlu
        # normalisasi ulang tiap chunk -- tapi tetap dinormalisasi manual
        # di sini supaya BENAR juga untuk vector yang belum ternormalisasi
        # (mis. HashingEmbeddingBackend versi lama / data historis).
        chunk_list, vektor_list = zip(*kandidat)
        matriks = np.asarray(vektor_list, dtype=np.float32)
        query = np.asarray(query_vector, dtype=np.float32)

        norm_matriks = np.linalg.norm(matriks, axis=1)
        norm_query = np.linalg.norm(query)
        denom = norm_matriks * norm_query
        denom[denom == 0] = 1.0  # hindari div-by-zero, skor jadi 0 secara alami

        skor = (matriks @ query) / denom

        top_k = max(0, min(top_k, len(chunk_list)))
        if top_k == 0:
            return []
        # argpartition O(n) untuk ambil top_k KANDIDAT (belum urut), baru
        # diurutkan (O(k log k)) -- lebih murah dari sort semua chunk
        # (O(n log n)) saat n jauh lebih besar dari top_k.
        idx_top = np.argpartition(-skor, top_k - 1)[:top_k]
        idx_top = idx_top[np.argsort(-skor[idx_top])]

        return [
            SearchResult(chunk=chunk_list[i], score=float(skor[i]))
            for i in idx_top
        ]

    def size(self) -> int:
        return len(self._chunks)


class PersistentVectorStore(InMemoryVectorStore):
    """
    Sama seperti InMemoryVectorStore (pencarian tetap cosine similarity di
    memory -- cepat untuk jumlah dokumen skala kantor akuntan), tapi setiap
    add() juga ditulis ke disk lewat modules/storage.py, dan seluruh isi
    tabel itu dimuat balik ke memory saat instance ini dibuat -- jadi data
    peraturan/putusan yang sudah di-ingest TIDAK hilang saat server di-restart.
    """

    def __init__(self, table: str = TABLE_VECTOR_CHUNKS):
        super().__init__()
        self._table = table
        self._lock = threading.Lock()
        self._id_ke_index: dict[str, int] = {}
        self._muat_dari_disk()

    def _muat_dari_disk(self) -> None:
        chunks: list[Chunk] = []
        vectors: list[list[float]] = []
        id_ke_index: dict[str, int] = {}
        dilewati = 0
        for record in storage.list_all(self._table):
            hasil = _record_ke_chunk(record)
            if hasil is None:
                dilewati += 1
                continue
            chunk, vector = hasil
            id_ke_index[chunk.id] = len(chunks)
            chunks.append(chunk)
            vectors.append(vector)

        with self._lock:
            self._chunks = chunks
            self._vectors = vectors
            self._id_ke_index = id_ke_index

        if dilewati:
            # Record korup/format lama dilewati saja, tidak menjatuhkan
            # seluruh vector store -- tapi dicatat di stdout/log server
            # supaya ketahuan kalau ada data yang perlu di-ingest ulang.
            print(
                f"[vector_store] Peringatan: {dilewati} record di tabel "
                f"'{self._table}' dilewati saat memuat (format tidak dikenali)."
            )

    def add(self, chunk: Chunk, vector: list[float]) -> None:
        storage.upsert(self._table, chunk.id, _chunk_ke_record(chunk, vector))
        with self._lock:
            idx = self._id_ke_index.get(chunk.id)
            if idx is not None:
                # Re-ingest chunk dengan id yang sama -> timpa, bukan duplikat.
                self._chunks[idx] = chunk
                self._vectors[idx] = vector
            else:
                self._id_ke_index[chunk.id] = len(self._chunks)
                self._chunks.append(chunk)
                self._vectors.append(vector)

    def hapus_by_metadata(self, field: str, nilai: str) -> int:
        """
        Hapus semua chunk yang metadata.<field>-nya == nilai (mis. hapus
        semua chunk milik satu document_id/case_id sebelum re-index ulang,
        supaya reindex_case()/ingest ulang tidak menumpuk chunk lama +
        chunk baru selamanya di penyimpanan permanen).
        """
        with self._lock:
            sisa_chunks, sisa_vectors = [], []
            dihapus = 0
            for chunk, vector in zip(self._chunks, self._vectors):
                if getattr(chunk.metadata, field, None) == nilai:
                    storage.delete(self._table, chunk.id)
                    dihapus += 1
                    continue
                sisa_chunks.append(chunk)
                sisa_vectors.append(vector)
            self._chunks = sisa_chunks
            self._vectors = sisa_vectors
            self._id_ke_index = {c.id: i for i, c in enumerate(self._chunks)}
        return dihapus

    def reload(self) -> None:
        """Muat ulang dari disk -- panggil manual kalau data diubah dari
        proses lain (mis. worker/proses terpisah menulis ke tabel yang sama)."""
        self._muat_dari_disk()

    def list_all_chunks(self) -> list[tuple[Chunk, list[float]]]:
        """
        [Tahap 4.1] Kembalikan semua (chunk, vector) yang sedang ada di
        memory -- method PUBLIK untuk tooling eksternal (mis.
        scripts/spot_check_chunks.py) yang perlu membaca seluruh isi
        vector store demi verifikasi manual, tanpa harus tahu struktur
        internal (_chunks/_vectors) atau memanggil fungsi private modul
        ini (_record_ke_chunk) secara langsung dari luar.

        Catatan: ini baca dari MEMORY (state saat instance dibuat / reload()
        terakhir dipanggil), bukan langsung dari disk. Untuk script yang
        dijalankan sebagai proses terpisah dari server (spot-check, eval),
        ini tetap aman karena __init__() PersistentVectorStore otomatis
        _muat_dari_disk() saat instance dibuat -- jadi begitu script
        mengimpor default_store, isinya sudah otomatis data terbaru dari
        disk saat itu.
        """
        with self._lock:
            return list(zip(self._chunks, self._vectors))

    def size(self) -> int:
        with self._lock:
            return len(self._chunks)


def _chunk_ke_record(chunk: Chunk, vector: list[float]) -> dict:
    return {"chunk": dataclasses.asdict(chunk), "vector": vector}


def _record_ke_chunk(record: dict) -> Optional[tuple[Chunk, list[float]]]:
    try:
        c = record["chunk"]
        metadata = RegulationMetadata(**c["metadata"])
        chunk = Chunk(
            id=c["id"],
            text=c["text"],
            metadata=metadata,
            pasal=c.get("pasal"),
            chunk_index=c.get("chunk_index", 0),
        )
        return chunk, record["vector"]
    except (KeyError, TypeError):
        # Record dari format lama/korup -- dilewati, tidak melempar error
        # supaya satu record rusak tidak menjatuhkan seluruh vector store.
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# Instance global dipakai modul lain (tax_ingestion.py, tax_case_ingestion.py,
# tax_rag.py) -- sekarang persisten, otomatis memuat data lama saat proses
# server start.
default_store = PersistentVectorStore()