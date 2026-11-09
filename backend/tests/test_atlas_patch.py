import sys, types
from datetime import date, timedelta
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
dbc = types.ModuleType('db_client'); dbc.engine = None; dbc.akun_default_sales = lambda *a, **k: None
sys.modules['db_client'] = dbc
import atlas_audit_sales as A

# stub query DB
A._tanggal_kunci = lambda k: None
A._dobel_sudah_posted = lambda k, ids: {}
A._periksa_klasifikasi = lambda k, inv: []
A._customer_harian_banyak = lambda k: set()
klien = {"id": "c1", "client_code": "T"}
hari = date.today() - timedelta(days=10)

def inv(i, cust, gross, rate, tgl=hari):
    dpp = round(gross / (1 + rate), 2); ppn = round(gross - dpp, 2)
    return {"id": f"i{i}", "invoice_no": f"N{i:04d}", "invoice_date": tgl, "due_date": tgl, "customer_name": cust,
            "customer_npwp": "", "cabang": None, "dpp": dpp, "ppn": ppn, "pph": 0, "gross": gross}

def kodes(t, kode): return [x for x in t if x["kode"] == kode]

# riwayat klien: 60 invoice Posted ber-pajak ~10%
riw = [{"c": "x", "g": 110000.0, "p": 10000.0, "d": hari} for _ in range(60)]

# 1) POS: 20 struk, nilai kembar, pajak 10%
pos = [inv(i, "Penjualan POS - PLAZA MARIETTA", 100000.0 if i % 2 else 70000.0, 0.10) for i in range(20)]
t = A.periksa_invoice(klien, [x["id"] for x in pos], _invoices=pos, _riwayat_data=riw)
assert not kodes(t, "dobel_dalam_file"), "POS tidak boleh dobel"
assert not kodes(t, "tarif_ppn_janggal"), "tarif 10% lazim klien"
print("1 POS ok")

# 2) customer bernama biasa dobel -> tetap ditandai
nm = [inv(1, "PT Maju Jaya", 5_000_000.0, 0.11), inv(2, "PT Maju Jaya", 5_000_000.0, 0.11)]
t = A.periksa_invoice(klien, ["i1", "i2"], _invoices=nm, _riwayat_data=riw)
assert len(kodes(t, "dobel_dalam_file")) == 1
print("2 dobel customer bernama tetap terdeteksi ok")

# 3) generik via kebiasaan data (nama tak berawalan, 6 struk sehari)
gen = [inv(i, "Toko Ceria", 50000.0, 0.11) for i in range(6)]
t = A.periksa_invoice(klien, [x["id"] for x in gen], _invoices=gen, _riwayat_data=riw)
assert not kodes(t, "dobel_dalam_file")
print("3 generik berbasis kebiasaan ok")

# 4) tarif 10% tanpa riwayat -> tetap janggal
one = [inv(1, "PT Baru", 1_100_000.0, 0.10)]
t = A.periksa_invoice(klien, ["i1"], _invoices=one, _riwayat_data=[])
assert kodes(t, "tarif_ppn_janggal")
print("4 tarif 10% tanpa riwayat ditandai ok")

# 5) tarif aneh 20% walau ada riwayat 10% -> janggal
ane = [inv(1, "PT Baru", 1_200_000.0, 0.20)]
t = A.periksa_invoice(klien, ["i1"], _invoices=ane, _riwayat_data=riw)
assert kodes(t, "tarif_ppn_janggal")
print("5 tarif 20% tetap ditandai ok")

# 6) tarif 9.52% (POS) dengan riwayat 10%
r952 = [inv(1, "PT X", 109520.0, 0.0952)]
t = A.periksa_invoice(klien, ["i1"], _invoices=r952, _riwayat_data=riw)
assert not kodes(t, "tarif_ppn_janggal")
print("6 tarif 9.52% lazim ok")
print("SEMUA TES LULUS")
