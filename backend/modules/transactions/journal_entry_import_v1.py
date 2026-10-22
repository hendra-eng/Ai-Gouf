"""
modules/transactions/journal_entry_import_v1.py
==================================================
Upload file laporan jurnal (CSV/Excel) + ekstraksi otomatis lewat Journal
Entry Import Template + daftar file/baris untuk tab "Source Data" Journal Entry
-- versi Journal Entry dari modules/transactions/purchase_import_v1.py (bentuk &
alur SENGAJA dibuat separarel mungkin; lihat root/SALES_IMPORT_TEMPLATES.md
untuk konsep templatenya secara umum). Endpoint:

    POST   /api/v1/transactions/journal-entries/import/upload
    GET    /api/v1/transactions/journal-entries/source-files
    GET    /api/v1/transactions/journal-entries/source-files/{id}
    PUT    /api/v1/transactions/journal-entries/source-files/{id}
    DELETE /api/v1/transactions/journal-entries/source-files/{id}
    GET    /api/v1/transactions/journal-entries/source-rows?source_file_id=
    POST   /api/v1/transactions/journal-entries/source-files/{id}/promote-to-journals

Alur (ringkas):

    1. Upload: baca file mentah, tentukan file_type, cocokkan ke template AKTIF
       milik (management_client_id, file_type) lewat hash baris header (fungsi
       baca file & hash DIPAKAI ULANG dari sales_import_v1).
    2. KETEMU template -> ekstrak baris pakai resep mapping_rules (format_type
       'flat_grouped_by_voucher': baris-baris dengan VOUCHER yang sama digabung
       jadi 1 journal entry multi-baris; 'blank_separated_journal': tidak ada kolom
       voucher -- blok baris dipisah baris kosong, judul jurnal di kolom pertama; format flat punya opsi
       resep split_by_date / round_decimals / skip_zero_lines, dan baris bernilai tanpa voucher
       dimunculkan sebagai baris staging tidak valid; 'month_matrix_journal': rekap bulanan
       berbentuk matriks (baris = akun, kolom = bulan x DEBIT/KREDIT) -- tiap blok akun x bulan
       jadi 1 jurnal; resep flat juga boleh punya 'extra_sheets' = sheet lain di file Excel yang
       sama dengan header identik, diekstrak dengan resep yang sama + awalan nomor jurnal).
       Hasilnya dicatat di
       financial_transaction_journal_entry_source_files (daftar file) + 1 baris
       staging per journal entry di ..._source_rows (File Preview). BELUM ada
       draft JE di tahap ini.
    3. TIDAK ketemu template -> file tetap dicatat sebagai 'Needs Review' tanpa
       baris (template_matched=false) supaya frontend bisa fallback ke parsing
       lokal di ImportJournalModal.tsx atau memberi tahu user membuat template.
    4. "Create Journal" (promote-to-journals): baris VALID & belum pernah
       dipromosikan naik jadi draft JE lewat dbc.create_je_draft_with_lines
       (fungsi atomik yang sama dipakai New Journal Entry) -> muncul di tab
       JE Transaction -> Journal Preview -> Exceptions / Posted. Idempoten.

File TIDAK disimpan ke disk -- diproses di memory saja, konsisten dengan
sales_import_v1.py & purchase_import_v1.py.
"""

from __future__ import annotations

import re
import time
from calendar import monthrange
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from .journal_entry_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi
from .sales_import_v1 import (  # algoritma baca-file & signature SAMA PERSIS, tidak ada alasan duplikasi
    MAX_UPLOAD_BYTES,
    _ambil_kolom,
    _baca_file_jadi_baris,
    _detect_file_type,
    _baca_excel_baris,
    _hash_baris,
    _nama_sheet_excel,
    _parse_angka,
    _parse_tanggal,
    ringkas_import_template,
)

logger = get_module_logger("transactions_journal_entry_import_v1")

router = APIRouter(prefix="/api/v1/transactions/journal-entries", tags=["transactions-journal-entry-v1"])

_BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


# ============================================================
# 1) Cocokkan file ke template yang sudah ada (versi sederhana dari
#    sales_import_v1._cocokkan_template -- belum ada kebutuhan varian
#    "Multi" untuk Journal Entry sejauh ini, tinggal ditambah kalau perlu).
# ============================================================

def _kandidat_template(management_client_id: str, file_type: str) -> List[Dict[str, Any]]:
    return [
        t for t in dbc.list_je_import_templates(client_id=management_client_id, hanya_aktif=True)
        if t.get("file_type") == file_type
    ]


def _cocokkan_template(content: bytes, file_type: str, management_client_id: str) -> Optional[Tuple[Dict[str, Any], List[List[str]]]]:
    for template in _kandidat_template(management_client_id, file_type):
        mapping_rules = template.get("mapping_rules") or {}
        encoding = mapping_rules.get("encoding", "utf-8")
        delimiter = mapping_rules.get("delimiter", ",")
        try:
            rows = _baca_file_jadi_baris(content, file_type, encoding, delimiter, template.get("sheet_name"), mapping_rules.get("quoted_fields", False))
        except Exception as e:
            logger.warning(f"Gagal decode file pakai template {template['id']}: {e}")
            continue
        idx = template["header_row_index"] - 1
        if idx < 0 or idx >= len(rows):
            continue
        # sel kosong di ujung baris header (lebar sheet Excel bisa berubah) tidak ikut di-hash
        header_terpangkas = list(rows[idx])
        while header_terpangkas and not (header_terpangkas[-1] or "").strip():
            header_terpangkas.pop()
        sig = template["column_signature_hash"]
        if _hash_baris(rows[idx]) == sig or _hash_baris(header_terpangkas) == sig:
            return template, rows
    return None


# ============================================================
# 2) Ekstraksi: format_type 'flat_grouped_by_voucher' -- tabel flat,
#    baris-baris dengan nilai kolom kunci (mapping_rules.columns.voucher)
#    yang sama digabung jadi 1 journal entry multi-baris.
# ============================================================

def _cari_kolom(header: List[str], nama: str) -> Optional[int]:
    """Cari index kolom via NAMA (dinormalisasi trim+collapse-spasi+lower),
    bukan posisi -- lebih kebal terhadap file berikutnya yang urutan
    kolomnya sedikit berubah selama nama headernya tetap sama."""
    target = " ".join(nama.strip().lower().split())
    for i, h in enumerate(header):
        if " ".join((h or "").strip().lower().split()) == target:
            return i
    return None


def _parse_flat_grouped_by_voucher(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    """Kembalikan {"groups": [...], "skipped_no_key": int, "skipped_zero_lines": int} -- lihat
    docstring modul untuk penjelasan format_type ini. Tiap group:
    {je_number, entry_date, description, source_type, lines: [...],
    total_debit, total_credit, balanced, errors: [...], notes?}.

    Opsi resep (mapping_rules) -- SEMUA opsional, tanpa opsi perilaku sama seperti versi lama:
      - round_decimals: bulatkan debit/kredit PER BARIS ke N desimal (mis. 2).
      - skip_zero_lines: baris debit=kredit=0 dilewati; voucher yang semua barisnya 0 dilewati.
      - split_by_date: voucher yang dipakai ulang di beberapa TANGGAL dan seimbang per tanggal
        dipecah jadi 1 jurnal per tanggal (je_number = <voucher>-<YYYYMMDD>). Kalau tidak seimbang
        per tanggal, tetap 1 jurnal bertanggal paling akhir + catatan.
      - balance_tolerance: toleransi selisih debit-kredit (default 0.01).
    Baris TANPA voucher yang bernilai (debit/kredit != 0) tidak dibuang diam-diam: dimunculkan
    sebagai baris staging TIDAK VALID (je_number kosong) supaya terlihat di File Preview dan
    status file jadi 'Needs Review'. Baris tanpa voucher dan tanpa nominal (judul, catatan) dilewati."""
    recipe = template["mapping_rules"]
    kolom = recipe["columns"]
    header_idx = template["header_row_index"] - 1
    data_idx = template["data_start_row_index"] - 1
    if header_idx < 0 or header_idx >= len(rows):
        return {"groups": [], "skipped_no_key": 0, "skipped_zero_lines": 0}
    header = rows[header_idx]

    idx = {key: _cari_kolom(header, nama) for key, nama in kolom.items()}
    key_field = recipe.get("je_number_source", "voucher")
    i_key = idx.get(key_field)
    if i_key is None:
        raise ValueError(f"Kolom kunci '{kolom.get(key_field)}' (field '{key_field}') tidak ditemukan di header file.")

    number_format = recipe.get("number_format", {})
    i_tanggal = idx.get(recipe.get("entry_date_source", "tanggal"))
    i_deskripsi = idx.get(recipe.get("description_source", "deskripsi"))
    i_deskripsi_fallback = idx.get(recipe.get("description_fallback_source", ""))
    i_akun_kode = idx.get(recipe.get("account_code_source", "kode_akun"))
    i_akun_nama = idx.get(recipe.get("account_name_source", "akun_deskripsi"))
    i_debit = idx.get(recipe.get("debit_source", "debit"))
    i_credit = idx.get(recipe.get("credit_source", "credit"))
    i_cost_center = idx.get(recipe.get("cost_center_source", ""))

    desimal_baris = int(recipe["round_decimals"]) if recipe.get("round_decimals") is not None else None
    desimal_total = desimal_baris if desimal_baris is not None else 2
    skip_zero = bool(recipe.get("skip_zero_lines", False))
    split_by_date = bool(recipe.get("split_by_date", False))
    toleransi = float(recipe.get("balance_tolerance", 0.01))
    date_format = recipe.get("date_format", "YYYY-MM-DD")
    min_lines = recipe.get("min_lines_per_group", 2)

    def angka(s: str) -> float:
        v = _parse_angka(s, number_format)
        return round(v, desimal_baris) if desimal_baris is not None else v

    # item = (nomor_baris_excel, tanggal_mentah, line)
    groups: "Dict[str, Dict[str, Any]]" = {}
    tanpa_key: List[Tuple[int, str, str, Dict[str, Any]]] = []
    skipped_no_key = 0
    skipped_zero = 0
    for i in range(data_idx, len(rows)):
        row = rows[i]
        no_baris = i + 1
        if all((c or "").strip() == "" for c in row):
            continue
        key = _ambil_kolom(row, i_key + 1) if i_key is not None else ""
        tanggal_raw = _ambil_kolom(row, i_tanggal + 1) if i_tanggal is not None else ""
        deskripsi_baris = (_ambil_kolom(row, i_deskripsi + 1) if i_deskripsi is not None else "") or ""
        line = {
            "account_code": _ambil_kolom(row, i_akun_kode + 1) if i_akun_kode is not None else "",
            "account_name": (_ambil_kolom(row, i_akun_nama + 1) if i_akun_nama is not None else "") or None,
            "description": deskripsi_baris or None,
            "debit": angka(_ambil_kolom(row, i_debit + 1) if i_debit is not None else ""),
            "credit": angka(_ambil_kolom(row, i_credit + 1) if i_credit is not None else ""),
            "cost_center": (_ambil_kolom(row, i_cost_center + 1) if i_cost_center is not None else "") or None,
        }
        if not key:
            skipped_no_key += 1
            if line["debit"] != 0 or line["credit"] != 0:
                tanpa_key.append((no_baris, tanggal_raw, deskripsi_baris, line))
            continue
        if skip_zero and line["debit"] == 0 and line["credit"] == 0:
            skipped_zero += 1
            continue
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "je_number": key,
                "description": deskripsi_baris
                    or (_ambil_kolom(row, i_deskripsi_fallback + 1) if i_deskripsi_fallback is not None else ""),
                "source_type": recipe.get("source_type_default", "Import"),
                "items": [],
            }
        g["items"].append((no_baris, tanggal_raw, line))

    def susun(je_number: str, description: str, source_type: str, entry_date: Optional[date],
              lines: List[Dict[str, Any]], notes: Optional[str]) -> Dict[str, Any]:
        total_debit = round(sum(l["debit"] for l in lines), desimal_total)
        total_credit = round(sum(l["credit"] for l in lines), desimal_total)
        errors = []
        if entry_date is None:
            errors.append("Date could not be read.")
        if len(lines) < min_lines:
            errors.append(f"Minimum {min_lines} lines per journal entry.")
        if any(not l["account_code"] for l in lines):
            errors.append("There is a line without an account code.")
        if any(l["debit"] > 0 and l["credit"] > 0 for l in lines):
            errors.append("There is a line with both debit & credit filled in.")
        balanced = abs(total_debit - total_credit) < toleransi and total_debit > 0
        if not balanced:
            errors.append(f"Not balanced (Debit {total_debit:,.2f} != Credit {total_credit:,.2f}).")
        hasil_group = {
            "je_number": je_number,
            "entry_date": entry_date,
            "description": description or None,
            "source_type": source_type,
            "lines": lines,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "balanced": balanced and not errors,
            "errors": errors,
        }
        if notes:
            hasil_group["notes"] = notes
        return hasil_group

    def rentang(items: List[Tuple[int, str, Dict[str, Any]]]) -> str:
        a, b = items[0][0], items[-1][0]
        return f"row {a}" if a == b else f"rows {a}-{b}"

    hasil: List[Dict[str, Any]] = []
    for je_number, g in groups.items():
        items = g["items"]
        if not items:
            continue
        # tanggal per baris
        tgl = [_parse_tanggal(it[1], date_format) for it in items]
        per_tanggal: "Dict[Any, List[Tuple[int, str, Dict[str, Any]]]]" = {}
        for it, d in zip(items, tgl):
            per_tanggal.setdefault(d, []).append(it)

        def seimbang(sub: List[Tuple[int, str, Dict[str, Any]]]) -> bool:
            return abs(sum(x[2]["debit"] for x in sub) - sum(x[2]["credit"] for x in sub)) <= toleransi

        tanggal_ada = [d for d in per_tanggal if d is not None]
        if split_by_date and len(tanggal_ada) > 1:
            if None not in per_tanggal and all(seimbang(v) for v in per_tanggal.values()):
                for d, sub in per_tanggal.items():  # urutan kemunculan di file
                    hasil.append(susun(
                        f"{je_number}-{d.strftime('%Y%m%d')}", g["description"], g["source_type"], d,
                        [x[2] for x in sub],
                        f"Voucher used on {len(per_tanggal)} different dates and is balanced per date; "
                        f"split into {len(per_tanggal)} journal entries | Source: {rentang(sub)}",
                    ))
                continue
            hasil.append(susun(
                je_number, g["description"], g["source_type"], max(tanggal_ada), [x[2] for x in items],
                "Voucher has different dates but is not balanced per date; kept as 1 journal entry dated "
                + max(tanggal_ada).isoformat() + f" | Source: {rentang(items)}",
            ))
            continue
        # perilaku lama: tanggal = tanggal baris pertama voucher
        hasil.append(susun(je_number, g["description"], g["source_type"], tgl[0], [x[2] for x in items], None))

    # baris bernilai tanpa voucher -> baris staging TIDAK VALID (terlihat di File Preview)
    run: List[Tuple[int, str, str, Dict[str, Any]]] = []
    runs: List[List[Tuple[int, str, str, Dict[str, Any]]]] = []
    for it in tanpa_key:
        if run and it[0] != run[-1][0] + 1:
            runs.append(run)
            run = []
        run.append(it)
    if run:
        runs.append(run)
    for r in runs:
        lines = [x[3] for x in r]
        total_debit = round(sum(l["debit"] for l in lines), desimal_total)
        total_credit = round(sum(l["credit"] for l in lines), desimal_total)
        rng = f"row {r[0][0]}" if len(r) == 1 else f"rows {r[0][0]}-{r[-1][0]}"
        hasil.append({
            "je_number": "",
            "entry_date": _parse_tanggal(r[0][1], date_format),
            "description": r[0][2] or None,
            "source_type": recipe.get("source_type_default", "Import"),
            "lines": lines,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "balanced": False,
            "errors": [f"{rng.capitalize()} have an amount but no voucher; skipped (add a voucher in the file to import)."],
            "notes": f"Source: {rng}",
        })
    return {"groups": hasil, "skipped_no_key": skipped_no_key, "skipped_zero_lines": skipped_zero}


# ============================================================
# 2b) Ekstraksi: format_type 'blank_separated_journal' -- TIDAK ada kolom
#     voucher. Satu jurnal = blok baris berurutan yang dipisah baris KOSONG;
#     baris judul (kolom pertama terisi, kode akun kosong) = nama jurnal.
#     Contoh: AADL "Adjustment Journal" (kolom dibaca lewat POSISI karena label
#     header di file tidak sejajar dengan isi kolomnya).
#     Aturan resep (mapping_rules; posisi kolom 1-based di "columns"):
#       - blok tanpa judul memakai judul blok sebelumnya (lanjutan jurnal yang sama)
#       - split_by_date: blok berisi beberapa tanggal DAN seimbang per tanggal -> dipecah
#         jadi 1 jurnal per tanggal; kalau tidak seimbang per tanggal tetap 1 jurnal
#         bertanggal paling akhir + catatan
#       - baris bernilai 0/kosong dilewati (skip_zero_lines); jurnal yang semua barisnya 0 dilewati
#       - nomor jurnal: <je_number_prefix>-<YYYYMM tanggal jurnal>-<urut per bulan>
#       - toleransi selisih debit-kredit: balance_tolerance (default 0.01)
# ============================================================

def _parse_blank_separated_journal(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    recipe = template["mapping_rules"]
    kol = recipe["columns"]
    data_idx = max(template["data_start_row_index"] - 1, 0)
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "YYYY-MM-DD")
    prefix = recipe.get("je_number_prefix", "JE")
    toleransi = float(recipe.get("balance_tolerance", 0.01))
    desimal = int(recipe.get("round_decimals", 2))
    min_lines = int(recipe.get("min_lines_per_group", 2))

    def sel(row: List[str], kunci: str) -> str:
        return _ambil_kolom(row, kol[kunci]) if kunci in kol else ""

    # 1) pecah jadi blok (judul, [(nomor_baris, baris)])
    blok: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    judul_terakhir: Optional[str] = None
    for i in range(data_idx, len(rows)):
        row = rows[i]
        if all((c or "").strip() == "" for c in row):
            cur = None
            continue
        judul, kode = sel(row, "judul"), sel(row, "kode_akun")
        if judul and not kode:
            judul_terakhir = " ".join(judul.split())
            cur = {"judul": judul_terakhir, "tanpa_judul": False, "baris": []}
            blok.append(cur)
            continue
        if cur is None:
            cur = {"judul": judul_terakhir, "tanpa_judul": judul_terakhir is not None, "baris": []}
            blok.append(cur)
        cur["baris"].append((i + 1, row))

    # 2) tiap blok -> 1+ jurnal
    skipped = 0
    mentah: List[Dict[str, Any]] = []
    for b in blok:
        baris_ok: List[Tuple[int, Optional[date], Dict[str, Any]]] = []
        for no_baris, row in b["baris"]:
            debit = round(_parse_angka(sel(row, "debit"), number_format), desimal)
            credit = round(_parse_angka(sel(row, "credit"), number_format), desimal)
            if debit == 0 and credit == 0 and recipe.get("skip_zero_lines", True):
                skipped += 1
                continue
            raw_tgl = sel(row, "tanggal")
            tanggal = _parse_tanggal(raw_tgl[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", raw_tgl) else raw_tgl, date_format) if raw_tgl else None
            baris_ok.append((no_baris, tanggal, {
                "account_code": sel(row, "kode_akun"),
                "account_name": sel(row, "akun_deskripsi") or None,
                "description": sel(row, "deskripsi") or None,
                "debit": debit,
                "credit": credit,
                "cost_center": None,
            }))
        if not baris_ok:
            continue
        per_tanggal: "Dict[Any, List[Tuple[int, Optional[date], Dict[str, Any]]]]" = {}
        for item in baris_ok:
            per_tanggal.setdefault(item[1], []).append(item)

        def seimbang(items: List[Tuple[int, Optional[date], Dict[str, Any]]]) -> bool:
            return abs(sum(x[2]["debit"] for x in items) - sum(x[2]["credit"] for x in items)) <= toleransi

        catatan_blok: List[str] = []
        if b["tanpa_judul"]:
            catatan_blok.append("Block has no title row; the previous title was used.")
        if len(per_tanggal) > 1 and recipe.get("split_by_date", True) and all(seimbang(v) for v in per_tanggal.values()) and None not in per_tanggal:
            kelompok = [sorted(v, key=lambda x: x[0]) for _, v in sorted(per_tanggal.items(), key=lambda kv: kv[1][0][0])]
            catatan_blok.append(f"Block has {len(per_tanggal)} different dates and is balanced per date; split into {len(per_tanggal)} journal entries.")
        else:
            kelompok = [baris_ok]
            tanggal_ada = [d for d in per_tanggal if d is not None]
            if len(tanggal_ada) > 1:
                catatan_blok.append("Block has different dates but is not balanced per date; kept as 1 journal entry dated " + max(tanggal_ada).isoformat() + ".")

        for items in kelompok:
            tanggal_ada = [x[1] for x in items if x[1] is not None]
            entry_date = max(tanggal_ada) if tanggal_ada else None
            lines = [x[2] for x in items]
            total_debit = round(sum(l["debit"] for l in lines), desimal)
            total_credit = round(sum(l["credit"] for l in lines), desimal)
            deskripsi = b["judul"] or next((l["description"] for l in lines if l["description"]), None)
            errors: List[str] = []
            if entry_date is None:
                errors.append("Date could not be read.")
            if len(lines) < min_lines:
                errors.append(f"Minimum {min_lines} lines per journal entry.")
            if any(not l["account_code"] for l in lines):
                errors.append("There is a line without an account code.")
            if any(l["debit"] > 0 and l["credit"] > 0 for l in lines):
                errors.append("There is a line with both debit & credit filled in.")
            balanced = abs(total_debit - total_credit) <= toleransi and total_debit > 0
            if not balanced:
                errors.append(f"Not balanced (Debit {total_debit:,.2f} != Credit {total_credit:,.2f}).")
            no_awal, no_akhir = items[0][0], items[-1][0]
            catatan = [*catatan_blok, f"Source: rows {no_awal}-{no_akhir}" if no_awal != no_akhir else f"Source: row {no_awal}"]
            mentah.append({
                "je_number": "",
                "entry_date": entry_date,
                "description": deskripsi,
                "source_type": recipe.get("source_type_default", "Import"),
                "lines": lines,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "balanced": balanced and not errors,
                "errors": errors,
                "notes": " | ".join(catatan),
            })

    # 3) nomor jurnal: <prefix>-<YYYYMM>-<urut per bulan> (urutan kemunculan di file)
    urut: Dict[str, int] = {}
    for g in mentah:
        periode = g["entry_date"].strftime("%Y%m") if g["entry_date"] else "NODATE"
        urut[periode] = urut.get(periode, 0) + 1
        g["je_number"] = f"{prefix}-{periode}-{urut[periode]:03d}"
    return {"groups": mentah, "skipped_no_key": skipped, "skipped_zero_lines": skipped}


# ============================================================
# 2c) Ekstraksi: format_type 'month_matrix_journal' -- rekap bulanan berbentuk
#     MATRIKS (mis. blok "JURNAL GAJI" SAU): kolom A = nama akun (label), kolom
#     berikutnya berpasangan DEBIT / KREDIT per bulan; baris header (header_row_index)
#     memuat teks DEBIT/KREDIT, baris sesudahnya (header_row_index + 1) memuat nomor
#     bulan 1-12. Tidak ada kolom tanggal/kode akun di file -> resep yang memberinya:
#       - year: tahun jurnal (kalau kosong diambil dari 4 digit di nama sheet, mis. "... 2026")
#       - entry_date_rule: 'month_end' (satu-satunya yang didukung) -> tanggal = akhir bulan
#       - label_column: posisi kolom label (1-based, default 1)
#       - account_map: {"<LABEL>": {"code": "...", "name": "..."}}; kunci boleh
#         "<LABEL PERTAMA BLOK>|<LABEL>" untuk label yang sama di blok berbeda (mis. "UTANG ").
#         Pencarian tidak peka huruf besar/kecil & spasi. Label tanpa pemetaan -> baris tanpa
#         kode akun -> jurnal TIDAK VALID (terlihat di File Preview), bukan hilang diam-diam.
#     Blok = baris-baris berurutan yang labelnya terisi; label kosong = pemisah blok. 1 blok x 1 bulan
#     = 1 jurnal (baris bernilai 0/kosong dilewati; blok-bulan yang semuanya 0 tidak dibuat jurnal).
#     Nomor jurnal: <je_number_prefix>-<YYYYMM>-<urut blok 2 digit>. Baris tanpa label tetapi
#     bernilai muncul sebagai baris staging TIDAK VALID.
# ============================================================

def _parse_month_matrix_journal(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    recipe = template["mapping_rules"]
    header_idx = template["header_row_index"] - 1
    data_idx = max(template["data_start_row_index"] - 1, 0)
    if header_idx < 0 or header_idx + 1 >= len(rows):
        return {"groups": [], "skipped_no_key": 0, "skipped_zero_lines": 0}
    number_format = recipe.get("number_format", {})
    desimal = int(recipe.get("round_decimals", 2))
    toleransi = float(recipe.get("balance_tolerance", 0.01))
    min_lines = int(recipe.get("min_lines_per_group", 2))
    prefix = recipe.get("je_number_prefix", "JE")
    source_type = recipe.get("source_type_default", "Import")
    label_col = int(recipe.get("label_column", 1))
    judul = recipe.get("description_prefix", "Journal")

    tahun = recipe.get("year")
    if tahun is None:
        m = re.search(r"(20\d{2})", template.get("sheet_name") or "")
        tahun = int(m.group(1)) if m else None
    if tahun is None:
        raise ValueError("Tahun jurnal tidak diketahui: isi mapping_rules.year atau pakai nama sheet yang memuat tahun.")
    tahun = int(tahun)

    def norm(t: str) -> str:
        return " ".join((t or "").strip().lower().split())

    # peta bulan -> {"debit": idx0, "credit": idx0}
    header, baris_bulan = rows[header_idx], rows[header_idx + 1]
    kolom_bulan: Dict[int, Dict[str, int]] = {}
    for j, sel in enumerate(header):
        jenis = {"debit": "debit", "kredit": "credit", "credit": "credit"}.get(norm(sel))
        if jenis is None or j >= len(baris_bulan):
            continue
        try:
            bulan = int(float((baris_bulan[j] or "").strip()))
        except ValueError:
            continue
        if 1 <= bulan <= 12:
            kolom_bulan.setdefault(bulan, {})[jenis] = j
    kolom_bulan = {b: c for b, c in kolom_bulan.items() if "debit" in c and "credit" in c}

    akun_map = {norm(k): v for k, v in (recipe.get("account_map") or {}).items()}

    def cari_akun(blok_pertama: str, label: str) -> Optional[Dict[str, str]]:
        return akun_map.get(norm(blok_pertama) + "|" + norm(label)) or akun_map.get(norm(label))

    def angka(row: List[str], j: int) -> float:
        return round(_parse_angka(_ambil_kolom(row, j + 1), number_format), desimal)

    # 1) blok berurutan berdasarkan label terisi
    blok: List[List[Tuple[int, List[str], str]]] = []
    cur: Optional[List[Tuple[int, List[str], str]]] = None
    tanpa_label: List[Tuple[int, List[str]]] = []
    for i in range(data_idx, len(rows)):
        row = rows[i]
        label = _ambil_kolom(row, label_col)
        if not label:
            cur = None
            nilai = any(angka(row, j) != 0 for c in kolom_bulan.values() for j in c.values())
            if nilai:
                tanpa_label.append((i + 1, row))
            continue
        if cur is None:
            cur = []
            blok.append(cur)
        cur.append((i + 1, row, label))

    # 2) tiap blok x bulan -> 1 jurnal
    hasil: List[Dict[str, Any]] = []
    skipped_zero = 0
    for no_blok, b in enumerate(blok, start=1):
        pertama = b[0][2]
        for bulan in sorted(kolom_bulan):
            c = kolom_bulan[bulan]
            lines: List[Dict[str, Any]] = []
            for no_baris, row, label in b:
                debit, credit = angka(row, c["debit"]), angka(row, c["credit"])
                if debit == 0 and credit == 0:
                    skipped_zero += 1
                    continue
                akun = cari_akun(pertama, label)
                lines.append({
                    "account_code": (akun or {}).get("code", ""),
                    "account_name": (akun or {}).get("name") or label.strip(),
                    "description": label.strip(),
                    "debit": debit,
                    "credit": credit,
                    "cost_center": None,
                })
                lines[-1]["_row"] = no_baris
                lines[-1]["_label"] = label.strip()
            if not lines:
                continue
            tgl = date(tahun, bulan, monthrange(tahun, bulan)[1])
            total_debit = round(sum(l["debit"] for l in lines), desimal)
            total_credit = round(sum(l["credit"] for l in lines), desimal)
            errors: List[str] = []
            tanpa_akun = [l["_label"] for l in lines if not l["account_code"]]
            if tanpa_akun:
                errors.append("There is a line without an account code (no account_map entry for: " + ", ".join(tanpa_akun) + ").")
            if len(lines) < min_lines:
                errors.append(f"Minimum {min_lines} lines per journal entry.")
            if any(l["debit"] > 0 and l["credit"] > 0 for l in lines):
                errors.append("There is a line with both debit & credit filled in.")
            balanced = abs(total_debit - total_credit) <= toleransi and total_debit > 0
            if not balanced:
                errors.append(f"Not balanced (Debit {total_debit:,.2f} != Credit {total_credit:,.2f}).")
            rng = f"rows {b[0][0]}-{b[-1][0]}" if b[0][0] != b[-1][0] else f"row {b[0][0]}"
            for l in lines:
                l.pop("_row", None)
                l.pop("_label", None)
            hasil.append({
                "je_number": f"{prefix}-{tahun}{bulan:02d}-{no_blok:02d}",
                "entry_date": tgl,
                "description": f"{judul} {tahun}-{bulan:02d} - {pertama.strip()}",
                "source_type": source_type,
                "lines": lines,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "balanced": balanced and not errors,
                "errors": errors,
                "notes": f"Source: {rng}, month {bulan}",
            })

    # 3) baris tanpa label tetapi bernilai -> staging TIDAK VALID
    for no_baris, row in tanpa_label:
        hasil.append({
            "je_number": "",
            "entry_date": None,
            "description": None,
            "source_type": source_type,
            "lines": [],
            "total_debit": 0.0,
            "total_credit": 0.0,
            "balanced": False,
            "errors": [f"Row {no_baris} has an amount but no account label; skipped."],
            "notes": f"Source: row {no_baris}",
        })
    return {"groups": hasil, "skipped_no_key": 0, "skipped_zero_lines": skipped_zero}


def _ekstrak_dengan_template(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type == "flat_grouped_by_voucher":
        return _parse_flat_grouped_by_voucher(rows, template)
    if format_type == "blank_separated_journal":
        return _parse_blank_separated_journal(rows, template)
    if format_type == "month_matrix_journal":
        return _parse_month_matrix_journal(rows, template)
    raise ValueError(f"format_type '{format_type}' belum didukung parser Journal Entry Import.")


def _header_cocok_template(rows: List[List[str]], template: Dict[str, Any]) -> bool:
    """Header sheet tambahan harus sama dengan header template (aturan hash yang sama dengan
    _cocokkan_template: sel kosong di ujung header tidak ikut di-hash)."""
    idx = template["header_row_index"] - 1
    if idx < 0 or idx >= len(rows):
        return False
    header_terpangkas = list(rows[idx])
    while header_terpangkas and not (header_terpangkas[-1] or "").strip():
        header_terpangkas.pop()
    sig = template["column_signature_hash"]
    return _hash_baris(rows[idx]) == sig or _hash_baris(header_terpangkas) == sig


def _ekstrak_dengan_sheet_tambahan(content: bytes, file_type: str, rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    """_ekstrak_dengan_template + opsi resep 'extra_sheets' (hanya Excel). Tiap entri:
        {"sheet_name": "...", "je_number_prefix": "PRB-", "source_type": "Import - Pribadi"}
    Sheet itu HARUS berheader sama dengan template (hash) -- diekstrak dengan resep yang sama; nomor
    jurnal diberi awalan (mencegah je_number ganda dengan sheet utama), source_type & catatan bisa
    diganti. Sheet yang tidak ada di file dilewati (opsional); sheet ada tapi header beda -> 1 baris
    staging TIDAK VALID (status file jadi 'Needs Review'), bukan hilang diam-diam."""
    hasil = _ekstrak_dengan_template(rows, template)
    rules = template.get("mapping_rules") or {}
    extra = rules.get("extra_sheets") or []
    if not extra or file_type != "Excel":
        return hasil
    ada = set(_nama_sheet_excel(content))
    for ex in extra:
        nama = ex.get("sheet_name")
        if not nama or nama not in ada:
            continue
        rows2 = _baca_excel_baris(content, nama)
        if not _header_cocok_template(rows2, template):
            hasil["groups"].append({
                "je_number": "", "entry_date": None, "description": f"Sheet '{nama}'",
                "source_type": rules.get("source_type_default", "Import"), "lines": [],
                "total_debit": 0.0, "total_credit": 0.0, "balanced": False,
                "errors": [f"Sheet '{nama}' skipped: its header differs from the template."],
                "notes": f"Sheet: {nama}",
            })
            continue
        sub = _ekstrak_dengan_template(rows2, template)
        awalan = ex.get("je_number_prefix", "")
        for g in sub["groups"]:
            if g.get("je_number"):
                g["je_number"] = awalan + g["je_number"]
            if ex.get("source_type"):
                g["source_type"] = ex["source_type"]
            g["notes"] = " | ".join(x for x in (g.get("notes"), f"Sheet: {nama}") if x)
        hasil["groups"].extend(sub["groups"])
        hasil["skipped_no_key"] = hasil.get("skipped_no_key", 0) + sub.get("skipped_no_key", 0)
        hasil["skipped_zero_lines"] = hasil.get("skipped_zero_lines", 0) + sub.get("skipped_zero_lines", 0)
    return hasil


def _period_label(d: date) -> str:
    return f"{_BULAN_ID[d.month - 1]} {d.year}"


# ============================================================
# STAGING -- 1 journal entry (voucher) -> 1 baris source_rows
# ============================================================

def _susun_baris_staging(
    groups: List[Dict[str, Any]],
    template: Dict[str, Any],
    management_client_id: str,
    file_name: Optional[str],
    user_id: Optional[str],
    created_by_name: Optional[str],
) -> List[Dict[str, Any]]:
    """Ubah group hasil ekstraksi jadi baris financial_transaction_journal_entry_source_rows.

    is_valid = group lolos semua validasi (tanggal terbaca, minimal N baris, akun terisi,
    debit = kredit). is_duplicate_candidate = je_number sudah dipakai draft milik user ini
    (draft JE unik per (client_id=user, je_number)) -- baris tetap tampil, tapi promote akan
    melewatinya sebagai 'number conflict'."""
    currency = (template.get("mapping_rules") or {}).get("currency_default", "IDR")
    hasil: List[Dict[str, Any]] = []
    for no, g in enumerate(groups, start=1):
        valid = bool(g["balanced"])
        duplikat = bool(g["je_number"]) and dbc.get_je_draft_by_client_and_number(user_id, g["je_number"]) is not None

        payload: Optional[Dict[str, Any]] = None
        if valid:
            payload = {
                # Isi ini dipakai apa adanya saat promote (entry_date disimpan ISO string;
                # client_id diisi id user yang menekan Create Journal).
                "draft": {
                    "management_client_id": management_client_id,
                    "je_number": g["je_number"][:100],
                    "entry_date": g["entry_date"].isoformat(),
                    "period_label": _period_label(g["entry_date"]),
                    "description": g["description"],
                    "source_type": (g["source_type"] or "Import")[:20],
                    "source_reference": (file_name or "")[:100] or None,
                    "currency": currency,
                    "status": "draft",
                    "created_by_name": created_by_name,
                    **({"notes": g["notes"]} if g.get("notes") else {}),
                },
                "lines": g["lines"],
            }

        hasil.append({
            "row_no": no,
            "tanggal": g["entry_date"],
            "je_number": (g["je_number"] or None) and g["je_number"][:100],
            "description": g["description"],
            "source_type": (g["source_type"] or None) and g["source_type"][:20],
            "line_count": len(g["lines"]),
            "debit_total": g["total_debit"],
            "credit_total": g["total_credit"],
            "is_valid": valid,
            "validation_notes": "; ".join(g["errors"]) or None,
            "is_duplicate_candidate": duplikat,
            "payload": payload,
        })
    return hasil


def _label_periode(tanggal: List[date]) -> Optional[str]:
    if not tanggal:
        return None
    awal, akhir = min(tanggal), max(tanggal)
    if (awal.year, awal.month) == (akhir.year, akhir.month):
        return _period_label(awal)
    return f"{_period_label(awal)} - {_period_label(akhir)}"


# ============================================================
# ENDPOINT -- Upload
# ============================================================

@router.post(
    "/import/upload",
    summary="Upload file laporan jurnal (CSV/Excel) + ekstraksi otomatis pakai template ke staging Source Data (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File dicatat di daftar Source Data -- template cocok -> journal entry diekstrak ke source rows (BELUM jadi draft JE); tidak cocok -> ditandai 'Needs Review'."},
        400: {"description": "Tipe file tidak didukung, atau file terlalu besar."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
    },
)
async def upload_journal_entry_import(
    file: UploadFile = File(...),
    management_client_id: str = Form(..., description="ID management_clients -- klien yang laporannya sedang diupload, WAJIB."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    mulai = time.perf_counter()
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return gagal(
            message=f"File size ({len(content) / (1024*1024):.1f} MB) exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
            errors={"code": "FILE_TOO_LARGE"},
            status_code=400,
        )

    file_type = _detect_file_type(file.filename or "file")
    user_id = current_user.get("id")  # management_users.id -- akun yang login (pemilik draft saat promote)
    diproses_oleh = current_user.get("nama") or current_user.get("username")

    dasar_file = {
        "client_id": management_client_id,  # kolom client_id di tabel source = company (sama seperti Purchase)
        "management_client_id": management_client_id,
        "file_name": file.filename,
        "file_type": file_type,
        "processed_by": diproses_oleh,
        "uploaded_by": user_id,
    }

    cocok = None
    try:
        cocok = await run_in_threadpool(_cocokkan_template, content, file_type, management_client_id)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Journal Entry Import untuk file {file.filename}: {e}")

    if cocok is None:
        source_file = dbc.create_je_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Needs Review", "status_mapping": "Needs Review",
        }, created_by=user_id)
        if source_file is None:
            return gagal(message="Failed to save source file (database error).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0, "groups_detected": 0, "created": 0, "drafts": []},
            message=(
                "No matching column pattern template found for this client & file format -- "
                "the file was saved as 'Needs Review' and no entries were extracted. Create a new template first (see "
                "one of the backend/migrations/journal_entry/seed_template_*_journal_entry.sql files as an example) "
                "before this file type can be extracted automatically."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        ekstrak = await run_in_threadpool(_ekstrak_dengan_sheet_tambahan, content, file_type, rows, template)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        source_file = dbc.create_je_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Failed", "status_mapping": "Failed", "template_id": template["id"],
        }, created_by=user_id)
        return sukses(
            data={**(source_file or {}), "template_matched": True, "rows_extracted": 0, "groups_detected": 0, "created": 0, "drafts": [], "note": f"Template found but extraction failed: {e}"},
            message=f"Template found but extraction failed: {e}",
            status_code=201,
        )

    baris = await run_in_threadpool(
        _susun_baris_staging, ekstrak["groups"], template, management_client_id, file.filename, user_id, diproses_oleh,
    )

    rows_valid = sum(1 for r in baris if r["is_valid"])
    rows_invalid = len(baris) - rows_valid

    source_file = dbc.create_je_source_file({
        **dasar_file,
        "period_label": _label_periode([r["tanggal"] for r in baris if r["tanggal"]]),
        "rows_detected": len(baris),
        "rows_valid": rows_valid,
        "rows_invalid": rows_invalid,
        "duplicate_count": sum(1 for r in baris if r["is_duplicate_candidate"]),
        "status_ekstraksi": "Completed" if baris and rows_invalid == 0 else "Needs Review",
        "status_mapping": "Completed" if baris else "Needs Review",
        "confidence_score": template.get("ai_confidence"),
        "debit_total": round(sum(r["debit_total"] for r in baris), 2),
        "credit_total": round(sum(r["credit_total"] for r in baris), 2),
        "extraction_duration_ms": int((time.perf_counter() - mulai) * 1000),
        "ai_model_version": template.get("ai_model_version"),
        "mapping_rules": template.get("mapping_rules"),
        "template_id": template["id"],
    }, created_by=user_id)
    if source_file is None:
        return gagal(message="Failed to save source file (database error).", status_code=500)

    if baris:
        n_tersimpan = await run_in_threadpool(dbc.create_je_source_rows_bulk, baris, source_file["id"], management_client_id, user_id)
        if n_tersimpan != len(baris):
            await run_in_threadpool(
                dbc.update_je_source_file, source_file["id"],
                {"status_ekstraksi": "Failed", "status_mapping": "Failed", "rows_detected": 0}, user_id,
            )
            return gagal(
                message="Extraction succeeded but saving the rows to the database failed (database error).",
                errors={"code": "BULK_INSERT_FAILED"}, status_code=500,
            )

    await run_in_threadpool(dbc.touch_je_import_template_usage, template["id"])

    # Ringkasan per journal entry -- dipakai langkah "result" di ImportJournalModal.
    ringkasan = [
        {
            "je_number": r["je_number"] or "-",
            "ok": r["is_valid"],
            "message": (
                f"Staged ({r['line_count']} lines) -- ready for Create Journal."
                if r["is_valid"] and not r["is_duplicate_candidate"]
                else (f"Staged, but this je_number already exists for your account." if r["is_valid"] else (r["validation_notes"] or "Invalid."))
            ),
        }
        for r in baris
    ]

    return sukses(
        data={
            **source_file,
            "template_matched": True,
            "rows_extracted": len(baris),
            "groups_detected": len(baris),
            "skipped_no_key_rows": ekstrak["skipped_no_key"],
            "skipped_zero_lines": ekstrak.get("skipped_zero_lines", 0),
            "created": 0,
            "drafts": ringkasan,
        },
        message=f"File extracted using a previously learned template ({len(baris)} journal entries staged -- use 'Create Journal' to create them).",
        status_code=201,
    )


# ============================================================
# ENDPOINT -- Daftar file & baris (tab Source Data)
# ============================================================

class JeSourceFileUpdateRequest(BaseModel):
    mapping_rules: Optional[Dict[str, Any]] = None
    status_mapping: Optional[str] = None
    status_ekstraksi: Optional[str] = None
    period_label: Optional[str] = None


@router.get(
    "/source-files",
    summary="Daftar file sumber Journal Entry (tab Source Data), difilter per company aktif",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_file(
    management_client_id: Optional[str] = Query(None, description="Filter company (management_clients.id) dari dropdown Switch Company."),
    client_id: Optional[str] = Query(None, description="Alias management_client_id (kompatibel dengan salesStore/purchaseStore)."),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_source_files(management_client_id=management_client_id or client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-files/{source_file_id}",
    summary="Detail 1 file sumber Journal Entry",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_file(
    source_file_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_source_file_by_id(source_file_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-files/{source_file_id}",
    summary="Update file sumber Journal Entry (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_file(
    source_file_id: str,
    payload: JeSourceFileUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_je_source_file(source_file_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source file updated.")


@router.delete(
    "/source-files/{source_file_id}",
    summary="Nonaktifkan (soft-delete) file sumber Journal Entry -- journal entry yang sudah dibuat dari file ini TIDAK ikut terhapus",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_file(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_je_source_file(source_file_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source file deactivated.")


@router.get(
    "/source-rows",
    summary="Daftar baris preview hasil ekstraksi (filter per source_file) -- untuk panel File Preview & Data Quality Check",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_row(
    source_file_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    # payload (header + baris debit/kredit lengkap) tidak dikirim -- berat & tidak dipakai panel preview.
    data = dbc.list_je_source_rows(source_file_id=source_file_id, termasuk_nonaktif=termasuk_nonaktif, dengan_payload=False)
    return sukses(data=data, message="OK")


# ============================================================
# PROMOTE -- naikkan source_rows valid jadi draft Journal Entry
# ============================================================
# SENGAJA endpoint TERPISAH (bukan otomatis saat upload), sama seperti
# promote-to-transactions di Purchase: baris tidak valid / je_number-nya
# bentrok dengan draft yang sudah ada TIDAK ikut naik, supaya data akuntansi
# tidak tercemar data yang belum ditinjau. Idempoten -- baris yang sudah
# punya draft_id dilewati. Draft dimiliki user yang menekan tombol (client_id
# = id user, sama seperti draft dari New Journal Entry) supaya muncul di tab
# JE Transaction milik user itu.

@router.post(
    "/source-files/{source_file_id}/promote-to-journals",
    summary="Naikkan baris valid hasil ekstraksi jadi draft Journal Entry (khusus Supervisor ke atas)",
    responses={
        200: {"description": "Selesai diproses -- lihat ringkasan created/skipped di response."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        404: {"description": "Source file tidak ditemukan."},
    },
)
def promote_source_file_to_journals(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    source_file = dbc.get_je_source_file_by_id(source_file_id, termasuk_nonaktif=False)
    if source_file is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)

    user_id = current_user.get("id")
    nama_user = current_user.get("nama") or current_user.get("username")
    rows = dbc.list_je_source_rows(source_file_id=source_file_id, termasuk_nonaktif=False, dengan_payload=True)

    dibuat = 0
    dilewati_tidak_valid = 0
    dilewati_sudah_pernah = 0
    dilewati_nomor_bentrok = 0

    for row in rows:
        if not row.get("is_valid"):
            dilewati_tidak_valid += 1
            continue
        if row.get("draft_id"):
            dilewati_sudah_pernah += 1
            continue
        payload = row.get("payload") or {}
        draft = dict(payload.get("draft") or {})
        baris_jurnal = payload.get("lines") or []
        je_number = row.get("je_number")
        if not draft or not baris_jurnal or not je_number:
            dilewati_tidak_valid += 1
            continue
        if dbc.get_je_draft_by_client_and_number(user_id, je_number):
            dilewati_nomor_bentrok += 1
            continue

        try:
            draft["entry_date"] = date.fromisoformat(str(draft.get("entry_date"))[:10])
        except ValueError:
            dilewati_tidak_valid += 1
            continue
        draft["client_id"] = user_id
        draft["created_by_name"] = nama_user or draft.get("created_by_name")

        draft_baru = dbc.create_je_draft_with_lines(draft, baris_jurnal, created_by=user_id)
        if draft_baru is None:
            dilewati_nomor_bentrok += 1  # gagal simpan (mis. race condition nomor ganda) -- dihitung dilewati, bukan error keras
            continue
        dbc.update_je_source_row(row["id"], {"draft_id": draft_baru["id"]}, updated_by=user_id)
        dibuat += 1

    ringkasan = {
        "total_rows": len(rows),
        "journals_created": dibuat,
        "skipped_invalid": dilewati_tidak_valid,
        "skipped_already_promoted": dilewati_sudah_pernah,
        "skipped_number_conflict": dilewati_nomor_bentrok,
    }
    return sukses(
        data=ringkasan,
        message=(
            f"{dibuat} journal entries created from {len(rows)} rows "
            f"({dilewati_tidak_valid} invalid, {dilewati_sudah_pernah} already promoted, "
            f"{dilewati_nomor_bentrok} number conflicts)."
        ),
    )