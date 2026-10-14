'use client';

// Tab Collections (Accounts Receivable) -- layout mengikuti
// dataset/picture/Template UI/Account Receivable/6.jpeg: Collection
// Performance per bulan, Follow-up Status, Collection Queue per customer
// (prioritas, bucket aging, collector, status, jadwal follow-up). Detail
// customer + riwayat follow-up + form catat follow-up di drawer. Di bawahnya
// daftar Receipt (Record Receipt / Cash & Bank) seperti sebelumnya.
// Backend: /api/v1/finance/receivables/collections (receivables_ar_v1.py).

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CheckCircle2, ChevronDown, Clock, CreditCard, FileText, Filter, Handshake,
  Loader2, Mail, MessageCircle, MoreHorizontal, Phone, Search, UserRound, Users, Wallet,
} from 'lucide-react';
import {
  BUCKET_LABEL, COLLECTION_STATUS_DOT, COLLECTION_STATUS_LABEL, COLLECTION_STATUS_TEXT, CONTACT_METHOD_LABEL, createCollectionActivity,
  fetchCollectionActivities, fmtDate, fmtDateTime, pctChange, PRIORITY_DOT, PRIORITY_LABEL, PRIORITY_STYLE, rupiah, todayIso,
  updateCollectionAccount, useArApData,
  type ArApDoc, type CollectionAccount, type CollectionAccountInput, type CollectionActivity, type CollectionPriority, type CollectionsReport, type CollectionStatus,
  type ContactMethod, type Settlement, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import {
  AgingBadge, btnPrimary, btnSmall, Card, DocStatusLabel, Drawer, EmptyRow, inputCls, Menu, MenuItem, NumberPager, sortRows, SortTh, useSort,
} from './arapUi';
import { MoneyInput } from './SettlementForm';
import SettlementsTab from './SettlementsTab';
import type { TabId } from './ArApWorkspace';

const STATUS: CollectionStatus[] = ['to_contact', 'promised', 'escalated', 'resolved'];
const PRIORITAS: CollectionPriority[] = ['high', 'medium', 'low'];
const METODE: ContactMethod[] = ['call', 'email', 'whatsapp', 'visit', 'meeting', 'letter', 'other'];
const IKON_METODE: Record<ContactMethod, React.ElementType> = {
  call: Phone, email: Mail, whatsapp: MessageCircle, visit: UserRound, meeting: Users, letter: FileText, other: MessageCircle,
};
const TILE: Record<CollectionStatus, { icon: React.ElementType; tone: string; bar: string }> = {
  to_contact: { icon: Phone, tone: 'bg-sky-50/70 text-sky-600', bar: 'bg-sky-500' },
  promised: { icon: CalendarDays, tone: 'bg-emerald-50/70 text-emerald-600', bar: 'bg-emerald-500' },
  escalated: { icon: AlertTriangle, tone: 'bg-amber-50/70 text-amber-600', bar: 'bg-orange-500' },
  resolved: { icon: CheckCircle2, tone: 'bg-violet-50/70 text-violet-600', bar: 'bg-violet-500' },
};
const PRIORITAS_URUT: Record<CollectionPriority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_URUT: Record<CollectionStatus, number> = { escalated: 0, to_contact: 1, promised: 2, resolved: 3 };

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inisial = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const WARNA_INISIAL = ['bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700'];
const warnaNama = (s: string) => WARNA_INISIAL[Array.from(s).reduce((n, c) => n + c.charCodeAt(0), 0) % WARNA_INISIAL.length];

type Kunci = 'party' | 'last_contact_date' | 'outstanding' | 'next_follow_up_date' | 'priority' | 'max_days_overdue' | 'collector_name' | 'status';

function Delta({ now, prev, goodWhenDown, unit = 'pct' }: { now: number | null; prev: number | null; goodWhenDown: boolean; unit?: 'pct' | 'abs' }) {
  if (now === null || prev === null) return null;
  const d = unit === 'pct' ? pctChange(now, prev) : now - prev;
  if (d === null || Math.abs(d) < 0.5) return <span className="text-[11px] text-muted-foreground">No change vs last month</span>;
  const naik = d > 0;
  const Ikon = naik ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${naik !== goodWhenDown ? 'text-emerald-600' : 'text-rose-600'}`}>
        <Ikon size={11} /> {unit === 'pct' ? `${Math.abs(d).toFixed(0)}%` : `${Math.abs(Math.round(d))} days`}
      </span>
      <span className="text-muted-foreground">vs last month</span>
    </span>
  );
}

export function useCollectionMonths(asOf: string) {
  return useMemo(() => {
    const [y, m] = asOf.split('-').map(Number);
    return Array.from({ length: 12 }, (_, i) => {
      const t = y * 12 + (m - 1) - i;
      const yy = Math.floor(t / 12), mm = (t % 12) + 1;
      return { value: `${yy}-${String(mm).padStart(2, '0')}`, label: `${i === 0 ? 'This month' : i === 1 ? 'Last month' : BULAN[mm - 1]} (${BULAN[mm - 1]} ${yy})` };
    });
  }, [asOf]);
}

export default function CollectionsTab({ cfg, clientId, asOf, month, onMonth, report, loading, error, docs, settlements, settlementsLoading, initialParty, goTab }: {
  cfg: SideConfig; clientId: string; asOf: string; month: string; onMonth: (m: string) => void;
  report: CollectionsReport | null; loading: boolean; error: string | null; docs: ArApDoc[];
  settlements: Settlement[]; settlementsLoading: boolean; initialParty: string; goTab: (t: TabId, extra?: Record<string, string>) => void;
}) {
  const bulan = useCollectionMonths(asOf);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<'all' | CollectionStatus>('all');
  const [fPrioritas, setFPrioritas] = useState<'all' | CollectionPriority>('all');
  const [fKolektor, setFKolektor] = useState('');
  const [fJatuh, setFJatuh] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [lihat, setLihat] = useState<string | null>(null);
  const [catat, setCatat] = useState(false);
  const { sort, onSort } = useSort<Kunci>('priority', 'asc');
  const hariIni = todayIso();

  useEffect(() => { if (initialParty) setLihat(initialParty); }, [initialParty]);

  const queue = useMemo(() => report?.queue ?? [], [report]);
  const tersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    const r = queue.filter(a => (fStatus === 'all' || a.status === fStatus) && (fPrioritas === 'all' || a.priority === fPrioritas)
      && (!fKolektor || (fKolektor === '-' ? !a.collector_name : a.collector_name === fKolektor))
      && (!fJatuh || (a.next_follow_up_date !== null && a.next_follow_up_date <= hariIni && a.status !== 'resolved'))
      && (!kata || a.party.toLowerCase().includes(kata) || (a.customer_code ?? '').toLowerCase().includes(kata)
        || docs.some(d => d.party === a.party && d.no.toLowerCase().includes(kata))));
    return sortRows(r, a => {
      if (sort.key === 'priority') return PRIORITAS_URUT[a.priority] * 1e15 - a.outstanding;
      if (sort.key === 'status') return STATUS_URUT[a.status];
      return a[sort.key] as string | number | null;
    }, sort.dir);
  }, [queue, q, fStatus, fPrioritas, fKolektor, fJatuh, sort, docs, hariIni]);
  useEffect(() => { setPage(0); setPilih(new Set()); }, [q, fStatus, fPrioritas, fKolektor, fJatuh, size]);
  const halaman = tersaring.slice(page * size, (page + 1) * size);
  const adaFilter = fStatus !== 'all' || fPrioritas !== 'all' || !!fKolektor || fJatuh;
  const akunLihat = queue.find(a => a.party === lihat) ?? null;

  const perf = report?.performance;
  const counts = report?.follow_up.counts;
  const totalAkun = report?.follow_up.total ?? 0;
  const semuaHalaman = halaman.length > 0 && halaman.every(a => pilih.has(a.party));

  const massal = async (patch: { status?: CollectionStatus; collector_name?: string; priority?: CollectionPriority | 'auto' }) => {
    const target = Array.from(pilih);
    try {
      for (const party of target) await updateCollectionAccount({ client_id: clientId, party, ...patch });
      toast.success(`${target.length} account${target.length === 1 ? '' : 's'} updated.`);
      setPilih(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const ubahSatu = async (party: string, patch: Omit<CollectionAccountInput, 'client_id' | 'party'>) => {
    try {
      const r = await updateCollectionAccount({ client_id: clientId, party, ...patch });
      toast.success(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const tanyaKolektor = (awal: string | null, aksi: (nama: string) => void) => {
    const nama = window.prompt('Collector name', awal ?? report?.collectors[0] ?? '');
    if (nama !== null) aksi(nama.trim());
  };

  const kartuPerf = [
    {
      label: 'Collected This Month', value: rupiah(perf?.collected), icon: Wallet, tone: 'bg-emerald-50 text-emerald-600',
      sub: <Delta now={perf?.collected ?? null} prev={perf?.collected_prev ?? null} goodWhenDown={false} />,
    },
    {
      label: 'Promise to Pay', value: rupiah(perf?.promise_to_pay), icon: Handshake, tone: 'bg-sky-50 text-sky-600',
      sub: <span className="text-[11px]"><b className="text-sky-700">{perf?.promise_count ?? 0} account{perf?.promise_count === 1 ? '' : 's'}</b> <span className="text-muted-foreground">in commitment</span></span>,
    },
    {
      label: 'High Priority Accounts', value: `${perf?.high_priority_count ?? 0} customer${perf?.high_priority_count === 1 ? '' : 's'}`, icon: UserRound, tone: 'bg-rose-50 text-rose-600',
      sub: <span className="text-[11px]"><b className="text-rose-600">{(perf?.high_priority_pct ?? 0).toFixed(0)}%</b> <span className="text-muted-foreground">of total receivables</span></span>,
    },
    {
      label: 'Avg. Days to Collect', value: perf?.avg_days_to_collect != null ? `${Math.round(perf.avg_days_to_collect)} days` : '—', icon: Clock, tone: 'bg-violet-50 text-violet-600',
      sub: <Delta now={perf?.avg_days_to_collect ?? null} prev={perf?.avg_days_to_collect_prev ?? null} goodWhenDown unit="abs" />,
    },
  ];

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Collection Performance" subtitle="Collection performance summary for the selected period."
          action={
            <select value={month} onChange={e => onMonth(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
              {bulan.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          }>
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 2xl:grid-cols-4">
            {kartuPerf.map(k => {
              const Ikon = k.icon;
              return (
                <div key={k.label} className="rounded-xl border border-border p-3">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><Ikon size={18} /></span>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">{k.label}</p>
                      {loading && !report ? <div className="mt-1 h-5 w-24 animate-pulse rounded bg-slate-100" /> : <p className="truncate text-base font-bold text-foreground">{k.value}</p>}
                    </div>
                  </div>
                  <div className="mt-2">{k.sub}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Follow-up Status" subtitle="Collection follow-up status."
          action={adaFilter ? <button type="button" onClick={() => { setFStatus('all'); setFPrioritas('all'); setFKolektor(''); setFJatuh(false); }} className="text-xs font-medium text-sky-700 hover:underline">See all</button> : null}>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
            {STATUS.map(s => {
              const t = TILE[s];
              const Ikon = t.icon;
              const n = counts?.[s] ?? 0;
              const p = totalAkun ? (n / totalAkun) * 100 : 0;
              return (
                <button key={s} type="button" onClick={() => setFStatus(fStatus === s ? 'all' : s)}
                  className={`rounded-xl p-3 text-left transition ${t.tone} ${fStatus === s ? 'ring-2 ring-offset-1 ring-current' : 'hover:brightness-95'}`}>
                  <Ikon size={18} />
                  <p className="mt-2 text-xs text-slate-600">{COLLECTION_STATUS_LABEL[s]}</p>
                  <p className="text-xl font-bold text-foreground">{n}</p>
                  <p className="text-[11px]">{p.toFixed(0)}%</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/80"><div className={`h-full rounded-full ${t.bar}`} style={{ width: `${p}%` }} /></div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Collection Queue" subtitle="Customers with a receivable balance that need follow-up."
        action={<>
          <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, invoice number..."
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
          </label>
          <Menu width="w-64" button={open => (
            <button type="button" className={`${btnSmall} py-2 ${adaFilter ? 'border-[#0F7D4E] text-[#0F7D4E]' : ''}`}>
              <Filter size={13} /> Filter <ChevronDown size={13} className={open ? 'rotate-180 transition' : 'transition'} />
            </button>
          )}>
            {() => (
              <div className="space-y-2 p-2 text-xs">
                <label className="block text-muted-foreground">Status
                  <select value={fStatus} onChange={e => setFStatus(e.target.value as 'all' | CollectionStatus)} className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-foreground">
                    <option value="all">All statuses</option>
                    {STATUS.map(s => <option key={s} value={s}>{COLLECTION_STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="block text-muted-foreground">Priority
                  <select value={fPrioritas} onChange={e => setFPrioritas(e.target.value as 'all' | CollectionPriority)} className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-foreground">
                    <option value="all">All priorities</option>
                    {PRIORITAS.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </label>
                <label className="block text-muted-foreground">Collector
                  <select value={fKolektor} onChange={e => setFKolektor(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-foreground">
                    <option value="">All collectors</option>
                    <option value="-">Unassigned</option>
                    {(report?.collectors ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-1 text-foreground">
                  <input type="checkbox" checked={fJatuh} onChange={e => setFJatuh(e.target.checked)} className="accent-[#0F7D4E]" /> Follow-up due today or earlier
                </label>
              </div>
            )}
          </Menu>
        </>}>
        {pilih.size > 0 && (
          <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#ECFDF5] px-4 py-2 text-xs text-[#0B5E5C]">
            <span><b>{pilih.size}</b> selected</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnSmall} onClick={() => tanyaKolektor(null, n => massal({ collector_name: n }))}><UserRound size={13} /> Assign collector</button>
              <Menu width="w-48" button={() => <button type="button" className={btnSmall}>Set status <ChevronDown size={12} /></button>}>
                {close => STATUS.map(s => <MenuItem key={s} onClick={() => { close(); massal({ status: s }); }}>{COLLECTION_STATUS_LABEL[s]}</MenuItem>)}
              </Menu>
              <Menu width="w-48" button={() => <button type="button" className={btnSmall}>Set priority <ChevronDown size={12} /></button>}>
                {close => (
                  <>
                    {PRIORITAS.map(p => <MenuItem key={p} onClick={() => { close(); massal({ priority: p }); }}>{PRIORITY_LABEL[p]}</MenuItem>)}
                    <MenuItem onClick={() => { close(); massal({ priority: 'auto' }); }}>Automatic (by aging)</MenuItem>
                  </>
                )}
              </Menu>
              <button type="button" onClick={() => setPilih(new Set())} className="px-2 font-semibold hover:underline">Clear</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label="Select page" className="accent-[#0F7D4E]" checked={semuaHalaman}
                    onChange={() => setPilih(s => { const n = new Set(s); halaman.forEach(a => (semuaHalaman ? n.delete(a.party) : n.add(a.party))); return n; })} />
                </th>
                <SortTh label="Customer" k="party" sort={sort} onSort={onSort} />
                <SortTh label="Last Contact" k="last_contact_date" sort={sort} onSort={onSort} />
                <SortTh label="Outstanding Balance" k="outstanding" sort={sort} onSort={onSort} align="right" />
                <SortTh label="Next Follow-Up Date" k="next_follow_up_date" sort={sort} onSort={onSort} />
                <SortTh label="Priority" k="priority" sort={sort} onSort={onSort} />
                <SortTh label="Aging Bucket" k="max_days_overdue" sort={sort} onSort={onSort} />
                <SortTh label="Collector" k="collector_name" sort={sort} onSort={onSort} />
                <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(loading && !report) || halaman.length === 0 ? (
                <EmptyRow cols={10} loading={loading && !report} text={queue.length ? 'No matching accounts.' : 'No customers with an outstanding balance.'} />
              ) : halaman.map(a => {
                const IkonKontak = a.last_contact_method ? IKON_METODE[a.last_contact_method] : null;
                const jatuh = a.next_follow_up_date && a.next_follow_up_date <= hariIni && a.status !== 'resolved';
                return (
                  <tr key={a.party} className={`hover:bg-slate-50/60 ${pilih.has(a.party) ? 'bg-[#ECFDF5]/50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={`Select ${a.party}`} className="accent-[#0F7D4E]" checked={pilih.has(a.party)}
                        onChange={() => setPilih(s => { const n = new Set(s); if (n.has(a.party)) n.delete(a.party); else n.add(a.party); return n; })} />
                    </td>
                    <td className="max-w-[230px] px-3 py-2.5">
                      <button type="button" onClick={() => setLihat(a.party)} className="block max-w-full truncate text-left font-medium text-foreground hover:underline" title={a.party}>{a.party}</button>
                      <span className="text-[11px] text-muted-foreground">{a.customer_code ?? '—'} · {a.open_count} open</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {a.last_contact_date ? (
                        <span className="inline-flex items-center gap-1.5" title={a.last_contact_method ? CONTACT_METHOD_LABEL[a.last_contact_method] : ''}>
                          {IkonKontak && <IkonKontak size={13} />} {fmtDate(a.last_contact_date)}
                        </span>
                      ) : <span className="text-xs">Never</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-foreground">{rupiah(a.outstanding)}</td>
                    <td className={`px-3 py-2.5 ${jatuh ? 'font-medium text-rose-600' : 'text-muted-foreground'}`}>
                      {a.next_follow_up_date ? <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {fmtDate(a.next_follow_up_date)}</span> : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLE[a.priority]}`}
                        title={a.priority_overridden ? `Set manually (automatic: ${PRIORITY_LABEL[a.priority_auto]})` : 'Automatic, based on aging'}>
                        <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[a.priority]}`} /> {PRIORITY_LABEL[a.priority]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><AgingBadge bucket={a.bucket} /></td>
                    <td className="px-3 py-2.5">
                      {a.collector_name ? (
                        <span className="inline-flex items-center gap-2 text-foreground">
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${warnaNama(a.collector_name)}`}>{inisial(a.collector_name)}</span>
                          <span className="max-w-[120px] truncate">{a.collector_name}</span>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${COLLECTION_STATUS_TEXT[a.status]}`}>
                        <span className={`h-2 w-2 rounded-full ${COLLECTION_STATUS_DOT[a.status]}`} /> {COLLECTION_STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setLihat(a.party)} className={btnSmall}>View</button>
                        <Menu width="w-60" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                          {close => (
                            <>
                              <MenuItem onClick={() => { close(); setLihat(a.party); setCatat(true); }}><Phone size={14} /> Log follow-up</MenuItem>
                              <MenuItem disabled={a.outstanding <= 0} href={`${cfg.basePath}/receipts/new?party=${encodeURIComponent(a.party)}`} onClick={close}><CreditCard size={14} /> Record Receipt</MenuItem>
                              <MenuItem onClick={() => { close(); goTab('statements', { party: a.party }); }}><FileText size={14} /> Customer Statement</MenuItem>
                              <MenuItem onClick={() => { close(); tanyaKolektor(a.collector_name, n => ubahSatu(a.party, { collector_name: n })); }}><UserRound size={14} /> Assign collector</MenuItem>
                              {a.status !== 'escalated' && a.outstanding > 0 && <MenuItem onClick={() => { close(); ubahSatu(a.party, { status: 'escalated' }); }}><AlertTriangle size={14} /> Escalate</MenuItem>}
                            </>
                          )}
                        </Menu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={size} total={tersaring.length} onPage={setPage} onPageSize={setSize} noun="accounts" />
      </Card>

      <SettlementsTab cfg={cfg} clientId={clientId} mode="all" data={settlements} loading={settlementsLoading} />

      {akunLihat && (
        <CollectionDrawer cfg={cfg} clientId={clientId} akun={akunLihat} docs={docs.filter(d => d.party === akunLihat.party && d.outstanding > 0)}
          collectors={report?.collectors ?? []} logOpen={catat} onLogOpen={setCatat} onClose={() => { setLihat(null); setCatat(false); }} />
      )}
    </div>
  );
}

function CollectionDrawer({ cfg, clientId, akun, docs, collectors, logOpen, onLogOpen, onClose }: {
  cfg: SideConfig; clientId: string; akun: CollectionAccount; docs: ArApDoc[]; collectors: string[];
  logOpen: boolean; onLogOpen: (b: boolean) => void; onClose: () => void;
}) {
  const riwayat = useArApData<CollectionActivity[]>(`colact:${clientId}:${akun.party}`, s => fetchCollectionActivities(clientId, akun.party, s), []);
  const [tgl, setTgl] = useState(todayIso());
  const [metode, setMetode] = useState<ContactMethod>('call');
  const [statusSesudah, setStatusSesudah] = useState<CollectionStatus>(akun.status === 'resolved' ? 'to_contact' : akun.status);
  const [janji, setJanji] = useState(0);
  const [tglJanji, setTglJanji] = useState('');
  const [berikut, setBerikut] = useState('');
  const [kolektor, setKolektor] = useState(akun.collector_name ?? '');
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setKolektor(akun.collector_name ?? ''); }, [akun.collector_name]);

  const simpan = async () => {
    setBusy(true);
    try {
      const r = await createCollectionActivity({
        client_id: clientId, party: akun.party, activity_date: tgl, method: metode, status_after: statusSesudah, notes: catatan.trim() || null,
        promise_amount: statusSesudah === 'promised' ? janji || null : null, promise_date: statusSesudah === 'promised' ? tglJanji || null : null,
        next_follow_up_date: berikut || null, collector_name: kolektor.trim() || null,
      });
      toast.success(r.message);
      setCatatan(''); setJanji(0); setTglJanji(''); setBerikut('');
      onLogOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ubah = async (patch: Omit<CollectionAccountInput, 'client_id' | 'party'>) => {
    try {
      const r = await updateCollectionAccount({ client_id: clientId, party: akun.party, ...patch });
      toast.success(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Drawer open onClose={onClose} title={akun.party}
      subtitle={<>{akun.customer_code ?? 'Not in customer master'}{akun.phone ? ` · ${akun.phone}` : ''}{akun.email ? ` · ${akun.email}` : ''}</>}
      footer={<>
        <button type="button" onClick={() => onLogOpen(!logOpen)} className={btnSmall}><Phone size={13} /> Log Follow-up</button>
        {akun.outstanding > 0 && (
          <Link href={`${cfg.basePath}/receipts/new?party=${encodeURIComponent(akun.party)}`} className={`${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]`}>
            Record Receipt
          </Link>
        )}
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[11px] text-muted-foreground">Outstanding</p><p className="text-base font-bold">{rupiah(akun.outstanding)}</p></div>
        <div className="rounded-xl bg-rose-50/60 px-3 py-2.5"><p className="text-[11px] text-muted-foreground">Overdue</p><p className="text-base font-bold text-rose-600">{rupiah(akun.overdue)}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="text-muted-foreground">Status
          <select value={akun.stored_status ?? 'to_contact'} disabled={akun.outstanding <= 0} onChange={e => ubah({ status: e.target.value as CollectionStatus })} className={`${inputCls} mt-1 py-2`}>
            {STATUS.map(s => <option key={s} value={s}>{COLLECTION_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-muted-foreground">Priority
          <select value={akun.priority_overridden ? akun.priority : 'auto'} onChange={e => ubah({ priority: e.target.value as CollectionPriority | 'auto' })} className={`${inputCls} mt-1 py-2`}>
            <option value="auto">Automatic ({PRIORITY_LABEL[akun.priority_auto]})</option>
            {PRIORITAS.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="text-muted-foreground">Collector
          <input list="ar-collectors" defaultValue={akun.collector_name ?? ''} key={akun.collector_name ?? ''} placeholder="Unassigned"
            onBlur={e => { if ((e.target.value.trim() || null) !== akun.collector_name) ubah({ collector_name: e.target.value }); }} className={`${inputCls} mt-1 py-2`} />
        </label>
        <label className="text-muted-foreground">Next follow-up
          <input type="date" value={akun.next_follow_up_date ?? ''} onChange={e => ubah(e.target.value ? { next_follow_up_date: e.target.value } : { clear_next_follow_up: true })} className={`${inputCls} mt-1 py-2`} />
        </label>
      </div>
      <datalist id="ar-collectors">{collectors.map(c => <option key={c} value={c} />)}</datalist>
      {akun.status === 'promised' && akun.promise_amount !== null && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Promised {rupiah(akun.promise_amount)} by {fmtDate(akun.promise_date)}.</p>
      )}
      {akun.outstanding <= 0 && <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">No outstanding balance — this account is resolved.</p>}

      {logOpen && (
        <div className="space-y-3 rounded-xl border border-[#22C55E]/40 bg-[#ECFDF5]/40 p-4">
          <h4 className="text-sm font-semibold text-foreground">Log Follow-up</h4>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="text-muted-foreground">Contact date
              <input type="date" value={tgl} max={todayIso()} onChange={e => setTgl(e.target.value)} className={`${inputCls} mt-1 py-2`} />
            </label>
            <label className="text-muted-foreground">Method
              <select value={metode} onChange={e => setMetode(e.target.value as ContactMethod)} className={`${inputCls} mt-1 py-2`}>
                {METODE.map(m => <option key={m} value={m}>{CONTACT_METHOD_LABEL[m]}</option>)}
              </select>
            </label>
            <label className="text-muted-foreground">Status after contact
              <select value={statusSesudah} onChange={e => setStatusSesudah(e.target.value as CollectionStatus)} className={`${inputCls} mt-1 py-2`}>
                {STATUS.map(s => <option key={s} value={s}>{COLLECTION_STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="text-muted-foreground">Next follow-up
              <input type="date" value={berikut} min={tgl} onChange={e => setBerikut(e.target.value)} className={`${inputCls} mt-1 py-2`} />
            </label>
            {statusSesudah === 'promised' && (
              <>
                <label className="text-muted-foreground">Promised amount
                  <MoneyInput value={janji} onChange={setJanji} className="mt-1 py-1" />
                </label>
                <label className="text-muted-foreground">Promised payment date
                  <input type="date" value={tglJanji} min={tgl} onChange={e => setTglJanji(e.target.value)} className={`${inputCls} mt-1 py-2`} />
                </label>
              </>
            )}
            <label className="col-span-2 text-muted-foreground">Collector
              <input list="ar-collectors" value={kolektor} onChange={e => setKolektor(e.target.value)} className={`${inputCls} mt-1 py-2`} />
            </label>
            <label className="col-span-2 text-muted-foreground">Notes
              <textarea value={catatan} onChange={e => setCatatan(e.target.value)} rows={3} maxLength={2000} placeholder="What was discussed?" className={`${inputCls} mt-1`} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onLogOpen(false)} className={btnSmall}>Cancel</button>
            <button type="button" onClick={simpan} disabled={busy || (statusSesudah === 'promised' && (!janji || !tglJanji))} className={`${btnPrimary} px-3 py-2 text-xs`}>
              {busy && <Loader2 size={13} className="animate-spin" />} Save Follow-up
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Open Invoices ({docs.length})</h4>
        {docs.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{d.no}</p>
                  <p className="text-muted-foreground">due {fmtDate(d.due_date)}{d.days_overdue ? ` · ${d.days_overdue} days overdue` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <DocStatusLabel status={d.status} />
                  <span className="font-semibold">{rupiah(d.outstanding)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Follow-up History</h4>
        {riwayat.loading && !riwayat.data.length ? <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          : riwayat.data.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">No follow-ups recorded yet.</p>
          ) : (
            <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
              {riwayat.data.map(r => {
                const Ikon = IKON_METODE[r.method];
                return (
                  <li key={r.id} className="relative text-xs">
                    <span className="absolute -left-[23px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-slate-200"><Ikon size={9} /></span>
                    <p className="font-medium text-foreground">
                      {fmtDate(r.activity_date)} · {CONTACT_METHOD_LABEL[r.method]} → <span className={COLLECTION_STATUS_TEXT[r.status_after]}>{COLLECTION_STATUS_LABEL[r.status_after]}</span>
                    </p>
                    {r.promise_amount !== null && <p className="text-emerald-700">Promised {rupiah(r.promise_amount)} by {fmtDate(r.promise_date)}</p>}
                    {r.notes && <p className="whitespace-pre-line text-muted-foreground">{r.notes}</p>}
                    <p className="text-[10px] text-muted-foreground">{r.created_by_name || '—'} · {fmtDateTime(r.created_at)}{r.next_follow_up_date ? ` · next ${fmtDate(r.next_follow_up_date)}` : ''}</p>
                  </li>
                );
              })}
            </ol>
          )}
      </div>
      <p className="text-[11px] text-muted-foreground">Aging bucket: {akun.bucket ? BUCKET_LABEL[akun.bucket] : '—'} · Last payment: {fmtDate(akun.last_payment_date)}</p>
    </Drawer>
  );
}
