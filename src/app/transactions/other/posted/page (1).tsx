'use client';

import React, { useMemo, useState } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatDate } from '../../lib/groupAnalytics';
import OtherTabs from '../components/OtherTabs';
import OtherJournalTable from '../components/OtherJournalTable';
import { buildOtherJournals } from '../lib/otherJournals';

export default function OtherPostedPage() {
  const { getByGroup } = useTransactions();
  const posted = useMemo(
    () => buildOtherJournals(getByGroup('other')).filter((j) => j.status === 'Posted' || j.status === 'Reconciled'),
    [getByGroup],
  );
  const [selected, setSelected] = useState<Transaction | null>(null);

  const total = posted.reduce((s, j) => s + j.amount, 0);
  const reconciled = posted.filter((j) => j.status === 'Reconciled').length;
  const latest = posted[0]?.date;

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="posted" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Jurnal Terposting" value={String(posted.length)} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Total Nilai Terposting" value={total} icon="Squares2X2Icon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title="Sudah Rekonsiliasi" value={String(reconciled)} icon="CheckBadgeIcon" iconColor="text-teal-600" iconBg="bg-teal-50" />
        <KpiCard title="Posting Terakhir" value={latest ? formatDate(latest) : '—'} icon="ClockIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
      </div>

      <OtherJournalTable
        journals={posted}
        statusOptions={['Posted', 'Reconciled']}
        onSelect={(j) => setSelected(j.lines[0])}
        emptyMessage="Belum ada jurnal Other yang diposting."
      />

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
