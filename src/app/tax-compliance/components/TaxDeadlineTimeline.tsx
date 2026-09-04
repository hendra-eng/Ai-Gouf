'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData } from '../lib/taxBridge';

const STATUS_CONFIG: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  'Due Soon': { color: 'text-warning', bg: 'bg-warning-subtle border-warning/20', dot: 'bg-warning', label: 'Due Soon' },
  'Calculated': { color: 'text-info', bg: 'bg-info-subtle border-info/20', dot: 'bg-info', label: 'Upcoming' },
  'Draft': { color: 'text-info', bg: 'bg-info-subtle border-info/20', dot: 'bg-info', label: 'Upcoming' },
  'Paid': { color: 'text-positive', bg: 'bg-positive-subtle border-positive/20', dot: 'bg-positive', label: 'Filed & Paid' },
  'Filed': { color: 'text-positive', bg: 'bg-positive-subtle border-positive/20', dot: 'bg-positive', label: 'Filed & Paid' },
  'Overdue': { color: 'text-negative', bg: 'bg-negative-subtle border-negative/20', dot: 'bg-negative', label: 'Overdue' },
};

export default function TaxDeadlineTimeline() {
  const { fx } = useCurrency();
  const { obligations, referenceDate } = useTaxComplianceData();

  // Deadline mendatang: obligasi yang belum lunas, dalam 90 hari ke depan (atau semua yang overdue),
  // diurutkan berdasarkan tanggal jatuh tempo paling dekat.
  const deadlines = obligations
    .filter((o) => o.status !== 'Paid' && o.daysUntilDue <= 90)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, 8);

  const goToCalendar = () => {
    document.getElementById('tax-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToObligation = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="card-base p-5 h-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Upcoming Tax Deadlines</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Next 90 days · {referenceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <button onClick={goToCalendar} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted">
          <Icon name="CalendarDaysIcon" size={14} />
          View Calendar
        </button>
      </div>

      {deadlines.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No upcoming tax deadlines in the next 90 days.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />
          <div className="space-y-3">
            {deadlines.map((dl) => {
              const cfg = STATUS_CONFIG[dl.status] || STATUS_CONFIG['Calculated'];
              return (
                <div key={dl.id} onClick={goToObligation} className="flex items-start gap-4 group cursor-pointer">
                  <div className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                    dl.status === 'Due Soon' ? 'border-warning bg-warning/10' :
                    dl.status === 'Overdue' ? 'border-negative bg-negative/10' :
                    dl.status === 'Paid' || dl.status === 'Filed' ? 'border-positive bg-positive/10' : 'border-info bg-info/10'
                  }`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                  </div>

                  <div className={`flex-1 rounded-xl border p-3 transition-all duration-150 group-hover:border-primary/30 ${cfg.bg}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{dl.taxType}</span>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                          {dl.daysUntilDue < 0 ? `${Math.abs(dl.daysUntilDue)}d overdue` : `${dl.daysUntilDue}d`}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground flex-shrink-0">{dl.dueDateLabel}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{dl.period} obligation, {dl.reference}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {dl.taxAmount > 0 ? fx(formatIDR(dl.taxAmount, true)) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
