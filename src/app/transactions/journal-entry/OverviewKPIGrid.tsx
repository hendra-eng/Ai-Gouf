'use client';

import React, { useMemo } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import { useAuth } from '@/lib/auth';
import { useJeDrafts } from '@/lib/journalEntryStore';

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n);

export default function OverviewKPIGrid() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts, loading } = useJeDrafts(clientId);

  const stats = useMemo(() => {
    const total = drafts.length;
    const posted = drafts.filter(d => d.status === 'posted').length;
    const pending = drafts.filter(d => d.status === 'pending').length;
    const draft = drafts.filter(d => d.status === 'draft').length;
    const unbalanced = drafts.filter(d => Math.abs(d.total_debit - d.total_credit) > 0.01).length;
    const exceptions = drafts.filter(d => d.status === 'exception').length;
    const totalDebit = drafts.reduce((s, d) => s + d.total_debit, 0);
    const totalCredit = drafts.reduce((s, d) => s + d.total_credit, 0);
    return {
      total, posted, pending, draft, unbalanced, exceptions, totalDebit, totalCredit,
      postedPct: total > 0 ? Math.round((posted / total) * 100) : 0,
      imbalance: totalDebit - totalCredit,
    };
  }, [drafts]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="je-card p-4 h-[104px] animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
      <KpiCard
        title="Total Journal Entries"
        value={String(stats.total)}
        subLabel="Seluruh periode"
        icon="BookOpenIcon"
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
      />
      <KpiCard
        title="Posted"
        value={String(stats.posted)}
        subLabel={`${stats.postedPct}% of total`}
        icon="CheckCircleIcon"
        iconBg="bg-emerald-50"
        iconColor="text-emerald-600"
      />
      <KpiCard
        title="Pending Review"
        value={String(stats.pending)}
        subLabel="Awaiting action"
        icon="ClockIcon"
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
      />
      <KpiCard
        title="Draft"
        value={String(stats.draft)}
        subLabel="In progress"
        icon="PencilSquareIcon"
        iconBg="bg-slate-100"
        iconColor="text-slate-600"
      />
      <KpiCard
        title="Unbalanced Entries"
        value={String(stats.unbalanced)}
        subLabel="Require correction"
        icon="ExclamationTriangleIcon"
        iconBg="bg-red-100"
        iconColor="text-red-600"
        alert={stats.unbalanced > 0}
      />
      <KpiCard
        title="Exceptions"
        value={String(stats.exceptions)}
        subLabel="Open issues"
        icon="XCircleIcon"
        iconBg="bg-orange-100"
        iconColor="text-orange-600"
        alert={stats.exceptions > 0}
      />
      <KpiCard
        title="Total Debits"
        value={fmtUsd(stats.totalDebit)}
        subLabel="Seluruh periode"
        icon="ArrowTrendingUpIcon"
        iconBg="bg-sky-50"
        iconColor="text-sky-600"
      />
      <KpiCard
        title="Total Credits"
        value={fmtUsd(stats.totalCredit)}
        subLabel={Math.abs(stats.imbalance) > 0.01 ? `${fmtUsd(Math.abs(stats.imbalance))} imbalance` : 'Balanced'}
        icon="ArrowTrendingDownIcon"
        iconBg="bg-rose-50"
        iconColor="text-rose-600"
        alert={Math.abs(stats.imbalance) > 0.01}
      />
    </div>
  );
}
