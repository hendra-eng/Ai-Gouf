"""
tests/test_auth_v1.py
======================
Test untuk fitur Auth REST API standar (/api/v1/auth/...) --
modules/auth_v1.py & modules/api_response.py.

Endpoint di-test lewat TestClient dengan APLIKASI MINI terpisah (bukan
import main.py) supaya tidak perlu menarik seluruh dependency berat
main.py (pandas/openpyxl/APScheduler/dst) cuma untuk menguji fitur auth
ini saja.
"""

import json
import os

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-cukup-panjang-untuk-pengujian")
os.environ.setdefault("ALLOW_ANONYMOUS_DEV", "false")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from modules import auth
from modules.auth import v1 as auth_v1
from modules.api_response import gagal, sukses


def _buat_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(BaseHTTPMiddleware, dispatch=auth_v1.jwt_v1_middleware)
    app.include_router(auth_v1.router)
    return app


class TestApiResponseEnvelope:
    def test_sukses_bentuk_amplop(self):
        r = sukses(data={"x": 1}, message="ok")
        body = json.loads(r.body)
        assert r.status_code == 200
        assert body == {"status": "success", "message": "ok", "data": {"x": 1}, "errors": None}

    def test_gagal_bentuk_amplop(self):
        r = gagal(message="salah", errors={"field": "username"}, status_code=409)
        body = json.loads(r.body)
        assert r.status_code == 409
        assert body["status"] == "error"
        assert body["data"] is None
        assert body["errors"] == {"field": "username"}


class TestMiddlewareGerbangV1:
    """jwt_v1_middleware harus menjaga SELURUH grup /api/v1/**, kecuali /login."""

    def test_me_tanpa_token_ditolak_401(self):
        client = TestClient(_buat_app())
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 401
        assert res.json()["status"] == "error"

    def test_me_dengan_token_tidak_valid_ditolak_401(self):
        client = TestClient(_buat_app())
        res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer token-ngasal"})
        assert res.status_code == 401

    def test_me_dengan_token_valid_berhasil(self):
        token = auth.buat_token({"id": 1, "username": "budi", "role": "tahap_5", "nama": "Budi"})
        client = TestClient(_buat_app())
        res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "success"
        assert body["data"]["username"] == "budi"
        assert body["data"]["role"] == "tahap_5"

    def test_login_tidak_butuh_token_tapi_gagal_kalau_password_salah(self):
        client = TestClient(_buat_app())
        res = client.post("/api/v1/auth/login", json={"username": "admin", "password": "salah_pasti"})
        assert res.status_code == 401
        assert res.json()["status"] == "error"

    def test_register_ditolak_tanpa_token(self):
        client = TestClient(_buat_app())
        res = client.post(
            "/api/v1/auth/register",
            json={"username": "staf_baru", "password": "password123"},
        )
        assert res.status_code == 401

    def test_register_ditolak_kalau_bukan_tahap_5(self):
        token = auth.buat_token({"id": 2, "username": "junior", "role": "tahap_1", "nama": "Junior"})
        client = TestClient(_buat_app())
        res = client.post(
            "/api/v1/auth/register",
            json={"username": "staf_baru", "password": "password123"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403

    def test_register_super_admin_lolos_require_level_5(self):
        """super_admin (role_level sentinel 999) harus otomatis lolos
        Depends(auth.require_level(5)) -- lanjut ke validasi role di dalam
        register() (yang berikutnya gagal di username duplikat/DB, bukan
        403 di gerbang require_level)."""
        token = auth.buat_token({"id": 99, "username": "root", "role": "super_admin", "nama": "Root"})
        client = TestClient(_buat_app())
        res = client.post(
            "/api/v1/auth/register",
            json={"username": "staf_baru", "password": "password123", "role": "tahap_1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code != 403

    def test_register_role_super_admin_ditolak_kalau_pemanggil_bukan_super_admin(self):
        """tahap_5 (Partner) TIDAK boleh membuat akun super_admin baru --
        cuma super_admin yang sudah ada yang boleh."""
        token = auth.buat_token({"id": 5, "username": "partner", "role": "tahap_5", "nama": "Partner"})
        client = TestClient(_buat_app())
        res = client.post(
            "/api/v1/auth/register",
            json={"username": "root_baru", "password": "password123", "role": "super_admin"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403
        assert res.json()["errors"]["code"] == "FORBIDDEN_SUPER_ADMIN"

    def test_register_role_tidak_dikenal_ditolak_422(self):
        token = auth.buat_token({"id": 5, "username": "partner", "role": "tahap_5", "nama": "Partner"})
        client = TestClient(_buat_app())
        res = client.post(
            "/api/v1/auth/register",
            json={"username": "staf_baru", "password": "password123", "role": "client_lv_1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422
        assert "super_admin" in res.json()["errors"]["role_valid"]

    def test_daftar_roles_butuh_login(self):
        client = TestClient(_buat_app())
        res = client.get("/api/v1/auth/roles")
        assert res.status_code == 401

    def test_daftar_roles_berisi_katalog_rbac(self):
        token = auth.buat_token({"id": 1, "username": "budi", "role": "tahap_1", "nama": "Budi"})
        client = TestClient(_buat_app())
        res = client.get("/api/v1/auth/roles", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()["data"]
        assert {"code": "tahap_5", "level": 5, "label": "Partner / Direktur (Akses Penuh)"} in data["internal"]
        assert {"code": "client_lv_1", "level": 1, "key": "org_owner", "label": "Org Owner"} in data["client"]
        assert {"code": "client_lv_9", "level": 9, "key": "viewer", "label": "Viewer"} in data["client"]
        assert data["super_admin"] == {"code": "super_admin", "label": "Super Admin"}


class TestRbacCatalog:
    """Unit test murni untuk katalog RBAC.md di modules/auth/core.py --
    tidak butuh DB/HTTP sama sekali."""

    def test_role_level_super_admin_di_atas_tahap_5(self):
        assert auth.role_level("super_admin") > auth.role_level("tahap_5")

    def test_role_label_super_admin(self):
        assert auth.role_label("super_admin") == "Super Admin"

    def test_client_role_level_urutan_sesuai_rbac_md(self):
        assert auth.client_role_level("client_lv_1") == 1
        assert auth.client_role_level("client_lv_9") == 9
        assert auth.client_role_level("client_lv_1") < auth.client_role_level("client_lv_9")

    def test_client_role_level_kode_tidak_dikenal(self):
        assert auth.client_role_level("bukan_role") is None
        # "org_owner" cuma nama deskriptif (lihat komentar CLIENT_LEVELS di
        # core.py), BUKAN kode yang divalidasi -- kodenya "client_lv_1".
        assert auth.client_role_level("org_owner") is None

    def test_client_role_label(self):
        assert auth.client_role_label("client_lv_3") == "Finance Manager"
        assert auth.client_role_label(None) == "-"

    def test_require_roles_meloloskan_super_admin_walau_tidak_ada_di_daftar(self):
        # require_roles(["tahap_5"]) normalnya menolak role lain PERSIS --
        # super_admin harus tetap lolos (bypass eksplisit di dalamnya).
        # Dipanggil manual (bukan lewat FastAPI/Depends) dengan user literal.
        user = {"id": 1, "username": "root", "role": "super_admin"}
        dep = auth.require_roles(["tahap_5"])
        assert dep(user=user) == user
