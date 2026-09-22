"""
modules/auth/v1.py
===================
Fitur Auth versi REST API standar: /api/v1/auth/...

Beda dengan modules/auth/core.py (sistem lama, dipakai di ~60 endpoint
lewat Depends(auth.require_level(...)) / Depends(auth.get_current_user)):

    - Routing pakai konvensi versi: /api/[version]/[group]/[fitur]
      (mis. POST /api/v1/auth/login), bukan endpoint datar /api/login.
    - Response SELALU pakai amplop standar {status, message, data, errors}
      -- lihat modules/api_response.py -- bukan bentuk bebas per endpoint.
    - Autentikasi (cek ADA & VALID-nya token) ditegakkan di MIDDLEWARE
      (jwt_v1_middleware di bawah, dipasang di main.py lewat
      app.add_middleware(BaseHTTPMiddleware, dispatch=jwt_v1_middleware))
      untuk SELURUH path /api/v1/**, bukan cuma lewat Depends() per
      endpoint satu-satu.

SENGAJA TIDAK mengganti sistem lama (modules/auth/core.py, endpoint
POST /api/login, ataupun Depends(auth.require_level(...)) yang sudah
dipakai di puluhan endpoint main.py) -- itu di luar scope permintaan ini
dan berisiko besar (banyak pemanggil). Sebagai gantinya, endpoint di
sini SENGAJA dibuat KOMPATIBEL:

    - Token dibuat lewat auth.buat_token() & divalidasi lewat
      auth.decode_token() -- fungsi & JWT_SECRET_KEY YANG SAMA dengan
      sistem lama. Jadi 1 token hasil POST /api/v1/auth/login BISA
      dipakai juga untuk endpoint lama (mis. GET /api/client) yang masih
      pakai Depends(auth.require_level(...)).
    - Password & user tetap disimpan di tabel `users` yang sama
      (db_client.py: User, create_user(), get_user_by_username()) --
      TIDAK ada tabel/skema user kedua yang terpisah.

Jadi fitur ini adalah "pintu depan" REST API yang baru & standar untuk
auth, bukan sistem akun paralel.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from starlette.requests import Request

import db_client as dbc
from . import core as auth
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("auth_v1")

router = APIRouter(prefix="/api/v1/auth", tags=["auth-v1"])

# Path di bawah grup /api/v1/ yang boleh diakses TANPA token (dicek di
# jwt_v1_middleware). Path /api/v1/... lain WAJIB header
# "Authorization: Bearer <token>" yang valid.
PUBLIC_PATHS_V1 = {
    "/api/v1/auth/login",
}


# ============================================================
# SKEMA REQUEST
# ============================================================

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8)
    nama: Optional[str] = None
    role: str = Field(default="tahap_1")


class LoginRequest(BaseModel):
    username: str
    password: str


# ============================================================
# MIDDLEWARE -- gerbang autentikasi JWT untuk SELURUH grup /api/v1/**
# ============================================================

async def jwt_v1_middleware(request: Request, call_next):
    """
    Dipasang di main.py lewat:
        app.add_middleware(BaseHTTPMiddleware, dispatch=jwt_v1_middleware)

    Jalan untuk SETIAP request masuk, tapi HANYA menegakkan aturan untuk
    path yang diawali "/api/v1/" (grup REST API standar yang baru). Path
    lama (/api/client, /api/login, /tax/..., dst) tidak disentuh sama
    sekali -- tetap jalan seperti sebelumnya lewat mekanisme
    Depends(auth.get_current_user)/require_level masing-masing, supaya
    tidak ada perubahan perilaku di luar fitur yang diminta.

    Kalau path termasuk grup /api/v1/ dan BUKAN salah satu
    PUBLIC_PATHS_V1 (mis. login): wajib token valid, dicari dari DUA
    sumber (urutan: header dulu, baru cookie):

      1. Header "Authorization: Bearer <token>" -- dipakai pemanggil
         non-browser (mis. Swagger UI /docs, curl, script lain) yang
         memang menaruh token sendiri di header.
      2. Cookie httpOnly "gouf_session" -- dipakai browser: token ini
         DISET oleh src/app/api/session/login/route.ts (Next.js) sehabis
         POST /api/v1/auth/login, lalu otomatis ikut terkirim oleh
         browser di setiap request ke domain ini (termasuk /api/v1/**
         lewat proxy Next.js). JS di browser SENGAJA tidak pernah bisa
         baca token ini (httpOnly, cegah XSS) -- makanya frontend
         (agent-ai/lib/api.js) tidak pernah mengirim header Authorization
         sama sekali, jadi cookie ini WAJIB dicek di sini juga, kalau
         tidak SEMUA endpoint /api/v1/** dari browser selalu 401.
         Nama cookie & cara least-privilege-nya sama dengan yang dibaca
         src/middleware.ts (Next.js) -- lihat src/lib/session.ts::
         SESSION_COOKIE_NAME.

    Kalau tidak ada satupun / tidak valid, request langsung dibalas 401
    dengan amplop standar TANPA diteruskan ke endpoint -- handler
    endpoint tidak perlu cek token-nya sendiri lagi.
    """
    path = request.url.path
    if path.startswith("/api/v1/") and path not in PUBLIC_PATHS_V1:
        header_value = request.headers.get("Authorization")
        token = None
        if header_value and header_value.startswith("Bearer "):
            token = header_value[len("Bearer "):].strip()
        if not token:
            token = request.cookies.get("gouf_session")

        user = auth.decode_token(token) if token else None
        if user is None:
            return gagal(
                message="Authorization Bearer token wajib & harus valid untuk endpoint ini.",
                errors={"code": "UNAUTHORIZED"},
                status_code=401,
            )
        # Ditaruh di request.state supaya endpoint (mis. /me) tidak perlu
        # decode ulang token -- lihat get_current_user_v1() di bawah.
        request.state.user = user

    return await call_next(request)


def get_current_user_v1(
    request: Request,
    # Parameter ini TIDAK dipakai untuk validasi (itu sudah tugas
    # jwt_v1_middleware) -- tujuannya SEMATA-MATA supaya FastAPI mendaftarkan
    # skema keamanan HTTPBearer di OpenAPI untuk endpoint yang bergantung ke
    # fungsi ini, sehingga muncul lock icon + bisa dites lewat tombol
    # "Authorize" di Swagger UI (/docs).
    _credentials: Optional[HTTPAuthorizationCredentials] = Depends(auth._bearer_scheme),
) -> Dict[str, Any]:
    """Dependency: ambil user yang SUDAH divalidasi jwt_v1_middleware di atas."""
    user = getattr(request.state, "user", None)
    if user is None:
        # Harusnya tidak pernah kejadian (middleware sudah menolak lebih
        # dulu kalau token kosong/invalid) -- pagar tambahan kalau suatu
        # saat middleware lupa dipasang di main.py.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak ditemukan atau middleware auth belum aktif.",
        )
    return user


# ============================================================
# ENDPOINTS
# ============================================================

@router.post(
    "/register",
    summary="Buat akun staf baru (khusus Partner/Admin)",
    responses={
        201: {
            "description": "User berhasil dibuat.",
            "content": {"application/json": {"example": {
                "status": "success",
                "message": "User berhasil dibuat.",
                "data": {"id": 12, "username": "budi.staf", "role": "tahap_1", "nama": "Budi Santoso"},
                "errors": None,
            }}},
        },
        401: {
            "description": "Token tidak dikirim / tidak valid.",
            "content": {"application/json": {"example": {
                "status": "error",
                "message": "Authorization Bearer token wajib & harus valid untuk endpoint ini.",
                "data": None,
                "errors": {"code": "UNAUTHORIZED"},
            }}},
        },
        403: {"description": "User yang login bukan role tahap_5 (Partner/Admin)."},
        409: {
            "description": "Username sudah dipakai.",
            "content": {"application/json": {"example": {
                "status": "error", "message": "Username sudah dipakai.",
                "data": None, "errors": {"field": "username"},
            }}},
        },
        422: {"description": "Payload tidak valid (mis. role tidak dikenal, password < 8 karakter)."},
    },
)
def register(
    payload: RegisterRequest,
    _current_user: Dict[str, Any] = Depends(auth.require_level(5)),
):
    """
    Buat akun staf baru.

    Dibatasi HANYA untuk role tahap_5 (Partner/Admin) -- atau super_admin,
    yang otomatis lolos Depends(auth.require_level(5)) di atas, lihat
    modules/auth/core.py::role_level() -- yang memanggil. Ini tool
    internal kantor, akun staf dibuat oleh admin, BUKAN pendaftaran
    publik terbuka (mencegah orang luar bikin akun sendiri dengan role
    bebas).

    role yang boleh diisi HANYA role FIRM-WIDE (tahap_1..5, super_admin)
    -- lihat RBAC.md. Role PER CLIENT (org_owner..viewer) BUKAN di sini,
    itu diberikan lewat POST /api/client/{client_id}/access
    (access_role), bukan lewat User.role.
    """
    role_valid = set(auth.LEVELS.keys()) | {auth.SUPER_ADMIN_ROLE}
    if payload.role not in role_valid:
        return gagal(
            message=f"Role tidak dikenal: {payload.role}",
            errors={"role_valid": sorted(role_valid)},
            status_code=422,
        )

    # super_admin ada DI ATAS tahap_5 (lihat RBAC.md) -- seorang Partner
    # (tahap_5) TIDAK boleh mengangkat dirinya/orang lain jadi super_admin
    # begitu saja, cuma super_admin yang sudah ada yang boleh membuat
    # super_admin baru.
    if payload.role == auth.SUPER_ADMIN_ROLE and not auth.is_super_admin(_current_user.get("role")):
        return gagal(
            message="Hanya Super Admin yang boleh membuat akun Super Admin baru.",
            errors={"code": "FORBIDDEN_SUPER_ADMIN"},
            status_code=403,
        )

    if dbc.get_user_by_username(payload.username):
        return gagal(
            message="Username sudah dipakai.",
            errors={"field": "username"},
            status_code=409,
        )

    hashed = auth.hash_password(payload.password)
    berhasil = dbc.create_user(
        username=payload.username,
        password_hash=hashed,
        role=payload.role,
        nama=payload.nama,
    )
    if not berhasil:
        return gagal(message="Gagal membuat user (kesalahan database).", status_code=500)

    user_baru = dbc.get_user_by_username(payload.username)
    return sukses(
        data={
            "id": user_baru["id"],
            "username": user_baru["username"],
            "role": user_baru["role"],
            "nama": user_baru.get("nama"),
        },
        message="User berhasil dibuat.",
        status_code=201,
    )


@router.post(
    "/login",
    summary="Login, dapatkan JWT access token",
    responses={
        200: {
            "description": "Login berhasil.",
            "content": {"application/json": {"example": {
                "status": "success",
                "message": "Login berhasil.",
                "data": {
                    "access_token": "eyJhbGciOi...",
                    "token_type": "bearer",
                    "expires_in_hours": 8,
                    "user": {"id": 1, "username": "budi.staf", "role": "tahap_1", "nama": "Budi Santoso"},
                },
                "errors": None,
            }}},
        },
        401: {
            "description": "Username atau password salah.",
            "content": {"application/json": {"example": {
                "status": "error", "message": "Username atau password salah.",
                "data": None, "errors": {"code": "INVALID_CREDENTIALS"},
            }}},
        },
    },
)
def login(payload: LoginRequest):
    """
    Login dengan username & password, dapatkan JWT access token.

    Token yang dihasilkan berlaku juga untuk endpoint LAMA (mis.
    `GET /api/client`) yang masih pakai `Depends(auth.require_level(...))`
    -- lihat catatan kompatibilitas di kepala file ini. Endpoint ini
    TIDAK memerlukan header Authorization (ada di PUBLIC_PATHS_V1).
    """
    user = auth.authenticate(payload.username, payload.password)
    if not user:
        return gagal(
            message="Username atau password salah.",
            errors={"code": "INVALID_CREDENTIALS"},
            status_code=401,
        )

    token = auth.buat_token(user)
    return sukses(
        data={
            "access_token": token,
            "token_type": "bearer",
            "expires_in_hours": auth.TOKEN_KADALUARSA_JAM,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "nama": user.get("nama"),
            },
        },
        message="Login berhasil.",
    )


@router.get(
    "/me",
    summary="Profil user yang sedang login",
    responses={
        200: {
            "description": "OK.",
            "content": {"application/json": {"example": {
                "status": "success",
                "message": "OK",
                "data": {
                    "id": 1, "username": "budi.staf", "role": "tahap_1",
                    "role_label": "Staf Tahap 1", "nama": "Budi Santoso",
                },
                "errors": None,
            }}},
        },
        401: {
            "description": "Token tidak dikirim / tidak valid.",
            "content": {"application/json": {"example": {
                "status": "error",
                "message": "Authorization Bearer token wajib & harus valid untuk endpoint ini.",
                "data": None,
                "errors": {"code": "UNAUTHORIZED"},
            }}},
        },
    },
)
def me(current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    """Ambil profil (id, username, role, nama) dari user pemilik token yang dipakai."""
    return sukses(
        data={
            "id": current_user.get("id"),
            "username": current_user.get("username"),
            "role": current_user.get("role"),
            "role_label": auth.role_label(current_user.get("role")),
            "nama": current_user.get("nama"),
        },
        message="OK",
    )


@router.get(
    "/roles",
    summary="Katalog role (firm-wide & per-client) -- lihat RBAC.md",
    responses={
        200: {
            "description": "OK.",
            "content": {"application/json": {"example": {
                "status": "success",
                "message": "OK",
                "data": {
                    "internal": [{"code": "tahap_1", "level": 1, "label": "Junior Staff"}],
                    "client": [{"code": "client_lv_1", "level": 1, "key": "org_owner", "label": "Org Owner"}],
                    "super_admin": {"code": "super_admin", "label": "Super Admin"},
                },
                "errors": None,
            }}},
        },
    },
)
def daftar_roles(_current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    """
    Sumber kebenaran tunggal untuk katalog role (dari RBAC.md), supaya
    frontend (mis. dropdown di halaman "Kelola Akses") tidak perlu
    hardcode daftar role/label sendiri:

    - "internal": role FIRM-WIDE staf kantor (User.role), berjenjang --
      level lebih tinggi otomatis bisa akses level di bawahnya.
    - "client": role PER CLIENT (UserClientAccess.access_role, diberikan
      lewat POST /api/client/{client_id}/access) -- BERJENJANG TERBALIK,
      level 1 (org_owner) paling senior, level 9 (viewer) paling terbatas.
    - "super_admin": satu role tunggal di atas tahap_5, lihat
      modules/auth/core.py::SUPER_ADMIN_ROLE.
    """
    return sukses(
        data={
            "internal": [
                {"code": code, "level": meta["level"], "label": meta["label"]}
                for code, meta in auth.LEVELS.items()
            ],
            "client": [
                {"code": code, "level": meta["level"], "key": meta["key"], "label": meta["label"]}
                for code, meta in auth.CLIENT_LEVELS.items()
            ],
            "super_admin": {
                "code": auth.SUPER_ADMIN_ROLE,
                "label": auth.role_label(auth.SUPER_ADMIN_ROLE),
            },
        },
        message="OK",
    )