'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Filter, MoreHorizontal, Search, FileText } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BUCKET_COLOR, BUCKET_LABEL, BUCKET_STYLE, fmtDate, fmtMonth, rupiah, rupiahShort,
  type ArApDoc, type ArApOverview, type DocStatus, type Settlement, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import { REPORT_GROUPS } from './arapExport';
import {
  AgingBadge, btnSmall, Card, DocDrawer, DocStatusLabel, EmptyRow, Menu, MenuItem, Pager, sortRows, SortTh, useSort,
} from './arapUi';
import type { TabId } from './ArApWorkspace';

type Kunci = 'party' | 'no' | 'date' | 'due_date' | 'outstanding' | 'days_overdue' | 'status';

export default function OverviewTab({ cfg, asOf, ov, docs, loading, settlements, trendMonths, onTrendMonths, goTab }: {
  cfg: SideConfig; clientId: string; asOf: string; ov: ArApOverview | null; docs: ArApDoc[]; loading: boolean;
  settlements: Settlement[]; trendMonths: number; onTrendMonths: (n: number) => void; goTab: (t: TabId, extra?: Record<string, string>) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | DocStatus>('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(5);
  const [lihat, setLihat] = useState<ArApDoc | null>(null);
  const { sort, onSort } = useSort<Kunci>('days_overdue');

  const terbuka = useMemo(() => docs.filter(d => d.outstanding > 0), [docs]);
  const tersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    const r = terbuka.filter(d => (status === 'all' || d.status === status)
      && (!kata || d.party.toLowerCase().includes(kata) || d.no.toLowerCase().includes(kata) || (d.ref_no ?? '').toLowerCase().includes(kata)));
    return sortRows(r, d => d[sort.key] as string | number, sort.dir);
  }, [terbuka, q, status, sort]);
  useEffect(() => setPage(0), [q, status, size]);
  const halaman = tersaring.slice(page * size, (page + 1) * size);
  const settlePath = `${cfg.basePath}/${cfg.side === 'ar' ? 'receipts' : 'payments'}/new`;

  const totalAging = ov?.aging.reduce((n, a) => n + a.amount, 0) ?? 0;
  const ringkas = REPORT_GROUPS.map(g => ({
    g, amount: (ov?.aging ?? []).filter(a => g.buckets.includes(a.bucket)).reduce((n, a) => n + a.amount, 0),
  }));
  const tren = (ov?.trend ?? []).map(t => ({ ...t, label: fmtMonth(t.month) }));

  return (
    <div className="space-y-5">
      <Card
        title={`${cfg.side === 'ar' ? 'Receivable' : 'Payable'} ${cfg.docs}`}
        subtitle={`${cfg.sourceModule} ${cfg.docs.toLowerCase()} with an outstanding balance, their status and aging as of ${fmtDate(asOf)}.`}
        action={<>
          <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}, ${cfg.doc.toLowerCase()} number...`}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <Filter size={14} className="text-muted-foreground" />
            <select value={status} onChange={e => setStatus(e.target.value as 'all' | DocStatus)} className="bg-transparent text-sm focus:outline-none">
              <option value="all">All open</option>
              <option value="overdue">Overdue</option>
              <option value="partial">Partially paid</option>
              <option value="open">Not yet due</option>
            </select>
          </label>
        </>}
      >
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                <SortTh label={cfg.party} k="party" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} No.`} k="no" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} Date`} k="date" sort={sort} onSort={onSort} />
                <SortTh label="Due Date" k="due_date" sort={sort} onSort={onSort} />
                <SortTh label="Outstanding Balance" k="outstanding" sort={sort} onSort={onSort} />
                <SortTh label="Aging" k="days_overdue" sort={sort} onSort={onSort} />
                <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading || halaman.length === 0 ? (
                <EmptyRow cols={8} loading={loading} text={terbuka.length ? 'No matching items.' : `No outstanding ${cfg.docs.toLowerCase()} as of ${fmtDate(asOf)}. Only posted ${cfg.sourceModule} transactions appear here.`} />
              ) : halaman.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/60">
                  <td className="max-w-[220px] truncate px-3 py-2.5 font-medium text-foreground" title={d.party}>{d.party}</td>
                  <td className="px-3 py-2.5 text-foreground">{d.no}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(d.date)}</td>
                  <td className={`px-3 py-2.5 ${d.days_overdue > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>{fmtDate(d.due_date)}</td>
                  <td className="px-3 py-2.5 font-semibold text-foreground">{rupiah(d.outstanding)}</td>
                  <td className="px-3 py-2.5"><AgingBadge bucket={d.bucket} /></td>
                  <td className="px-3 py-2.5"><DocStatusLabel status={d.status} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setLihat(d)} className={`${btnSmall} w-16`}>View</button>
                      <Menu width="w-52" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                        {close => (
                          <>
                            <MenuItem disabled={d.available <= 0} href={`${settlePath}?party=${encodeURIComponent(d.party)}&invoice=${d.id}`} onClick={close}>Record {cfg.settle}</MenuItem>
                            <MenuItem onClick={() => { close(); goTab('statements', { party: d.party }); }}>{cfg.party} Statement</MenuItem>
                            <MenuItem onClick={() => { close(); goTab('invoices', { party: d.party }); }}>All {cfg.docs.toLowerCase()} of this {cfg.party.toLowerCase()}</MenuItem>
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
        <Pager page={page} pageSize={size} total={tersaring.length} onPage={setPage} onPageSize={setSize} />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Aging Summary" subtitle="Outstanding balance by age (based on due date)."
          action={<Link href={`${cfg.basePath}/export?as_of=${asOf}`} className={`${btnSmall} text-[#0F7D4E]`}><FileText size={13} /> View Aging Report</Link>}>
          <div className="space-y-3 px-5 pb-5">
            {ringkas.map(({ g, amount }) => {
              const p = totalAging ? (amount / totalAging) * 100 : 0;
              return (
                <div key={g.key} className="grid grid-cols-[90px_1fr_80px_42px] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{g.label}</span>
                  <span className="text-right font-semibold text-foreground">{rupiah(amount)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full" style={{ width: `${p}%`, background: g.color }} />
                  </span>
                  <span className="text-right text-xs text-muted-foreground">{p.toFixed(0)}%</span>
                </div>
              );
            })}
            <div className="mt-2 flex items-center justify-between rounded-xl bg-[#ECFDF5] px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Total {cfg.side === 'ar' ? 'Receivables' : 'Payables'}</span>
              <span className="text-lg font-bold text-foreground">{rupiah(totalAging)}</span>
            </div>
          </div>
        </Card>

        <Card title={`Top Overdue ${cfg.parties}`} subtitle={`${cfg.parties} with the largest overdue balance.`}
          action={<button type="button" onClick={() => goTab('aging')} className="text-xs font-medium text-[#0F7D4E] hover:underline">See all</button>}>
          <div className="px-5 pb-5">
            {(ov?.top_overdue ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">Nothing overdue as of {fmtDate(asOf)}.</p>
            ) : (
              <ol className="divide-y divide-border">
                {ov!.top_overdue.map((t, i) => (
                  <li key={t.party} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground">{i + 1}</span>
                    <button type="button" onClick={() => goTab('statements', { party: t.party })} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline" title={t.party}>{t.party}</button>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{rupiah(t.amount)}</p>
                      <p className="text-[11px] text-muted-foreground">{t.count} {t.count === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()}</p>
                    </div>
                    <span className={`inline-flex w-[88px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BUCKET_STYLE[t.bucket]}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: BUCKET_COLOR[t.bucket] }} />
                      {BUCKET_LABEL[t.bucket]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <Card title={`${cfg.side === 'ar' ? 'Collection' : 'Payment'} Trend`} subtitle={`${cfg.trend.invoiced}, ${cfg.trend.settled.toLowerCase()} and ${cfg.trend.balance.toLowerCase()} per month.`}
          action={
            <select value={trendMonths} onChange={e => onTrendMonths(Number(e.target.value))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs">
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          }>
          <div className="px-3 pb-4">
            {tren.every(t => !t.invoiced && !t.collected && !t.balance) ? (
              <p className="px-2 py-14 text-center text-xs text-muted-foreground">No activity in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={tren} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => rupiahShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={62} />
                  <Tooltip formatter={(v: number) => rupiah(v)} />
                  <Bar dataKey="invoiced" name={cfg.trend.invoiced} fill="#A7F3D0" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="collected" name={cfg.trend.settled} fill="#0F7D4E" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Line dataKey="balance" name={cfg.trend.balance} stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap justify-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#A7F3D0]" /> {cfg.trend.invoiced}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#0F7D4E]" /> {cfg.trend.settled}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" /> {cfg.trend.balance}</span>
            </div>
          </div>
        </Card>
      </div>

      <DocDrawer cfg={cfg} doc={lihat} settlements={settlements} onClose={() => setLihat(null)} />
    </div>
  );
}
