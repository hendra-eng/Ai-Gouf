// ─── JEMBATAN BACKEND (finance_transaction_bank_cash) → HALAMAN CASH
// PAYMENT & CASH RECEIPT ────────────────────────────────────────────────
// Satu-satunya tempat yang menerjemahkan hasil GET
// /api/client/{client_id}/bank-cash (lihat daftarBankCash() di
// @/app/agent-ai/lib/api.js, dan dbc.daftar_bank_cash() di
// backend/db_client.py) menjadi bentuk Transaction[] yang dipakai
// TransactionsContext & khusus 2 sub halaman Cash Payment/Cash Receipt
// lewat getTransactionGroup(). Pola file ini SENGAJA identik dengan
// jurnalBridge.ts (skema tabel backend sama persis, cuma tabel
// terpisah) -- lihat komentar di sana untuk penjelasan lebih detail
// per konsep yang sama.
//
// Satu baris finance_transaction_bank_cash = SATU entri jurnal
// berpasangan (satu akun debet + satu akun kredit dalam satu baris yang
// sama). Sama seperti jurnalBridge.ts, setiap baris backend dipecah jadi
// DUA baris Transaction (satu leg debet, satu leg kredit) yang berbagi
// jeId yang sama.
//
// jeId di sini SENGAJA diberi prefix "BC-" (bukan "JE-" seperti
// jurnalBridge.ts) supaya TransactionsContext bisa membedakan baris ini
// datang dari tabel finance_transaction_bank_cash, bukan jurnal_posting --
// lihat extractBankCashId() di bawah vs extractPostingId() di
// jurnalBridge.ts, dan pemakaiannya di TransactionsContext.tsx (saveEdit/
// deleteTransactions/postAllUnposted dst -- keduanya dicoba, salah satu
// yang match dipakai untuk tahu endpoint PATCH/posting mana yang benar).

import type { Transaction } from '../components/transactionData';
import { classifyJournalPairCategory } from '../components/transactionData';

/** Bentuk satu baris respons GET /api/client/{client_id}/bank-cash (lihat db_client._bank_cash_ke_dict). */
export interface BackendBankCashRow {
  id: number;
  hasil_id?: number | null;
  jenis_dokumen?: string | null; // 'cash_payment' | 'cash_receipt'
  tanggal?: string | null;
  keterangan?: string | null;
  lawan_transaksi?: string | null;
  no_dokumen?: string | null;
  project_unit?: string | null;
  jatuh_tempo?: string | null;
  no_akun_debet?: string | null;
  nama_akun_debet?: string | null;
  jml_debet?: number | null;
  no_akun_kredit?: string | null;
  nama_akun_kredit?: string | null;
  jml_kredit?: number | null;
  status?: string | null; // 'draft' | 'terposting' | 'ditolak'
  sumber_placeholder?: unknown;
  voucher?: string | null;
  periode_voucher?: string | null;
  payment_status?: string | null;
  paid_amount?: number | null;
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

// Sama seperti STATUS_MAP di jurnalBridge.ts -- 'draft' backend = "sudah
// masuk sistem tapi belum diposting", persis definisi 'Unposted' di
// frontend. 'ditolak' -> 'Voided' (tidak masuk buku besar).
const STATUS_MAP: Record<string, Transaction['status']> = {
  draft: 'Unposted',
  terposting: 'Posted',
  ditolak: 'Voided',
};

function mapStatus(status?: string | null): Transaction['status'] {
  if (!status) return 'Unposted';
  return STATUS_MAP[status] || 'Unposted';
}

function safeAmount(value?: number | null): number {
  return typeof value === 'number' && !isNaN(value) ? value : 0;
}

/** Satu leg (debet ATAU kredit) dari satu baris finance_transaction_bank_cash -> satu Transaction. */
function legFromRow(row: BackendBankCashRow, side: 'debet' | 'kredit'): Transaction {
  const isDebet = side === 'debet';
  const rawAccountCode = isDebet ? row.no_akun_debet : row.no_akun_kredit;
  const accountCode = rawAccountCode ? String(rawAccountCode) : '—';
  const accountName = (isDebet ? row.nama_akun_debet : row.nama_akun_kredit) || '—';
  const amount = safeAmount(isDebet ? row.jml_debet : row.jml_kredit);
  const reference = row.no_dokumen || row.lawan_transaksi || `BC-${row.id}`;

  return {
    id: `bc-${row.id}-${side}`,
    date: row.tanggal || '',
    txId: `TXN-BC-${row.id}-${isDebet ? 'D' : 'K'}`,
    accountCode,
    accountName,
    description: row.keterangan || '—',
    debit: isDebet ? amount : 0,
    credit: isDebet ? 0 : amount,
    reference,
    party: row.lawan_transaksi || '—',
    // Kategori GRANULAR (Tax/AP Payment/CapEx/Financing/dst) tetap dihitung
    // dari pasangan nama akun -- sama seperti jurnalBridge.ts -- supaya KPI
    // "Pembayaran Pajak"/"Pembayaran Hutang Usaha" (countJournalsByCategory)
    // dan breakdown "per Kategori" di halaman Cash Payment/Cash Receipt
    // tetap jalan. Pengelompokan ke sub halaman yang BENAR (cash_payment vs
    // cash_receipt) tidak digantungkan ke tebakan nama akun ini -- lihat
    // `sourceModule` di bawah, yang memakai `jenis_dokumen` yang memang
    // sudah eksplisit disimpan backend per baris.
    category: classifyJournalPairCategory(row.nama_akun_debet, row.nama_akun_kredit),
    type: isDebet ? 'debit' : 'credit',
    status: mapStatus(row.status),
    jeId: `BC-${row.id}`,
    notes: row.project_unit || undefined,
    voucherNo: row.voucher || row.periode_voucher || '—',
    saldoAkhir: 0,
    cek: false,
    paymentStatus: (row.payment_status as Transaction['paymentStatus']) || undefined,
    paidAmount: row.paid_amount ?? undefined,
    dueDate: row.jatuh_tempo || undefined,
    // [PENTING] getTransactionGroup() di transactionData.ts mengecek
    // sourceModule LEBIH DULU sebelum fallback ke CATEGORY_TO_GROUP/nama
    // akun -- diisi langsung dari `jenis_dokumen` (field eksplisit yang
    // sudah dipilih user/backend saat baris ini dibuat), supaya baris ini
    // PASTI mendarat di sub halaman Cash Payment/Cash Receipt yang benar,
    // tidak pernah salah tebak walau nama akunnya ambigu.
    sourceModule: row.jenis_dokumen === 'cash_receipt' ? 'CASH_RECEIPT' : 'CASH_PAYMENT',
  };
}

/** Seluruh baris finance_transaction_bank_cash -> Transaction[] (2 leg per baris). */
export function transactionsFromBankCash(rows: BackendBankCashRow[]): Transaction[] {
  const out: Transaction[] = [];
  for (const row of rows || []) {
    out.push(legFromRow(row, 'debet'));
    out.push(legFromRow(row, 'kredit'));
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ─── PERSIST EDIT/POSTING HALAMAN CASH PAYMENT/CASH RECEIPT → BACKEND ─────

/**
 * Ekstrak bank_cash id asli dari jeId satu Transaction -- HANYA baris yang
 * datang dari transactionsFromBankCash() (backend asli) yang jeId-nya
 * berformat persis "BC-<angka>" (lihat legFromRow di atas). Baris lokal
 * (data contoh statis / jurnal manual yang gagal tersimpan) mengembalikan
 * null di sini -- dipakai TransactionsContext untuk tahu baris mana yang
 * boleh dikirim PATCH/posting ke endpoint /bank-cash, vs baris yang cuma
 * bisa diubah di state lokal.
 */
export function extractBankCashId(jeId: string | undefined | null): number | null {
  if (!jeId) return null;
  const m = /^BC-(\d+)$/.exec(jeId);
  return m ? Number(m[1]) : null;
}

/** true kalau Transaction ini datang dari finance_transaction_bank_cash backend asli. */
export function isBankCashSynced(tx: Transaction): boolean {
  return extractBankCashId(tx.jeId) !== null;
}

/**
 * Susun payload PATCH /api/client/{id}/bank-cash/{bank_cash_id} dari SATU
 * leg yang baru diedit (`edited`) + leg pasangannya yang tidak ikut diedit
 * (`sibling`) -- pola identik buildUpdatePayloadFromPair() di
 * jurnalBridge.ts, cuma tanpa field khusus Accounting Core V2.
 */
export function buildBankCashUpdatePayload(edited: Transaction, sibling: Transaction | null) {
  const debetLeg = edited.type === 'credit' ? sibling : edited;
  const kreditLeg = edited.type === 'credit' ? edited : sibling;
  return {
    tanggal: edited.date || undefined,
    keterangan: edited.description || undefined,
    lawan_transaksi: edited.party || undefined,
    no_dokumen: edited.reference || undefined,
    project_unit: edited.notes || undefined,
    jatuh_tempo: edited.dueDate ?? undefined,
    no_akun_debet: debetLeg?.accountCode || undefined,
    nama_akun_debet: debetLeg?.accountName || undefined,
    jml_debet: debetLeg?.debit ?? undefined,
    no_akun_kredit: kreditLeg?.accountCode || undefined,
    nama_akun_kredit: kreditLeg?.accountName || undefined,
    jml_kredit: kreditLeg?.credit ?? undefined,
    status: edited.status || undefined,
    payment_status: edited.paymentStatus ?? undefined,
    paid_amount: edited.paidAmount ?? undefined,
  };
}

/**
 * Susun payload POST /api/client/{id}/bank-cash/manual dari sepasang
 * Transaction baru (satu leg debet + satu leg kredit) yang dibuat lewat
 * tombol "+ Jurnal Baru" di halaman Cash Payment/Cash Receipt --
 * `jenisDokumen` WAJIB diisi eksplisit ('cash_payment'/'cash_receipt')
 * oleh pemanggil (lihat TransactionsContext.addTransaction), karena
 * backend butuh tahu baris ini masuk sub halaman mana.
 */
export function buildBankCashManualCreatePayload(
  debetLeg: Transaction,
  kreditLeg: Transaction,
  jenisDokumen: 'cash_payment' | 'cash_receipt',
) {
  return {
    jenis_dokumen: jenisDokumen,
    tanggal: debetLeg.date || kreditLeg.date || '',
    keterangan: debetLeg.description || kreditLeg.description || '',
    no_akun_debet: debetLeg.accountCode || '',
    nama_akun_debet: debetLeg.accountName || undefined,
    jml_debet: debetLeg.debit || 0,
    no_akun_kredit: kreditLeg.accountCode || '',
    nama_akun_kredit: kreditLeg.accountName || undefined,
    jml_kredit: kreditLeg.credit || 0,
    lawan_transaksi: debetLeg.party || kreditLeg.party || undefined,
    no_dokumen: debetLeg.reference || kreditLeg.reference || undefined,
    project_unit: debetLeg.notes || kreditLeg.notes || undefined,
    jatuh_tempo: debetLeg.dueDate ?? kreditLeg.dueDate ?? undefined,
    status: debetLeg.status || 'Unposted',
    payment_status: debetLeg.paymentStatus ?? undefined,
    paid_amount: debetLeg.paidAmount ?? undefined,
  };
}