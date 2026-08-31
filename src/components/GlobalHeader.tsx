'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';

const companies = [
  'PT Nusantara Teknologi',
  'PT Maju Bersama',
  'CV Karya Digital',
];

const periods = [
  'Jan 2026 – Aug 2026',
  'Jan 2025 – Dec 2025',
  'Jan 2025 – Aug 2025',
  'Q2 2026',
  'Q1 2026',
];

interface GlobalHeaderProps {
  sidebarCollapsed: boolean;
}

export default function GlobalHeader({ sidebarCollapsed }: GlobalHeaderProps) {
  const [company, setCompany] = useState(companies[0]);
  const [period, setPeriod] = useState(periods[0]);
  const [showCompanyDrop, setShowCompanyDrop] = useState(false);
  const [showPeriodDrop, setShowPeriodDrop] = useState(false);

  return (
    <header
      className={`fixed top-0 right-0 h-[52px] bg-card border-b border-border z-20 flex items-center px-4 gap-3 transition-all duration-300 ${sidebarCollapsed ? 'left-16' : 'left-[220px]'}`}
    >
      {/* Search */}
      <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 text-[13px] text-muted-foreground w-52 cursor-pointer hover:border-primary/50 transition-colors">
        <Icon name="MagnifyingGlassIcon" size={14} />
        <span>Search transaction</span>
        <span className="ml-auto text-[11px] bg-border rounded px-1 py-0.5">⌘K</span>
      </div>

      <div className="flex-1" />

      {/* Company Selector */}
      <div className="relative">
        <button
          onClick={() => { setShowCompanyDrop(!showCompanyDrop); setShowPeriodDrop(false); }}
          className="flex items-center gap-1.5 bg-muted border border-border rounded-md px-3 py-1.5 text-[12px] font-500 text-foreground hover:border-primary/50 transition-colors"
        >
          <Icon name="BuildingOffice2Icon" size={13} className="text-muted-foreground" />
          <span className="max-w-[140px] truncate">{company}</span>
          <Icon name="ChevronDownIcon" size={11} className="text-muted-foreground" />
        </button>
        {showCompanyDrop && (
          <div className="absolute right-0 top-full mt-1 w-52 fin-card py-1 z-50">
            {companies.map(c => (
              <button
                key={`company-${c}`}
                onClick={() => { setCompany(c); setShowCompanyDrop(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-muted transition-colors ${c === company ? 'text-primary font-600' : 'text-foreground'}`}
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
          onClick={() => { setShowPeriodDrop(!showPeriodDrop); setShowCompanyDrop(false); }}
          className="flex items-center gap-1.5 bg-muted border border-border rounded-md px-3 py-1.5 text-[12px] font-500 text-foreground hover:border-primary/50 transition-colors"
        >
          <Icon name="CalendarIcon" size={13} className="text-muted-foreground" />
          <span>{period}</span>
          <Icon name="ChevronDownIcon" size={11} className="text-muted-foreground" />
        </button>
        {showPeriodDrop && (
          <div className="absolute right-0 top-full mt-1 w-52 fin-card py-1 z-50">
            {periods.map(p => (
              <button
                key={`period-${p}`}
                onClick={() => { setPeriod(p); setShowPeriodDrop(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-muted transition-colors ${p === period ? 'text-primary font-600' : 'text-foreground'}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Ask AI */}
      <button className="flex items-center gap-1.5 bg-ai-subtle border border-accent/20 rounded-md px-3 py-1.5 text-[12px] font-500 text-ai hover:bg-accent/10 transition-colors">
        <Icon name="SparklesIcon" size={13} />
        Ask AI
      </button>

      {/* Help */}
      <button className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
        <Icon name="QuestionMarkCircleIcon" size={16} className="text-muted-foreground" />
      </button>

      {/* Notifications */}
      <button className="relative w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
        <Icon name="BellIcon" size={16} className="text-muted-foreground" />
        <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-negative rounded-full text-white text-[8px] flex items-center justify-center font-600">5</span>
      </button>

      {/* User */}
      <div className="flex items-center gap-2 pl-2 border-l border-border">
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-600">RW</div>
        <div className="hidden lg:block">
          <div className="text-[12px] font-600 text-foreground leading-tight">Rizky Wardana</div>
          <div className="text-[10px] text-muted-foreground">Finance Manager</div>
        </div>
      </div>
    </header>
  );
}
