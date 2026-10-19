"""
modules/management/payroll_v1.py
=================================
Halaman Payroll (/payroll): /api/v1/management/payroll/...

    GET    /api/v1/management/payroll?client_id=<uuid>
        Muat SEMUA data payroll 1 company sekaligus: {employees, runs, settings}.
        settings = null kalau belum pernah disimpan (frontend pakai default).
    PUT    /api/v1/management/payroll/settings?client_id=        (min Tahap 5)
        Simpan pengaturan payroll (upsert, 1 baris per company).
    POST   /api/v1/management/payroll/employees?client_id=       (min Tahap 3)
    PUT    /api/v1/management/payroll/employees/{id}             (min Tahap 3)
    DELETE /api/v1/management/payroll/employees/{id}             (min Tahap 3, soft delete)
    POST   /api/v1/management/payroll/runs?client_id=            (min Tahap 3)
        Buat payroll run 1 periode (YYYY-MM). 1 periode = 1 run per company (409 kalau dobel).
    PUT    /api/v1/management/payroll/runs/{id}                  (min Tahap 3)
        Ganti isi `lines` -- HANYA untuk run berstatus draft.
    PUT    /api/v1/management/payroll/runs/{id}/status           (approve min Tahap 4, paid min Tahap 4)
        draft -> approved -> paid. Tidak bisa loncat.
    PUT    /api/v1/management/payroll/runs/{id}/reopen           (min Tahap 5, alasan wajib)
        Mundur SATU langkah: paid -> approved (batalkan pembayaran) atau
        approved -> draft (angka bisa diedit lagi). Dicatat di status_history.
    DELETE /api/v1/management/payroll/runs/{id}                  (min Tahap 3, hanya draft)

Baca cukup token valid (sama seperti endpoint settings lain). Perhitungan
gaji/BPJS/PPh 21 dilakukan di frontend (src/app/payroll/lib/payrollCalc.ts);
backend menyimpan hasilnya sebagai snapshot di `lines` dan MENGHITUNG ULANG
kolom total_* dari snapshot itu. Setelah status approved, `lines` terkunci.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from .clients_v1 import _require_level_v1

router = APIRouter(prefix="/api/v1/management/payroll", tags=["management-payroll-v1"])

LEVEL_KELOLA_DATA = 3      # karyawan & draft payroll
LEVEL_SETUJUI_BAYAR = 4    # approve & tandai dibayar
LEVEL_UBAH_SETTING = 5     # pengaturan tarif/akun
LEVEL_BUKA_KEMBALI = 5     # mundurkan status payroll yang sudah disetujui/dibayar

PTKP_VALID = {"TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"}
STATUS_URUT = ["draft", "approved", "paid"]
RE_PERIODE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# ── Skema input ────────────────────────────────────────────────────────────

class EmployeeInput(BaseModel):
    nip: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=255)
    position: Optional[str] = Field(None, max_length=255)
    department: Optional[str] = Field(None, max_length=255)
    branch: Optional[str] = Field(None, max_length=255)
    employment_type: str = Field("PKWTT", pattern="^(PKWTT|PKWT)$")
    join_date: Optional[date] = None
    npwp: Optional[str] = Field(None, max_length=50)
    ptkp: str = "TK/0"
    base_salary: Decimal = Field(..., gt=0, le=Decimal("1000000000000"))
    fixed_allowance: Decimal = Field(Decimal(0), ge=0, le=Decimal("1000000000000"))
    variable_allowance: Decimal = Field(Decimal(0), ge=0, le=Decimal("1000000000000"))
    bank_name: Optional[str] = Field(None, max_length=100)
    bank_account: Optional[str] = Field(None, max_length=100)
    bpjs_tk: bool = True
    bpjs_kes: bool = True
    is_active: bool = True


class RunCreateInput(BaseModel):
    period: str
    pay_date: date
    lines: List[Dict[str, Any]] = Field(..., min_length=1)


class RunLinesInput(BaseModel):
    lines: List[Dict[str, Any]] = Field(..., min_length=1)


class RunStatusInput(BaseModel):
    status: str


class RunReopenInput(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500, description="Alasan wajib (minimal 5 karakter).")


class SettingsInput(BaseModel):
    settings: Dict[str, Any]


# ── Helper ─────────────────────────────────────────────────────────────────

def _num(v: Any) -> float:
    return float(v) if v is not None else 0.0


def _cek_client(client_id: UUID):
    if dbc.get_management_client_by_id(str(client_id)) is None:
        return gagal(message="Client tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return None


def _employee_ke_dict(e: Any) -> Dict[str, Any]:
    return {
        "id": e.id, "client_id": e.client_id, "nip": e.nip, "name": e.name,
        "position": e.position or "", "department": e.department or "", "branch": e.branch or "",
        "employment_type": e.employment_type, "join_date": e.join_date.isoformat() if e.join_date else "",
        "npwp": e.npwp or "", "ptkp": e.ptkp,
        "base_salary": _num(e.base_salary), "fixed_allowance": _num(e.fixed_allowance),
        "variable_allowance": _num(e.variable_allowance),
        "bank_name": e.bank_name or "", "bank_account": e.bank_account or "",
        "bpjs_tk": bool(e.bpjs_tk), "bpjs_kes": bool(e.bpjs_kes), "is_active": bool(e.is_active),
    }


def _run_ke_dict(r: Any) -> Dict[str, Any]:
    return {
        "id": r.id, "client_id": r.client_id, "period": r.period, "pay_date": r.pay_date.isoformat(),
        "status": r.status, "lines": r.lines or [], "headcount": r.headcount,
        "total_gross": _num(r.total_gross), "total_pph21": _num(r.total_pph21),
        "total_bpjs": _num(r.total_bpjs), "total_net": _num(r.total_net),
        "status_history": r.status_history or [],
        "created_at": r.created_at,
        "approved_at": r.approved_at, "paid_at": r.paid_at,
    }


def _hitung_total(lines: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Hitung ulang total dari snapshot `lines[].computed` (jangan percaya total dari klien)."""
    gross = pph = bpjs = net = 0.0
    for l in lines:
        c = (l or {}).get("computed") or {}
        gross += _num(c.get("grossCash"))
        pph += _num(c.get("pph21"))
        bpjs += _num(c.get("erTotal")) + _num(c.get("eeTotal"))
        net += _num(c.get("netPay"))
    return {"headcount": len(lines), "total_gross": gross, "total_pph21": pph, "total_bpjs": bpjs, "total_net": net}


def _validasi_lines(lines: List[Dict[str, Any]]) -> Optional[str]:
    """Pagar minimal: tiap baris punya employeeId unik + blok computed berisi angka."""
    ids = set()
    for i, l in enumerate(lines, start=1):
        eid = (l or {}).get("employeeId")
        if not eid or not isinstance(eid, str):
            return f"Baris {i}: employeeId wajib diisi."
        if eid in ids:
            return f"Baris {i}: karyawan dobel dalam satu payroll."
        ids.add(eid)
        c = l.get("computed")
        if not isinstance(c, dict):
            return f"Baris {i}: blok 'computed' wajib ada."
        for k in ("grossCash", "pph21", "erTotal", "eeTotal", "netPay"):
            if not isinstance(c.get(k), (int, float)) or isinstance(c.get(k), bool):
                return f"Baris {i}: computed.{k} harus berupa angka."
        if c["netPay"] < 0:
            return f"Baris {i}: take home pay negatif -- periksa potongan."
    return None


def _terapkan_employee(row: Any, p: EmployeeInput) -> Optional[str]:
    if p.ptkp not in PTKP_VALID:
        return f"Status PTKP tidak valid: {p.ptkp}."
    row.nip = p.nip.strip()
    row.name = p.name.strip()
    row.position = (p.position or "").strip() or None
    row.department = (p.department or "").strip() or None
    row.branch = (p.branch or "").strip() or None
    row.employment_type = p.employment_type
    row.join_date = p.join_date
    row.npwp = (p.npwp or "").strip() or None
    row.ptkp = p.ptkp
    row.base_salary = p.base_salary
    row.fixed_allowance = p.fixed_allowance
    row.variable_allowance = p.variable_allowance
    row.bank_name = (p.bank_name or "").strip() or None
    row.bank_account = (p.bank_account or "").strip() or None
    row.bpjs_tk = p.bpjs_tk
    row.bpjs_kes = p.bpjs_kes
    row.is_active = p.is_active
    return None


def _nip_dobel(session: Any, client_id: str, nip: str, kecuali_id: Optional[str] = None) -> bool:
    q = session.query(dbc.ManagementPayrollEmployee).filter(
        dbc.ManagementPayrollEmployee.client_id == client_id,
        dbc.func.lower(dbc.ManagementPayrollEmployee.nip) == nip.strip().lower(),
        dbc.ManagementPayrollEmployee.deleted_at.is_(None),
    )
    if kecuali_id:
        q = q.filter(dbc.ManagementPayrollEmployee.id != kecuali_id)
    return q.first() is not None


# ── Muat semua ─────────────────────────────────────────────────────────────

@router.get("", summary="Muat semua data payroll 1 company (karyawan, run, pengaturan)")
def muat_payroll(
    client_id: UUID = Query(..., description="management_clients.id (company terpilih)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    salah = _cek_client(client_id)
    if salah:
        return salah
    cid = str(client_id)
    session = dbc.SessionLocal()
    try:
        emps = (
            session.query(dbc.ManagementPayrollEmployee)
            .filter(dbc.ManagementPayrollEmployee.client_id == cid, dbc.ManagementPayrollEmployee.deleted_at.is_(None))
            .order_by(dbc.ManagementPayrollEmployee.nip)
            .all()
        )
        runs = (
            session.query(dbc.ManagementPayrollRun)
            .filter(dbc.ManagementPayrollRun.client_id == cid)
            .order_by(dbc.ManagementPayrollRun.period)
            .all()
        )
        st = session.query(dbc.ManagementPayrollSetting).filter_by(client_id=cid).first()
        return sukses(data={
            "employees": [_employee_ke_dict(e) for e in emps],
            "runs": [_run_ke_dict(r) for r in runs],
            "settings": st.settings if st else None,
        })
    finally:
        session.close()


# ── Settings ───────────────────────────────────────────────────────────────

@router.put("/settings", summary="Simpan (upsert) pengaturan payroll 1 company")
def simpan_settings(
    payload: SettingsInput,
    client_id: UUID = Query(...),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_UBAH_SETTING)),
):
    salah = _cek_client(client_id)
    if salah:
        return salah
    cid = str(client_id)
    session = dbc.SessionLocal()
    try:
        row = session.query(dbc.ManagementPayrollSetting).filter_by(client_id=cid).first()
        if row is None:
            row = dbc.ManagementPayrollSetting(client_id=cid, created_by=current_user.get("id"), settings=payload.settings)
            session.add(row)
        else:
            row.settings = payload.settings
            row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        session.commit()
        return sukses(data=row.settings, message="Pengaturan payroll disimpan.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Employees ──────────────────────────────────────────────────────────────

@router.post("/employees", summary="Tambah karyawan")
def tambah_karyawan(
    payload: EmployeeInput,
    client_id: UUID = Query(...),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    salah = _cek_client(client_id)
    if salah:
        return salah
    cid = str(client_id)
    session = dbc.SessionLocal()
    try:
        if _nip_dobel(session, cid, payload.nip):
            return gagal(message=f"NIP {payload.nip} sudah dipakai karyawan lain.", errors={"code": "DUPLICATE", "field": "nip"}, status_code=409)
        row = dbc.ManagementPayrollEmployee(client_id=cid, created_by=current_user.get("id"))
        err = _terapkan_employee(row, payload)
        if err:
            return gagal(message=err, errors={"code": "VALIDATION_ERROR"}, status_code=422)
        session.add(row)
        session.commit()
        session.refresh(row)
        return sukses(data=_employee_ke_dict(row), message="Karyawan ditambahkan.", status_code=201)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _ambil_employee(session: Any, employee_id: UUID) -> Optional[Any]:
    return (
        session.query(dbc.ManagementPayrollEmployee)
        .filter(dbc.ManagementPayrollEmployee.id == str(employee_id), dbc.ManagementPayrollEmployee.deleted_at.is_(None))
        .first()
    )


@router.put("/employees/{employee_id}", summary="Ubah karyawan")
def ubah_karyawan(
    employee_id: UUID,
    payload: EmployeeInput,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    session = dbc.SessionLocal()
    try:
        row = _ambil_employee(session, employee_id)
        if row is None:
            return gagal(message="Karyawan tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        if _nip_dobel(session, row.client_id, payload.nip, kecuali_id=row.id):
            return gagal(message=f"NIP {payload.nip} sudah dipakai karyawan lain.", errors={"code": "DUPLICATE", "field": "nip"}, status_code=409)
        err = _terapkan_employee(row, payload)
        if err:
            return gagal(message=err, errors={"code": "VALIDATION_ERROR"}, status_code=422)
        row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        session.commit()
        session.refresh(row)
        return sukses(data=_employee_ke_dict(row), message="Karyawan diperbarui.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.delete("/employees/{employee_id}", summary="Hapus karyawan (soft delete)")
def hapus_karyawan(
    employee_id: UUID,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    session = dbc.SessionLocal()
    try:
        row = _ambil_employee(session, employee_id)
        if row is None:
            return gagal(message="Karyawan tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        row.deleted_at, row.deleted_by = datetime.now(), current_user.get("id")
        session.commit()
        return sukses(data={"id": str(employee_id)}, message="Karyawan dihapus.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Runs ───────────────────────────────────────────────────────────────────

def _catat_status(row: Any, dari: str, ke: str, uid: Any, alasan: Optional[str] = None) -> None:
    """Tambah 1 entri riwayat status (list baru supaya perubahan JSONB terdeteksi SQLAlchemy)."""
    row.status_history = list(row.status_history or []) + [{
        "at": datetime.now().isoformat(timespec="seconds"),
        "by": str(uid) if uid else None,
        "from": dari, "to": ke, "reason": alasan,
    }]


def _isi_total(row: Any, lines: List[Dict[str, Any]]) -> None:
    t = _hitung_total(lines)
    row.headcount, row.total_gross, row.total_pph21 = t["headcount"], t["total_gross"], t["total_pph21"]
    row.total_bpjs, row.total_net = t["total_bpjs"], t["total_net"]


@router.post("/runs", summary="Buat payroll run (1 periode per company)")
def buat_run(
    payload: RunCreateInput,
    client_id: UUID = Query(...),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    salah = _cek_client(client_id)
    if salah:
        return salah
    if not RE_PERIODE.match(payload.period):
        return gagal(message="Periode harus berformat YYYY-MM.", errors={"code": "VALIDATION_ERROR", "field": "period"}, status_code=422)
    err = _validasi_lines(payload.lines)
    if err:
        return gagal(message=err, errors={"code": "VALIDATION_ERROR", "field": "lines"}, status_code=422)
    cid = str(client_id)
    session = dbc.SessionLocal()
    try:
        if session.query(dbc.ManagementPayrollRun).filter_by(client_id=cid, period=payload.period).first():
            return gagal(message=f"Payroll periode {payload.period} sudah ada.", errors={"code": "DUPLICATE", "field": "period"}, status_code=409)
        row = dbc.ManagementPayrollRun(
            client_id=cid, period=payload.period, pay_date=payload.pay_date,
            status="draft", lines=payload.lines, created_by=current_user.get("id"),
        )
        _isi_total(row, payload.lines)
        session.add(row)
        session.commit()
        session.refresh(row)
        return sukses(data=_run_ke_dict(row), message="Payroll run dibuat.", status_code=201)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _ambil_run(session: Any, run_id: UUID) -> Optional[Any]:
    return session.query(dbc.ManagementPayrollRun).filter_by(id=str(run_id)).first()


@router.put("/runs/{run_id}", summary="Ganti isi payroll run (hanya draft)")
def ubah_run(
    run_id: UUID,
    payload: RunLinesInput,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    err = _validasi_lines(payload.lines)
    if err:
        return gagal(message=err, errors={"code": "VALIDATION_ERROR", "field": "lines"}, status_code=422)
    session = dbc.SessionLocal()
    try:
        row = _ambil_run(session, run_id)
        if row is None:
            return gagal(message="Payroll run tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        if row.status != "draft":
            return gagal(message="Payroll yang sudah disetujui tidak bisa diubah.", errors={"code": "LOCKED"}, status_code=409)
        row.lines = payload.lines
        _isi_total(row, payload.lines)
        row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        session.commit()
        session.refresh(row)
        return sukses(data=_run_ke_dict(row), message="Payroll run diperbarui.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.put("/runs/{run_id}/status", summary="Ubah status payroll run: draft -> approved -> paid")
def ubah_status_run(
    run_id: UUID,
    payload: RunStatusInput,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_SETUJUI_BAYAR)),
):
    if payload.status not in STATUS_URUT:
        return gagal(message=f"Status tidak valid: {payload.status}.", errors={"code": "VALIDATION_ERROR", "options": STATUS_URUT}, status_code=422)
    session = dbc.SessionLocal()
    try:
        row = _ambil_run(session, run_id)
        if row is None:
            return gagal(message="Payroll run tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        if STATUS_URUT.index(payload.status) != STATUS_URUT.index(row.status) + 1:
            return gagal(
                message=f"Status tidak bisa diubah dari '{row.status}' ke '{payload.status}'.",
                errors={"code": "INVALID_TRANSITION"}, status_code=409,
            )
        if payload.status == "approved" and not (row.lines or []):
            return gagal(message="Payroll kosong tidak bisa disetujui.", errors={"code": "VALIDATION_ERROR"}, status_code=422)
        now, uid = datetime.now(), current_user.get("id")
        _catat_status(row, row.status, payload.status, uid)
        row.status = payload.status
        if payload.status == "approved":
            row.approved_at, row.approved_by = now, uid
        else:
            row.paid_at, row.paid_by = now, uid
        row.edited_at, row.edited_by = now, uid
        session.commit()
        session.refresh(row)
        return sukses(data=_run_ke_dict(row), message=f"Status payroll: {payload.status}.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.put("/runs/{run_id}/reopen", summary="Buka kembali payroll: paid -> approved, approved -> draft")
def buka_kembali_run(
    run_id: UUID,
    payload: RunReopenInput,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_BUKA_KEMBALI)),
):
    alasan = payload.reason.strip()
    if len(alasan) < 5:
        return gagal(message="Alasan minimal 5 karakter.", errors={"code": "VALIDATION_ERROR", "field": "reason"}, status_code=422)
    session = dbc.SessionLocal()
    try:
        row = _ambil_run(session, run_id)
        if row is None:
            return gagal(message="Payroll run tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        if row.status == "draft":
            return gagal(message="Payroll masih draft, tidak ada yang perlu dibuka kembali.", errors={"code": "INVALID_TRANSITION"}, status_code=409)
        now, uid = datetime.now(), current_user.get("id")
        baru = STATUS_URUT[STATUS_URUT.index(row.status) - 1]
        _catat_status(row, row.status, baru, uid, alasan)
        if row.status == "paid":
            row.paid_at = row.paid_by = None
        else:  # approved -> draft
            row.approved_at = row.approved_by = None
        row.status = baru
        row.edited_at, row.edited_by = now, uid
        session.commit()
        session.refresh(row)
        return sukses(data=_run_ke_dict(row), message=f"Payroll dikembalikan ke status '{baru}'.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.delete("/runs/{run_id}", summary="Hapus payroll run (hanya draft)")
def hapus_run(
    run_id: UUID,
    _current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_KELOLA_DATA)),
):
    session = dbc.SessionLocal()
    try:
        row = _ambil_run(session, run_id)
        if row is None:
            return gagal(message="Payroll run tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
        if row.status != "draft":
            return gagal(message="Hanya payroll berstatus draft yang boleh dihapus.", errors={"code": "LOCKED"}, status_code=409)
        session.delete(row)
        session.commit()
        return sukses(data={"id": str(run_id)}, message="Draft payroll dihapus.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
