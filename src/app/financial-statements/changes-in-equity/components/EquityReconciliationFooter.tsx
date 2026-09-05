import React from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export default function EquityReconciliationFooter() {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-5">
        {/* Reconciliation equation */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-primary" />
            <h2 className="text-[14px] font-bold text-foreground">Equity Reconciliation</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
            <div className="flex flex-col items-center p-3 rounded-lg bg-muted/60 border border-border min-w-[110px]">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Opening Equity</span>
              <span className="text-[15px] font-bold text-foreground tabular-nums">$8,420,000</span>
            </div>
            <span className="text-xl font-light text-muted-foreground">+</span>
            <div className="flex flex-col items-center p-3 rounded-lg bg-muted/60 border border-border min-w-[110px]">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Total Movements</span>
              <span className="text-[15px] font-bold text-positive tabular-nums">+$2,085,000</span>
            </div>
            <span className="text-xl font-light text-muted-foreground">=</span>
            <div className="flex flex-col items-center p-3 rounded-lg bg-primary/5 border border-primary/20 min-w-[110px]">
              <span className="text-[9px] text-primary uppercase tracking-wide mb-1 font-semibold">Closing Equity</span>
              <span className="text-[15px] font-bold text-primary tabular-nums">$10,505,000</span>
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-col gap-2 lg:border-l lg:border-border lg:pl-5">
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--positive-bg)] border border-[var(--positive-light)]">
            <CheckCircle2 size={16} className="text-positive flex-shrink-0" />
            <div>
              <div className="text-[12px] font-bold text-foreground">Balanced ✓</div>
              <div className="text-[10px] text-muted-foreground">All equity movements reconcile to closing balance</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/5 border border-primary/15">
            <ShieldCheck size={15} className="text-primary flex-shrink-0" />
            <div>
              <div className="text-[11px] font-semibold text-foreground">PSAK Compliant</div>
              <div className="text-[10px] text-muted-foreground">Indonesian Financial Accounting Standards</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}