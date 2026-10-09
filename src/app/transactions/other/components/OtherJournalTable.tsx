'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import JePagination, { JE_PAGE_SIZE } from '../../journal-entry/components/JePagination';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import type { OtherJournal, JournalStatus } from '../lib/otherJournals';

export const OTHER_STATUS_VARIANT: Record<JournalStatus, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// Tabel jurnal Other (1 baris = 1 nomor jurnal) dengan pencarian, filter status
// opsional, dan pagination yang sama dengan tab Journal Entry.
export default function OtherJournalTable({
  journals,
  onSelect,
  statusOptions,
  emptyMessage = 'Belum ada jurnal Other.',
}: {
  journals: OtherJournal[];
  onSelect: (j: OtherJournal) => void;
  statusOptions?: JournalStatus[];
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return journals.filter((j) => {
      if (status !== 'all' && j.status !== status) return false;
      if (!q) return true;
      return [j.jeId, j.party, j.description, j.category].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [journals, query, status]);

  useEffect(() => setPage(1), [query, status, journals]);

  const pageRows = filtered.slice((page - 1) * JE_PAGE_SIZE, page * JE_PAGE_SIZE);

  const columns = [
    { key: 'date', label: 'Tanggal', render: (r: OtherJournal) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'jeId', label: 'No. Jurnal', render: (r: OtherJournal) => <span className="font-mono text-xs text-teal-600">{r.jeId}</span> },
    { key: 'party', label: 'Pihak', render: (r: OtherJournal) => <span className="font-medium text-xs">{r.party || '—'}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: OtherJournal) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: OtherJournal) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'lines', label: 'Baris', render: (r: OtherJournal) => <span className="text-xs">{r.lines.length}</span> },
    { key: 'amount', label: 'Nilai', render: (r: OtherJournal) => <span className="font-mono text-xs">{formatIDR(r.amount, true)}</span> },
    { key: 'status', label: 'Status', render: (r: OtherJournal) => <StatusBadge variant={OTHER_STATUS_VARIANT[r.status]} label={r.status} dot /> },
  ];

  return (
    <div className="card-elevated-md rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari no. jurnal, pihak, deskripsi..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        {statusOptions && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg"
          >
            <option value="all">Semua status</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      <DataTable<OtherJournal> columns={columns} data={pageRows} onRowClick={onSelect} emptyMessage={emptyMessage} />
      <JePagination page={page} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="jurnal" />
    </div>
  );
}
