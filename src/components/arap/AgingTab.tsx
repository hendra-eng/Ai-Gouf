'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, FileText, Filter, Search, Timer } from 'lucide-react';
import {
  BUCKET_COLOR, BUCKET_LABEL, BUCKETS, fetchArApAging, fmtDate, rupiah, useArApData,
  type AgingBucket, type AgingReport, type ArApOverview, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import { btnPrimary, btnSmall, Card, EmptyRow, Menu } from './arapUi';
import type { TabId } from './ArApWorkspace';

// Tab Aging (dataset/picture/Template UI/Account Receivable/7.jpeg): saldo per
// customer / vendor dipecah per umur (berdasarkan jatuh tempo), baris bisa
// dibuka untuk melihat invoice penyusunnya; di bawahnya distribusi umur,
// ringkasan aging (overdue + rata-rata hari tagih), dan top 5 overdue.

const SEL: Record<AgingBucket, string> = {
  current: 'bg-emerald-50 text-emerald-700',
  '1_30': 'bg-amber-50 text-amber-700',
  '31_60': 'bg-orange-50 text-orange-700',
  '61_90': 'bg-orange-100/70 text-orange-800',
  '91_plus': 'bg-rose-50 text-rose-700',
};

export default function AgingTab({ cfg, clientId, asOf, ov, goTab }: {
  cfg: SideConfig; clientId: string; asOf: string; ov: ArApOverview | null; goTab: (t: TabId, extra?: Record<string, string>) => void;
}) {
  const [nol, setNol] = useState(false);
  const [q, setQ] = useState('');
  const [ember, setEmber] = useState<'all' | 'overdue' | AgingBucket>('all');
  const [buka, setBuka] = useState<Set<string>>(new Set());
  const { data, loading, error } = useArApData<AgingReport | null>(
    `aging:${cfg.side}:${clientId}:${asOf}:${nol}`,
    s => fetchArApAging(cfg.side, clientId, { as_of: asOf, include_zero: nol, include_details: true }, s), null,
  );
  const baris = useMemo(() => {
    const kata = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(r => (!kata || r.party.toLowerCase().includes(kata) || r.invoices.some(d => d.no.toLowerCase().includes(kata)))
      && (ember === 'all' || (ember === 'overdue' ? BUCKETS.some(b => b !== 'current' && r.buckets[b] > 0) : r.buckets[ember] > 0)));
  }, [data, q, ember]);
  const tot = data?.totals;
  const total = tot?.total ?? 0;
  const telat = tot ? BUCKETS.filter(b => b !== 'current').reduce((n, b) => n + tot.buckets[b], 0) : 0;
  const toggle = (p: string) => setBuka(s => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });
  const dso = ov?.kpi.avg_days_to_settle ?? null;
  const dsoLalu = ov?.kpi.avg_days_to_settle_prev ?? null;
  const pie = BUCKETS.map(b => ({ bucket: b, name: BUCKET_LABEL[b], value: tot?.buckets[b] ?? 0 })).filter(x => x.value > 0);
  const labelEmber: Record<string, string> = { all: 'All balances', overdue: 'Overdue only', ...BUCKET_LABEL };

  return (
    <div className="space-y-5">
      <Card
        title={`Aging Analysis per ${cfg.party}`}
        subtitle={`Outstanding balance per ${cfg.party.toLowerCase()} as of ${fmtDate(asOf)}, grouped by days past the due date.`}
        action={<>
          <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}, ${cfg.doc.toLowerCase()} number...`}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
          </label>
          <Menu width="w-60" button={open => (
            <button type="button" className={`${btnSmall} py-2 ${ember !== 'all' || nol ? 'border-[#0F7D4E] text-[#0F7D4E]' : ''}`}>
              <Filter size={13} /> {ember === 'all' ? 'Filter' : labelEmber[ember]} <ChevronDown size={13} className={open ? 'rotate-180 transition' : 'transition'} />
            </button>
          )}>
            {close => (
              <div className="p-1 text-xs">
                <p className="px-2 pb-1 pt-1 font-semibold text-muted-foreground">Show {cfg.parties.toLowerCase()} with</p>
                {(['all', 'overdue', ...BUCKETS] as const).map(b => (
                  <button key={b} type="button" onClick={() => { setEmber(b); close(); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${ember === b ? 'font-semibold text-[#0F7D4E]' : 'text-foreground'}`}>
                    {b !== 'all' && b !== 'overdue' && <span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[b] }} />}
                    {labelEmber[b]}
                  </button>
                ))}
                <label className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-muted-foreground">
                  <input type="checkbox" checked={nol} onChange={e => setNol(e.target.checked)} className="accent-[#0F7D4E]" />
                  Include zero balance
                </label>
              </div>
            )}
          </Menu>
          <Link href={`${cfg.basePath}/export?as_of=${asOf}`} className={`${btnPrimary} px-3 py-2 text-xs`}><FileText size={14} /> View Aging Report</Link>
        </>}
      >
        {error && <p className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                <th className="w-8 px-2 py-2.5" />
                <th className="px-3 py-2.5 text-left font-medium">{cfg.party}</th>
                <th className="px-3 py-2.5 text-right font-medium">Total {cfg.side === 'ar' ? 'Receivable' : 'Payable'}</th>
                {BUCKETS.map(b => (
                  <th key={b} className="px-2 py-2.5 text-center font-medium">
                    {BUCKET_LABEL[b]}
                    {b === 'current' && <span className="block text-[10px] font-normal text-muted-foreground">(not yet due)</span>}
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(loading && !data) || baris.length === 0 ? (
                <EmptyRow cols={9} loading={loading && !data} text={data?.rows.length ? 'No matching items.' : `No outstanding ${cfg.docs.toLowerCase()} as of ${fmtDate(asOf)}.`} />
              ) : baris.map(r => (
                <React.Fragment key={r.party}>
                  <tr className="border-b border-border hover:bg-slate-50/60">
                    <td className="px-2 py-2">
                      {r.invoices.length > 0 && (
                        <button type="button" onClick={() => toggle(r.party)} className="rounded p-0.5 text-muted-foreground hover:bg-slate-100" aria-label="Toggle details">
                          {buka.has(r.party) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-medium text-foreground" title={r.party}>
                      {r.party}
                      <span className="block text-[11px] font-normal text-muted-foreground">{r.open_count} open {r.open_count === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()}{r.party_tax_id ? ` · ${r.party_tax_id}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-foreground">{rupiah(r.total)}</td>
                    {BUCKETS.map(b => (
                      <td key={b} className="px-1.5 py-1.5">
                        <div className={`rounded-lg px-2 py-1.5 text-center text-xs font-medium ${r.buckets[b] ? SEL[b] : 'text-slate-300'}`}>
                          {r.buckets[b] ? rupiah(r.buckets[b]) : '—'}
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => goTab('statements', { party: r.party })} className="text-xs font-medium text-[#0F7D4E] hover:underline">Statement</button>
                    </td>
                  </tr>
                  {buka.has(r.party) && r.invoices.map(d => (
                    <tr key={d.id} className="border-b border-border bg-slate-50/50 text-xs text-muted-foreground">
                      <td />
                      <td className="px-3 py-1.5 pl-6">{d.no} <span className="ml-1">· due {fmtDate(d.due_date)}{d.days_overdue ? ` (${d.days_overdue} days)` : ''}</span></td>
                      <td className="px-3 py-1.5 text-right">{rupiah(d.outstanding)}</td>
                      {BUCKETS.map(b => <td key={b} className="px-3 py-1.5 text-center">{d.bucket === b ? rupiah(d.outstanding) : ''}</td>)}
                      <td />
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            {tot && baris.length > 0 && (
              <tfoot>
                <tr className="bg-[#ECFDF5] text-sm font-bold text-foreground">
                  <td />
                  <td className="px-3 py-3">Total{baris.length !== (data?.rows.length ?? 0) ? ` (${baris.length} shown)` : ''}</td>
                  <td className="px-3 py-3 text-right">{rupiah(baris.reduce((n, r) => n + r.total, 0))}</td>
                  {BUCKETS.map(b => <td key={b} className="px-2 py-3 text-center">{rupiah(baris.reduce((n, r) => n + r.buckets[b], 0))}</td>)}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_1fr_1.2fr]">
        <Card title={`${cfg.side === 'ar' ? 'Receivable' : 'Payable'} Age Distribution`} subtitle="Share of the total balance by aging bucket.">
          <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row">
            <div className="relative h-48 w-48 shrink-0">
              {pie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={1.5} stroke="none">
                      {pie.map(p => <Cell key={p.bucket} fill={BUCKET_COLOR[p.bucket]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => rupiah(v)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-full w-full rounded-full border-[18px] border-slate-100" />}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xs font-bold text-foreground">{rupiah(total)}</span>
                <span className="text-[10px] text-muted-foreground">Total {cfg.side === 'ar' ? 'Receivable' : 'Payable'}</span>
              </div>
            </div>
            <ul className="w-full space-y-2.5 text-xs">
              {BUCKETS.map(b => {
                const v = tot?.buckets[b] ?? 0;
                return (
                  <li key={b} className="grid grid-cols-[1fr_auto_40px] items-center gap-3">
                    <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLOR[b] }} />{BUCKET_LABEL[b]}</span>
                    <span className="text-right font-semibold text-foreground">{rupiah(v)}</span>
                    <span className="text-right text-muted-foreground">{total ? Math.round((v / total) * 100) : 0}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <Card title="Aging Summary" subtitle={`Total overdue exposure and average days to ${cfg.side === 'ar' ? 'collect' : 'pay'}.`}>
          <div className="space-y-3 px-5 pb-5">
            <div className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600"><Timer size={18} /></span>
              <div>
                <p className="text-xs text-muted-foreground">Total Overdue Exposure</p>
                <p className="text-lg font-bold text-rose-600">{rupiah(telat)}</p>
                <p className="text-[11px] text-muted-foreground">{total ? Math.round((telat / total) * 100) : 0}% of total {cfg.side === 'ar' ? 'receivables' : 'payables'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600"><Clock size={18} /></span>
              <div>
                <p className="text-xs text-muted-foreground">Average {cfg.side === 'ar' ? 'Collection' : 'Payment'} Days{cfg.side === 'ar' ? ' (DSO)' : ''}</p>
                <p className="text-lg font-bold text-foreground">{dso !== null ? `${Math.round(dso)} days` : '—'}</p>
                {dso !== null && dsoLalu !== null && Math.round(dso - dsoLalu) !== 0 ? (
                  <p className="inline-flex items-center gap-1 text-[11px]">
                    <span className={`inline-flex items-center gap-0.5 font-semibold ${(dso < dsoLalu) === (cfg.side === 'ar') ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {dso < dsoLalu ? <ArrowDown size={11} /> : <ArrowUp size={11} />} {Math.abs(Math.round(dso - dsoLalu))} days
                    </span>
                    <span className="text-muted-foreground">vs last month</span>
                  </p>
                ) : <p className="text-[11px] text-muted-foreground">{dso === null ? `No ${cfg.settle.toLowerCase()}s this month` : 'No change vs last month'}</p>}
              </div>
            </div>
          </div>
        </Card>

        <Card title={`Top 5 Overdue ${cfg.parties}`} subtitle={`${cfg.parties} with the largest overdue balance.`}>
          <div className="px-5 pb-5">
            {(ov?.top_overdue ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">Nothing overdue as of {fmtDate(asOf)}.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-slate-600">
                    <th className="px-2 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">{cfg.party}</th>
                    <th className="px-2 py-2 text-right font-medium">Total Overdue</th>
                    <th className="px-2 py-2 text-right font-medium">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ov!.top_overdue.map((t, i) => (
                    <tr key={t.party}>
                      <td className="px-2 py-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{i + 1}</span></td>
                      <td className="max-w-[160px] truncate px-2 py-2">
                        <button type="button" onClick={() => goTab('statements', { party: t.party })} className="truncate text-left text-foreground hover:underline" title={t.party}>{t.party}</button>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-rose-600">{rupiah(t.amount)}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">{total ? Math.round((t.amount / total) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
