"""
modules/progress.py
====================
Progress bar & monitoring untuk batch processing
"""

import time
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
from dataclasses import dataclass, field

from .logging_config import get_module_logger

logger = get_module_logger("progress")


@dataclass
class ProgressTracker:
    """Tracker untuk progress processing"""
    total: int = 0
    current: int = 0
    current_item: str = ""
    status: str = "idle"  # idle, running, completed, failed
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    errors: List[Dict] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def percent(self) -> float:
        """Persentase progress"""
        if self.total == 0:
            return 0.0
        return (self.current / self.total) * 100
    
    @property
    def elapsed_time(self) -> Optional[float]:
        """Waktu yang sudah berjalan (detik)"""
        if self.start_time is None:
            return None
        end = self.end_time or datetime.now()
        return (end - self.start_time).total_seconds()
    
    @property
    def estimated_remaining(self) -> Optional[float]:
        """Estimasi waktu tersisa (detik)"""
        if self.elapsed_time is None or self.current == 0:
            return None
        if self.total == 0:
            return 0
        remaining = self.total - self.current
        rate = self.current / self.elapsed_time
        if rate == 0:
            return None
        return remaining / rate
    
    def update(self, current: int = None, current_item: str = None):
        """Update progress"""
        if current is not None:
            self.current = current
        if current_item is not None:
            self.current_item = current_item
        
        # Log progress setiap 10%
        if self.total > 0:
            prev_percent = ((self.current - 1) / self.total * 100) if self.current > 0 else 0
            current_percent = (self.current / self.total * 100)
            if int(current_percent) > int(prev_percent) and int(current_percent) % 10 == 0:
                logger.info(f"📊 Progress: {current_percent:.0f}% - {self.current_item or 'Processing...'}")
    
    def start(self, total: int, description: str = "Processing"):
        """Mulai tracking"""
        self.total = total
        self.current = 0
        self.status = "running"
        self.start_time = datetime.now()
        self.end_time = None
        self.errors = []
        self.current_item = description
        logger.info(f"⏳ Starting: {description} ({total} items)")
    
    def complete(self, description: str = "Completed"):
        """Selesai tracking"""
        self.status = "completed"
        self.end_time = datetime.now()
        self.current_item = description
        duration = self.elapsed_time
        logger.info(f"✅ {description} - Duration: {duration:.2f}s, Items: {self.current}/{self.total}")
    
    def fail(self, error: str):
        """Gagal tracking"""
        self.status = "failed"
        self.end_time = datetime.now()
        self.errors.append({"error": error, "time": datetime.now().isoformat()})
        logger.error(f"❌ Failed: {error}")
    
    def add_error(self, error: str, details: Optional[Dict] = None):
        """Tambahkan error"""
        self.errors.append({
            "error": error,
            "details": details or {},
            "time": datetime.now().isoformat(),
            "current_item": self.current_item,
            "progress": self.percent,
        })
        logger.warning(f"⚠️ Error at {self.percent:.1f}%: {error}")
    
    def to_dict(self) -> Dict:
        """Konversi ke dict"""
        return {
            "total": self.total,
            "current": self.current,
            "percent": self.percent,
            "status": self.status,
            "current_item": self.current_item,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "elapsed_time": self.elapsed_time,
            "estimated_remaining": self.estimated_remaining,
            "errors": self.errors,
            "metadata": self.metadata,
        }


def batch_process_with_progress(
    items: List[Any],
    process_func: Callable,
    description: str = "Processing",
    batch_size: int = 10,
    callback: Optional[Callable] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Proses batch dengan progress tracking
    
    Args:
        items: List item yang diproses
        process_func: Fungsi untuk memproses satu item
        description: Deskripsi proses
        batch_size: Ukuran batch untuk log progress
        callback: Callback untuk update progress (function(current, total, item))
        **kwargs: Argumen tambahan untuk process_func
    
    Returns:
        Dict dengan hasil processing
    """
    tracker = ProgressTracker()
    tracker.start(len(items), description)
    
    results = []
    errors = []
    
    for i, item in enumerate(items):
        try:
            result = process_func(item, **kwargs)
            results.append(result)
            
            # Update tracker
            tracker.current = i + 1
            tracker.current_item = str(item)[:50] if item else ""
            tracker.update()
            
            # Callback
            if callback:
                callback(i + 1, len(items), item)
            
            # Log setiap batch
            if (i + 1) % batch_size == 0:
                logger.info(f"📊 Batch {i+1}/{len(items)} - {tracker.percent:.1f}%")
                
        except Exception as e:
            errors.append({
                "item": item,
                "error": str(e),
                "index": i,
            })
            tracker.add_error(str(e), {"item": item, "index": i})
    
    tracker.complete(description)
    
    return {
        "tracker": tracker.to_dict(),
        "results": results,
        "errors": errors,
        "success_count": len(results),
        "error_count": len(errors),
        "total_count": len(items),
    }


class ProgressCallback:
    """Callback untuk progress dengan multiple steps"""
    
    def __init__(self, total_steps: int, description: str = "Processing"):
        self.total = total_steps
        self.current = 0
        self.description = description
        self.step_messages: Dict[int, str] = {}
        self.start_time = datetime.now()
    
    def set_step_message(self, step: int, message: str):
        """Set message untuk step tertentu"""
        self.step_messages[step] = message
        # PERBAIKAN: Update description jika step sesuai dengan current
        if self.current == step:
            self.description = message
    
    def update(self, step: int = None, message: Optional[str] = None):
        """Update progress"""
        if step is not None:
            self.current = step
        if message:
            self.description = message
        elif self.current in self.step_messages:
            self.description = self.step_messages[self.current]
        
        percent = (self.current / self.total) * 100 if self.total > 0 else 0
        logger.info(f"📊 {percent:.1f}% - {self.description}")
    
    def get_progress(self) -> Dict:
        """Dapatkan status progress"""
        return {
            "current": self.current,
            "total": self.total,
            "percent": (self.current / self.total * 100) if self.total > 0 else 0,
            "description": self.description,
            "elapsed": (datetime.now() - self.start_time).total_seconds(),
        }