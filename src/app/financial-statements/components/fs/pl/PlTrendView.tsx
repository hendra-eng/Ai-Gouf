'use client';

import React, { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Database, FileText, Lightbulb, LineChart, Trophy } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { Select } from '../PeriodPicker';
import { fmtAmount, todayIso } from '../fsFormat';
import { fmtCompact, fmtMillions, pctChange } from '../bs/bsData';
import { ChartTooltip, Delta, EmptyData, InsightCard, KpiCard, KpiRow, Legend, Panel } from '../bs/BsUi';
import { BsToolbar } from '../bs/BsToolbar';
import { PL_COLORS, monthName, monthPeriod, usePlSeries, type Period, type PlMerged, type ViewProps } from './plData';
import { plTemplateReport, todayLong } from '../statementTemplate';

// (b) Profit & Loss Trend -- kinerja bulanan sepanjang 1 tahun + rata-rata
// vs tahun sebelumnya, grafik garis, insight & tabel rincian bulanan.

const avg = (a: number[]) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);

export default function PlTrendView({ clientId, segment, printedBy, filters }: ViewProps) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [millions, setMillions] = useState(true);
  const [picked, setPicked] = useState<number | null>(null);

  // Bulan tahun berjalan dipotong s.d. bulan ini; 12 bulan tahun lalu untuk pembanding rata-rata.
  const { cur, periods } = useMemo(() => {
    const cur: Period[] = [];
    for (let mo = 1; mo <= 12; mo++) {
      const p = monthPeriod(year, mo);
      if (p.start > today) break;
      cur.push(p);
    }
    const prev = Array.from({ length: 12 }, (_, i) => monthPeriod(year - 1, i + 1));
    return { cur, periods: [...cur, ...prev] };
  }, [year, today]);
  const { data, merged: m, loading, error } = usePlSeries(clientId, periods, segment, cur.length > 0);
  const n = cur.length;
  const sel = picked !== null && picked < n ? picked : n - 1;
  const company = data?.client.company_name ?? '';
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const label = (p: Period) => monthName(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)));

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Year
              <div className="w-28"><Select value={year} onChange={v => { setYear(Number(v)); setPicked(null); }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
            </label>
            {filters}
            <span className="text-sm text-muted-foreground">Monthly performance across {n || 12} months · IDR</span>
          </>
        }
        loading={loading}
        exportReady={!!m && n > 0}
        buildExport={() => plTemplateReport(m!, cur.map((_, i) => i), cur.map(label), {
          title: 'Profit and Loss Trend', fileBase: `Profit-Loss-Trend-${year}`, companyName: company,
          subtitle: `Monthly performance, ${year}`, printedBy,
          meta: [['Report Date', todayLong()], ['Currency', 'Indonesian Rupiah (IDR)'], ...(segment ? [[segment.type, segment.value] as [string, string]] : [])],
          extra: [{ header: `Total ${year}`, values: v => v.slice(0, n).reduce((t, x) => t + x, 0) }],
        })}
      />

      {n === 0 && <EmptyData text={`${year} has not started yet.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && n > 0 && <LoadingBlock />}
      {m && n > 0 && (
        <div className={loading ? 'opacity-60' : ''}>
          <TrendBody m={m} n={n} sel={sel} onPick={setPicked} year={year} millions={millions} setMillions={setMillions} label={i => label(periods[i])} />
        </div>
      )}
    </div>
  );
}

function TrendBody({ m, n, sel, onPick, year, millions, setMillions, label }: {
  m: PlMerged; n: number; sel: number; onPick: (i: number) => void; year: number; millions: boolean; setMillions: (v: boolean) => void; label: (i: number) => string;
}) {
  const curIdx = Array.from({ length: n }, (_, i) => i);
  const prevIdx = Array.from({ length: 12 }, (_, i) => n + i);
  const pick = (arr: number[], idx: number[]) => idx.map(i => arr[i]);
  const R = pick(m.revenue, curIdx), GP = pick(m.grossProfit, curIdx), OP = pick(m.operatingProfit, curIdx), NP = pick(m.netProfit, curIdx), EX = pick(m.expenses, curIdx);
  const sfx = `vs ${year - 1}`;
  const bestI = NP.indexOf(Math.max(...NP));
  const hiR = R.indexOf(Math.max(...R));

  // Perubahan bulan-ke-bulan pendapatan (Januari dibanding Desember tahun lalu).
  const moves = curIdx.map(i => {
    const before = i === 0 ? m.revenue[n + 11] : R[i - 1];
    return { i, from: i === 0 ? label(n + 11) : label(i - 1), d: R[i] - before, p: pctChange(R[i], before) };
  });
  const none = { i: -1, from: '', d: 0, p: null as number | null };
  const up = moves.reduce((b, x) => (x.d > b.d ? x : b), none);
  const down = moves.reduce((b, x) => (x.d < b.d ? x : b), none);
  const npGrowth = NP[n - 1] - NP[0];
  const npPct = pctChange(NP[n - 1], NP[0]);

  const chart = curIdx.map(i => ({ name: label(i), Revenue: R[i], 'Operating Expense': EX[i], 'Net Profit': NP[i] }));

  return (
    <div className="space-y-5">
      <KpiRow>
        <KpiCard label="Average Monthly Revenue" icon={Database} tone="brand" value={`IDR ${fmtAmount(avg(R))}`} delta={<Delta pct={pctChange(avg(R), avg(pick(m.revenue, prevIdx)))} suffix={sfx} />} />
        <KpiCard label="Average Gross Profit" icon={FileText} tone="rose" value={`IDR ${fmtAmount(avg(GP))}`} delta={<Delta pct={pctChange(avg(GP), avg(pick(m.grossProfit, prevIdx)))} suffix={sfx} />} />
        <KpiCard label="Average Operating Profit" icon={BarChart3} tone="sky" value={`IDR ${fmtAmount(avg(OP))}`} delta={<Delta pct={pctChange(avg(OP), avg(pick(m.operatingProfit, prevIdx)))} suffix={sfx} />} />
        <KpiCard label="Best Month (Net Profit)" icon={Trophy} tone="violet" value={label(bestI)}
          delta={<div className="flex items-center gap-3 flex-wrap"><span className="text-xs text-foreground tabular-nums">IDR {fmtAmount(NP[bestI])}</span><Delta pct={pctChange(NP[bestI], NP[0])} suffix={`vs ${label(0)}`} /></div>} />
      </KpiRow>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Panel title="Profit & Loss Trend (IDR)" icon={LineChart}
            right={<Legend items={[{ label: 'Revenue', color: PL_COLORS.revenue }, { label: 'Operating Expense', color: PL_COLORS.expense }, { label: 'Net Profit', color: PL_COLORS.profit }]} />}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  onClick={(e: { activeTooltipIndex?: number } | null) => { if (e && typeof e.activeTooltipIndex === 'number') onPick(e.activeTooltipIndex); }}>
                  <defs>
                    {[['plR', PL_COLORS.revenue], ['plE', PL_COLORS.expense], ['plN', PL_COLORS.profit]].map(([id, c]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={0.18} /><stop offset="100%" stopColor={c} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCompact(v, 1)} />
                  <Tooltip content={<ChartTooltip fmt={v => fmtAmount(v)} />} />
                  <ReferenceLine x={chart[sel]?.name} stroke={PL_COLORS.brand} strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="Revenue" stroke="none" fill="url(#plR)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Area type="monotone" dataKey="Operating Expense" stroke="none" fill="url(#plE)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Area type="monotone" dataKey="Net Profit" stroke="none" fill="url(#plN)" isAnimationActive={false} legendType="none" tooltipType="none" />
                  <Line type="monotone" dataKey="Revenue" stroke={PL_COLORS.revenue} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Operating Expense" stroke={PL_COLORS.expense} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Net Profit" stroke={PL_COLORS.profit} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Operating Expense = Cost of Sales + Operating Expenses. Click a month on the chart to highlight it in the table.</p>
          </Panel>

          <MonthlyTable m={m} n={n} sel={sel} onPick={onPick} millions={millions} setMillions={setMillions} label={label} />
        </div>

        <Panel title="Insights" icon={Lightbulb} tone="sky" bodyClass="p-4 space-y-3">
          <InsightCard icon={ArrowUpRight} tone="brand" title="Largest Revenue Increase"
            value={up.i < 0 ? 'No increase' : `+ IDR ${fmtAmount(up.d)}`} sub={up.i < 0 ? undefined : `from ${up.from} to ${label(up.i)}`}
            badge={up.i < 0 || up.p === null ? null : <span className="text-emerald-600">+{up.p.toFixed(1)}%</span>} />
          <InsightCard icon={ArrowDownRight} tone="rose" title="Largest Revenue Decrease"
            value={down.i < 0 ? 'No decrease' : `- IDR ${fmtAmount(Math.abs(down.d))}`} sub={down.i < 0 ? undefined : `from ${down.from} to ${label(down.i)}`}
            badge={down.i < 0 || down.p === null ? null : <span className="text-rose-600">{down.p.toFixed(1)}%</span>} />
          <InsightCard icon={BarChart3} tone="sky" title={npGrowth >= 0 ? 'Net Profit Growth' : 'Net Profit Decline'}
            value={`${npGrowth >= 0 ? '+' : '-'} IDR ${fmtAmount(Math.abs(npGrowth))}`} sub={`from ${label(0)} to ${label(n - 1)}`}
            badge={npPct === null ? null : <span className={npGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{npPct > 0 ? '+' : ''}{npPct.toFixed(1)}%</span>} />
          <InsightCard icon={Trophy} tone="violet" title="Highest Revenue" value={`IDR ${fmtAmount(R[hiR])}`} sub={`in ${label(hiR)}`} />
          <InsightCard icon={CalendarDays} tone="rose" title="Highest Net Profit" value={`IDR ${fmtAmount(NP[bestI])}`} sub={`in ${label(bestI)}`} />
        </Panel>
      </div>
    </div>
  );
}

function MonthlyTable({ m, n, sel, onPick, millions, setMillions, label }: {
  m: PlMerged; n: number; sel: number; onPick: (i: number) => void; millions: boolean; setMillions: (v: boolean) => void; label: (i: number) => string;
}) {
  const idx = Array.from({ length: n }, (_, i) => i);
  const fmt = (v: number) => (millions ? fmtMillions(v) : fmtAmount(v));
  const rows = [
    { label: 'Revenue', v: m.revenue, color: PL_COLORS.revenue },
    { label: 'Cost of Sales', v: m.cogs, color: PL_COLORS.expense },
    { label: 'Gross Profit', v: m.grossProfit, color: PL_COLORS.brand, hl: true },
    { label: 'Operating Expenses', v: m.opex, color: PL_COLORS.amber },
    { label: 'Operating Profit', v: m.operatingProfit, color: PL_COLORS.sky },
    { label: 'Other Income / (Expense)', v: m.otherNet, color: PL_COLORS.muted },
    { label: 'Income Tax', v: m.tax, color: '#64748B' },
    { label: 'Net Profit', v: m.netProfit, color: PL_COLORS.profit, hl: true },
  ];

  return (
    <Panel title={`Monthly Profit & Loss Details (IDR${millions ? ' millions' : ''})`} icon={BarChart3} bodyClass="p-3 pt-2"
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
                  {label(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className={`border-t border-slate-100 ${r.hl ? 'bg-blue-50/60' : ''}`}>
                <td className={`px-2.5 py-2 whitespace-nowrap ${r.hl ? 'font-semibold text-foreground' : 'text-foreground/85'}`}>
                  <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{r.label}</span>
                </td>
                {idx.map(i => (
                  <td key={i} className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap ${r.hl ? 'font-semibold' : ''} ${i === sel ? 'bg-blue-50 font-semibold text-blue-800' : ''} ${r.v[i] < -0.004 ? 'text-rose-600' : ''}`}>
                    {fmt(r.v[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
