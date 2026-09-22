"""
modules/auth/core.py
=====================
Login & Role-Based Access Control (RBAC) untuk AI Gouf Consulting.

VERSI FASTAPI -- ini penulisan ulang dari versi Streamlit lama.

Kenapa ditulis ulang (bukan cuma dipindah apa adanya):
    Versi Streamlit menyimpan status login di `st.session_state`, yaitu
    memory yang otomatis nempel ke SATU tab browser selama app Streamlit
    itu jalan. FastAPI tidak punya konsep ini -- setiap request HTTP
    berdiri sendiri, server tidak "ingat" siapa yang barusan login.

    Solusinya: JWT (JSON Web Token). Alurnya:
        1. User login lewat POST /api/login (username + password)
        2. Kalau cocok, server bikin "token" (string terenkripsi berisi
           username + role + waktu kadaluarsa), dikirim balik ke React
        3. React SIMPAN token itu (di memory/localStorage), lalu
           menyertakannya di header setiap request selanjutnya:
               Authorization: Bearer <token>
        4. Endpoint yang butuh login tinggal pasang
           `Depends(get_current_user)` -- FastAPI otomatis baca & validasi
           token dari header itu.

    Logika BISNIS-nya (hash password, 5 level tahapan, siapa boleh akses
    apa) SAMA PERSIS seperti versi Streamlit -- yang beda cuma cara
    "mengingat" siapa yang sedang login.

Butuh 2 library baru (sudah ditambahkan ke requirements.txt):
    pip install "pyjwt>=2.8.0" "python-dotenv>=1.0.0"
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

try:
    import bcrypt
except ImportError:
    raise ImportError(
        "❌ Library bcrypt diperlukan. Jalankan: pip install bcrypt"
    )

try:
    import jwt  # PyJWT
except ImportError:
    raise ImportError(
        "❌ Library PyJWT diperlukan. Jalankan: pip install pyjwt"
    )

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..logging_config import get_module_logger

logger = get_module_logger("auth")

# ============================================================
# SECURITY MODE
# ============================================================
# Development boleh memakai anonymous bypass supaya workflow lokal yang sudah
# ada tidak rusak. Production SECARA DEFAULT wajib JWT dan tidak pernah
# memberikan role tahap_5 hanya karena header Authorization kosong.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in {"production", "prod"}
ALLOW_ANONYMOUS_DEV = (
    os.environ.get("ALLOW_ANONYMOUS_DEV", "true" if not IS_PRODUCTION else "false")
    .strip().lower() in {"1", "true", "yes", "on"}
)
ALLOW_FALLBACK_ADMIN = (
    os.environ.get("ALLOW_FALLBACK_ADMIN", "true" if not IS_PRODUCTION else "false")
    .strip().lower() in {"1", "true", "yes", "on"}
)

DEFAULT_USER_TANPA_LOGIN: Dict[str, Any] = {
    "username": "dashboard-dev",
    "role": "tahap_5",
    "nama": "Dashboard Development",
    "id": 0,
}

# ============================================================
# KONFIGURASI JWT
# ============================================================
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "ganti-ini-di-env-JWT_SECRET_KEY-jangan-dipakai-di-production")
ALGORITMA = "HS256"
TOKEN_KADALUARSA_JAM = int(os.environ.get("JWT_EXPIRE_HOURS", "12"))

if SECRET_KEY.startswith("ganti-ini"):
    if IS_PRODUCTION:
        raise RuntimeError(
            "JWT_SECRET_KEY wajib di-set dengan nilai acak yang kuat pada APP_ENV=production."
        )
    logger.warning(
        "JWT_SECRET_KEY belum di-set; nilai default hanya diizinkan untuk development."
    )

_bearer_scheme = HTTPBearer(auto_error=False)


# ============================================================
# KONFIGURASI - SISTEM TAHAPAN BERJENJANG (5 LEVEL)
# ============================================================
# Sama persis seperti versi Streamlit: setiap user punya satu "role" yang
# sebenarnya adalah sebuah tahapan (tahap_1 s/d tahap_5). Aksesnya
# BERJENJANG: user tahap N otomatis bisa akses tahap N dan semua tahap DI
# BAWAHNYA, tapi TIDAK bisa akses tahap DI ATASNYA.
LEVELS: Dict[str, Dict[str, Any]] = {
    "tahap_1": {"level": 1, "label": "Junior Staff"},
    "tahap_2": {"level": 2, "label": "Senior Staff"},
    "tahap_3": {"level": 3, "label": "Supervisor"},
    "tahap_4": {"level": 4, "label": "Manager"},
    "tahap_5": {"level": 5, "label": "Partner / Direktur (Akses Penuh)"},
}

# Dipertahankan supaya kode lama yang memanggil `auth.ROLES` tetap jalan.
ROLES = list(LEVELS.keys())

# ============================================================
# KONFIGURASI - ROLE PER-CLIENT (9 LEVEL) -- lihat RBAC.md
# ============================================================
# BEDA dari LEVELS di atas: LEVELS adalah role FIRM-WIDE milik user
# (User.role, tahap_1..5), sedangkan ini adalah role PER CLIENT --
# disimpan di UserClientAccess.access_role (lihat db_client.py), bukan
# di User.role. Satu user (staf non-Partner) bisa punya access_role
# BERBEDA di tiap client (mis. "client_lv_2" untuk client A karena
# dialah yang bikin/pegang client itu, "client_lv_9" saja untuk client B).
#
# Kode yang DISIMPAN & DIVALIDASI adalah "client_lv_N" (kolom tengah di
# RBAC.md) -- SAMA polanya dengan LEVELS di atas (mis. "tahap_1"
# disimpan, "junior_associate" cuma nama deskriptif yang TIDAK pernah
# dipakai sebagai value di kode mana pun). "key" di bawah cuma metadata
# nama deskriptif itu (org_owner, director, dst), disimpan sekadar
# referensi/dokumentasi, bukan yang divalidasi/disimpan ke DB.
#
# PENTING -- arah levelnya KEBALIKAN dari LEVELS: level 1 (client_lv_1
# / "org_owner") PALING SENIOR/akses penuh ke client itu, level 9
# (client_lv_9 / "viewer") PALING terbatas (cuma baca).
# require_client_level(max_level) di bawah meloloskan user yang level
# access_role-nya <= max_level, mis. max_level=5 -> client_lv_1 s/d
# client_lv_5 (org_owner..supervisor) lolos, client_lv_6..9 ditolak.
CLIENT_LEVELS: Dict[str, Dict[str, Any]] = {
    "client_lv_1": {"level": 1, "key": "org_owner", "label": "Org Owner"},
    "client_lv_2": {"level": 2, "key": "director", "label": "Director"},
    "client_lv_3": {"level": 3, "key": "finance_mgr", "label": "Finance Manager"},
    "client_lv_4": {"level": 4, "key": "accounting_mgr", "label": "Accounting Manager"},
    "client_lv_5": {"level": 5, "key": "supervisor", "label": "Supervisor"},
    "client_lv_6": {"level": 6, "key": "accounting_staff", "label": "Accounting Staff"},
    "client_lv_7": {"level": 7, "key": "tax", "label": "Tax Staff"},
    "client_lv_8": {"level": 8, "key": "auditor", "label": "Auditor"},
    "client_lv_9": {"level": 9, "key": "viewer", "label": "Viewer"},
}

CLIENT_ROLE_CODES: List[str] = list(CLIENT_LEVELS.keys())


def client_role_label(access_role: Optional[str]) -> str:
    """Label tampilan utk access_role per-client (mis. 'client_lv_2' -> 'Director')."""
    return CLIENT_LEVELS.get(access_role or "", {}).get("label", access_role or "-")


def client_role_level(access_role: Optional[str]) -> Optional[int]:
    """Nomor level access_role per-client (1=paling senior .. 9=paling
    terbatas). None kalau kode tidak dikenal/kosong."""
    entry = CLIENT_LEVELS.get(access_role or "")
    return entry["level"] if entry else None


def client_role_label_by_level(level: int) -> str:
    """Kebalikan dari client_role_level() -- dipakai untuk pesan error yang
    mudah dibaca (mis. "butuh minimal level 'Supervisor'")."""
    for meta in CLIENT_LEVELS.values():
        if meta["level"] == level:
            return meta["label"]
    return str(level)


# ============================================================
# SUPER ADMIN -- role tunggal DI ATAS tahap_5 (lihat RBAC.md)
# ============================================================
# Dipakai untuk pemilik platform, DI LUAR hierarki 5 tahap staf kantor
# (mis. developer/owner aplikasi ini sendiri). Diberi level sentinel
# sangat tinggi supaya OTOMATIS lolos semua require_level(N)/
# role_level() check yang sudah ada di ~60 endpoint tanpa perlu
# mengubah pemanggilnya satu-satu. require_roles() (exact-match, lihat
# di bawah) SENGAJA tetap diberi pengecualian eksplisit yang sama.
SUPER_ADMIN_ROLE = "super_admin"
_SUPER_ADMIN_LEVEL = 999


def is_super_admin(role: Optional[str]) -> bool:
    return role == SUPER_ADMIN_ROLE


# Akun fallback saat database tidak aktif -- HANYA dipakai kalau db_client
# tidak bisa dihubungi. Ganti/matikan begitu database sungguhan sudah jalan.
_FALLBACK_USERNAME = "admin"
_FALLBACK_PASSWORD = "admin123"
_FALLBACK_USER = {
    "id": 0,
    "username": _FALLBACK_USERNAME,
    "role": "tahap_5",
    "nama": "Administrator (fallback)",
}


def role_label(role: Optional[str]) -> str:
    """Ambil label tampilan (mis. 'Junior Staff') dari kode role (mis. 'tahap_1')."""
    if role == SUPER_ADMIN_ROLE:
        return "Super Admin"
    return LEVELS.get(role or "", {}).get("label", role or "-")


def role_level(role: Optional[str]) -> int:
    """Ambil nomor level (1-5) dari kode role. super_admin selalu di atas
    tahap_5 (lihat _SUPER_ADMIN_LEVEL). 0 kalau role tidak dikenal."""
    if role == SUPER_ADMIN_ROLE:
        return _SUPER_ADMIN_LEVEL
    return LEVELS.get(role or "", {}).get("level", 0)


# ============================================================
# HASHING PASSWORD (tidak berubah dari versi Streamlit)
# ============================================================

def hash_password(password: str) -> str:
    """Hash password pakai bcrypt (otomatis pakai salt acak setiap panggilan)."""
    if not password:
        raise ValueError("Password tidak boleh kosong")
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Cek apakah password cocok dengan hash bcrypt yang tersimpan."""
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ============================================================
# SUMBER DATA USER (DB atau fallback) -- tidak berubah
# ============================================================

def _db_aktif() -> bool:
    """Cek apakah koneksi database berfungsi, tanpa melempar exception."""
    try:
        import db_client as dbc
        return dbc.cek_koneksi()
    except Exception:
        return False


def _cari_user_db(username: str) -> Optional[Dict[str, Any]]:
    try:
        import db_client as dbc
        return dbc.get_user_by_username(username)
    except Exception as e:
        logger.warning(f"Gagal mengambil user dari database ({e})")
        return None


# ============================================================
# AUTENTIKASI (logika sama, tanpa session_state)
# ============================================================

def authenticate(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Cek username & password. Coba lewat database dulu; kalau database
    tidak aktif, fallback ke satu akun admin bawaan.

    Returns:
        Dict user (tanpa password_hash) kalau berhasil, None kalau gagal.
    """
    if not username or not password:
        return None

    username = username.strip()

    if _db_aktif():
        user = _cari_user_db(username)
        if user and verify_password(password, user.get("password_hash", "")):
            logger.info(f"✅ Login berhasil (database): {username}")
            return {
                "id": user.get("id"),
                "username": user.get("username"),
                "role": user.get("role"),
                "nama": user.get("nama"),
            }
        logger.warning(f"❌ Login gagal (database): {username}")
        return None

    if ALLOW_FALLBACK_ADMIN and username == _FALLBACK_USERNAME and password == _FALLBACK_PASSWORD:
        logger.warning(f"Login fallback development dipakai (database tidak aktif): {username}")
        return dict(_FALLBACK_USER)

    logger.warning(f"❌ Login gagal (fallback, database tidak aktif): {username}")
    return None


# ============================================================
# TOKEN (JWT) -- ini pengganti st.session_state
# ============================================================

def buat_token(user: Dict[str, Any]) -> str:
    """
    Bungkus data user (username, role, nama) jadi 1 token JWT yang
    dikirim ke frontend React setelah login berhasil.
    """
    kadaluarsa = datetime.now(timezone.utc) + timedelta(hours=TOKEN_KADALUARSA_JAM)
    payload = {
        "sub": user.get("username"),
        "role": user.get("role"),
        "nama": user.get("nama"),
        "user_id": user.get("id"),
        "exp": kadaluarsa,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITMA)


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Buka & validasi token. None kalau tidak valid/sudah kadaluarsa."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITMA])
        return {
            "username": payload.get("sub"),
            "role": payload.get("role"),
            "nama": payload.get("nama"),
            "id": payload.get("user_id"),
        }
    except jwt.ExpiredSignatureError:
        logger.info("Token sudah kadaluarsa")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Token tidak valid: {e}")
        return None


# ============================================================
# DEPENDENCY FASTAPI -- dipasang di endpoint yang butuh login
# ============================================================
# Cara pakai di main.py:
#
#   from modules.auth import get_current_user, require_level
#
#   @app.get("/api/profil-saya")
#   def profil_saya(user: dict = Depends(get_current_user)):
#       return user
#
#   @app.get("/api/data-khusus-manager")
#   def data_khusus(user: dict = Depends(require_level(4))):
#       ...  # hanya tahap_4 & tahap_5 yang lolos, selainnya dapat 403

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Dict[str, Any]:
    """
    Dependency FastAPI: ambil & validasi token dari header
    `Authorization: Bearer <token>`.

    Security mode:
    - Development dapat mengaktifkan ALLOW_ANONYMOUS_DEV=true untuk
      mempertahankan workflow demo/local yang lama. User bypass ini hanya
      ada di development.
    - Production (APP_ENV=production) default-nya WAJIB Bearer JWT. Request
      tanpa token mendapat 401 dan tidak pernah otomatis memperoleh tahap_5.
    - Frontend production memakai halaman /login -> POST /api/login, lalu
      mengirim token pada setiap request API.
    """
    if credentials is None:
        if ALLOW_ANONYMOUS_DEV:
            return DEFAULT_USER_TANPA_LOGIN.copy()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization Bearer token wajib untuk environment production.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = decode_token(credentials.credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid atau sudah kadaluarsa, silakan login ulang.",
        )
    return user


def require_level(min_tahap: int):
    """
    Factory dependency: hasilkan dependency yang hanya meloloskan user
    dengan level >= min_tahap (akses berjenjang, sama seperti
    `has_access()`/`require_stage()` di versi Streamlit).

    Contoh: Depends(require_level(3)) -> hanya tahap_3, tahap_4, tahap_5.
    """

    def _dependency(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if role_level(user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. "
                    f"Akun kamu: {role_label(user.get('role'))}."
                ),
            )
        return user

    return _dependency


def require_roles(roles: List[str]):
    """
    Factory dependency: hasilkan dependency yang hanya meloloskan user
    dengan role PERSIS ada di `roles` (tidak berjenjang -- beda dengan
    require_level di atas).

    Contoh: Depends(require_roles(["tahap_5"])) -> hanya tahap_5 persis.
    """

    def _dependency(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        # super_admin ada DI LUAR daftar `roles` manapun (exact-match) tapi
        # tetap harus lolos -- sama seperti bypass di role_level()/
        # user_has_client_access() di bawah.
        if is_super_admin(user.get("role")):
            return user
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Fitur ini hanya untuk role: {', '.join(roles)}",
            )
        return user

    return _dependency


def require_client_level(max_level: int):
    """
    Dependency factory: user harus lolos get_current_user DAN (kalau
    bukan tahap_5/super_admin, yang selalu full akses) punya baris
    UserClientAccess AKTIF di client ini dengan access_role yang
    level-nya <= max_level -- lihat CLIENT_LEVELS (level 1 = org_owner
    paling senior, level 9 = viewer paling terbatas).

    WAJIB dipakai di endpoint yang path-nya punya path param
    "client_id" (mis. "/api/client/{client_id}/..."), diambil dari
    request.path_params supaya dependency ini generic untuk endpoint
    mana pun tanpa perlu tahu urutan parameter fungsinya.

    Contoh: Depends(require_client_level(5)) -> org_owner s/d
    supervisor lolos, accounting_staff/tax/auditor/viewer ditolak (403).
    """

    def _dependency(
        request: Request,
        user: Dict[str, Any] = Depends(get_current_user),
    ) -> Dict[str, Any]:
        if role_level(user.get("role")) >= LEVELS["tahap_5"]["level"]:
            return user  # tahap_5 & super_admin: full akses semua client

        client_id_raw = request.path_params.get("client_id")
        if client_id_raw is None:
            raise HTTPException(
                status_code=500,
                detail="require_client_level() dipakai di endpoint tanpa path param client_id.",
            )

        import db_client as dbc
        akses = dbc.get_user_client_access(user.get("id"), int(client_id_raw))
        level = client_role_level(akses.get("access_role")) if akses else None
        if level is None or level > max_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Fitur ini butuh access_role client minimal setara "
                    f"'{client_role_label_by_level(max_level)}'."
                ),
            )
        return user

    return _dependency


def user_from_authorization_header(header_value: Optional[str]) -> Optional[Dict[str, Any]]:
    """Helper untuk middleware client-isolation. Tidak melempar exception."""
    if not header_value:
        return DEFAULT_USER_TANPA_LOGIN.copy() if ALLOW_ANONYMOUS_DEV else None
    prefix = "Bearer "
    if not header_value.startswith(prefix):
        return None
    return decode_token(header_value[len(prefix):].strip())


def production_auth_required() -> bool:
    return not ALLOW_ANONYMOUS_DEV
