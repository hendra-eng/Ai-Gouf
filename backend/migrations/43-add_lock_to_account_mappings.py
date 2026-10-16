"""
migrations/43-add_lock_to_account_mappings.py
=============================================
Settings > Account Mapping: kunci per mapping.

Kolom baru di management_setting_account_mappings:
    is_locked (bool, default false), locked_at, locked_by, locked_by_name

Trigger penjaga (berlaku untuk SEMUA jalur tulis -- menu Settings, COA,
import, script, dsb.):
    trg_kunci_account_mapping  (management_setting_account_mappings)
        mapping terkunci tidak boleh dihapus atau diganti akun / key / klien-nya.
        Membuka kunci (is_locked -> false) tetap boleh.
    trg_kunci_coa_mapping      (management_client_coa)
        akun COA yang dipakai mapping terkunci tidak boleh dihapus (hard /
        soft delete), dinonaktifkan, diganti nomor / nama akun, atau dipindah klien.
Pesan error diawali "MAPPING_LOCKED:" (lihat db_client.pesan_mapping_terkunci).

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\43-add_lock_to_account_mappings.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from _history import catat_history
from db_client import engine

KOLOM = """
ALTER TABLE management_setting_account_mappings ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE management_setting_account_mappings ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE management_setting_account_mappings ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE management_setting_account_mappings ADD COLUMN IF NOT EXISTS locked_by_name varchar(255);
CREATE INDEX IF NOT EXISTS idx_management_setting_account_mappings_locked_coa
    ON management_setting_account_mappings (coa_id) WHERE is_locked;
"""

FUNGSI = """
CREATE OR REPLACE FUNCTION fn_kunci_account_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT OLD.is_locked THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MAPPING_LOCKED: Account mapping "%" is locked. Unlock it in Settings > Account Mapping first.', OLD.mapping_key;
    END IF;
    IF NEW.coa_id IS DISTINCT FROM OLD.coa_id OR NEW.mapping_key IS DISTINCT FROM OLD.mapping_key
       OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION 'MAPPING_LOCKED: Account mapping "%" is locked. Unlock it in Settings > Account Mapping first.', OLD.mapping_key;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_coa_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_keys text;
BEGIN
    SELECT string_agg(m.mapping_key, ', ' ORDER BY m.mapping_key) INTO v_keys
      FROM management_setting_account_mappings m
     WHERE m.coa_id = OLD.id AND m.is_locked;
    IF v_keys IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE'
       OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
       OR (COALESCE(NEW.is_active, true) = false AND COALESCE(OLD.is_active, true) = true)
       OR NEW.acc_no IS DISTINCT FROM OLD.acc_no
       OR NEW.account_name IS DISTINCT FROM OLD.account_name
       OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION 'MAPPING_LOCKED: Account % % is used by locked account mapping (%). Unlock it in Settings > Account Mapping first.',
            OLD.acc_no, OLD.account_name, v_keys;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kunci_account_mapping ON management_setting_account_mappings;
CREATE TRIGGER trg_kunci_account_mapping BEFORE UPDATE OR DELETE ON management_setting_account_mappings
    FOR EACH ROW EXECUTE FUNCTION fn_kunci_account_mapping();

DROP TRIGGER IF EXISTS trg_kunci_coa_mapping ON management_client_coa;
CREATE TRIGGER trg_kunci_coa_mapping BEFORE UPDATE OR DELETE ON management_client_coa
    FOR EACH ROW EXECUTE FUNCTION fn_kunci_coa_mapping();
"""


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Commit lewat koneksi DBAPI mentah (lihat catatan di migration 34).
    raw = connection.connection
    try:
        with raw.cursor() as cur:
            cur.execute(sql)
        raw.commit()
        print(f"✅ {label} siap.")
        return True
    except Exception as e:
        raw.rollback()
        print(f"❌ Gagal {label}: {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: kunci Account Mapping")
    print("=" * 60)
    hasil = {}
    with engine.connect() as connection:
        hasil["kolom is_locked / locked_*"] = _jalankan_sql(connection, "kolom is_locked / locked_*", KOLOM)
        if all(hasil.values()):
            hasil["trigger kunci mapping & akun COA"] = _jalankan_sql(connection, "trigger kunci mapping & akun COA", FUNGSI)
    print()
    for k, v in hasil.items():
        print(f"{k:<60}: {'✅' if v else '❌'}")
    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
