'use client';

// Tab Depreciation (Template UI/Fix Assets/4.jpeg): KPI, tren penyusutan
// bulanan, run berikutnya, daftar batch (approve / post / reverse), dan aset
// yang perlu direview sebelum bisa disusutkan.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, CalendarDays, Coins, FileText, Hourglass, Loader2, MoreHorizontal, Play } from 'lucide-react';
import { fmtDate, fmtDateTime, fmtMonth, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteRun, fetchDepreciation, fetchRun, METHOD_LABEL, reverseRun, runAction, useFaData, type DepRun, type DepreciationSummary,
} from '@/lib/fixedAssetsStore';
import { btnPrimary, btnSmall, Card, Drawer, Field } from '@/components/arap/arapUi';
import { Delta, ReasonDialog } from '@/components/shared/moduleUi';
import { FaKpiGrid } from './FaKpi';
import { faTableCls, faRow, faRowClickable, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow } from './FaTable';
import type { FaActions } from './FixedAssetsWorkspace';
import DepreciationReviewPanel from './DepreciationReviewPanel';
import NextRunPreview from './NextRunPreview';
import FaTrendChart, { type FaMonthGetter, type FaPointBuilder, type FaSeries } from './FaTrendChart';

const bulanPanjang = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });

export function approvalPill(s: DepRun['status']) {
  if (s === 'draft') return <FaPill label="Draft" style="bg-slate-100 text-slate-600" />;
  if (s === 'reversed') return <FaPill label="Reversed" style="bg-rose-50 text-rose-700" />;
  return <FaPill label="Approved" style="bg-emerald-50 text-emerald-700" />;
}
export function postingPill(s: DepRun['status']) {
  if (s === 'posted') return <FaPill label="Posted" style="bg-emerald-50 text-emerald-700" />;
  if (s === 'reversed') return <FaPill label="Reversed" style="bg-rose-50 text-rose-700" />;
  return <FaPill label="Unposted" style="bg-amber-50 text-amber-700" />;
}

// Chart tren: penyusutan bulanan vs bulan yang sama tahun lalu (kolom) + rata-rata 3 & 6 bulan (garis).
const DEP_SERIES: FaSeries[] = [
  { key: 'depreciation', name: 'Depreciation', color: '#2563EB', kind: 'bar' },
  { key: 'lastYear', name: 'Same Month Last Year', color: '#F59E0B', kind: 'bar' },
  { key: 'avg3', name: '3-Month Average', color: '#DC2626', kind: 'line' },
  { key: 'avg6', name: '6-Month Average', color: '#16A34A', kind: 'line', emphasis: true },
];
const rataRata = (i: number, get: FaMonthGetter, n: number): number | null => {
  let total = 0;
  for (let k = 0; k < n; k++) {
    const v = get(i - k)?.depreciation;
    if (v == null) return null;
    total += v;
  }
  return total / n;
};
const depBuild: FaPointBuilder = (i, get) => ({
  depreciation: get(i)?.depreciation ?? null,
  lastYear: get(i - 12)?.depreciation ?? null,
  avg3: rataRata(i, get, 3),
  avg6: rataRata(i, get, 6),
});

export default function DepreciationTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: FaActions }) {
  const dep = useFaData<DepreciationSummary | null>(`dep:${clientId}:${asOf}`, s => fetchDepreciation(clientId, asOf, s), null);
  const [runId, setRunId] = useState<string | null>(null);
  const d = dep.data;
  const k = d?.kpi;
  const nr = d?.next_run;
  const loading = dep.loading && !d;

  return (
    <div className="space-y-5">
      {dep.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{dep.error}</div>}
      <FaKpiGrid loading={loading} cards={[
        { label: 'Current Month Depreciation', value: rupiah(k?.current_month), icon: Coins, tone: 'rose',
          delta: <Delta now={k?.current_month} prev={k?.previous_month} suffix="vs. previous month" /> },
        { label: 'YTD Depreciation', value: rupiah(k?.ytd), icon: BarChart3, tone: 'violet', delta: <Delta now={k?.ytd} prev={k?.ytd_prev} suffix="vs. previous year" /> },
        { label: 'Pending Depreciation Batches', value: String(k?.pending_batches ?? 0), icon: Hourglass, tone: 'amber',
          delta: <span className="text-[11px] text-muted-foreground">{k?.pending_batches ? 'Waiting for approval / posting' : 'Nothing pending'}</span> },
        { label: 'Posted Depreciation Entries', value: String(k?.posted_entries_ytd ?? 0), icon: FileText, tone: 'emerald',
          delta: <Delta now={k?.posted_entries_ytd} prev={k?.posted_entries_prev_ytd} suffix="vs. previous year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <FaTrendChart className="xl:col-span-3" title="Depreciation Trend" titleLarge clientId={clientId} asOf={asOf} series={DEP_SERIES} build={depBuild} />

        <Card className="xl:col-span-2" title={<span className="flex items-center gap-2 text-neutral-900"><CalendarDays size={18} className="text-neutral-900" /> Next Depreciation Run</span>}>
          {loading || !nr ? <div className="mx-5 mb-5 h-40 animate-pulse rounded-xl bg-slate-50" /> : (
            <div className="space-y-3 px-5 pb-5 text-sm">
              <dl className="grid grid-cols-2 gap-y-2.5">
                <dt className="text-muted-foreground">Period</dt><dd className="font-semibold">{bulanPanjang(nr.period)}</dd>
                <dt className="text-muted-foreground">Depreciation Method</dt><dd className="font-semibold">{nr.methods.length ? nr.methods.map(m => METHOD_LABEL[m]).join(', ') : '—'}</dd>
                <dt className="text-muted-foreground">Eligible Assets</dt><dd className="font-semibold">{nr.eligible_assets}</dd>
                <dt className="text-muted-foreground">Estimated Depreciation Amount</dt><dd className="font-semibold">{rupiah(nr.estimated_amount)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{nr.status === 'ready' ? <FaPill label="Ready to Run" style="bg-sky-50 text-sky-700" />
                  : nr.status === 'exists' ? <FaPill label="Batch Created" style="bg-emerald-50 text-emerald-700" />
                    : <FaPill label="Nothing to Run" style="bg-slate-100 text-slate-600" />}</dd>
              </dl>
              {nr.issues > 0 && <p className="text-xs text-amber-700">{nr.issues} asset(s) skipped — see the review panel.</p>}
              {nr.status === 'exists' && nr.existing_run_id ? (
                <button type="button" onClick={() => setRunId(nr.existing_run_id)} className={`${btnPrimary} w-full`}>Open Batch for {bulanPanjang(nr.period)}</button>
              ) : (
                <button type="button" disabled={nr.status !== 'ready'} onClick={actions.runDepreciation} className={`${btnPrimary} w-full`}>
                  <Play size={15} /> Run Depreciation for {bulanPanjang(nr.period)}
                </button>
              )}
              {nr.status !== 'nothing_to_run' && (
                <NextRunPreview clientId={clientId} period={`${nr.period.slice(0, 7)}-01`} version={`${nr.eligible_assets}:${nr.estimated_amount}:${nr.status}`} actions={actions} />
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <FaCard className="xl:col-span-3" title="Depreciation Schedule / Batch List">
          <div className="overflow-x-auto scrollbar-thin">
            <table className={`${faTableCls} min-w-[760px]`}>
              <thead><tr className={tableHeadRow}>
                <th className={thCls}>Period</th><th className={thCls}>Batch No.</th><th className={`${thCls} text-right`}>Assets Included</th>
                <th className={`${thCls} text-right`}>Depreciation Amount</th><th className={thCls}>Prepared By</th>
                <th className={thCls}>Approval Status</th><th className={thCls}>Posting Status</th><th className={`${thCls} w-10`} />
              </tr></thead>
              <tbody>
                {(loading || !d?.runs.length) && <FaEmptyRow cols={8} loading={loading} text="No depreciation batches yet." />}
                {d?.runs.map(r => (
                  <tr key={r.id} className={faRowClickable} onClick={() => setRunId(r.id)}>
                    <td className={tdCls}>{fmtMonth(r.period.slice(0, 7))}</td>
                    <td className={`${tdCls} font-medium`}>{r.run_no}</td>
                    <td className={`${tdCls} text-right`}>{r.asset_count}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(r.total_amount)}</td>
                    <td className={tdCls}>{r.prepared_by_name ?? '—'}</td>
                    <td className={tdCls}>{approvalPill(r.status)}</td>
                    <td className={tdCls}>{postingPill(r.status)}</td>
                    <td className={tdCls}><MoreHorizontal size={13} className="text-neutral-600" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FaCard>

        <div className="xl:col-span-2">
          <DepreciationReviewPanel data={d} loading={loading} actions={actions} onOpenRun={setRunId} />
        </div>
      </div>

      {runId && <RunDrawer clientId={clientId} runId={runId} onClose={() => setRunId(null)} />}
    </div>
  );
}

function RunDrawer({ clientId, runId, onClose }: { clientId: string; runId: string; onClose: () => void }) {
  const run = useFaData<DepRun | null>(`run:${clientId}:${runId}`, s => fetchRun(clientId, runId, s), null);
  const [busy, setBusy] = useState<string | null>(null);
  const [balik, setBalik] = useState(false);
  const r = run.data;

  const aksi = async (label: string, fn: () => Promise<{ message: string }>, tutup = false) => {
    setBusy(label);
    try {
      toast.success((await fn()).message);
      if (tutup) onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const tombol = (label: string, fn: () => Promise<{ message: string }>, utama = false, tutup = false) => (
    <button type="button" disabled={!!busy} onClick={() => aksi(label, fn, tutup)}
      className={utama ? `${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]` : btnSmall}>
      {busy === label && <Loader2 size={12} className="animate-spin" />} {label}
    </button>
  );

  return (
    <Drawer open onClose={onClose} title={r ? `${r.run_no} · ${bulanPanjang(r.period)}` : 'Loading...'}
      subtitle={r ? `${r.asset_count} assets · ${rupiah(r.total_amount)} · posting date ${fmtDate(r.posting_date)}` : undefined}
      footer={r && <>
        {(r.status === 'draft' || r.status === 'approved') && tombol('Recalculate', () => runAction(clientId, r.id, 'recalculate'))}
        {(r.status === 'draft' || r.status === 'approved') && tombol('Delete', () => deleteRun(clientId, r.id), false, true)}
        {r.status === 'approved' && tombol('Return to Draft', () => runAction(clientId, r.id, 'return-to-draft'))}
        {r.status === 'draft' && tombol('Approve', () => runAction(clientId, r.id, 'approve'))}
        {(r.status === 'draft' || r.status === 'approved') && tombol('Post to Ledger', () => runAction(clientId, r.id, 'post'), true)}
        {r.status === 'posted' && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setBalik(true)}>Reverse Batch</button>}
      </>}>
      {run.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{run.error}</p>}
      {!r ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <div className="flex flex-wrap gap-2">{approvalPill(r.status)} {postingPill(r.status)}</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Prepared">{r.prepared_by_name ?? '—'} · {fmtDateTime(r.created_at)}</Field>
          <Field label="Approved">{r.approved_by_name ?? '—'} · {fmtDateTime(r.approved_at)}</Field>
          <Field label="Posted">{r.posted_by_name ?? '—'} · {fmtDateTime(r.posted_at)}</Field>
          <Field label="Journals">{r.journal_count ?? 0} journal(s)</Field>
        </div>
        {r.status === 'reversed' && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Reversed on {fmtDate(r.reversal_date)} by {r.reversed_by_name ?? '—'}. Reason: {r.reversal_reason}</p>
        )}
        {r.notes && <Field label="Notes">{r.notes}</Field>}
        <div className="overflow-x-auto scrollbar-thin">
        <table className={faTableCls}>
          <thead><tr className={tableHeadRow}>
            <th className={thCls}>Asset</th><th className={`${thCls} text-right`}>Accum. Before</th><th className={`${thCls} text-right`}>Depreciation</th><th className={`${thCls} text-right`}>NBV After</th>
          </tr></thead>
          <tbody>
            {r.lines?.map(l => (
              <tr key={l.asset_id} className={faRow}>
                <td className={tdCls}><span className="font-medium">{l.asset_code}</span> · {l.name}
                  <span className="block text-[10px] text-neutral-500">{METHOD_LABEL[l.method]} · Dr {l.expense_account} / Cr {l.accum_account}</span></td>
                <td className={`${tdCls} text-right`}>{rupiah(l.accumulated_before)}</td>
                <td className={`${tdCls} text-right font-semibold`}>{rupiah(l.amount)}</td>
                <td className={`${tdCls} text-right`}>{rupiah(l.nbv_after)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className={faRow}><td className={`${tdCls} border-b border-neutral-800 font-bold`}>Total</td><td className="border-b border-neutral-800" /><td className={`${tdCls} border-b border-neutral-800 text-right font-bold`}>{rupiah(r.total_amount)}</td><td className="border-b border-neutral-800" /></tr></tfoot>
        </table>
        </div>
      </>}
      <ReasonDialog open={balik} title={`Reverse ${r?.run_no ?? ''}`} withDate minDate={r?.posting_date} defaultDate={r?.posting_date}
        subtitle="All depreciation journals of this batch get a reversing journal (RV-) on the reversal date. Only the latest posted batch can be reversed."
        onClose={() => setBalik(false)} onConfirm={async (reason, date) => {
          try {
            toast.success((await reverseRun(clientId, r!.id, reason, date)).message);
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }} />
    </Drawer>
  );
}