// ─── JEMBATAN BACKEND (jurnal_posting) → HALAMAN TRANSAKSI ─────────────────
// Satu-satunya tempat yang menerjemahkan hasil GET
// /api/client/{client_id}/jurnal-posting (lihat daftarJurnalPosting() di
// @/app/agent-ai/lib/api.js, dan dbc.daftar_jurnal_posting() di
// backend/db_client.py) menjadi bentuk Transaction[] yang dipakai
// TransactionsContext & seluruh 5 sub halaman Transaksi (Sales, Expense,
// Cash Payment, Cash Reserve, Other) lewat getTransactionGroup().
//
// Satu baris jurnal_posting di backend = SATU entri jurnal berpasangan
// (satu akun debet + satu akun kredit dalam satu baris yang sama).
// Transaction di frontend merepresentasikan satu LEG (satu sisi debet ATAU
// kredit) -- sama seperti pola di arBridge.ts/apBridge.ts -- sehingga di
// sini setiap baris backend selalu dipecah jadi DUA baris Transaction:
// satu leg debet dan satu leg kredit, berbagi jeId yang sama supaya bisa
// dikelompokkan kembali (mis. oleh arBridge.ts) saat dibutuhkan.

import type { Transaction } from '../components/transactionData';

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
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

// Status posting backend ('draft'/'terposting'/'ditolak') -> status
// Transaction frontend. 'ditolak' dipetakan ke 'Voided' karena baris yang
// ditolak supervisor tidak pernah masuk buku besar -- setara "dibatalkan".
const STATUS_MAP: Record<string, Transaction['status']> = {
  draft: 'Draft',
  terposting: 'Posted',
  ditolak: 'Voided',
};

function mapStatus(status?: string | null): Transaction['status'] {
  if (!status) return 'Unposted';
  return STATUS_MAP[status] || 'Unposted';
}

/** Kategori generik dipakai supaya getTransactionGroup() jatuh ke fallback
 * classifyByAccountName() berdasarkan nama_akun_debet/nama_akun_kredit --
 * sama seperti perlakuan baris hasil "Import Rekening Koran" di
 * transactionData.ts, karena backend jurnal_posting tidak mengirim field
 * `category` (Revenue/Payroll/dst) sama sekali. */
const FALLBACK_CATEGORY = 'Import Rekening Koran';

function safeAmount(value?: number | null): number {
  return typeof value === 'number' && !isNaN(value) ? value : 0;
}

/** Satu leg (debet ATAU kredit) dari satu baris jurnal_posting -> satu Transaction. */
function legFromRow(
  row: BackendJurnalRow,
  side: 'debet' | 'kredit',
): Transaction {
  const isDebet = side === 'debet';
  const accountCode = (isDebet ? row.no_akun_debet : row.no_akun_kredit) || '—';
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
    category: FALLBACK_CATEGORY,
    type: isDebet ? 'debit' : 'credit',
    status: mapStatus(row.status),
    jeId: `JE-${row.id}`,
    notes: row.project_unit || undefined,
    voucherNo: row.voucher || row.periode_voucher || '—',
    // Backend jurnal_posting tidak menyimpan saldo kas/bank berjalan --
    // hanya rekening_koran (lihat main.py) yang punya kolom SALDO_AKHIR.
    // Diisi 0 di sini; halaman yang butuh saldo berjalan sesungguhnya
    // (Cash Reserve) membaca dari sumber lain, bukan dari jembatan ini.
    saldoAkhir: 0,
    cek: false,
    // paymentStatus/dueDate/paidAmount sengaja tidak diisi -- backend
    // jurnal_posting tidak punya konsep status pembayaran ke vendor.
    // Baris tanpa field ini dianggap "sudah lunas" oleh apBridge.ts/
    // arBridge.ts (lihat komentar invoicePaidAmount()), kecuali
    // jatuh_tempo tersedia maka dipakai sebagai dueDate.
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