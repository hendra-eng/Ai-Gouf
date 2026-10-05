"""
modules/management/coa_industry_v1.py
======================================
Template COA default per industri (KBLI 2020 A..U, tabel
management_coa_industry_templates + _accounts, migration 30):

    GET /api/v1/management/coa-industries
        Daftar industri aktif -> pilihan "Industry" di form Add Client &
        Settings > Company (industry_name_en disimpan ke
        management_clients.industry). Termasuk jumlah akun template.
    GET /api/v1/management/coa-industries/{template_id}/accounts
        Isi akun 1 template (preview).

Saat client dibuat (POST /api/v1/management/clients), COA-nya otomatis
diisi dari template industri yang dipilih -- lihat
db_client.create_management_client / salin_coa_template_industri.

Baca cukup token valid.
"""

from __future__ import annotations

from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses

router = APIRouter(prefix="/api/v1/management/coa-industries", tags=["management-coa-industries-v1"])

TPL = dbc.ManagementCoaIndustryTemplate
AKUN = dbc.ManagementCoaIndustryTemplateAccount


@router.get("", summary="Daftar industri + template COA default-nya")
def daftar_industri(_current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        jumlah = dict(
            session.query(AKUN.template_id, func.count(AKUN.id)).group_by(AKUN.template_id).all()
        )
        rows = session.query(TPL).filter(TPL.is_active.is_(True)).order_by(TPL.kbli_category).all()
        return sukses(data=[{
            "id": t.id,
            "kbli_category": t.kbli_category,
            "name": t.industry_name_en,
            "name_id": t.industry_name_id,
            "template_sheet": t.template_sheet,
            "account_count": int(jumlah.get(t.id, 0)),
            "framework_note": t.framework_note,
        } for t in rows], message="OK")
    finally:
        session.close()


@router.get("/{template_id}/accounts", summary="Akun default 1 template industri")
def akun_template(template_id: UUID, _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        tpl = session.get(TPL, str(template_id))
        if tpl is None:
            return gagal(message="Template industri tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        rows = session.query(AKUN).filter(AKUN.template_id == tpl.id).order_by(AKUN.sort_order).all()
        return sukses(data=[{
            "acc_no": a.acc_no,
            "account_name": a.account_name,
            "account_classification": a.account_classification,
            "account_head": a.account_head,
            "account_sub": a.account_sub,
            "normal_balance": a.normal_balance,
            "standard_account_code": a.standard_account_code,
        } for a in rows], message="OK")
    finally:
        session.close()
