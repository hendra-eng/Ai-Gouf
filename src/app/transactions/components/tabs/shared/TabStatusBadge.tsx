'use client';

// [BARU] Badge status khusus tab-tab baru di halaman /transactions.
// File-file di folder tabs/ (Sales/Purchase/Journal Entry/Cash & Bank/Other)
// semula memanggil `<StatusBadge status="paid" />` dkk — tapi StatusBadge asli
// project ini (src/components/ui/StatusBadge.tsx) cuma terima `label` +
// `variant`, bukan `status`. Komponen ini jadi pemetaan: terima string status
// apa adanya (posted, paid, reconciled, dst) lalu render StatusBadge asli
// dengan label & variant yang sesuai.
import React from 'react';
import StatusBadge from '@/components/ui/StatusBadge';

type BadgeVariant = 'positive' | 'negative' | 'warning' | 'info' | 'ai' | 'neutral';

interface TabStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  // posting / approval status
  posted: { label: 'Posted', variant: 'positive' },
  approved: { label: 'Approved', variant: 'positive' },
  draft: { label: 'Draft', variant: 'neutral' },
  pending: { label: 'Pending', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'negative' },
  // payment status
  paid: { label: 'Paid', variant: 'positive' },
  unpaid: { label: 'Unpaid', variant: 'negative' },
  overdue: { label: 'Overdue', variant: 'negative' },
  partial: { label: 'Partial', variant: 'warning' },
  // reconciliation status (Cash & Bank)
  reconciled: { label: 'Reconciled', variant: 'positive' },
  unreconciled: { label: 'Unreconciled', variant: 'negative' },
  review: { label: 'In Review', variant: 'info' },
  // journal balance status
  balanced: { label: 'Balanced', variant: 'positive' },
  unbalanced: { label: 'Unbalanced', variant: 'negative' },
  // misc
  voided: { label: 'Voided', variant: 'neutral' },
};

export default function TabStatusBadge({ status, size = 'md', className }: TabStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'neutral' as const };
  return <StatusBadge label={config.label} variant={config.variant} size={size} className={className} />;
}
