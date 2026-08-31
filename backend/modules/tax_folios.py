"""
modules/tax_folios.py
Folio = kumpulan dokumen & kasus yang dikelompokkan per topik/berkas kerja
(mis. "Sengketa PPN Klien X 2026"), supaya staf tidak perlu mencari ulang
tiap kali membuka topik yang sama.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from modules.schemas import TaxFolio
from modules import storage

TABLE = "folios"


def create_folio(title: str, topic: str, description: str = "") -> TaxFolio:
    folio = TaxFolio(id=str(uuid.uuid4()), title=title, topic=topic, description=description)
    storage.upsert(TABLE, folio.id, folio.model_dump(mode="json"))
    return folio


def get_folio(folio_id: str) -> Optional[TaxFolio]:
    record = storage.get(TABLE, folio_id)
    return TaxFolio(**record) if record else None


def list_folios(topic: Optional[str] = None) -> List[TaxFolio]:
    if topic:
        records = storage.query(TABLE, lambda r: r.get("topic") == topic)
    else:
        records = storage.list_all(TABLE)
    return [TaxFolio(**r) for r in records]


def add_document(folio_id: str, document_id: str) -> Optional[TaxFolio]:
    def mutate(f: TaxFolio) -> None:
        if document_id not in f.document_ids:
            f.document_ids.append(document_id)

    return _mutate(folio_id, mutate)


def add_case(folio_id: str, case_id: str) -> Optional[TaxFolio]:
    def mutate(f: TaxFolio) -> None:
        if case_id not in f.case_ids:
            f.case_ids.append(case_id)

    return _mutate(folio_id, mutate)


def _mutate(folio_id: str, fn) -> Optional[TaxFolio]:
    folio = get_folio(folio_id)
    if not folio:
        return None
    fn(folio)
    folio.updated_at = datetime.utcnow()
    storage.upsert(TABLE, folio.id, folio.model_dump(mode="json"))
    return folio


def delete_folio(folio_id: str) -> bool:
    return storage.delete(TABLE, folio_id)