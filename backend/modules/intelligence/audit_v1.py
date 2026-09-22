"""
modules/intelligence/audit_v1.py
==================================
Fitur halaman Audit: temuan (finding), tahapan audit trail (stage),
log aktivitas (activity), dan bukti (evidence) -- 4 tabel dibuat manual
oleh user lewat Supabase SQL Editor, schema "6_Intelligence":
intelligence_audit_finding/intelligence_audit_stage/
intelligence_audit_activity/intelligence_audit_evidence. Lihat
db_client.py: AuditFindingRow/AuditStageRow/AuditActivityRow/
AuditEvidenceRow dan fungsi ambil_data_audit/tambah_audit_finding/
ubah_audit_finding/tambah_audit_evidence/dst. Frontend:
src/app/audit/lib/auditBridge.ts.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/intelligence/__init__.py untuk catatan lengkap
kenapa pemindahan ini menghapus registrasi lama di main.py (bukan
menambah path baru seperti pola modules/management/).
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("intelligence_audit_v1")

router = APIRouter(prefix="/api/v1/intelligence", tags=["audit"])


# ============================================================
# SKEMA
# ============================================================

class AuditFindingSkema(BaseModel):
    """Satu temuan audit -- lihat ambil_data_audit()."""
    id: str
    findingNo: int
    area: Optional[str] = None
    description: str
    account: Optional[str] = None
    amount: float = 0
    risk: Optional[str] = None
    assignedTo: Optional[str] = None
    dueDate: Optional[str] = None
    status: Optional[str] = None
    rootCause: Optional[str] = None
    recommendation: Optional[str] = None
    managementResponse: Optional[str] = None
    likelihood: Optional[int] = None
    impact: Optional[int] = None


class AuditStageSkema(BaseModel):
    id: str
    label: str
    date: Optional[str] = None
    done: Optional[bool] = None
    current: Optional[bool] = None
    sortOrder: Optional[int] = None


class AuditActivitySkema(BaseModel):
    id: str
    findingId: Optional[str] = None
    user: Optional[str] = None
    action: Optional[str] = None
    type: Optional[str] = None
    date: Optional[str] = None


class AuditEvidenceSkema(BaseModel):
    """Metadata evidence SAJA -- isi file tidak diikutkan (lihat GET
    .../evidence/{id}/file utk download isinya)."""
    id: str
    findingId: str
    fileName: Optional[str] = None
    fileSize: Optional[int] = None
    uploadedBy: Optional[str] = None
    uploadedAt: Optional[str] = None
    mimeType: Optional[str] = None


class DataAuditResponse(BaseModel):
    findings: List[AuditFindingSkema]
    stages: List[AuditStageSkema]
    activities: List[AuditActivitySkema]
    evidence: List[AuditEvidenceSkema]


class TambahAuditFindingSkema(BaseModel):
    """Hasil tambah temuan -- bentuk ringkas, lihat tambah_audit_finding()."""
    id: str
    findingNo: int


class TambahAuditFindingResponse(BaseModel):
    berhasil: bool
    finding: TambahAuditFindingSkema


class UbahAuditFindingSkema(BaseModel):
    """Hasil ubah temuan -- bentuk ringkas, lihat ubah_audit_finding()."""
    id: str
    status: Optional[str] = None


class UbahAuditFindingResponse(BaseModel):
    berhasil: bool
    finding: UbahAuditFindingSkema


class TambahAuditEvidenceSkema(BaseModel):
    """Hasil upload evidence -- bentuk ringkas, lihat tambah_audit_evidence()."""
    id: str
    fileName: str
    fileSize: int


class TambahAuditEvidenceResponse(BaseModel):
    berhasil: bool
    evidence: TambahAuditEvidenceSkema


class HapusAuditEvidenceResponse(BaseModel):
    berhasil: bool
    pesan: Optional[str] = None


class UbahAuditStageSkema(BaseModel):
    id: str
    done: Optional[bool] = None
    current: Optional[bool] = None


class UbahAuditStageResponse(BaseModel):
    berhasil: bool
    stage: UbahAuditStageSkema


class TambahAuditFindingRequest(BaseModel):
    """Body POST /api/client/{client_id}/audit/findings -> tombol "New Finding"."""
    area: Optional[str] = None
    description: str
    account: Optional[str] = None
    amount: Decimal = Decimal("0")
    risk: str = "Medium"
    assignedTo: Optional[str] = None
    dueDate: Optional[str] = None
    status: str = "Open"
    rootCause: Optional[str] = None
    recommendation: Optional[str] = None
    managementResponse: Optional[str] = None
    likelihood: int = 3
    impact: int = 3


class UbahAuditFindingRequest(BaseModel):
    """Body PATCH /api/client/{client_id}/audit/findings/{finding_id} --
    semua field opsional, hanya yang dikirim yang diubah."""
    status: Optional[str] = None
    risk: Optional[str] = None
    rootCause: Optional[str] = None
    recommendation: Optional[str] = None
    managementResponse: Optional[str] = None
    assignedTo: Optional[str] = None
    dueDate: Optional[str] = None
    likelihood: Optional[int] = None
    impact: Optional[int] = None


class UbahAuditStageRequest(BaseModel):
    """Body PATCH /api/client/{client_id}/audit/stage/{stage_id}."""
    done: Optional[bool] = None
    current: Optional[bool] = None


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getAudit", response_model=DataAuditResponse)
def api_data_audit(client_id: str, user: dict = Depends(auth.get_current_user)):
    """Data mentah modul Audit (finding, stage, activity, evidence
    metadata) utk satu client -- tabel dibuat manual oleh user lewat
    Supabase SQL Editor, schema "6_Intelligence". Path lama:
    GET /api/client/{client_id}/audit -- client_id sekarang lewat query
    string mengikuti pola /api/[version]/[group]/[nama_fitur]."""
    return dbc.ambil_data_audit(client_id)


@router.post("/addAuditFinding", response_model=TambahAuditFindingResponse)
def api_tambah_audit_finding(
    client_id: str, req: TambahAuditFindingRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tambah temuan audit baru -- tombol "New Finding" di
    src/app/audit/page.tsx. Path lama:
    POST /api/client/{client_id}/audit/findings."""
    hasil = dbc.tambah_audit_finding(client_id, req.model_dump(), user.get("username", "unknown"))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="tambah_audit_finding",
        detail={"finding_id": hasil["id"], "description": req.description},
    )
    return {"berhasil": True, "finding": hasil}


@router.patch("/updateAuditFinding", response_model=UbahAuditFindingResponse)
def api_ubah_audit_finding(
    client_id: str, finding_id: str, req: UbahAuditFindingRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Ubah temuan audit -- dipakai tombol Review/Resolve/Escalate
    di FindingDrawer (src/app/audit/page.tsx). Path lama: PATCH
    /api/client/{client_id}/audit/findings/{finding_id} -- finding_id
    sekarang lewat query string."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    hasil = dbc.ubah_audit_finding(client_id, finding_id, fields, user.get("username", "unknown"))
    if hasil is None:
        raise HTTPException(status_code=404, detail="Temuan audit tidak ditemukan untuk client ini.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="ubah_audit_finding",
        detail={"finding_id": finding_id, "fields": list(fields.keys())},
    )
    return {"berhasil": True, "finding": hasil}


@router.post("/addAuditEvidence", response_model=TambahAuditEvidenceResponse)
async def api_tambah_audit_evidence(
    client_id: str, finding_id: str, file: UploadFile = File(...),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Upload 1 file evidence utk 1 temuan -- tombol "Add
    Evidence" di FindingDrawer. File disimpan sbg bytea langsung di
    Postgres (bukan Supabase Storage). Path lama: POST
    /api/client/{client_id}/audit/findings/{finding_id}/evidence --
    client_id & finding_id sekarang lewat query string, file tetap lewat
    multipart form body."""
    content = await file.read(dbc.AUDIT_EVIDENCE_MAX_BYTES + 1)
    try:
        hasil = dbc.tambah_audit_evidence(
            client_id, finding_id, file.filename, len(content),
            file.content_type, content, user.get("username", "unknown"),
        )
    except ValueError as e:
        # Semua ValueError (termasuk "file terlalu besar" / "file kosong")
        # dibalas 400 (kesalahan pada file), KECUALI pesannya soal temuan
        # tidak ditemukan -> 404.
        status = 404 if "tidak ditemukan" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="tambah_audit_evidence",
        detail={"finding_id": finding_id, "file_name": file.filename},
    )
    return {"berhasil": True, "evidence": hasil}


@router.get("/getAuditEvidenceFile")
def api_ambil_audit_evidence_file(client_id: str, evidence_id: str, user: dict = Depends(auth.get_current_user)):
    """Download isi 1 file evidence. Path lama: GET
    /api/client/{client_id}/audit/evidence/{evidence_id}/file --
    client_id & evidence_id sekarang lewat query string."""
    hasil = dbc.ambil_audit_evidence_file(evidence_id, client_id)
    if hasil is None:
        raise HTTPException(status_code=404, detail="Evidence tidak ditemukan.")
    return Response(
        content=hasil["content"], media_type=hasil["mimeType"],
        headers={"Content-Disposition": f'attachment; filename="{hasil["fileName"]}"'},
    )


@router.delete("/deleteAuditEvidence", response_model=HapusAuditEvidenceResponse)
def api_hapus_audit_evidence(
    client_id: str, evidence_id: str, user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Hapus 1 file evidence. Path lama: DELETE
    /api/client/{client_id}/audit/evidence/{evidence_id}. Evidence yang
    tidak ditemukan dibalas 404, dan log HANYA ditulis setelah baris
    benar-benar terhapus."""
    try:
        hasil = dbc.hapus_audit_evidence(evidence_id, client_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="hapus_audit_evidence",
        detail={"evidence_id": evidence_id},
    )
    return hasil


@router.patch("/updateAuditStage", response_model=UbahAuditStageResponse)
def api_ubah_audit_stage(
    client_id: str, stage_id: str, req: UbahAuditStageRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tandai tahapan audit selesai/berjalan -- klik di Audit
    Progress bar (src/app/audit/page.tsx). Path lama: PATCH
    /api/client/{client_id}/audit/stage/{stage_id}."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    hasil = dbc.ubah_audit_stage(client_id, stage_id, fields)
    if hasil is None:
        raise HTTPException(status_code=404, detail="Tahapan audit tidak ditemukan.")
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="ubah_audit_stage",
        detail={"stage_id": stage_id, **fields},
    )
    return {"berhasil": True, "stage": hasil}