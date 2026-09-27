'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, type BackendJeDraft } from '@/lib/journalEntryStore';

const EntryTrendChart = dynamic(() => import('./charts/EntryTrendChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const StatusDistributionChart = dynamic(() => import('./charts/StatusDistributionChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const ExceptionBreakdownChart = dynamic(() => import('./charts/ExceptionBreakdownChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const STATUS_META: Record<string, { name: string; color: string }> = {
  posted: { name: 'Posted', color: '#15803D' },
  pending: { name: 'Pending Review', color: '#D97706' },
  draft: { name: 'Draft', color: '#64748B' },
  approved: { name: 'Approved', color: '#0369A1' },
  exception: { name: 'Exception', color: '#C2410C' },
  rejected: { name: 'Rejected', color: '#B91C1C' },
};

function formatTanggalPendek(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

/** Semua nilai di bawah DERIVABLE dari draft asli (tanggal/status/imbalance
 *  yang sungguhan tersimpan) -- tidak ada severity/kategori yang dikarang,
 *  mengikuti prinsip yang sama dengan exceptions/page.tsx. */
function hitungAgregat(drafts: BackendJeDraft[]) {
  const perTanggal = new Map<string, { entries: number; posted: number; exceptions: number }>();
  drafts.forEach(d => {
    const key = d.entry_date;
    if (!key) return;
    const row = perTanggal.get(key) || { entries: 0, posted: 0, exceptions: 0 };
    row.entries += 1;
    if (d.status === 'posted') row.posted += 1;
    if (d.status === 'exception') row.exceptions += 1;
    perTanggal.set(key, row);
  });
  const trendData = Array.from(perTanggal.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tanggal, v]) => ({ date: formatTanggalPendek(tanggal), ...v }));

  const statusCount = new Map<string, number>();
  drafts.forEach(d => statusCount.set(d.status, (statusCount.get(d.status) || 0) + 1));
  const statusDistribution = Array.from(statusCount.entries()).map(([status, value]) => ({
    name: STATUS_META[status]?.name ?? status,
    value,
    color: STATUS_META[status]?.color ?? '#94A3B8',
  }));

  const mismatch = drafts.filter(d => Math.abs(d.total_debit - d.total_credit) > 0.01).length;
  const flagged = drafts.filter(d => d.status === 'exception').length;
  const rejected = drafts.filter(d => d.status === 'rejected').length;
  const exceptionBreakdown = [
    { type: 'Debit/Credit Mismatch', count: mismatch, color: '#DC2626' },
    { type: 'Flagged as Exception', count: flagged, color: '#EA580C' },
    { type: 'Rejected', count: rejected, color: '#B91C1C' },
  ].filter(r => r.count > 0);

  return { trendData, statusDistribution, exceptionBreakdown };
}

export default function OverviewCharts() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts } = useJeDrafts(clientId);
  const { trendData, statusDistribution, exceptionBreakdown } = useMemo(() => hitungAgregat(drafts), [drafts]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
      {/* Entry Volume Trend — spans 2 cols */}
      <div className="lg:col-span-2 je-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-700 text-foreground">Journal Entry Volume</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Entries created vs posted per entry date</p>
          </div>
        </div>
        <EntryTrendChart data={trendData} />
      </div>

      {/* Status Distribution */}
      <div className="je-card p-5">
        <div className="mb-4">
          <h2 className="text-sm font-700 text-foreground">Entry Status Distribution</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{drafts.length} total entries</p>
        </div>
        <StatusDistributionChart data={statusDistribution} />
      </div>

      {/* Exception Breakdown */}
      <div className="lg:col-span-3 je-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-700 text-foreground">Exception Breakdown</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Entries that need review before period close</p>
          </div>
          <a href="/transactions/journal-entry/exceptions" className="text-xs text-primary font-600 hover:underline">View All Exceptions →</a>
        </div>
        <ExceptionBreakdownChart data={exceptionBreakdown} />
      </div>
    </div>
  );
}
