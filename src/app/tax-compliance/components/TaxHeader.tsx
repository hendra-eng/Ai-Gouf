'use client';
import React, { useMemo, useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { useTaxComplianceData } from '../lib/taxBridge';

const TAX_TYPES = ['All Types', 'PPN', 'PPh 21', 'PPh 23', 'PPh 25', 'PPh 29'];
const STATUSES = ['All Status', 'Draft', 'Calculated', 'Ready to File', 'Filed', 'Paid', 'Due Soon', 'Overdue'];

export default function TaxHeader() {
  const { obligations, statusCounts } = useTaxComplianceData();
  const isCompliant = statusCounts.overdue === 0;

  // Daftar periode diambil dari periode yang benar-benar ada di obligasi
  // (real), jatuh ke default kalau belum ada data sama sekali.
  const PERIODS = useMemo(() => {
    const unique = Array.from(new Set(obligations.map((o) => o.period)));
    return unique.length > 0 ? unique.slice(0, 6) : ['No data yet'];
  }, [obligations]);

  const [taxType, setTaxType] = useState('All Types');
  const [status, setStatus] = useState('All Status');
  const [period, setPeriod] = useState(PERIODS[0]);
  const [showType, setShowType] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showPeriod, setShowPeriod] = useState(false);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-chart-3/10 flex items-center justify-center">
            <Icon name="DocumentCheckIcon" size={18} className="text-chart-3" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Tax &amp; Compliance</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border flex items-center gap-1 ${isCompliant ? 'bg-positive-subtle text-positive border-positive/20' : 'bg-negative-subtle text-negative border-negative/20'}`}>
            <Icon name="ShieldCheckIcon" size={11} />
            {isCompliant ? 'Compliant' : 'Needs Attention'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground ml-11">
          Monitor tax obligations, filing deadlines, compliance status, and tax exposure
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Period */}
        <div className="relative">
          <button
            onClick={() => { setShowPeriod(!showPeriod); setShowType(false); setShowStatus(false); }}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="CalendarDaysIcon" size={14} className="text-muted-foreground" />
            <span>{period}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showPeriod && (
            <div className="absolute right-0 top-full mt-1 w-36 card-elevated py-1 z-50">
              {PERIODS?.map((p) => (
                <button key={`tp-${p}`} onClick={() => { setPeriod(p); setShowPeriod(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${p === period ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tax Type */}
        <div className="relative">
          <button
            onClick={() => { setShowType(!showType); setShowPeriod(false); setShowStatus(false); }}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <span>{taxType}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showType && (
            <div className="absolute right-0 top-full mt-1 w-36 card-elevated py-1 z-50">
              {TAX_TYPES?.map((t) => (
                <button key={`tt-${t}`} onClick={() => { setTaxType(t); setShowType(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${t === taxType ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status */}
        <div className="relative">
          <button
            onClick={() => { setShowStatus(!showStatus); setShowPeriod(false); setShowType(false); }}
            className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <span>{status}</span>
            <Icon name="ChevronDownIcon" size={12} className="text-muted-foreground" />
          </button>
          {showStatus && (
            <div className="absolute right-0 top-full mt-1 w-40 card-elevated py-1 z-50">
              {STATUSES?.map((s) => (
                <button key={`ts-${s}`} onClick={() => { setStatus(s); setShowStatus(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${s === status ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-muted'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-chart-3/10 border border-chart-3/20 text-chart-3 rounded-lg px-4 py-2 text-sm font-medium hover:bg-chart-3/20 transition-colors active:scale-95"
        >
          <Icon name="ArrowDownTrayIcon" size={14} />
          <span className="hidden sm:block">Export</span>
        </button>
      </div>
    </div>
  );
}
