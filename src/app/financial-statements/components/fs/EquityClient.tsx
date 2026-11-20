'use client';

import React, { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Printer } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchChangesInEquity, type ChangesInEquity, type PeriodQuery } from '@/lib/fsStore';
import type { PrintColumn, PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import DownloadMenu from './DownloadMenu';
import { CheckBanner, WarningsPanel } from './CheckBanner';
import PeriodPicker, { defaultPeriod } from './PeriodPicker';
import { fmtAmount, fmtDate, glHref } from './fsFormat';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { thCls, thRowCls, trCls } from './bs/BsMono';
import { Num } from './pl/PlUi';

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
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodQuery>(() => ({ ...defaultPeriod(), compare: 'none' }));
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fsQuery = useQuery({
    queryKey: ['fs', 'changes-in-equity', activeClientId, period],
    queryFn: ({ signal }) => fetchChangesInEquity(activeClientId!, period, signal),
    enabled: hydrated && !!activeClientId,
    placeholderData: keepPreviousData,
  });
  const data: ChangesInEquity | null = fsQuery.data ?? null;
  const loading = fsQuery.isFetching && (fsQuery.isPlaceholderData || !fsQuery.data);
  const error = fsQuery.error ? (fsQuery.error as Error).message : null;

  // Dulu di-reset di .then(); sekarang saat data baru (bukan placeholder) tiba.
  useEffect(() => { if (fsQuery.data && !fsQuery.isPlaceholderData) setOpen(new Set()); }, [fsQuery.data, fsQuery.isPlaceholderData]);

  const company = data?.client.company_name ?? '';
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <FsShell
      title="Statement of Changes in Equity"
      subtitle={<>Movement of each equity component from opening to closing balance{company ? ` · ${company}` : ''}</>}
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <PeriodPicker
            mono
            value={period}
            onApply={setPeriod}
            loading={loading}
            hideCompare
            trailing={
              <>
                <button type="button" onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                  <Printer size={14} className="text-neutral-500" /> Print
                </button>
                <DownloadMenu variant="mono" disabled={!data} build={() => buildReport(data!, company, user?.nama || user?.username)} />
              </>
            }
          />
          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <CheckBanner
                fontCls="text-xs font-medium"
                ok={data.check.reconciled}
                okText={`Reconciled — closing equity ${fmtAmount(data.check.closing_equity)} equals total equity on the Balance Sheet at ${fmtDate(data.period.end)}`}
                failText={`Not reconciled with the Balance Sheet — difference ${fmtAmount(data.check.difference)}`}
              />
              <WarningsPanel fontCls="text-xs font-medium" warnings={data.warnings} />
              {/* Gaya tabel disamakan dengan Profit & Loss / Balance Sheet: header abu, baris saldo abu muda
                  bergaris tebal, garis pemisah tipis, hover abu, teks kolom pertama tidak turun baris. */}
              <section className={`card-elevated-md rounded-xl ${salesFont.className}`}>
                <div className="overflow-x-auto scrollbar-thin p-3">
                  <table className="w-full border-separate border-spacing-0 text-xs" style={{ minWidth: 760 }}>
                    <thead>
                      <tr className={thRowCls}>
                        <th className={`${thCls} pl-8 text-left`}>Description</th>
                        {data.components.map(c => <th key={c.key} className={`${thCls} text-right`}>{c.label}</th>)}
                        <th className={`${thCls} text-right`}>Total Equity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map(r => {
                        const strong = r.type !== 'movement';
                        const drill = Object.values(r.accounts).some(l => l.length > 0);
                        const isOpen = open.has(r.key);
                        const chevron = drill
                          ? (isOpen ? <ChevronDown size={14} className="text-neutral-500" /> : <ChevronRight size={14} className="text-neutral-500" />)
                          : <span className="w-[14px]" />;
                        return (
                          <React.Fragment key={r.key}>
                            <tr
                              className={strong
                                ? `text-xs [&>td]:bg-neutral-200 [&>td]:shadow-[inset_0_-1px_0_#171717,inset_0_1px_0_#171717] ${drill ? 'cursor-pointer' : ''}`
                                : `${trCls} ${drill ? 'cursor-pointer' : ''}`}
                              onClick={drill ? () => toggle(r.key) : undefined}
                            >
                              <td className={`px-3 ${strong ? 'py-2.5 font-bold' : 'py-2'} whitespace-nowrap text-neutral-900`}>
                                <span className="inline-flex items-center gap-1.5">{chevron}{rowLabel(r.label)}</span>
                              </td>
                              {data.components.map(c => <Num key={c.key} v={r.values[c.key]} bold={strong} className="py-2" />)}
                              <Num v={r.total} bold={strong} className="py-2" />
                            </tr>
                            {isOpen && data.components.filter(c => r.accounts[c.key]?.length).flatMap(c =>
                              r.accounts[c.key].map((a, i) => (
                                <tr key={`${r.key}-${c.key}-${a.code ?? 'auto'}-${i}`} className={trCls}>
                                  <td className="pl-14 pr-3 py-1 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-2 min-w-0 text-neutral-500">
                                      {a.code ? <span className="font-mono text-[11px]">{kodeAkun(a.code)}</span> : <span className="rounded bg-neutral-200 px-1.5 text-[10px] font-semibold uppercase text-neutral-700">Auto</span>}
                                      <span className="truncate">{a.name}</span>
                                      {a.code && (
                                        <Link href={glHref(a.code, data.period.start, data.period.end)} target="_blank" title="Open in General Ledger" onClick={e => e.stopPropagation()} className="hover:text-neutral-900">
                                          <ExternalLink size={12} />
                                        </Link>
                                      )}
                                    </span>
                                  </td>
                                  {data.components.map(cc => (cc.key === c.key ? <Num key={cc.key} v={a.amount} className="py-1" /> : <td key={cc.key} className="px-3 py-1" />))}
                                  <Num v={a.amount} className="py-1" />
                                </tr>
                              ))
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="text-xs font-medium text-neutral-500">
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