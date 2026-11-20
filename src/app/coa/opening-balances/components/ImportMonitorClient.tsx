'use client';

// Monitoring import 1 modul (/coa/opening-balances/[id]/imports/[module]):
// riwayat seluruh batch upload modul ini + status approval-nya. Klik baris
// -> halaman review batch (submit / approve / reject).
//
// Desain mengikuti halaman Chart of Accounts (monokrom neutral, kartu dengan
// garis atas gelap, header tabel abu gelap). CATATAN Tailwind: modifier opacity
// (bg-xxx/5 dst) tidak menghasilkan CSS di proyek ini -- pakai palet bawaan.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ChevronRight, Clock, Inbox, Layers, ListTree, RefreshCw, Search, XCircle } from 'lucide-react';
import { fetchOpeningBalance, formatAmount, type OpeningBalanceDetail } from '@/lib/openingBalanceStore';
import { fetchImportOverview, type ImportBatch, type ImportBatchStatus } from '@/lib/openingBalanceImportStore';
import { BatchStatusBadge, formatDateTime, metaModul } from './importUi';
import { branchLabel } from './obUi';
import { btnOutline } from '@/components/arap/arapSalesUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

type Filter = 'all' | ImportBatchStatus;

// Titik warna kecil per status (sama gaya chip klasifikasi di halaman COA).
const FILTER: [Filter, string, string | null][] = [
  ['all', 'All', null],
  ['submitted', 'Pending approval', 'bg-amber-500'],
  ['validated', 'Ready', 'bg-sky-500'],
  ['approved', 'Approved', 'bg-emerald-500'],
  ['rejected', 'Rejected', 'bg-red-500'],
  ['cancelled', 'Cancelled', 'bg-neutral-400'],
];

function StatCard({ icon: Icon, label, value, note }: {
  icon: React.ElementType; label: string; value: number | string; note?: string;
}) {
  // Desain sama dengan kartu KPI halaman COA / AR / AP.
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <div className="mt-1 min-h-4 text-[11px] text-neutral-500">{note}</div>
    </div>
  );
}

function EmptyRow({ colSpan, icon: Icon, title, hint }: { colSpan: number; icon: React.ElementType; title: string; hint: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-16">
        <div className="flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200">
            <Icon size={20} />
          </span>
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="mt-1 max-w-sm text-xs text-neutral-500">{hint}</p>
        </div>
      </td>
    </tr>
  );
}

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
      <div className={`${salesFont.className} min-h-screen bg-background px-6 py-16`}>
        <div className="relative mx-auto max-w-md overflow-hidden rounded-lg border border-neutral-300 bg-white p-8 text-center shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-neutral-800">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200"><Inbox size={20} /></span>
          <h2 className="text-sm font-semibold text-neutral-900">Import module not found</h2>
          <p className="mt-1 text-xs font-medium text-neutral-500">{error ?? 'Unknown import module.'}</p>
          <Link href={`/coa/opening-balances/${id}`} className={`${btnOutline} mt-5`}>
            <ArrowLeft size={14} /> Back to opening balance
          </Link>
        </div>
      </div>
    );
  }

  const Icon = meta.icon;
  const kolom = 7 + meta.amounts.length;
  const filterAktif = filter !== 'all';

  return (
    <div className={`${salesFont.className} min-h-screen bg-background pb-10`}>
      {/* Header: gaya COA / Opening Balance (monokrom) */}
      <div className="mx-auto max-w-screen-2xl px-6 pt-5 lg:px-8 xl:px-10">
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs font-medium text-neutral-500">
          <ListTree size={13} />
          <Link href="/coa" className="hover:text-neutral-900">Chart of Accounts</Link>
          <ChevronRight size={12} />
          <Link href="/coa/opening-balances" className="hover:text-neutral-900">Opening balances</Link>
          <ChevronRight size={12} />
          <Link href={`/coa/opening-balances/${id}`} className="hover:text-neutral-900">
            {ob ? `FY ${ob.fiscal_year} · ${branchLabel(ob.branch)}` : '…'}
          </Link>
          <ChevronRight size={12} />
          <span className="font-semibold text-neutral-900">Import monitoring</span>
        </nav>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/coa/opening-balances/${id}`} title="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
              <ArrowLeft size={18} />
            </Link>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.iconCls}`}><Icon size={18} /></span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{meta.no}. {meta.title}</h1>
              <p className="mt-1 text-sm font-medium text-neutral-500">Upload history, validation results, and approval status.</p>
            </div>
          </div>
          <button onClick={muat} disabled={memuat} className={btnOutline}>
            <RefreshCw size={14} className={memuat ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-6 lg:px-8 xl:px-10">
        {/* Ringkasan */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Layers} label="Batches" value={batch ? hitung.all : '–'} note="All uploads of this module" />
          <StatCard icon={Clock} label="Pending approval" value={batch ? hitung.submitted ?? 0 : '–'} note="Waiting for review" />
          <StatCard icon={CheckCircle2} label="Approved" value={batch ? hitung.approved ?? 0 : '–'} note="Imported into the books" />
          <StatCard icon={XCircle} label="Rejected" value={batch ? hitung.rejected ?? 0 : '–'} note="Returned for fixes" />
        </div>

        <div className="relative overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-0.5 before:bg-neutral-800">
          {/* Toolbar: chip status = filter cepat */}
          <div className="border-b border-neutral-300 bg-neutral-50 px-5 pb-4 pt-5">
            <div className="flex flex-wrap gap-1.5">
              {FILTER.map(([k, label, dot]) => {
                const aktif = filter === k;
                return (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      aktif
                        ? k === 'all'
                          ? 'border-neutral-800 bg-neutral-800 text-white'
                          : 'border-neutral-800 bg-neutral-100 text-neutral-900 ring-1 ring-neutral-800'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-700'
                    }`}
                  >
                    {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
                    {label}
                    <span className="tabular-nums opacity-70">{hitung[k] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tabel */}
          <div className="max-h-[64vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:shadow-[inset_0_1px_0_0_#262626,inset_0_-1px_0_0_#262626] [&>th]:font-bold">
                  <th className="px-5 py-2">File</th>
                  <th className="px-4 py-2">Uploaded</th>
                  <th className="px-4 py-2 text-right">Rows</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right">Valid / Warn / Error</th>
                  {meta.amounts.map(a => <th key={a.label} className="px-4 py-2 text-right">{a.label}</th>)}
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Reviewed</th>
                  <th className="w-10 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-400">
                {!batch ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={kolom} className="px-5 py-3.5">
                        <div className="h-4 animate-pulse rounded-md bg-neutral-100" style={{ width: `${60 + ((i * 7) % 35)}%` }} />
                      </td>
                    </tr>
                  ))
                ) : tampil.length === 0 ? (
                  batch.length === 0
                    ? <EmptyRow colSpan={kolom} icon={Inbox} title="No uploads yet" hint="No files have been uploaded for this module yet." />
                    : <EmptyRow colSpan={kolom} icon={Search} title="No matching batches" hint="Pick another status or clear the filter." />
                ) : tampil.map(b => (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/coa/opening-balances/${id}/imports/${meta.key}/${b.id}`)}
                    className="group cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="max-w-xs px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-8 w-0.5 shrink-0 rounded-full bg-neutral-800" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900" title={b.file_name}>{b.file_name}</p>
                          {b.review_note && <p className="truncate text-[11px] text-neutral-500">“{b.review_note}”</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-medium text-neutral-900">{b.created_by_name ?? '—'}</p>
                      <p className="text-[11px] text-neutral-500">{formatDateTime(b.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-900">{b.total_rows}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
                      <span className="text-emerald-700">{b.valid_rows}</span>
                      <span className="text-neutral-400"> / </span><span className="text-amber-700">{b.warning_rows}</span>
                      <span className="text-neutral-400"> / </span><span className={b.error_rows ? 'font-semibold text-red-600' : 'text-neutral-500'}>{b.error_rows}</span>
                    </td>
                    {meta.amounts.map(a => (
                      <td key={a.label} className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-neutral-900">{formatAmount(b[a.field])}</td>
                    ))}
                    <td className="px-4 py-3"><BatchStatusBadge batch={b} /></td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {b.reviewed_at ? (
                        <>
                          <p className="font-medium text-neutral-900">{b.reviewed_by_name ?? '—'}</p>
                          <p className="text-[11px] text-neutral-500">{formatDateTime(b.reviewed_at)}</p>
                        </>
                      ) : b.submitted_at ? (
                        <p className="text-neutral-500">Submitted {formatDateTime(b.submitted_at)}</p>
                      ) : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight size={15} className="inline text-neutral-300 transition-colors group-hover:text-neutral-800" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {batch && batch.length > 0 && (
            <div className="flex items-center justify-between border-t border-neutral-300 bg-neutral-50 px-5 py-2.5 text-xs text-neutral-500">
              <span>Showing <span className="font-semibold text-neutral-900">{tampil.length}</span> of {batch.length} batches</span>
              {filterAktif && (
                <button onClick={() => setFilter('all')} className="font-semibold text-neutral-900 hover:underline">
                  Clear filter
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}