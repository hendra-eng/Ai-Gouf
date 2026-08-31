'use client';

import React, { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BellIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { searchPages } from '@/lib/searchIndex';

const PERIODS = [
  'Jan – Aug 2026',
  'Apr – Jun 2026',
  'Jan – Mar 2026',
  'Jan – Dec 2025',
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Financial overview' },
  '/ai-analytics': { title: 'AI Financial Analyst', subtitle: 'Financial intelligence workspace' },
  '/financial-statements': { title: 'Financial Statements', subtitle: 'P&L, Balance Sheet, Cash Flow' },
  '/transactions': { title: 'Transactions', subtitle: 'Journal entries and ledger' },
  '/accounts-receivable': { title: 'Accounts Receivable', subtitle: 'Customer invoices and aging' },
  '/accounts-payable': { title: 'Accounts Payable', subtitle: 'Vendor bills and payments' },
  '/assets': { title: 'Assets', subtitle: 'Fixed and current assets' },
  '/liabilities': { title: 'Liabilities', subtitle: 'Short and long-term liabilities' },
  '/equity': { title: 'Equity', subtitle: 'Shareholders equity and retained earnings' },
  '/budget-forecast': { title: 'Budget & Forecast', subtitle: 'Budget vs actual analysis' },
  '/tax-compliance': { title: 'Tax & Compliance', subtitle: 'Tax obligations and filings' },
  '/financial-analytics': { title: 'Financial Analytics', subtitle: 'Advanced financial analysis' },
  '/reports': { title: 'Reports', subtitle: 'Financial report studio' },
  '/clients': { title: 'Clients', subtitle: 'Client portfolio management' },
  '/documents': { title: 'Documents', subtitle: 'Document workspace' },
  '/agent-ai': { title: 'Agent AI', subtitle: 'AI accounting assistant' },
  '/audit': { title: 'Audit Center', subtitle: 'Audit control and findings' },
};

export default function TopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [period, setPeriod] = useState(PERIODS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const page = pageTitles[pathname] ?? { title: 'Finova AI', subtitle: '' };

  const searchResults = useMemo(() => searchPages(searchQuery), [searchQuery]);

  const goToSearchResult = (href: string) => {
    router.push(href);
    setSearchQuery('');
    setSearchFocused(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      goToSearchResult(searchResults[0].href);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleLogout = () => {
    setUserMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('gouf_auth');
    }
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-[#E2E8F0] h-14 flex items-center px-6 gap-4">
      {/* Page title - hidden on mobile (hamburger takes space) */}
      <div className="hidden lg:block flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-[#0F172A] truncate">{page.title}</h1>
      </div>

      {/* Mobile spacer for hamburger */}
      <div className="lg:hidden w-10 flex-shrink-0" />

      {/* Search */}
      <div className="flex-1 lg:flex-none max-w-xs relative">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
          <input
            type="text"
            value={searchQuery}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/30 focus:border-[#1B4FD8]/40"
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        {searchFocused && searchQuery && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 py-1">
            {searchResults.length > 0 ? (
              searchResults.map((item) => (
                <button
                  key={item.href}
                  onMouseDown={() => goToSearchResult(item.href)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[#F8FAFC] transition-colors text-left"
                >
                  <span className="text-xs text-[#0F172A]">{item.label}</span>
                  <span className="text-[10px] text-[#94A3B8]">{item.group}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-[#94A3B8]">No pages match &quot;{searchQuery}&quot;</p>
            )}
          </div>
        )}
      </div>

      {/* Company + Period */}
      <div className="relative hidden md:block">
        <div
          onClick={() => setPeriodOpen((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg cursor-pointer hover:bg-[#EFF6FF] transition-colors"
        >
          <CalendarDaysIcon className="w-3.5 h-3.5 text-[#1B4FD8]" />
          <span className="text-xs font-medium text-[#0F172A]">{period}</span>
          <ChevronDownIcon className="w-3 h-3 text-[#64748B]" />
        </div>
        {periodOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 py-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPeriodOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${p === period ? 'text-[#1B4FD8] bg-[#EFF6FF]' : 'text-[#0F172A] hover:bg-[#F8FAFC]'}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative">
        <button
          onClick={() => { setNotifOpen(!notifOpen); setPeriodOpen(false); setUserMenuOpen(false); }}
          className="relative p-1.5 rounded-lg hover:bg-[#F8FAFC] transition-colors"
          aria-label="Notifications"
        >
          <BellIcon className="w-4.5 h-4.5 text-[#64748B]" style={{ width: 18, height: 18 }} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#DC2626] rounded-full" />
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 py-2">
            <div className="px-4 py-2 border-b border-[#E2E8F0]">
              <p className="text-xs font-semibold text-[#0F172A]">Notifications</p>
            </div>
            {[
              { text: 'AR aging report ready', time: '2m ago', dot: 'bg-[#1B4FD8]', href: '/accounts-receivable' },
              { text: 'Audit finding AUD-002 updated', time: '1h ago', dot: 'bg-[#D97706]', href: '/audit' },
              { text: 'Monthly P&L generated', time: '3h ago', dot: 'bg-[#059669]', href: '/financial-statements/profit-loss' },
            ].map((n, i) => (
              <div
                key={i}
                onClick={() => { router.push(n.href); setNotifOpen(false); }}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-[#F8FAFC] cursor-pointer"
              >
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#0F172A]">{n.text}</p>
                  <p className="text-[10px] text-[#94A3B8] mt-0.5">{n.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User avatar */}
      <div className="relative">
        <div
          onClick={() => { setUserMenuOpen((p) => !p); setNotifOpen(false); setPeriodOpen(false); }}
          className="flex items-center gap-2 cursor-pointer group"
        >
          <div className="w-7 h-7 rounded-full bg-[#1B4FD8] flex items-center justify-center">
            <span className="text-[10px] font-bold text-white">HW</span>
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-semibold text-[#0F172A] leading-none">Hendra W.</p>
            <p className="text-[10px] text-[#64748B] leading-none mt-0.5">CFO</p>
          </div>
          <ChevronDownIcon className="hidden md:block w-3 h-3 text-[#94A3B8]" />
        </div>
        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 py-1">
            <button
              onClick={() => { router.push('/settings'); setUserMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
            >
              Settings
            </button>
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-xs text-[#DC2626] hover:bg-[#F8FAFC] transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}