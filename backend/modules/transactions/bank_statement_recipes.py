"""
modules/transactions/bank_statement_recipes.py
==============================================
RESEP ekstraksi untuk format rekening koran / buku kas yang TIDAK bisa dibaca
jalur generik bank_statement_extractor (grid / words / table), karena bentuknya
bukan "1 baris tabel = 1 transaksi dengan saldo":

  permata_inquiry  -- Permata "Transaction Inquiry" (eBusiness, PDF). Karakter
                      tercetak dobel (efek tebal: "PPBB KKEE"), nomor urut menempel
                      ke tanggal ("101-Jul-2026"), saldo TIDAK per baris: hanya
                      "Opening/Closing Ledger Balance" + "Ledger Balance per <tgl>"
                      (= saldo setelah transaksi hari sebelumnya) + "Total" per hari.
  permata_me       -- Permata ME Saver "Transaction History" (export aplikasi, PDF).
                      Tanpa kolom & tanpa saldo; arah dibaca dari WARNA nominal
                      (merah = keluar, hijau = masuk).
  petty_expense    -- Laporan belanja Petty Cash (Excel, 1 sheet per bulan:
                      DATE | NAME PRODUCT | UNIT | PRICE | TOTAL, lalu blok TOTAL,
                      "rest money", "transfer <tgl> <bulan>", "sisa petty cash").
                      Hanya sheet bulan TERAKHIR yang dibaca (workbook kumulatif).

Setiap resep mengembalikan TabelKandidat (metode 'recipe') berisi 1 BarisSel per
transaksi dengan sel yang sudah rapi (tanggal ISO, angka '1234.00'), lalu
diproses & divalidasi oleh rakit_baris/validasi yang SAMA dengan jalur generik
(saldo berjalan, total resmi, confidence per baris). Header buatan resep jadi
signature template, jadi template seed bisa menunjuk resep ini.

Deteksi dari STRUKTUR dokumen (judul + pola baris), bukan nama klien.
"""

from __future__ import annotations

import io
import re
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from .bank_statement_extractor import (
    _BULAN, BarisSel, Dokumen, TabelKandidat, _baris_visual, parse_angka, pecah_tanggal,
)

_RE_NOMINAL = re.compile(r"^\d{1,3}(?:,\d{3})*\.\d{2}$")


def _angka_teks(v: Optional[Decimal]) -> str:
    return "" if v is None else format(v.quantize(Decimal("0.01")), "f")


def _tgl_teks(d: Optional[date]) -> str:
    return d.isoformat() if d else ""


def _tanggal(teks: str, tahun: Optional[int] = None) -> Optional[date]:
    p = pecah_tanggal(teks)
    if not p:
        return None
    a, b, th, _ = p
    try:
        return date(th or tahun or date.today().year, b, a)
    except ValueError:
        return None


def _kandidat(nama: str, headers: List[str], roles: List[str], rows: List[List[str]], ringkasan: List[str],
              bank: Optional[str], periode: Tuple[Optional[date], Optional[date]], no_rek: Optional[str],
              halaman: Optional[List[Optional[int]]] = None, sheet: Optional[str] = None) -> Optional[TabelKandidat]:
    if not rows:
        return None
    baris = [BarisSel(cells=r, halaman=(halaman[i] if halaman else None), putus=True,
                      teks_penuh=" ".join(c for c in r if c)) for i, r in enumerate(rows)]
    return TabelKandidat(metode="recipe", headers=headers, roles_terdeteksi=list(roles), baris=baris,
                         sheet_name=sheet, ringkasan_teks=ringkasan, resep=nama, bank=bank, periode=periode,
                         no_rekening=no_rek)


# ============================================================
# 1) Permata Transaction Inquiry (PDF)
# ============================================================

_PI_HEADERS = ["Post Date", "Eff Date", "Transaction Code", "Ref No", "Customer Ref No", "Description", "Debit", "Credit",
               "Ledger Balance"]
_PI_ROLES = ["date", "ignore", "reference", "ignore", "reference", "description", "debit", "credit", "balance"]
_RE_PI_TGL = re.compile(r"^(\d*?)(\d{2}-[A-Za-z]{3}-\d{4})$")
_RE_PI_TGL_SAJA = re.compile(r"\d{2}-[A-Za-z]{3}-\d{4}")


def _permata_inquiry(isi: bytes, teks_awal: str) -> Optional[TabelKandidat]:
    t = teks_awal.upper()
    if "TRANSACTION INQUIRY" not in t or "LEDGER BALANCE" not in t:
        return None
    import pdfplumber

    rows: List[List[str]] = []
    hal: List[Optional[int]] = []
    ringkasan: List[str] = []
    total_d = total_k = Decimal("0")
    ada_total = False
    no_rek = None
    periode: Tuple[Optional[date], Optional[date]] = (None, None)
    selesai = False
    with pdfplumber.open(io.BytesIO(isi)) as pdf:
        for page in pdf.pages:
            if selesai:
                break
            words = page.dedupe_chars().extract_words(x_tolerance=2, y_tolerance=2)
            words = [{"text": w["text"], "x0": float(w["x0"]), "x1": float(w["x1"]),
                      "top": float(w["top"]), "bottom": float(w["bottom"])} for w in words]
            lines = _baris_visual(words)
            kolom_desk = kolom_debit = None
            i_mulai = None
            for i, ln in enumerate(lines):
                teks = " ".join(w["text"] for w in ln)
                if no_rek is None:
                    m = re.search(r"\bAccount\s*:\s*(\d{6,20})", teks)
                    if m:
                        no_rek = m.group(1)
                if periode[0] is None and teks.startswith("Period"):
                    tgl = _RE_PI_TGL_SAJA.findall(teks)
                    if len(tgl) == 2:
                        periode = (_tanggal(tgl[0]), _tanggal(tgl[1]))
                kata = {w["text"] for w in ln}
                if {"Description", "Debit", "Credit"} <= kata:
                    kolom_desk = next(w["x0"] for w in ln if w["text"] == "Description")
                    kolom_debit = next(w["x0"] for w in ln if w["text"] == "Debit")
                    i_mulai = i + 1
                    break
            if i_mulai is None:
                continue
            batas_desk = kolom_desk - 40      # teks keterangan mulai ~25pt kiri judul 'Description'
            batas_angka = kolom_debit - 20
            for ln in lines[i_mulai:]:
                teks = " ".join(w["text"] for w in ln)
                if re.match(r"^(Code|Ref)\b", teks) and not any(ch.isdigit() for ch in teks):
                    continue  # sisa header 2 baris ("Code Ref No")
                if re.match(r"^(Ineffective Balance|Opening Ineffective|Effective Balance|Hold Amount|Description:)", teks):
                    selesai = True
                    break
                angka = [w for w in ln if _RE_NOMINAL.match(w["text"]) and w["x0"] >= batas_angka]
                m_saldo = re.match(r"^(Opening |Closing )?Ledger Balance per (\d{2}-[A-Za-z]{3}-\d{4})", teks)
                if m_saldo:
                    if not angka:
                        continue
                    nilai, _ = parse_angka(angka[-1]["text"])
                    if m_saldo.group(1) == "Opening ":
                        ringkasan.append(f"OPENING BALANCE {_angka_teks(nilai)}")
                    else:
                        if rows:
                            rows[-1][8] = _angka_teks(nilai)   # saldo setelah transaksi terakhir hari sebelumnya
                        if m_saldo.group(1) == "Closing ":
                            ringkasan.append(f"CLOSING BALANCE {_angka_teks(nilai)}")
                    continue
                if teks.startswith("Total"):
                    if len(angka) >= 2:
                        d, _ = parse_angka(angka[0]["text"])
                        k, _ = parse_angka(angka[1]["text"])
                        total_d += d or 0
                        total_k += k or 0
                        ada_total = True
                    continue
                if not angka and ln and re.fullmatch(r"[\d,.]+", ln[0]["text"]) and len(ln) <= 2 and rows:
                    continue  # angka 'Total' yang tercetak sedikit di bawah labelnya (sudah dibaca)
                awal = ln[0]
                m = _RE_PI_TGL.match(awal["text"]) if awal["x0"] < batas_desk else None
                kata_sisa = ln[1:]
                if m is None and len(ln) > 1 and re.fullmatch(r"\d{1,4}", awal["text"]) and _RE_PI_TGL.match(ln[1]["text"]):
                    m, kata_sisa = _RE_PI_TGL.match(ln[1]["text"]), ln[2:]
                if m and len(angka) >= 2:
                    kiri = [w for w in kata_sisa if w["x0"] < batas_desk]
                    desk = [w["text"] for w in kata_sisa if batas_desk <= w["x0"] < batas_angka]
                    eff = next((w["text"] for w in kiri if _RE_PI_TGL_SAJA.fullmatch(w["text"])), "")
                    lain = [w["text"] for w in kiri if w["text"] != eff]
                    kode = lain[0] if lain else ""
                    ref = " ".join(x for x in lain[2:3])
                    cust = " ".join(lain[3:])
                    d, _ = parse_angka(angka[0]["text"])
                    k, _ = parse_angka(angka[1]["text"])
                    rows.append([_tgl_teks(_tanggal(m.group(2))), eff, kode, ref, cust, " ".join(desk),
                                 _angka_teks(d) if d else "", _angka_teks(k) if k else "", ""])
                    hal.append(page.page_number)
                    continue
                if rows and all(w["x0"] >= batas_desk for w in ln) and not angka:
                    rows[-1][5] = (rows[-1][5] + " " + teks).strip()   # sambungan keterangan
    if not rows:
        return None
    if ada_total:
        ringkasan += [f"TOTAL DEBIT {_angka_teks(total_d)}", f"TOTAL CREDIT {_angka_teks(total_k)}"]
    return _kandidat("permata_inquiry", _PI_HEADERS, _PI_ROLES, rows, ringkasan, "Permata", periode, no_rek, hal)


# ============================================================
# 2) Permata ME Saver Transaction History (PDF, arah dari warna)
# ============================================================

_PM_HEADERS = ["Transaction Date", "Transaction Details", "Money Out (red)", "Money In (green)"]
_PM_ROLES = ["date", "description", "debit", "credit"]
_RE_PM_TGL = re.compile(rf"^\d{{1,2}} ({'|'.join(sorted(_BULAN, key=len, reverse=True))}) \d{{4}}$", re.I)


def _warna(w: Dict[str, Any]) -> Optional[str]:
    c = w.get("non_stroking_color")
    if not isinstance(c, (tuple, list)) or len(c) != 3:
        return None
    r, g, b = (float(x) for x in c)
    if r > 0.5 and g < 0.3:
        return "debit"
    if g > 0.35 and r < 0.3:
        return "credit"
    return None


def _permata_me(isi: bytes, teks_awal: str) -> Optional[TabelKandidat]:
    t = teks_awal.upper()
    if "TRANSACTION HISTORY" not in t or "PERMATA ME" not in t:
        return None
    import pdfplumber

    rows: List[List[str]] = []
    hal: List[Optional[int]] = []
    no_rek = None
    bulan_dok: Optional[Tuple[int, int]] = None
    with pdfplumber.open(io.BytesIO(isi)) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=2, y_tolerance=2, extra_attrs=["non_stroking_color"])
            words = [dict(w, x0=float(w["x0"]), x1=float(w["x1"]), top=float(w["top"]), bottom=float(w["bottom"]))
                     for w in words]
            lines = _baris_visual(words)
            tgl: Optional[date] = None
            blok: List[Dict[str, Any]] = []      # {top0, top1, teks[], tgl}
            nominal: List[Tuple[float, str, Decimal]] = []
            batas_kanan = float(page.width) * 0.7
            for ln in lines:
                teks = " ".join(w["text"] for w in ln)
                if no_rek is None and re.fullmatch(r"\d{4}-\d{4}-\d{4}", teks):
                    no_rek = re.sub(r"\D", "", teks)
                    continue
                if bulan_dok is None:
                    m = re.fullmatch(rf"({'|'.join(_BULAN)}) (\d{{4}})", teks.upper())
                    if m:
                        bulan_dok = (int(m.group(2)), _BULAN[m.group(1)])
                        continue
                if _RE_PM_TGL.match(teks):
                    tgl = _tanggal(teks)
                    continue
                if teks.startswith(("Halaman/Page", "Transaction History")) or ln[0]["top"] > float(page.height) * 0.9:
                    continue
                kanan = [w for w in ln if w["x0"] >= batas_kanan]
                if kanan and _RE_NOMINAL.match(kanan[-1]["text"]):
                    arah = _warna(kanan[-1])
                    nilai, _ = parse_angka(kanan[-1]["text"])
                    if nilai is not None:
                        nominal.append(((ln[0]["top"] + ln[0]["bottom"]) / 2, arah or "", nilai))
                    ln = [w for w in ln if w["x0"] < batas_kanan]
                    if not ln:
                        continue
                if tgl is None:
                    continue   # judul halaman (nama produk) sebelum tanggal pertama
                teks = " ".join(w["text"] for w in ln)
                if blok and blok[-1]["tgl"] == tgl and ln[0]["top"] - blok[-1]["top1"] < 24:
                    blok[-1]["teks"].append(teks)
                    blok[-1]["top1"] = ln[0]["bottom"]
                else:
                    blok.append({"top0": ln[0]["top"], "top1": ln[0]["bottom"], "teks": [teks], "tgl": tgl})
            for b in blok:
                cocok = [n for n in nominal if b["top0"] - 6 <= n[0] <= b["top1"] + 6]
                if not cocok:
                    continue
                _, arah, nilai = cocok[0]
                rows.append([_tgl_teks(b["tgl"]), " ".join(b["teks"]),
                             _angka_teks(nilai) if arah != "credit" else "", _angka_teks(nilai) if arah == "credit" else ""])
                hal.append(page.page_number)
    if not rows:
        return None
    periode: Tuple[Optional[date], Optional[date]] = (None, None)
    if bulan_dok:
        y, m = bulan_dok
        periode = (date(y, m, 1), date.fromordinal(date(y + (m == 12), m % 12 + 1, 1).toordinal() - 1))
    rows.reverse()     # dokumen urut terbaru dulu -> urut kronologis
    hal.reverse()
    return _kandidat("permata_me", _PM_HEADERS, _PM_ROLES, rows, [], "Permata", periode, no_rek, hal)


# ============================================================
# 3) Laporan belanja Petty Cash (Excel)
# ============================================================

_PE_HEADERS = ["DATE", "NAME PRODUCT", "TOTAL", "TRANSFER IN"]
_PE_ROLES = ["date", "description", "debit", "credit"]


def _header_petty(rows: List[List[str]]) -> Optional[int]:
    for i, r in enumerate(rows[:5]):
        n = [(c or "").strip().upper() for c in r]
        if n and n[0] == "DATE" and {"UNIT", "PRICE", "TOTAL"} <= set(n[:6]):
            return i
    return None


def _tgl_sel(v: str, tahun: Optional[int]) -> Optional[date]:
    v = (v or "").strip()
    if not v:
        return None
    return _tanggal(v, tahun)


def _petty_expense(dok: Dokumen) -> Optional[TabelKandidat]:
    if dok.file_type != "Excel":
        return None
    terbaik: Optional[Tuple[date, str, List[List[str]], int]] = None
    for nama, rows in dok.sheets:
        i = _header_petty(rows)
        if i is None:
            continue
        tgl = sorted(d for d in (_tgl_sel(r[0] if r else "", None) for r in rows[i + 1:]) if d)
        if not tgl:
            continue
        tengah = tgl[len(tgl) // 2]   # median: 1 tanggal salah ketik (mis. 2028) tidak menentukan sheet terbaru
        if terbaik is None or tengah > terbaik[0]:
            terbaik = (tengah, nama, rows, i)
    if terbaik is None:
        return None
    akhir, nama, rows, i_hdr = terbaik
    tahun = akhir.year
    out: List[List[str]] = []
    ringkasan: List[str] = []
    tgl: Optional[date] = None
    blok_dana = False
    for r in rows[i_hdr + 1:]:
        r = (list(r) + [""] * 6)[:6]
        c0, c1, c4 = r[0].strip(), r[1].strip(), r[4].strip()
        if c1.upper() == "NAME PRODUCT" or (c0.upper() == "DATE" and blok_dana):
            break   # tabel lain di bawah laporan
        if c1.upper() == "TOTAL":
            v, _ = parse_angka(c4)
            if v is not None:
                ringkasan.append(f"TOTAL DEBIT {_angka_teks(v)}")
            blok_dana = True
            continue
        if any("SISA PETTY CASH" in (c or "").upper() for c in r):
            v, _ = parse_angka(c4)
            if v is not None:
                ringkasan.append(f"CLOSING BALANCE {_angka_teks(v)}")
            break
        if blok_dana:
            u = c0.upper()
            v, _ = parse_angka(c4)
            if u.startswith("REST MONEY") and v is not None:
                ringkasan.append(f"OPENING BALANCE {_angka_teks(v)}")
            elif u.startswith("TRANSFER") and v:
                m = re.search(rf"(\d{{1,2}})\s+({'|'.join(sorted(_BULAN, key=len, reverse=True))})", u)
                d = None
                if m:
                    bln = _BULAN[m.group(2)]
                    th = tahun - 1 if bln > akhir.month + 1 else tahun
                    try:
                        d = date(th, bln, int(m.group(1)))
                    except ValueError:
                        d = None
                out.append([_tgl_teks(d), c0, "", _angka_teks(v)])
            continue
        d = _tgl_sel(c0, tahun)
        if d:
            tgl = d
        v, _ = parse_angka(c4)
        if not c1 or not v:
            continue   # baris subtotal harian (kolom 'sum') / baris kosong
        out.append([_tgl_teks(tgl), c1, _angka_teks(v), ""])
    if not out:
        return None
    mulai = date(akhir.year, akhir.month, 1)
    periode = (mulai, date.fromordinal(date(akhir.year + (akhir.month == 12), akhir.month % 12 + 1, 1).toordinal() - 1))
    k = _kandidat("petty_expense", _PE_HEADERS, _PE_ROLES, out, ringkasan, "Petty Cash", periode, None, sheet=nama)
    if k is not None:
        k.sheets = [nama]
        k.teks_atas = f"PETTY CASH {nama}"
    return k


# ============================================================
# Titik masuk
# ============================================================

def kandidat_resep(dok: Dokumen, isi: bytes) -> List[TabelKandidat]:
    """Semua resep yang cocok dengan bentuk dokumen (biasanya 0 atau 1)."""
    hasil: List[TabelKandidat] = []
    if dok.file_type == "PDF":
        for fn in (_permata_inquiry, _permata_me):
            k = fn(isi, dok.teks_awal)
            if k is not None and k.baris:
                hasil.append(k)
    elif dok.file_type == "Excel":
        k = _petty_expense(dok)
        if k is not None and k.baris:
            hasil.append(k)
    return hasil
