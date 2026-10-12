'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { BarChart3, Database, FileText, Lightbulb, PieChart } from 'lucide-react';
import { WarningsPanel } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { inputCls } from '../PeriodPicker';
import { fmtAmount, fmtDate, todayIso } from '../fsFormat';
import { fmtCompact, pctChange } from '../bs/bsData';
import { ChartTooltip, Delta, KpiCard, KpiRow, Panel } from '../bs/BsUi';
import { BsToolbar } from '../bs/BsToolbar';
import { PL_COLORS, monthName, monthPeriod, plMovers, usePlSeries, ym, type PlMerged, type ViewProps } from './plData';
import { Bridge, NumberedInsights, Num, PctCell, PlTable, profitSteps, type CellCtx } from './PlUi';
import { fmtLongDate, plTemplateReport, todayLong } from '../statementTemplate';

// (a) Profit & Loss default -- 1 bulan vs bulan lalu & bulan yang sama tahun
// lalu, ringkasan varians + bridge laba bersih, trend pendapatan 12 bulan & insight.

const CUR = 0, PREV = 1, LY = 2;
const TREND_START = 3; // index 3..13 = 11 bulan sebelumnya, lalu CUR

type Metric = 'net_profit' | 'operating_profit' | 'gross_profit' | 'revenue';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'net_profit', label: 'Net Profit' },
  { id: 'operating_profit', label: 'Operating Profit' },
  { id: 'gross_profit', label: 'Gross Profit' },
  { id: 'revenue', label: 'Revenue' },
];

export default function PlDefaultView({ clientId, segment, printedBy, filters }: ViewProps) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [y, mo] = ym(month);
  const periods = useMemo(() => [
    monthPeriod(y, mo), monthPeriod(y, mo - 1), monthPeriod(y - 1, mo),
    ...Array.from({ length: 11 }, (_, i) => monthPeriod(y, mo - 11 + i)),
  ], [y, mo]);
  const { data, merged: m, loading, error } = usePlSeries(clientId, periods, segment);
  const company = data?.client.company_name ?? '';

  const lbl = (i: number) => { const [yy, mm] = ym(periods[i].start); return monthName(yy, mm); };
  const curEnd = periods[CUR].end;

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Month
              <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className={`${inputCls} w-44`} />
            </label>
            {filters}
            <span className="text-sm text-muted-foreground">For the month ended {fmtDate(curEnd)}</span>
          </>
        }
        loading={loading}
        exportReady={!!m}
        buildExport={() => plTemplateReport(m!, [CUR], ['Amount (IDR)'], {
          title: 'Profit and Loss Statement', fileBase: `Profit-Loss-${month}`, companyName: company,
          subtitle: `For the Month Ended ${fmtLongDate(curEnd)}`, printedBy,
          meta: [['Report Date', todayLong()], ['Currency', 'Indonesian Rupiah (IDR)'], ['Period', `${fmtLongDate(periods[CUR].start)} – ${fmtLongDate(curEnd)}`], ...(segment ? [[segment.type, segment.value] as [string, string]] : [])],
        })}
      />

      {error && <ErrorBlock message={error} />}
      {loading && !m && <LoadingBlock />}
      {m && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <KpiRow>
            <KpiCard label="Total Revenue" icon={Database} tone="brand" value={`IDR ${fmtAmount(m.revenue[CUR])}`}
              delta={<Delta pct={pctChange(m.revenue[CUR], m.revenue[PREV])} suffix={`vs ${lbl(PREV)}`} />} />
            <KpiCard label="Gross Profit" icon={FileText} tone="rose" value={`IDR ${fmtAmount(m.grossProfit[CUR])}`}
              delta={<Delta pct={pctChange(m.grossProfit[CUR], m.grossProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />} />
            <KpiCard label="Operating Profit" icon={BarChart3} tone="sky" value={`IDR ${fmtAmount(m.operatingProfit[CUR])}`}
              delta={<Delta pct={pctChange(m.operatingProfit[CUR], m.operatingProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />} />
            <KpiCard label="Net Profit" icon={PieChart} tone="violet" value={`IDR ${fmtAmount(m.netProfit[CUR])}`}
              delta={<Delta pct={pctChange(m.netProfit[CUR], m.netProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />} />
          </KpiRow>

          {data && <WarningsPanel warnings={data.warnings} />}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <PlTable
              m={m}
              title={<h2 className="text-lg font-bold text-foreground">Profit &amp; Loss</h2>}
              colCount={7}
              glRange={periods[CUR]}
              head={
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-left font-semibold px-3 py-2" />
                  {[
                    [fmtDate(periods[CUR].end), 'Amount (IDR)'], [fmtDate(periods[PREV].end), 'Amount (IDR)'], ['Change', '(IDR)'], ['Change %', ''],
                    [fmtDate(periods[LY].end), 'Amount (IDR)'], ['YoY Change', '(IDR)'], ['YoY %', ''],
                  ].map(([a, b], i) => (
                    <th key={i} className={`text-right font-semibold px-3 py-2 whitespace-nowrap align-bottom ${i === 4 ? 'border-l border-slate-200' : ''}`}>
                      <span className="block text-foreground">{a}</span>
                      {b && <span className="block font-normal">{b}</span>}
                    </th>
                  ))}
                </tr>
              }
              cells={(v, c) => <ValueCells v={v} c={c} />}
            />
            <div className="space-y-5">
              <VarianceSummary m={m} prevLbl={lbl(PREV)} lyLbl={lbl(LY)} curLbl={lbl(CUR)} />
              <RevenueTrend m={m} periods={periods} lyLbl={lbl(LY)} />
              <Panel title="Key Insights" icon={Lightbulb} tone="amber">
                <NumberedInsights items={insights(m, lbl(PREV), lbl(LY))} />
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ValueCells({ v, c }: { v: number[]; c: CellCtx }) {
  const cls = c.level === 'account' ? 'py-1 text-muted-foreground' : c.level === 'line' ? 'py-1.5 text-foreground/85' : c.level === 'subtotal' ? 'text-blue-800' : 'text-foreground';
  return (
    <>
      <Num v={v[CUR]} bold={c.bold} className={`${cls} font-semibold`} />
      <Num v={v[PREV]} bold={c.bold} className={cls} />
      <Num v={v[CUR] - v[PREV]} bold={c.bold} className={cls} />
      <PctCell cur={v[CUR]} prev={v[PREV]} upIsGood={c.upIsGood} className={c.level === 'account' ? 'py-1' : ''} />
      <Num v={v[LY]} bold={c.bold} className={`${cls} border-l border-slate-100`} />
      <Num v={v[CUR] - v[LY]} bold={c.bold} className={cls} />
      <PctCell cur={v[CUR]} prev={v[LY]} upIsGood={c.upIsGood} className={c.level === 'account' ? 'py-1' : ''} />
    </>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────

function VarianceSummary({ m, prevLbl, lyLbl, curLbl }: { m: PlMerged; prevLbl: string; lyLbl: string; curLbl: string }) {
  const [metric, setMetric] = useState<Metric>('net_profit');
  const v = metric === 'revenue' ? m.revenue : m.sub(metric);
  const label = METRICS.find(x => x.id === metric)!.label;

  const steps = metric === 'revenue'
    ? (() => {
      const movers = plMovers(m, ['revenue'], PREV, CUR, 3);
      const other = (v[CUR] - v[PREV]) - movers.reduce((t, x) => t + x.delta, 0);
      return [...movers.map(x => ({ name: x.label, delta: x.delta })), { name: 'Other', delta: other }];
    })()
    : profitSteps(m, PREV, CUR, metric);

  return (
    <Panel
      title="Variance Summary"
      right={
        <select value={metric} onChange={e => setMetric(e.target.value as Metric)} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white">
          {METRICS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {[{ lbl: prevLbl, i: PREV }, { lbl: lyLbl, i: LY }].map(c => {
          const d = v[CUR] - v[c.i];
          return (
            <div key={c.i} className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">vs {c.lbl}</p>
              <p className={`text-lg font-bold tabular-nums ${d >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{d >= 0 ? '+' : '-'}IDR {fmtCompact(Math.abs(d))}</p>
              <Delta pct={pctChange(v[CUR], v[c.i])} />
            </div>
          );
        })}
      </div>
      <p className="text-sm font-semibold text-foreground mt-4">{label} Bridge <span className="font-normal text-muted-foreground">({prevLbl} → {curLbl})</span></p>
      <Bridge startLabel={`${prevLbl}`} start={v[PREV]} steps={steps} endLabel={`${curLbl}`} end={v[CUR]} />
    </Panel>
  );
}

function RevenueTrend({ m, periods, lyLbl }: { m: PlMerged; periods: { start: string }[]; lyLbl: string }) {
  const idx = [...Array.from({ length: 11 }, (_, i) => TREND_START + i), CUR];
  const data = idx.map(i => { const [yy, mm] = ym(periods[i].start); return { name: monthName(yy, mm), value: m.revenue[i], last: i === CUR }; });
  return (
    <Panel title="Revenue Trend" icon={BarChart3}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-bold text-foreground">IDR {fmtCompact(m.revenue[CUR])}</span>
        <Delta pct={pctChange(m.revenue[CUR], m.revenue[LY])} suffix={`vs ${lyLbl}`} />
      </div>
      <div className="h-32 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} interval={0} tickLine={false} axisLine={false} tickFormatter={(s: string) => s.split(' ')[0]} />
            <Tooltip cursor={{ fill: '#F1F5F9' }} content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
            <Bar dataKey="value" name="Revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.last ? PL_COLORS.brand : '#BBF7D0'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function insights(m: PlMerged, prevLbl: string, lyLbl: string): string[] {
  const out: string[] = [];
  const pct = (a: number, b: number) => { const p = pctChange(a, b); return p === null ? '' : `${Math.abs(p).toFixed(1)}% `; };
  const np = m.netProfit, rev = m.revenue;
  const dNp = np[CUR] - np[PREV];
  if (Math.abs(dNp) >= 0.5) {
    const drivers = profitSteps(m, PREV, CUR, 'net_profit').filter(s => Math.sign(s.delta) === Math.sign(dNp) && Math.abs(s.delta) >= 0.5)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2).map(s => s.name.toLowerCase());
    out.push(`Net profit ${dNp >= 0 ? 'increased' : 'decreased'} by ${pct(np[CUR], np[PREV])}(IDR ${fmtCompact(Math.abs(dNp), 1)}) compared to ${prevLbl}${drivers.length ? `, mainly due to ${drivers.join(' and ')}` : ''}.`);
  } else {
    out.push(`Net profit is unchanged from ${prevLbl}.`);
  }
  const dR = rev[CUR] - rev[PREV];
  const top = plMovers(m, ['revenue'], PREV, CUR, 1)[0];
  out.push(Math.abs(dR) >= 0.5
    ? `Revenue ${dR >= 0 ? 'increased' : 'decreased'} by ${pct(rev[CUR], rev[PREV])}(IDR ${fmtCompact(Math.abs(dR), 1)}) month-over-month${top ? `, led by ${top.label}` : ''}.`
    : `Revenue is flat month-over-month at IDR ${fmtCompact(rev[CUR])}.`);
  const dY = np[CUR] - np[LY];
  const gm = Math.abs(rev[CUR]) < 0.005 ? null : (m.grossProfit[CUR] / rev[CUR]) * 100;
  out.push(`Compared to ${lyLbl}, net profit is ${dY >= 0 ? 'higher' : 'lower'} by ${pct(np[CUR], np[LY])}(IDR ${fmtCompact(Math.abs(dY), 1)})${gm !== null ? `; gross margin this month is ${gm.toFixed(1)}%` : ''}.`);
  return out;
}
