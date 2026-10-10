'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Download, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatusBadge from '@/components/ui/StatusBadge';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import OtherTabs from '../components/OtherTabs';
import { useOtherWorkspace } from '../components/OtherWorkspace';
import { buildOtherExceptions, monthKeyOf, monthLabelOf, OTHER_STATUS_VARIANT, type OtherJournal } from '../lib/otherJournals';

// POSTED = arsip buku besar. Fokus: ritme posting dari waktu ke waktu (grafik
// bulanan), tingkat rekonsiliasi, lalu linimasa jurnal dikelompokkan per bulan.

export default function OtherPostedPage() {
  const ws = useOtherWorkspace();
  const posted = useMemo(
    () => ws.journals.filter((j) => j.status === 'Posted' || j.status === 'Reconciled'),
    [ws.journals],
  );
  const exceptionCount = useMemo(() => buildOtherExceptions(ws.journals).length, [ws.journals]);
  const waiting = useMemo(() => ws.journals.filter((j) => j.status === 'Unposted').length, [ws.journals]);
  const [query, setQuery] = useState('');
  const [openMonths, setOpenMonths] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const months = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = new Map<string, OtherJournal[]>();
    posted.forEach((j) => {
      if (q && ![j.jeId, j.party, j.description].some((v) => (v || '').toLowerCase().includes(q))) return;
      const k = monthKeyOf(j.date);
      const arr = m.get(k);
      if (arr) arr.push(j);
      else m.set(k, [j]);
    });
    return Array.from(m.entries())
      .map(([key, items]) => ({ key, items, total: items.reduce((s, j) => s + j.amount, 0) }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [posted, query]);

  const chartData = useMemo(() => {
    const m = new Map<string, number>();
    posted.forEach((j) => m.set(monthKeyOf(j.date), (m.get(monthKeyOf(j.date)) ?? 0) + j.amount));
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12)
      .map(([key, total]) => ({ month: monthLabelOf(key).replace(/ \d{4}$/, (y) => ` '${y.trim().slice(2)}`), total }));
  }, [posted]);

  const total = posted.reduce((s, j) => s + j.amount, 0);
  const avg = posted.length ? total / posted.length : 0;
  const latest = posted[0]?.date;

  const isOpen = (key: string, idx: number) => (openMonths ? openMonths.has(key) : idx === 0);
  const toggle = (key: string, idx: number) =>
    setOpenMonths((prev) => {
      const base = prev ?? new Set(months[0] ? [months[0].key] : []);
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      void idx;
      return next;
    });

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="posted" exceptionCount={exceptionCount} />
      {ws.dialogs}
      {ws.error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Gagal memuat jurnal Other: {ws.error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground">Nilai Posting per Bulan</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">12 bulan terakhir yang ada datanya</p>
          {chartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-14 text-center">Belum ada jurnal Other yang diposting.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatIDR(v, true)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v: number) => formatIDR(v)} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="total" name="Terposting" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Total Terposting</p>
            <p className="text-2xl font-bold font-mono text-foreground mt-1">{formatIDR(total, true)}</p>
            <p className="text-xs text-muted-foreground mt-1">{posted.length} jurnal{latest ? ` · terakhir ${formatDate(latest)}` : ''}</p>
          </div>
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-foreground">Rata-rata per Jurnal</p>
              <p className="text-lg font-bold font-mono text-emerald-600">{posted.length ? formatIDR(avg, true) : '—'}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Jurnal terposting otomatis masuk Buku Besar & Financial Statements.
              {waiting > 0 ? ` ${waiting} jurnal disetujui masih menunggu posting.` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">Linimasa Posting</h2>
        <div className="flex items-center gap-2 flex-wrap">
        <button onClick={ws.openNew} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90"><Plus size={13} /> Jurnal Baru</button>
        <button onClick={() => ws.exportCsv(posted, 'jurnal-other-posted')} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted"><Download size={13} /> Ekspor CSV</button>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari jurnal terposting..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        </div>
      </div>

      {months.length === 0 ? (
        <div className="card-elevated-md rounded-xl py-16 text-center text-sm text-muted-foreground">Belum ada jurnal Other yang diposting.</div>
      ) : (
        <div className="space-y-3">
          {months.map((m, idx) => {
            const open = isOpen(m.key, idx);
            return (
              <div key={m.key} className="card-elevated-md rounded-xl overflow-hidden">
                <button onClick={() => toggle(m.key, idx)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/40 transition-colors">
                  {open ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                  <span className="text-sm font-semibold text-foreground flex-1">{monthLabelOf(m.key)}</span>
                  <span className="text-xs text-muted-foreground">{m.items.length} jurnal</span>
                  <span className="text-sm font-mono font-semibold text-foreground w-32 text-right">{formatIDR(m.total, true)}</span>
                </button>
                {open && (
                  <div className="border-t border-border ml-9 mr-5 mb-3 relative">
                    <div className="absolute left-0 top-3 bottom-3 w-px bg-border" />
                    {m.items.map((j) => (
                      <button
                        key={j.id}
                        onClick={() => setSelected(j.lines[0])}
                        className="relative w-full flex items-center gap-3 pl-5 py-2.5 text-left hover:bg-muted/40 rounded-md transition-colors"
                      >
                        <span className="absolute left-[-3px] w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span className="font-mono text-xs w-20 shrink-0 text-muted-foreground">{formatDate(j.date)}</span>
                        <span className="font-mono text-xs text-teal-600 w-28 shrink-0">{j.jeId}</span>
                        <span className="text-xs text-foreground flex-1 truncate">{j.party ? `${j.party} — ` : ''}{j.description}</span>
                        <span className="font-mono text-xs w-24 text-right shrink-0">{formatIDR(j.amount, true)}</span>
                        <StatusBadge variant={OTHER_STATUS_VARIANT[j.status]} label={j.status} dot />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
