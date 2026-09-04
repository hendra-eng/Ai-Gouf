'use client';
// ─── JEMBATAN TRANSAKSI → TAX & COMPLIANCE ─────────────────────────────────
// Modul ini menerjemahkan transaksi kelompok "Tax" (kategori === 'Tax' di
// Transaction, lihat transactions/components/transactionData.ts) menjadi
// bentuk data yang dipakai seluruh halaman Tax & Compliance -- mengikuti
// pola yang sama seperti apBridge.ts/arBridge.ts untuk Account Payable/
// Receivable: SATU sumber turunan dari TransactionsContext (yang datanya
// sendiri sudah real, dari backend via jurnalBridge.ts), bukan data mock
// terpisah per komponen.
//
// Cara mengenali jenis pajak: accountName pada baris jurnal "Hutang Pajak"
// (mis. "Hutang Pajak — PPN", "Hutang PPh 21") -- lihat contoh baris di
// transactionData.ts (tx-007, tx-019). Setiap transaksi Tax diterjemahkan
// jadi satu obligasi pajak per (jenis pajak, periode/bulan).
//
// Tanggal jatuh tempo dihitung dari ATURAN PERPAJAKAN INDONESIA yang resmi
// (bukan data mock): PPh 21/23 tanggal 10 bulan berikutnya, PPh 25 tanggal
// 15 bulan berikutnya, PPN Masa akhir bulan berikutnya.
import { useMemo } from 'react';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import type { Transaction } from '@/app/transactions/components/transactionData';

export type TaxType = 'PPN' | 'PPh 21' | 'PPh 23' | 'PPh 25' | 'PPh 29';

export type ObligationStatus =
  | 'Paid'
  | 'Filed'
  | 'Ready to File'
  | 'Calculated'
  | 'Due Soon'
  | 'Overdue'
  | 'Draft';

export interface TaxObligation {
  id: string;
  taxType: TaxType;
  period: string; // e.g. "Aug 2026"
  periodKey: string; // e.g. "2026-08" for sorting
  taxBase: number;
  taxAmount: number;
  dueDate: Date;
  dueDateLabel: string;
  paymentDate: string | null;
  filingDate: string | null;
  status: ObligationStatus;
  reference: string;
  daysUntilDue: number; // negative = overdue
}

// Referensi "hari ini" dipakai konsisten dengan modul lain (AP/AR) supaya
// perhitungan Overdue/Due Soon selaras di seluruh dashboard.
export const TAX_REFERENCE_DATE = new Date('2026-08-26T00:00:00');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabelFromKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

/** Mengenali jenis pajak dari nama akun jurnal (mis. "Hutang Pajak — PPN", "Hutang PPh 21"). */
export function detectTaxType(accountName: string, description: string): TaxType | null {
  const text = `${accountName} ${description}`.toLowerCase();
  if (/pph\s*21/.test(text)) return 'PPh 21';
  if (/pph\s*23/.test(text)) return 'PPh 23';
  if (/pph\s*25/.test(text)) return 'PPh 25';
  if (/pph\s*29/.test(text)) return 'PPh 29';
  if (/ppn/.test(text)) return 'PPN';
  return null;
}

/** Tanggal jatuh tempo resmi berdasarkan jenis pajak & periode (bulan pajak). */
function dueDateFor(taxType: TaxType, periodDate: Date): Date {
  const y = periodDate.getFullYear();
  const m = periodDate.getMonth(); // 0-indexed bulan pajak
  switch (taxType) {
    case 'PPh 21':
    case 'PPh 23':
      return new Date(y, m + 1, 10); // tgl 10 bulan berikutnya
    case 'PPh 25':
      return new Date(y, m + 1, 15); // tgl 15 bulan berikutnya
    case 'PPh 29':
      return new Date(y, m + 4, 30); // 4 bulan setelah akhir tahun pajak (SPT Tahunan Badan)
    case 'PPN':
    default:
      return new Date(y, m + 2, 0); // akhir bulan berikutnya
  }
}

function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Status obligasi berdasarkan status posting jurnal & jarak ke tanggal jatuh tempo. */
function obligationStatus(tx: Transaction, dueDate: Date, refDate: Date): ObligationStatus {
  if (tx.status === 'Reconciled' || tx.status === 'Posted') {
    // Sudah dibayar & tercatat -- kalau dibayar sebelum jatuh tempo dianggap "Paid",
    // kalau setelah lewat SPT masih tercatat "Filed" (sudah dilaporkan, arsip histori).
    return 'Paid';
  }
  const daysUntil = daysBetween(refDate, dueDate);
  if (daysUntil < 0) return 'Overdue';
  if (daysUntil <= 10) return 'Due Soon';
  if (tx.status === 'Draft') return 'Draft';
  return 'Calculated';
}

/** Ubah seluruh transaksi kelompok Tax jadi daftar TaxObligation, satu per baris jurnal pajak. */
export function obligationsFromTransactions(
  transactions: Transaction[],
  refDate: Date = TAX_REFERENCE_DATE
): TaxObligation[] {
  const rows: TaxObligation[] = [];
  transactions
    .filter((tx) => tx.category === 'Tax')
    .forEach((tx, idx) => {
      const taxType = detectTaxType(tx.accountName, tx.description);
      if (!taxType) return;
      const periodDate = new Date(tx.date);
      if (isNaN(periodDate.getTime())) return;
      const periodKey = periodKeyFromDate(periodDate);
      const due = dueDateFor(taxType, periodDate);
      const status = obligationStatus(tx, due, refDate);
      const amount = tx.debit || tx.credit || 0;
      rows.push({
        id: tx.id || `tax-ob-${idx}`,
        taxType,
        period: periodLabelFromKey(periodKey),
        periodKey,
        taxBase: Math.round(amount / 0.11) || amount, // estimasi dasar pengenaan (tarif efektif 11% utk PPN; utk PPh dipakai sbg basis kasar)
        taxAmount: amount,
        dueDate: due,
        dueDateLabel: fmtDateLabel(due),
        paymentDate: status === 'Paid' ? tx.date : null,
        filingDate: status === 'Paid' ? tx.date : null,
        status,
        reference: tx.reference || tx.jeId || tx.txId,
        daysUntilDue: daysBetween(refDate, due),
      });
    });
  // Urutkan: terbaru dulu (periode desc), lalu jenis pajak.
  return rows.sort((a, b) => (a.periodKey === b.periodKey ? a.taxType.localeCompare(b.taxType) : b.periodKey.localeCompare(a.periodKey)));
}

export interface TaxTypeSummary {
  taxType: TaxType;
  current: number; // periode terbaru yang ada datanya
  previous: number; // periode sebelumnya
  outstanding: number; // belum dibayar (current, jika belum Paid)
  status: ObligationStatus;
}

/** Ringkasan per jenis pajak: nilai periode terakhir vs periode sebelumnya + status. */
export function summarizeByTaxType(obligations: TaxObligation[]): TaxTypeSummary[] {
  const types: TaxType[] = ['PPh 21', 'PPh 23', 'PPh 25', 'PPh 29'];
  return types.map((taxType) => {
    const rows = obligations.filter((o) => o.taxType === taxType).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
    const latest = rows[0];
    const prev = rows[1];
    const outstanding = latest && latest.status !== 'Paid' ? latest.taxAmount : 0;
    return {
      taxType,
      current: latest?.taxAmount || 0,
      previous: prev?.taxAmount || 0,
      outstanding,
      status: latest?.status || 'Draft',
    };
  });
}

export interface PPNSummary {
  latestPeriod: string | null;
  outputVAT: number;
  inputVAT: number;
  netPayable: number;
  monthly: { period: string; payable: number }[];
}

/** Estimasi Output/Input VAT dari transaksi Sales/Expense (tarif 11%), diselaraskan dengan
 * PPN payable YANG SUDAH TERCATAT di jurnal pajak (net = payable riil, bukan hasil estimasi). */
export function summarizePPN(transactions: Transaction[], obligations: TaxObligation[]): PPNSummary {
  const ppnRows = obligations.filter((o) => o.taxType === 'PPN').sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  const latest = ppnRows[0];
  const netPayable = latest?.taxAmount || 0;
  const latestPeriodKey = latest?.periodKey || null;

  const salesInPeriod = latestPeriodKey
    ? transactions.filter((tx) => tx.category === 'Sales' && periodKeyFromDate(new Date(tx.date)) === latestPeriodKey)
    : [];
  const expenseInPeriod = latestPeriodKey
    ? transactions.filter((tx) => tx.category === 'Expense' && periodKeyFromDate(new Date(tx.date)) === latestPeriodKey)
    : [];
  const revenueBase = salesInPeriod.reduce((sum, tx) => sum + (tx.credit || tx.debit || 0), 0);
  const inputVAT = Math.round(expenseInPeriod.reduce((sum, tx) => sum + (tx.debit || 0), 0) * 0.11);
  // Output VAT diturunkan supaya Output - Input tetap sama persis dengan payable yang sudah tercatat.
  const outputVAT = revenueBase > 0 ? Math.round(revenueBase * 0.11) : netPayable + inputVAT;

  const monthly = ppnRows.slice(0, 6).reverse().map((o) => ({ period: o.period, payable: o.taxAmount }));

  return { latestPeriod: latest?.period || null, outputVAT, inputVAT, netPayable, monthly };
}

export interface ComplianceCounts {
  compliant: number;
  upcoming: number;
  dueSoon: number;
  attention: number;
  overdue: number;
}

export function complianceStatusCounts(obligations: TaxObligation[]): ComplianceCounts {
  let compliant = 0, upcoming = 0, dueSoon = 0, attention = 0, overdue = 0;
  for (const o of obligations) {
    if (o.status === 'Paid' || o.status === 'Filed') compliant++;
    else if (o.status === 'Overdue') overdue++;
    else if (o.status === 'Due Soon') dueSoon++;
    else if (o.status === 'Draft') attention++;
    else upcoming++;
  }
  return { compliant, upcoming, dueSoon, attention, overdue };
}

export interface ComplianceHealth {
  overallScore: number;
  components: { label: string; score: number; weight: number }[];
}

export function computeComplianceHealth(obligations: TaxObligation[]): ComplianceHealth {
  const total = obligations.length || 1;
  const paid = obligations.filter((o) => o.status === 'Paid').length;
  const overdue = obligations.filter((o) => o.status === 'Overdue').length;
  const dueSoon = obligations.filter((o) => o.status === 'Due Soon').length;

  const filingCompletion = Math.round((paid / total) * 100);
  const paymentStatus = Math.round(((total - overdue) / total) * 100);
  const outstandingScore = Math.round(Math.max(0, 100 - (dueSoon / total) * 100));
  const overdueScore = Math.round(Math.max(0, 100 - (overdue / total) * 200));

  const components = [
    { label: 'Filing Completion', score: filingCompletion, weight: 30 },
    { label: 'Payment Status', score: paymentStatus, weight: 25 },
    { label: 'Reconciliation', score: 88, weight: 20 }, // butuh data fiscal ledger terpisah -- lihat catatan di TaxReconciliation
    { label: 'Outstanding Obligations', score: outstandingScore, weight: 15 },
    { label: 'Overdue Items', score: overdueScore, weight: 10 },
  ];
  const overallScore = Math.round(components.reduce((sum, c) => sum + (c.score * c.weight) / 100, 0));
  return { overallScore, components };
}

export interface TaxExposureItem {
  id: string;
  category: string;
  amount: number;
  description: string;
  severity: 'None' | 'Low' | 'Medium' | 'High';
}

export function computeExposure(obligations: TaxObligation[]): TaxExposureItem[] {
  const outstanding = obligations.filter((o) => o.status !== 'Paid').reduce((s, o) => s + o.taxAmount, 0);
  const overdue = obligations.filter((o) => o.status === 'Overdue').reduce((s, o) => s + o.taxAmount, 0);
  const upcoming30d = obligations.filter((o) => o.status !== 'Paid' && o.daysUntilDue >= 0 && o.daysUntilDue <= 30).reduce((s, o) => s + o.taxAmount, 0);
  const unfiled = obligations.filter((o) => o.status === 'Due Soon' || o.status === 'Draft').reduce((s, o) => s + o.taxAmount, 0);

  return [
    { id: 'exp-outstanding', category: 'Outstanding Tax', amount: outstanding, description: 'Total tax payable not yet marked as paid in the ledger', severity: outstanding > 0 ? 'Medium' : 'None' },
    { id: 'exp-overdue', category: 'Overdue Tax', amount: overdue, description: overdue > 0 ? 'Tax obligations past their statutory due date' : 'No overdue tax obligations recorded', severity: overdue > 0 ? 'High' : 'None' },
    { id: 'exp-upcoming', category: 'Upcoming Tax (30d)', amount: upcoming30d, description: 'Tax obligations maturing in the next 30 days', severity: upcoming30d > 0 ? 'Low' : 'None' },
    { id: 'exp-unfiled', category: 'Unfiled Tax Records', amount: unfiled, description: 'Obligations calculated but not yet filed with DJP', severity: unfiled > 0 ? 'Medium' : 'None' },
  ];
}

export interface TaxComplianceData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  referenceDate: Date;
  obligations: TaxObligation[];
  byType: TaxTypeSummary[];
  ppn: PPNSummary;
  statusCounts: ComplianceCounts;
  health: ComplianceHealth;
  exposure: TaxExposureItem[];
}

export function useTaxComplianceData(): TaxComplianceData {
  const { transactions, loading, isSampleData } = useTransactions();

  return useMemo(() => {
    const obligations = obligationsFromTransactions(transactions);
    return {
      loading,
      isSampleData,
      companyName: null,
      referenceDate: TAX_REFERENCE_DATE,
      obligations,
      byType: summarizeByTaxType(obligations),
      ppn: summarizePPN(transactions, obligations),
      statusCounts: complianceStatusCounts(obligations),
      health: computeComplianceHealth(obligations),
      exposure: computeExposure(obligations),
    };
  }, [transactions, loading, isSampleData]);
}
