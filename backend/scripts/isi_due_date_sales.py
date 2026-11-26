"""Isi Due Date (dan term_of_payment) invoice Sales LAMA yang due_date-nya masih kosong.

Rumus: due_date = tanggal invoice + hari termin. Termin diambil dari master customer AR (payment_terms);
kalau customer tidak punya termin, dipakai --termin-default. Invoice yang due_date-nya sudah ada TIDAK diubah.

Contoh (cek dulu tanpa menyimpan):
    python scripts/isi_due_date_sales.py --client-id <management_client_id> --termin-default "Net 30" --dry-run
Simpan beneran: hilangkan --dry-run. Untuk klien POS/kas pakai --termin-default "Due on Receipt".
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db_client as dbc  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-id", required=True, help="management_clients.id (perusahaan)")
    ap.add_argument("--termin-default", required=True, help='mis. "Net 30" atau "Due on Receipt"')
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    session = dbc.SessionLocal()
    try:
        termin_customer = {
            dbc._norm_pihak_sales(n): t for (n, t) in session.query(dbc.ArCustomer.name, dbc.ArCustomer.payment_terms).filter(
                dbc.ArCustomer.client_id == a.client_id, dbc.ArCustomer.deleted_at.is_(None),
                dbc.ArCustomer.payment_terms.isnot(None)).all() if (t or "").strip()}
        inv = session.query(dbc.SalesInvoice).filter(
            dbc.SalesInvoice.management_client_id == a.client_id, dbc.SalesInvoice.deleted_at.is_(None),
            dbc.SalesInvoice.due_date.is_(None), dbc.SalesInvoice.is_opening_balance.is_(False)).all()
        terisi = 0
        for r in inv:
            termin = termin_customer.get(dbc._norm_pihak_sales(r.customer_name)) or a.termin_default
            due = dbc.hitung_due_date_sales(r.invoice_date, termin)
            if due is None:
                continue
            terisi += 1
            if not a.dry_run:
                r.due_date = due
                if not r.term_of_payment:
                    r.term_of_payment = termin
        if a.dry_run:
            session.rollback()
        else:
            session.commit()
        print(f"{'[DRY-RUN] ' if a.dry_run else ''}Invoice tanpa due date: {len(inv)} | terisi: {terisi}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
