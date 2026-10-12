'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { BarChart3, Database, FileText, PieChart as PieIcon, Scale, Wallet } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { Select, inputCls } from '../PeriodPicker';
import { fmtAmount, fmtDate, todayIso } from '../fsFormat';
import { ASSET_SECTIONS, BS_COLORS, LIAB_SECTIONS, fmtCompact, parts, pctChange, prevMonthEnd, shiftYear, useBsSeries, yearEnd, type Merged } from './bsData';
import { ChartTooltip, Delta, KpiCard, KpiRow, Panel } from './BsUi';
import { BsToolbar, type ViewProps } from './BsToolbar';
import { bsTemplateReport, fmtLongDate } from '../statementTemplate';

// (d) Balance Sheet Assets vs Liabilities -- dua kolom (Aset | Liabilitas &
// Ekuitas) per tanggal, komposisi aset (donut) & trend total aset 5 tahun.

type Basis = 'same_date_last_year' | 'previous_year_end' | 'previous_month';
const BASES: { id: Basis; label: string }[] = [
  { id: 'same_date_last_year', label: 'Same date last year' },
  { id: 'previous_year_end', label: 'Previous year end' },
  { id: 'previous_month', label: 'Previous month end' },
];

const DONUT = ['#0F7D4E', '#22C55E', '#8B5CF6', '#0EA5E9', '#F59E0B', '#CBD5E1'];
const CUR = 0, CMP = 1, YEARS = 2; // index 2..5 = 4 akhir tahun sebelumnya

export default function BsAssetsLiabView({ clientId, companyName, printedBy }: ViewProps) {
  const [asOf, setAsOf] = useState(todayIso());
  const [basis, setBasis] = useState<Basis>('same_date_last_year');
  const dates = useMemo(() => {
    const y = parts(asOf)[0];
    const cmp = basis === 'previous_month' ? prevMonthEnd(asOf) : basis === 'previous_year_end' ? yearEnd(y - 1) : shiftYear(asOf);
    return [asOf, cmp, ...[4, 3, 2, 1].map(k => yearEnd(y - k))];
  }, [asOf, basis]);
  const { data, merged: m, loading, error } = useBsSeries(clientId, dates);
  const company = data?.client.company_name ?? companyName ?? '';
  const cmpLbl = fmtDate(dates[CMP]);

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              As of
              <input type="date" value={asOf} max="9999-12-31" onChange={e => e.target.value && setAsOf(e.target.value)} className={`${inputCls} w-44`} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Compare with
              <div className="w-52"><Select value={basis} onChange={v => setBasis(v as Basis)}>{BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
            </label>
          </>
        }
        loading={loading}
        exportReady={!!m}
        buildExport={() => bsTemplateReport(m!, [CUR, CMP], [fmtDate(asOf), cmpLbl], {
          title: 'Statement of Financial Position (Balance Sheet)', fileBase: `Balance-Sheet-${asOf}`, companyName: company,
          subtitle: `As of ${fmtLongDate(asOf)}`, printedBy,
          extra: [{ header: 'Variance', values: v => v[CUR] - v[CMP] }],
        })}
      />
      {error && <ErrorBlock message={error} />}
      {loading && !m && <LoadingBlock />}
      {m && <Body m={m} cmpLbl={cmpLbl} asOf={asOf} />}
    </div>
  );
}

function Body({ m, cmpLbl, asOf }: { m: Merged; cmpLbl: string; asOf: string }) {
  const sfx = `vs ${cmpLbl}`;
  const cr = m.currentRatio[CUR], crPrev = m.currentRatio[CMP];
  const y = parts(asOf)[0];

  // Komposisi aset: 4 baris terbesar + lainnya.
  const comp = useMemo(() => {
    const lines = ASSET_SECTIONS.flatMap(k => m.sec(k).lines).map(l => ({ name: l.label, value: l.v[CUR] })).filter(l => l.value > 0.5).sort((a, b) => b.value - a.value);
    const top = lines.slice(0, 4);
    const rest = lines.slice(4).reduce((t, l) => t + l.value, 0);
    return rest > 0.5 ? [...top, { name: 'Other Assets', value: rest }] : top;
  }, [m]);
  const compTotal = comp.reduce((t, c) => t + c.value, 0);

  const trend = [YEARS, YEARS + 1, YEARS + 2, YEARS + 3, CUR].map((i, k) => ({ name: k === 4 ? String(y) : String(y - 4 + k), value: m.assets[i], last: k === 4 }));

  return (
    <div className="space-y-5">
      <KpiRow>
        <KpiCard label="Total Assets" icon={Database} tone="brand" value={`IDR ${fmtAmount(m.assets[CUR])}`} delta={<Delta pct={pctChange(m.assets[CUR], m.assets[CMP])} suffix={sfx} />} />
        <KpiCard label="Total Liabilities" icon={FileText} tone="rose" value={`IDR ${fmtAmount(m.liabilities[CUR])}`} delta={<Delta pct={pctChange(m.liabilities[CUR], m.liabilities[CMP])} upIsGood={false} suffix={sfx} />} />
        <KpiCard label="Total Equity" icon={BarChart3} tone="violet" value={`IDR ${fmtAmount(m.equity[CUR])}`} delta={<Delta pct={pctChange(m.equity[CUR], m.equity[CMP])} suffix={sfx} />} />
        <KpiCard label="Current Ratio" icon={PieIcon} tone="sky" value={cr === null ? '–' : cr.toFixed(2)}
          delta={cr !== null && crPrev !== null
            ? <span className="inline-flex items-center gap-1 text-xs"><span className={`font-semibold ${cr >= crPrev ? 'text-emerald-600' : 'text-rose-600'}`}>{cr >= crPrev ? '+' : ''}{(cr - crPrev).toFixed(2)}</span><span className="text-muted-foreground ml-1">{sfx}</span></span>
            : <span className="text-xs text-muted-foreground">Current assets ÷ current liabilities</span>} />
      </KpiRow>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px] gap-5 items-stretch">
        <SideCard title="Assets" icon={Wallet} tone="brand" m={m} sections={ASSET_SECTIONS} total={{ label: 'Total Assets', v: m.assets[CUR] }} />
        <SideCard title="Liabilities & Equity" icon={Scale} tone="rose" m={m} sections={[...LIAB_SECTIONS, 'equity']} total={{ label: 'Total Liabilities & Equity', v: m.le[CUR] }} />

        <div className="lg:col-span-2 2xl:col-span-1 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-5 content-start">
          <Panel title="Assets Composition">
            {comp.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No asset balances.</p> : (
              <>
                <div className="relative h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={comp} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                        {comp.map((c, i) => <Cell key={c.name} fill={c.name === 'Other Assets' ? DONUT[5] : DONUT[i]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-semibold text-muted-foreground">IDR</span>
                    <span className="text-lg font-bold text-foreground">{fmtCompact(m.assets[CUR])}</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {comp.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.name === 'Other Assets' ? DONUT[5] : DONUT[i] }} />
                      <span className="text-foreground/90 truncate">{c.name}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{((c.value / compTotal) * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Total Assets Trend" icon={BarChart3}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xl font-bold text-foreground">IDR {fmtCompact(m.assets[CUR])}</span>
              <Delta pct={pctChange(m.assets[CUR], m.assets[YEARS + 3])} suffix={`vs ${y - 1}`} />
            </div>
            <div className="h-28 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: '#F1F5F9' }} content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
                  <Bar dataKey="value" name="Total Assets" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                    {trend.map((d, i) => <Cell key={i} fill={d.last ? BS_COLORS.assets : '#BBF7D0'} />)}
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

function SideCard({ title, icon, tone, m, sections, total }: {
  title: string; icon: React.ElementType; tone: 'brand' | 'rose'; m: Merged; sections: string[]; total: { label: string; v: number };
}) {
  return (
    <Panel title={title} icon={icon} tone={tone} right={<span className="text-xs text-muted-foreground">Amount (IDR)</span>} className="flex flex-col" bodyClass="p-4 pt-3 flex-1 flex flex-col">
      <div className="space-y-4 flex-1">
        {sections.map(k => {
          const s = m.sec(k);
          return (
            <div key={k}>
              <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                <span className="font-semibold text-foreground text-sm">{s.label || k}</span>
                <span className="font-bold text-foreground tabular-nums text-sm">{fmtAmount(s.v[CUR])}</span>
              </div>
              {s.lines.length === 0 ? <p className="px-3 py-2 text-xs italic text-muted-foreground">No balances</p> : (
                <ul className="divide-y divide-slate-100">
                  {s.lines.map(l => (
                    <li key={l.key} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-foreground/85">{l.label}</span>
                      <span className={`tabular-nums ${l.v[CUR] < -0.004 ? 'text-rose-600' : 'text-foreground/85'}`}>{fmtAmount(l.v[CUR])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3">
        <span className="font-bold text-blue-800">{total.label}</span>
        <span className="font-bold text-blue-800 tabular-nums">{fmtAmount(total.v)}</span>
      </div>
    </Panel>
  );
}
