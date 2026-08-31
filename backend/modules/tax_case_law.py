"""
modules/tax_case_law.py
Penyimpanan & pencarian dasar untuk putusan pengadilan pajak (CourtCase).
Ini "database kasus" yang jadi fondasi fitur prediksi & risk scoring,
setara dengan koleksi case law di Blue J.

Untuk memasukkan kasus baru + indexing ke vector store, pakai
modules/tax_case_ingestion.py (yang memanggil create_case() di sini).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from modules.schemas import CourtCase
from modules import storage

TABLE = "cases"


def save_case(case: CourtCase) -> CourtCase:
    storage.upsert(TABLE, case.id, case.model_dump(mode="json"))
    return case


def create_case(
    nomor_putusan: str,
    pengadilan: str,
    ringkasan: str = "",
    full_text: str = "",
    **kwargs,
) -> CourtCase:
    case = CourtCase(
        id=str(uuid.uuid4()),
        nomor_putusan=nomor_putusan,
        pengadilan=pengadilan,
        ringkasan=ringkasan,
        full_text=full_text,
        **kwargs,
    )
    return save_case(case)


def get_case(case_id: str) -> Optional[CourtCase]:
    record = storage.get(TABLE, case_id)
    return CourtCase(**record) if record else None


def get_case_by_nomor(nomor_putusan: str) -> Optional[CourtCase]:
    matches = storage.query(TABLE, lambda r: r.get("nomor_putusan") == nomor_putusan)
    return CourtCase(**matches[0]) if matches else None


def list_cases(jenis_sengketa: Optional[str] = None) -> List[CourtCase]:
    if jenis_sengketa:
        records = storage.query(TABLE, lambda r: r.get("jenis_sengketa") == jenis_sengketa)
    else:
        records = storage.list_all(TABLE)
    return [CourtCase(**r) for r in records]


def delete_case(case_id: str) -> bool:
    return storage.delete(TABLE, case_id)