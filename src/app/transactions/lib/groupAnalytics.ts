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

/** Tren bulanan (jumlah nominal per bulan) dari transaksi satu kelompok. */
export function monthlyTrendFor(transactions: Transaction[]): { month: string; total: number; count: number }[] {
  const byMonth = new Map<string, { total: number; count: number; order: number }>();
  transactions.forEach((tx) => {
    const d = new Date(tx.date);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = MONTH_LABELS[d.getMonth()];
    const entry = byMonth.get(key) || { total: 0, count: 0, order: d.getFullYear() * 12 + d.getMonth() };
    entry.total += txAmount(tx);
    entry.count += 1;
    byMonth.set(key, entry);
  });
  return Array.from(byMonth.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, v]) => ({ month: MONTH_LABELS[Number(key.split('-')[1])], total: v.total, count: v.count }));
}

/** Breakdown per kategori (mis. dalam kelompok Expense: Payroll/Rent/Software/dst). */
export function categoryBreakdown(transactions: Transaction[]): { name: string; value: number }[] {
  const byCat = new Map<string, number>();
  transactions.forEach((tx) => {
    byCat.set(tx.category, (byCat.get(tx.category) || 0) + txAmount(tx));
  });
  return Array.from(byCat.entries())
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
