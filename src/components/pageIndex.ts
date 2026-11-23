// Indeks pencarian SELURUH halaman aplikasi (bukan hanya yang ada di sidebar).
// Nama = judul halaman (sama dengan judul di halaman / metadata-nya). Halaman tab diberi awalan induknya,
// mis. "Journal Entry — Posted", supaya mudah dibedakan.
// Menambah halaman baru: tambahkan satu baris di PAGES. Halaman dinamis ([id], [batchId]) tidak masuk
// karena butuh data; halaman yang hanya redirect (/settings, /zafeb-ai) dan /login juga tidak dimasukkan.
import { FileText } from 'lucide-react';
import { findNavEntry, type NavIcon } from '@/components/navConfig';

export interface PageEntry {
  href: string;
  title: string;
  /** Grup / induk yang tampil di kanan hasil pencarian. */
  context: string;
  icon: NavIcon;
}

type Row = [href: string, title: string, context: string];

const PAGES: Row[] = [
  // Overview
  ['/', 'Financial Overview', 'Overview'],
  ['/memori-ai', 'Memori AI', 'Overview'],

  // Financial Statements
  ['/financial-statements/profit-loss', 'Profit & Loss', 'Financial Statements'],
  ['/financial-statements/balance-sheet', 'Balance Sheet', 'Financial Statements'],
  ['/financial-statements/cash-flow', 'Cash Flow Statement', 'Financial Statements'],
  ['/financial-statements/changes-in-equity', 'Statement of Changes in Equity', 'Financial Statements'],
  ['/financial-statements/notes', 'Notes to Financial Statements', 'Financial Statements'],
  ['/financial-statements/mapping', 'Financial Statement Mapping', 'Financial Statements'],

  // Transactions
  ['/transactions/source-data', 'Transactions — Source Data', 'Transactions'],
  ['/transactions/sales', 'Sales', 'Transactions'],
  ['/transactions/sales/invoice/new', 'Add Sales Transaction', 'Sales'],
  ['/transactions/purchase', 'Purchase', 'Transactions'],
  ['/transactions/purchase/source-data', 'Purchase — Source Data', 'Purchase'],
  ['/transactions/purchase/transaction', 'Purchase Transaction', 'Purchase'],
  ['/transactions/purchase/preview', 'Purchase — Journal Preview', 'Purchase'],
  ['/transactions/purchase/exceptions', 'Purchase — Exceptions', 'Purchase'],
  ['/transactions/purchase/posted', 'Purchase — Posted', 'Purchase'],
  ['/transactions/purchase/bill/new', 'Create Bill', 'Purchase'],
  ['/transactions/journal-entry', 'Journal Entry', 'Transactions'],
  ['/transactions/journal-entry/source-data', 'Journal Entry — Source Data', 'Journal Entry'],
  ['/transactions/journal-entry/transactions', 'Journal Entry — JE Transaction', 'Journal Entry'],
  ['/transactions/journal-entry/preview', 'Journal Entry — Journal Preview', 'Journal Entry'],
  ['/transactions/journal-entry/exceptions', 'Journal Entry — Exceptions', 'Journal Entry'],
  ['/transactions/journal-entry/posted', 'Journal Entry — Posted', 'Journal Entry'],
  ['/transactions/bank-cash', 'Cash & Bank', 'Transactions'],
  ['/transactions/bank-cash/overview', 'Cash & Bank — Overview', 'Cash & Bank'],
  ['/transactions/bank-cash/source-data', 'Cash & Bank — Source Data', 'Cash & Bank'],
  ['/transactions/bank-cash/cash-payment', 'Cash & Bank — Cash Payment', 'Cash & Bank'],
  ['/transactions/bank-cash/cash-receipt', 'Cash & Bank — Cash Receipt', 'Cash & Bank'],
  ['/transactions/bank-cash/reconciliation', 'Cash & Bank — Reconciliation', 'Cash & Bank'],
  ['/transactions/bank-cash/journal-preview', 'Cash & Bank — Journal Preview', 'Cash & Bank'],
  ['/transactions/bank-cash/exceptions', 'Cash & Bank — Exceptions', 'Cash & Bank'],
  ['/transactions/bank-cash/posted', 'Cash & Bank — Posted', 'Cash & Bank'],
  ['/transactions/other', 'Other Transactions', 'Transactions'],
  ['/transactions/other/source-data', 'Other Transactions — Source Data', 'Other Transactions'],
  ['/transactions/other/transaction', 'Other Transaction', 'Other Transactions'],
  ['/transactions/other/preview', 'Other Transactions — Journal Preview', 'Other Transactions'],
  ['/transactions/other/exceptions', 'Other Transactions — Exceptions', 'Other Transactions'],
  ['/transactions/other/posted', 'Other Transactions — Posted', 'Other Transactions'],
  ['/transactions/other/create', 'Create Other Transaction', 'Other Transactions'],
  ['/transactions/other/legacy-overview', 'Other Transactions — Legacy Overview', 'Other Transactions'],

  // AR / AP / FX
  ['/accounts-receivable', 'Accounts Receivable', 'Financial'],
  ['/accounts-receivable/invoices/new', 'Create Invoice', 'Accounts Receivable'],
  ['/accounts-receivable/receipts/new', 'Record Receipt', 'Accounts Receivable'],
  ['/accounts-receivable/export', 'Accounts Receivable Export', 'Accounts Receivable'],
  ['/accounts-payable', 'Accounts Payable', 'Financial'],
  ['/accounts-payable/payments/new', 'Record Payment', 'Accounts Payable'],
  ['/accounts-payable/export', 'Accounts Payable Export', 'Accounts Payable'],
  ['/fx-revaluation', 'FX Revaluation', 'Financial'],
  ['/fx-transfers', 'FX Transfers', 'Financial'],

  // Assets & Equity
  ['/assets', 'Fixed Assets', 'Assets & Equity'],
  ['/inventory', 'Inventory', 'Assets & Equity'],
  ['/liabilities', 'Liabilities', 'Assets & Equity'],
  ['/equity', 'Equity', 'Assets & Equity'],

  // Planning
  ['/budget-forecast', 'Budget & Forecast', 'Planning'],
  ['/tax-compliance', 'Tax Compliance', 'Planning'],
  ['/financial-analytics', 'Financial Analytics', 'Planning'],

  // Intelligence
  ['/ai-financial-analyst', 'AI Financial Analyst', 'Intelligence'],
  ['/agentic-ai', 'Agentic AI', 'Intelligence'],
  ['/audit', 'Audit', 'Intelligence'],

  // Setup
  ['/coa', 'Chart of Accounts', 'Setup'],
  ['/coa/new', 'New Account', 'Chart of Accounts'],
  ['/coa/opening-balances', 'Opening Balances', 'Chart of Accounts'],
  ['/coa/opening-balances/new', 'New Opening Balance', 'Chart of Accounts'],
  ['/exchange-rates', 'Exchange Rates', 'Setup'],
  ['/year-end-closing', 'Year-End Closing', 'Setup'],

  // Management
  ['/reports', 'Reports', 'Management'],
  ['/reports/trial-balance', 'Trial Balance', 'Reports'],
  ['/reports/general-ledger', 'General Ledger', 'Reports'],
  ['/reports/adjustment', 'Adjustment', 'Reports'],
  ['/clients', 'Clients', 'Management'],
  ['/documents', 'Documents', 'Management'],
  ['/payroll', 'Payroll', 'Management'],

  // Settings
  ['/settings/company', 'Company', 'Settings'],
  ['/settings/users', 'User Management', 'Settings'],
  ['/settings/product', 'Product Settings', 'Settings'],
  ['/settings/purchase', 'Purchase Settings', 'Settings'],
  ['/settings/account-mapping', 'Account Mapping', 'Settings'],
];

export const pageEntries: PageEntry[] = PAGES.map(([href, title, context]) => ({
  href,
  title,
  context,
  // Ikon: ikuti menu sidebar terdekat; halaman yang tidak ada di sidebar memakai ikon dokumen.
  icon: findNavEntry(href)?.item.icon ?? FileText,
}));

/**
 * Cari halaman. Query kosong = semua halaman (urutan sama dengan daftar di atas).
 * Urutan hasil: judul diawali query, judul memuat query, semua kata ada di judul+konteks.
 * `translate` dipakai supaya pencarian juga cocok dengan judul yang sudah diterjemahkan.
 */
export function searchPages(query: string, translate: (text: string) => string = (s) => s, limit = 60): PageEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return pageEntries.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: { entry: PageEntry; score: number; order: number }[] = [];
  pageEntries.forEach((entry, order) => {
    const raw = entry.title.toLowerCase();
    const shown = translate(entry.title).toLowerCase();
    const hay = `${raw} ${shown} ${entry.context.toLowerCase()} ${translate(entry.context).toLowerCase()}`;
    let score = -1;
    if (raw.startsWith(q) || shown.startsWith(q)) score = 0;
    else if (raw.includes(q) || shown.includes(q)) score = 1;
    else if (tokens.every((tk) => hay.includes(tk))) score = 2;
    if (score >= 0) scored.push({ entry, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.entry);
}