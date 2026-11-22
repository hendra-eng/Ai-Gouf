"""
modules/financial_statements/adjustment_core.py
================================================
Mesin hitung report "Adjustment" (Reports > Adjustment) -- murni Python, tanpa
database (mudah dites), pola sama dengan trial_balance_core.py.

Masukan: baris jurnal hasil db_client.ambil_baris_jurnal_posted_transaksi
(termasuk_penutup=True, sama dengan Trial Balance). Baris Journal Entry membawa
`is_adjustment` (bool); sumber lain tidak punya kuncinya -> dianggap False.

Definisi (periode = tahun buku `year` s.d. akhir `end_month`):
    ADJ        baris jurnal bertanda is_adjustment dengan tanggal dalam periode.
    Unadjusted saldo akun SEBELUM penyesuaian periode ini = semua baris lain
               s.d. akhir periode (jurnal penyesuaian tahun-tahun lalu dianggap
               sudah menjadi bagian saldo). Akun neraca (kepala 1-3) kumulatif
               sejak awal pembukuan; akun Laba Rugi (kepala 4-9) hanya sejak
               1 Januari `year` -- aturan sama dengan Trial Balance.
    Adjusted   Unadjusted + ADJ.

Hanya akun yang tersentuh jurnal penyesuaian yang muncul di `tb_effect`.
Saldo disajikan sebagai kolom Debit ATAU Kredit (saldo bersih).
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any, Callable, Dict, Iterable, List, Optional

MODE_STATUS = ("all", "posted")
_TOLERANSI = 0.005


def akhir_bulan(tahun: int, bulan: int) -> date:
    return date(tahun, bulan, calendar.monthrange(tahun, bulan)[1])


def _r(v: float) -> float:
    return round(v, 2) + 0.0


def _debit_kredit(saldo: float) -> Dict[str, float]:
    """Saldo bersih (debit - kredit) -> {debit, kredit} salah satunya 0."""
    saldo = _r(saldo)
    return {"debit": saldo if saldo > 0 else 0.0, "kredit": -saldo if saldo < 0 else 0.0}


def _kunci_nomor(entri: Dict[str, Any]) -> tuple:
    return (entri["date"], entri["number"] or "")


def susun_adjustment(
    baris: Iterable[Dict[str, Any]],
    info_akun: Callable[[str, Optional[str]], Dict[str, Any]],
    year: int,
    end_month: int,
) -> Dict[str, Any]:
    """Susun daftar jurnal penyesuaian + efeknya ke saldo akun.

    `info_akun(kode, nama)` mengembalikan dict dengan `account_name` dan
    `laba_rugi` (bool) -- di router dipakai general_ledger_v1._info_akun
    (COA klien, fallback heuristik kepala kode)."""
    mulai = date(year, 1, 1)
    akhir = akhir_bulan(year, end_month)

    adj_rows: List[Dict[str, Any]] = []
    lainnya: List[Dict[str, Any]] = []
    for b in baris:
        tgl = b.get("tanggal")
        if not tgl or tgl > akhir:
            continue
        if b.get("is_adjustment") and tgl >= mulai:
            adj_rows.append(b)
        else:
            lainnya.append(b)

    # --- 1) Jurnal penyesuaian, dikelompokkan per jurnal ---
    per_jurnal: Dict[str, Dict[str, Any]] = {}
    for b in adj_rows:
        jid = str(b.get("jurnal_id") or b.get("nomor") or "")
        e = per_jurnal.get(jid)
        if e is None:
            e = per_jurnal[jid] = {
                "id": jid.split(":", 1)[-1],
                "number": b.get("nomor") or "",
                "date": b["tanggal"].isoformat(),
                "description": b.get("keterangan") or "",
                "status": b.get("status") or "",
                "posted": (b.get("status") or "").lower() == "posted",
                "lines": [],
                "total_debit": 0.0,
                "total_kredit": 0.0,
            }
        debit, kredit = float(b.get("debit") or 0), float(b.get("kredit") or 0)
        kode = str(b.get("account_code") or "").strip()
        e["lines"].append({
            "account_code": kode,
            "account_name": info_akun(kode, b.get("account_name")).get("account_name") or kode,
            "description": b.get("keterangan") or "",
            "debit": _r(debit),
            "kredit": _r(kredit),
        })
        e["total_debit"] = _r(e["total_debit"] + debit)
        e["total_kredit"] = _r(e["total_kredit"] + kredit)
    entries = sorted(per_jurnal.values(), key=_kunci_nomor)

    # --- 2) Efek ke saldo per akun ---
    adj_per_akun: Dict[str, List[float]] = {}   # kode -> [debit, kredit]
    nama_akun: Dict[str, Optional[str]] = {}
    for b in adj_rows:
        kode = str(b.get("account_code") or "").strip()
        t = adj_per_akun.setdefault(kode, [0.0, 0.0])
        t[0] += float(b.get("debit") or 0)
        t[1] += float(b.get("kredit") or 0)
        nama_akun.setdefault(kode, b.get("account_name"))

    info_cache: Dict[str, Dict[str, Any]] = {k: info_akun(k, nama_akun.get(k)) for k in adj_per_akun}
    unadj_per_akun: Dict[str, float] = {k: 0.0 for k in adj_per_akun}
    for b in lainnya:
        kode = str(b.get("account_code") or "").strip()
        if kode not in unadj_per_akun:
            continue
        if info_cache[kode].get("laba_rugi") and b["tanggal"] < mulai:
            continue  # akun Laba Rugi: hanya tahun berjalan
        unadj_per_akun[kode] += float(b.get("debit") or 0) - float(b.get("kredit") or 0)

    tb_effect: List[Dict[str, Any]] = []
    tot = {"unadj_debit": 0.0, "unadj_kredit": 0.0, "adj_debit": 0.0, "adj_kredit": 0.0, "adjusted_debit": 0.0, "adjusted_kredit": 0.0}
    efek_laba = 0.0  # kredit - debit pada akun Laba Rugi = pengaruh ke laba bersih
    for kode in sorted(adj_per_akun):
        adj_d, adj_k = adj_per_akun[kode]
        unadj = unadj_per_akun[kode]
        adjusted = unadj + adj_d - adj_k
        u, a = _debit_kredit(unadj), _debit_kredit(adjusted)
        info = info_cache[kode]
        tb_effect.append({
            "account_code": kode,
            "account_name": info.get("account_name") or nama_akun.get(kode) or kode,
            "tipe": "pnl" if info.get("laba_rugi") else "neraca",
            "unadj_debit": u["debit"], "unadj_kredit": u["kredit"],
            "adj_debit": _r(adj_d), "adj_kredit": _r(adj_k),
            "adjusted_debit": a["debit"], "adjusted_kredit": a["kredit"],
        })
        tot["unadj_debit"] += u["debit"]; tot["unadj_kredit"] += u["kredit"]
        tot["adj_debit"] += adj_d; tot["adj_kredit"] += adj_k
        tot["adjusted_debit"] += a["debit"]; tot["adjusted_kredit"] += a["kredit"]
        if info.get("laba_rugi"):
            efek_laba += adj_k - adj_d

    total_debit = _r(sum(e["total_debit"] for e in entries))
    total_kredit = _r(sum(e["total_kredit"] for e in entries))
    belum_posted = sum(1 for e in entries if not e["posted"])
    return {
        "periode": {"year": year, "end_month": end_month, "start_date": mulai.isoformat(), "end_date": akhir.isoformat()},
        "summary": {
            "entry_count": len(entries),
            "line_count": len(adj_rows),
            "total_debit": total_debit,
            "total_kredit": total_kredit,
            "balanced": abs(total_debit - total_kredit) < _TOLERANSI,
            "net_profit_effect": _r(efek_laba),
            "unposted_entries": belum_posted,
        },
        "entries": entries,
        "tb_effect": tb_effect,
        "tb_effect_totals": {k: _r(v) for k, v in tot.items()},
        "has_data": bool(entries),
    }
