'use client';

import React, { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, Database, FileText, Lightbulb, LineChart, Trophy } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { Select } from '../PeriodPicker';
import { fmtAmount } from '../fsFormat';
import { BS_COLORS, capToday, fmtCompact, fmtMillions, monthEnd, monthLabel, pctChange, useBsSeries, type Merged } from './bsData';
import { ChartTooltip, Delta, EmptyData, InsightCard, KpiCard, KpiRow, Legend, Panel } from './BsUi';
import { BsToolbar, type ViewProps } from './BsToolbar';
import { todayIso } from '../fsFormat';
import { bsTemplateReport } from '../statementTemplate';

// (b) Balance Sheet Trend -- posisi akhir bulan sepanjang 1 tahun + rata-rata
// vs tahun sebelumnya, grafik garis, insight & tabel bulanan.

const avg = (a: number[]) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);

export default function BsTrendView({ clientId, companyName, printedBy }: ViewProps) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [millions, setMillions] = useState(true);
  const [picked, setPicked] = useState<number | null>(null);

  // Bulan tahun berjalan dipotong s.d. bulan ini (bulan ini = per hari ini).
  const { cur, prev } = useMemo(() => {
    const cur: string[] = [];
    for (let mo = 1; mo <= 12; mo++) {
      const d = monthEnd(year, mo);
      if (d.slice(0, 7) > today.slice(0, 7)) break;
      cur.push(capToday(d, today));
    }
    const prev = Array.from({ length: 12 }, (_, i) => monthEnd(year - 1, i + 1));
    return { cur, prev };
  }, [year, today]);
  const dates = useMemo(() => [...cur, ...prev], [cur, prev]);
  const { data, merged: m, loading, error } = useBsSeries(clientId, dates, cur.length > 0);
  const n = cur.length;
  const sel = picked !== null && picked < n ? picked : n - 1;
  const company = data?.client.company_name ?? companyName ?? '';

  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Year
              <div className="w-28"><Select value={year} onChange={v => { setYear(Number(v)); setPicked(null); }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
            </label>
            <span className="text-sm text-muted-foreground">Monthly position across {n || 12} months · IDR</span>
          </>
        }
        loading={loading}
        exportReady={!!m && n > 0}
        buildExport={() => bsTemplateReport(m!, cur.map((_, i) => i), cur.map(d => monthLabel(d)), {
          title: 'Balance Sheet Trend', fileBase: `Balance-Sheet-Trend-${year}`, companyName: company,
          subtitle: `Month-end positions, ${year}`, printedBy,
        })}
      />

      {n === 0 && <EmptyData text={`${year} has not started yet.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && n > 0 && <LoadingBlock />}
      {m && n > 0 && <TrendBody m={m} n={n} sel={sel} onPick={setPicked} year={year} millions={millions} setMillions={setMillions} />}
    </div>
  );
}

function TrendBody({ m, n, sel, onPick, year, millions, setMillions }: {
  m: Merged; n: number; sel: number; onPick: (i: number) => void; year: number; millions: boolean; setMillions: (v: boolean) => void;
}) {
  const curIdx = Array.from({ length: n }, (_, i) => i);
  const prevIdx = Array.from({ length: 12 }, (_, i) => n + i);
  const pick = (arr: number[], idx: number[]) => idx.map(i => arr[i]);
  const A = pick(m.assets, curIdx), L = pick(m.liabilities, curIdx), E = pick(m.equity, curIdx);
  const avgA = avg(A), avgL = avg(L), avgE = avg(E);
  const pavgA = avg(pick(m.assets, prevIdx)), pavgL = avg(pick(m.liabilities, prevIdx)), pavgE = avg(pick(m.equity, prevIdx));
  const hiI = A.indexOf(Math.max(...A));
  const loI = A.indexOf(Math.min(...A));
  const lbl = (i: number) => monthLabel(m.dates[i]);

  // Perubahan bulan-ke-bulan total aset (butuh Desember tahun lalu untuk Januari).
  const moves = curIdx.map(i => {
    const before = i === 0 ? m.assets[n + 11] : A[i - 1];
    return { i, from: i === 0 ? monthLabel(m.dates[n + 11]) : lbl(i - 1), d: A[i] - before, p: pctChange(A[i], before) };
  });
  const up = moves.reduce((b, x) => (x.d > b.d ? x : b), { i: -1, from: '', d: 0, p: null as number | null });
  const down = moves.reduce((b, x) => (x.d < b.d ? x : b), { i: -1, from: '', d: 0, p: null as number | null });
  const eqGrowth = E[n - 1] - E[0];

  const chart = curIdx.map(i => ({ name: lbl(i), Assets: A[i], Liabilities: L[i], Equity: E[i] }));
  const sfx = `vs ${year - 1}`;

  return (
    <div className="space-y-5">
      <KpiRow>
        <KpiCard label="Average Total Assets" icon={Database} tone="brand" value={`IDR ${fmtAmount(avgA)}`} delta={<Delta pct={pctChange(avgA, pavgA)} suffix={sfx} />} />
        <KpiCard label="Average Total Liabilities" icon={FileText} tone="rose" value={`IDR ${fmtAmount(avgL)}`} delta={<Delta pct={pctChange(avgL, pavgL)} upIsGood={false} suffix={sfx} />} />
        <KpiCard label="Average Equity" icon={BarChart3} tone="violet" value={`IDR ${fmtAmount(avgE)}`} delta={<Delta pct={pctChange(avgE, pavgE)} suffix={sfx} />} />
        <KpiCard label="Highest Month (Total Assets)" icon={Trophy} tone="amber" value={lbl(hiI)}
          delta={<div className="flex items-center gap-3 flex-wrap"><span className="text-xs text-foreground tabular-nums">IDR {fmtAmount(A[hiI])}</span><Delta pct={pctChange(A[hiI], A[0])} suffix={`vs ${lbl(0)}`} /></div>} />
      </KpiRow>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Panel title="Balance Sheet Trend (IDR)" icon={LineChart}
            right={<Legend items={[{ label: 'Total Assets', color: BS_COLORS.assetsSoft }, { label: 'Total Liabilities', color: BS_COLORS.liabilities }, { label: 'Total Equity', color: BS_COLORS.equity }]} />}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  onClick={(e: { activeTooltipIndex?: number } | null) => { if (e && typeof e.activeTooltipIndex === 'number') onPick(e.activeTooltipIndex); }}>
                  <defs>
                    {[['gA', BS_COLORS.assetsSoft], ['gL', BS_COLORS.liabilities], ['gE', BS_COLORS.equity]].map(([id, c]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={0.18} /><stop offset="100%" stopColor={c} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCompact(v, 1)} />
                  <Tooltip content={<ChartTooltip fmt={v => fmtAmount(v)} />} />
                  <ReferenceLine x={chart[sel]?.name} stroke={BS_COLORS.assets} strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="Assets" name="Assets" stroke="none" fill="url(#gA)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Area type="monotone" dataKey="Liabilities" name="Liabilities" stroke="none" fill="url(#gL)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Area type="monotone" dataKey="Equity" name="Equity" stroke="none" fill="url(#gE)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Line type="monotone" dataKey="Assets" stroke={BS_COLORS.assetsSoft} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Liabilities" stroke={BS_COLORS.liabilities} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Equity" stroke={BS_COLORS.equity} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Click a month on the chart to highlight it in the table.</p>
          </Panel>

          <MonthlyTable m={m} n={n} sel={sel} onPick={onPick} millions={millions} setMillions={setMillions} />
        </div>

        <Panel title="Insights" icon={Lightbulb} tone="sky" bodyClass="p-4 space-y-3">
          <InsightCard icon={ArrowUpRight} tone="brand" title="Largest Assets Increase"
            value={up.i < 0 ? 'No increase' : `+ IDR ${fmtAmount(up.d)}`} sub={up.i < 0 ? undefined : `from ${up.from} to ${lbl(up.i)}`}
            badge={up.i < 0 ? null : <span className="text-emerald-600">{up.p === null ? '' : `+${up.p.toFixed(1)}%`}</span>} />
          <InsightCard icon={ArrowDownRight} tone="rose" title="Largest Assets Decrease"
            value={down.i < 0 ? 'No decrease' : `- IDR ${fmtAmount(Math.abs(down.d))}`} sub={down.i < 0 ? undefined : `from ${down.from} to ${lbl(down.i)}`}
            badge={down.i < 0 ? null : <span className="text-rose-600">{down.p === null ? '' : `${down.p.toFixed(1)}%`}</span>} />
          <InsightCard icon={BarChart3} tone="violet" title={eqGrowth >= 0 ? 'Equity Growth' : 'Equity Decline'}
            value={`${eqGrowth >= 0 ? '+' : '-'} IDR ${fmtAmount(Math.abs(eqGrowth))}`} sub={`from ${lbl(0)} to ${lbl(n - 1)}`}
            badge={<span className={eqGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{(() => { const p = pctChange(E[n - 1], E[0]); return p === null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`; })()}</span>} />
          <InsightCard icon={CalendarDays} tone="brand" title="Highest Total Assets" value={`IDR ${fmtAmount(A[hiI])}`} sub={`in ${lbl(hiI)}`} />
          <InsightCard icon={CalendarDays} tone="rose" title="Lowest Total Assets" value={`IDR ${fmtAmount(A[loI])}`} sub={`in ${lbl(loI)}`} />
        </Panel>
      </div>
    </div>
  );
}

function MonthlyTable({ m, n, sel, onPick, millions, setMillions }: {
  m: Merged; n: number; sel: number; onPick: (i: number) => void; millions: boolean; setMillions: (v: boolean) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setClosed(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const idx = Array.from({ length: n }, (_, i) => i);
  const fmt = (v: number) => (millions ? fmtMillions(v) : fmtAmount(v));

  const groups = [
    { key: 'a', label: 'Total Assets', v: m.assets, bg: 'bg-emerald-50', text: 'text-emerald-800', children: [m.sec('current_assets'), m.sec('non_current_assets')] },
    { key: 'l', label: 'Total Liabilities', v: m.liabilities, bg: 'bg-rose-50', text: 'text-rose-800', children: [m.sec('current_liabilities'), m.sec('non_current_liabilities')] },
    { key: 'e', label: 'Total Equity', v: m.equity, bg: 'bg-violet-50', text: 'text-violet-800', children: m.sec('equity').lines.map(l => ({ key: l.key, label: l.label, v: l.v })) },
  ];

  const cells = (v: number[], bold?: boolean) => idx.map(i => (
    <td key={i} className={`px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold' : ''} ${i === sel ? 'bg-blue-50 font-semibold text-blue-800' : ''} ${v[i] < -0.004 ? 'text-rose-600' : ''}`}>{fmt(v[i])}</td>
  ));

  return (
    <Panel title={`Monthly Balance Sheet Details (IDR${millions ? ' millions' : ''})`} icon={BarChart3} bodyClass="p-3 pt-2"
      right={
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          Show amount in millions
          <button type="button" role="switch" aria-checked={millions} onClick={() => setMillions(!millions)}
            className={`relative w-9 h-5 rounded-full transition-colors ${millions ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${millions ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </label>
      }>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-semibold px-2.5 py-2">Account Item</th>
              {idx.map(i => (
                <th key={i} onClick={() => onPick(i)} className={`text-right font-semibold px-2.5 py-2 whitespace-nowrap cursor-pointer ${i === sel ? 'bg-blue-600 text-white rounded-t-lg' : 'hover:text-foreground'}`}>
                  {monthLabel(m.dates[i])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const open = !closed.has(g.key);
              return (
                <React.Fragment key={g.key}>
                  <tr className={`${g.bg} cursor-pointer border-t border-white`} onClick={() => toggle(g.key)}>
                    <td className={`px-2.5 py-1.5 font-semibold whitespace-nowrap ${g.text}`}>
                      <span className="inline-flex items-center gap-1">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{g.label}</span>
                    </td>
                    {cells(g.v, true)}
                  </tr>
                  {open && g.children.map(c => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className="pl-7 pr-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{c.label || c.key}</td>
                      {cells(c.v)}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
