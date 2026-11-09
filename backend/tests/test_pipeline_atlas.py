import sys, types, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from datetime import date, timedelta

dbc = types.ModuleType('db_client'); dbc.engine = None
dbc.akun_default_sales = lambda *a, **k: None
sys.modules['db_client'] = dbc
import atlas_audit_sales as A
import neo_wa_pipeline as P

# ---- fake engine: semua query kosong ----
class R:
    def mappings(self): return self
    def all(self): return []
    def first(self): return None
    def scalar(self): return None
class Conn:
    def __init__(self, log): self.log = log
    def execute(self, q, params=None):
        self.log.append((str(q), params)); return R()
class Ctx:
    def __init__(self, log): self.log = log
    def __enter__(self): return Conn(self.log)
    def __exit__(self, *a): return False
class Eng:
    def __init__(self): self.log = []
    def begin(self): return Ctx(self.log)
eng = Eng(); dbc.engine = eng; P.dbc.engine = eng

klien = {"id": "11111111-1111-1111-1111-111111111111", "client_code": "T"}

# 1) catat_penahanan: user id bukan UUID -> tidak error, created_by None
t = [{"invoice_id": "22222222-2222-2222-2222-222222222222", "invoice_no": "N1", "kode": "nilai_nol", "tingkat": "blokir", "pesan": "nilai nol"}]
assert A.catat_penahanan(klien, {"id": 0, "nama": "dev"}, t, False, ["x"]) is True
ins = [p for q, p in eng.log if "ATLAS_HOLD" in q][0]
assert ins[0]["u"] is None and ins[0]["p"].startswith("Atlas")
print("1 catat_penahanan id non-UUID ok")

# 2) catat_penahanan gagal -> False, tidak melempar
class Boom(Eng):
    def begin(self): raise RuntimeError("db mati")
A.dbc.engine = Boom()
assert A.catat_penahanan(klien, {"id": None}, t, False, ["x"]) is False
A.dbc.engine = eng
print("2 catat_penahanan gagal -> False ok")

# 3) FAIL-CLOSED: analisa error -> tak ada invoice diposting
daftar = [{"id": f"i{n}", "invoice_no": f"N{n}", "posting_status": "Draft"} for n in range(7)]
class R2(R):
    def all(self): return daftar
class Conn2(Conn):
    def execute(self, q, params=None):
        self.log.append((str(q), params)); return R2()
class Ctx2(Ctx):
    def __enter__(self): return Conn2(self.log)
class Eng2(Eng):
    def begin(self): return Ctx2(self.log)
e2 = Eng2(); P.dbc.engine = e2; A.dbc.engine = e2

def boom(*a, **k): raise RuntimeError("audit rusak")
A.analisa = boom
dipanggil = {"cepat": 0, "lama": 0}
def cepat(user, klien_, dft, hasil, wa_id):
    dipanggil["cepat"] = len(dft); return 0, 0, {}, dft
P._posting_cepat = cepat
P.dbc.pastikan_mapping_sales = lambda *a, **k: dipanggil.__setitem__("lama", dipanggil["lama"] + 1)
P.dbc.validasi_posting_sales = lambda *a, **k: []
P.dbc.update_sales_invoice = lambda *a, **k: {"ok": 1}
P.dbc.create_sales_activity_log = lambda *a, **k: None
catat = []
P._catat = lambda wa_id, status, hasil, selesai=False: catat.append((status, dict(hasil)))
hasil = {"baris_terbaca": 7, "buat_transaksi": {}}
P._posting(1, {"id": "u"}, klien, "sf1", hasil)
assert dipanggil == {"cepat": 0, "lama": 0}, dipanggil
assert hasil["tidak_diposting"] == 7 and hasil["diposting"] == 0
assert hasil["atlas"]["error"] and hasil["atlas"]["gagal_periksa"]
status, rinci = catat[-1]
assert status == "selesai_sebagian"
kode, kal = P._ringkas_hasil(status, rinci, "sales", "T")
assert kode == "sebagian" and "gagal memeriksa" in kal and "7 invoice" in kal, kal
print("3 fail-closed ok ->", kal)

# 4) laporan 'selesai' tanpa kunci atlas: tidak mengklaim bersih
_, k2 = P._ringkas_hasil("selesai", {"diposting": 3}, "sales", "T")
assert "tidak menemukan kejanggalan" not in k2, k2
_, k3 = P._ringkas_hasil("selesai", {"diposting": 3, "atlas": {"ditahan": 0, "total": 3, "jurnal_seimbang": True}}, "sales", "T")
assert "tidak menemukan kejanggalan" in k3, k3
_, k4 = P._ringkas_hasil("selesai", {"diposting": 0, "atlas": {"error": "x", "ditahan": 3, "total": 3}}, "sales", "T")
assert "tidak menemukan" not in k4 and "gagal memeriksa" in k4
print("4 kalimat laporan jujur ok")

# 5) jalur normal: 8 invoice, 2 ditahan -> hanya 6 yang dikirim ke posting
del A.analisa
import importlib; A = importlib.reload(A); A.dbc.engine = e2
def analisa_palsu(klien_, ids, sf, hb, br):
    tahan = {ids[0], ids[1]}
    temuan = [{"invoice_id": ids[0], "invoice_no": "N0", "kode": "nilai_nol", "tingkat": "blokir", "pesan": "nilai nol"},
              {"invoice_id": ids[1], "invoice_no": "N1", "kode": "tanggal_masa_depan", "tingkat": "blokir", "pesan": "tgl"}]
    return {"temuan": temuan, "catatan": [], "tahan": tahan,
            "putusan": {"tahan_semua": False, "ditahan": tahan, "ringkas": [{"kode": "nilai_nol", "jumlah": 1}, {"kode": "tanggal_masa_depan", "jumlah": 1}]},
            "hasil_atlas": {"total": len(ids), "ditahan": 2, "tahan_semua": False, "ringkas": [{"kode": "nilai_nol", "jumlah": 1}, {"kode": "tanggal_masa_depan", "jumlah": 1}], "catatan_kode": [], "catatan_file": []}}
import atlas_audit_sales
atlas_audit_sales.analisa = analisa_palsu
atlas_audit_sales.catat_penahanan = lambda *a, **k: True
atlas_audit_sales.tambah_jurnal = lambda *a, **k: None
daftar[:] = [{"id": f"j{n}", "invoice_no": f"N{n}", "posting_status": "Draft"} for n in range(8)]
dipanggil["cepat"] = -1
P._posting_cepat = lambda user, k_, dft, h, w: (dipanggil.__setitem__("cepat", len(dft)) or (len(dft), 0, {}, []))
hasil = {"baris_terbaca": 8, "buat_transaksi": {}}
P._posting(2, {"id": "u"}, klien, "sf2", hasil)
assert dipanggil["cepat"] == 6, dipanggil
assert hasil["tidak_diposting"] == 2 and hasil["diposting"] == 6
status, rinci = catat[-1]
kode, kal = P._ringkas_hasil(status, rinci, "sales", "T")
assert "menaruh 2 invoice di Draft Sales" in kal, kal
print("5 jalur normal ok ->", kal)
print("SEMUA LULUS")
