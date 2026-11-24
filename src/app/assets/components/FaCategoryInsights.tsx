'use client';

// Blok informasi di bawah donut "Assets by Category" (tab Overview): proporsi penyusutan
// (bar bertumpuk dengan warna yang sama seperti chart tren: merah = akumulasi penyusutan,
// hijau = nilai buku) + 2 tile ringkasan. Mengisi ruang kosong supaya tinggi kartu sepadan
// dengan chart di sebelahnya. Semua angka berasal dari data Overview yang sudah dimuat.

import React from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import type { Overview } from '@/lib/fixedAssetsStore';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

const ACCUM_COLOR = '#DC2626'; // = seri "Accumulated Depreciation" di chart tren
const NBV_COLOR = '#16A34A';   // = seri "Net Book Value" di chart tren

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

export default function FaCategoryInsights({ data, onRegister, onReview }: {
  data: Overview | null;
  onRegister: () => void;
  onReview: () => void;
}) {
  const k = data?.kpi.current;
  const cost = k?.total_cost ?? 0;
  const accum = Math.max(0, Math.min(k?.accumulated ?? 0, cost));
  const nbv = Math.max(0, cost - accum);
  const pctAccum = cost > 0 ? (accum / cost) * 100 : 0;
  const pctNbv = cost > 0 ? 100 - pctAccum : 0;

  const issues = data?.issues_count ?? 0;

  return (
    <div className={`${salesFont.className} mt-auto border-t border-neutral-200 px-5 pb-5 pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-neutral-900">Depreciation Progress</span>
        <span className="text-[11px] text-neutral-500"><span className="font-semibold tabular-nums text-neutral-900">{pctAccum.toFixed(1)}%</span> of cost depreciated</span>
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={`${pctAccum.toFixed(1)}% of total cost depreciated`}>
        <div style={{ width: `${pctAccum}%`, background: ACCUM_COLOR }} />
        <div style={{ width: `${pctNbv}%`, background: NBV_COLOR }} />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-[11px]">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-neutral-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ACCUM_COLOR }} />Accumulated Depreciation</div>
          <div className="mt-0.5 font-semibold tabular-nums text-neutral-900">{rupiah(Math.round(accum))}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="flex items-center justify-end gap-1.5 text-neutral-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NBV_COLOR }} />Net Book Value</div>
          <div className="mt-0.5 font-semibold tabular-nums text-neutral-900">{rupiah(Math.round(nbv))}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Tile icon={Boxes} label="Total Assets" value={String(k?.count ?? 0)} sub={`in ${data?.category_count ?? 0} ${data?.category_count === 1 ? 'category' : 'categories'}`} onClick={onRegister} />
        <Tile icon={AlertTriangle} label="Needs Review" value={String(issues)} sub={issues > 0 ? 'Fix before next depreciation' : 'All assets look good'}
          tone={issues > 0 ? 'amber' : 'neutral'} onClick={issues > 0 ? onReview : undefined} />
      </div>
    </div>
  );
}