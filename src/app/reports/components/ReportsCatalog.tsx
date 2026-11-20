'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { btnOutline, btnPrimary, tabBarCls, tabCls, tabListCls } from '@/components/arap/arapSalesUi';
import PageHeading from '@/components/shared/PageHeading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import Link from 'next/link';
import {
  PieChart, BarChart3, ShoppingCart, Package, Building2, CreditCard, FileText, Settings,
  ArrowUpDown, BookOpen, Scale, Star, ArrowRight, Download, Calendar, ChevronDown,
  Users, Clock, Landmark, Receipt, Percent, Boxes, Factory, Wallet, ListChecks,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';

// Tema elegant monokrom (neutral-*) disamakan dengan halaman Sales.
// Katalog report per modul (desain: dataset/picture/report 1.jpeg).
// `href: null` = halaman report-nya belum ada -> tombol tampil "Coming Soon".

type TabId = 'overview' | 'sales' | 'purchases' | 'inventory' | 'fixed-assets' | 'banking' | 'tax' | 'production';
type Tone = 'green' | 'emerald' | 'violet' | 'orange' | 'teal' | 'rose' | 'amber' | 'sky';
type Art = 'bars' | 'line' | 'area' | 'rows' | 'doc' | 'table';

interface ReportDef {
  id: string;
  tab: TabId;
  title: string;
  description: string;
  icon: React.ElementType;
  tone: Tone;
  art: Art;
  href: string | null;
}

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'overview', label: 'Business Overview', icon: PieChart },
  { id: 'sales', label: 'Sales', icon: BarChart3 },
  { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'fixed-assets', label: 'Fixed Assets', icon: Building2 },
  { id: 'banking', label: 'Banking', icon: CreditCard },
  { id: 'tax', label: 'Tax', icon: FileText },
  { id: 'production', label: 'Production', icon: Settings },
];

const REPORTS: ReportDef[] = [
  // Business Overview
  { id: 'balance-sheet', tab: 'overview', title: 'Balance Sheet', description: 'View assets, liabilities, and equity at a selected date.', icon: FileText, tone: 'green', art: 'bars', href: '/financial-statements/balance-sheet' },
  { id: 'profit-loss', tab: 'overview', title: 'Profit & Loss', description: 'Review revenue, cost, and net profit for the selected period.', icon: BarChart3, tone: 'emerald', art: 'line', href: '/financial-statements/profit-loss' },
  { id: 'cash-flow', tab: 'overview', title: 'Cash Flow Statement', description: 'Analyze operating, investing, and financing cash movements.', icon: ArrowUpDown, tone: 'violet', art: 'area', href: '/financial-statements/cash-flow' },
  { id: 'general-ledger', tab: 'overview', title: 'General Ledger', description: 'Inspect all account-level postings and transaction movements.', icon: BookOpen, tone: 'orange', art: 'rows', href: '/reports/general-ledger' },
  { id: 'journal-report', tab: 'overview', title: 'Journal Report', description: 'Browse journal entries created during the selected period.', icon: FileText, tone: 'teal', art: 'doc', href: '/transactions/journal-entry/posted' },
  { id: 'trial-balance', tab: 'overview', title: 'Trial Balance', description: 'Compare opening balance, movements, and ending balances by account.', icon: Scale, tone: 'rose', art: 'table', href: null },

  // Sales
  { id: 'sales-register', tab: 'sales', title: 'Sales Register', description: 'List every sales invoice with tax and posting status.', icon: Receipt, tone: 'green', art: 'rows', href: '/transactions/sales' },
  { id: 'ar-aging', tab: 'sales', title: 'Receivables Aging', description: 'Track outstanding customer invoices by aging bucket.', icon: Clock, tone: 'orange', art: 'bars', href: '/accounts-receivable' },
  { id: 'sales-by-customer', tab: 'sales', title: 'Sales by Customer', description: 'Compare revenue contribution across your customers.', icon: Users, tone: 'violet', art: 'line', href: null },

  // Purchases
  { id: 'purchase-register', tab: 'purchases', title: 'Purchase Register', description: 'List posted purchase invoices and their journal impact.', icon: ShoppingCart, tone: 'green', art: 'rows', href: '/transactions/purchase/posted' },
  { id: 'ap-aging', tab: 'purchases', title: 'Payables Aging', description: 'Monitor vendor bills that are due and overdue.', icon: Clock, tone: 'rose', art: 'bars', href: '/accounts-payable' },
  { id: 'purchases-by-vendor', tab: 'purchases', title: 'Purchases by Vendor', description: 'See spending distribution across your vendors.', icon: Users, tone: 'teal', art: 'line', href: null },

  // Inventory
  { id: 'stock-summary', tab: 'inventory', title: 'Stock Summary', description: 'Quantity on hand and value for every inventory item.', icon: Boxes, tone: 'green', art: 'bars', href: null },
  { id: 'stock-movement', tab: 'inventory', title: 'Stock Movement', description: 'Track items received, issued, and adjusted over time.', icon: ArrowUpDown, tone: 'violet', art: 'area', href: null },
  { id: 'inventory-valuation', tab: 'inventory', title: 'Inventory Valuation', description: 'Value inventory using the selected costing method.', icon: Package, tone: 'amber', art: 'table', href: null },

  // Fixed Assets
  { id: 'asset-register', tab: 'fixed-assets', title: 'Fixed Asset Register', description: 'All fixed assets with cost, location, and book value.', icon: Building2, tone: 'green', art: 'rows', href: '/assets' },
  { id: 'depreciation-schedule', tab: 'fixed-assets', title: 'Depreciation Schedule', description: 'Monthly depreciation and accumulated depreciation per asset.', icon: ListChecks, tone: 'orange', art: 'line', href: null },

  // Banking
  { id: 'cash-bank-summary', tab: 'banking', title: 'Cash & Bank Summary', description: 'Balances and movements across all cash and bank accounts.', icon: Landmark, tone: 'green', art: 'area', href: '/transactions/bank-cash' },
  { id: 'bank-reconciliation', tab: 'banking', title: 'Bank Reconciliation', description: 'Match bank statement lines against recorded transactions.', icon: Scale, tone: 'teal', art: 'table', href: '/transactions/bank-cash/reconciliation' },
  { id: 'cash-bank-posted', tab: 'banking', title: 'Posted Cash & Bank', description: 'Cash receipts and payments already posted to the ledger.', icon: Wallet, tone: 'violet', art: 'doc', href: '/transactions/bank-cash/posted' },

  // Tax
  { id: 'tax-summary', tab: 'tax', title: 'Tax Summary', description: 'Overview of tax obligations, filings, and compliance status.', icon: FileText, tone: 'green', art: 'bars', href: '/tax-compliance' },
  { id: 'vat-report', tab: 'tax', title: 'VAT Report', description: 'Output and input VAT for the selected tax period.', icon: Percent, tone: 'amber', art: 'table', href: null },
  { id: 'withholding-tax', tab: 'tax', title: 'Withholding Tax', description: 'PPh 21, 23, and 4(2) withheld from transactions.', icon: Receipt, tone: 'rose', art: 'rows', href: null },

  // Production
  { id: 'production-summary', tab: 'production', title: 'Production Summary', description: 'Output quantity and status of production orders.', icon: Factory, tone: 'green', art: 'bars', href: null },
  { id: 'production-cost', tab: 'production', title: 'Production Cost', description: 'Material, labor, and overhead cost per production order.', icon: Settings, tone: 'violet', art: 'area', href: null },
];

// Semua nada tampil monokrom (abu + hitam); kunci Tone dipertahankan agar definisi REPORTS tidak berubah.
const MONO = { tile: 'bg-neutral-100 ring-1 ring-neutral-200', icon: 'text-neutral-800', art: '#404040', artSoft: '#D4D4D4' };
const TONE: Record<Tone, { tile: string; icon: string; art: string; artSoft: string }> = {
  green: MONO, emerald: MONO, violet: MONO, orange: MONO, teal: MONO, rose: MONO, amber: MONO, sky: MONO,
};

const PERIODS = ['Jan – Dec 2026', 'Jan – Dec 2025', 'Jan – Dec 2024', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];

const FAVORITES_KEY = 'reports.favorites';

function loadFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // storage diblokir: favorit hanya bertahan selama sesi ini
  }
}

/** Ilustrasi grafik kecil di pojok kanan bawah kartu (dekoratif). */
function CardArt({ art, tone }: { art: Art; tone: Tone }) {
  const { art: c, artSoft: s } = TONE[tone];
  const common = { width: 104, height: 84, viewBox: '0 0 104 84', 'aria-hidden': true } as const;
  switch (art) {
    case 'bars':
      return (
        <svg {...common}>
          <rect x="8" y="50" width="22" height="30" rx="4" fill={s} />
          <rect x="38" y="34" width="22" height="46" rx="4" fill={s} opacity="0.85" />
          <rect x="68" y="8" width="22" height="72" rx="4" fill={c} opacity="0.55" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <rect x="18" y="56" width="16" height="24" rx="3" fill={s} />
          <rect x="44" y="48" width="16" height="32" rx="3" fill={s} />
          <rect x="70" y="34" width="16" height="46" rx="3" fill={s} />
          <path d="M6 50 C 24 30, 40 44, 58 30 S 88 10, 98 10" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case 'area':
      return (
        <svg {...common}>
          <path d="M4 80 L4 62 C 24 58, 36 46, 54 48 S 84 20, 100 12 L100 80 Z" fill={s} opacity="0.6" />
          <path d="M4 62 C 24 58, 36 46, 54 48 S 84 20, 100 12" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <rect x="28" y="64" width="14" height="16" rx="3" fill={s} />
          <rect x="54" y="56" width="14" height="24" rx="3" fill={s} />
        </svg>
      );
    case 'rows':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="96" height="78" rx="8" fill={s} opacity="0.35" />
          {[16, 30, 44, 58].map(y => (
            <g key={y}>
              <rect x="14" y={y} width="16" height="7" rx="3.5" fill={s} />
              <rect x="38" y={y} width="52" height="7" rx="3.5" fill={s} />
            </g>
          ))}
        </svg>
      );
    case 'doc':
      return (
        <svg {...common}>
          <rect x="10" y="4" width="88" height="78" rx="8" fill={s} opacity="0.4" />
          <rect x="24" y="18" width="46" height="6" rx="3" fill={c} opacity="0.55" />
          <rect x="24" y="32" width="38" height="6" rx="3" fill={c} opacity="0.45" />
          <rect x="24" y="46" width="60" height="6" rx="3" fill={c} opacity="0.55" />
          <rect x="24" y="60" width="44" height="6" rx="3" fill={c} opacity="0.45" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          {[8, 24, 40, 56].map((y, r) => (
            <g key={y}>
              <rect x="8" y={y} width="22" height="9" rx="3" fill={r % 2 ? s : c} opacity={r % 2 ? 0.6 : 0.3} />
              <rect x="36" y={y} width="28" height="9" rx="3" fill={r % 2 ? s : c} opacity={r % 2 ? 0.6 : 0.3} />
              <rect x="70" y={y} width="28" height="9" rx="3" fill={r % 2 ? s : c} opacity={r % 2 ? 0.6 : 0.3} />
            </g>
          ))}
        </svg>
      );
  }
}

function ReportCard({ report, favorite, onToggleFavorite }: {
  report: ReportDef;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const tone = TONE[report.tone];
  const Icon = report.icon;
  const categoryLabel = TABS.find(t => t.id === report.tab)?.label ?? '';
  return (
    <div className="group relative bg-white border border-neutral-300 rounded-xl shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700 p-5 pt-6 overflow-hidden min-h-[176px] flex gap-4">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-neutral-900 via-neutral-400 to-transparent" />
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${tone.tile}`}>
        <Icon size={26} className={tone.icon} strokeWidth={1.8} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col pr-6 relative z-10">
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          <span className={`h-1.5 w-1.5 rounded-full ${report.href ? 'bg-neutral-800' : 'bg-neutral-300'}`} />
          {categoryLabel}
        </p>
        <h3 className="text-base font-semibold text-neutral-900 leading-tight">{report.title}</h3>
        <p className="text-xs font-medium text-neutral-500 mt-1.5 max-w-[16rem] leading-relaxed">{report.description}</p>
        <div className="mt-auto pt-4">
          {report.href ? (
            <Link
              href={report.href}
              className={btnOutline}
            >
              Open Report <ArrowRight size={14} />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-500 cursor-not-allowed" title="This report is not available yet">
              Coming Soon
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleFavorite}
        className="absolute top-4 right-4 p-1 rounded-md hover:bg-neutral-100 transition-colors z-10"
        aria-label={favorite ? `Remove ${report.title} from favorites` : `Add ${report.title} to favorites`}
        aria-pressed={favorite}
      >
        <Star size={18} className={favorite ? 'text-neutral-900 fill-neutral-900' : 'text-neutral-400'} />
      </button>

      <div className="absolute right-4 bottom-3 pointer-events-none opacity-90 hidden sm:block">
        <CardArt art={report.art} tone={report.tone} />
      </div>
    </div>
  );
}

function downloadCatalogCsv(reports: ReportDef[], company: string, period: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const tabLabel = (id: TabId) => TABS.find(t => t.id === id)?.label ?? id;
  const lines = [
    ['Category', 'Report', 'Description', 'Status', 'Link', 'Company', 'Period'].map(esc).join(','),
    ...reports.map(r => [
      tabLabel(r.tab), r.title, r.description, r.href ? 'Available' : 'Coming Soon', r.href ?? '', company, period,
    ].map(esc).join(',')),
  ];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsCatalog() {
  const { clients, activeClientId, activeClientName, setActiveClient } = useActiveClient();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState(PERIODS[0]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  useEffect(() => { setFavorites(loadFavorites()); }, []);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      saveFavorites(next);
      return next;
    });
  };

  const visibleReports = useMemo(
    () => (showFavorites ? REPORTS.filter(r => favorites.includes(r.id)) : REPORTS.filter(r => r.tab === activeTab)),
    [showFavorites, favorites, activeTab],
  );

  const companyName = activeClientName
    ?? clients.find(c => c.id === activeClientId)?.companyName
    ?? 'No company selected';

  const selectClass = 'w-full appearance-none rounded-lg border-2 border-neutral-300 bg-white pl-9 pr-8 py-1.5 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300';

  return (
    <div className={`mx-auto max-w-screen-2xl space-y-4 px-6 py-5 lg:px-8 xl:px-10 fade-in ${salesFont.className}`}>
      {/* Header */}
      <PageHeading title="Reports" description="Explore operational and financial reports across your business modules." />

      {/* Tabs -- gaya Sales (garis bawah hitam) */}
      <div className={tabBarCls}>
        <nav className={tabListCls}>
          {TABS.map(tab => {
            const active = !showFavorites && tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setShowFavorites(false); }} aria-current={active ? 'page' : undefined} className={tabCls(active)}>
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filter bar */}
      <div className="relative overflow-hidden bg-white border border-neutral-300 rounded-xl shadow-sm">
        <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-neutral-900 via-neutral-400 to-transparent" />
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-5 pb-2.5 pt-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-700">
            <span className="h-3.5 w-1 rounded-full bg-neutral-800" /> Report Settings
          </p>
          <p className="text-xs font-medium text-neutral-500">
            {showFavorites ? 'My Favorites' : TABS.find(t => t.id === activeTab)?.label} · {visibleReports.length} reports · {visibleReports.filter(r => r.href).length} available
          </p>
        </div>
        <div className="p-5 flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-1">
          <label className="block sm:w-[22rem]">
            <span className="block text-xs font-medium text-neutral-500 mb-1">Company</span>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <select
                value={activeClientId ?? ''}
                onChange={e => {
                  const c = clients.find(x => x.id === e.target.value);
                  setActiveClient(c ? c.id : null, c?.companyName ?? null);
                }}
                className={selectClass}
                aria-label="Company"
              >
                {clients.length === 0 && <option value="">{companyName}</option>}
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            </div>
          </label>
          <label className="block sm:w-60">
            <span className="block text-xs font-medium text-neutral-500 mb-1">Period</span>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <select value={period} onChange={e => setPeriod(e.target.value)} className={selectClass} aria-label="Period">
                {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3 lg:pl-6 lg:border-l lg:border-neutral-300 lg:self-stretch lg:items-end">
          <button
            onClick={() => downloadCatalogCsv(visibleReports, companyName, period)}
            className={btnOutline}
          >
            <Download size={14} /> Export Catalog
          </button>
          <button
            onClick={() => setShowFavorites(v => !v)}
            aria-pressed={showFavorites}
            className={showFavorites ? btnPrimary : btnOutline}
          >
            <Star size={14} className={showFavorites ? 'fill-white' : ''} /> My Favorites ({favorites.length})
          </button>
        </div>
        </div>
      </div>

      {/* Report cards */}
      {visibleReports.length === 0 ? (
        <div className="bg-white border border-dashed border-neutral-300 rounded-xl p-12 text-center">
          <Star size={28} className="mx-auto text-neutral-300 mb-3" />
          <p className="text-sm font-semibold text-neutral-900">No favorite reports yet</p>
          <p className="text-xs font-medium text-neutral-500 mt-1">Click the star on any report card to pin it here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleReports.map(r => (
            <ReportCard key={r.id} report={r} favorite={favorites.includes(r.id)} onToggleFavorite={() => toggleFavorite(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}