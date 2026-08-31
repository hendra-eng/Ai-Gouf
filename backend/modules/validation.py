"""
modules/validation.py
======================
Data validation untuk COA dan transaksi
"""

import math
import pandas as pd
from typing import Tuple, List, Dict, Any, Optional
from datetime import datetime

from .logging_config import get_module_logger

logger = get_module_logger("validation")


# Schema validation untuk COA
COA_SCHEMA = {
    "required_columns": ["no_akun", "nama_akun"],
    "optional_columns": ["kategori", "tipe", "saldo_awal", "parent"],
    "column_types": {
        "no_akun": ["str", "int", "float"],
        "nama_akun": ["str"],
        "kategori": ["str"],
        "saldo_awal": ["int", "float"],
    },
    "rules": {
        "no_akun": {
            "unique": True,
            "not_null": True,
            "min_length": 1,
            "max_length": 20,
        },
        "nama_akun": {
            "not_null": True,
            "min_length": 1,
            "max_length": 100,
        },
        "kategori": {
            "allowed_values": ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"]
        }
    }
}


def validate_coa(df: pd.DataFrame) -> Tuple[bool, List[str]]:
    """
    Validasi struktur dan data COA
    
    Args:
        df: DataFrame COA
    
    Returns:
        (is_valid, list_of_errors)
    """
    errors = []
    warnings = []
    
    if df is None or df.empty:
        errors.append("❌ COA tidak boleh kosong")
        return False, errors
    
    # 1. Cek kolom wajib
    required = COA_SCHEMA["required_columns"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        errors.append(f"❌ Kolom wajib tidak ditemukan: {missing}")
        return False, errors
    
    # 2. Cek no_akun
    if "no_akun" in df.columns:
        # Tidak boleh null
        null_count = df["no_akun"].isna().sum()
        if null_count > 0:
            errors.append(f"❌ Ada {null_count} no_akun yang kosong (null)")
        
        # Tidak boleh duplikat
        duplicates = df["no_akun"].duplicated()
        if duplicates.any():
            dup_values = df[duplicates]["no_akun"].tolist()[:5]
            msg = f"❌ No akun duplikat: {dup_values}"
            if len(df[duplicates]["no_akun"].tolist()) > 5:
                msg += f" dan {len(df[duplicates]['no_akun'].tolist()) - 5} lainnya"
            errors.append(msg)
        
        # Cek tipe data
        for idx, val in df["no_akun"].items():
            if pd.notna(val) and not isinstance(val, (str, int, float)):
                errors.append(f"❌ Row {idx}: no_akun harus string atau number, got {type(val)}")
        
        # Cek panjang
        long_codes = df[df["no_akun"].astype(str).str.len() > 20]
        if not long_codes.empty:
            warnings.append(f"⚠️ Ada {len(long_codes)} no_akun > 20 karakter")
    
    # 3. Cek nama_akun
    if "nama_akun" in df.columns:
        # Tidak boleh null
        if df["nama_akun"].isna().any():
            errors.append("❌ Ada nama_akun yang kosong (null)")
        
        # Tidak boleh kosong
        empty_names = df[df["nama_akun"].astype(str).str.strip() == ""]
        if not empty_names.empty:
            errors.append(f"❌ Ada {len(empty_names)} nama_akun yang kosong")
        
        # Cek panjang
        long_names = df[df["nama_akun"].astype(str).str.len() > 100]
        if not long_names.empty:
            warnings.append(f"⚠️ Ada {len(long_names)} nama_akun > 100 karakter")
    
    # 4. Cek kategori (opsional)
    if "kategori" in df.columns:
        if df["kategori"].isna().all():
            warnings.append("⚠️ Kolom kategori semua null (kosong)")
        else:
            allowed = COA_SCHEMA["rules"]["kategori"]["allowed_values"]
            invalid = df[~df["kategori"].isin(allowed)]
            if not invalid.empty:
                warnings.append(f"⚠️ Ada {len(invalid)} kategori tidak standar: {invalid['kategori'].unique().tolist()}")
    
    # Log hasil
    if errors:
        logger.warning(f"❌ Validasi COA gagal: {len(errors)} error, {len(warnings)} warning")
        for err in errors:
            logger.warning(f"  {err}")
    else:
        if warnings:
            logger.info(f"⚠️ Validasi COA dengan warning: {len(warnings)} warning")
        else:
            logger.info(f"✅ Validasi COA berhasil: {len(df)} akun")
    
    return len(errors) == 0, errors + warnings


def validate_transaction(row: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validasi satu baris transaksi
    
    Args:
        row: Dict berisi data transaksi
    
    Returns:
        (is_valid, list_of_errors)
    """
    errors = []
    warnings = []
    
    # 1. Cek nilai mutasi
    # [FIX] Sebelumnya: `row.get("mutasi_debet") or row.get("jml_debet") or 0`
    # lalu di-float() belakangan. Kalau mutasi_debet nilainya NaN (bukan
    # None -- ini yang biasa terjadi setelah beberapa sheet digabung lewat
    # pandas.concat), "nan or row.get(...)" mengembalikan nan itu sendiri
    # (NaN dianggap truthy di Python), jadi fallback ke jml_debet/0 TIDAK
    # PERNAH kepakai. float(nan) berhasil (jadi nan, bukan error), lolos
    # dari try/except di bawah, lalu semua pengecekan nominal setelah ini
    # (negatif, sama-sama 0, dst) diam-diam tidak pernah kena karena
    # `nan < 0` dan `nan == 0` selalu False -- baris rusak lolos tanpa
    # peringatan sama sekali.
    def _angka_mentah(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        return v

    debet = _angka_mentah(row.get("mutasi_debet"))
    if debet is None:
        debet = _angka_mentah(row.get("jml_debet"))
    if debet is None:
        debet = 0

    kredit = _angka_mentah(row.get("mutasi_kredit"))
    if kredit is None:
        kredit = _angka_mentah(row.get("jml_kredit"))
    if kredit is None:
        kredit = 0

    try:
        debet = float(debet)
        kredit = float(kredit)
        if pd.isna(debet) or math.isinf(debet):
            debet = 0.0
        if pd.isna(kredit) or math.isinf(kredit):
            kredit = 0.0
    except (TypeError, ValueError):
        errors.append("❌ Nominal mutasi tidak valid (bukan angka)")
        return False, errors
    
    if debet < 0 or kredit < 0:
        errors.append("❌ Nominal mutasi tidak boleh negatif")
    
    # 2. Cek debet dan kredit tidak sama-sama 0
    if debet == 0 and kredit == 0:
        warnings.append("⚠️ Debet dan kredit sama-sama 0 (transaksi kosong)")
    
    # 3. Cek akun
    no_debet = row.get("no_akun_debet")
    no_kredit = row.get("no_akun_kredit")
    
    if no_debet is None and no_kredit is None:
        errors.append("❌ No akun debet dan kredit kosong")
    elif no_debet == no_kredit:
        if no_debet is not None:
            errors.append(f"❌ No akun debet dan kredit sama: {no_debet}")
    
    # 4. Cek tanggal
    tanggal = row.get("tanggal")
    if tanggal is not None:
        try:
            if isinstance(tanggal, str):
                pd.to_datetime(tanggal)
            elif isinstance(tanggal, (int, float)):
                # Mungkin timestamp
                datetime.fromtimestamp(tanggal)
        except:
            warnings.append(f"⚠️ Format tanggal tidak valid: {tanggal}")
    
    # 5. Cek keterangan
    keterangan = row.get("keterangan")
    if keterangan is None or (isinstance(keterangan, float) and pd.isna(keterangan)):
        warnings.append("⚠️ Keterangan kosong")
    elif isinstance(keterangan, str) and len(keterangan.strip()) == 0:
        warnings.append("⚠️ Keterangan kosong")
    
    return len(errors) == 0, errors + warnings


class DataValidator:
    """
    Validator untuk data batch
    """
    
    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.errors = []
        self.warnings = []
        self.stats = {}
    
    def validate_all(self) -> Dict[str, Any]:
        """Validasi semua baris"""
        total_rows = len(self.df)
        
        for idx, row in self.df.iterrows():
            is_valid, issues = validate_transaction(row.to_dict())
            if not is_valid:
                self.errors.append({
                    "row": int(idx),
                    "errors": [i for i in issues if i.startswith("❌")],
                    "warnings": [i for i in issues if i.startswith("⚠️")],
                })
            else:
                warnings = [i for i in issues if i.startswith("⚠️")]
                if warnings:
                    self.warnings.append({
                        "row": int(idx),
                        "warnings": warnings,
                    })
        
        # Cek duplikat
        self._check_duplicates()
        
        # Cek balance
        self._check_balance()
        
        # Statistik
        self.stats = {
            "total_rows": total_rows,
            "valid_rows": total_rows - len(self.errors),
            "error_rows": len(self.errors),
            "warning_rows": len(self.warnings),
            "valid_percentage": ((total_rows - len(self.errors)) / total_rows * 100) if total_rows > 0 else 0,
        }
        
        return {
            "is_valid": len(self.errors) == 0,
            "stats": self.stats,
            "errors": self.errors[:50],  # Limit untuk display
            "warnings": self.warnings[:50],
        }
    
    def _check_duplicates(self):
        """Cek transaksi duplikat"""
        cols = ["tanggal", "keterangan", "mutasi_debet", "mutasi_kredit"]
        available = [col for col in cols if col in self.df.columns]
        
        if available:
            duplicates = self.df.duplicated(subset=available, keep=False)
            if duplicates.any():
                dup_count = duplicates.sum()
                self.warnings.append({
                    "row": -1,
                    "warnings": [f"⚠️ Terdapat {dup_count} transaksi duplikat"]
                })
    
    def _check_balance(self):
        """Cek keseimbangan jurnal"""
        if "jml_debet" in self.df.columns and "jml_kredit" in self.df.columns:
            total_debet = self.df["jml_debet"].sum()
            total_kredit = self.df["jml_kredit"].sum()
            
            if "jml_kredit_ppn" in self.df.columns:
                total_kredit += self.df["jml_kredit_ppn"].sum()
            
            selisih = abs(total_debet - total_kredit)
            if selisih > 1.0:
                self.warnings.append({
                    "row": -1,
                    "warnings": [
                        f"⚠️ Jurnal tidak balance: Debet {total_debet:,.0f} vs Kredit {total_kredit:,.0f} "
                        f"(selisih {selisih:,.0f})"
                    ]
                })
            else:
                self.warnings.append({
                    "row": -1,
                    "warnings": [
                        f"✅ Jurnal balance: Debet {total_debet:,.0f} = Kredit {total_kredit:,.0f}"
                    ]
                })