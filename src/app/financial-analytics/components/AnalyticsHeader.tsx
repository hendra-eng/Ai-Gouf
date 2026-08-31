'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';

const COMPARISON_PERIODS = ['Previous Month', 'Previous Quarter', 'Previous Year', 'Budget', 'Internal Target'];
const BRANCHES = ['All Branches', 'Jakarta HQ', 'Surabaya', 'Bandung'];

export default function AnalyticsHeader() {
  const [comparison, setComparison] = useState('Previous Year');
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
          <h1 className="text-3xl font-700 text-foreground">Financial Analytics</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-11">
          Explore financial performance, ratios, trends, efficiency, liquidity, and business drivers
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
