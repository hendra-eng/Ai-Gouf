"""
modules/auth/__init__.py
=========================
Paket auth -- dipecah dari 1 file (modules/auth.py) jadi folder supaya
lebih rapi & gampang dicari:

    modules/auth/core.py  -- sistem lama (JWT + RBAC 5-tahap), fungsi
                              hash_password/authenticate/buat_token/
                              decode_token/get_current_user/require_level/
                              require_roles, dst. Dipakai di ~60 endpoint
                              lewat Depends(auth.require_level(...)).
    modules/auth/v1.py    -- fitur baru: REST API standar /api/v1/auth/
                              (register/login/me) + middleware JWT-nya.
                              Lihat modules/auth/v1.py untuk detail &
                              kenapa ini TIDAK menggantikan core.py.

`from .core import *` di bawah supaya kode lama yang sudah ada di seluruh
project (main.py, tax_router.py, dst) yang menulis:

    from modules import auth
    auth.get_current_user(...) / auth.require_level(3) / dst

    from modules.auth import hash_password, verify_password, ROLES

TETAP JALAN TANPA PERLU DIUBAH SATU BARIS PUN -- `auth` sekarang adalah
paket (folder), tapi isi namespace publiknya sama persis dengan waktu
masih 1 file.
"""

from .core import *  # noqa: F401,F403
from .core import (  # noqa: F401
    ALLOW_ANONYMOUS_DEV,
    ALLOW_FALLBACK_ADMIN,
    APP_ENV,
    IS_PRODUCTION,
    LEVELS,
    ROLES,
    TOKEN_KADALUARSA_JAM,
    DEFAULT_USER_TANPA_LOGIN,
    production_auth_required,
    user_from_authorization_header,
)

# Submodul fitur baru -- dipakai di main.py lewat:
#   from modules.auth import v1 as auth_v1
from . import v1  # noqa: F401
