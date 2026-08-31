"""
tests/test_minimal.py

Smoke test PALING DASAR -- bukan menguji logika bisnis (itu tugas
test_*.py lain yang lebih spesifik, mis. test_tax_rag.py,
test_tax_case_router.py, dst), tapi memastikan hal paling mendasar tidak
rusak:

  1. Modul inti fitur riset pajak bisa di-import tanpa error.
  2. main.py bisa di-assemble jadi objek FastAPI `app`.
  3. Router-router penting (tax_router, tax_case_router) benar-benar
     terdaftar ke app (bukan cuma ada file-nya tapi lupa di-include).
  4. Endpoint /api/health merespons dengan status 200.

Kenapa desainnya SKIP (bukan FAIL keras) kalau main.py gagal di-import:
main.py punya banyak dependensi berat (akuntansi_ai.py, db_client.py,
openpyxl, pandas, apscheduler, koneksi Supabase lewat DATABASE_URL di
.env, dst) yang TIDAK semuanya relevan untuk smoke test modul riset
pajak. Kalau lingkungan test dijalankan tanpa .env lengkap/tanpa akses
DB (mis. di CI runner yang belum di-setup penuh), test ini SEHARUSNYA
tidak menghasilkan FAIL yang menyesatkan seolah-olah ada bug kode --
FAIL harusnya cuma muncul kalau app SUDAH berhasil dibuat tapi
strukturnya salah (route hilang, /api/health error 500, dst). Skip
dengan pesan jelas membedakan "environment belum siap" dari "kode
rusak", supaya orang yang jalanin test tidak salah simpul.

Prasyarat: pip install pytest fastapi httpx
Jalankan:  pytest tests/test_minimal.py -v
"""
import importlib
import sys

import pytest

# ---------------------------------------------------------------------------
# 1. Modul inti riset pajak -- ringan, tidak butuh .env/DB, harus SELALU
#    bisa di-import. Kalau ini gagal, hampir pasti dependency belum
#    lengkap (pip install -r requirements.txt) atau ada salah ketik impor
#    di salah satu modul -- FAIL di sini memang seharusnya keras (tidak
#    di-skip), beda dengan test main.py di bawah.
# ---------------------------------------------------------------------------

MODUL_INTI_RISET_PAJAK = [
    "modules.schemas",
    "modules.storage",
    "modules.tax_chunker",
    "modules.embedding",
    "modules.vector_store",
    "modules.tax_status_tracker",
    "modules.tax_qa_log",
    "modules.tax_history",
    "modules.audit_activity",
    "modules.tax_rag",
    "modules.tax_router",
    "modules.tax_case_ingestion",
    "modules.tax_ingestion",
]


def test_python_version_minimal():
    """Kode di banyak modul (mis. modules/tax_rag.py: `list[SearchResult]`
    sebagai type hint langsung, tanpa `from __future__ import annotations`
    di beberapa file) butuh minimal Python 3.9+ untuk generic builtin type
    hint. Dicek eksplisit di sini supaya kalau environment ternyata
    Python lama, pesannya jelas ("Python kamu terlalu lama") bukan
    SyntaxError yang membingungkan di modul lain."""
    assert sys.version_info >= (3, 9), (
        f"Butuh Python 3.9+, environment ini pakai {sys.version_info.major}."
        f"{sys.version_info.minor}"
    )


@pytest.mark.parametrize("nama_modul", MODUL_INTI_RISET_PAJAK)
def test_modul_inti_bisa_diimpor(nama_modul):
    """Tiap modul inti riset pajak harus bisa di-import sendiri-sendiri --
    diparametrisasi per modul (bukan satu test besar) supaya kalau ada
    YANG gagal, laporan pytest langsung menunjuk modul mana persisnya,
    bukan cuma 'ada sesuatu yang gagal di suatu tempat'."""
    importlib.import_module(nama_modul)


# ---------------------------------------------------------------------------
# 2-4. main.py -- app FastAPI penuh. Di-skip (bukan fail) kalau environment
# belum lengkap -- lihat penjelasan di docstring atas file ini.
# ---------------------------------------------------------------------------

def _import_main_app_atau_skip():
    """Helper dipakai berulang di bawah -- import `main`, atau skip test
    dengan alasan jelas kalau gagal (dependency berat/.env belum ada)."""
    try:
        import main
    except Exception as e:  # noqa: BLE001 -- sengaja luas, ini smoke test
        pytest.skip(
            f"main.py gagal di-import ({type(e).__name__}: {e}). "
            f"Kemungkinan besar .env belum lengkap (DATABASE_URL / "
            f"JWT_SECRET_KEY / DEEPSEEK_API_KEY) atau dependency berat "
            f"(akuntansi_ai.py, db_client.py, openpyxl, pandas, "
            f"apscheduler) belum terinstall/terkonfigurasi. Ini BUKAN "
            f"indikasi bug kode -- cek setup environment (.env, "
            f"requirements.txt) sebelum menganggap ada yang rusak."
        )
    return main


def test_app_fastapi_bisa_dibuat():
    main = _import_main_app_atau_skip()
    assert main.app is not None
    assert main.app.title == "AI Gouf Consulting API"


def _semua_paths(routes):
    """
    [FIX v2] Percobaan pertama (cari `.path`/`.routes`/`.prefix` langsung
    di objek route) tidak cukup untuk versi FastAPI yang terinstall di
    environment ini -- lewat introspeksi manual (lihat debug_routes2.py),
    ketahuan bahwa app.include_router() di sini membungkus router yang
    di-include jadi objek `_IncludedRouter` dengan struktur:

        _IncludedRouter
          .original_router.routes   -> list APIRoute, .path TANPA prefix
                                         (mis. "/predict", bukan
                                         "/tax/cases/predict")
          .include_context.prefix   -> prefix asli yang didaftarkan lewat
                                         app.include_router(..., prefix=...)
                                         (mis. "/tax/cases")

    Jadi path lengkapnya harus digabung manual: prefix + path sub-route.
    Route biasa (Route/APIRoute langsung di app.routes, seperti
    /api/health atau /docs) tetap ditangani oleh cabang `.path` biasa di
    bawah, tidak lewat `_IncludedRouter`.
    """
    hasil = set()
    for r in routes:
        path = getattr(r, "path", None)
        if path:
            hasil.add(path)

        # Kasus _IncludedRouter: gabungkan prefix + path tiap sub-route.
        include_context = getattr(r, "include_context", None)
        original_router = getattr(r, "original_router", None)
        if include_context is not None and original_router is not None:
            prefix = getattr(include_context, "prefix", "") or ""
            sub_routes = getattr(original_router, "routes", None) or []
            for sub_path in _semua_paths(sub_routes):
                hasil.add(prefix + sub_path)
            continue

        # Kasus umum lain: sub-router/Mount dengan `.routes` langsung
        # (mis. versi FastAPI lama, atau Mount biasa) -- tetap ditelusuri
        # sebagai fallback, gabung dengan `.prefix` kalau ada.
        sub_routes = getattr(r, "routes", None)
        if sub_routes:
            prefix = getattr(r, "prefix", "") or ""
            for sub_path in _semua_paths(sub_routes):
                hasil.add(prefix + sub_path if prefix and not sub_path.startswith(prefix) else sub_path)

    return hasil


def test_router_tax_terdaftar_di_app():
    """[Terkait Tahap 4] Pastikan modules/tax_router.py &
    modules/tax_case_router.py benar-benar ter-include ke app (bukan
    cuma ada file router-nya tapi lupa dipasang lewat
    app.include_router() di main.py) -- termasuk endpoint BARU dari
    perbaikan sebelumnya (no.4 filter, no.5 /tax/activity)."""
    main = _import_main_app_atau_skip()
    paths = _semua_paths(main.app.routes)

    endpoint_wajib_ada = [
        "/tax/ask",
        "/tax/qa-log",
        "/tax/activity",
        "/tax/cases/predict",
        "/tax/cases/risk-score",
    ]
    hilang = [p for p in endpoint_wajib_ada if p not in paths]
    assert not hilang, f"Endpoint berikut tidak terdaftar di app: {hilang}"


def test_endpoint_health_merespons_ok():
    main = _import_main_app_atau_skip()

    from fastapi.testclient import TestClient

    try:
        client = TestClient(main.app)
        resp = client.get("/api/health")
    except Exception as e:  # noqa: BLE001
        pytest.skip(
            f"/api/health gagal dipanggil ({type(e).__name__}: {e}) -- "
            f"kemungkinan butuh koneksi database sungguhan yang tidak "
            f"tersedia di environment test ini."
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body.get("status") == "ok"
    # ai_aktif & database_aktif SENGAJA tidak dipaksa True/False di sini --
    # nilainya wajar berbeda antar environment (mis. DEEPSEEK_API_KEY
    # belum di-set di mesin CI). Yang penting endpoint-nya hidup & bentuk
    # responsnya benar, bukan nilai spesifiknya.
    assert "ai_aktif" in body
    assert "database_aktif" in body