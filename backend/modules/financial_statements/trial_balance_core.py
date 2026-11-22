"""
modules/financial_statements/trial_balance_core.py
====================================================
Mesin hitung TRIAL BALANCE (Neraca Saldo) -- MURNI fungsi Python tanpa akses
DB/FastAPI supaya gampang dites. Router ada di trial_balance_v1.py.

Sumber data = baris jurnal yang SAMA dengan General Ledger
(db_client.ambil_baris_jurnal_posted_transaksi). Mode default
`status_filter="all"`: semua transaksi yang sudah masuk Journal Preview
(draft / pending / approved / posted) langsung masuk TB tanpa menunggu Post;
yang rejected / void / cancelled / dihapus tidak ikut. Tiap baris membawa
`status` transaksi sumbernya, jadi TB bisa menampilkan berapa nominal yang
BELUM posted per akun dan ringkasan per status.

Susunan meniru sheet "TB" di Excel PT BIT (tanpa kolom ADJ -- adjustment
nanti dibuat di aplikasi terpisah):

    No Account | Account | Saldo Awal | (Debet, Kredit, Balance) Jan..Des | YTD

Aturan saldo:
    - Akun NERACA (kepala kode 1-3): Balance = saldo kumulatif (saldo awal 1 Jan
      + mutasi sampai bulan itu). Saldo awal = semua jurnal sebelum 1 Jan tahun
      terpilih (termasuk jurnal Opening Balance).
    - Akun LABA RUGI (kepala 4-9): Balance = mutasi bulan itu saja (seperti
      Excel); YTD = jumlah mutasi Jan s.d. bulan akhir.
    - Laba/rugi tahun-tahun sebelumnya yang belum ditutup lewat jurnal penutup
      dibawa sebagai baris "Laba Ditahan Tahun Lalu (belum ditutup)" di ekuitas.
      Jurnal penutup (Year-End Closing) ikut dibaca, jadi tahun yang sudah
      ditutup otomatis nol di akun laba rugi dan pindah ke Retained Earnings.
    - Baris "Current Year Profit / Loss" dihitung otomatis dari akun laba rugi
      (kumulatif), tidak diinput manual.
    - Saldo ditampilkan di sisi normal akun (COA `normal_balance`; fallback
      sisi normal kelompok). Akun kontra (mis. akumulasi penyusutan,
      normal_balance CREDIT di kelompok ASSET) mengurangi total kelompoknya.

Akun yang TIDAK ada di COA klien tetap dihitung (supaya TB = GL), digolongkan
dari digit pertama kode, dan diberi `in_coa=False` + ringkasan `tanpa_coa`.
"""

from __future__ import annotations

import calendar
import re
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Set

NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Status yang dianggap sudah posted (reversed = posted lalu dibalik, jurnal asal + pembaliknya sama-sama posted).
STATUS_POSTED = frozenset({"posted", "reversed"})

MODE_INCLUDE = ("non_zero", "with_activity", "all")
MODE_STATUS = ("all", "posted")

# (kunci, label, tipe, sisi normal default). Urutan = urutan tampil.
GRUP: List[Dict[str, str]] = [
    {"key": "ASSET", "label": "ASSETS", "tipe": "neraca", "normal": "DEBIT"},
    {"key": "LIABILITY", "label": "LIABILITIES", "tipe": "neraca", "normal": "CREDIT"},
    {"key": "EQUITY", "label": "EQUITIES", "tipe": "neraca", "normal": "CREDIT"},
    {"key": "REVENUE", "label": "REVENUE", "tipe": "pnl", "normal": "CREDIT"},
    {"key": "COST OF SALES", "label": "COST OF SALES", "tipe": "pnl", "normal": "DEBIT"},
    {"key": "EXPENSE", "label": "OPERATING EXPENSES", "tipe": "pnl", "normal": "DEBIT"},
    {"key": "OTHER INCOME", "label": "OTHER INCOME", "tipe": "pnl", "normal": "CREDIT"},
    {"key": "OTHER EXPENSE", "label": "OTHER EXPENSE", "tipe": "pnl", "normal": "DEBIT"},
    {"key": "INCOME TAX", "label": "INCOME TAX", "tipe": "pnl", "normal": "DEBIT"},
]
_GRUP_PER_KUNCI = {g["key"]: g for g in GRUP}

_GRUP_DARI_DIGIT = {
    "1": "ASSET", "2": "LIABILITY", "3": "EQUITY", "4": "REVENUE", "5": "COST OF SALES",
    "6": "EXPENSE", "7": "OTHER INCOME", "8": "OTHER EXPENSE", "9": "INCOME TAX",
}


def _r(v: float) -> float:
    """Bulatkan ke 2 desimal & hilangkan -0.0."""
    return round(v, 2) + 0.0


def akhir_bulan(tahun: int, bulan: int) -> date:
    return date(tahun, bulan, calendar.monthrange(tahun, bulan)[1])


def _digit(kode: Optional[str]) -> str:
    return re.sub(r"\D", "", kode or "")


def _grup_dari_klasifikasi(klasifikasi: str) -> Optional[str]:
    """Klasifikasi COA (ASSET/LIABILITY/EQUITY/REVENUE/COST OF SALES/EXPENSE/
    OTHER INCOME/OTHER EXPENSE/INCOME TAX) -> kunci kelompok TB. Toleran
    terhadap variasi penulisan."""
    c = (klasifikasi or "").strip().upper()
    if not c:
        return None
    if c in _GRUP_PER_KUNCI:
        return c
    if "TAX" in c:
        return "INCOME TAX"
    if "OTHER" in c and "INCOME" in c:
        return "OTHER INCOME"
    if "OTHER" in c and "EXPENSE" in c:
        return "OTHER EXPENSE"
    if "COST" in c or "COGS" in c:
        return "COST OF SALES"
    if "ASSET" in c:
        return "ASSET"
    if "LIAB" in c:
        return "LIABILITY"
    if "EQUITY" in c:
        return "EQUITY"
    if "REVENUE" in c or "SALES" in c or "INCOME" in c:
        return "REVENUE"
    if "EXPENSE" in c:
        return "EXPENSE"
    return None


def _grup_dari_nama(nama: str) -> str:
    """Fallback terakhir untuk kode non-angka & tanpa COA (sama semangat dengan core.py)."""
    t = (nama or "").lower()
    if re.search(r"hutang|utang|payable|kewajiban|liabilit", t):
        return "LIABILITY"
    if re.search(r"modal|ekuitas|laba ditahan|equity|capital|prive|dividen", t):
        return "EQUITY"
    if re.search(r"pendapatan|penjualan|revenue|\bsales\b|income", t):
        return "REVENUE"
    if re.search(r"beban|biaya|expense|\bcost\b|hpp", t):
        return "EXPENSE"
    return "ASSET"


def tentukan_grup(kode: str, nama: Optional[str], coa: Optional[Dict[str, Any]]) -> str:
    """Kelompok TB 1 akun: klasifikasi COA klien dulu, lalu digit pertama kode, lalu nama."""
    if coa:
        grup = _grup_dari_klasifikasi(coa.get("account_classification") or "")
        if grup:
            return grup
    grup = _GRUP_DARI_DIGIT.get(_digit(kode)[:1])
    if grup:
        return grup
    return _grup_dari_nama(nama or "")


def _sisi_normal(grup: str, coa: Optional[Dict[str, Any]]) -> str:
    if coa:
        n = (coa.get("normal_balance") or "").strip().upper()
        if n in ("DEBIT", "CREDIT"):
            return n
    return _GRUP_PER_KUNCI[grup]["normal"]


def tentukan_sampai_bulan(baris: Iterable[Dict[str, Any]], tahun: int, hari_ini: Optional[date] = None) -> int:
    """Bulan terakhir periode TB kalau tidak diminta eksplisit: bulan terakhir
    yang ada transaksi di `tahun`; kalau tidak ada -> 12 (tahun lampau) / bulan
    berjalan (tahun ini) / 1 (tahun depan)."""
    aktif = [b["tanggal"].month for b in baris if b.get("tanggal") and b["tanggal"].year == tahun]
    if aktif:
        return max(aktif)
    hari_ini = hari_ini or date.today()
    if tahun < hari_ini.year:
        return 12
    return hari_ini.month if tahun == hari_ini.year else 1


def _belum_posted(status: Optional[str]) -> bool:
    return (status or "").strip().lower() not in STATUS_POSTED


def susun_trial_balance(
    baris: Iterable[Dict[str, Any]],
    coa: List[Dict[str, Any]],
    tahun: int,
    sampai_bulan: int,
    include: str = "non_zero",
) -> Dict[str, Any]:
    """Susun Trial Balance `tahun` s.d. akhir `sampai_bulan` dari baris jurnal
    datar ({sumber, jurnal_id, nomor, tanggal, account_code, account_name,
    debit, kredit, status}). Baris sesudah akhir `sampai_bulan` diabaikan."""
    sampai_bulan = max(1, min(12, int(sampai_bulan)))
    batas = akhir_bulan(tahun, sampai_bulan)
    awal_tahun = date(tahun, 1, 1)
    coa_per_kode = {str(c["acc_no"]).strip(): c for c in coa if c.get("acc_no")}

    akun: Dict[str, Dict[str, Any]] = {}

    def ambil(kode: str, nama: Optional[str]) -> Dict[str, Any]:
        if kode not in akun:
            c = coa_per_kode.get(kode)
            grup = tentukan_grup(kode, nama or (c or {}).get("account_name"), c)
            akun[kode] = {
                "account_code": kode,
                "account_name": ((c or {}).get("account_name") or nama or kode).strip() if (c or nama) else kode,
                "account_head": (c or {}).get("account_head"),
                "group": grup,
                "tipe": _GRUP_PER_KUNCI[grup]["tipe"],
                "normal_balance": _sisi_normal(grup, c),
                "in_coa": c is not None,
                # internal: bertanda (debit - kredit)
                "_awal": 0.0,
                "_debit": [0.0] * 12,
                "_kredit": [0.0] * 12,
                "_bp_debit": 0.0,   # nominal belum posted (s.d. batas)
                "_bp_kredit": 0.0,
                "_bp_baris": 0,
                "ada_mutasi": False,
            }
        elif nama and akun[kode]["account_name"] == kode:
            akun[kode]["account_name"] = nama.strip()
        return akun[kode]

    laba_tahun_lalu_ds = 0.0  # bertanda (debit - kredit) akun laba rugi sebelum tahun terpilih
    total_debit = total_kredit = 0.0
    ringkas_status: Dict[str, Dict[str, Any]] = {}
    jurnal_status: Dict[str, Set[str]] = {}
    ada_data = False

    for b in baris:
        tgl = b.get("tanggal")
        if not tgl or tgl > batas:
            continue
        if b.get("sumber") == "year_end_closing" and tgl >= awal_tahun:
            continue  # penutup tahun terpilih tidak ikut: akun laba rugi tahun itu harus tetap tampil
        ada_data = True
        kode = str(b.get("account_code") or "").strip() or "(no code)"
        debit, kredit = float(b.get("debit") or 0), float(b.get("kredit") or 0)
        a = ambil(kode, b.get("account_name"))
        status = (b.get("status") or "").strip().lower() or "draft"
        total_debit += debit
        total_kredit += kredit

        rs = ringkas_status.setdefault(status, {"status": status, "posted": status in STATUS_POSTED,
                                                 "journals": 0, "lines": 0, "debit": 0.0, "kredit": 0.0})
        rs["lines"] += 1
        rs["debit"] += debit
        rs["kredit"] += kredit
        jurnal_status.setdefault(status, set()).add(str(b.get("jurnal_id") or f"{b.get('nomor')}|{tgl}"))

        if _belum_posted(status):
            a["_bp_debit"] += debit
            a["_bp_kredit"] += kredit
            a["_bp_baris"] += 1

        if tgl < awal_tahun:
            if a["tipe"] == "pnl":
                laba_tahun_lalu_ds += debit - kredit
            else:
                a["_awal"] += debit - kredit
            continue
        m = tgl.month - 1
        a["_debit"][m] += debit
        a["_kredit"][m] += kredit
        a["ada_mutasi"] = True

    for status, rs in ringkas_status.items():
        rs["journals"] = len(jurnal_status.get(status, ()))
        rs["debit"] = _r(rs["debit"])
        rs["kredit"] = _r(rs["kredit"])

    if include == "all":
        for kode, c in coa_per_kode.items():
            ambil(kode, c.get("account_name"))

    # ---- hitung kolom per akun ----
    bulan_ke = range(sampai_bulan)
    hasil_akun: List[Dict[str, Any]] = []
    for kode in sorted(akun):
        a = akun[kode]
        tanda = 1.0 if a["normal_balance"] == "DEBIT" else -1.0  # bertanda -> sisi normal
        neraca = a["tipe"] == "neraca"
        awal = tanda * a["_awal"] if neraca else 0.0
        jalan = a["_awal"] if neraca else 0.0
        bulan: List[Dict[str, float]] = []
        ytd_pnl = 0.0
        for i in bulan_ke:
            d, k = a["_debit"][i], a["_kredit"][i]
            if neraca:
                jalan += d - k
                balance = tanda * jalan
            else:
                balance = tanda * (d - k)
                ytd_pnl += balance
            bulan.append({"debit": _r(d), "kredit": _r(k), "balance": _r(balance)})
        ytd = _r(tanda * jalan) if neraca else _r(ytd_pnl)
        tot_d = sum(a["_debit"][i] for i in bulan_ke)
        tot_k = sum(a["_kredit"][i] for i in bulan_ke)

        tidak_nol = (abs(awal) >= 0.005) or a["ada_mutasi"] or abs(ytd) >= 0.005
        if include == "with_activity" and not a["ada_mutasi"]:
            continue
        if include == "non_zero" and not tidak_nol:
            continue

        hasil_akun.append({
            "account_code": a["account_code"],
            "account_name": a["account_name"],
            "account_head": a["account_head"],
            "group": a["group"],
            "tipe": a["tipe"],
            "normal_balance": a["normal_balance"],
            "in_coa": a["in_coa"],
            "opening_balance": _r(awal),
            "months": bulan,
            "total_debit": _r(tot_d),
            "total_kredit": _r(tot_k),
            "ytd": ytd,
            # nominal yang statusnya BELUM posted (draft/pending/approved), s.d. akhir periode
            "unposted_debit": _r(a["_bp_debit"]),
            "unposted_kredit": _r(a["_bp_kredit"]),
            "unposted_lines": a["_bp_baris"],
        })

    # ---- kelompok + total ----
    groups: List[Dict[str, Any]] = []
    for g in GRUP:
        daftar = [x for x in hasil_akun if x["group"] == g["key"]]
        if not daftar and g["key"] not in ("ASSET", "LIABILITY", "EQUITY", "REVENUE"):
            continue
        # nilai kelompok bertanda ke sisi normal KELOMPOK (akun kontra mengurangi)
        tg = 1.0 if g["normal"] == "DEBIT" else -1.0

        def dlm(x: Dict[str, Any], nilai: float) -> float:
            """Nilai di sisi normal AKUN -> sisi normal KELOMPOK."""
            ta = 1.0 if x["normal_balance"] == "DEBIT" else -1.0
            return nilai * ta * tg

        total_bulan = []
        for i in bulan_ke:
            total_bulan.append({
                "debit": _r(sum(x["months"][i]["debit"] for x in daftar)),
                "kredit": _r(sum(x["months"][i]["kredit"] for x in daftar)),
                "balance": _r(sum(dlm(x, x["months"][i]["balance"]) for x in daftar)),
            })
        groups.append({
            "key": g["key"],
            "label": g["label"],
            "tipe": g["tipe"],
            "normal_balance": g["normal"],
            "accounts": daftar,
            "total": {
                "opening_balance": _r(sum(dlm(x, x["opening_balance"]) for x in daftar)),
                "months": total_bulan,
                "ytd": _r(sum(dlm(x, x["ytd"]) for x in daftar)),
                "unposted_debit": _r(sum(x["unposted_debit"] for x in daftar)),
                "unposted_kredit": _r(sum(x["unposted_kredit"] for x in daftar)),
            },
        })

    def _tot(key: str) -> Dict[str, Any]:
        g = next((x for x in groups if x["key"] == key), None)
        if g is None:
            return {"opening_balance": 0.0, "months": [{"balance": 0.0}] * sampai_bulan, "ytd": 0.0}
        return g["total"]

    # laba rugi per bulan (pendapatan - beban), semua kelompok PNL
    laba_bulan = [0.0] * sampai_bulan
    for g in groups:
        if g["tipe"] != "pnl":
            continue
        tanda = 1.0 if g["normal_balance"] == "CREDIT" else -1.0  # pendapatan +, beban -
        for i in bulan_ke:
            laba_bulan[i] += tanda * g["total"]["months"][i]["balance"]
    laba_kum: List[float] = []
    jalan_laba = 0.0
    for v in laba_bulan:
        jalan_laba += v
        laba_kum.append(jalan_laba)

    laba_lalu = -laba_tahun_lalu_ds  # sisi kredit positif = laba

    t_aset, t_liab, t_ekuitas = _tot("ASSET"), _tot("LIABILITY"), _tot("EQUITY")
    total_aset = [t_aset["months"][i]["balance"] for i in bulan_ke]
    total_le = [
        _r(t_liab["months"][i]["balance"] + t_ekuitas["months"][i]["balance"] + laba_lalu + laba_kum[i])
        for i in bulan_ke
    ]
    kontrol = [_r(total_aset[i] - total_le[i]) for i in bulan_ke]

    tanpa_coa = [x for x in hasil_akun if not x["in_coa"]]
    ringkas = sorted(ringkas_status.values(), key=lambda r: (r["posted"], r["status"]))
    unposted_lines = sum(r["lines"] for r in ringkas if not r["posted"])

    return {
        "periode": {
            "year": tahun,
            "end_month": sampai_bulan,
            "start_date": awal_tahun.isoformat(),
            "end_date": batas.isoformat(),
            "months": NAMA_BULAN[:sampai_bulan],
            "include": include,
        },
        "groups": groups,
        "carry_forward": {
            # laba/rugi tahun lalu yang belum ditutup (sisi kredit positif = laba) -> baris ekuitas
            "prior_year_profit": _r(laba_lalu),
        },
        "current_year_profit": {
            "months": [_r(v) for v in laba_bulan],   # laba bersih tiap bulan
            "cumulative": [_r(v) for v in laba_kum],  # laba berjalan kumulatif (= baris 3300)
            "ytd": _r(laba_kum[-1]) if laba_kum else 0.0,
        },
        "totals": {
            "total_asset": [_r(v) for v in total_aset],
            "total_liabilities_equity": total_le,
            "control": kontrol,
            "total_asset_ytd": _r(total_aset[-1]) if total_aset else 0.0,
            "total_liabilities_equity_ytd": total_le[-1] if total_le else 0.0,
            "control_ytd": kontrol[-1] if kontrol else 0.0,
        },
        "balance_check": {
            "total_debit": _r(total_debit),
            "total_kredit": _r(total_kredit),
            "difference": _r(total_debit - total_kredit),
            "debit_equals_kredit": abs(total_debit - total_kredit) < 1,
            "balance_sheet_balanced": bool(kontrol) and abs(kontrol[-1]) < 1,
        },
        "status_summary": ringkas,
        "unposted": {
            "lines": unposted_lines,
            "has_unposted": unposted_lines > 0,
            "debit": _r(sum(r["debit"] for r in ringkas if not r["posted"])),
            "kredit": _r(sum(r["kredit"] for r in ringkas if not r["posted"])),
        },
        "tanpa_coa": {
            "accounts": len(tanpa_coa),
            "codes": [x["account_code"] for x in tanpa_coa],
            "debit": _r(sum(x["total_debit"] for x in tanpa_coa)),
            "kredit": _r(sum(x["total_kredit"] for x in tanpa_coa)),
            "coa_available": bool(coa_per_kode),
        },
        "has_data": ada_data,
    }