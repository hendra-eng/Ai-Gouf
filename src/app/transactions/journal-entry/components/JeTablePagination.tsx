'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Footer tabel JE Transaction -- salinan persis footer Sales Transaction:
// "Rows per page" + rentang data + nomor halaman ringkas (1 … 4 5 6 … 28).
function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

export default function JeTablePagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50], itemLabel = 'journal entries' }: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const goTo = (p: number) => onPageChange(Math.min(Math.max(1, p), totalPages));

  return (
    <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={ev => onPageSizeChange(Number(ev.target.value))}
            className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {pageSizeOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="hidden sm:inline text-slate-300">|</span>
        <span>
          <span className="font-semibold text-foreground">
            {total === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, total)}
          </span>{' '}
          of <span className="font-semibold text-foreground">{total}</span> {itemLabel}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => goTo(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
        {buildPageItems(pageSafe, totalPages).map((p, idx) =>
          p === '…' ? (
            <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
          ) : (
            <button key={p} onClick={() => goTo(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
          )
        )}
        <button onClick={() => goTo(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
