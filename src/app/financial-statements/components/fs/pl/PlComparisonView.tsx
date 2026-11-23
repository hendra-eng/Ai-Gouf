'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Database, FileText, Percent } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { fmtAmount, todayIso } from '../fsFormat';
import { fmtCompact, pctChange } from '../bs/bsData';
import { BsToolbar, ChartTooltip, EmptyData, Legend, Panel, Select, thCls, thRowCls, yearAsOf } from '../bs/BsMono';
import { PL_COLORS, margin, quarterPeriod, usePlSeries, type Period, type PlMerged, type ViewProps } from './plData';
import { KpiDelta, Num, PlKpiRow, PlKpiTile, PlTable, ratioPct, type CellCtx } from './PlUi';
import { plTemplateReport, todayLong } from '../statementTemplate';

// (c) Profit & Loss Comparison -- per kuartal dalam 1 tahun buku, grafik
// batang per kuartal, dan varians kuartal terakhir vs basis pembanding.

type Basis = 'previous_quarter' | 'same_quarter_last_year';
const BASES: { id: Basis; label: string }[] = [
  { id: 'previous_quarter', label: 'vs Previous Quarter' },
  { id: 'same_quarter_last_year', label: 'vs Same Quarter Last Year' },
];

export default function PlComparisonView({ clientId, segment, printedBy, filters }: ViewProps) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [basis, setBasis] = useState<Basis>('previous_quarter');

  // index 0..qn-1 = kuartal FY yang sudah mulai; qn..qn+3 = Q1..Q4 tahun lalu.
  const { periods, qn, labels } = useMemo(() => {
    const cur: Period[] = [];
    const labels: string[] = [];
    for (let q = 1; q <= 4; q++) {
      const p = quarterPeriod(year, q);
      if (p.start > today) break;
      cur.push(p);
      labels.push(`Q${q} ${year}${p.end > today ? ' (to date)' : ''}`);
    }
    const prev = [1, 2, 3, 4].map(q => quarterPeriod(year - 1, q));
    return { periods: [...cur, ...prev], qn: cur.length, labels };
  }, [year, today]);

  const L = qn - 1;
  const B = basis === 'previous_quarter' ? (qn <= 1 ? qn + 3 : qn - 2) : qn + L;
  const basisLabel = basis === 'previous_quarter' ? (qn <= 1 ? `Q4 ${year - 1}` : `Q${qn - 1} ${year}`) : `Q${qn} ${year - 1}`;

  const { data, merged: m, loading, error } = usePlSeries(clientId, periods, segment, qn > 0);
  const company = data?.client.company_name ?? '';
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
              Fiscal Year
              <div className="w-28"><Select value={year} onChange={v => setYear(Number(v))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
              Comparison Basis
              <div className="w-56"><Select value={basis} onChange={v => setBasis(v as Basis)}>{BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
            </label>
            {filters}
          </>
        }
        loading={loading}
        exportReady={!!m && qn > 0}
        templateSheet={{ sheet: 'PNL CF', asOf: yearAsOf(year) }}
        buildExport={() => plTemplateReport(m!, Array.from({ length: qn }, (_, i) => i), labels, {
          title: 'Profit and Loss Comparison', fileBase: `Profit-Loss-Comparison-FY${year}`, companyName: company,
          subtitle: `Quarterly view – FY${year}, variance Q${qn} vs ${basisLabel}`, printedBy,
          meta: [['Report Date', todayLong()], ['Currency', 'Indonesian Rupiah (IDR)'], ...(segment ? [[segment.type, segment.value] as [string, string]] : [])],
          extra: [{ header: `Variance vs ${basisLabel}`, values: v => v[L] - v[B] }],
        })}
      />

      {qn === 0 && <EmptyData text={`FY${year} has not started yet.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && qn > 0 && <LoadingBlock />}
      {m && qn > 0 && (
        <div className={loading ? 'opacity-60' : ''}>
          <ComparisonBody m={m} qn={qn} B={B} labels={labels} basisLabel={basisLabel} year={year} glRange={{ start: periods[0].start, end: periods[qn - 1].end }} />
        </div>
      )}
    </div>
  );
}

function ComparisonBody({ m, qn, B, labels, basisLabel, year, glRange }: {
  m: PlMerged; qn: number; B: number; labels: string[]; basisLabel: string; year: number; glRange: { start: string; end: string };
}) {
  const L = qn - 1;
  const sum = (v: number[], from: number, count: number) => v.slice(from, from + count).reduce((t, x) => t + x, 0);
  const ytd = (v: number[]) => sum(v, 0, qn);
  const lyYtd = (v: number[]) => sum(v, qn, qn); // kuartal yang sama tahun lalu
  const lyLbl = qn === 4 ? `FY${year - 1}` : `Q1–Q${qn} ${year - 1}`;
  const sfx = `vs ${lyLbl}`;
  const dNp = m.netProfit[L] - m.netProfit[B];

  const chart = labels.map((l, i) => ({
    name: l,
    Revenue: m.revenue[i],
    'Expenses / Cost Base': m.revenue[i] + m.otherIncome[i] - m.netProfit[i],
    'Net Profit': m.netProfit[i],
  }));
  const series = [
    { key: 'Revenue', color: PL_COLORS.revenue },
    { key: 'Expenses / Cost Base', color: PL_COLORS.expense },
    { key: 'Net Profit', color: PL_COLORS.profit },
  ];

  return (
    <div className="space-y-5">
      <PlKpiRow>
        <PlKpiTile label={`Total Revenue${qn < 4 ? ' (YTD)' : ''}`} icon={Database} value={`IDR ${fmtAmount(ytd(m.revenue))}`}
          sub={<KpiDelta pct={pctChange(ytd(m.revenue), lyYtd(m.revenue))} suffix={sfx} />}
          pct={ratioPct(ytd(m.revenue), lyYtd(m.revenue))} pctLabel={`of ${lyLbl}`} />
        <PlKpiTile label={`Gross Profit${qn < 4 ? ' (YTD)' : ''}`} icon={FileText} value={`IDR ${fmtAmount(ytd(m.grossProfit))}`}
          sub={<KpiDelta pct={pctChange(ytd(m.grossProfit), lyYtd(m.grossProfit))} suffix={sfx} />}
          pct={margin(ytd(m.grossProfit), ytd(m.revenue))} pctLabel="of revenue" />
        <PlKpiTile label={`Operating Profit${qn < 4 ? ' (YTD)' : ''}`} icon={BarChart3} value={`IDR ${fmtAmount(ytd(m.operatingProfit))}`}
          sub={<KpiDelta pct={pctChange(ytd(m.operatingProfit), lyYtd(m.operatingProfit))} suffix={sfx} />}
          pct={margin(ytd(m.operatingProfit), ytd(m.revenue))} pctLabel="of revenue" />
        <PlKpiTile label={`Net Profit Change Q${qn} vs ${basisLabel}`} icon={Percent} value={`${dNp >= 0 ? '+' : '-'}IDR ${fmtAmount(Math.abs(dNp))}`}
          sub={<KpiDelta pct={pctChange(m.netProfit[L], m.netProfit[B])} suffix={`vs ${basisLabel}`} />}
          pct={margin(m.netProfit[L], m.revenue[L])} pctLabel={`of Q${qn} revenue`} />
      </PlKpiRow>

      <Panel title="Quarterly Profit & Loss Trend" icon={BarChart3} right={<Legend items={series.map(s => ({ label: s.key, color: s.color }))} />}>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barGap={6} barCategoryGap="22%">
              <CartesianGrid stroke="#E5E5E5" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#525252' }} tickLine={false} axisLine={{ stroke: '#D4D4D4' }} />
              <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtCompact(v, 0)} />
              <Tooltip cursor={{ fill: '#F5F5F5' }} content={<ChartTooltip fmt={v => fmtAmount(v)} />} />
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  <LabelList dataKey={s.key} position="top" formatter={(v: number) => fmtCompact(v, 1)} style={{ fontSize: 11, fontWeight: 600, fill: '#262626' }} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-neutral-500 mt-1">Expenses / Cost Base = Cost of Sales + Operating Expenses + Other Expenses + Income Tax.</p>
      </Panel>

      <PlTable
        m={m}
        colCount={qn + 1}
        minWidth={760}
        compact
        glRange={glRange}
        head={
          <tr className={thRowCls}>
            <th className={`${thCls} py-3 text-left`}>Account Group</th>
            {labels.map(l => (
              <th key={l} className={`${thCls} py-3 text-right`}>
                <span className="block">{l}</span>
                <span className="block text-[10px] font-medium text-neutral-700">(IDR)</span>
              </th>
            ))}
            <th className={`${thCls} py-3 text-right`}>
              <span className="block">Variance</span>
              <span className="block text-[10px] font-medium text-neutral-700">Q{qn} vs {basisLabel}</span>
            </th>
          </tr>
        }
        cells={(v, c) => <QuarterCells v={v} c={c} qn={qn} B={B} />}
      />
    </div>
  );
}

function QuarterCells({ v, c, qn, B }: { v: number[]; c: CellCtx; qn: number; B: number }) {
  const cls = c.level === 'account' ? 'py-1 text-neutral-500' : c.level === 'line' ? 'py-1.5 text-neutral-800' : 'text-neutral-900';
  const p = pctChange(v[qn - 1], v[B]);
  const good = p !== null && (p >= 0) === c.upIsGood;
  return (
    <>
      {Array.from({ length: qn }, (_, i) => <Num key={i} v={v[i]} bold={c.bold} className={cls} />)}
      <td className={`px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap ${c.bold ? 'font-bold' : 'font-medium'} ${p === null || Math.abs(p) < 0.05 ? 'text-neutral-500' : good ? 'text-neutral-900' : 'text-red-700'}`}>
        {p === null ? '–' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`}
      </td>
    </>
  );
}