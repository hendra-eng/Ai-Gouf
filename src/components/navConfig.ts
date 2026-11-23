// Sumber tunggal struktur menu. Dipakai oleh:
//   - Sidebar.tsx  (daftar menu, submenu, flyout saat collapsed)
//   - Topbar.tsx   (breadcrumb + judul halaman, pencarian halaman, daftar notifikasi)
// Menambah halaman baru cukup di sini -- sidebar, breadcrumb, dan search ikut otomatis.
// `id` dipakai backend (nav_badges_v1.py) untuk badge angka, jadi JANGAN diganti sembarangan.
import type { ComponentType } from 'react';
import {
  LayoutDashboard, Brain, FileText, TrendingUp, Scale, Activity, RefreshCcw, NotebookText, Link2,
  ArrowLeftRight, ShoppingCart, ShoppingBag, BookOpen, Landmark, MoreHorizontal,
  ReceiptText, CreditCard, Repeat, Send,
  Package, Boxes, Wallet, PieChart,
  Calculator, ShieldCheck, BarChart3,
  Sparkles, Cuboid, ClipboardCheck,
  ListTree, Coins, CalendarCheck,
  ScrollText, Building2, FolderOpen, Banknote, Settings,
} from 'lucide-react';

export type NavIcon = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  id: string;
  label: string;
  icon: NavIcon;
  href?: string;
  badge?: string;
  badgeVariant?: 'positive' | 'negative' | 'warning' | 'info' | 'ai';
  children?: NavItem[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Satu ikon = satu menu (tidak ada ikon kembar), supaya mudah dipindai dengan mata.
export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'nav-overview', label: 'Overview', icon: LayoutDashboard, href: '/' },
      { id: 'nav-memori-ai', label: 'Memori AI', icon: Brain, href: '/memori-ai' },
    ],
  },
  {
    label: 'Financial',
    items: [
      {
        id: 'nav-statements', label: 'Financial Statements', icon: FileText, href: '/financial-statements',
        children: [
          { id: 'nav-pl', label: 'Profit & Loss', icon: TrendingUp, href: '/financial-statements/profit-loss' },
          { id: 'nav-bs', label: 'Balance Sheet', icon: Scale, href: '/financial-statements/balance-sheet' },
          { id: 'nav-cf', label: 'Cash Flow', icon: Activity, href: '/financial-statements/cash-flow' },
          { id: 'nav-coe', label: 'Statement of Changes in Equity', icon: RefreshCcw, href: '/financial-statements/changes-in-equity' },
          { id: 'nav-notes', label: 'Notes to Financial Statements', icon: NotebookText, href: '/financial-statements/notes' },
          { id: 'nav-fs-mapping', label: 'Statement Mapping', icon: Link2, href: '/financial-statements/mapping' },
        ],
      },
      {
        id: 'nav-transactions', label: 'Transactions', icon: ArrowLeftRight, href: '/transactions',
        children: [
          { id: 'nav-tx-sales', label: 'Sales', icon: ShoppingCart, href: '/transactions/sales' },
          { id: 'nav-tx-purchase', label: 'Purchase', icon: ShoppingBag, href: '/transactions/purchase' },
          { id: 'nav-tx-journal-entry', label: 'Journal Entry', icon: BookOpen, href: '/transactions/journal-entry' },
          { id: 'nav-tx-bank-cash', label: 'Cash & Bank', icon: Landmark, href: '/transactions/bank-cash' },
          { id: 'nav-tx-other', label: 'Other', icon: MoreHorizontal, href: '/transactions/other' },
        ],
      },
      { id: 'nav-ar', label: 'Accounts Receivable', icon: ReceiptText, href: '/accounts-receivable' },
      { id: 'nav-ap', label: 'Accounts Payable', icon: CreditCard, href: '/accounts-payable' },
      { id: 'nav-fx-revaluation', label: 'FX Revaluation', icon: Repeat, href: '/fx-revaluation' },
      { id: 'nav-fx-transfers', label: 'FX Transfers', icon: Send, href: '/fx-transfers' },
    ],
  },
  {
    label: 'Assets & Equity',
    items: [
      { id: 'nav-assets', label: 'Fixed Assets', icon: Package, href: '/assets' },
      { id: 'nav-inventory', label: 'Inventory', icon: Boxes, href: '/inventory' },
      { id: 'nav-liabilities', label: 'Liabilities', icon: Wallet, href: '/liabilities' },
      { id: 'nav-equity', label: 'Equity', icon: PieChart, href: '/equity' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { id: 'nav-budget', label: 'Budget & Forecast', icon: Calculator, href: '/budget-forecast' },
      { id: 'nav-tax', label: 'Tax Compliance', icon: ShieldCheck, href: '/tax-compliance' },
      { id: 'nav-analytics', label: 'Financial Analytics', icon: BarChart3, href: '/financial-analytics' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'nav-ai', label: 'AI Financial Analyst', icon: Sparkles, href: '/ai-financial-analyst', badge: 'AI', badgeVariant: 'ai' },
      { id: 'nav-agentic-ai', label: 'Agentic AI', icon: Cuboid, href: '/agentic-ai', badge: 'AI', badgeVariant: 'ai' },
      { id: 'nav-audit', label: 'Audit', icon: ClipboardCheck, href: '/audit' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { id: 'nav-coa', label: 'Chart of Accounts', icon: ListTree, href: '/coa' },
      { id: 'nav-exchange-rates', label: 'Exchange Rates', icon: Coins, href: '/exchange-rates' },
      { id: 'nav-year-end-closing', label: 'Year-End Closing', icon: CalendarCheck, href: '/year-end-closing' },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'nav-reports', label: 'Reports', icon: ScrollText, href: '/reports' },
      { id: 'nav-clients', label: 'Clients', icon: Building2, href: '/clients' },
      { id: 'nav-documents', label: 'Documents', icon: FolderOpen, href: '/documents' },
      { id: 'nav-payroll', label: 'Payroll', icon: Banknote, href: '/payroll' },
    ],
  },
];

// Settings tidak ikut daftar grup: dipasang permanen di bagian bawah sidebar.
export const settingsItem: NavItem = { id: 'nav-settings', label: 'Settings', icon: Settings, href: '/settings' };
const SETTINGS_GROUP = 'Management';

// ---------------------------------------------------------------------------
// Turunan data: daftar datar untuk breadcrumb, search, dan notifikasi.
// ---------------------------------------------------------------------------
export interface NavEntry {
  item: NavItem;
  parent?: NavItem;
  group: string;
}

export const navEntries: NavEntry[] = (() => {
  const out: NavEntry[] = [];
  for (const group of navGroups) {
    for (const item of group.items) {
      out.push({ item, group: group.label });
      for (const child of item.children ?? []) out.push({ item: child, parent: item, group: group.label });
    }
  }
  out.push({ item: settingsItem, group: SETTINGS_GROUP });
  return out;
})();

const entryById = new Map(navEntries.map((e) => [e.item.id, e]));

export function navEntryById(id: string): NavEntry | undefined {
  return entryById.get(id);
}

/** Menu yang paling cocok dengan path saat ini (href terpanjang menang, jadi submenu mengalahkan induknya). */
export function findNavEntry(pathname: string): NavEntry | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: NavEntry | null = null;
  let bestLen = -1;
  for (const entry of navEntries) {
    const href = entry.item.href;
    if (!href) continue;
    const match = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
    if (match && href.length > bestLen) {
      best = entry;
      bestLen = href.length;
    }
  }
  return best;
}

/** Cari halaman untuk palet pencarian. Query kosong = tampilkan semua halaman. */
export function searchNavEntries(
  query: string,
  translate: (text: string) => string = (s) => s,
  limit = 50,
): NavEntry[] {
  const q = query.trim().toLowerCase();
  const pages = navEntries.filter((e) => !!e.item.href);
  if (!q) return pages.slice(0, limit);

  const scored: { entry: NavEntry; score: number }[] = [];
  for (const entry of pages) {
    const raw = entry.item.label.toLowerCase();
    const shown = translate(entry.item.label).toLowerCase();
    const context = `${entry.parent?.label ?? ''} ${entry.group}`.toLowerCase();
    let score = -1;
    if (raw.startsWith(q) || shown.startsWith(q)) score = 0;
    else if (raw.includes(q) || shown.includes(q)) score = 1;
    else if (context.includes(q)) score = 2;
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
