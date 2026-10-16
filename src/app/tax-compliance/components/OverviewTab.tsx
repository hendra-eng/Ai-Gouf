'use client';

// Tab Overview (Template UI/Tax Compliance/8.jpeg): 8 KPI, ringkasan per jenis
// pajak, status bayar & lapor, tren pajak bulanan, potensi eksposur.

import React from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ChevronRight, Clock, Coins, CreditCard, FileText, ReceiptText, ShieldAlert } from 'lucide-react';
import { fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchTaxOverview, useTaxData, type TaxOverview } from '@/lib/taxComplianceStore';
import { Card, EmptyRow } from '@/components/arap/arapUi';
import { Delta, KpiGrid, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import { angka, DotPill } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

const STATUS_TIPE = { on_track: { label: 'On Track', style: 'bg-emerald-50 text-emerald-700' }, partial: { label: 'Partial', style: 'bg-amber-50 text-amber-700' },
  pending: { label: 'Pending', style: 'bg-amber-50 text-amber-700' } };
const DONUT = [
  { k: 'paid_reported', label: 'Paid & Reported', color: '#16A34A' }, { k: 'paid_not_reported', label: 'Paid, Not Reported', color: '#86EFAC' },
  { k: 'unpaid', label: 'Unpaid', color: '#FBBF24' }, { k: 'overdue', label: 'Overdue', color: '#F43F5E' },
] as const;

export default function OverviewTab({ clientId, range, goTab }: TaxTabProps) {
  const ov = useTaxData<TaxOverview | null>(`tov:${clientId}:${range.date_from}:${range.date_to}`, s => fetchTaxOverview(clientId, range, s), null);
  const d = ov.data;
  const k = d?.kpi, p = d?.previous;
  const loading = ov.loading && !d;
  const totalItem = d ? Object.values(d.status_items).reduce((a, b) => a + b, 0) : 0;
  const vs = 'vs previous period';

  return (
    <div className="space-y-5">
      {ov.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ov.error}</div>}
      <KpiGrid loading={loading} cards={[
        { label: 'Total Tax Base (DPP)', value: rupiah(k?.total_dpp), icon: Coins, tone: 'green', delta: <Delta now={k?.total_dpp} prev={p?.total_dpp} suffix={vs} /> },
        { label: 'Total PPh Payable', value: rupiah(k?.pph_payable), icon: FileText, tone: 'green', delta: <Delta now={k?.pph_payable} prev={p?.pph_payable} suffix={vs} /> },
        { label: 'VAT Output', value: rupiah(k?.vat_output), icon: ReceiptText, tone: 'red', delta: <Delta now={k?.vat_output} prev={p?.vat_output} suffix={vs} /> },
        { label: 'VAT Input', value: rupiah(k?.vat_input), icon: FileText, tone: 'blue', delta: <Delta now={k?.vat_input} prev={p?.vat_input} suffix={vs} /> },
        { label: 'Tax Paid', value: rupiah(k?.tax_paid), icon: CreditCard, tone: 'green', delta: <Delta now={k?.tax_paid} prev={p?.tax_paid} suffix={vs} /> },
        { label: 'Unpaid Tax', value: rupiah(k?.unpaid), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.unpaid} prev={p?.unpaid} goodWhenDown suffix={vs} /> },
        { label: 'Unreported Returns', value: String(k?.unreported_returns ?? 0), icon: Clock, tone: 'amber',
          delta: <Delta now={k?.unreported_returns} prev={p?.unreported_returns} goodWhenDown unit="abs" suffix={vs} /> },
        { label: 'Exceptions', value: String(k?.exceptions ?? 0), icon: ShieldAlert, tone: 'red', delta: <Delta now={k?.exceptions} prev={p?.exceptions} goodWhenDown suffix={vs} /> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Tax Summary by Type" action={<button type="button" onClick={() => goTab('ledger')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View Details →</button>}>
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className={tableHeadRow}>
                <th className={thCls}>Tax Type</th><th className={`${thCls} text-right`}>DPP (Tax Base)</th><th className={`${thCls} text-right`}>Rate</th>
                <th className={`${thCls} text-right`}>Tax Amount</th><th className={`${thCls} text-right`}>Paid</th><th className={thCls}>Reported</th><th className={thCls}>Status</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(loading || !d?.by_type.length) && <EmptyRow cols={7} loading={loading} text="No tax records in this period. Post transactions or click Sync Transactions." />}
                {d?.by_type.map(r => (
                  <tr key={r.tax_type}>
                    <td className={`${tdCls} font-medium`}>{r.label}</td><td className={`${tdCls} text-right`}>{rupiah(r.dpp)}</td><td className={`${tdCls} text-right`}>{r.rate}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(r.tax_amount)}</td><td className={`${tdCls} text-right`}>{rupiah(r.paid)}</td><td className={tdCls}>{r.reported}</td>
                    <td className={tdCls}><DotPill {...STATUS_TIPE[r.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Payment & Filing Status">
          <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row xl:flex-col 2xl:flex-row">
            <div className="relative h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={DONUT.map(x => ({ name: x.label, value: d?.status_items[x.k] ?? 0 }))} dataKey="value" innerRadius={50} outerRadius={75} stroke="none">
                  {DONUT.map(x => <Cell key={x.k} fill={x.color} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-bold">{totalItem}</span><span className="text-[10px] text-muted-foreground">Total Items</span></div>
            </div>
            <ul className="w-full space-y-2 text-xs">
              {DONUT.map(x => {
                const n = d?.status_items[x.k] ?? 0;
                return <li key={x.k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />
                  <span className="flex-1">{x.label}</span><b>{n}</b><span className="w-10 text-right text-muted-foreground">{totalItem ? Math.round((n / totalItem) * 100) : 0}%</span></li>;
              })}
            </ul>
          </div>
          <p className="px-5 pb-4 text-[11px] text-muted-foreground">One item = one tax type for one tax period.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Monthly Tax Trend">
          <div className="h-72 px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d?.trend ?? []} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tickFormatter={m => fmtMonth(m)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => rupiahShort(v)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pph" name="PPh Payable" fill="#0B5E5C" radius={[3, 3, 0, 0]} />
                <Bar dataKey="vat" name="VAT Payable" fill="#A7F3D0" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="total" name="Total Tax Payable" stroke="#0F7D4E" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Potential Tax Exposure" action={<button type="button" onClick={() => goTab('exceptions')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View All →</button>}>
          <div className="space-y-2 px-5 pb-5">
            {!d?.exposure.length && <p className="py-6 text-center text-xs text-muted-foreground">No open exceptions.</p>}
            {d?.exposure.map(e => (
              <button key={e.id} type="button" onClick={() => goTab('exceptions')} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-slate-50">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${e.severity === 'high' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}><AlertTriangle size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{e.reason}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{e.source_document ?? e.tax_type_label}{e.party_name ? ` · ${e.party_name}` : ''}</span></span>
                <span className={`text-xs font-semibold ${e.severity === 'high' ? 'text-rose-600' : 'text-amber-600'}`}>{angka(e.potential_tax)}</span>
                <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
