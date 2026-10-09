'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import DataTable from '@/components/shared/DataTable';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import JePagination, { JE_PAGE_SIZE } from '../../journal-entry/components/JePagination';
import OtherTabs from '../components/OtherTabs';
import { sourceLabelOf } from '../lib/otherJournals';

// Source Data = baris mentah (per kaki jurnal) transaksi Other beserta asal
// datanya (sourceModule) dan status pemetaan akun standarnya.
export default function OtherSourceDataPage() {
  const { getByGroup } = useTransactions();
  const rows = useMemo(() => getByGroup('other'), [getByGroup]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [mapping, setMapping] = useState('all');
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

  const unmapped = rows.filter((r) => !r.standardAccountCode).length;
  const withoutJe = rows.filter((r) => !(r.jeId || '').trim()).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (source !== 'all' && sourceLabelOf(r) !== source) return false;
      if (mapping === 'mapped' && !r.standardAccountCode) return false;
      if (mapping === 'unmapped' && r.standardAccountCode) return false;
      if (!q) return true;
      return [r.txId, r.jeId, r.accountCode, r.accountName, r.party, r.description].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [rows, query, source, mapping]);

  useEffect(() => setPage(1), [query, source, mapping, rows]);
  const pageRows = filtered.slice((page - 1) * JE_PAGE_SIZE, page * JE_PAGE_SIZE);

  const columns = [
    { key: 'date', label: 'Tanggal', render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'source', label: 'Sumber', render: (r: Transaction) => <span className="badge badge-neutral">{sourceLabelOf(r)}</span> },
    { key: 'accountCode', label: 'Kode Akun', render: (r: Transaction) => <span className="font-mono text-xs">{r.accountCode || '—'}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    {
      key: 'standard', label: 'Akun Standar',
      render: (r: Transaction) => r.standardAccountCode
        ? <span className="font-mono text-xs">{r.standardAccountCode}</span>
        : <span className="badge badge-warning">Belum dipetakan</span>,
    },
    { key: 'debit', label: 'Debit', render: (r: Transaction) => <span className="font-mono text-xs">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="source" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Baris Sumber" value={String(rows.length)} icon="CircleStackIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Jumlah Sumber" value={String(bySource.length)} icon="Squares2X2Icon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title="Akun Belum Dipetakan" value={String(unmapped)} icon="ExclamationTriangleIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unmapped > 0} />
        <KpiCard title="Tanpa Nomor Jurnal" value={String(withoutJe)} icon="ExclamationTriangleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" alert={withoutJe > 0} />
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Ringkasan per Sumber</h2>
        <p className="text-xs text-muted-foreground mb-4">Asal data transaksi Other (kolom sourceModule)</p>
        {bySource.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data sumber.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {bySource.map((s) => (
              <button
                key={s.name}
                onClick={() => setSource(source === s.name ? 'all' : s.name)}
                className={`text-left rounded-lg border px-4 py-3 transition-colors ${source === s.name ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted'}`}
              >
                <p className="text-sm font-semibold text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.rows} baris · {formatIDR(s.total, true)}</p>
              </button>
            ))}
          </div>
        )}
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
          <select value={source} onChange={(e) => setSource(e.target.value)} className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
            <option value="all">Semua sumber</option>
            {bySource.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <select value={mapping} onChange={(e) => setMapping(e.target.value)} className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
            <option value="all">Semua pemetaan</option>
            <option value="mapped">Sudah dipetakan</option>
            <option value="unmapped">Belum dipetakan</option>
          </select>
        </div>
        <DataTable<Transaction> columns={columns} data={pageRows} onRowClick={setSelected} emptyMessage="Belum ada data sumber Other." />
        <JePagination page={page} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="baris" />
      </div>

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
