"""E2E Fase 3B/3C kurs: rekening bank valas, transfer antar mata uang, revaluasi saldo bank valas.
Jalankan di Postgres LOKAL (bukan produksi) yang BERSIH (kurs master global, jadi pakai database baru):
    set DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:5432/t5
    python tests\\e2e_fx_bank_transfer.py
"""
import os, sys
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://postgres:pw@localhost:5432/t5")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from decimal import Decimal
from datetime import date
from fastapi import FastAPI
from fastapi.testclient import TestClient
import db_client as dbc
from modules.auth.v1 import get_current_user_v1
from modules.finance import receivables_ar_v1 as ar, receivables_payables_v1 as rp, fx_revaluation_v1 as fv, fx_bank_v1 as fb
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
c = dbc.Client(nama="FX Bank PT", client_code="FXB"); s.add(c); s.flush(); cid = c.id
def coa(no, nm, cl, sub=None):
    r = dbc.ManagementClientCoa(client_id=cid, acc_no=no, account_name=nm, account_classification=cl, account_sub=sub)
    s.add(r); s.flush(); return r
KAS = "CASH & CASH EQUIVALENTS"
b_idr = coa("1100", "Bank BCA IDR", "ASSET", KAS)
b_usd = coa("1110", "Bank BCA USD", "ASSET", KAS)
b_usd2 = coa("1112", "Bank Mandiri USD", "ASSET", KAS)
b_eur = coa("1115", "Bank BCA EUR", "ASSET", KAS)
coa("1120", "Piutang Usaha", "ASSET"); ap = coa("2100", "Hutang Usaha", "LIABILITY"); coa("4100", "Pendapatan", "REVENUE")
coa("2200", "PPN Keluaran", "LIABILITY"); tx_in = coa("1300", "PPN Masukan", "ASSET"); ex = coa("6100", "Beban Umum", "EXPENSE")
g_real = coa("7100", "Laba Selisih Kurs", "OTHER INCOME"); l_real = coa("8100", "Rugi Selisih Kurs", "OTHER EXPENSE")
g_un = coa("7200", "Laba Selisih Kurs Belum Terealisasi", "OTHER INCOME"); l_un = coa("8200", "Rugi Selisih Kurs Belum Terealisasi", "OTHER EXPENSE")
for k, r in (("account_payable", ap), ("purchase_tax_receivable", tx_in), ("purchase_cogs", ex),
             ("fx_gain_realized", g_real), ("fx_loss_realized", l_real),
             ("fx_gain_unrealized", g_un), ("fx_loss_unrealized", l_un)):
    s.add(dbc.ManagementSettingAccountMapping(client_id=cid, mapping_key=k, coa_id=r.id))
for mu, tgl, kurs in (("USD", date(2026, 11, 5), "15800"), ("USD", date(2026, 11, 10), "16000"), ("USD", date(2026, 11, 30), "16200"),
                      ("EUR", date(2026, 11, 10), "17000"), ("EUR", date(2026, 11, 30), "17500")):
    s.add(dbc.ExchangeRate(currency=mu, rate_date=tgl, rate_type="middle", rate=Decimal(kurs), source="manual"))
I_IDR, I_USD, I_USD2, I_EUR, I_EXP, I_REV = b_idr.id, b_usd.id, b_usd2.id, b_eur.id, ex.id, None
s.commit(); s.close()

user = {"id": None, "nama": "Tester", "username": "t", "role": "tahap_4"}
app = FastAPI()
for r in (ar.router_ar, rp.router_ar, rp.router_ap, pb.router, bc.router, fv.router, fb.router):
    app.include_router(r)
app.dependency_overrides[get_current_user_v1] = lambda: user
cl = TestClient(app)
AR_ = "/api/v1/finance/receivables"; BC = "/api/v1/transactions/bank-cash"
FV = "/api/v1/finance/fx-revaluation"; FB = "/api/v1/finance/fx-bank"

def akun(kode, per="2026-11-30"):
    d = js(cl.get(f"{FB}/accounts", params=dict(client_id=cid, as_of=per)))["data"]["accounts"]
    return next(x for x in d if x["account_code"] == kode)

def saldo_gl(per, kode):
    baris = dbc.ambil_baris_jurnal_posted_transaksi(management_client_id=cid, sampai_tanggal=per)
    return sum((D(x["debit"]) - D(x["kredit"]) for x in baris if x["account_code"] == kode), Decimal(0))

def transfer(dari, ke, jml_dari, jml_ke, tgl, **extra):
    return cl.post(f"{FB}/transfers", json=dict(client_id=cid, transfer_date=tgl, from_coa_id=dari, to_coa_id=ke,
                                                 from_amount=jml_dari, to_amount=jml_ke, **extra))
def prevt(dari, ke, jml_dari, jml_ke, tgl, **extra):
    return cl.post(f"{FB}/transfers/preview", json=dict(client_id=cid, transfer_date=tgl, from_coa_id=dari, to_coa_id=ke,
                                                         from_amount=jml_dari, to_amount=jml_ke, **extra))

# ---------- 1. Rekening valas ----------
def set_akun(coa_id, mu, mulai="2026-11-01", awal=0):
    return cl.put(f"{FB}/accounts", json=dict(client_id=cid, coa_id=coa_id, currency=mu, tracking_start=mulai, opening_foreign=awal))
user["role"] = "tahap_3"
cek("Supervisor tidak boleh menandai rekening valas (403)", set_akun(I_USD, "USD").status_code == 403)
user["role"] = "tahap_4"
cek("mata uang IDR ditolak (422)", set_akun(I_USD, "IDR").status_code == 422)
cek("akun non-kas ditolak (400)", set_akun(I_EXP, "USD").status_code == 400)
for i, mu in ((I_USD, "USD"), (I_USD2, "USD"), (I_EUR, "EUR")):
    r = set_akun(i, mu); assert r.status_code == 200, r.text[:300]
a = js(cl.get(f"{FB}/accounts", params=dict(client_id=cid, as_of="2026-11-30")))["data"]["accounts"]
cek("daftar rekening: 4 akun kas, 3 valas", len(a) == 4 and sum(x["is_foreign"] for x in a) == 3, [(x["account_code"], x["currency"]) for x in a])

# ---------- 2. Penerimaan invoice USD ke rekening USD (Fase 2) ----------
def buat_invoice(no, cust, usd, kurs, tgl="2026-11-01"):
    body = dict(client_id=cid, invoice_date=tgl, payment_terms="30", currency="USD", exchange_rate=kurs, branch="HO",
                customer_name=cust, tax_type="ppn_11", submit=True, invoice_no=no,
                lines=[dict(product_name="Consulting", quantity=1, unit_price=usd, tax_code="non_ppn", discount_value=0)])
    r = cl.post(f"{AR_}/invoice-entries", json=body); assert r.status_code == 201, r.text[:300]
    return js(r)["data"]["id"]
inv_a = buat_invoice("INV/FB/A", "Alpha Corp", 1000, 15000)
s = dbc.SessionLocal()
for i in s.query(dbc.SalesInvoice).filter(dbc.SalesInvoice.management_client_id == cid).all():
    i.posting_status = "Posted"
s.commit(); s.close()
r = cl.post(f"{AR_}/settlements", json=dict(client_id=cid, tx_date="2026-11-10", party="ALPHA CORP", bank_coa_id=I_USD, currency="USD",
            submit=True, allocations=[dict(invoice_id=inv_a, fx_amount=1000, fx_rate=16000)]))
cek("receipt USD 1000 @16.000 ke rekening USD posted", r.status_code == 201 and js(r)["data"]["result"] == "posted", r.text[:300])
u = akun("1110")
cek("saldo valas 1110 = 1000 USD, nilai buku 16jt, rata-rata 16.000, tanpa masalah",
    D(u["foreign_balance"]) == 1000 and D(u["carrying_idr"]) == D("16000000") and u["average_rate"] == 16000.0 and not u["issues"], u)

# ---------- 3. Transaksi tanpa nominal valas menahan rekening ----------
r = cl.post(f"{BC}/transactions", json=dict(client_id=cid, direction="payment", tx_date="2026-11-12", bank_coa_id=I_USD,
            category="Bank Charges", lines=[dict(type="account", coa_id=I_EXP, amount=160000, description="Admin fee USD 10")]))
assert r.status_code == 201, r.text[:300]
tx_fee = js(r)["data"]["id"]
for jalur in ("approve", "post"):
    r = cl.post(f"{BC}/transactions/{jalur}", json=dict(client_id=cid, ids=[tx_fee])); assert r.status_code == 200, r.text[:300]
u = akun("1110")
cek("transaksi biaya admin tanpa nominal valas dilaporkan (1 belum dikonversi)", len(u["unconverted"]) == 1 and u["issues"], u)
r = prevt(I_USD, I_IDR, 100, 1600000, "2026-11-15")
cek("transfer dari rekening yang belum bisa dipastikan -> can_post false", js(r)["data"]["can_post"] is False and js(r)["data"]["code"] == "FX_BANK_UNCONVERTED", r.text[:300])
d = js(cl.post(f"{FV}/preview", json=dict(client_id=cid, as_of="2026-11-30")))["data"]
cek("revaluasi menahan run sampai nominal valas diisi", d["can_run"] is False and any("no USD amount" in m for m in d["issues"]), d["issues"])
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30"))
cek("run revaluasi -> 422 FX_BANK_UNCONVERTED", r.status_code == 422 and "FX_BANK_UNCONVERTED" in r.text, r.text[:200])
user["role"] = "tahap_3"
r = cl.put(f"{FB}/transactions/{tx_fee}/foreign-amount", json=dict(client_id=cid, fx_amount=10, fx_rate=16000))
cek("Supervisor boleh mengisi nominal valas", r.status_code == 200, r.text[:300])
user["role"] = "tahap_4"
u = akun("1110")
cek("setelah diisi: 990 USD, nilai buku 15.840.000, rata-rata 16.000",
    D(u["foreign_balance"]) == 990 and D(u["carrying_idr"]) == D("15840000") and u["average_rate"] == 16000.0 and not u["issues"], u)
r = cl.put(f"{FB}/transactions/{I_IDR}/foreign-amount", json=dict(client_id=cid, fx_amount=1))
cek("nominal valas hanya untuk transaksi di rekening valas (404 / 400)", r.status_code in (400, 404), r.text[:200])

# ---------- 4. Transfer USD -> IDR (untung terealisasi) ----------
r = prevt(I_USD, I_IDR, 400, 6500000, "2026-11-15"); d = js(r)["data"]
cek("preview USD->IDR: keluar 6.400.000 (biaya rata-rata), masuk 6.500.000, untung 100.000",
    d["can_post"] and D(d["value_out_idr"]) == D("6400000") and D(d["value_in_idr"]) == D("6500000") and D(d["fx_difference"]) == D("100000") and d["effect"] == "gain", d)
user["role"] = "tahap_3"
cek("Supervisor boleh preview", prevt(I_USD, I_IDR, 400, 6500000, "2026-11-15").status_code == 200)
cek("Supervisor tidak boleh posting transfer (403)", transfer(I_USD, I_IDR, 400, 6500000, "2026-11-15").status_code == 403)
user["role"] = "tahap_4"
r = transfer(I_USD, I_IDR, 400, 6500000, "2026-11-15"); d = js(r)["data"]
cek("posting transfer 1 -> FXT-2611-0001", r.status_code == 200 and d["transfer"]["transfer_no"] == "FXT-2611-0001", r.text[:300])
cek("GL 1100 +6.500.000 ; 1110 jadi 9.440.000 ; 7100 kredit 1.100.000 (1jt pelunasan invoice + 100rb transfer)",
    saldo_gl(date(2026, 11, 30), "1100") == D("6500000") and saldo_gl(date(2026, 11, 30), "1110") == D("9440000")
    and saldo_gl(date(2026, 11, 30), "7100") == D("-1100000"))
u = akun("1110")
cek("1110 sekarang 590 USD", D(u["foreign_balance"]) == 590 and D(u["carrying_idr"]) == D("9440000"), u)

# ---------- 5. Transfer IDR -> USD (spread = rugi) ----------
r = transfer(I_IDR, I_USD, 3300000, 200, "2026-11-16"); d = js(r)["data"]
cek("IDR->USD: nilai masuk 200 x 16.000 (kurs master 10 Nov) = 3.200.000, rugi 100.000",
    r.status_code == 200 and D(d["value_in_idr"]) == D("3200000") and D(d["fx_difference"]) == D("-100000") and d["effect"] == "loss" and d["rate_in"] == 16000.0, r.text[:300])
u = akun("1110")
cek("1110: 790 USD, 12.640.000", D(u["foreign_balance"]) == 790 and D(u["carrying_idr"]) == D("12640000"), u)
cek("GL 8100 debit 100.000", saldo_gl(date(2026, 11, 30), "8100") == D("100000"))
r = prevt(I_IDR, I_USD, 3300000, 200, "2026-11-16", rate_in=16500); d = js(r)["data"]
cek("kurs penilaian manual 16.500 dipakai", D(d["value_in_idr"]) == D("3300000") and D(d["fx_difference"]) == 0 and d["journal"] and len(d["journal"]) == 2, d)

# ---------- 6. Transfer USD -> USD rekening lain, USD -> EUR ----------
r = transfer(I_USD, I_USD2, 100, 100, "2026-11-17"); d = js(r)["data"]
cek("USD->USD: nilai dibawa utuh 1.600.000, tanpa untung/rugi", r.status_code == 200 and D(d["value_out_idr"]) == D("1600000") and D(d["fx_difference"]) == 0 and len(d["journal"]) == 2, r.text[:300])
tr_usd2 = d["transfer"]["id"]
cek("USD->USD nominal beda ditolak", prevt(I_USD, I_USD2, 100, 90, "2026-11-17").json()["data"]["code"] == "AMOUNT_MISMATCH")
cek("saldo tidak cukup ditolak", prevt(I_USD, I_IDR, 10000, 1, "2026-11-18").json()["data"]["code"] == "INSUFFICIENT_BALANCE")
cek("kedua rekening IDR ditolak", prevt(I_IDR, I_IDR, 1, 1, "2026-11-18").status_code in (200, 400)
    and prevt(I_IDR, I_IDR, 1, 1, "2026-11-18").json()["data"]["can_post"] is False)
cek("tanggal sebelum tracking_start ditolak", prevt(I_USD, I_IDR, 1, 16000, "2026-10-15").json()["data"]["code"] == "BEFORE_TRACKING_START")
r = transfer(I_USD2, I_EUR, 50, 45, "2026-11-18"); d = js(r)["data"]
cek("USD->EUR: keluar 800.000, masuk 45 x 17.000 = 765.000, rugi 35.000",
    r.status_code == 200 and D(d["value_out_idr"]) == D("800000") and D(d["value_in_idr"]) == D("765000") and D(d["fx_difference"]) == D("-35000"), r.text[:300])
tr_eur = d["transfer"]["id"]
u1, u2, u3 = akun("1110"), akun("1112"), akun("1115")
cek("posisi: 1110 690 USD/11.040.000 ; 1112 50 USD/800.000 ; 1115 45 EUR/765.000",
    (D(u1["foreign_balance"]), D(u1["carrying_idr"])) == (690, D("11040000")) and (D(u2["foreign_balance"]), D(u2["carrying_idr"])) == (50, D("800000"))
    and (D(u3["foreign_balance"]), D(u3["carrying_idr"])) == (45, D("765000")), (u1, u2, u3))

# ---------- 7. Jurnal manual di akun valas tanpa nominal valas ----------
s = dbc.SessionLocal()
je = fb.tulis_jurnal(s, cid, user, source_type="Manual", je_number="MJ-FB-1", tgl=date(2026, 11, 20), description="manual", reference="MJ-FB-1",
                     baris=[dict(account_code="1112", account_name="Bank Mandiri USD", debit=Decimal(1000), credit=Decimal(0), description=""),
                            dict(account_code="6100", account_name="Beban Umum", debit=Decimal(0), credit=Decimal(1000), description="")],
                     log="test")
s.commit(); je_id = je.id; s.close()
d = js(cl.post(f"{FV}/preview", json=dict(client_id=cid, as_of="2026-11-30")))["data"]
cek("jurnal manual di akun valas menahan revaluasi", d["can_run"] is False and any("without a USD amount" in m for m in d["issues"]), d["issues"])
s = dbc.SessionLocal()
from datetime import datetime
j = s.get(dbc.JournalEntryDraft, je_id); j.deleted_at = datetime.now()
for l in s.query(dbc.JournalEntryDraftLine).filter_by(draft_id=je_id).all(): l.deleted_at = datetime.now()
s.commit(); s.close()

# ---------- 8. Revaluasi 30 Nov: hanya rekening valas ----------
d = js(cl.post(f"{FV}/preview", json=dict(client_id=cid, as_of="2026-11-30")))["data"]
cek("preview: 3 rekening valas, tanpa masalah, can_run", d["can_run"] is True and d["totals"]["document_count"] == 3 and all(x["type"] == "bank" for x in d["documents"]), d["issues"])
cek("untung 170.500 (1110 138.000 + 1112 10.000 + 1115 22.500), rugi 0", D(d["totals"]["gain"]) == D("170500") and D(d["totals"]["loss"]) == 0, d["totals"])
b1 = next(x for x in d["documents"] if x["no"] == "1110")
cek("1110: 690 USD, tercatat 11.040.000 -> 690 x 16.200 = 11.178.000", D(b1["revalued_idr"]) == D("11178000") and D(b1["difference"]) == D("138000") and D(b1["carried_idr"]) == D("11040000"), b1)
j = d["journal"]
cek("jurnal: Dr 3 rekening + Cr 7200 170.500, seimbang", len(j) == 4 and sum(D(x["debit"]) for x in j) == sum(D(x["credit"]) for x in j) == D("170500"), j)
r = cl.post(f"{FV}/run", json=dict(client_id=cid, as_of="2026-11-30", notes="Closing Nov")); dd = js(r)
cek("run Nov 200", r.status_code == 200, r.text[:400])
run1 = dd["data"]["run"]
cek("GL 30 Nov: 1110 = 11.178.000 ; 1 Des kembali 11.040.000 (jurnal pembalik)",
    saldo_gl(date(2026, 11, 30), "1110") == D("11178000") and saldo_gl(date(2026, 12, 1), "1110") == D("11040000"),
    (saldo_gl(date(2026, 11, 30), "1110"), saldo_gl(date(2026, 12, 1), "1110")))
u1 = akun("1110", "2026-11-30")
cek("nilai buku dasar mengabaikan jurnal revaluasi (tetap 11.040.000)", D(u1["carrying_idr"]) == D("11040000") and D(u1["foreign_balance"]) == 690, u1)

# ---------- 9. Pembalikan transfer ----------
r = cl.post(f"{FB}/transfers/{tr_usd2}/reverse", json=dict(client_id=cid, reversal_date="2026-12-02"))
cek("balik transfer USD->USD ditolak: saldo tujuan (50) < 100", r.status_code == 409, r.text[:300])
r = cl.post(f"{FB}/transfers/{tr_eur}/reverse", json=dict(client_id=cid, reversal_date="2026-12-02", reason="salah rekening")); d = js(r)["data"]
cek("balik transfer USD->EUR 200", r.status_code == 200 and d["status"] == "reversed" and d["reversal_date"] == "2026-12-02", r.text[:300])
cek("balik ulang -> 409", cl.post(f"{FB}/transfers/{tr_eur}/reverse", json=dict(client_id=cid)).status_code == 409)
u2, u3 = akun("1112", "2026-12-31"), akun("1115", "2026-12-31")
cek("setelah dibalik: 1112 100 USD/1.600.000 ; 1115 0 EUR/0",
    (D(u2["foreign_balance"]), D(u2["carrying_idr"])) == (100, D("1600000")) and (D(u3["foreign_balance"]), D(u3["carrying_idr"])) == (0, 0), (u2, u3))
u3_nov = akun("1115", "2026-12-01")
cek("sebelum tanggal pembalik (1 Des) transfer masih dihitung: 1115 45 EUR", D(u3_nov["foreign_balance"]) == 45, u3_nov)
cek("GL 7100/8100 setelah pembalikan: rugi 35.000 hilang dari 8100 (tinggal 100.000)", saldo_gl(date(2026, 12, 31), "8100") == D("100000"), saldo_gl(date(2026, 12, 31), "8100"))

# ---------- 10. Revaluasi Des (tidak berantai dari Nov) ----------
d = js(cl.post(f"{FV}/preview", json=dict(client_id=cid, as_of="2026-12-31", rates={"USD": 16400, "EUR": 17600})))["data"]
cek("Des: 2 rekening (1115 saldo 0 tidak ikut)", d["totals"]["document_count"] == 2 and sorted(x["no"] for x in d["documents"]) == ["1110", "1112"], [x["no"] for x in d["documents"]])
cek("Des: untung 276.000 + 40.000 = 316.000 (revaluasi Nov tidak ikut berantai)", D(d["totals"]["gain"]) == D("316000") and D(d["totals"]["loss"]) == 0, d["totals"])

# ---------- 11. Lepas penanda & ganti mata uang ----------
cek("ganti mata uang rekening yang punya transfer -> 409", set_akun(I_USD, "EUR").status_code == 409)
r = cl.delete(f"{FB}/accounts/{I_USD}", params=dict(client_id=cid))
cek("lepas penanda rekening yang punya transfer aktif -> 409", r.status_code == 409, r.text[:200])
r = cl.delete(f"{FB}/accounts/{I_EUR}", params=dict(client_id=cid))
cek("lepas penanda EUR (transfer sudah dibalik) 200", r.status_code == 200, r.text[:200])
r = cl.get(f"{FB}/transfers", params=dict(client_id=cid)); lst = js(r)["data"]
cek("riwayat transfer: 4 (3 posted, 1 reversed)", len(lst) == 4 and sorted(x["status"] for x in lst) == ["posted"] * 3 + ["reversed"], [x["status"] for x in lst])

print("\nGAGAL:", GAGAL if GAGAL else "tidak ada")
sys.exit(1 if GAGAL else 0)
