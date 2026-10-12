'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileText, Wallet } from 'lucide-react';
import { CheckBanner } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { inputCls } from '../PeriodPicker';
import { fmtAmount, glHref, todayIso } from '../fsFormat';
import { fmtCompact, pctChange } from '../bs/bsData';
import { ChartTooltip, Panel } from '../bs/BsUi';
import { BsToolbar } from '../bs/BsToolbar';
import { CF_COLORS, MAX_COLUMNS, cfReport, fmtRange, splitRange, useCfSeries, type CfMerged, type CfRow, type Granularity, type Method, type Tone } from './cfData';

// Cash Flow Statement -- satu layout untuk metode langsung & tidak langsung:
// filter periode (bulanan / kuartalan / tahunan + rentang), 4 KPI vs periode
// sebelumnya, grafik trend (kolom + garis), komposisi, dan tabel per kolom
// periode + total (+ pembanding opsional / % of revenue).

export interface CfViewProps {
  clientId: string;
  method: Method;
  onMethod: (m: Method) => void;
  printedBy?: string;
}

const GRANS: { id: Granularity; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
];

type Unit = 'million' | 'full';
type ChartType = 'column_line' | 'line';
type CmpBasis = 'previous_period' | 'last_year';

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
      {options.map(o => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${value === o.id ? 'bg-blue-600 text-white shadow-sm' : 'text-foreground/80 hover:bg-slate-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function CashFlowView({ clientId, method, onMethod, printedBy }: CfViewProps) {
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const [gran, setGran] = useState<Granularity>('monthly');
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y}-12-31`);
  const columns = useMemo(() => (from && to && from <= to ? splitRange(from, to, gran) : []), [from, to, gran]);
  const tooMany = columns.length > MAX_COLUMNS;
  const valid = columns.length > 0 && !tooMany;
  const { merged: m, loading, error } = useCfSeries(clientId, columns, from, to, valid);
  const company = m?.data.client.company_name ?? '';
  const totalLabel = gran === 'annual' && columns.length === 1 ? `Total ${columns[0].label}` : from.slice(0, 4) === to.slice(0, 4) && from.endsWith('-01-01') && to.endsWith('-12-31') ? `Total ${from.slice(0, 4)}` : 'Total';

  const [showCmp, setShowCmp] = useState(false);
  const [cmpBasis, setCmpBasis] = useState<CmpBasis>('previous_period');

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Period View</p>
              <Segmented value={gran} options={GRANS} onChange={setGran} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Period Range</p>
              <div className="flex items-center gap-2">
                <input type="date" value={from} max="9999-12-31" onChange={e => e.target.value && setFrom(e.target.value)} className={`${inputCls} w-40`} aria-label="From" />
                <span className="text-sm text-muted-foreground">to</span>
                <input type="date" value={to} max="9999-12-31" onChange={e => e.target.value && setTo(e.target.value)} className={`${inputCls} w-40`} aria-label="To" />
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Method</p>
              <Segmented value={method} options={[{ id: 'direct', label: 'Direct Method' }, { id: 'indirect', label: 'Indirect Method' }]} onChange={onMethod} />
            </div>
            {valid && (
              <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 px-3.5 py-2">
                <CalendarDays size={22} className="text-blue-700 shrink-0" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Selected Period</p>
                  <p className="text-sm font-bold text-foreground whitespace-nowrap">{fmtRange(from, to)}</p>
                  <p className="text-[11px] text-muted-foreground">{GRANS.find(g => g.id === gran)!.label} view ({columns.length} {gran === 'monthly' ? 'months' : gran === 'quarterly' ? 'quarters' : 'years'}) · {method === 'direct' ? 'Direct' : 'Indirect'} method</p>
                </div>
              </div>
            )}
          </>
        }
        loading={loading}
        exportReady={!!m && valid}
        buildExport={() => {
          const cmp = showCmp ? { label: cmpBasis === 'previous_period' ? 'Previous Period' : 'Same Period Last Year', index: cmpBasis === 'previous_period' ? m!.PREV : m!.LY } : null;
          return cfReport(m!, method, columns.map(c => c.label), totalLabel, {
            companyName: company, subtitle: `For the period ${fmtRange(from, to)}`, fileBase: `Cash-Flow-${method}-${from}_${to}`, printedBy, compare: cmp,
          });
        }}
      />

      {from > to && <ErrorBlock message="The start date must be on or before the end date." />}
      {tooMany && <ErrorBlock message={`The range has more than ${MAX_COLUMNS} ${gran === 'monthly' ? 'months' : 'periods'}. Shorten the range or use a quarterly / annual view.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && valid && <LoadingBlock />}
      {m && valid && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <Body m={m} method={method} labels={columns.map(c => c.label)} totalLabel={totalLabel} range={{ start: from, end: to }}
            showCmp={showCmp} setShowCmp={setShowCmp} cmpBasis={cmpBasis} setCmpBasis={setCmpBasis} />
        </div>
      )}
    </div>
  );
}

// ── Isi ──────────────────────────────────────────────────────────────

function Body({ m, method, labels, totalLabel, range, showCmp, setShowCmp, cmpBasis, setCmpBasis }: {
  m: CfMerged; method: Method; labels: string[]; totalLabel: string; range: { start: string; end: string };
  showCmp: boolean; setShowCmp: (v: boolean) => void; cmpBasis: CmpBasis; setCmpBasis: (v: CmpBasis) => void;
}) {
  const T = m.TOTAL, P = m.PREV;
  const op = m.operating[method];
  const ind = m.data.periods.find(p => p.period.start === range.start && p.period.end === range.end)?.indirect;
  const unmappedMoving = m.data.unmapped_accounts.filter(a => a.has_movement);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <CfKpi label="Operating Cash Flow" icon={FileText} v={op[T]} prev={op[P]} />
        <CfKpi label="Investing Cash Flow" icon={BarChart3} v={m.investing[T]} prev={m.investing[P]} />
        <CfKpi label="Financing Cash Flow" icon={ArrowLeftRight} v={m.financing[T]} prev={m.financing[P]} />
        <CfKpi label="Net Cash Change" icon={Wallet} v={m.net[T]} prev={m.net[P]} />
      </div>

      {ind && (
        <CheckBanner
          ok={ind.check.reconciled}
          okText={`Reconciled — net change ${fmtAmount(ind.net_change)} agrees with the movement of cash accounts in the Balance Sheet (closing cash ${fmtAmount(ind.balance_sheet_ending_cash)}).`}
          failText={`Not reconciled — difference ${fmtAmount(ind.check.difference)}. Caused by journals whose debit ≠ credit.`}
          journals={ind.check.unbalanced_journals}
        />
      )}
      {m.data.cash_accounts.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>No account is mapped as <b>Cash &amp; cash equivalents</b>, so every cash flow is zero. Set the cash flow category of the cash / bank accounts in <Link href="/financial-statements/mapping" className="underline font-medium">Statement Mapping</Link>.</span>
        </div>
      )}
      {unmappedMoving.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {unmappedMoving.length} balance sheet account{unmappedMoving.length > 1 ? 's have' : ' has'} movement but no cash flow mapping (shown under Operating in the indirect method):{' '}
            {unmappedMoving.slice(0, 6).map(a => `${a.code} ${a.name}`).join(' · ')}{unmappedMoving.length > 6 ? ' …' : ''}.{' '}
            <Link href="/financial-statements/mapping" className="underline font-medium">Map them</Link>
          </span>
        </div>
      )}

      {method === 'indirect' ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-stretch">
          <TrendChart m={m} method={method} labels={labels} />
          <Composition m={m} method={method} />
        </div>
      ) : (
        <TrendChart m={m} method={method} labels={labels} withType />
      )}

      <CfTable m={m} method={method} labels={labels} totalLabel={totalLabel} range={range}
        showCmp={showCmp} setShowCmp={setShowCmp} cmpBasis={cmpBasis} setCmpBasis={setCmpBasis} />
    </>
  );
}

function CfKpi({ label, icon: Icon, v, prev }: { label: string; icon: React.ElementType; v: number; prev: number }) {
  const pos = v >= 0;
  const p = pctChange(v, prev);
  const better = v >= prev;
  return (
    <div className={`rounded-2xl border p-4 flex items-start gap-3 min-w-0 ${pos ? 'bg-emerald-50/60 border-emerald-100' : 'bg-rose-50/60 border-rose-100'}`}>
      <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${pos ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
        {pos ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground/80">{label}</p>
          <Icon size={16} className={pos ? 'text-emerald-700' : 'text-rose-600'} />
        </div>
        <p className={`text-xl font-bold tabular-nums truncate mt-0.5 ${pos ? 'text-foreground' : 'text-rose-600'}`}>{pos ? '' : '('}Rp {fmtAmount(Math.abs(v))}{pos ? '' : ')'}</p>
        <p className="text-xs mt-1">
          {p === null ? <span className="text-muted-foreground">– vs. previous period</span> : (
            <>
              <span className={`font-semibold ${better ? 'text-emerald-600' : 'text-rose-600'}`}>{better ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%</span>
              <span className="text-muted-foreground ml-2">vs. previous period</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function TrendChart({ m, method, labels, withType }: { m: CfMerged; method: Method; labels: string[]; withType?: boolean }) {
  const [unit, setUnit] = useState<Unit>('million');
  const [type, setType] = useState<ChartType>('column_line');
  const div = unit === 'million' ? 1e6 : 1;
  const op = m.operating[method];
  const data = labels.map((l, i) => ({ name: l, Operating: op[i] / div, Investing: m.investing[i] / div, Financing: m.financing[i] / div, Net: m.net[i] / div }));
  const fmtAxis = (v: number) => (unit === 'million' ? (v < 0 ? `(${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })})` : v.toLocaleString('id-ID', { maximumFractionDigits: 1 })) : fmtCompact(v, 1));
  const fmtTip = (v: number) => (unit === 'million' ? `Rp ${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : `Rp ${fmtAmount(v)}`);
  const series = [
    { key: 'Operating', name: 'Operating Cash Flow', color: CF_COLORS.operating },
    { key: 'Investing', name: 'Investing Cash Flow', color: CF_COLORS.investing },
    { key: 'Financing', name: 'Financing Cash Flow', color: CF_COLORS.financing },
  ];
  const sel = 'text-xs border border-border rounded-lg px-2 py-1.5 bg-white';
  return (
    <Panel title={`Cash Flow Trend`} className="min-w-0"
      right={
        <>
          {withType && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">Chart Type
              <select value={type} onChange={e => setType(e.target.value as ChartType)} className={sel}>
                <option value="column_line">Column &amp; Line</option>
                <option value="line">Line</option>
              </select>
            </label>
          )}
          <select value={unit} onChange={e => setUnit(e.target.value as Unit)} className={sel} aria-label="Unit">
            <option value="million">Rp Million</option>
            <option value="full">Rp (Full Amount)</option>
          </select>
        </>
      }>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke="#EEF2F7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={60} tickFormatter={fmtAxis}
              label={unit === 'million' ? { value: 'Rp Million', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748B' } } : undefined} />
            <ReferenceLine y={0} stroke="#CBD5E1" />
            <Tooltip cursor={{ fill: '#F8FAFC' }} content={<ChartTooltip fmt={fmtTip} />} />
            {series.map(s => type === 'column_line'
              ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={18} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              : <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />)}
            <Line type="linear" dataKey="Net" name="Net Cash Change" stroke={CF_COLORS.net} strokeWidth={2.5} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-5 flex-wrap text-xs text-muted-foreground mt-2">
        {series.map(s => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 rounded" style={{ background: CF_COLORS.net }} />Net Cash Change</span>
      </div>
    </Panel>
  );
}

function Composition({ m, method }: { m: CfMerged; method: Method }) {
  const T = m.TOTAL;
  const items = [
    { name: 'Operating Cash Flow', v: m.operating[method][T], color: CF_COLORS.operating },
    { name: 'Investing Cash Flow', v: m.investing[T], color: CF_COLORS.investing },
    { name: 'Financing Cash Flow', v: m.financing[T], color: CF_COLORS.financing },
  ];
  const base = items.reduce((t, i) => t + Math.abs(i.v), 0);
  const pie = items.filter(i => Math.abs(i.v) >= 0.5).map(i => ({ name: i.name, value: Math.abs(i.v), color: i.color }));
  const p = pctChange(m.net[T], m.net[m.PREV]);
  return (
    <Panel title="Cash Flow Composition">
      <div className="relative h-48">
        {pie.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="95%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                {pie.map(x => <Cell key={x.name} fill={x.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : <div className="absolute inset-[12%] rounded-full border-[14px] border-slate-100" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] text-muted-foreground">Net Cash Change</span>
          <span className={`text-lg font-bold ${m.net[T] < 0 ? 'text-rose-600' : 'text-foreground'}`}>Rp {fmtCompact(m.net[T], 1)}</span>
          {p !== null && <span className={`text-xs font-semibold ${m.net[T] >= m.net[m.PREV] ? 'text-emerald-600' : 'text-rose-600'}`}>{m.net[T] >= m.net[m.PREV] ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%</span>}
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map(i => {
          const share = base < 0.5 ? null : (i.v / base) * 100;
          return (
            <li key={i.name} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color }} />
              <span className="text-foreground/90">{i.name}</span>
              <span className={`ml-auto tabular-nums font-semibold ${share !== null && share < 0 ? 'text-rose-600' : 'text-foreground'}`}>
                {share === null ? '–' : share < 0 ? `(${Math.abs(share).toFixed(1)})%` : `${share.toFixed(1)}%`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-3">Share of total absolute cash movement in the selected period.</p>
    </Panel>
  );
}

// ── Tabel ────────────────────────────────────────────────────────────

const TONE_BG: Record<Tone, { head: string; total: string; text: string }> = {
  operating: { head: 'bg-emerald-50', total: 'bg-emerald-50', text: 'text-emerald-800' },
  investing: { head: 'bg-sky-50', total: 'bg-sky-50', text: 'text-sky-800' },
  financing: { head: 'bg-amber-50', total: 'bg-amber-50', text: 'text-amber-800' },
};

function CfTable({ m, method, labels, totalLabel, range, showCmp, setShowCmp, cmpBasis, setCmpBasis }: {
  m: CfMerged; method: Method; labels: string[]; totalLabel: string; range: { start: string; end: string };
  showCmp: boolean; setShowCmp: (v: boolean) => void; cmpBasis: CmpBasis; setCmpBasis: (v: CmpBasis) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pctRev, setPctRev] = useState(false);
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) => set(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rows = m.rows[method];
  const lineKeys = rows.filter(r => r.kind === 'line' && r.accounts?.length).map(r => r.key);
  const allOpen = open.size > 0 && open.size >= lineKeys.length;
  const cmpIdx = cmpBasis === 'previous_period' ? m.PREV : m.LY;
  const cols = [...labels.map((_, i) => i), m.TOTAL];
  const colCount = cols.length + (showCmp ? 2 : 0) + 1;

  // Seksi yang sedang ditutup -> sembunyikan barisnya sampai total seksi itu.
  let hidden: Tone | null = null;

  const fmtV = (v: number, i: number, cash = false) => {
    if (pctRev && !cash) {
      const r = m.revenue[i];
      if (Math.abs(r) < 0.005) return '–';
      const p = (v / r) * 100;
      if (Math.abs(p) < 0.05) return '–';
      return p < 0 ? `(${Math.abs(p).toFixed(1)}%)` : `${p.toFixed(1)}%`;
    }
    return fmtAmount(v);
  };
  const cell = (v: number[], i: number, cls: string, cash = false) => (
    <td key={i} className={`px-3 text-right tabular-nums whitespace-nowrap ${cls} ${i === m.TOTAL ? 'font-semibold border-l border-slate-200' : ''} ${v[i] < -0.004 ? 'text-rose-600' : ''}`}>{fmtV(v[i], i, cash)}</td>
  );
  const cmpCells = (v: number[], cls: string, upIsGood = true) => {
    if (!showCmp) return null;
    const d = v[m.TOTAL] - v[cmpIdx];
    const good = Math.abs(d) < 0.5 ? null : (d > 0) === upIsGood;
    return (
      <>
        <td className={`px-3 text-right tabular-nums whitespace-nowrap border-l border-slate-200 ${cls} ${v[cmpIdx] < -0.004 ? 'text-rose-600' : ''}`}>{fmtAmount(v[cmpIdx])}</td>
        <td className={`px-3 text-right tabular-nums whitespace-nowrap ${cls} ${good === null ? 'text-muted-foreground' : good ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtAmount(d)}</td>
      </>
    );
  };
  const valueCells = (v: number[], cls: string, cash = false) => <>{cols.map(i => cell(v, i, cls, cash))}{cmpCells(v, cls)}</>;

  const render = (r: CfRow): React.ReactNode => {
    if (r.kind === 'heading') {
      const t = TONE_BG[r.tone!];
      const isClosed = closed.has(r.tone!);
      hidden = isClosed ? r.tone! : null;
      return (
        <tr key={r.key} className={`${t.head} cursor-pointer`} onClick={() => toggle(setClosed, r.tone!)}>
          <td colSpan={colCount} className={`px-3 py-2 font-semibold text-[13px] ${t.text} sticky left-0`}>
            <span className="inline-flex items-center gap-1.5">{isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{r.label}</span>
          </td>
        </tr>
      );
    }
    if (r.kind === 'total' && r.tone) {
      hidden = null;
      const t = TONE_BG[r.tone];
      return (
        <tr key={r.key} className={`${t.total} border-t border-white`}>
          <td className={`px-3 py-2 font-bold ${t.text} sticky left-0 ${t.total}`}>{r.label}</td>
          {valueCells(r.v, `py-2 font-bold ${t.text}`)}
        </tr>
      );
    }
    if (hidden) return null;
    if (r.kind === 'sub') {
      return <tr key={r.key}><td colSpan={colCount} className="pl-6 pr-3 pt-2 pb-1 text-[12.5px] font-semibold text-foreground/80 sticky left-0 bg-white">{r.label}</td></tr>;
    }
    if (r.kind === 'grand') {
      return (
        <tr key={r.key} className="bg-blue-50 border-t-2 border-white">
          <td className="px-3 py-2.5 font-bold text-blue-800 sticky left-0 bg-blue-50">{r.label}</td>
          {valueCells(r.v, 'py-2.5 font-bold text-blue-800', r.key === 'end')}
        </tr>
      );
    }
    if (r.kind === 'cash') {
      return (
        <tr key={r.key} className="border-t border-slate-100">
          <td className="px-3 py-2 text-foreground/85 sticky left-0 bg-white">{r.label}</td>
          {valueCells(r.v, 'py-2 text-foreground/85', true)}
        </tr>
      );
    }
    // line
    const isOpen = open.has(r.key);
    const hasAcc = !!r.accounts?.length;
    const indent = r.key.startsWith('nc:') || r.key.startsWith('wc:') ? 'pl-10' : 'pl-7';
    return (
      <React.Fragment key={r.key}>
        <tr className={`border-t border-slate-100 hover:bg-slate-50 text-[13px] ${hasAcc ? 'cursor-pointer' : ''}`} onClick={() => hasAcc && toggle(setOpen, r.key)}>
          <td className={`${indent} pr-3 py-1.5 text-foreground/90 sticky left-0 bg-white`}>
            <span className="inline-flex items-center gap-1">
              {hasAcc ? (isOpen ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />) : <span className="w-[13px]" />}
              <span className={r.key === 'np' ? 'font-semibold' : ''}>{r.label}</span>
              {r.flag && <AlertTriangle size={13} className="text-amber-600" />}
              {r.key === 'np' && (
                <Link href="/financial-statements/profit-loss" onClick={e => e.stopPropagation()} title="Open Profit & Loss" className="text-muted-foreground hover:text-blue-700"><ExternalLink size={12} /></Link>
              )}
            </span>
          </td>
          {valueCells(r.v, `py-1.5 ${r.key === 'np' ? 'font-semibold' : ''}`)}
        </tr>
        {isOpen && r.accounts!.map(a => (
          <tr key={`${r.key}:${a.code}`} className="text-[12px] hover:bg-slate-50">
            <td className="pl-16 pr-3 py-1 sticky left-0 bg-white">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span className="font-mono text-[11px]">{a.code}</span>
                <span className="truncate max-w-[220px]">{a.name}</span>
                <Link href={glHref(a.code, range.start, range.end)} target="_blank" title="Open in General Ledger" className="hover:text-blue-700"><ExternalLink size={12} /></Link>
              </span>
            </td>
            {valueCells(a.v, 'py-1 text-muted-foreground')}
          </tr>
        ))}
      </React.Fragment>
    );
  };

  return (
    <Panel bodyClass="p-0">
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-base font-bold text-foreground">Cash Flow Statement ({method === 'direct' ? 'Direct' : 'Indirect'} Method)</h2>
          <p className="text-xs text-muted-foreground">For the period {fmtRange(range.start, range.end)}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(lineKeys))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-slate-50">
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {allOpen ? 'Collapse accounts' : 'Expand accounts'}
          </button>
          {method === 'direct' ? (
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {[{ v: false, l: 'Amount: Nominal' }, { v: true, l: '% of Revenue' }].map(o => (
                <button key={o.l} type="button" onClick={() => setPctRev(o.v)} className={`px-3 py-1 text-xs font-medium rounded-md ${pctRev === o.v ? 'bg-blue-600 text-white' : 'text-foreground/80 hover:bg-slate-50'}`}>{o.l}</button>
              ))}
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <button type="button" role="switch" aria-checked={showCmp} onClick={() => setShowCmp(!showCmp)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${showCmp ? 'bg-blue-600' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${showCmp ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                Show Comparison
              </label>
              <select value={cmpBasis} onChange={e => setCmpBasis(e.target.value as CmpBasis)} disabled={!showCmp} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white disabled:opacity-50">
                <option value="previous_period">Previous Period</option>
                <option value="last_year">Same Period Last Year</option>
              </select>
            </>
          )}
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin px-3 pb-3">
        <table className="w-full text-sm" style={{ minWidth: 300 + cols.length * 96 }}>
          <thead>
            <tr className="text-[11.5px] text-muted-foreground border-b border-border">
              <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-white min-w-[260px]">Description</th>
              {labels.map(l => <th key={l} className="text-right font-semibold px-3 py-2 whitespace-nowrap">{l}</th>)}
              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap text-foreground border-l border-slate-200">{totalLabel}</th>
              {showCmp && (
                <>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap border-l border-slate-200">{cmpBasis === 'previous_period' ? 'Previous Period' : 'Same Period LY'}</th>
                  <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Variance</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>{rows.map(render)}</tbody>
        </table>
      </div>
      {method === 'direct' && (
        <p className="px-5 pb-4 text-[11px] text-muted-foreground">
          Direct method: every journal that moves a cash account is split over its counter-accounts (revenue / receivables → customers, cost of sales / inventory / trade payables → suppliers, tax accounts → taxes, investing &amp; financing per the cash flow mapping). Transfers between cash accounts are excluded.
          {pctRev && ' % of Revenue = amount ÷ revenue of the same column.'}
        </p>
      )}
    </Panel>
  );
}
