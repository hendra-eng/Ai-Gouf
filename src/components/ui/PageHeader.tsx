'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';

interface FilterOption {
  key: string;
  label: string;
  options: string[];
  defaultValue?: string;
}

const viewOptions = ['Actual', 'Budget', 'Previous Year'] as const;

interface PageHeaderProps {
  title: string;
  subtitle: string;
  period: string;
  periodOptions: string[];
  filters?: FilterOption[];
  actions?: React.ReactNode;
  /** Dipanggil saat tombol Export ditekan. Kalau tidak diisi, fallback ke window.print(). */
  onExport?: () => void;
  /** Dipanggil saat tombol refresh ditekan. Kalau tidak diisi, fallback ke router.refresh(). */
  onRefresh?: () => void;
  /** Dipanggil saat toggle Actual/Budget/Previous Year berubah. */
  onViewChange?: (view: (typeof viewOptions)[number]) => void;
}

export default function PageHeader({ title, subtitle, period, periodOptions, filters = [], actions, onExport, onRefresh, onViewChange }: PageHeaderProps) {
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState(period);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    Object.fromEntries(filters.map(f => [f.key, f.defaultValue ?? f.options[0]]))
  );
  const [showPeriodDrop, setShowPeriodDrop] = useState(false);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<(typeof viewOptions)[number]>('Actual');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      window.print();
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    if (onRefresh) {
      onRefresh();
    } else {
      router.refresh();
    }
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleViewChange = (view: (typeof viewOptions)[number]) => {
    setSelectedView(view);
    onViewChange?.(view);
  };

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] font-600 text-primary bg-blue-50 px-2 py-0.5 rounded">{selectedPeriod}</span>
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded">YTD</span>
            <span className="text-[11px] text-muted-foreground">Last updated: 26 Aug 2026, 00:39 WIB</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {actions}
          <button onClick={handleExport} className="fin-btn-secondary flex items-center gap-1.5">
            <Icon name="ArrowDownTrayIcon" size={13} />
            Export
          </button>
          <button onClick={handleRefresh} className="p-1.5 rounded hover:bg-muted transition-colors" aria-label="Refresh">
            <Icon name="ArrowPathIcon" size={14} className={`text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Period filter */}
        <div className="relative">
          <button
            onClick={() => { setShowPeriodDrop(!showPeriodDrop); setOpenFilter(null); }}
            className="flex items-center gap-1.5 bg-card border border-border rounded-md px-3 py-1.5 text-[12px] font-500 text-foreground hover:border-primary/50 transition-colors"
          >
            <Icon name="CalendarIcon" size={13} className="text-muted-foreground" />
            {selectedPeriod}
            <Icon name="ChevronDownIcon" size={11} className="text-muted-foreground" />
          </button>
          {showPeriodDrop && (
            <div className="absolute top-full mt-1 left-0 w-52 fin-card py-1 z-50">
              {periodOptions.map(p => (
                <button
                  key={`period-opt-${p}`}
                  onClick={() => { setSelectedPeriod(p); setShowPeriodDrop(false); }}
                  className={`w-full text-left px-3 py-2 text-[12px] hover:bg-muted transition-colors ${p === selectedPeriod ? 'text-primary font-600' : 'text-foreground'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {filters.map(f => (
          <div key={`filter-${f.key}`} className="relative">
            <button
              onClick={() => { setOpenFilter(openFilter === f.key ? null : f.key); setShowPeriodDrop(false); }}
              className="flex items-center gap-1.5 bg-card border border-border rounded-md px-3 py-1.5 text-[12px] font-500 text-foreground hover:border-primary/50 transition-colors"
            >
              {filterValues[f.key]}
              <Icon name="ChevronDownIcon" size={11} className="text-muted-foreground" />
            </button>
            {openFilter === f.key && (
              <div className="absolute top-full mt-1 left-0 w-44 fin-card py-1 z-50">
                {f.options.map(opt => (
                  <button
                    key={`filter-opt-${f.key}-${opt}`}
                    onClick={() => { setFilterValues(prev => ({ ...prev, [f.key]: opt })); setOpenFilter(null); }}
                    className={`w-full text-left px-3 py-2 text-[12px] hover:bg-muted transition-colors ${filterValues[f.key] === opt ? 'text-primary font-600' : 'text-foreground'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* View toggles */}
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 ml-auto">
          {viewOptions.map(v => (
            <button
              key={`view-${v}`}
              onClick={() => handleViewChange(v)}
              className={`px-3 py-1 text-[11px] font-500 rounded transition-colors ${v === selectedView ? 'bg-card text-foreground card-shadow' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
