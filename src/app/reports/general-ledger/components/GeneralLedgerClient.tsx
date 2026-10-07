'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  Download, FileSpreadsheet, FileText, Filter, Loader2, RotateCcw, Search, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { useClientCoa } from '@/lib/coaStore';
import {
  fetchGeneralLedger, type GeneralLedger, type GlAccount, type GlInclude, type GlLine, type GlMonth,
} from '@/lib/generalLedgerStore';
import { printReport, type PrintFormat, type PrintReport, type PrintRow, type PrintRowStyle } from '@/lib/printExport';

// Reports > General Ledger. Data baru diambil setelah user menekan "Apply"
// (filter wajib dulu). Data dikelompokkan per akun; akun yang punya transaksi
// bisa di-expand untuk melihat rinciannya. Download PDF/CSV/XLSX memakai
// helper bersama src/lib/printExport.ts (jsPDF + autotable, exceljs).

type PeriodId = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' | 'custom';

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'last_quarter', label: 'Last Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'last_year', label: 'Last Year' },
  { id: 'custom', label: 'Custom' },
];

const INCLUDE_OPTIONS: { id: GlInclude; label: string }[] = [
  { id: 'with_activity', label: 'Accounts with transactions' },
  { id: 'non_zero', label: 'Accounts with balance or transactions' },
  { id: 'all', label: 'All accounts' },
  { id: 'selected', label: 'Selected accounts' },
];

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function rangeFor(period: PeriodId, today = new Date()): { start: string; end: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3);
  switch (period) {
    case 'this_month': return { start: isoDate(new Date(y, m, 1)), end: isoDate(new Date(y, m + 1, 0)) };
    case 'last_month': return { start: isoDate(new Date(y, m - 1, 1)), end: isoDate(new Date(y, m, 0)) };
    case 'this_quarter': return { start: isoDate(new Date(y, q * 3, 1)), end: isoDate(new Date(y, q * 3 + 3, 0)) };
    case 'last_quarter': return { start: isoDate(new Date(y, q * 3 - 3, 1)), end: isoDate(new Date(y, q * 3, 0)) };
    case 'this_year': return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'last_year': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    default: return null;
  }
}

const fmtNumber = (n: number) => Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function fmtAmount(n: number): string {
  return n ? fmtNumber(n) : '–';
}

/** Saldo bertanda (debit - kredit) -> "1.000.000 Dr" / "250.000 Cr". */
function fmtBalance(n: number): string {
  if (Math.abs(n) < 0.005) return '0';
  return `${fmtNumber(n)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Rule saldo (lihat backend general_ledger_v1.py):
// - akun posisi keuangan (kepala 1-3) dilaporkan PER BULAN -> tiap bulan ditutup baris saldo akhir bulan;
// - akun PNL (kepala 4-9) terakumulasi sejak awal tahun / bulan pertama klien -> kalau periode
//   melewati pergantian tahun, ada pemisah "tahun buku baru" (saldo mulai dari 0).
type DetailRow =
  | { kind: 'line'; line: GlLine }
  | { kind: 'month'; month: GlMonth }
  | { kind: 'year'; year: string };

function detailRows(a: GlAccount): DetailRow[] {
  const rows: DetailRow[] = [];
  if (a.balance_basis === 'cumulative' && a.monthly.length > 0) {
    const perMonth = new Map<string, GlLine[]>();
    a.lines.forEach(l => {
      const k = l.date.slice(0, 7);
      perMonth.set(k, [...(perMonth.get(k) ?? []), l]);
    });
    a.monthly.forEach(m => {
      (perMonth.get(m.month) ?? []).forEach(line => rows.push({ kind: 'line', line }));
      rows.push({ kind: 'month', month: m });
    });
    return rows;
  }
  a.lines.forEach(line => {
    if (line.year_reset) rows.push({ kind: 'year', year: line.date.slice(0, 4) });
    rows.push({ kind: 'line', line });
  });
  return rows;
}

function openingLabel(a: GlAccount): string {
  return a.balance_basis === 'ytd' && a.accumulated_from
    ? `Opening Balance (YTD since ${fmtDate(a.accumulated_from)})`
    : 'Opening Balance';
}

const CLASS_TONE: Record<string, string> = {
  ASSET: 'bg-blue-50 text-blue-700',
  LIABILITY: 'bg-amber-50 text-amber-700',
  EQUITY: 'bg-violet-50 text-violet-700',
  REVENUE: 'bg-emerald-50 text-emerald-700',
  'OTHER INCOME': 'bg-emerald-50 text-emerald-700',
};

// ── Export ───────────────────────────────────────────────────────────

function buildPrintReport(gl: GeneralLedger, companyName: string, printedBy?: string): PrintReport {
  const rows: PrintRow[] = [];
  const rowStyles: (PrintRowStyle | undefined)[] = [];
  const push = (row: PrintRow, style?: PrintRowStyle) => { rows.push(row); rowStyles.push(style); };

  gl.accounts.forEach(a => {
    push({ date: `${a.account_code} — ${a.account_name}` }, 'section');
    push({ description: openingLabel(a), balance: a.opening_balance });
    detailRows(a).forEach(r => {
      if (r.kind === 'line') {
        const l = r.line;
        push({
          date: l.date, source: l.source, number: l.number, description: l.description,
          debit: l.debit || null, credit: l.credit || null, balance: l.balance,
        });
      } else if (r.kind === 'month') {
        push({ description: `Balance end of ${fmtMonth(r.month.month)}`, debit: r.month.debit, credit: r.month.credit, balance: r.month.closing_balance }, 'total');
      } else {
        push({ description: `Fiscal year ${r.year} — P&L balance starts from 0` }, 'section');
      }
    });
    push({ description: `Total ${a.account_code}`, debit: a.total_debit, credit: a.total_credit, balance: a.closing_balance }, 'total');
  });

  const include = INCLUDE_OPTIONS.find(o => o.id === gl.filter.include)?.label ?? gl.filter.include;
  return {
    title: 'General Ledger',
    fileBase: `General-Ledger-${gl.filter.start_date}_to_${gl.filter.end_date}`,
    companyName,
    subtitle: `Period ${fmtDate(gl.filter.start_date)} – ${fmtDate(gl.filter.end_date)} · ${include} · Balance: positive = Debit, negative = Credit · P&L accounts (4-9) accumulated year-to-date, balance sheet accounts (1-3) per month`,
    orientation: 'landscape',
    printedBy,
    table: {
      columns: [
        { key: 'date', header: 'Date', width: 14 },
        { key: 'source', header: 'Source', width: 14 },
        { key: 'number', header: 'Ref No.', width: 22 },
        { key: 'description', header: 'Description', width: 48 },
        { key: 'debit', header: 'Debit', type: 'money', width: 18 },
        { key: 'credit', header: 'Credit', type: 'money', width: 18 },
        { key: 'balance', header: 'Balance', type: 'money', width: 20 },
      ],
      rows,
      rowStyles,
      totals: { description: 'GRAND TOTAL', debit: gl.totals.debit, credit: gl.totals.credit },
    },
  };
}

// ── Account picker (Include Account = Selected accounts) ─────────────

function AccountPicker({ clientId, value, onChange }: {
  clientId: string | null;
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const { accounts, loading } = useClientCoa(clientId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? accounts.filter(a => a.acc_no.toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q)) : accounts;
    return list.slice(0, 300);
  }, [accounts, query]);

  const nameOf = (code: string) => accounts.find(a => a.acc_no === code)?.account_name ?? '';
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[42px] flex items-center flex-wrap gap-1.5 text-left bg-card border border-border rounded-lg pl-3 pr-9 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
      >
        {value.length === 0 && <span className="text-muted-foreground py-1">Choose accounts…</span>}
        {value.map(code => (
          <span key={code} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 rounded-md px-2 py-0.5 text-xs font-medium">
            {code}
            <span
              role="button"
              tabIndex={0}
              aria-label={`Remove ${code}`}
              onClick={e => { e.stopPropagation(); toggle(code); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); toggle(code); } }}
              className="hover:text-blue-900"
            >
              <X size={12} />
            </span>
          </span>
        ))}
        <ChevronDown size={16} className="absolute right-3 top-3 text-muted-foreground pointer-events-none" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[22rem] bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search code or name"
                className="w-full pl-8 pr-2 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto scrollbar-thin py-1">
            {loading && <p className="px-3 py-3 text-sm text-muted-foreground">Loading accounts…</p>}
            {!loading && filtered.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No accounts found.</p>}
            {filtered.map(a => {
              const checked = value.includes(a.acc_no);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.acc_no)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                    {checked && <Check size={12} className="text-white" />}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground w-24 flex-shrink-0">{a.acc_no}</span>
                  <span className="truncate text-foreground">{a.account_name}</span>
                </button>
              );
            })}
          </div>
          {value.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs">
              <span className="text-muted-foreground truncate" title={value.map(c => `${c} ${nameOf(c)}`).join(', ')}>{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} className="text-blue-700 font-medium hover:underline">Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Account group ────────────────────────────────────────────────────

function AccountGroup({ account, expanded, onToggle }: { account: GlAccount; expanded: boolean; onToggle: () => void }) {
  const hasLines = account.line_count > 0;
  const tone = CLASS_TONE[account.classification ?? ''] ?? 'bg-slate-100 text-slate-600';
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        type="button"
        onClick={hasLines ? onToggle : undefined}
        disabled={!hasLines}
        aria-expanded={hasLines ? expanded : undefined}
        className={`w-full grid grid-cols-[1.25rem_minmax(0,1fr)] lg:grid-cols-[1.25rem_minmax(0,1fr)_9rem_9rem_9rem_10rem] items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left ${
          hasLines ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
        } ${expanded ? 'bg-slate-50 border-b border-border' : ''}`}
      >
        <span className="text-muted-foreground">
          {hasLines ? (expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />) : null}
        </span>
        <span className="min-w-0 flex items-center gap-2.5 flex-wrap">
          <span className="font-mono text-sm font-semibold text-foreground">{account.account_code}</span>
          <span className="text-sm font-semibold text-foreground truncate">{account.account_name}</span>
          {account.classification && <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${tone}`}>{account.classification}</span>}
          <span className="text-xs text-muted-foreground">
            {hasLines ? `${account.line_count} transaction${account.line_count > 1 ? 's' : ''}` : 'No transactions'}
            {' · '}
            {account.balance_basis === 'ytd' && account.accumulated_from
              ? `YTD since ${fmtDate(account.accumulated_from)}`
              : 'Monthly balance'}
          </span>
        </span>
        <Figure label="Opening" value={fmtBalance(account.opening_balance)} />
        <Figure label="Debit" value={fmtAmount(account.total_debit)} />
        <Figure label="Credit" value={fmtAmount(account.total_credit)} />
        <Figure label="Closing" value={fmtBalance(account.closing_balance)} strong />
      </button>

      {expanded && hasLines && (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground bg-white">
                <th className="text-left font-semibold px-4 py-2.5 w-32">Date</th>
                <th className="text-left font-semibold px-3 py-2.5 w-32">Source</th>
                <th className="text-left font-semibold px-3 py-2.5 w-48">Ref No.</th>
                <th className="text-left font-semibold px-3 py-2.5">Description</th>
                <th className="text-right font-semibold px-3 py-2.5 w-36">Debit</th>
                <th className="text-right font-semibold px-3 py-2.5 w-36">Credit</th>
                <th className="text-right font-semibold px-4 py-2.5 w-40">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border bg-slate-50/60">
                <td className="px-4 py-2 text-muted-foreground" colSpan={6}><span className="italic">{openingLabel(account)}</span></td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtBalance(account.opening_balance)}</td>
              </tr>
              {detailRows(account).map((r, i) => {
                if (r.kind === 'month') {
                  return (
                    <tr key={`m-${r.month.month}`} className="border-t border-border bg-blue-50/60 text-sm">
                      <td className="px-4 py-2 font-semibold text-blue-800" colSpan={4}>Balance end of {fmtMonth(r.month.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-800">{fmtAmount(r.month.debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-800">{fmtAmount(r.month.credit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-blue-800">{fmtBalance(r.month.closing_balance)}</td>
                    </tr>
                  );
                }
                if (r.kind === 'year') {
                  return (
                    <tr key={`y-${r.year}`} className="border-t border-border bg-amber-50">
                      <td className="px-4 py-2 text-xs font-semibold text-amber-800" colSpan={7}>
                        Fiscal year {r.year} — P&amp;L balance starts from 0
                      </td>
                    </tr>
                  );
                }
                const l = r.line;
                return (
                  <tr key={`${l.number}-${i}`} className="border-t border-border hover:bg-slate-50">
                    <td className="px-4 py-2 whitespace-nowrap text-foreground">{fmtDate(l.date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{l.source}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-foreground">{l.number || '–'}</td>
                    <td className="px-3 py-2 text-foreground">{l.description || '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(l.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(l.credit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">{fmtBalance(l.balance)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-slate-50 font-semibold">
                <td className="px-4 py-2.5 text-foreground" colSpan={4}>Closing Balance</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtAmount(account.total_debit)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtAmount(account.total_credit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtBalance(account.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="col-start-2 lg:col-start-auto flex lg:block items-baseline justify-between lg:text-right">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`block tabular-nums text-sm ${strong ? 'font-bold text-foreground' : 'font-medium text-foreground/90'}`}>{value}</span>
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function GeneralLedgerClient() {
  const { clients, activeClientId, activeClientName, hydrated } = useActiveClient();
  const { user } = useAuth();

  const initial = rangeFor('this_month')!;
  const [period, setPeriod] = useState<PeriodId>('this_month');
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [include, setInclude] = useState<GlInclude>('with_activity');
  const [accountCodes, setAccountCodes] = useState<string[]>([]);

  const [data, setData] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState<PrintFormat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const companyName = activeClientName ?? clients.find(c => c.id === activeClientId)?.companyName ?? '';

  // Ganti klien -> hasil lama tidak berlaku lagi (filter harus di-apply ulang).
  useEffect(() => {
    abortRef.current?.abort();
    setData(null);
    setError(null);
    setAccountCodes([]);
    setExpanded(new Set());
  }, [activeClientId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!downloadOpen) return;
    const close = (e: MouseEvent) => { if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) setDownloadOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [downloadOpen]);

  const changePeriod = (p: PeriodId) => {
    setPeriod(p);
    const r = rangeFor(p);
    if (r) { setStartDate(r.start); setEndDate(r.end); }
  };

  const validation = !activeClientId
    ? 'Select a company first.'
    : !startDate || !endDate
      ? 'Start date and end date are required.'
      : startDate > endDate
        ? 'Start date must be on or before end date.'
        : include === 'selected' && accountCodes.length === 0
          ? 'Choose at least one account.'
          : null;

  const runQuery = async (q: { startDate: string; endDate: string; include: GlInclude; accountCodes: string[] }, expand: string[] = []) => {
    if (!activeClientId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const gl = await fetchGeneralLedger({ managementClientId: activeClientId, ...q }, ctrl.signal);
      setData(gl);
      setExpanded(new Set(expand));
      setSearch('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load general ledger');
      setData(null);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  const apply = () => {
    if (validation) return;
    runQuery({ startDate, endDate, include, accountCodes });
  };

  // Drill-down dari Financial Statements: /reports/general-ledger?account=X&start=..&end=..
  // -> filter diisi & langsung dijalankan sekali begitu klien aktif siap.
  const searchParams = useSearchParams();
  const drillDone = useRef(false);
  useEffect(() => {
    if (drillDone.current || !hydrated || !activeClientId) return;
    const acc = searchParams.get('account');
    const s = searchParams.get('start');
    const e = searchParams.get('end');
    if (!acc || !s || !e || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return;
    drillDone.current = true;
    setPeriod('custom');
    setStartDate(s);
    setEndDate(e);
    setInclude('selected');
    setAccountCodes([acc]);
    runQuery({ startDate: s, endDate: e, include: 'selected', accountCodes: [acc] }, [acc]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dijalankan sekali per kunjungan drill-down
  }, [hydrated, activeClientId, searchParams]);

  const reset = () => {
    abortRef.current?.abort();
    setLoading(false);
    changePeriod('this_month');
    setInclude('with_activity');
    setAccountCodes([]);
    setData(null);
    setError(null);
  };

  const visibleAccounts = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.accounts;
    return data.accounts.filter(a => a.account_code.toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q));
  }, [data, search]);

  const expandable = visibleAccounts.filter(a => a.line_count > 0);
  const allExpanded = expandable.length > 0 && expandable.every(a => expanded.has(a.account_code));

  const toggle = (code: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const download = async (format: PrintFormat) => {
    if (!data) return;
    setDownloadOpen(false);
    setDownloading(format);
    try {
      await printReport(buildPrintReport(data, companyName, user?.nama || user?.username), format);
    } finally {
      setDownloading(null);
    }
  };

  const inputClass = 'w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400';
  const selectClass = `${inputClass} appearance-none pr-9`;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-5 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-blue-700 mb-2">
            <ArrowLeft size={15} /> Reports
          </Link>
          <h1 className="text-3xl font-bold text-foreground tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
              <BookOpen size={22} className="text-orange-500" />
            </span>
            General Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Account-level postings with opening, running, and closing balances{companyName ? ` · ${companyName}` : ''}.
          </p>
        </div>

        <div className="relative" ref={downloadRef}>
          <button
            type="button"
            onClick={() => setDownloadOpen(o => !o)}
            disabled={!data || data.accounts.length === 0 || downloading !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download <ChevronDown size={15} />
          </button>
          {downloadOpen && (
            <div className="absolute right-0 z-30 mt-1 w-48 bg-card border border-border rounded-xl shadow-lg py-1">
              {([
                ['pdf', 'PDF', FileText, 'text-rose-500'],
                ['csv', 'CSV', FileText, 'text-slate-500'],
                ['excel', 'Excel (XLSX)', FileSpreadsheet, 'text-blue-600'],
              ] as const).map(([fmt, label, Icon, color]) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => download(fmt)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-slate-50"
                >
                  <Icon size={16} className={color} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter */}
      <form
        onSubmit={e => { e.preventDefault(); apply(); }}
        className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Filter size={16} className="text-blue-600" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[12rem_11rem_11rem_minmax(0,1fr)] gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Period</span>
            <div className="relative">
              <select value={period} onChange={e => changePeriod(e.target.value as PeriodId)} className={selectClass}>
                {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Start Date</span>
            <input type="date" value={startDate} max={endDate || undefined} onChange={e => { setStartDate(e.target.value); setPeriod('custom'); }} className={inputClass} required />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">End Date</span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={e => { setEndDate(e.target.value); setPeriod('custom'); }} className={inputClass} required />
          </label>
          <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-4 sm:col-span-2 xl:col-span-1">
            <label className="block">
              <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Include Account</span>
              <div className="relative">
                <select value={include} onChange={e => setInclude(e.target.value as GlInclude)} className={selectClass}>
                  {INCLUDE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </label>
            {include === 'selected' && (
              <div className="block">
                <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Accounts</span>
                <AccountPicker clientId={activeClientId} value={accountCodes} onChange={setAccountCodes} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className={`text-xs ${validation && hydrated ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {hydrated && validation ? validation : 'Only posted transactions are included (Journal Entry, Sales, Purchase, Cash & Bank).'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-foreground bg-card hover:bg-slate-50">
              <RotateCcw size={15} /> Reset
            </button>
            <button
              type="submit"
              disabled={!!validation || loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply Filter
            </button>
          </div>
        </div>
      </form>

      {/* Hasil */}
      {error && (
        <div className="border border-rose-200 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {!data && !loading && !error && (
        <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
          <BookOpen size={30} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-foreground">Set your filters to view the general ledger</p>
          <p className="text-xs text-muted-foreground mt-1">Choose a period or date range and which accounts to include, then click <b>Apply Filter</b>.</p>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      )}

      {data && (
        <div className={`space-y-4 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Accounts" value={data.totals.accounts.toLocaleString('id-ID')} />
            <Stat label="Transactions" value={data.totals.lines.toLocaleString('id-ID')} />
            <Stat label="Total Debit" value={fmtNumber(data.totals.debit)} />
            <Stat label="Total Credit" value={fmtNumber(data.totals.credit)} />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {fmtDate(data.filter.start_date)} – {fmtDate(data.filter.end_date)} · {INCLUDE_OPTIONS.find(o => o.id === data.filter.include)?.label}
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Find account"
                  className="w-56 pl-8 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(expandable.map(a => a.account_code)))}
                disabled={expandable.length === 0}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-sm font-medium text-foreground bg-card hover:bg-slate-50 disabled:opacity-50"
              >
                {allExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {visibleAccounts.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center">
              <p className="text-sm font-semibold text-foreground">No accounts to show</p>
              <p className="text-xs text-muted-foreground mt-1">
                {search ? 'No account matches your search.' : 'There are no posted transactions for this filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleAccounts.map(a => (
                <AccountGroup key={a.account_code} account={a} expanded={expanded.has(a.account_code)} onToggle={() => toggle(a.account_code)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
