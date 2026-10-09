"""
modules/financial_statements/general_ledger_v1.py
===================================================
Report "General Ledger" (Buku Besar) -- halaman src/app/reports/general-ledger:

    GET /api/v1/reports/general-ledger

Sumber data SAMA PERSIS dengan Financial Statements & saldo di halaman COA:
db_client.ambil_baris_jurnal_posted_transaksi (Journal Entry termasuk Opening
Balance & jurnal Cash & Bank, Sales, Purchase -- hanya yang POSTED). Jadi saldo
akhir tiap akun di sini selalu cocok dengan Trial Balance.

Aturan saldo (rule user 2026-10-07), jenis akun ditentukan KEPALA kode akun
(digit pertama, sama dengan core.klasifikasi_akun):
    - Kepala 4-9 = akun Laba Rugi (PNL): TERAKUMULASI sejak awal tahun buku --
      1 Januari tahun start_date kalau pembukuan klien mulai awal tahun, atau
      bulan PERTAMA pembukuan klien (bulan transaksi posted paling awal, mis.
      tanggal jurnal Opening Balance) kalau klien mulai di pertengahan tahun.
      Mutasi tahun-tahun sebelumnya tidak ikut (sudah "ditutup").
    - Kepala 1-3 = akun Posisi Keuangan (neraca): saldo kumulatif sejak awal
      pembukuan, dilaporkan PER BULAN -- tiap akun membawa `monthly` (mutasi &
      saldo akhir tiap bulan dalam periode).
    - Kode tanpa kepala 1-9: pakai klasifikasi COA / heuristik nama.

Saldo dikirim BERTANDA (debit - kredit); frontend menampilkannya sebagai
Dr/Cr. normal_balance akun diambil dari master COA klien
(management_client_coa), fallback ke heuristik core.klasifikasi_akun untuk
kode akun yang tidak ada di COA.

Filter "include":
    with_activity  akun yang punya transaksi dalam periode (default)
    non_zero       akun yang punya saldo awal ATAU transaksi dalam periode
    all            semua akun COA klien (+ akun di jurnal yang tidak ada di COA)
    selected       hanya akun di `account_codes` (dipisah koma)
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Set

from fastapi import APIRouter, Depends, Query

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import core
from .v1 import _filter_pemilik

logger = get_module_logger("general_ledger_v1")

router = APIRouter(prefix="/api/v1/reports/general-ledger", tags=["reports-general-ledger-v1"])

MODE_INCLUDE = ("with_activity", "non_zero", "all", "selected")

# Klasifikasi COA yang termasuk Laba Rugi (saldo awal direset tiap awal tahun).
_KLASIFIKASI_LABA_RUGI = {"REVENUE", "COST OF SALES", "EXPENSE", "OTHER INCOME", "OTHER EXPENSE", "INCOME TAX"}

_LABEL_SUMBER = {"journal_entry": "Journal Entry", "sales": "Sales", "purchase": "Purchase"}


def _r(v: float) -> float:
    return round(v, 2) + 0.0


def _laba_rugi_dari_kepala(kode: str) -> Optional[bool]:
    """Kepala kode 4-9 -> True (PNL), 1-3 -> False (posisi keuangan), lainnya None."""
    digit = core._digit_kode(kode)[:1]
    if digit in ("1", "2", "3"):
        return False
    if digit in ("4", "5", "6", "7", "8", "9"):
        return True
    return None


def _info_akun(kode: str, nama: Optional[str], coa: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Nama, klasifikasi, saldo normal & status laba-rugi 1 akun."""
    info = _info_akun_dasar(kode, nama, coa)
    kepala = _laba_rugi_dari_kepala(kode)
    if kepala is not None:
        info["laba_rugi"] = kepala
    return info


def _info_akun_dasar(kode: str, nama: Optional[str], coa: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if coa:
        klasifikasi = (coa.get("account_classification") or "").upper()
        normal = (coa.get("normal_balance") or "").upper()
        if normal not in ("DEBIT", "CREDIT"):
            normal = "CREDIT" if klasifikasi in ("LIABILITY", "EQUITY", "REVENUE", "OTHER INCOME") else "DEBIT"
        return {
            "account_name": coa.get("account_name") or nama or kode,
            "classification": klasifikasi or None,
            "normal_balance": normal,
            "laba_rugi": klasifikasi in _KLASIFIKASI_LABA_RUGI,
        }
    info = core.klasifikasi_akun(kode, nama)
    return {
        "account_name": (nama or "").strip() or kode,
        "classification": None,
        "normal_balance": "DEBIT" if info["saldo_normal"] == "D" else "CREDIT",
        "laba_rugi": info["kategori"] in ("PENDAPATAN", "BEBAN"),
    }


def awal_akumulasi_pnl(baris: List[Dict[str, Any]], mulai: date) -> date:
    """Awal akumulasi akun PNL untuk periode yang mulai `mulai`: 1 Januari
    tahun itu, KECUALI pembukuan klien baru mulai di pertengahan tahun itu ->
    tanggal 1 bulan transaksi posted paling awal."""
    awal_tahun = date(mulai.year, 1, 1)
    tanggal = [b["tanggal"] for b in baris if b.get("tanggal")]
    if not tanggal:
        return awal_tahun
    pertama = min(tanggal)
    return max(awal_tahun, date(pertama.year, pertama.month, 1))


def _rekap_bulanan(saldo_awal: float, lines: List[Dict[str, Any]], mulai: date, akhir: date) -> List[Dict[str, Any]]:
    """Akun posisi keuangan per bulan: mutasi debit/kredit & saldo akhir tiap
    bulan dalam periode (bulan tanpa transaksi tetap muncul, saldo terbawa)."""
    per_bulan: Dict[str, List[float]] = {}
    for line in lines:
        t = per_bulan.setdefault(line["date"][:7], [0.0, 0.0])
        t[0] += line["debit"]
        t[1] += line["credit"]
    hasil = []
    jalan = saldo_awal
    tahun, bulan = mulai.year, mulai.month
    while (tahun, bulan) <= (akhir.year, akhir.month):
        kunci = f"{tahun:04d}-{bulan:02d}"
        debit, kredit = per_bulan.get(kunci, [0.0, 0.0])
        jalan += debit - kredit
        hasil.append({"month": kunci, "debit": _r(debit), "credit": _r(kredit), "closing_balance": _r(jalan)})
        tahun, bulan = (tahun + 1, 1) if bulan == 12 else (tahun, bulan + 1)
    return hasil


def susun_general_ledger(
    baris: Iterable[Dict[str, Any]],
    coa: List[Dict[str, Any]],
    mulai: date,
    akhir: date,
    include: str = "with_activity",
    kode_terpilih: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    """Kelompokkan baris jurnal posted per akun -> saldo awal, rincian
    transaksi periode [mulai, akhir] dengan saldo berjalan, saldo akhir.
    Tanpa akses DB supaya gampang dites."""
    baris = list(baris)
    coa_per_kode = {str(c["acc_no"]).strip(): c for c in coa if c.get("acc_no")}
    awal_pnl = awal_akumulasi_pnl(baris, mulai)

    akun: Dict[str, Dict[str, Any]] = {}

    def ambil(kode: str, nama: Optional[str]) -> Dict[str, Any]:
        if kode not in akun:
            akun[kode] = {
                "account_code": kode,
                **_info_akun(kode, nama, coa_per_kode.get(kode)),
                "opening_balance": 0.0,
                "total_debit": 0.0,
                "total_credit": 0.0,
                "lines": [],
            }
        return akun[kode]

    for b in baris:
        tgl = b.get("tanggal")
        if not tgl or tgl > akhir:
            continue
        kode = str(b.get("account_code") or "").strip() or "(no code)"
        a = ambil(kode, b.get("account_name"))
        debit, kredit = float(b.get("debit") or 0), float(b.get("kredit") or 0)
        if tgl < mulai:
            if a["laba_rugi"] and tgl < awal_pnl:
                continue  # laba rugi sebelum awal tahun buku sudah "ditutup"
            a["opening_balance"] += debit - kredit
            continue
        a["total_debit"] += debit
        a["total_credit"] += kredit
        a["lines"].append({
            "date": tgl.isoformat(),
            "source": _LABEL_SUMBER.get(b.get("sumber"), b.get("sumber") or ""),
            "number": b.get("nomor") or "",
            "description": b.get("keterangan") or "",
            "party": b.get("pihak") or "",
            "debit": _r(debit),
            "credit": _r(kredit),
        })

    if include in ("all", "selected"):
        for kode, c in coa_per_kode.items():
            if include == "all" or kode in (kode_terpilih or set()):
                ambil(kode, c.get("account_name"))

    hasil: List[Dict[str, Any]] = []
    for kode in sorted(akun):
        a = akun[kode]
        if include == "selected" and kode not in (kode_terpilih or set()):
            continue
        ada_mutasi = bool(a["lines"])
        if include == "with_activity" and not ada_mutasi:
            continue
        if include == "non_zero" and not ada_mutasi and abs(a["opening_balance"]) < 0.005:
            continue
        a["lines"].sort(key=lambda x: (x["date"], x["number"]))
        laba_rugi = a.pop("laba_rugi")
        jalan = a["opening_balance"]
        tahun_jalan = mulai.year
        for line in a["lines"]:
            tahun = int(line["date"][:4])
            if laba_rugi and tahun != tahun_jalan:
                # Periode melewati pergantian tahun: akun PNL mulai akumulasi baru dari 0.
                jalan = 0.0
                tahun_jalan = tahun
                line["year_reset"] = True
            jalan += line["debit"] - line["credit"]
            line["balance"] = _r(jalan)
        hasil.append({
            **a,
            "balance_basis": "ytd" if laba_rugi else "cumulative",
            # Akun PNL: saldo terakumulasi sejak tanggal ini (awal tahun / bulan pertama klien).
            "accumulated_from": awal_pnl.isoformat() if laba_rugi else None,
            "opening_balance": _r(a["opening_balance"]),
            "total_debit": _r(a["total_debit"]),
            "total_credit": _r(a["total_credit"]),
            "closing_balance": _r(jalan),
            "line_count": len(a["lines"]),
            "monthly": [] if laba_rugi else _rekap_bulanan(a["opening_balance"], a["lines"], mulai, akhir),
        })

    return {
        "accounts": hasil,
        "totals": {
            "accounts": len(hasil),
            "lines": sum(a["line_count"] for a in hasil),
            "debit": _r(sum(a["total_debit"] for a in hasil)),
            "credit": _r(sum(a["total_credit"] for a in hasil)),
        },
    }


@router.get("", summary="General Ledger per akun (saldo awal, transaksi, saldo berjalan, saldo akhir)")
def general_ledger(
    start_date: date = Query(..., description="Awal periode (inklusif)"),
    end_date: date = Query(..., description="Akhir periode (inklusif)"),
    include: str = Query("with_activity", description="with_activity | non_zero | all | selected"),
    account_codes: Optional[str] = Query(None, description="Kode akun dipisah koma; wajib kalau include=selected"),
    management_client_id: Optional[str] = Query(None, description="id management_clients (klien); filter utama"),
    client_id: Optional[str] = Query(None, description="id_user management_users; default user yang login kalau management_client_id kosong"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if start_date > end_date:
        return gagal(message="Start date tidak boleh setelah end date.", errors={"code": "INVALID_DATE_RANGE"}, status_code=400)
    if include not in MODE_INCLUDE:
        return gagal(message=f"include harus salah satu dari: {', '.join(MODE_INCLUDE)}.", errors={"code": "INVALID_INCLUDE"}, status_code=400)
    kode_terpilih = {k.strip() for k in (account_codes or "").split(",") if k.strip()}
    if include == "selected" and not kode_terpilih:
        return gagal(message="Pilih minimal 1 akun.", errors={"code": "ACCOUNT_CODES_REQUIRED"}, status_code=400)

    filter_, error = _filter_pemilik(client_id, management_client_id, current_user)
    if error is not None:
        return error
    try:
        baris = dbc.ambil_baris_jurnal_posted_transaksi(sampai_tanggal=end_date, **filter_)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal membaca transaksi posted untuk general ledger: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    coa = dbc.list_management_client_coa(filter_["management_client_id"]) if filter_["management_client_id"] else []

    data = susun_general_ledger(baris, coa, start_date, end_date, include, kode_terpilih)
    data["filter"] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "include": include,
        "account_codes": sorted(kode_terpilih),
        **filter_,
    }
    return sukses(data=data, message="OK")
