"""ATURAN MUTLAK: upload file halaman Sales SELALU dikerjakan Atlas, siapa pun yang diminta (Neo, Zeno, atau tanpa nama).
Agen lain tidak ditolak, pekerjaannya diserahkan ke Atlas. Halaman lain tidak berubah. Jalankan: python tests/test_upload_sales_atlas.py"""
import sys, types, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

dbc = types.ModuleType('db_client'); dbc.engine = None
sys.modules['db_client'] = dbc

# stub modul yang di-import di dalam mulai()
auth_core = types.ModuleType('modules.auth.core'); auth_core.role_level = lambda r: 99
auth_pkg = types.ModuleType('modules.auth'); auth_pkg.core = auth_core
modules_pkg = types.ModuleType('modules'); modules_pkg.auth = auth_pkg
sys.modules.update({'modules': modules_pkg, 'modules.auth': auth_pkg, 'modules.auth.core': auth_core})
kt = types.ModuleType('kantor_tugas_route')
kt.mulai_tugas_wa = lambda pemilik, agen, meja, ket: {"ok": True, "id": "t1"}
kt.batalkan_tugas_wa = lambda pemilik, tid: None
sys.modules['kantor_tugas_route'] = kt
mem = types.ModuleType('memori_ai'); mem.pemilik_dari_user = lambda u: "pemilik"
sys.modules['memori_ai'] = mem

import neo_wa_pipeline as P

dipakai = []
def palsu(user, klien, pemilik, nama, halaman, agen=None, tugas_id=None, pemilik_kantor=None):
    dipakai.append((halaman, agen)); return {"status": "dimulai"}
P._mulai_inti = palsu

user = {"id": "u1", "role": "partner"}; klien = {"id": "c1", "client_code": "T"}

def jalankan(halaman, agen):
    dipakai.clear()
    hasil = P.mulai(user, klien, "pemilik", None, halaman=halaman, agen=agen)
    return hasil, (dipakai[0][1] if dipakai else None)

# 1) Sales diminta ke Neo/Zeno/tanpa nama -> TIDAK ditolak, dikerjakan Atlas
for diminta in ("Neo", "Zeno", None, "Atlas"):
    hasil, pelaksana = jalankan("sales", diminta)
    assert "error" not in hasil, f"Sales + {diminta} ditolak: {hasil}"
    assert pelaksana == "Atlas", f"Sales + {diminta} dikerjakan {pelaksana}, harusnya Atlas"
    print(f"1 Sales diminta ke {diminta or 'tanpa nama'} -> dikerjakan Atlas ok")

# 2) Halaman lain tidak berubah: tetap agen yang diminta
for halaman in ("purchase", "journal_entry", "other"):
    hasil, pelaksana = jalankan(halaman, "Neo")
    assert "error" not in hasil and pelaksana == "Neo", (halaman, hasil, pelaksana)
print("2 halaman lain tetap dikerjakan agen yang diminta ok")

print("SEMUA LULUS")