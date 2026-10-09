'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { FsAccountRow, FsLine, FsSection } from '@/lib/fsStore';
import { fmtAmount, fmtMonth, fmtPct, glHref, variance } from './fsFormat';

// Tabel statement bersama Balance Sheet & Profit & Loss: seksi -> baris
// laporan (bisa di-expand) -> akun -> drill ke General Ledger.

export type StatementRow =
  | { kind: 'section'; section: FsSection }
  | { kind: 'subtotal' | 'total'; key: string; label: string; amount: number; compare_amount: number | null; monthly?: number[] | null; strong?: boolean };

export interface StatementTableProps {
  rows: StatementRow[];
  currentLabel: string;
  compareLabel?: string | null;
  months?: string[];
  /** Rentang tanggal GL untuk drill-down 1 akun. */
  glRange: { start: string; end: string };
  expandAll: boolean;
  warningText?: Record<string, string>;
}

function Amount({ v, strong, muted }: { v: number | null | undefined; strong?: boolean; muted?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${strong ? 'font-bold text-foreground' : muted ? 'text-muted-foreground' : 'text-foreground'} ${v !== null && v !== undefined && v < 0 ? 'text-rose-700' : ''}`}>
      {fmtAmount(v)}
    </td>
  );
}

function VarianceCells({ cur, prev, strong }: { cur: number; prev: number | null; strong?: boolean }) {
  const v = variance(cur, prev);
  if (!v) return null;
  return (
    <>
      <Amount v={v.abs} strong={strong} muted={!strong} />
      <td className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap ${v.pct === null ? 'text-muted-foreground' : v.pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
        {fmtPct(v.pct)}
      </td>
    </>
  );
}

export default function StatementTable({ rows, currentLabel, compareLabel, months, glRange, expandAll, warningText }: StatementTableProps) {
  const monthly = !!months?.length;
  const showCompare = !!compareLabel && !monthly;
  const [open, setOpen] = useState<Set<string>>(new Set());
  // rows lewat ref: effect hanya bereaksi ke tombol Expand/Collapse all & data baru, bukan tiap render induk.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!expandAll) { setOpen(new Set()); return; }
    const all = new Set<string>();
    rowsRef.current.forEach(r => { if (r.kind === 'section') r.section.lines.forEach(l => all.add(`${r.section.key}:${l.key}`)); });
    setOpen(all);
  }, [expandAll]);

  const toggle = (k: string) => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const valueCells = (amount: number, compare: number | null, monthlyVals: number[] | null | undefined, strong?: boolean) => (
    <>
      {monthly && (months ?? []).map((m, i) => <Amount key={m} v={monthlyVals?.[i] ?? 0} strong={strong} />)}
      <Amount v={amount} strong />
      {showCompare && <Amount v={compare} strong={strong} muted={!strong} />}
      {showCompare && <VarianceCells cur={amount} prev={compare} strong={strong} />}
    </>
  );

  const colCount = 1 + (monthly ? (months?.length ?? 0) : 0) + 1 + (showCompare ? 3 : 0);

  const accountRow = (a: FsAccountRow, i: number) => (
    <tr key={`${a.code ?? 'calc'}-${i}`} className="hover:bg-slate-50 text-[13px]">
      <td className="pl-12 pr-3 py-1.5">
        <span className="inline-flex items-center gap-2 min-w-0">
          {a.code ? <span className="font-mono text-xs text-muted-foreground">{a.code}</span> : <span className="text-[10px] font-semibold uppercase tracking-wide bg-violet-50 text-violet-700 rounded px-1.5 py-0.5">Auto</span>}
          <span className="text-foreground/90 truncate">{a.name}</span>
          {a.warnings?.length > 0 && (
            <span title={a.warnings.map(w => warningText?.[w] ?? w).join('\n')}>
              <AlertTriangle size={13} className="text-amber-500" />
            </span>
          )}
          {a.code && (
            <Link href={glHref(a.code, glRange.start, glRange.end)} target="_blank" title="Open in General Ledger" className="text-muted-foreground hover:text-blue-700">
              <ExternalLink size={13} />
            </Link>
          )}
        </span>
      </td>
      {monthly && (months ?? []).map((m, j) => <Amount key={m} v={a.monthly?.[j] ?? 0} muted />)}
      <Amount v={a.amount} muted />
      {showCompare && <Amount v={a.compare_amount} muted />}
      {showCompare && <VarianceCells cur={a.amount} prev={a.compare_amount} />}
    </tr>
  );

  const lineRows = (sectionKey: string, l: FsLine) => {
    const k = `${sectionKey}:${l.key}`;
    const isOpen = open.has(k);
    return (
      <React.Fragment key={k}>
        <tr className="border-t border-border hover:bg-slate-50 cursor-pointer" onClick={() => toggle(k)}>
          <td className="pl-5 pr-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-foreground">
              {isOpen ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronRight size={15} className="text-muted-foreground" />}
              {l.label}
              <span className="text-xs text-muted-foreground">({l.accounts.length})</span>
            </span>
          </td>
          {valueCells(l.amount, l.compare_amount, l.monthly)}
        </tr>
        {isOpen && l.accounts.map(accountRow)}
      </React.Fragment>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-slate-50 border-b border-border">
            <th className="text-left font-semibold px-5 py-2.5">Description</th>
            {monthly && (months ?? []).map(m => <th key={m} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">{fmtMonth(m)}</th>)}
            <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">{monthly ? 'Total' : currentLabel}</th>
            {showCompare && <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">{compareLabel}</th>}
            {showCompare && <th className="text-right font-semibold px-3 py-2.5">Variance</th>}
            {showCompare && <th className="text-right font-semibold px-3 py-2.5">%</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            if (r.kind === 'section') {
              const s = r.section;
              return (
                <React.Fragment key={s.key}>
                  <tr className="border-t border-border bg-white">
                    <td colSpan={colCount} className="px-5 pt-4 pb-1.5 text-xs font-bold uppercase tracking-wider text-blue-800">{s.label}</td>
                  </tr>
                  {s.lines.length === 0 && (
                    <tr><td colSpan={colCount} className="pl-10 py-2 text-xs italic text-muted-foreground">No balances</td></tr>
                  )}
                  {s.lines.map(l => lineRows(s.key, l))}
                  <tr className="border-t border-border bg-slate-50/70 font-semibold">
                    <td className="px-5 py-2 text-foreground">Total {s.label}</td>
                    {valueCells(s.total, s.compare_total, s.monthly ?? null, true)}
                  </tr>
                </React.Fragment>
              );
            }
            const strong = r.kind === 'total' || r.strong;
            return (
              <tr key={r.key} className={`border-t-2 border-border ${strong ? 'bg-blue-50/70' : 'bg-slate-100/70'}`}>
                <td className={`px-5 py-2.5 ${strong ? 'font-bold text-blue-900' : 'font-semibold text-foreground'}`}>{r.label}</td>
                {valueCells(r.amount, r.compare_amount, r.monthly, true)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
