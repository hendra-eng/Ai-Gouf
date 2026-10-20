'use client';
import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown, Menu, Calendar, Check, User, Settings, LogOut
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import CompanySwitcher from '@/components/CompanySwitcher';
import { useAuth, userInitials } from '@/lib/auth';

interface TopbarProps {
  onMobileMenuToggle: () => void;
  company?: string;
  period?: string;
}

const periods = [
  { id: 'p-2026-ytd', label: 'Jan 2026 – Aug 2026', sub: 'Year to Date' },
  { id: 'p-2026-q2', label: 'Apr 2026 – Jun 2026', sub: 'Q2 2026' },
  { id: 'p-2026-q1', label: 'Jan 2026 – Mar 2026', sub: 'Q1 2026' },
  { id: 'p-2025-fy', label: 'Jan 2025 – Dec 2025', sub: 'FY 2025' },
];

export default function Topbar({ onMobileMenuToggle, company, period }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const displayName = user?.nama || user?.username || 'Pengguna';

  const initialPeriod = periods.find((p) => p.label === period || p.sub === period) || periods[0];

  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
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

      {/* Period selector */}
      <div className="relative hidden md:block">
        <button
          onClick={() => { setPeriodOpen((p) => !p); setCompanyOpen(false); setUserMenuOpen(false); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        >
          <Calendar size={15} className="text-muted-foreground" />
          <span className="font-medium text-foreground hidden lg:block">{selectedPeriod.label}</span>
          <span className="font-medium text-foreground lg:hidden">{selectedPeriod.sub}</span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${periodOpen ? 'rotate-180' : ''}`} />
        </button>
        {periodOpen && (
          <div className="absolute left-0 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
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