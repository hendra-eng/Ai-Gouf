'use client';

// Tab Depreciation (Template UI/Fix Assets/4.jpeg): KPI, tren penyusutan
// bulanan, run berikutnya, daftar batch (approve / post / reverse), dan aset
// yang perlu direview sebelum bisa disusutkan.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarDays, Coins, FileText, Hourglass, Loader2, MoreHorizontal, Play } from 'lucide-react';
import { fmtDate, fmtDateTime, fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import {
  deleteRun, fetchDepreciation, fetchRun, METHOD_LABEL, reverseRun, runAction, useFaData, type DepRun, type DepreciationSummary,
} from '@/lib/fixedAssetsStore';
import { btnPrimary, btnSmall, Card, Drawer, EmptyRow, Field } from '@/components/arap/arapUi';
import { Delta, KpiGrid, Pill, ReasonDialog, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

const bulanPanjang = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });

export function approvalPill(s: DepRun['status']) {
  if (s === 'draft') return <Pill label="Draft" style="bg-slate-100 text-slate-600" />;
  if (s === 'reversed') return <Pill label="Reversed" style="bg-rose-50 text-rose-700" />;
  return <Pill label="Approved" style="bg-emerald-50 text-emerald-700" />;
}
export function postingPill(s: DepRun['status']) {
  if (s === 'posted') return <Pill label="Posted" style="bg-emerald-50 text-emerald-700" />;
  if (s === 'reversed') return <Pill label="Reversed" style="bg-rose-50 text-rose-700" />;
  return <Pill label="Unposted" style="bg-amber-50 text-amber-700" />;
}

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
      <KpiGrid loading={loading} cards={[
        { label: 'Current Month Depreciation', value: rupiah(k?.current_month), icon: Coins, tone: 'green',
          delta: <Delta now={k?.current_month} prev={k?.previous_month} suffix="vs. previous month" /> },
        { label: 'YTD Depreciation', value: rupiah(k?.ytd), icon: BarChart3, tone: 'green', delta: <Delta now={k?.ytd} prev={k?.ytd_prev} suffix="vs. previous year" /> },
        { label: 'Pending Depreciation Batches', value: String(k?.pending_batches ?? 0), icon: Hourglass, tone: 'amber',
          delta: <span className="text-[11px] text-muted-foreground">{k?.pending_batches ? 'Waiting for approval / posting' : 'Nothing pending'}</span> },
        { label: 'Posted Depreciation Entries', value: String(k?.posted_entries_ytd ?? 0), icon: FileText, tone: 'blue',
          delta: <Delta now={k?.posted_entries_ytd} prev={k?.posted_entries_prev_ytd} suffix="vs. previous year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Monthly Depreciation Trend" subtitle="Posted depreciation, last 12 months">
          <div className="h-64 px-3 pb-4">
            {loading ? <div className="h-full animate-pulse rounded-xl bg-slate-50" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d?.trend ?? []} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={m => fmtMonth(m).slice(0, 3)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                  <Line type="monotone" dataKey="amount" name="Depreciation" stroke="#0F7D4E" strokeWidth={2.5} dot={{ r: 3, fill: '#0F7D4E' }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2" title={<span className="flex items-center gap-2"><CalendarDays size={18} className="text-[#0F7D4E]" /> Next Depreciation Run</span>}>
          {loading || !nr ? <div className="mx-5 mb-5 h-40 animate-pulse rounded-xl bg-slate-50" /> : (
            <div className="space-y-3 px-5 pb-5 text-sm">
              <dl className="grid grid-cols-2 gap-y-2.5">
                <dt className="text-muted-foreground">Period</dt><dd className="font-semibold">{bulanPanjang(nr.period)}</dd>
                <dt className="text-muted-foreground">Depreciation Method</dt><dd className="font-semibold">{nr.methods.length ? nr.methods.map(m => METHOD_LABEL[m]).join(', ') : '—'}</dd>
                <dt className="text-muted-foreground">Eligible Assets</dt><dd className="font-semibold">{nr.eligible_assets}</dd>
                <dt className="text-muted-foreground">Estimated Depreciation Amount</dt><dd className="font-semibold">{rupiah(nr.estimated_amount)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{nr.status === 'ready' ? <Pill label="Ready to Run" style="bg-sky-50 text-sky-700" />
                  : nr.status === 'exists' ? <Pill label="Batch Created" style="bg-emerald-50 text-emerald-700" />
                    : <Pill label="Nothing to Run" style="bg-slate-100 text-slate-600" />}</dd>
              </dl>
              {nr.issues > 0 && <p className="text-xs text-amber-700">{nr.issues} asset(s) skipped — see Assets Pending Depreciation Review.</p>}
              {nr.status === 'exists' && nr.existing_run_id ? (
                <button type="button" onClick={() => setRunId(nr.existing_run_id)} className={`${btnPrimary} w-full`}>Open Batch for {bulanPanjang(nr.period)}</button>
              ) : (
                <button type="button" disabled={nr.status !== 'ready'} onClick={actions.runDepreciation} className={`${btnPrimary} w-full`}>
                  <Play size={15} /> Run Depreciation for {bulanPanjang(nr.period)}
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Depreciation Schedule / Batch List">
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className={tableHeadRow}>
                <th className={thCls}>Period</th><th className={thCls}>Batch No.</th><th className={`${thCls} text-right`}>Assets Included</th>
                <th className={`${thCls} text-right`}>Depreciation Amount</th><th className={thCls}>Prepared By</th>
                <th className={thCls}>Approval Status</th><th className={thCls}>Posting Status</th><th className="w-10" />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(loading || !d?.runs.length) && <EmptyRow cols={8} loading={loading} text="No depreciation batches yet." />}
                {d?.runs.map(r => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setRunId(r.id)}>
                    <td className={tdCls}>{fmtMonth(r.period.slice(0, 7))}</td>
                    <td className={`${tdCls} font-medium`}>{r.run_no}</td>
                    <td className={`${tdCls} text-right`}>{r.asset_count}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(r.total_amount)}</td>
                    <td className={tdCls}>{r.prepared_by_name ?? '—'}</td>
                    <td className={tdCls}>{approvalPill(r.status)}</td>
                    <td className={tdCls}>{postingPill(r.status)}</td>
                    <td className={tdCls}><MoreHorizontal size={16} className="text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Assets Pending Depreciation Review" subtitle="Fix these so they are included in the next run">
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-sm">
              <thead><tr className={tableHeadRow}>
                <th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th><th className={`${thCls} text-right`}>Book Value</th><th className={thCls}>Issue</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(loading || !d?.review.length) && <EmptyRow cols={4} loading={loading} text="All active assets are ready for depreciation." />}
                {d?.review.map(r => (
                  <tr key={r.asset_id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.openAsset(r.asset_id)}>
                    <td className={`${tdCls} font-medium`}>{r.asset_code}</td>
                    <td className={tdCls}>{r.name}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(r.nbv)}</td>
                    <td className={tdCls}><div className="flex flex-wrap gap-1">{r.issues.map(i => <Pill key={i} label={i} style="bg-rose-50 text-rose-600" />)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1.5">Asset</th><th className="py-1.5 text-right">Accum. Before</th><th className="py-1.5 text-right">Depreciation</th><th className="py-1.5 text-right">NBV After</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {r.lines?.map(l => (
              <tr key={l.asset_id}>
                <td className="py-1.5 pr-2"><span className="font-medium">{l.asset_code}</span> · {l.name}
                  <span className="block text-[10px] text-muted-foreground">{METHOD_LABEL[l.method]} · Dr {l.expense_account} / Cr {l.accum_account}</span></td>
                <td className="py-1.5 text-right">{rupiah(l.accumulated_before)}</td>
                <td className="py-1.5 text-right font-medium">{rupiah(l.amount)}</td>
                <td className="py-1.5 text-right">{rupiah(l.nbv_after)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border font-semibold"><td className="py-1.5">Total</td><td /><td className="py-1.5 text-right">{rupiah(r.total_amount)}</td><td /></tr></tfoot>
        </table>
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

