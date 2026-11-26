"""Refresh SEMUA invoice Sales hasil upload lama -- tanpa hapus & upload ulang.

Mengisi 3 hal pada invoice yang sudah ada, berdasarkan resep template klien (seed):
  * transaction_type   <- mapping_rules.transaction_type
  * term_of_payment    <- termin customer (master customer AR) atau mapping_rules.default_payment_terms
  * due_date           <- tanggal invoice + hari termin
(Kolom Journal tidak perlu diisi: dihitung otomatis dari status Posted.)

Aman dijalankan berulang: HANYA mengisi kolom yang masih kosong, jadi hasil edit manual tidak ditimpa.
Invoice yang tidak berasal dari upload (dibuat manual/AR/saldo awal) tidak disentuh.

PRASYARAT: 11 seed Sales versi terbaru sudah dijalankan (supaya template di database punya kunci
transaction_type & default_payment_terms).

Pemakaian:
    python scripts/refresh_sales_lama.py --dry-run                      # cek dulu semua klien, tidak menyimpan
    python scripts/refresh_sales_lama.py                                # simpan, semua klien
    python scripts/refresh_sales_lama.py --client-id <management_client_id>   # satu klien saja
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db_client as dbc  # noqa: E402

SF, SR, INV, TPL, CUST = dbc.SalesSourceFile, dbc.SalesSourceRow, dbc.SalesInvoice, dbc.SalesImportTemplate, dbc.ArCustomer


def _ambil_resep(session, sf_resep, template_id):
    """(transaction_type, default_payment_terms) untuk 1 source file: dari resep file, kalau kosong dari varian
    template induk dengan format_type yang sama (aturan sama dengan promote_sales_rows_bulk)."""
    resep = sf_resep or {}
    tipe, termin = resep.get("transaction_type"), resep.get("default_payment_terms")
    if (not tipe or not termin) and template_id:
        row = session.query(TPL.mapping_rules).filter(TPL.id == template_id).first()
        tr = (row[0] if row else None) or {}
        for v in (tr.get("variants") or [tr]):
            mr = v.get("mapping_rules") or v
            if resep.get("format_type") and mr.get("format_type") != resep.get("format_type"):
                continue
            tipe = tipe or mr.get("transaction_type")
            termin = termin or mr.get("default_payment_terms")
            if tipe and termin:
                break
    tipe = str(tipe).strip()[:50] if tipe else None
    termin = str(termin).strip()[:50] if termin else None
    return (tipe or None), (termin or None)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-id", help="management_clients.id; kosong = semua klien")
    ap.add_argument("--dry-run", action="store_true", help="hanya hitung, tidak menyimpan")
    a = ap.parse_args()

    session = dbc.SessionLocal()
    try:
        q = session.query(SF.id, SF.file_name, SF.management_client_id, SF.mapping_rules, SF.template_id).filter(
            SF.deleted_at.is_(None))
        if a.client_id:
            q = q.filter(SF.management_client_id == a.client_id)
        files = q.all()

        termin_cache = {}  # management_client_id -> {NAMA CUSTOMER: termin}
        total = {"file": 0, "invoice": 0, "tipe": 0, "due": 0, "tanpa_resep": 0}
        per_file_tanpa = []
        for (fid, fname, mcid, resep, tpl_id) in files:
            tipe, termin_default = _ambil_resep(session, resep, tpl_id)
            if mcid not in termin_cache:
                termin_cache[mcid] = {dbc._norm_pihak_sales(n): t for (n, t) in session.query(CUST.name, CUST.payment_terms).filter(
                    CUST.client_id == mcid, CUST.deleted_at.is_(None), CUST.payment_terms.isnot(None)).all() if (t or "").strip()}
            tc = termin_cache[mcid]
            if not tipe and not termin_default and not tc:
                total["tanpa_resep"] += 1
                per_file_tanpa.append(fname)
                continue

            invoices = session.query(INV).filter(
                INV.deleted_at.is_(None),
                INV.source_row_id.in_(session.query(SR.id).filter(SR.source_file_id == fid)),
            ).all()
            n_tipe = n_due = 0
            for r in invoices:
                if tipe and not (r.transaction_type or "").strip():
                    r.transaction_type = tipe
                    n_tipe += 1
                if r.due_date is None:
                    termin = (r.term_of_payment or "").strip() or tc.get(dbc._norm_pihak_sales(r.customer_name)) or termin_default
                    due = dbc.hitung_due_date_sales(r.invoice_date, termin)
                    if due is not None:
                        r.due_date = due
                        if not (r.term_of_payment or "").strip():
                            r.term_of_payment = termin
                        n_due += 1
            total["file"] += 1
            total["invoice"] += len(invoices)
            total["tipe"] += n_tipe
            total["due"] += n_due
            if a.dry_run:
                session.rollback()
            else:
                session.commit()
            print(f"  {fname[:55]:55} invoice={len(invoices):5} tipe+={n_tipe:5} due+={n_due:5}")

        print(("[DRY-RUN] " if a.dry_run else "") +
              f"Selesai: {total['file']} file | {total['invoice']} invoice | Transaction Type terisi: {total['tipe']} | "
              f"Due Date terisi: {total['due']} | file tanpa resep/termin (dilewati): {total['tanpa_resep']}")
        if per_file_tanpa:
            print("File dilewati (template belum punya kunci -- pastikan seed terbaru sudah dijalankan):")
            for f in per_file_tanpa[:20]:
                print("   -", f)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()