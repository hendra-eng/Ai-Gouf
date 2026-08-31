'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MagnifyingGlassIcon,
  BellIcon,
  ChevronDownIcon,
  SparklesIcon,
  BuildingOfficeIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import { searchPages } from '@/lib/searchIndex';

const COMPANIES = ['PT Nusantara Teknologi', 'PT Maju Bersama Sentosa', 'CV Karya Mandiri Digital'];
const PERIODS = ['Jan 2026 – Aug 2026', 'Apr 2026 – Jun 2026', 'Jan 2026 – Mar 2026', 'Jan 2025 – Dec 2025'];

interface GlobalHeaderProps {
  title?: string;
  subtitle?: string;
}

export default function GlobalHeader({ title, subtitle }: GlobalHeaderProps) {
  const router = useRouter();
  const [period, setPeriod] = useState(PERIODS[0]);
  const [company, setCompany] = useState(COMPANIES[0]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const searchResults = useMemo(() => searchPages(searchQuery), [searchQuery]);

  const closeAllDropdowns = () => {
    setCompanyOpen(false);
    setPeriodOpen(false);
    setNotifOpen(false);
    setUserMenuOpen(false);
  };

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
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 gap-4 flex-shrink-0 sticky top-0 z-30">
      {/* Left: Title */}
      <div className="flex-1 min-w-0">
        {title && (
          <div>
            <h1 className="text-slate-800 font-semibold text-base leading-tight">{title}</h1>
            {subtitle && <p className="text-slate-500 text-xs">{subtitle}</p>}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative hidden md:block">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          placeholder="Search..."
          className="pl-9 pr-4 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 transition-all"
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => { setSearchFocused(true); closeAllDropdowns(); }}
          onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchFocused && searchQuery && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
            {searchResults.length > 0 ? (
              searchResults.map((item) => (
                <button
                  key={item.href}
                  onMouseDown={() => goToSearchResult(item.href)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="text-sm text-slate-800">{item.label}</span>
                  <span className="text-[10px] text-slate-400">{item.group}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-slate-400">No pages match &quot;{searchQuery}&quot;</p>
            )}
          </div>
        )}
      </div>

      {/* Company Selector */}
      <div className="relative">
        <button
          onClick={() => { setCompanyOpen((p) => !p); setPeriodOpen(false); setNotifOpen(false); setUserMenuOpen(false); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors text-sm"
        >
          <BuildingOfficeIcon className="w-4 h-4 text-slate-500" />
          <span className="text-slate-700 font-medium hidden sm:block">{company}</span>
          <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
        </button>
        {companyOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
            {COMPANIES.map((c) => (
              <button
                key={c}
                onClick={() => { setCompany(c); setCompanyOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${c === company ? 'text-teal-600 bg-teal-50' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Period Selector */}
      <div className="relative">
        <button
          onClick={() => { setPeriodOpen((p) => !p); setCompanyOpen(false); setNotifOpen(false); setUserMenuOpen(false); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors text-sm"
        >
          <CalendarIcon className="w-4 h-4 text-slate-500" />
          <span className="text-slate-700 font-medium hidden sm:block">{period}</span>
          <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
        </button>
        {periodOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPeriodOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${p === period ? 'text-teal-600 bg-teal-50' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Ask AI */}
      <button
        onClick={() => router.push('/ai-financial-analyst')}
        className="flex items-center gap-2 px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors text-sm font-medium"
      >
        <SparklesIcon className="w-4 h-4" />
        <span className="hidden sm:block">Ask AI</span>
      </button>

      {/* Notifications */}
      <div className="relative">
        <button
          onClick={() => { setNotifOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setUserMenuOpen(false); }}
          className="relative p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <BellIcon className="w-5 h-5 text-slate-500" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-2">
            <div className="px-4 py-2 border-b border-slate-200">
              <p className="text-xs font-semibold text-slate-800">Notifications</p>
            </div>
            {[
              { text: 'AR aging report ready', time: '2m ago', dot: 'bg-teal-500', href: '/accounts-receivable' },
              { text: 'Audit finding AUD-002 updated', time: '1h ago', dot: 'bg-amber-500', href: '/audit' },
              { text: 'Monthly P&L generated', time: '3h ago', dot: 'bg-emerald-500', href: '/financial-statements/profit-loss' },
            ].map((n, i) => (
              <div
                key={i}
                onClick={() => { router.push(n.href); setNotifOpen(false); }}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
              >
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-800">{n.text}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{n.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Avatar */}
      <div className="relative">
        <div
          onClick={() => { setUserMenuOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setNotifOpen(false); }}
          className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center cursor-pointer flex-shrink-0"
        >
          <span className="text-white text-xs font-semibold">RW</span>
        </div>
        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
            <button
              onClick={() => { router.push('/settings'); setUserMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Settings
            </button>
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-slate-50 transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
