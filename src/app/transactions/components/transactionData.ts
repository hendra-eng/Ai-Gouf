export interface Transaction {
  id: string;
  date: string;
  txId: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  reference: string;
  party: string;
  category: string;
  type: 'debit' | 'credit' | 'journal';
  // [BARU] 'Unposted' — status default seluruh baris hasil import rekening
  // koran, sebelum user menekan tombol "Posting Semua" di halaman Transaksi.
  status: 'Unposted' | 'Posted' | 'Draft' | 'Reconciled' | 'Voided';
  jeId: string;
  notes?: string;
  // [BARU] Diadaptasi dari format rekonsiliasi rekening koran (kolom VOUCHER,
  // SALDO_AKHIR, CEK). voucherNo mengikuti pola "<KodeBank>-<MMDD>-<urutan>"
  // (mis. BCA-0825-1), sama seperti nomor voucher hasil rumus Excel di sheet
  // rekening koran — bedanya di sini dihitung sekali saat data dibuat/diimpor,
  // jadi tidak rusak kalau tabel di-sort (tidak seperti rumus Excel aslinya).
  voucherNo: string;
  // Saldo kas/bank berjalan setelah transaksi ini (khusus baris yang menyentuh
  // akun Kas & Bank; baris lain membawa nilai saldo terakhir yang diketahui).
  saldoAkhir: number;
  // Tanda centang rekonsiliasi manual (kolom CEK) — independen dari field
  // `status`, dipakai saat user mencocokkan baris ini manual dengan rekening koran.
  cek: boolean;
  // [FIX - audit #2] Tanda arsip lokal (lihat archiveTransactions di
  // TransactionsContext.tsx) — backend jurnal_posting tidak punya konsep
  // arsip sama sekali, jadi field ini murni state sesi, tidak pernah
  // dikirim ke server. undefined/false = tampil normal di tabel.
  archived?: boolean;
  // [BARU] ─── FIELD PENGHUBUNG KE ACCOUNTS PAYABLE ─────────────────────────
  // Field-field di bawah ini SENGAJA terpisah dari `status` (status posting
  // jurnal: Unposted/Posted/Draft/dst). `status` menjawab "sudah tercatat di
  // buku besar atau belum", sedangkan 3 field ini menjawab "sudah dibayar ke
  // vendor atau belum" — dua hal yang berbeda secara akuntansi. Field ini
  // relevan untuk transaksi kelompok Expense (lihat getTransactionGroup di
  // bawah): SEMUA transaksi Expense, apapun status posting-nya, otomatis
  // "diterjemahkan" jadi satu tagihan (bill) di halaman Account Payable lewat
  // src/app/transactions/lib/apBridge.ts — bukan cuma yang berstatus tertentu.

  /** Status pembayaran ke vendor. Default 'Belum Dibayar' untuk expense baru. */
  paymentStatus?: 'Belum Dibayar' | 'Sebagian Dibayar' | 'Lunas';
  /** Tanggal jatuh tempo pembayaran ke vendor — dipakai AP untuk hitung Overdue/Due Soon. */
  dueDate?: string;
  /** Nominal yang sudah dibayarkan ke vendor sejauh ini (relevan saat paymentStatus 'Sebagian Dibayar'). */
  paidAmount?: number;
  // [ACCOUNTING CORE V2] Metadata dari backend. UI tidak perlu menebak
  // arti akun dari nama/nomor jika backend sudah mengirim semantic data.
  sourceModule?: string;
  standardAccountCode?: string;
  accountRole?: string;
  coreJournalEntryId?: number;
  coreJournalLineId?: number;
}

export type PaymentStatus = NonNullable<Transaction['paymentStatus']>;

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = ['Belum Dibayar', 'Sebagian Dibayar', 'Lunas'];

// Warna badge untuk field paymentStatus — dipakai di kolom tabel Expense,
// TransactionDrawer, dan panel AP supaya konsisten satu warna di semua tempat.
export const PAYMENT_STATUS_VARIANT: Record<PaymentStatus, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  'Lunas': 'positive',
  'Sebagian Dibayar': 'warning',
  'Belum Dibayar': 'negative',
};

// ─── PENGELOMPOKAN KE 5 SUB HALAMAN TRANSAKSI ──────────────────────────────
// [BARU] Setiap baris transaksi di halaman Transaksi utama dikelompokkan ke
// salah satu dari 5 sub halaman (Sales, Expense, Cash Payment, Cash Receipt,
// Other) berdasarkan field `category`, bukan accountCode/accountName.
// Alasannya: `category` sudah berupa daftar nilai yang tetap/terbatas
// (Revenue, Payroll, Software, dst — lihat categoryColors di
// TransactionsTable.tsx), jadi jauh lebih konsisten & minim salah deteksi
// dibanding mem-parsing teks nama akun yang bervariasi. accountCode juga
// tidak cukup andal sendirian di sini karena satu digit awal (mis. "1xxx")
// bisa berarti Kas & Bank, Piutang, ATAU Aset Tetap sekaligus — tiga makna
// bisnis yang berbeda kelompok.
export type TransactionGroup = 'sales' | 'purchase' | 'cash_payment' | 'cash_receipt' | 'other';

export const CATEGORY_TO_GROUP: Record<string, TransactionGroup> = {
  Revenue: 'sales',
  Payroll: 'purchase',
  Software: 'purchase',
  Rent: 'purchase',
  Marketing: 'purchase',
  Travel: 'purchase',
  Utilities: 'purchase',
  Tax: 'cash_payment',
  'AP Payment': 'cash_payment',
  CapEx: 'cash_payment',
  Financing: 'cash_receipt',
  // [DIUBAH] 'Lainnya' — kategori fallback resmi untuk baris hasil import
  // yang nama akunnya tidak cocok kata kunci manapun (lihat
  // classifyAccountNameToCategory di bawah). Sebelumnya baris seperti ini
  // "dipinjamkan" ke kategori CapEx supaya mendarat di grup 'other', tapi
  // sekarang CapEx sudah punya arti bisnis sendiri (grup 'cash_payment'),
  // jadi butuh kategori fallback terpisah yang tetap mengarah ke 'other'
  // supaya baris ambigu tetap terlihat di halaman Other untuk ditinjau,
  // bukan ikut nyasar ke Cash Payment seolah-olah itu pembayaran CapEx.
  Lainnya: 'other',
  // [BARU] 5 label grup ini bisa dipilih langsung sebagai kategori manual di
  // TransactionEditModal.tsx (KNOWN_CATEGORIES) — sebelumnya tidak terdaftar
  // di sini sama sekali, jadi kalau dipilih malah jatuh ke fallback tebakan
  // classifyByAccountName(accountName), bukan ke grup yang namanya sendiri.
  // Dipetakan langsung supaya konsisten: pilih "Sales" ya pasti masuk Sales.
  Sales: 'sales',
  Purchase: 'purchase',
  'Cash Payment': 'cash_payment',
  'Cash Receipt': 'cash_receipt',
  Other: 'other',
};

// [BARU] Fallback KHUSUS untuk baris hasil "Import Rekening Koran" — baris
// itu semuanya diberi category: 'Import Rekening Koran' yang sama (lihat
// ImportRekeningKoranModal.tsx), jadi field `category` saja tidak cukup
// untuk membedakan sales/expense/dst pada data import. Sebagai gantinya kita
// baca `accountName` (nama akun hasil kategorisasi otomatis dari backend,
// mis. "Pendapatan Jasa Konsultasi" atau "Beban Sewa Kantor") dengan
// pencocokan kata kunci akuntansi standar.
export function classifyByAccountName(accountName: string | undefined | null): TransactionGroup {
  const n = (accountName || '').toLowerCase();
  if (n.includes('pendapatan') || n.includes('piutang')) return 'sales';
  if (n.includes('beban')) return 'purchase';
  if (n.includes('pajak') || n.includes('ppn') || n.includes('pph') || n.includes('hutang usaha') || n.includes('hutang dagang')) return 'cash_payment';
  if (n.includes('kas & bank') || n.includes('kas dan bank') || n.includes('deposito') || n.includes('giro') || n.includes('tabungan')) return 'cash_receipt';
  return 'other';
}

// Kategori baru/tidak dikenal (termasuk 'Import Rekening Koran') jatuh ke
// fallback nama akun, supaya tidak ada transaksi yang "hilang" / tidak
// tampil di sub halaman manapun, baik data statis maupun hasil import.
export function getTransactionGroup(tx: Transaction): TransactionGroup {
  // Accounting Core menjadi sumber klasifikasi utama. Nama akun hanya fallback
  // untuk data legacy/import yang belum mempunyai source_module.
  const source = (tx.sourceModule || '').toUpperCase();
  if (source === 'SALES') return 'sales';
  if (source === 'PURCHASE') return 'purchase';
  if (source === 'CASH_PAYMENT') return 'cash_payment';
  if (source === 'CASH_RECEIPT') return 'cash_receipt';
  if (source === 'GENERAL_JOURNAL') return 'other';
  return CATEGORY_TO_GROUP[tx.category] || classifyByAccountName(tx.accountName);
}

// ─── KATEGORISASI GRANULAR HASIL IMPORT ────────────────────────────────────
// [DIUBAH] Sebelumnya baris hasil import (rekening koran / PDF penjualan
// kasir) diberi field `category` berupa salah satu dari 5 LABEL GRUP
// (Sales/Expense/Cash Payment/Cash Receipt/Other — lewat GROUP_LABELS), jadi
// kolom "Kategori" di tabel & dropdown filter di TransactionsFilterBar (yang
// isinya cuma 11 kategori resmi: Revenue, Payroll, Software, dst) tidak
// pernah cocok untuk data hasil import — makanya semua baris import tampil
// "Other" dan tidak bisa difilter. Fungsi-fungsi di bawah mengklasifikasi
// LANGSUNG ke salah satu dari 11 kategori resmi tsb, bukan ke label grup.
// getTransactionGroup() di atas tetap bisa memetakan kategori resmi ini ke
// grup sub halaman lewat CATEGORY_TO_GROUP seperti sebelumnya — tidak ada
// yang berubah dari sisi pengelompokan 5 sub halaman.
function namaAkunAdalahKasBank(nama: string | null | undefined): boolean {
  const n = (nama || '').toLowerCase();
  return n.includes('kas') || n.includes('bank');
}

// Klasifikasi SATU nama akun (bukan Kas/Bank) ke salah satu dari 11 kategori
// resmi (+ fallback 'Lainnya'). Fallback terakhir (nama akun tidak dikenali /
// generic "Beban ..." tanpa kata kunci lebih spesifik) jatuh ke 'Lainnya' —
// satu-satunya kategori yang memetakan ke grup 'other' (lihat
// CATEGORY_TO_GROUP), jadi baris ambigu mendarat di halaman Other untuk
// ditinjau, BUKAN ikut nebeng ke kategori CapEx seperti sebelumnya (CapEx
// sekarang punya arti bisnis sendiri di grup Cash Payment, jadi tidak boleh
// lagi dipakai sebagai keranjang sampah). Baris seperti ini sudah otomatis
// ditandai "Belum terkategori otomatis — cek kembali" oleh
// drafJurnalToTransactions, jadi tetap butuh review manual oleh user apa pun
// kategori tebakannya.
function classifyAccountNameToCategory(accountName: string | null | undefined): string {
  const n = (accountName || '').toLowerCase();
  if (n.includes('pendapatan') || n.includes('piutang') || n.includes('penjualan')) return 'Revenue';
  if (n.includes('pajak') || n.includes('ppn') || n.includes('pph') || n.includes('pbb')) return 'Tax';
  if (n.includes('hutang usaha') || n.includes('hutang dagang') || n.includes('utang usaha') || n.includes('utang dagang')) return 'AP Payment';
  if (n.includes('gaji') || n.includes('honor') || n.includes('tunjangan') || n.includes('thr') || n.includes('upah')) return 'Payroll';
  if (n.includes('software') || n.includes('lisensi') || n.includes('license') || n.includes('langganan') || n.includes('subscription') || n.includes('saas')) return 'Software';
  if (n.includes('sewa')) return 'Rent';
  if (n.includes('marketing') || n.includes('iklan') || n.includes('promosi')) return 'Marketing';
  if (n.includes('perjalanan') || n.includes('dinas') || n.includes('tiket') || n.includes('akomodasi')) return 'Travel';
  if (n.includes('listrik') || n.includes('air') || n.includes('internet') || n.includes('telekomunikasi') || n.includes('telepon') || n.includes('utilitas') || n.includes('pln') || n.includes('pdam')) return 'Utilities';
  if (n.includes('aset tetap') || n.includes('peralatan') || n.includes('mesin') || n.includes('kendaraan') || n.includes('gedung') || n.includes('inventaris')) return 'CapEx';
  if (n.includes('deposito') || n.includes('pinjaman') || n.includes('modal') || n.includes('obligasi') || n.includes('giro') || n.includes('tabungan')) return 'Financing';
  return 'Lainnya';
}

// Klasifikasi SEPASANG kaki jurnal (debet + kredit) sekaligus ke SATU
// kategori resmi yang sama untuk kedua kaki — meniru pola yang sudah dipakai
// data statis di ALL_TRANSACTIONS (mis. tx-001/tx-002 sama-sama 'Revenue'
// walau salah satu kakinya akun Kas & Bank). Kalau salah satu kaki adalah
// akun Kas/Bank, kategori diambil dari kaki LAWANNYA (akun bisnisnya, bukan
// akun kasnya) — supaya mis. penerimaan pembayaran invoice tetap muncul
// sebagai 'Revenue', bukan ikut kategori Kas/Bank yang tidak spesifik.
export function classifyJournalPairCategory(
  namaAkunDebet: string | null | undefined,
  namaAkunKredit: string | null | undefined
): string {
  const debetKasBank = namaAkunAdalahKasBank(namaAkunDebet);
  const kreditKasBank = namaAkunAdalahKasBank(namaAkunKredit);
  if (debetKasBank && !kreditKasBank) return classifyAccountNameToCategory(namaAkunKredit);
  if (kreditKasBank && !debetKasBank) return classifyAccountNameToCategory(namaAkunDebet);
  if (debetKasBank && kreditKasBank) return 'Financing'; // transfer antar akun kas/bank
  return classifyAccountNameToCategory(namaAkunDebet);
}

export const GROUP_LABELS: Record<TransactionGroup, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  cash_payment: 'Cash Payment',
  cash_receipt: 'Cash Receipt',
  other: 'Other',
};

// [BARU] Baris hasil import rekening koran sekarang diberi `category` berupa
// salah satu dari 5 label grup di atas (bukan lagi teks statis
// "Import Rekening Koran") — lihat drafJurnalToTransactions() di
// ImportRekeningKoranModal.tsx. Supaya getTransactionGroup() tetap konsisten
// (tidak jatuh lagi ke classifyByAccountName untuk baris yang category-nya
// sudah berupa label grup ini), daftarkan juga 5 label ini ke CATEGORY_TO_GROUP.
Object.keys(GROUP_LABELS).forEach((g) => {
  const group = g as TransactionGroup;
  CATEGORY_TO_GROUP[GROUP_LABELS[group]] = group;
});


// [BARU] Helper generator dipakai ulang oleh ImportRekeningKoranModal supaya
// nomor voucher hasil import mengikuti pola yang sama persis dengan data di
// atas ("<KodeBank>-<MMDD>-<urutan-per-hari>"), bukan lagi timestamp acak.
export function kodeBankDariNama(nama: string | null | undefined): string {
  const n = (nama || '').toUpperCase();
  if (n.includes('BCA')) return 'BCA';
  if (n.includes('MANDIRI')) return 'MDR';
  if (n.includes('BNI')) return 'BNI';
  if (n.includes('BRI')) return 'BRI';
  if (n.includes('CIMB')) return 'CIMB';
  if (n.includes('PERMATA')) return 'PMT';
  return 'JV'; // Jurnal Voucher generik kalau tidak ada nama bank yang cocok
}

export function buatVoucherNo(kodeBank: string, tanggalISO: string, urutan: number): string {
  // tanggalISO: "2026-08-25" -> "0825"
  const mmdd = (tanggalISO || '').slice(5, 10).replace('-', '');
  return `${kodeBank}-${mmdd || '0000'}-${urutan}`;
}

// [BARU] Default field pembayaran ke vendor untuk transaksi Expense baru
// (dipakai tombol "+ Jurnal Baru" di halaman Expense) — belum dibayar,
// jatuh tempo 30 hari dari tanggal transaksi, sesuai umumnya termin Net 30.
export function tambahHariISO(tanggalISO: string, jumlahHari: number): string {
  const d = new Date(tanggalISO || new Date().toISOString().slice(0, 10));
  if (isNaN(d.getTime())) return tanggalISO;
  d.setDate(d.getDate() + jumlahHari);
  return d.toISOString().slice(0, 10);
}

// ─── GUARD DUPLIKAT IMPORT (frontend-only, lihat ImportRekeningKoranModal) ──
// [BARU] Deteksi "kelihatannya sudah pernah diimpor" untuk baris hasil
// import rekening koran / jurnal penjualan kasir SEBELUM ditambahkan ke
// TransactionsContext lewat addTransactions()/replaceGroup().
//
// SENGAJA TIDAK pakai txId atau reference sebagai kunci pembanding:
// - txId selalu baru per sesi import (format TXN-IMPORT-<batchTag>-<baris>,
//   batchTag dari Date.now()) -- upload file yang SAMA dua kali tetap
//   menghasilkan txId yang berbeda, jadi tidak akan pernah "bentrok".
// - reference untuk rekening koran diisi NAMA BANK (mis. "BCA"), sama di
//   SEMUA baris satu file -- kalau dipakai literal, hampir semua baris akan
//   selalu "bentrok" walau isinya beda tanggal/nominal (noise, bukan deteksi
//   yang berguna). Untuk jurnal_penjualan_kasir reference memang unik
//   (no_invoice), tapi supaya satu logika berlaku konsisten untuk kedua
//   jenis sumber, dipakai signature berbasis ISI transaksi di bawah ini --
//   prinsipnya sama seperti fingerprint di backend (modules/dedup_transaksi.py:
//   tanggal+bank+keterangan+nominal+saldo), hanya dihitung di level pasangan
//   debet-kredit (per jeId), bukan per baris Transaction mentah -- karena tiap
//   baris sumber (draf_jurnal) menghasilkan 2 baris Transaction (kaki debet +
//   kaki kredit) yang berbagi jeId yang sama.
function normalisasiKeterangan(s: string | undefined): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Signature satu ENTRI JURNAL (sepasang baris debet+kredit berbagi jeId yang sama). */
export function signatureEntriJurnal(entriSejeId: Transaction[]): string {
  const debet = entriSejeId.find((e) => e.debit > 0);
  const kredit = entriSejeId.find((e) => e.credit > 0);
  const tanggal = entriSejeId[0]?.date || '';
  const keterangan = normalisasiKeterangan(entriSejeId[0]?.description);
  const nominal = debet?.debit || kredit?.credit || 0;
  return `${tanggal}|${debet?.accountCode || '-'}|${kredit?.accountCode || '-'}|${nominal}|${keterangan}`;
}

/** Kelompokkan baris Transaction flat jadi Map<jeId, baris-baris miliknya>. */
function kelompokkanPerJeId(rows: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const row of rows) {
    const arr = map.get(row.jeId) || [];
    arr.push(row);
    map.set(row.jeId, arr);
  }
  return map;
}

export interface HasilPisahDuplikat {
  /** Baris (flat, sudah termasuk kaki debet+kredit) yang jeId-nya TIDAK ditemukan mirip di `existing`. */
  entriBaru: Transaction[];
  /** Jumlah ENTRI JURNAL (bukan baris flat) yang terdeteksi kemungkinan sudah pernah diimpor. */
  jumlahKemungkinanDuplikat: number;
}

/**
 * Bandingkan `rowsBaru` (hasil konversi draf_jurnal, akan masuk lewat
 * addTransactions/replaceGroup) terhadap `existing` (transaksi yang sudah
 * ada di TransactionsContext saat ini) berdasarkan signatureEntriJurnal().
 * TIDAK memutuskan apa pun sendiri (sama prinsipnya dengan dedup_transaksi.py
 * di backend) -- cuma memisahkan mana yang kemungkinan duplikat, keputusan
 * akhir tetap di tangan user lewat modal konfirmasi.
 */
export function pisahkanTransaksiDuplikat(rowsBaru: Transaction[], existing: Transaction[]): HasilPisahDuplikat {
  const signatureLama = new Set<string>();
  for (const entri of kelompokkanPerJeId(existing).values()) {
    signatureLama.add(signatureEntriJurnal(entri));
  }

  const entriBaru: Transaction[] = [];
  let jumlahKemungkinanDuplikat = 0;
  for (const [, entri] of kelompokkanPerJeId(rowsBaru)) {
    if (signatureLama.has(signatureEntriJurnal(entri))) {
      jumlahKemungkinanDuplikat += 1;
    } else {
      entriBaru.push(...entri);
    }
  }
  return { entriBaru, jumlahKemungkinanDuplikat };
}