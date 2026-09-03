'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Invoice, formatRupiah, arStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

interface Props {
  invoice: Invoice;
  onClose: () => void;
}

export default function InvoiceDetailPanel({ invoice, onClose }: Props) {
  const { fx } = useCurrency();
  const router = useRouter();
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('2026-08-28');
  const [note, setNote] = useState('');

  const handleRecordPayment = () => {
    if (!paymentAmount) { toast.error('Please enter a payment amount'); return; }
    if (!paymentDate) { toast.error('Please select a payment date'); return; }
    toast.success(fx(`Payment of Rp ${Number(paymentAmount).toLocaleString('id-ID')} recorded for ${invoice.number} on ${paymentDate}`));
    setShowPaymentForm(false);
    setPaymentAmount('');
  };

  const progressPct = invoice.amount > 0 ? Math.round((invoice.paid / invoice.amount) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-card border-l border-border shadow-card-lg overflow-y-auto fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-bold text-foreground">{invoice.number}</h2>
                <StatusBadge label={invoice.status} className={arStatusColors[invoice.status]} size="md" />
              </div>
              <p className="text-sm text-muted-foreground">{invoice.customerName} · {invoice.accountManager}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors flex-shrink-0">
              <Icon name="XMarkIcon" size={18} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              onClick={() => setShowPaymentForm(!showPaymentForm)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="BanknotesIcon" size={12} />
              Record Payment
            </button>
            <button
              onClick={() => router.push('/ai-financial-analyst?analysis=ar-risk')}
              className="flex items-center gap-1.5 text-xs font-medium text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-2.5 py-1.5 transition-colors"
            >
              <Icon name="SparklesIcon" size={12} />
              AI Risk
            </button>
            <button
              onClick={() => toast.success('Invoice exported as PDF')}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-secondary transition-colors"
            >
              <Icon name="ArrowDownTrayIcon" size={12} />
              Export
            </button>
            <button
              onClick={() => toast.warning('Invoice flagged as high risk')}
              className="flex items-center gap-1.5 text-xs font-medium text-danger border border-red-200 rounded-md px-2.5 py-1.5 hover:bg-danger-bg transition-colors"
            >
              <Icon name="FlagIcon" size={12} />
              Flag Risk
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Payment Form */}
          {showPaymentForm && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 slide-up">
              <h4 className="text-sm font-semibold text-foreground mb-3">Record Payment</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">Payment Amount (IDR)</label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={invoice.outstanding.toString()}
                    className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRecordPayment} className="flex-1 bg-primary text-white text-sm font-medium rounded-md py-2 hover:bg-primary/90 transition-colors">
                    Save Payment
                  </button>
                  <button onClick={() => setShowPaymentForm(false)} className="px-4 text-sm font-medium text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Invoice Summary */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">Invoice Summary</h4>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Invoice Amount', value: fx(formatRupiah(invoice.amount, true)), bold: true },
                { label: 'Amount Paid', value: invoice.paid > 0 ? fx(formatRupiah(invoice.paid, true)) : '—', color: 'text-success' },
                { label: 'Outstanding', value: fx(formatRupiah(invoice.outstanding, true)), color: invoice.outstanding > 0 ? 'text-danger font-bold' : 'text-success' },
              ].map((row) => (
                <div key={`inv-row-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`tabular-nums ${row.color || ''} ${row.bold ? 'font-semibold' : ''}`}>{row.value}</span>
                </div>
              ))}
              {invoice.amount > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Payment Progress</span>
                    <span className="font-semibold">{progressPct}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${progressPct === 100 ? 'bg-success' : progressPct > 50 ? 'bg-primary' : 'bg-warning'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dates & Terms */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">Dates & Terms</h4>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Invoice Date', value: invoice.invoiceDate },
                { label: 'Due Date', value: invoice.dueDate },
                { label: 'Days Overdue', value: invoice.daysOverdue > 0 ? `${invoice.daysOverdue} days` : 'Not overdue', color: invoice.daysOverdue > 0 ? 'text-danger font-semibold' : 'text-success' },
                { label: 'Payment Terms', value: 'Net 30' },
                { label: 'Priority', value: invoice.priority },
              ].map((row) => (
                <div key={`inv-date-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`font-medium ${row.color || ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Collection Notes */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">Collection Notes</h4>
              <button onClick={() => toast.info('Note saved')} className="text-xs text-primary hover:underline font-medium">Save Note</button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a collection note..."
              rows={3}
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Navigate to customer */}
          <button
            className="w-full flex items-center justify-between p-3 bg-secondary/50 rounded-lg hover:bg-secondary transition-colors text-sm"
            onClick={() => toast.info('Opening customer profile...')}
          >
            <span className="font-medium text-foreground">View Customer Profile</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}