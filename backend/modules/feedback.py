"""
modules/feedback.py
====================
AI training feedback loop - kumpulkan feedback user untuk retraining
"""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
from collections import defaultdict

import pandas as pd

from .logging_config import get_module_logger

logger = get_module_logger("feedback")

FEEDBACK_FILE = "user_feedback.jsonl"
FEEDBACK_DIR = Path("feedback_data")
FEEDBACK_DIR.mkdir(exist_ok=True)


class FeedbackCollector:
    """Collector untuk feedback user"""
    
    def __init__(self, feedback_file: str = FEEDBACK_FILE):
        self.feedback_file = Path(feedback_file)
        self.feedback_file.parent.mkdir(exist_ok=True)
        self._cache = []
        self._load_cache()
    
    def _load_cache(self):
        """Load feedback dari file ke cache"""
        if not self.feedback_file.exists():
            return
        
        try:
            with open(self.feedback_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        self._cache.append(json.loads(line))
            logger.info(f"📂 Loaded {len(self._cache)} feedback entries")
        except Exception as e:
            logger.error(f"❌ Failed to load feedback: {e}")
    
    def add_feedback(
        self,
        original: Dict[str, Any],
        corrected: Dict[str, Any],
        user: Optional[str] = None,
        context: Optional[Dict] = None
    ) -> bool:
        """
        Tambahkan feedback user
        
        Args:
            original: Data asli sebelum koreksi
            corrected: Data setelah koreksi
            user: Nama user (optional)
            context: Konteks tambahan
        
        Returns:
            bool: Success status
        """
        try:
            # Extract signature
            signature = self._extract_signature(original.get("keterangan", ""))
            
            feedback = {
                "id": datetime.now().strftime("%Y%m%d_%H%M%S_%f"),
                "timestamp": datetime.now().isoformat(),
                "user": user or "unknown",
                "signature": signature,
                "original": original,
                "corrected": corrected,
                "context": context or {},
                "changes": self._calculate_changes(original, corrected),
                "metadata": {
                    "version": "1.0",
                    "source": "user_correction",
                }
            }
            
            # Simpan ke cache dan file
            self._cache.append(feedback)
            self._append_to_file(feedback)
            
            logger.info(f"✅ Feedback added: {signature} by {user or 'unknown'}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to add feedback: {e}")
            return False
    
    def _append_to_file(self, feedback: Dict):
        """Append feedback ke file"""
        try:
            with open(self.feedback_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(feedback, default=str, ensure_ascii=False) + '\n')
        except Exception as e:
            logger.error(f"❌ Failed to save feedback: {e}")
    
    def _extract_signature(self, keterangan: str) -> str:
        """Ekstrak signature dari keterangan"""
        if not keterangan:
            return "TIDAK_ADA_KETERANGAN"
        
        try:
            import re
            t = str(keterangan).upper().strip()
            if not t:
                return "TIDAK_ADA_KETERANGAN"
            token = t.split(" ")[0].split("/")[0]
            token = re.sub(r"[0-9]+$", "", token)
            return token if token else "TIDAK_ADA_KETERANGAN"
        except:
            return "TIDAK_ADA_KETERANGAN"
    
    def _calculate_changes(self, original: Dict, corrected: Dict) -> Dict:
        """Hitung perubahan antara original dan corrected"""
        changes = {}
        
        # Bandingkan akun
        for key in ["no_akun_debet", "no_akun_kredit", "nama_akun_debet", "nama_akun_kredit"]:
            if original.get(key) != corrected.get(key):
                changes[key] = {
                    "from": original.get(key),
                    "to": corrected.get(key),
                }
        
        # Bandingkan nominal
        for key in ["jml_debet", "jml_kredit"]:
            if original.get(key) != corrected.get(key):
                changes[key] = {
                    "from": original.get(key),
                    "to": corrected.get(key),
                }
        
        return changes
    
    def get_feedback(
        self,
        signature: Optional[str] = None,
        limit: int = 100,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict]:
        """
        Dapatkan feedback dengan filter
        
        Args:
            signature: Filter by signature
            limit: Maksimum jumlah
            start_date: Filter tanggal mulai
            end_date: Filter tanggal akhir
        
        Returns:
            List feedback
        """
        results = self._cache
        
        if signature:
            results = [f for f in results if f.get("signature") == signature]
        
        if start_date:
            results = [f for f in results if f.get("timestamp", "") >= start_date]
        
        if end_date:
            results = [f for f in results if f.get("timestamp", "") <= end_date]
        
        return results[:limit]
    
    def get_statistics(self) -> Dict[str, Any]:
        """Dapatkan statistik feedback"""
        stats = {
            "total_feedback": len(self._cache),
            "unique_signatures": len(set(f.get("signature", "unknown") for f in self._cache)),
            "by_signature": defaultdict(int),
            "by_user": defaultdict(int),
            "last_7_days": 0,
        }
        
        # Hitung per signature
        for f in self._cache:
            sig = f.get("signature", "unknown")
            stats["by_signature"][sig] += 1
            user = f.get("user", "unknown")
            stats["by_user"][user] += 1
        
        # Last 7 days
        seven_days_ago = datetime.now().timestamp() - (7 * 24 * 3600)
        stats["last_7_days"] = sum(
            1 for f in self._cache 
            if f.get("timestamp") and 
            datetime.fromisoformat(f.get("timestamp")).timestamp() > seven_days_ago
        )
        
        return stats


def collect_feedback(
    original: Dict[str, Any],
    corrected: Dict[str, Any],
    user: Optional[str] = None,
    context: Optional[Dict] = None
) -> bool:
    """
    Convenience function untuk collect feedback
    
    Args:
        original: Data asli
        corrected: Data setelah koreksi
        user: Nama user
        context: Konteks tambahan
    
    Returns:
        bool: Success status
    """
    collector = FeedbackCollector()
    return collector.add_feedback(original, corrected, user, context)


def retrain_with_feedback(pola, feedback_file: Optional[str] = None):
    """
    Retrain pola dengan feedback user
    
    Args:
        pola: Objek Pola yang akan diupdate
        feedback_file: File feedback (default: FEEDBACK_FILE)
    
    Returns:
        Pola yang sudah diupdate
    """
    from akuntansi_ai import Pola, gabung_pola
    
    if feedback_file is None:
        feedback_file = FEEDBACK_FILE
    
    if not os.path.exists(feedback_file):
        logger.warning("No feedback file found")
        return pola
    
    try:
        # Load feedback
        feedbacks = []
        with open(feedback_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    feedbacks.append(json.loads(line))
        
        if not feedbacks:
            logger.info("No feedback entries found")
            return pola
        
        # Build new patterns from feedback
        new_pola = Pola()
        for fb in feedbacks:
            if "changes" not in fb:
                continue
            
            signature = fb.get("signature", "TIDAK_ADA_KETERANGAN")
            arah = "KELUAR" if fb.get("original", {}).get("mutasi_kredit", 0) > 0 else "MASUK"
            corrected = fb.get("corrected", {})
            
            # Tambahkan ke pola baru
            key = (signature, arah)
            if key not in new_pola.aturan:
                new_pola.aturan[key] = {
                    "no_akun_debet": corrected.get("no_akun_debet"),
                    "nama_akun_debet": corrected.get("nama_akun_debet"),
                    "no_akun_kredit": corrected.get("no_akun_kredit"),
                    "nama_akun_kredit": corrected.get("nama_akun_kredit"),
                    "konsisten": True,
                    "jumlah_contoh": 1,
                    "confidence_score": 0.9,  # High confidence from user feedback
                    "is_valid": True,
                    "source": "user_feedback",
                    "feedback_id": fb.get("id"),
                    "last_updated": datetime.now().isoformat(),
                }
            else:
                # Update existing
                new_pola.aturan[key]["jumlah_contoh"] += 1
                new_pola.aturan[key]["confidence_score"] = min(
                    0.95, new_pola.aturan[key]["confidence_score"] + 0.05
                )
        
        # Gabungkan dengan pola existing
        updated_pola = gabung_pola(pola, new_pola)
        logger.info(f"✅ Retrained with {len(feedbacks)} feedback entries")
        
        return updated_pola
        
    except Exception as e:
        logger.error(f"❌ Retrain failed: {e}")
        return pola


def get_feedback_statistics() -> Dict[str, Any]:
    """Dapatkan statistik feedback"""
    collector = FeedbackCollector()
    return collector.get_statistics()