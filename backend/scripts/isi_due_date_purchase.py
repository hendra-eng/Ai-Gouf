"""Isi Due Date transaksi Purchase LAMA (hasil import) yang due_date-nya masih kosong.

Rumus: due_date = tanggal transaksi + --hari (default 30, sama dengan "jatuh_tempo_hari" di seed template).
Yang diisi (dua tempat, supaya tidak perlu hapus & upload ulang file):
  A) Transaksi yang SUDAH dibuat (tab Purchase Transaction).
  B) Baris Source Data yang BELUM dijadikan transaksi: due_date ditulis ke payload staging-nya, jadi saat
     "Create Transaction" nanti Due Date ikut terisi.
Yang TIDAK disentuh: due_date yang sudah ada, transaksi non_cash (penyusutan/amortisasi), saldo awal,
transaksi tanpa tanggal, transaksi yang sudah dihapus, dan transaksi non-import (manual) kecuali --termasuk-manual.
Aman dijalankan berulang (idempoten). Invoice No. / PO Number TIDAK diisi di sini: file NBM/UBD memang tidak punya
kolomnya (kalau suatu hari file punya kolom itu, cukup upload file barunya).

Contoh (cek dulu tanpa menyimpan):
    cd /var/www/Ai-Gouf/backend && source venv/bin/activate
    python scripts/isi_due_date_purchase.py --client-code NBM UBD --dry-run
Simpan beneran: hilangkan --dry-run.   Hari lain: --hari 45
"""
import argparse
import os
import sys
from datetime import date, timedelta

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)
try:  # db_client membaca DATABASE_URL dari environment; di main.py .env dimuat dulu, di skrip ini kita muat sendiri
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(_BACKEND, ".env"))
except ImportError:
    pass
import db_client as dbc  # noqa: E402
from sqlalchemy import text  # noqa: E402


def _tgl(v):
    """Tanggal dari payload JSON (teks ISO) atau objek date; tidak terbaca -> None."""
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v or "")[:10])
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-code", nargs="+", required=True, help="client_code, boleh lebih dari satu, mis. NBM UBD")
    ap.add_argument("--hari", type=int, default=30, help="jumlah hari jatuh tempo dari tanggal transaksi (default 30)")
    ap.add_argument("--termasuk-manual", action="store_true", help="ikutkan juga transaksi manual (bukan hasil import)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.hari <= 0:
        sys.exit("--hari harus lebih dari 0")

    PT, SR, SF = dbc.PurchaseTransaction, dbc.PurchaseSourceRow, dbc.PurchaseSourceFile
    session = dbc.SessionLocal()
    try:
        for kode in a.client_code:
            cid = session.execute(
                text("SELECT id FROM management_clients WHERE upper(trim(client_code)) = :k"), {"k": kode.strip().upper()}
            ).scalar()
            if cid is None:
                print(f"[{kode}] client tidak ditemukan, dilewati.")
                continue
            cid = str(cid)

            # A) transaksi yang sudah dibuat
            q = session.query(PT).filter(
                PT.management_client_id == cid, PT.deleted_at.is_(None), PT.due_date.is_(None),
                PT.purchase_date.isnot(None), PT.payment_status != "non_cash", PT.is_opening_balance.is_(False),
            )
            if not a.termasuk_manual:
                q = q.filter(PT.source_doc_type == "Import")
            trx = q.all()
            for r in trx:
                r.due_date = r.purchase_date + timedelta(days=a.hari)

            # B) baris Source Data yang belum jadi transaksi (payload staging)
            rows = session.query(SR).join(SF, SF.id == SR.source_file_id).filter(
                SF.management_client_id == cid, SR.deleted_at.is_(None), SR.transaction_id.is_(None),
                SR.payload.isnot(None),
            ).all()
            staging = 0
            for r in rows:
                header = (r.payload or {}).get("header")
                if not isinstance(header, dict) or header.get("due_date") or header.get("payment_status") == "non_cash":
                    continue
                tgl = _tgl(header.get("purchase_date"))
                if tgl is None:
                    continue
                payload = dict(r.payload)  # objek BARU supaya SQLAlchemy mendeteksi perubahan kolom JSONB
                payload["header"] = {**header, "due_date": (tgl + timedelta(days=a.hari)).isoformat()}
                r.payload = payload
                staging += 1

            print(f"{'[DRY-RUN] ' if a.dry_run else ''}[{kode.upper()}] transaksi terisi: {len(trx)} | baris Source Data terisi: {staging}")

        if a.dry_run:
            session.rollback()
        else:
            session.commit()
    finally:
        session.close()


if __name__ == "__main__":
    main()