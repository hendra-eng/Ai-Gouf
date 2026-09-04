'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useBudgetData } from '../lib/budgetBridge';

const SCENARIOS = ['Base Case', 'Optimistic', 'Conservative'];
const VIEWS = ['Actual', 'Budget', 'Forecast'];
const BRANCHES = ['All Branches', 'Jakarta HQ', 'Surabaya', 'Bandung'];

export default function BudgetHeader() {
  const { periodLabel } = useBudgetData();
  const [scenario, setScenario] = useState('Base Case');
  const [view, setView] = useState('Actual');
  const [branch, setBranch] = useState('All Branches');
  const [showScenario, setShowScenario] = useState(false);
  const [showBranch, setShowBranch] = useState(false);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon name="PresentationChartLineIcon" size={18} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Budget &amp; Forecast</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
            FY 2026
          </span>
        </div>
        <p className="text-sm text-muted-foreground ml-11">
          Plan financial performance, monitor budget variance, and forecast future results
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Branch selector */}
        <div className="relative">
          <button
            onClick={() => setShowBranch(!showBranch)}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="BuildingOffice2Icon" size={14} className="text-muted-foreground" />
            <span>{branch}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showBranch && (
            <div className="absolute right-0 top-full mt-1 w-44 card-elevated py-1 z-50">
              {BRANCHES?.map((b) => (
                <button
                  key={`branch-${b}`}
                  onClick={() => { setBranch(b); setShowBranch(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${b === branch ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scenario */}
        <div className="relative">
          <button
            onClick={() => setShowScenario(!showScenario)}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="AdjustmentsHorizontalIcon" size={14} className="text-muted-foreground" />
            <span>{scenario}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showScenario && (
            <div className="absolute right-0 top-full mt-1 w-44 card-elevated py-1 z-50">
              {SCENARIOS?.map((s) => (
                <button
                  key={`scenario-${s}`}
                  onClick={() => { setScenario(s); setShowScenario(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${s === scenario ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {VIEWS?.map((v) => (
            <button
              key={`view-${v}`}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
                v === view ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <button
          onClick={() => toast.success('Export dimulai', { description: `Rencana anggaran (${scenario}, ${view}) akan diunduh` })}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors active:scale-95"
        >
          <Icon name="ArrowDownTrayIcon" size={14} />
          <span className="hidden sm:block">Export Plan</span>
        </button>
      </div>
    </div>
  );
}
