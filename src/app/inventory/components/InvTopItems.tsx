'use client';

// Top 5 Items by Value -- bukan tabel: 1 kartu "juara" besar (peringkat #1) + 4 kartu peringkat di sampingnya.
// Tiap kartu menampilkan nilai stok, porsi terhadap total nilai persediaan, stok x biaya rata-rata, dan kategori.
// Warna mengikuti halaman (kartu putih + garis netral, aksen emerald seperti KPI & tautan Categories).

import React from 'react';
import { Crown } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import { qty, type Item } from '@/lib/inventoryStore';

const pct = (v: number, total: number) => (total > 0 ? (v / total) * 100 : 0);
const pctText = (p: number) => `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;

// Garis aksen atas kartu: emerald makin pudar sesuai peringkat.
const BAR = ['bg-emerald-600', 'bg-emerald-500', 'bg-emerald-400', 'bg-emerald-300', 'bg-emerald-200'];

function Share({ p, tone }: { p: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-neutral-500">
        <span>Share of total stock value</span>
        <span className="tabular-nums text-neutral-800">{pctText(p)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, p))}%` }} />
      </div>
    </div>
  );
}

function Hero({ item, total, onOpen }: { item: Item; total: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="group relative flex h-full min-h-[260px] flex-col justify-between overflow-hidden rounded-[10px] border border-neutral-300 bg-gradient-to-br from-emerald-50 via-white to-white p-5 pt-6 text-left shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700 lg:col-span-2 lg:row-span-2">
      <span className="absolute inset-x-0 top-0 h-1 bg-emerald-600" />
      <span aria-hidden className="pointer-events-none absolute -right-2 -top-6 select-none text-[150px] font-bold leading-none tracking-tighter text-emerald-600/[0.07]">1</span>
      <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          <Crown size={12} /> Highest value
        </span>
        <h4 className="mt-4 text-xl font-semibold tracking-tight text-neutral-900">{item.name}</h4>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          <span className="font-semibold text-emerald-700">{item.code}</span>
          {item.category && <><span>·</span><span>{item.category}</span></>}
        </p>
      </div>
      <div className="relative mt-6 space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Stock value</p>
          <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-neutral-900">{rupiah(item.value)}</p>
          <p className="mt-1 text-xs text-neutral-500 tabular-nums">{qty(item.qty)} {item.unit} × {rupiah(item.avg_cost)} avg cost</p>
        </div>
        <Share p={pct(item.value, total)} tone="bg-emerald-600" />
      </div>
    </button>
  );
}

function Card({ item, rank, total, onOpen }: { item: Item; rank: number; total: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 text-left shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${BAR[rank - 1]}`} />
      <span aria-hidden className="pointer-events-none absolute -right-1 -top-3 select-none text-[84px] font-bold leading-none tracking-tighter text-neutral-900/[0.05]">{rank}</span>
      <div className="relative min-w-0">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">#{rank}</span>
        <h4 className="mt-2 truncate text-sm font-semibold text-neutral-900" title={item.name}>{item.name}</h4>
        <p className="truncate text-[11px] text-neutral-500">{item.code}{item.category ? ` · ${item.category}` : ''}</p>
      </div>
      <div className="relative mt-4 space-y-2.5">
        <div>
          <p className="truncate text-base font-semibold tabular-nums tracking-tight text-neutral-900">{rupiah(item.value)}</p>
          <p className="truncate text-[11px] tabular-nums text-neutral-500">{qty(item.qty)} {item.unit} × {rupiah(item.avg_cost)}</p>
        </div>
        <Share p={pct(item.value, total)} tone={BAR[rank - 1]} />
      </div>
    </button>
  );
}

export default function InvTopItems({ items, total, loading, onOpen }: {
  items: Item[]; total: number; loading?: boolean; onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-[260px] animate-pulse rounded-[10px] bg-neutral-100 lg:col-span-2 lg:row-span-2" />
        {[0, 1, 2, 3].map(n => <div key={n} className="h-[122px] animate-pulse rounded-[10px] bg-neutral-100" />)}
      </div>
    );
  }
  if (!items.length) {
    return <div className="rounded-[10px] border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">No stock yet.</div>;
  }
  const [first, ...rest] = items;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Hero item={first} total={total} onOpen={() => onOpen(first.id)} />
      {rest.map((i, n) => <Card key={i.id} item={i} rank={n + 2} total={total} onOpen={() => onOpen(i.id)} />)}
    </div>
  );
}