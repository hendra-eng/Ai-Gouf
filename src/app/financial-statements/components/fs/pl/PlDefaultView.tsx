'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { BarChart3, Database, FileText, Lightbulb, PieChart } from 'lucide-react';
import { WarningsPanel } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { fmtAmount, fmtDate, todayIso } from '../fsFormat';
import { fmtCompact, pctChange } from '../bs/bsData';
import { BsDropdown, BsToolbar, ChartTooltip, Delta, Panel, filterLabelCls, inputCls, thCls, thRowCls } from '../bs/BsMono';
import { PL_COLORS, margin, monthName, monthPeriod, plMovers, usePlSeries, ym, type PlMerged, type ViewProps } from './plData';
import { Bridge, KpiDelta, NumberedInsights, Num, PctCell, PlKpiRow, PlKpiTile, PlTable, profitSteps, ratioPct, type CellCtx } from './PlUi';
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
            <label className={filterLabelCls}>
              Month
              <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className={`${inputCls} w-44`} />
            </label>
            {filters}
            <span className="text-xs font-medium text-neutral-500">For the month ended {fmtDate(curEnd)}</span>
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
          <PlKpiRow>
            <PlKpiTile label="Total Revenue" icon={Database} value={`IDR ${fmtAmount(m.revenue[CUR])}`}
              sub={<KpiDelta pct={pctChange(m.revenue[CUR], m.revenue[PREV])} suffix={`vs ${lbl(PREV)}`} />}
              pct={ratioPct(m.revenue[CUR], m.revenue[PREV])} pctLabel={`of ${lbl(PREV)}`} />
            <PlKpiTile label="Gross Profit" icon={FileText} value={`IDR ${fmtAmount(m.grossProfit[CUR])}`}
              sub={<KpiDelta pct={pctChange(m.grossProfit[CUR], m.grossProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />}
              pct={margin(m.grossProfit[CUR], m.revenue[CUR])} pctLabel="of revenue" />
            <PlKpiTile label="Operating Profit" icon={BarChart3} value={`IDR ${fmtAmount(m.operatingProfit[CUR])}`}
              sub={<KpiDelta pct={pctChange(m.operatingProfit[CUR], m.operatingProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />}
              pct={margin(m.operatingProfit[CUR], m.revenue[CUR])} pctLabel="of revenue" />
            <PlKpiTile label="Net Profit" icon={PieChart} value={`IDR ${fmtAmount(m.netProfit[CUR])}`}
              sub={<KpiDelta pct={pctChange(m.netProfit[CUR], m.netProfit[PREV])} suffix={`vs ${lbl(PREV)}`} />}
              pct={margin(m.netProfit[CUR], m.revenue[CUR])} pctLabel="of revenue" />
          </PlKpiRow>

          {data && <WarningsPanel mono warnings={data.warnings} />}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <PlTable
              m={m}
              title={<h2 className="text-sm font-semibold text-neutral-900">Profit &amp; Loss</h2>}
              colCount={7}
              glRange={periods[CUR]}
              head={
                <tr className={thRowCls}>
                  <th className={`${thCls} text-left`} />
                  {[
                    [fmtDate(periods[CUR].end), 'Amount (IDR)'], [fmtDate(periods[PREV].end), 'Amount (IDR)'], ['Change', '(IDR)'], ['Change %', ''],
                    [fmtDate(periods[LY].end), 'Amount (IDR)'], ['YoY Change', '(IDR)'], ['YoY %', ''],
                  ].map(([a, b], i) => (
                    <th key={i} className={`${thCls} text-right align-middle`}>
                      <span className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                        <span>{a}</span>
                        {b && <span className="text-[10px] font-medium text-neutral-700">{b}</span>}
                      </span>
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
  const cls = c.level === 'account' ? 'py-1 text-neutral-500' : c.level === 'line' ? 'py-1.5 text-neutral-800' : 'text-neutral-900';
  return (
    <>
      <Num v={v[CUR]} bold={c.bold} className={`${cls} font-semibold`} />
      <Num v={v[PREV]} bold={c.bold} className={cls} />
      <Num v={v[CUR] - v[PREV]} bold={c.bold} className={cls} />
      <PctCell cur={v[CUR]} prev={v[PREV]} upIsGood={c.upIsGood} className={c.level === 'account' ? 'py-1' : ''} />
      <Num v={v[LY]} bold={c.bold} className={cls} />
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
        <BsDropdown align="right" value={metric} onChange={x => setMetric(x as Metric)} options={METRICS.map(x => ({ value: x.id, label: x.label }))} />
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {[{ lbl: prevLbl, i: PREV }, { lbl: lyLbl, i: LY }].map(c => {
          const d = v[CUR] - v[c.i];
          return (
            <div key={c.i} className="rounded-[10px] border border-neutral-300 bg-white p-3 text-center">
              <p className="text-xs font-medium text-neutral-500">vs {c.lbl}</p>
              <p className={`text-lg font-semibold tracking-tight tabular-nums ${d >= 0 ? 'text-neutral-900' : 'text-red-700'}`}>{d >= 0 ? '+' : '-'}IDR {fmtCompact(Math.abs(d))}</p>
              <Delta pct={pctChange(v[CUR], v[c.i])} />
            </div>
          );
        })}
      </div>
      <p className="text-sm font-semibold text-neutral-900 mt-4">{label} Bridge <span className="font-normal text-neutral-500">({prevLbl} → {curLbl})</span></p>
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
        <span className="text-xl font-semibold tracking-tight tabular-nums text-neutral-900">IDR {fmtCompact(m.revenue[CUR])}</span>
        <Delta pct={pctChange(m.revenue[CUR], m.revenue[LY])} suffix={`vs ${lyLbl}`} />
      </div>
      <div className="h-32 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#737373' }} interval={0} tickLine={false} axisLine={false} tickFormatter={(s: string) => s.split(' ')[0]} />
            <Tooltip cursor={{ fill: '#F5F5F5' }} content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
            <Bar dataKey="value" name="Revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.last ? PL_COLORS.brand : '#D4D4D4'} />)}
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