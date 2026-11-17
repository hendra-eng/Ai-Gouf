"""E2E Fase 2 kurs: invoice/bill valas + pelunasan dengan selisih kurs terealisasi.
Jalankan di Postgres LOKAL (bukan produksi):
    set DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:5432/t1
    python tests\\e2e_fx_settlement.py
"""
import os, sys, json
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://postgres:pw@localhost:5432/t1")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from decimal import Decimal
from datetime import date
from fastapi import FastAPI
from fastapi.testclient import TestClient
import db_client as dbc
from modules.auth.v1 import get_current_user_v1
from modules.finance import receivables_ar_v1 as ar, receivables_payables_v1 as rp
from modules.transactions import bank_cash_willi as bc, purchase_bill_v1 as pb

dbc.Base.metadata.create_all(dbc.engine)
GAGAL = []
def cek(nama, kondisi, info=""):
    print(("PASS " if kondisi else "FAIL ") + nama + (f"  [{info}]" if (info and not kondisi) else ""))
    if not kondisi: GAGAL.append(nama)

s = dbc.SessionLocal()
c = dbc.Client(nama="FX Test PT", client_code="FXT"); s.add(c); s.flush(); cid = c.id
def coa(no, nm, cl, sub=None):
    r = dbc.ManagementClientCoa(client_id=cid, acc_no=no, account_name=nm, account_classification=cl, account_sub=sub)
    s.add(r); s.flush(); return r
bank = coa("1110", "Bank BCA USD", "ASSET", "CASH & CASH EQUIVALENTS")
coa("1120", "Piutang Usaha", "ASSET"); coa("2100", "Hutang Usaha", "LIABILITY"); coa("4100", "Pendapatan", "REVENUE")
coa("2200", "PPN Keluaran", "LIABILITY"); coa("1300", "PPN Masukan", "ASSET"); coa("6100", "Beban Umum", "EXPENSE")
gain = coa("7100", "Laba Selisih Kurs", "OTHER INCOME"); loss = coa("8100", "Rugi Selisih Kurs", "OTHER EXPENSE")
ap = s.query(dbc.ManagementClientCoa).filter_by(client_id=cid, acc_no="2100").first()
tx_in = s.query(dbc.ManagementClientCoa).filter_by(client_id=cid, acc_no="1300").first()
ex = s.query(dbc.ManagementClientCoa).filter_by(client_id=cid, acc_no="6100").first()
for k, r in (("account_payable", ap), ("purchase_tax_receivable", tx_in), ("purchase_cogs", ex)):
    s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key=k, coa_id=r.id))
s.add(dbc.ExchangeRate(currency="USD", rate_date=date(2026, 11, 10), rate_type="middle", rate=Decimal("16000"), source="manual"))
bank_id, gain_id, loss_id = bank.id, gain.id, loss.id
s.commit(); s.close()

user = {"id": None, "nama": "Tester", "username": "t", "role": "tahap_4"}
app = FastAPI()
for r in (ar.router_ar, rp.router_ar, rp.router_ap, pb.router, bc.router):
    app.include_router(r)
app.dependency_overrides[get_current_user_v1] = lambda: user
cl = TestClient(app)
AR_ = "/api/v1/finance/receivables"; AP_ = "/api/v1/finance/payables"; BILL = "/api/v1/transactions/purchase/bills"

def js(r): return r.json()
def D(x): return Decimal(str(x))

# ---------- Seting akun FX: belum diisi -> pelunasan dengan selisih ditolak ----------
# ---------- Invoice valas ----------
body = dict(client_id=cid, invoice_date="2026-11-01", payment_terms="30", currency="USD", exchange_rate=15000,
            branch="HO", customer_name="Acme Corp", tax_type="ppn_11", submit=True,
            lines=[dict(product_name="Consulting", quantity=1, unit_price=1000, tax_code="non_ppn", discount_value=0),
                   dict(product_name="License", quantity=1, unit_price=500, tax_code="ppn_11", discount_value=0)])
r = cl.post(f"{AR_}/invoice-entries", json=body); d = js(r)
cek("create invoice USD 201", r.status_code == 201, r.text[:300])
inv = d["data"]
cek("invoice: foreign_total 1555 USD", D(inv["foreign_total"]) == D("1555"), inv)
cek("invoice: IDR header = 23.325.000 (dpp 22.5jt + ppn 825rb)", D(inv["total"]) == D("23325000") and D(inv["dpp"]) == D("22500000") and D(inv["tax_total"]) == D("825000"), inv)
cek("invoice: baris tetap valas (1000)", D(inv["lines"][0]["unit_price"]) == D("1000"))
r = cl.post(f"{AR_}/invoice-entries", json={**body, "invoice_no": "INV/2026/9001", "exchange_rate": None, "invoice_date": "2026-11-12"}); 
cek("invoice tanpa kurs: master 10/11 (umur 2 hari) dipakai", r.status_code == 201 and D(js(r)["data"]["exchange_rate"]) == D("16000"), r.text[:300])
r = cl.post(f"{AR_}/invoice-entries", json={**body, "invoice_no": "INV/2026/9002", "exchange_rate": None, "invoice_date": "2026-12-20"})
cek("invoice tanpa kurs & master usang -> 422 FX_RATE_REQUIRED", r.status_code == 422, r.text[:200])
r = cl.post(f"{AR_}/invoice-entries", json={**body, "invoice_no": "INV/2026/9003", "currency": "IDR", "exchange_rate": None})
cek("invoice IDR tetap jalan", r.status_code == 201 and js(r)["data"]["foreign_total"] is None, r.text[:200])

s = dbc.SessionLocal()
for i in s.query(dbc.SalesInvoice).filter(dbc.SalesInvoice.management_client_id == cid).all():
    i.posting_status = "Posted"
s.commit()
inv_id = inv["id"]
s.close()

# ---------- Pelunasan 1 (parsial) : tanpa akun FX -> ditolak ----------
sett = dict(client_id=cid, tx_date="2026-11-10", party="ACME CORP", bank_coa_id=bank_id, currency="USD", submit=False,
            allocations=[dict(invoice_id=inv_id, fx_amount=500, fx_rate=16000)])
r = cl.post(f"{AR_}/settlements", json=sett)
cek("akun FX belum diset -> 422 FX_ACCOUNT_NOT_SET", r.status_code == 422 and "FX_ACCOUNT_NOT_SET" in r.text, r.text[:300])
s = dbc.SessionLocal()
s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key="fx_gain_realized", coa_id=gain_id))
s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key="fx_loss_realized", coa_id=loss_id))
s.commit(); s.close()

r = cl.post(f"{AR_}/settlements", json={**sett, "currency": "IDR"})
cek("currency IDR utk invoice USD ditolak", r.status_code in (400, 422) and "USD" in r.text, r.text[:200])
r = cl.post(f"{AR_}/settlements", json={**sett, "allocations": [dict(invoice_id=inv_id, fx_amount=2000, fx_rate=16000)]})
cek("fx_amount melebihi sisa ditolak", r.status_code in (400, 422), r.text[:200])
r = cl.post(f"{AR_}/settlements", json=sett); d = js(r)
cek("receipt parsial 500 USD @16000 -> draft 201", r.status_code == 201, r.text[:400])
st = d["data"]["settlement"]
cek("kas = 8.000.000", D(st["amount"]) == D("8000000"), st["amount"])
cek("allocated (tercatat) = 7.500.000", D(st["allocated"]) == D("7500000"), st["allocated"])
cek("unapplied = 0 (baris FX tidak dihitung unapplied)", D(st["unapplied"]) == 0, st["unapplied"])
cek("selisih kurs +500.000 (untung)", D(st["fx_difference"]) == D("500000"), st["fx_difference"])
cek("currency transaksi = USD", st["currency"] == "USD", st["currency"])
j = st["journal"]
cek("jurnal seimbang", sum(D(x["debit"]) for x in j) == sum(D(x["credit"]) for x in j), j)
cek("ada baris Laba Selisih Kurs 7100 kredit 500rb", any(x["account_code"] == "7100" and D(x["credit"]) == D("500000") for x in j), j)
t1 = st["id"]

# tanpa fx_rate -> kurs master (10/11 ada)
r = cl.get(f"{AR_}/invoices", params=dict(client_id=cid)); lst = js(r)["data"]
rows = lst if isinstance(lst, list) else lst.get("rows", lst.get("items", []))
row = next(x for x in rows if x["id"] == inv_id)
cek("daftar invoice: foreign_in_process 500 (draft)", D(row.get("foreign_in_process")) == D("500"), row)
cek("daftar invoice: foreign_outstanding 1055", D(row.get("foreign_outstanding")) == D("1055"), row)

# post t1
r = cl.post(f"{AR_}/settlements/{t1}/submit", params=dict(client_id=cid)) if False else None
r = cl.put(f"{AR_}/settlements/{t1}", json={**sett, "submit": True}); d = js(r)
cek("ubah + submit receipt -> posted", r.status_code == 200 and d["data"]["result"] == "posted", r.text[:400])

r = cl.get(f"{AR_}/invoices", params=dict(client_id=cid)); lst = js(r)["data"]
rows = lst if isinstance(lst, list) else lst.get("rows", lst.get("items", []))
row = next(x for x in rows if x["id"] == inv_id)
cek("setelah posted: outstanding IDR 15.825.000", D(row["outstanding"]) == D("15825000"), row)
cek("setelah posted: foreign_outstanding 1055, foreign_paid 500", D(row["foreign_outstanding"]) == D("1055") and D(row["foreign_paid"]) == D("500"), row)

# pelunasan akhir: 1055 USD @ 14500 -> sisa IDR habis tepat, rugi 527.500
fin = {**sett, "tx_date": "2026-11-14", "fx_rate": 14500, "submit": True,
       "allocations": [dict(invoice_id=inv_id, fx_amount=1055)]}
r = cl.post(f"{AR_}/settlements", json=fin); d = js(r)
cek("receipt akhir 1055 USD posted", r.status_code == 201 and d["data"]["result"] == "posted", r.text[:400])
st2 = d["data"]["settlement"]
cek("pelunasan akhir: tercatat 15.825.000, kas 15.297.500, selisih -527.500 (rugi)",
    D(st2["allocated"]) == D("15825000") and D(st2["amount"]) == D("15297500") and D(st2["fx_difference"]) == D("-527500"),
    (st2["allocated"], st2["amount"], st2["fx_difference"]))
r = cl.get(f"{AR_}/invoices", params=dict(client_id=cid, as_of="2026-11-30")); lst = js(r)["data"]
rows = lst if isinstance(lst, list) else lst.get("rows", lst.get("items", []))
row = next((x for x in rows if x["id"] == inv_id), None)
cek("invoice lunas: outstanding 0", row is None or D(row["outstanding"]) == 0, row)

# kurs dari master (tanpa fx_rate) + reverse
inv2 = [i for i in js(cl.get(f"{AR_}/invoices", params=dict(client_id=cid)))["data"]] if False else None
r = cl.post(f"{AR_}/settlements/{st2['id']}/reverse", json=dict(client_id=cid, reversal_date="2026-11-15", reason="test"))
cek("reverse receipt akhir", r.status_code == 200, r.text[:300])
r = cl.get(f"{AR_}/invoices", params=dict(client_id=cid)); lst = js(r)["data"]
rows = lst if isinstance(lst, list) else lst.get("rows", lst.get("items", []))
row = next(x for x in rows if x["id"] == inv_id)
cek("setelah reverse: outstanding 15.825.000 & foreign_outstanding 1055 lagi", D(row["outstanding"]) == D("15825000") and D(row["foreign_outstanding"]) == D("1055"), row)

# ---------- AP: bill valas ----------
bb = dict(management_client_id=cid, purchase_no="PUR-2026-11-0001", purchase_date="2026-11-02", invoice_date="2026-11-02",
          invoice_number="V-001", vendor_name="Global Supplier", currency="USD", exchange_rate=15000, submit=False,
          lines=[dict(description="Servers", quantity=2, unit_price=500, tax_code="ppn_11", account_code="6100")])
r = cl.post(BILL, json=bb); d = js(r)
cek("create bill USD 201", r.status_code == 201, r.text[:400])
bill = d["data"]
cek("bill: foreign_amount 1110, total IDR 16.650.000", D(bill["foreign_amount"]) == D("1110") and D(bill["total"]) == D("16650000"), (bill["foreign_amount"], bill["total"]))
cek("bill: baris IDR (subtotal 15.000.000, pajak 1.650.000)", D(bill["lines"][0]["subtotal"]) == D("15000000") and D(bill["lines"][0]["tax_amount"]) == D("1650000"), bill["lines"][0])
cek("bill: foreign_unit_price 500 untuk form edit", D(bill["lines"][0].get("foreign_unit_price")) == D("500"), bill["lines"][0])
s = dbc.SessionLocal()
t = s.get(dbc.PurchaseTransaction, bill["id"]); t.status = "posted"; s.commit(); s.close()
pay = dict(client_id=cid, tx_date="2026-11-10", party="GLOBAL SUPPLIER", bank_coa_id=bank_id, currency="USD", submit=True,
           allocations=[dict(invoice_id=bill["id"], fx_amount=1110, fx_rate=15500)])
r = cl.post(f"{AP_}/settlements", json=pay); d = js(r)
cek("payment bill USD posted", r.status_code == 201 and d["data"]["result"] == "posted", r.text[:400])
sp = d["data"]["settlement"]
cek("payment: kas 17.205.000, tercatat 16.650.000, selisih -555.000 (rugi)",
    D(sp["amount"]) == D("17205000") and D(sp["allocated"]) == D("16650000") and D(sp["fx_difference"]) == D("-555000"),
    (sp["amount"], sp["allocated"], sp["fx_difference"]))
jp = sp["journal"]
cek("jurnal payment seimbang & ada Rugi Selisih Kurs 8100 debit 555rb",
    sum(D(x["debit"]) for x in jp) == sum(D(x["credit"]) for x in jp) and any(x["account_code"] == "8100" and D(x["debit"]) == D("555000") for x in jp), jp)
r = cl.get(f"{AP_}/invoices", params=dict(client_id=cid)); lst = js(r)["data"]
rows = lst if isinstance(lst, list) else lst.get("rows", lst.get("items", []))
row = next((x for x in rows if x["id"] == bill["id"]), None)
cek("bill lunas: outstanding 0", row is None or D(row["outstanding"]) == 0, row)
# GL
jr = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=cid)
cek("GL posted seimbang", sum(D(x["debit"]) for x in jr) == sum(D(x["kredit"]) for x in jr),
    (sum(D(x["debit"]) for x in jr), sum(D(x["kredit"]) for x in jr)))

print("\nGAGAL:", GAGAL if GAGAL else "tidak ada")
sys.exit(1 if GAGAL else 0)
