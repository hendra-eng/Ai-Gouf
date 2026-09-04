'use client';
// [BARU] ─── JEMBATAN TRANSAKSI (jurnal_posting) → DETAIL HALAMAN LIABILITIES ──
// KPI Grid & Charts di Liabilities sudah tersambung ke saldo akun neraca real
// lewat useLiabilitiesData.ts (-> src/lib/neracaBridge.ts). Modul ini
// menyambungkan 4 bagian DETAIL yang sebelumnya masih mock murni:
//   - DebtAnalysisSection   (maturity profile + rasio utang)
//   - LiabilityDueSchedule  (daftar kewajiban jatuh tempo)
//   - LiabilityTransactions (mutasi akun liabilitas)
//   - LiabilitiesAllInsights (AI insight liabilitas)
//
// Sumber datanya SAMA dengan halaman Transaksi/Account Payable: seluruh leg
// jurnal (Transaction[]) dari TransactionsContext (lihat apBridge.ts untuk
// pola yang identik di sisi Expense -> Account Payable). Bedanya di sini
// tidak dibatasi ke kelompok "Expense" saja -- SEMUA leg transaksi yang
// accountCode-nya cocok dengan salah satu akun LIABILITAS di neraca (dari
// useLiabilitiesData().liabilityAccounts) diikutkan, apapun kelompok
// (Sales/Expense/Cash Payment/Cash Reserve/Other) asalnya.
//
// Keterbatasan yang disengaja (best-effort, konsisten dgn komentar di
// useLiabilitiesData.ts):
//  - "Jenis kewajiban" (Accounts Payable/Tax Payable/Debt/dst) diklasifikasi
//    dari KATA KUNCI nama akun/sub_kategori, bukan dari tabel referensi.
//  - Outstanding per kewajiban memakai field paymentStatus/paidAmount kalau
//    tersedia di baris transaksi (sama seperti apBridge.ts); kalau tidak ada,
//    dianggap belum dibayar sama sekali (paling aman utk peringatan jatuh tempo).
//  - Interest Coverage memakai proksi EBIT (Laba Bersih YTD + Beban Bunga)
//    karena backend belum expose EBIT per akun secara terpisah -- ditandai
//    jelas di UI sebagai estimasi, dan dikembalikan null kalau data beban
//    bunga tidak ditemukan sama sekali (drpd menampilkan angka yang salah).

import type { AkunNeraca } from '@/lib/neracaBridge';
import type { Transaction } from '@/app/transactions/components/transactionData';

export interface LiabAccountInfo {
  namaAkun: string;
  subKategori: string | null;
  type: string;
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** Klasifikasi jenis kewajiban dari teks nama akun/sub_kategori — best-effort, konsisten dgn useLiabilitiesData.ts. */
export function classifyLiabilityType(text: string): string {
  const t = (text || '').toLowerCase();
  if (/(hutang usaha|utang usaha|hutang dagang|utang dagang|accounts? payable)/.test(t)) return 'Accounts Payable';
  if (/(hutang pajak|utang pajak|pajak terutang|tax payable|\bppn\b|\bpph\b)/.test(t)) return 'Tax Payable';
  if (/(sewa|lease)/.test(t)) return 'Lease Liability';
  if (/(akrual|accrued)/.test(t)) return 'Accrued Expense';
  if (/(jangka panjang|long.?term debt|obligasi|\bbond\b)/.test(t)) return 'Long-Term Debt';
  if (/(jangka pendek|short.?term debt|kredit modal kerja|pinjaman)/.test(t)) return 'Short-Term Debt';
  if (/(bank|kredit|loan|\bdebt\b)/.test(t)) return 'Debt';
  return 'Other Liability';
}

/** Peta noAkun -> info akun liabilitas, dipakai untuk mencocokkan leg transaksi ke akun neraca. */
export function buildLiabilityAccountMap(liabilitas: AkunNeraca[]): Map<string, LiabAccountInfo> {
  const map = new Map<string, LiabAccountInfo>();
  for (const a of liabilitas) {
    map.set(a.noAkun, {
      namaAkun: a.namaAkun,
      subKategori: a.subKategori,
      type: classifyLiabilityType(`${a.subKategori || ''} ${a.namaAkun || ''}`),
    });
  }
  return map;
}

export interface LiabilityTxRow {
  id: string;
  date: string;
  txId: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
  party: string;
  reference: string;
  jeId: string;
  variant: 'active' | 'paid' | 'scheduled';
}

/** Seluruh leg transaksi (debit ATAU kredit) yang menyentuh akun liabilitas -- untuk tabel "Recent Liability Transactions". */
export function liabilityTransactionRows(
  transactions: Transaction[],
  liabMap: Map<string, LiabAccountInfo>,
  limit = 200,
): LiabilityTxRow[] {
  const rows: LiabilityTxRow[] = [];
  for (const tx of transactions) {
    if (tx.status === 'Voided') continue;
    const info = liabMap.get(tx.accountCode);
    if (!info) continue;
    let variant: LiabilityTxRow['variant'] = 'active';
    if ((tx.debit || 0) > 0) variant = 'paid'; // debit di akun liabilitas = pelunasan/pengurangan kewajiban
    else if (tx.status === 'Draft' || tx.status === 'Unposted') variant = 'scheduled';
    rows.push({
      id: tx.id,
      date: tx.date,
      txId: tx.txId,
      account: tx.accountName || info.namaAkun,
      description: tx.description || '—',
      debit: tx.debit || 0,
      credit: tx.credit || 0,
      party: tx.party || '—',
      reference: tx.reference || tx.jeId,
      jeId: tx.jeId,
      variant,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows.slice(0, limit);
}

export interface LiabilityObligation {
  id: string;
  liability: string;
  type: string;
  creditor: string;
  dueDate: string;
  amount: number;
  daysRemaining: number;
  status: 'overdue' | 'due-soon' | 'scheduled';
  reference: string;
}

/**
 * Daftar kewajiban yang masih outstanding (belum lunas penuh), dihitung dari
 * sisi KREDIT akun liabilitas (kredit = pengakuan kewajiban baru). Dipakai
 * untuk tabel "Upcoming Liability Obligations" & profil jatuh tempo.
 */
export function liabilityObligations(
  transactions: Transaction[],
  liabMap: Map<string, LiabAccountInfo>,
  refDateISO: string = new Date().toISOString().slice(0, 10),
): LiabilityObligation[] {
  const out: LiabilityObligation[] = [];
  for (const tx of transactions) {
    if (tx.status === 'Voided') continue;
    const info = liabMap.get(tx.accountCode);
    if (!info) continue;
    if (!((tx.credit || 0) > 0)) continue;
    const paid = tx.paymentStatus === 'Lunas'
      ? tx.credit
      : tx.paymentStatus === 'Sebagian Dibayar'
        ? Math.max(0, tx.paidAmount || 0)
        : 0;
    const outstanding = Math.max(0, (tx.credit || 0) - paid);
    if (outstanding <= 0.01) continue;
    const dueDate = tx.dueDate || tx.date;
    const daysRemaining = daysBetween(refDateISO, dueDate);
    const status: LiabilityObligation['status'] = daysRemaining < 0 ? 'overdue' : daysRemaining <= 14 ? 'due-soon' : 'scheduled';
    out.push({
      id: tx.txId,
      liability: tx.description || info.namaAkun,
      type: info.type,
      creditor: tx.party || info.namaAkun,
      dueDate,
      amount: outstanding,
      daysRemaining,
      status,
      reference: tx.reference || tx.jeId,
    });
  }
  return out.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export interface MaturityBucket { bucket: string; amount: number; color: string }

const MATURITY_BUCKET_DEFS: { bucket: string; min: number; max: number; color: string }[] = [
  { bucket: '\u226430 days', min: -Infinity, max: 30, color: '#dc2626' },
  { bucket: '31\u201390 days', min: 31, max: 90, color: '#d97706' },
  { bucket: '3\u20136 months', min: 91, max: 180, color: '#f59e0b' },
  { bucket: '6\u201312 months', min: 181, max: 365, color: '#2563eb' },
  { bucket: '1\u20133 years', min: 366, max: 1095, color: '#7c3aed' },
  { bucket: '3+ years', min: 1096, max: Infinity, color: '#16a34a' },
];

/** Kelompokkan seluruh kewajiban outstanding ke 6 bucket jatuh tempo, dalam satuan juta IDR (untuk BarChart). */
export function obligationMaturityBuckets(obligations: LiabilityObligation[]): MaturityBucket[] {
  const totals = MATURITY_BUCKET_DEFS.map((b) => ({ bucket: b.bucket, amount: 0, color: b.color }));
  obligations.forEach((o) => {
    const idx = MATURITY_BUCKET_DEFS.findIndex((b) => o.daysRemaining >= b.min && o.daysRemaining <= b.max);
    totals[idx === -1 ? 0 : idx].amount += o.amount;
  });
  return totals.map((t) => ({ ...t, amount: Math.round((t.amount / 1_000_000) * 100) / 100 }));
}

export interface DebtMetrics {
  totalDebt: number;
  shortTermDebt: number;
  longTermDebt: number;
  shortTermPct: number;
  longTermPct: number;
  debtToEquity: number | null;
  interestExpenseYtd: number | null;
  interestCoverage: number | null;
}

export function computeDebtMetrics(params: {
  shortTermDebt: number;
  longTermDebt: number;
  totalEquity: number;
  netIncomeYtd: number;
  interestExpenseYtd: number | null;
}): DebtMetrics {
  const { shortTermDebt, longTermDebt, totalEquity, netIncomeYtd, interestExpenseYtd } = params;
  const totalDebt = shortTermDebt + longTermDebt;
  const shortTermPct = totalDebt > 0 ? Math.round((shortTermDebt / totalDebt) * 1000) / 10 : 0;
  const longTermPct = totalDebt > 0 ? Math.round((longTermDebt / totalDebt) * 1000) / 10 : 0;
  const debtToEquity = totalEquity > 0.01 ? Math.round((totalDebt / totalEquity) * 100) / 100 : null;
  const hasInterest = interestExpenseYtd !== null && interestExpenseYtd > 0.01;
  // Proksi EBIT = Laba Bersih YTD + Beban Bunga (backend belum expose EBIT per akun terpisah).
  const ebitProxy = netIncomeYtd + (interestExpenseYtd || 0);
  const interestCoverage = hasInterest ? Math.round((ebitProxy / (interestExpenseYtd as number)) * 10) / 10 : null;
  return { totalDebt, shortTermDebt, longTermDebt, shortTermPct, longTermPct, debtToEquity, interestExpenseYtd, interestCoverage };
}

/** Total beban bunga tahun berjalan, dicari dari SELURUH transaksi (bukan hanya leg liabilitas -- beban bunga ada di akun P&L). */
export function interestExpenseFromTransactions(transactions: Transaction[], tahun: number): number | null {
  const re = /(beban bunga|biaya bunga|interest expense)/i;
  let found = false;
  let total = 0;
  for (const tx of transactions) {
    if (tx.status === 'Voided') continue;
    if (!re.test(tx.accountName || '')) continue;
    if (!tx.date || !tx.date.startsWith(String(tahun))) continue;
    found = true;
    total += tx.debit || 0;
  }
  return found ? total : null;
}

export interface LiabilityInsight {
  title: string;
  description: string;
  metric: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
}

/** Bangun kartu AI Insight dari data kewajiban + rasio yang sudah dihitung -- pengganti 6 kartu hardcoded. */
export function generateLiabilityInsights(params: {
  obligations: LiabilityObligation[];
  metrics: DebtMetrics;
  totalNow: number;
  totalPrev: number;
  taxPayable: number;
  rp: (v: number) => string;
}): LiabilityInsight[] {
  const { obligations, metrics, totalNow, totalPrev, taxPayable, rp } = params;
  const insights: LiabilityInsight[] = [];

  const overdue = obligations.filter((o) => o.status === 'overdue');
  if (overdue.length > 0) {
    const worst = overdue.reduce((a, b) => (a.daysRemaining < b.daysRemaining ? a : b));
    const overdueTotal = overdue.reduce((s, o) => s + o.amount, 0);
    insights.push({
      title: 'Overdue Obligation Detected',
      description: `${overdue.length} obligation(s) totaling ${rp(overdueTotal)} are past due. "${worst.liability}" to ${worst.creditor} is ${Math.abs(worst.daysRemaining)} day(s) overdue.`,
      metric: `${rp(overdueTotal)} \u00b7 ${overdue.length} overdue`,
      severity: 'critical',
    });
  }

  const dueSoon = obligations.filter((o) => o.status === 'due-soon');
  if (dueSoon.length > 0) {
    const nearest = dueSoon[0];
    const dueSoonTotal = dueSoon.reduce((s, o) => s + o.amount, 0);
    insights.push({
      title: 'Upcoming Obligations Due Soon',
      description: `${dueSoon.length} obligation(s) totaling ${rp(dueSoonTotal)} are due within 14 days. Nearest: "${nearest.liability}" due in ${nearest.daysRemaining} day(s).`,
      metric: `${rp(dueSoonTotal)} \u00b7 next in ${nearest.daysRemaining}d`,
      severity: 'warning',
    });
  }

  if (taxPayable > 0) {
    insights.push({
      title: 'Outstanding Tax Payable',
      description: `Tax payable balance stands at ${rp(taxPayable)}. Ensure timely settlement to avoid penalties and interest charges from DJP.`,
      metric: rp(taxPayable),
      severity: 'warning',
    });
  }

  if (metrics.debtToEquity !== null) {
    const healthy = metrics.debtToEquity < 1;
    insights.push({
      title: healthy ? 'Healthy Debt Leverage' : 'Elevated Debt Leverage',
      description: healthy
        ? `Debt-to-equity ratio of ${metrics.debtToEquity}x is below the 1.0x threshold, indicating conservative financial leverage and a strong equity base.`
        : `Debt-to-equity ratio of ${metrics.debtToEquity}x exceeds the 1.0x threshold — monitor leverage closely and consider reducing reliance on debt financing.`,
      metric: `D/E: ${metrics.debtToEquity}x`,
      severity: healthy ? 'positive' : 'warning',
    });
  }

  if (Math.abs(totalPrev) > 0.01) {
    const pct = Math.round(((totalNow - totalPrev) / Math.abs(totalPrev)) * 1000) / 10;
    if (Math.abs(pct) >= 1) {
      insights.push({
        title: pct > 0 ? 'Total Liabilities Increased' : 'Total Liabilities Decreased',
        description: `Total liabilities ${pct > 0 ? 'increased' : 'decreased'} ${Math.abs(pct)}% compared with the previous period.`,
        metric: `${pct > 0 ? '+' : ''}${pct}% vs prev period`,
        severity: pct > 15 ? 'warning' : 'info',
      });
    }
  }

  const apObligations = obligations.filter((o) => o.type === 'Accounts Payable');
  if (apObligations.length > 0) {
    const byCreditor = new Map<string, number>();
    apObligations.forEach((o) => byCreditor.set(o.creditor, (byCreditor.get(o.creditor) || 0) + o.amount));
    const totalAp = apObligations.reduce((s, o) => s + o.amount, 0);
    const sorted = Array.from(byCreditor.entries()).sort((a, b) => b[1] - a[1]);
    const [topCreditor, topAmt] = sorted[0];
    const pct = totalAp > 0 ? Math.round((topAmt / totalAp) * 1000) / 10 : 0;
    if (pct >= 25) {
      insights.push({
        title: 'Payables Concentration',
        description: `${topCreditor} accounts for ${pct}% of total outstanding accounts payable (${rp(topAmt)}), out of ${sorted.length} vendor(s) with open balances.`,
        metric: `${rp(topAmt)} \u00b7 ${pct}% of total AP`,
        severity: pct >= 50 ? 'warning' : 'info',
      });
    }
  }

  if (metrics.interestCoverage !== null) {
    const healthy = metrics.interestCoverage >= 3;
    insights.push({
      title: healthy ? 'Comfortable Interest Coverage' : 'Tight Interest Coverage',
      description: `Estimated interest coverage (EBIT proxy \u00f7 interest expense) is ${metrics.interestCoverage}x YTD.${healthy ? '' : ' This is below the commonly-used 3x safety threshold — review debt servicing capacity.'}`,
      metric: `${metrics.interestCoverage}x \u00b7 Interest exp. ${rp(metrics.interestExpenseYtd || 0)}`,
      severity: healthy ? 'positive' : 'warning',
    });
  }

  return insights.slice(0, 6);
}
