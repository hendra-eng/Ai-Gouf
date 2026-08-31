"""
tests/test_vector_store_filters.py

[Tahap 4 - no.4] Test untuk fitur filter metadata di
InMemoryVectorStore.search() / PersistentVectorStore.search() (diwariskan
dari InMemoryVectorStore, jadi cukup diuji lewat InMemoryVectorStore --
tidak perlu storage.py sungguhan untuk ini).

Jalankan:  pytest tests/test_vector_store_filters.py -v
"""
from modules.tax_chunker import Chunk, RegulationMetadata
from modules.vector_store import InMemoryVectorStore


def _isi_store():
    store = InMemoryVectorStore()
    store.add(
        Chunk(
            id="c1",
            text="isi pmk dicabut",
            metadata=RegulationMetadata(
                nomor="PMK 1/2020", jenis="PMK", judul="A", status="dicabut",
            ),
        ),
        [1.0, 0.0],
    )
    store.add(
        Chunk(
            id="c2",
            text="isi uu berlaku",
            metadata=RegulationMetadata(
                nomor="UU 7/2021", jenis="UU", judul="B", status="berlaku",
            ),
        ),
        [1.0, 0.0],
    )
    store.add(
        Chunk(
            id="c3",
            text="isi pmk lain berlaku",
            metadata=RegulationMetadata(
                nomor="PMK 5/2023", jenis="PMK", judul="C", status="berlaku",
            ),
        ),
        [1.0, 0.0],
    )
    return store


def test_tanpa_filter_kembalikan_semua():
    store = _isi_store()
    hasil = store.search([1.0, 0.0], top_k=5)
    assert len(hasil) == 3


def test_filter_satu_field():
    store = _isi_store()
    hasil = store.search([1.0, 0.0], top_k=5, filters={"jenis": "PMK"})
    ids = {r.chunk.id for r in hasil}
    assert ids == {"c1", "c3"}


def test_filter_kombinasi_dua_field():
    store = _isi_store()
    hasil = store.search(
        [1.0, 0.0], top_k=5, filters={"jenis": "PMK", "status": "berlaku"}
    )
    ids = {r.chunk.id for r in hasil}
    assert ids == {"c3"}


def test_filter_tidak_match_apapun_kembalikan_kosong():
    store = _isi_store()
    hasil = store.search(
        [1.0, 0.0], top_k=5, filters={"jenis": "UU", "status": "dicabut"}
    )
    assert hasil == []


def test_filter_menghormati_top_k_setelah_difilter():
    store = _isi_store()
    hasil = store.search([1.0, 0.0], top_k=1, filters={"jenis": "PMK"})
    assert len(hasil) == 1