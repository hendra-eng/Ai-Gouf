'use client';
// [BARU] ─── JEMBATAN TRANSAKSI (jurnal_posting) → DETAIL HALAMAN EQUITY ──────
// KPI Grid & Charts di Equity sudah tersambung ke saldo akun neraca real
// lewat useEquityData.ts (-> src/lib/neracaBridge.ts). Modul ini menyambungkan
// 4 bagian DETAIL yang sebelumnya masih mock murni:
//   - EquityClassification     (breakdown hierarkis Share Capital/Retained
//                                Earnings/Other Equity)
//   - EquityTransactions       (mutasi akun ekuitas)
//   - RetainedEarningsAnalysis (roll-forward saldo laba ditahan)
//   - EquityAllInsights        (AI insight ekuitas)
//
// Sumber datanya SAMA dengan halaman Liabilities/Account Payable: seluruh leg
// jurnal (Transaction[]) dari TransactionsContext (lihat liabilitiesBridge.ts
// untuk pola yang identik di sisi Liabilities). SEMUA leg transaksi yang
// accountCode-nya cocok dengan salah satu akun EKUITAS di neraca (dari
// useEquityData().equityAccounts) diikutkan, apapun kelompok asalnya.
//
// Keterbatasan yang disengaja (best-effort, konsisten dgn komentar di
// useEquityData.ts):
//  - "Jenis mutasi ekuitas" (Profit Allocation/Dividend/Capital Injection/dst)
//    diklasifikasi dari KATA KUNCI nama akun/sub_kategori & arah debit-kredit,
//    bukan dari tabel referensi jenis jurnal.
//  - "Dividends Paid" pada roll-forward Retained Earnings dihitung dari sisi
//    DEBIT leg transaksi yang cocok kata kunci dividen (pengurang ekuitas),
//    bukan dari field khusus (backend belum menandai jurnal ekuitas per jenis).
//  - "Prior Year Adjustments" adalah sisa/residual (delta total ekuitas - net
//    profit movement - dividends), ditandai jelas sebagai estimasi di UI.

import type { AkunNeraca } from '@/lib/neracaBridge';
import type { Transaction } from '@/app/transactions/components/transactionData';

export interface EqAccountInfo {
  namaAkun: string;
  subKategori: string | null;
  type: string;
}

/** Klasifikasi jenis mutasi ekuitas dari teks nama akun/sub_kategori + arah — best-effort, konsisten dgn useEquityData.ts. */
export function classifyEquityType(text: string): string {
  const t = (text || '').toLowerCase();
  if (/(dividen|dividend)/.test(t)) return 'Dividend';
  if (/(modal disetor|paid.?in capital|modal saham|setoran modal)/.test(t)) return 'Capital Injection';
  if (/(laba ditahan|saldo laba|retained earnings)/.test(t)) return 'Profit Allocation';
  if (/(revaluasi|revaluation)/.test(t)) return 'Equity Adjustment';
  if (/(komprehensif lain|other comprehensive|\boci\b)/.test(t)) return 'Retained Earnings Adjustment';
  return 'Equity Adjustment';
}

/** Peta noAkun -> info akun ekuitas, dipakai untuk mencocokkan leg transaksi ke akun neraca. */
export function buildEquityAccountMap(ekuitas: AkunNeraca[]): Map<string, EqAccountInfo> {
  const map = new Map<string, EqAccountInfo>();
  for (const a of ekuitas) {
    map.set(a.noAkun, {
      namaAkun: a.namaAkun,
      subKategori: a.subKategori,
      type: classifyEquityType(`${a.subKategori || ''} ${a.namaAkun || ''}`),
    });
  }
  return map;
}

export interface EquityTxRow {
  id: string;
  date: string;
  txId: string;
  account: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  amount: number; // credit - debit (kenaikan ekuitas positif, penurunan negatif)
  reference: string;
  jeId: string;
  variant: 'active' | 'paid' | 'neutral';
}

/** Seluruh leg transaksi (debit ATAU kredit) yang menyentuh akun ekuitas -- untuk tabel "Recent Equity Transactions". */
export function equityTransactionRows(
  transactions: Transaction[],
  eqMap: Map<string, EqAccountInfo>,
  limit = 200,
): EquityTxRow[] {
  const rows: EquityTxRow[] = [];
  for (const tx of transactions) {
    if (tx.status === 'Voided') continue;
    const info = eqMap.get(tx.accountCode);
    if (!info) continue;
    const debit = tx.debit || 0;
    const credit = tx.credit || 0;
    const amount = credit - debit;
    let variant: EquityTxRow['variant'] = 'neutral';
    if (debit > 0) variant = 'paid'; // debit di akun ekuitas = pengurangan (dividen dibayar, OCI turun, dst)
    else if (credit > 0) variant = 'active'; // kredit di akun ekuitas = kenaikan (laba ditahan, setoran modal, dst)
    rows.push({
      id: tx.id,
      date: tx.date,
      txId: tx.txId,
      account: tx.accountName || info.namaAkun,
      type: info.type,
      description: tx.description || '\u2014',
      debit,
      credit,
      amount,
      reference: tx.reference || tx.jeId,
      jeId: tx.jeId,
      variant,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows.slice(0, limit);
}

export interface EquityTreeItem {
  id: string;
  label: string;
  amount: number;
  pct: number;
  children?: EquityTreeItem[];
}

/** Bangun breakdown hierarkis (Share Capital / Retained Earnings / Other Equity) dari akun ekuitas real -- pengganti equityTree hardcoded. */
export function buildEquityClassificationTree(params: {
  equityAccounts: AkunNeraca[];
  lastIdx: number;
  netIncomeYtd: number;
  totalEquity: number;
}): EquityTreeItem[] {
  const { equityAccounts, lastIdx, netIncomeYtd, totalEquity } = params;
  const teks = (a: AkunNeraca) => `${a.subKategori || ''} ${a.namaAkun || ''}`.toLowerCase();
  const at = (a: AkunNeraca) => (lastIdx >= 0 ? a.perBulan[lastIdx] || 0 : 0);
  const pct = (v: number) => (Math.abs(totalEquity) > 0.01 ? Math.round((v / totalEquity) * 1000) / 10 : 0);

  const paidIn = equityAccounts.filter((a) => /(modal disetor|paid.?in capital|modal saham)/.test(teks(a)));
  const retained = equityAccounts.filter((a) => /(laba ditahan|saldo laba|retained earnings)/.test(teks(a)));
  const other = equityAccounts.filter((a) => !paidIn.includes(a) && !retained.includes(a));

  const accountChildren = (list: AkunNeraca[]): EquityTreeItem[] =>
    list
      .filter((a) => Math.abs(at(a)) > 0.01)
      .sort((a, b) => Math.abs(at(b)) - Math.abs(at(a)))
      .map((a) => ({ id: a.noAkun, label: a.namaAkun, amount: at(a), pct: pct(at(a)) }));

  const paidInTotal = paidIn.reduce((s, a) => s + at(a), 0);
  const retainedAccountsTotal = retained.reduce((s, a) => s + at(a), 0);
  const otherTotal = other.reduce((s, a) => s + at(a), 0);

  const tree: EquityTreeItem[] = [];

  if (paidIn.length > 0 || paidInTotal !== 0) {
    tree.push({ id: 'share-capital', label: 'Share Capital', amount: paidInTotal, pct: pct(paidInTotal), children: accountChildren(paidIn) });
  }

  // Retained Earnings ditampilkan termasuk laba tahun berjalan (belum tentu
  // sudah diposting ke akun Laba Ditahan) -- konsisten dgn useEquityData.ts.
  const retainedWithCurrentYear = retainedAccountsTotal + netIncomeYtd;
  const retainedChildren = accountChildren(retained);
  if (Math.abs(netIncomeYtd) > 0.01) {
    retainedChildren.push({ id: 'current-year-profit', label: 'Current Year Profit (YTD)', amount: netIncomeYtd, pct: pct(netIncomeYtd) });
  }
  if (retained.length > 0 || Math.abs(retainedWithCurrentYear) > 0.01) {
    tree.push({ id: 'retained-earnings', label: 'Retained Earnings', amount: retainedWithCurrentYear, pct: pct(retainedWithCurrentYear), children: retainedChildren });
  }

  if (other.length > 0 && Math.abs(otherTotal) > 0.01) {
    tree.push({ id: 'other-equity', label: 'Other Equity', amount: otherTotal, pct: pct(otherTotal), children: accountChildren(other) });
  }

  return tree;
}

export interface RetainedEarningsStep {
  label: string;
  amount: number;
  description: string;
  type: 'base' | 'positive' | 'negative' | 'neutral' | 'result';
}

/** Roll-forward saldo laba ditahan (Beginning -> Net Profit -> Dividends -> Prior Year Adj -> Ending) dari data real. */
export function retainedEarningsWaterfall(params: {
  retainedBeginning: number;
  retainedEnding: number;
  netIncomeYtd: number;
  dividendsPaid: number;
  beginLabel: string;
  endLabel: string;
}): RetainedEarningsStep[] {
  const { retainedBeginning, retainedEnding, netIncomeYtd, dividendsPaid, beginLabel, endLabel } = params;
  // Sisa pergerakan yang belum terjelaskan oleh Net Profit / Dividends (mis.
  // koreksi retrospektif) -- residual, ditandai jelas sebagai estimasi.
  const priorYearAdj = (retainedEnding - retainedBeginning) - netIncomeYtd + dividendsPaid;

  return [
    { label: 'Beginning Retained Earnings', amount: retainedBeginning, description: beginLabel, type: 'base' },
    { label: 'Net Profit (period movement)', amount: netIncomeYtd, description: 'Net profit recognized this period, from posted journals', type: netIncomeYtd >= 0 ? 'positive' : 'negative' },
    { label: 'Dividends Paid', amount: -dividendsPaid, description: dividendsPaid > 0 ? 'From posted dividend journal entries' : 'No dividend postings found', type: dividendsPaid > 0 ? 'negative' : 'neutral' },
    { label: 'Prior Year Adjustments', amount: priorYearAdj, description: Math.abs(priorYearAdj) > 0.01 ? 'Residual movement (estimated)' : 'No retrospective adjustments', type: 'neutral' },
    { label: 'Ending Retained Earnings', amount: retainedEnding, description: endLabel, type: 'result' },
  ];
}

export interface EquityInsight {
  title: string;
  description: string;
  metric: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
}

/** Bangun kartu AI Insight dari data ekuitas + pergerakan yang sudah dihitung -- pengganti 6 kartu hardcoded. */
export function generateEquityInsights(params: {
  totalNow: number;
  totalPrev: number;
  paidInNow: number;
  paidInPrev: number;
  retainedNow: number;
  retainedPrev: number;
  otherNow: number;
  otherPrev: number;
  netIncomeYtd: number;
  dividendsPaid: number;
  rp: (v: number) => string;
}): EquityInsight[] {
  const { totalNow, totalPrev, paidInNow, paidInPrev, retainedNow, retainedPrev, otherNow, otherPrev, netIncomeYtd, dividendsPaid, rp } = params;
  const insights: EquityInsight[] = [];

  const pct = (now: number, prev: number): number => {
    if (Math.abs(prev) < 0.01) return 0;
    return Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10;
  };

  const totalGrowth = pct(totalNow, totalPrev);
  if (Math.abs(totalGrowth) >= 1) {
    insights.push({
      title: totalGrowth >= 0 ? 'Equity Growth' : 'Equity Decline',
      description: `Total equity ${totalGrowth >= 0 ? 'grew' : 'declined'} ${Math.abs(totalGrowth)}% vs the previous period${netIncomeYtd !== 0 ? `, driven in part by current-year net profit of ${rp(netIncomeYtd)}` : ''}.`,
      metric: `${totalGrowth >= 0 ? '+' : ''}${rp(totalNow - totalPrev)} \u00b7 ${totalGrowth >= 0 ? '+' : ''}${totalGrowth}% vs prev period`,
      severity: totalGrowth >= 0 ? 'positive' : 'warning',
    });
  }

  const retainedGrowth = pct(retainedNow, retainedPrev);
  if (Math.abs(retainedGrowth) >= 1) {
    const retentionRate = netIncomeYtd > 0.01 ? Math.round(((netIncomeYtd - dividendsPaid) / netIncomeYtd) * 1000) / 10 : null;
    insights.push({
      title: retainedGrowth >= 0 ? 'Retained Earnings Expansion' : 'Retained Earnings Contraction',
      description: `Retained earnings ${retainedGrowth >= 0 ? 'increased' : 'decreased'} ${Math.abs(retainedGrowth)}% vs the previous period${retentionRate !== null ? `. Profit retention rate is ${retentionRate}% after dividend payments` : ''}.`,
      metric: `${rp(retainedNow)} \u00b7 ${retainedGrowth >= 0 ? '+' : ''}${retainedGrowth}% vs prev period`,
      severity: retainedGrowth >= 0 ? 'positive' : 'warning',
    });
  }

  if (dividendsPaid > 0.01) {
    const payoutRatio = netIncomeYtd > 0.01 ? Math.round((dividendsPaid / netIncomeYtd) * 1000) / 10 : null;
    insights.push({
      title: 'Dividend Payout Impact',
      description: `Dividends of ${rp(dividendsPaid)} were paid out this period${payoutRatio !== null ? `, representing ${payoutRatio}% of current-year net profit` : ''}. This reduces equity growth capacity.`,
      metric: payoutRatio !== null ? `${rp(dividendsPaid)} \u00b7 ${payoutRatio}% payout ratio` : rp(dividendsPaid),
      severity: 'info',
    });
  }

  const capitalGrowth = pct(paidInNow, paidInPrev);
  if (Math.abs(capitalGrowth) < 1 && paidInNow > 0.01) {
    insights.push({
      title: 'Stable Capital Base',
      description: `Paid-in capital of ${rp(paidInNow)} has remained unchanged this period. No share issuances or buybacks detected in posted journals.`,
      metric: `${rp(paidInNow)} \u00b7 No capital movement`,
      severity: 'info',
    });
  } else if (Math.abs(capitalGrowth) >= 1) {
    insights.push({
      title: capitalGrowth > 0 ? 'Capital Injection Detected' : 'Capital Reduction Detected',
      description: `Paid-in capital ${capitalGrowth > 0 ? 'increased' : 'decreased'} ${Math.abs(capitalGrowth)}% vs the previous period, based on posted journal entries.`,
      metric: `${capitalGrowth > 0 ? '+' : ''}${rp(paidInNow - paidInPrev)} \u00b7 ${capitalGrowth > 0 ? '+' : ''}${capitalGrowth}%`,
      severity: capitalGrowth > 0 ? 'positive' : 'warning',
    });
  }

  const otherGrowth = pct(otherNow, otherPrev);
  if (Math.abs(otherNow - otherPrev) > 0.01 && Math.abs(otherGrowth) >= 1) {
    insights.push({
      title: otherNow - otherPrev >= 0 ? 'Other Equity Gain' : 'Other Equity Adjustment',
      description: `Other equity components (OCI, revaluation reserve, etc.) ${otherNow - otherPrev >= 0 ? 'increased' : 'decreased'} by ${rp(Math.abs(otherNow - otherPrev))} this period.`,
      metric: `${otherNow - otherPrev >= 0 ? '+' : ''}${rp(otherNow - otherPrev)}`,
      severity: otherNow - otherPrev >= 0 ? 'positive' : 'warning',
    });
  }

  return insights.slice(0, 6);
}
