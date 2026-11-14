import os, sys, json
os.environ.setdefault("DATABASE_URL","postgresql+psycopg2://postgres:pw@localhost:5432/t1")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
import db_client as dbc
from modules.auth.v1 import get_current_user_v1
from modules.transactions import purchase_bill_v1 as pb, purchase_v1 as pv
from modules.finance import payables_v1 as ap

dbc.Base.metadata.create_all(dbc.engine)
s=dbc.SessionLocal()
c=dbc.Client(nama="AP Test PT", client_code="APT"); s.add(c); s.flush(); cid=c.id
def coa(no,nm,cl):
    r=dbc.ManagementClientCoa(client_id=cid,acc_no=no,account_name=nm,account_classification=cl); s.add(r); s.flush(); return r
apc=coa("2100","Accounts Payable","LIABILITY"); tx=coa("1300","VAT Input","ASSET"); ex=coa("5100","Purchases","COST OF SALES")
for k,r in (("account_payable",apc),("purchase_tax_receivable",tx),("purchase_cogs",ex)):
    s.add(dbc.ManagementSettingAccountMapping(client_id=cid,mapping_key=k,coa_id=r.id))
s.commit(); s.close()

user={"id":None,"nama":"Tester","username":"t","role":"tahap_4"}
app=FastAPI()
for m in (pb,pv,ap): app.include_router(m.router)
app.dependency_overrides[get_current_user_v1]=lambda: user
cl=TestClient(app); P="/api/v1/transactions/purchase"; A="/api/v1/finance/payables"
ok=True
def check(name,cond,extra=""):
    global ok; ok&=bool(cond); print(("PASS " if cond else "FAIL ")+name, extra if not cond else "")

def bill(no,inv,vendor,tgl,due=None,terms=None,harga=1000000,submit=True):
    b=dict(management_client_id=cid,purchase_no=no,purchase_date=tgl,invoice_date=tgl,invoice_number=inv,vendor_name=vendor,
           payment_terms=terms,due_date=due,submit=submit,lines=[dict(description="Item",quantity=1,unit_price=harga,tax_code="ppn_11")])
    r=cl.post(f"{P}/bills",json=b); assert r.status_code==201,r.text; return r.json()["data"]["id"]
A_id=bill("B-A","INV-A","CV Alfa","2026-08-01",due="2026-09-01")            # total 1.110.000, telat 45 hari
B_id=bill("B-B","INV-B","CV Alfa","2026-10-10",terms="Net 30")                # jatuh tempo diestimasi 2026-11-09
C_id=bill("B-C","INV-C","PT Beta","2026-07-01",due="2026-07-31",harga=2000000)  # telat 77 hari, total 2.220.000
D_id=bill("B-D","INV-D","PT Beta","2026-10-01",submit=False)                  # tetap draft -> tidak boleh muncul di AP
ids=[A_id,B_id,C_id]
r=cl.post(f"{P}/transactions/approve",json={"transaction_ids":ids}); assert r.status_code==200
r=cl.post(f"{P}/transactions/post",json={"transaction_ids":ids}); print("post:",r.json()["message"])

q={"client_id":cid,"as_of":"2026-10-16"}
d=cl.get(f"{A}/invoices",params=q).json()["data"]
check("invoices: hanya bill posted (3, draft D tidak ikut)", len(d)==3, [x["no"] for x in d])
by={x["no"]:x for x in d}
check("A telat 45 hari, bucket 31_60, status overdue", by["INV-A"]["days_overdue"]==45 and by["INV-A"]["bucket"]=="31_60" and by["INV-A"]["status"]=="overdue", by["INV-A"])
check("B due diestimasi dari Net 30, bucket current, status open", by["INV-B"]["due_date"]=="2026-11-09" and by["INV-B"]["due_date_estimated"] and by["INV-B"]["bucket"]=="current" and by["INV-B"]["status"]=="open", by["INV-B"])
check("C bucket 61_90", by["INV-C"]["bucket"]=="61_90", by["INV-C"])
check("total = bill + PPN, akun AP", by["INV-A"]["total"]==1110000 and by["INV-A"]["outstanding"]==1110000 and by["INV-A"]["account_code"]=="2100")

# --- simulasi pembayaran (tabel dikelola modul rekonsiliasi bank; DDL minimal utk tes)
with dbc.engine.begin() as cx:
    cx.execute(text("""create table if not exists financial_transaction_bank_cash_payments(
        id uuid primary key default gen_random_uuid(), client_id uuid, direction text, purchase_transaction_id uuid, sales_invoice_id uuid,
        payment_date date, amount numeric, applied_at timestamptz, deleted_at timestamptz)"""))
    # A: bayar 300rb sudah diposting (trigger menurunkan accounts_payable) + 200rb masih menunggu posting
    cx.execute(text("insert into financial_transaction_bank_cash_payments(client_id,direction,purchase_transaction_id,payment_date,amount,applied_at) values (cast(:c as uuid),'cash_payment',cast(:p as uuid),'2026-10-05',300000,now())"),{"c":cid,"p":A_id})
    cx.execute(text("update financial_transaction_purchase_transactions set accounts_payable=accounts_payable-300000, payment_status='partial' where id=cast(:p as uuid)"),{"p":A_id})
    cx.execute(text("insert into financial_transaction_bank_cash_payments(client_id,direction,purchase_transaction_id,payment_date,amount) values (cast(:c as uuid),'cash_payment',cast(:p as uuid),'2026-10-12',200000)"),{"c":cid,"p":A_id})
    # B: lunas
    cx.execute(text("insert into financial_transaction_bank_cash_payments(client_id,direction,purchase_transaction_id,payment_date,amount,applied_at) values (cast(:c as uuid),'cash_payment',cast(:p as uuid),'2026-10-14',1110000,now())"),{"c":cid,"p":B_id})
    cx.execute(text("update financial_transaction_purchase_transactions set accounts_payable=0, payment_status='paid' where id=cast(:p as uuid)"),{"p":B_id})

d=cl.get(f"{A}/invoices",params=q).json()["data"]; by={x["no"]:x for x in d}
check("A: paid 300rb, outstanding 810rb, in_process 200rb, available 610rb, last payment", (by["INV-A"]["paid"],by["INV-A"]["outstanding"],by["INV-A"]["in_process"],by["INV-A"]["available"],by["INV-A"]["last_payment_date"])==(300000,810000,200000,610000,"2026-10-05"), by["INV-A"])
check("B lunas: status paid, bucket None", by["INV-B"]["status"]=="paid" and by["INV-B"]["bucket"] is None, by["INV-B"])
check("only_open membuang B", len(cl.get(f"{A}/invoices",params={**q,"only_open":True}).json()["data"])==2)
check("filter party", len(cl.get(f"{A}/invoices",params={**q,"party":"pt beta"}).json()["data"])==1)

ov=cl.get(f"{A}/overview",params=q).json()["data"]
k=ov["kpi"]
check("overview KPI: outstanding 810rb+2.220.000=3.030.000", k["total_outstanding"]==3030000, k)
check("overview KPI: overdue = sama (A & C telat)", k["overdue"]==3030000 and k["overdue_count"]==2 and k["open_count"]==2 and k["parties_with_balance"]==2, k)
check("overview collected_month Oct = 300rb+1.110.000", k["collected_month"]==1410000, k)
ag={a["bucket"]:a["amount"] for a in ov["aging"]}
check("overview aging 31_60=810rb, 61_90=2.220.000", ag["31_60"]==810000 and ag["61_90"]==2220000 and ag["current"]==0, ag)
check("top_overdue PT Beta terbesar", ov["top_overdue"][0]["party"]=="PT Beta", ov["top_overdue"])
check("trend 6 bulan, bulan terakhir 2026-10", len(ov["trend"])==6 and ov["trend"][-1]["month"]=="2026-10", ov["trend"])

g=cl.get(f"{A}/aging",params={**q,"include_details":True}).json()["data"]
check("aging total 3.030.000, 2 vendor", g["totals"]["total"]==3030000 and len(g["rows"])==2, g["totals"])
check("aging row detail", all(len(r["invoices"])==r["open_count"] for r in g["rows"]))
pa=cl.get(f"{A}/parties",params={"client_id":cid}).json()["data"]
check("parties: CV Alfa outstanding 810rb", {p["name"]:p["outstanding"] for p in pa}.get("CV Alfa")==810000, pa)
st=cl.get(f"{A}/statement",params={"client_id":cid,"party":"CV Alfa","date_from":"2026-08-01","date_to":"2026-10-16"}).json()["data"]
check("statement CV Alfa: charge 2.220.000, settle 1.410.000, closing 810rb", (st["total_charges"],st["total_settlements"],st["closing_balance"])==(2220000,1410000,810000), st)
check("settlements kosong", cl.get(f"{A}/settlements",params={"client_id":cid}).json()["data"]==[])
check("next-number", cl.get(f"{A}/settlements/next-number",params={"client_id":cid,"date":"2026-10-16"}).json()["data"]["number"]=="PAY/2026/0001")
r=cl.post(f"{A}/settlements",json={}); check("POST settlements -> 501 pesan jelas", r.status_code==501 and "not available" in r.json()["message"], r.text)
# klien lain tidak bocor
c2=cl.get(f"{A}/invoices",params={"client_id":"00000000-0000-0000-0000-000000000001","as_of":"2026-10-16"}).json()["data"]
check("klien lain: kosong", c2==[])
print("\nHASIL:", "SEMUA LOLOS" if ok else "ADA YANG GAGAL")