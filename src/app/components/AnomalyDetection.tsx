'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { ShieldAlert, Eye, History, X } from 'lucide-react';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

// Backend integration point: replace with /api/ai/anomalies?company=&period=
const anomalies = [
  {
    id: 'anom-001',
    vendor: 'CV Mitra Abadi Jaya',
    amount: 'Rp 185.000.000',
    amountNum: 185,
    expectedRange: 'Rp 20Jt – Rp 50Jt',
    risk: 'High' as const,
    date: '22 Aug 2026',
    category: 'Vendor Payment',
    txId: 'TXN-2026-08422',
  },
  {
    id: 'anom-002',
    vendor: 'Petty Cash — Ops',
    amount: 'Rp 42.500.000',
    amountNum: 42.5,
    expectedRange: 'Rp 5Jt – Rp 15Jt',
    risk: 'Medium' as const,
    date: '19 Aug 2026',
    category: 'Petty Cash',
    txId: 'TXN-2026-08318',
  },
];

const riskStyle = {
  High: 'badge-negative',
  Medium: 'badge-warning',
  Low: 'badge-info',
};

export default function AnomalyDetection() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { fx } = useCurrency();
  const { t } = useLanguage();

  const visible = anomalies.filter((a) => !dismissed.has(a.id));

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-negative" />
          <h2 className="text-base font-bold text-foreground">{t('Anomaly Detection')}</h2>
        </div>
        {visible.length > 0 && (
          <span className="badge-negative">{visible.length} {t(visible.length > 1 ? 'alerts' : 'alert')}</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-full bg-positive-subtle flex items-center justify-center mx-auto mb-2">
            <ShieldAlert size={18} className="text-positive" />
          </div>
          <p className="text-sm font-semibold text-foreground">{t('No anomalies detected')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('All transactions are within expected ranges')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <div key={a.id} className="rounded-xl border border-negative/20 bg-negative-subtle p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(a.category)}</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">{a.vendor}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={riskStyle[a.risk]}>{t(a.risk)} {t('Risk')}</span>
                  <button
                    onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
                    className="p-1 rounded hover:bg-negative/10 text-muted-foreground hover:text-negative transition-colors"
                    aria-label="Dismiss anomaly"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('Amount')}</p>
                  <p className="text-sm font-bold font-mono text-negative">{fx(a.amount)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('Expected')}</p>
                  <p className="text-xs font-semibold text-foreground">{fx(t(a.expectedRange))}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-mono">{a.txId} · {a.date}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => toast.info(`${t('Meninjau anomali pada')} ${a.vendor}`, { description: a.txId })}
                    className="btn-ghost py-1 px-2 text-xs gap-1"
                  >
                    <Eye size={12} />
                    {t('Review')}
                  </button>
                  <button
                    onClick={() => toast.info(`${t('Riwayat transaksi')} ${a.vendor}`, { description: a.txId })}
                    className="btn-ghost py-1 px-2 text-xs gap-1"
                  >
                    <History size={12} />
                    {t('History')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
