'use client';

// Management > Year-End Closing (layout mengikuti dataset/picture/Template UI/
// Year closing/1.jpeg): KPI semua klien, Daftar Tahun Buku (semua klien),
// Detail Tahun yang Sudah Ditutup (snapshot, jurnal penutup, audit trail),
// Dampak ke Modul Lain, dan drawer Pre-Closing Checklist di kanan.
// Backend: modules/management/year_end_closing_v1.py.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, BookOpen, Building2, CalendarDays, CheckCircle2, ChevronDown, ExternalLink, FileText, Filter,
  Hourglass, Info, Loader2, LockOpen, MoreHorizontal, Play, RefreshCcw, RotateCcw, Search, Settings2, X, XCircle,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  closeFiscalYear, fetchYecDetail, fetchYecPreview, formatAmount, formatDate, formatDateTime, reopenFiscalYear, useYecWorkspace,
  type CheckStatus, type WorkspaceYear, type YecDetail, type YecPreview,
} from '@/lib/yearEndClosingStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

const glLink = (date: string) => `/reports/general-ledger?start=${date}&end=${date}`;
const kunci = (y: { client_id: string; fiscal_year: number }) => `${y.client_id}:${y.fiscal_year}`;
const PER_HALAMAN = 10;

function rupiah(n: number | null | undefined): string {
  const v = n || 0;
  return `${v < 0 ? '-' : ''}Rp ${formatAmount(Math.abs(v))}`;
}

type StatusFilter = 'all' | 'open' | 'closed' | 'reopened';
type Drawer = { year: WorkspaceYear; mode: 'close' | 'view' };

export default function YearEndClosingClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId, setActiveClient } = useActiveClient();
  const { data, loading, error, refresh } = useYecWorkspace();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [reopening, setReopening] = useState<WorkspaceYear | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailTick, setDetailTick] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => data?.years ?? [], [data]);
  const filtered = useMemo(() => {
    const kata = q.trim().toLowerCase();
    return years.filter(y =>
      (statusFilter === 'all' || y.status === statusFilter)
      && (!activeOnly || y.client_id === activeClientId)
      && (!kata || y.client_name.toLowerCase().includes(kata) || (y.client_code ?? '').toLowerCase().includes(kata)
        || `fy ${y.fiscal_year}`.includes(kata)),
    );
  }, [years, q, statusFilter, activeOnly, activeClientId]);
  useEffect(() => setPage(0), [q, statusFilter, activeOnly]);
  const halaman = filtered.slice(page * PER_HALAMAN, (page + 1) * PER_HALAMAN);
  const jumlahHalaman = Math.max(1, Math.ceil(filtered.length / PER_HALAMAN));

  // Tahun yang (pernah) ditutup -> pilihan di "Detail Tahun yang Sudah Ditutup".
  const pernahDitutup = useMemo(() => years.filter(y => y.status !== 'open'), [years]);
  useEffect(() => {
    if (detailKey && pernahDitutup.some(y => kunci(y) === detailKey)) return;
    const pilih = pernahDitutup.find(y => y.client_id === activeClientId && y.status === 'closed')
      ?? pernahDitutup.find(y => y.status === 'closed') ?? pernahDitutup[0];
    setDetailKey(pilih ? kunci(pilih) : null);
  }, [pernahDitutup, activeClientId, detailKey]);

  const reload = () => { refresh(); setDetailTick(t => t + 1); };
  const lihat = (y: WorkspaceYear) => {
    setDetailKey(kunci(y));
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const keGl = (y: { client_id: string; client_name: string }) => {
    if (y.client_id !== activeClientId) setActiveClient(y.client_id, y.client_name);
  };

  const kpi = data?.kpi;
  return (
    <div className={`${salesFont.className} min-h-screen bg-background pb-16`}>
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Year-End Closing</h1>
            <p className="mt-1 text-sm font-medium text-neutral-500">Kelola proses penutupan tahun buku, snapshot saldo akhir, dan audit trail closing per klien.</p>
          </div>
          <button onClick={reload} disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {error && <div className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={CalendarDays} tone="sky" label="Open Fiscal Years" value={kpi?.open} hint="Tahun buku belum ditutup" />
          <KpiCard icon={CheckCircle2} tone="green" label="Closed Fiscal Years" value={kpi?.closed} hint="Tahun buku sudah ditutup" />
          <KpiCard icon={RotateCcw} tone="orange" label="Re-opened Cases" value={kpi?.reopened} hint="Pernah dibuka kembali" />
          <KpiCard icon={Hourglass} tone="amber" label="Pending Pre-Closing Checks" value={kpi?.pending_checks} hint="Menunggu pengecekan" />
        </div>

        {/* ---------------- Daftar Tahun Buku ---------------- */}
        <section className="card-elevated-md rounded-xl">
          <div className="flex flex-col gap-3 px-5 pb-3 pt-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">Daftar Tahun Buku</h2>
              <p className="mt-0.5 text-xs text-neutral-500">Daftar tahun buku per klien beserta status penutupan.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-sm focus-within:border-neutral-700 focus-within:ring-2 focus-within:ring-neutral-300 sm:w-72">
                <Search size={14} className="text-neutral-500" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari klien atau tahun buku..."
                  className="w-full bg-transparent text-sm placeholder:text-neutral-500 focus:outline-none" />
              </label>
              <FilterMenu status={statusFilter} onStatus={setStatusFilter} activeOnly={activeOnly} onActiveOnly={setActiveOnly} hasActive={!!activeClientId} />
            </div>
          </div>

          <div className="overflow-x-auto px-5 pb-2">
            <table className="w-full min-w-[980px] select-text border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-neutral-300 text-left">
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Klien</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Fiscal Year</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Start Date</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">End Date</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Status</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Closed By</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Closed At</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Re-opened By</th>
                  <th className="whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2.5 text-xs font-bold text-black">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  [0, 1, 2, 3].map(i => <tr key={i}><td colSpan={9} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-neutral-100" /></td></tr>)
                ) : halaman.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-xs text-neutral-500">Tidak ada tahun buku yang cocok.</td></tr>
                ) : halaman.map(y => (
                  <YearRow key={kunci(y)} y={y} selected={kunci(y) === detailKey}
                    onClose={() => setDrawer({ year: y, mode: 'close' })}
                    onView={() => lihat(y)}
                    onChecklist={() => setDrawer({ year: y, mode: y.status === 'closed' ? 'view' : 'close' })}
                    onReopen={() => setReopening(y)}
                    onGl={() => keGl(y)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > PER_HALAMAN && (
            <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-5 py-3 text-xs font-medium text-neutral-500">
              <span>{page * PER_HALAMAN + 1}–{Math.min(filtered.length, (page + 1) * PER_HALAMAN)} dari {filtered.length}</span>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-neutral-700 shadow-sm hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Prev</button>
                <button disabled={page >= jumlahHalaman - 1} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-neutral-700 shadow-sm hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Detail Tahun yang Sudah Ditutup ---------------- */}
        <div ref={detailRef} className="scroll-mt-4">
          <ClosedDetail options={pernahDitutup} selectedKey={detailKey} onSelect={setDetailKey} tick={detailTick} onGl={keGl} />
        </div>

        <ImpactPanel />
      </div>

      {drawer && (
        <ChecklistDrawer
          key={kunci(drawer.year) + drawer.mode}
          year={drawer.year}
          mode={drawer.mode}
          onCancel={() => setDrawer(null)}
          onDone={() => { setDetailKey(kunci(drawer.year)); setDrawer(null); reload(); }}
        />
      )}
      {reopening && (
        <ReopenDialog year={reopening} onCancel={() => setReopening(null)} onDone={() => { setReopening(null); reload(); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------

function KpiCard({ icon: Icon, label, value, hint }: { icon: React.ElementType; tone?: string; label: string; value?: number; hint: string }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><Icon size={16} /></span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">{value ?? '–'}</p>
      <p className="text-[11px] font-medium text-neutral-500">{hint}</p>
    </div>
  );
}

function FilterMenu({ status, onStatus, activeOnly, onActiveOnly, hasActive }: {
  status: StatusFilter; onStatus: (s: StatusFilter) => void; activeOnly: boolean; onActiveOnly: (v: boolean) => void; hasActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const aktif = (status !== 'all' ? 1 : 0) + (activeOnly ? 1 : 0);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
        <Filter size={14} /> Filter{aktif ? <span className="rounded-full bg-neutral-800 px-1.5 text-[10px] font-semibold text-white">{aktif}</span> : null}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-60 rounded-[10px] border border-neutral-300 bg-white p-3 shadow-xl">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Status</p>
            {(['all', 'open', 'closed', 'reopened'] as StatusFilter[]).map(s => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50">
                <input type="radio" checked={status === s} onChange={() => onStatus(s)} />
                {s === 'all' ? 'All statuses' : STATUS_BADGE[s].label}
              </label>
            ))}
            <div className="my-2 border-t border-neutral-200" />
            <label className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${hasActive ? 'cursor-pointer hover:bg-neutral-50' : 'opacity-50'}`}>
              <input type="checkbox" checked={activeOnly} disabled={!hasActive} onChange={e => onActiveOnly(e.target.checked)} />
              Active client only
            </label>
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<'open' | 'closed' | 'reopened', { label: string; cls: string; dot: string }> = {
  open: { label: 'Open', cls: 'bg-neutral-50 text-neutral-700 ring-1 ring-neutral-300', dot: 'bg-neutral-500' },
  closed: { label: 'Closed', cls: 'bg-neutral-50 text-neutral-700 ring-1 ring-neutral-300', dot: 'bg-emerald-500' },
  reopened: { label: 'Re-opened', cls: 'bg-neutral-50 text-neutral-700 ring-1 ring-neutral-300', dot: 'bg-amber-500' },
};

function StatusBadge({ status }: { status: 'open' | 'closed' | 'reopened' }) {
  const b = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${b.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} /> {b.label}
    </span>
  );
}

function YearRow({ y, selected, onClose, onView, onChecklist, onReopen, onGl }: {
  y: WorkspaceYear; selected: boolean; onClose: () => void; onView: () => void; onChecklist: () => void; onReopen: () => void; onGl: () => void;
}) {
  return (
    <tr className={`[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 ${selected ? '[&>td]:bg-neutral-100' : ''}`}>
      <td className="px-3 py-3 text-xs font-medium uppercase text-neutral-900">{y.client_name}</td>
      <td className="px-3 py-3 text-xs font-semibold text-neutral-900">FY {y.fiscal_year}</td>
      <td className="px-3 py-3 text-xs text-neutral-900">{formatDate(y.period_start)}</td>
      <td className="px-3 py-3 text-xs text-neutral-900">{formatDate(y.period_end)}</td>
      <td className="px-3 py-3"><StatusBadge status={y.status} /></td>
      <td className="px-3 py-3 text-xs text-neutral-900">{y.closed_by_name || '-'}</td>
      <td className="px-3 py-3 text-xs text-neutral-900">{y.closed_at ? formatDate(y.closed_at) : '-'}</td>
      <td className="px-3 py-3 text-xs text-neutral-900" title={y.reopen_reason ?? undefined}>{y.status === 'reopened' ? y.reopened_by_name || '-' : '-'}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          {y.status === 'open' ? (
            <button onClick={onClose} title={y.has_ended ? undefined : `FY ${y.fiscal_year} ends on ${formatDate(y.period_end)}`}
              className="w-[118px] rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700">
              Close FY {y.fiscal_year}
            </button>
          ) : (
            <>
              <button onClick={onView} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">View</button>
              <button onClick={onChecklist} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">Checklist</button>
            </>
          )}
          <RowMenu y={y} onClose={onClose} onReopen={onReopen} onGl={onGl} />
        </div>
      </td>
    </tr>
  );
}

function RowMenu({ y, onClose, onReopen, onGl }: { y: WorkspaceYear; onClose: () => void; onReopen: () => void; onGl: () => void }) {
  const [open, setOpen] = useState(false);
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-neutral-50';
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex h-7 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-500 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-56 rounded-[10px] border border-neutral-300 bg-white p-1.5 shadow-xl" onClick={() => setOpen(false)}>
            {y.status === 'reopened' && <button onClick={onClose} className={item}><Play size={13} /> Close FY {y.fiscal_year} again</button>}
            {y.status === 'closed' && (
              y.can_reopen
                ? <button onClick={onReopen} className={`${item} text-orange-700`}><LockOpen size={13} /> Re-open FY {y.fiscal_year}</button>
                : <p className="px-2.5 py-1.5 text-[11px] text-neutral-500">Re-open later years first</p>
            )}
            {y.journal_number && (
              <Link href={glLink(y.period_end)} onClick={onGl} className={item}><BookOpen size={13} /> {y.journal_number} in General Ledger</Link>
            )}
            <Link href="/financial-statements/balance-sheet" onClick={onGl} className={item}><FileText size={13} /> Financial Statements</Link>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------

function ClosedDetail({ options, selectedKey, onSelect, tick, onGl }: {
  options: WorkspaceYear[]; selectedKey: string | null; onSelect: (k: string) => void; tick: number; onGl: (y: { client_id: string; client_name: string }) => void;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [detail, setDetail] = useState<YecDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pilihan = options.find(o => kunci(o) === selectedKey);
  const clientId = pilihan?.client_id;
  const fy = pilihan?.fiscal_year;

  useEffect(() => {
    if (!clientId || !fy) { setDetail(null); return; }
    let batal = false;
    setLoading(true);
    fetchYecDetail(clientId, fy)
      .then(d => { if (!batal) { setDetail(d); setErr(null); } })
      .catch(e => { if (!batal) setErr(e instanceof Error ? e.message : 'Failed to load the closing detail.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [clientId, fy, tick]);

  const d = detail;
  const bs = d?.snapshot.balance_sheet;
  return (
    <section className="card-elevated-md rounded-xl">
      <div className="flex flex-col gap-3 px-5 pb-3 pt-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Detail Tahun yang Sudah Ditutup</h2>
          <p className="mt-0.5 text-xs text-neutral-500">Informasi detail dan snapshot keuangan untuk tahun buku yang telah ditutup.</p>
        </div>
        {options.length > 0 && (
          <label className="relative flex w-full items-center rounded-lg border border-neutral-300 bg-white shadow-sm sm:w-80">
            <select value={selectedKey ?? ''} onChange={e => onSelect(e.target.value)}
              className="w-full appearance-none bg-transparent py-2 pl-3 pr-9 text-sm font-medium text-neutral-900 focus:outline-none">
              {options.map(o => (
                <option key={kunci(o)} value={kunci(o)}>FY {o.fiscal_year} – {o.client_name.toUpperCase()}{o.status === 'reopened' ? ' (re-opened)' : ''}</option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 text-neutral-500" />
          </label>
        )}
      </div>

      <div className="px-5 pb-5">
        {options.length === 0 ? (
          <div className="flex flex-col items-center rounded-[10px] border border-dashed border-neutral-300 px-6 py-12 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"><CalendarDays size={20} /></span>
            <p className="text-sm font-semibold text-neutral-900">Belum ada tahun buku yang ditutup</p>
            <p className="mt-1 max-w-md text-xs text-neutral-500">Klik &quot;Close FY&quot; pada tahun buku yang sudah berakhir untuk menjalankan checklist dan menutupnya.</p>
          </div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        ) : !d ? (
          <div className="h-48 animate-pulse rounded-[10px] bg-neutral-100" />
        ) : (
          <div className={`rounded-[10px] border border-neutral-300 p-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><CalendarDays size={18} /></span>
              <div>
                <p className="flex items-center gap-2 text-base font-semibold text-neutral-900">FY {d.fiscal_year} <StatusBadge status={d.status} /></p>
                <p className="text-xs uppercase text-neutral-500">{d.client_name}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:divide-x lg:divide-border">
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700"><span className="h-3.5 w-1 rounded-full bg-neutral-800" />Closing Snapshot</h3>
                <dl className="space-y-2 text-xs">
                  <SnapRow label="Total Assets" value={bs?.assets} />
                  <SnapRow label="Total Liabilities" value={bs?.liabilities} />
                  <SnapRow label="Total Equity" value={bs?.equity} />
                  <SnapRow label="Net Profit Closed to Retained Earnings" value={d.net_profit} />
                </dl>
                {d.snapshot.summary && (
                  <p className="mt-3 text-[11px] text-neutral-500">
                    Revenue {rupiah(d.snapshot.summary.revenue)} · Expenses {rupiah(d.snapshot.summary.expenses)}
                  </p>
                )}
              </div>

              <div className="lg:pl-6">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700"><span className="h-3.5 w-1 rounded-full bg-neutral-800" />Closing Journal</h3>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-neutral-500">Journal No.</dt>
                  <dd>
                    {d.journal ? (
                      <Link href={glLink(d.period_end)} onClick={() => onGl(d)}
                        className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] font-medium text-neutral-800 ring-1 ring-neutral-200 hover:underline">
                        {d.journal.je_number} <ExternalLink size={11} />
                      </Link>
                    ) : <span className="text-neutral-500">No P&amp;L activity — none needed</span>}
                    {d.reversal_journal && <span className="ml-1.5 font-mono text-[11px] text-orange-700">→ {d.reversal_journal.je_number}</span>}
                  </dd>
                  <dt className="text-neutral-500">Link to General Ledger</dt>
                  <dd>
                    <Link href={glLink(d.period_end)} onClick={() => onGl(d)}
                      className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-800 ring-1 ring-neutral-200 hover:underline">
                      <FileText size={11} /> Lihat di General Ledger
                    </Link>
                  </dd>
                  <dt className="text-neutral-500">Retained Earnings</dt>
                  <dd className="text-neutral-900">{d.retained_earnings_account ? `${kodeAkun(d.retained_earnings_account.acc_no)} · ${d.retained_earnings_account.account_name}` : '—'}</dd>
                  <dt className="text-neutral-500">Closed By</dt>
                  <dd className="text-neutral-900">{d.closed_by_name || '—'}</dd>
                  <dt className="text-neutral-500">Closed At</dt>
                  <dd className="text-neutral-900">{formatDateTime(d.closed_at)}</dd>
                  <dt className="text-neutral-500">Catatan</dt>
                  <dd className="text-neutral-900">{d.notes || '—'}</dd>
                  {d.status === 'reopened' && (
                    <>
                      <dt className="text-orange-700">Re-open reason</dt>
                      <dd className="text-orange-800">{d.reopen_reason || '—'}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="lg:pl-6">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700"><span className="h-3.5 w-1 rounded-full bg-neutral-800" />Audit Trail</h3>
                <ol className="space-y-3">
                  {d.audit_trail.map((s, i) => {
                    const buka = s.step === 'reopen' || s.step === 'reversed';
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-xs">
                        <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white ${buka ? 'bg-amber-500' : 'bg-neutral-800'}`}>
                          {buka ? <RotateCcw size={10} /> : <CheckCircle2 size={12} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-neutral-900">{s.title}</p>
                          {s.detail && <p className="truncate text-[11px] text-neutral-500" title={s.detail}>{s.detail}</p>}
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-neutral-500">
                          <p>{formatDateTime(s.at)}</p>
                          <p>oleh {s.by || '—'}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>

            {d.in_sync === false && (
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-amber-700">
                <AlertTriangle size={12} /> Angka laba sekarang berbeda dari snapshot (mapping COA berubah setelah closing). Re-open lalu close ulang untuk memperbarui jurnal penutup.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SnapRow({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${(value ?? 0) < 0 ? 'text-red-600' : 'text-neutral-900'}`}>{value === null || value === undefined ? '—' : rupiah(value)}</dd>
    </div>
  );
}

function ImpactPanel() {
  const items = [
    { icon: Building2, t: 'Transactions', d: 'Posting atau edit jurnal bertanggal di FY yang sudah ditutup akan ditolak dengan pesan "falls in a closed period" (Sales, Purchase, Journal Entry, Cash & Bank).', href: '/transactions/journal-entry' },
    { icon: FileText, t: 'Financial Statements', d: 'Label kecil "FY 2025 closed" muncul di Balance Sheet, Profit & Loss, Cash Flow dan Changes in Equity.', href: '/financial-statements/balance-sheet' },
    { icon: Settings2, t: 'Settings > Account Mapping', d: 'Akun Retained Earnings dipakai sebagai default tujuan laba tahun berjalan saat closing.', href: '/settings' },
  ];
  return (
    <section className="rounded-[10px] border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900"><Info size={16} /> Dampak ke Modul Lain</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map(({ icon: Icon, t, d, href }) => (
          <Link key={t} href={href} className="group flex items-start gap-3">
            <Icon size={20} className="mt-0.5 shrink-0 text-neutral-700" />
            <div>
              <p className="text-xs font-semibold text-neutral-900 group-hover:underline">{t}</p>
              <p className="text-[11px] leading-relaxed text-neutral-600">{d}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------

const CHECK_ICON: Record<CheckStatus, { icon: React.ElementType; cls: string }> = {
  pass: { icon: CheckCircle2, cls: 'bg-neutral-800 text-white' },
  warn: { icon: AlertTriangle, cls: 'bg-amber-100 text-amber-600' },
  fail: { icon: XCircle, cls: 'bg-red-100 text-red-600' },
};

const LABEL_CEK: Record<string, string> = {
  not_closed: 'Fiscal year is still open', year_ended: 'Fiscal year has ended', later_year: 'No later fiscal year is closed',
  balanced_journals: 'All posted journals are balanced', balance_sheet: 'Balance Sheet balances at year end',
  retained_earnings_account: 'Retained earnings account selected', pending_documents: 'No unposted documents in the year',
  mapping: 'All accounts are mapped', prior_years: 'Earlier fiscal years are closed', activity: 'Profit & loss activity',
};

function CheckCard({ c }: { c: { id: string; label?: string; status: CheckStatus; detail: string } }) {
  const ic = CHECK_ICON[c.status];
  const I = ic.icon;
  return (
    <li className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 ${c.status === 'fail' ? 'border-red-200 bg-red-50/40' : c.status === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-neutral-300 bg-white'}`}>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ic.cls}`}><I size={c.status === 'pass' ? 17 : 15} /></span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900">{c.label || LABEL_CEK[c.id] || c.id}</p>
        <p className="text-xs text-neutral-500">{c.detail}</p>
        {c.id === 'mapping' && c.status === 'warn' && (
          <Link href="/financial-statements/mapping" className="text-[11px] font-medium text-neutral-900 underline-offset-2 hover:underline">Open Statement Mapping →</Link>
        )}
        {c.id === 'pending_documents' && c.status === 'warn' && (
          <Link href="/transactions/journal-entry" className="text-[11px] font-medium text-neutral-900 underline-offset-2 hover:underline">Review transactions →</Link>
        )}
      </div>
    </li>
  );
}

function ChecklistDrawer({ year, mode, onCancel, onDone }: { year: WorkspaceYear; mode: 'close' | 'view'; onCancel: () => void; onDone: () => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<YecPreview | null>(null);
  const [snapshot, setSnapshot] = useState<YecDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let batal = false;
    setLoading(true);
    const req = mode === 'view'
      ? fetchYecDetail(year.client_id, year.fiscal_year).then(d => { if (!batal) setSnapshot(d); })
      : fetchYecPreview(year.client_id, year.fiscal_year, accountId || null).then(p => {
        if (batal) return;
        setPreview(p);
        if (!accountId && p.retained_earnings_account) setAccountId(p.retained_earnings_account.id);
      });
    req.then(() => { if (!batal) setErr(null); })
      .catch(e => { if (!batal) setErr(e instanceof Error ? e.message : 'Failed to run the pre-closing checks.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [year.client_id, year.fiscal_year, mode, accountId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel, saving]);

  const submit = async () => {
    setSaving(true);
    try {
      const { message } = await closeFiscalYear({
        client_id: year.client_id, fiscal_year: year.fiscal_year, retained_earnings_coa_id: accountId || null, notes: notes.trim() || null,
      });
      toast.success(`FY ${year.fiscal_year} closed`, { description: message });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Closing failed.');
    } finally {
      setSaving(false);
    }
  };

  const p = preview;
  const checks = mode === 'view' ? snapshot?.snapshot.checks ?? [] : p?.checks ?? [];
  const profit = mode === 'view' ? snapshot?.net_profit ?? 0 : p?.summary.net_profit ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-neutral-900/30 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <aside className="flex h-full w-full max-w-[400px] flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h3 className="text-lg font-semibold text-neutral-900">Pre-Closing Checklist – FY {year.fiscal_year}</h3>
            <p className="mt-1 text-xs text-neutral-500">
              {mode === 'view'
                ? `Hasil checklist saat FY ${year.fiscal_year} ditutup${snapshot?.snapshot.checked_at ? ` (${formatDateTime(snapshot.snapshot.checked_at)})` : ''}.`
                : 'Pastikan semua persyaratan terpenuhi sebelum melakukan penutupan tahun buku.'}
            </p>
          </div>
          <button onClick={onCancel} disabled={saving} className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <div className="rounded-[10px] border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs">
            <p className="text-neutral-500">Klien</p>
            <p className="mb-2 text-sm font-semibold uppercase text-neutral-900">{year.client_name}</p>
            <p className="text-neutral-500">Periode</p>
            <p className="text-sm text-neutral-900">{formatDate(year.period_start)} – {formatDate(year.period_end)}</p>
          </div>

          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

          <div>
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700"><span className="h-3.5 w-1 rounded-full bg-neutral-800" />Checklist</h4>
            {loading && checks.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" /> Running pre-closing checks…</div>
            ) : (
              <ul className={`space-y-2.5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
                {checks.map(c => <CheckCard key={c.id} c={c} />)}
              </ul>
            )}
          </div>

          {mode === 'close' && p && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-900">Retained earnings account</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300">
                <option value="">— Choose an equity account —</option>
                {p.retained_earnings_options.map(a => <option key={a.id} value={a.id}>{kodeAkun(a.acc_no)} · {a.account_name}</option>)}
              </select>
            </div>
          )}

          {(p || snapshot) && (
            <div className="flex items-center gap-3 rounded-[10px] border border-neutral-300 bg-neutral-50 px-4 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 ring-1 ring-neutral-200"><Building2 size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-neutral-900">{mode === 'view' ? 'Profit Closed to Retained Earnings' : 'Estimated Profit to Retained Earnings'}</p>
                <p className={`text-xl font-semibold tabular-nums tracking-tight ${profit < 0 ? 'text-red-600' : 'text-neutral-900'}`}>{rupiah(profit)}</p>
              </div>
              <span title="Pendapatan dikurangi beban tahun ini; dipindahkan ke akun Retained Earnings lewat jurnal penutup."><Info size={15} className="text-neutral-500" /></span>
            </div>
          )}

          {mode === 'close' && p && (
            <>
              <div className="rounded-[10px] border border-neutral-300">
                <button onClick={() => setShowJournal(s => !s)} className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-neutral-900">
                  <span>Closing journal preview <span className="ml-1 font-mono font-normal text-neutral-500">{p.journal_preview.je_number}</span></span>
                  <ChevronDown size={14} className={`transition-transform ${showJournal ? 'rotate-180' : ''}`} />
                </button>
                {showJournal && (
                  p.journal_preview.lines.length === 0 ? (
                    <p className="border-t border-neutral-200 px-4 py-3 text-[11px] text-neutral-500">
                      {accountId ? 'Tidak ada saldo laba rugi — periode hanya dikunci.' : 'Pilih akun Retained Earnings untuk melihat jurnal.'}
                    </p>
                  ) : (
                    <table className="w-full border-t border-neutral-200 text-[11px]">
                      <tbody className="divide-y divide-neutral-200">
                        {p.journal_preview.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5"><span className="font-mono text-neutral-500">{kodeAkun(l.account_code)}</span> {l.account_name}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{l.debit ? formatAmount(l.debit) : ''}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{l.credit ? formatAmount(l.credit) : ''}</td>
                          </tr>
                        ))}
                        <tr className="bg-neutral-50 font-semibold">
                          <td className="px-3 py-1.5">Total</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(p.journal_preview.total_debit)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatAmount(p.journal_preview.total_credit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )
                )}
              </div>

              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Catatan (opsional), mis. sesuai hasil review audit internal"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs shadow-sm focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />

              <label className="flex items-start gap-2.5 rounded-[10px] border border-orange-200 bg-orange-50 px-4 py-3 text-[11px] leading-relaxed text-orange-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-500" />
                <span className="flex-1">
                  Proses closing akan menghasilkan jurnal penutup akhir dan mengunci periode tahun buku. Setelah ditutup, transaksi tidak dapat diubah atau ditambahkan.
                  <span className="mt-1.5 flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={confirm} disabled={!p.can_close} onChange={e => setConfirm(e.target.checked)} /> Saya mengerti
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-neutral-200 px-5 py-4">
          <button onClick={onCancel} disabled={saving} className="flex-1 rounded-lg border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-700 shadow-sm hover:border-neutral-700 hover:bg-neutral-50">
            {mode === 'view' ? 'Close' : 'Cancel'}
          </button>
          {mode === 'close' && (
            <button onClick={submit} disabled={!p?.can_close || !confirm || saving || loading}
              title={p && !p.can_close ? 'Selesaikan checklist yang gagal terlebih dahulu.' : undefined}
              className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-neutral-700 disabled:opacity-40">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} />} Run Closing
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------

function ReopenDialog({ year, onCancel, onDone }: { year: WorkspaceYear; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const { message } = await reopenFiscalYear({ client_id: year.client_id, fiscal_year: year.fiscal_year, reason: reason.trim() });
      toast.success(`FY ${year.fiscal_year} re-opened`, { description: message });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Re-open failed.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-[10px] bg-white shadow-2xl">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700"><LockOpen size={18} /></span>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Re-open FY {year.fiscal_year}?</h3>
              <p className="mt-0.5 text-xs uppercase text-neutral-500">{year.client_name}</p>
              <p className="mt-2 text-sm text-neutral-500">
                Transaksi bertanggal di FY {year.fiscal_year} bisa diubah lagi
                {year.journal_number ? <> dan jurnal penutup <span className="font-mono">{year.journal_number}</span> dibalik dengan <span className="font-mono">RV-{year.journal_number}</span></> : null}.
                Tutup kembali setelah koreksi selesai di-posting.
              </p>
            </div>
          </div>
          <label className="mb-1.5 mt-5 block text-xs font-semibold text-neutral-900">Alasan (wajib)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus placeholder="mis. Penyesuaian audit untuk beban akrual"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
          <p className="mt-1 text-[11px] text-neutral-500">Tercatat di audit trail. Butuh akses Partner / Direktur.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-4">
          <button onClick={onCancel} disabled={saving} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-neutral-700 hover:bg-neutral-50">Cancel</button>
          <button onClick={submit} disabled={reason.trim().length < 5 || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <LockOpen size={15} />} Re-open
          </button>
        </div>
      </div>
    </div>
  );
}