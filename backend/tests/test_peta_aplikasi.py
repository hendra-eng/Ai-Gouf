"""
Tes peta aplikasi Zake. Menjaga supaya peta TIDAK basi:
  - setiap page.tsx di frontend harus ada di data/peta_aplikasi.json
  - menu sidebar tercatat lengkap
  - pemilih halaman & penyusun prompt bekerja
Kalau tes pertama gagal -> jalankan: python scripts/buat_peta_aplikasi.py
Tes yang butuh folder `src/` frontend otomatis dilewati kalau folder itu tidak ada di mesin ini.
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
SRC = BACKEND.parent / "src"
PETA = BACKEND / "data" / "peta_aplikasi.json"

_spec = importlib.util.spec_from_file_location("peta_aplikasi_rt", BACKEND / "modules" / "peta_aplikasi.py")
pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pa)


@pytest.fixture(scope="module")
def d():
    assert PETA.exists(), "peta belum dibuat: python scripts/buat_peta_aplikasi.py"
    return json.loads(PETA.read_text(encoding="utf-8"))


def _rute(p: Path) -> str:
    bag = [x for x in p.parent.relative_to(SRC / "app").parts if not (x.startswith("(") and x.endswith(")"))]
    bag = [":" + x[1:-1] if x.startswith("[") and x.endswith("]") else x for x in bag]
    return "/" + "/".join(bag)


@pytest.mark.skipif(not (SRC / "app").is_dir(), reason="folder src/ frontend tidak ada")
def test_semua_halaman_frontend_ada_di_peta(d):
    ada = {_rute(p) for p in (SRC / "app").rglob("page.tsx")}
    peta = {h["rute"] for h in d["halaman"]}
    assert ada == peta, f"Peta basi. Hilang: {sorted(ada - peta)} | Kelebihan: {sorted(peta - ada)}"
    assert d["ringkas"]["jumlah_halaman"] == len(ada)


@pytest.mark.skipif(not (SRC / "components" / "Sidebar.tsx").exists(), reason="Sidebar.tsx tidak ada")
def test_menu_sidebar_lengkap(d):
    s = (SRC / "components" / "Sidebar.tsx").read_text(encoding="utf-8", errors="ignore")
    href = set(re.findall(r"id:\s*'nav-[\w-]+'.*?href:\s*'([^']+)'", s))
    assert href <= {m["href"] for m in d["menu"]}


def test_halaman_aktif_dinamis_dikenali(d):
    assert pa.cocokkan_rute(d, "/coa/123/edit") == "/coa/:id/edit"
    assert pa.cocokkan_rute(d, "/transactions/sales?tab=x") == "/transactions/sales"


@pytest.mark.parametrize("tanya,harus_ada", [
    ("apa saja tombol di halaman penjualan?", "/transactions/sales"),
    ("cara posting jurnal kas bank", "/transactions/bank-cash"),
    ("dimana saya lihat piutang jatuh tempo", "/accounts-receivable"),
    ("tombol untuk tutup buku akhir tahun", "/year-end-closing"),
])
def test_pemilih_halaman(d, tanya, harus_ada):
    rute = [h["rute"] for h in pa.pilih_halaman(d, tanya)]
    assert any(r.startswith(harus_ada) for r in rute), rute


def test_halaman_aktif_selalu_ikut(d):
    rute = [h["rute"] for h in pa.pilih_halaman(d, "tombol apa saja di sini?", "/assets")]
    assert "/assets" in rute


def test_konteks_memuat_jumlah_halaman_dan_detail():
    statis, dinamis = pa.bangun_konteks("tombol di halaman sales apa saja", "/transactions/sales")
    n = json.loads(PETA.read_text(encoding="utf-8"))["ringkas"]["jumlah_halaman"]
    assert f"Total halaman (URL): {n}" in statis
    assert "/transactions/sales" in dinamis and "Tombol/aksi" in dinamis
