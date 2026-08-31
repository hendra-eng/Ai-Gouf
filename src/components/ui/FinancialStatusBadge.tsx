import React from 'react';

type BadgeVariant = 'active' | 'inactive' | 'overdue' | 'warning' | 'paid' | 'disposed' | 'maintenance' | 'scheduled' | 'due-soon' | 'ai' | 'neutral' | 'fully-depreciated';

const variantStyles: Record<BadgeVariant, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  inactive: 'bg-gray-100 text-gray-600 border-gray-200',
  overdue: 'bg-negative-subtle text-negative border-red-200',
  warning: 'bg-warning-subtle text-warning border-amber-200',
  paid: 'bg-green-50 text-green-700 border-green-200',
  disposed: 'bg-gray-100 text-gray-500 border-gray-200',
  maintenance: 'bg-blue-50 text-blue-700 border-blue-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  'due-soon': 'bg-warning-subtle text-warning border-amber-200',
  ai: 'bg-ai-subtle text-ai border-purple-200',
  neutral: 'bg-muted text-muted-foreground border-border',
  'fully-depreciated': 'bg-gray-100 text-gray-500 border-gray-200',
};

const variantLabels: Record<BadgeVariant, string> = {
  active: 'Active',
  inactive: 'Inactive',
  overdue: 'Overdue',
  warning: 'Warning',
  paid: 'Paid',
  disposed: 'Disposed',
  maintenance: 'Under Maintenance',
  scheduled: 'Scheduled',
  'due-soon': 'Due Soon',
  ai: 'AI',
  neutral: 'Neutral',
  'fully-depreciated': 'Fully Depreciated',
};

interface FinancialStatusBadgeProps {
  variant: BadgeVariant;
  label?: string;
  size?: 'sm' | 'md';
}

export default function FinancialStatusBadge({ variant, label, size = 'sm' }: FinancialStatusBadgeProps) {
  const text = label ?? variantLabels[variant];
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1';
  return (
    <span className={`fin-badge border ${variantStyles[variant]} ${sizeClass} whitespace-nowrap`}>
      {text}
    </span>
  );
}
