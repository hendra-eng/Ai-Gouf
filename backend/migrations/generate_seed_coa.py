"""
migrations/generate_seed_coa.py
================================
Generator file seed COA klien (tabel management_client_coa) dari master
dataset/COA/COA_Clients_GOUF.xlsx. Hasilnya file SQL biasa
(migrations/seed_coa_<kode>.sql) yang dijalankan lewat run_seed.py -- script
ini TIDAK menyentuh database.

Dipakai supaya seed tidak ditulis tangan (95-176 akun per klien) dan supaya
klien berikutnya (workbook punya 13 sheet "COA <KODE>") tinggal ditambahkan
ke KLIEN di bawah lalu dijalankan ulang.

Aturan:
- Baris diambil persis dari sheet (kolom A..J, header di baris 1), baris
  kosong dilewati, ACC NO duplikat dalam 1 sheet = error.
- normal_balance diturunkan dari ACCOUNT CLASSIFICATION (lihat
  normal_balance()) karena tidak ada di Excel.
- Klien dicari lewat nama_client (pola sama dengan seed template Sales/
  Purchase), client_id TIDAK di-hardcode.
- INSERT ... ON CONFLICT (client_id, acc_no) DO UPDATE: aman dijalankan
  ulang setelah Excel direvisi (isi akun ditimpa dari Excel; akun yang sudah
  di-soft-delete lewat UI tetap terhapus).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\generate_seed_coa.py            # semua klien di KLIEN
    venv\\Scripts\\python migrations\\generate_seed_coa.py SAU NPI    # sebagian
"""

import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent.parent
FILE_EXCEL = ROOT / "dataset" / "COA" / "COA_Clients_GOUF.xlsx"
FOLDER_OUTPUT = Path(__file__).resolve().parent

# kode sheet -> nama_client yang dicocokkan (upper(trim(nama_client)) IN (...))
KLIEN = {
    "SAU": ["SAU", "CV SUMBER ALODIE UTAMA"],
    "NPI": ["NPI", "PT NUSA PENIDA INVESTMENTS"],
    "NBM": ["NBM", "PT NAWASANGA BERTATAP MUKA"],
}

HEADER_WAJIB = [
    "ACC NO", "ACCOUNT NAME", "ACCOUNT CLASSIFICATION", "ACCOUNT HEAD", "ACCOUNT SUB",
    "DESCRIPTION", "INTERNATIONAL STANDARD GROUP (IFRS-ALIGNED)", "STANDARD ACCOUNT CODE",
    "IFRS TAXONOMY REFERENCE", "IFRS SOURCE",
]

KOLOM_DB = [
    "acc_no", "account_name", "account_classification", "account_head", "account_sub",
    "description", "international_standard_group", "standard_account_code",
    "ifrs_taxonomy_reference", "ifrs_source",
]

_SALDO_NORMAL_DEBIT = {"ASSET", "COST OF SALES", "EXPENSE", "OTHER EXPENSE", "INCOME TAX"}
# Akun kontra: saldo normalnya KEBALIKAN dari klasifikasinya.
_AKUN_KONTRA = {
    ("ASSET", "ACCUMULATED DEPRECIATION"),
    ("ASSET", "ALLOWANCE FOR CREDIT LOSSES"),
    ("ASSET", "ASSET IMPAIRMENT / ALLOWANCE"),
    ("COST OF SALES", "PURCHASE DISCOUNT"),
    ("COST OF SALES", "PURCHASE RETURN"),
    ("REVENUE", "SALES DEDUCTIONS"),
    ("EQUITY", "OWNER DRAWINGS"),
}


def normal_balance(classification: str, sub: str) -> str:
    debit = classification in _SALDO_NORMAL_DEBIT
    if (classification, sub) in _AKUN_KONTRA:
        debit = not debit
    return "DEBIT" if debit else "CREDIT"


def _sql_str(nilai) -> str:
    if nilai is None or str(nilai).strip() == "":
        return "NULL"
    return "'" + str(nilai).strip().replace("'", "''") + "'"


def baca_sheet(wb, kode: str):
    ws = wb[f"COA {kode}"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() if h is not None else "" for h in rows[0][: len(HEADER_WAJIB)]]
    if header != HEADER_WAJIB:
        raise ValueError(f"Header sheet 'COA {kode}' berubah: {header}")

    hasil, terlihat = [], set()
    for no_baris, r in enumerate(rows[1:], start=2):
        if not any(v not in (None, "") for v in r[: len(HEADER_WAJIB)]):
            continue
        akun = dict(zip(KOLOM_DB, (str(v).strip() if v is not None else None for v in r[: len(HEADER_WAJIB)])))
        if not akun["acc_no"] or not akun["account_name"] or not akun["account_classification"]:
            raise ValueError(f"COA {kode} baris {no_baris}: ACC NO/ACCOUNT NAME/CLASSIFICATION kosong")
        if akun["acc_no"] in terlihat:
            raise ValueError(f"COA {kode} baris {no_baris}: ACC NO {akun['acc_no']} duplikat")
        terlihat.add(akun["acc_no"])
        akun["account_classification"] = akun["account_classification"].upper()
        akun["normal_balance"] = normal_balance(akun["account_classification"], (akun["account_sub"] or "").upper())
        hasil.append(akun)
    return hasil


def tulis_seed(kode: str, akun_list) -> Path:
    nama_file = f"seed_coa_{kode.lower()}.sql"
    nama_cocok = ", ".join(_sql_str(n) for n in KLIEN[kode])
    kolom = KOLOM_DB + ["normal_balance"]

    values = ",\n".join(
        "        (" + ", ".join(_sql_str(a[k]) for k in kolom) + ")" for a in akun_list
    )
    set_update = ",\n        ".join(f"{k} = EXCLUDED.{k}" for k in kolom[1:] + ["client_code"])

    isi = f"""-- {nama_file}
-- =============================================================
-- Master COA klien {kode} -> tabel management_client_coa ({len(akun_list)} akun).
-- DIHASILKAN OTOMATIS oleh migrations/generate_seed_coa.py dari
-- dataset/COA/COA_Clients_GOUF.xlsx sheet "COA {kode}" -- JANGAN diedit
-- manual, ubah Excel-nya lalu generate ulang.
--
-- normal_balance diturunkan dari ACCOUNT CLASSIFICATION (+ akun kontra),
-- lihat generate_seed_coa.py::normal_balance().
--
-- KLIEN: dicari lewat nama_client IN ({nama_cocok}), GAGAL dengan pesan
-- jelas kalau belum ada. client_id/client_code TIDAK di-hardcode.
--
-- PRASYARAT: venv\\Scripts\\python migrations\\16-create_management_client_coa.py
--
-- Cara pakai:
--   cd backend
--   venv\\Scripts\\python migrations\\run_seed.py {nama_file}
--
-- Idempotensi: ON CONFLICT (client_id, acc_no) DO UPDATE -- aman dijalankan
-- ulang; isi akun ditimpa dari Excel, akun yang di-soft-delete tetap terhapus.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ({nama_cocok})
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien {kode} belum ada di management_clients (dicari nama_client IN ({nama_cocok.replace("'", "''")})). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    INSERT INTO management_client_coa (
        client_id, client_code, {", ".join(kolom)}
    )
    SELECT v_client_id, v_client_code, v.*
    FROM (VALUES
{values}
    ) AS v({", ".join(kolom)})
    ON CONFLICT (client_id, acc_no) DO UPDATE SET
        {set_update},
        edited_at = now();
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT m.nama_client, count(*) FROM management_client_coa c
-- JOIN management_clients m ON m.id = c.client_id
-- WHERE c.deleted_at IS NULL GROUP BY m.nama_client;
"""
    path = FOLDER_OUTPUT / nama_file
    path.write_text(isi, encoding="utf-8")
    return path


def main(argv) -> int:
    kode_list = [a.upper() for a in argv[1:]] or list(KLIEN)
    tidak_dikenal = [k for k in kode_list if k not in KLIEN]
    if tidak_dikenal:
        print(f"❌ Kode klien belum terdaftar di KLIEN: {tidak_dikenal}")
        return 1
    wb = openpyxl.load_workbook(FILE_EXCEL, read_only=True, data_only=True)
    for kode in kode_list:
        akun = baca_sheet(wb, kode)
        path = tulis_seed(kode, akun)
        print(f"✅ {path.name}: {len(akun)} akun")
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main(sys.argv))
