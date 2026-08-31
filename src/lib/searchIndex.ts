// Index halaman untuk global search di Topbar.
// Tambahkan entry baru di sini setiap kali ada page baru di src/app.
export interface SearchIndexItem {
  label: string;
  href: string;
  group: string;
}

export const searchIndex: SearchIndexItem[] = [
  { label: 'Overview', href: '/', group: 'Overview' },
  { label: 'Agent AI', href: '/agent-ai', group: 'Overview' },
  { label: 'Financial Statements', href: '/financial-statements', group: 'Financial' },
  { label: 'Profit & Loss', href: '/financial-statements/profit-loss', group: 'Financial' },
  { label: 'Balance Sheet', href: '/financial-statements/balance-sheet', group: 'Financial' },
  { label: 'Cash Flow', href: '/financial-statements/cash-flow', group: 'Financial' },
  { label: 'Transactions', href: '/transactions', group: 'Financial' },
  { label: 'Accounts Receivable', href: '/accounts-receivable', group: 'Financial' },
  { label: 'Accounts Payable', href: '/accounts-payable', group: 'Financial' },
  { label: 'Assets', href: '/assets', group: 'Assets & Equity' },
  { label: 'Liabilities', href: '/liabilities', group: 'Assets & Equity' },
  { label: 'Equity', href: '/equity', group: 'Assets & Equity' },
  { label: 'Budget & Forecast', href: '/budget-forecast', group: 'Planning' },
  { label: 'Tax & Compliance', href: '/tax-compliance', group: 'Planning' },
  { label: 'Financial Analytics', href: '/financial-analytics', group: 'Planning' },
  { label: 'AI Financial Analyst', href: '/ai-financial-analyst', group: 'Intelligence' },
  { label: 'Audit', href: '/audit', group: 'Intelligence' },
  { label: 'Reports', href: '/reports', group: 'Management' },
  { label: 'Clients', href: '/clients', group: 'Management' },
  { label: 'Documents', href: '/documents', group: 'Management' },
];

export function searchPages(query: string, limit = 6): SearchIndexItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return searchIndex
    .filter((item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q))
    .slice(0, limit);
}
