'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Database, ExternalLink, FileText, Lightbulb, PieChart } from 'lucide-react';
import { CheckBanner, WarningsPanel } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { inputCls } from '../PeriodPicker';
import { fmtAmount, fmtDate, glHref, startOfYear, todayIso } from '../fsFormat';
import {
  ASSET_SECTIONS, BS_COLORS, LIAB_SECTIONS, fmtCompact, monthEnd, monthLabel, parts, pctChange, prevMonthEnd, shiftYear,
  topMovers, useBsSeries, type MAccount, type MLine, type MSection, type Merged,
} from './bsData';
import { ChartTooltip, Delta, KpiCard, KpiRow, Panel } from './BsUi';
import { BsToolbar, type ViewProps } from './BsToolbar';
import { bsTemplateReport, fmtLongDate } from '../statementTemplate';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// (a) Balance Sheet default -- posisi per tanggal vs akhir bulan lalu & tanggal
// yang sama tahun lalu, ringkasan varians (waterfall), trend 12 bulan & insight.

const CUR = 0, PREV = 1, LY = 2;
const TREND_START = 3; // index 3..13 = 11 akhir bulan sebelumnya, lalu CUR

type Metric = 'assets' | 'liabilities' | 'equity';
const METRICS: { id: Metric; label: string; sections: string[] }[] = [
  { id: 'assets', label: 'Total Assets', sections: ASSET_SECTIONS },
  { id: 'liabilities', label: 'Total Liabilities', sections: LIAB_SECTIONS },
  { id: 'equity', label: 'Total Equity', sections: ['equity'] },
];

export default function BsDefaultView({ clientId, companyName, printedBy }: ViewProps) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [asOf, setAsOf] = useState(todayIso());
  const dates = useMemo(() => {
    const [y, m] = parts(asOf);
    const trend = Array.from({ length: 11 }, (_, i) => monthEnd(y, m - 11 + i));
    return [asOf, prevMonthEnd(asOf), shiftYear(asOf), ...trend];
  }, [asOf]);
  const { data, merged: m, loading, error } = useBsSeries(clientId, dates);
  const snap = data?.snapshots.find(s => s.as_of === asOf);
  const company = data?.client.company_name ?? companyName;

  const prevLbl = monthLabel(dates[PREV]);
  const lyLbl = monthLabel(dates[LY]);

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            As of
            <input type="date" value={asOf} max="9999-12-31" onChange={e => e.target.value && setAsOf(e.target.value)} className={`${inputCls} w-44`} />
          </label>
        }
        loading={loading}
        exportReady={!!m}
        buildExport={() => bsTemplateReport(m!, [CUR], ['Amount (IDR)'], {
          title: 'Statement of Financial Position (Balance Sheet)', fileBase: `Balance-Sheet-${asOf}`, companyName: company ?? '',
          subtitle: `As of ${fmtLongDate(asOf)}`, printedBy,
        })}
      />

      {error && <ErrorBlock message={error} />}
      {loading && !m && <LoadingBlock />}
      {m && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <KpiRow>
            <KpiCard label="Total Assets" icon={Database} tone="brand" value={`IDR ${fmtAmount(m.assets[CUR])}`}
              delta={<Delta pct={pctChange(m.assets[CUR], m.assets[PREV])} suffix={`vs ${prevLbl}`} />} />
            <KpiCard label="Total Liabilities" icon={FileText} tone="rose" value={`IDR ${fmtAmount(m.liabilities[CUR])}`}
              delta={<Delta pct={pctChange(m.liabilities[CUR], m.liabilities[PREV])} upIsGood={false} suffix={`vs ${prevLbl}`} />} />
            <KpiCard label="Total Equity" icon={BarChart3} tone="violet" value={`IDR ${fmtAmount(m.equity[CUR])}`}
              delta={<Delta pct={pctChange(m.equity[CUR], m.equity[PREV])} suffix={`vs ${prevLbl}`} />} />
            <KpiCard label="Working Capital" icon={PieChart} tone="sky" value={`IDR ${fmtAmount(m.workingCapital[CUR])}`}
              delta={<Delta pct={pctChange(m.workingCapital[CUR], m.workingCapital[PREV])} suffix={`vs ${prevLbl}`} />} />
          </KpiRow>

          {snap && (
            <CheckBanner
              ok={snap.check.balanced}
              okText={`Balanced — Total Assets ${fmtAmount(snap.totals.assets)} = Total Liabilities + Equity ${fmtAmount(snap.totals.liabilities_and_equity)}`}
              failText={`Not balanced — difference ${fmtAmount(snap.check.difference)}. Caused by journals whose debit ≠ credit.`}
              journals={snap.check.unbalanced_journals}
            />
          )}
          {data && <WarningsPanel warnings={data.warnings} />}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <DefaultTable m={m} labels={[fmtDate(asOf), prevLbl, lyLbl]} glRange={{ start: startOfYear(asOf), end: asOf }} />
            <div className="space-y-5">
              <VarianceSummary m={m} prevLbl={prevLbl} lyLbl={lyLbl} curLbl={monthLabel(asOf)} />
              <AssetsTrend m={m} dates={dates} lyLbl={lyLbl} />
              <KeyInsights m={m} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tabel ────────────────────────────────────────────────────────────

function Num({ v, bold, className = '' }: { v: number | null; bold?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold text-foreground' : 'text-foreground/90'} ${v !== null && v < -0.004 ? 'text-rose-600' : ''} ${className}`}>
      {fmtAmount(v)}
    </td>
  );
}

function PctCell({ cur, prev, upIsGood = true }: { cur: number; prev: number; upIsGood?: boolean }) {
  const p = pctChange(cur, prev);
  if (p === null || Math.abs(p) < 0.05) return <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{p === null ? '–' : '0.0%'}</td>;
  const good = (p > 0) === upIsGood;
  return (
    <td className={`px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      {p > 0 ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%
    </td>
  );
}

function ValueCells({ v, bold, upIsGood }: { v: number[]; bold?: boolean; upIsGood?: boolean }) {
  return (
    <>
      <Num v={v[CUR]} bold={bold} className="font-semibold" />
      <Num v={v[PREV]} bold={bold} />
      <Num v={v[CUR] - v[PREV]} bold={bold} />
      <PctCell cur={v[CUR]} prev={v[PREV]} upIsGood={upIsGood} />
      <Num v={v[LY]} bold={bold} />
      <Num v={v[CUR] - v[LY]} bold={bold} />
      <PctCell cur={v[CUR]} prev={v[LY]} upIsGood={upIsGood} />
    </>
  );
}

function DefaultTable({ m, labels, glRange }: { m: Merged; labels: [string, string, string]; glRange: { start: string; end: string } }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) => set(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const allLineKeys = m.sections.flatMap(s => s.lines.map(l => `${s.key}:${l.key}`));
  const allOpen = openLines.size > 0 && openLines.size >= allLineKeys.length;

  const groups: { key: string; label: string; v: number[]; sections: string[] }[] = [
    { key: 'g_assets', label: 'Assets', v: m.assets, sections: ASSET_SECTIONS },
    { key: 'g_le', label: 'Liabilities & Equity', v: m.le, sections: [...LIAB_SECTIONS, 'equity'] },
  ];

  const accountRow = (a: MAccount, i: number, upIsGood: boolean) => (
    <tr key={`${a.code ?? 'calc'}-${i}`} className="text-[12.5px] hover:bg-slate-50">
      <td className="pl-14 pr-3 py-1">
        <span className="inline-flex items-center gap-2 min-w-0 text-muted-foreground">
          {a.code ? <span className="font-mono text-[11px]">{kodeAkun(a.code)}</span> : <span className="text-[10px] font-semibold uppercase bg-violet-50 text-violet-700 rounded px-1.5">Auto</span>}
          <span className="truncate">{a.name}</span>
          {a.code && <Link href={glHref(a.code, glRange.start, glRange.end)} target="_blank" title="Open in General Ledger" className="hover:text-blue-700"><ExternalLink size={12} /></Link>}
        </span>
      </td>
      <ValueCells v={a.v} upIsGood={upIsGood} />
    </tr>
  );

  const lineRow = (s: MSection, l: MLine, upIsGood: boolean) => {
    const k = `${s.key}:${l.key}`;
    const open = openLines.has(k);
    return (
      <React.Fragment key={k}>
        <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(setOpenLines, k)}>
          <td className="pl-9 pr-3 py-1.5 text-foreground/90">
            <span className="inline-flex items-center gap-1">
              {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
              {l.label}
            </span>
          </td>
          <ValueCells v={l.v} upIsGood={upIsGood} />
        </tr>
        {open && l.accounts.map((a, i) => accountRow(a, i, upIsGood))}
      </React.Fragment>
    );
  };

  return (
    <Panel
      title="Balance Sheet"
      bodyClass="p-3 pt-2"
      right={
        <button type="button" onClick={() => setOpenLines(allOpen ? new Set() : new Set(allLineKeys))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-slate-50">
          {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {allOpen ? 'Collapse accounts' : 'Expand accounts'}
        </button>
      }
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-left font-semibold px-3 py-2" />
              {[
                [labels[0], 'Amount (IDR)'], [labels[1], 'Amount (IDR)'], ['Change', '(IDR)'], ['Change %', ''],
                [labels[2], 'Amount (IDR)'], ['YoY Change', '(IDR)'], ['YoY %', ''],
              ].map(([a, b], i) => (
                <th key={i} className="text-right font-semibold px-3 py-2 whitespace-nowrap align-bottom">
                  <span className="block text-foreground">{a}</span>
                  {b && <span className="block font-normal">{b}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const gOpen = !closed.has(g.key);
              return (
                <React.Fragment key={g.key}>
                  <tr className="bg-blue-50 cursor-pointer" onClick={() => toggle(setClosed, g.key)}>
                    <td className="px-3 py-2 font-bold text-blue-800 rounded-l-lg">
                      <span className="inline-flex items-center gap-1.5">{gOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{g.label}</span>
                    </td>
                    <ValueCells v={g.v} bold />
                  </tr>
                  {gOpen && g.sections.map(sk => {
                    const s = m.sec(sk);
                    const sOpen = !closed.has(sk);
                    const upIsGood = !LIAB_SECTIONS.includes(sk);
                    return (
                      <React.Fragment key={sk}>
                        <tr className="border-t border-slate-200 cursor-pointer hover:bg-slate-50" onClick={() => toggle(setClosed, sk)}>
                          <td className="pl-6 pr-3 py-2 font-semibold text-foreground">
                            <span className="inline-flex items-center gap-1.5">{sOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{s.label || sk}</span>
                          </td>
                          <ValueCells v={s.v} bold upIsGood={upIsGood} />
                        </tr>
                        {sOpen && s.lines.length === 0 && (
                          <tr><td colSpan={8} className="pl-12 py-1.5 text-xs italic text-muted-foreground">No balances</td></tr>
                        )}
                        {sOpen && s.lines.map(l => lineRow(s, l, upIsGood))}
                      </React.Fragment>
                    );
                  })}
                  <tr><td colSpan={8} className="h-3" /></tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────

function VarianceSummary({ m, prevLbl, lyLbl, curLbl }: { m: Merged; prevLbl: string; lyLbl: string; curLbl: string }) {
  const [metric, setMetric] = useState<Metric>('assets');
  const def = METRICS.find(x => x.id === metric)!;
  const v = m[metric];
  const upIsGood = metric !== 'liabilities';

  const bars = useMemo(() => {
    const movers = topMovers(m, def.sections, PREV, CUR, 3);
    const total = v[CUR] - v[PREV];
    const other = total - movers.reduce((t, x) => t + x.delta, 0);
    const steps = [...movers.map(x => ({ name: x.label, delta: x.delta })), ...(Math.abs(other) >= 0.5 ? [{ name: 'Other', delta: other }] : [])];
    let run = v[PREV];
    const out = [{ name: prevLbl, base: 0, value: v[PREV], fill: '#94A3B8', label: fmtCompact(v[PREV], 1) }];
    steps.forEach(s => {
      const base = s.delta >= 0 ? run : run + s.delta;
      out.push({ name: s.name, base, value: Math.abs(s.delta), fill: s.delta >= 0 ? BS_COLORS.assetsSoft : BS_COLORS.liabilities, label: `${s.delta >= 0 ? '+' : '-'}${fmtCompact(Math.abs(s.delta), 1)}` });
      run += s.delta;
    });
    out.push({ name: curLbl, base: 0, value: v[CUR], fill: BS_COLORS.assets, label: fmtCompact(v[CUR], 1) });
    return out;
  }, [m, def, v, prevLbl, curLbl]);

  const levels = bars.flatMap(b => [b.base || b.value, b.base + b.value]);
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.05 || 1;
  const domain: [number, number] = [Math.max(0, lo - pad), hi + pad * 0.4];

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
              <p className="text-lg font-bold text-foreground tabular-nums">{d >= 0 ? '+' : '-'}{fmtCompact(Math.abs(d))}</p>
              <Delta pct={pctChange(v[CUR], v[c.i])} upIsGood={upIsGood} />
            </div>
          );
        })}
      </div>
      <div className="h-48 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} interval={0} tickLine={false} axisLine={false}
              tickFormatter={(s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s)} />
            <YAxis hide domain={domain} allowDataOverflow />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {bars.map((b, i) => <Cell key={i} fill={b.fill} />)}
              <LabelList dataKey="label" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#334155' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function AssetsTrend({ m, dates, lyLbl }: { m: Merged; dates: string[]; lyLbl: string }) {
  const idx = [...Array.from({ length: 11 }, (_, i) => TREND_START + i), CUR];
  const data = idx.map(i => ({ name: monthLabel(dates[i]), value: m.assets[i], last: i === CUR }));
  return (
    <Panel title="Total Assets Trend" icon={BarChart3}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-bold text-foreground">IDR {fmtCompact(m.assets[CUR])}</span>
        <Delta pct={pctChange(m.assets[CUR], m.assets[LY])} suffix={`vs ${lyLbl}`} />
      </div>
      <div className="h-32 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} interval={0} tickLine={false} axisLine={false}
              tickFormatter={(s: string) => s.split(' ')[0]} />
            <Tooltip cursor={{ fill: '#F1F5F9' }} content={<ChartTooltip fmt={v => `IDR ${fmtAmount(v)}`} />} />
            <Bar dataKey="value" name="Total Assets" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.last ? BS_COLORS.assets : '#BBF7D0'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function KeyInsights({ m }: { m: Merged }) {
  const items: { color: string; text: string }[] = [];
  const dA = m.assets[CUR] - m.assets[PREV];
  const pA = pctChange(m.assets[CUR], m.assets[PREV]);
  const movers = topMovers(m, ASSET_SECTIONS, PREV, CUR, 2).filter(x => Math.sign(x.delta) === Math.sign(dA));
  if (Math.abs(dA) >= 0.5) {
    items.push({
      color: dA >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
      text: `Total assets ${dA >= 0 ? 'increased' : 'decreased'} by ${pA === null ? '' : `${Math.abs(pA).toFixed(1)}% `}(IDR ${fmtCompact(Math.abs(dA), 1)}) from last month${movers.length ? `, mainly due to ${movers.map(x => x.label.toLowerCase()).join(' and ')}` : ''}.`,
    });
  } else {
    items.push({ color: 'bg-slate-400', text: 'Total assets are unchanged from last month.' });
  }
  const wc = m.workingCapital;
  const pW = pctChange(wc[CUR], wc[PREV]);
  items.push({
    color: wc[CUR] >= wc[PREV] ? 'bg-emerald-500' : 'bg-amber-500',
    text: `Working capital ${wc[CUR] >= wc[PREV] ? 'improved' : 'declined'}${pW === null ? '' : ` by ${Math.abs(pW).toFixed(1)}%`} to IDR ${fmtCompact(wc[CUR])}${m.currentRatio[CUR] !== null ? ` (current ratio ${m.currentRatio[CUR]!.toFixed(2)})` : ''}.`,
  });
  const dY = m.assets[CUR] - m.assets[LY];
  const pY = pctChange(m.assets[CUR], m.assets[LY]);
  items.push({
    color: 'bg-blue-600',
    text: `Year-over-year, total assets ${dY >= 0 ? 'grew' : 'fell'}${pY === null ? '' : ` ${Math.abs(pY).toFixed(1)}%`} (IDR ${fmtCompact(Math.abs(dY), 1)}); equity ${m.equity[CUR] >= m.equity[LY] ? 'rose' : 'fell'} to IDR ${fmtCompact(m.equity[CUR])}.`,
  });
  return (
    <Panel title="Key Insights" icon={Lightbulb} tone="amber">
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-foreground/90 leading-snug">
            <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${it.color}`} />{it.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
