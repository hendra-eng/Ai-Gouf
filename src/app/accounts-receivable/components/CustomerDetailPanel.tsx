'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Customer, type Invoice, formatRupiah, riskColors, arStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

// [DIUBAH] `invoices` sekarang diterima lewat props (daftar Invoice hasil
// turunan transaksi Sales yang sesungguhnya dari ARContent.tsx), bukan lagi
// import langsung dari mockData — panel ini dulu selalu kosong/salah untuk
// customer real karena ID customer real (cust-sales-xxx, lihat arBridge.ts)
// tidak pernah cocok dengan customerId di invoice mock statis (cust-001, dst).
interface Props {
  customer: Customer;
  invoices: Invoice[];
  onClose: () => void;
}

export default function CustomerDetailPanel({ customer, invoices, onClose }: Props) {
  const { fx } = useCurrency();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'payments'>('overview');
  const customerInvoices = invoices.filter((i) => i.customerId === customer.id);

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'invoices' as const, label: 'Invoices', count: customerInvoices.length },
    { id: 'payments' as const, label: 'Payment History' },
  ];

  const paymentHistory = [
    { id: `ph-${customer.id}-1`, date: customer.lastPayment, amount: Math.round(customer.totalAR * 0.3), method: 'Bank Transfer', ref: `PAY-${customer.code}-001` },
    { id: `ph-${customer.id}-2`, date: '2026-07-10', amount: Math.round(customer.totalAR * 0.2), method: 'Bank Transfer', ref: `PAY-${customer.code}-002` },
    { id: `ph-${customer.id}-3`, date: '2026-06-15', amount: Math.round(customer.totalAR * 0.25), method: 'Giro', ref: `PAY-${customer.code}-003` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-card border-l border-border shadow-card-lg overflow-y-auto fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-bold text-foreground truncate">{customer.name}</h2>
                <StatusBadge label={customer.riskLevel} className={riskColors[customer.riskLevel]} size="md" />
              </div>
              <p className="text-sm text-muted-foreground">{customer.code} · {customer.industry} · Mgr: {customer.accountManager}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors flex-shrink-0">
              <Icon name="XMarkIcon" size={18} />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => router.push('/ai-financial-analyst?analysis=ar-risk&customer=' + customer.id)}
              className="flex items-center gap-1.5 text-xs font-medium text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="SparklesIcon" size={12} />
              AI Risk Assessment
            </button>
            <button
              onClick={() => toast.success('Payment recorded')}
              className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="BanknotesIcon" size={12} />
              Record Payment
            </button>
            <button
              onClick={() => toast.info('Note added')}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-secondary transition-colors"
            >
              <Icon name="ChatBubbleLeftIcon" size={12} />
              Add Note
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 -mb-4 border-b border-border pb-0">
            {tabs.map((tab) => (
              <button
                key={`cust-detail-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
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
              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total AR', value: fx(formatRupiah(customer.totalAR, true)), color: 'text-foreground' },
                  { label: 'Current AR', value: fx(formatRupiah(customer.currentAR, true)), color: 'text-success' },
                  { label: 'Overdue AR', value: customer.overdueAR > 0 ? fx(formatRupiah(customer.overdueAR, true)) : '—', color: customer.overdueAR > 0 ? 'text-danger' : 'text-muted-foreground' },
                  { label: '90+ Days', value: customer.ar90Plus > 0 ? fx(formatRupiah(customer.ar90Plus, true)) : '—', color: customer.ar90Plus > 0 ? 'text-danger' : 'text-muted-foreground' },
                  { label: 'DSO', value: `${customer.dso} days`, color: customer.dso > 40 ? 'text-warning' : 'text-success' },
                  { label: 'Collection Rate', value: `${customer.collectionRate}%`, color: customer.collectionRate > 90 ? 'text-success' : customer.collectionRate > 75 ? 'text-warning' : 'text-danger' },
                ].map((m) => (
                  <div key={`cust-metric-${m.label}`} className="bg-secondary/50 rounded-lg p-3">
                    <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
                    <p className={`text-xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Credit Info */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-foreground mb-3">Credit Exposure</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Credit Limit</span>
                    <span className="font-semibold tabular-nums">{fx(formatRupiah(customer.creditLimit, true))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Used</span>
                    <span className="font-semibold tabular-nums">{fx(formatRupiah(customer.totalAR, true))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Available</span>
                    <span className="font-semibold tabular-nums text-success">{fx(formatRupiah(customer.creditLimit - customer.totalAR, true))}</span>
                  </div>
                  <div className="pt-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Utilization</span>
                      <span className="font-semibold">{customer.creditUtilization}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${customer.creditUtilization > 80 ? 'bg-danger' : customer.creditUtilization > 60 ? 'bg-warning' : 'bg-success'}`}
                        style={{ width: `${customer.creditUtilization}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Schedule */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-foreground mb-3">Payment Schedule</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Payment</span>
                    <span className="font-medium">{customer.lastPayment}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Next Expected</span>
                    <span className="font-medium text-primary">{customer.nextExpectedPayment}</span>
                  </div>
                </div>
              </div>

              {/* AI Risk Assessment Box */}
              <div className="bg-ai-purple-bg border border-purple-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="SparklesIcon" size={14} className="text-ai-purple" />
                  <span className="text-sm font-semibold text-ai-purple">AI Risk Assessment</span>
                </div>
                <p className="text-xs text-ai-purple-foreground leading-relaxed">
                  {customer.riskLevel === 'Critical'
                    ? `${customer.name} has ${fx(formatRupiah(customer.overdueAR, true))} overdue with DSO at ${customer.dso} days — significantly above target. Immediate collection action recommended. Consider credit limit review.`
                    : customer.riskLevel === 'High'
                    ? `${customer.name} shows elevated DSO of ${customer.dso} days with ${fx(formatRupiah(customer.overdueAR, true))} overdue. Monitor closely and escalate if no payment within 7 days.`
                    : `${customer.name} maintains healthy payment behavior with ${customer.collectionRate}% collection rate. DSO within acceptable range.`
                  }
                </p>
                <button
                  onClick={() => router.push('/ai-financial-analyst?analysis=ar-risk')}
                  className="text-xs text-ai-purple font-semibold mt-2 hover:underline"
                >
                  View full AI analysis →
                </button>
              </div>
            </>
          )}

          {activeTab === 'invoices' && (
            <div className="space-y-2">
              {customerInvoices.length === 0 ? (
                <div className="text-center py-8">
                  <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No invoices found for this customer</p>
                </div>
              ) : (
                customerInvoices.map((inv) => (
                  <div key={inv.id} className="bg-card border border-border rounded-lg p-3 hover:shadow-card transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{inv.number}</p>
                        <p className="text-xs text-muted-foreground">Due: {inv.dueDate}</p>
                      </div>
                      <StatusBadge label={inv.status} className={arStatusColors[inv.status]} />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-lg font-bold tabular-nums text-foreground">{fx(formatRupiah(inv.amount, true))}</span>
                      {inv.daysOverdue > 0 && (
                        <span className="text-xs font-semibold text-danger">{inv.daysOverdue}d overdue</span>
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
                      <p className="text-sm font-semibold text-foreground">{fx(formatRupiah(p.amount, true))}</p>
                      <p className="text-xs text-muted-foreground">{p.ref} · {p.method}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{p.date}</p>
                      <span className="text-2xs bg-success-bg text-success-foreground px-1.5 py-0.5 rounded-full font-semibold">Received</span>
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