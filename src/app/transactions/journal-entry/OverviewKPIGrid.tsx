'use client';

import React from 'react';
import KpiCard from '@/components/shared/KpiCard';

export default function OverviewKPIGrid() {
  // Backend integration point: fetch period summary from /api/journal-entries/summary
  // Desain kartu disamakan dengan shared KpiCard (dipakai di Sales/Purchase),
  // data & isi (title/value/subValue/trend/alert) tetap sama seperti sebelumnya.
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
      <KpiCard
        title="Total Journal Entries"
        value="42"
        subLabel="Sep 2026 period"
        change="+8 vs Aug 2026"
        changePositive={true}
        icon="BookOpenIcon"
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
      />
      <KpiCard
        title="Posted"
        value="24"
        subLabel="57% of total"
        change="+6 this week"
        changePositive={true}
        icon="CheckCircleIcon"
        iconBg="bg-emerald-50"
        iconColor="text-emerald-600"
      />
      <KpiCard
        title="Pending Review"
        value="8"
        subLabel="Awaiting action"
        icon="ClockIcon"
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
      />
      <KpiCard
        title="Draft"
        value="5"
        subLabel="In progress"
        icon="PencilSquareIcon"
        iconBg="bg-slate-100"
        iconColor="text-slate-600"
      />
      <KpiCard
        title="Unbalanced Entries"
        value="3"
        subLabel="Require correction"
        icon="ExclamationTriangleIcon"
        iconBg="bg-red-100"
        iconColor="text-red-600"
        alert
      />
      <KpiCard
        title="Exceptions"
        value="7"
        subLabel="Open issues"
        icon="XCircleIcon"
        iconBg="bg-orange-100"
        iconColor="text-orange-600"
      />
      <KpiCard
        title="Total Debits"
        value="$2.84M"
        subLabel="Sep 2026 period"
        change="+12.4% vs Aug"
        changePositive={true}
        icon="ArrowTrendingUpIcon"
        iconBg="bg-sky-50"
        iconColor="text-sky-600"
      />
      <KpiCard
        title="Total Credits"
        value="$2.81M"
        subLabel="Sep 2026 period"
        change="$30K imbalance"
        changePositive={false}
        icon="ArrowTrendingDownIcon"
        iconBg="bg-rose-50"
        iconColor="text-rose-600"
        alert
      />
    </div>
  );
}