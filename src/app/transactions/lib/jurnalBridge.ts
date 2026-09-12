// ─── JEMBATAN BACKEND (jurnal_posting) → HALAMAN TRANSAKSI ─────────────────
// Satu-satunya tempat yang menerjemahkan hasil GET
// /api/client/{client_id}/jurnal-posting (lihat daftarJurnalPosting() di
// @/app/agent-ai/lib/api.js, dan dbc.daftar_jurnal_posting() di
// backend/db_client.py) menjadi bentuk Transaction[] yang dipakai
// TransactionsContext & seluruh 5 sub halaman Transaksi (Sales, Expense,
// Cash Payment, Cash Receipt, Other) lewat getTransactionGroup().
//
// Satu baris jurnal_posting di backend = SATU entri jurnal berpasangan
// (satu akun debet + satu akun kredit dalam satu baris yang sama).
// Transaction di frontend merepresentasikan satu LEG (satu sisi debet ATAU
// kredit) -- sama seperti pola di arBridge.ts/apBridge.ts -- sehingga di
// sini setiap baris backend selalu dipecah jadi DUA baris Transaction:
// satu leg debet dan satu leg kredit, berbagi jeId yang sama supaya bisa
// dikelompokkan kembali (mis. oleh arBridge.ts) saat dibutuhkan.

import type { Transaction } from '../components/transactionData';
import { classifyJournalPairCategory } from '../components/transactionData';

/** Bentuk satu baris respons GET /api/client/{client_id}/jurnal-posting (lihat db_client.daftar_jurnal_posting). */
export interface BackendJurnalRow {
  id: number;
  hasil_id?: number | null;
  jenis_dokumen?: string | null;
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
  // [BARU - persist edit/posting] lihat kolom payment_status/paid_amount
  // di model JurnalPosting (backend/db_client.py) -- sebelumnya field ini
  // (paymentStatus/paidAmount di Transaction) TIDAK PERNAH datang dari
  // backend sama sekali (selalu diisi ulang lewat state lokal di
  // TransactionEditModal), sekarang benar-benar persist & ikut kebaca di
  // sini setiap kali jurnal_posting di-refetch.
  payment_status?: string | null;
  paid_amount?: number | null;
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

// [DIUBAH - persist edit/posting halaman Transaksi frontend] Status posting
// backend ('draft'/'terposting'/'ditolak') -> status Transaction frontend.
// SEBELUMNYA 'draft' dipetakan ke 'Draft' -- ini salah secara semantik:
// 'draft' backend = "sudah masuk sistem tapi belum diposting ke buku
// besar", PERSIS definisi 'Unposted' di frontend (lihat komentar field
// `status` di transactionData.ts). Akibat bug ini, baris hasil import yang
// SUDAH di-refetch dari backend (bukan langsung dari respons upload) akan
// tampil sebagai "Draft", BUKAN "Unposted" -- sehingga tidak pernah ikut
// terhitung oleh tombol "Posting Semua" (unpostedCount hanya menghitung
// status==='Unposted'), padahal secara ekonomi baris itu jelas belum
// diposting. 'ditolak' tetap dipetakan ke 'Voided' karena baris yang
// ditolak supervisor tidak pernah masuk buku besar -- setara "dibatalkan".
// 'Draft'/'Reconciled' di frontend sekarang murni status LOKAL (data
// contoh statis / belum pernah disinkronkan ke backend) -- backend tidak
// pernah mengirim nilai yang berujung ke salah satu dari keduanya lagi.
const STATUS_MAP: Record<string, Transaction['status']> = {
  draft: 'Unposted',
  terposting: 'Posted',
  ditolak: 'Voided',
};

function mapStatus(status?: string | null): Transaction['status'] {
  if (!status) return 'Unposted';
  return STATUS_MAP[status] || 'Unposted';
}

// [DIPERBAIKI] Sebelumnya setiap leg diberi category hardcode
// 'Import Rekening Koran' (FALLBACK_CATEGORY) untuk SEMUA baris backend,
// tanpa kecuali -- alasannya backend jurnal_posting memang tidak mengirim
// field `category` (Revenue/Payroll/dst) sama sekali. Akibatnya field
// `category` di baris backend asli tidak pernah cocok dengan 11 kategori
// resmi (lihat categoryOptions di TransactionsFilterBar.tsx), sehingga
// dropdown filter Kategori tidak pernah match, KPI berbasis kategori
// (mis. "Beban Rutin" di Expense, "Pembayaran Pajak"/"Pembayaran Hutang
// Usaha" di Cash Payment -- lihat countJournalsByCategory() di
// groupAnalytics.ts) selalu 0 untuk data client asli, dan setiap Bill dari
// backend berbagi satu kategori generik yang sama. Pengelompokan ke 5 sub
// halaman lewat getTransactionGroup() tetap aman karena punya fallback
// terpisah (classifyByAccountName berdasarkan accountName), tapi apa pun
// yang membaca tx.category langsung untuk kategori RESMI selalu gagal.
// Sekarang legFromRow() di bawah menghitung kategori asli lewat
// classifyJournalPairCategory(nama_akun_debet, nama_akun_kredit) --
// fungsi yang sama persis dipakai jalur import (lihat
// drafJurnalToTransactions di ImportRekeningKoranModal.tsx) -- alih-alih
// nilai generik ini.

function safeAmount(value?: number | null): number {
  return typeof value === 'number' && !isNaN(value) ? value : 0;
}

/** Satu leg (debet ATAU kredit) dari satu baris jurnal_posting -> satu Transaction. */
function legFromRow(
  row: BackendJurnalRow,
  side: 'debet' | 'kredit',
): Transaction {
  const isDebet = side === 'debet';
  const rawAccountCode = isDebet ? row.no_akun_debet : row.no_akun_kredit;
  const accountCode = rawAccountCode ? String(rawAccountCode) : '—';
  const accountName = (isDebet ? row.nama_akun_debet : row.nama_akun_kredit) || '—';
  const amount = safeAmount(isDebet ? row.jml_debet : row.jml_kredit);
  const reference = row.no_dokumen || row.lawan_transaksi || `JE-${row.id}`;

  return {
    id: `jp-${row.id}-${side}`,
    date: row.tanggal || '',
    txId: `TXN-${row.id}-${isDebet ? 'D' : 'K'}`,
    accountCode,
    accountName,
    description: row.keterangan || '—',
    debit: isDebet ? amount : 0,
    credit: isDebet ? 0 : amount,
    reference,
    party: row.lawan_transaksi || '—',
    // [DIPERBAIKI] Backend jurnal_posting tidak mengirim field `category`
    // sama sekali (tidak ada kolom `kategori` di daftar_jurnal_posting/
    // ambil_jurnal_posting_by_id -- lihat backend/db_client.py), jadi
    // tidak ada row.kategori untuk didahulukan seperti di jalur import;
    // classifyJournalPairCategory() langsung yang menentukan kategori
    // resmi (Revenue/Payroll/Software/dst) dari pasangan nama akun.
    category: classifyJournalPairCategory(row.nama_akun_debet, row.nama_akun_kredit),
    type: isDebet ? 'debit' : 'credit',
    status: mapStatus(row.status),
    jeId: `JE-${row.id}`,
    notes: row.project_unit || undefined,
    voucherNo: row.voucher || row.periode_voucher || '—',
    // Backend jurnal_posting tidak menyimpan saldo kas/bank berjalan --
    // hanya rekening_koran (lihat main.py) yang punya kolom SALDO_AKHIR.
    // Diisi 0 di sini; halaman yang butuh saldo berjalan sesungguhnya
    // (Cash Receipt) membaca dari sumber lain, bukan dari jembatan ini.
    saldoAkhir: 0,
    cek: false,
    // [DIUBAH - persist edit/posting] payment_status/paid_amount sekarang
    // benar-benar ada kolomnya di backend (lihat BackendJurnalRow di atas)
    // -- diisi di sini kalau backend mengirimnya. Kalau backend belum
    // pernah menyimpan nilai ini utk baris lama (kolom baru, NULL),
    // field ini tetap undefined -- apBridge.ts/arBridge.ts menganggap
    // baris tanpa paymentStatus sebagai "sudah lunas" (lihat komentar
    // invoicePaidAmount()), sama seperti perilaku sebelumnya.
    paymentStatus: (row.payment_status as Transaction['paymentStatus']) || undefined,
    paidAmount: row.paid_amount ?? undefined,
    dueDate: row.jatuh_tempo || undefined,
  };
}

/**
 * Ubah SEMUA baris jurnal_posting (hasil daftarJurnalPosting()) jadi daftar
 * Transaction -- pengganti data statis ALL_TRANSACTIONS begitu client aktif
 * sudah punya jurnal sungguhan. Baris tanpa no_akun_debet/no_akun_kredit
 * (akun masih placeholder & belum dikonfirmasi) tetap disertakan supaya
 * tidak ada transaksi yang hilang dari tampilan.
 */
export function transactionsFromJurnalPosting(rows: BackendJurnalRow[]): Transaction[] {
  const out: Transaction[] = [];
  rows.forEach((row) => {
    out.push(legFromRow(row, 'debet'));
    out.push(legFromRow(row, 'kredit'));
  });
  // Terbaru dulu, konsisten dengan urutan default dbc.daftar_jurnal_posting
  // (ORDER BY dibuat_at DESC) -- di sini diurutkan ulang eksplisit supaya
  // tidak bergantung pada urutan asal array.
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}


// ─── ACCOUNTING CORE V2 (journal_entries + journal_lines) ────────────────
export interface BackendJournalLine {
  id: number;
  line_no: number;
  account_code: string;
  account_name?: string | null;
  standard_account_code?: string | null;
  account_role?: string | null;
  description?: string | null;
  debit?: number | null;
  credit?: number | null;
  partner_name?: string | null;
  tax_code?: string | null;
  branch?: string | null;
  department?: string | null;
  cost_center?: string | null;
  project?: string | null;
  reconciliation_no?: string | null;
}

export interface BackendJournalEntry {
  id: number;
  journal_no: string;
  source_module?: string | null;
  source_transaction_id?: string | null;
  legacy_posting_id?: number | null;
  document_date?: string | null;
  posting_date?: string | null;
  description?: string | null;
  reference?: string | null;
  status?: string | null;
  currency?: string | null;
  posted_by?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  lines: BackendJournalLine[];
}

const CORE_STATUS_MAP: Record<string, Transaction['status']> = {
  DRAFT: 'Unposted',
  REVIEW: 'Draft',
  APPROVED: 'Draft',
  POSTED: 'Posted',
  REVERSED: 'Voided',
  REJECTED: 'Voided',
};

function categoryFromSemantic(entry: BackendJournalEntry, line: BackendJournalLine): string {
  const source = (entry.source_module || '').toUpperCase();
  const role = (line.account_role || '').toUpperCase();
  const standard = (line.standard_account_code || '').toUpperCase();

  if (source === 'SALES' || standard.startsWith('STD.REVENUE.')) return 'Revenue';
  if (role === 'AR_CONTROL') return 'Revenue';
  if (role === 'AP_CONTROL') return 'AP Payment';
  if (role === 'OUTPUT_VAT' || role === 'INPUT_VAT' || role === 'WHT_PAYABLE' || role === 'PREPAID_TAX') return 'Tax';
  if (standard.includes('PAYROLL')) return 'Payroll';
  if (standard.includes('SOFTWARE')) return 'Software';
  if (standard.includes('RENT')) return 'Rent';
  if (standard.includes('FIXED') || role === 'FIXED_ASSET_DEFAULT') return 'CapEx';
  if (source === 'PURCHASE') return 'Expense';
  if (source === 'CASH_PAYMENT') return 'Cash Payment';
  if (source === 'CASH_RECEIPT') return 'Cash Receipt';
  return 'Lainnya';
}

/**
 * Accounting Core V2 -> Transaction[] tanpa mengubah struktur halaman.
 * Satu journal entry dapat mempunyai 2, 3, atau lebih lines; setiap line
 * menjadi satu row Transaction dan tetap berbagi jeId yang sama.
 */
export function transactionsFromJournalEntries(entries: BackendJournalEntry[]): Transaction[] {
  const out: Transaction[] = [];
  for (const entry of entries || []) {
    const legacyId = entry.legacy_posting_id ?? null;
    // Bila berasal dari legacy queue, pertahankan format JE-<posting_id>
    // supaya edit/post endpoint lama tetap kompatibel. Native journal baru
    // memakai CORE-<id> dan tidak diperlakukan sebagai legacy row.
    const jeId = legacyId != null ? `JE-${legacyId}` : `CORE-${entry.id}`;
    for (const line of entry.lines || []) {
      const debit = safeAmount(line.debit);
      const credit = safeAmount(line.credit);
      out.push({
        id: `core-${entry.id}-${line.id}`,
        date: entry.posting_date || entry.document_date || '',
        txId: entry.source_transaction_id || `TXN-JE-${entry.id}`,
        accountCode: line.account_code || '—',
        accountName: line.account_name || '—',
        description: line.description || entry.description || '—',
        debit,
        credit,
        reference: entry.reference || entry.journal_no || `JE-${entry.id}`,
        party: line.partner_name || '—',
        category: categoryFromSemantic(entry, line),
        type: debit > 0 ? 'debit' : credit > 0 ? 'credit' : 'journal',
        status: CORE_STATUS_MAP[(entry.status || 'DRAFT').toUpperCase()] || 'Unposted',
        jeId,
        notes: line.project || undefined,
        voucherNo: entry.journal_no || '—',
        saldoAkhir: 0,
        cek: Boolean(line.reconciliation_no),
        sourceModule: entry.source_module || undefined,
        standardAccountCode: line.standard_account_code || undefined,
        accountRole: line.account_role || undefined,
        coreJournalEntryId: entry.id,
        coreJournalLineId: line.id,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ─── PERSIST EDIT/POSTING HALAMAN TRANSAKSI → BACKEND ──────────────────────
// [BARU] Sebelumnya TransactionsContext.saveEdit/postAllUnposted/dll cuma
// mengubah state React lokal, tidak pernah dikirim ke backend. Fungsi di
// bawah ini menjembatani balik: dari Transaction (satu leg, format
// frontend) ke payload PATCH/POST jurnal_posting (satu row = dua leg
// sekaligus, format backend).

/**
 * Ekstrak posting_id asli (id baris jurnal_posting di backend) dari jeId
 * satu Transaction -- HANYA baris yang datang dari
 * transactionsFromJurnalPosting() (backend asli) yang jeId-nya berformat
 * persis "JE-<angka>" (lihat legFromRow di atas). Baris lokal (hasil
 * import yang belum sempat direfetch, jurnal manual yang gagal tersimpan,
 * atau data contoh statis) punya format jeId lain (JE-IMPORT-.../
 * JE-MANUAL-.../JE-2026-00842 dst) dan akan mengembalikan null di sini --
 * dipakai TransactionsContext untuk tahu baris mana yang boleh dikirim
 * PATCH/posting ke backend, vs baris yang cuma bisa diubah di state lokal.
 */
export function extractPostingId(jeId: string | undefined | null): number | null {
  if (!jeId) return null;
  const m = /^JE-(\d+)$/.exec(jeId);
  return m ? Number(m[1]) : null;
}

/** true kalau Transaction ini datang dari jurnal_posting backend (bukan
 * data contoh statis, bukan hasil import/jurnal manual yang belum sempat
 * direfetch). */
export function isBackendSynced(tx: Transaction): boolean {
  return extractPostingId(tx.jeId) !== null;
}

/**
 * Susun payload PATCH /api/client/{id}/jurnal-posting/{posting_id} dari
 * SATU leg yang baru saja diedit (`edited`) + leg pasangannya yang TIDAK
 * ikut diedit (`sibling`). Satu baris jurnal_posting backend menyimpan
 * KEDUA sisi (debet & kredit) sekaligus dalam satu row -- edit di UI cuma
 * menyentuh satu leg (satu Transaction), jadi sisi yang TIDAK diedit tetap
 * harus dikirim apa adanya, supaya tidak ketimpa kosong oleh PATCH ini.
 * `sibling` null hanya dijaga untuk keamanan tipe -- seharusnya tidak
 * pernah terjadi untuk baris backend asli (legFromRow selalu membuat
 * sepasang debet+kredit dgn jeId yang sama).
 */
export function buildUpdatePayloadFromPair(edited: Transaction, sibling: Transaction | null) {
  const debetLeg = edited.type === 'credit' ? sibling : edited;
  const kreditLeg = edited.type === 'credit' ? edited : sibling;
  return {
    tanggal: edited.date || undefined,
    keterangan: edited.description || undefined,
    lawan_transaksi: edited.party || undefined,
    no_dokumen: edited.reference || undefined,
    // [FIX - audit #8] Sebelumnya field ini TIDAK PERNAH disertakan di
    // payload PATCH sama sekali, padahal textarea "Catatan" di
    // TransactionEditModal.tsx bisa diedit & backend sudah siap
    // menerimanya (project_unit ada di KOLOM_BOLEH_DIUBAH,
    // db_client.py) -- akibatnya perubahan Catatan tampil "tersimpan"
    // (toast sukses) tapi hilang lagi begitu ada refetch berikutnya.
    // Frontend `notes` <-> backend `project_unit` (lihat legFromRow() di
    // atas: `notes: row.project_unit || undefined`), jadi field ini yang
    // dikirim balik ke backend, bukan `notes` secara harfiah.
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
 * Susun payload POST /api/client/{id}/jurnal-posting/manual dari sepasang
 * Transaction baru (satu leg debet + satu leg kredit) yang baru dibuat
 * lewat form "+ Jurnal Baru" (lihat TransactionEditModal mode isNew) --
 * belum pernah ada di backend sama sekali, jadi tidak ada posting_id/
 * sibling nyata untuk dirujuk seperti buildUpdatePayloadFromPair() di atas.
 */
export function buildManualCreatePayload(debetLeg: Transaction, kreditLeg: Transaction) {
  return {
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
    // [FIX - audit #8, diperluas] Bug yang sama (notes/project_unit tidak
    // pernah dikirim ke backend) juga ada di jalur "+ Jurnal Baru" -- bukan
    // cuma edit baris yang sudah ada. Ikut disertakan di sini supaya
    // Catatan yang diisi user saat membuat jurnal manual baru juga benar-
    // benar tersimpan (lihat penambahan project_unit di
    // BuatJurnalManualRequest/buat_jurnal_manual, backend/main.py &
    // db_client.py).
    project_unit: debetLeg.notes || kreditLeg.notes || undefined,
    jatuh_tempo: debetLeg.dueDate ?? kreditLeg.dueDate ?? undefined,
    status: debetLeg.status || 'Unposted',
    payment_status: debetLeg.paymentStatus ?? undefined,
    paid_amount: debetLeg.paidAmount ?? undefined,
  };
}