'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import JePagination, { JE_PAGE_SIZE } from '../../journal-entry/components/JePagination';
import OtherTabs from '../components/OtherTabs';
import { OTHER_STATUS_VARIANT } from '../components/OtherJournalTable';
import { buildOtherJournals } from '../lib/otherJournals';

// Journal Preview = jurnal Other yang BELUM diposting (Unposted / Draft),
// ditampilkan lengkap per baris debit-kredit beserta cek keseimbangannya.
export default function OtherJournalPreviewPage() {
  const { getByGroup } = useTransactions();
  const pending = useMemo(
    () => buildOtherJournals(getByGroup('other')).filter((j) => j.status === 'Unposted' || j.status === 'Draft'),
    [getByGroup],
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter((j) => [j.jeId, j.party, j.description].some((v) => (v || '').toLowerCase().includes(q)));
  }, [pending, query]);

  useEffect(() => setPage(1), [query, pending]);
  const pageRows = filtered.slice((page - 1) * JE_PAGE_SIZE, page * JE_PAGE_SIZE);

  const ready = pending.filter((j) => j.status === 'Unposted' && j.balanced).length;
  const draft = pending.filter((j) => j.status === 'Draft').length;
  const unbalanced = pending.filter((j) => !j.balanced).length;
  const totalDebit = pending.reduce((s, j) => s + j.debit, 0);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="preview" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Siap Diposting" value={String(ready)} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Draft" value={String(draft)} icon="PencilSquareIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Tidak Balance" value={String(unbalanced)} icon="ExclamationTriangleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" alert={unbalanced > 0} />
        <KpiCard title="Total Debit Pending" value={totalDebit} icon="Squares2X2Icon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>

      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari no. jurnal, pihak, deskripsi..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        </div>

        {pageRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-14 text-center">Tidak ada jurnal Other yang menunggu posting.</p>
        ) : (
          <div className="divide-y divide-border">
            {pageRows.map((j) => {
              const isOpen = open.has(j.id);
              return (
                <div key={j.id}>
                  <button onClick={() => toggle(j.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors">
                    {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                    <span className="font-mono text-xs text-teal-600 w-32 shrink-0">{j.jeId}</span>
                    <span className="font-mono text-xs w-24 shrink-0">{formatDate(j.date)}</span>
                    <span className="text-xs text-foreground flex-1 min-w-0 truncate">{j.party ? `${j.party} — ` : ''}{j.description}</span>
                    <span className="font-mono text-xs w-28 text-right shrink-0">{formatIDR(j.amount, true)}</span>
                    {j.balanced
                      ? <StatusBadge variant="positive" label="Balance" dot />
                      : <StatusBadge variant="negative" label="Tidak balance" dot />}
                    <StatusBadge variant={OTHER_STATUS_VARIANT[j.status]} label={j.status} dot />
                  </button>
                  {isOpen && (
                    <div className="bg-muted/30 px-4 pb-4 pl-11">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="py-2 font-medium">Kode Akun</th>
                            <th className="py-2 font-medium">Akun</th>
                            <th className="py-2 font-medium text-right">Debit</th>
                            <th className="py-2 font-medium text-right">Kredit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {j.lines.map((l) => (
                            <tr key={l.id} className="border-t border-border">
                              <td className="py-2 font-mono">{l.accountCode || '—'}</td>
                              <td className="py-2">{l.accountName}</td>
                              <td className="py-2 font-mono text-right">{l.debit ? formatIDR(l.debit, true) : '—'}</td>
                              <td className="py-2 font-mono text-right">{l.credit ? formatIDR(l.credit, true) : '—'}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-border font-semibold">
                            <td className="py-2" colSpan={2}>Total{!j.balanced && ` (selisih ${formatIDR(j.diff, true)})`}</td>
                            <td className="py-2 font-mono text-right">{formatIDR(j.debit, true)}</td>
                            <td className="py-2 font-mono text-right">{formatIDR(j.credit, true)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <JePagination page={page} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} itemLabel="jurnal" />
      </div>
    </div>
  );
}
