'use client';

// Tab Overview (Template UI/Fix Assets/5.jpeg): 4 KPI, tren nilai buku,
// komposisi per kategori (donut), dan aset yang mendekati akhir umur ekonomis.

import React, { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Coins, Layers, MoreHorizontal, PieChart as PieIcon, Plus, TrendingUp } from 'lucide-react';
import { fmtDate, fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchOverview, lifeLabel, useFaData, type Overview } from '@/lib/fixedAssetsStore';
import { Card, EmptyRow } from '@/components/arap/arapUi';
import { Delta, KpiGrid, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

export const PALET = ['#0B5E5C', '#0F7D4E', '#14B8A6', '#5EEAD4', '#A7F3D0', '#CBD5E1', '#94A3B8', '#64748B'];

export default function OverviewTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: FaActions }) {
  const [months, setMonths] = useState(12);
  const ov = useFaData<Overview | null>(`ov:${clientId}:${asOf}:${months}`, s => fetchOverview(clientId, asOf, months, s), null);
  const d = ov.data;
  const k = d?.kpi;
  const loading = ov.loading && !d;
  const totalNbv = d?.by_category.reduce((n, c) => n + c.nbv, 0) ?? 0;

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

      <KpiGrid loading={loading} cards={[
        { label: 'Total Fixed Assets', value: rupiah(k?.current.total_cost), icon: Coins, tone: 'green',
          delta: <Delta now={k?.current.total_cost} prev={k?.previous.total_cost} suffix="vs. previous year" /> },
        { label: 'Accumulated Depreciation', value: rupiah(k?.current.accumulated), icon: PieIcon, tone: 'red',
          delta: <Delta now={k?.current.accumulated} prev={k?.previous.accumulated} goodWhenDown suffix="vs. previous year" /> },
        { label: 'Net Book Value', value: rupiah(k?.current.nbv), icon: TrendingUp, tone: 'green',
          delta: <Delta now={k?.current.nbv} prev={k?.previous.nbv} suffix="vs. previous year" /> },
        { label: 'Additions This Year', value: rupiah(k?.current.additions_ytd), icon: Plus, tone: 'amber',
          delta: <Delta now={k?.current.additions_ytd} prev={k?.previous.additions_ytd} suffix="vs. last year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Net Book Value Trend" action={
          <select value={months} onChange={e => setMonths(Number(e.target.value))} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
            <option value={6}>Last 6 Months</option><option value={12}>Last 12 Months</option><option value={24}>Last 24 Months</option>
          </select>
        }>
          <div className="h-72 px-3 pb-4">
            {loading ? <div className="h-full animate-pulse rounded-xl bg-slate-50" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d?.trend ?? []} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="faNbv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0F7D4E" stopOpacity={0.25} /><stop offset="100%" stopColor="#0F7D4E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={m => fmtMonth(m).slice(0, 3)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                  <Area type="monotone" dataKey="nbv" name="Net Book Value" stroke="#0F7D4E" strokeWidth={2.5} fill="url(#faNbv)" dot={{ r: 3, fill: '#0F7D4E' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Assets by Category" subtitle="By net book value" action={
          <button type="button" onClick={actions.manageCategories} className="inline-flex items-center gap-1 text-xs font-medium text-[#0F7D4E] hover:underline"><Layers size={13} /> Categories</button>
        }>
          <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row">
            <div className="relative h-48 w-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d?.by_category ?? []} dataKey="nbv" nameKey="category" innerRadius={58} outerRadius={88} paddingAngle={1} stroke="none">
                    {(d?.by_category ?? []).map((_, i) => <Cell key={i} fill={PALET[i % PALET.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => rupiah(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-sm font-bold text-foreground">{rupiahShort(totalNbv)}</span>
                <span className="text-[10px] text-muted-foreground">Net Book Value</span>
              </div>
            </div>
            <ul className="w-full space-y-2 text-xs">
              {(d?.by_category ?? []).length === 0 && <li className="text-muted-foreground">No assets yet.</li>}
              {(d?.by_category ?? []).map((c, i) => (
                <li key={c.category} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALET[i % PALET.length] }} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{c.category}</span>
                  <span className="w-10 text-right text-muted-foreground">{totalNbv ? Math.round((c.nbv / totalNbv) * 100) : 0}%</span>
                  <span className="w-28 text-right font-medium text-foreground">{rupiah(c.nbv)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card title="Assets Near End of Useful Life" subtitle="Remaining useful life of 24 months or less" action={
        <button type="button" onClick={() => actions.goTab('register')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View All ›</button>
      }>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th><th className={thCls}>Category</th>
              <th className={thCls}>Acquisition Date</th><th className={thCls}>Useful Life</th><th className={thCls}>Remaining Life</th>
              <th className={`${thCls} text-right`}>Net Book Value</th><th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(loading || !(d?.near_end_of_life.length)) && <EmptyRow cols={8} loading={loading} text="No assets are close to the end of their useful life." />}
              {d?.near_end_of_life.slice(0, 10).map(a => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className={`${tdCls} font-medium`}>{a.asset_code}</td>
                  <td className={tdCls}>{a.name}</td>
                  <td className={tdCls}>{a.category ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.acquisition_date)}</td>
                  <td className={tdCls}>{lifeLabel(a.useful_life_months)}</td>
                  <td className={tdCls}><span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">{lifeLabel(a.remaining_life_months)}</span></td>
                  <td className={`${tdCls} text-right font-medium`}>{rupiah(a.net_book_value)}</td>
                  <td className={tdCls}>
                    <button type="button" onClick={() => actions.openAsset(a.id)} className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Open asset"><MoreHorizontal size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
