"""E2E Fase 3A kurs: revaluasi akhir periode AR/AP valas + jurnal pembalik otomatis.
Jalankan di Postgres LOKAL (bukan produksi), SETELAH migration 56-58 / create_all:
    set DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:5432/t1
    python tests\\e2e_fx_revaluation.py
"""
import os, sys
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://postgres:pw@localhost:5432/t1")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from decimal import Decimal
from datetime import date
from fastapi import FastAPI
from fastapi.testclient import TestClient
import db_client as dbc
from modules.auth.v1 import get_current_user_v1
from modules.finance import receivables_ar_v1 as ar, receivables_payables_v1 as rp, fx_revaluation_v1 as fv
from modules.transactions import bank_cash_willi as bc, purchase_bill_v1 as pb

dbc.Base.metadata.create_all(dbc.engine)
GAGAL = []
def cek(nama, kondisi, info=""):
    print(("PASS " if kondisi else "FAIL ") + nama + (f"  [{info}]" if (info and not kondisi) else ""))
    if not kondisi: GAGAL.append(nama)
def D(x): return Decimal(str(x))
def js(r): return r.json()

# ---------- data awal ----------
s = dbc.SessionLocal()
c = dbc.Client(nama="FX Reval PT", client_code="FXR"); s.add(c); s.flush(); cid = c.id
def coa(no, nm, cl, sub=None):
    r = dbc.ManagementClientCoa(client_id=cid, acc_no=no, account_name=nm, account_classification=cl, account_sub=sub)
    s.add(r); s.flush(); return r
bank = coa("1110", "Bank BCA USD", "ASSET", "CASH & CASH EQUIVALENTS")
coa("1120", "Piutang Usaha", "ASSET"); ap = coa("2100", "Hutang Usaha", "LIABILITY"); coa("4100", "Pendapatan", "REVENUE")
coa("2200", "PPN Keluaran", "LIABILITY"); tx_in = coa("1300", "PPN Masukan", "ASSET"); ex = coa("6100", "Beban Umum", "EXPENSE")
g_real = coa("7100", "Laba Selisih Kurs", "OTHER INCOME"); l_real = coa("8100", "Rugi Selisih Kurs", "OTHER EXPENSE")
g_un = coa("7200", "Laba Selisih Kurs Belum Terealisasi", "OTHER INCOME"); l_un = coa("8200", "Rugi Selisih Kurs Belum Terealisasi", "OTHER EXPENSE")
for k, r in (("account_payable", ap), ("purchase_tax_receivable", tx_in), ("purchase_cogs", ex),
             ("fx_gain_realized", g_real), ("fx_loss_realized", l_real)):
    s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key=k, coa_id=r.id))
for tgl, kurs in ((date(2026, 11, 5), "15800"), (date(2026, 11, 10), "16000"), (date(2026, 11, 30), "16200")):
    s.add(dbc.ExchangeRate(currency="USD", rate_date=tgl, rate_type="middle", rate=Decimal(kurs), source="manual"))
bank_id, gun_id, lun_id = bank.id, g_un.id, l_un.id
s.commit(); s.close()

user = {"id": None, "nama": "Tester", "username": "t", "role": "tahap_4"}
app = FastAPI()
for r in (ar.router_ar, rp.router_ar, rp.router_ap, pb.router, bc.router, fv.router):
    app.include_router(r)
app.dependency_overrides[get_current_user_v1] = lambda: user
cl = TestClient(app)
AR_ = "/api/v1/finance/receivables"; AP_ = "/api/v1/finance/payables"; BILL = "/api/v1/transactions/purchase/bills"
FV = "/api/v1/finance/fx-revaluation"

def buat_invoice(no, cust, usd, kurs, tgl="2026-11-01"):
    body = dict(client_id=cid, invoice_date=tgl, payment_terms="30", currency="USD", exchange_rate=kurs, branch="HO",
                customer_name=cust, tax_type="ppn_11", submit=True, invoice_no=no,
                lines=[dict(product_name="Consulting", quantity=1, unit_price=usd, tax_code="non_ppn", discount_value=0)])
    r = cl.post(f"{AR_}/invoice-entries", json=body)
    assert r.status_code == 201, r.text[:300]
    return js(r)["data"]["id"]

inv_a = buat_invoice("INV/FX/A", "Alpha Corp", 1000, 15000)
inv_b = buat_invoice("INV/FX/B", "Beta Corp", 600, 15000)
inv_d = buat_invoice("INV/FX/D", "Delta Corp", 300, 15000)
bb = dict(management_client_id=cid, purchase_no="PUR-FX-0001", purchase_date="2026-11-02", invoice_date="2026-11-02",
          invoice_number="V-FX-1", vendor_name="Global Supplier", currency="USD", exchange_rate=15500, submit=False,
          lines=[dict(description="Servers", quantity=1, unit_price=500, tax_code="ppn_11", account_code="6100")])
r = cl.post(BILL, json=bb); assert r.status_code == 201, r.text[:300]
bill_id = js(r)["data"]["id"]
s = dbc.SessionLocal()
for i in s.query(dbc.SalesInvoice).filter(dbc.SalesInvoice.management_client_id == cid).all():
    i.posting_status = "Posted"
s.get(dbc.PurchaseTransaction, bill_id).status = "posted"
s.commit(); s.close()

def terima(inv, party, usd, tgl, kurs):
    r = cl.post(f"{AR_}/settlements", json=dict(client_id=cid, tx_date=tgl, party=party, bank_coa_id=bank_id, currency="USD",
                submit=True, allocations=[dict(invoice_id=inv, fx_amount=usd, fx_rate=kurs)]))
    assert r.status_code == 201 and js(r)["data"]["result"] == "posted", r.text[:400]
    return js(r)["data"]["settlement"]

terima(inv_b, "BETA CORP", 200, "2026-11-10", 16000)      # B: sisa 400 USD (tercatat 6.000.000)
terima(inv_d, "DELTA CORP", 300, "2026-11-12", 16000)     # D: lunas
cek("bill valas: total IDR 8.602.500 & 555 USD",
    D(js(cl.get(f"{AP_}/invoices", params=dict(client_id=cid)))["data"][0]["total"]) == D("8602500"))

def pre(per, rates=None):
    body = dict(client_id=cid, as_of=per)
    if rates: body["rates"] = rates
    return cl.post(f"{FV}/preview", json=body)

# ---------- 1. Preview, akun unrealized belum diset ----------
r = pre("2026-11-30"); d = js(r)["data"]
cek("preview 200", r.status_code == 200, r.text[:300])
cek("3 dokumen terbuka (A, B, bill); D lunas tidak ikut", d["totals"]["document_count"] == 3, [x["no"] for x in d["documents"]])
cek("kurs penutup 16.200 dari master", d["rates"][0]["rate"] == 16200.0 and d["rates"][0]["source"] == "master", d["rates"])
cek("untung 1.680.000 (A 1.200.000 + B 480.000)", D(d["totals"]["gain"]) == D("1680000"), d["totals"])
cek("rugi 388.500 (bill 555 USD)", D(d["totals"]["loss"]) == D("388500"), d["totals"])
cek("akun unrealized belum diset -> can_run false + pesan", d["can_run"] is False and not d["accounts_ready"]["gain"]
    and any("Unrealized FX" in m for m in d["issues"]), d["issues"])
doc_a = next(x for x in d["documents"] if x["no"] == "INV/FX/A")
cek("dokumen A: 1000 USD, tercatat 15jt -> 16,2jt, selisih +1,2jt gain",
    D(doc_a["foreign_outstanding"]) == 1000 and D(doc_a["carried_idr"]) == D("15000000") and D(doc_a["revalued_idr"]) == D("16200000")
    and D(doc_a["difference"]) == D("1200000") and doc_a["effect"] == "gain", doc_a)
doc_b = next(x for x in d["documents"] if x["no"] == "INV/FX/B")
cek("dokumen B: sisa 400 USD (setelah receipt 200), tercatat 6jt -> 6,48jt",
    D(doc_b["foreign_outstanding"]) == 400 and D(doc_b["carried_idr"]) == D("6000000") and D(doc_b["difference"]) == D("480000"), doc_b)
doc_c = next(x for x in d["documents"] if x["type"] == "ap")
cek("bill (AP): naik 388.500 = RUGI", D(doc_c["difference"]) == D("388500") and doc_c["effect"] == "loss", doc_c)

r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30"))
cek("run tanpa akun unrealized -> 422 FX_ACCOUNT_NOT_SET", r.status_code == 422 and "FX_ACCOUNT_NOT_SET" in r.text, r.text[:200])

s = dbc.SessionLocal()
s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key="fx_gain_unrealized", coa_id=gun_id))
s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key="fx_loss_unrealized", coa_id=lun_id))
s.commit(); s.close()

# ---------- 2. Preview setelah akun diset: jurnal ----------
d = js(pre("2026-11-30"))["data"]
j = d["journal"]
cek("can_run true", d["can_run"] is True, d["issues"])
cek("jurnal preview seimbang", sum(D(x["debit"]) for x in j) == sum(D(x["credit"]) for x in j) and len(j) == 4, j)
cek("Cr 7200 1.680.000 & Dr 8200 388.500", any(x["account_code"] == "7200" and D(x["credit"]) == D("1680000") for x in j)
    and any(x["account_code"] == "8200" and D(x["debit"]) == D("388500") for x in j), j)

# ---------- 3. Pembatasan tanggal: per 9 Nov (sebelum receipt 10/12 Nov) ----------
d = js(pre("2026-11-09"))["data"]
cek("per 9 Nov: 4 dokumen (B belum dibayar, D belum lunas)", d["totals"]["document_count"] == 4, [x["no"] for x in d["documents"]])
cek("per 9 Nov: kurs 15.800 (kurs master 5 Nov)", d["rates"][0]["rate"] == 15800.0, d["rates"])
cek("per 9 Nov: untung 1.520.000, rugi 166.500", D(d["totals"]["gain"]) == D("1520000") and D(d["totals"]["loss"]) == D("166500"), d["totals"])
b9 = next(x for x in d["documents"] if x["no"] == "INV/FX/B")
cek("per 9 Nov: B masih 600 USD, tercatat 9jt", D(b9["foreign_outstanding"]) == 600 and D(b9["carried_idr"]) == D("9000000"), b9)

# ---------- 4. Kurs hilang & kurs manual ----------
d = js(pre("2026-12-31"))["data"]
cek("per 31 Des tanpa kurs terbaru: missing_rates USD, can_run false", d["missing_rates"] == ["USD"] and d["can_run"] is False, d)
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-12-31"))
cek("run tanpa kurs -> 422 FX_RATE_REQUIRED", r.status_code == 422 and "FX_RATE_REQUIRED" in r.text, r.text[:200])
d = js(pre("2026-12-31", {"USD": 16400}))["data"]
cek("kurs manual 16.400 dipakai (source manual)", d["rates"][0]["source"] == "manual" and not d["missing_rates"], d["rates"])
r = cl.post(f"{FV}/preview", json=dict(client_id=cid, as_of="2026-11-30", rates={"IDR": 1}))
cek("kurs manual IDR ditolak (422)", r.status_code == 422, r.text[:200])

# ---------- 5. Hak akses ----------
user["role"] = "tahap_3"
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30"))
cek("Supervisor tidak boleh run (403)", r.status_code == 403, r.text[:200])
cek("Supervisor boleh preview", pre("2026-11-30").status_code == 200)
user["role"] = "tahap_4"

# ---------- 6. Run November ----------
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30", notes="Closing Nov")); d = js(r)
cek("run Nov 200", r.status_code == 200, r.text[:400])
run1 = d["data"]["run"]
cek("nomor jurnal REV-20261130 & RV-REV-20261130", d["data"]["journal_number"] == "REV-20261130" and d["data"]["reversal_journal_number"] == "RV-REV-20261130", d["data"])
cek("run: untung 1.680.000, rugi 388.500, 3 dokumen", D(run1["total_gain"]) == D("1680000") and D(run1["total_loss"]) == D("388500") and run1["document_count"] == 3, run1)
s = dbc.SessionLocal()
jes = s.query(dbc.JournalEntryDraft).filter(dbc.JournalEntryDraft.management_client_id == cid,
                                            dbc.JournalEntryDraft.source_type == "Revaluation").order_by(dbc.JournalEntryDraft.entry_date).all()
cek("2 jurnal posted: 30 Nov & 1 Des", [(j.entry_date, j.status) for j in jes] == [(date(2026, 11, 30), "posted"), (date(2026, 12, 1), "posted")], [(j.entry_date, j.status) for j in jes])
bar = {j.je_number: [(l.account_code, D(l.debit), D(l.credit)) for l in s.query(dbc.JournalEntryDraftLine).filter_by(draft_id=j.id).all()] for j in jes}
s.close()
a, b = bar["REV-20261130"], bar["RV-REV-20261130"]
cek("jurnal revaluasi seimbang", sum(x[1] for x in a) == sum(x[2] for x in a))
cek("jurnal pembalik = debit/kredit ditukar", sorted((x[0], x[2], x[1]) for x in a) == sorted((x[0], x[1], x[2]) for x in b), (a, b))

def saldo(per, kode):
    baris = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=cid, sampai_tanggal=per)
    return sum((D(x["debit"]) - D(x["kredit"]) for x in baris if x["account_code"] == kode and x["sumber"] == "journal_entry"), Decimal(0))
cek("GL per 30 Nov: 7200 kredit 1.680.000, 8200 debit 388.500", saldo(date(2026, 11, 30), "7200") == D("-1680000") and saldo(date(2026, 11, 30), "8200") == D("388500"))
cek("GL per 1 Des: revaluasi terbalik habis (7200 & 8200 = 0)", saldo(date(2026, 12, 1), "7200") == 0 and saldo(date(2026, 12, 1), "8200") == 0)
jr = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=cid, sampai_tanggal=date(2026, 11, 30))
cek("GL per 30 Nov tetap seimbang", sum(D(x["debit"]) for x in jr) == sum(D(x["kredit"]) for x in jr))

# ---------- 7. Duplikat ----------
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30"))
cek("run ulang tanggal sama -> 409 REVALUATION_EXISTS", r.status_code == 409 and "REVALUATION_EXISTS" in r.text, r.text[:200])
d = js(pre("2026-11-30"))["data"]
cek("preview: existing_run terisi & can_run false", d["existing_run"] is not None and d["can_run"] is False)

# ---------- 8. Interaksi Fase 2: pelunasan setelah revaluasi tetap dibanding KURS INVOICE ----------
st = terima(inv_a, "ALPHA CORP", 1000, "2026-12-05", 16300)
cek("Fase 2 utuh: selisih terealisasi A = 1000 x (16.300 - 15.000) = +1.300.000 (bukan terhadap kurs revaluasi)",
    D(st["fx_difference"]) == D("1300000"), st["fx_difference"])

# ---------- 9. Run Desember (tidak berantai dari November) ----------
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-12-31", rates={"USD": 16400})); d = js(r)
cek("run Des 200", r.status_code == 200, r.text[:400])
rd = d["data"]["run"]
cek("Des: A lunas tidak ikut; untung B 560.000, rugi bill 499.500", D(rd["total_gain"]) == D("560000") and D(rd["total_loss"]) == D("499500") and rd["document_count"] == 2, rd)
cek("GL per 31 Des: 7200 = -560.000 & 8200 = 499.500 (Nov sudah terbalik)",
    saldo(date(2026, 12, 31), "7200") == D("-560000") and saldo(date(2026, 12, 31), "8200") == D("499500"),
    (saldo(date(2026, 12, 31), "7200"), saldo(date(2026, 12, 31), "8200")))

# ---------- 10. Batalkan November, buat ulang ----------
r = cl.post(f"{FV}/runs/{run1['id']}/cancel", params=dict(client_id=cid), json=dict(reason="salah kurs")); d = js(r)
cek("cancel Nov 200 -> cancelled", r.status_code == 200 and d["data"]["status"] == "cancelled", r.text[:300])
cek("GL per 30 Nov: 7200 & 8200 hilang", saldo(date(2026, 11, 30), "7200") == 0 and saldo(date(2026, 11, 30), "8200") == 0)
r = cl.post(f"{FV}/runs/{run1['id']}/cancel", params=dict(client_id=cid), json={})
cek("cancel ulang -> 409", r.status_code == 409, r.text[:200])
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30")); d = js(r)
cek("buat ulang Nov setelah cancel -> nomor REV-20261130-2", r.status_code == 200 and d["data"]["journal_number"] == "REV-20261130-2", r.text[:300])
r = cl.get(f"{FV}/runs", params=dict(client_id=cid)); lst = js(r)["data"]
cek("riwayat: 3 run (2 posted, 1 cancelled)", len(lst) == 3 and sorted(x["status"] for x in lst) == ["cancelled", "posted", "posted"], [x["status"] for x in lst])
r = cl.get(f"{FV}/runs/{run1['id']}", params=dict(client_id=cid)); dd = js(r)["data"]
cek("detail run: dokumen + jurnal (terhapus ditandai)", len(dd["documents"]) == 3 and dd["journal"]["deleted"] is True, dd.get("journal"))

print("\nGAGAL:", GAGAL if GAGAL else "tidak ada")
sys.exit(1 if GAGAL else 0)
