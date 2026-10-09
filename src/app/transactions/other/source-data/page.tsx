'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate, CHART_COLORS } from '../../lib/groupAnalytics';
import JePagination, { JE_PAGE_SIZE } from '../../journal-entry/components/JePagination';
import OtherTabs from '../components/OtherTabs';
import { sourceLabelOf, lineIssues } from '../lib/otherJournals';

// SOURCE DATA = pintu masuk data. Fokus: dari mana data berasal dan seberapa
// lengkap/bersih datanya sebelum dijurnal. Atas: kualitas data + komposisi
// sumber. Bawah: baris mentah dengan penanda masalah per baris.

function QualityMeter({ label, ok, total, hint }: { label: string; ok: number; total: number; hint: string }) {
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const color = pct >= 95 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500';
  const text = pct >= 95 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-rose-600';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className={`text-lg font-bold font-mono ${text}`}>{total ? `${pct}%` : '—'}</p>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{ok} dari {total} baris · {hint}</p>
    </div>
  );
}

export default function OtherSourceDataPage() {
  const { getByGroup } = useTransactions();
  const rows = useMemo(() => getByGroup('other'), [getByGroup]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [quality, setQuality] = useState('all');
  const [page, setPage] = useState(1);

  const bySource = useMemo(() => {
    const m = new Map<string, { rows: number; total: number }>();
    rows.forEach((r) => {
      const k = sourceLabelOf(r);
      const cur = m.get(k) ?? { rows: 0, total: 0 };
      cur.rows += 1;
      cur.total += r.debit + r.credit;
      m.set(k, cur);
    });
    return Array.from(m.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rows - a.rows);
  }, [rows]);

  const withJe = rows.filter((r) => (r.jeId || '').trim()).length;
  const mapped = rows.filter((r) => r.standardAccountCode).length;
  const clean = rows.filter((r) => lineIssues(r).length === 0).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (source !== 'all' && sourceLabelOf(r) !== source) return false;
      const issues = lineIssues(r).length;
      if (quality === 'issue' && issues === 0) return false;
      if (quality === 'clean' && issues > 0) return false;
      if (!q) return true;
      return [r.txId, r.jeId, r.accountCode, r.accountName, r.party, r.description].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [rows, query, source, quality]);

  useEffect(() => setPage(1), [query, source, quality, rows]);
  const pageRows = filtered.slice((page - 1) * JE_PAGE_SIZE, page * JE_PAGE_SIZE);

  const columns = [
    { key: 'date', label: 'Tanggal', render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'source', label: 'Sumber', render: (r: Transaction) => <span className="badge badge-neutral">{sourceLabelOf(r)}</span> },
    { key: 'je', label: 'No. Jurnal', render: (r: Transaction) => <span className="font-mono text-xs">{(r.jeId || '').trim() || '—'}</span> },
    { key: 'account', label: 'Akun', render: (r: Transaction) => <span className="text-xs"><span className="font-mono text-muted-foreground">{r.accountCode || '—'}</span> {r.accountName}</span> },
    { key: 'std', label: 'Akun Standar', render: (r: Transaction) => <span className="font-mono text-xs">{r.standardAccountCode || '—'}</span> },
    { key: 'debit', label: 'Debit', render: (r: Transaction) => <span className="font-mono text-xs">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    {
      key: 'issues', label: 'Kondisi',
      render: (r: Transaction) => {
        const issues = lineIssues(r);
        return issues.length === 0
          ? <span className="badge badge-positive">Bersih</span>
          : <span className="badge badge-warning" title={issues.join(', ')}>{issues.length} masalah</span>;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="source" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-foreground">Kualitas Data Sumber</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Seberapa siap data ini untuk dijurnal</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold font-mono text-foreground">{rows.length}</p>
              <p className="text-xs text-muted-foreground">baris · {clean} bersih</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <QualityMeter label="Kelengkapan No. Jurnal" ok={withJe} total={rows.length} hint="baris punya jeId" />
            <QualityMeter label="Pemetaan Akun Standar" ok={mapped} total={rows.length} hint="baris terpetakan ke COA" />
          </div>
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground">Komposisi Sumber</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">Klik untuk memfilter tabel</p>
          {bySource.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data sumber.</p>
          ) : (
            <>
              <div className="flex w-full h-3 rounded-full overflow-hidden mb-4">
                {bySource.map((s, i) => (
                  <div key={s.name} title={`${s.name}: ${s.rows} baris`} style={{ width: `${(s.rows / rows.length) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                ))}
              </div>
              <div className="space-y-1.5">
                {bySource.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setSource(source === s.name ? 'all' : s.name)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors ${source === s.name ? 'bg-blue-50' : 'hover:bg-muted'}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="font-medium text-foreground flex-1 truncate">{s.name}</span>
                    <span className="text-muted-foreground">{s.rows} baris</span>
                    <span className="font-mono text-foreground">{formatIDR(s.total, true)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari TX ID, akun, pihak..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {[['all', 'Semua'], ['issue', 'Bermasalah'], ['clean', 'Bersih']].map(([k, label]) => (
              <button key={k} onClick={() => setQuality(k)} className={`px-3 py-2 transition-colors ${quality === k ? 'bg-blue-600 text-white' : 'bg-background text-muted-foreground hover:bg-muted'}`}>{label}</button>
            ))}
          </div>
          {source !== 'all' && (
            <button onClick={() => setSource('all')} className="text-xs px-2.5 py-1.5 rounded-full bg-blue-50 text-blue-700">Sumber: {source} ✕</button>
          )}
        </div>
        <DataTable<Transaction> columns={columns} data={pageRows} onRowClick={setSelected} emptyMessage="Tidak ada baris yang cocok." />
        <JePagination page={page} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="baris" />
      </div>

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
