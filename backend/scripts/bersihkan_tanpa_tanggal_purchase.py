"""Bersihkan baris Source Data Purchase TANPA TANGGAL yang nomornya sudah punya transaksi (kartu Data Quality jadi bersih).

Latar belakang: invoice tanpa tanggal selalu ikut ke SETIAP file bulanan (filter periode tidak bisa menyaringnya). Begitu
satu file dibuat jadi transaksi, di file lain baris yang sama ditandai "Duplicate" dan "tanggal tidak valid", padahal
transaksinya sudah ada. Script ini membereskan data yang SUDAH terlanjur ter-upload, tanpa hapus & upload ulang file.

Langkah A -- hapus baris (soft delete, deleted_at) yang memenuhi SEMUA syarat:
    - tanggal kosong, DAN
    - belum jadi transaksi (transaction_id kosong) -- baris yang sudah jadi transaksi TIDAK disentuh, DAN
    - nomor invoicenya sudah ada di tabel transaksi (belum dihapus) untuk company yang sama.
  Lalu hitung ulang ringkasan tiap file yang terpengaruh (rows_detected, valid/invalid, duplicate_count, confidence,
  dpp/ppn/grand total, vendor_hint) dengan rumus yang sama persis seperti saat upload.
Langkah B -- sinkron tanggal: baris Source Data yang sudah jadi transaksi tapi tanggalnya masih kosong diisi dari
  purchase_date transaksinya (kalau transaksinya sudah kamu isi tanggalnya). Jalankan ulang script ini setelah kamu
  mengisi tanggal di tab Purchase Transaction supaya kartu file tersebut ikut hijau.

Yang TIDAK disentuh: transaksi, jurnal, baris bertanggal (termasuk duplikat bertanggal), baris yang sudah jadi transaksi,
status_mapping / status_ekstraksi file. Aman dijalankan berulang (idempoten).
Catatan: nomor baris ("No") tidak dirapatkan -- baris yang dihapus meninggalkan celah nomor.

Contoh (cek dulu tanpa menyimpan):
    cd /var/www/Ai-Gouf/backend && source venv/bin/activate
    python scripts/bersihkan_tanpa_tanggal_purchase.py --client-code NBM --dry-run
Simpan beneran: hilangkan --dry-run.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)
try:  # db_client membaca DATABASE_URL dari environment; di skrip ini kita muat .env sendiri
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(_BACKEND, ".env"))
except ImportError:
    pass
import db_client as dbc  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import defer  # noqa: E402


def hitung_ringkasan(baris: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Rumus sama dengan _catat_file_sumber() di purchase_import_v1.py. `baris` sudah urut row_no."""
    valid = [b for b in baris if b["is_valid"]]
    vendor = list(dict.fromkeys(b["nama_vendor"] for b in baris if b.get("nama_vendor")))
    vendor_hint: Optional[str] = None if not vendor else (vendor[0] if len(vendor) == 1 else f"{vendor[0]} +{len(vendor) - 1} more")
    return {
        "rows_detected": len(baris),
        "rows_valid": len(valid),
        "rows_invalid": len(baris) - len(valid),
        "duplicate_count": sum(1 for b in baris if b["is_duplicate_candidate"]),
        "confidence_score": round(100.0 * len(valid) / len(baris), 2) if baris else None,
        "dpp_total": round(sum(float(b["dpp"]) for b in valid), 2),
        "ppn_total": round(sum(float(b["ppn"]) for b in valid), 2),
        "grand_total": round(sum(float(b["total"]) for b in valid), 2),
        "vendor_hint": vendor_hint[:255] if vendor_hint else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-code", nargs="+", required=True, help="client_code, boleh lebih dari satu, mis. NBM UBD")
    ap.add_argument("--dry-run", action="store_true", help="tampilkan hasilnya saja, tidak menyimpan")
    a = ap.parse_args()

    PT, SR, SF = dbc.PurchaseTransaction, dbc.PurchaseSourceRow, dbc.PurchaseSourceFile
    session = dbc.SessionLocal()
    sekarang = datetime.now(timezone.utc)
    try:
        for kode in a.client_code:
            cid = session.execute(
                text("SELECT id FROM management_clients WHERE upper(trim(client_code)) = :k"), {"k": kode.strip().upper()}
            ).scalar()
            if cid is None:
                print(f"[{kode}] client tidak ditemukan, dilewati.")
                continue
            cid = str(cid)

            files = session.query(SF).filter(SF.management_client_id == cid, SF.deleted_at.is_(None)).all()
            nama_file = {str(f.id): f.file_name for f in files}
            if not files:
                print(f"[{kode.upper()}] tidak ada file Source Data.")
                continue
            file_ids = list(nama_file)

            # ---- A) hapus baris tanpa tanggal yang nomornya sudah punya transaksi ----
            no_ada = {
                r[0] for r in session.query(PT.purchase_no).filter(PT.management_client_id == cid, PT.deleted_at.is_(None)).all()
            }
            kandidat = (
                session.query(SR).options(defer(SR.payload))
                .filter(SR.source_file_id.in_(file_ids), SR.deleted_at.is_(None), SR.tanggal.is_(None), SR.transaction_id.is_(None))
                .all()
            )
            kandidat = [r for r in kandidat if r.no_invoice and r.no_invoice in no_ada]
            per_file: Dict[str, List[Any]] = {}
            for r in kandidat:
                r.deleted_at = sekarang
                per_file.setdefault(str(r.source_file_id), []).append(r)
            session.flush()  # supaya hitung ulang di bawah melihat baris yang sudah "dihapus"

            print(f"\n{'[DRY-RUN] ' if a.dry_run else ''}[{kode.upper()}] {len(kandidat)} baris tanpa tanggal dihapus dari {len(per_file)} file:")
            for fid in sorted(per_file, key=lambda x: nama_file[x]):
                f = next(x for x in files if str(x.id) == fid)
                rows = (
                    session.query(SR.row_no, SR.is_valid, SR.is_duplicate_candidate, SR.nama_vendor, SR.dpp, SR.ppn, SR.total)
                    .filter(SR.source_file_id == fid, SR.deleted_at.is_(None)).order_by(SR.row_no).all()
                )
                ring = hitung_ringkasan([
                    {"is_valid": x.is_valid, "is_duplicate_candidate": x.is_duplicate_candidate, "nama_vendor": x.nama_vendor,
                     "dpp": x.dpp, "ppn": x.ppn, "total": x.total} for x in rows
                ])
                lama = f"{f.rows_detected} baris, duplicate {f.duplicate_count}"
                for kolom, nilai in ring.items():
                    setattr(f, kolom, nilai)
                nomor = ", ".join(sorted(r.no_invoice for r in per_file[fid]))
                print(f"  - {nama_file[fid]}: -{len(per_file[fid])} ({nomor}) | {lama} -> {ring['rows_detected']} baris, duplicate {ring['duplicate_count']}")

            # ---- B) sinkron tanggal dari transaksi untuk baris yang sudah jadi transaksi ----
            sinkron = (
                session.query(SR, PT.purchase_date).options(defer(SR.payload))
                .join(PT, PT.id == SR.transaction_id)
                .filter(SR.source_file_id.in_(file_ids), SR.deleted_at.is_(None), SR.tanggal.is_(None),
                        PT.deleted_at.is_(None), PT.purchase_date.isnot(None))
                .all()
            )
            for r, tgl in sinkron:
                r.tanggal = tgl
            print(f"[{kode.upper()}] tanggal disinkron dari transaksi: {len(sinkron)} baris")

            sisa = (
                session.query(SR.id).filter(SR.source_file_id.in_(file_ids), SR.deleted_at.is_(None), SR.tanggal.is_(None)).count()
            )
            print(f"[{kode.upper()}] baris masih tanpa tanggal setelah ini: {sisa} (yang sudah jadi transaksi / belum punya transaksi)")

        if a.dry_run:
            session.rollback()
            print("\n[DRY-RUN] tidak ada yang disimpan.")
        else:
            session.commit()
            print("\nSelesai, perubahan disimpan.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()