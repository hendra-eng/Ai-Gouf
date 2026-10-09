'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, AlertTriangle, XCircle, Eye } from 'lucide-react';
import StatusBadge from '@/components/ui/StatusBadge';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import OtherTabs from '../components/OtherTabs';
import { buildOtherJournals, journalChecks, OTHER_STATUS_VARIANT, type JournalStatus } from '../lib/otherJournals';

// OTHER TRANSACTION = ruang kerja jurnal (master-detail). Kiri: daftar jurnal
// yang bisa dipindai cepat; kanan: isi lengkap jurnal terpilih (baris
// debit-kredit, keseimbangan, pemeriksaan, catatan).

const FILTERS: ('Semua' | JournalStatus)[] = ['Semua', 'Unposted', 'Draft', 'Posted', 'Reconciled', 'Voided'];
const PAGE = 40;

export default function OtherTransactionTabPage() {
  const { getByGroup } = useTransactions();
  const journals = useMemo(() => buildOtherJournals(getByGroup('other')), [getByGroup]);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Semua');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTx, setDrawerTx] = useState<Transaction | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { Semua: journals.length };
    journals.forEach((j) => { c[j.status] = (c[j.status] ?? 0) + 1; });
    return c;
  }, [journals]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return journals.filter((j) => {
      if (filter !== 'Semua' && j.status !== filter) return false;
      if (!q) return true;
      return [j.jeId, j.party, j.description, j.category].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [journals, filter, query]);

  useEffect(() => setLimit(PAGE), [filter, query]);

  const selected = list.find((j) => j.id === selectedId) ?? list[0] ?? null;
  const checks = selected ? journalChecks(selected) : [];
  const debitShare = selected && selected.debit + selected.credit > 0 ? (selected.debit / (selected.debit + selected.credit)) * 100 : 50;

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="transaction" />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        {/* ── Kiri: daftar jurnal ── */}
        <div className="xl:col-span-2 card-elevated-md rounded-xl overflow-hidden">
          <div className="p-3 border-b border-border space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari no. jurnal, pihak, deskripsi..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-full text-xs transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  {f} <span className="opacity-70">{counts[f] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[620px] overflow-y-auto divide-y divide-border">
            {list.length === 0 && <p className="text-sm text-muted-foreground py-14 text-center">Tidak ada jurnal yang cocok.</p>}
            {list.slice(0, limit).map((j) => {
              const active = selected?.id === j.id;
              return (
                <button
                  key={j.id}
                  onClick={() => setSelectedId(j.id)}
                  className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${active ? 'bg-blue-50 border-blue-600' : 'border-transparent hover:bg-muted/50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-teal-600">{j.jeId}</span>
                    <span className="font-mono text-xs font-semibold text-foreground">{formatIDR(j.amount, true)}</span>
                  </div>
                  <p className="text-xs text-foreground mt-0.5 truncate">{j.party || '—'} · {j.description}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-muted-foreground">{formatDate(j.date)} · {j.lines.length} baris</span>
                    <StatusBadge variant={OTHER_STATUS_VARIANT[j.status]} label={j.status} dot />
                  </div>
                </button>
              );
            })}
            {list.length > limit && (
              <button onClick={() => setLimit(limit + PAGE)} className="w-full py-3 text-xs text-blue-600 hover:bg-muted/50">
                Tampilkan {Math.min(PAGE, list.length - limit)} lagi ({list.length - limit} tersisa)
              </button>
            )}
          </div>
        </div>

        {/* ── Kanan: isi jurnal terpilih ── */}
        <div className="xl:col-span-3 card-elevated-md rounded-xl p-5 xl:sticky xl:top-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground py-24 text-center">Pilih jurnal di sebelah kiri untuk melihat isinya.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-bold text-foreground">{selected.jeId}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{selected.description}</p>
                </div>
                <StatusBadge variant={OTHER_STATUS_VARIANT[selected.status]} label={selected.status} dot />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {[['Tanggal', formatDate(selected.date)], ['Pihak', selected.party || '—'], ['Kategori', selected.category], ['Sumber', selected.sourceLabel]].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground">{k}</p>
                    <p className="font-medium text-foreground mt-0.5 truncate">{v}</p>
                  </div>
                ))}
              </div>

              <div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 font-medium">Akun</th>
                      <th className="py-2 font-medium text-right">Debit</th>
                      <th className="py-2 font-medium text-right">Kredit</th>
                      <th className="py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border">
                        <td className="py-2"><span className="font-mono text-muted-foreground">{l.accountCode || '—'}</span> {l.accountName}</td>
                        <td className="py-2 font-mono text-right">{l.debit ? formatIDR(l.debit, true) : '—'}</td>
                        <td className="py-2 font-mono text-right">{l.credit ? formatIDR(l.credit, true) : '—'}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => setDrawerTx(l)} title="Detail baris" className="text-muted-foreground hover:text-blue-600"><Eye size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2">Total</td>
                      <td className="py-2 font-mono text-right">{formatIDR(selected.debit, true)}</td>
                      <td className="py-2 font-mono text-right">{formatIDR(selected.credit, true)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                <div className="mt-3">
                  <div className="flex w-full h-2 rounded-full overflow-hidden bg-slate-100">
                    <div className="bg-blue-500" style={{ width: `${debitShare}%` }} />
                    <div className="bg-teal-400 flex-1" />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                    <span>Debit</span>
                    <span className={selected.balanced ? 'text-emerald-600' : 'text-rose-600 font-semibold'}>
                      {selected.balanced ? 'Seimbang' : `Selisih ${formatIDR(selected.diff, true)}`}
                    </span>
                    <span>Kredit</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {checks.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-xs">
                    {c.ok
                      ? <CheckCircle2 size={14} className="text-emerald-500" />
                      : c.blocking ? <XCircle size={14} className="text-rose-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
                    <span className={c.ok ? 'text-foreground' : c.blocking ? 'text-rose-700 font-medium' : 'text-amber-700'}>{c.label}</span>
                  </div>
                ))}
              </div>

              {selected.notes.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <p className="font-semibold mb-1">Catatan</p>
                  {selected.notes.map((n, i) => <p key={i}>{n}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {drawerTx && <TransactionDrawer transaction={drawerTx} onClose={() => setDrawerTx(null)} />}
    </div>
  );
}
