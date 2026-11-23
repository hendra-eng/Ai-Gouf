'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText,
  Filter, Loader2, RotateCcw, Scale, Search, Wallet, Landmark, TrendingUp, ShieldCheck,
} from 'lucide-react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { KpiSectionLabel, PurchaseKpiTile } from '@/app/transactions/purchase/components/PurchaseKpiTile';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import {
  fetchTrialBalance, fetchTrialBalancePeriods,
  type TbAccount, type TbInclude, type TbPeriods, type TbStatusFilter, type TrialBalance,
} from '@/lib/trialBalanceStore';
import { printReport, type PrintColumn, type PrintFormat, type PrintReport, type PrintRow, type PrintRowStyle } from '@/lib/printExport';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { readReportPeriodParams } from '@/lib/reportPeriodQuery';
import { downloadReportsSheet } from '@/lib/reportsWorkbook';

// Reports > Trial Balance. Susunan meniru sheet "TB" Excel: No Account | Account | Saldo Awal |
// (Debet, Kredit, Balance) per bulan | YTD. Tanpa kolom ADJ (adjustment dikerjakan di aplikasi terpisah).
// Sumber data = SAMA dengan General Ledger: semua transaksi di Journal Preview (draft / pending /
// approved / posted) langsung masuk; bagian yang belum posted ditandai. Filter "Posted only" = angka resmi.

const INCLUDE_OPTIONS: { id: TbInclude; label: string }[] = [
  { id: 'non_zero', label: 'Accounts with balance or transactions' },
  { id: 'with_activity', label: 'Accounts with transactions' },
  { id: 'all', label: 'All accounts' },
];

const STATUS_OPTIONS: { id: TbStatusFilter; label: string }[] = [
  { id: 'all', label: 'All journals (incl. not yet posted)' },
  { id: 'posted', label: 'Posted only' },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', approved: 'Approved', posted: 'Posted', reversed: 'Reversed',
  need_review: 'Need review', open: 'Open',
};

const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

const fmtNumber = (n: number) => Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Angka di sisi normal akun: 0 -> "–", negatif -> "(1.000)". */
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Math.abs(n) < 0.005) return '–';
  return n < 0 ? `(${fmtNumber(n)})` : fmtNumber(n);
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function monthRange(year: number, month: number): { start: string; end: string } {
  const last = new Date(year, month, 0).getDate();
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(last)}` };
}

const inputClass = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300';

function NeutralSelect<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = options.find(o => o.id === value);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`${inputClass} flex items-center justify-between gap-2 text-left hover:border-neutral-700`}
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown size={16} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 z-30 mt-1 w-full min-w-max overflow-hidden rounded-lg border border-neutral-300 bg-white py-1 shadow-lg">
          {options.map(o => {
            const active = o.id === value;
            return (
              <button
                key={o.id} type="button" role="option" aria-selected={active}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-200 hover:text-neutral-900 ${active ? 'bg-neutral-100 font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}
              >
                {o.label}
                {active && <Check size={14} className="shrink-0 text-neutral-800" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────

function buildPrintReport(tb: TrialBalance, companyName: string, printedBy?: string): PrintReport {
  const n = tb.periode.end_month;
  const columns: PrintColumn[] = [
    { key: 'code', header: 'No Account', width: 14 },
    { key: 'name', header: 'Account', width: 40 },
    { key: 'opening', header: 'Opening', type: 'money', width: 18 },
  ];
  for (let i = 0; i < n; i++) {
    columns.push({ key: `d${i}`, header: `${MONTH_NAMES[i]} Debit`, type: 'money', width: 16, excelOnly: true });
    columns.push({ key: `k${i}`, header: `${MONTH_NAMES[i]} Credit`, type: 'money', width: 16, excelOnly: true });
    columns.push({ key: `b${i}`, header: `${MONTH_NAMES[i]}`, type: 'money', width: 18 });
  }
  columns.push({ key: 'ytd', header: 'YTD', type: 'money', width: 20 });

  const rows: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  const push = (r: PrintRow, s?: PrintRowStyle) => { rows.push(r); styles.push(s); };
  const monthCells = (ms: { debit?: number; kredit?: number; balance: number }[]) => {
    const o: PrintRow = {};
    ms.forEach((m, i) => { if (m.debit !== undefined) o[`d${i}`] = m.debit || null; if (m.kredit !== undefined) o[`k${i}`] = m.kredit || null; o[`b${i}`] = m.balance; });
    return o;
  };

  tb.groups.forEach(g => {
    push({ code: g.label }, 'section');
    g.accounts.forEach(a => push({
      code: kodeAkun(a.account_code), name: a.account_name + (a.in_coa ? '' : ' (not in COA)'),
      opening: a.opening_balance, ...monthCells(a.months), ytd: a.ytd,
    }));
    if (g.key === 'EQUITY') {
      if (Math.abs(tb.carry_forward.prior_year_profit) >= 0.005) {
        const v = tb.carry_forward.prior_year_profit;
        push({ name: 'Prior Year Profit / Loss (not yet closed)', opening: v, ...monthCells(Array.from({ length: n }, () => ({ balance: v }))), ytd: v });
      }
      push({ code: '3300', name: 'Current Year Profit / Loss', ...monthCells(tb.current_year_profit.cumulative.map(v => ({ balance: v }))), ytd: tb.current_year_profit.ytd });
    }
    push({ name: `Total ${g.label}`, opening: g.total.opening_balance, ...monthCells(g.total.months), ytd: g.total.ytd }, 'total');
  });
  push({ name: 'Total Assets', ...monthCells(tb.totals.total_asset.map(v => ({ balance: v }))), ytd: tb.totals.total_asset_ytd }, 'total');
  push({ name: 'Total Liabilities + Equities', ...monthCells(tb.totals.total_liabilities_equity.map(v => ({ balance: v }))), ytd: tb.totals.total_liabilities_equity_ytd }, 'total');
  push({ name: 'Control (Assets − Liabilities − Equities)', ...monthCells(tb.totals.control.map(v => ({ balance: v }))), ytd: tb.totals.control_ytd }, 'total');
  push({ name: 'Profit (Loss)', ...monthCells(tb.current_year_profit.months.map(v => ({ balance: v }))), ytd: tb.current_year_profit.ytd }, 'total');

  const statusTxt = tb.filter.status_filter === 'posted' ? 'Posted journals only' : 'All journals in Journal Preview (incl. not yet posted)';
  return {
    title: 'Trial Balance',
    fileBase: `Trial-Balance-${tb.periode.year}-${MONTH_NAMES[n - 1]}`,
    companyName,
    subtitle: `Jan – ${MONTH_NAMES[n - 1]} ${tb.periode.year} · ${statusTxt} · Balance shown on the normal side of each account; P&L accounts per month, YTD = sum of months`,
    orientation: 'landscape',
    printedBy,
    table: { columns, rows, rowStyles: styles },
  };
}

// ── Tabel ────────────────────────────────────────────────────────────

const TH = 'border-t border-b border-neutral-800 bg-neutral-300 text-[11px] font-bold uppercase tracking-wide text-black';
const STICKY_1 = 'sticky left-0 z-10 w-28 min-w-[7rem]';
const STICKY_2 = 'sticky left-[7rem] z-10 w-64 min-w-[16rem] shadow-[1px_0_0_0_rgb(212,212,212)]';

function Cell({ v, bold, muted }: { v: number | null | undefined; bold?: boolean; muted?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold' : ''} ${typeof v === 'number' && v < 0 ? 'text-red-700' : bold ? 'text-neutral-900' : muted ? 'text-neutral-500' : 'text-neutral-800'}`}>
      {fmt(v)}
    </td>
  );
}

function AccountRow({ a, tb }: { a: TbAccount; tb: TrialBalance }) {
  const { year } = tb.periode;
  const tag = a.unposted_lines > 0
    ? `${a.unposted_lines} line(s) not posted yet — Dr ${fmtNumber(a.unposted_debit)} / Cr ${fmtNumber(a.unposted_kredit)}`
    : null;
  const canDrill = a.account_code !== '(no code)';
  return (
    <tr className="group border-t border-neutral-200 hover:bg-neutral-50">
      <td className={`${STICKY_1} bg-white px-4 py-2 font-mono text-xs text-neutral-900 group-hover:bg-neutral-50`}>{a.account_code === '(no code)' ? a.account_code : kodeAkun(a.account_code)}</td>
      <td className={`${STICKY_2} bg-white px-3 py-2 text-neutral-900 group-hover:bg-neutral-50`}>
        <span className="flex items-center gap-2">
          <span className="truncate">{a.account_name}</span>
          {tag && <span title={tag} className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label={tag} />}
          {!a.in_coa && <span title="Account is not in the client's COA" className="shrink-0 rounded-full border border-amber-400 bg-amber-50 px-1.5 text-[10px] font-semibold uppercase text-amber-800">No COA</span>}
        </span>
      </td>
      <Cell v={a.opening_balance} muted />
      {a.months.map((m, i) => {
        const active = m.debit !== 0 || m.kredit !== 0;
        const r = monthRange(year, i + 1);
        return (
          <React.Fragment key={i}>
            <Cell v={m.debit} muted />
            <Cell v={m.kredit} muted />
            <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${m.balance < 0 ? 'text-red-700' : 'text-neutral-900'}`}>
              {active && canDrill ? (
                <Link
                  href={`/reports/general-ledger?account=${encodeURIComponent(a.account_code)}&start=${r.start}&end=${r.end}`}
                  title="Open in General Ledger" className="underline-offset-2 hover:underline"
                >{fmt(m.balance)}</Link>
              ) : fmt(m.balance)}
            </td>
          </React.Fragment>
        );
      })}
      <Cell v={a.ytd} bold />
    </tr>
  );
}

function SumRow({ label, opening, months, ytd, tone = 'total', showDK, n }: {
  label: string; opening?: number; months: { debit?: number; kredit?: number; balance: number }[]; ytd: number;
  tone?: 'total' | 'grand' | 'plain'; showDK?: boolean; n: number;
}) {
  const cls = tone === 'grand' ? 'bg-neutral-800 text-white' : tone === 'total' ? 'bg-neutral-100 font-semibold' : '';
  const stickyBg = tone === 'grand' ? 'bg-neutral-800' : tone === 'total' ? 'bg-neutral-100' : 'bg-white';
  const num = (v: number | undefined) => (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${tone === 'grand' ? 'text-white' : v !== undefined && v < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{fmt(v)}</td>
  );
  return (
    <tr className={`border-t border-neutral-300 ${cls}`}>
      <td className={`${STICKY_1} ${stickyBg} px-4 py-2`} />
      <td className={`${STICKY_2} ${stickyBg} px-3 py-2`}>{label}</td>
      {num(opening)}
      {Array.from({ length: n }, (_, i) => {
        const m = months[i];
        return (
          <React.Fragment key={i}>
            {showDK ? num(m?.debit) : <td />}
            {showDK ? num(m?.kredit) : <td />}
            {num(m?.balance)}
          </React.Fragment>
        );
      })}
      {num(ytd)}
    </tr>
  );
}

function TbTable({ tb, search }: { tb: TrialBalance; search: string }) {
  const n = tb.periode.end_month;
  const q = search.trim().toLowerCase();
  const match = (a: TbAccount) => !q || a.account_code.toLowerCase().includes(q) || kodeAkun(a.account_code).toLowerCase().includes(q) || a.account_name.toLowerCase().includes(q);
  const span = 3 + n * 3;
  const prior = tb.carry_forward.prior_year_profit;
  const searching = q.length > 0;

  return (
    <div className="overflow-auto scrollbar-thin max-h-[75vh] rounded-[10px] border border-neutral-300 bg-white shadow-sm">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-20">
          <tr>
            <th rowSpan={2} className={`${TH} ${STICKY_1} !z-30 px-4 py-2.5 text-left`}>No Account</th>
            <th rowSpan={2} className={`${TH} ${STICKY_2} !z-30 px-3 py-2.5 text-left`}>Account</th>
            <th rowSpan={2} className={`${TH} px-3 py-2.5 text-right min-w-[7rem]`}>Opening</th>
            {tb.periode.months.map(m => (
              <th key={m} colSpan={3} className={`${TH} border-l border-neutral-500 px-3 py-2 text-center`}>{m} {tb.periode.year}</th>
            ))}
            <th rowSpan={2} className={`${TH} border-l border-neutral-500 px-3 py-2.5 text-right min-w-[7.5rem]`}>YTD</th>
          </tr>
          <tr>
            {tb.periode.months.map(m => (
              <React.Fragment key={m}>
                <th className={`${TH} border-l border-neutral-500 px-3 py-1.5 text-right min-w-[6rem]`}>Debit</th>
                <th className={`${TH} px-3 py-1.5 text-right min-w-[6rem]`}>Credit</th>
                <th className={`${TH} px-3 py-1.5 text-right min-w-[6.5rem]`}>Balance</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {tb.groups.map(g => {
            const accounts = g.accounts.filter(match);
            if (searching && accounts.length === 0) return null;
            return (
              <React.Fragment key={g.key}>
                <tr><td colSpan={span + 1} className="border-t border-neutral-800 bg-neutral-200 py-2 text-[11px] font-bold uppercase tracking-wide text-neutral-900"><div className="sticky left-4 w-max">{g.label}</div></td></tr>
                {accounts.map(a => <AccountRow key={a.account_code} a={a} tb={tb} />)}
                {g.key === 'EQUITY' && !searching && (
                  <>
                    {Math.abs(prior) >= 0.005 && (
                      <SumRow tone="plain" n={n} label="Prior Year Profit / Loss (not yet closed)" opening={prior}
                        months={Array.from({ length: n }, () => ({ balance: prior }))} ytd={prior} />
                    )}
                    <SumRow tone="plain" n={n} label="3300 · Current Year Profit / Loss"
                      months={tb.current_year_profit.cumulative.map(v => ({ balance: v }))} ytd={tb.current_year_profit.ytd} />
                  </>
                )}
                {!searching && (
                  <SumRow tone="total" n={n} showDK label={`Total ${g.label}`} opening={g.total.opening_balance} months={g.total.months} ytd={g.total.ytd} />
                )}
              </React.Fragment>
            );
          })}
          {!searching && (
            <>
              <tr><td colSpan={span + 1} className="h-3" /></tr>
              <SumRow tone="grand" n={n} label="Total Assets" months={tb.totals.total_asset.map(v => ({ balance: v }))} ytd={tb.totals.total_asset_ytd} />
              <SumRow tone="grand" n={n} label="Total Liabilities + Equities" months={tb.totals.total_liabilities_equity.map(v => ({ balance: v }))} ytd={tb.totals.total_liabilities_equity_ytd} />
              <SumRow tone="total" n={n} label="Control (Assets − Liabilities − Equities)" months={tb.totals.control.map(v => ({ balance: v }))} ytd={tb.totals.control_ytd} />
              <SumRow tone="total" n={n} label="Profit (Loss)" months={tb.current_year_profit.months.map(v => ({ balance: v }))} ytd={tb.current_year_profit.ytd} />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function TrialBalanceClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { clients, activeClientId, activeClientName, hydrated } = useActiveClient();
  const { user } = useAuth();

  const [periods, setPeriods] = useState<TbPeriods | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [endMonth, setEndMonth] = useState<string>('auto');
  const [include, setInclude] = useState<TbInclude>('non_zero');
  const [statusFilter, setStatusFilter] = useState<TbStatusFilter>('all');

  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState<PrintFormat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const companyName = activeClientName ?? clients.find(c => c.id === activeClientId)?.companyName ?? '';

  const runQuery = useCallback(async (q: { year: number; endMonth: string; include: TbInclude; statusFilter: TbStatusFilter }) => {
    if (!activeClientId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const tb = await fetchTrialBalance({
        managementClientId: activeClientId, year: q.year, include: q.include, statusFilter: q.statusFilter,
        endMonth: q.endMonth === 'auto' ? undefined : Number(q.endMonth),
      }, ctrl.signal);
      setData(tb);
      setSearch('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load trial balance');
      setData(null);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [activeClientId]);

  // Klien aktif siap / berganti -> muat daftar tahun, lalu langsung tampilkan tahun terbaru.
  useEffect(() => {
    abortRef.current?.abort();
    setData(null);
    setError(null);
    setPeriods(null);
    if (!hydrated || !activeClientId) return;
    const ctrl = new AbortController();
    fetchTrialBalancePeriods(activeClientId, statusFilter, ctrl.signal)
      .then(p => {
        setPeriods(p);
        // Dari halaman Reports: ?year=2026&month=10 -> periode terpilih dipakai; selain itu default.
        const dariReports = readReportPeriodParams(window.location.search);
        const y = dariReports ? dariReports.year : p.default_year;
        const em = dariReports ? String(dariReports.month) : 'auto';
        setYear(y);
        setEndMonth(em);
        runQuery({ year: y, endMonth: em, include, statusFilter });
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load periods'); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat klien aktif berganti
  }, [hydrated, activeClientId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!downloadOpen) return;
    const close = (e: MouseEvent) => { if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) setDownloadOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [downloadOpen]);

  const yearOptions = useMemo(() => {
    const ys = periods?.years.map(y => y.year) ?? [];
    if (!ys.includes(year)) ys.unshift(year);
    return ys.map(y => ({ id: String(y), label: String(y) }));
  }, [periods, year]);

  const monthOptions = useMemo(() => [
    { id: 'auto', label: 'Latest month with data' },
    ...MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: `Up to ${m}` })),
  ], []);

  const validation = !activeClientId ? 'Select a company first.' : null;
  const apply = () => { if (!validation) runQuery({ year, endMonth, include, statusFilter }); };
  const reset = () => {
    const y = periods?.default_year ?? new Date().getFullYear();
    setYear(y); setEndMonth('auto'); setInclude('non_zero'); setStatusFilter('all');
    runQuery({ year: y, endMonth: 'auto', include: 'non_zero', statusFilter: 'all' });
  };

  const download = async (format: PrintFormat) => {
    if (!data) return;
    setDownloadOpen(false);
    setDownloading(format);
    try {
      if (format === 'excel') {
        // Excel = sheet "TB" saja, dengan template yang sama seperti sheet TB di workbook Financial Statement (halaman Reports).
        // Periode mengikuti data yang sedang tampil di halaman ini.
        const { year: y, end_month: m } = data.periode;
        const label = `${m === 1 ? 'Jan' : `Jan – ${MONTH_NAMES[m - 1]}`} ${y}`;
        await downloadReportsSheet({ companyName, periodLabel: label, year: y, endMonth: m, managementClientId: activeClientId ?? null }, 'TB');
      } else {
        await printReport(buildPrintReport(data, companyName, user?.nama || user?.username), format);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download the Excel file.');
    } finally {
      setDownloading(null);
    }
  };

  const accountCount = data ? data.groups.reduce((s, g) => s + g.accounts.length, 0) : 0;
  const balanced = data ? data.balance_check.debit_equals_kredit && data.balance_check.balance_sheet_balanced : true;

  return (
    <div className={`${salesFont.className} px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-5 fade-in`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900">
            <ArrowLeft size={15} /> Reports
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-neutral-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-neutral-100 ring-1 ring-neutral-200">
              <Scale size={22} className="text-neutral-700" />
            </span>
            Trial Balance
          </h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">
            Opening balance, monthly movements, and ending balances by account{companyName ? ` · ${companyName}` : ''}.
          </p>
        </div>

        <div className="relative" ref={downloadRef}>
          <button
            type="button" onClick={() => setDownloadOpen(o => !o)}
            disabled={!data || accountCount === 0 || downloading !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download <ChevronDown size={15} />
          </button>
          {downloadOpen && (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-neutral-300 bg-white py-1 shadow-lg">
              {([['pdf', 'PDF', FileText], ['csv', 'CSV', FileText], ['excel', 'Excel (XLSX)', FileSpreadsheet]] as const).map(([fmtId, label, Icon]) => (
                <button
                  key={fmtId} type="button" onClick={() => download(fmtId)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200"
                >
                  <Icon size={16} className="text-neutral-600" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter */}
      <form onSubmit={e => { e.preventDefault(); apply(); }} className="relative space-y-4 rounded-[10px] border border-neutral-300 bg-white p-5 pt-6 shadow-sm">
        <span className="absolute inset-x-0 top-0 h-0.5 rounded-t-[10px] bg-neutral-800" />
        <KpiSectionLabel><Filter size={14} className="text-neutral-700" /> Filters</KpiSectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[8rem_13rem_18rem_minmax(0,1fr)] gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Year</span>
            <NeutralSelect value={String(year)} onChange={v => setYear(Number(v))} options={yearOptions} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Until</span>
            <NeutralSelect value={endMonth} onChange={setEndMonth} options={monthOptions} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Include Account</span>
            <NeutralSelect value={include} onChange={setInclude} options={INCLUDE_OPTIONS} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Journal Status</span>
            <NeutralSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className={`text-xs font-medium ${validation && hydrated ? 'text-amber-700' : 'text-neutral-500'}`}>
            {hydrated && validation ? validation : 'Transactions in Journal Preview (draft, pending, approved, posted) go straight into the trial balance, same as the General Ledger. Rejected and voided are excluded.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
              <RotateCcw size={15} /> Reset
            </button>
            <button
              type="submit" disabled={!!validation || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply Filter
            </button>
          </div>
        </div>
      </form>

      {error && <div className="border border-neutral-800 bg-neutral-100 text-neutral-900 rounded-[10px] px-4 py-3 text-sm">{error}</div>}

      {loading && !data && (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-[10px] bg-neutral-100 animate-pulse" />)}</div>
      )}

      {data && (
        <div className={`space-y-4 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {/* Banner */}
          <div className="space-y-2">
            <div className={`flex items-start gap-2.5 rounded-[10px] border px-4 py-3 text-sm ${balanced ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
              {balanced ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
              <p>
                {balanced
                  ? `Balanced: total debit equals total credit (${fmtNumber(data.balance_check.total_debit)}) and Assets = Liabilities + Equities.`
                  : `Out of balance: debit − credit = ${fmtNumber(data.balance_check.difference)}, control (Assets − Liabilities − Equities) = ${fmtNumber(data.totals.control_ytd)}.`}
              </p>
            </div>

            {data.unposted.has_unposted && (
              <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <div className="space-y-1.5">
                    <p>
                      {data.unposted.lines.toLocaleString('id-ID')} journal lines (Dr {fmtNumber(data.unposted.debit)} / Cr {fmtNumber(data.unposted.kredit)}) are not posted yet.
                      They are already included in this trial balance. Accounts with an amber dot contain them.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.status_summary.map(s => (
                        <span key={s.status} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.posted ? 'border-neutral-300 bg-white text-neutral-700' : 'border-amber-400 bg-amber-100 text-amber-900'}`}>
                          {statusLabel(s.status)} · {s.journals.toLocaleString('id-ID')} journals
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {data.tanpa_coa.accounts > 0 && (
              <div className="flex items-start gap-2.5 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>
                  {data.tanpa_coa.accounts} account(s) in the journals are not in this client&apos;s COA
                  ({data.tanpa_coa.codes.slice(0, 8).map(c => (c === '(no code)' ? c : kodeAkun(c))).join(', ')}{data.tanpa_coa.codes.length > 8 ? ', …' : ''};
                  Dr {fmtNumber(data.tanpa_coa.debit)} / Cr {fmtNumber(data.tanpa_coa.kredit)}).
                  They are still counted and grouped by the first digit of their code. Add them to the COA to classify them properly.
                </p>
              </div>
            )}
          </div>

          {/* KPI */}
          <div>
            <KpiSectionLabel>Trial Balance Summary · Jan – {data.periode.months[data.periode.months.length - 1]} {data.periode.year}</KpiSectionLabel>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <PurchaseKpiTile
                label="Total Assets" value={fmtNumber(data.totals.total_asset_ytd)} icon={Wallet}
                sub={`${accountCount.toLocaleString('id-ID')} accounts listed`}
                pct={data.totals.total_liabilities_equity_ytd !== 0 ? (data.totals.total_asset_ytd / data.totals.total_liabilities_equity_ytd) * 100 : 0} pctLabel="of liabilities + equities"
              />
              <PurchaseKpiTile
                label="Liabilities + Equities" value={fmtNumber(data.totals.total_liabilities_equity_ytd)} icon={Landmark}
                sub="Incl. current year profit / loss"
                pct={data.totals.total_asset_ytd !== 0 ? (data.totals.total_liabilities_equity_ytd / data.totals.total_asset_ytd) * 100 : 0} pctLabel="of total assets"
              />
              <PurchaseKpiTile
                label="Control" value={fmtNumber(data.totals.control_ytd)} icon={ShieldCheck}
                sub={balanced ? 'Balanced' : 'Needs review'} pct={balanced ? 100 : 0} pctLabel={balanced ? 'balanced' : 'out of balance'}
              />
              <PurchaseKpiTile
                label={data.current_year_profit.ytd >= 0 ? 'Profit (YTD)' : 'Loss (YTD)'} value={fmtNumber(data.current_year_profit.ytd)} icon={TrendingUp}
                sub="Revenue − costs − expenses" pct={data.current_year_profit.ytd > 0 ? 100 : 0} pctLabel="current year result"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">
              {STATUS_OPTIONS.find(o => o.id === data.filter.status_filter)?.label} · {INCLUDE_OPTIONS.find(o => o.id === data.periode.include)?.label} · click a monthly balance to open it in the General Ledger
            </p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                value={search} onChange={e => setSearch(e.target.value)} placeholder="Find account"
                className="w-56 rounded-lg border border-neutral-300 bg-white py-2 pl-8 pr-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          </div>

          {accountCount === 0 ? (
            <div className="bg-white border border-dashed border-neutral-300 rounded-[10px] p-10 text-center">
              <Scale size={30} className="mx-auto text-neutral-300 mb-3" />
              <p className="text-sm font-semibold text-neutral-900">No accounts to show</p>
              <p className="text-xs text-neutral-500 mt-1">There are no transactions for this filter.</p>
            </div>
          ) : (
            <TbTable tb={data} search={search} />
          )}
        </div>
      )}
    </div>
  );
}