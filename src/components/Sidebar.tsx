'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import { LayoutDashboard, FileText, ArrowLeftRight, CreditCard, Package, TrendingUp, Calculator, Brain, ClipboardCheck, FolderOpen, Building2, BarChart3, Settings, LogOut, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, DollarSign, Scale, Activity, Wallet, ShieldCheck, X, Bot, ShoppingCart, ArrowUpCircle, MoreHorizontal, Shield, RefreshCcw, NotebookText } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  currentPath?: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href?: string;
  badge?: string;
  badgeVariant?: 'positive' | 'negative' | 'warning' | 'info' | 'ai';
  children?: NavItem[];
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'nav-overview', label: 'Overview', icon: LayoutDashboard, href: '/' },
      { id: 'nav-agent-ai', label: 'Agent AI', icon: Bot, href: '/agent-ai', badge: 'AI', badgeVariant: 'ai' },
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
        ],
      },
      {
        id: 'nav-transactions', label: 'Transactions', icon: ArrowLeftRight, href: '/transactions', badge: '248',
        children: [
          { id: 'nav-tx-sales', label: 'Sales', icon: ShoppingCart, href: '/transactions/sales' },
          { id: 'nav-tx-expense', label: 'Expense', icon: CreditCard, href: '/transactions/expense' },
          { id: 'nav-tx-cash-payment', label: 'Cash Payment', icon: ArrowUpCircle, href: '/transactions/cash-payment' },
          { id: 'nav-tx-cash-reserve', label: 'Cash Reserve', icon: Shield, href: '/transactions/cash-reserve' },
          { id: 'nav-tx-other', label: 'Other', icon: MoreHorizontal, href: '/transactions/other' },
        ],
      },
      { id: 'nav-ar', label: 'Accounts Receivable', icon: DollarSign, href: '/accounts-receivable', badge: '3', badgeVariant: 'warning' },
      { id: 'nav-ap', label: 'Accounts Payable', icon: CreditCard, href: '/accounts-payable' },
    ],
  },
  {
    label: 'Assets & Equity',
    items: [
      { id: 'nav-assets', label: 'Assets', icon: Package, href: '/assets' },
      { id: 'nav-liabilities', label: 'Liabilities', icon: Wallet, href: '/liabilities' },
      { id: 'nav-equity', label: 'Equity', icon: Scale, href: '/equity' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { id: 'nav-budget', label: 'Budget & Forecast', icon: Calculator, href: '/budget-forecast' },
      { id: 'nav-tax', label: 'Tax & Compliance', icon: ShieldCheck, href: '/tax-compliance', badge: '2', badgeVariant: 'negative' },
      { id: 'nav-analytics', label: 'Financial Analytics', icon: BarChart3, href: '/financial-analytics' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'nav-ai', label: 'AI Financial Analyst', icon: Brain, href: '/ai-financial-analyst', badge: 'AI', badgeVariant: 'ai' },
      { id: 'nav-audit', label: 'Audit', icon: ClipboardCheck, href: '/audit' },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'nav-reports', label: 'Reports', icon: BarChart3, href: '/reports' },
      { id: 'nav-clients', label: 'Clients', icon: Building2, href: '/clients' },
      { id: 'nav-documents', label: 'Documents', icon: FolderOpen, href: '/documents' },
    ],
  },
];

function getBadgeClasses(variant?: string) {
  switch (variant) {
    case 'positive': return 'bg-positive-subtle text-positive';
    case 'negative': return 'bg-negative-subtle text-negative';
    case 'warning': return 'bg-warning-subtle text-warning';
    case 'ai': return 'bg-ai-subtle text-ai';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default function Sidebar({ collapsed, onToggle, currentPath = '', mobileOpen, onMobileClose }: SidebarProps) {
  const router = useRouter();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const goToSettings = () => router.push('/settings');

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('gouf_auth');
    }
    router.push('/');
  };

  useEffect(() => {
    navGroups.forEach((group) => {
      group.items.forEach((item) => {
        const isOnParent = item.href === currentPath;
        const isOnChild = item.children?.some((child) => child.href === currentPath);
        if (item.children && (isOnParent || isOnChild)) {
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

  const isActive = (href?: string) => href === currentPath || (href === '/' && currentPath === '/');

  const renderNavItem = (item: NavItem, depth = 0) => {
    const active = isActive(item.href);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const Icon = item.icon;

    if (hasChildren && !collapsed) {
      return (
        <div key={item.id}>
          <div
            className={`flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
              active ? 'nav-item-active' : 'nav-item-inactive'
            }`}
          >
            <Link
              href={item.href || '/'}
              onClick={() => expandItem(item.id)}
              className="flex-1 flex items-center gap-3 px-3 py-2 min-w-0"
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="flex-1 text-left truncate">{item.label}</span>
              {item.badge && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${getBadgeClasses(item.badgeVariant)}`}>
                  {item.badge}
                </span>
              )}
            </Link>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              className="px-2.5 py-2 flex-shrink-0 text-current"
              aria-label={isExpanded ? 'Collapse submenu' : 'Expand submenu'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {isExpanded && (
            <div className="ml-4 mt-0.5 border-l border-border pl-3 space-y-0.5">
              {item.children!.map((child) => renderNavItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    if (collapsed) {
      return (
        <div key={item.id} className="relative group">
          <Link
            href={item.href || '/'}
            className={`flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-all duration-150 ${
              active ? 'nav-item-active' : 'nav-item-inactive'
            }`}
          >
            <Icon size={18} />
          </Link>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-foreground text-background text-xs font-medium rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
            {item.label}
          </div>
        </div>
      );
    }

    return (
      <Link
        key={item.id}
        href={item.href || '/'}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
          active ? 'nav-item-active' : 'nav-item-inactive'
        } ${depth > 0 ? 'text-xs' : ''}`}
      >
        <Icon size={depth > 0 ? 15 : 18} className="flex-shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${getBadgeClasses(item.badgeVariant)}`}>
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className={`flex items-center h-16 border-b border-border flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'px-4 justify-between'}`}>
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <AppLogo size={32} />
            <div>
              <span className="font-bold text-sm text-foreground tracking-tight">Gouf Consulting</span>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Accounting</p>
            </div>
          </div>
        )}
        {collapsed && <AppLogo size={32} />}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-8 h-8 mx-auto mt-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-4">
        {navGroups.map((group) => (
          <div key={`group-${group.label}`}>
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 mb-1.5">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => renderNavItem(item))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-border p-3 flex-shrink-0 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
        {!collapsed ? (
          <>
            <div
              onClick={goToSettings}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer mb-1"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">RW</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">Rizky Wardana</p>
                <p className="text-xs text-muted-foreground truncate">Finance Manager</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={goToSettings}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-negative-subtle hover:text-negative transition-colors"
              >
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">RW</span>
            </div>
            <button onClick={goToSettings} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" aria-label="Settings">
              <Settings size={16} />
            </button>
            <button onClick={handleLogout} className="p-1.5 rounded-lg hover:bg-negative-subtle text-muted-foreground hover:text-negative transition-colors" aria-label="Logout">
              <LogOut size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col h-screen sticky top-0 self-start overflow-hidden bg-card border-r border-border transition-sidebar flex-shrink-0 ${
          collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'
        }`}
      >
        {sidebarContent}
      </aside>

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-card border-r border-border lg:hidden transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <AppLogo size={32} />
            <span className="font-bold text-sm text-foreground">Gouf Consulting</span>
          </div>
          <button onClick={onMobileClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <X size={16} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-4">
          {navGroups.map((group) => (
            <div key={`mobile-group-${group.label}`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`mobile-${item.id}`}
                      href={item.href || '/'}
                      onClick={onMobileClose}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        active ? 'nav-item-active' : 'nav-item-inactive'
                      }`}
                    >
                      <Icon size={18} className="flex-shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${getBadgeClasses(item.badgeVariant)}`}>
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}