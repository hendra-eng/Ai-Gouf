"""
tests/test_auth.py
===================
Unit test untuk login & RBAC (modules/auth.py). Tidak menyentuh Streamlit
session_state / database asli - hanya menguji fungsi hashing & fallback auth.
"""

import pytest

from modules.auth import hash_password, verify_password, authenticate, ROLES


class TestPasswordHashing:
    def test_hash_dan_verify_benar(self):
        hashed = hash_password("password_rahasia123")
        assert hashed != "password_rahasia123"
        assert verify_password("password_rahasia123", hashed) is True

    def test_verify_password_salah(self):
        hashed = hash_password("password_asli")
        assert verify_password("password_salah", hashed) is False

    def test_hash_berbeda_setiap_kali(self):
        h1 = hash_password("sama123")
        h2 = hash_password("sama123")
        assert h1 != h2  # bcrypt pakai salt acak
        assert verify_password("sama123", h1) is True
        assert verify_password("sama123", h2) is True


class TestAuthenticateFallback:
    """Test autentikasi lewat fallback (tanpa database)."""

    def test_login_gagal_dengan_password_salah(self):
        hasil = authenticate("admin", "password_ngasal_pasti_salah")
        assert hasil is None

    def test_login_gagal_username_tidak_dikenal(self):
        hasil = authenticate("user_tidak_ada", "apapun")
        assert hasil is None


class TestRoles:
    def test_roles_terdiri_dari_lima_tahap(self):
        assert set(ROLES) == {"tahap_1", "tahap_2", "tahap_3", "tahap_4", "tahap_5"}