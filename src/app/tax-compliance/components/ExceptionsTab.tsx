'use client';

// Tab Exceptions (Template UI/Tax Compliance/1.jpeg): filter, 6 KPI, daftar
// temuan (assign / ubah status), insight, eksposur per jenis, aging.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Coins, Download, Lightbulb, Loader2, MoreHorizontal, Plus, ShieldAlert, Sparkles, XOctagon } from 'lucide-react';
import { fmtDate, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import {
  addException, EXC_STATUS, fetchExceptions, SEVERITY_STYLE, TAX_COLORS, TAX_LABEL, updateException, useTaxData,
  type ExceptionsData, type ExcStatus, type Severity, type TaxException, type TaxType,
} from '@/lib/taxComplianceStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, Card, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Delta, FormField, KpiGrid, Modal, tdCls } from '@/components/shared/moduleUi';
import { angka, DotPill, SeverityPill } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

const inisial = (s: string | null) => (s ? s.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() : '—');

export default function ExceptionsTab({ clientId, clientName, range }: TaxTabProps) {
  const ex = useTaxData<ExceptionsData | null>(`tex:${clientId}:${range.date_from}:${range.date_to}`, s => fetchExceptions(clientId, range, s), null);
  const [sev, setSev] = useState<'' | Severity>('');
  const [jenis, setJenis] = useState<'' | TaxType>('');
  const [status, setStatus] = useState<'' | ExcStatus | 'active'>('active');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [buka, setBuka] = useState<TaxException | null>(null);
  const [baru, setBaru] = useState(false);
  const d = ex.data;
  const k = d?.kpi, p = d?.previous;
  const rows = useMemo(() => (d?.rows ?? []).filter(e => (!sev || e.severity === sev) && (!jenis || e.tax_type === jenis)
    && (!status || (status === 'active' ? ['open', 'in_review', 'on_hold'].includes(e.status) : e.status === status))), [d, sev, jenis, status]);
  const totalEks = d?.exposure_by_type.reduce((n, x) => n + x.amount, 0) ?? 0;
  const aging = d ? [{ b: '0 - 7 days', n: d.aging['0_7'], c: '#86EFAC' }, { b: '8 - 30 days', n: d.aging['8_30'], c: '#FCD34D' },
    { b: '31 - 60 days', n: d.aging['31_60'], c: '#FB923C' }, { b: '> 60 days', n: d.aging['60_plus'], c: '#F43F5E' }] : [];

  const ubah = async (e: TaxException, body: Record<string, unknown>) => {
    try { toast.success((await updateException(clientId, e.id, body)).message); } catch (err) { toast.error((err as Error).message); }
  };
  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable<TaxException>(f, { title: 'Tax Exceptions', clientName, subtitle: `${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}`, rows,
        fileName: `Tax-Exceptions-${range.date_from}-${range.date_to}`, orientation: 'landscape', columns: [
          { header: 'Issue ID', value: e => e.exception_no }, { header: 'Source Document', value: e => e.source_document }, { header: 'Counterparty', value: e => e.party_name },
          { header: 'Tax Type', value: e => e.tax_type_label }, { header: 'Exception Reason', value: e => e.reason }, { header: 'DPP', value: e => e.dpp, type: 'money' },
          { header: 'Potential Tax', value: e => e.potential_tax, type: 'money' }, { header: 'Severity', value: e => SEVERITY_STYLE[e.severity].label },
          { header: 'Assigned To', value: e => e.assigned_to }, { header: 'Status', value: e => EXC_STATUS[e.status].label },
        ] });
    } catch (e) { toast.error((e as Error).message || 'Export failed.'); }
  };

  return (
    <div className="space-y-5">
      {ex.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ex.error}</div>}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-12 md:items-end">
        <label className="md:col-span-3"><span className="mb-1 block text-xs font-medium">Severity</span>
          <select value={sev} onChange={e => { setSev(e.target.value as Severity | ''); setPage(0); }} className={inputCls}>
            <option value="">All Severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className="md:col-span-3"><span className="mb-1 block text-xs font-medium">Tax Type</span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as TaxType | ''); setPage(0); }} className={inputCls}>
            <option value="">All Tax Types</option>{(Object.keys(TAX_LABEL) as TaxType[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}</select></label>
        <label className="md:col-span-3"><span className="mb-1 block text-xs font-medium">Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value as ExcStatus | '' | 'active'); setPage(0); }} className={inputCls}>
            <option value="active">Unresolved</option><option value="">All Status</option>{(Object.keys(EXC_STATUS) as ExcStatus[]).map(s => <option key={s} value={s}>{EXC_STATUS[s].label}</option>)}</select></label>
        <div className="flex gap-2 md:col-span-3 md:justify-end">
          <button type="button" onClick={() => { setSev(''); setJenis(''); setStatus('active'); }} className={btnOutline}>Reset</button>
          <button type="button" onClick={() => setBaru(true)} className={btnPrimary}><Plus size={15} /> Add Exception</button>
        </div>
      </div>

      <KpiGrid cols={6} loading={ex.loading && !d} cards={[
        { label: 'Total Exceptions', value: String(k?.total ?? 0), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.total} prev={p?.total} goodWhenDown suffix="vs previous period" /> },
        { label: 'High Risk', value: String(k?.high ?? 0), icon: XOctagon, tone: 'red', delta: <Delta now={k?.high} prev={p?.high} goodWhenDown suffix="vs previous period" /> },
        { label: 'Medium Risk', value: String(k?.medium ?? 0), icon: ShieldAlert, tone: 'amber', delta: <Delta now={k?.medium} prev={p?.medium} goodWhenDown suffix="vs previous period" /> },
        { label: 'Overdue Review', value: String(k?.overdue_review ?? 0), icon: Clock, tone: 'red', delta: <span className="text-[11px] text-muted-foreground">Open more than 7 days</span> },
        { label: 'Resolved This Month', value: String(k?.resolved_month ?? 0), icon: CheckCircle2, tone: 'green', delta: <Delta now={k?.resolved_month} prev={p?.resolved_month} suffix="vs previous period" /> },
        { label: 'Estimated Exposure', value: rupiah(k?.exposure), icon: Coins, tone: 'green', delta: <Delta now={k?.exposure} prev={p?.exposure} goodWhenDown suffix="vs previous period" /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3" title="Tax Exceptions" subtitle="Issues detected from transactions, e-Faktur, e-Bupot, payments, filings and reconciliation that require review." action={
          <Menu width="w-40" button={open => <button type="button" className={btnPrimary}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => <><MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem><MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem><MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem></>}
          </Menu>
        }>
          <div className="overflow-x-auto px-2">
            <table className="w-full min-w-[1000px] text-sm">
              <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
                {['Issue ID', 'Source Document', 'Counterparty', 'Tax Type', 'Exception Reason'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
                {['DPP', 'Potential Tax'].map(h => <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>)}
                {['Severity', 'Assigned', 'Status'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}<th className="w-10" />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(ex.loading && !d) || !rows.length ? <EmptyRow cols={11} loading={ex.loading && !d} text="No exceptions. Click Sync Transactions to run the checks again." /> :
                  rows.slice(page * pageSize, (page + 1) * pageSize).map(e => (
                    <tr key={e.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => setBuka(e)}>
                      <td className={`${tdCls} whitespace-nowrap font-medium`}>{e.exception_no}</td><td className={tdCls}>{e.source_document ?? '—'}</td>
                      <td className={tdCls}>{e.party_name ?? '—'}</td><td className={tdCls}>{e.tax_type_label}</td>
                      <td className={`${tdCls} max-w-[260px]`}>{e.reason}</td><td className={`${tdCls} text-right`}>{angka(e.dpp)}</td>
                      <td className={`${tdCls} text-right`}>{angka(e.potential_tax)}</td><td className={tdCls}><SeverityPill s={e.severity} /></td>
                      <td className={tdCls}><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold" title={e.assigned_to ?? 'Unassigned'}>{inisial(e.assigned_to)}</span></td>
                      <td className={tdCls}><DotPill {...EXC_STATUS[e.status]} /></td>
                      <td className={tdCls} onClick={x => x.stopPropagation()}>
                        <Menu width="w-44" button={() => <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
                          {close => (<>
                            {(['in_review', 'on_hold', 'resolved', 'dismissed', 'open'] as ExcStatus[]).filter(s => s !== e.status).map(s => (
                              <MenuItem key={s} onClick={() => { close(); ubah(e, { status: s }); }}>Mark {EXC_STATUS[s].label}</MenuItem>
                            ))}
                            <MenuItem onClick={() => { close(); setBuka(e); }}>Assign / details</MenuItem>
                          </>)}
                        </Menu>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <NumberPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="exceptions" />
        </Card>

        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2">Insights <span className="rounded-md bg-violet-50 px-1.5 text-[10px] font-bold text-violet-700">RULES</span></span>}>
            <div className="space-y-2 px-4 pb-4">
              {!d?.insights.length && <p className="text-xs text-muted-foreground">No insights — nothing unusual in this period.</p>}
              {d?.insights.map((i, n) => (
                <div key={n} className={`flex gap-2 rounded-xl px-3 py-2 text-xs ${i.level === 'info' ? 'bg-emerald-50 text-emerald-900' : 'border border-border'}`}>
                  {i.level === 'info' ? <Sparkles size={15} className="shrink-0 text-emerald-600" /> : i.level === 'tip' ? <Lightbulb size={15} className="shrink-0 text-emerald-600" />
                    : <AlertTriangle size={15} className={`shrink-0 ${i.level === 'high' ? 'text-rose-600' : 'text-amber-500'}`} />}
                  <span>{i.text}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Potential Tax Exposure by Tax Type">
            <div className="flex items-center gap-3 px-4 pb-4">
              <div className="relative h-28 w-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%"><PieChart>
                  <Pie data={d?.exposure_by_type ?? []} dataKey="amount" nameKey="label" innerRadius={34} outerRadius={52} stroke="none">
                    {(d?.exposure_by_type ?? []).map(x => <Cell key={x.tax_type} fill={TAX_COLORS[x.tax_type] ?? '#94A3B8'} />)}</Pie>
                  <Tooltip formatter={(v: number) => rupiah(v)} /></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><b className="text-[11px]">{rupiahShort(totalEks)}</b><span className="text-[9px] text-muted-foreground">Total</span></div>
              </div>
              <ul className="w-full space-y-1 text-[11px]">
                {d?.exposure_by_type.map(x => (
                  <li key={x.tax_type} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: TAX_COLORS[x.tax_type] ?? '#94A3B8' }} />
                    <span className="flex-1 truncate">{x.label}</span><span>{totalEks ? Math.round((x.amount / totalEks) * 100) : 0}%</span></li>
                ))}
              </ul>
            </div>
          </Card>
          <Card title="Aging of Unresolved Exceptions">
            <div className="h-36 px-2 pb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aging} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="b" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip /><Bar dataKey="n" name="Exceptions" radius={[3, 3, 0, 0]}>
                    {aging.map(a => <Cell key={a.b} fill={a.c} />)}<LabelList dataKey="n" position="top" style={{ fontSize: 11, fontWeight: 700 }} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
      {buka && <ExceptionModal clientId={clientId} e={buka} onClose={() => setBuka(null)} />}
      {baru && <NewExceptionModal clientId={clientId} onClose={() => setBaru(false)} />}
    </div>
  );
}

function ExceptionModal({ clientId, e, onClose }: { clientId: string; e: TaxException; onClose: () => void }) {
  const [v, setV] = useState({ status: e.status, severity: e.severity, assigned_to: e.assigned_to ?? '', resolution_note: e.resolution_note ?? '' });
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    setBusy(true);
    try { toast.success((await updateException(clientId, e.id, v)).message); onClose(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-lg" title={`${e.exception_no} · ${e.tax_type_label}`} subtitle={e.reason}
      footer={<><button type="button" onClick={onClose} className={btnOutline}>Close</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button></>}>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
        <span>Source: <b>{e.source_document ?? '—'}</b></span><span>Counterparty: <b>{e.party_name ?? '—'}</b></span>
        <span>DPP: <b>{angka(e.dpp)}</b></span><span>Potential tax: <b>{angka(e.potential_tax)}</b></span>
        <span>Detected: <b>{fmtDate(e.detected_at)}</b> ({e.age_days} days)</span><span>{e.is_auto ? 'Detected automatically' : 'Recorded manually'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Status"><select value={v.status} onChange={x => setV({ ...v, status: x.target.value as ExcStatus })} className={inputCls}>
          {(Object.keys(EXC_STATUS) as ExcStatus[]).map(s => <option key={s} value={s}>{EXC_STATUS[s].label}</option>)}</select></FormField>
        <FormField label="Severity"><select value={v.severity} onChange={x => setV({ ...v, severity: x.target.value as Severity })} className={inputCls}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></FormField>
      </div>
      <FormField label="Assigned To"><input value={v.assigned_to} onChange={x => setV({ ...v, assigned_to: x.target.value })} className={inputCls} placeholder="Name or initials" /></FormField>
      <FormField label="Resolution Note"><textarea rows={3} value={v.resolution_note} onChange={x => setV({ ...v, resolution_note: x.target.value })} className={inputCls} /></FormField>
      {e.is_auto && <p className="text-[11px] text-muted-foreground">Automatic exceptions are re-checked on every sync: they close themselves when the condition is fixed (e.g. e-Faktur number filled, tax paid, return filed).</p>}
    </Modal>
  );
}

function NewExceptionModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [v, setV] = useState({ reason: '', tax_type: '' as '' | TaxType, tax_period: '', source_document: '', party_name: '', potential_tax: '', severity: 'medium' as Severity, assigned_to: '' });
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    setBusy(true);
    try {
      toast.success((await addException(clientId, { ...v, tax_type: v.tax_type || null, tax_period: v.tax_period ? `${v.tax_period}-01` : null,
        potential_tax: Number(v.potential_tax || 0), source_document: v.source_document || null, party_name: v.party_name || null, assigned_to: v.assigned_to || null })).message);
      onClose();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-lg" title="Add Exception" footer={<><button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
      <button type="button" onClick={simpan} disabled={busy || v.reason.trim().length < 3} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button></>}>
      <FormField label="Reason" required><textarea rows={2} value={v.reason} onChange={x => setV({ ...v, reason: x.target.value })} className={inputCls} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Tax Type"><select value={v.tax_type} onChange={x => setV({ ...v, tax_type: x.target.value as TaxType | '' })} className={inputCls}>
          <option value="">—</option>{(Object.keys(TAX_LABEL) as TaxType[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}</select></FormField>
        <FormField label="Tax Period"><input type="month" value={v.tax_period} onChange={x => setV({ ...v, tax_period: x.target.value })} className={inputCls} /></FormField>
        <FormField label="Source Document"><input value={v.source_document} onChange={x => setV({ ...v, source_document: x.target.value })} className={inputCls} /></FormField>
        <FormField label="Counterparty"><input value={v.party_name} onChange={x => setV({ ...v, party_name: x.target.value })} className={inputCls} /></FormField>
        <FormField label="Potential Tax (IDR)"><input type="number" min={0} value={v.potential_tax} onChange={x => setV({ ...v, potential_tax: x.target.value })} className={inputCls} /></FormField>
        <FormField label="Severity"><select value={v.severity} onChange={x => setV({ ...v, severity: x.target.value as Severity })} className={inputCls}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></FormField>
      </div>
      <FormField label="Assigned To"><input value={v.assigned_to} onChange={x => setV({ ...v, assigned_to: x.target.value })} className={inputCls} /></FormField>
    </Modal>
  );
}
