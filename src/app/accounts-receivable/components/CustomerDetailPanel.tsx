'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Customer, type Invoice, formatRupiah, riskColors, arStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type { AddNoteInput, CollectionNoteView, PaymentView, RecordPaymentInput, RecordPaymentResult } from '../lib/arDbBridge';
import { CollectionNotesSection, RecordPaymentForm } from './ARActionForms';

// [DIUBAH -- halaman AR dituntaskan] Panel customer sekarang membaca riwayat
// pembayaran & catatan penagihan dari tabel AR di Supabase, dan bisa mencatat
// pembayaran (pilih salah satu invoice yang masih punya sisa tagihan) serta
// menambah catatan level customer. Sebelumnya Payment History selalu kosong
// dan tombol Record Payment / Add Note hanya menampilkan toast.
interface Props {
  customer: Customer;
  invoices: Invoice[];
  /** Pembayaran seluruh invoice customer ini (terbaru dulu). */
  payments: PaymentView[];
  /** Catatan penagihan customer ini -- level customer maupun level invoice (terbaru dulu). */
  notes: CollectionNoteView[];
  onClose: () => void;
  onRecordPayment: (input: RecordPaymentInput) => Promise<RecordPaymentResult>;
  onAddNote: (input: AddNoteInput) => Promise<void>;
  onOpenInvoice: (invoiceId: string) => void;
}

export default function CustomerDetailPanel({
  customer, invoices, payments, notes, onClose, onRecordPayment, onAddNote, onOpenInvoice,
}: Props) {
  const { fx } = useCurrency();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'payments' | 'notes'>('overview');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const customerInvoices = invoices.filter((i) => i.customerId === customer.id);
  const payableInvoices = customerInvoices.filter((i) => i.outstanding > 0 && i.status !== 'Written Off');

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'invoices' as const, label: 'Invoices', count: customerInvoices.length },
    { id: 'payments' as const, label: 'Payment History', count: payments.length },
    { id: 'notes' as const, label: 'Notes', count: notes.length },
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
              onClick={() => setShowPaymentForm((v) => !v)}
              disabled={payableInvoices.length === 0}
              title={payableInvoices.length === 0 ? 'Tidak ada invoice dengan sisa tagihan' : 'Catat pembayaran invoice customer ini'}
              className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon name="BanknotesIcon" size={12} />
              Record Payment
            </button>
            <button
              onClick={() => setActiveTab('notes')}
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
          {showPaymentForm && (
            <RecordPaymentForm
              invoices={payableInvoices}
              onRecord={onRecordPayment}
              onDone={() => setShowPaymentForm(false)}
              onCancel={() => setShowPaymentForm(false)}
            />
          )}

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
                  <div
                    key={inv.id}
                    onClick={() => onOpenInvoice(inv.id)}
                    className="bg-card border border-border rounded-lg p-3 hover:shadow-card transition-all cursor-pointer"
                  >
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
              {payments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Belum ada riwayat pembayaran.</p>
              )}
              {payments.map((p) => (
                <div key={p.id} className="bg-card border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{fx(formatRupiah(p.amount, true))}</p>
                      <p className="text-xs text-muted-foreground">{p.invoiceNumber} · {p.method} · {p.reference}</p>
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

          {activeTab === 'notes' && (
            <CollectionNotesSection notes={notes} customerId={customer.id} onAdd={onAddNote} autoFocus showInvoiceTag />
          )}
        </div>
      </div>
    </div>
  );
}