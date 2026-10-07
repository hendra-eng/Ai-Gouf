"""
modules/financial_statements/fs_mapping_v1.py
===============================================
Master mapping laporan keuangan per klien (Task Plan 16-19):

    GET    /api/v1/management/fs-mapping?client_id=...           semua akun COA + mapping efektif + katalog pilihan
    PUT    /api/v1/management/fs-mapping/{coa_id}                 simpan override 1 akun (Tahap 3+)
    DELETE /api/v1/management/fs-mapping/{coa_id}?client_id=...   kembali ke default (Tahap 3+)
    POST   /api/v1/management/fs-mapping/apply-defaults           salin aturan default ke semua akun (Tahap 3+)

Mapping efektif tiap akun = override klien (management_client_fs_mappings)
> COA (head/sub) > aturan default per prefix standard_account_code
(management_fs_mapping_rules). Lihat mapped.info_akun_coa.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from . import fs_store, mapped
from .statements_v1 import GagalValidasi, _klien, _respon_gagal, _uuid_atau_gagal

logger = get_module_logger("fs_mapping_v1")

router = APIRouter(prefix="/api/v1/management/fs-mapping", tags=["management-fs-mapping-v1"])

LEVEL_UBAH_MAPPING = 3


def _katalog(client_id: str) -> Dict[str, Any]:
    notes = fs_store.daftar_note_klien(client_id, termasuk_nonaktif=True)
    kunci_note = {n["note_key"]: n["title"] for n in notes if n["note_type"] == "account"}
    for t in fs_store.daftar_template():
        if t["note_type"] == "account":
            kunci_note.setdefault(t["note_key"], t["title"])
    return {
        "balance_sheet_sections": [{"key": k, "label": v} for k, v in mapped.SEKSI_NERACA],
        "profit_loss_sections": [{"key": k, "label": v} for k, v in mapped.SEKSI_LABA_RUGI],
        "equity_components": [{"key": k, "label": v} for k, v in mapped.KOMPONEN_EKUITAS],
        "cash_flow_categories": [{"key": k, "label": v} for k, v in mapped.KATEGORI_ARUS_KAS],
        "notes": [{"key": k, "label": v} for k, v in kunci_note.items()],
        "warnings": mapped.PERINGATAN,
    }


@router.get("", summary="Mapping laporan keuangan semua akun COA 1 klien")
def daftar_mapping(client_id: str = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    try:
        kid = _klien(client_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    coa = {c["id"]: c for c in dbc.list_management_client_coa(kid)}
    tersimpan = fs_store.mapping_klien(kid)
    peta = fs_store.peta_akun_klien(kid)
    akun = []
    for kode, info in sorted(peta.items()):
        c = coa.get(info["coa_id"], {})
        akun.append({
            **info,
            "account_head": c.get("account_head"),
            "account_sub": c.get("account_sub"),
            "saved": tersimpan.get(info["coa_id"]),
        })
    ringkas = {
        "accounts": len(akun),
        "saved": sum(1 for a in akun if a["saved"]),
        "no_cash_flow_mapping": sum(1 for a in akun if "no_cash_flow_mapping" in a["warnings"]),
        "no_equity_component": sum(1 for a in akun if "no_equity_component" in a["warnings"]),
        "with_warnings": sum(1 for a in akun if a["warnings"]),
    }
    return sukses(data={"accounts": akun, "summary": ringkas, "options": _katalog(kid)})


class MappingRequest(BaseModel):
    client_id: str
    fs_section: Optional[str] = None
    fs_line: Optional[str] = Field(None, max_length=150)
    equity_component: Optional[str] = None
    cash_flow_category: Optional[str] = None
    cash_flow_line: Optional[str] = Field(None, max_length=150)
    note_key: Optional[str] = Field(None, max_length=60)


@router.put("/{coa_id}", summary="Simpan mapping 1 akun (Tahap 3+). Field kosong = ikut default.")
def simpan_mapping(coa_id: str, body: MappingRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_UBAH_MAPPING))):
    try:
        kid = _klien(body.client_id)
        cid = _uuid_atau_gagal(coa_id, "coa_id")
    except GagalValidasi as e:
        return _respon_gagal(e)
    coa = fs_store.coa_milik_klien(kid, cid)
    if not coa:
        return gagal(message="Akun COA tidak ditemukan di klien ini.", errors={"code": "NOT_FOUND"}, status_code=404)

    nilai = {k: (v.strip() if isinstance(v, str) else v) or None for k, v in body.model_dump(exclude={"client_id"}).items()}
    klas = (coa.get("account_classification") or "").upper()
    akun_neraca = klas in ("ASSET", "LIABILITY", "EQUITY")
    seksi_valid = dict(mapped.SEKSI_NERACA) if akun_neraca else dict(mapped.SEKSI_LABA_RUGI)
    if nilai["fs_section"] and nilai["fs_section"] not in seksi_valid:
        return gagal(message=f"fs_section untuk akun {'neraca' if akun_neraca else 'laba rugi'} harus salah satu dari: {', '.join(seksi_valid)}.",
                     errors={"code": "INVALID_SECTION"})
    if nilai["equity_component"] and nilai["equity_component"] not in dict(mapped.KOMPONEN_EKUITAS):
        return gagal(message="equity_component tidak valid.", errors={"code": "INVALID_EQUITY_COMPONENT"})
    if nilai["cash_flow_category"] and nilai["cash_flow_category"] not in dict(mapped.KATEGORI_ARUS_KAS):
        return gagal(message="cash_flow_category tidak valid.", errors={"code": "INVALID_CASH_FLOW_CATEGORY"})
    if not akun_neraca and (nilai["cash_flow_category"] or nilai["cash_flow_line"]):
        return gagal(message="Akun laba rugi tidak dipetakan ke cash flow (masuk lewat laba bersih).", errors={"code": "PL_NO_CASH_FLOW"})
    try:
        hasil = fs_store.simpan_mapping(kid, cid, nilai, current_user.get("id"))
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal simpan mapping FS: %s", e)
        return gagal(message="Gagal menyimpan mapping.", errors={"code": "DB_ERROR"}, status_code=500)
    return sukses(data=hasil or None, message="Mapping tersimpan." if hasil else "Mapping dikembalikan ke default.")


@router.delete("/{coa_id}", summary="Kembalikan mapping 1 akun ke default (Tahap 3+)")
def hapus_mapping(coa_id: str, client_id: str = Query(...), _c: Dict[str, Any] = Depends(_require_level_v1(LEVEL_UBAH_MAPPING))):
    try:
        kid = _klien(client_id)
        cid = _uuid_atau_gagal(coa_id, "coa_id")
    except GagalValidasi as e:
        return _respon_gagal(e)
    fs_store.hapus_mapping(kid, cid)
    return sukses(data=None, message="Mapping dikembalikan ke default.")


class ApplyDefaultsRequest(BaseModel):
    client_id: str
    overwrite: bool = False


@router.post("/apply-defaults", summary="Salin aturan default ke mapping semua akun klien (Tahap 3+)")
def apply_defaults(body: ApplyDefaultsRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_UBAH_MAPPING))):
    try:
        kid = _klien(body.client_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    try:
        hasil = fs_store.terapkan_default(kid, body.overwrite, current_user.get("id"))
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal apply default mapping FS: %s", e)
        return gagal(message="Gagal menerapkan mapping default.", errors={"code": "DB_ERROR"}, status_code=500)
    return sukses(data=hasil, message="Mapping default diterapkan.")
