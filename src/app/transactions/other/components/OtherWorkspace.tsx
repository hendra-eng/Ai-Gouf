'use client';

// Halaman Other Transactions (layout dataset/picture/Template UI/other/1.jpeg):
// tab Overview, Categories, Review Queue, Journal Preview, Exceptions, Posted +
// tombol Create Transaction, Transaction Templates, Import, Export.
// Backend: modules/assets_and_equity/other_transactions_v1.py.

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleCheck, Clock, Download, Eye, FileText, LayoutGrid, Loader2, Plus, Tag, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useActiveClient } from '@/lib/activeClient';
import { fmtDate, fmtMonth, rupiah, rupiahShort, todayIso } from '@/lib/receivablesPayablesStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import {
  fetchCategories, fetchMeta, fetchOverview, fetchTransactions, useOtherTxData,
  type CategoryStat, type Meta, type OtherTx, type Overview, type TxStatus, type TypeKey,
} from '@/lib/otherTransactionStore';
import { btnOutline, btnPrimary, btnSmall, Card, EmptyRow, inputCls, Menu, MenuItem } from '@/components/arap/arapUi';
import { JournalLines, KpiGrid, tabCls, tabNavCls, tdCls } from '@/components/shared/moduleUi';
import {
  cocok, createHref, editHref, EDITABLE, runBulk, SearchBox, StatusPill, TransactionDrawer, TYPE_ORDER, TYPE_UI, TypeIcon,
} from './otherUi';
import TemplatesModal from './TemplatesModal';
import OtherImportModal from './OtherImportModal';

type Tab = 'overview' | 'categories' | 'review' | 'preview' | 'exceptions' | 'posted';
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'review', label: 'Review Queue', icon: Clock },
  { id: 'preview', label: 'Journal Preview', icon: FileText },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'posted', label: 'Posted', icon: CircleCheck },
];

interface Ctx { clientId: string; meta: Meta | null; txs: OtherTx[]; loading: boolean; error: string | null; open: (id: string) => void }

function OtherWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as Tab) || 'overview';
  const goTab = useCallback((t: Tab) => router.replace(t === 'overview' ? pathname : `${pathname}?tab=${t}`, { scroll: false }), [pathname, router]);
  const meta = useOtherTxData<Meta | null>(kid ? `otmeta:${kid}` : null, s => fetchMeta(kid as string, s), null);
  const txs = useOtherTxData<OtherTx[]>(kid ? `otx:${kid}` : null, s => fetchTransactions(kid as string, s), []);
  const [buka, setBuka] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'templates' | 'import'>(null);
  const [exporting, setExporting] = useState(false);
  const review = txs.data.filter(t => t.status === 'pending_review').length;
  const exceptions = txs.data.filter(t => !['posted', 'reversed'].includes(t.status) && t.issues.length).length;

  const ekspor = async (format: ExportFormat) => {
    if (!txs.data.length) { toast.info('There are no transactions to export.'); return; }
    setExporting(true);
    try {
      await downloadTable(format, {
        title: 'Other Transactions', clientName: meta.data?.client_name || '', fileName: `other-transactions-${todayIso()}`, orientation: 'landscape',
        rows: txs.data,
        columns: [
          { header: 'Transaction ID', value: t => t.journal_no }, { header: 'Date', value: t => fmtDate(t.journal_date) },
          { header: 'Type', value: t => t.type_name }, { header: 'Subtype', value: t => t.subtype_label },
          { header: 'Counterparty', value: t => t.counterparty }, { header: 'Reference', value: t => t.reference_no },
          { header: 'Description', value: t => t.description }, { header: 'Amount (IDR)', value: t => t.amount_idr, type: 'money' },
          { header: 'Status', value: t => t.status_label },
          { header: 'Journal', value: t => t.lines.map(l => `${l.debit ? 'Dr' : 'Cr'} ${l.account_code} ${(l.debit || l.credit).toLocaleString('id-ID')}`).join('; ') },
        ],
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const ctx: Ctx | null = kid ? { clientId: kid, meta: meta.data, txs: txs.data, loading: txs.loading && !txs.data.length, error: txs.error || meta.error, open: setBuka } : null;
  const templates = (meta.data?.templates ?? []).filter(t => t.is_active);

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0B5E5C] sm:text-3xl">Other Transactions</h1>
            <p className="mt-1 text-sm text-muted-foreground">Special business events outside Sales, Purchase, and Cash &amp; Bank.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Menu width="w-72" button={() => (
              <button type="button" disabled={!kid} className={`${btnPrimary} bg-[#0E2F26] hover:bg-[#0B5E5C]`}><Plus size={16} /> Create Transaction <ChevronDown size={14} /></button>
            )}>
              {close => <>
                {(templates.length ? templates : []).map(t => (
                  <MenuItem key={t.id} href={createHref(t.type_key, t.id)} onClick={close}>
                    <TypeIcon type={t.type_key} /> <span className="flex-1">{t.name}</span>{!t.is_system && <span className="text-[10px] text-muted-foreground">Custom</span>}
                  </MenuItem>
                ))}
                {!templates.length && <p className="px-3 py-2 text-xs text-muted-foreground">Loading templates...</p>}
              </>}
            </Menu>
            <button type="button" disabled={!kid} onClick={() => setModal('templates')} className={btnOutline}><FileText size={16} /> Transaction Templates</button>
            <button type="button" disabled={!kid} onClick={() => setModal('import')} className={btnOutline}><Upload size={16} /> Import</button>
            <Menu width="w-44" button={() => (
              <button type="button" disabled={!kid || exporting} className={btnOutline}>{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export</button>
            )}>
              {close => <>
                <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel (.xlsx)</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
              </>}
            </Menu>
          </div>
        </div>
        <nav className={tabNavCls}>
          {TABS.map(t => {
            const n = t.id === 'review' ? review : t.id === 'exceptions' ? exceptions : 0;
            return (
              <button key={t.id} type="button" onClick={() => goTab(t.id)} className={tabCls(t.id === tab)}>
                <t.icon size={16} /> {t.label}
                {n > 0 && <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{n}</span>}
              </button>
            );
          })}
        </nav>
        {!kid && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}
        {ctx?.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ctx.error}</div>}
        {ctx && tab === 'overview' && <OverviewTab {...ctx} onTemplates={() => setModal('templates')} />}
        {ctx && tab === 'categories' && <CategoriesTab {...ctx} />}
        {ctx && tab === 'review' && <ReviewTab {...ctx} />}
        {ctx && tab === 'preview' && <PreviewTab {...ctx} />}
        {ctx && tab === 'exceptions' && <ExceptionsTab {...ctx} />}
        {ctx && tab === 'posted' && <PostedTab {...ctx} />}
      </div>
      {kid && <TransactionDrawer clientId={kid} txId={buka} canPost={!!meta.data?.can_post} onClose={() => setBuka(null)} />}
      {kid && modal === 'templates' && meta.data && <TemplatesModal clientId={kid} meta={meta.data} onClose={() => setModal(null)} />}
      {kid && modal === 'import' && meta.data && <OtherImportModal clientId={kid} meta={meta.data} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function OtherPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><OtherWorkspace /></React.Suspense>;
}

// ============================================================
// TABEL TRANSAKSI (dipakai beberapa tab)
// ============================================================

function TxTable({ rows, loading, open, empty, select, extra }: {
  rows: OtherTx[]; loading?: boolean; open: (id: string) => void; empty: string;
  select?: { ids: Set<string>; toggle: (id: string) => void; all: () => void };
  extra?: (t: OtherTx) => React.ReactNode;
}) {
  const cols = 8 + (select ? 1 : 0) + (extra ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead><tr className="bg-slate-50 text-left text-xs text-muted-foreground">
          {select && <th className="w-8 px-3 py-2.5"><input type="checkbox" checked={!!rows.length && rows.every(r => select.ids.has(r.id))} onChange={select.all} /></th>}
          <th className="px-3 py-2.5 font-medium">Transaction ID</th><th className="px-3 py-2.5 font-medium">Date</th>
          <th className="px-3 py-2.5 font-medium">Type</th><th className="px-3 py-2.5 font-medium">Counterparty</th>
          <th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 font-medium">Status</th>
          <th className="px-3 py-2.5 font-medium">Journal Result</th>
          {extra && <th className="px-3 py-2.5 font-medium">Notes</th>}
          <th className="px-3 py-2.5" />
        </tr></thead>
        <tbody className="divide-y divide-border">
          {!rows.length ? <EmptyRow cols={cols} text={empty} loading={loading} /> : rows.map(t => (
            <tr key={t.id} className="hover:bg-slate-50/60">
              {select && <td className="px-3 py-2.5"><input type="checkbox" checked={select.ids.has(t.id)} onChange={() => select.toggle(t.id)} /></td>}
              <td className={`${tdCls} font-mono text-xs`}><button type="button" onClick={() => open(t.id)} className="hover:text-[#0F7D4E] hover:underline">{t.journal_no}</button></td>
              <td className={`${tdCls} whitespace-nowrap text-xs`}>{fmtDate(t.journal_date)}</td>
              <td className={tdCls}><span className="flex items-center gap-2"><TypeIcon type={t.type_key} /><span className="text-xs"><b className="font-medium">{t.type_name}</b><span className="block text-muted-foreground">{t.subtype_label}</span></span></span></td>
              <td className={`${tdCls} text-xs`}>{t.counterparty || '—'}</td>
              <td className={`${tdCls} whitespace-nowrap text-right text-xs font-medium`}>{rupiah(t.amount_idr)}</td>
              <td className={tdCls}><StatusPill s={t.status} /></td>
              <td className={`${tdCls} text-xs`}>{['posted', 'reversed'].includes(t.status)
                ? <span className="inline-flex items-center gap-1 font-mono"><FileText size={13} className="text-muted-foreground" />{t.journal_no}</span>
                : <span className="text-muted-foreground">—</span>}</td>
              {extra && <td className={`${tdCls} text-xs`}>{extra(t)}</td>}
              <td className={`${tdCls} text-right`}>
                <span className="inline-flex gap-1">
                  {EDITABLE.includes(t.status) && t.source !== 'legacy' && <Link href={editHref(t.id)} className={btnSmall}>Edit</Link>}
                  <button type="button" onClick={() => open(t.id)} className={btnSmall}><Eye size={13} /></button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useSelect(rows: OtherTx[]) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const aktif = new Set([...ids].filter(i => rows.some(r => r.id === i)));
  return {
    ids: aktif,
    toggle: (id: string) => setIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    all: () => setIds(aktif.size === rows.length ? new Set() : new Set(rows.map(r => r.id))),
    clear: () => setIds(new Set()),
  };
}

function Filters({ q, setQ, type, setType, status, setStatus, statuses }: {
  q: string; setQ: (v: string) => void; type: '' | TypeKey; setType: (v: '' | TypeKey) => void;
  status?: '' | TxStatus; setStatus?: (v: '' | TxStatus) => void; statuses?: TxStatus[];
}) {
  return (
    <div className="flex flex-col gap-2 px-5 pb-3 sm:flex-row">
      <SearchBox value={q} onChange={setQ} placeholder="Search transactions, counterparty, or reference..." className="flex-1" />
      <select value={type} onChange={e => setType(e.target.value as '' | TypeKey)} className={`${inputCls} sm:w-56`}>
        <option value="">All types</option>
        {TYPE_ORDER.map(k => <option key={k} value={k}>{TYPE_UI[k].title}</option>)}
      </select>
      {setStatus && statuses && (
        <select value={status} onChange={e => setStatus(e.target.value as '' | TxStatus)} className={`${inputCls} sm:w-44`}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s === 'pending_review' ? 'Under Review' : s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      )}
    </div>
  );
}

// ============================================================
// OVERVIEW
// ============================================================

const PIPELINE = [
  ['Select Type', 'Choose transaction template'], ['Enter Details', 'Fill in transaction information'],
  ['Review Rules', 'System applies accounting rules'], ['Approval', 'Send for approval (if required)'], ['Post to GL', 'Generate and post journal entry'],
];

function OverviewTab({ clientId, meta, open, onTemplates }: Ctx & { onTemplates: () => void }) {
  const [months, setMonths] = useState(6);
  const ov = useOtherTxData<Overview | null>(`otov:${clientId}:${months}`, s => fetchOverview(clientId, months, s), null);
  const d = ov.data;
  const templates = (d?.templates ?? meta?.templates ?? []).filter(t => t.is_active);
  return (
    <div className="space-y-5">
      <Card title="Quick Create by Transaction Type" subtitle="Choose a business event template to get started. Each template comes with predefined rules and account mappings."
        action={<button type="button" onClick={onTemplates} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F7D4E]">View all templates <ArrowRight size={13} /></button>}>
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {(templates.length ? templates.filter(t => t.is_system) : []).map(t => {
            const u = TYPE_UI[t.type_key];
            return (
              <Link key={t.id} href={createHref(t.type_key, t.id)} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${u.card}`}>
                <TypeIcon type={t.type_key} size="md" />
                <p className="mt-3 text-sm font-semibold text-foreground">{t.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </Link>
            );
          })}
          {!templates.length && [0, 1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      </Card>

      <Card title="Transaction Pipeline" subtitle="From business event to automated journal entry.">
        <div className="flex flex-col gap-3 px-5 pb-5 lg:flex-row lg:items-center">
          {PIPELINE.map(([t, s], i) => (
            <React.Fragment key={t}>
              <div className="flex flex-1 items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === 0 ? 'bg-[#0F7D4E] text-white' : 'bg-slate-100 text-foreground'}`}>{i + 1}</span>
                <div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-muted-foreground">{s}</p></div>
              </div>
              {i < PIPELINE.length - 1 && <ArrowRight size={18} className="hidden shrink-0 text-muted-foreground lg:block" />}
            </React.Fragment>
          ))}
        </div>
      </Card>

      <KpiGrid cols={5} loading={ov.loading && !d} cards={[
        { label: 'Total Transactions', value: String(d?.kpi.total ?? 0), icon: LayoutGrid, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">{d?.kpi.draft ?? 0} draft</span> },
        { label: 'Under Review', value: String(d?.kpi.pending_review ?? 0), icon: Clock, tone: 'blue', delta: <span className="text-[11px] text-muted-foreground">Waiting for approval</span> },
        { label: 'Ready to Post', value: String(d?.kpi.approved ?? 0), icon: CheckCircle2, tone: 'amber', delta: <span className="text-[11px] text-muted-foreground">Approved, not posted yet</span> },
        { label: 'Posted', value: String(d?.kpi.posted ?? 0), icon: CircleCheck, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">{rupiah(d?.kpi.posted_amount)}</span> },
        { label: 'Exceptions', value: String(d?.kpi.exceptions ?? 0), icon: AlertTriangle, tone: 'red', delta: <span className="text-[11px] text-muted-foreground">Need attention before posting</span> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Recent Other Transactions"
          action={<Link href="/transactions/other?tab=posted" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F7D4E]">View all <ArrowRight size={13} /></Link>}>
          <TxTable rows={d?.recent ?? []} loading={ov.loading && !d} open={open} empty="No other transactions yet. Pick a template above to create one." />
        </Card>
        <div className="space-y-5 xl:col-span-2">
          <Card title="Other Transactions by Month" action={
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs">
              <option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
            </select>
          }>
            <div className="h-60 px-3 pb-4">
              {!d?.trend.some(t => t.count) ? <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No transactions in this period.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.trend} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={m => fmtMonth(String(m))} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="n" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={28} />
                    <YAxis yAxisId="rp" orientation="right" tickFormatter={v => rupiahShort(Number(v))} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip formatter={(v: number, n: string) => (n === 'Total Amount (Rp)' ? rupiah(v) : v)} labelFormatter={m => fmtMonth(String(m))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="n" dataKey="count" name="Number of Transactions" fill="#BBF7D0" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="rp" type="monotone" dataKey="amount" name="Total Amount (Rp)" stroke="#0F7D4E" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Card title="Rule Mapping Summary" action={<button type="button" onClick={onTemplates} className="text-muted-foreground"><ChevronRight size={16} /></button>}>
              <dl className="space-y-2 px-5 pb-5 text-xs">
                {[['Active Rules', d?.rules.active_rules], ['Transaction Templates', d?.rules.templates], ['Auto-Post Enabled', d?.rules.auto_post],
                  ['Requires Approval', d?.rules.requires_approval]].map(([l, v]) => (
                  <div key={String(l)} className="flex justify-between"><dt className="text-muted-foreground">{l}</dt><dd className="font-semibold">{v ?? 0}</dd></div>
                ))}
                {!!d?.rules.incomplete && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{d.rules.incomplete} rule(s) have no default account yet.</p>}
              </dl>
            </Card>
            <Card title="Top Categories" action={<Link href="/transactions/other?tab=categories" className="text-muted-foreground"><ChevronRight size={16} /></Link>}>
              <ul className="space-y-2 px-5 pb-5 text-xs">
                {!d?.top_categories.length && <li className="text-muted-foreground">No data yet.</li>}
                {d?.top_categories.map(c => (
                  <li key={c.type_key} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: TYPE_UI[c.type_key].dot }} />
                    <span className="flex-1 truncate">{c.type_name}</span><b>{c.count}</b><span className="w-10 text-right text-muted-foreground">{c.share}%</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Pending Review" action={<Link href="/transactions/other?tab=review" className="text-muted-foreground"><ChevronRight size={16} /></Link>}>
            <ul className="divide-y divide-border px-5 pb-4 text-xs">
              {!d?.pending.length && <li className="py-2 text-muted-foreground">Nothing is waiting for review.</li>}
              {d?.pending.map(t => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <TypeIcon type={t.type_key} />
                  <button type="button" onClick={() => open(t.id)} className="flex-1 truncate text-left"><b className="font-mono font-medium">{t.journal_no}</b> · {t.counterparty || t.type_name}</button>
                  <span className="font-medium">{rupiah(t.amount_idr)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CATEGORIES
// ============================================================

function CategoriesTab({ clientId, txs, loading, open }: Ctx) {
  const cat = useOtherTxData<CategoryStat[]>(`otcat:${clientId}`, s => fetchCategories(clientId, s), []);
  const [type, setType] = useState<'' | TypeKey>('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const rows = txs.filter(t => (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(cat.data.length ? cat.data : []).map(c => {
          const u = TYPE_UI[c.type_key];
          const aktif = type === c.type_key;
          return (
            <div key={c.type_key} className={`rounded-2xl border p-4 shadow-sm ${aktif ? 'border-[#0F7D4E] ring-2 ring-[#22C55E]/20' : 'border-border'} bg-card`}>
              <div className="flex items-start gap-3">
                <TypeIcon type={c.type_key} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-slate-50 py-1.5"><p className="font-bold">{c.count}</p><p className="text-[10px] text-muted-foreground">Total</p></div>
                <div className="rounded-lg bg-emerald-50 py-1.5"><p className="font-bold text-emerald-700">{c.posted}</p><p className="text-[10px] text-muted-foreground">Posted</p></div>
                <div className="rounded-lg bg-amber-50 py-1.5"><p className="font-bold text-amber-700">{c.in_progress}</p><p className="text-[10px] text-muted-foreground">In Progress</p></div>
              </div>
              <ul className="mt-3 space-y-1 text-[11px]">
                {c.subtypes.map(s => (
                  <li key={s.subtype} className="flex justify-between gap-2"><span className="truncate text-muted-foreground">{s.label}</span><span>{s.count} · {rupiahShort(s.amount)}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Posted value <b className="text-foreground">{rupiah(c.posted_amount)}</b>{c.last_date ? ` · last ${fmtDate(c.last_date)}` : ''}</p>
              <div className="mt-3 flex gap-2">
                <Link href={createHref(c.type_key, c.templates.find(t => t.is_system)?.id)} className={`${btnSmall} border-transparent ${u.iconBg}`}><Plus size={12} /> Create</Link>
                <button type="button" onClick={() => setType(aktif ? '' : c.type_key)} className={btnSmall}>{aktif ? 'Show all' : 'View transactions'}</button>
              </div>
            </div>
          );
        })}
        {!cat.data.length && [0, 1, 2, 3].map(i => <div key={i} className="h-64 animate-pulse rounded-2xl bg-slate-100" />)}
      </div>
      <Card title={type ? `${TYPE_UI[type].title} Transactions` : 'All Other Transactions'} subtitle={`${rows.length} transaction(s)`}>
        <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus}
          statuses={['draft', 'pending_review', 'approved', 'rejected', 'posted', 'reversed']} />
        <TxTable rows={rows} loading={loading} open={open} empty="No transactions match the filter." />
      </Card>
    </div>
  );
}

// ============================================================
// REVIEW QUEUE
// ============================================================

function ReviewTab({ clientId, meta, txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [alasan, setAlasan] = useState<string | null>(null);
  const filt = (t: OtherTx) => (!type || t.type_key === type) && cocok(t, q);
  const antre = txs.filter(t => t.status === 'pending_review' && filt(t));
  const siap = txs.filter(t => t.status === 'approved' && filt(t));
  const sel = useSelect(antre);
  const selPost = useSelect(siap);
  const jalan = async (label: string, fn: () => Promise<boolean>, clear: () => void) => {
    setBusy(label);
    if (await fn()) clear();
    setBusy(null);
  };
  const hari = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
  return (
    <div className="space-y-5">
      <Card title="Waiting for Review" subtitle="Transactions submitted for approval. Approve to make them ready for posting, or reject with a reason."
        action={<>
          <button type="button" disabled={!sel.ids.size || !!busy} onClick={() => setAlasan('')} className={`${btnOutline} text-rose-600`}>Reject</button>
          <button type="button" disabled={!sel.ids.size || !!busy} onClick={() => jalan('approve', () => runBulk(clientId, 'approve', [...sel.ids]), sel.clear)} className={btnPrimary}>
            {busy === 'approve' && <Loader2 size={14} className="animate-spin" />} Approve {sel.ids.size ? `(${sel.ids.size})` : ''}
          </button>
        </>}>
        <Filters q={q} setQ={setQ} type={type} setType={setType} />
        <TxTable rows={antre} loading={loading} open={open} empty="Nothing is waiting for review." select={sel}
          extra={t => {
            const n = hari(t.submitted_at);
            return <span className={t.has_error ? 'text-rose-600' : 'text-muted-foreground'}>
              {t.has_error ? t.issues.find(i => i.level === 'error')?.message : `By ${t.submitted_by_name ?? '—'}${n !== null ? ` · ${n} day(s) ago` : ''}`}
            </span>;
          }} />
      </Card>
      <Card title="Approved — Ready to Post" subtitle={meta?.can_post ? 'Post approved transactions to the General Ledger.' : 'Posting requires Manager level or above.'}
        action={meta?.can_post && (
          <button type="button" disabled={!selPost.ids.size || !!busy} onClick={() => jalan('post', () => runBulk(clientId, 'post', [...selPost.ids]), selPost.clear)} className={btnPrimary}>
            {busy === 'post' && <Loader2 size={14} className="animate-spin" />} Post to GL {selPost.ids.size ? `(${selPost.ids.size})` : ''}
          </button>
        )}>
        <TxTable rows={siap} loading={loading} open={open} empty="No approved transactions waiting to be posted." select={meta?.can_post ? selPost : undefined}
          extra={t => <span className="text-muted-foreground">Approved by {t.approved_by_name ?? '—'}</span>} />
      </Card>
      {alasan !== null && (
        <RejectModal count={sel.ids.size} onClose={() => setAlasan(null)}
          onConfirm={async r => { await jalan('reject', () => runBulk(clientId, 'reject', [...sel.ids], r), sel.clear); setAlasan(null); }} />
      )}
    </div>
  );
}

function RejectModal({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [r, setR] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Reject {count} transaction(s)</h3>
        <p className="mt-1 text-xs text-muted-foreground">The submitter can edit and resubmit after rejection.</p>
        <textarea value={r} onChange={e => setR(e.target.value)} rows={3} maxLength={2000} placeholder="Reason" className={`${inputCls} mt-4`} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" disabled={busy || r.trim().length < 3} onClick={async () => { setBusy(true); await onConfirm(r.trim()); setBusy(false); }}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />} Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// JOURNAL PREVIEW
// ============================================================

function PreviewTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const rows = txs.filter(t => !['posted', 'reversed'].includes(t.status) && (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  const seimbang = rows.filter(t => t.lines.length && t.total_debit === t.total_credit).length;
  return (
    <Card title="Journal Preview" subtitle={`Journals generated from the template rules for transactions not posted yet — ${seimbang} of ${rows.length} balanced.`}>
      <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus} statuses={['draft', 'pending_review', 'approved', 'rejected']} />
      <div className="grid grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-2">
        {loading && [0, 1].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100" />)}
        {!loading && !rows.length && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No unposted transactions.</p>}
        {rows.map(t => {
          const ok = t.lines.length > 0 && t.total_debit === t.total_credit;
          return (
            <div key={t.id} className="rounded-2xl border border-border p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <button type="button" onClick={() => open(t.id)} className="flex items-center gap-2 text-left">
                  <TypeIcon type={t.type_key} />
                  <span className="text-xs"><b className="font-mono text-sm">{t.journal_no}</b><span className="block text-muted-foreground">{t.subtype_label} · {fmtDate(t.journal_date)} · {t.counterparty || '—'}</span></span>
                </button>
                <span className="flex items-center gap-1.5">
                  <StatusPill s={t.status} />
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{ok ? 'Balanced' : 'Not balanced'}</span>
                </span>
              </div>
              {t.lines.length ? <JournalLines lines={t.lines} /> : <p className="py-3 text-xs text-muted-foreground">No journal lines yet — complete the accounts.</p>}
              {t.issues.some(i => i.level === 'error') && <p className="mt-2 text-[11px] text-rose-600">{t.issues.find(i => i.level === 'error')?.message}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ============================================================
// EXCEPTIONS
// ============================================================

function ExceptionsTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [level, setLevel] = useState<'' | 'error' | 'warning'>('');
  const rows = useMemo(() => txs.filter(t => !['posted', 'reversed'].includes(t.status) && t.issues.length
    && (!level || t.issues.some(i => i.level === level)) && (!type || t.type_key === type) && cocok(t, q)), [txs, level, type, q]);
  const nErr = txs.filter(t => !['posted', 'reversed'].includes(t.status) && t.has_error).length;
  const nWarn = txs.filter(t => !['posted', 'reversed'].includes(t.status) && !t.has_error && t.issues.length).length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button type="button" onClick={() => setLevel(level === 'error' ? '' : 'error')} className={`rounded-2xl border p-4 text-left ${level === 'error' ? 'border-rose-300 bg-rose-50' : 'border-rose-100 bg-rose-50/40'}`}>
          <p className="text-xs text-muted-foreground">Blocking errors</p><p className="text-2xl font-bold text-rose-600">{nErr}</p>
          <p className="text-[11px] text-muted-foreground">Cannot be submitted, approved or posted until fixed</p>
        </button>
        <button type="button" onClick={() => setLevel(level === 'warning' ? '' : 'warning')} className={`rounded-2xl border p-4 text-left ${level === 'warning' ? 'border-amber-300 bg-amber-50' : 'border-amber-100 bg-amber-50/40'}`}>
          <p className="text-xs text-muted-foreground">Warnings only</p><p className="text-2xl font-bold text-amber-600">{nWarn}</p>
          <p className="text-[11px] text-muted-foreground">Can be posted, but should be reviewed</p>
        </button>
      </div>
      <Card title="Exceptions" subtitle="Unposted transactions with findings: missing accounts, closed periods, inactive or unmapped accounts, overdue reviews.">
        <Filters q={q} setQ={setQ} type={type} setType={setType} />
        <TxTable rows={rows} loading={loading} open={open} empty="No exceptions. All unposted transactions passed the checks."
          extra={t => (
            <ul className="space-y-0.5">
              {t.issues.slice(0, 3).map(i => <li key={i.message} className={i.level === 'error' ? 'text-rose-600' : 'text-amber-700'}>{i.message}</li>)}
              {t.issues.length > 3 && <li className="text-muted-foreground">+{t.issues.length - 3} more</li>}
            </ul>
          )} />
      </Card>
    </div>
  );
}

// ============================================================
// POSTED
// ============================================================

function PostedTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const semua = txs.filter(t => ['posted', 'reversed'].includes(t.status));
  const rows = semua.filter(t => (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  const posted = semua.filter(t => t.status === 'posted');
  const total = posted.reduce((n, t) => n + t.amount_idr, 0);
  const bulanIni = todayIso().slice(0, 7);
  return (
    <div className="space-y-5">
      <KpiGrid cols={4} cards={[
        { label: 'Posted Transactions', value: String(posted.length), icon: CircleCheck, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">In the General Ledger</span> },
        { label: 'Posted Value', value: rupiah(total), icon: FileText, tone: 'blue', delta: <span className="text-[11px] text-muted-foreground">All posted transactions</span> },
        { label: 'Posted This Month', value: String(posted.filter(t => t.journal_date.startsWith(bulanIni)).length), icon: Clock, tone: 'amber', delta: <span className="text-[11px] text-muted-foreground">{fmtMonth(bulanIni)}</span> },
        { label: 'Reversed', value: String(semua.length - posted.length), icon: AlertTriangle, tone: 'red', delta: <span className="text-[11px] text-muted-foreground">Reversing journal RV- posted</span> },
      ]} />
      <Card title="Posted Transactions" subtitle="Other transactions posted to the General Ledger (source: Other).">
        <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus} statuses={['posted', 'reversed']} />
        <TxTable rows={rows} loading={loading} open={open} empty="No posted transactions yet."
          extra={t => <span className="text-muted-foreground">{t.status === 'reversed' ? `Reversed ${fmtDate(t.reversal_date)}` : `By ${t.posted_by_name ?? '—'}`}</span>} />
      </Card>
    </div>
  );
}
