'use client';

// Halaman Transactions > Other (layout dataset/picture/Template UI/other/1-7.png):
// tab Overview, Source Data, Other Transaction, Journal Preview, Exceptions, Posted.
// Backend: modules/transactions/other_v1.py.

import React, { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, CheckCircle2, ChevronRight, CircleCheck, Clock, Database, Download, Eye, FileText, Inbox, LayoutGrid, Plus, Receipt, Send,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fmtDate, fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import {
  fetchOtherJournals, fetchOtherOverview, fetchOtherPosted, fetchOtherSource, OTHER_STATUS, useOtherData,
  type OtherJournal, type OtherOverview, type OtherStatus, type PostedData, type SourceData,
} from '@/lib/otherJournalStore';
import { btnOutline, btnPrimary, Card, EmptyRow, inputCls } from '@/components/arap/arapUi';
import { KpiGrid, Pill, tabCls, tabNavCls, tdCls } from '@/components/shared/moduleUi';
import { cocok, exportJournalsCsv, JournalDetail, JournalFormModal, runAction, SearchBox, StatusPill } from './otherUi';

type Tab = 'overview' | 'source' | 'transactions' | 'preview' | 'exceptions' | 'posted';
const TABS: { id: Tab; label: string; icon: React.ElementType; subtitle: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, subtitle: 'Summary of other journals (outside Sales, Purchase and Cash & Bank) — add journals, approve, then post to the General Ledger.' },
  { id: 'source', label: 'Source Data', icon: Database, subtitle: 'Source lines of Other transactions (general journal, CapEx and uncategorized items) before they are posted.' },
  { id: 'transactions', label: 'Other Transaction', icon: FileText, subtitle: 'Other journals by journal number, integrated with the accounting journal.' },
  { id: 'preview', label: 'Journal Preview', icon: Eye, subtitle: 'Preview Other journals that are not posted yet — check that debit and credit balance.' },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle, subtitle: 'Other journals that need review: unbalanced, still in draft, closed period, or accounts not mapped.' },
  { id: 'posted', label: 'Posted', icon: CircleCheck, subtitle: 'Other journals that have been posted to the accounting system.' },
];
const WARNA = ['#0B5E5C', '#0F7D4E', '#22C55E', '#86EFAC', '#BFDBFE', '#CBD5E1'];

interface TabProps { clientId: string; onNew: () => void; onEdit: (j: OtherJournal) => void }

function OtherWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as Tab) || 'overview';
  const [form, setForm] = useState<{ j: OtherJournal | null } | null>(null);
  const goTab = useCallback((t: Tab) => router.replace(t === 'overview' ? pathname : `${pathname}?tab=${t}`, { scroll: false }), [pathname, router]);
  const meta = TABS.find(t => t.id === tab) ?? TABS[0];
  const props: TabProps | null = kid ? { clientId: kid, onNew: () => setForm({ j: null }), onEdit: j => setForm({ j }) } : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0B5E5C] sm:text-3xl">Other</h1>
          <p className="mt-1 text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>
        <nav className={tabNavCls}>
          {TABS.map(t => {
            const aktif = t.id === tab;
            return (
              <button key={t.id} type="button" onClick={() => goTab(t.id)} className={tabCls(aktif)}>
                <t.icon size={16} /> {t.label}
              </button>
            );
          })}
        </nav>
        {!kid && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}
        {props && tab === 'overview' && <OverviewTab {...props} />}
        {props && tab === 'source' && <SourceTab {...props} />}
        {props && tab === 'transactions' && <TransactionsTab {...props} />}
        {props && tab === 'preview' && <PreviewTab {...props} />}
        {props && tab === 'exceptions' && <ExceptionsTab {...props} />}
        {props && tab === 'posted' && <PostedTab {...props} />}
      </div>
      {kid && form && <JournalFormModal clientId={kid} journal={form.j} onClose={() => setForm(null)} />}
    </div>
  );
}

export default function OtherPage() {
  return <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}><OtherWorkspace /></React.Suspense>;
}

// ============================================================
// OVERVIEW
// ============================================================

function OverviewTab({ clientId, onNew, onEdit }: TabProps) {
  const ov = useOtherData<OtherOverview | null>(`oov:${clientId}`, s => fetchOtherOverview(clientId, s), null);
  const [cari, setCari] = useState('');
  const [status, setStatus] = useState<'' | OtherStatus>('');
  const [buka, setBuka] = useState<string | null>(null);
  const d = ov.data;
  const k = d?.kpi;
  const js = (d?.journals ?? []).filter(j => cocok(j, cari) && (!status || j.status === status));
  const draft = (d?.journals ?? []).filter(j => j.status === 'draft').map(j => j.id);
  const approved = (d?.journals ?? []).filter(j => j.status === 'approved').map(j => j.id);
  const dipilih = d?.journals.find(j => j.id === buka) ?? null;

  return (
    <div className="space-y-5">
      {ov.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ov.error}</div>}
      <KpiGrid cols={5} loading={ov.loading && !d} cards={[
        { label: 'Total Other', value: rupiah(k?.total), icon: LayoutGrid, tone: 'blue', delta: <span className="text-[11px] text-muted-foreground">Approved and posted journals</span> },
        { label: 'Transactions', value: String(k?.count ?? 0), icon: FileText, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">Journals</span> },
        { label: 'Average / Transaction', value: rupiah(k?.average), icon: Receipt, tone: 'blue', delta: <span className="text-[11px] text-muted-foreground">Per journal</span> },
        { label: 'Not Posted Yet', value: String(k?.unposted ?? 0), icon: Clock, tone: 'amber',
          delta: <span className="text-[11px] text-muted-foreground">{k?.draft_count ?? 0} draft · {rupiah(k?.draft_total)}</span> },
        { label: 'Needs Review', value: String(k?.needs_review ?? 0), icon: AlertTriangle, tone: 'red', delta: <span className="text-[11px] text-muted-foreground">Journals with findings</span> },
      ]} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Monthly Other Trend" subtitle="Approved and posted Other journals">
          <div className="h-60 px-3 pb-4">
            {!d?.trend.some(t => t.total) ? <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No Other transactions to show yet.</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.trend} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                  <defs><linearGradient id="othTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0F7D4E" stopOpacity={0.25} /><stop offset="100%" stopColor="#0F7D4E" stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={m => fmtMonth(m).slice(0, 3)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                  <Area type="monotone" dataKey="total" name="Other" stroke="#0F7D4E" strokeWidth={2} fill="url(#othTrend)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card title="Other by Category" subtitle="Breakdown of other transactions">
          <div className="flex flex-col items-center gap-3 px-5 pb-5">
            {!d?.by_category.length ? <p className="py-10 text-sm text-muted-foreground">No data yet.</p> : <>
              <div className="h-36 w-36"><ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={d.by_category} dataKey="amount" nameKey="category" innerRadius={42} outerRadius={66} stroke="none">{d.by_category.map((_, i) => <Cell key={i} fill={WARNA[i % WARNA.length]} />)}</Pie>
                <Tooltip formatter={(v: number) => rupiah(v)} /></PieChart></ResponsiveContainer></div>
              <ul className="w-full space-y-1.5 text-xs">{d.by_category.map((c, i) => (
                <li key={c.category} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: WARNA[i % WARNA.length] }} /><span className="flex-1">{c.category}</span><b>{rupiah(c.amount)}</b></li>
              ))}</ul>
            </>}
          </div>
        </Card>
      </div>
      <Card title="Top Related Parties" subtitle="By amount">
        <div className="px-5 pb-5">
          {!d?.top_parties.length ? <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p> : (
            <div className="space-y-2">{d.top_parties.map(p => {
              const max = d.top_parties[0].amount || 1;
              return (
                <div key={p.party} className="flex items-center gap-3 text-sm">
                  <span className="w-56 truncate">{p.party}</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-[#0F7D4E]" style={{ width: `${(p.amount / max) * 100}%` }} /></div>
                  <span className="w-40 text-right font-medium">{rupiah(p.amount)}</span><span className="w-16 text-right text-xs text-muted-foreground">{p.count} jrn</span>
                </div>
              );
            })}</div>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-[#0B5E5C]">Other Journals</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
          <button type="button" disabled={!draft.length} onClick={() => runAction(clientId, 'approve', draft)} className={btnOutline}><CheckCircle2 size={15} /> Approve Drafts ({draft.length})</button>
          <button type="button" disabled={!approved.length} onClick={() => runAction(clientId, 'post', approved)} className={btnOutline}><Send size={15} /> Post Approved ({approved.length})</button>
          <button type="button" onClick={() => exportJournalsCsv(js, 'Other-Journals')} className={btnOutline}><Download size={15} /> Export CSV</button>
        </div>
      </div>
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <SearchBox value={cari} onChange={setCari} placeholder="Search journal no., party, description..." className="w-full max-w-sm" />
          <select value={status} onChange={e => setStatus(e.target.value as OtherStatus | '')} className={`${inputCls} w-44`}>
            <option value="">All statuses</option>{(Object.keys(OTHER_STATUS) as OtherStatus[]).map(s => <option key={s} value={s}>{OTHER_STATUS[s].label}</option>)}
          </select>
        </div>
        <JournalTable rows={js} loading={ov.loading && !d} onOpen={j => setBuka(j.id === buka ? null : j.id)} openId={buka} />
        {dipilih && <div className="border-t border-border p-5"><JournalDetail clientId={clientId} j={dipilih} onEdit={onEdit} onDone={() => setBuka(null)} /></div>}
      </section>
    </div>
  );
}

function JournalTable({ rows, loading, onOpen, openId }: { rows: OtherJournal[]; loading: boolean; onOpen: (j: OtherJournal) => void; openId?: string | null }) {
  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full min-w-[860px] text-sm">
        <thead><tr className="text-xs text-muted-foreground">{['Journal No.', 'Date', 'Category', 'Party / Reference', 'Description'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
          <th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 text-left font-medium">Status</th><th className="px-3 py-2.5 text-left font-medium">Checks</th></tr></thead>
        <tbody className="divide-y divide-border">
          {(loading || !rows.length) && <EmptyRow cols={8} loading={loading} text='No Other journals yet. Click "New Journal" to add one.' />}
          {!loading && rows.map(j => (
            <tr key={j.id} onClick={() => onOpen(j)} className={`cursor-pointer hover:bg-slate-50/60 ${openId === j.id ? 'bg-emerald-50/40' : ''}`}>
              <td className={`${tdCls} font-mono text-xs font-semibold`}>{j.journal_no}</td><td className={tdCls}>{fmtDate(j.journal_date)}</td><td className={tdCls}>{j.category_label}</td>
              <td className={tdCls}>{j.reference ?? '—'}</td><td className={`${tdCls} max-w-[260px] truncate`}>{j.description ?? '—'}</td>
              <td className={`${tdCls} text-right font-medium`}>{rupiah(j.amount)}</td><td className={tdCls}><StatusPill s={j.status} /></td>
              <td className={tdCls}>{j.status === 'posted' || j.status === 'reversed' ? '—' : j.has_error ? <Pill label="Needs fix" style="bg-rose-50 text-rose-700" />
                : j.issues.length ? <Pill label="Warning" style="bg-amber-50 text-amber-700" /> : <Pill label="OK" style="bg-emerald-50 text-emerald-700" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// SOURCE DATA
// ============================================================

function SourceTab({ clientId, onNew }: TabProps) {
  const sd = useOtherData<SourceData | null>(`osd:${clientId}`, s => fetchOtherSource(clientId, s), null);
  const [cari, setCari] = useState('');
  const [mode, setMode] = useState<'all' | 'problem' | 'clean'>('all');
  const [kat, setKat] = useState('');
  const d = sd.data;
  const q = d?.quality;
  const rows = useMemo(() => (d?.rows ?? []).filter(r => (mode === 'all' || (mode === 'problem' ? r.problems.length > 0 : !r.problems.length)) && (!kat || r.category === kat)
    && (!cari || [r.journal_no, r.account_code, r.account_name, r.reference, r.description].some(x => (x || '').toLowerCase().includes(cari.toLowerCase())))), [d, mode, kat, cari]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const Bar_ = ({ label, a, b, hint }: { label: string; a: number; b: number; hint: string }) => (
    <div>
      <div className="flex justify-between text-sm font-medium"><span>{label}</span><span className={b && a === b ? 'text-emerald-600' : 'text-rose-600'}>{b ? `${pct(a, b)}%` : '—'}</span></div>
      <div className="mt-2 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${a === b ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${pct(a, b)}%` }} /></div>
      <p className="mt-2 text-xs text-muted-foreground">{a} of {b} lines · {hint}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Source Data Quality" subtitle="How ready these lines are to be journalized"
          action={<div className="text-right"><p className="text-xl font-bold">{q?.total ?? 0}</p><p className="text-xs text-muted-foreground">lines · {q?.clean ?? 0} clean</p></div>}>
          <div className="grid grid-cols-1 gap-6 px-5 pb-5 md:grid-cols-2">
            <Bar_ label="Journal No. Completeness" a={q?.with_number ?? 0} b={q?.total ?? 0} hint="lines with a journal number" />
            <Bar_ label="Standard Account Mapping" a={q?.mapped ?? 0} b={q?.total ?? 0} hint="lines mapped to a standard COA account" />
          </div>
        </Card>
        <Card title="Source Composition" subtitle="Click to filter the table">
          <div className="space-y-1.5 px-5 pb-5">
            {!d?.composition.length && <p className="py-6 text-center text-sm text-muted-foreground">No source data yet.</p>}
            {d?.composition.map(c => (
              <button key={c.category} type="button" onClick={() => setKat(kat === c.category ? '' : c.category)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm ${kat === c.category ? 'bg-emerald-50 font-semibold text-[#0F7D4E]' : 'hover:bg-slate-50'}`}>
                <span>{c.category}</span><span>{c.count}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <SearchBox value={cari} onChange={setCari} placeholder="Search journal no., account, party..." className="w-full max-w-sm" />
          <div className="flex overflow-hidden rounded-xl border border-border text-sm">
            {([['all', 'All'], ['problem', 'With Issues'], ['clean', 'Clean']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMode(k)} className={`px-4 py-2 ${mode === k ? 'bg-[#0F7D4E] font-semibold text-white' : 'text-muted-foreground hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
            <button type="button" onClick={() => exportLinesCsv(rows)} className={btnOutline}><Download size={15} /> Export CSV</button>
          </div>
        </div>
        {(sd.loading && !d) || !rows.length ? (
          <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground"><Inbox size={22} />
            {sd.loading && !d ? 'Loading...' : d?.rows.length ? 'No lines match the filter.' : 'No Other data yet. Click "New Journal" to add one.'}</div>
        ) : (
          <div className="overflow-x-auto px-2">
            <table className="w-full min-w-[1000px] text-sm">
              <thead><tr className="text-xs text-muted-foreground">{['Journal No.', 'Date', 'Category', 'Party', 'Account', 'Description'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
                <th className="px-3 py-2.5 text-right font-medium">Debit</th><th className="px-3 py-2.5 text-right font-medium">Credit</th><th className="px-3 py-2.5 text-left font-medium">Status</th><th className="px-3 py-2.5 text-left font-medium">Quality</th></tr></thead>
              <tbody className="divide-y divide-border">{rows.map((r, i) => (
                <tr key={`${r.journal_id}-${i}`}>
                  <td className={`${tdCls} font-mono text-xs`}>{r.journal_no}</td><td className={tdCls}>{fmtDate(r.date)}</td><td className={tdCls}>{r.category}</td><td className={tdCls}>{r.reference ?? '—'}</td>
                  <td className={tdCls}><b>{r.account_code}</b> · {r.account_name}</td><td className={`${tdCls} max-w-[220px] truncate`}>{r.description ?? '—'}</td>
                  <td className={`${tdCls} text-right`}>{r.debit ? rupiah(r.debit) : ''}</td><td className={`${tdCls} text-right`}>{r.credit ? rupiah(r.credit) : ''}</td>
                  <td className={tdCls}><StatusPill s={r.status} /></td>
                  <td className={tdCls}>{r.problems.length ? <span className="text-xs text-rose-600" title={r.problems.join(', ')}>{r.problems[0]}</span> : <span className="text-xs text-emerald-700">Clean</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

async function exportLinesCsv(rows: SourceData['rows']) {
  const { downloadTable } = await import('@/lib/tableExport');
  await downloadTable('csv', { title: 'Other Source Data', clientName: '', rows, fileName: 'Other-Source-Data', columns: [
    { header: 'Journal No.', value: r => r.journal_no }, { header: 'Date', value: r => r.date }, { header: 'Category', value: r => r.category },
    { header: 'Party', value: r => r.reference }, { header: 'Account Code', value: r => r.account_code }, { header: 'Account Name', value: r => r.account_name },
    { header: 'Description', value: r => r.description }, { header: 'Debit', value: r => r.debit, type: 'money' }, { header: 'Credit', value: r => r.credit, type: 'money' },
    { header: 'Status', value: r => OTHER_STATUS[r.status].label }, { header: 'Issues', value: r => r.problems.join('; ') },
  ] });
}

// ============================================================
// OTHER TRANSACTION (daftar + detail)
// ============================================================

function TransactionsTab({ clientId, onNew, onEdit }: TabProps) {
  const data = useOtherData(`ojr:${clientId}`, s => fetchOtherJournals(clientId, s), null as Awaited<ReturnType<typeof fetchOtherJournals>> | null);
  const [cari, setCari] = useState('');
  const [status, setStatus] = useState<'' | OtherStatus>('');
  const [pilih, setPilih] = useState<string | null>(null);
  const semua = data.data?.journals ?? [];
  const js = semua.filter(j => cocok(j, cari) && (!status || j.status === status));
  const sel = semua.find(j => j.id === pilih) ?? null;
  const chips: { k: '' | OtherStatus; l: string }[] = [{ k: '', l: 'All' }, { k: 'draft', l: 'Draft' }, { k: 'approved', l: 'Approved' }, { k: 'posted', l: 'Posted' }, { k: 'rejected', l: 'Rejected' }];
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
        <button type="button" onClick={() => exportJournalsCsv(js, 'Other-Journals')} className={btnOutline}><Download size={15} /> Export CSV ({js.length})</button>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="rounded-2xl border border-border bg-card shadow-sm xl:col-span-2">
          <div className="space-y-3 border-b border-border p-4">
            <SearchBox value={cari} onChange={setCari} placeholder="Search journal no., party, description..." />
            <div className="flex flex-wrap gap-1.5">{chips.map(c => (
              <button key={c.l} type="button" onClick={() => setStatus(c.k)} className={`rounded-full px-3 py-1 text-xs ${status === c.k ? 'bg-[#0F7D4E] font-semibold text-white' : 'bg-slate-100 text-muted-foreground'}`}>
                {c.l} {c.k ? semua.filter(j => j.status === c.k).length : semua.length}</button>
            ))}</div>
          </div>
          <div className="max-h-[640px] divide-y divide-border overflow-y-auto">
            {!js.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{data.loading ? 'Loading...' : 'No Other journals yet. Click "New Journal" to add one.'}</p>}
            {js.map(j => (
              <button key={j.id} type="button" onClick={() => setPilih(j.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 ${pilih === j.id ? 'bg-emerald-50/50' : ''}`}>
                <span className="min-w-0 flex-1"><span className="block font-mono text-xs font-semibold">{j.journal_no}</span>
                  <span className="block truncate text-xs text-muted-foreground">{fmtDate(j.journal_date)} · {j.reference ?? j.description ?? j.category_label}</span></span>
                <span className="text-right"><span className="block text-sm font-medium">{rupiah(j.amount)}</span><StatusPill s={j.status} /></span>
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm xl:col-span-3">
          {sel ? <JournalDetail clientId={clientId} j={sel} onEdit={onEdit} onDone={() => setPilih(null)} />
            : <p className="py-24 text-center text-sm text-muted-foreground">Select a journal on the left to see its details.</p>}
        </section>
      </div>
    </div>
  );
}

// ============================================================
// JOURNAL PREVIEW
// ============================================================

function PreviewTab({ clientId, onNew, onEdit }: TabProps) {
  const data = useOtherData(`ojr:${clientId}`, s => fetchOtherJournals(clientId, s), null as Awaited<ReturnType<typeof fetchOtherJournals>> | null);
  const [cari, setCari] = useState('');
  const [tahap, setTahap] = useState<'' | 'draft' | 'fix' | 'ready'>('');
  const belum = (data.data?.journals ?? []).filter(j => ['draft', 'approved'].includes(j.status));
  const draft = belum.filter(j => j.status === 'draft' && !j.has_error);
  const perbaiki = belum.filter(j => j.has_error);
  const siap = belum.filter(j => j.status === 'approved' && !j.has_error);
  const tampil = belum.filter(j => cocok(j, cari) && (!tahap || (tahap === 'draft' ? draft.includes(j) : tahap === 'fix' ? perbaiki.includes(j) : siap.includes(j))));
  const kartu = [
    { k: 'draft' as const, cap: 'Waiting for approval', judul: 'Draft', n: draft.length, total: draft.reduce((a, j) => a + j.amount, 0), warna: 'text-violet-600' },
    { k: 'fix' as const, cap: 'Failed checks', judul: 'Needs Fix', n: perbaiki.length, total: perbaiki.reduce((a, j) => a + j.amount, 0), warna: 'text-rose-600' },
    { k: 'ready' as const, cap: 'Passed all checks', judul: 'Ready to Post', n: siap.length, total: siap.reduce((a, j) => a + j.amount, 0), warna: 'text-emerald-600' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {kartu.map((c, i) => (
          <React.Fragment key={c.k}>
            <button type="button" onClick={() => setTahap(tahap === c.k ? '' : c.k)} className={`rounded-2xl border bg-card p-5 text-left shadow-sm ${tahap === c.k ? 'border-[#22C55E] ring-2 ring-[#22C55E]/20' : 'border-border'}`}>
              <p className="text-xs text-muted-foreground">{c.cap}</p><p className="font-semibold">{c.judul}</p>
              <div className="mt-2 flex items-end justify-between"><span className={`text-2xl font-bold ${c.warna}`}>{c.n}</span><span className="font-mono text-xs text-muted-foreground">{rupiah(c.total)}</span></div>
            </button>
            {i < 2 && <ChevronRight className="hidden text-muted-foreground md:block" size={18} />}
          </React.Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={cari} onChange={setCari} placeholder="Search journal no., party, description..." className="w-full max-w-sm" />
        <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
        <button type="button" disabled={!draft.length} onClick={() => runAction(clientId, 'approve', draft.map(j => j.id))} className={btnOutline}><CheckCircle2 size={15} /> Approve All Drafts ({draft.length})</button>
        <button type="button" disabled={!siap.length} onClick={() => runAction(clientId, 'post', siap.map(j => j.id))} className={btnOutline}><Send size={15} /> Post All Ready ({siap.length})</button>
        <button type="button" onClick={() => exportJournalsCsv(tampil, 'Other-Journal-Preview')} className={btnOutline}><Download size={15} /> CSV</button>
        <span className="ml-auto text-xs text-muted-foreground">{tampil.length} voucher(s)</span>
      </div>
      {!tampil.length ? (
        <div className="rounded-2xl border border-border bg-card py-14 text-center text-sm text-muted-foreground shadow-sm">{data.loading ? 'Loading...' : 'No Other journals waiting to be posted.'}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {tampil.map(j => <section key={j.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><JournalDetail clientId={clientId} j={j} onEdit={onEdit} /></section>)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// EXCEPTIONS
// ============================================================

function ExceptionsTab({ clientId, onNew, onEdit }: TabProps) {
  const data = useOtherData(`ojr:${clientId}`, s => fetchOtherJournals(clientId, s), null as Awaited<ReturnType<typeof fetchOtherJournals>> | null);
  const [buka, setBuka] = useState<string | null>(null);
  const belum = (data.data?.journals ?? []).filter(j => !['posted', 'reversed'].includes(j.status));
  const temuan = belum.flatMap(j => [
    ...j.issues.map(i => ({ j, level: i.level, message: i.message })),
    ...(j.status === 'draft' ? [{ j, level: 'info' as const, message: 'Draft waiting for approval.' }] : []),
    ...(j.status === 'rejected' ? [{ j, level: 'warning' as const, message: `Rejected: ${j.rejected_reason ?? ''}` }] : []),
  ]);
  const draft = belum.filter(j => j.status === 'draft').map(j => j.id);
  const sel = belum.find(j => j.id === buka) ?? null;
  const gaya = { error: 'bg-rose-50 text-rose-700', warning: 'bg-amber-50 text-amber-700', info: 'bg-sky-50 text-sky-700' };
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
        <button type="button" disabled={!draft.length} onClick={() => runAction(clientId, 'approve', draft)} className={btnOutline}><CheckCircle2 size={15} /> Approve All Drafts ({draft.length})</button>
        <button type="button" onClick={() => exportJournalsCsv(Array.from(new Set(temuan.map(t => t.j))), 'Other-Exceptions')} className={btnOutline}><Download size={15} /> CSV</button>
      </div>
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        {!temuan.length ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 size={36} className="text-emerald-500" /><p className="font-semibold">{data.loading ? 'Loading...' : 'All Other journals are in good shape'}</p>
            <p className="text-xs text-muted-foreground">No findings that need follow-up.</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-2">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-xs text-muted-foreground">{['Journal No.', 'Date', 'Party / Reference', 'Finding', 'Severity'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
                <th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 text-left font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-border">{temuan.map((t, i) => (
                <tr key={i} onClick={() => setBuka(t.j.id === buka ? null : t.j.id)} className="cursor-pointer hover:bg-slate-50/60">
                  <td className={`${tdCls} font-mono text-xs font-semibold`}>{t.j.journal_no}</td><td className={tdCls}>{fmtDate(t.j.journal_date)}</td><td className={tdCls}>{t.j.reference ?? '—'}</td>
                  <td className={tdCls}>{t.message}</td><td className={tdCls}><Pill label={t.level === 'error' ? 'Error' : t.level === 'warning' ? 'Warning' : 'Info'} style={gaya[t.level]} /></td>
                  <td className={`${tdCls} text-right`}>{rupiah(t.j.amount)}</td><td className={tdCls}><StatusPill s={t.j.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {sel && <div className="border-t border-border p-5"><JournalDetail clientId={clientId} j={sel} onEdit={onEdit} onDone={() => setBuka(null)} /></div>}
      </section>
    </div>
  );
}

// ============================================================
// POSTED
// ============================================================

function PostedTab({ clientId, onNew, onEdit }: TabProps) {
  const pd = useOtherData<PostedData | null>(`opd:${clientId}`, s => fetchOtherPosted(clientId, s), null);
  const [cari, setCari] = useState('');
  const [buka, setBuka] = useState<string | null>(null);
  const d = pd.data;
  const js = (d?.journals ?? []).filter(j => cocok(j, cari));
  const sel = d?.journals.find(j => j.id === buka) ?? null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Posted Value per Month" subtitle="Last 12 months with data">
          <div className="h-56 px-3 pb-4">
            {!d?.monthly.length ? <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No posted Other journals yet.</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.monthly} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={m => fmtMonth(m)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v: number) => rupiah(v)} labelFormatter={m => fmtMonth(String(m))} />
                  <Bar dataKey="total" name="Posted" fill="#0F7D4E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <div className="space-y-6 p-5">
            <div><p className="text-xs text-muted-foreground">Total Posted</p><p className="font-mono text-2xl font-bold text-[#0F7D4E]">{rupiah(d?.total)}</p>
              <p className="text-xs text-muted-foreground">{d?.count ?? 0} journal(s){d?.reversed_count ? ` · ${d.reversed_count} reversed` : ''}</p></div>
            <div className="flex items-center justify-between"><p className="font-semibold">Average per Journal</p><p className="font-semibold text-[#0F7D4E]">{d?.average != null ? rupiah(d.average) : '—'}</p></div>
            <p className="text-xs text-muted-foreground">Posted journals automatically flow into the General Ledger &amp; Financial Statements.</p>
          </div>
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-[#0B5E5C]">Posting Timeline</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onNew} className={btnPrimary}><Plus size={15} /> New Journal</button>
          <button type="button" onClick={() => exportJournalsCsv(js, 'Other-Posted-Journals')} className={btnOutline}><Download size={15} /> Export CSV</button>
          <SearchBox value={cari} onChange={setCari} placeholder="Search posted journals..." className="w-72" />
        </div>
      </div>
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <JournalTable rows={js} loading={pd.loading && !d} onOpen={j => setBuka(j.id === buka ? null : j.id)} openId={buka} />
        {sel && <div className="border-t border-border p-5"><JournalDetail clientId={clientId} j={sel} onEdit={onEdit} /></div>}
      </section>
    </div>
  );
}

