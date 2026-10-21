'use client';

// Tab Payments (Template UI/Tax Compliance/4.jpeg): KPI, daftar setoran,
// Record Tax Payment (opsional jadi transaksi Cash & Bank), setoran per jenis
// per bulan, jatuh tempo, dan status SPT per masa.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BarChart3, ChevronDown, Clock, Coins, CreditCard, Download, ExternalLink, FileText, Loader2, MoreHorizontal, Plus } from 'lucide-react';
import { fmtDate, fmtMonth, rupiah, rupiahShort, todayIso } from '@/lib/receivablesPayablesStore';
import {
  cancelTaxPayment, fetchTaxAccounts, fetchTaxPayments, FILING_STYLE, PAY_LABEL, recordTaxPayment, RETURN_LABEL, saveFiling, TAX_COLORS, updateTaxPayment, useTaxData,
  type Filing, type PaymentsData, type PayType, type TaxAccountsData, type TaxPayment,
} from '@/lib/taxComplianceStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, btnSmall, Card, Drawer, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { AccountSelect, Delta, FormField, isCashAccount, KpiGrid, Modal, ReasonDialog, tdCls } from '@/components/shared/moduleUi';
import { angka, DotPill } from './taxUi';
import type { TaxTabProps } from './TaxWorkspace';

const STATUS_BAYAR = { paid: { label: 'Paid', style: 'bg-emerald-50 text-emerald-700' }, pending: { label: 'Pending', style: 'bg-amber-50 text-amber-700' },
  cancelled: { label: 'Cancelled', style: 'bg-slate-100 text-slate-500' }, overdue: { label: 'Overdue', style: 'bg-rose-50 text-rose-700' } };
const TENGGAT = { overdue: { label: 'Overdue', style: 'bg-rose-50 text-rose-700' }, due_soon: { label: 'Due Soon', style: 'bg-amber-50 text-amber-700' },
  not_due: { label: 'Not Due', style: 'bg-slate-100 text-slate-600' } };

export default function PaymentsTab({ clientId, clientName, range }: TaxTabProps) {
  const pd = useTaxData<PaymentsData | null>(`tpay:${clientId}:${range.date_from}:${range.date_to}`, s => fetchTaxPayments(clientId, range, s), null);
  const [jenis, setJenis] = useState<'' | PayType>('');
  const [status, setStatus] = useState('');
  const [bank, setBank] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState<{ tax_type?: PayType; tax_period?: string; amount?: number } | null>(null);
  const [edit, setEdit] = useState<TaxPayment | null>(null);
  const [batal, setBatal] = useState<TaxPayment | null>(null);
  const [spt, setSpt] = useState<Filing | null>(null);
  const d = pd.data;
  const k = d?.kpi, p = d?.previous;
  const bankList = useMemo(() => Array.from(new Set((d?.payments ?? []).map(x => x.bank_account).filter(Boolean))) as string[], [d]);
  const rows = useMemo(() => (d?.payments ?? []).filter(x => (!jenis || x.tax_type === jenis) && (!bank || x.bank_account === bank)
    && (!status || (status === 'overdue' ? x.overdue : x.status === status))), [d, jenis, status, bank]);
  const jenisBulanan = useMemo(() => Array.from(new Set((d?.monthly ?? []).flatMap(m => Object.keys(m).filter(x => x !== 'month')))), [d]);

  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable<TaxPayment>(f, { title: 'Tax Payments', clientName, subtitle: `${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}`, rows,
        fileName: `Tax-Payments-${range.date_from}-${range.date_to}`, orientation: 'landscape', columns: [
          { header: 'Payment No.', value: x => x.payment_no }, { header: 'Payment Date', value: x => x.payment_date }, { header: 'Tax Period', value: x => x.tax_period.slice(0, 7) },
          { header: 'Tax Type', value: x => x.tax_type_label }, { header: 'Related Liability', value: x => x.related_liability }, { header: 'DPP', value: x => x.dpp, type: 'money' },
          { header: 'Tax Amount', value: x => x.amount, type: 'money' }, { header: 'Billing Code', value: x => x.billing_code }, { header: 'NTPN', value: x => x.ntpn },
          { header: 'Bank Account', value: x => x.bank_account }, { header: 'Status', value: x => STATUS_BAYAR[x.status].label },
        ] });
    } catch (e) { toast.error((e as Error).message || 'Export failed.'); }
  };

  return (
    <div className="space-y-5">
      {pd.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{pd.error}</div>}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3">
        <label><span className="mb-1 block text-xs font-medium">Tax Type</span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as PayType | ''); setPage(0); }} className={inputCls}>
            <option value="">All Types</option>{(Object.keys(PAY_LABEL) as PayType[]).map(t => <option key={t} value={t}>{PAY_LABEL[t]}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-medium">Payment Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All Status</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option></select></label>
        <label><span className="mb-1 block text-xs font-medium">Bank Account</span>
          <select value={bank} onChange={e => { setBank(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All Banks</option>{bankList.map(b => <option key={b}>{b}</option>)}</select></label>
      </div>

      <KpiGrid cols={6} loading={pd.loading && !d} cards={[
        { label: 'Total Tax Due', value: rupiah(k?.total_due), icon: Coins, tone: 'green', delta: <Delta now={k?.total_due} prev={p?.total_due} suffix="vs previous period" /> },
        { label: 'Total Paid', value: rupiah(k?.total_paid), icon: FileText, tone: 'green', delta: <Delta now={k?.total_paid} prev={p?.total_paid} suffix="vs previous period" /> },
        { label: 'Overdue Tax', value: rupiah(k?.overdue), icon: AlertTriangle, tone: 'red', delta: <Delta now={k?.overdue} prev={p?.overdue} goodWhenDown suffix="vs previous period" /> },
        { label: 'Upcoming Due', value: rupiah(k?.upcoming), icon: Clock, tone: 'blue', delta: <Delta now={k?.upcoming} prev={p?.upcoming} goodWhenDown suffix="vs previous period" /> },
        { label: 'Payment Success Rate', value: k?.success_rate != null ? `${k.success_rate}%` : '—', icon: BarChart3, tone: 'green',
          delta: <Delta now={k?.success_rate ?? null} prev={p?.success_rate ?? null} unit="abs" suffix="pts vs previous period" /> },
        { label: 'Unallocated Payments', value: rupiah(k?.unallocated), icon: CreditCard, tone: 'amber', delta: <span className="text-[11px] text-muted-foreground">Paid above the liability</span> },
      ]} />

      <Card title="Tax Payments" action={<>
        <button type="button" onClick={() => setForm({})} className={btnPrimary}><Plus size={15} /> Record Tax Payment</button>
        <Menu width="w-40" button={open => <button type="button" className={btnOutline}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
          {close => <><MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem><MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem><MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem></>}
        </Menu>
      </>}>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              {['Payment Date', 'Tax Period', 'Tax Type', 'Related Liability'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
              {['DPP', 'Tax Amount'].map(h => <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>)}
              {['Billing Code / NTPN', 'Bank Account', 'Payment Status', 'Reporting Link'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
              <th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(pd.loading && !d) || !rows.length ? <EmptyRow cols={11} loading={pd.loading && !d} text="No tax payments in this period." /> :
                rows.slice(page * pageSize, (page + 1) * pageSize).map(x => {
                  const st = x.overdue ? STATUS_BAYAR.overdue : STATUS_BAYAR[x.status];
                  return (
                    <tr key={x.id} className="hover:bg-slate-50/60">
                      <td className={tdCls}>{fmtDate(x.payment_date)}</td><td className={tdCls}>{fmtMonth(x.tax_period.slice(0, 7))}</td>
                      <td className={tdCls}>{x.tax_type_label}</td><td className={tdCls}>{x.related_liability ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{angka(x.dpp)}</td><td className={`${tdCls} text-right font-medium`}>{angka(x.amount)}</td>
                      <td className={tdCls}>{x.billing_code ?? '—'}{x.ntpn && <span className="block text-[11px] text-muted-foreground">NTPN {x.ntpn}</span>}</td>
                      <td className={tdCls}>{x.bank_account ?? '—'}</td>
                      <td className={tdCls}><DotPill {...st} /></td>
                      <td className={tdCls}>{x.bank_cash_transaction_id ? <a href="/transactions/bank-cash/posted" className="inline-flex items-center gap-1 text-xs font-medium text-[#0F7D4E] hover:underline"><ExternalLink size={12} /> Cash &amp; Bank</a> : '—'}</td>
                      <td className={tdCls}>
                        <Menu width="w-44" button={() => <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
                          {close => <>
                            <MenuItem onClick={() => { close(); setEdit(x); }}>Edit billing / NTPN</MenuItem>
                            <MenuItem danger disabled={x.status === 'cancelled'} onClick={() => { close(); setBatal(x); }}>Cancel payment</MenuItem>
                          </>}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="payments" />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Recent Payments by Tax Type">
          <div className="h-64 px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d?.monthly ?? []} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tickFormatter={m => fmtMonth(String(m))} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => rupiahShort(v)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={60} />
                <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                {jenisBulanan.map(j => <Bar key={j} dataKey={j} stackId="a" name={PAY_LABEL[j as PayType] ?? j} fill={TAX_COLORS[j] ?? '#94A3B8'} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Upcoming Deadlines">
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-muted-foreground">{['Due Date', 'Tax Period', 'Tax Type', 'Amount', 'Status', ''].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {!d?.deadlines.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No outstanding tax liabilities.</td></tr>}
                {d?.deadlines.map((t, i) => (
                  <tr key={i}><td className="px-3 py-2">{fmtDate(t.due_date)}</td><td className="px-3 py-2">{fmtMonth(t.tax_period.slice(0, 7))}</td><td className="px-3 py-2">{t.tax_type_label}</td>
                    <td className="px-3 py-2">{rupiah(t.amount)}</td><td className="px-3 py-2"><DotPill {...TENGGAT[t.status]} /></td>
                    <td className="px-3 py-2"><button type="button" className={btnSmall} onClick={() => setForm({ tax_type: t.tax_type, tax_period: t.tax_period, amount: t.amount })}>Pay</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Tax Returns (SPT)" subtitle="Returns required for the period, based on the tax types in the ledger">
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">{['Return', 'Tax Period', 'Due Date', 'Filed Date', 'Receipt (BPE)', 'Amount', 'Status', ''].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {(pd.loading && !d) || !d?.filings.length ? <EmptyRow cols={8} loading={pd.loading && !d} text="No returns required in this period." /> : d.filings.map((f, i) => (
                <tr key={i}>
                  <td className={tdCls}>{f.return_label}{f.is_amendment && <span className="ml-1 text-[10px] text-amber-700">(amendment)</span>}</td>
                  <td className={tdCls}>{f.return_type === 'annual_corporate' ? f.tax_period.slice(0, 4) : fmtMonth(f.tax_period.slice(0, 7))}</td>
                  <td className={tdCls}>{fmtDate(f.due_date)}</td><td className={tdCls}>{fmtDate(f.filed_date)}{f.late && f.status === 'filed' && <span className="ml-1 text-[10px] text-rose-600">late</span>}</td>
                  <td className={tdCls}>{f.receipt_no ?? '—'}</td><td className={tdCls}>{rupiah(f.amount)}</td>
                  <td className={tdCls}><DotPill {...FILING_STYLE[f.status]} />{f.late && f.status !== 'filed' && <span className="ml-1 text-[10px] text-rose-600">overdue</span>}</td>
                  <td className={tdCls}><button type="button" className={btnSmall} onClick={() => setSpt(f)}>Update</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {form && <RecordPaymentDrawer clientId={clientId} preset={form} onClose={() => setForm(null)} />}
      {edit && <EditPaymentModal clientId={clientId} p={edit} onClose={() => setEdit(null)} />}
      {spt && <FilingModal clientId={clientId} f={spt} onClose={() => setSpt(null)} />}
      <ReasonDialog open={!!batal} title={`Cancel ${batal?.payment_no ?? ''}`} confirmLabel="Cancel Payment"
        subtitle="A draft Cash & Bank payment is deleted; a posted one is reversed (Manager level)." onClose={() => setBatal(null)}
        onConfirm={async reason => { try { toast.success((await cancelTaxPayment(clientId, batal!.id, reason)).message); } catch (e) { toast.error((e as Error).message); throw e; } }} />
    </div>
  );
}

function RecordPaymentDrawer({ clientId, preset, onClose }: { clientId: string; preset: { tax_type?: PayType; tax_period?: string; amount?: number }; onClose: () => void }) {
  const akun = useTaxData<TaxAccountsData | null>(`tacc:${clientId}`, s => fetchTaxAccounts(clientId, s), null);
  const [f, setF] = useState({
    payment_date: todayIso(), tax_type: (preset.tax_type ?? 'pph21') as PayType, tax_period: (preset.tax_period ?? todayIso()).slice(0, 7),
    related_liability: '', dpp: '', amount: preset.amount ? String(Math.round(preset.amount * 100) / 100) : '', billing_code: '', ntpn: '', notes: '',
    mode: 'cash_bank' as 'cash_bank' | 'record_only', bank_coa_id: null as string | null, payable_coa_id: null as string | null, status: 'paid' as 'paid' | 'pending',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const target = f.tax_type === 'vat' ? 'vat_output' : f.tax_type;
  const defaultHutang = akun.data?.accounts.find(a => a.tax_type === target)?.id ?? null;

  const simpan = async () => {
    if (!(Number(f.amount) > 0)) { toast.error('Enter the amount paid.'); return; }
    setBusy(true);
    try {
      const r = await recordTaxPayment(clientId, {
        payment_date: f.payment_date, tax_type: f.tax_type, tax_period: `${f.tax_period}-01`, related_liability: f.related_liability || null,
        dpp: f.dpp ? Number(f.dpp) : null, amount: Number(f.amount), billing_code: f.billing_code || null, ntpn: f.ntpn || null, notes: f.notes || null,
        mode: f.mode, bank_coa_id: f.mode === 'cash_bank' ? f.bank_coa_id : null, payable_coa_id: f.mode === 'cash_bank' ? (f.payable_coa_id ?? defaultHutang) : null, status: f.status,
      });
      toast.success(r.data.status === 'pending' ? `${r.message} The Cash & Bank payment is a draft waiting to be posted.` : r.message);
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title="Record Tax Payment" subtitle="Deposit of tax (SSP / e-Billing) for one tax type and period"
      footer={<><button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save Payment</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Tax Type" required>
          <select value={f.tax_type} onChange={e => set('tax_type', e.target.value as PayType)} className={inputCls}>{(Object.keys(PAY_LABEL) as PayType[]).map(t => <option key={t} value={t}>{PAY_LABEL[t]}</option>)}</select>
        </FormField>
        <FormField label="Tax Period" required><input type="month" value={f.tax_period} onChange={e => set('tax_period', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Payment Date" required><input type="date" value={f.payment_date} onChange={e => set('payment_date', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Amount (IDR)" required><input type="number" min={0} step="0.01" value={f.amount} onChange={e => set('amount', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Billing Code"><input value={f.billing_code} onChange={e => set('billing_code', e.target.value)} className={inputCls} maxLength={30} /></FormField>
        <FormField label="NTPN"><input value={f.ntpn} onChange={e => set('ntpn', e.target.value)} className={inputCls} maxLength={30} /></FormField>
        <FormField label="Related Liability"><input value={f.related_liability} onChange={e => set('related_liability', e.target.value)} className={inputCls} placeholder="e.g. Salary Tax" /></FormField>
        <FormField label="DPP (optional)"><input type="number" min={0} value={f.dpp} onChange={e => set('dpp', e.target.value)} className={inputCls} /></FormField>
      </div>
      <div className="space-y-3 rounded-xl border border-border p-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          <button type="button" onClick={() => set('mode', 'cash_bank')} className={`flex-1 rounded-lg px-3 py-1.5 ${f.mode === 'cash_bank' ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>Create Cash &amp; Bank payment</button>
          <button type="button" onClick={() => set('mode', 'record_only')} className={`flex-1 rounded-lg px-3 py-1.5 ${f.mode === 'record_only' ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>Record only</button>
        </div>
        {f.mode === 'cash_bank' ? <>
          <p className="text-[11px] text-muted-foreground">Creates a Cash Payment (Dr tax payable / Cr bank). Manager level posts it immediately; otherwise it is saved as a draft in Cash &amp; Bank.</p>
          <FormField label="Paid From (Bank / Cash)" required><AccountSelect accounts={akun.data?.accounts ?? []} value={f.bank_coa_id} onChange={v => set('bank_coa_id', v)} filter={isCashAccount} /></FormField>
          <FormField label="Tax Payable Account" hint="Default: the account mapped to this tax type">
            <AccountSelect accounts={akun.data?.accounts ?? []} value={f.payable_coa_id ?? defaultHutang} onChange={v => set('payable_coa_id', v)} filter={a => !!a.tax_type} />
          </FormField>
        </> : <>
          <p className="text-[11px] text-muted-foreground">Use when the payment is already booked in the ledger (e.g. through a journal entry or an existing Cash &amp; Bank transaction).</p>
          <FormField label="Status"><select value={f.status} onChange={e => set('status', e.target.value as 'paid' | 'pending')} className={inputCls}><option value="paid">Paid</option><option value="pending">Pending</option></select></FormField>
        </>}
      </div>
      <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} className={inputCls} /></FormField>
    </Drawer>
  );
}

function EditPaymentModal({ clientId, p, onClose }: { clientId: string; p: TaxPayment; onClose: () => void }) {
  const [f, setF] = useState({ billing_code: p.billing_code ?? '', ntpn: p.ntpn ?? '', related_liability: p.related_liability ?? '', notes: p.notes ?? '', status: p.status });
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { billing_code: f.billing_code, ntpn: f.ntpn, related_liability: f.related_liability, notes: f.notes };
      if (!p.bank_cash_transaction_id && f.status !== 'cancelled') body.status = f.status;
      toast.success((await updateTaxPayment(clientId, p.id, body)).message);
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${p.payment_no}`} footer={<><button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
      <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button></>}>
      <FormField label="Billing Code"><input value={f.billing_code} onChange={e => setF({ ...f, billing_code: e.target.value })} className={inputCls} /></FormField>
      <FormField label="NTPN"><input value={f.ntpn} onChange={e => setF({ ...f, ntpn: e.target.value })} className={inputCls} /></FormField>
      <FormField label="Related Liability"><input value={f.related_liability} onChange={e => setF({ ...f, related_liability: e.target.value })} className={inputCls} /></FormField>
      {!p.bank_cash_transaction_id && p.status !== 'cancelled' && (
        <FormField label="Status"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value as 'paid' | 'pending' })} className={inputCls}><option value="paid">Paid</option><option value="pending">Pending</option></select></FormField>
      )}
      <FormField label="Notes"><textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={inputCls} /></FormField>
    </Modal>
  );
}

function FilingModal({ clientId, f, onClose }: { clientId: string; f: Filing; onClose: () => void }) {
  const [v, setV] = useState({ status: (f.status === 'not_filed' ? 'filed' : f.status) as 'draft' | 'filed' | 'not_required', filed_date: f.filed_date ?? todayIso(), receipt_no: f.receipt_no ?? '',
    amount: String(f.amount ?? ''), is_amendment: f.is_amendment, notes: f.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    setBusy(true);
    try {
      toast.success((await saveFiling(clientId, { return_type: f.return_type, tax_period: f.tax_period, status: v.status, filed_date: v.status === 'filed' ? v.filed_date : null,
        receipt_no: v.receipt_no || null, amount: v.amount === '' ? null : Number(v.amount), is_amendment: v.is_amendment, notes: v.notes || null })).message);
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${RETURN_LABEL[f.return_type]} · ${f.return_type === 'annual_corporate' ? f.tax_period.slice(0, 4) : fmtMonth(f.tax_period.slice(0, 7))}`}
      subtitle={`Due ${fmtDate(f.due_date)}`} footer={<><button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button></>}>
      <FormField label="Status"><select value={v.status} onChange={e => setV({ ...v, status: e.target.value as 'draft' | 'filed' | 'not_required' })} className={inputCls}>
        <option value="filed">Filed</option><option value="draft">Draft (prepared, not filed)</option><option value="not_required">Not Required (nil / exempt)</option></select></FormField>
      {v.status === 'filed' && <FormField label="Filing Date" required><input type="date" value={v.filed_date} onChange={e => setV({ ...v, filed_date: e.target.value })} className={inputCls} /></FormField>}
      <FormField label="Receipt No. (BPE / NTTE)"><input value={v.receipt_no} onChange={e => setV({ ...v, receipt_no: e.target.value })} className={inputCls} /></FormField>
      <FormField label="Tax Declared (IDR)"><input type="number" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} className={inputCls} /></FormField>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_amendment} onChange={e => setV({ ...v, is_amendment: e.target.checked })} /> Amendment (pembetulan)</label>
      <FormField label="Notes"><textarea rows={2} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} className={inputCls} /></FormField>
    </Modal>
  );
}
