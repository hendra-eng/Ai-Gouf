"""
tests/test_tax_case_law.py
Uji dasar untuk modules/tax_case_law.py (penyimpanan CourtCase).
"""
import pytest

from modules import storage, tax_case_law


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)


def test_create_and_get_case():
    case = tax_case_law.create_case(
        nomor_putusan="PUT-001/PP/2026",
        pengadilan="Pengadilan Pajak",
        ringkasan="Sengketa PPN masukan",
        jenis_sengketa="PPN",
        amar_putusan="dikabulkan_sebagian",
    )

    fetched = tax_case_law.get_case(case.id)
    assert fetched is not None
    assert fetched.nomor_putusan == "PUT-001/PP/2026"
    assert fetched.amar_putusan == "dikabulkan_sebagian"


def test_get_case_by_nomor():
    tax_case_law.create_case(nomor_putusan="PUT-002/PP/2026", pengadilan="Pengadilan Pajak")

    found = tax_case_law.get_case_by_nomor("PUT-002/PP/2026")
    assert found is not None
    assert found.nomor_putusan == "PUT-002/PP/2026"

    assert tax_case_law.get_case_by_nomor("TIDAK-ADA") is None


def test_list_cases_filtered_by_jenis_sengketa():
    tax_case_law.create_case(nomor_putusan="A", pengadilan="Pengadilan Pajak", jenis_sengketa="PPN")
    tax_case_law.create_case(nomor_putusan="B", pengadilan="Pengadilan Pajak", jenis_sengketa="PPh")

    ppn_cases = tax_case_law.list_cases(jenis_sengketa="PPN")
    assert len(ppn_cases) == 1
    assert ppn_cases[0].nomor_putusan == "A"

    assert len(tax_case_law.list_cases()) == 2


def test_delete_case():
    case = tax_case_law.create_case(nomor_putusan="C", pengadilan="Pengadilan Pajak")
    assert tax_case_law.delete_case(case.id) is True
    assert tax_case_law.get_case(case.id) is None
    assert tax_case_law.delete_case(case.id) is False