'use client';

// Tab Overview (Template UI/Fix Assets/5.jpeg): 4 KPI, tren nilai buku,
// komposisi per kategori (donut), dan aset yang mendekati akhir umur ekonomis.

import React, { useMemo } from 'react';
import { AlertTriangle, Coins, Layers, MoreHorizontal, PieChart as PieIcon, Plus, TrendingUp } from 'lucide-react';
import { fmtDate, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchOverview, lifeLabel, useFaData, type Overview } from '@/lib/fixedAssetsStore';
import { Card } from '@/components/arap/arapUi';
import { Delta } from '@/components/shared/moduleUi';
import { FaKpiGrid } from './FaKpi';
import { faTableCls, faRow, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow } from './FaTable';
import type { FaActions } from './FixedAssetsWorkspace';
import FaTrendChart, { type FaPointBuilder, type FaSeries } from './FaTrendChart';
import FaCategoryInsights from './FaCategoryInsights';
import FaDonut, { FA_DONUT_COLORS, FA_DONUT_OTHERS_COLOR, type FaDonutItem } from './FaDonut';


// Chart tren: Total Cost, Accumulated Depreciation, Additions (kolom) + Net Book Value (garis).
const OV_SERIES: FaSeries[] = [
  { key: 'cost', name: 'Total Cost', color: '#2563EB', kind: 'bar' },
  { key: 'accumulated', name: 'Accumulated Depreciation', color: '#DC2626', kind: 'bar' },
  { key: 'additions', name: 'Additions', color: '#F59E0B', kind: 'bar' },
  { key: 'nbv', name: 'Net Book Value', color: '#16A34A', kind: 'line', emphasis: true },
];
const ovBuild: FaPointBuilder = (i, get) => {
  const m = get(i);
  return { cost: m?.cost ?? null, accumulated: m?.accumulated ?? null, additions: m?.additions ?? null, nbv: m?.nbv ?? null };
};

export default function OverviewTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: FaActions }) {
  const ov = useFaData<Overview | null>(`ov:${clientId}:${asOf}`, s => fetchOverview(clientId, asOf, 12, s), null);
  const d = ov.data;
  const k = d?.kpi;
  const loading = ov.loading && !d;
  const totalNbv = d?.by_category.reduce((n, c) => n + c.nbv, 0) ?? 0;
  // Warna donut sama dengan donut Sales/Purchase; "Uncategorized" memakai warna abu "Others".
  const donutItems = useMemo<FaDonutItem[]>(() => {
    let n = 0;
    return (d?.by_category ?? []).filter(c => c.nbv !== 0).map(c => ({
      key: c.category, name: c.category, value: c.nbv,
      color: c.category === 'Uncategorized' ? FA_DONUT_OTHERS_COLOR : FA_DONUT_COLORS[n++ % FA_DONUT_COLORS.length],
    }));
  }, [d?.by_category]);

  return (
    <div className="space-y-5">
      {ov.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ov.error}</div>}
      {d && d.category_count === 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 sm:flex-row sm:items-center sm:justify-between">
          <span>No asset categories yet. Categories hold the default depreciation method, useful life and COA accounts.</span>
          <button type="button" onClick={actions.manageCategories} className="font-semibold underline hover:no-underline">Set up categories</button>
        </div>
      )}
      {d && d.issues_count > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><AlertTriangle size={16} /> {d.issues_count} asset(s) need review before they can be depreciated.</span>
          <button type="button" onClick={() => actions.goTab('depreciation')} className="font-semibold underline hover:no-underline">Review</button>
        </div>
      )}

      <FaKpiGrid loading={loading} cards={[
        { label: 'Total Fixed Assets', value: rupiah(k?.current.total_cost), icon: Coins, tone: 'emerald',
          delta: <Delta now={k?.current.total_cost} prev={k?.previous.total_cost} suffix="vs. previous year" /> },
        { label: 'Accumulated Depreciation', value: rupiah(k?.current.accumulated), icon: PieIcon, tone: 'rose',
          delta: <Delta now={k?.current.accumulated} prev={k?.previous.accumulated} goodWhenDown suffix="vs. previous year" /> },
        { label: 'Net Book Value', value: rupiah(k?.current.nbv), icon: TrendingUp, tone: 'teal',
          delta: <Delta now={k?.current.nbv} prev={k?.previous.nbv} suffix="vs. previous year" /> },
        { label: 'Additions This Year', value: rupiah(k?.current.additions_ytd), icon: Plus, tone: 'sky',
          delta: <Delta now={k?.current.additions_ytd} prev={k?.previous.additions_ytd} suffix="vs. last year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <FaTrendChart className="xl:col-span-3" title="Fixed Asset Trend" clientId={clientId} asOf={asOf} series={OV_SERIES} build={ovBuild} />

        <Card className="flex flex-col xl:col-span-2" title="Assets by Category" subtitle="By net book value" action={
          <button type="button" onClick={actions.manageCategories} className="inline-flex items-center gap-1 text-xs font-medium text-[#0F7D4E] hover:underline"><Layers size={13} /> Categories</button>
        }>
          <FaDonut items={donutItems} centerLabel={rupiahShort(totalNbv)} centerSubLabel="Net Book Value" size={168} integer
            formatLegend={v => rupiah(Math.round(v))} formatCallout={v => rupiahShort(v)} emptyText="No assets yet." />
          <FaCategoryInsights data={d} onRegister={() => actions.goTab('register')} onReview={() => actions.goTab('depreciation')} />
        </Card>
      </div>

      <FaCard title="Assets Near End of Useful Life" subtitle="Remaining useful life of 24 months or less" action={
        <button type="button" onClick={() => actions.goTab('register')} className="text-xs font-semibold text-[#0F7D4E] hover:underline">View All ›</button>
      }>
        <div className="overflow-x-auto scrollbar-thin">
          <table className={`${faTableCls} min-w-[820px]`}>
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th><th className={thCls}>Category</th>
              <th className={thCls}>Acquisition Date</th><th className={thCls}>Useful Life</th><th className={thCls}>Remaining Life</th>
              <th className={`${thCls} text-right`}>Net Book Value</th><th className={`${thCls} w-10`} />
            </tr></thead>
            <tbody>
              {(loading || !(d?.near_end_of_life.length)) && <FaEmptyRow cols={8} loading={loading} text="No assets are close to the end of their useful life." />}
              {d?.near_end_of_life.slice(0, 10).map(a => (
                <tr key={a.id} className={faRow}>
                  <td className={`${tdCls} font-medium`}>{a.asset_code}</td>
                  <td className={tdCls}>{a.name}</td>
                  <td className={tdCls}>{a.category ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.acquisition_date)}</td>
                  <td className={tdCls}>{lifeLabel(a.useful_life_months)}</td>
                  <td className={tdCls}><FaPill label={lifeLabel(a.remaining_life_months)} style="bg-rose-50 text-rose-600" /></td>
                  <td className={`${tdCls} text-right font-medium`}>{rupiah(a.net_book_value)}</td>
                  <td className={tdCls}>
                    <button type="button" onClick={() => actions.openAsset(a.id)} className="rounded p-1 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="Open asset"><MoreHorizontal size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FaCard>
    </div>
  );
}