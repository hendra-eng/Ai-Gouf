r"""
scripts/cek_fs_klien.py
=======================
Diagnosa kenapa transaksi posted (mis. Sales) tidak muncul di Balance Sheet 1 klien.
HANYA MEMBACA -- tidak mengubah data.

Langkah yang dicek (sama dengan engine Balance Sheet /api/v1/reports/financial-statements):
  1. Klien dengan nama mirip (deteksi klien dobel -- invoice bisa nyangkut di kembarannya).
  2. Baris GL posted per sumber (ambil_baris_jurnal_posted_transaksi).
  3. Baris GL sumber sales: akun yang dipakai + apakah ada di COA klien.
  4. Hasil susun_neraca per tanggal (default hari ini): baris yang memuat akun sales.

Cara pakai:
    cd backend
    venv/bin/python scripts/cek_fs_klien.py "NAWASANGA"              # cari per nama
    venv/bin/python scripts/cek_fs_klien.py adf26d6c-1d70-...        # per management_client_id
    venv/bin/python scripts/cek_fs_klien.py "NAWASANGA" 2026-08-31   # tanggal As of tertentu
"""

import collections
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import db_client as dbc  # noqa: E402
from modules.financial_statements import fs_store, mapped  # noqa: E402


def _klien(arg: str):
    s = dbc.SessionLocal()
    try:
        try:
            q = s.query(dbc.Client).filter(dbc.Client.id == str(uuid.UUID(arg)))
        except ValueError:
            q = s.query(dbc.Client).filter(dbc.Client.nama.ilike(f"%{arg}%"))
        return [(c.id, c.nama, c.client_code) for c in q.all()]
    finally:
        s.close()


def _cetak_baris_neraca(neraca: dict, kode_sales: set) -> None:
    for sek in neraca.get("sections", []):
        print(f"   [{sek.get('key')}] {sek.get('label')}: total {sek.get('total'):,.0f}")
        for ln in sek.get("lines", []):
            if not ln.get("amount") and not ln.get("accounts"):
                continue
            print(f"      {str(ln.get('label') or '')[:62]:<62} {ln.get('amount') or 0:>18,.0f}")
            for a in ln.get("accounts", []):
                kode = str(a.get("code") or "")
                tanda = "  <-- akun sales" if kode and kode in kode_sales else ""
                if a.get("amount") or tanda:
                    print(f"         {kode or '(auto)':<12} {str(a.get('name') or '')[:46]:<46} {a.get('amount') or 0:>18,.0f}{tanda}")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    per = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date.today()
    daftar = _klien(sys.argv[1])
    print(f"1) Klien cocok: {len(daftar)}")
    for kid, nama, kode in daftar:
        print(f"   - {nama} [{kode}] id={kid}")
    if len(daftar) > 1:
        print("   ⚠️  Lebih dari 1 klien -- pastikan klien yang dipilih di Balance Sheet = klien pemilik invoice.")

    for kid, nama, _ in daftar:
        print("\n" + "=" * 70 + f"\n{nama}  ({kid})  As of {per}\n" + "=" * 70)
        baris = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=kid)
        per_sumber = collections.Counter(b["sumber"] for b in baris)
        print(f"2) Baris GL posted (semua tanggal): {len(baris)} -> {dict(per_sumber) or '-'}")
        sales = [b for b in baris if b["sumber"] == "sales"]
        if not sales:
            print("   ❌ Tidak ada baris sales posted untuk klien ini (cek posting_status / management_client_id invoice).")
        peta = fs_store.peta_akun_klien(kid)
        kode_coa = {str(k) for k in (peta.keys() if isinstance(peta, dict) else [])}
        kode_sales = set()
        if sales:
            print("3) Akun di baris sales:")
            agg = collections.defaultdict(lambda: [0.0, 0.0, 0])
            for b in sales:
                a = agg[(b["account_code"], b["account_name"])]
                a[0] += b["debit"]; a[1] += b["kredit"]; a[2] += 1
                kode_sales.add(str(b["account_code"]))
            for (kode, nm), (d, k, n) in sorted(agg.items(), key=lambda x: str(x[0][0])):
                ada = "ada di COA" if not kode_coa or str(kode) in kode_coa else "❌ TIDAK ADA di COA"
                print(f"   {kode} {nm}: D {d:,.0f} K {k:,.0f} ({n} baris) -- {ada}")
            sesudah = [b for b in sales if b["tanggal"] and b["tanggal"] > per]
            if sesudah:
                print(f"   ⚠️  {len(sesudah)} baris sales bertanggal SETELAH {per} -> tidak masuk neraca per tanggal itu.")
        buku = mapped.Buku(baris, peta)
        neraca = mapped.susun_neraca(buku, per, None, False)
        t = neraca["totals"]
        print(f"4) Neraca: aset {t['assets']:,.0f} | liabilitas {t['liabilities']:,.0f} | ekuitas {t['equity']:,.0f} "
              f"| balance={neraca['check']['balanced']}")
        _cetak_baris_neraca(neraca, kode_sales)
        if neraca.get("warnings"):
            print(f"   warnings: {neraca['warnings']}")
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
