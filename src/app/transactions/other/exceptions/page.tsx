'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import JePagination, { JE_PAGE_SIZE } from '../../journal-entry/components/JePagination';
import OtherTabs from '../components/OtherTabs';
import {
  buildOtherJournals, buildOtherExceptions, EXCEPTION_TYPES,
  type OtherException, type ExceptionSeverity,
} from '../lib/otherJournals';

const SEVERITY_VARIANT: Record<ExceptionSeverity, 'negative' | 'warning' | 'neutral'> = {
  High: 'negative', Medium: 'warning', Low: 'neutral',
};

// Exceptions = temuan otomatis dari data Other (tanpa nomor jurnal, tidak
// balance, draft, ada catatan, akun belum dipetakan). Hanya tampilan baca:
// temuan hilang sendiri begitu datanya diperbaiki di halaman Transaksi.
export default function OtherExceptionsPage() {
  const { getByGroup } = useTransactions();
  const exceptions = useMemo(() => buildOtherExceptions(buildOtherJournals(getByGroup('other'))), [getByGroup]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [page, setPage] = useState(1);

  const count = (s: ExceptionSeverity) => exceptions.filter((e) => e.severity === s).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exceptions.filter((e) => {
      if (type !== 'all' && e.type !== type) return false;
      if (severity !== 'all' && e.severity !== severity) return false;
      if (!q) return true;
      return [e.journal.jeId, e.journal.party, e.journal.description, e.detail].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [exceptions, query, type, severity]);

  useEffect(() => setPage(1), [query, type, severity, exceptions]);
  const pageRows = filtered.slice((page - 1) * JE_PAGE_SIZE, page * JE_PAGE_SIZE);

  const columns = [
    { key: 'severity', label: 'Prioritas', render: (e: OtherException) => <StatusBadge variant={SEVERITY_VARIANT[e.severity]} label={e.severity} dot /> },
    { key: 'type', label: 'Jenis Temuan', render: (e: OtherException) => <span className="text-xs font-medium">{e.type}</span> },
    { key: 'jeId', label: 'No. Jurnal', render: (e: OtherException) => <span className="font-mono text-xs text-teal-600">{e.journal.jeId}</span> },
    { key: 'date', label: 'Tanggal', render: (e: OtherException) => <span className="font-mono text-xs">{formatDate(e.journal.date)}</span> },
    { key: 'party', label: 'Pihak', render: (e: OtherException) => <span className="text-xs">{e.journal.party || '—'}</span> },
    { key: 'amount', label: 'Nilai', render: (e: OtherException) => <span className="font-mono text-xs">{formatIDR(e.journal.amount, true)}</span> },
    { key: 'detail', label: 'Keterangan', render: (e: OtherException) => <span className="text-xs text-muted-foreground max-w-sm truncate block">{e.detail}</span> },
  ];

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="exceptions" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Temuan" value={String(exceptions.length)} icon="ExclamationTriangleIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={exceptions.length > 0} />
        <KpiCard title="Prioritas High" value={String(count('High'))} icon="ExclamationTriangleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" alert={count('High') > 0} />
        <KpiCard title="Prioritas Medium" value={String(count('Medium'))} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
        <KpiCard title="Prioritas Low" value={String(count('Low'))} icon="DocumentTextIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>

      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari no. jurnal, pihak, keterangan..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
            <option value="all">Semua jenis</option>
            {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="px-3 py-2 text-sm bg-background border border-border rounded-lg">
            <option value="all">Semua prioritas</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
        <DataTable<OtherException>
          columns={columns}
          data={pageRows}
          onRowClick={(e) => setSelected(e.journal.lines[0])}
          emptyMessage="Tidak ada temuan — semua jurnal Other dalam kondisi baik."
        />
        <JePagination page={page} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="temuan" />
      </div>

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
