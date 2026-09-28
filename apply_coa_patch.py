"""
apply_coa_patch.py
==================
Menambahkan dukungan "Management > COA" (versi playground-willi) ke
backend milik playground-hendra TANPA menimpa file apa pun secara utuh.

Yang dilakukan (semuanya hanya MENAMBAH baris, tidak menghapus/mengubah
baris lain):
  1. backend/db_client.py : model ManagementClientCoa + 9 fungsi CRUD COA
  2. backend/main.py      : import & include_router untuk coa_v1

Cara pakai (dari folder Dashboard):
    python apply_coa_patch.py

Aman dijalankan berulang kali: kalau sudah pernah ditambahkan, dilewati.
Sebelum menulis, dibuat cadangan <file>.bak_coa. Setelah menulis, hasilnya
dicek sintaksnya; kalau ada masalah, file dikembalikan otomatis.
"""

import ast
import os
import shutil
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB_CLIENT = os.path.join(BASE, "backend", "db_client.py")
MAIN_PY = os.path.join(BASE, "backend", "main.py")


# ---------------------------------------------------------------------------
# Blok 1: model tabel management_client_coa
# ---------------------------------------------------------------------------
MODEL_BLOCK = '''# ============================================================
# MANAGEMENT > COA -- DDL: root/ddl-table (bagian "FITUR MANAGEMENT > COA")
# [DITAMBAHKAN dari playground-willi]
# ============================================================

class ManagementClientCoa(Base):
    """[BARU] Master Chart of Accounts per klien (management_clients).

    Sumber awal: dataset/COA/COA_Clients_GOUF.xlsx (sheet "COA <KODE>"),
    di-seed lewat migrations/seed_coa_*.sql. Kolom mengikuti persis kolom
    sheet tsb: nomor & nama akun ASLI klien (acc_no/account_name) + lapisan
    semantik standar lintas-klien (classification/head/sub/standard_account_code,
    IFRS-aligned) -- jadi 1001, 1-1000 dan 110101 di 3 klien berbeda bisa
    punya standard_account_code yang sama.

    TERPISAH dari tabel `coa` lama (FK ke `clients` integer, dipakai modul
    akuntansi/upload lama) -- tabel ini FK ke management_clients (UUID),
    sama seperti fitur Transactions yang baru.

    normal_balance (DEBIT/CREDIT) TIDAK ada di Excel -- diturunkan dari
    account_classification + akun kontra (akumulasi penyusutan, cadangan
    kerugian piutang, potongan/retur pembelian, potongan penjualan, prive),
    lihat migrations/generate_seed_coa.py::normal_balance().

    client_id BOLEH NULL = akun "unassigned": dibuat dulu tanpa klien, lalu
    kelak di-assign ke klien lewat POST /api/v1/management/coa/assign (baris
    yang sama diisi client_id-nya, bukan disalin). UNIQUE (client_id, acc_no)
    tidak berlaku antar baris NULL di Postgres, jadi keunikan acc_no di pool
    unassigned dijaga di API (modules/management/coa_v1.py). Lihat
    migrations/17-allow_unassigned_management_client_coa.py.
    """
    __tablename__ = "management_client_coa"
    __table_args__ = (
        UniqueConstraint("client_id", "acc_no", name="uq_management_client_coa_client_acc_no"),
        # UNIQUE di atas tidak berlaku antar client_id NULL -> jaga acc_no unik di pool unassigned.
        Index(
            "uq_management_client_coa_unassigned_acc_no", "acc_no", unique=True,
            postgresql_where=text("client_id IS NULL AND deleted_at IS NULL"),
        ),
        Index("idx_management_client_coa_client", "client_id"),
        Index("idx_management_client_coa_standard_code", "standard_account_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)  # NULL = unassigned
    client_code = Column(String(50), nullable=True)
    acc_no = Column(String(50), nullable=False)
    account_name = Column(String(255), nullable=False)
    account_classification = Column(String(30), nullable=False)  # ASSET/LIABILITY/EQUITY/REVENUE/COST OF SALES/EXPENSE/OTHER INCOME/OTHER EXPENSE/INCOME TAX
    account_head = Column(String(50), nullable=True)             # mis. CURRENT ASSET, OPERATING EXPENSE
    account_sub = Column(String(100), nullable=True)             # mis. CASH & CASH EQUIVALENTS
    normal_balance = Column(String(10), nullable=True)           # DEBIT/CREDIT
    description = Column(Text, nullable=True)
    international_standard_group = Column(String(255), nullable=True)
    standard_account_code = Column(String(100), nullable=True)   # mis. std_asset_current_cash_bank
    ifrs_taxonomy_reference = Column(String(255), nullable=True)
    ifrs_source = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


'''


# ---------------------------------------------------------------------------
# Blok 2: fungsi CRUD management_client_coa
# ---------------------------------------------------------------------------
FUNCTIONS_BLOCK = '''# ============================================================
# MANAGEMENT > COA -- CRUD management_client_coa (lihat model
# ManagementClientCoa & modules/management/coa_v1.py). create/get/update/
# soft-delete memakai helper generic _sales_crud_* di bawah (kolom audit
# tabel ini sama persis).
# [DITAMBAHKAN dari playground-willi]
# ============================================================

CRUD_FIELDS_MANAGEMENT_CLIENT_COA = [
    "client_id", "client_code", "acc_no", "account_name", "account_classification",
    "account_head", "account_sub", "normal_balance", "description",
    "international_standard_group", "standard_account_code",
    "ifrs_taxonomy_reference", "ifrs_source", "is_active",
]


def _filter_client_coa(query, client_id: Optional[str]):
    """client_id None = akun unassigned (client_id IS NULL)."""
    if client_id is None:
        return query.filter(ManagementClientCoa.client_id.is_(None))
    return query.filter(ManagementClientCoa.client_id == client_id)


def list_management_client_coa(
    client_id: Optional[str],
    search: Optional[str] = None,
    account_classification: Optional[str] = None,
    hanya_aktif: bool = False,
    termasuk_nonaktif: bool = False,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """COA 1 klien (client_id None = akun unassigned), terurut acc_no.
    `search` mencocokkan acc_no ATAU account_name (case-insensitive,
    substring) -- dipakai autocomplete Account Name di New Journal Entry
    & pencarian akun unassigned."""
    session = SessionLocal()
    try:
        query = _filter_client_coa(session.query(ManagementClientCoa), client_id)
        if not termasuk_nonaktif:
            query = query.filter(ManagementClientCoa.deleted_at.is_(None))
        if hanya_aktif:
            query = query.filter(ManagementClientCoa.is_active.is_(True))
        if account_classification:
            query = query.filter(ManagementClientCoa.account_classification == account_classification.upper())
        if search and search.strip():
            pola = f"%{search.strip()}%"
            query = query.filter(
                (ManagementClientCoa.acc_no.ilike(pola)) | (ManagementClientCoa.account_name.ilike(pola))
            )
        query = query.order_by(ManagementClientCoa.acc_no)
        if limit:
            query = query.limit(limit)
        return [_sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA) for obj in query.all()]
    except Exception as e:
        session.rollback()
        print(f"Error list management_client_coa: {e}")
        return []
    finally:
        session.close()


def get_management_client_coa_by_id(coa_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, coa_id, termasuk_nonaktif)


def cari_management_client_coa_by_acc_no(client_id: Optional[str], acc_no: str) -> Optional[Dict[str, Any]]:
    """1 akun berdasarkan (client_id, acc_no) persis -- TERMASUK yang sudah
    di-soft-delete (lihat field `aktif`), karena UNIQUE (client_id, acc_no)
    tetap berlaku untuk baris yang dihapus. client_id None = pool unassigned
    (bisa >1 baris dgn acc_no sama kalau ada yang terhapus -> yang aktif
    diutamakan)."""
    session = SessionLocal()
    try:
        obj = _filter_client_coa(session.query(ManagementClientCoa), client_id).filter(
            ManagementClientCoa.acc_no == acc_no
        ).order_by(ManagementClientCoa.deleted_at.desc().nullsfirst()).first()
        return _sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def create_management_client_coa(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, data, created_by)


def update_management_client_coa(coa_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, coa_id, data, updated_by)


def restore_management_client_coa(coa_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Hidupkan lagi akun yang sudah di-soft-delete sekaligus timpa isinya --
    dipakai saat user membuat akun dengan acc_no yang dulu pernah dihapus."""
    session = SessionLocal()
    try:
        obj = session.query(ManagementClientCoa).filter(ManagementClientCoa.id == coa_id).first()
        if not obj:
            return None
        for kolom, nilai in data.items():
            if kolom in CRUD_FIELDS_MANAGEMENT_CLIENT_COA:
                setattr(obj, kolom, nilai)
        obj.deleted_at = None
        obj.deleted_by = None
        obj.edited_at = datetime.now()
        obj.edited_by = updated_by
        hasil = _sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error restore management_client_coa: {e}")
        return None
    finally:
        session.close()


def soft_delete_management_client_coa(coa_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(ManagementClientCoa, coa_id, deleted_by)


def assign_management_client_coa(
    coa_ids: List[str], client_id: str, client_code: Optional[str], assigned_by: Optional[str] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """Assign akun unassigned (client_id NULL) ke 1 klien -- baris YANG SAMA
    diisi client_id-nya (akun keluar dari pool unassigned). 1 transaksi.

    Per akun:
      - tidak ada / sudah dihapus / sudah punya klien -> skipped
      - acc_no sudah dipakai akun AKTIF klien tujuan   -> skipped
      - acc_no dipakai akun klien tujuan yang SUDAH DIHAPUS -> baris terhapus
        itu dihidupkan lagi dengan isi akun unassigned, lalu akun unassigned
        di-soft-delete (UNIQUE (client_id, acc_no) tidak memberi pilihan lain;
        pola sama dengan POST create yang menghidupkan akun terhapus).
    Return {"assigned": [...akun], "skipped": [{id, acc_no, account_name, reason}]}.
    """
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"assigned": [], "skipped": []}
    try:
        rows = session.query(ManagementClientCoa).filter(ManagementClientCoa.id.in_(coa_ids)).all()
        by_id = {r.id: r for r in rows}
        existing = {
            r.acc_no: r for r in session.query(ManagementClientCoa).filter(
                ManagementClientCoa.client_id == client_id
            ).all()
        }
        sekarang = datetime.now()
        for coa_id in dict.fromkeys(coa_ids):  # buang id dobel, urutan dipertahankan
            obj = by_id.get(coa_id)
            if obj is None or obj.deleted_at is not None:
                hasil["skipped"].append({"id": coa_id, "acc_no": None, "account_name": None, "reason": "Akun tidak ditemukan."})
                continue
            if obj.client_id is not None:
                hasil["skipped"].append({"id": coa_id, "acc_no": obj.acc_no, "account_name": obj.account_name,
                                         "reason": "Akun sudah terhubung ke klien lain."})
                continue
            bentrok = existing.get(obj.acc_no)
            if bentrok is not None and bentrok.deleted_at is None:
                hasil["skipped"].append({"id": coa_id, "acc_no": obj.acc_no, "account_name": obj.account_name,
                                         "reason": f"ACC NO sudah dipakai akun '{bentrok.account_name}' di klien ini."})
                continue
            if bentrok is not None:
                for kolom in CRUD_FIELDS_MANAGEMENT_CLIENT_COA:
                    if kolom not in ("client_id", "client_code"):
                        setattr(bentrok, kolom, getattr(obj, kolom))
                bentrok.client_code = client_code
                bentrok.deleted_at = None
                bentrok.deleted_by = None
                bentrok.edited_at = sekarang
                bentrok.edited_by = assigned_by
                obj.deleted_at = sekarang
                obj.deleted_by = assigned_by
                target = bentrok
            else:
                obj.client_id = client_id
                obj.client_code = client_code
                obj.edited_at = sekarang
                obj.edited_by = assigned_by
                existing[obj.acc_no] = obj
                target = obj
            hasil["assigned"].append(_sales_row_ke_dict(target, CRUD_FIELDS_MANAGEMENT_CLIENT_COA))
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error assign management_client_coa: {e}")
        raise
    finally:
        session.close()


'''


# ---------------------------------------------------------------------------
# Utilitas
# ---------------------------------------------------------------------------
def baca(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def tulis(path, teks):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(teks)


def sesuaikan_eol(blok, eol):
    return blok.replace("\r\n", "\n").replace("\n", eol)


def sisipkan_sebelum(teks, jangkar, blok):
    """Sisipkan `blok` tepat sebelum kemunculan PERTAMA `jangkar`."""
    idx = teks.find(jangkar)
    if idx < 0:
        raise RuntimeError(f"Titik sisip tidak ditemukan: {jangkar[:60]!r}")
    return teks[:idx] + blok + teks[idx:]


def sisipkan_setelah_baris(teks, awalan_baris, baris_baru, eol):
    """Sisipkan `baris_baru` sebagai baris baru tepat setelah baris yang
    diawali `awalan_baris` (kemunculan pertama)."""
    idx = teks.find(awalan_baris)
    if idx < 0:
        raise RuntimeError(f"Baris acuan tidak ditemukan: {awalan_baris[:60]!r}")
    akhir = teks.find(eol, idx)
    if akhir < 0:
        akhir = len(teks)
        return teks + eol + baris_baru
    akhir += len(eol)
    return teks[:akhir] + baris_baru + eol + teks[akhir:]


def terapkan(path, fungsi_ubah, nama):
    asli = baca(path)
    baru = fungsi_ubah(asli)
    if baru is None:
        print(f"[lewati] {nama}: sudah ada, tidak diubah.")
        return True
    cadangan = path + ".bak_coa"
    if not os.path.exists(cadangan):
        shutil.copyfile(path, cadangan)
    tulis(path, baru)
    try:
        ast.parse(baru)
    except SyntaxError as e:
        tulis(path, asli)
        print(f"[GAGAL] {nama}: hasil tidak valid ({e}). File dikembalikan seperti semula.")
        return False
    print(f"[ok] {nama}: berhasil ditambahkan.")
    return True


# ---------------------------------------------------------------------------
# Perubahan per file
# ---------------------------------------------------------------------------
def ubah_db_client(teks):
    if "class ManagementClientCoa(Base)" in teks:
        return None
    eol = "\r\n" if "\r\n" in teks else "\n"

    teks = sisipkan_sebelum(
        teks,
        "class UserClientAccess(Base):",
        sesuaikan_eol(MODEL_BLOCK, eol),
    )

    jangkar_fungsi = (
        "# ============================================================" + eol +
        "# TRANSACTIONS > SALES -- CRUD (lihat model di atas"
    )
    teks = sisipkan_sebelum(teks, jangkar_fungsi, sesuaikan_eol(FUNCTIONS_BLOCK, eol))
    return teks


def ubah_main(teks):
    if "management_coa_v1" in teks:
        return None
    eol = "\r\n" if "\r\n" in teks else "\n"
    teks = sisipkan_setelah_baris(
        teks,
        "from modules.management import clients_v1 as management_clients_v1",
        "from modules.management import coa_v1 as management_coa_v1  # [DITAMBAHKAN dari playground-willi] /api/v1/management/coa/...",
        eol,
    )
    teks = sisipkan_setelah_baris(
        teks,
        "app.include_router(management_clients_v1.router)",
        "app.include_router(management_coa_v1.router)  # [DITAMBAHKAN dari playground-willi] /api/v1/management/coa/...",
        eol,
    )
    return teks


def main():
    for p in (DB_CLIENT, MAIN_PY):
        if not os.path.exists(p):
            print(f"File tidak ditemukan: {p}")
            print("Jalankan skrip ini dari folder Dashboard (yang berisi folder 'backend').")
            sys.exit(1)

    ok1 = terapkan(DB_CLIENT, ubah_db_client, "backend/db_client.py")
    ok2 = terapkan(MAIN_PY, ubah_main, "backend/main.py")
    if ok1 and ok2:
        print("\nSelesai. Langkah berikutnya: pastikan file backend/modules/management/coa_v1.py ada.")
    else:
        print("\nAda yang gagal, lihat pesan di atas. Tidak ada file yang rusak.")
        sys.exit(1)


if __name__ == "__main__":
    main()