"""
modules/finance/bank_reconciliation_v1.py
==========================================
Reconciliation Cash & Bank: mencocokkan mutasi Bank Feed ke invoice yang masih
outstanding, mencatat pembayarannya, dan membentuk jurnal Kas vs Hutang/Piutang
otomatis.

    Bank Feed (mutasi mentah, hidup di sesi browser)
        debet  (uang keluar)  -> invoice PURCHASE posted yang masih ada sisa hutang
        kredit (uang masuk)   -> invoice SALES Posted/Partial yang masih ada sisa piutang
    matched   -> 1 baris financial_transaction_bank_cash_payments per invoice
                 (applied_at KOSONG = menunggu posting; invoice BELUM berubah) + 1 jurnal
                 DRAFT (source_module BANK_RECONCILIATION) -> tampil di Journal Preview.
    approve   -> DRAFT -> APPROVED (POST /approve, Supervisor ke atas).
    post      -> APPROVED -> POSTED (POST /post, Manager ke atas). Dalam satu transaksi
                 applied_at pembayaran diisi; trigger DB fn_bcp_apply baru saat itu
                 memperbarui accounts_payable/payment_status Purchase atau
                 paid_amount/posting_status Sales.
    unmatched -> dicatat di financial_transaction_bank_cash_exceptions
                 (exception_type "Unmatched bank mutation") dan diklasifikasi
                 lewat jalur lengkap.

Bank Feed SENGAJA tidak disimpan di database (lihat BankFeedContext.tsx), jadi
endpoint di sini STATELESS terhadap Bank Feed: frontend mengirim baris mutasi
beserta `ref` yang stabil (refDasar() di cashBankExceptionsStore.ts) dan `ref`
itulah yang disimpan sebagai payments.bank_mutation_ref.

client_id di SEMUA endpoint = management_clients.id (company aktif di "Switch
Company"), sama seperti modul exceptions.

Aturan yang dijaga di sini (sisanya dijaga trigger DB fn_bcp_validate):
  - Total alokasi ke invoice harus SAMA dengan nominal mutasi (toleransi 0,50).
    Selisih (biaya admin bank, potongan, dst) tidak diselesaikan diam-diam --
    biarkan unmatched / exception.
  - Satu mutasi (ref) hanya boleh dicocokkan sekali; batalkan dulu (unmatch)
    untuk mencocokkan ulang.
  - Jurnal dibuat berstatus DRAFT, lalu APPROVED, lalu POSTED. Pembayaran yang masih
    menunggu (applied_at kosong) ikut mengurangi sisa yang boleh dicocokkan lagi.
    Jurnal yang sudah POSTED tidak dibatalkan
    otomatis saat unmatch (harus di-reverse lewat jurnal).
  - Reversal (POST /reverse, Manager ke atas): jurnal POSTED TIDAK diubah dan
    TIDAK dihapus. Dibuat jurnal pembalik baru (debit/kredit ditukar, status
    POSTED, reversed_from_id -> jurnal asal, source_module
    BANK_RECONCILIATION_REVERSAL) supaya buku besar (hanya membaca status
    POSTED) nettonya nol. Pembayaran jurnal asal dibatalkan (deleted_at) dan
    trigger fn_bcp_apply memulihkan outstanding invoice (hanya untuk pembayaran yang sudah
    diterapkan); mutasi bank jadi
    bebas dicocokkan ulang. Semuanya satu transaksi DB (semua berhasil / batal).

[ADAPTASI playground-willi] Versi asli (playground-hendra) membaca tabel `coa`
dan menulis ke journal_entries/journal_lines (UUID) di Supabase Hendra. Di DB
playground-willi:
  - Akun diambil dari `management_client_coa` (master COA per klien). Jenis kas
    (bank/kas_tunai/kas_kecil/transit) diturunkan dari standard_account_code
    lewat db_client._tentukan_jenis_kas(), bukan kolom `jenis_kas`.
  - Jurnal ditulis ke financial_transaction_journal_entry_drafts + draft_lines
    (fitur Journal Entry), source_type "Bank", status draft/approved/posted/
    rejected (huruf kecil). Jurnal rekon dikenali dari prefix je_number "BR-";
    jurnal pembaliknya "RV-<je_number asal>". Yang POSTED otomatis ikut GL &
    Financial Statements (db_client.ambil_baris_jurnal_posted_transaksi).
  - Respons API tetap memakai bentuk lama (journal_no, status HURUF BESAR,
    no_akun/nama_akun/jenis_kas) supaya frontend Cash & Bank tidak berubah.
"""

from __future__ import annotations

import itertools
import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("finance_bank_reconciliation_v1")

router = APIRouter(prefix="/api/v1/finance/bank-reconciliation", tags=["bank-reconciliation-v1"])

TOLERANSI = Decimal("0.50")
SOURCE_TYPE_JURNAL = "Bank"          # nilai source_type fitur Journal Entry
PREFIX_JURNAL = "BR-"                # je_number jurnal rekon: BR-<tahun>-<8 hex>
PREFIX_PEMBALIK = "RV-"              # je_number jurnal pembalik: RV-<je_number asal>
SUB_AKUN_KAS = "CASH & CASH EQUIVALENTS"
SUB_AKUN_LAWAN = {"purchase": "TRADE PAYABLES", "sales": "TRADE RECEIVABLES"}
_BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
LEVEL_APPROVE = 3    # Supervisor (tahap_3) ke atas
LEVEL_POST = 4       # Manager (tahap_4) ke atas
LEVEL_REVERSAL = 4   # Manager (tahap_4) ke atas
TIPE_EXCEPTION_UNMATCHED = "Unmatched bank mutation"

# Kata umum yang tidak dianggap sebagai bukti nama pihak (vendor/customer).
_KATA_ABAIKAN = {
    "pt", "cv", "tbk", "ud", "pd", "persero", "the", "and", "dan", "bank", "transfer", "trf",
    "payment", "pembayaran", "bayar", "inv", "invoice", "faktur", "no", "nomor", "ke", "dari",
    "atas", "untuk", "via", "ibanking", "mbanking", "kliring", "sknbi", "bifast", "switching",
}


def _require_level_v1(min_tahap: int):
    def _dependency(current_user: Dict[str, Any] = Depends(get_current_user_v1)) -> Dict[str, Any]:
        if auth.role_level(current_user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. "
                    f"Akun kamu: {auth.role_label(current_user.get('role'))}."
                ),
            )
        return current_user

    return _dependency


# ============================================================
# SKEMA REQUEST
# ============================================================

class MutasiIn(BaseModel):
    """Satu mutasi Bank Feed. `ref` = referensi STABIL dari frontend (refDasar())."""
    ref: str = Field(..., min_length=1, max_length=100)
    date: str
    description: Optional[str] = ""
    debit: float = 0     # uang keluar dari rekening
    credit: float = 0    # uang masuk ke rekening
    bank_account: Optional[str] = None
    source_file: Optional[str] = None


class SuggestRequest(BaseModel):
    client_id: str
    mutations: List[MutasiIn] = Field(..., min_length=1, max_length=1000)


class AlokasiIn(BaseModel):
    invoice_id: str
    amount: float = Field(..., gt=0)


class MatchRequest(BaseModel):
    client_id: str
    mutation: MutasiIn
    allocations: List[AlokasiIn] = Field(..., min_length=1, max_length=50)
    bank_coa_id: Optional[str] = None      # kosong -> dicari otomatis dari nama rekening / role
    counter_coa_id: Optional[str] = None   # kosong -> Hutang Usaha / Piutang Usaha client
    notes: Optional[str] = None


class BarisAkunIn(BaseModel):
    """Satu baris akun lawan untuk mutasi tanpa invoice. `side` = sisi jurnal baris ini."""
    coa_id: str
    side: str = Field(..., pattern="^(debit|credit)$")
    amount: float = Field(..., gt=0)
    description: Optional[str] = None


class NonInvoiceRequest(BaseModel):
    """Mutasi yang bukan pelunasan invoice: biaya admin, bunga, pajak bunga, transfer antar bank, setoran modal, dst."""
    client_id: str
    mutation: MutasiIn
    category: str = Field(..., min_length=2, max_length=60)   # label bebas, mis. "Biaya admin bank"
    lines: List[BarisAkunIn] = Field(..., min_length=1, max_length=20)
    bank_coa_id: Optional[str] = None
    notes: Optional[str] = None


class AutoMatchRequest(BaseModel):
    client_id: str
    mutations: List[MutasiIn] = Field(..., min_length=1, max_length=1000)
    bank_coa_id: Optional[str] = None
    catat_exception: bool = True   # mutasi yang tidak bisa dicocokkan dicatat ke tab Exceptions


class UnmatchRequest(BaseModel):
    client_id: str
    bank_mutation_ref: str = Field(..., min_length=1, max_length=100)
    alasan: Optional[str] = None


class JurnalAksiRequest(BaseModel):
    """Body untuk POST /approve dan POST /post."""
    client_id: str
    journal_entry_id: str


class ReverseRequest(BaseModel):
    client_id: str
    journal_entry_id: str
    alasan: str = Field(..., min_length=5, max_length=300)
    tanggal: Optional[str] = None   # tanggal jurnal pembalik (YYYY-MM-DD); kosong = hari ini


# ============================================================
# UTIL
# ============================================================

class _Gagal(Exception):
    def __init__(self, pesan: str, kode: str = "VALIDATION", status_code: int = 422, detail: Any = None):
        super().__init__(pesan)
        self.pesan, self.kode, self.status_code, self.detail = pesan, kode, status_code, detail


def _dec(v: Any) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _parse_tanggal(v: Any) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    raise _Gagal(f"Tanggal mutasi tidak valid: '{v}'.")


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _token(s: Optional[str]) -> set:
    return {
        t for t in re.findall(r"[a-z0-9]+", (s or "").lower())
        if len(t) >= 3 and not t.isdigit() and t not in _KATA_ABAIKAN
    }


def _uuid_atau_none(v: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, TypeError, AttributeError):
        return None


def _pesan_db(e: Exception) -> str:
    """Ambil pesan trigger/constraint yang bisa dibaca user dari error driver."""
    orig = getattr(e, "orig", None)
    msg = str(orig if orig is not None else e).strip()
    msg = msg.split("\nCONTEXT:")[0].split("\nDETAIL:")[0]
    msg = re.sub(r"^\s*(ERROR|Error):\s*", "", msg)
    return msg.splitlines()[0] if msg else "Kesalahan database."


def _arah_dan_nominal(m: MutasiIn) -> Tuple[str, Decimal]:
    debit, credit = _dec(m.debit), _dec(m.credit)
    if debit > 0 and credit > 0:
        raise _Gagal("Mutasi memiliki debet dan kredit sekaligus.")
    if debit <= 0 and credit <= 0:
        raise _Gagal("Nominal mutasi harus lebih dari 0.")
    return ("purchase", debit) if debit > 0 else ("sales", credit)


def _prioritas(nominal: Decimal) -> str:
    n = abs(nominal)
    return "High" if n >= 50_000_000 else "Medium" if n >= 10_000_000 else "Low"


# ============================================================
# KANDIDAT INVOICE OUTSTANDING
# ============================================================

def _muat_kandidat(session, client_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """Invoice yang masih punya sisa tagihan (sisa sudah dikurangi pembayaran yang menunggu
    posting). Kriteria SAMA dengan trigger
    fn_bcp_validate (Purchase: status 'posted' -- di DB willi tersimpan sbg label "Posted",
    makanya dibandingkan lower(); Sales: 'Posted'/'Partial'; pemilik =
    coalesce(management_client_id, client_id))."""
    purchase = session.execute(text("""
        select id::text as id, purchase_no, invoice_number, vendor_name as party,
               purchase_date, invoice_date, due_date, total,
               coalesce(accounts_payable, total) - coalesce((
                   select sum(b.amount) from financial_transaction_bank_cash_payments b
                    where b.purchase_transaction_id = financial_transaction_purchase_transactions.id
                      and b.deleted_at is null and b.applied_at is null), 0) as outstanding
          from financial_transaction_purchase_transactions
         where deleted_at is null and lower(status) = 'posted'
           and coalesce(management_client_id, client_id) = cast(:cid as uuid)
           and coalesce(accounts_payable, total) - coalesce((
                   select sum(b.amount) from financial_transaction_bank_cash_payments b
                    where b.purchase_transaction_id = financial_transaction_purchase_transactions.id
                      and b.deleted_at is null and b.applied_at is null), 0) > 0.005
    """), {"cid": client_id}).mappings().all()
    sales = session.execute(text("""
        select id::text as id, invoice_no, customer_name as party, invoice_date, due_date,
               gross_amount as total,
               gross_amount - coalesce(paid_amount, 0) - coalesce((
                   select sum(b.amount) from financial_transaction_bank_cash_payments b
                    where b.sales_invoice_id = financial_transaction_sales_invoices.id
                      and b.deleted_at is null and b.applied_at is null), 0) as outstanding
          from financial_transaction_sales_invoices
         where deleted_at is null and posting_status in ('Posted', 'Partial')
           and coalesce(management_client_id, client_id) = cast(:cid as uuid)
           and gross_amount - coalesce(paid_amount, 0) - coalesce((
                   select sum(b.amount) from financial_transaction_bank_cash_payments b
                    where b.sales_invoice_id = financial_transaction_sales_invoices.id
                      and b.deleted_at is null and b.applied_at is null), 0) > 0.005
    """), {"cid": client_id}).mappings().all()

    hasil: Dict[str, List[Dict[str, Any]]] = {"purchase": [], "sales": []}
    for r in purchase:
        hasil["purchase"].append({
            "type": "purchase", "id": r["id"], "no": r["invoice_number"] or r["purchase_no"],
            "refs": [x for x in (r["purchase_no"], r["invoice_number"]) if x],
            "party": r["party"], "date": r["invoice_date"] or r["purchase_date"], "due_date": r["due_date"],
            "total": _dec(r["total"]), "outstanding": _dec(r["outstanding"]),
        })
    for r in sales:
        hasil["sales"].append({
            "type": "sales", "id": r["id"], "no": r["invoice_no"], "refs": [r["invoice_no"]],
            "party": r["party"], "date": r["invoice_date"], "due_date": r["due_date"],
            "total": _dec(r["total"]), "outstanding": _dec(r["outstanding"]),
        })
    return hasil


def _nilai_kandidat(nominal: Decimal, tgl: date, deskripsi: str, c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Skor 1 invoice untuk 1 mutasi. None kalau nominal melebihi sisa tagihan
    (tidak boleh -- trigger DB akan menolak)."""
    sisa = c["outstanding"]
    if nominal > sisa + TOLERANSI:
        return None
    exact = abs(sisa - nominal) <= TOLERANSI
    desk_norm = _norm(deskripsi)
    ref_hit = any(len(_norm(r)) >= 4 and _norm(r) in desk_norm for r in c["refs"])
    tok_party = _token(c["party"])
    tok_desk = _token(deskripsi)
    rasio = (len(tok_party & tok_desk) / len(tok_party)) if tok_party else 0.0

    skor = 0.60 if exact else 0.15
    if ref_hit:
        skor += 0.30
    skor += 0.15 * min(rasio, 1.0)
    if c["date"] and tgl >= c["date"]:
        skor += 0.05
    if c["due_date"] and abs((tgl - c["due_date"]).days) <= 14:
        skor += 0.05
    return {
        "exact": exact, "ref_hit": ref_hit, "party_ratio": round(rasio, 2), "score": round(min(skor, 1.0), 2),
    }


def _ringkas_alokasi(c: Dict[str, Any], jumlah: Decimal) -> Dict[str, Any]:
    return {
        "invoice_id": c["id"], "invoice_no": c["no"], "party": c["party"],
        "outstanding": float(c["outstanding"]), "amount": float(jumlah),
    }


def _saran_untuk_mutasi(m: MutasiIn, kandidat: Dict[str, List[Dict[str, Any]]], maks: int = 5) -> Dict[str, Any]:
    """Susun saran pencocokan 1 mutasi. TIDAK menulis apa pun."""
    tipe, nominal = _arah_dan_nominal(m)
    tgl = _parse_tanggal(m.date)
    deskripsi = m.description or ""
    pool = kandidat[tipe]

    daftar: List[Dict[str, Any]] = []
    for c in pool:
        n = _nilai_kandidat(nominal, tgl, deskripsi, c)
        if n is None:
            continue
        # buang kandidat yang cuma "kebetulan muat" tanpa bukti apa pun selain tanggal
        if not n["exact"] and not n["ref_hit"] and n["party_ratio"] < 0.5:
            continue
        daftar.append({"kind": "single", **n, "allocations": [_ringkas_alokasi(c, nominal)]})

    # Kombinasi 2-4 invoice yang totalnya PAS dengan nominal (satu transfer bayar beberapa invoice)
    if not any(d["exact"] for d in daftar):
        pool_kombo = [
            c for c in pool
            if c["outstanding"] < nominal and (
                _token(c["party"]) & _token(deskripsi)
                or any(len(_norm(r)) >= 4 and _norm(r) in _norm(deskripsi) for r in c["refs"])
            )
        ]
        pool_kombo = sorted(pool_kombo, key=lambda x: x["outstanding"], reverse=True)[:12]
        for ukuran in (2, 3, 4):
            for kombo in itertools.combinations(pool_kombo, ukuran):
                if abs(sum(x["outstanding"] for x in kombo) - nominal) <= TOLERANSI:
                    daftar.append({
                        "kind": "combo", "exact": True, "ref_hit": False, "party_ratio": 1.0, "score": 0.70,
                        "allocations": [_ringkas_alokasi(x, x["outstanding"]) for x in kombo],
                    })
            if len(daftar) >= maks * 2:
                break

    daftar.sort(key=lambda d: (d["score"], d["exact"]), reverse=True)
    daftar = daftar[:maks]

    # Auto-match hanya kalau: kandidat teratas 1 invoice, nominal PAS, ada bukti (no invoice / nama pihak),
    # dan tidak ada kandidat lain yang sama kuatnya (biar tidak salah pilih invoice).
    auto = False
    if daftar and daftar[0]["kind"] == "single" and daftar[0]["exact"] and (
        daftar[0]["ref_hit"] or daftar[0]["party_ratio"] >= 0.5
    ):
        pesaing = [
            d for d in daftar[1:]
            if d["exact"] and (d["ref_hit"] or d["party_ratio"] >= 0.5) and d["score"] >= daftar[0]["score"] - 0.10
        ]
        auto = not pesaing

    return {
        "ref": m.ref, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
        "amount": float(nominal), "candidates": daftar, "auto_match": auto,
    }


# ============================================================
# AKUN (COA)
# ============================================================

# Sumber akun = management_client_coa (master COA klien, UUID). Kolomnya dialiaskan ke
# nama lama (no_akun/nama_akun/...) supaya sisa modul & frontend tidak berubah.
_SQL_AKUN = """
    select id::text as id, acc_no as no_akun, account_name as nama_akun,
           account_classification as kategori, account_sub as sub_kategori,
           standard_account_code, coalesce(is_active, true) as aktif
      from management_client_coa
     where client_id = cast(:c as uuid) and deleted_at is null
"""


def _jenis_kas(akun: Dict[str, Any]) -> Optional[str]:
    """bank / kas_tunai / kas_kecil / transit untuk akun Kas & Setara Kas; None untuk akun lain."""
    if str(akun.get("sub_kategori") or "").strip().upper() != SUB_AKUN_KAS:
        return None
    return dbc._tentukan_jenis_kas("Kas", akun.get("nama_akun"), standard_code=akun.get("standard_account_code"))


def _dengan_jenis_kas(r: Any) -> Dict[str, Any]:
    akun = dict(r)
    akun["jenis_kas"] = _jenis_kas(akun)
    return akun


def _daftar_akun(session, client_id: str, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    sql = _SQL_AKUN + (" and coalesce(is_active, true)" if hanya_aktif else "") + " order by acc_no"
    return [_dengan_jenis_kas(r) for r in session.execute(text(sql), {"c": client_id}).mappings().all()]


def _coa_row(session, client_id: str, coa_id: str) -> Optional[Dict[str, Any]]:
    if not _uuid_atau_none(coa_id):
        return None
    r = session.execute(text(_SQL_AKUN + " and id = cast(:i as uuid)"),
                        {"i": coa_id, "c": client_id}).mappings().first()
    return _dengan_jenis_kas(r) if r else None


def _coa_dari_kode(session, client_id: str, acc_no: Optional[str]) -> Optional[Dict[str, Any]]:
    if not acc_no:
        return None
    rows = session.execute(text(_SQL_AKUN + " and acc_no = :n and coalesce(is_active, true)"),
                           {"c": client_id, "n": acc_no}).mappings().all()
    return _dengan_jenis_kas(rows[0]) if len(rows) == 1 else None


def _no_akun_dari_label(label: Optional[str]) -> Optional[str]:
    """Label akun bank dari Bank Feed berbentuk "<no_akun> - <nama_akun>"
    (mis. "11200001 - BANK BCA") -> "11200001". None kalau polanya tidak cocok."""
    m = re.match(r"^\s*(\S+)\s+-\s+", label or "")
    return m.group(1) if m else None


def _resolve_bank(session, client_id: str, explicit_id: Optional[str], bank_hint: Optional[str]) -> Dict[str, Any]:
    if explicit_id:
        r = _coa_row(session, client_id, explicit_id)
        if not r:
            raise _Gagal("Akun Kas/Bank tidak ditemukan pada COA client ini.")
        return r
    # [BARU] Akun bank mutasi sudah dipilih saat upload di Bank Feed dan label-nya
    # memuat nomor akun COA -> cocokkan LANGSUNG lewat nomor akun (pasti), bukan
    # menebak dari kata-kata nama akun. Dipakai hanya kalau nomor itu cocok tepat
    # 1 akun aktif milik client; selain itu jatuh ke logika lama di bawah.
    langsung = _coa_dari_kode(session, client_id, _no_akun_dari_label(bank_hint))
    if langsung:
        return langsung
    banks = [a for a in _daftar_akun(session, client_id) if a["jenis_kas"] == "bank"]
    tok_hint = _token(bank_hint)
    if tok_hint:
        cocok = [b for b in banks if _token(b["nama_akun"]) & tok_hint]
        if len(cocok) == 1:
            return cocok[0]
    # (Role BANK_DEFAULT via company_account_roles tidak dipakai: di DB willi tabel itu
    # menunjuk ke `coa` legacy, bukan management_client_coa.)
    if len(banks) == 1:
        return banks[0]
    raise _Gagal(
        "Akun Bank mutasi ini tidak bisa ditentukan. Hapus data Bank Feed, lalu upload ulang rekening koran dan pilih akun bank di dropdown upload.",
        kode="NEED_ACCOUNT", detail={"field": "bank_coa_id", "options": banks},
    )


def _kode_akun_lawan_invoice(session, tipe: str, ids: List[str]) -> Optional[str]:
    """Akun Hutang/Piutang yang DIPAKAI saat invoice diposting (Purchase: ap_account_code per
    transaksi; Sales: piutang_account_code di account mapping invoice). Pelunasan harus mendebit/
    mengkredit akun yang sama supaya saldonya nol. None kalau kosong atau invoice-invoice di
    alokasi memakai akun berbeda (biar user memilih)."""
    if tipe == "purchase":
        sql = """select distinct ap_account_code from financial_transaction_purchase_transactions
                  where id = any(cast(:ids as uuid[]))"""
    else:
        sql = """select distinct piutang_account_code from financial_transaction_sales_account_mappings
                  where invoice_id = any(cast(:ids as uuid[])) and deleted_at is null"""
    kode = {k for k in session.execute(text(sql), {"ids": ids}).scalars().all() if k}
    return kode.pop() if len(kode) == 1 else None


def _resolve_lawan(session, client_id: str, tipe: str, explicit_id: Optional[str],
                   kode_invoice: Optional[str] = None) -> Dict[str, Any]:
    if explicit_id:
        r = _coa_row(session, client_id, explicit_id)
        if not r:
            raise _Gagal("Akun Hutang/Piutang tidak ditemukan pada COA client ini.")
        return r
    r = _coa_dari_kode(session, client_id, kode_invoice)
    if r:
        return r
    sub = SUB_AKUN_LAWAN[tipe]
    rows = [a for a in _daftar_akun(session, client_id)
            if str(a["sub_kategori"] or "").strip().upper() == sub]
    if len(rows) > 1:  # buang akun perantara (clearance / other)
        utama = [x for x in rows if not re.search(r"clearance|other|lain", x["nama_akun"] or "", re.I)]
        rows = utama or rows
    if len(rows) > 1:
        awalan = "HUTANG USAHA" if tipe == "purchase" else "PIUTANG USAHA"
        persis = [x for x in rows if (x["nama_akun"] or "").upper().startswith(awalan)]
        rows = persis or rows
    if len(rows) == 1:
        return rows[0]
    raise _Gagal(
        f"Akun {'Hutang' if tipe == 'purchase' else 'Piutang'} Usaha tidak bisa ditentukan otomatis. Pilih akunnya.",
        kode="NEED_ACCOUNT", detail={"field": "counter_coa_id", "options": rows},
    )


# ============================================================
# INTI: MATCH (tulis payments + jurnal DRAFT dalam SATU transaksi)
# ============================================================

# ------------------------------------------------------------
# JURNAL (financial_transaction_journal_entry_drafts + draft_lines)
# ------------------------------------------------------------
# Jurnal rekon = draft dengan je_number berprefix PREFIX_JURNAL milik company
# (management_client_id). Mutasi bank-nya disimpan di source_reference.
# Pembalik = draft "RV-<je_number asal>" berstatus posted.

_SQL_JURNAL_REKON = """
    from financial_transaction_journal_entry_drafts je
   where je.management_client_id = cast(:c as uuid) and je.deleted_at is null
     and je.je_number like 'BR-%'
"""
_SQL_BELUM_DIBALIK = """
     and not exists (select 1 from financial_transaction_journal_entry_drafts rv
                      where rv.management_client_id = je.management_client_id
                        and rv.je_number = 'RV-' || je.je_number and rv.deleted_at is null)
"""


def _period_label(d: date) -> str:
    return f"{_BULAN_ID[d.month - 1]} {d.year}"


def _tulis_jurnal(session, *, client_id: str, user_id: Optional[str], username: Optional[str], je_number: str,
                  tgl: date, description: str, reference: str, status_jurnal: str,
                  baris: List[Dict[str, Any]], posted: bool = False) -> Any:
    """Insert 1 draft + barisnya. `baris` = [{akun: {no_akun, nama_akun}, debit, credit, desc, partner}].
    TIDAK commit. Kembalikan objek JournalEntryDraft (id sudah terisi)."""
    total_d = sum((_dec(b["debit"]) for b in baris), Decimal("0"))
    total_k = sum((_dec(b["credit"]) for b in baris), Decimal("0"))
    je = dbc.JournalEntryDraft(
        client_id=user_id, management_client_id=client_id, je_number=je_number[:100],
        entry_date=tgl, posting_date=tgl, period_label=_period_label(tgl),
        description=description[:2000], source_type=SOURCE_TYPE_JURNAL, source_reference=reference[:100],
        total_debit=total_d, total_credit=total_k, currency="IDR", status=status_jurnal,
        created_by=user_id, created_by_name=username,
        approved_by_name=username if posted else None,
        posted_at=datetime.now() if posted else None, posted_by=user_id if posted else None,
    )
    session.add(je)
    session.flush()
    for no, b in enumerate(baris, 1):
        ket = b.get("desc") or ""
        if b.get("partner") and b["partner"] not in ket:
            ket = f"{ket} - {b['partner']}"
        session.add(dbc.JournalEntryDraftLine(
            draft_id=je.id, client_id=user_id, line_no=no,
            account_code=b["akun"]["no_akun"], account_name=(b["akun"]["nama_akun"] or "")[:200],
            description=ket[:2000], debit=_dec(b["debit"]), credit=_dec(b["credit"]),
            cost_center=b.get("cost_center"), created_by=user_id,
        ))
    session.flush()
    return je


def _ref_sudah_dicocokkan(session, client_id: str) -> set:
    """Semua ref mutasi yang sedang terpakai: pembayaran aktif (jalur invoice) ATAU jurnal rekon
    draft/approved/posted yang belum dibalik (jalur invoice maupun non-invoice)."""
    rows = session.execute(text(f"""
        select bank_mutation_ref as r from financial_transaction_bank_cash_payments
         where client_id = cast(:c as uuid) and deleted_at is null
        union
        select je.source_reference as r {_SQL_JURNAL_REKON}
           and lower(je.status) in ('draft', 'approved', 'posted') {_SQL_BELUM_DIBALIK}
    """), {"c": client_id}).all()
    return {r[0] for r in rows if r[0]}


def _sudah_dicocokkan(session, client_id: str, ref: str) -> bool:
    return ref in _ref_sudah_dicocokkan(session, client_id)


def _jurnal_non_invoice(session, client_id: str, je_id: str) -> bool:
    """Jurnal rekon tanpa satu pun baris pembayaran (aktif maupun dibatalkan) = jalur non-invoice."""
    n = session.execute(text("""
        select count(*) from financial_transaction_bank_cash_payments
         where journal_entry_id = cast(:je as uuid) and client_id = cast(:c as uuid)
    """), {"je": je_id, "c": client_id}).scalar()
    return not n


def _lakukan_match(
    session, *, client_id: str, m: MutasiIn, alokasi: List[Dict[str, Any]],
    bank_coa_id: Optional[str], counter_coa_id: Optional[str], notes: Optional[str], user_id: Optional[str],
    username: Optional[str] = None,
) -> Dict[str, Any]:
    """Tulis payments + jurnal. TIDAK commit -- pemanggil yang commit/rollback."""
    tipe, nominal = _arah_dan_nominal(m)
    tgl = _parse_tanggal(m.date)

    if _sudah_dicocokkan(session, client_id, m.ref):
        raise _Gagal("Mutasi ini sudah dicocokkan. Batalkan pencocokan dulu (unmatch) kalau ingin mengulang.",
                     kode="ALREADY_MATCHED", status_code=409)

    total_alokasi = sum((_dec(a["amount"]) for a in alokasi), Decimal("0"))
    if abs(total_alokasi - nominal) > TOLERANSI:
        raise _Gagal(
            f"Total alokasi ({total_alokasi:,.2f}) tidak sama dengan nominal mutasi ({nominal:,.2f}). "
            "Selisih (mis. biaya admin bank) harus ditangani terpisah, bukan dipaksa cocok.",
            kode="ALLOCATION_MISMATCH",
        )
    ids = [a["invoice_id"] for a in alokasi]
    if len(set(ids)) != len(ids):
        raise _Gagal("Satu invoice tidak boleh muncul dua kali dalam alokasi yang sama.")

    # Data invoice untuk deskripsi jurnal (validasi kepemilikan/status/sisa dilakukan trigger DB).
    if tipe == "purchase":
        rows = session.execute(text("""
            select id::text as id, coalesce(invoice_number, purchase_no) as no, vendor_name as party
              from financial_transaction_purchase_transactions
             where id = any(cast(:ids as uuid[])) and deleted_at is null
        """), {"ids": ids}).mappings().all()
    else:
        rows = session.execute(text("""
            select id::text as id, invoice_no as no, customer_name as party
              from financial_transaction_sales_invoices
             where id = any(cast(:ids as uuid[])) and deleted_at is null
        """), {"ids": ids}).mappings().all()
    info = {r["id"]: r for r in rows}
    hilang = [i for i in ids if i not in info]
    if hilang:
        raise _Gagal(f"Invoice {'Purchase' if tipe == 'purchase' else 'Sales'} tidak ditemukan: {', '.join(hilang)}.")

    bank = _resolve_bank(session, client_id, bank_coa_id, m.bank_account)
    lawan = _resolve_lawan(session, client_id, tipe, counter_coa_id, _kode_akun_lawan_invoice(session, tipe, ids))

    # --- jurnal DRAFT: Purchase -> Dr Hutang / Cr Bank ; Sales -> Dr Bank / Cr Piutang
    baris: List[Dict[str, Any]] = []
    for a in alokasi:
        inv = info[a["invoice_id"]]
        jumlah = _dec(a["amount"])
        ket = f"{'Pembayaran' if tipe == 'purchase' else 'Penerimaan'} invoice {inv['no']} - {inv['party']}"
        if tipe == "purchase":
            baris.append({"akun": lawan, "debit": jumlah, "credit": Decimal("0"), "desc": ket, "partner": inv["party"]})
        else:
            baris.append({"akun": lawan, "debit": Decimal("0"), "credit": jumlah, "desc": ket, "partner": inv["party"]})
    ket_bank = (m.description or "").strip()[:200] or f"Mutasi bank {m.ref}"
    if tipe == "purchase":
        baris.append({"akun": bank, "debit": Decimal("0"), "credit": total_alokasi, "desc": ket_bank, "partner": None})
    else:
        baris.insert(0, {"akun": bank, "debit": total_alokasi, "credit": Decimal("0"), "desc": ket_bank, "partner": None})

    je = _tulis_jurnal(
        session, client_id=client_id, user_id=user_id, username=username,
        je_number=f"{PREFIX_JURNAL}{tgl.year}-{uuid.uuid4().hex[:8].upper()}", tgl=tgl,
        description=f"Rekonsiliasi bank {m.ref}: {ket_bank}", reference=m.ref, status_jurnal="draft", baris=baris,
    )

    # --- payments (trigger fn_bcp_validate + fn_bcp_apply berjalan di sini)
    payment_ids: List[str] = []
    for a in alokasi:
        hasil = session.execute(text("""
            insert into financial_transaction_bank_cash_payments
                (client_id, direction, purchase_transaction_id, sales_invoice_id, payment_date, amount,
                 bank_coa_id, counter_coa_id, bank_account, bank_mutation_ref, mutation_date,
                 mutation_amount, mutation_description, source_file, journal_entry_id, notes, created_by)
            values
                (cast(:client_id as uuid), :direction, cast(:pid as uuid), cast(:sid as uuid), :tgl, :amount,
                 cast(:bank as uuid), cast(:lawan as uuid), :rek, :ref, :tgl,
                 :mut_amount, :mut_desc, :src, cast(:je as uuid), :notes, cast(:by as uuid))
            returning id::text
        """), {
            "client_id": client_id, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
            "pid": a["invoice_id"] if tipe == "purchase" else None,
            "sid": a["invoice_id"] if tipe == "sales" else None,
            "tgl": tgl, "amount": _dec(a["amount"]), "bank": bank["id"], "lawan": lawan["id"],
            "rek": m.bank_account, "ref": m.ref, "mut_amount": nominal, "mut_desc": m.description,
            "src": m.source_file, "je": je.id, "notes": notes, "by": user_id,
        })
        payment_ids.append(hasil.scalar())

    return {
        "bank_mutation_ref": m.ref, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
        "amount": float(nominal), "payment_ids": payment_ids,
        "journal_entry_id": str(je.id), "journal_no": je.je_number, "journal_status": "DRAFT",
        "bank_account": {"id": bank["id"], "no_akun": bank["no_akun"], "nama_akun": bank["nama_akun"]},
        "counter_account": {"id": lawan["id"], "no_akun": lawan["no_akun"], "nama_akun": lawan["nama_akun"]},
    }


def _match_satu(client_id: str, m: MutasiIn, alokasi: List[Dict[str, Any]], bank_coa_id: Optional[str],
                counter_coa_id: Optional[str], notes: Optional[str], user_id: Optional[str],
                username: Optional[str] = None) -> Dict[str, Any]:
    """Sesi sendiri + commit/rollback. Ubah error DB (trigger) jadi _Gagal yang bisa dibaca."""
    session = dbc.SessionLocal()
    try:
        hasil = _lakukan_match(
            session, client_id=client_id, m=m, alokasi=alokasi, bank_coa_id=bank_coa_id,
            counter_coa_id=counter_coa_id, notes=notes, user_id=user_id, username=username,
        )
        session.commit()
        return hasil
    except _Gagal:
        session.rollback()
        raise
    except DBAPIError as e:
        session.rollback()
        raise _Gagal(_pesan_db(e), kode="DB_REJECTED")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _lakukan_non_invoice(session, *, client_id: str, m: MutasiIn, category: str, lines: List[Dict[str, Any]],
                         bank_coa_id: Optional[str], notes: Optional[str], user_id: Optional[str],
                         username: Optional[str] = None) -> Dict[str, Any]:
    """Jurnal DRAFT untuk mutasi tanpa invoice. Baris Bank dibuat otomatis dari arah mutasi:
    uang masuk -> Dr Bank; uang keluar -> Cr Bank. Baris akun lawan dipilih user (boleh banyak,
    dua sisi, mis. bunga: Dr Bank + Dr Pajak dibayar dimuka / Cr Pendapatan bunga). TIDAK commit."""
    _tipe, nominal = _arah_dan_nominal(m)
    masuk = _tipe == "sales"   # kredit di Bank Feed = uang masuk
    tgl = _parse_tanggal(m.date)

    if _sudah_dicocokkan(session, client_id, m.ref):
        raise _Gagal("Mutasi ini sudah dicocokkan. Batalkan pencocokan dulu (unmatch) kalau ingin mengulang.",
                     kode="ALREADY_MATCHED", status_code=409)

    bank = _resolve_bank(session, client_id, bank_coa_id, m.bank_account)

    baris: List[Dict[str, Any]] = []
    for ln in lines:
        coa = _coa_row(session, client_id, ln["coa_id"])
        if not coa:
            raise _Gagal("Akun lawan tidak ditemukan pada COA client ini.")
        if coa["id"] == bank["id"]:
            raise _Gagal("Akun lawan tidak boleh sama dengan akun Bank mutasi ini.")
        jumlah = _dec(ln["amount"])
        baris.append({
            "akun": coa, "desc": (ln.get("description") or category)[:200], "partner": None,
            "debit": jumlah if ln["side"] == "debit" else Decimal("0"),
            "credit": jumlah if ln["side"] == "credit" else Decimal("0"),
        })
    ket_bank = (m.description or "").strip()[:200] or f"Mutasi bank {m.ref}"
    bank_line = {"akun": bank, "desc": ket_bank, "partner": None,
                 "debit": nominal if masuk else Decimal("0"), "credit": Decimal("0") if masuk else nominal}
    baris.insert(0, bank_line) if masuk else baris.append(bank_line)

    total_d = sum((b["debit"] for b in baris), Decimal("0"))
    total_k = sum((b["credit"] for b in baris), Decimal("0"))
    if abs(total_d - total_k) > Decimal("0.005"):
        raise _Gagal(
            f"Jurnal tidak seimbang: debit {total_d:,.2f} vs kredit {total_k:,.2f}. "
            f"Baris akun lawan harus melengkapi nominal mutasi ({nominal:,.2f}) di sisi "
            f"{'kredit' if masuk else 'debit'}, dikurangi/ditambah baris sisi lain bila ada (mis. pajak).",
            kode="UNBALANCED",
        )

    je = _tulis_jurnal(
        session, client_id=client_id, user_id=user_id, username=username,
        je_number=f"{PREFIX_JURNAL}{tgl.year}-{uuid.uuid4().hex[:8].upper()}", tgl=tgl,
        description=f"{category}: {ket_bank}", reference=m.ref, status_jurnal="draft", baris=baris,
    )
    if notes:
        je.notes = notes
    return {
        "bank_mutation_ref": m.ref, "kind": "non_invoice", "category": category,
        "direction": "cash_receipt" if masuk else "cash_payment", "amount": float(nominal),
        "journal_entry_id": str(je.id), "journal_no": je.je_number, "journal_status": "DRAFT",
        "bank_account": {"id": bank["id"], "no_akun": bank["no_akun"], "nama_akun": bank["nama_akun"]},
    }


# ============================================================
# EXCEPTIONS (unmatched)
# ============================================================

def _catat_unmatched(client_id: str, m: MutasiIn, saran: Optional[Dict[str, Any]], user_id: Optional[str]) -> None:
    try:
        tipe, nominal = _arah_dan_nominal(m)
    except _Gagal:
        return
    if saran and saran["candidates"]:
        top = saran["candidates"][0]
        nama = ", ".join(a["invoice_no"] or "-" for a in top["allocations"])
        ai = (f"Ada {len(saran['candidates'])} kandidat invoice tetapi belum cukup pasti "
              f"(teratas: {nama}, skor {top['score']}). Cocokkan manual di tab Reconciliation.")
    else:
        ai = ("Tidak ada invoice Purchase/Sales outstanding yang nominalnya cocok. "
              "Klasifikasikan lewat Journal Preview jalur lengkap atau periksa input invoice.")
    dbc.upsert_bank_cash_exception({
        "client_id": client_id, "bank_mutation_ref": m.ref, "exception_type": TIPE_EXCEPTION_UNMATCHED,
        "source": "Reconciliation", "priority": _prioritas(nominal), "status": "Open",
        "ai_suggestion": ai,
        "source_snippet": {"tanggal": m.date, "kredit" if tipe == "sales" else "debit": float(nominal),
                           "rekening": m.bank_account or ""},
    }, user_id=user_id)


def _tutup_exception_unmatched(client_id: str, ref: str, user_id: Optional[str]) -> None:
    try:
        for row in dbc.list_bank_cash_exceptions(client_id=client_id, bank_mutation_ref=ref) or []:
            if row.get("exception_type") == TIPE_EXCEPTION_UNMATCHED and row.get("status") != "Resolved":
                dbc.update_bank_cash_exception(
                    row["id"], {"status": "Resolved", "resolved_at": datetime.now(), "resolved_by": user_id},
                    updated_by=user_id,
                )
    except Exception as e:  # exception hanya catatan; jangan gagalkan pencocokan yang sudah tersimpan
        logger.warning("Gagal menutup exception unmatched %s: %s", ref, e)


def _buka_lagi_exception_unmatched(client_id: str, ref: str, user_id: Optional[str]) -> None:
    """Kebalikan _tutup_exception_unmatched: setelah unmatch, mutasi kembali belum cocok, jadi
    exception "Unmatched bank mutation" yang tadinya ditutup (Resolved) dibuka lagi (Open)."""
    try:
        for row in dbc.list_bank_cash_exceptions(client_id=client_id, bank_mutation_ref=ref) or []:
            if row.get("exception_type") == TIPE_EXCEPTION_UNMATCHED and row.get("status") == "Resolved":
                dbc.update_bank_cash_exception(
                    row["id"], {"status": "Open", "resolved_at": None, "resolved_by": None},
                    updated_by=user_id,
                )
    except Exception as e:  # catatan saja; jangan gagalkan unmatch yang sudah tersimpan
        logger.warning("Gagal membuka lagi exception unmatched %s: %s", ref, e)


def _balas_gagal(e: _Gagal):
    return gagal(message=e.pesan, errors={"code": e.kode, "detail": e.detail}, status_code=e.status_code)


# ============================================================
# ENDPOINTS
# ============================================================

@router.post("/suggest", summary="Saran pencocokan mutasi Bank Feed ke invoice outstanding (tidak menulis apa pun)")
def api_suggest(payload: SuggestRequest, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        kandidat = _muat_kandidat(session, payload.client_id)
        sudah = _ref_sudah_dicocokkan(session, payload.client_id)
    finally:
        session.close()
    hasil = []
    for m in payload.mutations:
        if m.ref in sudah:
            hasil.append({"ref": m.ref, "already_matched": True, "candidates": [], "auto_match": False})
            continue
        try:
            hasil.append(_saran_untuk_mutasi(m, kandidat))
        except _Gagal as e:
            hasil.append({"ref": m.ref, "error": e.pesan, "candidates": [], "auto_match": False})
    return sukses(data={"results": hasil}, message="OK")


@router.post("/match", summary="Cocokkan 1 mutasi ke 1..n invoice: catat pembayaran + jurnal DRAFT (Supervisor ke atas)")
def api_match(payload: MatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    try:
        hasil = _match_satu(
            payload.client_id, payload.mutation, [a.model_dump() for a in payload.allocations],
            payload.bank_coa_id, payload.counter_coa_id, payload.notes, user_id,
            str(current_user.get("username") or "")[:255] or None,
        )
    except _Gagal as e:
        return _balas_gagal(e)
    _tutup_exception_unmatched(payload.client_id, payload.mutation.ref, user_id)
    return sukses(data=hasil, message="Mutasi berhasil dicocokkan. Jurnal berstatus DRAFT.", status_code=201)


@router.post("/auto-match", summary="Cocokkan otomatis mutasi yang pasti; sisanya dicatat sebagai exception (Supervisor ke atas)")
def api_auto_match(payload: AutoMatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    session = dbc.SessionLocal()
    try:
        kandidat = _muat_kandidat(session, payload.client_id)
        sudah = _ref_sudah_dicocokkan(session, payload.client_id)
    finally:
        session.close()

    matched: List[Dict[str, Any]] = []
    unmatched: List[Dict[str, Any]] = []
    dilewati: List[str] = []
    for m in payload.mutations:
        if m.ref in sudah:
            dilewati.append(m.ref)
            continue
        try:
            saran = _saran_untuk_mutasi(m, kandidat)
        except _Gagal as e:
            unmatched.append({"ref": m.ref, "alasan": e.pesan})
            continue
        if saran["auto_match"]:
            alok = [{"invoice_id": a["invoice_id"], "amount": a["amount"]} for a in saran["candidates"][0]["allocations"]]
            try:
                hasil = _match_satu(payload.client_id, m, alok, payload.bank_coa_id, None, "Auto-match rekonsiliasi",
                                    user_id, str(current_user.get("username") or "")[:255] or None)
            except _Gagal as e:
                unmatched.append({"ref": m.ref, "alasan": e.pesan, "kode": e.kode, "detail": e.detail})
                if payload.catat_exception and e.kode not in ("ALREADY_MATCHED",):
                    _catat_unmatched(payload.client_id, m, saran, user_id)
                continue
            matched.append(hasil)
            _tutup_exception_unmatched(payload.client_id, m.ref, user_id)
            # kurangi sisa in-memory supaya mutasi berikutnya di batch ini tidak memakai sisa yang sama
            tipe, _n = _arah_dan_nominal(m)
            for a in alok:
                for c in kandidat[tipe]:
                    if c["id"] == a["invoice_id"]:
                        c["outstanding"] -= _dec(a["amount"])
            kandidat[tipe] = [c for c in kandidat[tipe] if c["outstanding"] > Decimal("0.005")]
        else:
            unmatched.append({"ref": m.ref, "alasan": "Belum ada kandidat yang cukup pasti.",
                              "jumlah_kandidat": len(saran["candidates"])})
            if payload.catat_exception:
                _catat_unmatched(payload.client_id, m, saran, user_id)

    return sukses(
        data={"matched": matched, "unmatched": unmatched, "already_matched": dilewati},
        message=f"{len(matched)} mutasi dicocokkan, {len(unmatched)} belum cocok.",
    )


@router.post("/match-non-invoice", summary="Jurnal DRAFT untuk mutasi tanpa invoice (biaya admin, bunga, pajak, transfer antar bank, setoran modal) (Supervisor ke atas)")
def api_match_non_invoice(payload: NonInvoiceRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    session = dbc.SessionLocal()
    try:
        hasil = _lakukan_non_invoice(
            session, client_id=payload.client_id, m=payload.mutation, category=payload.category.strip(),
            lines=[l.model_dump() for l in payload.lines], bank_coa_id=payload.bank_coa_id,
            notes=payload.notes, user_id=user_id, username=str(current_user.get("username") or "")[:255] or None,
        )
        session.commit()
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()
    _tutup_exception_unmatched(payload.client_id, payload.mutation.ref, user_id)
    return sukses(data=hasil, message="Mutasi dicatat sebagai jurnal DRAFT (tanpa invoice).", status_code=201)


@router.post("/unmatch", summary="Batalkan pencocokan: pembayaran dibatalkan (saldo invoice dipulihkan trigger) & jurnal DRAFT ditolak (Supervisor ke atas)")
def api_unmatch(payload: UnmatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    session = dbc.SessionLocal()
    try:
        pay = session.execute(text("""
            select id::text as id, journal_entry_id::text as je from financial_transaction_bank_cash_payments
             where client_id = cast(:c as uuid) and bank_mutation_ref = :r and deleted_at is null
        """), {"c": payload.client_id, "r": payload.bank_mutation_ref}).mappings().all()
        if not pay:
            # Jalur non-invoice: tidak ada pembayaran; jurnalnya dicari lewat ref mutasi.
            nj = session.execute(text(f"""
                select je.id::text as id, je.je_number as journal_no, upper(je.status) as status {_SQL_JURNAL_REKON}
                   and je.source_reference = :r and lower(je.status) in ('draft', 'approved', 'posted')
                   and not exists (select 1 from financial_transaction_bank_cash_payments p
                                    where p.journal_entry_id = je.id)
                   {_SQL_BELUM_DIBALIK}
            """), {"c": payload.client_id, "r": payload.bank_mutation_ref}).mappings().all()
            if not nj:
                raise _Gagal("Tidak ada pencocokan aktif untuk mutasi ini.", kode="NOT_FOUND", status_code=404)
            if any(j["status"] == "POSTED" for j in nj):
                raise _Gagal(
                    f"Jurnal {', '.join(j['journal_no'] for j in nj if j['status'] == 'POSTED')} sudah diposting, "
                    "tidak bisa dibatalkan otomatis. Balik jurnalnya dulu lewat tab Posted (Manager ke atas).",
                    kode="JOURNAL_POSTED", status_code=409,
                )
            session.execute(text("""
                update financial_transaction_journal_entry_drafts
                   set status = 'rejected', edited_at = now(), edited_by = cast(:by as uuid)
                 where id = any(cast(:ids as uuid[])) and lower(status) <> 'posted'
            """), {"ids": [j["id"] for j in nj], "by": user_id})
            session.commit()
            _buka_lagi_exception_unmatched(payload.client_id, payload.bank_mutation_ref, user_id)
            return sukses(
                data={"bank_mutation_ref": payload.bank_mutation_ref, "payments_dibatalkan": 0, "journal_ditolak": len(nj)},
                message="Pencocokan dibatalkan.",
            )

        je_ids = sorted({p["je"] for p in pay if p["je"]})
        if je_ids:
            terposting = session.execute(text("""
                select je_number from financial_transaction_journal_entry_drafts
                 where id = any(cast(:ids as uuid[])) and lower(status) = 'posted'
            """), {"ids": je_ids}).scalars().all()
            if terposting:
                raise _Gagal(
                    f"Jurnal {', '.join(terposting)} sudah diposting, tidak bisa dibatalkan otomatis. "
                    "Balik jurnalnya dulu lewat tab Posted (Manager ke atas).", kode="JOURNAL_POSTED", status_code=409,
                )

        session.execute(text("""
            update financial_transaction_bank_cash_payments
               set deleted_at = now(), deleted_by = cast(:by as uuid),
                   notes = coalesce(notes || ' | ', '') || :alasan
             where client_id = cast(:c as uuid) and bank_mutation_ref = :r and deleted_at is null
        """), {"c": payload.client_id, "r": payload.bank_mutation_ref, "by": user_id,
               "alasan": f"Dibatalkan: {payload.alasan or 'unmatch'}"})
        if je_ids:
            session.execute(text("""
                update financial_transaction_journal_entry_drafts
                   set status = 'rejected', edited_at = now(), edited_by = cast(:by as uuid)
                 where id = any(cast(:ids as uuid[])) and lower(status) <> 'posted'
            """), {"ids": je_ids, "by": user_id})
        session.commit()
        _buka_lagi_exception_unmatched(payload.client_id, payload.bank_mutation_ref, user_id)
        return sukses(
            data={"bank_mutation_ref": payload.bank_mutation_ref, "payments_dibatalkan": len(pay), "journal_ditolak": len(je_ids)},
            message="Pencocokan dibatalkan.",
        )
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()


def _kunci_jurnal_rekon(session, client_id: str, je_id: str):
    """Ambil + kunci jurnal hasil rekonsiliasi (for update) supaya dua permintaan bersamaan tidak saling menimpa."""
    if not client_id or not je_id:
        raise _Gagal("client_id / journal_entry_id tidak valid.")
    je = session.execute(text("""
        select id::text as id, je_number as journal_no, upper(status) as status, posting_date, entry_date,
               source_reference, currency
          from financial_transaction_journal_entry_drafts
         where id = cast(:id as uuid) and management_client_id = cast(:c as uuid) and deleted_at is null
           for update
    """), {"id": je_id, "c": client_id}).mappings().first()
    if not je:
        raise _Gagal("Jurnal tidak ditemukan.", kode="NOT_FOUND", status_code=404)
    if not str(je["journal_no"] or "").startswith(PREFIX_JURNAL):
        raise _Gagal("Hanya jurnal hasil rekonsiliasi bank yang bisa diproses dari sini.",
                     kode="NOT_RECONCILIATION_JOURNAL")
    return je


@router.post("/approve", summary="Setujui jurnal hasil rekonsiliasi: DRAFT -> APPROVED (Supervisor ke atas)")
def api_approve(payload: JurnalAksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_APPROVE))):
    user_id = _uuid_atau_none(current_user.get("id"))
    username = str(current_user.get("username") or "unknown")[:100]
    session = dbc.SessionLocal()
    try:
        client_id, je_id = _uuid_atau_none(payload.client_id), _uuid_atau_none(payload.journal_entry_id)
        je = _kunci_jurnal_rekon(session, client_id, je_id)
        if je["status"] != "DRAFT":
            raise _Gagal(f"Jurnal {je['journal_no']} berstatus {je['status']}. Hanya jurnal DRAFT yang bisa disetujui.",
                         kode="NOT_DRAFT", status_code=409)
        aktif = session.execute(text("""
            select count(*) from financial_transaction_bank_cash_payments
             where journal_entry_id = cast(:je as uuid) and deleted_at is null
        """), {"je": je_id}).scalar()
        if not aktif and not _jurnal_non_invoice(session, client_id, je_id):
            raise _Gagal(f"Jurnal {je['journal_no']} tidak punya pembayaran aktif (mungkin sudah di-unmatch).",
                         kode="NO_PAYMENT", status_code=409)
        session.execute(text("""
            update financial_transaction_journal_entry_drafts
               set status = 'approved', approved_by_name = :u, edited_at = now(), edited_by = cast(:uid as uuid)
             where id = cast(:id as uuid)
        """), {"u": username, "uid": user_id, "id": je_id})
        session.commit()
        hasil = {"journal_entry_id": je_id, "journal_no": je["journal_no"], "status": "APPROVED", "approved_by": username}
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()

    try:
        dbc.log_audit(client_id, username, "approve_bank_recon_journal", hasil)
    except Exception as e:
        logger.warning("Gagal mencatat audit approve %s: %s", hasil.get("journal_no"), e)
    return sukses(data=hasil, message=f"Jurnal {hasil['journal_no']} disetujui. Siap diposting.")


@router.post("/post", summary="Posting jurnal hasil rekonsiliasi: APPROVED -> POSTED + terapkan pembayaran ke invoice (Manager ke atas)")
def api_post(payload: JurnalAksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    user_id = _uuid_atau_none(current_user.get("id"))
    username = str(current_user.get("username") or "unknown")[:100]
    session = dbc.SessionLocal()
    try:
        client_id, je_id = _uuid_atau_none(payload.client_id), _uuid_atau_none(payload.journal_entry_id)
        je = _kunci_jurnal_rekon(session, client_id, je_id)
        if je["status"] != "APPROVED":
            raise _Gagal(
                f"Jurnal {je['journal_no']} berstatus {je['status']}. Hanya jurnal APPROVED yang bisa diposting; setujui (Approve) dulu.",
                kode="NOT_APPROVED", status_code=409,
            )
        total = session.execute(text("""
            select coalesce(sum(debit), 0) as d, coalesce(sum(credit), 0) as k, count(*) as n
              from financial_transaction_journal_entry_draft_lines
             where draft_id = cast(:id as uuid) and deleted_at is null
        """), {"id": je_id}).mappings().first()
        if not total["n"] or _dec(total["d"]) <= 0:
            raise _Gagal(f"Jurnal {je['journal_no']} tidak punya baris.", kode="NO_LINES")
        if abs(_dec(total["d"]) - _dec(total["k"])) > Decimal("0.005"):
            raise _Gagal(f"Jurnal {je['journal_no']} tidak seimbang (debit {total['d']} vs kredit {total['k']}).",
                         kode="UNBALANCED")

        # Terapkan pembayaran -> trigger fn_bcp_validate (cek sisa tagihan) + fn_bcp_apply (ubah invoice) berjalan di sini.
        diterapkan = session.execute(text("""
            update financial_transaction_bank_cash_payments
               set applied_at = now(), edited_at = now(), edited_by = cast(:uid as uuid)
             where journal_entry_id = cast(:je as uuid) and deleted_at is null and applied_at is null
         returning id::text
        """), {"je": je_id, "uid": user_id}).scalars().all()
        # Jalur non-invoice (biaya admin, bunga, dst) memang tidak punya pembayaran untuk diterapkan.
        if not diterapkan and not _jurnal_non_invoice(session, client_id, je_id):
            raise _Gagal(f"Jurnal {je['journal_no']} tidak punya pembayaran yang menunggu diterapkan.",
                         kode="NO_PAYMENT", status_code=409)

        session.execute(text("""
            update financial_transaction_journal_entry_drafts
               set status = 'posted', posted_by = cast(:uid as uuid), posted_at = now(),
                   edited_at = now(), edited_by = cast(:uid as uuid)
             where id = cast(:id as uuid)
        """), {"uid": user_id, "id": je_id})
        session.commit()
        hasil = {"journal_entry_id": je_id, "journal_no": je["journal_no"], "status": "POSTED",
                 "posted_by": username, "payments_diterapkan": len(diterapkan)}
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()

    try:
        dbc.log_audit(client_id, username, "post_bank_recon_journal", hasil)
    except Exception as e:
        logger.warning("Gagal mencatat audit post %s: %s", hasil.get("journal_no"), e)
    return sukses(data=hasil, message=f"Jurnal {hasil['journal_no']} diposting. Outstanding invoice diperbarui.")


@router.post("/reverse", summary="Balik jurnal POSTED hasil rekonsiliasi: jurnal pembalik (POSTED) + pembayaran dibatalkan, outstanding invoice dipulihkan (Manager ke atas)")
def api_reverse(payload: ReverseRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_REVERSAL))):
    user_id = _uuid_atau_none(current_user.get("id"))
    username = str(current_user.get("username") or "unknown")[:100]
    alasan = payload.alasan.strip()
    session = dbc.SessionLocal()
    try:
        client_id, je_id = _uuid_atau_none(payload.client_id), _uuid_atau_none(payload.journal_entry_id)
        if not client_id or not je_id:
            raise _Gagal("client_id / journal_entry_id tidak valid.")
        if len(alasan) < 5:
            raise _Gagal("Alasan pembalikan wajib diisi (minimal 5 karakter).")

        # Kunci baris jurnal asal supaya dua permintaan bersamaan tidak membalik dua kali.
        je = _kunci_jurnal_rekon(session, client_id, je_id)
        if je["status"] != "POSTED":
            raise _Gagal(
                f"Jurnal {je['journal_no']} berstatus {je['status']}. Hanya jurnal yang sudah diposting yang perlu dibalik; "
                "jurnal DRAFT cukup dibatalkan lewat unmatch di tab Reconciliation.",
                kode="NOT_POSTED", status_code=409,
            )
        no_pembalik = f"{PREFIX_PEMBALIK}{je['journal_no']}"
        sudah = session.execute(text("""
            select je_number from financial_transaction_journal_entry_drafts
             where management_client_id = cast(:c as uuid) and je_number = :n and deleted_at is null limit 1
        """), {"c": client_id, "n": no_pembalik}).scalar()
        if sudah:
            raise _Gagal(f"Jurnal {je['journal_no']} sudah dibalik oleh {sudah}.", kode="ALREADY_REVERSED", status_code=409)

        if payload.tanggal:
            try:
                tgl = _parse_tanggal(payload.tanggal)
            except _Gagal:
                raise _Gagal(f"Tanggal jurnal pembalik tidak valid: '{payload.tanggal}'.")
        else:
            tgl = date.today()
        tgl_asal = je["posting_date"] or je["entry_date"]
        if tgl_asal and tgl < tgl_asal:
            raise _Gagal(
                f"Tanggal jurnal pembalik ({tgl.isoformat()}) tidak boleh sebelum tanggal jurnal asal ({tgl_asal.isoformat()}).",
                kode="DATE_BEFORE_ORIGINAL",
            )

        baris = session.execute(text("""
            select account_code, account_name, description, debit, credit, cost_center
              from financial_transaction_journal_entry_draft_lines
             where draft_id = cast(:id as uuid) and deleted_at is null
             order by line_no
        """), {"id": je_id}).mappings().all()
        if not baris:
            raise _Gagal("Jurnal ini tidak punya baris, tidak ada yang bisa dibalik.", kode="NO_LINES")

        # Jurnal pembalik: debit/kredit ditukar, langsung posted (buku besar nettonya nol).
        rv = _tulis_jurnal(
            session, client_id=client_id, user_id=user_id, username=username, je_number=no_pembalik, tgl=tgl,
            description=f"Pembalik {je['journal_no']}: {alasan}", reference=je["source_reference"] or je["journal_no"],
            status_jurnal="posted", posted=True,
            baris=[{
                "akun": {"no_akun": b["account_code"], "nama_akun": b["account_name"]},
                "debit": b["credit"], "credit": b["debit"], "cost_center": b["cost_center"], "partner": None,
                "desc": f"Pembalik {je['journal_no']}: {b['description'] or ''}".strip(),
            } for b in baris],
        )
        rv.notes = alasan

        # Batalkan pembayaran jurnal asal; trigger fn_bcp_apply memulihkan outstanding invoice.
        dibatalkan = session.execute(text("""
            update financial_transaction_bank_cash_payments
               set deleted_at = now(), deleted_by = cast(:by as uuid),
                   notes = coalesce(notes || ' | ', '') || :ket
             where client_id = cast(:c as uuid) and journal_entry_id = cast(:je as uuid) and deleted_at is null
         returning id::text
        """), {"c": client_id, "je": je_id, "by": user_id,
               "ket": f"Dibatalkan: jurnal dibalik oleh {rv.je_number} ({alasan})"}).scalars().all()

        session.commit()
        hasil = {
            "journal_entry_id": je_id, "journal_no": je["journal_no"],
            "reversal_id": str(rv.id), "reversal_no": rv.je_number, "reversal_date": tgl.isoformat(),
            "payments_dibatalkan": len(dibatalkan),
        }
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()

    # Audit trail: dicatat SETELAH commit dan tidak boleh menggagalkan pembalikan yang sudah tersimpan.
    try:
        dbc.log_audit(client_id, username, "reverse_bank_recon_journal", hasil)
    except Exception as e:
        logger.warning("Gagal mencatat audit reversal %s: %s", hasil.get("reversal_no"), e)
    return sukses(data=hasil, message=f"Jurnal dibalik ({hasil['reversal_no']}). Pembayaran dibatalkan dan outstanding invoice dipulihkan.")


@router.get("/payments", summary="Daftar pembayaran hasil rekonsiliasi (sumber tab Cash Payment / Cash Receipt / Overview)")
def api_daftar_payments(
    client_id: str = Query(..., description="management_clients.id"),
    direction: Optional[str] = Query(None, pattern="^(cash_payment|cash_receipt)$"),
    termasuk_dibatalkan: bool = Query(False),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        rows = session.execute(text("""
            select p.id::text as id, p.direction, p.payment_date, p.amount, p.bank_account, p.bank_mutation_ref,
                   p.mutation_amount, p.mutation_description, p.source_file, p.notes, p.deleted_at, p.created_at, p.applied_at,
                   p.purchase_transaction_id::text as purchase_id, p.sales_invoice_id::text as sales_id,
                   coalesce(pt.invoice_number, pt.purchase_no, si.invoice_no) as invoice_no,
                   coalesce(pt.vendor_name, si.customer_name) as party,
                   coalesce(pt.total, si.gross_amount) as invoice_total,
                   p.journal_entry_id::text as journal_entry_id, je.je_number as journal_no,
                   upper(je.status) as journal_status,
                   cb.acc_no as bank_no_akun, cb.account_name as bank_nama_akun,
                   cc.acc_no as counter_no_akun, cc.account_name as counter_nama_akun
              from financial_transaction_bank_cash_payments p
              left join financial_transaction_purchase_transactions pt on pt.id = p.purchase_transaction_id
              left join financial_transaction_sales_invoices si on si.id = p.sales_invoice_id
              left join financial_transaction_journal_entry_drafts je on je.id = p.journal_entry_id
              left join management_client_coa cb on cb.id = p.bank_coa_id
              left join management_client_coa cc on cc.id = p.counter_coa_id
             where p.client_id = cast(:c as uuid)
               and (cast(:dir as text) is null or p.direction = cast(:dir as text))
               and (cast(:semua as boolean) or p.deleted_at is null)
             order by p.payment_date desc, p.created_at desc
        """), {"c": client_id, "dir": direction, "semua": termasuk_dibatalkan}).mappings().all()
        return sukses(data=[dict(r) for r in rows], message="OK")
    finally:
        session.close()


@router.get("/journal-preview", summary="Jurnal Kas vs Hutang/Piutang hasil rekonsiliasi (Journal Preview jalur pendek)")
def api_journal_preview(
    client_id: str = Query(..., description="management_clients.id"),
    status_jurnal: Optional[str] = Query(None, alias="status", pattern="^(DRAFT|APPROVED|POSTED|REJECTED|REVERSED)$"),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        entries = session.execute(text("""
            select je.id::text as id, je.je_number as journal_no, coalesce(je.posting_date, je.entry_date) as posting_date,
                   je.description, je.source_reference as reference, upper(je.status) as status,
                   je.approved_by_name as approved_by, coalesce(pu.username, je.approved_by_name) as posted_by,
                   je.posted_at,
                   not exists (select 1 from financial_transaction_bank_cash_payments pp
                                where pp.journal_entry_id = je.id) as non_invoice,
                   rv.id::text as reversal_id, rv.je_number as reversal_no,
                   coalesce(rv.posting_date, rv.entry_date) as reversal_date,
                   rv.approved_by_name as reversal_by, rv.posted_at as reversal_at, rv.description as reversal_description
              from financial_transaction_journal_entry_drafts je
              left join lateral (
                    select r.id, r.je_number, r.posting_date, r.entry_date, r.approved_by_name, r.posted_at, r.description
                      from financial_transaction_journal_entry_drafts r
                     where r.management_client_id = je.management_client_id
                       and r.je_number = 'RV-' || je.je_number and r.deleted_at is null
                     order by r.created_at desc limit 1
              ) rv on true
              left join management_users pu on pu.id_user = je.posted_by
             where je.management_client_id = cast(:c as uuid) and je.deleted_at is null
               and je.je_number like 'BR-%'
               and (cast(:st as text) is null or lower(je.status) = lower(cast(:st as text)))
             order by coalesce(je.posting_date, je.entry_date) desc, je.je_number desc
        """), {"c": client_id, "st": status_jurnal}).mappings().all()
        if not entries:
            return sukses(data=[], message="OK")
        jenis_kas = {a["no_akun"]: a["jenis_kas"] for a in _daftar_akun(session, client_id, hanya_aktif=False)}
        baris = session.execute(text("""
            select l.draft_id::text as je, l.line_no, l.account_code as no_akun, l.account_name as nama_akun,
                   l.debit, l.credit, l.description, null as partner_name
              from financial_transaction_journal_entry_draft_lines l
             where l.draft_id = any(cast(:ids as uuid[])) and l.deleted_at is null
             order by l.draft_id, l.line_no
        """), {"ids": [e["id"] for e in entries]}).mappings().all()
        per_je: Dict[str, List[Dict[str, Any]]] = {}
        for b in baris:
            baris_dict = {k: v for k, v in dict(b).items() if k != "je"}
            baris_dict["jenis_kas"] = jenis_kas.get(b["no_akun"])
            per_je.setdefault(b["je"], []).append(baris_dict)
        data = [{**dict(e), "lines": per_je.get(e["id"], [])} for e in entries]
        return sukses(data=data, message="OK")
    finally:
        session.close()


@router.get("/accounts", summary="Akun COA client (management_client_coa) + jenis_kas, untuk dropdown akun Bank & akun lawan")
def api_daftar_akun(
    client_id: str = Query(..., description="management_clients.id"),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    if not _uuid_atau_none(client_id):
        return gagal(message="client_id tidak valid.", errors={"code": "VALIDATION"}, status_code=422)
    session = dbc.SessionLocal()
    try:
        akun = _daftar_akun(session, client_id)
        return sukses(data={"coa": [{k: v for k, v in a.items() if k != "standard_account_code"} for a in akun]},
                      message="OK")
    finally:
        session.close()
