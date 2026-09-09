// [BARU] Helper analisa bersama untuk 5 sub halaman Transaksi (Sales,
// Expense, Cash Payment, Cash Reserve, Other). Semua fungsi di sini murni
// mengolah array Transaction yang sudah difilter per kelompok (hasil
// getByGroup() dari TransactionsContext) — tidak ada data dummy di sini.
import { Transaction } from '../components/transactionData';

export function formatIDR(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 1_000_000_000_000) return `Rp ${(amount / 1_000_000_000_000).toFixed(2).replace('.', ',')}T`;
    if (Math.abs(amount) >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(2).replace('.', ',')}M`;
    if (Math.abs(amount) >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(0)}Jt`;
    if (Math.abs(amount) >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}Rb`;
  }
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Nilai satu baris transaksi (satu kaki jurnal): sisi yang terisi, debit atau kredit. */
export function txAmount(tx: Transaction): number {
  return tx.debit + tx.credit;
}

/**
 * [BARU] Kelompokkan baris transaksi per NOMOR JURNAL (`jeId`). Baris tanpa
 * jeId (kosong/undefined) diperlakukan sebagai transaksi tersendiri
 * masing-masing (tidak ikut tergabung ke baris lain yang juga tidak punya
 * jeId), supaya tidak ada baris yang "hilang" karena dianggap satu grup yang
 * sama. Dipakai bersama oleh uniqueJournalTotal() dan uniqueJournalCount()
 * supaya definisi "satu transaksi" konsisten di kedua tempat.
 */
function groupByJournal(transactions: Transaction[]): Map<string, Transaction[]> {
  const byJournal = new Map<string, Transaction[]>();
  let fallbackIndex = 0;
  transactions.forEach((tx) => {
    const key = tx.jeId && tx.jeId.trim() !== '' ? tx.jeId : `__no-je-${fallbackIndex++}`;
    const rows = byJournal.get(key) || [];
    rows.push(tx);
    byJournal.set(key, rows);
  });
  return byJournal;
}

/**
 * [BARU] Total nilai transaksi dikelompokkan per NOMOR JURNAL (`jeId`), bukan
 * per baris. Satu transaksi ekonomi (satu jeId) sering dicatat sebagai lebih
 * dari satu baris kaki jurnal — misalnya sisi Kas & Bank (uang masuk) dan
 * sisi akun Pendapatan (pengakuan pendapatan) untuk invoice yang sama. Kalau
 * dijumlah pakai txAmount() per baris seperti biasa, nilai transaksi itu akan
 * terhitung DUA KALI (sekali dari kaki Kas, sekali dari kaki Pendapatan).
 *
 * Untuk tiap jeId: jumlahkan semua debit dalam grup itu, jumlahkan semua
 * kredit dalam grup itu, lalu ambil yang LEBIH BESAR di antara keduanya (pada
 * jurnal yang balance/seimbang, total debit = total kredit, jadi hasilnya
 * sama saja; Math.max dipakai sebagai jaga-jaga kalau ada baris yang belum
 * seimbang).
 */
/** Total nilai satu grup kaki jurnal (baris-baris dengan jeId yang sama): sisi debit atau kredit yang lebih besar. */
function journalAmount(rows: Transaction[]): number {
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return Math.max(debit, credit);
}

export function uniqueJournalTotal(transactions: Transaction[]): number {
  const byJournal = groupByJournal(transactions);
  let total = 0;
  byJournal.forEach((rows) => {
    total += journalAmount(rows);
  });
  return total;
}

/**
 * [BARU] Jumlah transaksi EKONOMI (jumlah nomor jurnal / jeId unik), bukan
 * jumlah baris kaki jurnal. Dipakai berpasangan dengan uniqueJournalTotal()
 * supaya "Rata-rata / Transaksi" (Total Sales ÷ Jumlah Transaksi) tetap
 * konsisten — kalau Jumlah Transaksi masih dihitung per baris sedangkan Total
 * Sales sudah per jeId, rata-ratanya akan salah lagi walau Total Sales-nya
 * sudah benar.
 */
export function uniqueJournalCount(transactions: Transaction[]): number {
  return groupByJournal(transactions).size;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang statusnya PERSIS sama dengan
 * `status` yang diminta — dipakai untuk kartu "Belum Diposting" (status
 * 'Unposted') dan "Rekonsiliasi" (status 'Reconciled'), supaya basis
 * hitungnya konsisten per-jurnal seperti uniqueJournalCount(), bukan lagi
 * per-baris kaki jurnal.
 *
 * Status diambil dari baris PERTAMA di tiap grup jeId. Ini aman karena semua
 * kaki jurnal yang sama biasanya diposting/direkonsiliasi bersamaan sehingga
 * statusnya seragam dalam satu jeId (lihat data contoh: tx-001 & tx-002 sama-
 * sama 'Posted' walau kaki jurnalnya berbeda akun). Kalau suatu saat ada
 * baris dalam satu jeId yang statusnya berbeda-beda (data tidak konsisten),
 * fungsi ini akan mengikuti status baris pertama yang ditemukan saja.
 */
export function countJournalsByStatus(transactions: Transaction[], status: Transaction['status']): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (rows[0]?.status === status) count += 1;
  });
  return count;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang kategorinya termasuk dalam daftar
 * `categories` yang diberikan — pola sama dengan countJournalsByStatus(),
 * dipakai untuk kartu ringkasan berbasis kategori (mis. "Beban Rutin" di
 * Expense) supaya basis hitungnya konsisten per-jurnal, bukan per-baris kaki
 * jurnal (satu transaksi dengan 2 kaki jurnal yang kebetulan sama-sama masuk
 * daftar kategori tidak akan terhitung dua kali). Kategori diambil dari baris
 * PERTAMA di tiap grup jeId, sama seperti countJournalsByStatus().
 */
export function countJournalsByCategory(transactions: Transaction[], categories: string[]): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (categories.includes(rows[0]?.category)) count += 1;
  });
  return count;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang lolos `predicate`, dengan
 * predicate menerima SELURUH baris dalam satu grup jeId (bukan cuma baris
 * pertama seperti countJournalsByStatus/countJournalsByCategory) — dipakai
 * untuk kondisi yang bisa saja hanya melekat di salah satu kaki jurnal, mis.
 * field `notes` (catatan anomali) yang biasanya cuma terisi di kaki yang
 * bermasalah, bukan di kedua kaki sekaligus. Helper umum ini menggantikan
 * pola `transactions.filter(...).length` berbasis baris untuk kartu
 * ringkasan yang belum punya helper spesifik sendiri.
 */
export function countJournalsWhere(transactions: Transaction[], predicate: (rows: Transaction[]) => boolean): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (predicate(rows)) count += 1;
  });
  return count;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * [DIUBAH] Tahun yang dipakai untuk grafik tren bulanan: kalau tidak
 * ditentukan lewat parameter `year` di monthlyTrendFor(), otomatis pakai
 * tahun dengan transaksi TERBANYAK di dalam data yang diberikan (paling
 * relevan untuk ditampilkan) — atau tahun berjalan (`new Date().getFullYear()`)
 * kalau kelompok itu belum punya transaksi sama sekali.
 */
function resolveTrendYear(transactions: Transaction[]): number {
  const byJournal = groupByJournal(transactions);
  const countByYear = new Map<number, number>();
  byJournal.forEach((rows) => {
    const d = new Date(rows[0].date);
    if (isNaN(d.getTime())) return;
    const y = d.getFullYear();
    countByYear.set(y, (countByYear.get(y) || 0) + 1);
  });
  if (countByYear.size === 0) return new Date().getFullYear();
  return Array.from(countByYear.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * [DIUBAH] Tren bulanan (jumlah nominal per bulan) dari transaksi satu
 * kelompok — SELALU mengembalikan 12 titik, Januari s/d Desember, untuk satu
 * tahun (bulan tanpa transaksi tetap tampil dengan total 0, bukan hilang dari
 * grafik). `year` opsional; kalau tidak diisi, otomatis pilih tahun dengan
 * transaksi terbanyak (lihat resolveTrendYear()).
 *
 * [DIUBAH] Sekarang dikelompokkan per NOMOR JURNAL (jeId) dulu sebelum
 * dijumlah ke bulan yang sesuai — supaya transaksi dengan 2 kaki jurnal (mis.
 * Kas + Pendapatan untuk invoice yang sama) tidak menambah nilai bulan itu
 * dua kali. Tanggal yang dipakai untuk menentukan bulan adalah tanggal baris
 * PERTAMA di tiap grup jeId (dalam praktiknya semua kaki jurnal yang sama
 * selalu punya tanggal yang identik).
 */
export function monthlyTrendFor(transactions: Transaction[], year?: number): { month: string; total: number; count: number }[] {
  const targetYear = year ?? resolveTrendYear(transactions);
  const totals = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  const byJournal = groupByJournal(transactions);
  byJournal.forEach((rows) => {
    const d = new Date(rows[0].date);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() !== targetYear) return;
    const m = d.getMonth();
    totals[m].total += journalAmount(rows);
    totals[m].count += 1;
  });
  return MONTH_LABELS.map((label, i) => ({ month: label, total: totals[i].total, count: totals[i].count }));
}

// [DIUBAH] Sebelumnya breakdown ini mengelompokkan per `tx.category` — itu
// cocok untuk data statis/demo yang tiap barisnya sudah punya kategori rinci
// (Revenue, Payroll, Software, dst). Tapi sejak baris hasil IMPORT rekening
// koran diberi `category` berupa salah satu dari 5 label grup saja (Sales/
// Expense/Cash Payment/Cash Reserve/Other — lihat classifyByAccountName di
// transactionData.ts), semua baris dalam satu sub halaman otomatis punya
// `category` yang SAMA (mis. semuanya "Sales") sehingga breakdown ini
// kolaps jadi cuma 1 batang. Sekarang dikelompokkan per `accountName` (nama
// akun COA yang sebenarnya, mis. "Pendapatan Jasa Konsultasi", "Pendapatan
// Maintenance") supaya tetap pecah rinci untuk data statis MAUPUN data hasil
// import.
//
// [DIUBAH LAGI] Ditemukan bug lanjutan: satu transaksi dengan 2 kaki jurnal
// (mis. "Kas & Bank — BCA" dan "Pendapatan Jasa Konsultasi" untuk invoice
// yang sama) sebelumnya membuat KEDUA nama akun itu muncul sebagai kategori
// terpisah — padahal "Kas & Bank" bukan kategori pendapatan, itu cuma sisi
// lain dari jurnal yang sama (makanya akun kas bisa nongol sebagai kategori
// "terbesar" walau isinya bukan pendapatan). Sekarang dikelompokkan per
// NOMOR JURNAL (jeId) dulu; dari tiap grup dipilih SATU kaki akun yang
// representatif — diutamakan akun PENDAPATAN (accountCode berawalan '4',
// sesuai standar penomoran akun di aplikasi ini). Kalau grup itu tidak
// punya kaki akun pendapatan sama sekali (mis. baris hasil import yang
// belum berpasangan dengan baris pengakuan pendapatan), fallback ke kaki
// dengan nilai terbesar di grup itu supaya transaksinya tetap tampil.
export function categoryBreakdown(transactions: Transaction[]): { name: string; value: number }[] {
  const byJournal = groupByJournal(transactions);
  const byAccount = new Map<string, number>();
  byJournal.forEach((rows) => {
    const revenueLeg = rows.find((r) => String(r.accountCode ?? '').startsWith('4'));
    const rep = revenueLeg || rows.reduce((a, b) => (txAmount(b) > txAmount(a) ? b : a));
    byAccount.set(rep.accountName, (byAccount.get(rep.accountName) || 0) + journalAmount(rows));
  });
  return Array.from(byAccount.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * [DIUBAH] Top pihak (customer/vendor/counterparty) berdasarkan total
 * nominal — sekarang dikelompokkan per NOMOR JURNAL (jeId) dulu sebelum
 * dijumlah per pihak, supaya transaksi dengan 2 kaki jurnal (yang keduanya
 * tercatat atas nama pihak yang sama) tidak menghitung nominal customer itu
 * dua kali. Nama pihak diambil dari baris PERTAMA di tiap grup jeId (dalam
 * praktiknya semua kaki jurnal yang sama selalu dicatat atas nama pihak yang
 * sama).
 */
export function topParties(transactions: Transaction[], limit = 5): { name: string; amount: number }[] {
  const byJournal = groupByJournal(transactions);
  const byParty = new Map<string, number>();
  byJournal.forEach((rows) => {
    const party = rows[0]?.party || '—';
    byParty.set(party, (byParty.get(party) || 0) + journalAmount(rows));
  });
  return Array.from(byParty.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export const CHART_COLORS = ['#14b8a6', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];