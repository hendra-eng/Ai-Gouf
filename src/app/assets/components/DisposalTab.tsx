'use client';

// Tab Disposal (Template UI/Fix Assets/3.jpeg): KPI, antrean disposal,
// komposisi per alasan, dan daftar transaksi disposal dengan alur
// draft -> pending -> approved -> posted (-> reversed).

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { BarChart3, CircleCheck, Coins, FileText, Filter, Loader2, MoreHorizontal } from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteDisposal, disposalAction, disposalApproval, disposalPosting, DISPOSAL_METHOD_COLOR, DISPOSAL_METHOD_LABEL, fetchDisposal, fetchDisposals,
  rejectDisposal, reverseDisposal, useFaData, type Disposal, type DisposalStatus, type DisposalSummary,
} from '@/lib/fixedAssetsStore';
import { btnSmall, Card, Drawer, EmptyRow, Field, NumberPager } from '@/components/arap/arapUi';
import { Delta, JournalLines, KpiGrid, Pill, ReasonDialog, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

const uang = (n: number | null) => (n === null ? '—' : n < 0 ? `(${rupiah(-n)})` : rupiah(n));

export default function DisposalTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: FaActions }) {
  const ds = useFaData<DisposalSummary | null>(`dsp:${clientId}:${asOf}`, s => fetchDisposals(clientId, asOf, s), null);
  const [bukaId, setBukaId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'' | DisposalStatus>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const d = ds.data;
  const k = d?.kpi;
  const loading = ds.loading && !d;
  const daftar = useMemo(() => (d?.disposals ?? []).filter(x => !filter || x.status === filter), [d, filter]);
  const totalAlasan = d?.by_reason.reduce((n, r) => n + r.count, 0) ?? 0;

  return (
    <div className="space-y-5">
      {ds.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ds.error}</div>}
      <KpiGrid loading={loading} cards={[
        { label: 'Pending Disposals', value: String(k?.pending ?? 0), icon: FileText, tone: 'green',
          delta: <span className="text-[11px] text-muted-foreground">NBV {rupiah(k?.pending_value)}</span> },
        { label: 'Disposed This Year', value: String(k?.disposed_ytd ?? 0), icon: CircleCheck, tone: 'green',
          delta: <Delta now={k?.disposed_ytd} prev={k?.disposed_prev_ytd} suffix="vs. previous year" /> },
        { label: 'Disposal Proceeds', value: rupiah(k?.proceeds_ytd), icon: Coins, tone: 'blue',
          delta: <Delta now={k?.proceeds_ytd} prev={k?.proceeds_prev_ytd} suffix="vs. previous year" /> },
        { label: 'Gain / Loss on Disposal', value: uang(k?.gain_loss_ytd ?? 0), icon: BarChart3, tone: 'amber',
          delta: <Delta now={k?.gain_loss_ytd} prev={k?.gain_loss_prev_ytd} suffix="vs. previous year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={<span className="flex items-center gap-2">Disposal Queue <Pill label={`${d?.queue.length ?? 0} assets`} style="bg-emerald-50 text-emerald-700" /></span>}>
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className={tableHeadRow}>
                <th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th><th className={thCls}>Category</th>
                <th className={`${thCls} text-right`}>Net Book Value</th><th className={thCls}>Expected Disposal Date</th><th className={thCls}>Status</th><th className="w-10" />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(loading || !d?.queue.length) && <EmptyRow cols={7} loading={loading} text="No disposals waiting. Use “New Disposal” to start one." />}
                {d?.queue.slice(0, 8).map(x => (
                  <tr key={x.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setBukaId(x.id)}>
                    <td className={`${tdCls} font-medium`}>{x.asset_code}</td>
                    <td className={tdCls}>{x.asset_name}</td>
                    <td className={tdCls}>{x.category ?? '—'}</td>
                    <td className={`${tdCls} text-right`}>{uang(x.net_book_value)}</td>
                    <td className={tdCls}>{fmtDate(x.disposal_date)}</td>
                    <td className={tdCls}><Pill {...disposalApproval(x.status)} /></td>
                    <td className={tdCls}><MoreHorizontal size={16} className="text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Disposal by Reason" subtitle="Posted disposals this year">
          <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d?.by_reason ?? []} dataKey="count" nameKey="method" innerRadius={52} outerRadius={80} stroke="none">
                    {(d?.by_reason ?? []).map(r => <Cell key={r.method} fill={DISPOSAL_METHOD_COLOR[r.method]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [v, DISPOSAL_METHOD_LABEL[n as keyof typeof DISPOSAL_METHOD_LABEL] ?? n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold">{totalAlasan}</span><span className="text-[10px] text-muted-foreground">Disposed Assets</span>
              </div>
            </div>
            <ul className="w-full space-y-2 text-sm">
              {!d?.by_reason.length && <li className="text-xs text-muted-foreground">No posted disposals this year.</li>}
              {d?.by_reason.map(r => (
                <li key={r.method} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: DISPOSAL_METHOD_COLOR[r.method] }} />
                  <span className="flex-1">{DISPOSAL_METHOD_LABEL[r.method]}</span>
                  <span className="w-12 text-right text-muted-foreground">{totalAlasan ? Math.round((r.count / totalAlasan) * 100) : 0}%</span>
                  <span className="w-8 text-right font-semibold">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card title="Disposal Transactions" action={
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><Filter size={14} /> Filters
          <select value={filter} onChange={e => { setFilter(e.target.value as DisposalStatus | ''); setPage(0); }} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground">
            <option value="">All</option><option value="draft">Draft</option><option value="pending">Pending</option><option value="approved">Approved</option>
            <option value="rejected">Rejected</option><option value="posted">Posted</option><option value="reversed">Reversed</option>
          </select>
        </label>
      }>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Disposal No.</th><th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th><th className={thCls}>Category</th>
              <th className={thCls}>Method</th><th className={thCls}>Disposal Date</th><th className={`${thCls} text-right`}>Net Book Value</th>
              <th className={`${thCls} text-right`}>Sale Proceeds</th><th className={`${thCls} text-right`}>Gain / Loss</th>
              <th className={thCls}>Approval Status</th><th className={thCls}>Posting Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(loading || !daftar.length) && <EmptyRow cols={11} loading={loading} text="No disposal transactions." />}
              {daftar.slice(page * pageSize, (page + 1) * pageSize).map(x => (
                <tr key={x.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setBukaId(x.id)}>
                  <td className={`${tdCls} font-medium`}>{x.disposal_no}</td>
                  <td className={tdCls}>{x.asset_code}</td>
                  <td className={tdCls}>{x.asset_name}</td>
                  <td className={tdCls}>{x.category ?? '—'}</td>
                  <td className={tdCls}>{DISPOSAL_METHOD_LABEL[x.method]}</td>
                  <td className={tdCls}>{fmtDate(x.disposal_date)}</td>
                  <td className={`${tdCls} text-right`}>{uang(x.net_book_value)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(x.proceeds)}</td>
                  <td className={`${tdCls} text-right ${(x.gain_loss ?? 0) < 0 ? 'text-rose-600' : ''}`}>{uang(x.gain_loss)}</td>
                  <td className={tdCls}><Pill {...disposalApproval(x.status)} /></td>
                  <td className={tdCls}><Pill {...disposalPosting(x.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={daftar.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="disposals" />
      </Card>

      {bukaId && <DisposalDrawer clientId={clientId} id={bukaId} actions={actions} onClose={() => setBukaId(null)} />}
    </div>
  );
}

function DisposalDrawer({ clientId, id, actions, onClose }: { clientId: string; id: string; actions: FaActions; onClose: () => void }) {
  const dt = useFaData<Disposal | null>(`dspd:${clientId}:${id}`, s => fetchDisposal(clientId, id, s), null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'reject' | 'reverse'>(null);
  const x = dt.data;

  const jalan = async (label: string, fn: () => Promise<{ message: string }>, tutup = false) => {
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
    <button type="button" disabled={!!busy} onClick={() => jalan(label, fn, tutup)}
      className={utama ? `${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]` : btnSmall}>
      {busy === label && <Loader2 size={12} className="animate-spin" />} {label}
    </button>
  );
  const bisaUbah = x && ['draft', 'pending', 'rejected'].includes(x.status);

  return (
    <Drawer open onClose={onClose} title={x ? `${x.disposal_no} · ${x.asset_code}` : 'Loading...'} subtitle={x ? `${x.asset_name} · ${DISPOSAL_METHOD_LABEL[x.method]}` : undefined}
      footer={x && <>
        {bisaUbah && tombol('Delete', () => deleteDisposal(clientId, x.id), false, true)}
        {bisaUbah && <button type="button" className={btnSmall} onClick={() => { onClose(); actions.editDisposal(x); }}>Edit</button>}
        {(x.status === 'draft' || x.status === 'rejected') && tombol('Submit for Approval', () => disposalAction(clientId, x.id, 'submit'))}
        {(x.status === 'pending' || x.status === 'approved') && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setDialog('reject')}>Reject</button>}
        {x.status === 'pending' && tombol('Approve', () => disposalAction(clientId, x.id, 'approve'))}
        {(x.status === 'pending' || x.status === 'approved') && tombol('Post to Ledger', () => disposalAction(clientId, x.id, 'post'), true)}
        {x.status === 'posted' && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setDialog('reverse')}>Reverse</button>}
      </>}>
      {dt.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{dt.error}</p>}
      {!x ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <div className="flex flex-wrap gap-2"><Pill {...disposalApproval(x.status)} /><Pill {...disposalPosting(x.status)} /></div>
        {x.status === 'rejected' && x.rejected_reason && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Rejected: {x.rejected_reason}</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Disposal Date">{fmtDate(x.disposal_date)}</Field>
          <Field label="Method">{DISPOSAL_METHOD_LABEL[x.method]}</Field>
          <Field label="Buyer / Recipient">{x.counterparty ?? '—'}</Field>
          <Field label="Sale Proceeds">{rupiah(x.proceeds)}</Field>
          <Field label="Cost">{uang(x.cost)}</Field>
          <Field label="Accumulated Depreciation">{uang(x.accumulated)}</Field>
          <Field label="Net Book Value">{uang(x.net_book_value)}</Field>
          <Field label="Gain / Loss"><span className={(x.gain_loss ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}>{uang(x.gain_loss)}</span>
            {!x.values_final && <span className="ml-1 text-[10px] text-muted-foreground">(estimate)</span>}</Field>
          <Field label="Proceeds Account">{x.proceeds_account ? `${x.proceeds_account.code} · ${x.proceeds_account.name}` : '—'}</Field>
          <Field label="Gain / Loss Account">{x.gain_loss_account ? `${x.gain_loss_account.code} · ${x.gain_loss_account.name}` : '—'}</Field>
        </div>
        {x.reason && <Field label="Reason">{x.reason}</Field>}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">{x.journal?.posted ? `Journal ${x.journal.journal_no}` : 'Journal Preview'}</h4>
          {x.journal?.error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{x.journal.error}</p>
            : <JournalLines lines={x.journal?.lines ?? []} />}
          {!x.values_final && <p className="mt-1 text-[11px] text-muted-foreground">Values are calculated as of the disposal date and fixed when posted. Run depreciation up to the disposal month first.</p>}
        </div>
        {x.status === 'reversed' && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Reversed on {fmtDate(x.reversal_date)} by {x.reversed_by_name ?? '—'}. Reason: {x.reversal_reason}</p>}
        <div className="grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
          <span>Created: {fmtDateTime(x.created_at)} · {x.created_by_name ?? '—'}</span>
          <span>Approved: {fmtDateTime(x.approved_at)} · {x.approved_by_name ?? '—'}</span>
          <span>Posted: {fmtDateTime(x.posted_at)} · {x.posted_by_name ?? '—'}</span>
        </div>
      </>}
      <ReasonDialog open={dialog === 'reject'} title={`Reject ${x?.disposal_no ?? ''}`} confirmLabel="Reject" onClose={() => setDialog(null)}
        onConfirm={async reason => {
          try { toast.success((await rejectDisposal(clientId, x!.id, reason)).message); } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
      <ReasonDialog open={dialog === 'reverse'} title={`Reverse ${x?.disposal_no ?? ''}`} withDate minDate={x?.disposal_date} defaultDate={x?.disposal_date}
        subtitle="The disposal journal is reversed and the asset becomes active again." onClose={() => setDialog(null)}
        onConfirm={async (reason, date) => {
          try { toast.success((await reverseDisposal(clientId, x!.id, reason, date)).message); } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </Drawer>
  );
}
