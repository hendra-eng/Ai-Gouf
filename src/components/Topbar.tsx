'use client';
import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown, Menu, Calendar, Check, User, Settings, LogOut
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import CompanySwitcher from '@/components/CompanySwitcher';
import { useAuth, userInitials } from '@/lib/auth';
import { PERIOD_GROUPS, formatPeriodRange, useActivePeriod } from '@/lib/activePeriod';

interface TopbarProps {
  onMobileMenuToggle: () => void;
  company?: string;
}

export default function Topbar({ onMobileMenuToggle }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const displayName = user?.nama || user?.username || 'Pengguna';

  const { period, setPreset, setCustom } = useActivePeriod();
  // Draft rentang Custom -- baru dipakai setelah klik Apply.
  const [customStart, setCustomStart] = useState(period.start);
  const [customEnd, setCustomEnd] = useState(period.end);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Buka dropdown company = tutup dropdown lain (period & user menu).
  const handleCompanyOpen = useCallback((o: boolean) => {
    setCompanyOpen(o);
    if (o) { setPeriodOpen(false); setUserMenuOpen(false); }
  }, []);

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
  };

  return (
    <header className="h-16 bg-nav border-b border-nav flex items-center px-4 lg:px-6 gap-3 flex-shrink-0 z-30">
      {/* Mobile menu */}
      <button
        onClick={onMobileMenuToggle}
        className="lg:hidden p-2 rounded-lg hover:bg-white/10 text-white"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2">
        <AppLogo size={28} />
        <span className="font-bold text-sm text-white">zafeb</span>
      </div>

      {/* Company selector (autocomplete, lihat CompanySwitcher.tsx) */}
      <CompanySwitcher
        open={companyOpen}
        onOpenChange={handleCompanyOpen}
      />

      {/* Period selector: preset (Today ... Last Year) + rentang Custom, lihat src/lib/activePeriod.tsx */}
      <div className="relative hidden md:block">
        <button
          onClick={() => {
            if (!periodOpen) { setCustomStart(period.start); setCustomEnd(period.end); }
            setPeriodOpen((p) => !p); setCompanyOpen(false); setUserMenuOpen(false);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        >
          <Calendar size={15} className="text-muted-foreground" />
          <span className="font-semibold text-foreground">{period.label}</span>
          <span className="text-muted-foreground hidden lg:block">· {period.range}</span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${periodOpen ? 'rotate-180' : ''}`} />
        </button>
        {periodOpen && (
          <div className="absolute left-0 top-full mt-1 w-[34rem] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-card-lg z-50 fade-in flex">
            <div className="flex-1 py-1 border-r border-border">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Financial Period</p>
              {PERIOD_GROUPS.map((g) => (
                <div key={g.title} className="px-1.5 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 px-1.5 pt-1.5 pb-0.5">{g.title}</p>
                  {g.presets.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => { setPreset(p.key); setPeriodOpen(false); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${period.preset === p.key ? 'bg-emerald-50' : 'hover:bg-muted'}`}
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
                onClick={() => { setCustom(customStart, customEnd); setPeriodOpen(false); }}
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

      <div className="flex-1" />

      {/* User avatar */}
      <div className="relative">
        <div
          onClick={() => { setUserMenuOpen((p) => !p); setCompanyOpen(false); setPeriodOpen(false); }}
          className="flex items-center gap-2 pl-1 cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-highlight flex items-center justify-center">
            <span className="text-xs font-bold text-white">{userInitials(displayName)}</span>
          </div>
          <div className="hidden xl:block">
            <p className="text-sm font-semibold text-white leading-none">{displayName}</p>
            <p className="text-[10px] text-white/70 mt-0.5">{user?.role_label || '—'}</p>
          </div>
          <ChevronDown size={14} className={`text-white/70 hidden xl:block transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
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