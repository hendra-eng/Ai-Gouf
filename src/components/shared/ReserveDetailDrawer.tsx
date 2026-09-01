'use client';

import React, { useEffect } from 'react';
import Icon from '@/components/ui/AppIcon';
import { CashReserveEntry, formatIDR, formatDate, getStatusBadgeClass } from '@/lib/transactionData';

interface ReserveDetailDrawerProps {
  entry: CashReserveEntry | null;
  onClose: () => void;
}

export default function ReserveDetailDrawer({ entry, onClose }: ReserveDetailDrawerProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (entry) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const coveragePct = entry.minimumTarget > 0 ? (entry.reservedAmount / entry.minimumTarget) * 100 : 0;

  const fields = [
    { label: 'Entry ID', value: entry.id },
    { label: 'Date', value: formatDate(entry.date) },
    { label: 'Account', value: entry.account },
    { label: 'Reserve Type', value: entry.reserveType },
    { label: 'Opening Balance', value: formatIDR(entry.openingBalance) },
    { label: 'Inflow', value: `+${formatIDR(entry.inflow)}` },
    { label: 'Outflow', value: `-${formatIDR(entry.outflow)}` },
    { label: 'Minimum Target', value: formatIDR(entry.minimumTarget) },
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
            <h2 className="text-base font-bold text-text-primary">Reserve Entry Detail</h2>
            <p className="text-xs text-text-secondary font-mono mt-0.5">{entry.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-secondary"
          >
            <Icon name="XMarkIcon" size={18} />
          </button>
        </div>

        {/* Balance Summary */}
        <div className="px-6 py-4 border-b border-border" style={{ background: '#f8fafc' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-text-secondary mb-1">Available Balance</p>
              <p className="text-2xl font-bold font-mono text-text-primary">
                {formatIDR(entry.availableBalance)}
              </p>
              <p className={`text-xs mt-1 ${entry.variance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                Variance: {entry.variance >= 0 ? '+' : ''}{formatIDR(entry.variance)} vs target
              </p>
            </div>
            <div className="flex flex-col gap-1.5 items-end">
              <span className={`badge ${getStatusBadgeClass(entry.status)}`}>{entry.status}</span>
              <span className="text-xs text-text-secondary font-mono">Reserved: {formatIDR(entry.reservedAmount, true)}</span>
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

          {/* Reserve Coverage */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">Reserve vs Minimum Target</span>
              <span className={`text-xs font-bold ${coveragePct >= 100 ? 'text-emerald-600' : coveragePct >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
                {coveragePct.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(coveragePct, 100)}%`,
                  background: coveragePct >= 100 ? '#10b981' : coveragePct >= 80 ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
          </div>

          {entry.status === 'Below Target' && (
            <div className="mt-4 flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              <Icon name="ExclamationTriangleIcon" size={13} />
              Reserved amount is below the minimum target for this account.
            </div>
          )}
          {entry.status === 'Watch' && (
            <div className="mt-4 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              <Icon name="ExclamationCircleIcon" size={13} />
              Reserve coverage is close to the minimum target — worth monitoring.
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
