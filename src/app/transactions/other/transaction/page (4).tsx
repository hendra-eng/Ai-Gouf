'use client';

import React, { useMemo, useState } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import OtherTabs from '../components/OtherTabs';
import OtherJournalTable from '../components/OtherJournalTable';
import { buildOtherJournals } from '../lib/otherJournals';

export default function OtherTransactionTabPage() {
  const { getByGroup } = useTransactions();
  const journals = useMemo(() => buildOtherJournals(getByGroup('other')), [getByGroup]);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const active = journals.filter((j) => j.status !== 'Voided');
  const total = active.filter((j) => j.status !== 'Draft').reduce((s, j) => s + j.amount, 0);
  const unposted = journals.filter((j) => j.status === 'Unposted').length;
  const draft = journals.filter((j) => j.status === 'Draft').length;

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="transaction" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Jumlah Jurnal" value={String(active.length)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Total Nilai (tanpa Draft)" value={total} icon="Squares2X2Icon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title="Belum Diposting" value={String(unposted)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unposted > 0} />
        <KpiCard title="Draft" value={String(draft)} icon="PencilSquareIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
      </div>

      <OtherJournalTable
        journals={journals}
        statusOptions={['Unposted', 'Draft', 'Posted', 'Reconciled', 'Voided']}
        onSelect={(j) => setSelected(j.lines[0])}
      />

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
