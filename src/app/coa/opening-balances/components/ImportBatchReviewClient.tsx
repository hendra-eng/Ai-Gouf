'use client';

// Review & approval 1 batch import (/coa/opening-balances/[id]/imports/[module]/[batchId]):
// ringkasan validasi, jejak approval (upload -> submit -> approve/reject),
// tabel baris + pesan validasi, dan aksi Submit / Approve / Reject / Cancel.
// Approve/Reject = Tahap 4+, dan bukan orang yang submit (dicek backend).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, ChevronRight, CircleDot, Inbox, ListTree, Loader2, Search, Send,
  ShieldCheck, Upload, X, XCircle,
} from 'lucide-react';
import { formatAmount } from '@/lib/openingBalanceStore';
import {
  approveImportBatch,
  cancelImportBatch,
  fetchImportBatch,
  rejectImportBatch,
  submitImportBatch,
  type ImportBatchDetail,
  type ImportRow,
  type ImportRowStatus,
} from '@/lib/openingBalanceImportStore';
import { BatchStatusBadge, formatDateTime, metaModul } from './importUi';
import { branchLabel } from './obUi';

type Aksi = 'submit' | 'approve' | 'reject' | 'cancel' | null;
type Filter = 'all' | ImportRowStatus;

const ROW_BADGE: Record<ImportRowStatus, string> = {
  valid: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  error: 'bg-red-50 text-red-700',
};

const teks = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));

export default function ImportBatchReviewClient() {
  const params = useParams<{ id: string; module: string; batchId: string }>();
  const id = params?.id ?? '';
  const batchId = params?.batchId ?? '';
  const meta = metaModul(params?.module ?? '');

  const [b, setB] = useState<ImportBatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aksi, setAksi] = useState<Aksi>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [tolak, setTolak] = useState<{ open: boolean; alasan: string }>({ open: false, alasan: '' });

  const muat = useCallback(() => {
    if (!batchId) return;
    fetchImportBatch(batchId)
      .then(d => { setB(d); setError(null); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load the import batch.'));
  }, [batchId]);

  useEffect(() => { muat(); }, [muat]);

  const isCoa = b?.module === 'coa';
  const isAset = b?.module === 'asset';

  const tampil = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (b?.rows ?? []).filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!q) return true;
      return Object.values(r.data).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
        || r.messages.some(m => m.message.toLowerCase().includes(q));
    });
  }, [b, filter, search]);

  async function jalankan(jenis: Exclude<Aksi, null>, fn: () => Promise<unknown>, sukses: string) {
    if (aksi) return;
    setAksi(jenis);
    try {
      await fn();
      toast.success(sukses);
      muat();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setAksi(null);
    }
  }

  const onSubmit = () => {
    if (!b) return;
    const pesan = b.warning_rows
      ? `Submit this batch for approval? ${b.warning_rows} row(s) still have warnings.`
      : 'Submit this batch for approval?';
    if (!window.confirm(pesan)) return;
    jalankan('submit', () => submitImportBatch(b.id), 'Batch submitted for approval');
  };
  const onApprove = () => {
    if (!b) return;
    const pesan = b.module === 'coa'
      ? `Approve "${b.file_name}"? Opening balance lines of non-control accounts will be REPLACED with this batch, and ZAFEB account names will be updated from Source Account Name.`
      : `Approve "${b.file_name}"? ${PESAN_APPROVE[b.module]?.(b.total_rows) ?? ''}`;
    if (!window.confirm(pesan)) return;
    jalankan('approve', () => approveImportBatch(b.id), 'Batch approved');
  };
  const onReject = () => {
    if (!b) return;
    const alasan = tolak.alasan.trim();
    if (alasan.length < 3) { toast.error('Write a reason for the rejection.'); return; }
    jalankan('reject', async () => { await rejectImportBatch(b.id, alasan); setTolak({ open: false, alasan: '' }); }, 'Batch rejected');
  };
  const onCancel = () => {
    if (!b || !window.confirm('Cancel this batch? It will no longer be used.')) return;
    jalankan('cancel', () => cancelImportBatch(b.id), 'Batch cancelled');
  };

  const kembali = `/coa/opening-balances/${id}/imports/${params?.module ?? ''}`;

  if (error || !meta) {
    return (
      <div className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><Inbox size={18} /></div>
          <h2 className="text-sm font-semibold text-foreground">Import batch not found</h2>
          <p className="mt-1 text-xs text-muted-foreground">{error ?? 'Unknown import module.'}</p>
          <Link href={`/coa/opening-balances/${id}`} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50">
            <ArrowLeft size={14} /> Back to opening balance
          </Link>
        </div>
      </div>
    );
  }

  if (!b) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading import batch…
      </div>
    );
  }

  const selisih = Math.round((b.total_debit - b.total_credit) * 100) / 100;
  const tombolSekunder = 'flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50';

  // Jejak approval (maker-checker).
  const langkah = [
    { label: 'Uploaded', by: b.created_by_name, at: b.created_at, done: true, icon: Upload, cls: 'text-sky-600 bg-sky-50' },
    { label: 'Submitted', by: b.submitted_by_name, at: b.submitted_at, done: !!b.submitted_at, icon: Send, cls: 'text-amber-600 bg-amber-50' },
    b.status === 'rejected'
      ? { label: 'Rejected', by: b.reviewed_by_name, at: b.reviewed_at, done: true, icon: XCircle, cls: 'text-red-600 bg-red-50' }
      : b.status === 'cancelled'
        ? { label: 'Cancelled', by: null, at: b.cancelled_at, done: true, icon: Ban, cls: 'text-slate-500 bg-slate-100' }
        : { label: 'Approved', by: b.reviewed_by_name, at: b.reviewed_at, done: b.status === 'approved', icon: ShieldCheck, cls: 'text-emerald-600 bg-emerald-50' },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-screen-2xl px-6 py-5">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href="/coa/opening-balances" className="hover:text-foreground">Opening balances</Link>
            <ChevronRight size={12} />
            <Link href={`/coa/opening-balances/${id}`} className="hover:text-foreground">
              {b.opening_balance ? `FY ${b.opening_balance.fiscal_year} · ${branchLabel(b.opening_balance.branch)}` : 'Opening balance'}
            </Link>
            <ChevronRight size={12} />
            <Link href={kembali} className="hover:text-foreground">Import monitoring</Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">Review</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Link href={kembali} title="Back" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground">
                <ArrowLeft size={16} />
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{b.file_name}</h1>
                  <BatchStatusBadge batch={b} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{meta.no}. {meta.title}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(b.status === 'validated' || b.status === 'rejected') && (
                <button onClick={onCancel} disabled={!!aksi} className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                  {aksi === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Cancel batch
                </button>
              )}
              {b.status === 'validated' && (
                <button
                  onClick={onSubmit}
                  disabled={!!aksi || b.blocking_issues.length > 0}
                  title={b.blocking_issues.length > 0 ? b.blocking_issues.join(' ') : undefined}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:opacity-50"
                >
                  {aksi === 'submit' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit for approval
                </button>
              )}
              {b.status === 'submitted' && (
                <>
                  <button onClick={() => setTolak({ open: true, alasan: '' })} disabled={!!aksi} className={tombolSekunder}>
                    <XCircle size={14} className="text-red-600" /> Reject
                  </button>
                  <button onClick={onApprove} disabled={!!aksi} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:opacity-50">
                    {aksi === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Approve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
        {b.blocking_issues.length > 0 && b.status === 'validated' && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <div className="text-xs leading-relaxed text-red-900">
              <p className="font-semibold">This batch cannot be submitted:</p>
              <ul className="mt-1 list-disc pl-4">
                {b.blocking_issues.map(i => <li key={i}>{i}</li>)}
              </ul>
              <p className="mt-1">Fix the file and import it again from the Import Data tab. Warnings do not block submission — just review them.</p>
            </div>
          </div>
        )}
        {b.status === 'rejected' && b.review_note && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <p className="text-xs leading-relaxed text-red-900">
              Rejected by <span className="font-semibold">{b.reviewed_by_name ?? '—'}</span>: “{b.review_note}”. Fix the file and import it again.
            </p>
          </div>
        )}
        {b.notes && (
          <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <CircleDot size={16} className="mt-0.5 shrink-0 text-sky-600" />
            <p className="text-xs leading-relaxed text-slate-700">{b.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
          {/* Ringkasan validasi */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {([
              ['Total rows', b.total_rows, 'text-foreground'],
              ['Valid', b.valid_rows, 'text-emerald-600'],
              ['Warnings', b.warning_rows, 'text-amber-600'],
              ['Errors', b.error_rows, 'text-red-600'],
            ] as const).map(([label, val, cls]) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${cls}`}>{val}</p>
              </div>
            ))}
            {isCoa && (
              <div className="col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm md:col-span-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total debit</p>
                  <p className="font-mono text-base font-bold tabular-nums text-foreground">{formatAmount(b.total_debit)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total credit</p>
                  <p className="font-mono text-base font-bold tabular-nums text-foreground">{formatAmount(b.total_credit)}</p>
                </div>
                <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ${selisih === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {selisih === 0 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <p className="text-xs font-semibold">
                    {selisih === 0 ? 'Balanced' : <>Difference <span className="font-mono tabular-nums">{formatAmount(Math.abs(selisih))}</span></>}
                  </p>
                </div>
              </div>
            )}
            {!isCoa && (
              <div className="col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm md:col-span-4">
                {(isAset
                  ? [['Original cost', b.total_debit], ['Accumulated depreciation', b.total_credit], ['Net book value', b.total_debit - b.total_credit]] as const
                  : meta.amounts.map(a => [a.label, b[a.field]] as const)
                ).map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className="font-mono text-base font-bold tabular-nums text-foreground">{formatAmount(val)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Jejak approval */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Approval trail</p>
            <ol className="space-y-4">
              {langkah.map((l, i) => {
                const LIcon = l.icon;
                return (
                  <li key={i} className="flex gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${l.done ? l.cls : 'bg-slate-100 text-slate-300'}`}><LIcon size={15} /></div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${l.done ? 'text-foreground' : 'text-slate-400'}`}>{l.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.done ? <>{l.by ?? '—'} · {formatDateTime(l.at)}</> : 'Waiting'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {b.status === 'approved' && b.review_note && <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">“{b.review_note}”</p>}
          </div>
        </div>

        {/* Tabel baris */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search rows or messages…"
                className="w-full rounded-xl border border-border bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-foreground placeholder:text-slate-400 transition-shadow focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-foreground" aria-label="Clear search"><X size={14} /></button>
              )}
            </div>
            <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
              {([['all', `All (${b.total_rows})`], ['error', `Errors (${b.error_rows})`], ['warning', `Warnings (${b.warning_rows})`], ['valid', `Valid (${b.valid_rows})`]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${filter === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            {isCoa ? <TabelCoa rows={tampil} /> : isAset ? <TabelAset rows={tampil} />
              : b.module === 'inventory' ? <TabelInventory rows={tampil} /> : <TabelDokumen rows={tampil} ar={b.module === 'ar'} />}
          </div>
        </div>
      </div>

      {/* Modal alasan reject */}
      {tolak.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => !aksi && setTolak({ open: false, alasan: '' })}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">Reject import batch</h3>
            <p className="mt-1 text-xs text-muted-foreground">The uploader will see this reason and must import a corrected file.</p>
            <textarea
              autoFocus
              value={tolak.alasan}
              onChange={e => setTolak(t => ({ ...t, alasan: e.target.value }))}
              rows={4}
              placeholder="Reason for rejection"
              className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTolak({ open: false, alasan: '' })} disabled={!!aksi} className={tombolSekunder}>Close</button>
              <button onClick={onReject} disabled={!!aksi} className="flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50">
                {aksi === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pesan({ r }: { r: ImportRow }) {
  if (r.messages.length === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <ul className="space-y-0.5">
      {r.messages.map((m, i) => (
        <li key={i} className={`text-xs ${m.level === 'error' ? 'text-red-700' : 'text-amber-700'}`}>• {m.message}</li>
      ))}
    </ul>
  );
}

function StatusBaris({ s }: { s: ImportRowStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${ROW_BADGE[s]}`}>{s}</span>;
}

const KOSONG = (n: number, ada: boolean) => (
  <tr><td colSpan={n} className="py-14 text-center text-sm text-muted-foreground">{ada ? 'No rows match this filter.' : 'No rows.'}</td></tr>
);

function TabelCoa({ rows }: { rows: ImportRow[] }) {
  return (
    <table className="w-full min-w-[1100px] text-sm">
      <thead className="bg-slate-50">
        <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <th className="w-14 px-4 py-3">Row</th>
          <th className="px-4 py-3">Source account</th>
          <th className="px-4 py-3">ZAFEB account</th>
          <th className="px-4 py-3">Standard code</th>
          <th className="px-4 py-3 text-right">Debit</th>
          <th className="px-4 py-3 text-right">Credit</th>
          <th className="px-4 py-3">Status</th>
          <th className="w-80 px-4 py-3">Messages</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? KOSONG(8, true) : rows.map(r => {
          const d = r.data;
          const z = d.zafeb_account as { acc_no: string; account_name: string; account_classification: string; standard_account_code: string | null } | null;
          return (
            <tr key={r.id} className={`border-b border-slate-100 align-top ${r.status === 'error' ? 'bg-red-50' : ''}`}>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.row_no}</td>
              <td className="px-4 py-2.5">
                <p className="text-foreground"><span className="font-mono text-xs text-slate-500">{teks(d.source_code)}</span> {teks(d.source_name)}</p>
                {!!d.source_classification && <p className="text-[11px] text-muted-foreground">{teks(d.source_classification)}</p>}
              </td>
              <td className="px-4 py-2.5">
                {z ? (
                  <>
                    <p className="text-foreground"><span className="font-mono text-xs text-slate-500">{z.acc_no}</span> {z.account_name}</p>
                    <p className="text-[11px] text-muted-foreground">{z.account_classification}</p>
                    {!!d.rename && <p className="text-[11px] font-medium text-sky-700">Renamed to “{teks(d.source_name)}” on approval</p>}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Unmapped</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{z?.standard_account_code || teks(d.standard_code)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{r.debit ? formatAmount(r.debit) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{r.credit ? formatAmount(r.credit) : ''}</td>
              <td className="px-4 py-2.5"><StatusBaris s={r.status} /></td>
              <td className="px-4 py-2.5"><Pesan r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const PESAN_APPROVE: Partial<Record<string, (n: number) => string>> = {
  asset: n => `${n} asset(s) will be created in the Fixed Asset register, and the opening balances of the fixed asset and accumulated depreciation accounts will be recalculated from the register.`,
  ar: n => `${n} invoice(s) will be added to Accounts Receivable, and the opening balance of the AR control account(s) will be recalculated.`,
  ap: n => `${n} bill(s) will be added to Accounts Payable, and the opening balance of the AP control account(s) will be recalculated.`,
  inventory: n => `Opening stock for ${n} row(s) will be posted in Inventory (new items and warehouses are created), and the opening balance of the inventory account(s) will be recalculated.`,
};

const METODE: Record<string, string> = { straight_line: 'Straight line', declining_balance: 'Declining balance', none: 'Not depreciated' };
type AkunRingkas = { acc_no: string; account_name: string } | null;

function Akun({ label, a }: { label: string; a: unknown }) {
  const x = a as AkunRingkas;
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="text-slate-400">{label}</span> {x ? <span className="font-mono text-slate-600">{x.acc_no}</span> : '—'} {x?.account_name}
    </p>
  );
}

function TabelAset({ rows }: { rows: ImportRow[] }) {
  return (
    <table className="w-full min-w-[1200px] text-sm">
      <thead className="bg-slate-50">
        <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <th className="w-14 px-4 py-3">Row</th>
          <th className="px-4 py-3">Asset</th>
          <th className="px-4 py-3">Acquired</th>
          <th className="px-4 py-3">Depreciation</th>
          <th className="px-4 py-3 text-right">Cost</th>
          <th className="px-4 py-3 text-right">Accum. dep.</th>
          <th className="px-4 py-3 text-right">NBV</th>
          <th className="px-4 py-3">Accounts</th>
          <th className="px-4 py-3">Status</th>
          <th className="w-72 px-4 py-3">Messages</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? KOSONG(10, true) : rows.map(r => {
          const d = r.data;
          const bulan = typeof d.life_months === 'number' ? d.life_months : null;
          return (
            <tr key={r.id} className={`border-b border-slate-100 align-top ${r.status === 'error' ? 'bg-red-50' : ''}`}>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.row_no}</td>
              <td className="px-4 py-2.5">
                <p className="text-foreground"><span className="font-mono text-xs text-slate-500">{teks(d.asset_code)}</span> {teks(d.asset_name)}</p>
                <p className="text-[11px] text-muted-foreground">{teks(d.category)}{d.location ? ` · ${teks(d.location)}` : ''}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs">{teks(d.acquisition_date)}</td>
              <td className="px-4 py-2.5 text-xs">
                <p className="text-foreground">{METODE[teks(d.method)] ?? teks(d.method)}</p>
                {bulan ? <p className="text-[11px] text-muted-foreground">{bulan} months · from {teks(d.dep_start)}</p> : null}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{r.debit ? formatAmount(r.debit) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{r.credit ? formatAmount(r.credit) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatAmount(r.debit - r.credit)}</td>
              <td className="px-4 py-2.5">
                <Akun label="Asset" a={d.asset_account} />
                <Akun label="Accum." a={d.accum_account} />
                <Akun label="Expense" a={d.expense_account} />
              </td>
              <td className="px-4 py-2.5"><StatusBaris s={r.status} /></td>
              <td className="px-4 py-2.5"><Pesan r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelDokumen({ rows, ar }: { rows: ImportRow[]; ar: boolean }) {
  return (
    <table className="w-full min-w-[1100px] text-sm">
      <thead className="bg-slate-50">
        <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <th className="w-14 px-4 py-3">Row</th>
          <th className="px-4 py-3">{ar ? 'Customer' : 'Vendor'}</th>
          <th className="px-4 py-3">{ar ? 'Invoice' : 'Bill'}</th>
          <th className="px-4 py-3 text-right">Original</th>
          <th className="px-4 py-3 text-right">Outstanding</th>
          <th className="px-4 py-3">Control account</th>
          <th className="px-4 py-3">Status</th>
          <th className="w-80 px-4 py-3">Messages</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? KOSONG(8, true) : rows.map(r => {
          const d = r.data;
          return (
            <tr key={r.id} className={`border-b border-slate-100 align-top ${r.status === 'error' ? 'bg-red-50' : ''}`}>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.row_no}</td>
              <td className="px-4 py-2.5">
                <p className="text-foreground">{d.party_code ? <span className="font-mono text-xs text-slate-500">{teks(d.party_code)} </span> : null}{teks(d.party_name)}</p>
                {!!d.tax_id && <p className="text-[11px] text-muted-foreground">Tax ID {teks(d.tax_id)}</p>}
                {d.party_exists === false && ar && <p className="text-[11px] font-medium text-sky-700">New customer</p>}
              </td>
              <td className="px-4 py-2.5">
                <p className="font-mono text-xs text-foreground">{teks(d.doc_no)}</p>
                <p className="text-[11px] text-muted-foreground">{teks(d.doc_date)}{d.due_date ? ` · due ${teks(d.due_date)}` : ''}</p>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{typeof d.original === 'number' ? formatAmount(d.original) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatAmount(r.debit || r.credit)}</td>
              <td className="px-4 py-2.5"><Akun label="" a={d.account} /></td>
              <td className="px-4 py-2.5"><StatusBaris s={r.status} /></td>
              <td className="px-4 py-2.5"><Pesan r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelInventory({ rows }: { rows: ImportRow[] }) {
  return (
    <table className="w-full min-w-[1100px] text-sm">
      <thead className="bg-slate-50">
        <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <th className="w-14 px-4 py-3">Row</th>
          <th className="px-4 py-3">Item</th>
          <th className="px-4 py-3">Warehouse</th>
          <th className="px-4 py-3 text-right">Qty</th>
          <th className="px-4 py-3 text-right">Unit cost</th>
          <th className="px-4 py-3 text-right">Value</th>
          <th className="px-4 py-3">Inventory account</th>
          <th className="px-4 py-3">Status</th>
          <th className="w-80 px-4 py-3">Messages</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? KOSONG(9, true) : rows.map(r => {
          const d = r.data;
          return (
            <tr key={r.id} className={`border-b border-slate-100 align-top ${r.status === 'error' ? 'bg-red-50' : ''}`}>
              <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.row_no}</td>
              <td className="px-4 py-2.5">
                <p className="text-foreground"><span className="font-mono text-xs text-slate-500">{teks(d.item_code)}</span> {teks(d.item_name)}</p>
                <p className="text-[11px] text-muted-foreground">{teks(d.category)}{d.unit ? ` · ${teks(d.unit)}` : ''}{d.lot ? ` · Lot ${teks(d.lot)}` : ''}</p>
                {d.item_exists === false && <p className="text-[11px] font-medium text-sky-700">New item</p>}
              </td>
              <td className="px-4 py-2.5">
                <p className="text-foreground"><span className="font-mono text-xs text-slate-500">{teks(d.wh_code)}</span> {teks(d.wh_name)}</p>
                {d.wh_exists === false && <p className="text-[11px] font-medium text-sky-700">New warehouse</p>}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{typeof d.qty === 'number' ? d.qty.toLocaleString('en-US', { maximumFractionDigits: 4 }) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{typeof d.unit_cost === 'number' ? formatAmount(d.unit_cost) : ''}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatAmount(r.debit)}</td>
              <td className="px-4 py-2.5"><Akun label="" a={d.inventory_account} /></td>
              <td className="px-4 py-2.5"><StatusBaris s={r.status} /></td>
              <td className="px-4 py-2.5"><Pesan r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
