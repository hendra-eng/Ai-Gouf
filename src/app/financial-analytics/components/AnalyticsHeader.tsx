'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const COMPARISON_PERIODS = ['Previous Month', 'Budget'];
const BRANCHES = ['All Branches'];

// [BARU] Header sekarang menampilkan nama client aktif & periode data ASLI
// dari useAnalyticsData (sama dengan yang dipakai KPI/chart di bawahnya),
// bukan lagi teks statis generik. Dropdown "Branch" disederhanakan jadi
// "All Branches" saja -- backend tidak punya dimensi cabang/branch per client
// (1 client = 1 entitas), jadi opsi Jakarta HQ/Surabaya/Bandung yang lama
// dihapus supaya tidak terkesan bisa memfilter data padahal tidak ada
// datanya. Dropdown "Comparison" disaring ke opsi yang benar-benar didukung
// data real: "Previous Month" (MoM, dari trial balance bulanan) dan "Budget"
// (dari budgetBridge.ts) -- opsi lain (Previous Quarter/Internal Target)
// dihapus karena tidak ada sumber datanya sama sekali di backend saat ini.
export default function AnalyticsHeader() {
  const { companyName, periodLabel, isSampleData, loading } = useAnalyticsData();
  const [comparison, setComparison] = useState('Previous Month');
  const [branch, setBranch] = useState('All Branches');
  const [showComp, setShowComp] = useState(false);
  const [showBranch, setShowBranch] = useState(false);

  const handleExport = () => {
    toast.success('Export started', {
      description: `Financial analytics report (${branch}, vs ${comparison}) will be downloaded as Excel`,
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-chart-4/10 flex items-center justify-center">
            <Icon name="BeakerIcon" size={18} className="text-chart-4" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Financial Analytics</h1>
          {isSampleData && (
            <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Sample data
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground ml-11">
          {loading ? 'Loading…' : `${companyName} · ${periodLabel}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button
            onClick={() => { setShowBranch(!showBranch); setShowComp(false); }}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="BuildingOffice2Icon" size={14} className="text-muted-foreground" />
            <span>{branch}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showBranch && (
            <div className="absolute right-0 top-full mt-1 w-44 card-elevated py-1 z-50">
              {BRANCHES?.map((b) => (
                <button key={`ab-${b}`} onClick={() => { setBranch(b); setShowBranch(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${b === branch ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}>
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setShowComp(!showComp); setShowBranch(false); }}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="ArrowsRightLeftIcon" size={14} className="text-muted-foreground" />
            <span>vs {comparison}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showComp && (
            <div className="absolute right-0 top-full mt-1 w-48 card-elevated py-1 z-50">
              {COMPARISON_PERIODS?.map((c) => (
                <button key={`ac-${c}`} onClick={() => { setComparison(c); setShowComp(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${c === comparison ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleExport}
          className="flex items-center gap-2 bg-chart-4/10 border border-chart-4/20 text-chart-4 rounded-lg px-4 py-2 text-sm font-medium hover:bg-chart-4/20 transition-colors active:scale-95"
        >
          <Icon name="ArrowDownTrayIcon" size={14} />
          <span className="hidden sm:block">Export</span>
        </button>
      </div>
    </div>
  );
}