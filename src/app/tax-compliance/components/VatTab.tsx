'use client';

// Tab VAT (Template UI/Tax Compliance/5.jpeg): KPI, PPN Keluaran (Sales) & PPN
// Masukan (Purchases) dengan status match e-Faktur, tren bulanan, VAT ledger vs GL.

import React, { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, FileText, Link2, Scale } from 'lucide-react';
import { fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchVat, REPORTING_STYLE, useTaxData, type LedgerRow, type ReportingStatus, type VatData } from '@/lib/taxComplianceStore';
import { Card, inputCls } from '@/components/arap/arapUi';
import { Delta, KpiGrid } from '@/components/shared/moduleUi';
import { LedgerTable } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

export default function VatTab({ clientId, range, goTab }: TaxTabProps) {
  const vd = useTaxData<VatData | null>(`tvat:${clientId}:${range.date_from}:${range.date_to}`, s => fetchVat(clientId, range, s), null);
  const [jenis, setJenis] = useState<'' | 'output' | 'input'>('');
  const [match, setMatch] = useState<'' | 'matched' | 'unmatched'>('');
  const [lapor, setLapor] = useState<'' | ReportingStatus>('');
  const d = vd.data;
  const k = d?.kpi, p = d?.previous;
  const saring = useMemo(() => (rs: LedgerRow[]) => rs.filter(r => (!match || r.match_status === match) && (!lapor || r.reporting_status === lapor)), [match, lapor]);
  const g = d?.vs_gl;

  return (
    <div className="space-y-5">
      {vd.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{vd.error}</div>}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3">
        <label><span className="mb-1 block text-xs font-medium">VAT Type</span>
          <select value={jenis} onChange={e => setJenis(e.target.value as '' | 'output' | 'input')} className={inputCls}>
            <option value="">All VAT Types</option><option value="output">VAT Output</option><option value="input">VAT Input</option></select></label>
        <label><span className="mb-1 block text-xs font-medium">e-Faktur Status</span>
          <select value={match} onChange={e => setMatch(e.target.value as '' | 'matched' | 'unmatched')} className={inputCls}>
            <option value="">All Statuses</option><option value="matched">Matched</option><option value="unmatched">Unmatched</option></select></label>
        <label><span className="mb-1 block text-xs font-medium">Filing Status</span>
          <select value={lapor} onChange={e => setLapor(e.target.value as '' | ReportingStatus)} className={inputCls}>
            <option value="">All Statuses</option>{(['reported', 'unreported'] as ReportingStatus[]).map(s => <option key={s} value={s}>{REPORTING_STYLE[s].label}</option>)}</select></label>
      </div>

      <KpiGrid cols={6} loading={vd.loading && !d} cards={[
        { label: 'Output VAT', value: rupiah(k?.output), icon: FileText, tone: 'green', delta: <Delta now={k?.output} prev={p?.output} suffix="vs previous period" /> },
        { label: 'Input VAT', value: rupiah(k?.input), icon: FileText, tone: 'green', delta: <Delta now={k?.input} prev={p?.input} suffix="vs previous period" /> },
        { label: 'Net VAT Position', value: rupiah(k?.net), icon: Scale, tone: 'green', delta: <Delta now={k?.net} prev={p?.net} suffix="vs previous period" /> },
        { label: 'e-Faktur Matched', value: String(k?.matched ?? 0), icon: Link2, tone: 'green',
          delta: <span className="text-[11px] text-muted-foreground">{k?.total ? Math.round((k.matched / k.total) * 100) : 0}% of total</span> },
        { label: 'Unmatched VAT', value: String(k?.unmatched ?? 0), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.unmatched} prev={p?.unmatched} goodWhenDown suffix="vs previous period" /> },
        { label: 'Draft Returns', value: String(k?.draft_returns ?? 0), icon: FileText, tone: 'blue', delta: <span className="text-[11px] text-muted-foreground">SPT Masa PPN not filed</span> },
      ]} />

      {jenis !== 'input' && (
        <Card title="VAT Output (Sales)" action={<button type="button" onClick={() => goTab('ledger')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View All →</button>}>
          <LedgerTable clientId={clientId} rows={saring(d?.output ?? [])} loading={vd.loading && !d} docLabel="e-Faktur Number"
            kolom={['date', 'doc', 'party', 'dpp', 'rate', 'amount', 'taxdoc', 'match', 'rep']} empty="No VAT output in this period." />
        </Card>
      )}
      {jenis !== 'output' && (
        <Card title="VAT Input (Purchases)" action={<button type="button" onClick={() => goTab('ledger')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View All →</button>}>
          <LedgerTable clientId={clientId} rows={saring(d?.input ?? [])} loading={vd.loading && !d} docLabel="e-Faktur Number"
            kolom={['date', 'doc', 'party', 'dpp', 'rate', 'amount', 'taxdoc', 'match', 'rep']} empty="No VAT input in this period." />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Monthly VAT Trend">
          <div className="h-64 px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d?.trend ?? []} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tickFormatter={m => fmtMonth(m)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => rupiahShort(v)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="output" name="Output VAT" fill="#0B5E5C" radius={[3, 3, 0, 0]} />
                <Bar dataKey="input" name="Input VAT" fill="#A7F3D0" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="net" name="Net VAT Position" stroke="#0F7D4E" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="VAT Ledger vs General Ledger" action={<button type="button" onClick={() => goTab('reconciliation')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View Details →</button>}>
          <div className="px-5 pb-5 text-sm">
            <table className="w-full">
              <thead><tr className="text-xs text-muted-foreground"><th /><th className="py-1 text-right font-medium">VAT Ledger</th><th className="py-1 text-right font-medium">General Ledger</th></tr></thead>
              <tbody>
                <tr><td className="py-1.5 text-muted-foreground">Output VAT</td><td className="text-right">{rupiah(g?.ledger_output)}</td><td className="text-right">{rupiah(g?.gl_output)}</td></tr>
                <tr><td className="py-1.5 text-muted-foreground">Input VAT</td><td className="text-right">{rupiah(g?.ledger_input)}</td><td className="text-right">{rupiah(g?.gl_input)}</td></tr>
                <tr className="border-t border-border font-semibold"><td className="py-1.5">Net VAT Position</td><td className="text-right text-[#0F7D4E]">{rupiah(g?.ledger_net)}</td><td className="text-right text-[#0F7D4E]">{rupiah(g?.gl_net)}</td></tr>
              </tbody>
            </table>
            {g && (Math.abs(g.difference) < 1 ? (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 size={16} /> Reconciled — VAT ledger is in sync with the General Ledger.</p>
            ) : (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700"><AlertTriangle size={16} /> Difference {rupiah(g.difference)} — check the VAT account mapping or the posting accounts.</p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
