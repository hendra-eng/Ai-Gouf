r"""
scripts/hapus_data_transaksi.py
===============================
Bersih-bersih DATA TRANSAKSI semua modul (atau modul / klien tertentu), dalam
SATU transaksi database -- 1 langkah gagal = tidak ada yang berubah.

Yang DIHAPUS (per modul, --only untuk memilih):
    sales        invoice + baris/detail/mapping/log/exception + file & baris upload
    purchase     transaksi + baris/exception + file/record/baris upload
    journal      Journal Entry (draft & posted) + baris/log + file/record/baris upload
    bank_cash    rekening koran (statement + mutasi), transaksi Cash & Bank (termasuk
                 receipt/payment AR & AP) + exception
    ar_ap        collection account/activity + log statement AR/AP
    other        Other Transactions (+ baris/riwayat/lampiran) + jurnal OTH- lama
    inventory    dokumen stok + baris, movement, jurnal persediaan
    fixed_asset  jurnal aset, penyusutan, disposal, log report + aset yang dibeli lewat
                 jurnal perolehan (aset saldo awal tetap ada, lihat di bawah)
    tax          tax ledger, exception, filing, payment, reconciliation

Yang TETAP (master & pengaturan): klien, user, COA, mapping akun, template import
(sales/purchase/JE/bank), bank mapping, template & aturan Other Transactions,
customer AR, item/gudang/kategori persediaan, kategori aset, tax account mapping,
FS mapping/notes, audit trail.

Saldo awal & tutup buku TIDAK disentuh kecuali diminta:
    --with-opening-balance  hapus juga Opening Balance (+ import batch, jurnal OB-/RV-,
                            invoice/bill/stok/aset hasil Import Data saldo awal)
    --with-closing          hapus juga Year-End Closing (+ log & jurnal CL-). WAJIB
                            kalau ada periode berstatus closed: trigger kunci periode
                            menolak penghapusan transaksi posted di periode tertutup.
Tanpa --with-opening-balance: jurnal "Opening Balance", invoice/bill dengan
opening_import_id, dokumen stok doc_type 'opening', dan aset tanpa jurnal perolehan
dipertahankan supaya saldo awal tetap utuh.

Rujukan FK dari baris yang TIDAK ikut dihapus ke baris yang dihapus (kolom nullable)
di-NULL-kan otomatis (dicari dari pg_constraint). File fisik upload Sales
(storage_path) tidak dihapus dari disk -- jumlahnya hanya dilaporkan.

Cara pakai (dari folder backend):
    venv\Scripts\python scripts\hapus_data_transaksi.py --dry-run
        -> hitung & jalankan semuanya lalu ROLLBACK (uji coba, tidak ada yang tersimpan)
    venv\Scripts\python scripts\hapus_data_transaksi.py
        -> hapus semua data transaksi SEMUA klien (minta konfirmasi ketik "yes")
    Opsi:
        --client "SAU" --client "PT Nusa Penida Investments"   (nama / client_code / uuid; boleh berulang)
        --only sales,purchase                                  (modul tertentu saja)
        --with-opening-balance  --with-closing  --yes
"""

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

FOLDER_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FOLDER_BACKEND))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" (lihat migrations/run_seed.py).
    load_dotenv(dotenv_path=FOLDER_BACKEND / ".env")
except ImportError:
    pass

from db_client import engine  # noqa: E402

MODUL = ("sales", "purchase", "journal", "bank_cash", "ar_ap", "other", "inventory", "fixed_asset", "tax")
JE_OB = "Opening Balance"
JE_CL = "Year-End Closing"

_SQL_FK_MASUK = """
SELECT c.conrelid::regclass::text, a.attname, b.attname, NOT a.attnotnull, c.confdeltype
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = c.confkey[1]
 WHERE c.contype = 'f' AND c.confrelid = %s::regclass AND array_length(c.conkey, 1) = 1
"""


@dataclass
class Opsi:
    klien: Optional[List[str]]     # None = semua klien
    simpan_ob: bool                # True = saldo awal dipertahankan
    simpan_cl: bool                # True = tutup buku dipertahankan

    def k(self, kolom: str) -> str:
        """Filter klien untuk kolom `kolom` (SQL)."""
        return "true" if self.klien is None else f"{kolom} = ANY(%(klien)s::uuid[])"


@dataclass
class Langkah:
    grup: str
    tabel: str
    where: Callable[[Opsi], str]


def _anak(kolom: str, induk: str, where_induk: Callable[[Opsi], str]) -> Callable[[Opsi], str]:
    return lambda o: f"{kolom} IN (SELECT id FROM {induk} WHERE {where_induk(o)})"


def _atau_tanpa_induk(kolom: str, induk: str, where_induk: Callable[[Opsi], str], kolom_klien: str = "client_id"):
    """Baris log/exception: milik induk yang dihapus, atau tanpa induk tapi milik klien."""
    return lambda o: (f"({kolom} IN (SELECT id FROM {induk} WHERE {where_induk(o)}) "
                      f"OR ({kolom} IS NULL AND {o.k(kolom_klien)}))")


# ---- scope induk ----
def _w_sales(o: Opsi) -> str:
    return o.k("coalesce(management_client_id, client_id)") + (" AND opening_import_id IS NULL" if o.simpan_ob else "")


def _w_purchase(o: Opsi) -> str:
    return o.k("coalesce(management_client_id, client_id)") + (" AND opening_import_id IS NULL" if o.simpan_ob else "")


def _w_je(o: Opsi) -> str:
    kecuali = [t for t, simpan in ((JE_OB, o.simpan_ob), (JE_CL, o.simpan_cl)) if simpan]
    w = o.k("coalesce(management_client_id, client_id)")
    if kecuali:
        w += " AND coalesce(source_type, '') NOT IN (" + ", ".join(f"'{t}'" for t in kecuali) + ")"
    return w


def _w_je_tipe(tipe: str) -> Callable[[Opsi], str]:
    return lambda o: f"{o.k('coalesce(management_client_id, client_id)')} AND source_type = '{tipe}'"


def _w_inv_doc(o: Opsi) -> str:
    return o.k("client_id") + (" AND doc_type <> 'opening'" if o.simpan_ob else "")


def _w_inv_ikut_doc(o: Opsi) -> str:
    if not o.simpan_ob:
        return o.k("client_id")
    return (f"{o.k('client_id')} AND (document_id IS NULL OR document_id IN "
            f"(SELECT id FROM asset_inventory_documents WHERE {_w_inv_doc(o)}))")


def _w_aset(o: Opsi) -> str:
    # Aset tanpa jurnal perolehan = aset saldo awal (Import Data) -> dipertahankan.
    return o.k("client_id") + (" AND acquisition_journal_id IS NOT NULL" if o.simpan_ob else "")


def _k(kolom: str = "client_id") -> Callable[[Opsi], str]:
    return lambda o: o.k(kolom)


S, P, J, B = ("financial_transaction_sales_", "financial_transaction_purchase_",
              "financial_transaction_journal_entry_", "financial_transaction_bank_cash_")

# Urutan penting: tabel yang merujuk dihapus lebih dulu; closing paling awal supaya
# kunci periode (fn_tanggal_kunci_periode) sudah terbuka saat transaksi posted dihapus.
LANGKAH: List[Langkah] = [
    Langkah("closing", "management_client_fiscal_closing_logs", _k()),
    Langkah("closing", "management_client_fiscal_closings", _k()),
    Langkah("closing", J + "draft_lines", _anak("draft_id", J + "drafts", _w_je_tipe(JE_CL))),
    Langkah("closing", J + "drafts", _w_je_tipe(JE_CL)),

    Langkah("tax", "planning_tax_exceptions", _k()),
    Langkah("tax", "planning_tax_payments", _k()),
    Langkah("tax", "planning_tax_filings", _k()),
    Langkah("tax", "planning_tax_reconciliations", _k()),
    Langkah("tax", "planning_tax_ledger", _k()),

    Langkah("bank_cash", B + "exceptions", _k()),
    Langkah("bank_cash", B + "transaction_lines", _anak("transaction_id", B + "transactions", _k())),
    Langkah("bank_cash", B + "transactions", _k()),
    Langkah("bank_cash", B + "mutations", _k()),
    Langkah("bank_cash", B + "statements", _k()),

    Langkah("ar_ap", "financial_ar_collection_activities", _k()),
    Langkah("ar_ap", "financial_ar_collection_accounts", _k()),
    Langkah("ar_ap", "financial_ar_ap_statements", _k()),

    Langkah("other", "asset_other_transaction_attachments", _k()),
    Langkah("other", "asset_other_transaction_events", _anak("transaction_id", "asset_other_transactions", _k())),
    Langkah("other", "asset_other_transaction_lines", _anak("journal_id", "asset_other_transactions", _k())),
    Langkah("other", "asset_other_transactions", _k()),
    Langkah("other", "financial_transaction_other_journal_lines", _anak("journal_id", "financial_transaction_other_journals", _k())),
    Langkah("other", "financial_transaction_other_journals", _k()),

    Langkah("sales", S + "activity_log", _atau_tanpa_induk("invoice_id", S + "invoices", _w_sales)),
    Langkah("sales", S + "exceptions", _atau_tanpa_induk("invoice_id", S + "invoices", _w_sales)),
    Langkah("sales", S + "account_mappings", _anak("invoice_id", S + "invoices", _w_sales)),
    Langkah("sales", S + "invoice_lines", _anak("invoice_id", S + "invoices", _w_sales)),
    Langkah("sales", S + "invoice_details", _anak("invoice_id", S + "invoices", _w_sales)),
    Langkah("sales", S + "invoices", _w_sales),
    Langkah("sales", S + "source_rows", _anak("source_file_id", S + "source_files", _k("management_client_id"))),
    Langkah("sales", S + "source_files", _k("management_client_id")),

    Langkah("purchase", P + "exceptions", _atau_tanpa_induk("transaction_id", P + "transactions", _w_purchase)),
    Langkah("purchase", P + "transaction_lines", _anak("transaction_id", P + "transactions", _w_purchase)),
    Langkah("purchase", P + "source_rows", _anak("source_file_id", P + "source_files", _k("management_client_id"))),
    Langkah("purchase", P + "transactions", _w_purchase),
    Langkah("purchase", P + "source_records", _k()),
    Langkah("purchase", P + "source_files", _k("management_client_id")),

    Langkah("journal", J + "activity_log", _atau_tanpa_induk("draft_id", J + "drafts", _w_je)),
    Langkah("journal", J + "draft_lines", _anak("draft_id", J + "drafts", _w_je)),
    Langkah("journal", J + "source_rows", _anak("source_file_id", J + "source_files", _k("management_client_id"))),
    Langkah("journal", J + "drafts", _w_je),
    Langkah("journal", J + "source_records", _k()),
    Langkah("journal", J + "source_files", _k("management_client_id")),

    Langkah("inventory", "asset_inventory_journal_lines", _anak("journal_id", "asset_inventory_journals", _w_inv_ikut_doc)),
    Langkah("inventory", "asset_inventory_journals", _w_inv_ikut_doc),
    Langkah("inventory", "asset_inventory_movements", _w_inv_ikut_doc),
    Langkah("inventory", "asset_inventory_document_lines", _anak("document_id", "asset_inventory_documents", _w_inv_doc)),
    Langkah("inventory", "asset_inventory_documents", _w_inv_doc),

    Langkah("fixed_asset", "asset_fixed_asset_journal_lines", _anak("journal_id", "asset_fixed_asset_journals", _k())),
    Langkah("fixed_asset", "asset_fixed_asset_journals", _k()),
    Langkah("fixed_asset", "asset_fixed_asset_depreciation_lines", _anak("run_id", "asset_fixed_asset_depreciation_runs", _k())),
    Langkah("fixed_asset", "asset_fixed_asset_depreciation_runs", _k()),
    Langkah("fixed_asset", "asset_fixed_asset_disposals", _k()),
    Langkah("fixed_asset", "asset_fixed_asset_report_logs", _k()),
    Langkah("fixed_asset", "asset_fixed_assets", _w_aset),

    Langkah("opening", "management_client_coa_opening_balance_import_rows",
            _anak("import_id", "management_client_coa_opening_balance_imports", _k())),
    Langkah("opening", "management_client_coa_opening_balance_imports", _k()),
    Langkah("opening", J + "draft_lines", _anak("draft_id", J + "drafts", _w_je_tipe(JE_OB))),
    Langkah("opening", J + "drafts", _w_je_tipe(JE_OB)),
    Langkah("opening", "management_client_coa_opening_balance_lines",
            _anak("opening_balance_id", "management_client_coa_opening_balances", _k())),
    Langkah("opening", "management_client_coa_opening_balances", _k()),
]


def _konsol_utf8() -> None:
    # Console Windows default-nya cp1252 -> print() emoji melempar UnicodeEncodeError.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _cari_klien(cur, kata: List[str]) -> Optional[Dict[str, str]]:
    """{id: nama} untuk tiap --client (nama / client_code / uuid, harus tepat 1)."""
    hasil: Dict[str, str] = {}
    for k in kata:
        cur.execute("SELECT id::text, nama_client, client_code FROM management_clients "
                    "WHERE deleted_at IS NULL AND (id::text = lower(%(k)s) OR upper(trim(nama_client)) = upper(trim(%(k)s)) "
                    "OR upper(trim(client_code)) = upper(trim(%(k)s)))", {"k": k})
        baris = cur.fetchall()
        if len(baris) != 1:
            print(f"❌ --client \"{k}\": {'tidak ditemukan' if not baris else f'cocok {len(baris)} klien'} "
                  f"({', '.join(f'{n} [{c}]' for _, n, c in baris)}). TIDAK ADA YANG DIUBAH.")
            return None
        hasil[baris[0][0]] = f"{baris[0][1]} [{baris[0][2]}]"
    return hasil


def main() -> int:
    _konsol_utf8()
    parser = argparse.ArgumentParser(description="Hapus data transaksi (master & pengaturan tetap).")
    parser.add_argument("--dry-run", action="store_true", help="jalankan semuanya lalu ROLLBACK (tidak ada yang tersimpan)")
    parser.add_argument("--client", action="append", help="nama / client_code / uuid klien (boleh berulang; default semua klien)")
    parser.add_argument("--only", help=f"modul dipisah koma: {','.join(MODUL)} (default semua)")
    parser.add_argument("--with-opening-balance", action="store_true", help="hapus juga saldo awal + hasil Import Data saldo awal")
    parser.add_argument("--with-closing", action="store_true", help="hapus juga Year-End Closing (membuka kunci periode)")
    parser.add_argument("--yes", action="store_true", help="tanpa konfirmasi (untuk mode simpan)")
    args = parser.parse_args()

    grup = set(MODUL)
    if args.only:
        grup = {g.strip() for g in args.only.split(",") if g.strip()}
        salah = grup - set(MODUL)
        if salah:
            print(f"❌ Modul tidak dikenal: {', '.join(sorted(salah))}. Pilihan: {', '.join(MODUL)}")
            return 1
    if args.with_opening_balance:
        grup.add("opening")
    if args.with_closing:
        grup.add("closing")

    print("=" * 64)
    print(f"🧹 HAPUS DATA TRANSAKSI {'(DRY RUN — akan di-ROLLBACK)' if args.dry_run else ''}")
    print("=" * 64)
    if engine.dialect.name != "postgresql":
        print(f"❌ Database yang terhubung bukan PostgreSQL: {engine.url.render_as_string(hide_password=True)}")
        return 1
    print(f"🔌 Database: {engine.url.render_as_string(hide_password=True)}")

    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        klien = None
        if args.client:
            peta = _cari_klien(cur, args.client)
            if peta is None:
                return 1
            klien = list(peta)
            print(f"👥 Klien: {'; '.join(peta.values())}")
        else:
            print("👥 Klien: SEMUA")
        o = Opsi(klien=klien, simpan_ob=not args.with_opening_balance, simpan_cl=not args.with_closing)
        param = {"klien": klien}
        print(f"📦 Modul: {', '.join(g for g in (*MODUL, 'opening', 'closing') if g in grup)}")

        if o.simpan_cl:
            cur.execute(f"SELECT count(*) FROM management_client_fiscal_closings WHERE status = 'closed' AND {o.k('client_id')}", param)
            if cur.fetchone()[0]:
                print("\n⛔ Ada periode yang sudah di-close (Year-End Closing). Transaksi posted di periode itu dikunci")
                print("   trigger database. Jalankan ulang dengan --with-closing. TIDAK ADA YANG DIUBAH.")
                return 1

        # Jurnal OB-/CL- sudah ikut langkah modul journal kalau modul itu dipilih.
        langkah = [l for l in LANGKAH if l.grup in grup
                   and not (l.grup in ("opening", "closing") and l.tabel.startswith(J) and "journal" in grup)]
        print("\n📋 Rencana:")
        total = 0
        for l in langkah:
            cur.execute(f"SELECT count(*) FROM {l.tabel} WHERE {l.where(o)}", param)
            n = cur.fetchone()[0]
            total += n
            if n:
                print(f"   🗑️  {l.grup:<11} {l.tabel:<58} {n:>8} baris")
        if "sales" in grup:
            cur.execute(f"SELECT count(*) FROM {S}source_files WHERE storage_path IS NOT NULL AND {o.k('management_client_id')}", param)
            n_file = cur.fetchone()[0]
            if n_file:
                print(f"   📁 {n_file} file upload Sales di disk (storage_path) TIDAK dihapus dari disk.")
        if not total:
            print("   (tidak ada data yang perlu dihapus)")
            return 0
        print(f"   Total: {total} baris")

        if not args.dry_run and not args.yes:
            if input('\nKetik "yes" untuk menghapus PERMANEN: ').strip().lower() != "yes":
                print("Dibatalkan. TIDAK ADA YANG DIUBAH.")
                return 1

        print()
        fk_cache: Dict[str, list] = {}
        try:
            for l in langkah:
                w = l.where(o)
                if l.tabel not in fk_cache:
                    cur.execute(_SQL_FK_MASUK, (l.tabel,))
                    fk_cache[l.tabel] = cur.fetchall()
                # Lepas rujukan (FK nullable tanpa ON DELETE) dari baris yang tetap ada.
                for tabel_ref, kolom, kolom_induk, nullable, aksi in fk_cache[l.tabel]:
                    if nullable and aksi in ("a", "r") and tabel_ref != l.tabel:
                        cur.execute(f"UPDATE {tabel_ref} SET {kolom} = NULL WHERE {kolom} IN "
                                    f"(SELECT {kolom_induk} FROM {l.tabel} WHERE {w})", param)
                        if cur.rowcount:
                            print(f"   🔗 {cur.rowcount} baris {tabel_ref}.{kolom} dilepas")
                cur.execute(f"DELETE FROM {l.tabel} WHERE {w}", param)
                if cur.rowcount:
                    print(f"   🗑️  {cur.rowcount} baris {l.tabel} dihapus")
            if "fixed_asset" in grup and o.simpan_ob:
                # Aset saldo awal yang tersisa: disposal & jurnalnya sudah dihapus -> aktif lagi.
                cur.execute(f"UPDATE asset_fixed_assets SET status = 'active', disposal_date = NULL, disposal_value = NULL "
                            f"WHERE status = 'disposed' AND {o.k('client_id')}", param)
                if cur.rowcount:
                    print(f"   ♻️  {cur.rowcount} aset saldo awal dikembalikan ke status active")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            pesan = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)
            print(f"\n❌ Gagal: {pesan}")
            print("   Semua perubahan di-ROLLBACK — TIDAK ADA YANG DIUBAH.")
            return 1

        if args.dry_run:
            conn.rollback()
            print("\n🧪 DRY RUN selesai — semua perubahan di-ROLLBACK, tidak ada yang tersimpan.")
            return 0
        conn.commit()
    finally:
        conn.close()

    print("\n✅ Data transaksi berhasil dihapus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
