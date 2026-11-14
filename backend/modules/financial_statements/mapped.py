"""
modules/financial_statements/mapped.py
========================================
Mesin hitung Financial Statements BERBASIS MAPPING COA (Task Plan 16-20) --
murni Python tanpa akses DB supaya gampang dites.

Beda dengan core.py (mesin lama, masih dipakai Overview/Analytics/Budget):
core.py mengelompokkan akun dengan kata kunci NAMA akun. Di sini TIDAK ADA
nama akun klien yang di-hard-code -- pengelompokan hanya dari:

    1. management_client_fs_mappings  (override per akun per klien)
    2. master COA klien               (account_classification, account_head,
                                       account_sub, standard_account_code)
    3. management_fs_mapping_rules    (aturan default per prefix
                                       standard_account_code: cash flow,
                                       komponen ekuitas, note CALK)

Akun baru di COA otomatis masuk laporan sesuai head/sub/standard code-nya.
Kode akun di jurnal yang tidak ada di COA tetap dihitung (supaya total
selalu = GL) dengan fallback digit pertama kode, dan di-flag.

Input: baris jurnal POSTED datar (db_client.ambil_baris_jurnal_posted_transaksi)
-- sumber yang sama dengan General Ledger, jadi semua laporan bisa di-drill
sampai transaksi GL.

Aturan saldo (rule user 2026-10-07, sama dengan GL):
    - Akun laba rugi terakumulasi sejak awal tahun buku = 1 Januari, atau
      bulan pertama pembukuan klien kalau mulai pertengahan tahun.
    - Akun posisi keuangan kumulatif sejak awal pembukuan.
    - Laba rugi tahun-tahun lalu yang belum ditutup lewat jurnal tampil di
      ekuitas sebagai saldo laba; laba tahun berjalan dihitung otomatis.

Konvensi angka: saldo internal BERTANDA (debit - kredit). Angka yang
DITAMPILKAN mengikuti sisi normal seksi: aset & beban positif di debit,
liabilitas/ekuitas/pendapatan positif di kredit.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ============================================================
# KATALOG
# ============================================================

SEKSI_NERACA: List[Tuple[str, str]] = [
    ("current_assets", "Current Assets"),
    ("non_current_assets", "Non-current Assets"),
    ("current_liabilities", "Current Liabilities"),
    ("non_current_liabilities", "Non-current Liabilities"),
    ("equity", "Equity"),
]
SEKSI_LABA_RUGI: List[Tuple[str, str]] = [
    ("revenue", "Revenue"),
    ("cost_of_sales", "Cost of Sales"),
    ("operating_expenses", "Operating Expenses"),
    ("other_income", "Other Income"),
    ("other_expense", "Other Expenses"),
    ("income_tax", "Income Tax"),
]
SEKSI_ASET = {"current_assets", "non_current_assets"}
SEKSI_LIABILITAS = {"current_liabilities", "non_current_liabilities"}
# Seksi yang ditampilkan positif di sisi KREDIT.
SEKSI_KREDIT = SEKSI_LIABILITAS | {"equity", "revenue", "other_income"}
SEMUA_SEKSI = {k for k, _ in SEKSI_NERACA} | {k for k, _ in SEKSI_LABA_RUGI}

KOMPONEN_EKUITAS: List[Tuple[str, str]] = [
    ("share_capital", "Share Capital"),
    ("additional_paid_in_capital", "Additional Paid-in Capital"),
    ("retained_earnings", "Retained Earnings"),
    ("current_year_earnings", "Current Year Earnings"),
    ("owner_drawings", "Owner Drawings / Dividends"),
    ("oci", "Other Comprehensive Income"),
    ("other_equity", "Other Equity"),
]
KATEGORI_ARUS_KAS: List[Tuple[str, str]] = [
    ("CASH", "Cash & cash equivalents"),
    ("OPERATING", "Operating – working capital"),
    ("NON_CASH", "Operating – non-cash adjustment"),
    ("INVESTING", "Investing"),
    ("FINANCING", "Financing"),
]
LABEL_DEFAULT_ARUS_KAS = {
    "OPERATING": "Changes in other operating assets and liabilities",
    "NON_CASH": "Other non-cash items",
    "INVESTING": "Other investing activities",
    "FINANCING": "Other financing activities",
}

_HEAD_KE_SEKSI = {
    "CURRENT ASSET": "current_assets", "CURRENT ASSETS": "current_assets",
    "NON-CURRENT ASSET": "non_current_assets", "NON-CURRENT ASSETS": "non_current_assets", "NON CURRENT ASSET": "non_current_assets",
    "CURRENT LIABILITY": "current_liabilities", "CURRENT LIABILITIES": "current_liabilities",
    "NON-CURRENT LIABILITY": "non_current_liabilities", "NON-CURRENT LIABILITIES": "non_current_liabilities", "NON CURRENT LIABILITY": "non_current_liabilities",
    "EQUITY": "equity",
}
_KLASIFIKASI_KE_SEKSI_LR = {
    "REVENUE": "revenue", "COST OF SALES": "cost_of_sales", "EXPENSE": "operating_expenses",
    "OTHER INCOME": "other_income", "OTHER EXPENSE": "other_expense", "INCOME TAX": "income_tax",
}
_KLASIFIKASI_NERACA = {"ASSET", "LIABILITY", "EQUITY"}
_DIGIT_KE_SEKSI = {
    "1": "current_assets", "2": "current_liabilities", "3": "equity", "4": "revenue",
    "5": "cost_of_sales", "6": "operating_expenses", "7": "other_income", "8": "other_expense", "9": "income_tax",
}

PERINGATAN = {
    "not_in_coa": "Account code is used in posted journals but does not exist in the client's COA.",
    "unknown_classification": "Account classification is missing or unknown; section derived from the account code.",
    "section_from_classification": "Account head is not a standard financial statement group; section derived from classification.",
    "no_equity_component": "Equity account has no equity component mapping (treated as Other Equity).",
    "no_cash_flow_mapping": "Balance sheet account has no cash flow mapping.",
    "code_head_conflict": "Account code head (first digit) does not match the account classification.",
}


def _r(v: float) -> float:
    return round(v, 2) + 0.0


def _nol(*nilai: Optional[float]) -> bool:
    return all(v is None or abs(v) < 0.005 for v in nilai)


def label_judul(teks: Optional[str]) -> str:
    """'PROPERTY, PLANT & EQUIPMENT' -> 'Property, Plant & Equipment' (sub COA
    ditulis kapital semua). Teks campuran dibiarkan apa adanya."""
    teks = (teks or "").strip()
    if not teks:
        return ""
    if teks.upper() != teks:
        return teks
    return re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda m: m.group(0).capitalize(), teks.lower())


def _slug(teks: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", teks.lower()).strip("_") or "other"


def _digit_pertama(kode: str) -> str:
    angka = re.sub(r"\D", "", kode or "")
    return angka[:1]


# ============================================================
# 1) PETA AKUN (COA + mapping)
# ============================================================

def cocokkan_aturan(standard_code: Optional[str], aturan: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Aturan dengan prefix TERPANJANG yang cocok (batas kata '_')."""
    std = (standard_code or "").strip().lower()
    if not std:
        return None
    terbaik = None
    for a in aturan:
        p = (a.get("standard_account_code") or "").strip().lower()
        if p and (std == p or std.startswith(p + "_")):
            if terbaik is None or len(p) > len(terbaik["standard_account_code"]):
                terbaik = a
    return terbaik


def _seksi_default(c: Dict[str, Any]) -> Tuple[Optional[str], List[str]]:
    klas = (c.get("account_classification") or "").upper().strip()
    head = (c.get("account_head") or "").upper().strip()
    std = (c.get("standard_account_code") or "").lower()
    if klas in _KLASIFIKASI_KE_SEKSI_LR:
        return _KLASIFIKASI_KE_SEKSI_LR[klas], []
    if klas in _KLASIFIKASI_NERACA:
        seksi = _HEAD_KE_SEKSI.get(head)
        if seksi and ((klas == "ASSET") == (seksi in SEKSI_ASET)) and ((klas == "LIABILITY") == (seksi in SEKSI_LIABILITAS)):
            return seksi, []
        if klas == "EQUITY":
            return "equity", ["section_from_classification"]
        tidak_lancar = "noncurrent" in std or "non_current" in std or "NON" in head
        if klas == "ASSET":
            return ("non_current_assets" if tidak_lancar else "current_assets"), ["section_from_classification"]
        return ("non_current_liabilities" if tidak_lancar else "current_liabilities"), ["section_from_classification"]
    return None, ["unknown_classification"]


def jenis_seksi(seksi: str) -> str:
    return "PL" if seksi in dict(SEKSI_LABA_RUGI) else "BS"


def info_akun_coa(c: Dict[str, Any], mapping: Optional[Dict[str, Any]], aturan: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Mapping efektif 1 akun COA: override klien > COA > aturan default."""
    kode = str(c.get("acc_no") or "").strip()
    m = mapping or {}
    aturan_cocok = cocokkan_aturan(c.get("standard_account_code"), aturan) or {}
    seksi, peringatan = _seksi_default(c)
    if seksi is None:
        seksi = _DIGIT_KE_SEKSI.get(_digit_pertama(kode), "current_assets")
    if m.get("fs_section") in SEMUA_SEKSI:
        seksi = m["fs_section"]
        peringatan = [p for p in peringatan if p != "section_from_classification"]
    jenis = jenis_seksi(seksi)

    digit = _digit_pertama(kode)
    if digit and ((digit in "123") != (jenis == "BS")):
        peringatan.append("code_head_conflict")

    komponen = None
    if seksi == "equity":
        komponen = m.get("equity_component") or aturan_cocok.get("equity_component")
        if not komponen:
            peringatan.append("no_equity_component")
    kategori_kas = cash_line = None
    if jenis == "BS":
        kategori_kas = m.get("cash_flow_category") or aturan_cocok.get("cash_flow_category")
        cash_line = m.get("cash_flow_line") or aturan_cocok.get("cash_flow_line")
        if not kategori_kas:
            peringatan.append("no_cash_flow_mapping")
        elif not cash_line:
            cash_line = LABEL_DEFAULT_ARUS_KAS.get(kategori_kas)

    return {
        "coa_id": c.get("id"),
        "code": kode,
        "name": c.get("account_name") or kode,
        "classification": (c.get("account_classification") or "").upper() or None,
        "standard_account_code": c.get("standard_account_code"),
        "in_coa": True,
        "is_active": c.get("is_active", True),
        "jenis": jenis,
        "section": seksi,
        "line": (m.get("fs_line") or "").strip() or label_judul(c.get("account_sub")) or "Other",
        "equity_component": komponen,
        "cash_flow_category": kategori_kas,
        "cash_flow_line": cash_line,
        "note_key": m.get("note_key") or aturan_cocok.get("note_key"),
        "mapping_source": "client" if mapping else ("default" if aturan_cocok else "none"),
        "warnings": peringatan,
    }


def info_akun_luar_coa(kode: str, nama: Optional[str]) -> Dict[str, Any]:
    """Kode akun di jurnal yang tidak ada di COA klien -- fallback digit pertama."""
    seksi = _DIGIT_KE_SEKSI.get(_digit_pertama(kode), "current_assets")
    jenis = jenis_seksi(seksi)
    return {
        "coa_id": None, "code": kode, "name": (nama or "").strip() or kode, "classification": None,
        "standard_account_code": None, "in_coa": False, "is_active": True,
        "jenis": jenis, "section": seksi, "line": "Accounts not in COA",
        "equity_component": None, "cash_flow_category": None, "cash_flow_line": None, "note_key": None,
        "mapping_source": "none",
        "warnings": ["not_in_coa"] + (["no_cash_flow_mapping"] if jenis == "BS" else []),
    }


def susun_peta_akun(coa: List[Dict[str, Any]], mapping_klien: Dict[str, Dict[str, Any]], aturan: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """kode akun -> info mapping efektif. mapping_klien di-key coa_id."""
    peta: Dict[str, Dict[str, Any]] = {}
    for c in coa:
        kode = str(c.get("acc_no") or "").strip()
        if kode:
            peta[kode] = info_akun_coa(c, mapping_klien.get(c.get("id")), aturan)
    return peta


# ============================================================
# 2) BUKU (saldo & mutasi cepat per akun)
# ============================================================

class Buku:
    """Indeks baris jurnal per akun: tanggal terurut + saldo kumulatif
    (debit - kredit) supaya saldo/mutasi per tanggal cukup bisect."""

    def __init__(self, baris: Iterable[Dict[str, Any]], peta: Dict[str, Dict[str, Any]]):
        self.peta = dict(peta)
        per_akun: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for b in baris:
            if not b.get("tanggal"):
                continue
            kode = str(b.get("account_code") or "").strip() or "(no code)"
            if kode not in self.peta:
                self.peta[kode] = info_akun_luar_coa(kode, b.get("account_name"))
            per_akun[kode].append(b)
        self.baris: Dict[str, List[Dict[str, Any]]] = {}
        self._tgl: Dict[str, List[date]] = {}
        self._kum: Dict[str, List[float]] = {}
        semua_tgl = []
        for kode, daftar in per_akun.items():
            daftar.sort(key=lambda b: (b["tanggal"], b.get("nomor") or ""))
            self.baris[kode] = daftar
            self._tgl[kode] = [b["tanggal"] for b in daftar]
            jalan, kum = 0.0, []
            for b in daftar:
                jalan += float(b.get("debit") or 0) - float(b.get("kredit") or 0)
                kum.append(jalan)
            self._kum[kode] = kum
            semua_tgl.append(daftar[0]["tanggal"])
        self.awal_pembukuan: Optional[date] = min(semua_tgl) if semua_tgl else None
        self.ada_data = bool(semua_tgl)

    # --- dasar ---
    def saldo(self, kode: str, sampai: Optional[date]) -> float:
        """Saldo bertanda s.d. `sampai` (inklusif)."""
        if sampai is None or kode not in self._tgl:
            return 0.0
        i = bisect_right(self._tgl[kode], sampai)
        return self._kum[kode][i - 1] if i else 0.0

    def mutasi(self, kode: str, dari: date, sampai: date, segmen: Optional[Tuple[str, str]] = None) -> float:
        """Mutasi bertanda dalam [dari, sampai]; `segmen` = (tipe, nilai)."""
        if sampai < dari:
            return 0.0
        if segmen is None:
            return self.saldo(kode, sampai) - self.saldo(kode, dari - timedelta(days=1))
        tipe, nilai = segmen
        total = 0.0
        for b in self.baris.get(kode, []):
            if dari <= b["tanggal"] <= sampai and _cocok_segmen(b, tipe, nilai):
                total += float(b.get("debit") or 0) - float(b.get("kredit") or 0)
        return total

    def akun(self, jenis: Optional[str] = None) -> List[Tuple[str, Dict[str, Any]]]:
        return sorted(((k, v) for k, v in self.peta.items() if jenis is None or v["jenis"] == jenis), key=lambda x: x[0])

    # --- laba rugi (kredit - debit) ---
    def awal_pnl(self, tgl: date) -> date:
        """Awal akumulasi akun laba rugi untuk tanggal `tgl`: 1 Januari, atau
        bulan pertama pembukuan kalau klien mulai di pertengahan tahun itu."""
        awal_tahun = date(tgl.year, 1, 1)
        # Pembukuan yang baru mulai SESUDAH `tgl` tidak menggeser awal (periode tetap valid, isinya kosong).
        if self.awal_pembukuan and self.awal_pembukuan.year == tgl.year and self.awal_pembukuan <= tgl:
            return max(awal_tahun, date(self.awal_pembukuan.year, self.awal_pembukuan.month, 1))
        return awal_tahun

    def jurnal_tidak_seimbang(self, sampai: date) -> List[Dict[str, Any]]:
        """Jurnal posted s.d. `sampai` yang total debit != kredit -- penyebab
        Balance Sheet / Cash Flow tidak seimbang."""
        per_jurnal: Dict[str, Dict[str, Any]] = {}
        for daftar in self.baris.values():
            for b in daftar:
                if b["tanggal"] > sampai:
                    continue
                j = per_jurnal.setdefault(b.get("jurnal_id") or f"{b.get('nomor')}|{b['tanggal']}", {
                    "number": b.get("nomor") or "", "date": b["tanggal"].isoformat(), "source": b.get("sumber"),
                    "debit": 0.0, "credit": 0.0,
                })
                j["debit"] += float(b.get("debit") or 0)
                j["credit"] += float(b.get("kredit") or 0)
        hasil = []
        for j in per_jurnal.values():
            selisih = j["debit"] - j["credit"]
            if abs(selisih) >= 0.005:
                hasil.append({**j, "debit": _r(j["debit"]), "credit": _r(j["credit"]), "difference": _r(selisih)})
        return sorted(hasil, key=lambda j: (j["date"], j["number"]))

    def laba(self, dari: date, sampai: date, segmen: Optional[Tuple[str, str]] = None) -> float:
        return -sum(self.mutasi(k, dari, sampai, segmen) for k, _ in self.akun("PL"))

    def laba_sd(self, tgl: date) -> float:
        return -sum(self.saldo(k, tgl) for k, _ in self.akun("PL"))

    def laba_berjalan(self, tgl: date) -> float:
        """Laba tahun berjalan per `tgl` (YTD)."""
        return self.laba(self.awal_pnl(tgl), tgl)

    def laba_tahun_lalu(self, tgl: date) -> float:
        """Laba s.d. akhir tahun sebelum `tgl` yang belum ditutup lewat jurnal."""
        return self.laba_sd(date(tgl.year, 1, 1) - timedelta(days=1))

    def segmen_tersedia(self) -> Dict[str, List[str]]:
        hasil: Dict[str, set] = defaultdict(set)
        for daftar in self.baris.values():
            for b in daftar:
                for tipe, nilai in (b.get("segmen") or {}).items():
                    if nilai and str(nilai).strip():
                        hasil[tipe].add(str(nilai).strip())
        return {k: sorted(v) for k, v in hasil.items()}


def _cocok_segmen(b: Dict[str, Any], tipe: str, nilai: str) -> bool:
    v = (b.get("segmen") or {}).get(tipe)
    return v is not None and str(v).strip().lower() == nilai.strip().lower()


def tampil(info: Dict[str, Any], bertanda: float) -> float:
    """Saldo bertanda -> angka tampilan sesuai sisi normal seksi akun."""
    return -bertanda if info["section"] in SEKSI_KREDIT else bertanda


def _baris_akun(info: Dict[str, Any], amount: float, compare: Optional[float], **lain) -> Dict[str, Any]:
    return {
        "code": info["code"], "name": info["name"], "coa_id": info["coa_id"],
        "amount": _r(amount), "compare_amount": None if compare is None else _r(compare),
        "warnings": info["warnings"], **lain,
    }


def _rapikan_baris(lines: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    hasil = sorted(lines.values(), key=lambda l: l.pop("_urut"))
    for l in hasil:
        l["amount"] = _r(l["amount"])
        l["compare_amount"] = None if l["compare_amount"] is None else _r(l["compare_amount"])
        l["accounts"].sort(key=lambda a: (a["code"] is None, a["code"] or ""))
    return hasil


def _tambah_ke_baris(lines: Dict[str, Dict[str, Any]], label: str, urut: str, baris_akun: Dict[str, Any], ada_pembanding: bool):
    line = lines.setdefault(label, {
        "key": _slug(label), "label": label, "amount": 0.0,
        "compare_amount": 0.0 if ada_pembanding else None, "accounts": [], "_urut": urut,
    })
    line["_urut"] = min(line["_urut"], urut)
    line["amount"] += baris_akun["amount"]
    if ada_pembanding:
        line["compare_amount"] += baris_akun["compare_amount"] or 0.0
    line["accounts"].append(baris_akun)


def _peringatan_buku(buku: Buku, jenis: Optional[str] = None) -> List[Dict[str, Any]]:
    hasil = []
    for kode, info in buku.akun(jenis):
        for w in info["warnings"]:
            # no_cash_flow_mapping dilaporkan khusus di Cash Flow; code_head_conflict
            # (mis. COA gaya Xero: 711 Accumulated Depreciation = ASSET) cuma
            # informasi di halaman Mapping -- laporan memakai klasifikasi COA.
            if w in ("no_cash_flow_mapping", "code_head_conflict"):
                continue
            hasil.append({"code": w, "account_code": kode, "account_name": info["name"], "message": PERINGATAN.get(w, w)})
    return hasil


# ============================================================
# 3) BALANCE SHEET
# ============================================================

def susun_neraca(buku: Buku, per_tanggal: date, pembanding: Optional[date] = None, tampilkan_nol: bool = False) -> Dict[str, Any]:
    ada_pemb = pembanding is not None
    seksi_lines: Dict[str, Dict[str, Dict[str, Any]]] = {k: {} for k, _ in SEKSI_NERACA}

    for kode, info in buku.akun("BS"):
        cur = tampil(info, buku.saldo(kode, per_tanggal))
        prev = tampil(info, buku.saldo(kode, pembanding)) if ada_pemb else None
        if _nol(cur, prev) and not tampilkan_nol:
            continue
        _tambah_ke_baris(seksi_lines[info["section"]], info["line"], kode, _baris_akun(info, cur, prev, equity_component=info["equity_component"]), ada_pemb)

    # Laba yang belum ditutup lewat jurnal -> baris hitungan di ekuitas,
    # ditaruh di baris COA yang komponennya sama (kalau ada).
    ekuitas = seksi_lines["equity"]
    for komponen, label_baris, nama, fn in (
        ("retained_earnings", "Retained Earnings", "Prior years' profit/(loss) not yet closed", buku.laba_tahun_lalu),
        ("current_year_earnings", "Current Year Earnings", "Current year profit/(loss)", buku.laba_berjalan),
    ):
        cur = fn(per_tanggal)
        prev = fn(pembanding) if ada_pemb else None
        if _nol(cur, prev):
            continue
        target = next((lbl for lbl, l in ekuitas.items() if any(a.get("equity_component") == komponen for a in l["accounts"])), label_baris)
        _tambah_ke_baris(ekuitas, target, "~" + komponen, {
            "code": None, "name": nama, "coa_id": None, "amount": _r(cur), "compare_amount": None if prev is None else _r(prev),
            "warnings": [], "computed": True, "equity_component": komponen,
        }, ada_pemb)

    sections = []
    total = {}
    for key, label in SEKSI_NERACA:
        lines = _rapikan_baris(seksi_lines[key])
        t = sum(l["amount"] for l in lines)
        tp = sum(l["compare_amount"] or 0.0 for l in lines) if ada_pemb else None
        total[key] = (t, tp)
        sections.append({"key": key, "label": label, "lines": lines, "total": _r(t), "compare_total": None if tp is None else _r(tp)})

    def jumlah(keys, idx):
        if idx == 1 and not ada_pemb:
            return None
        return _r(sum(total[k][idx] for k in keys))

    ta, tl, te = (jumlah(SEKSI_ASET, 0), jumlah(SEKSI_LIABILITAS, 0), jumlah({"equity"}, 0))
    tap, tlp, tep = (jumlah(SEKSI_ASET, 1), jumlah(SEKSI_LIABILITAS, 1), jumlah({"equity"}, 1))
    selisih = _r(ta - tl - te)
    selisih_p = None if not ada_pemb else _r(tap - tlp - tep)
    return {
        "as_of": per_tanggal.isoformat(),
        "compare_as_of": pembanding.isoformat() if ada_pemb else None,
        "sections": sections,
        "totals": {
            "assets": ta, "liabilities": tl, "equity": te, "liabilities_and_equity": _r(tl + te),
            "compare_assets": tap, "compare_liabilities": tlp, "compare_equity": tep,
            "compare_liabilities_and_equity": None if not ada_pemb else _r(tlp + tep),
        },
        "check": {
            "balanced": abs(selisih) < 1 and (selisih_p is None or abs(selisih_p) < 1),
            "difference": selisih, "compare_difference": selisih_p,
            "unbalanced_journals": buku.jurnal_tidak_seimbang(per_tanggal) if abs(selisih) >= 1 else [],
        },
        "warnings": _peringatan_buku(buku, "BS"),
    }


# ============================================================
# 4) PROFIT & LOSS
# ============================================================

def bulan_dalam_rentang(dari: date, sampai: date) -> List[Tuple[str, date, date]]:
    hasil = []
    t, b = dari.year, dari.month
    while (t, b) <= (sampai.year, sampai.month):
        awal = max(dari, date(t, b, 1))
        akhir_bln = (date(t + 1, 1, 1) if b == 12 else date(t, b + 1, 1)) - timedelta(days=1)
        hasil.append((f"{t:04d}-{b:02d}", awal, min(sampai, akhir_bln)))
        t, b = (t + 1, 1) if b == 12 else (t, b + 1)
    return hasil


_SUBTOTAL_LR = [
    ("gross_profit", "Gross Profit", lambda s: s["revenue"] - s["cost_of_sales"]),
    ("operating_profit", "Operating Profit", lambda s: s["revenue"] - s["cost_of_sales"] - s["operating_expenses"]),
    ("profit_before_tax", "Profit Before Tax",
     lambda s: s["revenue"] - s["cost_of_sales"] - s["operating_expenses"] + s["other_income"] - s["other_expense"]),
    ("net_profit", "Net Profit",
     lambda s: s["revenue"] - s["cost_of_sales"] - s["operating_expenses"] + s["other_income"] - s["other_expense"] - s["income_tax"]),
]
# Posisi subtotal: setelah seksi ini.
_SUBTOTAL_SETELAH = {"cost_of_sales": "gross_profit", "operating_expenses": "operating_profit", "other_expense": "profit_before_tax", "income_tax": "net_profit"}


def susun_laba_rugi(
    buku: Buku,
    dari: date,
    sampai: date,
    pembanding: Optional[Tuple[date, date]] = None,
    segmen: Optional[Tuple[str, str]] = None,
    bulanan: bool = False,
) -> Dict[str, Any]:
    ada_pemb = pembanding is not None
    bulan = bulan_dalam_rentang(dari, sampai) if bulanan else []
    seksi_lines: Dict[str, Dict[str, Dict[str, Any]]] = {k: {} for k, _ in SEKSI_LABA_RUGI}

    for kode, info in buku.akun("PL"):
        cur = tampil(info, buku.mutasi(kode, dari, sampai, segmen))
        prev = tampil(info, buku.mutasi(kode, pembanding[0], pembanding[1], segmen)) if ada_pemb else None
        if _nol(cur, prev):
            continue
        lain = {}
        if bulanan:
            lain["monthly"] = [_r(tampil(info, buku.mutasi(kode, a, b, segmen))) for _, a, b in bulan]
        _tambah_ke_baris(seksi_lines[info["section"]], info["line"], kode, _baris_akun(info, cur, prev, **lain), ada_pemb)

    sections, nilai, nilai_p, nilai_bln = [], {}, {}, {}
    for key, label in SEKSI_LABA_RUGI:
        lines = _rapikan_baris(seksi_lines[key])
        if bulanan:
            for l in lines:
                l["monthly"] = [_r(sum(a["monthly"][i] for a in l["accounts"])) for i in range(len(bulan))]
        nilai[key] = sum(l["amount"] for l in lines)
        nilai_p[key] = sum(l["compare_amount"] or 0.0 for l in lines)
        nilai_bln[key] = [sum(l["monthly"][i] for l in lines) for i in range(len(bulan))] if bulanan else []
        sections.append({
            "key": key, "label": label, "lines": lines, "total": _r(nilai[key]),
            "compare_total": _r(nilai_p[key]) if ada_pemb else None,
            "monthly": [_r(v) for v in nilai_bln[key]] if bulanan else None,
        })

    subtotal = {}
    for key, label, fn in _SUBTOTAL_LR:
        subtotal[key] = {
            "key": key, "label": label, "amount": _r(fn(nilai)),
            "compare_amount": _r(fn(nilai_p)) if ada_pemb else None,
            "monthly": [_r(fn({k: v[i] for k, v in nilai_bln.items()})) for i in range(len(bulan))] if bulanan else None,
        }

    # Urutan baris laporan untuk ditampilkan apa adanya oleh frontend/export.
    rows = []
    for s in sections:
        rows.append({"type": "section", **s})
        if s["key"] in _SUBTOTAL_SETELAH:
            rows.append({"type": "subtotal", **subtotal[_SUBTOTAL_SETELAH[s["key"]]]})

    return {
        "period": {"start": dari.isoformat(), "end": sampai.isoformat()},
        "compare_period": {"start": pembanding[0].isoformat(), "end": pembanding[1].isoformat()} if ada_pemb else None,
        "segment": {"type": segmen[0], "value": segmen[1]} if segmen else None,
        "months": [m for m, _, _ in bulan],
        "rows": rows,
        "summary": {k: v for k, v in subtotal.items()},
        "warnings": _peringatan_buku(buku, "PL"),
    }


# ============================================================
# 5) STATEMENT OF CHANGES IN EQUITY
# ============================================================

_BARIS_GERAK_EKUITAS = [
    ("capital_injection", "Capital injection / (withdrawal)"),
    ("profit", "Profit/(loss) for the period"),
    ("owner_drawings", "Owner drawings / dividends"),
    ("retained_earnings_transfer", "Transfer of prior year profit to retained earnings"),
    ("retained_earnings_adjustment", "Retained earnings adjustments"),
    ("oci", "Other comprehensive income"),
    ("other_adjustments", "Other adjustments"),
]
_KOMPONEN_KE_GERAK = {
    "share_capital": "capital_injection", "additional_paid_in_capital": "capital_injection",
    "owner_drawings": "owner_drawings", "retained_earnings": "retained_earnings_adjustment",
    "oci": "oci", "current_year_earnings": "other_adjustments", "other_equity": "other_adjustments",
}


def susun_perubahan_ekuitas(buku: Buku, dari: date, sampai: date) -> Dict[str, Any]:
    kemarin = dari - timedelta(days=1)
    kunci_komponen = [k for k, _ in KOMPONEN_EKUITAS]
    buka = {k: 0.0 for k in kunci_komponen}
    gerak: Dict[str, Dict[str, float]] = {r: {k: 0.0 for k in kunci_komponen} for r, _ in _BARIS_GERAK_EKUITAS}
    rincian: Dict[str, Dict[str, List[Dict[str, Any]]]] = {r: defaultdict(list) for r, _ in _BARIS_GERAK_EKUITAS}
    rincian_buka: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for kode, info in buku.akun("BS"):
        if info["section"] != "equity":
            continue
        komponen = info["equity_component"] if info["equity_component"] in buka else "other_equity"
        b = -buku.saldo(kode, kemarin)
        t = -buku.saldo(kode, sampai)
        if _nol(b, t):
            continue
        buka[komponen] += b
        if abs(b) >= 0.005:
            rincian_buka[komponen].append({"code": kode, "name": info["name"], "coa_id": info["coa_id"], "amount": _r(b)})
        if abs(t - b) >= 0.005:
            r = _KOMPONEN_KE_GERAK[komponen]
            gerak[r][komponen] += t - b
            rincian[r][komponen].append({"code": kode, "name": info["name"], "coa_id": info["coa_id"], "amount": _r(t - b)})

    laba_lalu_buka, laba_jalan_buka = buku.laba_tahun_lalu(kemarin), buku.laba_berjalan(kemarin)
    buka["retained_earnings"] += laba_lalu_buka
    buka["current_year_earnings"] += laba_jalan_buka
    for komponen, nilai, nama in (("retained_earnings", laba_lalu_buka, "Prior years' profit/(loss) not yet closed"),
                                  ("current_year_earnings", laba_jalan_buka, "Current year profit/(loss)")):
        if abs(nilai) >= 0.005:
            rincian_buka[komponen].append({"code": None, "name": nama, "coa_id": None, "amount": _r(nilai), "computed": True})

    laba = buku.laba(dari, sampai)
    transfer = laba_jalan_buka + laba - buku.laba_berjalan(sampai)
    gerak["profit"]["current_year_earnings"] += laba
    gerak["retained_earnings_transfer"]["current_year_earnings"] -= transfer
    gerak["retained_earnings_transfer"]["retained_earnings"] += transfer

    tutup = {k: buka[k] + sum(gerak[r][k] for r, _ in _BARIS_GERAK_EKUITAS) for k in kunci_komponen}
    aktif = [k for k in kunci_komponen if not _nol(buka[k], tutup[k], *(gerak[r][k] for r, _ in _BARIS_GERAK_EKUITAS))]
    if not aktif:
        aktif = ["retained_earnings", "current_year_earnings"]

    def baris(key, label, nilai: Dict[str, float], drill: Optional[Dict[str, List[Dict[str, Any]]]] = None, jenis="movement"):
        return {
            "key": key, "label": label, "type": jenis,
            "values": {k: _r(nilai[k]) for k in aktif},
            "total": _r(sum(nilai[k] for k in kunci_komponen)),
            "accounts": {k: (drill or {}).get(k, []) for k in aktif},
        }

    rows = [baris("opening", f"Balance as at {kemarin.isoformat()}", buka, rincian_buka, "opening")]
    for r, label in _BARIS_GERAK_EKUITAS:
        if r == "profit" or not _nol(*gerak[r].values()):
            rows.append(baris(r, label, gerak[r], rincian[r]))
    rows.append(baris("closing", f"Balance as at {sampai.isoformat()}", tutup, None, "closing"))

    neraca = susun_neraca(buku, sampai)
    ekuitas_neraca = neraca["totals"]["equity"]
    total_tutup = _r(sum(tutup.values()))
    return {
        "period": {"start": dari.isoformat(), "end": sampai.isoformat()},
        "components": [{"key": k, "label": dict(KOMPONEN_EKUITAS)[k]} for k in aktif],
        "rows": rows,
        "check": {
            "closing_equity": total_tutup,
            "balance_sheet_equity": ekuitas_neraca,
            "difference": _r(total_tutup - ekuitas_neraca),
            "reconciled": abs(total_tutup - ekuitas_neraca) < 1,
        },
        "warnings": [w for w in _peringatan_buku(buku, "BS") if w["code"] == "no_equity_component"],
    }


# ============================================================
# 6) CASH FLOW (metode tidak langsung)
# ============================================================

def susun_arus_kas(buku: Buku, dari: date, sampai: date) -> Dict[str, Any]:
    kemarin = dari - timedelta(days=1)
    akun_kas = [(k, i) for k, i in buku.akun("BS") if i["cash_flow_category"] == "CASH"]
    kas_awal = sum(buku.saldo(k, kemarin) for k, _ in akun_kas)
    kas_akhir = sum(buku.saldo(k, sampai) for k, _ in akun_kas)
    laba = buku.laba(dari, sampai)

    grup: Dict[str, Dict[str, Dict[str, Any]]] = {g: {} for g in ("NON_CASH", "OPERATING", "UNMAPPED", "INVESTING", "FINANCING")}
    for kode, info in buku.akun("BS"):
        kategori = info["cash_flow_category"]
        if kategori == "CASH":
            continue
        awal, akhir = buku.saldo(kode, kemarin), buku.saldo(kode, sampai)
        delta = akhir - awal
        if abs(delta) < 0.005:
            continue
        efek = -delta  # aset naik = kas keluar; liabilitas/ekuitas naik = kas masuk
        g = kategori if kategori in grup else "UNMAPPED"
        label = "Accounts without cash flow mapping" if g == "UNMAPPED" else (info["cash_flow_line"] or LABEL_DEFAULT_ARUS_KAS[g])
        line = grup[g].setdefault(label, {"key": _slug(label), "label": label, "amount": 0.0, "accounts": [], "_urut": kode})
        line["amount"] += efek
        line["accounts"].append({
            "code": kode, "name": info["name"], "coa_id": info["coa_id"], "section": info["section"],
            "opening": _r(tampil(info, awal)), "closing": _r(tampil(info, akhir)), "amount": _r(efek),
            "warnings": info["warnings"],
        })

    def daftar(g):
        hasil = sorted(grup[g].values(), key=lambda l: l.pop("_urut"))
        for l in hasil:
            l["amount"] = _r(l["amount"])
            l["accounts"].sort(key=lambda a: a["code"])
        return hasil

    non_kas, modal_kerja, tanpa_map = daftar("NON_CASH"), daftar("OPERATING"), daftar("UNMAPPED")
    investasi, pendanaan = daftar("INVESTING"), daftar("FINANCING")
    total_operasi = laba + sum(l["amount"] for l in non_kas + modal_kerja + tanpa_map)
    total_investasi = sum(l["amount"] for l in investasi)
    total_pendanaan = sum(l["amount"] for l in pendanaan)
    kenaikan = total_operasi + total_investasi + total_pendanaan
    kenaikan_aktual = kas_akhir - kas_awal

    akun_tanpa_map = [
        {"code": k, "name": i["name"], "coa_id": i["coa_id"], "section": i["section"], "in_coa": i["in_coa"],
         "has_movement": abs(buku.saldo(k, sampai) - buku.saldo(k, kemarin)) >= 0.005}
        for k, i in buku.akun("BS") if not i["cash_flow_category"]
    ]

    return {
        "period": {"start": dari.isoformat(), "end": sampai.isoformat()},
        "method": "indirect",
        "operating": {
            "net_profit": _r(laba),
            "non_cash_adjustments": non_kas,
            "working_capital": modal_kerja,
            "unmapped": tanpa_map,
            "total": _r(total_operasi),
        },
        "investing": {"lines": investasi, "total": _r(total_investasi)},
        "financing": {"lines": pendanaan, "total": _r(total_pendanaan)},
        "net_change": _r(kenaikan),
        "opening_cash": _r(kas_awal),
        "ending_cash": _r(kas_awal + kenaikan),
        "balance_sheet_ending_cash": _r(kas_akhir),
        "check": {
            "difference": _r(kenaikan - kenaikan_aktual),
            "reconciled": abs(kenaikan - kenaikan_aktual) < 1,
            # Selisih rekonsiliasi hanya bisa berasal dari jurnal yang tidak seimbang.
            "unbalanced_journals": [j for j in buku.jurnal_tidak_seimbang(sampai) if j["date"] >= dari.isoformat()]
            if abs(kenaikan - kenaikan_aktual) >= 1 else [],
        },
        "cash_accounts": [
            {"code": k, "name": i["name"], "coa_id": i["coa_id"],
             "opening": _r(buku.saldo(k, kemarin)), "closing": _r(buku.saldo(k, sampai))}
            for k, i in akun_kas if not _nol(buku.saldo(k, kemarin), buku.saldo(k, sampai))
        ],
        "unmapped_accounts": akun_tanpa_map,
    }


# ============================================================
# 7) CALK (Notes to Financial Statements)
# ============================================================

def isi_placeholder(teks: Optional[str], konteks: Dict[str, str]) -> str:
    if not teks:
        return ""
    return re.sub(r"\{(\w+)\}", lambda m: konteks.get(m.group(1), m.group(0)), teks)


def susun_calk(
    buku: Buku,
    notes: List[Dict[str, Any]],
    overrides: Dict[str, Dict[str, Dict[str, Any]]],
    konten: Dict[str, Dict[str, Any]],
    per_tanggal: date,
    dari: date,
    pembanding: Optional[Tuple[date, date]],
    konteks: Dict[str, str],
) -> Dict[str, Any]:
    """notes: note klien aktif (urut). overrides[note_id][acc_no] = override
    aktif periode ini. konten[note_id] = isi periode (narasi/status).
    Akun BS -> saldo per tanggal; akun laba rugi -> mutasi [dari, per_tanggal].
    Pembanding = (awal, akhir) periode pembanding."""
    hasil = []
    for no, note in enumerate(notes, start=1):
        isi = konten.get(note["id"]) or {}
        narasi_sumber = "period" if isi.get("narrative") else ("client" if note.get("narrative") else "template")
        narasi = isi.get("narrative") or note.get("narrative") or note.get("template_narrative") or ""
        entri = {
            "id": note["id"], "no": no, "note_key": note["note_key"], "title": note["title"],
            "statement": note["statement"], "note_type": note["note_type"], "is_custom": not note.get("template_id"),
            "narrative": isi_placeholder(narasi, konteks), "narrative_raw": narasi, "narrative_source": narasi_sumber,
            "status": isi.get("status") or "draft", "groups": [], "has_override": False,
        }
        if note["note_type"] == "account":
            ov_note = overrides.get(note["id"], {})
            grup: Dict[str, Dict[str, Any]] = {}
            for kode, info in buku.akun():
                if info["note_key"] != note["note_key"]:
                    continue
                if info["jenis"] == "BS":
                    cur = tampil(info, buku.saldo(kode, per_tanggal))
                    prev = tampil(info, buku.saldo(kode, pembanding[1])) if pembanding else None
                else:
                    cur = tampil(info, buku.mutasi(kode, dari, per_tanggal))
                    prev = tampil(info, buku.mutasi(kode, pembanding[0], pembanding[1])) if pembanding else None
                ov = ov_note.get(kode)
                if _nol(cur, prev) and not ov:
                    continue
                tampil_nilai = float(ov["override_value"]) if ov else cur
                g = grup.setdefault(info["line"], {
                    "label": info["line"], "statement": "BALANCE_SHEET" if info["jenis"] == "BS" else "PROFIT_LOSS",
                    "rows": [], "system_total": 0.0, "total": 0.0, "compare_total": 0.0 if pembanding else None, "_urut": kode,
                })
                g["rows"].append({
                    "code": kode, "name": info["name"], "coa_id": info["coa_id"],
                    "system_amount": _r(cur), "amount": _r(tampil_nilai),
                    "compare_amount": None if prev is None else _r(prev),
                    "override": None if not ov else {
                        "id": ov["id"], "override_value": _r(float(ov["override_value"])),
                        "system_value_at_override": None if ov.get("system_value") is None else _r(float(ov["system_value"])),
                        "reason": ov.get("reason"), "created_at": ov.get("created_at"), "created_by_name": ov.get("created_by_name"),
                    },
                })
                g["system_total"] += cur
                g["total"] += tampil_nilai
                if pembanding:
                    g["compare_total"] += prev or 0.0
            groups = sorted(grup.values(), key=lambda g: g.pop("_urut"))
            for g in groups:
                g["rows"].sort(key=lambda r: r["code"])
                g["difference"] = _r(g["total"] - g["system_total"])
                g["system_total"], g["total"] = _r(g["system_total"]), _r(g["total"])
                g["compare_total"] = None if g["compare_total"] is None else _r(g["compare_total"])
                g["reconciled"] = abs(g["difference"]) < 0.005
            entri["groups"] = groups
            entri["has_override"] = any(not g["reconciled"] or any(r["override"] for r in g["rows"]) for g in groups)
        hasil.append(entri)

    # Akun yang punya saldo tapi tidak masuk note mana pun.
    kunci_note = {n["note_key"] for n in notes if n["note_type"] == "account"}
    tanpa_note = []
    for kode, info in buku.akun():
        if info["note_key"] in kunci_note:
            continue
        nilai = buku.saldo(kode, per_tanggal) if info["jenis"] == "BS" else buku.mutasi(kode, dari, per_tanggal)
        if abs(nilai) >= 0.005:
            tanpa_note.append({"code": kode, "name": info["name"], "note_key": info["note_key"], "amount": _r(tampil(info, nilai))})

    return {
        "as_of": per_tanggal.isoformat(),
        "period": {"start": dari.isoformat(), "end": per_tanggal.isoformat()},
        "compare_period": {"start": pembanding[0].isoformat(), "end": pembanding[1].isoformat()} if pembanding else None,
        "notes": hasil,
        "accounts_without_note": tanpa_note,
    }
