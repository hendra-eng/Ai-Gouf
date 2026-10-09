'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchChangesInEquity, type ChangesInEquity, type PeriodQuery } from '@/lib/fsStore';
import type { PrintColumn, PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import DownloadMenu from './DownloadMenu';
import { CheckBanner, WarningsPanel } from './CheckBanner';
import PeriodPicker, { defaultPeriod } from './PeriodPicker';
import { fmtAmount, fmtDate, glHref } from './fsFormat';

// Task Plan 18 -- Statement of Changes in Equity: saldo awal komponen
// ekuitas + mutasi (setoran modal, prive/dividen, laba periode, transfer ke
// saldo laba, OCI, penyesuaian) = saldo akhir, direkonsiliasi ke Balance Sheet.

function rowLabel(label: string): string {
  // "Balance as at 2026-01-01" -> tanggal ramah baca
  return label.replace(/(\d{4}-\d{2}-\d{2})/, m => fmtDate(m));
}

function buildReport(d: ChangesInEquity, company: string, printedBy?: string): PrintReport {
  const columns: PrintColumn[] = [{ key: 'desc', header: 'Description', width: 44 }];
  d.components.forEach(c => columns.push({ key: c.key, header: c.label, type: 'money', width: 18 }));
  columns.push({ key: 'total', header: 'Total Equity', type: 'money', width: 18 });
  const rows: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  d.rows.forEach(r => {
    rows.push({ desc: rowLabel(r.label), ...r.values, total: r.total });
    styles.push(r.type === 'movement' ? undefined : 'total');
  });
  return {
    title: 'Statement of Changes in Equity', fileBase: `Changes-in-Equity-${d.period.start}_${d.period.end}`,
    companyName: company, subtitle: `Period ${d.period_info.label}`, orientation: 'landscape', printedBy,
    table: { columns, rows, rowStyles: styles },
  };
}

export default function EquityClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodQuery>(() => ({ ...defaultPeriod(), compare: 'none' }));
  const [data, setData] = useState<ChangesInEquity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback((signal?: AbortSignal) => {
    if (!activeClientId) return;
    setLoading(true);
    setError(null);
    fetchChangesInEquity(activeClientId, period, signal)
      .then(d => { setData(d); setOpen(new Set()); })
      .catch(e => { if ((e as Error).name !== 'AbortError') { setError((e as Error).message); setData(null); } })
      .finally(() => setLoading(false));
  }, [activeClientId, period]);

  useEffect(() => {
    if (!hydrated) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [hydrated, load]);

  const company = data?.client.company_name ?? '';
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <FsShell
      title="Statement of Changes in Equity"
      subtitle={<>Movement of each equity component from opening to closing balance{company ? ` · ${company}` : ''}</>}
      actions={<DownloadMenu disabled={!data} build={() => buildReport(data!, company, user?.nama || user?.username)} />}
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <PeriodPicker value={period} onApply={setPeriod} loading={loading} hideCompare />
          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <CheckBanner
                ok={data.check.reconciled}
                okText={`Reconciled — closing equity ${fmtAmount(data.check.closing_equity)} equals total equity on the Balance Sheet at ${fmtDate(data.period.end)}`}
                failText={`Not reconciled with the Balance Sheet — difference ${fmtAmount(data.check.difference)}`}
              />
              <WarningsPanel warnings={data.warnings} />
              <div className="bg-card border border-border rounded-xl overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-slate-50 border-b border-border">
                      <th className="text-left font-semibold px-5 py-2.5">Description</th>
                      {data.components.map(c => <th key={c.key} className="text-right font-semibold px-3 py-2.5">{c.label}</th>)}
                      <th className="text-right font-semibold px-4 py-2.5">Total Equity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => {
                      const strong = r.type !== 'movement';
                      const drill = Object.values(r.accounts).some(l => l.length > 0);
                      const isOpen = open.has(r.key);
                      return (
                        <React.Fragment key={r.key}>
                          <tr
                            className={`border-t border-border ${strong ? 'bg-blue-50/60 font-semibold' : 'hover:bg-slate-50'} ${drill ? 'cursor-pointer' : ''}`}
                            onClick={drill ? () => toggle(r.key) : undefined}
                          >
                            <td className="px-5 py-2.5 text-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                {drill ? (isOpen ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronRight size={15} className="text-muted-foreground" />) : <span className="w-[15px]" />}
                                {rowLabel(r.label)}
                              </span>
                            </td>
                            {data.components.map(c => (
                              <td key={c.key} className={`px-3 py-2.5 text-right tabular-nums ${r.values[c.key] < 0 ? 'text-rose-700' : ''}`}>{fmtAmount(r.values[c.key])}</td>
                            ))}
                            <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.total < 0 ? 'text-rose-700' : ''}`}>{fmtAmount(r.total)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={data.components.length + 2} className="px-10 py-3">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                  {data.components.filter(c => r.accounts[c.key]?.length).map(c => (
                                    <div key={c.key} className="bg-card border border-border rounded-lg p-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{c.label}</p>
                                      <ul className="space-y-1 text-[13px]">
                                        {r.accounts[c.key].map((a, i) => (
                                          <li key={`${a.code ?? 'auto'}-${i}`} className="flex items-center justify-between gap-3">
                                            <span className="inline-flex items-center gap-1.5 min-w-0">
                                              {a.code ? <span className="font-mono text-xs text-muted-foreground">{a.code}</span> : <span className="text-[10px] font-semibold uppercase bg-violet-50 text-violet-700 rounded px-1.5">Auto</span>}
                                              <span className="truncate">{a.name}</span>
                                              {a.code && (
                                                <Link href={glHref(a.code, data.period.start, data.period.end)} target="_blank" title="Open in General Ledger" className="text-muted-foreground hover:text-blue-700">
                                                  <ExternalLink size={12} />
                                                </Link>
                                              )}
                                            </span>
                                            <span className="tabular-nums">{fmtAmount(a.amount)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Columns follow the equity component mapping of each equity account (Mapping tab). Current year earnings are computed from the
                Profit &amp; Loss; at the start of a new year they move to retained earnings automatically. Click a row to see the accounts behind it.
              </p>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}
