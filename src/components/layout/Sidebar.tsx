'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  HomeIcon,
  SparklesIcon,
  DocumentTextIcon,
  CreditCardIcon,
  BuildingLibraryIcon,
  ScaleIcon,
  ChartBarIcon,
  CalculatorIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ClipboardDocumentListIcon,
  CubeIcon,
  ShieldCheckIcon,
  BeakerIcon,
  DocumentChartBarIcon,
  UsersIcon,
  FolderIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import Icon from '@/components/ui/AppIcon';


interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  children?: NavItem[];
}

const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: 'OVERVIEW',
    items: [
      { label: 'Overview', href: '/', icon: HomeIcon },
      { label: 'Agent AI', href: '/agent-ai', icon: SparklesIcon },
    ],
  },
  {
    group: 'FINANCIAL',
    items: [
      {
        label: 'Financial Statements',
        icon: DocumentTextIcon,
        children: [
          { label: 'Profit & Loss', href: '/financial-statements/profit-loss', icon: ArrowTrendingUpIcon },
          { label: 'Balance Sheet', href: '/financial-statements/balance-sheet', icon: ScaleIcon },
          { label: 'Cash Flow', href: '/financial-statements/cash-flow', icon: BanknotesIcon },
        ],
      },
      { label: 'Transactions', href: '/transactions', icon: CreditCardIcon, badge: 248 },
      { label: 'Accounts Receivable', href: '/accounts-receivable', icon: ClipboardDocumentListIcon, badge: 3 },
      { label: 'Accounts Payable', href: '/accounts-payable', icon: BuildingLibraryIcon },
    ],
  },
  {
    group: 'ASSETS & EQUITY',
    items: [
      { label: 'Assets', href: '/assets', icon: CubeIcon },
      { label: 'Liabilities', href: '/liabilities', icon: ScaleIcon },
      { label: 'Equity', href: '/equity', icon: ChartBarIcon },
    ],
  },
  {
    group: 'PLANNING',
    items: [
      { label: 'Budget & Forecast', href: '/budget-forecast', icon: CalculatorIcon },
      { label: 'Tax & Compliance', href: '/tax-compliance', icon: ShieldCheckIcon },
      { label: 'Financial Analytics', href: '/financial-analytics', icon: BeakerIcon },
    ],
  },
  {
    group: 'MANAGEMENT',
    items: [
      { label: 'Reports', href: '/reports', icon: DocumentChartBarIcon },
      { label: 'Clients', href: '/clients', icon: UsersIcon },
      { label: 'Documents', href: '/documents', icon: FolderIcon },
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      { label: 'AI Financial Analytics', href: '/ai-analytics', icon: SparklesIcon },
      { label: 'Audit', href: '/audit', icon: MagnifyingGlassIcon },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Financial Statements': true,
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = () => {
    setUserMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('gouf_auth');
    }
    router.push('/');
  };

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const isActive = (href?: string) => href && pathname === href;
  const isChildActive = (children?: NavItem[]) =>
    children?.some(c => c.href && pathname.startsWith(c.href));

  return (
    <aside className="w-64 min-h-screen bg-slate-900 flex flex-col border-r border-slate-800 flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">F</span>
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Finova AI</div>
            <div className="text-slate-400 text-xs">Accounting</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {NAV_GROUPS.map(({ group, items }) => (
          <div key={group} className="mb-5">
            <div className="text-slate-500 text-[10px] font-semibold tracking-widest px-2 mb-2 uppercase">
              {group}
            </div>
            {items.map(item => {
              const Icon = item.icon;
              const hasChildren = item.children && item.children.length > 0;
              const expanded = expandedGroups[item.label];
              const childActive = isChildActive(item.children);

              if (hasChildren) {
                return (
                  <div key={item.label}>
                    <button
                      onClick={() => toggleGroup(item.label)}
                      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors duration-150 mb-0.5 ${
                        childActive
                          ? 'text-teal-400 bg-teal-500/10' :'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1 text-left font-medium">{item.label}</span>
                      {expanded ? (
                        <ChevronDownIcon className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRightIcon className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {expanded && (
                      <div className="ml-4 pl-2 border-l border-slate-700 mb-1">
                        {item.children!.map(child => {
                          const ChildIcon = child.icon;
                          const active = isActive(child.href);
                          return (
                            <Link
                              key={child.label}
                              href={child.href!}
                              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors duration-150 mb-0.5 ${
                                active
                                  ? 'text-teal-400 bg-teal-500/10 font-medium' :'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                              }`}
                            >
                              <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const active = isActive(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href!}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors duration-150 mb-0.5 ${
                    active
                      ? 'text-teal-400 bg-teal-500/10 font-medium' :'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-teal-500/20 text-teal-400' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-800 relative">
        <div
          onClick={() => setUserMenuOpen((p) => !p)}
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-semibold">RW</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-slate-200 text-xs font-medium truncate">Rizky Wardana</div>
            <div className="text-slate-500 text-[10px] truncate">Finance Manager</div>
          </div>
        </div>
        {userMenuOpen && (
          <div className="absolute left-3 right-3 bottom-full mb-1 bg-slate-900 border border-slate-800 rounded-xl shadow-lg z-50 py-1">
            <button
              onClick={() => { router.push('/settings'); setUserMenuOpen(false); }}
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <Cog6ToothIcon className="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-red-400 hover:bg-slate-800 transition-colors"
            >
              <ArrowRightOnRectangleIcon className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}