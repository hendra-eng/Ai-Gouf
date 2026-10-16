'use client';

// Tab Tax Ledger (Template UI/Tax Compliance/2.jpeg): filter, KPI, buku pajak,
// siklus status, link jurnal sumber, Add Adjustment, Export.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle, ChevronDown, Clock, Coins, Download, FileText, Plus, ReceiptText, Search } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  fetchLedger, PAYMENT_STYLE, REPORTING_STYLE, SOURCE_LABEL, TAX_LABEL, useTaxData, type LedgerData, type LedgerRow, type PaymentStatus, type ReportingStatus, type TaxType,
} from '@/lib/taxComplianceStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, Card, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Delta, KpiGrid } from '@/components/shared/moduleUi';
import { LedgerDrawer, LedgerTable } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

export const LEDGER_EXPORT = [
  { header: 'Date', value: (r: LedgerRow) => r.date }, { header: 'Source Document', value: (r: LedgerRow) => r.source_document },
  { header: 'Party', value: (r: LedgerRow) => r.party_name }, { header: 'Source Module', value: (r: LedgerRow) => SOURCE_LABEL[r.source_module] },
  { header: 'Tax Type', value: (r: LedgerRow) => TAX_LABEL[r.tax_type] }, { header: 'Tax Code', value: (r: LedgerRow) => r.tax_code },
  { header: 'DPP', value: (r: LedgerRow) => r.dpp, type: 'money' as const }, { header: 'Rate %', value: (r: LedgerRow) => r.rate, type: 'number' as const },
  { header: 'Tax Amount', value: (r: LedgerRow) => r.tax_amount, type: 'money' as const }, { header: 'GL Account', value: (r: LedgerRow) => r.gl_account_code },
  { header: 'e-Faktur / e-Bupot', value: (r: LedgerRow) => r.tax_document_no }, { header: 'Payment Status', value: (r: LedgerRow) => PAYMENT_STYLE[r.payment_status].label },
  { header: 'Reporting Status', value: (r: LedgerRow) => REPORTING_STYLE[r.reporting_status].label },
];

export default function LedgerTab({ clientId, clientName, range }: TaxTabProps) {
  const lg = useTaxData<LedgerData | null>(`tlg:${clientId}:${range.date_from}:${range.date_to}`, s => fetchLedger(clientId, range, s), null);
  const [jenis, setJenis] = useState<'' | TaxType>('');
  const [bayar, setBayar] = useState<'' | PaymentStatus>('');
  const [lapor, setLapor] = useState<'' | ReportingStatus>('');
  const [pihak, setPihak] = useState('');
  const [cari, setCari] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [adj, setAdj] = useState(false);
  const d = lg.data;
  const k = d?.kpi, p = d?.previous;

  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase(), pq = pihak.trim().toLowerCase();
    return (d?.rows ?? []).filter(r => (!jenis || r.tax_type === jenis) && (!bayar || r.payment_status === bayar) && (!lapor || r.reporting_status === lapor)
      && (!pq || (r.party_name || '').toLowerCase().includes(pq))
      && (!q || [r.source_document, r.party_name, r.tax_code, r.tax_document_no, r.journal_no].some(x => (x || '').toLowerCase().includes(q))));
  }, [d, jenis, bayar, lapor, pihak, cari]);

  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable(f, { title: 'Tax Ledger', clientName, subtitle: `${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}`, columns: LEDGER_EXPORT, rows,
        totals: { Date: 'Total', DPP: rows.reduce((n, r) => n + (r.dpp || 0), 0), 'Tax Amount': rows.reduce((n, r) => n + r.tax_amount, 0) },
        fileName: `Tax-Ledger-${range.date_from}-${range.date_to}`, orientation: 'landscape' });
    } catch (e) { toast.error((e as Error).message || 'Export failed.'); }
  };
  const lc = d?.lifecycle;
  const siklus = lc ? [
    { name: 'Posted', value: lc.posted, color: '#16A34A' }, { name: 'Paid / Credited', value: lc.paid, color: '#86EFAC' }, { name: 'Unpaid', value: lc.unpaid, color: '#FBBF24' },
    { name: 'Reported', value: lc.reported, color: '#3B82F6' }, { name: 'Unreported', value: lc.unreported, color: '#F43F5E' },
  ] : [];

  return (
    <div className="space-y-5">
      {lg.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{lg.error}</div>}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-2 xl:grid-cols-12 xl:items-end">
        <label className="xl:col-span-2"><span className="mb-1 block text-xs font-medium">Tax Type</span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as TaxType | ''); setPage(0); }} className={inputCls}>
            <option value="">All Tax Types</option>{(Object.keys(TAX_LABEL) as TaxType[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
          </select></label>
        <label className="xl:col-span-2"><span className="mb-1 block text-xs font-medium">Payment Status</span>
          <select value={bayar} onChange={e => { setBayar(e.target.value as PaymentStatus | ''); setPage(0); }} className={inputCls}>
            <option value="">All Statuses</option>{(Object.keys(PAYMENT_STYLE) as PaymentStatus[]).map(s => <option key={s} value={s}>{PAYMENT_STYLE[s].label}</option>)}
          </select></label>
        <label className="xl:col-span-2"><span className="mb-1 block text-xs font-medium">Reporting Status</span>
          <select value={lapor} onChange={e => { setLapor(e.target.value as ReportingStatus | ''); setPage(0); }} className={inputCls}>
            <option value="">All Statuses</option>{(Object.keys(REPORTING_STYLE) as ReportingStatus[]).map(s => <option key={s} value={s}>{REPORTING_STYLE[s].label}</option>)}
          </select></label>
        <label className="xl:col-span-3"><span className="mb-1 block text-xs font-medium">Vendor / Customer</span>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={pihak} onChange={e => { setPihak(e.target.value); setPage(0); }} placeholder="Search vendor or customer..." className={`${inputCls} pl-9`} /></div></label>
        <div className="flex flex-wrap gap-2 xl:col-span-3 xl:justify-end">
          <button type="button" onClick={() => setAdj(true)} className={btnOutline}><Plus size={15} /> Add Adjustment</button>
          <Menu width="w-40" button={open => <button type="button" className={btnPrimary}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => <>
              <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem><MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
              <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
            </>}
          </Menu>
        </div>
      </div>

      <KpiGrid cols={5} loading={lg.loading && !d} cards={[
        { label: 'Total Tax Records', value: String(k?.records ?? 0), icon: FileText, tone: 'green', delta: <Delta now={k?.records} prev={p?.records} suffix="vs previous period" /> },
        { label: 'Total DPP (Tax Base)', value: rupiah(k?.total_dpp), icon: Coins, tone: 'green', delta: <Delta now={k?.total_dpp} prev={p?.total_dpp} suffix="vs previous period" /> },
        { label: 'Total Tax Amount', value: rupiah(k?.tax_amount), icon: ReceiptText, tone: 'green', delta: <Delta now={k?.tax_amount} prev={p?.tax_amount} suffix="vs previous period" /> },
        { label: 'Unpaid Tax', value: rupiah(k?.unpaid), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.unpaid} prev={p?.unpaid} goodWhenDown suffix="vs previous period" /> },
        { label: 'Unreported Tax', value: rupiah(k?.unreported), icon: Clock, tone: 'blue', delta: <Delta now={k?.unreported} prev={p?.unreported} goodWhenDown suffix="vs previous period" /> },
      ]} />

      <Card title="Tax Ledger" action={
        <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search by document number, party, or tax code..." className={`${inputCls} w-80 pl-9`} /></div>
      }>
        <LedgerTable clientId={clientId} rows={rows.slice(page * pageSize, (page + 1) * pageSize)} loading={lg.loading && !d}
          kolom={['date', 'doc', 'party', 'module', 'type', 'code', 'dpp', 'rate', 'amount', 'gl', 'pay', 'rep']}
          empty="No tax records in this period. Post Sales, Purchase, Journal Entry or Cash & Bank transactions on tax accounts, then click Sync Transactions." />
        <NumberPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="records" />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Tax Lifecycle Status">
          <div className="grid grid-cols-1 gap-4 px-5 pb-5 md:grid-cols-2">
            <div className="flex items-center gap-4">
              <div className="relative h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%"><PieChart>
                  <Pie data={siklus.slice(1)} dataKey="value" innerRadius={44} outerRadius={66} stroke="none">{siklus.slice(1).map(s => <Cell key={s.name} fill={s.color} />)}</Pie><Tooltip />
                </PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><b className="text-lg">{lc?.posted ?? 0}</b><span className="text-[10px] text-muted-foreground">Total Records</span></div>
              </div>
              <ul className="w-full space-y-1.5 text-xs">
                {siklus.map(s => <li key={s.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /><span className="flex-1">{s.name}</span><b>{s.value}</b></li>)}
              </ul>
            </div>
            <div className="space-y-2.5 text-xs">
              {(d?.by_type ?? []).map(t => (
                <div key={t.tax_type} className="flex items-center gap-2">
                  <span className="w-20 shrink-0">{t.label}</span>
                  <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="bg-emerald-500" style={{ width: `${(t.paid / t.count) * 100}%` }} />
                    <span className="bg-amber-400" style={{ width: `${(t.partial / t.count) * 100}%` }} />
                    <span className="bg-rose-400" style={{ width: `${(t.unpaid / t.count) * 100}%` }} />
                  </div>
                  <b className="w-6 text-right">{t.count}</b>
                </div>
              ))}
              {!d?.by_type.length && <p className="text-muted-foreground">No records.</p>}
            </div>
          </div>
        </Card>
        <Card title="Recent Tax Journal Links">
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-muted-foreground"><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Journal No.</th>
                <th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-right">Tax Amount</th><th className="px-3 py-2 text-left">Source</th></tr></thead>
              <tbody className="divide-y divide-border">
                {!d?.journal_links.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No linked journals.</td></tr>}
                {d?.journal_links.map((j, i) => (
                  <tr key={i}><td className="px-3 py-2">{fmtDate(j.date)}</td><td className="px-3 py-2 font-medium">{j.journal_no}</td><td className="px-3 py-2">{j.description}</td>
                    <td className="px-3 py-2 text-right">{rupiah(j.tax_amount)}</td><td className="px-3 py-2">{SOURCE_LABEL[j.source_module as LedgerRow['source_module']] ?? j.source_module}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {adj && <LedgerDrawer clientId={clientId} row={null} onClose={() => setAdj(false)} />}
    </div>
  );
}
