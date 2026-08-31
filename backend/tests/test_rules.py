"""
tests/test_rules.py
====================
Unit test untuk validation rules engine
"""

import pytest
import pandas as pd

from modules.rules import (
    ValidationRule,
    VALIDATION_RULES,
    validate_all_rules,
    get_violations_summary,
)


class TestValidationRule:
    """Test ValidationRule class"""
    
    def test_rule_validation_valid(self):
        """Test rule valid"""
        rule = ValidationRule(
            name="test_rule",
            condition=lambda row: row.get("value", 0) > 0,
            message="Value harus positif",
            severity="error"
        )
        
        result = rule.validate({"value": 10})
        assert result is None
    
    def test_rule_validation_invalid(self):
        """Test rule invalid"""
        rule = ValidationRule(
            name="test_rule",
            condition=lambda row: row.get("value", 0) > 0,
            message="Value harus positif",
            severity="error"
        )
        
        result = rule.validate({"value": -5})
        assert result is not None
        assert result["rule"] == "test_rule"
        assert result["severity"] == "error"
    
    def test_rule_disabled(self):
        """Test rule yang dinonaktifkan"""
        rule = ValidationRule(
            name="test_rule",
            condition=lambda row: False,
            message="Always fails",
            severity="error",
            enabled=False
        )
        
        result = rule.validate({"value": 0})
        assert result is None
    
    def test_rule_with_exception(self):
        """Test rule yang error"""
        rule = ValidationRule(
            name="error_rule",
            condition=lambda row: 1/0,
            message="Should not happen",
            severity="error"
        )
        
        result = rule.validate({"value": 0})
        assert result is not None
        assert result["category"] == "system"


class TestValidationRules:
    """Test predefined validation rules"""
    
    def test_nominal_positif_rule(self):
        """Test rule nominal positif"""
        rule = VALIDATION_RULES[0]  # nominal_positif
        
        # Valid
        result = rule.validate({"jml_debet": 100000, "jml_kredit": 50000})
        assert result is None
        
        # Invalid
        result = rule.validate({"jml_debet": -100000, "jml_kredit": 50000})
        assert result is not None
        assert "negatif" in result["message"].lower()
    
    def test_akun_berbeda_rule(self):
        """Test rule akun berbeda"""
        # Cari rule akun_berbeda
        rule = next(r for r in VALIDATION_RULES if r.name == "akun_berbeda")
        
        # Valid
        result = rule.validate({"no_akun_debet": "5100", "no_akun_kredit": "1100"})
        assert result is None
        
        # Invalid
        result = rule.validate({"no_akun_debet": "5100", "no_akun_kredit": "5100"})
        assert result is not None
        assert "berbeda" in result["message"].lower()
    
    def test_nominal_wajar_rule(self):
        """Test rule nominal wajar"""
        # Cari rule nominal_wajar
        rule = next(r for r in VALIDATION_RULES if r.name == "nominal_wajar")
        
        # Valid
        result = rule.validate({"jml_debet": 500000, "jml_kredit": 0})
        assert result is None
        
        # Invalid (terlalu besar)
        result = rule.validate({"jml_debet": 2_000_000_000, "jml_kredit": 0})
        assert result is not None


class TestValidateAllRules:
    """Test validate_all_rules function"""
    
    def test_validate_all_valid(self):
        """Test semua data valid"""
        df = pd.DataFrame([
            {"jml_debet": 100000, "jml_kredit": 100000, "no_akun_debet": "5100", "no_akun_kredit": "1100"},
            {"jml_debet": 200000, "jml_kredit": 200000, "no_akun_debet": "5200", "no_akun_kredit": "1100"},
        ])
        
        result = validate_all_rules(df)
        assert result["total_rows"] == 2
        # Ada warnings dari rules (keterangan kosong, dll) - ini normal
        assert result["summary"]["total_violations"] <= 2
    
    def test_validate_all_invalid(self):
        """Test data invalid"""
        df = pd.DataFrame([
            {"jml_debet": -100000, "jml_kredit": 100000, "no_akun_debet": "5100", "no_akun_kredit": "1100"},
            {"jml_debet": 200000, "jml_kredit": 200000, "no_akun_debet": "5100", "no_akun_kredit": "5100"},
        ])
        
        result = validate_all_rules(df)
        assert result["summary"]["total_violations"] > 0
        assert result["summary"]["has_errors"] is True
    
    def test_get_violations_summary(self):
        """Test get_violations_summary"""
        violations = [
            {"rule": "rule1", "severity": "error", "row": 0},
            {"rule": "rule1", "severity": "error", "row": 1},
            {"rule": "rule2", "severity": "warning", "row": 2},
        ]
        
        summary = get_violations_summary(violations)
        assert summary["total"] == 3
        assert summary["by_rule"]["rule1"] == 2
        assert summary["by_rule"]["rule2"] == 1
        assert summary["by_severity"]["error"] == 2
        assert summary["by_severity"]["warning"] == 1