"""
tests/test_tax_case_features.py
Uji dasar untuk modules/tax_case_features.py (ekstraksi fitur kasus).
"""
import pytest

from modules import storage
from modules.schemas import CourtCase
from modules.tax_case_features import extract_features, get_features


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def _make_case(**overrides) -> CourtCase:
    base = dict(
        id="case-1",
        nomor_putusan="PUT-001/PP/2026",
        pengadilan="Pengadilan Pajak",
        jenis_sengketa="PPN",
        full_text=(
            "Menurut pemohon, faktur pajak masukan sudah sesuai Pasal 9 UU PPN. "
            "Menurut terbanding, dokumen pendukung belum lengkap sesuai PMK No. 18/2021."
        ),
        amar_putusan="ditolak",
    )
    base.update(overrides)
    return CourtCase(**base)


def test_extract_features_finds_arguments_and_legal_basis():
    features = extract_features(_make_case())

    assert features.case_id == "case-1"
    assert features.hasil == "ditolak"
    assert len(features.argumen_pemohon) >= 1
    assert len(features.argumen_termohon) >= 1
    assert any("PPN" in d or "PMK" in d for d in features.dasar_hukum)


def test_extract_features_persists_and_is_retrievable():
    case = _make_case(id="case-2", nomor_putusan="PUT-002/PP/2026")
    extract_features(case)

    fetched = get_features("case-2")
    assert fetched is not None
    assert fetched.case_id == "case-2"


def test_extract_features_no_markers_returns_empty_arguments():
    case = _make_case(id="case-3", full_text="Teks putusan tanpa penanda argumen apa pun.")
    features = extract_features(case)

    assert features.argumen_pemohon == []
    assert features.argumen_termohon == []