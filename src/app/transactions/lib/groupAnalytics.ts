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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * [DIUBAH] Tahun yang dipakai untuk grafik tren bulanan: kalau tidak
 * ditentukan lewat parameter `year` di monthlyTrendFor(), otomatis pakai
 * tahun dengan transaksi TERBANYAK di dalam data yang diberikan (paling
 * relevan untuk ditampilkan) — atau tahun berjalan (`new Date().getFullYear()`)
 * kalau kelompok itu belum punya transaksi sama sekali.
 */
function resolveTrendYear(transactions: Transaction[]): number {
  const countByYear = new Map<number, number>();
  transactions.forEach((tx) => {
    const d = new Date(tx.date);
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
 */
export function monthlyTrendFor(transactions: Transaction[], year?: number): { month: string; total: number; count: number }[] {
  const targetYear = year ?? resolveTrendYear(transactions);
  const totals = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  transactions.forEach((tx) => {
    const d = new Date(tx.date);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() !== targetYear) return;
    const m = d.getMonth();
    totals[m].total += txAmount(tx);
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
export function categoryBreakdown(transactions: Transaction[]): { name: string; value: number }[] {
  const byAccount = new Map<string, number>();
  transactions.forEach((tx) => {
    byAccount.set(tx.accountName, (byAccount.get(tx.accountName) || 0) + txAmount(tx));
  });
  return Array.from(byAccount.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Top pihak (customer/vendor/counterparty) berdasarkan total nominal. */
export function topParties(transactions: Transaction[], limit = 5): { name: string; amount: number }[] {
  const byParty = new Map<string, number>();
  transactions.forEach((tx) => {
    byParty.set(tx.party, (byParty.get(tx.party) || 0) + txAmount(tx));
  });
  return Array.from(byParty.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export const CHART_COLORS = ['#14b8a6', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];
