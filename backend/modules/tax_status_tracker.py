"""
modules/tax_status_tracker.py
Melacak status peraturan (berlaku/dicabut/diubah) secara terpisah dari
dokumen itu sendiri, supaya status bisa diperbarui (mis. saat ada
perubahan aturan) tanpa menulis ulang seluruh dokumen sumber.

Dipakai oleh modules/citation.py untuk memberi peringatan saat suatu
sumber yang disitasi ternyata sudah dicabut/diubah.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from modules.schemas import RegulationStatus
from modules import storage

TABLE = "regulation_status"


class StatusTracker:
    def get_status(self, document_id: str) -> RegulationStatus:
        record = storage.get(TABLE, document_id)
        if not record:
            return RegulationStatus.TIDAK_DIKETAHUI
        return RegulationStatus(record.get("status", RegulationStatus.TIDAK_DIKETAHUI.value))

    def get_note(self, document_id: str) -> Optional[str]:
        record = storage.get(TABLE, document_id)
        return record.get("note") if record else None

    def set_status(
        self,
        document_id: str,
        status: RegulationStatus,
        note: Optional[str] = None,
        changed_by: Optional[str] = None,
    ) -> None:
        storage.upsert(
            TABLE,
            document_id,
            {
                "document_id": document_id,
                "status": status.value,
                "note": note,
                "changed_by": changed_by,
                "updated_at": datetime.utcnow().isoformat(),
            },
        )

    def list_by_status(self, status: RegulationStatus) -> List[Dict]:
        return storage.query(TABLE, lambda r: r.get("status") == status.value)


_tracker = StatusTracker()


def get_status_tracker() -> StatusTracker:
    return _tracker