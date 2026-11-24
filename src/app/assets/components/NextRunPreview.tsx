'use client';

// Pratinjau isi run depresiasi periode berikutnya -- mengisi ruang kosong di bawah kartu
// "Next Depreciation Run". Tiga tab: Journal (jurnal yang akan terbentuk, Dr/Cr per akun),
// Top assets (kontributor terbesar) dan Categories (rincian per kategori).
// Data: POST /depreciation/preview (tanpa menyimpan apa pun).

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Scale } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import { METHOD_LABEL, previewDepreciation, type DepPreview } from '@/lib/fixedAssetsStore';
import type { FaActions } from './FixedAssetsWorkspace';

type Tab = 'journal' | 'assets' | 'category';
const TABS: { id: Tab; label: string }[] = [
  { id: 'journal', label: 'Journal' },
  { id: 'assets', label: 'Top assets' },
  { id: 'category', label: 'Categories' },
];

function sum(m: Map<string, number>) {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export default function NextRunPreview({ clientId, period, version, actions }: {
  clientId: string;
  period: string;
  /** Berubah saat angka run berubah (mis. setelah aset diperbaiki) -> muat ulang pratinjau. */
  version: string;
  actions: FaActions;
}) {
  const [tab, setTab] = useState<Tab>('journal');
  const [pv, setPv] = useState<DepPreview | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    let batal = false;
    setMemuat(true);
    setGagal(false);
    previewDepreciation(clientId, period)
      .then(r => { if (!batal) setPv(r.data); })
      .catch(() => { if (!batal) { setPv(null); setGagal(true); } })
      .finally(() => { if (!batal) setMemuat(false); });
    return () => { batal = true; };
  }, [clientId, period, version]);

  const lines = useMemo(() => pv?.lines ?? [], [pv]);
  const total = lines.reduce((n, l) => n + l.amount, 0);

  const debit = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach(l => m.set(l.expense_account, (m.get(l.expense_account) ?? 0) + l.amount));
    return sum(m);
  }, [lines]);
  const kredit = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach(l => m.set(l.accum_account, (m.get(l.accum_account) ?? 0) + l.amount));
    return sum(m);
  }, [lines]);
  const top = useMemo(() => [...lines].sort((a, b) => b.amount - a.amount).slice(0, 8), [lines]);
  const perKategori = useMemo(() => {
    const m = new Map<string, { n: number; amount: number }>();
    lines.forEach(l => {
      const k = l.category ?? 'Uncategorized';
      const g = m.get(k) ?? { n: 0, amount: 0 };
      m.set(k, { n: g.n + 1, amount: g.amount + l.amount });
    });
    return Array.from(m.entries()).sort((a, b) => b[1].amount - a[1].amount);
  }, [lines]);

  return (
    <div className="mt-1 border-t border-neutral-300 pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Run preview</span>
        <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="tablist">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${tab === t.id ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-300' : 'text-neutral-500 hover:text-neutral-800'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[132px] overflow-y-auto scrollbar-thin">
        {memuat ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-7 animate-pulse rounded-md bg-neutral-100" />)}</div>
        ) : gagal || lines.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">{gagal ? 'Preview is not available right now.' : 'No depreciation lines to preview for this period.'}</p>
        ) : tab === 'journal' ? (
          <div className="text-xs">
            {debit.map(([akun, n]) => (
              <div key={`d-${akun}`} className="flex items-center gap-2 py-1.5">
                <span className="w-7 shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-center text-[10px] font-bold text-neutral-700">Dr</span>
                <span className="min-w-0 flex-1 truncate text-neutral-900" title={akun}>{akun}</span>
                <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{rupiah(n)}</span>
              </div>
            ))}
            {kredit.map(([akun, n]) => (
              <div key={`k-${akun}`} className="flex items-center gap-2 py-1.5 pl-5">
                <span className="w-7 shrink-0 rounded bg-neutral-100 px-1 py-0.5 text-center text-[10px] font-bold text-neutral-700">Cr</span>
                <span className="min-w-0 flex-1 truncate text-neutral-900" title={akun}>{akun}</span>
                <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{rupiah(n)}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-1.5 border-t border-neutral-300 pt-2 text-[11px] text-neutral-500">
              <Scale size={12} className="text-emerald-600" /> Balanced · {rupiah(total)}
            </div>
          </div>
        ) : tab === 'assets' ? (
          <ol className="text-xs">
            {top.map((l, i) => (
              <li key={l.asset_id}>
                <button type="button" onClick={() => actions.openAsset(l.asset_id)} className="group flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-neutral-100">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold text-neutral-700 ring-1 ring-neutral-300">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-neutral-900">{l.asset_code} · {l.name}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{l.category ?? 'Uncategorized'} · {METHOD_LABEL[l.method]}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{rupiah(l.amount)}</span>
                  <ArrowUpRight size={12} className="shrink-0 text-neutral-400 group-hover:text-neutral-800" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="text-xs">
            {perKategori.map(([nama, g]) => (
              <li key={nama} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-neutral-900">{nama}</span>
                  <span className="block text-[11px] text-neutral-500">{g.n} asset{g.n === 1 ? '' : 's'}</span>
                </span>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-700 ring-1 ring-neutral-300">
                  {total > 0 ? ((g.amount / total) * 100).toFixed(1) : '0.0'}%
                </span>
                <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-neutral-900">{rupiah(g.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}