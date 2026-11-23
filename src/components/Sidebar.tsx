'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BrandMark from '@/components/ui/BrandMark';
import { ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useNavBadges } from '@/lib/navBadges';
import { navGroups, settingsItem, type NavItem } from '@/components/navConfig';

// Struktur menu (grup, ikon, href) ada di navConfig.ts -- file ini hanya urusan tampilan.
// Identitas user & tombol Log out sekarang hanya ada di Topbar (tidak lagi dobel di sini);
// Settings dipasang permanen di bagian bawah sidebar.

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  currentPath?: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function getBadgeClasses(variant?: string) {
  switch (variant) {
    case 'positive': return 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/20';
    case 'negative': return 'bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/20';
    case 'warning': return 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/20';
    case 'ai': return 'bg-violet-400/20 text-violet-200 ring-1 ring-violet-300/25';
    default: return 'bg-white/10 text-white/80 ring-1 ring-white/10';
  }
}

// prefix=true: halaman turunan ikut menandai menu aktif (mis. /settings/users -> Settings,
// /coa/new -> Chart of Accounts). Hanya untuk menu TANPA sub-menu, supaya menu induk
// (Transactions, Financial Statements) tetap seperti semula.
function pathMatches(href: string | undefined, currentPath: string, prefix = false) {
  if (!href) return false;
  if (href === currentPath) return true;
  return prefix && href !== '/' && !!currentPath && currentPath.startsWith(`${href}/`);
}

export default function Sidebar({ collapsed, onToggle, currentPath = '', mobileOpen, onMobileClose }: SidebarProps) {
  const { t } = useLanguage();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // Angka badge asli dari database (company aktif), bukan angka tetap.
  const liveBadges = useNavBadges();

  // Buka otomatis induk dari halaman yang sedang aktif (termasuk halaman turunan submenu).
  useEffect(() => {
    navGroups.forEach((group) => {
      group.items.forEach((item) => {
        if (!item.children) return;
        const onParent = item.href === currentPath;
        const onChild = item.children.some((child) => pathMatches(child.href, currentPath, true));
        if (onParent || onChild) {
          setExpandedItems((prev) => {
            if (prev.has(item.id)) return prev;
            const next = new Set(prev);
            next.add(item.id);
            return next;
          });
        }
      });
    });
  }, [currentPath]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandItem = (id: string) => {
    setExpandedItems((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // ---- Mode collapsed ------------------------------------------------------
  // Tooltip (menu biasa) dan flyout (menu yang punya submenu) memakai posisi fixed
  // supaya tidak terpotong overflow-hidden pada <aside>.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const [flyout, setFlyout] = useState<{ item: NavItem; top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const showTip = (label: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
  };

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setFlyout(null), 140);
  }, [cancelClose]);

  const openFlyout = (item: NavItem, el: HTMLElement) => {
    cancelClose();
    setTip(null);
    const r = el.getBoundingClientRect();
    const estimatedHeight = (item.children?.length ?? 0) * 36 + 56;
    const top = Math.max(8, Math.min(r.top - 6, window.innerHeight - estimatedHeight - 8));
    setFlyout({ item, top, left: r.right + 10 });
  };

  // Tutup flyout/tooltip saat pindah halaman atau sidebar dilebarkan lagi.
  useEffect(() => {
    setFlyout(null);
    setTip(null);
  }, [currentPath, collapsed]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlyout(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [flyout]);

  // Badge live (angka dari database) menang atas label statis seperti "AI".
  const resolveBadge = (item: NavItem) => {
    const live = liveBadges[item.id];
    if (live) {
      return { text: live.count > 99 ? '99+' : String(live.count), variant: live.severity as string, title: live.label };
    }
    if (item.badge) return { text: item.badge, variant: item.badgeVariant as string | undefined, title: undefined };
    return null;
  };

  const renderBadge = (item: NavItem) => {
    const b = resolveBadge(item);
    if (!b) return null;
    return (
      <span
        title={b.title}
        aria-label={b.title}
        className={`text-[11px] min-w-[22px] text-center px-1.5 py-0.5 rounded-full font-semibold tabular-nums ${getBadgeClasses(b.variant)}`}
      >
        {b.text}
      </span>
    );
  };

  const renderNavItem = (item: NavItem, collapsed: boolean, onNavigate?: () => void, depth = 0): React.ReactNode => {
    const hasChildren = !!item.children && item.children.length > 0;
    const active = pathMatches(item.href, currentPath, !hasChildren);
    const isExpanded = expandedItems.has(item.id);
    const Icon = item.icon;

    // Menu dengan submenu, sidebar lebar: baris induk + daftar anak di bawahnya.
    if (hasChildren && !collapsed) {
      return (
        <div key={item.id}>
          <div
            className={`flex items-center rounded-xl text-[13px] font-medium transition-all duration-150 ${
              active ? 'nav-item-active' : 'nav-item-inactive'
            }`}
          >
            <Link
              href={item.href || '/'}
              aria-current={active ? 'page' : undefined}
              onClick={() => { expandItem(item.id); onNavigate?.(); }}
              className="flex-1 flex items-center gap-3 pl-3 pr-1 py-2 min-w-0"
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="flex-1 text-left truncate">{t(item.label)}</span>
              {renderBadge(item)}
            </Link>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              className="px-2.5 py-2 flex-shrink-0 text-current"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? t('Collapse submenu') : t('Expand submenu')}
            >
              <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {isExpanded && (
            <div className="ml-[22px] mt-1 mb-1 border-l border-white/10 pl-2.5 space-y-0.5 fade-in">
              {item.children!.map((child) => renderNavItem(child, collapsed, onNavigate, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // Sidebar collapsed: ikon saja. Menu biasa -> tooltip; menu bersubmenu -> flyout berisi anak-anaknya.
    if (collapsed) {
      const live = liveBadges[item.id];
      const childActive = hasChildren && item.children!.some((c) => pathMatches(c.href, currentPath, true));
      const on = active || childActive;
      return (
        <div
          key={item.id}
          className="relative"
          onMouseEnter={(e) => {
            if (hasChildren) openFlyout(item, e.currentTarget);
            else showTip(live ? `${t(item.label)} · ${live.label}` : t(item.label), e.currentTarget);
          }}
          onMouseLeave={() => (hasChildren ? scheduleClose() : setTip(null))}
          onFocus={(e) => { if (hasChildren) openFlyout(item, e.currentTarget); }}
          onBlur={() => { if (hasChildren) scheduleClose(); }}
          onKeyDown={(e) => {
            if (hasChildren && e.key === 'ArrowRight') {
              e.preventDefault();
              openFlyout(item, e.currentTarget);
              window.setTimeout(() => flyoutRef.current?.querySelector<HTMLElement>('a')?.focus(), 30);
            }
          }}
        >
          <Link
            href={item.href || '/'}
            aria-label={t(item.label)}
            aria-current={on ? 'page' : undefined}
            aria-haspopup={hasChildren ? 'menu' : undefined}
            className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all duration-150 ${
              on ? 'nav-item-active' : 'nav-item-inactive'
            }`}
          >
            <Icon size={18} />
          </Link>
          {live && (
            <span
              className={`absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#0E2F26] pointer-events-none ${
                live.severity === 'negative' ? 'bg-rose-400' : 'bg-amber-300'
              }`}
            />
          )}
          {hasChildren && (
            <span className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-white/40 pointer-events-none" aria-hidden />
          )}
        </div>
      );
    }

    // Menu biasa / submenu, sidebar lebar.
    const isSub = depth > 0;
    return (
      <Link
        key={item.id}
        href={item.href || '/'}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-xl font-medium transition-all duration-150 ${
          isSub
            ? `px-2.5 py-1.5 text-[12.5px] ${active ? 'nav-sub-active' : 'nav-item-inactive'}`
            : `px-3 py-2 text-[13px] ${active ? 'nav-item-active' : 'nav-item-inactive'}`
        }`}
      >
        <Icon size={isSub ? 15 : 18} className="flex-shrink-0" />
        <span className="flex-1 truncate">{t(item.label)}</span>
        {renderBadge(item)}
      </Link>
    );
  };

  // Satu isi sidebar dipakai desktop (bisa collapsed) dan drawer mobile (selalu penuh).
  const renderContent = (collapsed: boolean, mobile: boolean) => {
    const onNavigate = mobile ? onMobileClose : undefined;
    return (
      <div className="flex flex-col h-full">
        {/* Header logo -- tinggi 64px sejajar dengan Topbar; garis bawahnya menyambung ke garis Topbar */}
        <div className={`nav-header-line flex items-center h-16 border-b border-white/[0.07] flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'px-4 justify-between'}`}>
          {collapsed ? (
            <BrandMark size={36} />
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <BrandMark size={36} />
              <div className="min-w-0">
                <p className="nav-wordmark">zafeb</p>
                <p className="nav-tagline">{t('Accounting')}</p>
              </div>
            </div>
          )}
          {!collapsed && !mobile && (
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
              aria-label={t('Collapse sidebar')}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {mobile && (
            <button
              onClick={onMobileClose}
              className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-8 h-8 mx-auto mt-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            aria-label={t('Expand sidebar')}
          >
            <ChevronRight size={16} />
          </button>
        )}

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto scrollbar-thin scrollbar-on-dark py-4 px-3 space-y-5">
          {navGroups.map((group, gi) => (
            <div key={`${mobile ? 'm-' : ''}group-${group.label}`}>
              {collapsed ? (
                gi > 0 && <div className="mx-3 mb-3 h-px bg-white/10" />
              ) : (
                <p className="nav-group-label">{t(group.label)}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => renderNavItem(item, collapsed, onNavigate))}
              </div>
            </div>
          ))}
        </nav>

        {/* Settings: permanen di bawah, tidak ikut ter-scroll bersama daftar menu */}
        <div className="border-t border-white/[0.07] p-3 flex-shrink-0">
          {renderNavItem(settingsItem, collapsed, onNavigate)}
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col h-screen sticky top-0 self-start overflow-hidden nav-surface border-r border-white/[0.06] transition-sidebar flex-shrink-0 ${
          collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'
        }`}
      >
        {renderContent(collapsed, false)}
      </aside>

      {/* Tooltip mode collapsed (menu tanpa submenu) */}
      {collapsed && tip && (
        <div
          className="hidden lg:block fixed z-[60] -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-[#0A251D] border border-white/10 text-white text-xs font-medium shadow-card-lg whitespace-nowrap pointer-events-none fade-in"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>
      )}

      {/* Flyout mode collapsed (menu bersubmenu): judul = halaman induk, isi = submenu */}
      {collapsed && flyout && (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={t(flyout.item.label)}
          className="hidden lg:block fixed z-[60] nav-flyout fade-in"
          style={{ top: flyout.top, left: flyout.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onFocus={cancelClose}
          onBlur={scheduleClose}
        >
          <Link
            href={flyout.item.href || '/'}
            onClick={() => setFlyout(null)}
            className="nav-flyout-title"
          >
            {t(flyout.item.label)}
          </Link>
          <div className="space-y-0.5">
            {flyout.item.children!.map((child) => {
              const ChildIcon = child.icon;
              const childOn = pathMatches(child.href, currentPath, true);
              return (
                <Link
                  key={child.id}
                  href={child.href || '/'}
                  role="menuitem"
                  aria-current={childOn ? 'page' : undefined}
                  onClick={() => setFlyout(null)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    childOn ? 'nav-sub-active' : 'nav-item-inactive'
                  }`}
                >
                  <ChildIcon size={15} className="flex-shrink-0" />
                  <span className="flex-1 truncate">{t(child.label)}</span>
                  {renderBadge(child)}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col w-64 nav-surface border-r border-white/[0.06] lg:hidden transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderContent(false, true)}
      </aside>
    </>
  );
}
