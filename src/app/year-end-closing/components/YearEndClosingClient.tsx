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
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Year-End Closing</h1>
            <p className="mt-1 text-sm text-muted-foreground">Kelola proses penutupan tahun buku, snapshot saldo akhir, dan audit trail closing per klien.</p>
          </div>
          <button onClick={reload} disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-50">
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={CalendarDays} tone="sky" label="Open Fiscal Years" value={kpi?.open} hint="Tahun buku belum ditutup" />
          <KpiCard icon={CheckCircle2} tone="green" label="Closed Fiscal Years" value={kpi?.closed} hint="Tahun buku sudah ditutup" />
          <KpiCard icon={RotateCcw} tone="orange" label="Re-opened Cases" value={kpi?.reopened} hint="Pernah dibuka kembali" />
          <KpiCard icon={Hourglass} tone="amber" label="Pending Pre-Closing Checks" value={kpi?.pending_checks} hint="Menunggu pengecekan" />
        </div>

        {/* ---------------- Daftar Tahun Buku ---------------- */}
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 px-5 pb-3 pt-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">Daftar Tahun Buku</h2>
              <p className="text-xs text-muted-foreground">Daftar tahun buku per klien beserta status penutupan.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-72">
                <Search size={14} className="text-muted-foreground" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari klien atau tahun buku..."
                  className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
              </label>
              <FilterMenu status={statusFilter} onStatus={setStatusFilter} activeOnly={activeOnly} onActiveOnly={setActiveOnly} hasActive={!!activeClientId} />
            </div>
          </div>

          <div className="overflow-x-auto px-5 pb-2">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th className="px-3 py-2.5">Klien</th>
                  <th className="px-3 py-2.5">Fiscal Year</th>
                  <th className="px-3 py-2.5">Start Date</th>
                  <th className="px-3 py-2.5">End Date</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Closed By</th>
                  <th className="px-3 py-2.5">Closed At</th>
                  <th className="px-3 py-2.5">Re-opened By</th>
                  <th className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && !data ? (
                  [0, 1, 2, 3].map(i => <tr key={i}><td colSpan={9} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-slate-100" /></td></tr>)
                ) : halaman.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-xs text-muted-foreground">Tidak ada tahun buku yang cocok.</td></tr>
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
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{page * PER_HALAMAN + 1}–{Math.min(filtered.length, (page + 1) * PER_HALAMAN)} dari {filtered.length}</span>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-border px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Prev</button>
                <button disabled={page >= jumlahHalaman - 1} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-border px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Next</button>
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

const TONES = {
  sky: { card: 'border-sky-100 bg-sky-50/50', icon: 'bg-sky-100 text-sky-600' },
  green: { card: 'border-emerald-100 bg-emerald-50/50', icon: 'bg-emerald-100 text-emerald-600' },
  orange: { card: 'border-orange-100 bg-orange-50/60', icon: 'bg-orange-100 text-orange-600' },
  amber: { card: 'border-amber-100 bg-amber-50/60', icon: 'bg-amber-100 text-amber-600' },
} as const;

function KpiCard({ icon: Icon, tone, label, value, hint }: { icon: React.ElementType; tone: keyof typeof TONES; label: string; value?: number; hint: string }) {
  const t = TONES[tone];
  return (
    <div className={`flex items-center gap-4 rounded-2xl border p-5 shadow-sm ${t.card}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${t.icon}`}><Icon size={22} /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-2xl font-bold leading-tight text-foreground">{value ?? '–'}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
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
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-slate-50">
        <Filter size={14} /> Filter{aktif ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{aktif}</span> : null}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-border bg-card p-3 shadow-lg">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</p>
            {(['all', 'open', 'closed', 'reopened'] as StatusFilter[]).map(s => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="radio" checked={status === s} onChange={() => onStatus(s)} />
                {s === 'all' ? 'All statuses' : STATUS_BADGE[s].label}
              </label>
            ))}
            <div className="my-2 border-t border-border" />
            <label className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${hasActive ? 'cursor-pointer hover:bg-slate-50' : 'opacity-50'}`}>
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
  open: { label: 'Open', cls: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  closed: { label: 'Closed', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  reopened: { label: 'Re-opened', cls: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
};

function StatusBadge({ status }: { status: 'open' | 'closed' | 'reopened' }) {
  const b = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} /> {b.label}
    </span>
  );
}

function YearRow({ y, selected, onClose, onView, onChecklist, onReopen, onGl }: {
  y: WorkspaceYear; selected: boolean; onClose: () => void; onView: () => void; onChecklist: () => void; onReopen: () => void; onGl: () => void;
}) {
  return (
    <tr className={selected ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60'}>
      <td className="px-3 py-3 text-xs font-medium uppercase text-foreground">{y.client_name}</td>
      <td className="px-3 py-3 text-xs font-semibold text-foreground">FY {y.fiscal_year}</td>
      <td className="px-3 py-3 text-xs text-foreground">{formatDate(y.period_start)}</td>
      <td className="px-3 py-3 text-xs text-foreground">{formatDate(y.period_end)}</td>
      <td className="px-3 py-3"><StatusBadge status={y.status} /></td>
      <td className="px-3 py-3 text-xs text-foreground">{y.closed_by_name || '-'}</td>
      <td className="px-3 py-3 text-xs text-foreground">{y.closed_at ? formatDate(y.closed_at) : '-'}</td>
      <td className="px-3 py-3 text-xs text-foreground" title={y.reopen_reason ?? undefined}>{y.status === 'reopened' ? y.reopened_by_name || '-' : '-'}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          {y.status === 'open' ? (
            <button onClick={onClose} title={y.has_ended ? undefined : `FY ${y.fiscal_year} ends on ${formatDate(y.period_end)}`}
              className="w-[118px] rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-800">
              Close FY {y.fiscal_year}
            </button>
          ) : (
            <>
              <button onClick={onView} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-slate-50">View</button>
              <button onClick={onChecklist} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-slate-50">Checklist</button>
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
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-50';
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex h-7 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-slate-50">
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg" onClick={() => setOpen(false)}>
            {y.status === 'reopened' && <button onClick={onClose} className={item}><Play size={13} /> Close FY {y.fiscal_year} again</button>}
            {y.status === 'closed' && (
              y.can_reopen
                ? <button onClick={onReopen} className={`${item} text-orange-700`}><LockOpen size={13} /> Re-open FY {y.fiscal_year}</button>
                : <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">Re-open later years first</p>
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
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 px-5 pb-3 pt-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Detail Tahun yang Sudah Ditutup</h2>
          <p className="text-xs text-muted-foreground">Informasi detail dan snapshot keuangan untuk tahun buku yang telah ditutup.</p>
        </div>
        {options.length > 0 && (
          <label className="relative flex w-full items-center rounded-xl border border-border bg-card sm:w-80">
            <select value={selectedKey ?? ''} onChange={e => onSelect(e.target.value)}
              className="w-full appearance-none bg-transparent py-2 pl-3 pr-9 text-sm font-medium text-foreground focus:outline-none">
              {options.map(o => (
                <option key={kunci(o)} value={kunci(o)}>FY {o.fiscal_year} – {o.client_name.toUpperCase()}{o.status === 'reopened' ? ' (re-opened)' : ''}</option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 text-muted-foreground" />
          </label>
        )}
      </div>

      <div className="px-5 pb-5">
        {options.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><CalendarDays size={20} /></span>
            <p className="text-sm font-semibold text-foreground">Belum ada tahun buku yang ditutup</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">Klik &quot;Close FY&quot; pada tahun buku yang sudah berakhir untuk menjalankan checklist dan menutupnya.</p>
          </div>
        ) : err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        ) : !d ? (
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
        ) : (
          <div className={`rounded-2xl border border-border p-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarDays size={18} /></span>
              <div>
                <p className="flex items-center gap-2 text-lg font-bold text-foreground">FY {d.fiscal_year} <StatusBadge status={d.status} /></p>
                <p className="text-xs uppercase text-muted-foreground">{d.client_name}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:divide-x lg:divide-border">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Closing Snapshot</h3>
                <dl className="space-y-2 text-xs">
                  <SnapRow label="Total Assets" value={bs?.assets} />
                  <SnapRow label="Total Liabilities" value={bs?.liabilities} />
                  <SnapRow label="Total Equity" value={bs?.equity} />
                  <SnapRow label="Net Profit Closed to Retained Earnings" value={d.net_profit} />
                </dl>
                {d.snapshot.summary && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Revenue {rupiah(d.snapshot.summary.revenue)} · Expenses {rupiah(d.snapshot.summary.expenses)}
                  </p>
                )}
              </div>

              <div className="lg:pl-6">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Closing Journal</h3>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Journal No.</dt>
                  <dd>
                    {d.journal ? (
                      <Link href={glLink(d.period_end)} onClick={() => onGl(d)}
                        className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-700 hover:underline">
                        {d.journal.je_number} <ExternalLink size={11} />
                      </Link>
                    ) : <span className="text-muted-foreground">No P&amp;L activity — none needed</span>}
                    {d.reversal_journal && <span className="ml-1.5 font-mono text-[11px] text-orange-700">→ {d.reversal_journal.je_number}</span>}
                  </dd>
                  <dt className="text-muted-foreground">Link to General Ledger</dt>
                  <dd>
                    <Link href={glLink(d.period_end)} onClick={() => onGl(d)}
                      className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:underline">
                      <FileText size={11} /> Lihat di General Ledger
                    </Link>
                  </dd>
                  <dt className="text-muted-foreground">Retained Earnings</dt>
                  <dd className="text-foreground">{d.retained_earnings_account ? `${kodeAkun(d.retained_earnings_account.acc_no)} · ${d.retained_earnings_account.account_name}` : '—'}</dd>
                  <dt className="text-muted-foreground">Closed By</dt>
                  <dd className="text-foreground">{d.closed_by_name || '—'}</dd>
                  <dt className="text-muted-foreground">Closed At</dt>
                  <dd className="text-foreground">{formatDateTime(d.closed_at)}</dd>
                  <dt className="text-muted-foreground">Catatan</dt>
                  <dd className="text-foreground">{d.notes || '—'}</dd>
                  {d.status === 'reopened' && (
                    <>
                      <dt className="text-orange-700">Re-open reason</dt>
                      <dd className="text-orange-800">{d.reopen_reason || '—'}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="lg:pl-6">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Audit Trail</h3>
                <ol className="space-y-3">
                  {d.audit_trail.map((s, i) => {
                    const buka = s.step === 'reopen' || s.step === 'reversed';
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-xs">
                        <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white ${buka ? 'bg-orange-500' : 'bg-emerald-600'}`}>
                          {buka ? <RotateCcw size={10} /> : <CheckCircle2 size={12} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{s.title}</p>
                          {s.detail && <p className="truncate text-[11px] text-muted-foreground" title={s.detail}>{s.detail}</p>}
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold tabular-nums ${(value ?? 0) < 0 ? 'text-rose-600' : 'text-foreground'}`}>{value === null || value === undefined ? '—' : rupiah(value)}</dd>
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
    <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-sky-800"><Info size={16} /> Dampak ke Modul Lain</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map(({ icon: Icon, t, d, href }) => (
          <Link key={t} href={href} className="group flex items-start gap-3">
            <Icon size={20} className="mt-0.5 shrink-0 text-sky-700" />
            <div>
              <p className="text-xs font-semibold text-sky-800 group-hover:underline">{t}</p>
              <p className="text-[11px] leading-relaxed text-slate-600">{d}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------

const CHECK_ICON: Record<CheckStatus, { icon: React.ElementType; cls: string }> = {
  pass: { icon: CheckCircle2, cls: 'bg-emerald-600 text-white' },
  warn: { icon: AlertTriangle, cls: 'bg-amber-100 text-amber-600' },
  fail: { icon: XCircle, cls: 'bg-rose-100 text-rose-600' },
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
    <li className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${c.status === 'fail' ? 'border-rose-200 bg-rose-50/40' : c.status === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-border bg-card'}`}>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ic.cls}`}><I size={c.status === 'pass' ? 17 : 15} /></span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{c.label || LABEL_CEK[c.id] || c.id}</p>
        <p className="text-xs text-muted-foreground">{c.detail}</p>
        {c.id === 'mapping' && c.status === 'warn' && (
          <Link href="/financial-statements/mapping" className="text-[11px] font-medium text-blue-700 hover:underline">Open Statement Mapping →</Link>
        )}
        {c.id === 'pending_documents' && c.status === 'warn' && (
          <Link href="/transactions/journal-entry" className="text-[11px] font-medium text-blue-700 hover:underline">Review transactions →</Link>
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
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <aside className="flex h-full w-full max-w-[400px] flex-col bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h3 className="text-xl font-bold text-foreground">Pre-Closing Checklist – FY {year.fiscal_year}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === 'view'
                ? `Hasil checklist saat FY ${year.fiscal_year} ditutup${snapshot?.snapshot.checked_at ? ` (${formatDateTime(snapshot.snapshot.checked_at)})` : ''}.`
                : 'Pastikan semua persyaratan terpenuhi sebelum melakukan penutupan tahun buku.'}
            </p>
          </div>
          <button onClick={onCancel} disabled={saving} className="rounded-lg p-1 text-muted-foreground hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs">
            <p className="text-muted-foreground">Klien</p>
            <p className="mb-2 text-sm font-semibold uppercase text-foreground">{year.client_name}</p>
            <p className="text-muted-foreground">Periode</p>
            <p className="text-sm text-foreground">{formatDate(year.period_start)} – {formatDate(year.period_end)}</p>
          </div>

          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

          <div>
            <h4 className="mb-2 text-base font-bold text-foreground">Checklist</h4>
            {loading && checks.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Running pre-closing checks…</div>
            ) : (
              <ul className={`space-y-2.5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
                {checks.map(c => <CheckCard key={c.id} c={c} />)}
              </ul>
            )}
          </div>

          {mode === 'close' && p && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Retained earnings account</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100">
                <option value="">— Choose an equity account —</option>
                {p.retained_earnings_options.map(a => <option key={a.id} value={a.id}>{kodeAkun(a.acc_no)} · {a.account_name}</option>)}
              </select>
            </div>
          )}

          {(p || snapshot) && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Building2 size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{mode === 'view' ? 'Profit Closed to Retained Earnings' : 'Estimated Profit to Retained Earnings'}</p>
                <p className={`text-xl font-bold tabular-nums ${profit < 0 ? 'text-rose-600' : 'text-foreground'}`}>{rupiah(profit)}</p>
              </div>
              <span title="Pendapatan dikurangi beban tahun ini; dipindahkan ke akun Retained Earnings lewat jurnal penutup."><Info size={15} className="text-muted-foreground" /></span>
            </div>
          )}

          {mode === 'close' && p && (
            <>
              <div className="rounded-xl border border-border">
                <button onClick={() => setShowJournal(s => !s)} className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-foreground">
                  <span>Closing journal preview <span className="ml-1 font-mono font-normal text-muted-foreground">{p.journal_preview.je_number}</span></span>
                  <ChevronDown size={14} className={`transition-transform ${showJournal ? 'rotate-180' : ''}`} />
                </button>
                {showJournal && (
                  p.journal_preview.lines.length === 0 ? (
                    <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
                      {accountId ? 'Tidak ada saldo laba rugi — periode hanya dikunci.' : 'Pilih akun Retained Earnings untuk melihat jurnal.'}
                    </p>
                  ) : (
                    <table className="w-full border-t border-border text-[11px]">
                      <tbody className="divide-y divide-border">
                        {p.journal_preview.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5"><span className="font-mono text-slate-500">{kodeAkun(l.account_code)}</span> {l.account_name}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums">{l.debit ? formatAmount(l.debit) : ''}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.credit ? formatAmount(l.credit) : ''}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-semibold">
                          <td className="px-3 py-1.5">Total</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatAmount(p.journal_preview.total_debit)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatAmount(p.journal_preview.total_credit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )
                )}
              </div>

              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Catatan (opsional), mis. sesuai hasil review audit internal"
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100" />

              <label className="flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-[11px] leading-relaxed text-orange-900">
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

        <div className="flex gap-3 border-t border-border px-5 py-4">
          <button onClick={onCancel} disabled={saving} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-slate-50">
            {mode === 'view' ? 'Close' : 'Cancel'}
          </button>
          {mode === 'close' && (
            <button onClick={submit} disabled={!p?.can_close || !confirm || saving || loading}
              title={p && !p.can_close ? 'Selesaikan checklist yang gagal terlebih dahulu.' : undefined}
              className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-40">
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
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-card shadow-2xl">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700"><LockOpen size={18} /></span>
            <div>
              <h3 className="text-lg font-bold text-foreground">Re-open FY {year.fiscal_year}?</h3>
              <p className="mt-0.5 text-xs uppercase text-muted-foreground">{year.client_name}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Transaksi bertanggal di FY {year.fiscal_year} bisa diubah lagi
                {year.journal_number ? <> dan jurnal penutup <span className="font-mono">{year.journal_number}</span> dibalik dengan <span className="font-mono">RV-{year.journal_number}</span></> : null}.
                Tutup kembali setelah koreksi selesai di-posting.
              </p>
            </div>
          </div>
          <label className="mb-1.5 mt-5 block text-xs font-semibold text-foreground">Alasan (wajib)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus placeholder="mis. Penyesuaian audit untuk beban akrual"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100" />
          <p className="mt-1 text-[11px] text-muted-foreground">Tercatat di audit trail. Butuh akses Partner / Direktur.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onCancel} disabled={saving} className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={reason.trim().length < 5 || saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <LockOpen size={15} />} Re-open
          </button>
        </div>
      </div>
    </div>
  );
}
