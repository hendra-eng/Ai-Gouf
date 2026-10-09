"""
modules/financial_statements/core.py
======================================
Mesin hitung laporan keuangan (fitur "Financial Statements") -- MURNI
fungsi Python tanpa akses DB, supaya gampang dites. Inputnya daftar baris
jurnal POSTED datar hasil db_client.ambil_baris_jurnal_posted_transaksi()
(sumber: tabel fitur Transactions -- Journal Entry, Sales, Purchase):

    {sumber, jurnal_id, nomor, tanggal (date), keterangan, pihak,
     account_code, account_name, debit, kredit}

Alur: baris jurnal -> saldo per akun per bulan (neraca saldo) -> Laba
Rugi, Neraca, Arus Kas (langsung & tidak langsung), Perubahan Ekuitas,
CALK. Semua nominal dalam RUPIAH penuh (bukan juta) -- konversi tampilan
urusan frontend.

[PENTING -- klasifikasi akun]
Tabel Transactions tidak menyimpan kategori akun (COA baru belum ada),
jadi kategori diturunkan dari DIGIT PERTAMA kode akun (konvensi COA
Indonesia: 1 Aset, 2 Liabilitas, 3 Ekuitas, 4 Pendapatan, 5/6 Beban,
7 Pendapatan lain, 8 Beban lain, 9 Pajak), fallback kata kunci nama akun
kalau kodenya bukan angka. Pengelompokan detail (Kas, Piutang, Aset
Tetap, Hutang Usaha, dst) & ember laba rugi (HPP/Opex/Penyusutan/Bunga/
Pajak) memakai kata kunci NAMA akun -- best-effort, sama semangatnya
dengan heuristik lama di frontend (useProfitLossData.ts dkk). Akun yang
tidak cocok kata kunci apa pun jatuh ke ember "Lainnya" di kategorinya,
jadi total SELALU persis sama dengan saldo buku besar (tidak ada nominal
yang hilang). Tetap wajib direview akuntan untuk pelaporan resmi.

Laba rugi tahun-tahun sebelumnya yang belum ditutup ke akun Laba Ditahan
otomatis dibawa sebagai "Saldo Laba Tahun Lalu" di ekuitas, supaya Neraca
tetap seimbang tanpa perlu jurnal penutup.
"""

from __future__ import annotations

import calendar
import re
from collections import defaultdict
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

KATEGORI_DEBIT = ("ASET", "BEBAN")  # saldo normal debit; sisanya kredit

# ============================================================
# 1) KLASIFIKASI AKUN
# ============================================================

# (kunci grup, label, pola kata kunci nama akun, lancar?) -- urutan PENTING,
# pola pertama yang cocok menang (mis. "piutang usaha" sebelum "piutang").
_GRUP_ASET = [
    ("akumulasi_penyusutan", "Akumulasi Penyusutan", r"akumulasi|accumulated", False),
    ("kas", "Kas & Setara Kas", r"\bkas\b|kasir|\bbank\b|petty cash|\bcash\b|giro|deposito", True),
    ("piutang_usaha", "Piutang Usaha", r"piutang usaha|piutang dagang|receivable", True),
    ("pajak_dimuka", "Pajak Dibayar Dimuka", r"ppn masukan|pajak dibayar dimuka|pph.*dimuka|vat|input tax|prepaid tax", True),
    ("piutang_lain", "Piutang Lain-lain", r"piutang", True),
    ("persediaan", "Persediaan", r"persediaan|inventory|\bstok\b|stock", True),
    ("dibayar_dimuka", "Biaya Dibayar Dimuka & Uang Muka", r"dibayar dimuka|uang muka|prepaid|advance", True),
    ("aset_tak_berwujud", "Aset Tak Berwujud", r"tak berwujud|intangible|goodwill|lisensi|software", False),
    ("investasi", "Investasi Jangka Panjang", r"investasi|penyertaan|investment", False),
    ("aset_tetap", "Aset Tetap", r"tanah|bangunan|gedung|kendaraan|peralatan|mesin|inventaris|komputer|aset tetap|property|equipment|vehicle|furniture|building", False),
]
_GRUP_LIABILITAS = [
    ("hutang_usaha", "Hutang Usaha", r"hutang usaha|utang usaha|hutang dagang|utang dagang|accounts payable|trade payable", True),
    ("hutang_pajak", "Hutang Pajak", r"ppn keluaran|hutang pajak|utang pajak|pph|tax payable|output tax|\bvat\b", True),
    ("akrual", "Biaya Masih Harus Dibayar", r"\bymh\b|masih harus dibayar|akrual|accrued", True),
    ("diterima_dimuka", "Pendapatan Diterima Dimuka", r"diterima dimuka|unearned|deferred revenue|uang muka pelanggan|customer advance", True),
    ("pihak_berelasi", "Hutang Pihak Berelasi", r"pemegang saham|direksi|direktur|afiliasi|pihak berelasi|related part|shareholder", None),
    ("liabilitas_sewa", "Liabilitas Sewa", r"sewa pembiayaan|liabilitas sewa|lease", None),
    ("imbalan_kerja", "Liabilitas Imbalan Kerja", r"imbalan kerja|employee benefit|pesangon", False),
    ("pinjaman", "Hutang Bank & Pinjaman", r"\bbank\b|pinjaman|\bloan\b|kredit|obligasi|borrowing", None),
]
_GRUP_EKUITAS = [
    ("tambahan_modal", "Tambahan Modal Disetor", r"tambahan modal|agio|additional paid", None),
    ("modal", "Modal Disetor", r"modal|capital|saham|share", None),
    ("laba_ditahan", "Laba Ditahan", r"laba ditahan|saldo laba|retained|laba \(rugi\) ditahan", None),
    ("dividen", "Dividen / Prive", r"dividen|dividend|prive|drawing", None),
]
_EMBER_BEBAN = [
    ("cogs", r"harga pokok|\bhpp\b|cogs|cost of goods|cost of sales|bahan baku|produksi"),
    ("da", r"penyusutan|depresiasi|amortisasi|depreciation|amortization"),
    ("interest", r"beban bunga|biaya bunga|bunga pinjaman|bunga bank|interest expense|\binterest\b"),
    ("tax", r"pajak penghasilan|pph badan|income tax|pph *29|pph *25"),
]

_LABEL_KATEGORI_LAINNYA = {
    ("ASET", True): ("aset_lancar_lain", "Aset Lancar Lainnya"),
    ("ASET", False): ("aset_tidak_lancar_lain", "Aset Tidak Lancar Lainnya"),
    ("LIABILITAS", True): ("liabilitas_pendek_lain", "Liabilitas Jangka Pendek Lainnya"),
    ("LIABILITAS", False): ("liabilitas_panjang_lain", "Liabilitas Jangka Panjang Lainnya"),
}


def _digit_kode(kode: Optional[str]) -> str:
    return re.sub(r"\D", "", kode or "")


def _kategori_dari_nama(nama: str) -> str:
    if re.search(r"hutang|utang|payable|kewajiban|liabilit", nama):
        return "LIABILITAS"
    if re.search(r"modal|ekuitas|laba ditahan|equity|capital|prive|dividen", nama):
        return "EKUITAS"
    if re.search(r"pendapatan|penjualan|revenue|\bsales\b|income", nama):
        return "PENDAPATAN"
    if re.search(r"beban|biaya|expense|\bcost\b|hpp", nama):
        return "BEBAN"
    return "ASET"


def _lancar_dari_kode(digit: str) -> bool:
    """Heuristik lancar/tidak lancar dari kode: COA 8 digit (11xxxxxx vs
    12xxxxxx) atau 4 digit (1100-1499 lancar, 1500+ tidak lancar)."""
    if len(digit) < 2:
        return True
    if len(digit) <= 4:
        return int(digit[1]) <= 4
    return digit[1] == "1"


def klasifikasi_akun(kode: Optional[str], nama: Optional[str]) -> Dict[str, Any]:
    """Kategori, grup, dan status lancar sebuah akun -- lihat catatan modul."""
    teks = (nama or "").lower()
    digit = _digit_kode(kode)
    kategori = {
        "1": "ASET", "2": "LIABILITAS", "3": "EKUITAS", "4": "PENDAPATAN",
        "5": "BEBAN", "6": "BEBAN", "7": "PENDAPATAN", "8": "BEBAN", "9": "BEBAN",
    }.get(digit[:1]) or _kategori_dari_nama(teks)

    hasil: Dict[str, Any] = {
        "kategori": kategori,
        "saldo_normal": "D" if kategori in KATEGORI_DEBIT else "K",
        "grup": None, "label_grup": None, "lancar": None, "ember_laba_rugi": None,
    }

    if kategori in ("ASET", "LIABILITAS"):
        daftar = _GRUP_ASET if kategori == "ASET" else _GRUP_LIABILITAS
        for kunci, label, pola, lancar in daftar:
            if re.search(pola, teks):
                if lancar is None:
                    lancar = not re.search(r"jangka panjang|long.?term", teks) and _lancar_dari_kode(digit)
                hasil.update(grup=kunci, label_grup=label, lancar=lancar)
                break
        else:
            lancar = _lancar_dari_kode(digit) and not re.search(r"jangka panjang|long.?term", teks)
            kunci, label = _LABEL_KATEGORI_LAINNYA[(kategori, lancar)]
            hasil.update(grup=kunci, label_grup=label, lancar=lancar)
    elif kategori == "EKUITAS":
        for kunci, label, pola, _ in _GRUP_EKUITAS:
            if re.search(pola, teks):
                hasil.update(grup=kunci, label_grup=label)
                break
        else:
            hasil.update(grup="ekuitas_lain", label_grup="Ekuitas Lainnya")
    elif kategori == "PENDAPATAN":
        lain = digit[:1] == "7" or bool(re.search(r"lain|bunga|jasa giro|other income|interest income", teks))
        hasil.update(grup="pendapatan_lain" if lain else "pendapatan_usaha",
                     label_grup="Pendapatan Lain-lain" if lain else "Pendapatan Usaha")
    else:  # BEBAN
        ember = next((k for k, pola in _EMBER_BEBAN if re.search(pola, teks)), "opex")
        label = {
            "cogs": "Harga Pokok Penjualan", "da": "Penyusutan & Amortisasi",
            "interest": "Beban Bunga", "tax": "Pajak Penghasilan", "opex": "Beban Operasional",
        }[ember]
        hasil.update(grup=ember, label_grup=label, ember_laba_rugi=ember)
    return hasil


def _is_kas(info: Dict[str, Any]) -> bool:
    return info["kategori"] == "ASET" and info["grup"] == "kas"


# ============================================================
# 2) NERACA SALDO (saldo per akun per bulan)
# ============================================================

def _r(v: float) -> float:
    """Bulatkan ke 2 desimal & hilangkan -0.0."""
    return round(v, 2) + 0.0


def akhir_bulan(tahun: int, bulan: int) -> date:
    return date(tahun, bulan, calendar.monthrange(tahun, bulan)[1])


def _label_periode(tahun: int, sampai_bulan: int) -> str:
    if sampai_bulan <= 1:
        return f"{NAMA_BULAN[0]} {tahun}"
    return f"{NAMA_BULAN[0]} {tahun} – {NAMA_BULAN[sampai_bulan - 1]} {tahun}"


def tentukan_sampai_bulan(baris: Iterable[Dict[str, Any]], tahun: int, hari_ini: Optional[date] = None) -> int:
    """Bulan terakhir periode laporan kalau tidak diminta eksplisit: bulan
    terakhir yang ada transaksi posted di `tahun`; kalau tidak ada sama
    sekali -> Desember (tahun lampau) / bulan berjalan (tahun ini)."""
    bulan_aktif = [b["tanggal"].month for b in baris if b["tanggal"] and b["tanggal"].year == tahun]
    if bulan_aktif:
        return max(bulan_aktif)
    hari_ini = hari_ini or date.today()
    if tahun < hari_ini.year:
        return 12
    return hari_ini.month if tahun == hari_ini.year else 1


class BukuBesar:
    """Ringkasan baris jurnal s.d. akhir `sampai_bulan` `tahun`:

    - akun[kode] = {account_code, account_name, **klasifikasi, saldo_awal,
      mutasi_bulanan[12] (normal sign), per_bulan[12] (saldo akhir bulan,
      normal sign -- akun Neraca kumulatif sejak awal, akun Laba Rugi YTD),
      mutasi_debit, mutasi_kredit (dalam tahun berjalan)}
    - laba_tahun_lalu: laba rugi s.d. 31 Des tahun lalu yang belum ditutup.
    - jurnal: baris dalam tahun berjalan dikelompokkan per jurnal_id
      (untuk arus kas metode langsung).
    """

    def __init__(self, baris: List[Dict[str, Any]], tahun: int, sampai_bulan: int):
        self.tahun = tahun
        self.sampai_bulan = sampai_bulan
        self.akun: Dict[str, Dict[str, Any]] = {}
        self.laba_tahun_lalu = 0.0
        self.jurnal: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.ada_data = False

        batas = akhir_bulan(tahun, sampai_bulan)
        awal_tahun = date(tahun, 1, 1)
        for b in baris:
            tgl = b.get("tanggal")
            if not tgl or tgl > batas:
                continue
            self.ada_data = True
            kode = str(b.get("account_code") or "").strip() or "(tanpa kode)"
            a = self._akun(kode, b.get("account_name"))
            debit, kredit = float(b.get("debit") or 0), float(b.get("kredit") or 0)
            nilai = (debit - kredit) if a["saldo_normal"] == "D" else (kredit - debit)
            if tgl < awal_tahun:
                if a["kategori"] in ("PENDAPATAN", "BEBAN"):
                    self.laba_tahun_lalu += (kredit - debit)
                else:
                    a["saldo_awal"] += nilai
                continue
            a["mutasi_bulanan"][tgl.month - 1] += nilai
            a["mutasi_debit"] += debit
            a["mutasi_kredit"] += kredit
            self.jurnal[b.get("jurnal_id") or f"{b.get('nomor')}|{tgl}"].append({**b, "_info": a})

        for a in self.akun.values():
            jalan = a["saldo_awal"]
            for i in range(12):
                jalan += a["mutasi_bulanan"][i]
                a["per_bulan"][i] = jalan if i < sampai_bulan else 0.0

    def _akun(self, kode: str, nama: Optional[str]) -> Dict[str, Any]:
        if kode not in self.akun:
            self.akun[kode] = {
                "account_code": kode,
                "account_name": (nama or "").strip() or kode,
                **klasifikasi_akun(kode, nama),
                "saldo_awal": 0.0,
                "mutasi_bulanan": [0.0] * 12,
                "per_bulan": [0.0] * 12,
                "mutasi_debit": 0.0,
                "mutasi_kredit": 0.0,
            }
        elif nama and self.akun[kode]["account_name"] == kode:
            self.akun[kode]["account_name"] = nama.strip()
        return self.akun[kode]

    # --- akses saldo ---
    def akun_kategori(self, *kategori: str) -> List[Dict[str, Any]]:
        return sorted((a for a in self.akun.values() if a["kategori"] in kategori), key=lambda a: a["account_code"])

    def saldo(self, a: Dict[str, Any], bulan: int) -> float:
        """Saldo akhir bulan ke-`bulan` (1..12); bulan 0 = saldo awal tahun
        (akun Laba Rugi = 0 karena YTD)."""
        if bulan <= 0:
            return a["saldo_awal"]
        return a["per_bulan"][bulan - 1]

    def laba_ytd(self, bulan: int) -> float:
        if bulan <= 0:
            return 0.0
        pendapatan = sum(self.saldo(a, bulan) for a in self.akun_kategori("PENDAPATAN"))
        beban = sum(self.saldo(a, bulan) for a in self.akun_kategori("BEBAN"))
        return pendapatan - beban


def susun_neraca_saldo(bb: BukuBesar) -> Dict[str, Any]:
    akun = []
    total_debit = total_kredit = 0.0
    for a in sorted(bb.akun.values(), key=lambda x: x["account_code"]):
        akhir = bb.saldo(a, bb.sampai_bulan)
        # Kolom debit/kredit neraca saldo: saldo normal positif di sisi normalnya.
        di_debit = (akhir if a["saldo_normal"] == "D" else -akhir)
        debit, kredit = (di_debit, 0.0) if di_debit >= 0 else (0.0, -di_debit)
        total_debit += debit
        total_kredit += kredit
        akun.append({
            "account_code": a["account_code"],
            "account_name": a["account_name"],
            "kategori": a["kategori"],
            "grup": a["grup"],
            "label_grup": a["label_grup"],
            "lancar": a["lancar"],
            "saldo_normal": a["saldo_normal"],
            "saldo_awal": _r(a["saldo_awal"]),
            "mutasi_debit": _r(a["mutasi_debit"]),
            "mutasi_kredit": _r(a["mutasi_kredit"]),
            "saldo_akhir": _r(akhir),
            "debit": _r(debit),
            "kredit": _r(kredit),
            "per_bulan": [_r(v) for v in a["per_bulan"][: bb.sampai_bulan]],
        })
    # Laba tahun lalu yang belum ditutup berada di sisi kredit (ekuitas).
    if abs(bb.laba_tahun_lalu) > 0.005:
        if bb.laba_tahun_lalu >= 0:
            total_kredit += bb.laba_tahun_lalu
        else:
            total_debit += -bb.laba_tahun_lalu
    return {
        "akun": akun,
        "laba_tahun_lalu_belum_ditutup": _r(bb.laba_tahun_lalu),
        "total_debit": _r(total_debit),
        "total_kredit": _r(total_kredit),
        "seimbang": abs(total_debit - total_kredit) < 1,
    }


# ============================================================
# 3) LABA RUGI
# ============================================================

def _komponen_laba_rugi(pendapatan: float, ember: Dict[str, float]) -> Dict[str, float]:
    gross = pendapatan - ember["cogs"]
    ebitda = gross - ember["opex"]
    ebit = ebitda - ember["da"]
    ebt = ebit - ember["interest"]
    return {
        "revenue": pendapatan, "cogs": ember["cogs"], "gross_profit": gross,
        "operating_expenses": ember["opex"], "ebitda": ebitda, "da": ember["da"],
        "ebit": ebit, "interest_expense": ember["interest"], "ebt": ebt,
        "income_tax": ember["tax"], "net_profit": ebt - ember["tax"],
    }


def _pct(a: float, b: float) -> float:
    return round(a / b * 100, 1) if b else 0.0


def _rincian(daftar: List[Tuple[str, str, float]]) -> List[Dict[str, Any]]:
    total = sum(v for _, _, v in daftar)
    return [
        {"account_code": kode, "name": nama, "value": _r(v), "pct": _pct(v, total)}
        for kode, nama, v in sorted(daftar, key=lambda x: -x[2]) if abs(v) > 0.005
    ]


def susun_laba_rugi(bb: BukuBesar) -> Dict[str, Any]:
    n = bb.sampai_bulan
    akun_pendapatan = bb.akun_kategori("PENDAPATAN")
    akun_beban = bb.akun_kategori("BEBAN")

    bulanan = []
    for i in range(n):
        ember = {"cogs": 0.0, "opex": 0.0, "da": 0.0, "interest": 0.0, "tax": 0.0}
        for a in akun_beban:
            ember[a["ember_laba_rugi"]] += a["mutasi_bulanan"][i]
        pendapatan = sum(a["mutasi_bulanan"][i] for a in akun_pendapatan)
        baris = {k: _r(v) for k, v in _komponen_laba_rugi(pendapatan, ember).items()}
        bulanan.append({"bulan": i + 1, "label": NAMA_BULAN[i], **baris})

    ember_ytd = {"cogs": 0.0, "opex": 0.0, "da": 0.0, "interest": 0.0, "tax": 0.0}
    for a in akun_beban:
        ember_ytd[a["ember_laba_rugi"]] += bb.saldo(a, n)
    pendapatan_ytd = sum(bb.saldo(a, n) for a in akun_pendapatan)
    ringkasan = _komponen_laba_rugi(pendapatan_ytd, ember_ytd)

    rincian = {"revenue": [(a["account_code"], a["account_name"], bb.saldo(a, n)) for a in akun_pendapatan]}
    for kunci in ember_ytd:
        rincian[kunci] = [(a["account_code"], a["account_name"], bb.saldo(a, n)) for a in akun_beban if a["ember_laba_rugi"] == kunci]

    return {
        "ringkasan": {k: _r(v) for k, v in ringkasan.items()},
        "margin": {
            "gross_margin": _pct(ringkasan["gross_profit"], pendapatan_ytd),
            "ebitda_margin": _pct(ringkasan["ebitda"], pendapatan_ytd),
            "ebit_margin": _pct(ringkasan["ebit"], pendapatan_ytd),
            "net_margin": _pct(ringkasan["net_profit"], pendapatan_ytd),
            "effective_tax_rate": _pct(ringkasan["income_tax"], ringkasan["ebt"]),
        },
        "bulanan": bulanan,
        "rincian": {
            "revenue": _rincian(rincian["revenue"]),
            "cogs": _rincian(rincian["cogs"]),
            "operating_expenses": _rincian(rincian["opex"]),
            "da": _rincian(rincian["da"]),
            "interest_expense": _rincian(rincian["interest"]),
            "income_tax": _rincian(rincian["tax"]),
        },
    }


# ============================================================
# 4) NERACA
# ============================================================

_HREF_GRUP = {
    "piutang_usaha": "/accounts-receivable", "piutang_lain": "/accounts-receivable",
    "hutang_usaha": "/accounts-payable",
}
_HREF_KATEGORI = {"ASET": "/assets", "LIABILITAS": "/liabilities", "EKUITAS": "/equity"}


def _seksi(label: str, akun: List[Dict[str, Any]], bb: BukuBesar, bulan: int, bulan_pembanding: int) -> Dict[str, Any]:
    """Seksi neraca: akun dikelompokkan per label_grup, urut nilai terbesar."""
    grup: Dict[str, Dict[str, Any]] = {}
    for a in akun:
        cur, prev = bb.saldo(a, bulan), bb.saldo(a, bulan_pembanding)
        if abs(cur) < 0.005 and abs(prev) < 0.005:
            continue
        g = grup.setdefault(a["label_grup"], {
            "name": a["label_grup"], "grup": a["grup"], "current": 0.0, "prev": 0.0,
            "href": _HREF_GRUP.get(a["grup"], _HREF_KATEGORI[a["kategori"]]), "akun": [],
        })
        g["current"] += cur
        g["prev"] += prev
        g["akun"].append({"account_code": a["account_code"], "account_name": a["account_name"], "current": _r(cur), "prev": _r(prev)})
    items = sorted(grup.values(), key=lambda g: -abs(g["current"]))
    total, prev_total = sum(g["current"] for g in items), sum(g["prev"] for g in items)
    for g in items:
        g["current"], g["prev"] = _r(g["current"]), _r(g["prev"])
    return {"label": label, "items": items, "total": _r(total), "prev_total": _r(prev_total)}


def _baris_laba_ekuitas(bb: BukuBesar, bulan: int) -> Dict[str, float]:
    """Laba tahun lalu yg belum ditutup + laba tahun berjalan s.d. `bulan`."""
    return {"laba_tahun_lalu": bb.laba_tahun_lalu, "laba_berjalan": bb.laba_ytd(bulan)}


def susun_neraca(bb: BukuBesar) -> Dict[str, Any]:
    n = bb.sampai_bulan
    pembanding = n - 1  # bulan sebelumnya; 0 = saldo awal tahun (31 Des tahun lalu)
    aset = bb.akun_kategori("ASET")
    liab = bb.akun_kategori("LIABILITAS")

    seksi = {
        "aset_lancar": _seksi("Current Assets", [a for a in aset if a["lancar"]], bb, n, pembanding),
        "aset_tidak_lancar": _seksi("Non-Current Assets", [a for a in aset if not a["lancar"]], bb, n, pembanding),
        "liabilitas_jangka_pendek": _seksi("Current Liabilities", [a for a in liab if a["lancar"]], bb, n, pembanding),
        "liabilitas_jangka_panjang": _seksi("Non-Current Liabilities", [a for a in liab if not a["lancar"]], bb, n, pembanding),
        "ekuitas": _seksi("Shareholders' Equity", bb.akun_kategori("EKUITAS"), bb, n, pembanding),
    }

    # Laba yang belum ditutup ke akun ekuitas -> baris virtual di ekuitas,
    # supaya Aset = Liabilitas + Ekuitas.
    eq = seksi["ekuitas"]
    cur, prev = _baris_laba_ekuitas(bb, n), _baris_laba_ekuitas(bb, pembanding)
    for kunci, nama in (("laba_berjalan", "Laba Tahun Berjalan"), ("laba_tahun_lalu", "Saldo Laba Tahun Lalu")):
        if abs(cur[kunci]) > 0.005 or abs(prev[kunci]) > 0.005:
            eq["items"].append({"name": nama, "grup": kunci, "current": _r(cur[kunci]), "prev": _r(prev[kunci]), "href": "/equity", "akun": []})
            eq["total"] = _r(eq["total"] + cur[kunci])
            eq["prev_total"] = _r(eq["prev_total"] + prev[kunci])

    def total(*kunci: str, prev: bool = False) -> float:
        return _r(sum(seksi[k]["prev_total" if prev else "total"] for k in kunci))

    total_aset = total("aset_lancar", "aset_tidak_lancar")
    total_liab = total("liabilitas_jangka_pendek", "liabilitas_jangka_panjang")
    total_ekuitas = seksi["ekuitas"]["total"]

    tren = []
    for i in range(1, n + 1):
        nilai_aset = sum(bb.saldo(a, i) for a in aset)
        nilai_liab = sum(bb.saldo(a, i) for a in liab)
        nilai_ekuitas = sum(bb.saldo(a, i) for a in bb.akun_kategori("EKUITAS")) + bb.laba_tahun_lalu + bb.laba_ytd(i)
        tren.append({
            "bulan": i, "label": NAMA_BULAN[i - 1],
            "aset": _r(nilai_aset), "liabilitas": _r(nilai_liab), "ekuitas": _r(nilai_ekuitas),
            "aset_lancar": _r(sum(bb.saldo(a, i) for a in aset if a["lancar"])),
            "liabilitas_jangka_pendek": _r(sum(bb.saldo(a, i) for a in liab if a["lancar"])),
        })

    selisih = _r(total_aset - total_liab - total_ekuitas)
    return {
        "per_tanggal": akhir_bulan(bb.tahun, n).isoformat(),
        "pembanding_tanggal": (akhir_bulan(bb.tahun, pembanding) if pembanding > 0 else date(bb.tahun - 1, 12, 31)).isoformat(),
        **seksi,
        "total_aset": total_aset, "prev_total_aset": total("aset_lancar", "aset_tidak_lancar", prev=True),
        "total_liabilitas": total_liab, "prev_total_liabilitas": total("liabilitas_jangka_pendek", "liabilitas_jangka_panjang", prev=True),
        "total_ekuitas": total_ekuitas, "prev_total_ekuitas": seksi["ekuitas"]["prev_total"],
        "seimbang": abs(selisih) < 1,
        "selisih": selisih,
        "tren_bulanan": tren,
    }


# ============================================================
# 5) ARUS KAS
# ============================================================

def aktivitas_arus_kas(info: Dict[str, Any]) -> str:
    """Aktivitas arus kas berdasarkan akun LAWAN kas."""
    if info["kategori"] == "ASET" and info["grup"] in ("aset_tetap", "aset_tak_berwujud", "investasi", "akumulasi_penyusutan", "aset_tidak_lancar_lain"):
        return "investasi"
    if info["kategori"] == "EKUITAS":
        return "pendanaan"
    if info["kategori"] == "LIABILITAS" and (
        info["grup"] in ("pinjaman", "pihak_berelasi", "liabilitas_sewa") or not info["lancar"]
    ):
        return "pendanaan"
    return "operasi"


def _ember_ringkasan_kas(aktivitas: str, info: Dict[str, Any], nama: str, nilai: float) -> str:
    """Pos rinci ala buku teks (customer_collections, dst) -- best-effort."""
    t = nama.lower()
    if aktivitas == "operasi":
        if info["kategori"] == "PENDAPATAN" or info["grup"] in ("piutang_usaha", "diterima_dimuka"):
            return "customer_collections"
        if info["grup"] in ("hutang_usaha", "persediaan"):
            return "supplier_payments"
        if re.search(r"gaji|payroll|upah|thr|karyawan|salary|wage", t):
            return "payroll_payments"
        if info["grup"] in ("hutang_pajak", "pajak_dimuka") or info["ember_laba_rugi"] == "tax" or re.search(r"pajak|\btax\b", t):
            return "tax_payments"
        if info["kategori"] == "BEBAN":
            return "operating_expenses_cf"
        return "other_operating_cf"
    if aktivitas == "investasi":
        if info["grup"] in ("aset_tetap", "akumulasi_penyusutan"):
            if nilai > 0:
                return "asset_sales"
            return "equipment_purchases" if re.search(r"peralatan|mesin|kendaraan|komputer|inventaris|equipment|vehicle", t) else "asset_purchases"
        if info["grup"] in ("investasi", "aset_tak_berwujud"):
            return "investments"
        return "other_investing_cf"
    if info["grup"] in ("pinjaman", "pihak_berelasi"):
        return "debt_proceeds" if nilai > 0 else "debt_repayment"
    if info["grup"] == "dividen":
        return "dividend_payments"
    if info["grup"] in ("modal", "tambahan_modal"):
        return "capital_injection"
    if info["grup"] == "liabilitas_sewa":
        return "lease_payments"
    return "other_financing_cf"


_POS_RINGKASAN_KAS = [
    "customer_collections", "supplier_payments", "payroll_payments", "tax_payments",
    "operating_expenses_cf", "other_operating_cf",
    "asset_purchases", "asset_sales", "equipment_purchases", "investments", "other_investing_cf",
    "debt_proceeds", "debt_repayment", "capital_injection", "dividend_payments", "lease_payments", "other_financing_cf",
]


def _href_arus_kas(aktivitas: str, info: Dict[str, Any]) -> str:
    if info["grup"] in _HREF_GRUP:
        return _HREF_GRUP[info["grup"]]
    if aktivitas == "investasi":
        return "/assets"
    if aktivitas == "pendanaan":
        return "/equity" if info["kategori"] == "EKUITAS" else "/liabilities"
    return "/transactions"


def susun_arus_kas(bb: BukuBesar, laba_rugi: Dict[str, Any]) -> Dict[str, Any]:
    """Arus kas metode LANGSUNG (dari jurnal yang menyentuh akun kas) +
    metode TIDAK LANGSUNG (dari perubahan saldo neraca). Keduanya selalu
    menghasilkan kenaikan/penurunan kas neto yang sama.

    Metode langsung: tiap jurnal yang punya baris kas -> SETIAP baris
    non-kas di jurnal itu menyumbang (kredit - debit) ke arus kas sesuai
    aktivitas akunnya. Untuk jurnal seimbang, jumlahnya persis = mutasi kas
    neto jurnal tsb (lebih tepat daripada cuma pakai 1 akun lawan terbesar).
    Jurnal kas-ke-kas (transfer antar rekening) tidak mengubah arus kas."""
    n = bb.sampai_bulan
    akun_kas = [a for a in bb.akun.values() if _is_kas(a)]

    per_bulan = [{"operasi": 0.0, "investasi": 0.0, "pendanaan": 0.0} for _ in range(n)]
    pos = {k: 0.0 for k in _POS_RINGKASAN_KAS}
    item: Dict[str, Dict[str, Dict[str, Any]]] = {"operasi": {}, "investasi": {}, "pendanaan": {}}
    transaksi_kas = []

    for jurnal_id, baris in bb.jurnal.items():
        kas = [b for b in baris if _is_kas(b["_info"])]
        lawan = [b for b in baris if not _is_kas(b["_info"])]
        if not kas or not lawan:
            continue
        bulan_idx = baris[0]["tanggal"].month - 1
        for b in lawan:
            info = b["_info"]
            nilai = float(b.get("kredit") or 0) - float(b.get("debit") or 0)
            if abs(nilai) < 0.005:
                continue
            aktivitas = aktivitas_arus_kas(info)
            per_bulan[bulan_idx][aktivitas] += nilai
            pos[_ember_ringkasan_kas(aktivitas, info, info["account_name"], nilai)] += nilai
            it = item[aktivitas].setdefault(info["account_code"], {
                "account_code": info["account_code"], "name": info["account_name"],
                "inflow": 0.0, "outflow": 0.0, "href": _href_arus_kas(aktivitas, info),
            })
            it["inflow" if nilai > 0 else "outflow"] += abs(nilai)

        neto = sum(float(b.get("debit") or 0) - float(b.get("kredit") or 0) for b in kas)
        if abs(neto) >= 0.005:
            utama = max(lawan, key=lambda b: abs(float(b.get("debit") or 0) - float(b.get("kredit") or 0)))
            transaksi_kas.append({
                "id": baris[0].get("nomor") or jurnal_id,
                "tanggal": baris[0]["tanggal"].isoformat(),
                "type": "Receipt" if neto > 0 else "Payment",
                "description": baris[0].get("keterangan") or utama["_info"]["account_name"],
                "account": utama["_info"]["account_name"],
                "cash_account": kas[0]["_info"]["account_name"],
                "inflow": _r(neto) if neto > 0 else 0.0,
                "outflow": _r(-neto) if neto < 0 else 0.0,
                "party": baris[0].get("pihak") or utama["_info"]["account_name"],
                "sumber": baris[0].get("sumber"),
                "status": "Posted",
            })

    bulanan = []
    for i in range(n):
        awal = sum(bb.saldo(a, i) for a in akun_kas)
        akhir = sum(bb.saldo(a, i + 1) for a in akun_kas)
        p = per_bulan[i]
        bulanan.append({
            "bulan": i + 1, "label": NAMA_BULAN[i],
            "begin_cash": _r(awal), "operating_cf": _r(p["operasi"]), "investing_cf": _r(p["investasi"]),
            "financing_cf": _r(p["pendanaan"]), "net_change": _r(akhir - awal), "end_cash": _r(akhir),
        })

    kas_awal = sum(bb.saldo(a, 0) for a in akun_kas)
    kas_akhir = sum(bb.saldo(a, n) for a in akun_kas)
    total = {k: sum(p[k] for p in per_bulan) for k in ("operasi", "investasi", "pendanaan")}

    def daftar_item(aktivitas: str) -> List[Dict[str, Any]]:
        hasil = sorted(item[aktivitas].values(), key=lambda x: -(x["inflow"] + x["outflow"]))
        return [{**x, "inflow": _r(x["inflow"]), "outflow": _r(x["outflow"])} for x in hasil]

    transaksi_kas.sort(key=lambda x: x["tanggal"], reverse=True)

    return {
        "ringkasan": {
            "beginning_cash": _r(kas_awal),
            **{k: _r(v) for k, v in pos.items()},
            "net_operating_cf": _r(total["operasi"]),
            "net_investing_cf": _r(total["investasi"]),
            "net_financing_cf": _r(total["pendanaan"]),
            "net_change": _r(kas_akhir - kas_awal),
            "ending_cash": _r(kas_akhir),
        },
        "bulanan": bulanan,
        "operating_items": daftar_item("operasi"),
        "investing_items": daftar_item("investasi"),
        "financing_items": daftar_item("pendanaan"),
        "recent_transactions": transaksi_kas[:10],
        "metode_tidak_langsung": _arus_kas_tidak_langsung(bb, laba_rugi, kas_awal, kas_akhir),
    }


def _arus_kas_tidak_langsung(bb: BukuBesar, laba_rugi: Dict[str, Any], kas_awal: float, kas_akhir: float) -> Dict[str, Any]:
    """Laba bersih + penyesuaian non-kas + perubahan modal kerja, dari
    perubahan saldo awal tahun -> akhir periode tiap akun Neraca non-kas."""
    n = bb.sampai_bulan
    seksi: Dict[str, Dict[str, float]] = {"operasi": defaultdict(float), "investasi": defaultdict(float), "pendanaan": defaultdict(float)}
    seksi["operasi"]["Laba Bersih"] = laba_rugi["ringkasan"]["net_profit"]

    for a in bb.akun.values():
        if a["kategori"] not in ("ASET", "LIABILITAS", "EKUITAS") or _is_kas(a):
            continue
        delta = bb.saldo(a, n) - bb.saldo(a, 0)
        if abs(delta) < 0.005:
            continue
        # Kenaikan aset = kas keluar; kenaikan liabilitas/ekuitas = kas masuk.
        efek = -delta if a["kategori"] == "ASET" else delta
        if a["grup"] == "akumulasi_penyusutan":
            seksi["operasi"]["Penyusutan & Amortisasi"] += efek
            continue
        aktivitas = aktivitas_arus_kas(a)
        label = a["label_grup"] if aktivitas != "operasi" else f"Perubahan {a['label_grup']}"
        seksi[aktivitas][label] += efek

    def ke_daftar(d: Dict[str, float]) -> Dict[str, Any]:
        items = [{"label": k, "value": _r(v)} for k, v in d.items() if abs(v) >= 0.005]
        return {"items": items, "total": _r(sum(d.values()))}

    hasil = {
        "operating": ke_daftar(seksi["operasi"]),
        "investing": ke_daftar(seksi["investasi"]),
        "financing": ke_daftar(seksi["pendanaan"]),
        "beginning": _r(kas_awal),
        "ending": _r(kas_akhir),
        "net_change": _r(kas_akhir - kas_awal),
    }
    hasil["selisih_rekonsiliasi"] = _r(
        hasil["operating"]["total"] + hasil["investing"]["total"] + hasil["financing"]["total"] - hasil["net_change"]
    )
    return hasil


# ============================================================
# 6) PERUBAHAN EKUITAS
# ============================================================

_KOLOM_MUTASI_EKUITAS = {
    "modal": "capital", "tambahan_modal": "capital", "dividen": "dividends",
}


def susun_perubahan_ekuitas(bb: BukuBesar) -> Dict[str, Any]:
    n = bb.sampai_bulan
    laba = bb.laba_ytd(n)

    komponen: Dict[str, Dict[str, Any]] = {}
    for a in bb.akun_kategori("EKUITAS"):
        buka, tutup = bb.saldo(a, 0), bb.saldo(a, n)
        if abs(buka) < 0.005 and abs(tutup) < 0.005:
            continue
        k = komponen.setdefault(a["grup"], {
            "key": a["grup"], "name": a["label_grup"], "opening": 0.0, "capital": 0.0,
            "profit": 0.0, "dividends": 0.0, "adjustments": 0.0, "closing": 0.0, "akun": [],
        })
        mutasi = tutup - buka
        k["opening"] += buka
        k["closing"] += tutup
        k[_KOLOM_MUTASI_EKUITAS.get(a["grup"], "adjustments")] += mutasi
        k["akun"].append({"account_code": a["account_code"], "account_name": a["account_name"], "opening": _r(buka), "movement": _r(mutasi), "closing": _r(tutup)})

    # Laba ditahan = akun laba ditahan + laba tahun lalu yang belum ditutup.
    if abs(bb.laba_tahun_lalu) > 0.005:
        k = komponen.setdefault("laba_ditahan", {
            "key": "laba_ditahan", "name": "Laba Ditahan", "opening": 0.0, "capital": 0.0,
            "profit": 0.0, "dividends": 0.0, "adjustments": 0.0, "closing": 0.0, "akun": [],
        })
        k["opening"] += bb.laba_tahun_lalu
        k["closing"] += bb.laba_tahun_lalu
        k["akun"].append({"account_code": None, "account_name": "Saldo Laba Tahun Lalu (belum ditutup)", "opening": _r(bb.laba_tahun_lalu), "movement": 0.0, "closing": _r(bb.laba_tahun_lalu)})
    if abs(laba) > 0.005:
        komponen["laba_berjalan"] = {
            "key": "laba_berjalan", "name": "Laba Tahun Berjalan", "opening": 0.0, "capital": 0.0,
            "profit": laba, "dividends": 0.0, "adjustments": 0.0, "closing": laba, "akun": [],
        }

    urutan = ["modal", "tambahan_modal", "laba_ditahan", "dividen", "ekuitas_lain", "laba_berjalan"]
    baris = sorted(komponen.values(), key=lambda k: urutan.index(k["key"]) if k["key"] in urutan else 99)
    kolom = ("opening", "capital", "profit", "dividends", "adjustments", "closing")
    total = {c: sum(k[c] for k in baris) for c in kolom}
    for k in baris:
        for c in kolom:
            k[c] = _r(k[c])

    laba_ditahan = komponen.get("laba_ditahan", {})
    dividen = komponen.get("dividen", {})
    bulanan = []
    for i in range(1, n + 1):
        ekuitas = sum(bb.saldo(a, i) for a in bb.akun_kategori("EKUITAS")) + bb.laba_tahun_lalu + bb.laba_ytd(i)
        bulanan.append({"bulan": i, "label": NAMA_BULAN[i - 1], "closing_equity": _r(ekuitas), "net_profit_ytd": _r(bb.laba_ytd(i))})

    return {
        "komponen": baris,
        "total": {c: _r(v) for c, v in total.items()},
        "ringkasan": {
            "opening_equity": _r(total["opening"]),
            "capital_contributions": _r(total["capital"]),
            "net_profit": _r(total["profit"]),
            "dividends": _r(total["dividends"]),
            "other_adjustments": _r(total["adjustments"]),
            "closing_equity": _r(total["closing"]),
            "equity_growth_pct": _pct(total["closing"] - total["opening"], total["opening"]) if abs(total["opening"]) > 0.005 else None,
        },
        "rekonsiliasi_laba_ditahan": {
            "opening": _r(laba_ditahan.get("opening", 0.0)),
            "net_profit": _r(laba),
            "dividends": _r(dividen.get("closing", 0.0) - dividen.get("opening", 0.0)),
            "adjustments": _r(laba_ditahan.get("adjustments", 0.0)),
            "closing": _r(laba_ditahan.get("closing", 0.0) + laba + dividen.get("closing", 0.0) - dividen.get("opening", 0.0)),
        },
        "bulanan": bulanan,
    }


# ============================================================
# 7) CALK (Catatan atas Laporan Keuangan)
# ============================================================

def _catatan_akun(bb: BukuBesar, filter_fn, pembanding: int) -> Tuple[List[Dict[str, Any]], float, float]:
    rows = []
    for a in sorted(bb.akun.values(), key=lambda x: x["account_code"]):
        if not filter_fn(a):
            continue
        cur, prev = bb.saldo(a, bb.sampai_bulan), bb.saldo(a, pembanding)
        if abs(cur) < 0.005 and abs(prev) < 0.005:
            continue
        rows.append({"account_code": a["account_code"], "account_name": a["account_name"], "current": _r(cur), "prev": _r(prev)})
    return rows, _r(sum(r["current"] for r in rows)), _r(sum(r["prev"] for r in rows))


def susun_calk(bb: BukuBesar, neraca: Dict[str, Any], laba_rugi: Dict[str, Any], nama_perusahaan: Optional[str] = None) -> Dict[str, Any]:
    """Catatan per pos laporan -- rincian saldo per akun + narasi singkat.
    Catatan kebijakan (01-03) berisi dasar penyusunan dari sistem ini,
    BUKAN kebijakan akuntansi resmi perusahaan -- akuntan wajib
    melengkapinya."""
    n = bb.sampai_bulan
    per_tanggal = neraca["per_tanggal"]
    # Pembanding CALK = awal tahun (31 Des tahun lalu), lazimnya catatan tahunan.
    pembanding = 0
    nama = nama_perusahaan or "Perusahaan"
    sumber = sorted({b.get("sumber") for baris in bb.jurnal.values() for b in baris if b.get("sumber")})

    def grup(*kunci: str):
        return lambda a: a["grup"] in kunci and a["kategori"] in ("ASET", "LIABILITAS", "EKUITAS")

    def ember(*kunci: str, kategori: str = "BEBAN"):
        return lambda a: a["kategori"] == kategori and (a["grup"] in kunci)

    definisi = [
        ("01", "general_information", "General Information", "All Statements", "Policy Note", None,
         f"{nama} menyajikan laporan keuangan periode {_label_periode(bb.tahun, n)} yang disusun otomatis dari transaksi yang sudah diposting."),
        ("02", "basis_of_preparation", "Basis of Preparation", "All Statements", "Policy Note", None,
         "Disusun dengan basis akrual dan biaya historis, mata uang penyajian Rupiah (IDR). "
         f"Sumber data: transaksi berstatus Posted dari modul {', '.join(sumber) if sumber else 'Transactions'}; transaksi draft tidak diikutsertakan."),
        ("03", "accounting_policies", "Material Accounting Policies", "All Statements", "Policy Note", None,
         "Klasifikasi akun mengikuti digit pertama kode akun (1 Aset, 2 Liabilitas, 3 Ekuitas, 4 Pendapatan, 5-6 & 8-9 Beban, 7 Pendapatan lain). "
         "Pendapatan diakui saat invoice diposting; beban diakui saat terjadi. Laba tahun lalu yang belum ditutup disajikan sebagai saldo laba."),
        ("04", "cash", "Cash & Cash Equivalents", "Balance Sheet", "Disclosed", grup("kas"), "Kas di tangan, kas kasir, dan rekening bank."),
        ("05", "receivables", "Trade & Other Receivables", "Balance Sheet", "Disclosed", grup("piutang_usaha", "piutang_lain"), "Piutang usaha dari penjualan dan piutang lain-lain (karyawan, pemegang saham, dst)."),
        ("06", "inventories", "Inventories", "Balance Sheet", "Supporting Schedule", grup("persediaan"), "Persediaan barang dagang/bahan."),
        ("07", "prepayments", "Prepaid Taxes & Expenses", "Balance Sheet", "Supporting Schedule", grup("pajak_dimuka", "dibayar_dimuka"), "Pajak dibayar dimuka, uang muka, dan biaya dibayar dimuka."),
        ("08", "fixed_assets", "Property & Equipment", "Balance Sheet", "Supporting Schedule", grup("aset_tetap", "akumulasi_penyusutan", "aset_tak_berwujud"), "Aset tetap dan aset tak berwujud setelah dikurangi akumulasi penyusutan/amortisasi."),
        ("09", "trade_payables", "Trade Payables", "Balance Sheet", "Disclosed", grup("hutang_usaha"), "Hutang kepada pemasok atas pembelian barang/jasa."),
        ("10", "tax_payables", "Taxes Payable", "Balance Sheet", "Disclosed", grup("hutang_pajak"), "PPN Keluaran dan hutang pajak lainnya."),
        ("11", "accruals", "Accrued Expenses & Other Liabilities", "Balance Sheet", "Disclosed", grup("akrual", "diterima_dimuka", "liabilitas_pendek_lain", "liabilitas_panjang_lain", "imbalan_kerja"), "Biaya yang masih harus dibayar dan liabilitas lainnya."),
        ("12", "borrowings", "Borrowings", "Balance Sheet", "Disclosed", grup("pinjaman", "pihak_berelasi", "liabilitas_sewa"), "Pinjaman bank, pinjaman pihak berelasi, dan liabilitas sewa."),
        ("13", "equity", "Equity", "Equity Statement", "Disclosed", lambda a: a["kategori"] == "EKUITAS", "Modal disetor, laba ditahan, dan komponen ekuitas lain."),
        ("14", "revenue", "Revenue", "Profit & Loss", "Disclosed", lambda a: a["kategori"] == "PENDAPATAN", "Pendapatan usaha dan pendapatan lain-lain periode berjalan."),
        ("15", "cost_of_sales", "Cost of Sales", "Profit & Loss", "Disclosed", ember("cogs"), "Harga pokok penjualan."),
        ("16", "operating_expenses", "Operating Expenses", "Profit & Loss", "Disclosed", ember("opex", "da"), "Beban operasional termasuk penyusutan & amortisasi."),
        ("17", "finance_costs_tax", "Finance Costs & Income Tax", "Profit & Loss", "Disclosed", ember("interest", "tax"), "Beban bunga dan pajak penghasilan."),
    ]

    catatan = []
    for no, key, judul, laporan, tag, filter_fn, narasi in definisi:
        entri = {"no": no, "key": key, "title": judul, "statement": laporan, "tag": tag, "narasi": narasi, "rows": [], "total": None, "prev_total": None}
        if filter_fn is not None:
            # Pembanding = saldo awal tahun. Untuk akun Laba Rugi selalu 0
            # (laba rugi tahun lalu sudah dibawa ke Saldo Laba).
            rows, total, prev_total = _catatan_akun(bb, filter_fn, pembanding)
            if not rows:
                continue  # pos yang tidak punya saldo tidak perlu catatan
            entri.update(rows=rows, total=total, prev_total=prev_total)
        catatan.append(entri)

    # Pihak berelasi -- diturunkan dari nama akun (lintas kategori).
    rows, total, prev_total = _catatan_akun(
        bb, lambda a: a["kategori"] in ("ASET", "LIABILITAS") and bool(re.search(r"pemegang saham|direksi|direktur|afiliasi|berelasi|karyawan", a["account_name"].lower())), pembanding)
    if rows:
        catatan.append({"no": str(len(catatan) + 1).zfill(2), "key": "related_parties", "title": "Related Parties", "statement": "All Statements",
                        "tag": "Disclosed", "narasi": "Saldo dengan pemegang saham, direksi, dan karyawan.", "rows": rows, "total": total, "prev_total": prev_total})
    # Nomor ulang supaya berurutan setelah pos kosong dilewati.
    for i, c in enumerate(catatan, start=1):
        c["no"] = str(i).zfill(2)

    return {
        "per_tanggal": per_tanggal,
        "pembanding_tanggal": date(bb.tahun - 1, 12, 31).isoformat(),
        "catatan": catatan,
        "jumlah": {
            "total": len(catatan),
            "policy": sum(1 for c in catatan if c["tag"] == "Policy Note"),
            "disclosed": sum(1 for c in catatan if c["tag"] == "Disclosed"),
            "schedule": sum(1 for c in catatan if c["tag"] == "Supporting Schedule"),
        },
    }


# ============================================================
# 8) SATU PINTU
# ============================================================

def susun_laporan_keuangan(
    baris: List[Dict[str, Any]],
    tahun: int,
    sampai_bulan: Optional[int] = None,
    nama_perusahaan: Optional[str] = None,
    hari_ini: Optional[date] = None,
) -> Dict[str, Any]:
    """Susun kelima laporan + neraca saldo sekaligus (dipakai endpoint
    ringkasan & tiap endpoint per laporan)."""
    if sampai_bulan is None:
        sampai_bulan = tentukan_sampai_bulan(baris, tahun, hari_ini)
    sampai_bulan = max(1, min(12, int(sampai_bulan)))
    bb = BukuBesar(baris, tahun, sampai_bulan)
    laba_rugi = susun_laba_rugi(bb)
    neraca = susun_neraca(bb)
    return {
        "periode": {
            "tahun": tahun,
            "sampai_bulan": sampai_bulan,
            "label": _label_periode(tahun, sampai_bulan),
            "per_tanggal": neraca["per_tanggal"],
            "ada_data": bb.ada_data,
            "jumlah_jurnal": len(bb.jurnal),
        },
        "trial_balance": susun_neraca_saldo(bb),
        "profit_loss": laba_rugi,
        "balance_sheet": neraca,
        "cash_flow": susun_arus_kas(bb, laba_rugi),
        "changes_in_equity": susun_perubahan_ekuitas(bb),
        "notes": susun_calk(bb, neraca, laba_rugi, nama_perusahaan),
    }
