'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchCashFlow, type CashFlow, type CashFlowBody, type CfLine, type PeriodQuery } from '@/lib/fsStore';
import type { PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import DownloadMenu from './DownloadMenu';
import { CheckBanner } from './CheckBanner';
import PeriodPicker, { defaultPeriod } from './PeriodPicker';
import { fmtAmount, glHref } from './fsFormat';

// Task Plan 19 -- Cash Flow Statement metode tidak langsung dari GL.
// Kategori tiap akun neraca (Operating / Non-cash / Investing / Financing /
// Cash) dari mapping per klien; akun tanpa mapping di-flag.

type Row =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'sub'; key: string; label: string }
  | { kind: 'line'; key: string; label: string; amount: number; compare: number | null; line?: CfLine; flag?: boolean; plLink?: boolean }
  | { kind: 'total'; key: string; label: string; amount: number; compare: number | null; strong?: boolean };

function susunBaris(d: CashFlowBody, c: CashFlowBody | undefined): Row[] {
  const cari = (pilih: (b: CashFlowBody) => CfLine[], label: string) => c ? (pilih(c).find(l => l.label === label)?.amount ?? 0) : null;
  const baris = (pilih: (b: CashFlowBody) => CfLine[], prefix: string, flag = false): Row[] => {
    const labels = new Set([...pilih(d).map(l => l.label), ...(c ? pilih(c).map(l => l.label) : [])]);
    return [...labels].map(label => {
      const line = pilih(d).find(l => l.label === label);
      return { kind: 'line' as const, key: `${prefix}:${label}`, label, amount: line?.amount ?? 0, compare: cari(pilih, label), line, flag };
    });
  };
  const rows: Row[] = [
    { kind: 'heading', key: 'h-op', label: 'Cash flows from operating activities' },
    { kind: 'line', key: 'np', label: 'Net profit for the period', amount: d.operating.net_profit, compare: c ? c.operating.net_profit : null, plLink: true },
  ];
  if (d.operating.non_cash_adjustments.length || c?.operating.non_cash_adjustments.length) {
    rows.push({ kind: 'sub', key: 's-nc', label: 'Adjustments for non-cash items' }, ...baris(b => b.operating.non_cash_adjustments, 'nc'));
  }
  if (d.operating.working_capital.length || c?.operating.working_capital.length) {
    rows.push({ kind: 'sub', key: 's-wc', label: 'Changes in working capital' }, ...baris(b => b.operating.working_capital, 'wc'));
  }
  if (d.operating.unmapped.length || c?.operating.unmapped.length) {
    rows.push(...baris(b => b.operating.unmapped, 'um', true));
  }
  rows.push({ kind: 'total', key: 't-op', label: 'Net cash from operating activities', amount: d.operating.total, compare: c ? c.operating.total : null });
  rows.push({ kind: 'heading', key: 'h-inv', label: 'Cash flows from investing activities' }, ...baris(b => b.investing.lines, 'inv'));
  rows.push({ kind: 'total', key: 't-inv', label: 'Net cash from investing activities', amount: d.investing.total, compare: c ? c.investing.total : null });
  rows.push({ kind: 'heading', key: 'h-fin', label: 'Cash flows from financing activities' }, ...baris(b => b.financing.lines, 'fin'));
  rows.push({ kind: 'total', key: 't-fin', label: 'Net cash from financing activities', amount: d.financing.total, compare: c ? c.financing.total : null });
  rows.push(
    { kind: 'total', key: 'net', label: 'Net increase/(decrease) in cash and cash equivalents', amount: d.net_change, compare: c ? c.net_change : null, strong: true },
    { kind: 'line', key: 'open', label: 'Cash and cash equivalents at beginning of period', amount: d.opening_cash, compare: c ? c.opening_cash : null },
    { kind: 'total', key: 'end', label: 'Cash and cash equivalents at end of period', amount: d.ending_cash, compare: c ? c.ending_cash : null, strong: true },
  );
  return rows;
}

function buildReport(d: CashFlow, rows: Row[], company: string, printedBy?: string): PrintReport {
  const compare = !!d.compare;
  const out: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  rows.forEach(r => {
    if (r.kind === 'heading' || r.kind === 'sub') {
      out.push({ desc: r.kind === 'heading' ? r.label.toUpperCase() : `  ${r.label}` });
      styles.push('section');
      return;
    }
    out.push({ desc: r.kind === 'line' ? `    ${r.label}` : r.label, cur: r.amount, cmp: r.compare });
    styles.push(r.kind === 'total' ? 'total' : undefined);
    if (r.kind === 'line' && r.line) {
      r.line.accounts.forEach(a => { out.push({ desc: `        ${a.code} ${a.name}`, cur: a.amount }); styles.push(undefined); });
    }
  });
  return {
    title: 'Statement of Cash Flows (Indirect Method)', fileBase: `Cash-Flow-${d.period.start}_${d.period.end}`,
    companyName: company, subtitle: `Period ${d.period_info.label}${d.period_info.compare ? ` vs ${d.period_info.compare.label}` : ''}`, printedBy,
    table: {
      columns: [
        { key: 'desc', header: 'Description', width: 56 },
        { key: 'cur', header: d.period_info.label, type: 'money', width: 20 },
        ...(compare ? [{ key: 'cmp', header: d.period_info.compare!.label, type: 'money' as const, width: 20 }] : []),
      ],
      rows: out, rowStyles: styles,
    },
  };
}

export default function CashFlowClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodQuery>(() => ({ ...defaultPeriod(), compare: 'none' }));
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fsQuery = useQuery({
    queryKey: ['fs', 'cash-flow', activeClientId, period],
    queryFn: ({ signal }) => fetchCashFlow(activeClientId!, period, signal),
    enabled: hydrated && !!activeClientId,
    placeholderData: keepPreviousData,
  });
  const data: CashFlow | null = fsQuery.data ?? null;
  const loading = fsQuery.isFetching && (fsQuery.isPlaceholderData || !fsQuery.data);
  const error = fsQuery.error ? (fsQuery.error as Error).message : null;

  // Dulu di-reset di .then(); sekarang saat data baru (bukan placeholder) tiba.
  useEffect(() => { if (fsQuery.data && !fsQuery.isPlaceholderData) setOpen(new Set()); }, [fsQuery.data, fsQuery.isPlaceholderData]);

  const rows = useMemo(() => (data ? susunBaris(data, data.compare) : []), [data]);
  const company = data?.client.company_name ?? '';
  const compare = !!data?.compare;
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const unmappedMoving = data?.unmapped_accounts.filter(a => a.has_movement) ?? [];

  return (
    <FsShell
      title="Cash Flow Statement"
      subtitle={<>Indirect method from the General Ledger and the client cash flow mapping{company ? ` · ${company}` : ''}</>}
      actions={<DownloadMenu disabled={!data} build={() => buildReport(data!, rows, company, user?.nama || user?.username)} />}
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <PeriodPicker value={period} onApply={setPeriod} loading={loading} />
          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <CheckBanner
                ok={data.check.reconciled}
                okText={`Reconciled — opening cash ${fmtAmount(data.opening_cash)} + net change ${fmtAmount(data.net_change)} = ending cash ${fmtAmount(data.balance_sheet_ending_cash)} on the Balance Sheet`}
                failText={`Not reconciled — computed ending cash ${fmtAmount(data.ending_cash)} vs Balance Sheet ${fmtAmount(data.balance_sheet_ending_cash)} (difference ${fmtAmount(data.check.difference)})`}
                journals={data.check.unbalanced_journals}
              />
              {data.unmapped_accounts.length > 0 && (
                <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-2.5 text-sm">
                  <AlertTriangle size={16} className="text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {data.unmapped_accounts.length} balance sheet account{data.unmapped_accounts.length > 1 ? 's have' : ' has'} no cash flow mapping
                      {unmappedMoving.length ? ` (${unmappedMoving.length} with movement this period, shown under Operating)` : ''}.
                    </p>
                    <p className="text-xs mt-0.5">
                      {data.unmapped_accounts.slice(0, 8).map(a => `${a.code} ${a.name}`).join(' · ')}{data.unmapped_accounts.length > 8 ? ' …' : ''}{' '}
                      <Link href="/financial-statements/mapping" className="font-semibold underline">Fix in Mapping</Link>
                    </p>
                  </div>
                </div>
              )}
              <div className="bg-card border border-border rounded-xl overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-slate-50 border-b border-border">
                      <th className="text-left font-semibold px-5 py-2.5">Description</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">{data.period_info.label}</th>
                      {compare && <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">{data.period_info.compare?.label}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      if (r.kind === 'heading') return <tr key={r.key} className="border-t border-border"><td colSpan={compare ? 3 : 2} className="px-5 pt-4 pb-1.5 text-xs font-bold uppercase tracking-wider text-blue-800">{r.label}</td></tr>;
                      if (r.kind === 'sub') return <tr key={r.key}><td colSpan={compare ? 3 : 2} className="pl-8 pr-5 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{r.label}</td></tr>;
                      if (r.kind === 'total') {
                        return (
                          <tr key={r.key} className={`border-t-2 border-border ${r.strong ? 'bg-blue-50/70 font-bold text-blue-900' : 'bg-slate-50 font-semibold'}`}>
                            <td className="px-5 py-2.5">{r.label}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${r.amount < 0 ? 'text-rose-700' : ''}`}>{fmtAmount(r.amount)}</td>
                            {compare && <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(r.compare)}</td>}
                          </tr>
                        );
                      }
                      const drill = !!r.line?.accounts.length;
                      const isOpen = open.has(r.key);
                      return (
                        <React.Fragment key={r.key}>
                          <tr className={`border-t border-border hover:bg-slate-50 ${drill ? 'cursor-pointer' : ''} ${r.flag ? 'bg-amber-50/60' : ''}`} onClick={drill ? () => toggle(r.key) : undefined}>
                            <td className="pl-10 pr-5 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                {drill ? (isOpen ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronRight size={15} className="text-muted-foreground" />) : <span className="w-[15px]" />}
                                {r.flag && <AlertTriangle size={14} className="text-amber-500" />}
                                {r.label}
                                {r.plLink && (
                                  <Link href="/financial-statements/profit-loss" onClick={e => e.stopPropagation()} className="text-muted-foreground hover:text-blue-700" title="Open Profit & Loss">
                                    <ExternalLink size={13} />
                                  </Link>
                                )}
                              </span>
                            </td>
                            <td className={`px-4 py-2 text-right tabular-nums ${r.amount < 0 ? 'text-rose-700' : ''}`}>{fmtAmount(r.amount)}</td>
                            {compare && <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmtAmount(r.compare)}</td>}
                          </tr>
                          {isOpen && r.line && r.line.accounts.map(a => (
                            <tr key={`${r.key}-${a.code}`} className="text-[13px] hover:bg-slate-50">
                              <td className="pl-16 pr-5 py-1.5">
                                <span className="inline-flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                                  <span className="text-foreground/90">{a.name}</span>
                                  <span className="text-xs text-muted-foreground">({fmtAmount(a.opening)} → {fmtAmount(a.closing)})</span>
                                  <Link href={glHref(a.code, data.period.start, data.period.end)} target="_blank" title="Open in General Ledger" className="text-muted-foreground hover:text-blue-700">
                                    <ExternalLink size={13} />
                                  </Link>
                                </span>
                              </td>
                              <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{fmtAmount(a.amount)}</td>
                              {compare && <td />}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.cash_accounts.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Cash &amp; cash equivalents accounts (mapped as Cash)</p>
                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[13px]">
                    {data.cash_accounts.map(a => (
                      <div key={a.code} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                          <span className="truncate">{a.name}</span>
                          <Link href={glHref(a.code, data.period.start, data.period.end)} target="_blank" className="text-muted-foreground hover:text-blue-700"><ExternalLink size={12} /></Link>
                        </span>
                        <span className="tabular-nums text-muted-foreground whitespace-nowrap">{fmtAmount(a.opening)} → <span className="text-foreground font-medium">{fmtAmount(a.closing)}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Each balance sheet account&apos;s change between the start and end of the period is classified by its cash flow mapping (Mapping tab).
                Increases in assets reduce cash; increases in liabilities and equity add cash.
              </p>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}
