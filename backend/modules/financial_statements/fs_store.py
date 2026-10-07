"""
modules/financial_statements/fs_store.py
==========================================
Akses DB untuk Financial Statements berbasis mapping (Task Plan 16-20):
aturan default, mapping per klien, dan framework CALK (note klien, isi per
periode, override angka, audit trail). Tabel: migrations/31-*.py.
Perhitungan ada di mapped.py (tanpa DB).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func

import db_client as dbc
from . import mapped

KOLOM_MAPPING = ("fs_section", "fs_line", "equity_component", "cash_flow_category", "cash_flow_line", "note_key")


def _dict(obj, kolom) -> Dict[str, Any]:
    hasil = {}
    for k in kolom:
        v = getattr(obj, k)
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        hasil[k] = v
    return hasil


def _nama_user(current_user: Dict[str, Any]) -> str:
    return current_user.get("nama") or current_user.get("username") or ""


# ============================================================
# ATURAN & MAPPING
# ============================================================

def daftar_aturan() -> List[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        rows = session.query(dbc.ManagementFsMappingRule).all()
        return [_dict(r, ("id", "standard_account_code", "cash_flow_category", "cash_flow_line", "equity_component", "note_key", "description")) for r in rows]
    finally:
        session.close()


def mapping_klien(client_id: str) -> Dict[str, Dict[str, Any]]:
    """{coa_id: mapping} milik 1 klien."""
    session = dbc.SessionLocal()
    try:
        rows = session.query(dbc.ManagementClientFsMapping).filter(dbc.ManagementClientFsMapping.client_id == client_id).all()
        return {r.coa_id: _dict(r, ("id", "coa_id") + KOLOM_MAPPING + ("edited_at",)) for r in rows}
    finally:
        session.close()


def peta_akun_klien(client_id: str) -> Dict[str, Dict[str, Any]]:
    coa = dbc.list_management_client_coa(client_id)
    return mapped.susun_peta_akun(coa, mapping_klien(client_id), daftar_aturan())


def buat_buku(client_id: str, sampai: Optional[date] = None) -> mapped.Buku:
    """Buku besar posted klien s.d. `sampai` + peta akun COA ter-mapping."""
    baris = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=client_id, sampai_tanggal=sampai)
    return mapped.Buku(baris, peta_akun_klien(client_id))


def coa_milik_klien(client_id: str, coa_id: str) -> Optional[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        c = session.query(dbc.ManagementClientCoa).filter(
            dbc.ManagementClientCoa.id == coa_id,
            dbc.ManagementClientCoa.client_id == client_id,
            dbc.ManagementClientCoa.deleted_at.is_(None),
        ).first()
        return {"id": c.id, "acc_no": c.acc_no, "account_classification": c.account_classification} if c else None
    finally:
        session.close()


def simpan_mapping(client_id: str, coa_id: str, nilai: Dict[str, Optional[str]], user_id: Optional[str]) -> Dict[str, Any]:
    """Upsert mapping 1 akun. Semua kolom NULL -> baris dihapus (kembali ke default)."""
    session = dbc.SessionLocal()
    try:
        M = dbc.ManagementClientFsMapping
        row = session.query(M).filter(M.client_id == client_id, M.coa_id == coa_id).first()
        if all(nilai.get(k) in (None, "") for k in KOLOM_MAPPING):
            if row:
                session.delete(row)
            session.commit()
            return {}
        if row is None:
            row = M(client_id=client_id, coa_id=coa_id, created_by=user_id)
            session.add(row)
        else:
            row.edited_at, row.edited_by = datetime.now(), user_id
        for k in KOLOM_MAPPING:
            setattr(row, k, (nilai.get(k) or None))
        session.commit()
        return _dict(row, ("id", "coa_id") + KOLOM_MAPPING)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def hapus_mapping(client_id: str, coa_id: str) -> bool:
    session = dbc.SessionLocal()
    try:
        M = dbc.ManagementClientFsMapping
        n = session.query(M).filter(M.client_id == client_id, M.coa_id == coa_id).delete()
        session.commit()
        return n > 0
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def terapkan_default(client_id: str, timpa: bool, user_id: Optional[str]) -> Dict[str, int]:
    """Salin aturan default (cash flow, komponen ekuitas, note) ke mapping
    klien untuk SEMUA akun COA-nya -- jadi master per klien yang bisa diedit.
    fs_section/fs_line dibiarkan NULL (ikut head/sub COA). timpa=False:
    akun yang sudah punya mapping dilewati."""
    coa = dbc.list_management_client_coa(client_id)
    aturan = daftar_aturan()
    session = dbc.SessionLocal()
    dibuat = diperbarui = dilewati = tanpa_aturan = 0
    try:
        M = dbc.ManagementClientFsMapping
        ada = {r.coa_id: r for r in session.query(M).filter(M.client_id == client_id).all()}
        for c in coa:
            a = mapped.cocokkan_aturan(c.get("standard_account_code"), aturan)
            if not a:
                tanpa_aturan += 1
                continue
            info = mapped.info_akun_coa(c, None, aturan)
            nilai = {
                "equity_component": a.get("equity_component") if info["section"] == "equity" else None,
                "cash_flow_category": a.get("cash_flow_category") if info["jenis"] == "BS" else None,
                "cash_flow_line": a.get("cash_flow_line") if info["jenis"] == "BS" else None,
                "note_key": a.get("note_key"),
            }
            row = ada.get(c["id"])
            if row is not None and not timpa:
                dilewati += 1
                continue
            if row is None:
                row = M(client_id=client_id, coa_id=c["id"], created_by=user_id)
                session.add(row)
                dibuat += 1
            else:
                row.edited_at, row.edited_by = datetime.now(), user_id
                diperbarui += 1
            for k, v in nilai.items():
                setattr(row, k, v)
        session.commit()
        return {"created": dibuat, "updated": diperbarui, "skipped": dilewati, "without_rule": tanpa_aturan}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============================================================
# CALK -- note klien, isi periode, override, audit
# ============================================================

_KOLOM_NOTE = ("id", "client_id", "template_id", "note_key", "title", "statement", "note_type", "sort_order", "narrative", "is_enabled", "edited_at")


def daftar_template() -> List[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        T = dbc.ManagementFsNoteTemplate
        rows = session.query(T).filter(T.is_active.is_(True)).order_by(T.sort_order).all()
        return [_dict(r, ("id", "note_key", "title", "statement", "note_type", "sort_order", "default_narrative")) for r in rows]
    finally:
        session.close()


def pastikan_note_klien(client_id: str, user_id: Optional[str]) -> int:
    """Salin template yang belum dimiliki klien (termasuk template baru yang
    ditambahkan belakangan). Note yang dihapus user (soft-delete) tidak
    disalin ulang. Return jumlah note yang dibuat."""
    session = dbc.SessionLocal()
    try:
        N = dbc.ManagementClientFsNote
        sudah = {r[0] for r in session.query(N.note_key).filter(N.client_id == client_id).all()}
        dibuat = 0
        for t in session.query(dbc.ManagementFsNoteTemplate).filter(dbc.ManagementFsNoteTemplate.is_active.is_(True)).all():
            if t.note_key in sudah:
                continue
            session.add(N(
                client_id=client_id, template_id=t.id, note_key=t.note_key, title=t.title, statement=t.statement,
                note_type=t.note_type, sort_order=t.sort_order, created_by=user_id,
            ))
            dibuat += 1
        session.commit()
        return dibuat
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def daftar_note_klien(client_id: str, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        N, T = dbc.ManagementClientFsNote, dbc.ManagementFsNoteTemplate
        q = session.query(N, T.default_narrative).outerjoin(T, T.id == N.template_id).filter(
            N.client_id == client_id, N.deleted_at.is_(None))
        if not termasuk_nonaktif:
            q = q.filter(N.is_enabled.is_(True))
        hasil = []
        for n, narasi_template in q.order_by(N.sort_order, N.title).all():
            d = _dict(n, _KOLOM_NOTE)
            d["template_narrative"] = narasi_template
            hasil.append(d)
        return hasil
    finally:
        session.close()


def ambil_note(client_note_id: str) -> Optional[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        n = session.query(dbc.ManagementClientFsNote).filter(
            dbc.ManagementClientFsNote.id == client_note_id, dbc.ManagementClientFsNote.deleted_at.is_(None)).first()
        return _dict(n, _KOLOM_NOTE) if n else None
    finally:
        session.close()


def konten_periode(note_ids: List[str], period_end: date) -> Dict[str, Dict[str, Any]]:
    if not note_ids:
        return {}
    session = dbc.SessionLocal()
    try:
        C = dbc.ManagementClientFsNoteContent
        rows = session.query(C).filter(C.client_note_id.in_(note_ids), C.period_end == period_end).all()
        return {r.client_note_id: _dict(r, ("id", "narrative", "status", "edited_at", "created_at")) for r in rows}
    finally:
        session.close()


def override_periode(note_ids: List[str], period_end: date) -> Dict[str, Dict[str, Dict[str, Any]]]:
    if not note_ids:
        return {}
    session = dbc.SessionLocal()
    try:
        O = dbc.ManagementClientFsNoteOverride
        rows = session.query(O).filter(O.client_note_id.in_(note_ids), O.period_end == period_end, O.deleted_at.is_(None)).all()
        nama = _nama_per_user({r.created_by for r in rows if r.created_by}, session)
        hasil: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for r in rows:
            d = _dict(r, ("id", "row_key", "system_value", "override_value", "reason", "created_at", "created_by"))
            d["created_by_name"] = nama.get(r.created_by)
            hasil.setdefault(r.client_note_id, {})[r.row_key] = d
        return hasil
    finally:
        session.close()


def _nama_per_user(ids, session) -> Dict[str, str]:
    if not ids:
        return {}
    try:
        U = dbc.User
        return {str(u.id_user): (getattr(u, "nama", None) or u.username) for u in session.query(U).filter(U.id_user.in_(list(ids))).all()}
    except Exception:  # noqa: BLE001 -- nama hanya pelengkap tampilan
        return {}


def catat_audit(session, client_id: str, client_note_id: str, action: str, current_user: Dict[str, Any], *,
                period_end: Optional[date] = None, field: Optional[str] = None, old=None, new=None, reason: Optional[str] = None):
    session.add(dbc.ManagementClientFsNoteAudit(
        client_id=client_id, client_note_id=client_note_id, period_end=period_end, action=action, field=field,
        old_value=None if old is None else str(old), new_value=None if new is None else str(new), reason=reason,
        user_id=current_user.get("id"), user_name=_nama_user(current_user),
    ))


def simpan_konten(note: Dict[str, Any], period_end: date, narrative: Optional[str], status: Optional[str], current_user: Dict[str, Any]) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        C = dbc.ManagementClientFsNoteContent
        row = session.query(C).filter(C.client_note_id == note["id"], C.period_end == period_end).first()
        lama_narasi, lama_status = (row.narrative, row.status) if row else (None, None)
        if row is None:
            row = C(client_note_id=note["id"], period_end=period_end, created_by=current_user.get("id"))
            session.add(row)
        else:
            row.edited_at, row.edited_by = datetime.now(), current_user.get("id")
        if narrative is not None:
            row.narrative = narrative.strip() or None
            if (lama_narasi or "") != (row.narrative or ""):
                catat_audit(session, note["client_id"], note["id"], "narrative_update", current_user,
                            period_end=period_end, field="narrative", old=lama_narasi, new=row.narrative)
        if status is not None and status != lama_status:
            row.status = status
            catat_audit(session, note["client_id"], note["id"], "status_update", current_user,
                        period_end=period_end, field="status", old=lama_status, new=status)
        session.commit()
        return _dict(row, ("id", "narrative", "status", "edited_at"))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_note(note: Dict[str, Any], nilai: Dict[str, Any], current_user: Dict[str, Any]) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        n = session.query(dbc.ManagementClientFsNote).filter(dbc.ManagementClientFsNote.id == note["id"]).first()
        for k, v in nilai.items():
            lama = getattr(n, k)
            if lama != v:
                catat_audit(session, n.client_id, n.id, "note_update", current_user, field=k, old=lama, new=v)
                setattr(n, k, v)
        n.edited_at, n.edited_by = datetime.now(), current_user.get("id")
        session.commit()
        return _dict(n, _KOLOM_NOTE)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_note(client_id: str, nilai: Dict[str, Any], current_user: Dict[str, Any]) -> Dict[str, Any]:
    session = dbc.SessionLocal()
    try:
        N = dbc.ManagementClientFsNote
        urut = session.query(func.max(N.sort_order)).filter(N.client_id == client_id).scalar() or 0
        n = N(client_id=client_id, template_id=None, sort_order=nilai.pop("sort_order", None) or urut + 10,
              created_by=current_user.get("id"), **nilai)
        session.add(n)
        session.flush()
        catat_audit(session, client_id, n.id, "note_create", current_user, new=n.title)
        session.commit()
        return _dict(n, _KOLOM_NOTE)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def hapus_note(note: Dict[str, Any], current_user: Dict[str, Any]) -> None:
    session = dbc.SessionLocal()
    try:
        n = session.query(dbc.ManagementClientFsNote).filter(dbc.ManagementClientFsNote.id == note["id"]).first()
        n.deleted_at, n.deleted_by = datetime.now(), current_user.get("id")
        catat_audit(session, n.client_id, n.id, "note_delete", current_user, old=n.title)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def pasang_override(note: Dict[str, Any], period_end: date, row_key: str, nilai: float, system_value: Optional[float],
                    alasan: str, current_user: Dict[str, Any]) -> Dict[str, Any]:
    """Override aktif lama untuk baris yang sama di-soft-delete dulu (riwayat tetap ada)."""
    session = dbc.SessionLocal()
    try:
        O = dbc.ManagementClientFsNoteOverride
        lama = session.query(O).filter(O.client_note_id == note["id"], O.period_end == period_end, O.row_key == row_key,
                                       O.deleted_at.is_(None)).first()
        if lama:
            lama.deleted_at, lama.deleted_by = datetime.now(), current_user.get("id")
            session.flush()
        row = O(client_note_id=note["id"], period_end=period_end, row_key=row_key, system_value=system_value,
                override_value=nilai, reason=alasan, created_by=current_user.get("id"))
        session.add(row)
        catat_audit(session, note["client_id"], note["id"], "override_set", current_user, period_end=period_end,
                    field=row_key, old=float(lama.override_value) if lama else system_value, new=nilai, reason=alasan)
        session.commit()
        return _dict(row, ("id", "row_key", "system_value", "override_value", "reason", "created_at"))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def hapus_override(note: Dict[str, Any], override_id: str, alasan: Optional[str], current_user: Dict[str, Any]) -> bool:
    session = dbc.SessionLocal()
    try:
        O = dbc.ManagementClientFsNoteOverride
        row = session.query(O).filter(O.id == override_id, O.client_note_id == note["id"], O.deleted_at.is_(None)).first()
        if not row:
            return False
        row.deleted_at, row.deleted_by = datetime.now(), current_user.get("id")
        catat_audit(session, note["client_id"], note["id"], "override_remove", current_user, period_end=row.period_end,
                    field=row.row_key, old=float(row.override_value), new=None if row.system_value is None else float(row.system_value), reason=alasan)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def riwayat_audit(client_note_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    session = dbc.SessionLocal()
    try:
        A = dbc.ManagementClientFsNoteAudit
        rows = session.query(A).filter(A.client_note_id == client_note_id).order_by(A.created_at.desc()).limit(limit).all()
        return [_dict(r, ("id", "period_end", "action", "field", "old_value", "new_value", "reason", "user_name", "created_at")) for r in rows]
    finally:
        session.close()
