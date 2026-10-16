import os, sys, json
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://postgres:pw@localhost:5432/t1")  # pakai Postgres LOKAL/test, JANGAN Supabase produksi
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import db_client as dbc
from modules.auth.v1 import get_current_user_v1
from modules.transactions import purchase_bill_v1 as pb, purchase_v1 as pv

dbc.Base.metadata.create_all(dbc.engine)
s=dbc.SessionLocal()
c=dbc.Client(nama="Test PT", client_code="TST"); s.add(c); s.flush(); cid=c.id
def coa(no,nm,cl): 
    r=dbc.ManagementClientCoa(client_id=cid,acc_no=no,account_name=nm,account_classification=cl); s.add(r); s.flush(); return r
ap=coa("2100","Accounts Payable","LIABILITY"); tx=coa("1300","VAT Input","ASSET"); ex=coa("5100","Purchases","COST OF SALES"); coa("6100","Office Exp","EXPENSE")
for k,r in (("account_payable",ap),("purchase_tax_receivable",tx),("purchase_cogs",ex)):
    s.add(dbc.ManagementSettingAccountMapping(client_id=cid,mapping_key=k,coa_id=r.id))
s.commit(); s.close()

user={"id":None,"nama":"Tester","username":"t","role":"tahap_4"}
app=FastAPI(); app.include_router(pb.router); app.include_router(pv.router)
app.dependency_overrides[get_current_user_v1]=lambda: user
cl=TestClient(app); B="/api/v1/transactions/purchase"
def show(t,r): print(f"\n## {t} -> {r.status_code}"); d=r.json(); print(json.dumps(d if r.status_code>=400 else {"message":d.get("message")},default=str)[:400]); return d

r=cl.get(f"{B}/bills/form-options",params={"management_client_id":cid,"purchase_date":"2026-10-16"}); d=show("form-options",r)
print(d["data"]["next_number"], d["data"]["defaults"], len(d["data"]["accounts"]))
def body(**kw):
    b=dict(management_client_id=cid,purchase_no="PUR-2026-10-0001",purchase_date="2026-10-16",invoice_date="2026-10-15",
      invoice_number="INV-001",vendor_name="CV Maju",tax_inclusive=False,submit=False,due_date="2026-11-15",
      lines=[dict(description="Kertas A4",quantity=10,unit_price=50000,discount_type="percent",discount_value=10,tax_code="ppn_11"),
             dict(description="Jasa",quantity=1,unit_price=111000,discount_type="amount",discount_value=0,tax_code="ppn_12",account_code="6100")])
    b.update(kw); return b
r=cl.post(f"{B}/bills",json=body()); d=show("create draft (exclusive)",r); bill=d["data"]; print({k:bill[k] for k in("status","subtotal","discount","tax_amount","total","accounts_payable","ap_account_code","tax_account_code")}); print([(l["account_code"],l["subtotal"],l["discount"],l["tax_amount"],l["total"]) for l in bill["lines"]])
bid=bill["id"]
show("duplicate invoice", cl.post(f"{B}/bills",json=body(purchase_no="PUR-2026-10-0002")))
show("duplicate purchase_no", cl.post(f"{B}/bills",json=body(invoice_number="X9")))
show("check-invoice", cl.get(f"{B}/bills/check-invoice",params={"management_client_id":cid,"vendor_name":"cv maju","invoice_number":"inv-001"}))
show("bad account", cl.post(f"{B}/bills",json=body(purchase_no="P3",invoice_number="X3",lines=[dict(description="a",quantity=1,unit_price=1000,account_code="9999")])))
# inclusive
r=cl.post(f"{B}/bills",json=body(purchase_no="PUR-2026-10-0003",invoice_number="INV-003",tax_inclusive=True,lines=[dict(description="Inklusif",quantity=3,unit_price=111000,discount_type="percent",discount_value=5,tax_code="ppn_11")])); d=show("create inclusive",r); b2=d["data"]; print({k:b2[k] for k in("subtotal","discount","tax_amount","total","accounts_payable")})
# edit + submit
show("GET detail", cl.get(f"{B}/bills/{bid}"))
r=cl.put(f"{B}/bills/{bid}",json=body(submit=True,lines=[dict(description="Kertas A4 rev",quantity=20,unit_price=50000,tax_code="ppn_11")])); d=show("edit+submit",r); print(d["data"]["status"] if r.status_code<400 else "", [(l["line_no"],l["total"]) for l in d["data"]["lines"]] if r.status_code<400 else "")
show("approve", cl.post(f"{B}/transactions/approve",json={"transaction_ids":[bid]}))
r=cl.put(f"{B}/bills/{bid}",json=body()); show("edit after approve (expect 409)",r)
r=cl.post(f"{B}/transactions/post",json={"transaction_ids":[bid]}); d=show("post",r); print(d.get("data"))  if r.status_code<400 else None
d=cl.get(f"{B}/bills/{bid}").json()["data"]; print("final status:",d["status"],d.get("posted_by_name"))
# jurnal posted
j=dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=cid)
print("\nJURNAL POSTED:"); [print(x["nomor"],x["account_code"],x["debit"],x["kredit"]) for x in j]
print("debit",sum(x["debit"] for x in j),"kredit",sum(x["kredit"] for x in j))