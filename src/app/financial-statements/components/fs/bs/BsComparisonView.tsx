'use client';

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChevronDown, ChevronRight, Database, FileText, Percent } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { Select } from '../PeriodPicker';
import { fmtAmount, todayIso } from '../fsFormat';
import { ASSET_SECTIONS, BS_COLORS, LIAB_SECTIONS, capToday, fmtCompact, monthEnd, pctChange, shiftYear, useBsSeries, yearEnd, type Merged } from './bsData';
import { ChartTooltip, Delta, EmptyData, KpiCard, KpiRow, Legend, Panel } from './BsUi';
import { BsToolbar, type ViewProps } from './BsToolbar';
import { bsTemplateReport } from '../statementTemplate';

// (c) Balance Sheet Comparison -- posisi akhir kuartal 1 tahun buku, grafik
// batang per kuartal, dan varians kuartal terakhir vs basis pembanding.

type Basis = 'previous_quarter' | 'same_quarter_last_year' | 'previous_year_end';
const BASES: { id: Basis; label: string }[] = [
  { id: 'previous_quarter', label: 'vs Previous Quarter' },
  { id: 'same_quarter_last_year', label: 'vs Same Quarter Last Year' },
  { id: 'previous_year_end', label: 'vs Previous Year End' },
];

export default function BsComparisonView({ clientId, companyName, printedBy }: ViewProps) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [basis, setBasis] = useState<Basis>('previous_year_end');

  const { quarters, labels, basisDate, basisLabel } = useMemo(() => {
    const quarters: string[] = [];
    const labels: string[] = [];
    for (let q = 1; q <= 4; q++) {
      const end = monthEnd(year, q * 3);
      const start = `${year}-${String(q * 3 - 2).padStart(2, '0')}-01`;
      if (start > today) break;
      quarters.push(capToday(end, today));
      labels.push(`Q${q} ${year}${end > today ? ' (to date)' : ''}`);
    }
    const qn = quarters.length;
    let basisDate = yearEnd(year - 1);
    let basisLabel = `Q4 ${year - 1}`;
    if (qn && basis === 'previous_quarter') {
      basisDate = qn === 1 ? yearEnd(year - 1) : quarters[qn - 2];
      basisLabel = qn === 1 ? `Q4 ${year - 1}` : `Q${qn - 1} ${year}`;
    } else if (qn && basis === 'same_quarter_last_year') {
      basisDate = shiftYear(quarters[qn - 1]);
      basisLabel = `Q${qn} ${year - 1}`;
    }
    return { quarters, labels, basisDate, basisLabel };
  }, [year, basis, today]);

  const dates = useMemo(() => [...quarters, basisDate], [quarters, basisDate]);
  const { data, merged: m, loading, error } = useBsSeries(clientId, dates, quarters.length > 0);
  const qn = quarters.length;
  const company = data?.client.company_name ?? companyName ?? '';
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Fiscal Year
              <div className="w-28"><Select value={year} onChange={v => setYear(Number(v))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Comparison Basis
              <div className="w-56"><Select value={basis} onChange={v => setBasis(v as Basis)}>{BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
            </label>
          </>
        }
        loading={loading}
        exportReady={!!m && qn > 0}
        buildExport={() => bsTemplateReport(m!, quarters.map((_, i) => i), labels, {
          title: 'Balance Sheet Comparison', fileBase: `Balance-Sheet-Comparison-FY${year}`, companyName: company,
          subtitle: `Quarterly view – FY${year}, variance vs ${basisLabel}`, printedBy,
          extra: [{ header: `Variance vs ${basisLabel}`, values: v => v[qn - 1] - v[qn] }],
        })}
      />

      {qn === 0 && <EmptyData text={`FY${year} has not started yet.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && qn > 0 && <LoadingBlock />}
      {m && qn > 0 && <ComparisonBody m={m} qn={qn} labels={labels} basisLabel={basisLabel} />}
    </div>
  );
}

function ComparisonBody({ m, qn, labels, basisLabel }: { m: Merged; qn: number; labels: string[]; basisLabel: string }) {
  const L = qn - 1; // kuartal terakhir
  const B = qn;     // basis pembanding
  const sfx = `vs ${basisLabel}`;
  const chart = labels.map((l, i) => ({ name: l, Assets: m.assets[i], Liabilities: m.liabilities[i], Equity: m.equity[i] }));
  const dA = m.assets[L] - m.assets[B];

  return (
    <div className="space-y-5">
      <KpiRow>
        <KpiCard label="Total Assets" icon={Database} tone="brand" value={`IDR ${fmtAmount(m.assets[L])}`} delta={<Delta pct={pctChange(m.assets[L], m.assets[B])} suffix={sfx} />} />
        <KpiCard label="Total Liabilities" icon={FileText} tone="rose" value={`IDR ${fmtAmount(m.liabilities[L])}`} delta={<Delta pct={pctChange(m.liabilities[L], m.liabilities[B])} upIsGood={false} suffix={sfx} />} />
        <KpiCard label="Total Equity" icon={BarChart3} tone="violet" value={`IDR ${fmtAmount(m.equity[L])}`} delta={<Delta pct={pctChange(m.equity[L], m.equity[B])} suffix={sfx} />} />
        <KpiCard label={`Change ${sfx}`} icon={Percent} tone="sky" value={`${dA >= 0 ? '+' : '-'}IDR ${fmtAmount(Math.abs(dA))}`}
          delta={<Delta pct={pctChange(m.assets[L], m.assets[B])} suffix="Total Assets" />} />
      </KpiRow>

      <Panel title="Quarterly Balance Sheet Trend" icon={BarChart3}
        right={<Legend items={[{ label: 'Assets', color: BS_COLORS.assets }, { label: 'Liabilities', color: BS_COLORS.liabilities }, { label: 'Equity', color: BS_COLORS.equity }]} />}>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barGap={6} barCategoryGap="22%">
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtCompact(v, 0)} />
              <Tooltip cursor={{ fill: '#F8FAFC' }} content={<ChartTooltip fmt={v => fmtAmount(v)} />} />
              {(['Assets', 'Liabilities', 'Equity'] as const).map(k => (
                <Bar key={k} dataKey={k} fill={BS_COLORS[k.toLowerCase() as 'assets' | 'liabilities' | 'equity']} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  <LabelList dataKey={k} position="top" formatter={(v: number) => fmtCompact(v, 1)} style={{ fontSize: 11, fontWeight: 600, fill: '#334155' }} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <ComparisonTable m={m} qn={qn} labels={labels} basisLabel={basisLabel} />
    </div>
  );
}

function ComparisonTable({ m, qn, labels, basisLabel }: { m: Merged; qn: number; labels: string[]; basisLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set(['current_assets']));
  const toggle = (k: string) => setOpen(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const idx = Array.from({ length: qn }, (_, i) => i);

  const varCell = (v: number[], bold?: boolean, upIsGood = true) => {
    const p = pctChange(v[qn - 1], v[qn]);
    const good = p !== null && (p >= 0) === upIsGood;
    return (
      <td className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${bold ? 'font-bold' : 'font-medium'} ${p === null || Math.abs(p) < 0.05 ? 'text-muted-foreground' : good ? 'text-emerald-600' : 'text-rose-600'}`}>
        {p === null ? '–' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`}
      </td>
    );
  };
  const nums = (v: number[], cls: string) => idx.map(i => <td key={i} className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${cls} ${v[i] < -0.004 ? 'text-rose-600' : ''}`}>{fmtAmount(v[i])}</td>);

  const sectionRows = (key: string) => {
    const s = m.sec(key);
    const isOpen = open.has(key);
    const upIsGood = !LIAB_SECTIONS.includes(key);
    return (
      <React.Fragment key={key}>
        <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => toggle(key)}>
          <td className="px-4 py-2 font-semibold text-foreground">
            <span className="inline-flex items-center gap-1.5">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{s.label || key}</span>
          </td>
          {nums(s.v, 'font-semibold text-foreground')}
          {varCell(s.v, false, upIsGood)}
        </tr>
        {isOpen && s.lines.map(l => (
          <tr key={l.key} className="border-t border-slate-50">
            <td className="pl-11 pr-4 py-1.5 text-muted-foreground">{l.label}</td>
            {nums(l.v, 'text-foreground/80 py-1.5')}
            {varCell(l.v, false, upIsGood)}
          </tr>
        ))}
      </React.Fragment>
    );
  };
  const totalRow = (label: string, v: number[], upIsGood = true) => (
    <tr className="bg-blue-50 border-t border-blue-100">
      <td className="px-4 py-2.5 font-bold text-blue-800">{label}</td>
      {nums(v, 'font-bold text-blue-800')}
      {varCell(v, true, upIsGood)}
    </tr>
  );

  return (
    <Panel bodyClass="p-0">
      <div className="overflow-x-auto scrollbar-thin rounded-2xl">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-bold text-foreground px-4 py-3">Account Group</th>
              {labels.map(l => (
                <th key={l} className="text-right px-4 py-3 whitespace-nowrap">
                  <span className="block font-bold text-foreground">{l}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">(IDR)</span>
                </th>
              ))}
              <th className="text-right px-4 py-3 whitespace-nowrap">
                <span className="block font-bold text-foreground">Variance</span>
                <span className="block text-[11px] font-normal text-muted-foreground">vs {basisLabel}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ASSET_SECTIONS.map(sectionRows)}
            {totalRow('Total Assets', m.assets)}
            {LIAB_SECTIONS.map(sectionRows)}
            {totalRow('Total Liabilities', m.liabilities, false)}
            {sectionRows('equity')}
            {totalRow('Total Liabilities & Equity', m.le)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
