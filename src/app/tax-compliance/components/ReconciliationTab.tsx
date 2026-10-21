'use client';

// Tab Reconciliation (Template UI/Tax Compliance/7.jpeg): Tax Ledger vs GL per
// jenis pajak, analisis selisih, saran perbaikan, simpan snapshot rekonsiliasi.

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Coins, Download, FileText, Loader2, Play, Settings2 } from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchRecon, runRecon, useTaxData, type ReconData, type ReconRow } from '@/lib/taxComplianceStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, btnSmall, Card, EmptyRow, inputCls, Menu, MenuItem } from '@/components/arap/arapUi';
import { Delta, KpiGrid, tdCls } from '@/components/shared/moduleUi';
import { DotPill } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

const FILING = { filed: { label: 'Filed', style: 'bg-emerald-50 text-emerald-700' }, partial: { label: 'Partially Filed', style: 'bg-amber-50 text-amber-700' },
  not_filed: { label: 'Not Filed', style: 'bg-amber-50 text-amber-700' }, not_required: { label: 'Not Required', style: 'bg-slate-100 text-slate-500' } };

export const RECON_COLUMNS = [
  { header: 'Tax Type', value: (r: ReconRow) => r.label }, { header: 'Tax Ledger Amount', value: (r: ReconRow) => r.ledger_amount, type: 'money' as const },
  { header: 'GL Amount', value: (r: ReconRow) => r.gl_amount, type: 'money' as const }, { header: 'Difference', value: (r: ReconRow) => r.difference, type: 'money' as const },
  { header: 'Payment Amount', value: (r: ReconRow) => r.payment_amount, type: 'money' as const }, { header: 'Filing Status', value: (r: ReconRow) => FILING[r.filing_status].label },
  { header: 'Reconciliation Status', value: (r: ReconRow) => (r.status === 'reconciled' ? 'Reconciled' : 'Difference') },
];

export default function ReconciliationTab({ clientId, clientName, range, openSettings }: TaxTabProps) {
  const rc = useTaxData<ReconData | null>(`trc:${clientId}:${range.date_from}:${range.date_to}`, s => fetchRecon(clientId, range, s), null);
  const [status, setStatus] = useState<'' | 'reconciled' | 'difference'>('');
  const [busy, setBusy] = useState(false);
  const d = rc.data;
  const k = d?.kpi, p = d?.previous;
  const rows = (d?.rows ?? []).filter(r => !status || r.status === status);

  const jalankan = async () => {
    setBusy(true);
    try { const r = await runRecon(clientId, range); toast.success(`${r.message} ${r.data.difference_count} difference(s).`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable(f, { title: 'Tax Ledger vs General Ledger Reconciliation', clientName, subtitle: `${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}`,
        columns: RECON_COLUMNS, rows, fileName: `Tax-Reconciliation-${range.date_from}-${range.date_to}`, orientation: 'landscape' });
    } catch (e) { toast.error((e as Error).message || 'Export failed.'); }
  };

  return (
    <div className="space-y-5">
      {rc.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{rc.error}</div>}
      {d && !d.mapping_saved && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 sm:flex-row sm:items-center sm:justify-between">
          <span>GL amounts use tax accounts detected automatically from the chart of accounts. Review and save the mapping for an exact reconciliation.</span>
          <button type="button" onClick={openSettings} className="inline-flex items-center gap-1 font-semibold underline hover:no-underline"><Settings2 size={14} /> Tax Accounts</button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="w-56"><span className="mb-1 block text-xs font-medium">Reconciliation Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as '' | 'reconciled' | 'difference')} className={inputCls}>
            <option value="">All Statuses</option><option value="reconciled">Reconciled</option><option value="difference">Difference</option></select></label>
        <button type="button" onClick={jalankan} disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run Reconciliation</button>
      </div>

      <KpiGrid cols={5} loading={rc.loading && !d} cards={[
        { label: 'Reconciled Amount', value: rupiah(k?.reconciled_amount), icon: Coins, tone: 'green', delta: <Delta now={k?.reconciled_amount} prev={p?.reconciled_amount} suffix="vs previous period" /> },
        { label: 'Unreconciled Amount', value: rupiah(k?.unreconciled_amount), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.unreconciled_amount} prev={p?.unreconciled_amount} goodWhenDown suffix="vs previous period" /> },
        { label: 'Matched Tax Items', value: String(k?.matched_items ?? 0), icon: FileText, tone: 'green', delta: <Delta now={k?.matched_items} prev={p?.matched_items} suffix="vs previous period" /> },
        { label: 'Difference Count', value: String(k?.difference_count ?? 0), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.difference_count} prev={p?.difference_count} goodWhenDown unit="abs" suffix="vs previous period" /> },
        { label: 'Last Reconciliation Date', value: d?.last_run ? fmtDate(d.last_run.run_at) : '—', icon: Clock, tone: 'blue',
          delta: <span className="text-[11px] text-muted-foreground">{d?.last_run ? `${fmtDateTime(d.last_run.run_at)} · ${d.last_run.run_by_name ?? ''}` : 'Not run yet'}</span> },
      ]} />

      <Card title="Tax Ledger vs General Ledger Reconciliation" action={
        <Menu width="w-40" button={open => <button type="button" className={btnPrimary}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
          {close => <><MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem><MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem><MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem></>}
        </Menu>
      }>
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[960px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-medium">Tax Type</th>
              {['Tax Ledger Amount', 'GL Amount', 'Difference', 'Payment Amount'].map(h => <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>)}
              <th className="px-3 py-2.5 text-left font-medium">Filing Status</th><th className="px-3 py-2.5 text-left font-medium">Reconciliation Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(rc.loading && !d) || !rows.length ? <EmptyRow cols={7} loading={rc.loading && !d} text="No tax amounts in the ledger or GL for this period." /> : rows.map(r => (
                <tr key={r.tax_type}>
                  <td className={`${tdCls} font-medium`}>{r.label}</td><td className={`${tdCls} text-right`}>{rupiah(r.ledger_amount)}</td><td className={`${tdCls} text-right`}>{rupiah(r.gl_amount)}</td>
                  <td className={`${tdCls} text-right font-medium ${Math.abs(r.difference) >= 1 ? 'text-rose-600' : 'text-emerald-700'}`}>{rupiah(r.difference)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(r.payment_amount)}</td>
                  <td className={tdCls}><DotPill {...FILING[r.filing_status]} /></td>
                  <td className={tdCls}>{r.status === 'reconciled'
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={12} /> Reconciled</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle size={12} /> Difference</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Difference Analysis">
          <div className="h-64 px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d?.rows ?? []} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={v => rupiahShort(v)} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={60} />
                <Tooltip formatter={(v: number) => rupiah(v)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ledger_amount" name="Tax Ledger Amount" fill="#0B5E5C" radius={[3, 3, 0, 0]} />
                <Bar dataKey="gl_amount" name="GL Amount" fill="#A7F3D0" radius={[3, 3, 0, 0]} />
                <Bar dataKey="difference" name="Difference" fill="#F43F5E" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Recommended Fixes">
          <div className="space-y-2 px-5 pb-5">
            {!d?.fixes.length && <p className="py-6 text-center text-xs text-muted-foreground">Nothing to fix — every tax type is reconciled.</p>}
            {d?.fixes.map(f => (
              <div key={f.tax_type} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                <AlertTriangle size={18} className={f.severity === 'high' ? 'text-rose-600' : 'text-amber-500'} />
                <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{f.title}</p><p className="text-[11px] text-muted-foreground">{f.detail}</p></div>
                <span className={`text-xs font-semibold ${f.severity === 'high' ? 'text-rose-600' : 'text-amber-600'}`}>{rupiah(f.amount)}</span>
                {f.action === 'create_je'
                  ? <Link href="/transactions/journal-entry" className={btnSmall}>Create JE</Link>
                  : <button type="button" onClick={openSettings} className={btnSmall}>Review</button>}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="text-[11px] text-muted-foreground">GL amount = tax recognised on the mapped tax accounts (credit side of payables, debit side of input VAT / prepaid tax), net of reversals; tax payments are excluded. <button type="button" onClick={openSettings} className={`${btnOutline} ml-1 px-2 py-0.5 text-[11px]`}>Tax Accounts</button></p>
    </div>
  );
}
