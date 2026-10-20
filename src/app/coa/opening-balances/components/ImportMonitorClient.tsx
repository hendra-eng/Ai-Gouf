'use client';

// Monitoring import 1 modul (/coa/opening-balances/[id]/imports/[module]):
// riwayat seluruh batch upload modul ini + status approval-nya. Klik baris
// -> halaman review batch (submit / approve / reject).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Inbox, ListTree, Loader2, RefreshCw } from 'lucide-react';
import { fetchOpeningBalance, formatAmount, type OpeningBalanceDetail } from '@/lib/openingBalanceStore';
import { fetchImportOverview, type ImportBatch, type ImportBatchStatus } from '@/lib/openingBalanceImportStore';
import { BatchStatusBadge, formatDateTime, metaModul } from './importUi';
import { branchLabel } from './obUi';

type Filter = 'all' | ImportBatchStatus;

const FILTER: [Filter, string][] = [
  ['all', 'All'],
  ['submitted', 'Pending approval'],
  ['validated', 'Ready'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
];

export default function ImportMonitorClient() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const id = params?.id ?? '';
  const meta = metaModul(params?.module ?? '');

  const [ob, setOb] = useState<OpeningBalanceDetail | null>(null);
  const [batch, setBatch] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [memuat, setMemuat] = useState(false);

  const muat = useCallback(() => {
    if (!id || !meta) return;
    setMemuat(true);
    Promise.all([fetchOpeningBalance(id), fetchImportOverview(id)])
      .then(([o, ov]) => {
        setOb(o);
        setBatch(ov.batches.filter(b => b.module === meta.key));
        setError(null);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load import history.'))
      .finally(() => setMemuat(false));
  }, [id, meta]);

  useEffect(() => { muat(); }, [muat]);

  const hitung = useMemo(() => {
    const c: Record<string, number> = { all: batch?.length ?? 0 };
    for (const b of batch ?? []) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [batch]);
  const tampil = (batch ?? []).filter(b => filter === 'all' || b.status === filter);

  if (!meta || error) {
    return (
      <div className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><Inbox size={18} /></div>
          <h2 className="text-sm font-semibold text-foreground">Import module not found</h2>
          <p className="mt-1 text-xs text-muted-foreground">{error ?? 'Unknown import module.'}</p>
          <Link href={`/coa/opening-balances/${id}`} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50">
            <ArrowLeft size={14} /> Back to opening balance
          </Link>
        </div>
      </div>
    );
  }

  const Icon = meta.icon;

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-screen-2xl px-6 py-5">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-foreground">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <Link href="/coa/opening-balances" className="hover:text-foreground">Opening balances</Link>
            <ChevronRight size={12} />
            <Link href={`/coa/opening-balances/${id}`} className="hover:text-foreground">
              {ob ? `FY ${ob.fiscal_year} · ${branchLabel(ob.branch)}` : '…'}
            </Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">Import monitoring</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Link href={`/coa/opening-balances/${id}`} title="Back" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground">
                <ArrowLeft size={16} />
              </Link>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.iconCls}`}><Icon size={18} /></div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">{meta.no}. {meta.title}</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">Upload history, validation results, and approval status.</p>
              </div>
            </div>
            <button onClick={muat} disabled={memuat} className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} className={memuat ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {([
            ['Batches', hitung.all, 'text-foreground'],
            ['Pending approval', hitung.submitted ?? 0, 'text-amber-600'],
            ['Approved', hitung.approved ?? 0, 'text-emerald-600'],
            ['Rejected', hitung.rejected ?? 0, 'text-red-600'],
          ] as const).map(([label, val, cls]) => (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${cls}`}>{batch ? val : '–'}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap gap-1 border-b border-border p-3">
            {FILTER.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filter === k ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-slate-100 hover:text-foreground'}`}
              >
                {label} <span className="opacity-70">({hitung[k] ?? 0})</span>
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">File</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3 text-right">Rows</th>
                  <th className="px-4 py-3 text-right">Valid / Warn / Error</th>
                  {meta.amounts.map(a => <th key={a.label} className="px-4 py-3 text-right">{a.label}</th>)}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {!batch ? (
                  <tr><td colSpan={8} className="py-14 text-center text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading…</td></tr>
                ) : tampil.length === 0 ? (
                  <tr><td colSpan={8} className="py-14 text-center text-sm text-muted-foreground">
                    {batch.length === 0 ? 'No files uploaded for this module yet.' : 'No batches match this filter.'}
                  </td></tr>
                ) : tampil.map(b => (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/coa/opening-balances/${id}/imports/${meta.key}/${b.id}`)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="max-w-xs px-5 py-3">
                      <p className="truncate font-medium text-foreground">{b.file_name}</p>
                      {b.review_note && <p className="truncate text-[11px] text-muted-foreground">“{b.review_note}”</p>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="text-foreground">{b.created_by_name ?? '—'}</p>
                      <p className="text-muted-foreground">{formatDateTime(b.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.total_rows}</td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      <span className="text-emerald-700">{b.valid_rows}</span>
                      {' / '}<span className="text-amber-700">{b.warning_rows}</span>
                      {' / '}<span className={b.error_rows ? 'font-semibold text-red-600' : 'text-slate-500'}>{b.error_rows}</span>
                    </td>
                    {meta.amounts.map(a => <td key={a.label} className="px-4 py-3 text-right font-mono text-xs tabular-nums">{formatAmount(b[a.field])}</td>)}
                    <td className="px-4 py-3"><BatchStatusBadge batch={b} /></td>
                    <td className="px-4 py-3 text-xs">
                      {b.reviewed_at ? (
                        <>
                          <p className="text-foreground">{b.reviewed_by_name ?? '—'}</p>
                          <p className="text-muted-foreground">{formatDateTime(b.reviewed_at)}</p>
                        </>
                      ) : b.submitted_at ? (
                        <p className="text-muted-foreground">Submitted {formatDateTime(b.submitted_at)}</p>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

