'use client';

// Tab PPh (Template UI/Tax Compliance/3.jpeg): KPI, transaksi pemotongan PPh,
// breakdown per pasal, gap pemotongan / potensi eksposur.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Coins, CreditCard, Download, FileText, Search } from 'lucide-react';
import { fmtDate, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchPph, PAYMENT_STYLE, TAX_COLORS, TAX_LABEL, useTaxData, type PaymentStatus, type PphData, type TaxType } from '@/lib/taxComplianceStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnPrimary, Card, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Delta, KpiGrid } from '@/components/shared/moduleUi';
import { angka, LedgerTable } from './taxUi';
import { LEDGER_EXPORT } from './LedgerTab';
import type { TaxTabProps } from './TaxWorkspace';

const PPH: TaxType[] = ['pph21', 'pph22', 'pph23', 'pph26', 'pph4_2', 'pph15', 'pph25', 'pph29', 'pph_credit'];

export default function PphTab({ clientId, clientName, range, goTab }: TaxTabProps) {
  const pd = useTaxData<PphData | null>(`tpph:${clientId}:${range.date_from}:${range.date_to}`, s => fetchPph(clientId, range, s), null);
  const [jenis, setJenis] = useState<'' | TaxType>('');
  const [status, setStatus] = useState<'' | PaymentStatus>('');
  const [cari, setCari] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const d = pd.data;
  const k = d?.kpi, p = d?.previous;
  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (d?.rows ?? []).filter(r => (!jenis || r.tax_type === jenis) && (!status || r.payment_status === status)
      && (!q || [r.party_name, r.source_document, r.tax_code].some(x => (x || '').toLowerCase().includes(q))));
  }, [d, jenis, status, cari]);
  const total = d?.breakdown.reduce((n, b) => n + b.amount, 0) ?? 0;
  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable(f, { title: 'Withholding Tax (PPh) Transactions', clientName, subtitle: `${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}`,
        columns: LEDGER_EXPORT, rows, fileName: `PPh-Transactions-${range.date_from}-${range.date_to}`, orientation: 'landscape' });
    } catch (e) { toast.error((e as Error).message || 'Export failed.'); }
  };

  return (
    <div className="space-y-5">
      {pd.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{pd.error}</div>}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-12 md:items-end">
        <label className="md:col-span-3"><span className="mb-1 block text-xs font-medium">PPh Type</span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as TaxType | ''); setPage(0); }} className={inputCls}>
            <option value="">All PPh Types</option>{PPH.map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
          </select></label>
        <label className="md:col-span-5"><span className="mb-1 block text-xs font-medium">Vendor / Employee / Counterparty</span>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search vendor, employee, or counterparty..." className={`${inputCls} pl-9`} /></div></label>
        <label className="md:col-span-2"><span className="mb-1 block text-xs font-medium">Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value as PaymentStatus | ''); setPage(0); }} className={inputCls}>
            <option value="">All Status</option>{(Object.keys(PAYMENT_STYLE) as PaymentStatus[]).map(s => <option key={s} value={s}>{PAYMENT_STYLE[s].label}</option>)}
          </select></label>
        <div className="flex md:col-span-2 md:justify-end">
          <Menu width="w-40" button={open => <button type="button" className={btnPrimary}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => <><MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem><MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem><MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem></>}
          </Menu>
        </div>
      </div>

      <KpiGrid cols={6} loading={pd.loading && !d} cards={[
        { label: 'Total DPP', value: rupiah(k?.total_dpp), icon: Coins, tone: 'green', delta: <Delta now={k?.total_dpp} prev={p?.total_dpp} suffix="vs previous period" /> },
        { label: 'Total PPh Payable', value: rupiah(k?.pph_payable), icon: FileText, tone: 'green', delta: <Delta now={k?.pph_payable} prev={p?.pph_payable} suffix="vs previous period" /> },
        { label: 'Paid This Period', value: rupiah(k?.paid), icon: CreditCard, tone: 'green', delta: <Delta now={k?.paid} prev={p?.paid} suffix="vs previous period" /> },
        { label: 'Unpaid', value: rupiah(k?.unpaid), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.unpaid} prev={p?.unpaid} goodWhenDown suffix="vs previous period" /> },
        { label: 'Reported', value: rupiah(k?.reported), icon: Clock, tone: 'blue', delta: <Delta now={k?.reported} prev={p?.reported} suffix="vs previous period" /> },
        { label: 'Needs Review', value: String(k?.needs_review ?? 0), icon: FileText, tone: 'red', delta: <Delta now={k?.needs_review} prev={p?.needs_review} goodWhenDown unit="abs" suffix="vs previous period" /> },
      ]} />

      <Card title="Withholding Tax (PPh) Transactions" action={<button type="button" onClick={() => goTab('ledger')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View Details →</button>}>
        <LedgerTable clientId={clientId} rows={rows.slice(page * pageSize, (page + 1) * pageSize)} loading={pd.loading && !d} docLabel="e-Bupot No."
          kolom={['doc', 'party', 'type', 'dpp', 'rate', 'amount', 'taxdoc', 'pay', 'rep']} empty="No withholding tax transactions in this period." />
        <NumberPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="transactions" />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="PPh Breakdown by Article">
          <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={d?.breakdown ?? []} dataKey="amount" nameKey="label" innerRadius={52} outerRadius={80} stroke="none">
                  {(d?.breakdown ?? []).map(b => <Cell key={b.tax_type} fill={TAX_COLORS[b.tax_type]} />)}
                </Pie><Tooltip formatter={(v: number) => rupiah(v)} /></PieChart></ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><b>{rupiahShort(total)}</b><span className="text-[10px] text-muted-foreground">Total PPh</span></div>
            </div>
            <ul className="w-full space-y-2 text-sm">
              {!d?.breakdown.length && <li className="text-xs text-muted-foreground">No PPh in this period.</li>}
              {d?.breakdown.map(b => (
                <li key={b.tax_type} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TAX_COLORS[b.tax_type] }} />
                  <span className="flex-1">{b.label} <span className="text-xs text-muted-foreground">({total ? Math.round((b.amount / total) * 100) : 0}%)</span></span><b>{rupiah(b.amount)}</b></li>
              ))}
            </ul>
          </div>
        </Card>
        <Card title="Withholding Gaps / Potential Exposure" action={<button type="button" onClick={() => goTab('exceptions')} className="text-xs font-medium text-[#0F7D4E] hover:underline">View All →</button>}>
          <div className="space-y-2 px-5 pb-5">
            {!d?.gaps.length && <p className="py-6 text-center text-xs text-muted-foreground">No open PPh exceptions.</p>}
            {d?.gaps.map(e => (
              <button key={e.id} type="button" onClick={() => goTab('exceptions')} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:bg-slate-50">
                <AlertTriangle size={18} className={e.severity === 'high' ? 'text-rose-600' : 'text-amber-500'} />
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{e.reason}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{e.source_document ?? ''}{e.party_name ? ` · ${e.party_name}` : ''}</span></span>
                <span className={`text-xs font-semibold ${e.severity === 'high' ? 'text-rose-600' : 'text-amber-600'}`}>{angka(e.potential_tax)}</span><ChevronRight size={14} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
