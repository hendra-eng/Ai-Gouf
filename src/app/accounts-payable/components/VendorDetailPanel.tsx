'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Vendor, bills, formatRupiah, riskColors, apStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

interface Props {
  vendor: Vendor;
  onClose: () => void;
}

export default function VendorDetailPanel({ vendor, onClose }: Props) {
  const router = useRouter();
  const { fx } = useCurrency();
  const [activeTab, setActiveTab] = useState<'overview' | 'bills' | 'payments'>('overview');
  const vendorBills = bills.filter((b) => b.vendorId === vendor.id);

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'bills' as const, label: 'Bills', count: vendorBills.length },
    { id: 'payments' as const, label: 'Payment History' },
  ];

  const paymentHistory = [
    { id: `vph-${vendor.id}-1`, date: '2026-08-10', amount: Math.round(vendor.totalAP * 0.28), method: 'Bank Transfer', ref: `PAY-${vendor.code}-001` },
    { id: `vph-${vendor.id}-2`, date: '2026-07-15', amount: Math.round(vendor.totalAP * 0.22), method: 'Bank Transfer', ref: `PAY-${vendor.code}-002` },
    { id: `vph-${vendor.id}-3`, date: '2026-06-20', amount: Math.round(vendor.totalAP * 0.25), method: 'Giro', ref: `PAY-${vendor.code}-003` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-card border-l border-border shadow-card-lg overflow-y-auto fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-700 text-foreground truncate">{vendor.name}</h2>
                <StatusBadge label={vendor.riskLevel} className={riskColors[vendor.riskLevel]} size="md" />
              </div>
              <p className="text-sm text-muted-foreground">{vendor.code} · {vendor.category}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors flex-shrink-0">
              <Icon name="XMarkIcon" size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => toast.success('Payment scheduled')}
              className="flex items-center gap-1.5 text-xs font-500 text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="CalendarIcon" size={12} />
              Schedule Payment
            </button>
            <button
              onClick={() => router.push('/ai-financial-analyst?analysis=ap-risk')}
              className="flex items-center gap-1.5 text-xs font-500 text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="SparklesIcon" size={12} />
              AI Payment Risk
            </button>
          </div>
          <div className="flex gap-1 mt-3 -mb-4 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={`vend-detail-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-500 border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="text-2xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">{tab.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-5 mt-4">
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total AP', value: fx(formatRupiah(vendor.totalAP, true)), color: 'text-foreground' },
                  { label: 'Current AP', value: fx(formatRupiah(vendor.currentAP, true)), color: 'text-info' },
                  { label: 'Overdue AP', value: vendor.overdueAP > 0 ? fx(formatRupiah(vendor.overdueAP, true)) : '—', color: vendor.overdueAP > 0 ? 'text-danger' : 'text-muted-foreground' },
                  { label: 'Due Soon', value: vendor.dueSoon > 0 ? fx(formatRupiah(vendor.dueSoon, true)) : '—', color: vendor.dueSoon > 0 ? 'text-warning' : 'text-muted-foreground' },
                  { label: 'Payment Terms', value: vendor.paymentTerms, color: 'text-foreground' },
                  { label: 'Avg Payment Days', value: `${vendor.avgPaymentDays} days`, color: vendor.avgPaymentDays > 35 ? 'text-warning' : 'text-success' },
                ].map((m) => (
                  <div key={`vend-metric-${m.label}`} className="bg-secondary/50 rounded-lg p-3">
                    <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
                    <p className={`text-xl font-700 tabular-nums ${m.color}`}>{m.value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-sm font-600 text-foreground mb-3">Payment Schedule</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Next Payment Due</span>
                    <span className="font-500 text-primary">{vendor.nextPayment}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Method</span>
                    <span className="font-500">Bank Transfer</span>
                  </div>
                </div>
              </div>

              <div className="bg-ai-purple-bg border border-purple-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="SparklesIcon" size={14} className="text-ai-purple" />
                  <span className="text-sm font-600 text-ai-purple">AI Payment Risk</span>
                </div>
                <p className="text-xs text-ai-purple-foreground leading-relaxed">
                  {vendor.riskLevel === 'Critical'
                    ? `${vendor.name} has ${fx(formatRupiah(vendor.overdueAP, true))} overdue. Immediate payment required to avoid service disruption and maintain vendor relationship.`
                    : `${vendor.name} payment profile is ${vendor.riskLevel.toLowerCase()} risk. Avg payment cycle ${vendor.avgPaymentDays} days — within acceptable terms.`
                  }
                </p>
              </div>
            </>
          )}

          {activeTab === 'bills' && (
            <div className="space-y-2">
              {vendorBills.length === 0 ? (
                <div className="text-center py-8">
                  <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No bills found for this vendor</p>
                </div>
              ) : (
                vendorBills.map((b) => (
                  <div key={b.id} className="bg-card border border-border rounded-lg p-3 hover:shadow-card transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-600 text-foreground">{b.number}</p>
                        <p className="text-xs text-muted-foreground">Due: {b.dueDate}</p>
                      </div>
                      <StatusBadge label={b.status} className={apStatusColors[b.status]} />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-lg font-700 tabular-nums text-foreground">{fx(formatRupiah(b.amount, true))}</span>
                      {b.daysOverdue > 0 && (
                        <span className="text-xs font-600 text-danger">{b.daysOverdue}d overdue</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="space-y-2">
              {paymentHistory.map((p) => (
                <div key={p.id} className="bg-card border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-600 text-foreground">{fx(formatRupiah(p.amount, true))}</p>
                      <p className="text-xs text-muted-foreground">{p.ref} · {p.method}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{p.date}</p>
                      <span className="text-2xs bg-success-bg text-success-foreground px-1.5 py-0.5 rounded-full font-600">Paid</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}