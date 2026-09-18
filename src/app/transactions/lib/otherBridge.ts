// ─── JEMBATAN BACKEND (finance_transaction_other) → HALAMAN OTHER ─────────
// Satu-satunya tempat yang menerjemahkan hasil GET
// /api/client/{client_id}/finance-other (lihat daftarFinanceOther() di
// @/app/agent-ai/lib/api.js, dan dbc.daftar_finance_other() di
// backend/db_client.py) menjadi bentuk Transaction[] yang dipakai
// TransactionsContext & halaman Other (src/app/transactions/other/page.tsx)
// lewat getTransactionGroup(). Pola file ini SENGAJA mirip bankCashBridge.ts
// -- bedanya tabel ini SUDAH menyimpan satu baris = SATU KAKI/leg jurnal
// (bukan sepasang debet+kredit dalam satu baris), jadi TIDAK perlu proses
// "pecah jadi 2 leg" seperti bankCashBridge.ts/jurnalBridge.ts -- cukup
// dipetakan langsung snake_case -> camelCase.
//
// je_id di sini SELALU berformat "OTH-<suffix>" (dibuat backend lewat
// _buat_je_id_other(), lihat db_client.py) -- dua baris dengan je_id yang
// sama adalah sepasang leg debet+kredit dari satu entri jurnal yang sama,
// prefix ini dipakai untuk membedakan baris tabel ini dari jurnal_posting
// ("JE-<id>") atau bank & cash ("BC-<id>") -- lihat extractOtherJeId() di
// bawah dan pemakaiannya di TransactionsContext.tsx.

import type { Transaction } from '../components/transactionData';

/** Bentuk satu baris respons GET /api/client/{client_id}/finance-other (lihat db_client._finance_other_ke_dict). */
export interface BackendFinanceOtherRow {
  id: string;
  tx_id?: string | null;
  je_id?: string | null;
  date?: string | null;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  debit?: number | null;
  credit?: number | null;
  reference?: string | null;
  party?: string | null;
  category?: string | null;
  type?: string | null; // 'debit' | 'credit'
  status?: string | null; // Unposted/Posted/Draft/Reconciled/Voided (ala frontend, tanpa terjemahan)
  notes?: string | null;
  voucher_no?: string | null;
  saldo_akhir?: number | null;
  cek?: boolean | null;
  source_module?: string | null;
  standard_account_code?: string | null;
  account_role?: string | null;
  core_journal_entry_id?: number | null;
  core_journal_line_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const VALID_STATUS: Transaction['status'][] = ['Unposted', 'Posted', 'Draft', 'Reconciled', 'Voided'];

function mapStatus(status?: string | null): Transaction['status'] {
  return (VALID_STATUS as string[]).includes(status || '') ? (status as Transaction['status']) : 'Unposted';
}

function mapType(type?: string | null): Transaction['type'] {
  return type === 'credit' ? 'credit' : type === 'journal' ? 'journal' : 'debit';
}

function safeAmount(value?: number | null): number {
  return typeof value === 'number' && !isNaN(value) ? value : 0;
}

/** Satu baris finance_transaction_other -> satu Transaction (sudah 1:1, tidak perlu dipecah). */
function transactionFromRow(row: BackendFinanceOtherRow): Transaction {
  return {
    id: `other-${row.id}`,
    date: row.date || '',
    txId: row.tx_id || `TXN-${row.je_id || row.id}`,
    accountCode: row.account_code || '—',
    accountName: row.account_name || '—',
    description: row.description || '—',
    debit: safeAmount(row.debit),
    credit: safeAmount(row.credit),
    reference: row.reference || '—',
    party: row.party || '—',
    category: row.category || 'Lainnya',
    type: mapType(row.type),
    status: mapStatus(row.status),
    jeId: row.je_id || `OTH-${row.id}`,
    notes: row.notes || undefined,
    voucherNo: row.voucher_no || '—',
    saldoAkhir: safeAmount(row.saldo_akhir),
    cek: !!row.cek,
    // [PENTING] getTransactionGroup() di transactionData.ts mengecek
    // sourceModule LEBIH DULU sebelum fallback ke CATEGORY_TO_GROUP/nama
    // akun -- dipaksa 'GENERAL_JOURNAL' supaya baris ini PASTI mendarat di
    // halaman Other, tidak pernah salah tebak walau category/nama akunnya
    // kebetulan mirip kategori grup lain (mis. "Beban ...").
    sourceModule: 'GENERAL_JOURNAL',
    standardAccountCode: row.standard_account_code || undefined,
    accountRole: row.account_role || undefined,
    coreJournalEntryId: row.core_journal_entry_id ?? undefined,
    coreJournalLineId: row.core_journal_line_id ?? undefined,
  };
}

/** Seluruh baris finance_transaction_other -> Transaction[] (1 baris = 1 leg, tidak dipecah). */
export function transactionsFromFinanceOther(rows: BackendFinanceOtherRow[]): Transaction[] {
  return (rows || []).map(transactionFromRow).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ─── PERSIST EDIT/POSTING HALAMAN OTHER → BACKEND ─────────────────────────

/**
 * Ekstrak je_id asli dari jeId satu Transaction -- HANYA baris yang datang
 * dari transactionsFromFinanceOther() (backend asli) yang jeId-nya
 * berformat "OTH-<suffix>" (lihat transactionFromRow di atas). Baris lokal
 * (data contoh statis / jurnal manual yang gagal tersimpan) mengembalikan
 * null di sini -- dipakai TransactionsContext untuk tahu baris mana yang
 * boleh dikirim PATCH/posting ke endpoint /finance-other, vs baris yang
 * cuma bisa diubah di state lokal.
 */
export function extractOtherJeId(jeId: string | undefined | null): string | null {
  if (!jeId) return null;
  return /^OTH-/.test(jeId) ? jeId : null;
}

/** true kalau Transaction ini datang dari finance_transaction_other backend asli. */
export function isFinanceOtherSynced(tx: Transaction): boolean {
  return extractOtherJeId(tx.jeId) !== null;
}

/**
 * Susun payload PATCH /api/client/{id}/finance-other/{je_id} dari SATU leg
 * yang baru diedit (`edited`) + leg pasangannya yang tidak ikut diedit
 * (`sibling`) -- pola mirip buildBankCashUpdatePayload() di
 * bankCashBridge.ts, cuma field khusus per-leg (account_code/account_name/
 * debit/credit) dikirim terpisah lewat debit_leg/credit_leg supaya backend
 * tahu baris mana yang harus diubah (lihat update_finance_other_by_je_id
 * di db_client.py).
 */
export function buildOtherUpdatePayload(edited: Transaction, sibling: Transaction | null) {
  const debetLeg = edited.type === 'credit' ? sibling : edited;
  const kreditLeg = edited.type === 'credit' ? edited : sibling;
  return {
    date: edited.date || undefined,
    description: edited.description || undefined,
    reference: edited.reference || undefined,
    party: edited.party || undefined,
    category: edited.category || undefined,
    notes: edited.notes || undefined,
    voucher_no: edited.voucherNo || undefined,
    status: edited.status || undefined,
    debit_leg: debetLeg ? { account_code: debetLeg.accountCode, account_name: debetLeg.accountName, debit: debetLeg.debit } : undefined,
    credit_leg: kreditLeg ? { account_code: kreditLeg.accountCode, account_name: kreditLeg.accountName, credit: kreditLeg.credit } : undefined,
  };
}

/**
 * Susun payload POST /api/client/{id}/finance-other/manual dari sepasang
 * Transaction baru (satu leg debet + satu leg kredit) yang dibuat lewat
 * tombol "+ Jurnal Baru" di halaman Other.
 */
export function buildOtherManualCreatePayload(debetLeg: Transaction, kreditLeg: Transaction) {
  return {
    tanggal: debetLeg.date || kreditLeg.date || '',
    description: debetLeg.description || kreditLeg.description || '',
    account_code_debet: debetLeg.accountCode || '',
    account_name_debet: debetLeg.accountName || undefined,
    jml_debet: debetLeg.debit || 0,
    account_code_kredit: kreditLeg.accountCode || '',
    account_name_kredit: kreditLeg.accountName || undefined,
    jml_kredit: kreditLeg.credit || 0,
    reference: debetLeg.reference || kreditLeg.reference || undefined,
    party: debetLeg.party || kreditLeg.party || undefined,
    category: debetLeg.category || kreditLeg.category || undefined,
    notes: debetLeg.notes || kreditLeg.notes || undefined,
    voucher_no: debetLeg.voucherNo || kreditLeg.voucherNo || undefined,
    status: debetLeg.status || 'Unposted',
  };
}
