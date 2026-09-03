'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Bell, ChevronDown, Sparkles, HelpCircle, Menu,
  Building2, Calendar, Check, AlertTriangle, TrendingUp, Info,
  User, Settings, LogOut, Keyboard, BookOpen, LifeBuoy, Globe
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { searchPages } from '@/lib/searchIndex';
import { useCurrency } from '@/lib/currency';
import { LANGUAGES, useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';

interface TopbarProps {
  onMobileMenuToggle: () => void;
  company?: string;
  period?: string;
}

// Indonesian legal-entity prefixes to skip when generating a short 2–3 letter
// code for the company switcher (e.g. "PT Nusantara Teknologi" -> "NT").
const LEGAL_PREFIXES = new Set(['PT', 'CV', 'UD', 'TBK', 'PD', 'FA']);

function companyShortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  const significant = words[0] && LEGAL_PREFIXES.has(words[0].toUpperCase()) ? words.slice(1) : words;
  const source = significant.length > 0 ? significant : words;
  const initials = source.slice(0, 3).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return initials || name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || '—';
}

const periods = [
  { id: 'p-2026-ytd', label: 'Jan 2026 – Aug 2026', sub: 'Year to Date' },
  { id: 'p-2026-q2', label: 'Apr 2026 – Jun 2026', sub: 'Q2 2026' },
  { id: 'p-2026-q1', label: 'Jan 2026 – Mar 2026', sub: 'Q1 2026' },
  { id: 'p-2025-fy', label: 'Jan 2025 – Dec 2025', sub: 'FY 2025' },
];

const initialNotifications = [
  { id: 'notif-001', type: 'warning', title: 'Tax Deadline Approaching', body: 'PPN Masa due in 5 days (30 Aug 2026)', time: '2h ago', read: false },
  { id: 'notif-002', type: 'negative', title: 'Overdue Receivable', body: 'PT Garuda Solusi — Rp 185M overdue 72 days', time: '4h ago', read: false },
  { id: 'notif-003', type: 'warning', title: 'Budget Variance Alert', body: 'Marketing expenses exceeded budget by 24.3%', time: '6h ago', read: false },
  { id: 'notif-004', type: 'ai', title: 'AI Insight Available', body: 'New cash flow forecast ready for review', time: '1d ago', read: true },
  { id: 'notif-005', type: 'positive', title: 'Payment Received', body: 'PT Teknindo — Rp 320M received', time: '1d ago', read: true },
];

function getNotifIcon(type: string) {
  switch (type) {
    case 'warning': return <AlertTriangle size={14} className="text-warning" />;
    case 'negative': return <AlertTriangle size={14} className="text-negative" />;
    case 'positive': return <TrendingUp size={14} className="text-positive" />;
    case 'ai': return <Sparkles size={14} className="text-ai" />;
    default: return <Info size={14} className="text-info" />;
  }
}

export default function Topbar({ onMobileMenuToggle, company, period }: TopbarProps) {
  const router = useRouter();

  // "Switch Company" is driven by the global active-client context (see
  // src/lib/activeClient.tsx), which is the SAME client every other page in
  // the dashboard reads from -- picking a company here is what makes every
  // other page (Dashboard, Accounts Payable, Accounts Receivable, dst) show
  // that client's data instead of a different one.
  const { clients: clientList, activeClientId, setActiveClient } = useActiveClient();
  const companies = useMemo(
    () => clientList.map((c) => ({ id: c.id, name: c.companyName, short: companyShortCode(c.companyName) })),
    [clientList]
  );

  const initialPeriod = periods.find((p) => p.label === period || p.sub === period) || periods[0];

  const { currency, fx } = useCurrency();
  const { lang, setLang, t } = useLanguage();
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState(initialNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const searchResults = useMemo(() => searchPages(searchQuery), [searchQuery]);

  const selectedCompany = companies.find((c) => c.id === activeClientId) || null;

  const closeAllDropdowns = () => {
    setCompanyOpen(false);
    setPeriodOpen(false);
    setLanguageOpen(false);
    setNotifOpen(false);
    setHelpOpen(false);
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

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const handleLogout = () => {
    setUserMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('gouf_auth');
    }
    router.push('/');
  };

  return (
    <header className="h-16 bg-card border-b border-border flex items-center px-4 lg:px-6 gap-3 flex-shrink-0 z-30">
      {/* Mobile menu */}
      <button
        onClick={onMobileMenuToggle}
        className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2">
        <AppLogo size={28} />
        <span className="font-bold text-sm text-foreground">Gouf Consulting</span>
      </div>

      {/* Search */}
      <div className="relative hidden md:block">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 ${
          searchFocused ? 'border-ring bg-card shadow-sm w-72' : 'border-border bg-muted w-52'
        }`}>
          <Search size={15} className="text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            placeholder="Search transactions, accounts..."
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0"
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => { setSearchFocused(true); closeAllDropdowns(); }}
            onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
            onKeyDown={handleSearchKeyDown}
          />
          {!searchFocused && (
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-background rounded border border-border">
              ⌘K
            </kbd>
          )}
        </div>
        {searchFocused && searchQuery && (
          <div className="absolute left-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            {searchResults.length > 0 ? (
              searchResults.map((item) => (
                <button
                  key={item.href}
                  onMouseDown={() => goToSearchResult(item.href)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
                >
                  <span className="text-sm text-foreground">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground">{item.group}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">No pages match “{searchQuery}”</p>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Company selector */}
      <div className="relative hidden sm:block">
        <button
          onClick={() => { setCompanyOpen((p) => !p); setPeriodOpen(false); setNotifOpen(false); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        >
          <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 size={12} className="text-primary" />
          </div>
          <span className="font-semibold text-foreground truncate max-w-[160px] hidden lg:block">
            {selectedCompany ? selectedCompany.name : 'No clients yet'}
          </span>
          <span className="font-semibold text-foreground lg:hidden">
            {selectedCompany ? selectedCompany.short : '—'}
          </span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${companyOpen ? 'rotate-180' : ''}`} />
        </button>
        {companyOpen && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Switch Company</p>
            {companies.length === 0 ? (
              <button
                onClick={() => { setCompanyOpen(false); router.push('/clients'); }}
                className="w-full flex items-center gap-3 px-3 py-3 hover:bg-muted transition-colors text-left"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">No clients yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Add your first client on the Clients page</p>
                </div>
              </button>
            ) : (
              companies.map((co) => (
                <button
                  key={co.id}
                  onClick={() => { setActiveClient(co.id, co.name); setCompanyOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-primary">{co.short}</span>
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{co.name}</span>
                  {selectedCompany?.id === co.id && <Check size={14} className="text-primary" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="relative hidden md:block">
        <button
          onClick={() => { setPeriodOpen((p) => !p); setCompanyOpen(false); setNotifOpen(false); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        >
          <Calendar size={15} className="text-muted-foreground" />
          <span className="font-medium text-foreground hidden lg:block">{selectedPeriod.label}</span>
          <span className="font-medium text-foreground lg:hidden">{selectedPeriod.sub}</span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${periodOpen ? 'rotate-180' : ''}`} />
        </button>
        {periodOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Financial Period</p>
            {periods.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedPeriod(p); setPeriodOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.sub}</p>
                </div>
                {selectedPeriod.id === p.id && <Check size={14} className="text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Currency indicator — read only; the actual switcher lives on Financial Overview and applies everywhere */}
      <div
        className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-sm"
        title="Ubah mata uang dari halaman Financial Overview"
      >
        <span className="font-medium text-foreground">{currency}</span>
      </div>

      {/* Language switcher */}
      <div className="relative hidden md:block">
        <button
          onClick={() => { setLanguageOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setNotifOpen(false); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        >
          <Globe size={15} className="text-muted-foreground" />
          <span className="font-medium text-foreground">{LANGUAGES.find((l) => l.code === lang)?.code.toUpperCase()}</span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${languageOpen ? 'rotate-180' : ''}`} />
        </button>
        {languageOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">{t('Language')}</p>
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setLanguageOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left"
              >
                <span className="flex-1 text-sm font-medium text-foreground">{l.native}</span>
                {lang === l.code && <Check size={14} className="text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI Assistant */}
      <button
        onClick={() => router.push('/agent-ai')}
        className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-ai-subtle border border-ai/20 text-ai text-sm font-semibold hover:bg-ai/10 transition-colors"
      >
        <Sparkles size={15} />
        <span className="hidden lg:block">Ask AI</span>
      </button>

      {/* Help */}
      <div className="relative">
        <button
          onClick={() => { setHelpOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setLanguageOpen(false); setNotifOpen(false); setUserMenuOpen(false); }}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Help"
        >
          <HelpCircle size={18} />
        </button>
        {helpOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Help</p>
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-foreground">
              <BookOpen size={14} className="text-muted-foreground" />
              Documentation (coming soon)
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-foreground">
              <LifeBuoy size={14} className="text-muted-foreground" />
              Contact support (coming soon)
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-foreground">
              <Keyboard size={14} className="text-muted-foreground" />
              Search shortcut: <kbd className="text-[10px] font-mono bg-muted rounded px-1 py-0.5">⌘K</kbd>
            </div>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative">
        <button
          onClick={() => { setNotifOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setLanguageOpen(false); }}
          className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Notifications — ${unreadCount} unread`}
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-negative text-background text-[9px] font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-card-lg z-50 fade-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm text-foreground">Notifications</h3>
              <span className="badge-negative text-[10px]">{unreadCount} new</span>
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markNotificationRead(n.id)}
                  className={`flex gap-3 px-4 py-3 hover:bg-muted transition-colors cursor-pointer border-b border-border last:border-0 ${!n.read ? 'bg-primary/2' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    n.type === 'warning' ? 'bg-warning-subtle' :
                    n.type === 'negative' ? 'bg-negative-subtle' :
                    n.type === 'positive' ? 'bg-positive-subtle' :
                    n.type === 'ai' ? 'bg-ai-subtle' : 'bg-info-subtle'
                  }`}>
                    {getNotifIcon(n.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold text-foreground ${!n.read ? '' : 'font-medium'}`}>{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(n.body)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{n.time}</p>
                  </div>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-border">
              <button onClick={markAllNotificationsRead} className="text-xs text-primary font-semibold hover:underline">
                Mark all as read
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User avatar */}
      <div className="relative">
        <div
          onClick={() => { setUserMenuOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); setLanguageOpen(false); setNotifOpen(false); setHelpOpen(false); }}
          className="flex items-center gap-2 pl-1 cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">RW</span>
          </div>
          <div className="hidden xl:block">
            <p className="text-sm font-semibold text-foreground leading-none">Rizky Wardana</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Finance Manager</p>
          </div>
          <ChevronDown size={14} className={`text-muted-foreground hidden xl:block transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
        </div>
        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/settings'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <User size={14} className="text-muted-foreground" />
              Profile
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/settings'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <Settings size={14} className="text-muted-foreground" />
              Account Settings
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-negative hover:bg-negative-subtle transition-colors text-left"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}