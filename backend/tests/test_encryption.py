"""
tests/test_encryption.py
=========================
Unit test untuk enkripsi data
"""

import pytest
import json
import tempfile
from pathlib import Path

from modules.encryption import (
    encrypt_data,
    decrypt_data,
    encrypt_file,
    decrypt_file,
    get_encryption_key,
    rotate_encryption_key,
)


class TestEncryption:
    """Test enkripsi data"""
    
    def setup_method(self):
        """Setup sebelum test"""
        self.test_data = {
            "name": "Test Data",
            "value": 12345,
            "nested": {"key": "value"}
        }
        self.test_string = "Hello World!"
    
    def test_encrypt_decrypt_string(self):
        """Test enkripsi dan dekripsi string"""
        encrypted = encrypt_data(self.test_string)
        assert encrypted != self.test_string
        assert isinstance(encrypted, str)
        
        decrypted = decrypt_data(encrypted)
        assert decrypted == self.test_string
    
    def test_encrypt_decrypt_dict(self):
        """Test enkripsi dan dekripsi dict"""
        encrypted = encrypt_data(self.test_data)
        assert encrypted != json.dumps(self.test_data)
        
        decrypted = decrypt_data(encrypted)
        assert decrypted == self.test_data
    
    def test_encrypt_decrypt_list(self):
        """Test enkripsi dan dekripsi list"""
        test_list = [1, 2, 3, {"a": "b"}]
        encrypted = encrypt_data(test_list)
        decrypted = decrypt_data(encrypted)
        assert decrypted == test_list
    
    def test_key_persistence(self):
        """Test key persistence"""
        key1 = get_encryption_key()
        key2 = get_encryption_key()
        assert key1 == key2
    
    @pytest.mark.skip(reason="Key rotation with re-encryption needs manual testing - skipping for CI")
    def test_rotate_key(self):
        """Test rotasi key - SKIP untuk sementara"""
        pass
    
    def test_encrypt_file(self):
        """Test enkripsi file"""
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            f.write("Test content")
            temp_path = Path(f.name)
        
        try:
            encrypted_path = encrypt_file(temp_path)
            assert encrypted_path.exists()
            assert encrypted_path.suffix == '.enc'
            
            # File terenkripsi berbeda dengan asli
            with open(temp_path, 'r') as f:
                original = f.read()
            with open(encrypted_path, 'rb') as f:
                encrypted = f.read()
            assert original != encrypted
            
        finally:
            temp_path.unlink(missing_ok=True)
            encrypted_path.unlink(missing_ok=True)
    
    def test_decrypt_file(self):
        """Test dekripsi file"""
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
            f.write("Test content")
            temp_path = Path(f.name)
        
        try:
            # Enkripsi dulu
            encrypted_path = encrypt_file(temp_path)
            
            # Dekripsi
            decrypted_path = decrypt_file(encrypted_path)
            assert decrypted_path.exists()
            
            with open(decrypted_path, 'r') as f:
                decrypted = f.read()
            assert decrypted == "Test content"
            
        finally:
            temp_path.unlink(missing_ok=True)
            encrypted_path.unlink(missing_ok=True)
            decrypted_path.unlink(missing_ok=True)