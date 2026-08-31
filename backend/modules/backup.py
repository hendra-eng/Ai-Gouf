"""
modules/backup.py
==================
Auto-backup & restore untuk data AI Gouf Consulting
"""

import json
import os
import shutil
import pickle
import gzip
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

from .logging_config import get_module_logger

logger = get_module_logger("backup")

# Konfigurasi
BACKUP_DIR = Path("backups")
BACKUP_DIR.mkdir(exist_ok=True)

DEFAULT_FILES = [
    "pola_belajar.json",
    "evaluasi_pola.json",
    "hasil_tersimpan.pkl",
    "riwayat_chat_tersimpan.pkl",
]

BACKUP_RETENTION_DAYS = 30
MAX_BACKUPS = 50  # Maksimum jumlah backup


class BackupManager:
    """Manager untuk backup dan restore data"""
    
    def __init__(self, backup_dir: Path = BACKUP_DIR):
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(exist_ok=True)
    
    def create_backup(
        self, 
        files: Optional[List[str]] = None, 
        compress: bool = True,
        description: str = ""
    ) -> Dict[str, Any]:
        """
        Buat backup semua file penting
        
        Args:
            files: List file yang akan di-backup
            compress: Kompres dengan gzip
            description: Deskripsi backup
        
        Returns:
            Dict dengan informasi backup
        """
        if files is None:
            files = DEFAULT_FILES
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_folder = self.backup_dir / timestamp
        backup_folder.mkdir(exist_ok=True)
        
        backed_up = []
        failed = []
        file_sizes = {}
        
        for file in files:
            src = Path(file)
            if not src.exists():
                logger.warning(f"File tidak ditemukan: {file}")
                failed.append({"file": file, "error": "File tidak ditemukan"})
                continue
            
            try:
                original_size = src.stat().st_size
                dst = backup_folder / file
                
                if compress and src.suffix in ['.json', '.pkl']:
                    # Kompres dengan gzip
                    dst = dst.with_suffix(dst.suffix + '.gz')
                    with open(src, 'rb') as f_in:
                        with gzip.open(dst, 'wb', compresslevel=6) as f_out:
                            shutil.copyfileobj(f_in, f_out)
                    compressed_size = dst.stat().st_size
                    file_sizes[file] = {
                        "original": original_size,
                        "compressed": compressed_size,
                        "ratio": f"{(compressed_size/original_size*100):.1f}%"
                    }
                else:
                    shutil.copy2(src, dst)
                    file_sizes[file] = {"original": original_size, "compressed": original_size}
                
                backed_up.append(str(dst))
                logger.info(f"✅ Backup: {file} -> {dst}")
                
            except Exception as e:
                failed.append({"file": file, "error": str(e)})
                logger.error(f"❌ Gagal backup {file}: {e}")
        
        # Simpan metadata backup
        metadata = {
            "timestamp": timestamp,
            "datetime": datetime.now().isoformat(),
            "description": description,
            "files": backed_up,
            "failed": failed,
            "source_files": files,
            "compressed": compress,
            "file_sizes": file_sizes,
            "total_files": len(backed_up),
            "total_failed": len(failed),
        }
        
        metadata_file = backup_folder / "backup_metadata.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, default=str, ensure_ascii=False)
        
        # Hapus backup lama
        self._cleanup_old_backups()
        
        logger.info(f"📦 Backup completed: {timestamp} ({len(backed_up)} files)")
        return metadata
    
    def restore_backup(
        self, 
        timestamp: str, 
        target_dir: Optional[Path] = None,
        files: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Restore data dari backup
        
        Args:
            timestamp: Timestamp backup (format: YYYYMMDD_HHMMSS)
            target_dir: Direktori tujuan (default: current directory)
            files: List file spesifik yang direstore
        
        Returns:
            Dict dengan hasil restore
        """
        backup_folder = self.backup_dir / timestamp
        if not backup_folder.exists():
            raise FileNotFoundError(f"Backup tidak ditemukan: {timestamp}")
        
        if target_dir is None:
            target_dir = Path.cwd()
        
        target_dir = Path(target_dir)
        target_dir.mkdir(exist_ok=True)
        
        restored = []
        failed = []
        
        # Baca metadata
        metadata_file = backup_folder / "backup_metadata.json"
        if metadata_file.exists():
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        else:
            metadata = {"source_files": DEFAULT_FILES}
        
        # Tentukan file yang direstore
        if files is None:
            files = metadata.get("source_files", DEFAULT_FILES)
        
        for file in files:
            # Cari file di backup (dengan atau tanpa .gz)
            src_candidates = [
                backup_folder / file,
                backup_folder / (file + '.gz'),
            ]
            
            src = None
            for candidate in src_candidates:
                if candidate.exists():
                    src = candidate
                    break
            
            if src is None:
                failed.append({"file": file, "error": "File tidak ditemukan di backup"})
                continue
            
            # Tentukan nama file asli (tanpa .gz)
            dst_name = src.stem if src.suffix == '.gz' else src.name
            dst = target_dir / dst_name
            
            try:
                if src.suffix == '.gz':
                    # Decompress
                    with gzip.open(src, 'rb') as f_in:
                        with open(dst, 'wb') as f_out:
                            shutil.copyfileobj(f_in, f_out)
                else:
                    shutil.copy2(src, dst)
                
                restored.append(str(dst))
                logger.info(f"✅ Restore: {src} -> {dst}")
                
            except Exception as e:
                failed.append({"file": str(src), "error": str(e)})
                logger.error(f"❌ Gagal restore {src}: {e}")
        
        result = {
            "timestamp": timestamp,
            "restored": restored,
            "failed": failed,
            "target_dir": str(target_dir),
            "total_restored": len(restored),
            "total_failed": len(failed),
        }
        
        logger.info(f"📂 Restore completed: {len(restored)} files")
        return result
    
    def list_backups(self) -> List[Dict[str, Any]]:
        """List semua backup yang tersedia"""
        backups = []
        
        for folder in sorted(self.backup_dir.iterdir(), reverse=True):
            if not folder.is_dir():
                continue
            
            metadata_file = folder / "backup_metadata.json"
            if metadata_file.exists():
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                metadata["folder"] = str(folder)
                metadata["size"] = sum(
                    f.stat().st_size for f in folder.glob("*") if f.is_file()
                )
                backups.append(metadata)
            else:
                # Backup tanpa metadata
                files = list(folder.glob("*"))
                backups.append({
                    "timestamp": folder.name,
                    "folder": str(folder),
                    "files": [str(f) for f in files],
                    "datetime": folder.name.replace("_", "T"),
                    "size": sum(f.stat().st_size for f in files if f.is_file()),
                })
        
        return backups
    
    def delete_backup(self, timestamp: str) -> bool:
        """Hapus backup tertentu"""
        backup_folder = self.backup_dir / timestamp
        if not backup_folder.exists():
            return False
        
        try:
            shutil.rmtree(backup_folder)
            logger.info(f"🗑️ Backup deleted: {timestamp}")
            return True
        except Exception as e:
            logger.error(f"❌ Gagal hapus backup {timestamp}: {e}")
            return False
    
    def _cleanup_old_backups(self):
        """Hapus backup lebih dari BACKUP_RETENTION_DAYS"""
        cutoff = datetime.now() - timedelta(days=BACKUP_RETENTION_DAYS)
        deleted = 0
        
        for folder in self.backup_dir.iterdir():
            if not folder.is_dir():
                continue
            
            try:
                ts = datetime.strptime(folder.name, "%Y%m%d_%H%M%S")
                if ts < cutoff:
                    shutil.rmtree(folder)
                    deleted += 1
                    logger.info(f"🗑️ Backup lama dihapus: {folder}")
            except ValueError:
                continue
        
        if deleted:
            logger.info(f"🧹 Cleaned up {deleted} old backups")


# Convenience functions
def auto_backup(description: str = "") -> Dict[str, Any]:
    """Auto backup dengan konfigurasi default"""
    manager = BackupManager()
    return manager.create_backup(description=description)


def restore_backup(timestamp: str) -> Dict[str, Any]:
    """Restore backup dengan timestamp tertentu"""
    manager = BackupManager()
    return manager.restore_backup(timestamp)


def list_backups() -> List[Dict[str, Any]]:
    """List semua backup yang tersedia"""
    manager = BackupManager()
    return manager.list_backups()


def delete_backup(timestamp: str) -> bool:
    """Hapus backup tertentu"""
    manager = BackupManager()
    return manager.delete_backup(timestamp)