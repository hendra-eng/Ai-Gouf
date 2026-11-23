'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Calendar, Check, ChevronDown, ChevronRight, LogOut, Menu, Search, Settings } from 'lucide-react';
import BrandMark from '@/components/ui/BrandMark';
import CompanySwitcher from '@/components/CompanySwitcher';
import { useAuth, userInitials } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { useNavBadges, type NavBadge } from '@/lib/navBadges';
import { PERIOD_GROUPS, formatPeriodRange, useActivePeriod } from '@/lib/activePeriod';
import { findNavEntry, navEntryById, type NavEntry } from '@/components/navConfig';
import { searchPages, type PageEntry } from '@/components/pageIndex';

interface TopbarProps {
  onMobileMenuToggle: () => void;
}

type MenuKey = 'company' | 'period' | 'user' | 'notif' | 'search' | null;

// ---------------------------------------------------------------------------
// Palet pencarian halaman (⌘K / Ctrl+K). Datanya dari navConfig.ts, jadi selalu
// sama dengan menu di sidebar (searchIndex.ts tidak dipakai lagi).
// ---------------------------------------------------------------------------
function SearchPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchPages(query, t), [query, t]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHighlight(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const go = (entry: PageEntry) => {
    onClose();
    router.push(entry.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (results.length ? (h + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (results.length ? (h - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = results[highlight];
      if (entry) go(entry);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh] bg-[#0A251D]/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="nav-panel w-full max-w-xl overflow-hidden fade-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search size={16} className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages…"
            maxLength={100}
            role="combobox"
            aria-expanded
            aria-controls="topbar-search-list"
            aria-autocomplete="list"
            className="flex-1 min-w-0 py-4 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="nav-kbd-light">Esc</kbd>
        </div>

        <div id="topbar-search-list" ref={listRef} role="listbox" className="max-h-[22rem] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No pages match &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            results.map((entry, i) => {
              const Icon = entry.icon;
              const active = i === highlight;
              return (
                <button
                  key={entry.href}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-index={i}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => go(entry)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    active ? 'bg-muted' : ''
                  }`}
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-card' : 'bg-muted'}`}>
                    <Icon size={16} className={active ? 'text-primary' : 'text-muted-foreground'} />
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{t(entry.title)}</span>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">{t(entry.context)}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border bg-[#F8FAFC] px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><kbd className="nav-kbd-light">↑</kbd><kbd className="nav-kbd-light">↓</kbd> Navigate</span>
          <span className="flex items-center gap-1.5"><kbd className="nav-kbd-light">↵</kbd> Open</span>
          <span className="ml-auto tabular-nums">{results.length} pages</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function Topbar({ onMobileMenuToggle }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const displayName = user?.nama || user?.username || 'Pengguna';

  const { period, setPreset, setCustom } = useActivePeriod();
  // Draft rentang Custom -- baru dipakai setelah klik Apply.
  const [customStart, setCustomStart] = useState(period.start);
  const [customEnd, setCustomEnd] = useState(period.end);

  // Satu dropdown terbuka pada satu waktu.
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const periodRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  const toggleMenu = useCallback((key: Exclude<MenuKey, null>) => {
    setOpenMenu((cur) => (cur === key ? null : key));
  }, []);

  // CompanySwitcher mengontrol dirinya lewat open/onOpenChange.
  const handleCompanyOpen = useCallback((o: boolean) => {
    setOpenMenu((cur) => (o ? 'company' : cur === 'company' ? null : cur));
  }, []);

  // Klik di luar / tekan Esc menutup dropdown period, notifikasi, dan menu user.
  useEffect(() => {
    if (openMenu !== 'period' && openMenu !== 'user' && openMenu !== 'notif') return;
    const ref = openMenu === 'period' ? periodRef : openMenu === 'user' ? userRef : notifRef;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // Pintasan ⌘K / Ctrl+K membuka (atau menutup) pencarian dari halaman mana pun.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpenMenu((cur) => (cur === 'search' ? null : 'search'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Pindah halaman = tutup semua dropdown.
  useEffect(() => { setOpenMenu(null); }, [pathname]);

  const handleLogout = () => {
    setOpenMenu(null);
    logout();
  };

  // ---- Judul halaman + breadcrumb (dari navConfig) -------------------------
  const entry = useMemo(() => findNavEntry(pathname || ''), [pathname]);
  const title = entry ? t(entry.item.label) : '';
  const crumbs = useMemo(() => {
    if (!entry) return [] as string[];
    const parts = [t(entry.group), ...(entry.parent ? [t(entry.parent.label)] : [])];
    // Buang bagian yang sama dengan judul (mis. grup "Overview" di halaman Overview).
    return parts.filter((p) => p.toLowerCase() !== title.toLowerCase());
  }, [entry, t, title]);

  // ---- Notifikasi: diambil dari badge live per menu (data asli database) ------
  const liveBadges = useNavBadges();
  const alerts = useMemo(() => {
    const rows: { entry: NavEntry; badge: NavBadge }[] = [];
    for (const [id, badge] of Object.entries(liveBadges)) {
      const e = navEntryById(id);
      if (e && e.item.href) rows.push({ entry: e, badge });
    }
    rows.sort((a, b) =>
      a.badge.severity === b.badge.severity
        ? b.badge.count - a.badge.count
        : a.badge.severity === 'negative' ? -1 : 1,
    );
    return rows;
  }, [liveBadges]);
  const alertTotal = alerts.reduce((sum, r) => sum + r.badge.count, 0);
  const hasUrgent = alerts.some((r) => r.badge.severity === 'negative');

  return (
    <header className="nav-topbar h-16 border-b border-[rgba(201,178,124,0.38)] flex items-center px-4 lg:px-6 gap-3 flex-shrink-0 z-30">
      {/* Mobile menu */}
      <button
        onClick={onMobileMenuToggle}
        className="lg:hidden p-2 rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Judul halaman (breadcrumb hanya di layar lebar). Di mobile tanpa judul -> logo. */}
      <div className="flex-1 min-w-0">
        {entry ? (
          <div className="min-w-0">
            {crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="hidden xl:flex items-center gap-1 mb-1 text-[12px] leading-none text-white/65">
                {crumbs.map((c, i) => (
                  <React.Fragment key={`${c}-${i}`}>
                    {i > 0 && <ChevronRight size={11} className="text-white/35 flex-shrink-0" />}
                    <span className="truncate">{c}</span>
                  </React.Fragment>
                ))}
              </nav>
            )}
            <p className="text-[15px] font-semibold leading-tight text-white truncate" title={title}>{title}</p>
          </div>
        ) : (
          <div className="lg:hidden flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="nav-wordmark"><span className="wm-za">za</span><span className="wm-feb">feb</span></span>
          </div>
        )}
      </div>

      {/* Kontrol di kanan */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {/* Rail kontrol: satu bingkai tipis, sel dipisah garis vertikal */}
        <div className="nav-seg">
        {/* Search */}
        <button
          type="button"
          onClick={() => toggleMenu('search')}
          className="nav-icon-btn"
          aria-label="Search pages"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search size={16} className="text-[color:var(--nav-accent)] flex-shrink-0" />
          <span className="hidden 2xl:inline text-[13px] text-white/70 pr-4">Search pages</span>
          <kbd className="hidden 2xl:inline nav-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>

        {/* Company selector (autocomplete, lihat CompanySwitcher.tsx).
            Dropdown-nya diratakan ke kanan chip supaya tidak keluar layar sekarang chip ada di sisi kanan bar. */}
        <div className="contents [&>div>div.absolute]:left-auto [&>div>div.absolute]:right-0">
          <CompanySwitcher open={openMenu === 'company'} onOpenChange={handleCompanyOpen} />
        </div>

        {/* Period selector: preset (Today ... Last Year) + rentang Custom, lihat src/lib/activePeriod.tsx */}
        <div ref={periodRef} className="relative hidden md:block">
          <button
            onClick={() => {
              if (openMenu !== 'period') { setCustomStart(period.start); setCustomEnd(period.end); }
              toggleMenu('period');
            }}
            className="nav-chip text-sm"
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'period'}
          >
            <Calendar size={16} className="text-[color:var(--nav-accent)] flex-shrink-0" />
            <div className="text-left leading-none">
              <p className="nav-chip-label">Period</p>
              <p className="mt-1 text-[13px] font-semibold text-white whitespace-nowrap">
                {period.label}
                <span className="hidden 2xl:inline font-normal text-white/65"> · {period.range}</span>
              </p>
            </div>
            <ChevronDown size={14} className={`text-white/60 transition-transform ${openMenu === 'period' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'period' && (
            <div className="nav-panel absolute right-0 top-full mt-[14px] w-[34rem] max-w-[calc(100vw-2rem)] z-50 fade-in flex">
              <div className="flex-1 py-1 border-r border-border">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Financial Period</p>
                {PERIOD_GROUPS.map((g) => (
                  <div key={g.title} className="px-1.5 pb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 px-1.5 pt-1.5 pb-0.5">{g.title}</p>
                    {g.presets.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => { setPreset(p.key); setOpenMenu(null); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${period.preset === p.key ? "bg-muted" : "hover:bg-muted"}`}
                      >
                        <span className="flex-1 text-sm font-medium text-foreground">{p.label}</span>
                        {period.preset === p.key && <Check size={14} className="text-primary" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div className="w-56 p-3 space-y-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Range</p>
                <label className="block text-xs text-muted-foreground">
                  From
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground" />
                </label>
                <label className="block text-xs text-muted-foreground">
                  To
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground" />
                </label>
                {customStart && customEnd && (
                  <p className="text-[11px] text-muted-foreground">
                    {formatPeriodRange(customStart <= customEnd ? customStart : customEnd, customStart <= customEnd ? customEnd : customStart)}
                  </p>
                )}
                <button
                  disabled={!customStart || !customEnd}
                  onClick={() => { setCustom(customStart, customEnd); setOpenMenu(null); }}
                  className="w-full rounded-lg bg-primary py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Apply
                </button>
                <div className="border-t border-border pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Selected</p>
                  <p className="mt-0.5 text-xs font-medium text-foreground">{period.label}</p>
                  <p className="text-[11px] text-muted-foreground">{period.range}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notifikasi */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('notif')}
            className="nav-icon-btn relative w-10 !px-0"
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'notif'}
            aria-label={alertTotal > 0 ? `Notifications, ${alertTotal} need attention` : 'Notifications'}
          >
            <Bell size={17} />
            {alertTotal > 0 && (
              <span
                className={`absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold leading-[17px] text-center tabular-nums ring-1 ring-[#0F362B] ${
                  hasUrgent ? 'bg-rose-500 text-white' : 'bg-[color:var(--nav-accent)] text-[#0E2F26]'
                }`}
              >
                {alertTotal > 99 ? '99+' : alertTotal}
              </span>
            )}
          </button>
          {openMenu === 'notif' && (
            <div className="nav-panel absolute right-0 top-full mt-[14px] w-[22rem] max-w-[calc(100vw-2rem)] z-50 fade-in overflow-hidden">
              <div className="px-3 py-2.5 border-b border-border">
                <p className="text-sm font-semibold text-foreground">Needs attention</p>
                <p className="text-[11px] text-muted-foreground">
                  {alerts.length > 0 ? `${alerts.length} ${alerts.length === 1 ? 'menu has' : 'menus have'} items to check` : 'Everything is up to date'}
                </p>
              </div>
              {alerts.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing needs attention right now.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  {alerts.map(({ entry: e, badge }) => {
                    const Icon = e.item.icon;
                    const urgent = badge.severity === 'negative';
                    return (
                      <Link
                        key={e.item.id}
                        href={e.item.href || '/'}
                        onClick={() => setOpenMenu(null)}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors"
                      >
                        <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Icon size={16} className="text-muted-foreground" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-foreground truncate">{t(e.item.label)}</span>
                          <span className="block text-xs text-muted-foreground truncate">{badge.label}</span>
                        </span>
                        <span
                          className={`text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${
                            urgent ? 'bg-negative-subtle text-negative' : 'bg-muted text-foreground'
                          }`}
                        >
                          {badge.count > 99 ? '99+' : badge.count}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        </div>

        <div className="hidden sm:block w-px h-7 bg-white/15" />

        {/* User -- satu-satunya tempat identitas user & Log out (kartu user di sidebar sudah dihapus) */}
        <div ref={userRef} className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('user')}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'user'}
            className="nav-user flex items-center gap-2.5 pl-1.5 pr-2 py-1.5"
          >
            <div className="w-9 h-9 rounded-full bg-white/10 ring-1 ring-[rgba(201,178,124,0.6)] flex items-center justify-center">
              <span className="text-xs font-bold text-white">{userInitials(displayName)}</span>
            </div>
            <div className="hidden xl:block text-left">
              <p className="text-[13px] font-semibold text-white leading-none">{displayName}</p>
              <p className="text-[12px] text-white/65 mt-1 leading-none">{user?.role_label || '—'}</p>
            </div>
            <ChevronDown size={14} className={`text-white/60 hidden xl:block transition-transform ${openMenu === 'user' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'user' && (
            <div role="menu" className="nav-panel absolute right-0 top-full mt-[10px] w-56 z-50 py-1 fade-in">
              <div className="px-3 py-2.5 border-b border-border mb-1">
                <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.role_label || '—'}</p>
              </div>
              <button
                role="menuitem"
                onClick={() => { setOpenMenu(null); router.push('/settings'); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Settings size={14} className="text-muted-foreground" />
                Account settings
              </button>
              <div className="border-t border-border my-1" />
              <button
                role="menuitem"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-negative hover:bg-negative-subtle transition-colors text-left"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {openMenu === 'search' && <SearchPalette onClose={() => setOpenMenu(null)} />}
    </header>
  );
}