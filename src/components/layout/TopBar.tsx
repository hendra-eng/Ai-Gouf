'use client';

import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const [dateRange] = useState('Jan 2026 – Aug 2026');

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-border sticky top-0 z-20">
      <div>
        <h1 className="text-lg font-bold text-text-primary">{title}</h1>
        {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {/* Date Range */}
        <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-white text-text-secondary hover:bg-surface-secondary transition-colors">
          <Icon name="CalendarIcon" size={15} />
          <span>{dateRange}</span>
          <Icon name="ChevronDownIcon" size={13} />
        </button>
        {/* Currency */}
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-white text-text-secondary hover:bg-surface-secondary transition-colors">
          <span className="font-semibold text-teal-600">IDR</span>
          <Icon name="ChevronDownIcon" size={13} />
        </button>
        {/* Ask AI */}
        <button className="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg text-white transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}>
          <Icon name="SparklesIcon" size={15} />
          Ask AI
        </button>
        {/* Notifications */}
        <button className="relative p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-secondary">
          <Icon name="BellIcon" size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
        </button>
      </div>
    </header>
  );
}
