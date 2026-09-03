'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const INITIAL_DEADLINES = [
  { id: 'dl-pph21-aug', taxType: 'PPh 21', description: 'Employee income tax withholding — Aug 2026', dueDate: 'Sep 10, 2026', daysUntil: 15, amount: 38_400_000, status: 'Due Soon', filed: false, paid: false },
  { id: 'dl-pph23-aug', taxType: 'PPh 23', description: 'Withholding tax on services — Aug 2026', dueDate: 'Sep 10, 2026', daysUntil: 15, amount: 12_800_000, status: 'Due Soon', filed: false, paid: false },
  { id: 'dl-ppn-aug', taxType: 'PPN Masa', description: 'Monthly VAT return — Aug 2026', dueDate: 'Sep 30, 2026', daysUntil: 35, amount: 94_200_000, status: 'Upcoming', filed: false, paid: false },
  { id: 'dl-pph25-sep', taxType: 'PPh 25', description: 'Corporate income tax installment — Sep 2026', dueDate: 'Sep 15, 2026', daysUntil: 20, amount: 36_600_000, status: 'Upcoming', filed: false, paid: false },
  { id: 'dl-ppn-sep', taxType: 'PPN Masa', description: 'Monthly VAT return — Sep 2026', dueDate: 'Oct 31, 2026', daysUntil: 66, amount: 96_400_000, status: 'Upcoming', filed: false, paid: false },
  { id: 'dl-pph21-sep', taxType: 'PPh 21', description: 'Employee income tax withholding — Sep 2026', dueDate: 'Oct 10, 2026', daysUntil: 45, amount: 39_200_000, status: 'Upcoming', filed: false, paid: false },
  { id: 'dl-spt-tahunan', taxType: 'SPT Tahunan', description: 'Annual corporate tax return — FY 2025', dueDate: 'Apr 30, 2027', daysUntil: 247, amount: 0, status: 'Compliant', filed: true, paid: true },
];

const STATUS_CONFIG: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  'Due Soon': { color: 'text-warning', bg: 'bg-warning-subtle border-warning/20', dot: 'bg-warning', label: 'Due Soon' },
  'Upcoming': { color: 'text-info', bg: 'bg-info-subtle border-info/20', dot: 'bg-info', label: 'Upcoming' },
  'Compliant': { color: 'text-positive', bg: 'bg-positive-subtle border-positive/20', dot: 'bg-positive', label: 'Filed & Paid' },
  'Overdue': { color: 'text-negative', bg: 'bg-negative-subtle border-negative/20', dot: 'bg-negative', label: 'Overdue' },
};

export default function TaxDeadlineTimeline() {
  const { fx } = useCurrency();
  const [deadlines, setDeadlines] = useState(INITIAL_DEADLINES);

  const goToCalendar = () => {
    document.getElementById('tax-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToObligation = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fileNow = (id: string) => {
    setDeadlines((prev) => prev.map((d) => (d.id === id ? { ...d, filed: true, status: 'Compliant' } : d)));
  };

  return (
    <div className="card-base p-5 h-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Upcoming Tax Deadlines</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Next 90 days · Aug 26, 2026</p>
        </div>
        <button onClick={goToCalendar} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted">
          <Icon name="CalendarDaysIcon" size={14} />
          View Calendar
        </button>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />

        <div className="space-y-3">
          {deadlines.map((dl) => {
            const cfg = STATUS_CONFIG[dl.status] || STATUS_CONFIG['Upcoming'];
            return (
              <div key={dl.id} onClick={goToObligation} className="flex items-start gap-4 group cursor-pointer">
                {/* Timeline dot */}
                <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                  dl.status === 'Due Soon' ? 'border-warning bg-warning/10' :
                  dl.status === 'Overdue' ? 'border-negative bg-negative/10' :
                  dl.status === 'Compliant'? 'border-positive bg-positive/10' : 'border-info bg-info/10'
                }`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                </div>

                {/* Content */}
                <div className={`flex-1 rounded-xl border p-3 transition-all duration-150 group-hover:border-primary/30 ${cfg.bg}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{dl.taxType}</span>
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                        {dl.status === 'Compliant' ? 'Filed & Paid' : `${dl.daysUntil}d`}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground flex-shrink-0">{dl.dueDate}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{dl.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {dl.amount > 0 ? fx(formatIDR(dl.amount, true)) : '—'}
                    </span>
                    <div className="flex items-center gap-2">
                      {dl.filed && <span className="text-2xs text-positive flex items-center gap-1"><Icon name="CheckIcon" size={11} />Filed</span>}
                      {dl.paid && <span className="text-2xs text-positive flex items-center gap-1"><Icon name="CheckIcon" size={11} />Paid</span>}
                      {!dl.filed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); fileNow(dl.id); }}
                          className="text-2xs font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"
                        >
                          File Now →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
