'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { BarChart3, Database, PieChart as PieIcon, TrendingUp } from 'lucide-react';
import { WarningsPanel } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { fmtAmount, fmtDate, todayIso } from '../fsFormat';
import { fmtCompact, pctChange } from '../bs/bsData';
import { BsToolbar, ChartTooltip, Delta, Panel, Select } from '../bs/BsMono';
import { PL_COLORS, margin, usePlSeries, yearPeriod, type Period, type PlMerged, type ViewProps } from './plData';
import { KpiDelta, PlKpiRow, PlKpiTile, ratioPct } from './PlUi';
import { fmtLongDate, plTemplateReport, todayLong } from '../statementTemplate';

// (d) Profit & Loss gross profit vs net profit -- dua kolom (Pendapatan s.d.
// Laba Kotor | Beban s.d. Laba Bersih) untuk 1 tahun / YTD, komposisi
// pendapatan (donut) & trend laba bersih 5 tahun.

type Span = 'year' | 'ytd';
const DONUT = ['#2563EB', '#0D9488', '#F59E0B', '#7C3AED', '#0EA5E9', '#CBD5E1'];
const CUR = 0, LY = 1, YEARS = 2; // index 2..5 = 4 tahun penuh sebelumnya (y-4..y-1)

export default function PlGrossNetView({ clientId, segment, printedBy, filters }: ViewProps) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [span, setSpan] = useState<Span>('year');

  const periods = useMemo<Period[]>(() => {
    const cur = yearPeriod(year);
    const ly = yearPeriod(year - 1);
    if (span === 'ytd') {
      // YTD s.d. hari ini (tahun berjalan) atau s.d. tanggal yang sama (tahun lalu).
      const md = year === thisYear ? today.slice(5) : '12-31';
      cur.end = `${year}-${md}`;
      ly.end = md === '02-29' ? `${year - 1}-02-28` : `${year - 1}-${md}`;
    }
    return [cur, ly, ...[4, 3, 2, 1].map(k => yearPeriod(year - k))];
  }, [year, span, today, thisYear]);
  const { data, merged: m, loading, error } = usePlSeries(clientId, periods, segment);
  const company = data?.client.company_name ?? '';
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const endLbl = fmtDate(periods[CUR].end);
  const lyLbl = fmtDate(periods[LY].end);
  const caption = span === 'ytd' ? `Year to date, ended ${endLbl}` : `For the year ended ${endLbl}`;

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
              Year
              <div className="w-28"><Select value={year} onChange={v => setYear(Number(v))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
              Period
              <div className="w-40"><Select value={span} onChange={v => setSpan(v as Span)}><option value="year">Full year</option><option value="ytd">Year to date</option></Select></div>
            </label>
            {filters}
            <span className="text-xs font-medium text-neutral-600">{caption}</span>
          </>
        }
        loading={loading}
        exportReady={!!m}
        buildExport={() => plTemplateReport(m!, [CUR, LY], [endLbl, lyLbl], {
          title: 'Profit and Loss Statement', fileBase: `Profit-Loss-${year}${span === 'ytd' ? '-YTD' : ''}`, companyName: company,
          subtitle: caption, printedBy,
          meta: [['Report Date', todayLong()], ['Currency', 'Indonesian Rupiah (IDR)'], ['Period', `${fmtLongDate(periods[CUR].start)} – ${fmtLongDate(periods[CUR].end)}`], ...(segment ? [[segment.type, segment.value] as [string, string]] : [])],
          extra: [{ header: 'Variance', values: v => v[CUR] - v[LY] }],
        })}
      />
      {error && <ErrorBlock message={error} />}
      {loading && !m && <LoadingBlock />}
      {m && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          {data && <WarningsPanel mono warnings={data.warnings} />}
          <Body m={m} lyLbl={lyLbl} year={year} />
        </div>
      )}
    </div>
  );
}

function Body({ m, lyLbl, year }: { m: PlMerged; lyLbl: string; year: number }) {
  const sfx = `vs ${lyLbl}`;
  const gm = margin(m.grossProfit[CUR], m.revenue[CUR]);
  const nm = margin(m.netProfit[CUR], m.revenue[CUR]);

  // Komposisi pendapatan: 4 baris terbesar (revenue + other income) + lainnya.
  const comp = useMemo(() => {
    const lines = [...m.sec('revenue').lines, ...m.sec('other_net').lines.filter(l => !l.key.startsWith('x_'))]
      .map(l => ({ name: l.label, value: l.v[CUR] })).filter(l => l.value > 0.5).sort((a, b) => b.value - a.value);
    const top = lines.slice(0, 4);
    const rest = lines.slice(4).reduce((t, l) => t + l.value, 0);
    return rest > 0.5 ? [...top, { name: 'Other', value: rest }] : top;
  }, [m]);
  const compTotal = comp.reduce((t, c) => t + c.value, 0);

  const trend = [YEARS, YEARS + 1, YEARS + 2, YEARS + 3, CUR].map((i, k) => ({ name: String(year - 4 + k), value: m.netProfit[i], last: k === 4 }));

  return (
    <div className="space-y-5">
      <PlKpiRow>
        <PlKpiTile label="Total Revenue" icon={Database} value={`IDR ${fmtAmount(m.revenue[CUR])}`}
          sub={<KpiDelta pct={pctChange(m.revenue[CUR], m.revenue[LY])} suffix={sfx} />}
          pct={ratioPct(m.revenue[CUR], m.revenue[LY])} pctLabel={`of ${lyLbl}`} />
        <PlKpiTile label="Gross Profit" icon={BarChart3} value={`IDR ${fmtAmount(m.grossProfit[CUR])}`}
          sub={<KpiDelta pct={pctChange(m.grossProfit[CUR], m.grossProfit[LY])} suffix={sfx} />}
          pct={gm} pctLabel="of revenue" />
        <PlKpiTile label="Operating Profit" icon={TrendingUp} value={`IDR ${fmtAmount(m.operatingProfit[CUR])}`}
          sub={<KpiDelta pct={pctChange(m.operatingProfit[CUR], m.operatingProfit[LY])} suffix={sfx} />}
          pct={margin(m.operatingProfit[CUR], m.revenue[CUR])} pctLabel="of revenue" />
        <PlKpiTile label="Net Profit" icon={PieIcon} value={`IDR ${fmtAmount(m.netProfit[CUR])}`}
          sub={<KpiDelta pct={pctChange(m.netProfit[CUR], m.netProfit[LY])} suffix={sfx} />}
          pct={nm} pctLabel="of revenue" />
      </PlKpiRow>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px] gap-5 items-stretch">
        <Panel title="Income" icon={TrendingUp} tone="brand" right={<span className="text-xs font-medium text-neutral-500">Amount (IDR)</span>} className="flex flex-col" bodyClass="p-4 pt-3 flex-1 flex flex-col">
          <div className="space-y-4 flex-1">
            <Block m={m} sec="revenue" total="Total Revenue" />
            <Block m={m} sec="cost_of_sales" total="Total Cost of Sales" />
          </div>
          <BigTotal label="Gross Profit" v={m.grossProfit[CUR]} note={gm === null ? undefined : `Gross margin ${gm.toFixed(1)}%`} />
        </Panel>

        <Panel title="Expenses & Profitability" icon={BarChart3} tone="rose" right={<span className="text-xs font-medium text-neutral-500">Amount (IDR)</span>} className="flex flex-col" bodyClass="p-4 pt-3 flex-1 flex flex-col">
          <div className="space-y-3 flex-1">
            <Block m={m} sec="operating_expenses" total="Total Operating Expenses" />
            <BigTotal label="Operating Profit" v={m.operatingProfit[CUR]} small />
            <Block m={m} sec="other_net" total="Net Other Income / (Expense)" />
            <div className="rounded-[10px] border border-neutral-200 bg-neutral-50">
              <Row label="Profit Before Tax" v={m.pbt[CUR]} bold />
              <Row label="Income Tax Expense" v={-m.tax[CUR]} />
            </div>
          </div>
          <BigTotal label="Net Profit" v={m.netProfit[CUR]} note={nm === null ? undefined : `Net margin ${nm.toFixed(1)}%`} />
        </Panel>

        <div className="lg:col-span-2 2xl:col-span-1 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-5 content-start">
          <Panel title="Revenue Composition">
            {comp.length === 0 ? <p className="text-xs font-medium text-neutral-600 py-8 text-center">No revenue in this period.</p> : (
              <>
                <div className="relative h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={comp} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                        {comp.map((c, i) => <Cell key={c.name} fill={c.name === 'Other' ? DONUT[5] : DONUT[i]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-semibold text-neutral-500">IDR</span>
                    <span className="text-lg font-semibold tracking-tight tabular-nums text-neutral-900">{fmtCompact(compTotal)}</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {comp.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.name === 'Other' ? DONUT[5] : DONUT[i] }} />
                      <span className="text-neutral-800 truncate">{c.name}</span>
                      <span className="ml-auto tabular-nums text-neutral-500">{((c.value / compTotal) * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Net Profit Trend" icon={BarChart3}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xl font-semibold tracking-tight tabular-nums text-neutral-900">IDR {fmtCompact(m.netProfit[CUR])}</span>
              <Delta pct={pctChange(m.netProfit[CUR], m.netProfit[LY])} suffix={`vs ${year - 1}`} />
            </div>
            <div className="h-28 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: '#F5F5F5' }} content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
                  <Bar dataKey="value" name="Net Profit" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                    {trend.map((d, i) => <Cell key={i} fill={d.value < 0 ? '#F87171' : d.last ? PL_COLORS.brand : PL_COLORS.muted} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 text-sm ${bold ? 'font-semibold text-neutral-900' : 'text-neutral-800'}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${v < -0.004 ? 'text-red-700' : ''}`}>{fmtAmount(v)}</span>
    </div>
  );
}

function Block({ m, sec, total }: { m: PlMerged; sec: string; total: string }) {
  const s = m.sec(sec);
  return (
    <div>
      <div className="rounded-md bg-neutral-300 px-3 py-2 text-xs font-bold text-black">{s.label}</div>
      {s.lines.length === 0 ? <p className="px-3 py-2 text-xs italic text-neutral-500">No transactions</p> : (
        <ul className="divide-y divide-neutral-200">
          {s.lines.map(l => (
            <li key={l.key} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-neutral-800">{l.label}</span>
              <span className={`tabular-nums ${l.v[CUR] < -0.004 ? 'text-red-700' : 'text-neutral-800'}`}>{fmtAmount(l.v[CUR])}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex items-center justify-between rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2">
        <span className="font-semibold text-neutral-900 text-sm">{total}</span>
        <span className={`font-bold tabular-nums text-sm ${s.v[CUR] < -0.004 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtAmount(s.v[CUR])}</span>
      </div>
    </div>
  );
}

function BigTotal({ label, v, note, small }: { label: string; v: number; note?: string; small?: boolean }) {
  return (
    <div className={`${small ? '' : 'mt-4'} flex items-center justify-between rounded-[10px] border border-neutral-800 bg-neutral-200 px-4 ${small ? 'py-2.5' : 'py-3.5'}`}>
      <div>
        <span className={`font-bold text-neutral-900 ${small ? 'text-sm' : 'text-base'}`}>{label}</span>
        {note && <span className="block text-xs font-medium text-neutral-500">{note}</span>}
      </div>
      <span className={`font-bold tabular-nums ${small ? 'text-sm' : 'text-lg'} ${v < -0.004 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtAmount(v)}</span>
    </div>
  );
}