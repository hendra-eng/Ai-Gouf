"""
modules/encryption.py
======================
Enkripsi data sensitif (PII) menggunakan Fernet
"""

import os
import json
import base64
from pathlib import Path
from typing import Optional, Any, Union, List

try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    raise ImportError(
        "❌ cryptography library required. Install: pip install cryptography"
    )

from .logging_config import get_module_logger

logger = get_module_logger("encryption")

# Konfigurasi
KEY_FILE = Path("encryption.key")
SALT_FILE = Path("encryption.salt")

# SALT default
DEFAULT_SALT = b"ai_gouf_salt_2024_v2"


def get_encryption_key(password: Optional[str] = None) -> bytes:
    """
    Dapatkan atau buat key enkripsi
    
    Args:
        password: Password untuk derivasi key (optional)
    
    Returns:
        Key enkripsi (bytes)
    """
    # Coba load dari file
    if KEY_FILE.exists():
        try:
            with open(KEY_FILE, 'rb') as f:
                key = f.read()
                # Validasi key
                if len(key) == 44:  # Fernet key length
                    return key
        except:
            logger.warning("Key file corrupted, generating new key")
    
    # Buat key baru
    if password:
        # Derive key dari password
        salt = _get_salt()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    else:
        # Generate random key
        key = Fernet.generate_key()
    
    # Simpan key
    try:
        with open(KEY_FILE, 'wb') as f:
            f.write(key)
        logger.info("✅ Encryption key created")
    except Exception as e:
        logger.error(f"❌ Failed to save encryption key: {e}")
    
    return key


def _get_salt() -> bytes:
    """Dapatkan atau buat salt"""
    if SALT_FILE.exists():
        try:
            with open(SALT_FILE, 'rb') as f:
                return f.read()
        except:
            pass
    
    # Gunakan default salt
    try:
        with open(SALT_FILE, 'wb') as f:
            f.write(DEFAULT_SALT)
    except:
        pass
    
    return DEFAULT_SALT


def encrypt_data(data: Union[Any, str]) -> str:
    """
    Enkripsi data (dict/list/string)
    
    Args:
        data: Data yang akan dienkripsi
    
    Returns:
        String terenkripsi (base64)
    """
    try:
        key = get_encryption_key()
        f = Fernet(key)
        
        # Convert ke JSON string
        if not isinstance(data, str):
            data = json.dumps(data, default=str, ensure_ascii=False)
        
        encrypted = f.encrypt(data.encode('utf-8'))
        return base64.b64encode(encrypted).decode('utf-8')
        
    except Exception as e:
        logger.error(f"❌ Encryption failed: {e}")
        raise


def decrypt_data(encrypted_data: str) -> Any:
    """
    Dekripsi data
    
    Args:
        encrypted_data: String terenkripsi (base64)
    
    Returns:
        Data yang didekripsi (dict/list/string)
    """
    try:
        key = get_encryption_key()
        f = Fernet(key)
        
        # Decode base64
        encrypted = base64.b64decode(encrypted_data.encode('utf-8'))
        decrypted = f.decrypt(encrypted).decode('utf-8')
        
        # Parse JSON jika valid
        try:
            return json.loads(decrypted)
        except json.JSONDecodeError:
            return decrypted
            
    except Exception as e:
        logger.error(f"❌ Decryption failed: {e}")
        raise


def encrypt_file(input_path: Union[str, Path], output_path: Optional[Path] = None) -> Path:
    """
    Enkripsi file
    
    Args:
        input_path: Path file input
        output_path: Path file output (default: input_path + .enc)
    
    Returns:
        Path file output
    """
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {input_path}")
    
    if output_path is None:
        output_path = input_path.with_suffix(input_path.suffix + '.enc')
    
    try:
        with open(input_path, 'rb') as f:
            data = f.read()
        
        key = get_encryption_key()
        f = Fernet(key)
        encrypted = f.encrypt(data)
        
        with open(output_path, 'wb') as f:
            f.write(encrypted)
        
        logger.info(f"✅ File encrypted: {input_path} -> {output_path}")
        return output_path
        
    except Exception as e:
        logger.error(f"❌ File encryption failed: {e}")
        raise


def decrypt_file(input_path: Union[str, Path], output_path: Optional[Path] = None) -> Path:
    """
    Dekripsi file
    
    Args:
        input_path: Path file input (.enc)
        output_path: Path file output (default: remove .enc)
    
    Returns:
        Path file output
    """
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"File not found: {input_path}")
    
    if output_path is None:
        output_path = input_path.with_suffix('') if input_path.suffix == '.enc' else input_path.with_suffix('.dec')
    
    try:
        with open(input_path, 'rb') as f:
            encrypted = f.read()
        
        key = get_encryption_key()
        f = Fernet(key)
        decrypted = f.decrypt(encrypted)
        
        with open(output_path, 'wb') as f:
            f.write(decrypted)
        
        logger.info(f"✅ File decrypted: {input_path} -> {output_path}")
        return output_path
        
    except Exception as e:
        logger.error(f"❌ File decryption failed: {e}")
        raise


def _get_encrypted_files() -> List[Path]:
    """Cari file-file terenkripsi di direktori saat ini"""
    encrypted_files = []
    for pattern in ["*.enc", "*.encrypted"]:
        encrypted_files.extend(Path().glob(pattern))
    return encrypted_files


def _reencrypt_with_new_key(old_key: bytes, new_key: bytes) -> int:
    """
    Re-encrypt semua file .enc dengan key baru
    
    Args:
        old_key: Key lama
        new_key: Key baru
    
    Returns:
        int: Jumlah file yang berhasil di-re-encrypt
    """
    try:
        old_fernet = Fernet(old_key)
        new_fernet = Fernet(new_key)
        
        encrypted_files = _get_encrypted_files()
        success_count = 0
        
        for file_path in encrypted_files:
            try:
                # Baca file terenkripsi
                with open(file_path, 'rb') as f:
                    encrypted_data = f.read()
                
                # Dekripsi dengan key lama
                decrypted_data = old_fernet.decrypt(encrypted_data)
                
                # Enkripsi dengan key baru
                new_encrypted = new_fernet.encrypt(decrypted_data)
                
                # Tulis ulang file
                with open(file_path, 'wb') as f:
                    f.write(new_encrypted)
                
                success_count += 1
                logger.info(f"✅ Re-encrypted: {file_path}")
                
            except Exception as e:
                logger.error(f"❌ Failed to re-encrypt {file_path}: {e}")
        
        return success_count
        
    except Exception as e:
        logger.error(f"❌ Re-encryption failed: {e}")
        return 0


def rotate_encryption_key(password: Optional[str] = None) -> bool:
    """
    Rotasi key enkripsi (re-encrypt all data with new key)
    
    Args:
        password: Password baru (optional)
    
    Returns:
        bool: Success status
    """
    try:
        # Backup old key
        old_key = None
        if KEY_FILE.exists():
            backup_key = KEY_FILE.with_suffix(KEY_FILE.suffix + '.bak')
            import shutil
            shutil.copy2(KEY_FILE, backup_key)
            
            # Baca key lama
            with open(KEY_FILE, 'rb') as f:
                old_key = f.read()
        
        # Generate new key
        if KEY_FILE.exists():
            os.remove(KEY_FILE)
        new_key = get_encryption_key(password)
        
        # Re-encrypt existing files jika ada key lama
        if old_key is not None:
            reencrypted_count = _reencrypt_with_new_key(old_key, new_key)
            if reencrypted_count > 0:
                logger.info(f"✅ Re-encrypted {reencrypted_count} files with new key")
        
        logger.info("✅ Encryption key rotated successfully")
        return True
        
    except Exception as e:
        logger.error(f"❌ Key rotation failed: {e}")
        return False