'use client';

// Blok informasi di bawah donut "Inventory by Category" (tab Overview) -- desain sama dengan
// FaCategoryInsights di halaman Fixed Assets: bar bertumpuk (kesehatan stok: normal / menipis / habis)
// + 2 tile ringkasan. Semua angka berasal dari data Overview yang sudah dimuat.

import React from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import type { InvOverview } from '@/lib/inventoryStore';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

const OK_COLOR = '#16A34A';   // = seri "Stock Value" di chart tren
const LOW_COLOR = '#F59E0B';
const OUT_COLOR = '#DC2626';  // = seri "Stock Out" di chart tren

function Tile({ icon: Icon, label, value, sub, tone = 'neutral', onClick }: {
  icon: React.ElementType; label: string; value: string; sub: string; tone?: 'neutral' | 'amber'; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-neutral-500">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-white text-neutral-600 ring-1 ring-neutral-200'}`}><Icon size={12} /></span>
        {label}
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold leading-tight text-neutral-900" title={value}>{value}</div>
      <div className="mt-0.5 truncate text-[10.5px] text-neutral-500" title={sub}>{sub}</div>
    </>
  );
  const cls = 'min-w-0 rounded-lg bg-neutral-50 px-3 py-2.5 text-left ring-1 ring-neutral-200';
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-neutral-100`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export default function InvCategoryInsights({ data, onItems }: { data: InvOverview | null; onItems: () => void }) {
  const k = data?.kpi;
  const total = k?.total_items ?? 0;
  const out = Math.min(k?.out_of_stock ?? 0, total);
  const low = Math.min(k?.low_stock ?? 0, Math.max(0, total - out));
  const ok = Math.max(0, total - low - out);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const needs = low + out;
  const cats = k?.categories ?? 0;

  return (
    <div className={`${salesFont.className} mt-auto border-t border-neutral-200 px-5 pb-5 pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-neutral-900">Stock Health</span>
        <span className="text-[11px] text-neutral-500"><span className="font-semibold tabular-nums text-neutral-900">{pct(ok).toFixed(1)}%</span> of items in stock</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={`${pct(ok).toFixed(1)}% of items in stock`}>
        <div style={{ width: `${pct(out)}%`, background: OUT_COLOR }} />
        <div style={{ width: `${pct(low)}%`, background: LOW_COLOR }} />
        <div style={{ width: `${pct(ok)}%`, background: OK_COLOR }} />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-[11px]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-neutral-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OUT_COLOR }} />Out of Stock</div>
          <div className="mt-0.5 font-semibold tabular-nums text-neutral-900">{out} {out === 1 ? 'item' : 'items'}</div>
        </div>
        <div className="min-w-0 text-center">
          <div className="flex items-center justify-center gap-1.5 text-neutral-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LOW_COLOR }} />Low Stock</div>
          <div className="mt-0.5 font-semibold tabular-nums text-neutral-900">{low} {low === 1 ? 'item' : 'items'}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="flex items-center justify-end gap-1.5 text-neutral-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OK_COLOR }} />In Stock</div>
          <div className="mt-0.5 font-semibold tabular-nums text-neutral-900">{ok} {ok === 1 ? 'item' : 'items'}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Tile icon={Boxes} label="Total Items" value={String(total)} sub={`in ${cats} ${cats === 1 ? 'category' : 'categories'}`} onClick={onItems} />
        <Tile icon={AlertTriangle} label="Needs Restock" value={String(needs)} sub={needs > 0 ? 'Restock before running out' : 'All items look good'}
          tone={needs > 0 ? 'amber' : 'neutral'} onClick={needs > 0 ? onItems : undefined} />
      </div>
    </div>
  );
}
