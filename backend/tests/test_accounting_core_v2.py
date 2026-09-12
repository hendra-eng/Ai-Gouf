"""Regression tests inti Accounting Core V2.

Test ini fokus pada invariant accounting core. Untuk dijalankan pada project env:
    pytest backend/tests/test_accounting_core_v2.py -q
"""
from decimal import Decimal

import pytest


def test_money_decimal_uses_two_decimals():
    from modules import accounting_core
    assert accounting_core._money("0.1") + accounting_core._money("0.2") == Decimal("0.30")


def test_standard_taxonomy_has_core_roles_targets():
    from modules import accounting_core
    codes = {row[0] for row in accounting_core.DEFAULT_STANDARD_ACCOUNTS}
    assert "STD.ASSET.AR" in codes
    assert "STD.LIABILITY.AP" in codes
    assert "STD.ASSET.VAT_INPUT" in codes
    assert "STD.LIABILITY.VAT_OUTPUT" in codes
    assert "STD.REVENUE.SERVICE" in codes


def test_account_roles_include_required_control_roles():
    from modules import accounting_core
    roles = {row[0] for row in accounting_core.DEFAULT_ACCOUNT_ROLES}
    assert {"AR_CONTROL", "AP_CONTROL", "INPUT_VAT", "OUTPUT_VAT", "RETAINED_EARNINGS"}.issubset(roles)
