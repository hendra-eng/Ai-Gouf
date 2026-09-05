import React from 'react';
import { Printer, FileDown, Download, CheckCircle2, Shield } from 'lucide-react';

export default function NotesPageHeader() {
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      {/* Left */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Notes to Financial Statements
          </h1>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold border border-accent/20">
            <CheckCircle2 size={11} />
            Balanced ✓
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary text-xs font-semibold border border-primary/15">
            <Shield size={10} />
            PSAK Compliant
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          Accounting policies, supporting details, and financial disclosures
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="font-semibold text-foreground/80">PT Nusantara Teknologi Indonesia</span>
          <span className="text-border">·</span>
          <span className="text-primary font-medium">January 2026 – August 2026</span>
          <span className="text-border">·</span>
          <span>USD</span>
          <span className="text-border">·</span>
          <span>16 Notes</span>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button className="btn-ghost text-xs">
          <Printer size={14} />
          Print
        </button>
        <button className="btn-ghost text-xs">
          <FileDown size={14} />
          PDF
        </button>
        <button className="btn-secondary text-xs">
          <Download size={14} />
          Export
        </button>
      </div>
    </div>
  );
}