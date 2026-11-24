'use client';

// Panel kanan tab Depreciation (pengganti tabel "Assets Pending Depreciation Review"):
// "Run Readiness" -- stepper perjalanan batch periode berikutnya (Review -> Create -> Approve -> Post)
// + papan triase masalah: chip jenis masalah (klik untuk menyaring) dan kartu aset yang bisa
// dibuka untuk melihat cara memperbaikinya. Semua dari data DepreciationSummary yang sudah dimuat.

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Lightbulb, PartyPopper, Play } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import type { DepreciationSummary } from '@/lib/fixedAssetsStore';
import { FaCard, FaPill } from './FaTable';
import type { FaActions } from './FixedAssetsWorkspace';

const bulanPanjang = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });

// Cara memperbaiki tiap jenis masalah (teks issue berasal dari backend fixed_assets_v1._masalah).
const HINTS: Record<string, string> = {
  'Check asset category': 'Assign a category in the asset form so method, life and accounts can be inherited.',
  'Verify acquisition date': 'Set a valid acquisition date that is not in the future.',
  'Check method': 'Choose Straight Line or Double Declining as the depreciation method.',
  'Missing useful life': 'Fill in the useful life in months, or pick a category that already has one.',
  'Missing salvage value': 'Enter a salvage (residual) value, even if it is 0.',
  'Missing cost': 'Enter the asset cost; it must be greater than zero.',
  'Missing depreciation accounts': 'Link the accumulated depreciation and expense COA accounts (on the asset or its category).',
};
const hintFor = (issue: string) => HINTS[issue] ?? 'Open the asset and resolve this issue.';

type StepState = 'done' | 'active' | 'warn' | 'todo';

function StepDot({ state, n }: { state: StepState; n: number }) {
  const cls = state === 'done' ? 'bg-emerald-600 text-white'
    : state === 'active' ? 'bg-blue-600 text-white ring-4 ring-emerald-100'
      : state === 'warn' ? 'bg-amber-500 text-white ring-4 ring-amber-100'
        : 'bg-neutral-200 text-neutral-500';
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${cls}`}>
      {state === 'done' ? <Check size={14} strokeWidth={3} /> : state === 'warn' ? <AlertTriangle size={13} /> : n}
    </span>
  );
}

const SECTION = 'overflow-hidden rounded-xl border border-neutral-400 bg-white shadow-sm';
const SECTION_HEAD = 'flex items-center justify-between gap-3 border-b border-neutral-300 px-4 py-3';
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-wide text-neutral-500';
// Tombol hijau utama -- kelas sama dengan tombol "Add Sales Invoice".
const BTN_GREEN = 'inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
// Chip jenis masalah -- semua chip (termasuk "All issues") memakai gaya yang sama.
const chipCls = (aktif: boolean) => `rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${aktif
  ? 'border-rose-500 bg-rose-100 text-rose-800 ring-1 ring-rose-300'
  : 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400'}`;

export default function DepreciationReviewPanel({ data, loading, actions, onOpenRun }: {
  data: DepreciationSummary | null;
  loading: boolean;
  actions: FaActions;
  onOpenRun: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const review = useMemo(() => data?.review ?? [], [data]);
  const nr = data?.next_run;

  // Jumlah aset per jenis masalah (untuk chip).
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    review.forEach(r => r.issues.forEach(i => m.set(i, (m.get(i) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [review]);

  const shown = useMemo(() => (filter ? review.filter(r => r.issues.includes(filter)) : review), [review, filter]);
  const LIMIT = 5;
  const list = all ? shown : shown.slice(0, LIMIT);

  // Batch milik periode run berikutnya (abaikan yang sudah di-reverse).
  const run = useMemo(() => (nr ? data?.runs.find(r => r.period.slice(0, 7) === nr.period.slice(0, 7) && r.status !== 'reversed') ?? null : null), [data, nr]);

  const steps = useMemo(() => {
    if (!nr) return [];
    const nIssue = review.length;
    const adaRun = !!run;
    const s2: StepState = adaRun ? 'done' : nr.status === 'ready' ? 'active' : 'todo';
    const s3: StepState = run?.status === 'draft' ? 'active' : run && (run.status === 'approved' || run.status === 'posted') ? 'done' : 'todo';
    const s4: StepState = run?.status === 'approved' ? 'active' : run?.status === 'posted' ? 'done' : 'todo';
    return [
      { title: 'Review assets', state: (nIssue ? 'warn' : 'done') as StepState,
        detail: nIssue ? `${nIssue} asset${nIssue === 1 ? '' : 's'} skipped` : 'All assets ready', sub: nIssue ? 'Fix to include them' : undefined, onClick: undefined as (() => void) | undefined },
      { title: 'Create batch', state: s2,
        detail: run ? run.run_no : nr.status === 'ready' ? `${nr.eligible_assets} assets` : 'Nothing to run',
        sub: run ? `${run.asset_count} assets` : nr.status === 'ready' ? rupiah(nr.estimated_amount) : undefined,
        onClick: !run && nr.status === 'ready' ? actions.runDepreciation : run ? () => onOpenRun(run.id) : undefined },
      { title: 'Approve', state: s3, detail: run?.status === 'draft' ? 'Waiting' : run && s3 === 'done' ? 'Approved' : 'Not started', sub: undefined as string | undefined,
        onClick: run ? () => onOpenRun(run.id) : undefined },
      { title: 'Post to ledger', state: s4, detail: run?.status === 'approved' ? 'Ready to post' : run?.status === 'posted' ? 'Posted' : 'Not started', sub: undefined as string | undefined,
        onClick: run ? () => onOpenRun(run.id) : undefined },
    ];
  }, [nr, review.length, run, actions.runDepreciation, onOpenRun]);

  if (loading || !data || !nr) {
    return (
      <FaCard title="Assets Pending Depreciation Review" subtitle="Fix these so they are included in the next run">
        <div className="mt-3 space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-neutral-100" />)}</div>
      </FaCard>
    );
  }

  return (
    <FaCard title="Assets Pending Depreciation Review" subtitle="Fix these so they are included in the next run">
      <div className="mt-4 space-y-4">
        {/* 1. Progres run periode berikutnya */}
        <section className={SECTION}>
          <header className={SECTION_HEAD}>
            <div>
              <p className={EYEBROW}>Next run</p>
              <p className="text-sm font-semibold text-neutral-900">{bulanPanjang(nr.period)}</p>
            </div>
            {nr.status === 'ready' && !run && (
              <button type="button" onClick={actions.runDepreciation} className={BTN_GREEN}><Play size={13} /> Run now</button>
            )}
          </header>
          <ol className="grid grid-cols-4 gap-1 px-3 py-4">
            {steps.map((st, i) => {
              const last = i === steps.length - 1;
              const body = (
                <>
                  <div className="flex items-center">
                    <StepDot state={st.state} n={i + 1} />
                    {!last && <span className={`mx-1.5 h-px flex-1 ${st.state === 'done' ? 'bg-emerald-400' : 'bg-neutral-300'}`} />}
                  </div>
                  <div className={`mt-2 text-xs font-semibold ${st.state === 'todo' ? 'text-neutral-500' : 'text-neutral-900'}`}>{st.title}</div>
                  <div className={`mt-0.5 text-[11px] leading-snug ${st.state === 'warn' ? 'font-medium text-amber-700' : 'text-neutral-500'}`}>{st.detail}</div>
                  {st.sub && <div className="text-[11px] leading-snug text-neutral-500">{st.sub}</div>}
                </>
              );
              return (
                <li key={st.title} className="min-w-0">
                  {st.onClick
                    ? <button type="button" onClick={st.onClick} className="block w-full rounded-lg p-1.5 text-left transition-colors hover:bg-neutral-100">{body}</button>
                    : <div className="p-1.5">{body}</div>}
                </li>
              );
            })}
          </ol>
        </section>

        {/* 2. Aset yang perlu diperbaiki */}
        <section className={SECTION}>
          <header className={SECTION_HEAD}>
            <div>
              <p className={EYEBROW}>Needs attention</p>
              <p className="text-sm font-semibold text-neutral-900">{review.length === 0 ? 'No issues found' : `${review.length} asset${review.length === 1 ? '' : 's'} with issues`}</p>
            </div>
          </header>

          {review.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><PartyPopper size={18} /></span>
              <p className="text-sm font-semibold text-neutral-900">All clear</p>
              <p className="text-xs text-neutral-500">Every active asset is ready for depreciation.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 border-b border-neutral-300 px-4 py-3">
                <button type="button" onClick={() => { setFilter(null); setAll(false); }} className={chipCls(filter === null)}>All issues · {review.length}</button>
                {counts.map(([issue, n]) => (
                  <button key={issue} type="button" onClick={() => { setFilter(filter === issue ? null : issue); setAll(false); }} className={chipCls(filter === issue)}>
                    {issue} · {n}
                  </button>
                ))}
              </div>

              <ul className="divide-y divide-neutral-300">
                {list.map(r => {
                  const terbuka = open === r.asset_id;
                  return (
                    <li key={r.asset_id}>
                      <button type="button" onClick={() => setOpen(terbuka ? null : r.asset_id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${terbuka ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200"><AlertTriangle size={15} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-neutral-900">{r.asset_code} · {r.name}</span>
                          <span className="block text-[11px] text-neutral-500">{r.issues.length} issue{r.issues.length === 1 ? '' : 's'} · Book value {rupiah(r.nbv)}</span>
                        </span>
                        <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform ${terbuka ? 'rotate-180' : ''}`} />
                      </button>
                      {terbuka && (
                        <div className="space-y-3 border-t border-neutral-300 bg-neutral-50 px-4 py-3">
                          {r.issues.map(i => (
                            <div key={i} className="flex items-start gap-2">
                              <Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-600" />
                              <div className="min-w-0 text-[11px]">
                                <FaPill label={i} style="bg-rose-50 text-rose-600" />
                                <p className="mt-1 text-neutral-600">{hintFor(i)}</p>
                              </div>
                            </div>
                          ))}
                          <button type="button" onClick={() => actions.openAsset(r.asset_id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                            Open asset <ArrowUpRight size={13} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {shown.length > LIMIT && (
                <button type="button" onClick={() => setAll(v => !v)} className="w-full border-t border-neutral-300 py-2.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50">
                  {all ? 'Show less' : `Show all ${shown.length} assets`}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </FaCard>
  );
}