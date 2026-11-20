'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, Check, X, Eye, Info, FileText, Clock, ShieldCheck, BookOpen,
  Hash, CalendarDays, Workflow, FileSpreadsheet,
} from 'lucide-react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { useJeDrafts, useJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiStatus } from '@/lib/journalEntryStore';
import { PickerPagination } from '@/app/transactions/components/PreviewLayout';
import { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';
import SalesLoading from '@/app/transactions/sales/components/SalesLoading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { JeErrorBanner } from '@/app/transactions/journal-entry/components/JeNotice';

type JEStatus = JeUiStatus;

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');
const fmtAngka = (n: number) => n.toLocaleString('id-ID');

// Warna status disamakan dengan pill bergaris di Sales Preview.
const STATUS_BADGE: Record<JEStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-800 border-neutral-300',
  pending: 'bg-amber-100 text-amber-900 border-amber-300',
  approved: 'bg-blue-100 text-blue-800 border-blue-300',
  posted: 'bg-teal-100 text-teal-800 border-teal-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  exception: 'bg-orange-100 text-orange-800 border-orange-300',
};
const STATUS_DOT: Record<JEStatus, string> = {
  draft: 'bg-neutral-500',
  pending: 'bg-amber-600',
  approved: 'bg-blue-600',
  posted: 'bg-teal-600',
  rejected: 'bg-red-600',
  exception: 'bg-orange-600',
};
const STATUS_LABEL: Record<JEStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
};

const iconBadge = (node: React.ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200">{node}</span>
);

function StatusPill({ status, label }: { status: JEStatus; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {label}
    </span>
  );
}

// Panel putih dengan header terpisah garis -- sama dengan JPanel di Sales Preview.
function JPanel({ title, subtitle, leading, action, children, className = '', flush }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-neutral-900">{title}</h3>
            {subtitle && <p className="truncate text-xs font-medium text-neutral-700">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children !== undefined && children !== null && children !== false && (
        <div className={`flex flex-1 flex-col ${flush ? '' : 'p-4'}`}>{children}</div>
      )}
    </section>
  );
}

// Kartu KPI -- desain sama dengan JournalKpiTile di Sales Preview.
function KpiTile({ label, value, pct, pctLabel, icon: Icon }: {
  label: string; value: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-700" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50">
          <Icon size={16} className="text-neutral-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-neutral-700">{p}% {pctLabel}</p>
    </div>
  );
}

// Kartu langkah (1-4) -- gaya StepCard di Sales Preview.
function StepCard({ step, icon: Icon, title, aside, flush, children }: {
  step: number;
  icon: React.ElementType;
  title: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-xs font-semibold text-neutral-700">
            {step}
          </span>
          <h4 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-neutral-900">
            <Icon size={15} className="shrink-0 text-neutral-700" />
            <span className="truncate">{title}</span>
          </h4>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className={`flex-1 ${flush ? '' : 'p-4'}`}>{children}</div>
    </section>
  );
}

interface RowSpec { label: React.ReactNode; value: React.ReactNode; strong?: boolean }

// Daftar label : nilai (label kiri, nilai rata kanan) -- sama dengan Rows di Sales Preview.
function Rows({ rows }: { rows: RowSpec[] }) {
  return (
    <dl className="divide-y divide-neutral-200 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="font-medium text-neutral-700">{r.label}</dt>
          <dd className={`min-w-0 break-words text-right tabular-nums ${r.strong ? 'text-sm font-bold text-neutral-900' : 'font-semibold text-neutral-900'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type StatusFilter = 'all' | JEStatus;

export default function JournalPreviewPage() {
  const { t } = useLanguage();
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading, error, refresh } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && journalEntries.length > 0) setSelectedId(journalEntries[0].id);
  }, [journalEntries, selectedId]);

  // Pencarian + filter status daftar kiri (gaya sama dengan daftar invoice di Sales Preview).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectorPage, setSelectorPage] = useState(1);

  const stats = useMemo(() => {
    const count = (s: JEStatus) => journalEntries.filter(e => e.status === s).length;
    return {
      total: journalEntries.length,
      draft: count('draft'),
      pending: count('pending'),
      approved: count('approved'),
      posted: count('posted'),
    };
  }, [journalEntries]);

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'Semua', count: stats.total },
    { key: 'draft', label: 'Draft', count: stats.draft },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'approved', label: 'Approved', count: stats.approved },
    { key: 'posted', label: 'Posted', count: stats.posted },
  ];

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journalEntries.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (e.jeNumber || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    });
  }, [journalEntries, search, statusFilter]);

  const selectorTotalPages = Math.max(1, Math.ceil(filteredEntries.length / JE_PAGE_SIZE));
  const selectorPageSafe = Math.min(selectorPage, selectorTotalPages);
  const paginatedEntries = filteredEntries.slice((selectorPageSafe - 1) * JE_PAGE_SIZE, selectorPageSafe * JE_PAGE_SIZE);

  const je = journalEntries.find(e => e.id === selectedId) || journalEntries[0];
  const { lines: backendLines } = useJeDraftLines(je?.id);
  const lines = useMemo(() => backendLines.map(mapJeDraftLineToUi), [backendLines]);
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const persen = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  if (loading) {
    return (
      <div className={`${salesFont.className} space-y-6 fade-in`}>
        <JournalEntryTabs activeTab="preview" />
        {error && <JeErrorBanner message={error} onRetry={refresh} />}
        <SalesLoading loading message="Loading journal entries…" />
      </div>
    );
  }

  if (!je) {
    return (
      <div className={`${salesFont.className} space-y-6 fade-in`}>
        <JournalEntryTabs activeTab="preview" />
        {error && <JeErrorBanner message={error} onRetry={refresh} />}
        <SalesLoading loading={false} message="No journal entries to preview yet." />
      </div>
    );
  }

  return (
    <div className={`${salesFont.className} space-y-5 fade-in`}>
      <JournalEntryTabs activeTab="preview" />
      {error && <JeErrorBanner message={error} onRetry={refresh} />}

      {/* KPI -- desain sama dengan Sales Preview */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label={t('Total Journal Entry')} value={String(stats.total)} pct={100} pctLabel={t('dari seluruh jurnal')} icon={FileText} />
        <KpiTile label={t('Menunggu Review')} value={String(stats.draft + stats.pending)} pct={persen(stats.draft + stats.pending, stats.total)} pctLabel={t('dari seluruh jurnal')} icon={Clock} />
        <KpiTile label={t('Siap Posting')} value={String(stats.approved)} pct={persen(stats.approved, stats.total)} pctLabel={t('dari seluruh jurnal')} icon={ShieldCheck} />
        <KpiTile label={t('Diposting')} value={String(stats.posted)} pct={persen(stats.posted, stats.total)} pctLabel={t('dari seluruh jurnal')} icon={BookOpen} />
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        {/* Kiri: daftar journal entry */}
        <JPanel
          className="w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-80"
          title={t('Daftar Journal Entry')}
          leading={iconBadge(<FileSpreadsheet size={17} />)}
          flush
        >
          <div className="space-y-2.5 border-b border-neutral-200 p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectorPage(1); }}
                placeholder={t('Cari nomor JE atau deskripsi...')}
                className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusTabs.map(tab => {
                const on = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setStatusFilter(tab.key); setSelectorPage(1); }}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'border-neutral-300 bg-neutral-200 text-neutral-900' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'}`}
                  >
                    {t(tab.label)} <span className="text-neutral-600">{tab.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="scrollbar-thin max-h-[560px] space-y-2 overflow-y-auto p-3">
            {paginatedEntries.length === 0 && (
              <div className="py-8 text-center text-xs text-neutral-600">{t('Tidak ada journal entry yang cocok.')}</div>
            )}
            {paginatedEntries.map(e => {
              const aktif = je.id === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  aria-current={aktif ? 'true' : undefined}
                  className={`group flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${aktif ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50'}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${aktif ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-600'}`}>JE</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold leading-snug text-blue-700">{e.jeNumber}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-neutral-800">{e.description}</span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-neutral-700">{e.date || '—'}</span>
                      <StatusPill status={e.status} label={t(STATUS_LABEL[e.status])} />
                    </span>
                    <span className="mt-1 block text-sm font-semibold tabular-nums text-neutral-900">{fmt(e.totalDebit)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <PickerPagination
            page={selectorPageSafe}
            totalPages={selectorTotalPages}
            total={filteredEntries.length}
            itemLabel="journal entries"
            onPageChange={setSelectorPage}
            className="p-3"
          />
        </JPanel>

        {/* Kanan: detail */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Header: ringkasan journal entry */}
          <JPanel
            title={t('Detail Journal Preview')}
            subtitle={t('Tinjau journal entry sebelum diposting ke buku besar')}
            leading={iconBadge(<Eye size={17} />)}
            action={<StatusPill status={je.status} label={t(STATUS_LABEL[je.status])} />}
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200">JE</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-blue-700">{je.jeNumber}</p>
                  <p className="truncate text-xs font-semibold text-neutral-700">{je.description}</p>
                </div>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-600">{t('Total Debit')}</p>
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{fmt(totalDebit || je.totalDebit)}</p>
              </div>
            </div>
          </JPanel>

          {/* 1-3. Reference, Dates, Workflow */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <StepCard step={1} icon={Hash} title={t('Reference')}>
              <Rows rows={[
                { label: t('JE Number'), value: <span className="font-mono">{je.jeNumber}</span> },
                { label: t('Source Type'), value: je.sourceType || '—' },
                { label: t('Source Reference'), value: je.sourceReference || '—' },
              ]} />
            </StepCard>
            <StepCard step={2} icon={CalendarDays} title={t('Dates')}>
              <Rows rows={[
                { label: t('Entry Date'), value: je.date || '—' },
                { label: t('Posting Date'), value: je.postingDate || '—' },
                { label: t('Period'), value: je.period || '—' },
              ]} />
            </StepCard>
            <StepCard step={3} icon={Workflow} title={t('Workflow')}>
              <Rows rows={[
                { label: t('Created by'), value: je.createdBy || '—' },
                { label: t('Reviewed by'), value: je.reviewedBy || t('— Pending —') },
                { label: t('Approved by'), value: je.approvedBy || t('— Pending —') },
              ]} />
            </StepCard>
          </div>

          {/* 4. Journal Lines */}
          <StepCard
            step={4}
            icon={BookOpen}
            title={t('Journal Lines')}
            flush
            aside={
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${isBalanced ? 'border-neutral-200 bg-neutral-50 text-neutral-700' : 'border-red-300 bg-red-100 text-red-700'}`}>
                {isBalanced ? <Check size={12} strokeWidth={3} /> : <X size={12} />} {isBalanced ? t('Seimbang') : t('Tidak seimbang')}
              </span>
            }
          >
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[720px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    {[
                      { h: t('No.'), cls: 'w-12 text-left' },
                      { h: t('Account Code'), cls: 'text-left' },
                      { h: t('Account Name'), cls: 'text-left' },
                      { h: t('Description'), cls: 'text-left' },
                      { h: t('Cost Center'), cls: 'text-left' },
                      { h: t('Debit (IDR)'), cls: 'text-right' },
                      { h: t('Credit (IDR)'), cls: 'text-right' },
                    ].map(c => (
                      <th key={c.h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-4 py-2 text-xs font-bold text-black ${c.cls}`}>{c.h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id} className="text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                      <td className="px-4 py-2.5 text-neutral-600">{i + 1}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold text-neutral-900">{l.accountCode ? kodeAkun(l.accountCode) : '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-neutral-900">{l.accountName || '—'}</td>
                      <td className="px-4 py-2.5 text-neutral-700">{l.description || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">{l.costCenter || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{l.debit !== 0 ? fmtAngka(l.debit) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{l.credit !== 0 ? fmtAngka(l.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`text-xs font-semibold ${isBalanced ? 'bg-neutral-100 text-neutral-900' : 'bg-red-50 text-red-700'}`}>
                    <td colSpan={5} className="border-t border-neutral-800 px-4 py-3">{t('Total')}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{fmtAngka(totalDebit)}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{fmtAngka(totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </StepCard>

          {je.notes && (
            <div className="flex items-start gap-2.5 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-600"><Info size={15} /></span>
              <p className="text-xs font-medium text-neutral-700">{je.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}