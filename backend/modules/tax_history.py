"""
modules/tax_history.py
Riwayat tanya-jawab riset pajak per user/klien (audit trail), terpisah
dari modules/history.py yang sudah ada (yang sepertinya untuk audit
log modul akuntansi umum, bukan fitur riset pajak).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from modules.schemas import HistoryEntry
from modules import storage

TABLE = "tax_history"


def log_interaction(
    question: str,
    answer: str,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
) -> HistoryEntry:
    entry = HistoryEntry(
        id=str(uuid.uuid4()),
        user_id=user_id,
        client_id=client_id,
        question=question,
        answer=answer,
    )
    storage.upsert(TABLE, entry.id, entry.model_dump(mode="json"))
    return entry


def get_history(
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 50,
) -> List[HistoryEntry]:
    def match(r):
        if user_id and r.get("user_id") != user_id:
            return False
        if client_id and r.get("client_id") != client_id:
            return False
        return True

    records = storage.query(TABLE, match)
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return [HistoryEntry(**r) for r in records[:limit]]


def delete_entry(entry_id: str) -> bool:
    return storage.delete(TABLE, entry_id)