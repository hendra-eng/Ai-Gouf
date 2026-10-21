'use client';

// Tab Posted (Template UI/Fix Assets/1.jpeg): semua jurnal FA yang sudah
// masuk buku besar (acquisition, depreciation, disposal, adjustment).

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, CalendarDays, ChevronDown, Clock, Download, FileText, PieChart as PieIcon, Search } from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah } from '@/lib/receivablesPayablesStore';
import {
  fetchJournal, fetchJournals, JOURNAL_TYPE_LABEL, JOURNAL_TYPE_STYLE, useFaData, type Journal, type JournalList, type JournalType,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnSmall, Card, Drawer, EmptyRow, Field, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Delta, JournalLines, KpiGrid, Pill, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

type Rentang = '' | 'month' | 'quarter' | 'year';

export default function PostedTab({ clientId, clientName, asOf, actions }: { clientId: string; clientName: string; asOf: string; actions: FaActions }) {
  const data = useFaData<JournalList | null>(`jr:${clientId}:${asOf}`, s => fetchJournals(clientId, { as_of: asOf }, s), null);
  const [cari, setCari] = useState('');
  const [rentang, setRentang] = useState<Rentang>('');
  const [jenis, setJenis] = useState<'' | JournalType>('');
  const [kategori, setKategori] = useState('');
  const [status, setStatus] = useState<'' | 'posted' | 'reversed'>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [buka, setBuka] = useState<string | null>(null);
  const k = data.data?.kpi;
  const semua = useMemo(() => data.data?.journals ?? [], [data.data]);
  const opsiKategori = useMemo(() => Array.from(new Set(semua.map(j => j.category).filter(Boolean))) as string[], [semua]);

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
    const dari = rentang === 'month' ? `${asOf.slice(0, 7)}-01` : rentang === 'quarter' ? `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
      : rentang === 'year' ? `${y}-01-01` : '';
    return semua.filter(j => (!q || [j.journal_no, j.asset_code, j.asset_name, j.reference].some(x => (x || '').toLowerCase().includes(q)))
      && (!dari || (j.journal_date >= dari && j.journal_date <= asOf)) && (!jenis || j.journal_type === jenis)
      && (!kategori || j.category === kategori) && (!status || j.status === status));
  }, [semua, cari, rentang, jenis, kategori, status, asOf]);

  const ekspor = async (format: ExportFormat) => {
    try {
      await downloadTable(format, {
        title: 'Posted Fixed Asset Journals', clientName, subtitle: `As of ${fmtDate(asOf)}`, rows: baris, fileName: `Fixed-Asset-Journals-${asOf}`,
        columns: [
          { header: 'Posting Date', value: (j: Journal) => j.journal_date }, { header: 'Journal No.', value: j => j.journal_no },
          { header: 'Asset Code', value: j => j.asset_code }, { header: 'Asset Name', value: j => j.asset_name },
          { header: 'Transaction Type', value: j => JOURNAL_TYPE_LABEL[j.journal_type] }, { header: 'Reference', value: j => j.reference },
          { header: 'Amount', value: j => j.amount, type: 'money' }, { header: 'Posted By', value: j => j.posted_by_name },
          { header: 'Status', value: j => (j.status === 'posted' ? 'Posted' : `Reversed ${j.reversal_date ?? ''}`) },
        ],
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  return (
    <div className="space-y-5">
      {data.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{data.error}</div>}
      <KpiGrid loading={data.loading && !data.data} cards={[
        { label: 'Posted Entries', value: String(k?.entries_ytd ?? 0), icon: FileText, tone: 'green', delta: <Delta now={k?.entries_ytd} prev={k?.entries_prev_ytd} suffix="vs. previous year" /> },
        { label: 'Posted This Month', value: String(k?.entries_month ?? 0), icon: CalendarDays, tone: 'blue', delta: <Delta now={k?.entries_month} prev={k?.entries_prev_month} suffix="vs. last month" /> },
        { label: 'Total Posted Depreciation', value: rupiah(k?.depreciation_ytd), icon: PieIcon, tone: 'red', delta: <Delta now={k?.depreciation_ytd} prev={k?.depreciation_prev_ytd} suffix="vs. previous year" /> },
        { label: 'Total Posted Disposals', value: rupiah(k?.disposals_ytd), icon: ArrowLeftRight, tone: 'amber', delta: <Delta now={k?.disposals_ytd} prev={k?.disposals_prev_ytd} suffix="vs. previous year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-2 xl:grid-cols-6 xl:items-end">
        <div className="relative xl:col-span-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search by journal no., asset code, asset name, or reference..." className={`${inputCls} pl-9`} />
        </div>
        <label><span className="mb-1 block text-xs font-medium">Posting Date</span>
          <select value={rentang} onChange={e => { setRentang(e.target.value as Rentang); setPage(0); }} className={inputCls}>
            <option value="">All Dates</option><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option>
          </select></label>
        <label><span className="mb-1 block text-xs font-medium">Transaction Type</span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as JournalType | ''); setPage(0); }} className={inputCls}>
            <option value="">All Types</option>{(Object.keys(JOURNAL_TYPE_LABEL) as JournalType[]).map(t => <option key={t} value={t}>{JOURNAL_TYPE_LABEL[t]}</option>)}
          </select></label>
        <label><span className="mb-1 block text-xs font-medium">Asset Category</span>
          <select value={kategori} onChange={e => { setKategori(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All Categories</option>{opsiKategori.map(c => <option key={c}>{c}</option>)}
          </select></label>
        <label><span className="mb-1 block text-xs font-medium">Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value as '' | 'posted' | 'reversed'); setPage(0); }} className={inputCls}>
            <option value="">All Statuses</option><option value="posted">Posted</option><option value="reversed">Reversed</option>
          </select></label>
      </div>

      <Card title={<span className="flex items-center gap-2"><Clock size={18} className="text-[#0F7D4E]" /> Posted Transactions</span>} action={
        <Menu width="w-44" button={open => <button type="button" className={btnOutline}><Download size={15} /> Export <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>}>
          {close => <>
            <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel (.xlsx)</MenuItem>
            <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
            <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
          </>}
        </Menu>
      }>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Posting Date</th><th className={thCls}>Journal No.</th><th className={thCls}>Asset Code</th><th className={thCls}>Asset Name</th>
              <th className={thCls}>Transaction Type</th><th className={thCls}>Reference</th><th className={`${thCls} text-right`}>Amount</th>
              <th className={thCls}>Posted By</th><th className={thCls}>Status</th><th className={thCls} />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(data.loading && !data.data) || !baris.length ? (
                <EmptyRow cols={10} loading={data.loading && !data.data} text="No posted fixed asset journals." />
              ) : baris.slice(page * pageSize, (page + 1) * pageSize).map(j => (
                <tr key={j.id} className="hover:bg-slate-50/60">
                  <td className={tdCls}>{fmtDate(j.journal_date)}</td>
                  <td className={`${tdCls} font-medium`}>{j.journal_no}</td>
                  <td className={tdCls}>{j.asset_code ?? '—'}</td>
                  <td className={tdCls}>{j.asset_name ?? '—'}</td>
                  <td className={tdCls}><Pill label={JOURNAL_TYPE_LABEL[j.journal_type]} style={JOURNAL_TYPE_STYLE[j.journal_type]} /></td>
                  <td className={tdCls}>{j.reference ?? '—'}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(j.amount)}</td>
                  <td className={tdCls}>{j.posted_by_name ?? '—'}</td>
                  <td className={tdCls}>{j.status === 'posted' ? <Pill label="Posted" style="bg-emerald-50 text-emerald-700" /> : <Pill label="Reversed" style="bg-rose-50 text-rose-700" />}</td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setBuka(j.id)} className={btnSmall}>Open Journal</button>
                      {j.asset_id && <button type="button" onClick={() => actions.openAsset(j.asset_id!)} className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-slate-100">Asset</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="journals" />
      </Card>

      {buka && <JournalDrawer clientId={clientId} id={buka} onClose={() => setBuka(null)} />}
    </div>
  );
}

function JournalDrawer({ clientId, id, onClose }: { clientId: string; id: string; onClose: () => void }) {
  const j = useFaData<Journal | null>(`jd:${clientId}:${id}`, s => fetchJournal(clientId, id, s), null);
  const x = j.data;
  return (
    <Drawer open onClose={onClose} title={x?.journal_no ?? 'Loading...'} subtitle={x ? `${JOURNAL_TYPE_LABEL[x.journal_type]} · ${fmtDate(x.journal_date)}` : undefined}>
      {j.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{j.error}</p>}
      {!x ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Asset">{x.asset_code ? `${x.asset_code} · ${x.asset_name}` : '—'}</Field>
          <Field label="Reference">{x.reference ?? '—'}</Field>
          <Field label="Amount">{rupiah(x.amount)}</Field>
          <Field label="Posted">{x.posted_by_name ?? '—'} · {fmtDateTime(x.posted_at)}</Field>
        </div>
        {x.description && <Field label="Description">{x.description}</Field>}
        <JournalLines lines={x.lines ?? []} />
        {x.status === 'reversed' && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Reversed on {fmtDate(x.reversal_date)} by {x.reversed_by_name ?? '—'} (journal RV-{x.journal_no}). Reason: {x.reversal_reason}</p>
        )}
      </>}
    </Drawer>
  );
}
