'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CalendarDays, CheckCircle2, ChevronDown, Clock, CreditCard, Download, FileSpreadsheet, FileText, Filter, MoreHorizontal,
  Pencil, RotateCcw, Search, Timer,
} from 'lucide-react';
import {
  BUCKET_LABEL, BUCKETS, DOC_STATUS_LABEL, fetchPendingInvoices, fmtDate, money, rupiah, useArApData,
  type AgingBucket, type ArApDoc, type DocStatus, type PendingInvoice, type Settlement, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import { downloadDocsCsv, downloadDocsXlsx } from './arapExport';
import {
  AgingBadge, btnSmall, Card, DocDrawer, DocStatusLabel, EmptyRow, Menu, MenuItem, NumberPager, sortRows, SortTh, useSort,
} from './arapSalesUi';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import type { TabId } from './ArApWorkspace';

// Tab Invoices / Bills (dataset/picture/Template UI/Account Receivable/8.jpeg):
// semua dokumen posted per tanggal as_of, filter tanggal / pihak / status /
// aging, pilih baris untuk export atau Record Receipt, ringkasan di bawah.
// AR juga menampilkan invoice yang belum diposting (Draft / menunggu approval).

type Kunci = 'party' | 'no' | 'date' | 'due_date' | 'total' | 'outstanding' | 'days_overdue' | 'status';
type Periode = 'all' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom';
const PERIODE_LABEL: Record<Periode, string> = {
  all: 'All periods', this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', this_year: 'This year', custom: 'Custom range',
};
const STATUS: DocStatus[] = ['open', 'partial', 'overdue', 'paid'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rentang(p: Periode, asOf: string, dari: string, sampai: string): [string, string] | null {
  const a = new Date(`${asOf}T00:00:00`);
  const y = a.getFullYear(), m = a.getMonth();
  switch (p) {
    case 'this_month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case 'last_month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
    case 'this_year': return [`${y}-01-01`, `${y}-12-31`];
    case 'custom': return dari || sampai ? [dari || '0000-01-01', sampai || '9999-12-31'] : null;
    default: return null;
  }
}


export default function InvoicesTab({ cfg, clientId, clientName, asOf, docs, loading, settlements, initialParty, goTab }: {
  cfg: SideConfig; clientId: string; clientName: string; asOf: string; docs: ArApDoc[]; loading: boolean; settlements: Settlement[];
  initialParty: string; goTab: (t: TabId, extra?: Record<string, string>) => void;
}) {
  const [q, setQ] = useState('');
  const [party, setParty] = useState(initialParty);
  const [status, setStatus] = useState<'all' | DocStatus>('all');
  const [aging, setAging] = useState<'all' | AgingBucket | 'paid'>('all');
  const [periode, setPeriode] = useState<Periode>('all');
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');
  const [filterBuka, setFilterBuka] = useState(true);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [lihat, setLihat] = useState<ArApDoc | null>(null);
  const { sort, onSort } = useSort<Kunci>('date');
  const settlePath = `${cfg.basePath}/${cfg.side === 'ar' ? 'receipts' : 'payments'}/new`;

  const pending = useArApData<PendingInvoice[]>(cfg.side === 'ar' ? `pending:${clientId}` : null, s => fetchPendingInvoices(clientId, s), []);
  const [pendingBuka, setPendingBuka] = useState(false);

  useEffect(() => setParty(initialParty), [initialParty]);
  const daftarPihak = useMemo(() => Array.from(new Set(docs.map(d => d.party))).sort(), [docs]);
  const r = useMemo(() => rentang(periode, asOf, dari, sampai), [periode, asOf, dari, sampai]);

  const tersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    const hasil = docs.filter(d => (status === 'all' || d.status === status) && (!party || d.party === party)
      && (aging === 'all' || (aging === 'paid' ? d.status === 'paid' : d.bucket === aging))
      && (!r || (d.date >= r[0] && d.date <= r[1]))
      && (!kata || d.no.toLowerCase().includes(kata) || d.party.toLowerCase().includes(kata) || (d.ref_no ?? '').toLowerCase().includes(kata)
        || (d.description ?? '').toLowerCase().includes(kata)));
    return sortRows(hasil, d => d[sort.key] as string | number, sort.dir);
  }, [docs, q, status, party, aging, r, sort]);
  useEffect(() => { setPage(0); setPilih(new Set()); }, [q, status, party, aging, periode, dari, sampai, size]);
  const halaman = tersaring.slice(page * size, (page + 1) * size);
  const adaFilter = !!(q || party || status !== 'all' || aging !== 'all' || periode !== 'all');
  const reset = () => { setQ(''); setParty(''); setStatus('all'); setAging('all'); setPeriode('all'); setDari(''); setSampai(''); };

  // Ringkasan (mengikuti filter).
  const ring = useMemo(() => {
    const n = { total: 0, totalN: 0, open: 0, openN: 0, overdue: 0, overdueN: 0, paid: 0, paidN: 0 };
    tersaring.forEach(d => {
      n.total += d.total; n.totalN += 1; n.paid += d.paid;
      if (d.status === 'paid') n.paidN += 1;
      else if (d.status === 'overdue') { n.overdue += d.outstanding; n.overdueN += 1; } else { n.open += d.outstanding; n.openN += 1; }
    });
    return n;
  }, [tersaring]);
  const pct = (v: number) => (ring.total ? Math.round((v / ring.total) * 100) : 0);

  const dipilih = tersaring.filter(d => pilih.has(d.id));
  const semuaHalaman = halaman.length > 0 && halaman.every(d => pilih.has(d.id));
  const togglePilih = (id: string) => setPilih(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleHalaman = () => setPilih(s => {
    const n = new Set(s);
    halaman.forEach(d => (semuaHalaman ? n.delete(d.id) : n.add(d.id)));
    return n;
  });
  const pihakDipilih = Array.from(new Set(dipilih.map(d => d.party)));
  const bisaTerima = pihakDipilih.length === 1 && dipilih.some(d => d.available > 0);

  const ekspor = async (jenis: 'xlsx' | 'csv', baris: ArApDoc[]) => {
    try {
      if (jenis === 'csv') downloadDocsCsv(cfg, asOf, baris);
      else await downloadDocsXlsx(cfg, clientName, asOf, baris);
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  const kartu = [
    { label: `Total ${cfg.docs}`, value: ring.total, n: ring.totalN, icon: FileText, tone: 'bg-neutral-100 text-neutral-600', pct: null as number | null, danger: false },
    { label: `Open ${cfg.docs}`, value: ring.open, n: ring.openN, icon: Clock, tone: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200', pct: pct(ring.open), danger: false },
    { label: `Overdue ${cfg.docs}`, value: ring.overdue, n: ring.overdueN, icon: Timer, tone: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200', pct: pct(ring.overdue), danger: true },
    { label: `${cfg.settled} Amount`, value: ring.paid, n: ring.paidN, icon: CheckCircle2, tone: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200', pct: pct(ring.paid), danger: false },
  ];

  return (
    <div className="space-y-5">
      {cfg.side === 'ar' && pending.data.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{pending.data.length}</b> invoice{pending.data.length === 1 ? ' is' : 's are'} not posted yet
              ({pending.data.filter(p => p.status === 'Draft').length} draft, {pending.data.filter(p => p.status !== 'Draft').length} awaiting approval / posting)
              — they appear here once posted in Sales &gt; Journal Preview.
            </span>
            <button type="button" onClick={() => setPendingBuka(o => !o)} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800 hover:underline">
              {pendingBuka ? 'Hide' : 'Show'} <ChevronDown size={13} className={pendingBuka ? 'rotate-180' : ''} />
            </button>
          </div>
          {pendingBuka && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-sky-100 bg-white">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-neutral-100">
                  {pending.data.map(p => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium text-neutral-900">{p.invoice_no}</td>
                      <td className="px-3 py-2 text-neutral-500">{p.customer_name}</td>
                      <td className="px-3 py-2 text-neutral-500">{fmtDate(p.invoice_date)}</td>
                      <td className="px-3 py-2 text-right">{rupiah(p.total)}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">{p.status === 'Review' ? 'Awaiting Approval' : p.status}</span></td>
                      <td className="px-3 py-2 text-right">
                        {p.editable ? (
                          <Link href={`${cfg.basePath}/invoices/new?id=${p.id}`} className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"><Pencil size={12} /> Edit</Link>
                        ) : (
                          <Link href="/transactions/sales?tab=journal-preview" className="font-medium text-blue-700 hover:underline">Journal Preview</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Card
        title={`${cfg.side === 'ar' ? 'Receivable Invoice' : 'Payable Bill'} List`}
        subtitle={`Manage and monitor every ${cfg.sourceModule.toLowerCase()} ${cfg.doc.toLowerCase()} ${cfg.side === 'ar' ? 'issued to customers' : 'received from vendors'} (as of ${fmtDate(asOf)}).`}
        action={<>
          <label className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 sm:w-80">
            <Search size={14} className="text-neutral-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}, ${cfg.doc.toLowerCase()} number or description...`}
              className="w-full bg-transparent text-sm placeholder:text-neutral-400 focus:outline-none" />
          </label>
          <button type="button" onClick={() => setFilterBuka(o => !o)} className={`${btnSmall} py-2`}>
            <Filter size={13} /> Filter <ChevronDown size={13} className={filterBuka ? 'rotate-180 transition' : 'transition'} />
          </button>
        </>}
      >
        {filterBuka && (
          <div className="grid grid-cols-1 gap-3 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <div className="text-xs font-medium text-neutral-900">
              {cfg.doc} Date
              <FilterSelect
                variant="elegant" block className="mt-1" ariaLabel={`${cfg.doc} date period`}
                icon={<CalendarDays size={14} />}
                value={periode}
                onChange={v => setPeriode(v as Periode)}
                options={(Object.keys(PERIODE_LABEL) as Periode[]).map(p => ({ value: p, label: PERIODE_LABEL[p] }))}
              />
            </div>
            <div className="text-xs font-medium text-neutral-900">
              {cfg.party}
              <FilterSelect
                variant="elegant" block className="mt-1" ariaLabel={cfg.party}
                value={party}
                onChange={setParty}
                options={[{ value: '', label: `All ${cfg.parties.toLowerCase()}` }, ...daftarPihak.map(p => ({ value: p, label: p }))]}
              />
            </div>
            <div className="text-xs font-medium text-neutral-900">
              Status
              <FilterSelect
                variant="elegant" block className="mt-1" ariaLabel="Status"
                value={status}
                onChange={v => setStatus(v as 'all' | DocStatus)}
                options={[{ value: 'all', label: 'All statuses' }, ...STATUS.map(s => ({ value: s, label: DOC_STATUS_LABEL[s] }))]}
              />
            </div>
            <div className="text-xs font-medium text-neutral-900">
              Aging
              <FilterSelect
                variant="elegant" block className="mt-1" ariaLabel="Aging"
                value={aging}
                onChange={v => setAging(v as 'all' | AgingBucket | 'paid')}
                options={[{ value: 'all', label: 'All' }, ...BUCKETS.map(b => ({ value: b, label: BUCKET_LABEL[b] })), { value: 'paid', label: 'Paid' }]}
              />
            </div>
            <button type="button" onClick={reset} disabled={!adaFilter}
              className="inline-flex items-center gap-1.5 justify-self-start py-2 text-xs font-semibold text-sky-700 hover:underline disabled:opacity-40">
              <RotateCcw size={13} /> Reset Filter
            </button>
            {periode === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 sm:col-span-2 lg:col-span-5">
                From <input type="date" value={dari} onChange={e => setDari(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900" />
                to <input type="date" value={sampai} onChange={e => setSampai(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900" />
              </div>
            )}
          </div>
        )}

        {pilih.size > 0 && (
          <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-xs text-[#0B5E5C]">
            <span><b>{pilih.size}</b> selected · Outstanding {rupiah(dipilih.reduce((n, d) => n + d.outstanding, 0))}</span>
            <div className="flex flex-wrap gap-2">
              {bisaTerima && (
                <Link href={`${settlePath}?party=${encodeURIComponent(pihakDipilih[0])}&invoice=${dipilih.filter(d => d.available > 0).map(d => d.id).join(',')}`}
                  className={btnSmall}><CreditCard size={13} /> Record {cfg.settle}</Link>
              )}
              <button type="button" onClick={() => ekspor('xlsx', dipilih)} className={btnSmall}><FileSpreadsheet size={13} /> Export Excel</button>
              <button type="button" onClick={() => ekspor('csv', dipilih)} className={btnSmall}><Download size={13} /> Export CSV</button>
              <button type="button" onClick={() => setPilih(new Set())} className="px-2 font-semibold hover:underline">Clear</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[1180px] text-xs">
            <thead>
              <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:border-y [&>th]:border-neutral-800 [&>th]:py-2 [&>th]:font-bold">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label="Select page" className="accent-neutral-800" checked={semuaHalaman} onChange={toggleHalaman} />
                </th>
                <SortTh label={cfg.party} k="party" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} No.`} k="no" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} Date`} k="date" sort={sort} onSort={onSort} />
                <SortTh label="Due Date" k="due_date" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} Amount`} k="total" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Outstanding Balance" k="outstanding" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Aging" k="days_overdue" sort={sort} onSort={onSort} />
                <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-300">
              {loading || halaman.length === 0 ? (
                <EmptyRow cols={10} loading={loading} text={docs.length ? 'No matching items.' : `No posted ${cfg.sourceModule} ${cfg.docs.toLowerCase()} yet.`} />
              ) : halaman.map(d => (
                <tr key={d.id} className={`hover:bg-neutral-200 ${pilih.has(d.id) ? 'bg-neutral-100/50' : ''}`}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`Select ${d.no}`} className="accent-neutral-800" checked={pilih.has(d.id)} onChange={() => togglePilih(d.id)} />
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 font-medium text-neutral-900" title={d.party}>{d.party}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => setLihat(d)} className="text-sky-700 hover:underline">{d.no}</button>
                    {d.ref_no && d.ref_no !== d.no && <span className="block text-[11px] text-neutral-500">{d.ref_no}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-500">{fmtDate(d.date)}</td>
                  <td className={`px-3 py-2.5 ${d.days_overdue > 0 ? 'text-rose-600' : 'text-neutral-500'}`}>
                    {fmtDate(d.due_date)}{d.due_date_estimated && <span className="ml-1 text-[10px] text-neutral-500" title="Estimated from payment terms">*</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {rupiah(d.total)}
                    {d.foreign_total != null && d.currency && d.currency !== 'IDR' && (
                      <span className="block text-[10px] font-normal text-sky-700">{money(d.foreign_total, d.currency)}{d.exchange_rate ? ` @ ${d.exchange_rate.toLocaleString('id-ID', { maximumFractionDigits: 6 })}` : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold">
                    {rupiah(d.outstanding)}
                    {d.foreign_outstanding != null && d.currency && d.currency !== 'IDR' && (
                      <span className="block text-[10px] font-normal text-sky-700">{money(d.foreign_outstanding, d.currency)}</span>
                    )}
                    {d.in_process > 0 && <span className="block text-[10px] font-normal text-sky-600">{rupiah(d.in_process)} in process</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {d.status === 'paid'
                      ? <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Paid</span>
                      : <AgingBadge bucket={d.bucket} />}
                  </td>
                  <td className="px-3 py-2.5"><DocStatusLabel status={d.status} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setLihat(d)} className={btnSmall}>View</button>
                      <Menu width="w-60" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                        {close => (
                          <>
                            <MenuItem disabled={d.available <= 0} href={`${settlePath}?party=${encodeURIComponent(d.party)}&invoice=${d.id}`} onClick={close}>
                              <CreditCard size={14} /> Record {cfg.settle}
                            </MenuItem>
                            <MenuItem onClick={() => { close(); goTab('statements', { party: d.party }); }}><FileText size={14} /> {cfg.party} Statement</MenuItem>
                            {cfg.side === 'ar' && d.outstanding > 0 && (
                              <MenuItem onClick={() => { close(); goTab('settlements', { party: d.party }); }}><Clock size={14} /> Collection follow-up</MenuItem>
                            )}
                            <MenuItem onClick={() => { close(); setParty(d.party); }}><Filter size={14} /> Only this {cfg.party.toLowerCase()}</MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={size} total={tersaring.length} onPage={setPage} onPageSize={setSize} noun={cfg.docs.toLowerCase()} />
        <p className="px-5 pb-4 text-[11px] text-neutral-500">* Due date estimated from the payment terms because the {cfg.doc.toLowerCase()} has no due date.</p>
        <DocDrawer cfg={cfg} doc={lihat} settlements={settlements} onClose={() => setLihat(null)} />
      </Card>

      <div className="grid grid-cols-1 gap-0 overflow-hidden relative rounded-xl border border-neutral-300 bg-white before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-xl before:bg-neutral-800 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        {kartu.map((k, i) => {
          const Ikon = k.icon;
          return (
            <div key={k.label} className={`flex items-center gap-4 px-5 py-4 ${i ? 'border-t border-neutral-300 sm:border-l sm:border-t-0' : ''}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${k.tone}`}><Ikon size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-500">{k.label}</p>
                <p className={`truncate text-lg font-semibold ${k.danger && k.value > 0 ? 'text-rose-600' : 'text-neutral-900'}`}>{rupiah(k.value)}</p>
                <p className="text-[11px] text-neutral-500">{k.n} {k.n === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()}</p>
              </div>
              {k.pct !== null && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${k.danger ? 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200' : i === 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{k.pct}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
