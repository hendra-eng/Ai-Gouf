'use client';

import React, { useEffect } from 'react';
import Icon from '@/components/ui/AppIcon';
import { Transaction, formatIDR, formatDate, getStatusBadgeClass, getPaymentStatusBadge } from '@/lib/transactionData';

interface TransactionDrawerProps {
  transaction: Transaction | null;
  onClose: () => void;
}

export default function TransactionDrawer({ transaction, onClose }: TransactionDrawerProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (transaction) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [transaction, onClose]);

  if (!transaction) return null;

  const fields = [
    { label: 'Transaction ID', value: transaction.id },
    { label: 'Date', value: formatDate(transaction.date) },
    { label: 'Type', value: transaction.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { label: 'Category', value: transaction.category },
    { label: 'Account', value: transaction.account },
    { label: 'Counter Account', value: transaction.counterAccount },
    { label: 'Party', value: transaction.party },
    { label: 'Description', value: transaction.description },
    { label: 'Reference', value: transaction.reference },
    { label: 'Department', value: transaction.department },
    ...(transaction.invoiceNumber ? [{ label: 'Invoice No.', value: transaction.invoiceNumber }] : []),
    ...(transaction.dueDate ? [{ label: 'Due Date', value: formatDate(transaction.dueDate) }] : []),
    { label: 'Payment Method', value: transaction.paymentMethod },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 animate-fade-in"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-drawer z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-bold text-text-primary">Transaction Detail</h2>
            <p className="text-xs text-text-secondary font-mono mt-0.5">{transaction.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-secondary"
          >
            <Icon name="XMarkIcon" size={18} />
          </button>
        </div>

        {/* Amount Summary */}
        <div className="px-6 py-4 border-b border-border" style={{ background: '#f8fafc' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-text-secondary mb-1">Amount</p>
              <p className={`text-2xl font-bold font-mono ${transaction.amount < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                {formatIDR(transaction.amount)}
              </p>
              {transaction.tax > 0 && (
                <p className="text-xs text-text-secondary mt-1">
                  Tax: {formatIDR(transaction.tax)} · Total: {formatIDR(transaction.amount + transaction.tax)}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 items-end">
              <span className={`badge ${getStatusBadgeClass(transaction.status)}`}>{transaction.status}</span>
              <span className={`badge ${getPaymentStatusBadge(transaction.paymentStatus)}`}>{transaction.paymentStatus}</span>
              {transaction.reconciliationStatus && (
                <span className={`badge ${getStatusBadgeClass(transaction.reconciliationStatus)}`}>{transaction.reconciliationStatus}</span>
              )}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {fields.map(f => (
              <div key={f.label} className="flex justify-between gap-4">
                <span className="text-xs text-text-secondary flex-shrink-0 w-32">{f.label}</span>
                <span className="text-xs font-medium text-text-primary text-right">{f.value}</span>
              </div>
            ))}
          </div>

          {/* Flags */}
          {(transaction.isRecurring || transaction.isFlagged) && (
            <div className="mt-4 pt-4 border-t border-border space-y-2">
              {transaction.isRecurring && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                  <Icon name="ArrowPathIcon" size={13} />
                  Recurring transaction
                </div>
              )}
              {transaction.isFlagged && (
                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  <Icon name="FlagIcon" size={13} />
                  Flagged for review
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-medium rounded-lg border border-border text-text-secondary hover:bg-surface-secondary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
