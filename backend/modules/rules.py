"""
modules/rules.py
=================
Validation rules engine untuk AI Gouf Consulting
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Callable, Optional
import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("rules")


def _angka(v) -> float:
    """
    [FIX] Ambil angka dengan aman dari sebuah field row -- None/NaN/inf
    semua dianggap 0.0.

    Rules di bawah (nominal_positif, balance_persen, dll) sebelumnya pakai
    pola `(row.get("jml_debet", 0) or 0)`. Pola itu TIDAK aman untuk NaN:
    `float('nan') or 0` mengembalikan `nan` (NaN dianggap truthy di
    Python, beda dari None/0/""), jadi fallback "or 0"-nya tidak kepakai.
    Akibatnya: baris dengan jml_debet/jml_kredit kosong (NaN, bukan None
    murni -- ini yang biasa terjadi setelah beberapa sheet digabung lewat
    pandas.concat, lihat catatan yang sama di akuntansi_ai.py) akan lolos
    ke perbandingan seperti `nan >= 0` (selalu False) dan membuat rule
    "nominal_positif" salah menuduh baris itu "nominal negatif" padahal
    sebenarnya datanya kosong -- pesan errornya jadi menyesatkan.
    """
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if pd.isna(f) or f in (float("inf"), float("-inf")):
        return 0.0
    return f


@dataclass
class ValidationRule:
    """Rule untuk validasi data"""
    name: str
    condition: Callable
    message: str
    severity: str = "warning"  # "error", "warning", "info"
    category: str = "general"
    enabled: bool = True
    
    def validate(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Validasi satu row"""
        if not self.enabled:
            return None
        
        try:
            if not self.condition(row):
                return {
                    "rule": self.name,
                    "category": self.category,
                    "severity": self.severity,
                    "message": self.message,
                    "row_data": row,
                }
        except Exception as e:
            logger.error(f"Error in rule {self.name}: {e}")
            return {
                "rule": self.name,
                "category": "system",
                "severity": "error",
                "message": f"Rule error: {e}",
                "row_data": row,
            }
        
        return None


# Definisi rules
VALIDATION_RULES = [
    ValidationRule(
        name="nominal_positif",
        # [FIX] pakai _angka() -- lihat docstring _angka() untuk kenapa
        # "(row.get(...) or 0)" tidak aman untuk nilai NaN.
        condition=lambda row: (
            _angka(row.get("jml_debet")) >= 0 and
            _angka(row.get("jml_kredit")) >= 0
        ),
        message="Nominal debet/kredit tidak boleh negatif",
        severity="error",
        category="nominal",
    ),
    ValidationRule(
        name="akun_berbeda",
        condition=lambda row: row.get("no_akun_debet") != row.get("no_akun_kredit"),
        message="Akun debet dan kredit harus berbeda",
        severity="error",
        category="akun",
    ),
    ValidationRule(
        name="akun_tidak_kosong",
        condition=lambda row: (
            row.get("no_akun_debet") is not None or 
            row.get("no_akun_kredit") is not None
        ),
        message="Akun debet atau kredit tidak boleh kosong",
        severity="warning",
        category="akun",
    ),
    ValidationRule(
        name="tanggal_valid",
        condition=lambda row: (
            row.get("tanggal") is None or 
            pd.notna(pd.to_datetime(row.get("tanggal"), errors="coerce"))
        ),
        message="Format tanggal tidak valid",
        severity="warning",
        category="tanggal",
    ),
    ValidationRule(
        name="keterangan_tidak_kosong",
        condition=lambda row: (
            row.get("keterangan") is not None and 
            str(row.get("keterangan", "")).strip() != ""
        ),
        message="Keterangan tidak boleh kosong",
        severity="warning",
        category="keterangan",
    ),
    ValidationRule(
        name="nominal_wajar",
        condition=lambda row: (  # [FIX] pakai _angka(), lihat catatan di atas
            _angka(row.get("jml_debet")) <= 1_000_000_000 and
            _angka(row.get("jml_kredit")) <= 1_000_000_000
        ),
        message="Nominal melebihi batas wajar (> 1M)",
        severity="info",
        category="nominal",
    ),
    ValidationRule(
        name="balance_persen",
        # [FIX] pakai _angka() -- versi lama: kalau jml_debet/jml_kredit NaN,
        # "abs(nan - x) <= max(nan, x)*0.01" selalu False, jadi baris yang
        # sebenarnya cuma datanya kosong malah dituduh "selisih > 1%".
        condition=lambda row: (
            abs(_angka(row.get("jml_debet")) - _angka(row.get("jml_kredit"))) <=
            max(_angka(row.get("jml_debet")), _angka(row.get("jml_kredit"))) * 0.01
        ),
        message="Selisih debet-kredit > 1%",
        severity="warning",
        category="balance",
    ),
]


def validate_all_rules(
    df: pd.DataFrame, 
    rules: Optional[List[ValidationRule]] = None
) -> Dict[str, Any]:
    """
    Validasi semua baris dengan semua rules
    
    Args:
        df: DataFrame yang divalidasi
        rules: List rules (default: VALIDATION_RULES)
    
    Returns:
        Dict dengan hasil validasi
    """
    if rules is None:
        rules = VALIDATION_RULES
    
    results = {
        "total_rows": len(df),
        "violations": [],
        "summary": {},
    }
    
    severity_count = {"error": 0, "warning": 0, "info": 0}
    category_count = {}

    # [BARU -- PERBAIKAN PERFORMA] Sebelumnya `for idx, row in df.iterrows():
    # row_dict = row.to_dict()` -- iterrows() membangun 1 objek pandas.Series
    # BARU per baris (termasuk penyelarasan dtype ke object kalau kolom
    # campuran), baru dikonversi lagi ke dict. df.to_dict("records") melakukan
    # konversi SEKALIGUS untuk semua baris dalam 1 operasi vektor, lebih murah
    # daripada N kali konstruksi Series + N kali .to_dict() terpisah. Index
    # asli tetap dipakai lewat df.index (bukan df.to_dict punya urutan sama
    # dgn df.index karena tidak diubah/di-reset di sini), jadi hasil "row"
    # yang dilaporkan di violations tetap index baris yang benar.
    records = df.to_dict("records")
    for idx, row_dict in zip(df.index, records):
        for rule in rules:
            violation = rule.validate(row_dict)
            if violation:
                violation["row"] = int(idx)
                results["violations"].append(violation)
                
                severity_count[violation["severity"]] = severity_count.get(violation["severity"], 0) + 1
                category_count[violation["category"]] = category_count.get(violation["category"], 0) + 1
    
    results["summary"] = {
        "total_violations": len(results["violations"]),
        "by_severity": severity_count,
        "by_category": category_count,
        "has_errors": severity_count.get("error", 0) > 0,
        "has_warnings": severity_count.get("warning", 0) > 0,
    }
    
    # Log hasil
    logger.info(
        f"Validasi selesai: {len(df)} rows, "
        f"{len(results['violations'])} violations "
        f"({severity_count.get('error', 0)} errors, {severity_count.get('warning', 0)} warnings)"
    )
    
    return results


def get_violations_summary(violations: List[Dict]) -> Dict[str, Any]:
    """Dapatkan summary dari violations"""
    if not violations:
        return {"total": 0, "by_rule": {}, "by_severity": {}}
    
    summary = {
        "total": len(violations),
        "by_rule": {},
        "by_severity": {"error": 0, "warning": 0, "info": 0},
        "top_rows": [],
    }
    
    row_counts = {}
    for v in violations:
        rule_name = v.get("rule", "unknown")
        summary["by_rule"][rule_name] = summary["by_rule"].get(rule_name, 0) + 1
        summary["by_severity"][v.get("severity", "info")] += 1
        
        row = v.get("row", -1)
        row_counts[row] = row_counts.get(row, 0) + 1
    
    # Top rows with most violations
    summary["top_rows"] = sorted(row_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    
    return summary