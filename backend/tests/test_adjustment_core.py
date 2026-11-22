"""Tes mesin report Adjustment (adjustment_core) -- murni Python, tanpa database."""

import importlib.util
import sys
from datetime import date
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "modules" / "financial_statements" / "adjustment_core.py"
_spec = importlib.util.spec_from_file_location("adjustment_core", _PATH)
adj = importlib.util.module_from_spec(_spec)
sys.modules["adjustment_core"] = adj
_spec.loader.exec_module(adj)


def _info(kode, nama):
    return {"account_name": nama or kode, "laba_rugi": kode[:1] in "456789"}


def _b(jid, nomor, tgl, kode, nama, d=0.0, k=0.0, adjusting=False, status="posted"):
    return {"sumber": "journal_entry", "jurnal_id": jid, "nomor": nomor, "tanggal": tgl, "keterangan": f"ket {nomor}",
            "account_code": kode, "account_name": nama, "debit": d, "kredit": k, "status": status, "is_adjustment": adjusting}


def _baris():
    return [
        # saldo sebelum penyesuaian
        _b("je:1", "JE-1", date(2026, 3, 1), "6-1100", "Salary", d=96_000_000),
        _b("je:1", "JE-1", date(2026, 3, 1), "1-1000", "Cash", k=96_000_000),
        _b("je:2", "JE-2", date(2026, 1, 5), "1-1400", "Prepaid", d=18_000_000),
        _b("je:2", "JE-2", date(2026, 1, 5), "1-1000", "Cash", k=18_000_000),
        # penyesuaian Okt 2026
        _b("je:9", "ADJ-1", date(2026, 10, 31), "6-1100", "Salary", d=12_500_000, adjusting=True, status="draft"),
        _b("je:9", "ADJ-1", date(2026, 10, 31), "2-1300", "Accrued", k=12_500_000, adjusting=True, status="draft"),
        _b("je:10", "ADJ-2", date(2026, 10, 31), "6-2300", "Insurance", d=3_000_000, adjusting=True),
        _b("je:10", "ADJ-2", date(2026, 10, 31), "1-1400", "Prepaid", k=3_000_000, adjusting=True),
        # penyesuaian tahun lalu: bukan ADJ periode ini, sudah menjadi bagian saldo
        _b("je:7", "ADJ-OLD", date(2025, 12, 31), "1-1400", "Prepaid", d=1_000_000, adjusting=True),
        _b("je:7", "ADJ-OLD", date(2025, 12, 31), "2-1300", "Accrued", k=1_000_000, adjusting=True),
        # setelah periode: diabaikan
        _b("je:11", "ADJ-3", date(2026, 12, 31), "6-1100", "Salary", d=999, adjusting=True),
    ]


def test_ringkasan_dan_jurnal():
    r = adj.susun_adjustment(_baris(), _info, 2026, 10)
    s = r["summary"]
    assert s["entry_count"] == 2 and s["line_count"] == 4
    assert s["total_debit"] == s["total_kredit"] == 15_500_000 and s["balanced"]
    assert s["net_profit_effect"] == -15_500_000  # dua beban bertambah
    assert s["unposted_entries"] == 1  # ADJ-1 masih draft
    assert [e["number"] for e in r["entries"]] == ["ADJ-1", "ADJ-2"]


def test_efek_trial_balance():
    r = adj.susun_adjustment(_baris(), _info, 2026, 10)
    per = {a["account_code"]: a for a in r["tb_effect"]}
    assert set(per) == {"6-1100", "2-1300", "6-2300", "1-1400"}
    assert per["6-1100"]["unadj_debit"] == 96_000_000 and per["6-1100"]["adjusted_debit"] == 108_500_000
    # saldo Prepaid: 18jt + 1jt (penyesuaian tahun lalu) - 3jt ADJ
    assert per["1-1400"]["unadj_debit"] == 19_000_000 and per["1-1400"]["adjusted_debit"] == 16_000_000
    # akun kredit: Accrued unadjusted = kredit 1jt (ADJ-OLD), adjusted = kredit 13,5jt
    assert per["2-1300"]["unadj_kredit"] == 1_000_000 and per["2-1300"]["adjusted_kredit"] == 13_500_000
    t = r["tb_effect_totals"]
    assert t["adj_debit"] == t["adj_kredit"] == 15_500_000


def test_akun_laba_rugi_hanya_tahun_berjalan():
    baris = [_b("je:0", "JE-0", date(2025, 6, 1), "6-1100", "Salary", d=5_000_000)] + _baris()
    r = adj.susun_adjustment(baris, _info, 2026, 10)
    per = {a["account_code"]: a for a in r["tb_effect"]}
    assert per["6-1100"]["unadj_debit"] == 96_000_000  # beban 2025 tidak ikut


def test_tanpa_penyesuaian():
    r = adj.susun_adjustment([b for b in _baris() if not b["is_adjustment"]], _info, 2026, 12)
    assert r["has_data"] is False and r["entries"] == [] and r["tb_effect"] == []
