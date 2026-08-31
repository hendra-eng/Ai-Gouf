'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Bill, formatRupiah, apStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

interface Props {
  bill: Bill;
  onClose: () => void;
}

export default function BillDetailPanel({ bill, onClose }: Props) {
  const { fx } = useCurrency();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleAmount, setScheduleAmount] = useState(bill.outstanding);

  const handleSchedule = () => {
    if (!scheduleDate) { toast.error('Please select a payment date'); return; }
    if (!scheduleAmount || scheduleAmount <= 0) { toast.error('Please enter a valid amount'); return; }
    toast.success(`Payment of ${fx(formatRupiah(scheduleAmount, true))} for ${bill.number} scheduled for ${scheduleDate}`);
    setShowScheduleForm(false);
  };

  const progressPct = bill.amount > 0 ? Math.round((bill.paid / bill.amount) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-card border-l border-border shadow-card-lg overflow-y-auto fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-700 text-foreground">{bill.number}</h2>
                <StatusBadge label={bill.status} className={apStatusColors[bill.status]} size="md" />
              </div>
              <p className="text-sm text-muted-foreground">{bill.vendorName} · {bill.paymentMethod}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors flex-shrink-0">
              <Icon name="XMarkIcon" size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={() => setShowScheduleForm(!showScheduleForm)} className="flex items-center gap-1.5 text-xs font-500 text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors">
              <Icon name="CalendarIcon" size={12} />
              Schedule Payment
            </button>
            <button onClick={() => toast.success(`${bill.number} marked as paid`)} className="flex items-center gap-1.5 text-xs font-500 text-success bg-success-bg hover:bg-green-100 rounded-md px-2.5 py-1.5 transition-colors">
              <Icon name="CheckCircleIcon" size={12} />
              Mark Paid
            </button>
            <button onClick={() => router.push('/ai-financial-analyst?analysis=ap-risk')} className="flex items-center gap-1.5 text-xs font-500 text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-2.5 py-1.5 transition-colors">
              <Icon name="SparklesIcon" size={12} />
              AI Risk
            </button>
            <button onClick={() => toast.success('Bill exported as PDF')} className="flex items-center gap-1.5 text-xs font-500 text-muted-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-secondary transition-colors">
              <Icon name="ArrowDownTrayIcon" size={12} />
              Export
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {showScheduleForm && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 slide-up">
              <h4 className="text-sm font-600 text-foreground mb-3">Schedule Payment</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-600 text-muted-foreground block mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-600 text-muted-foreground block mb-1">Amount (IDR)</label>
                  <input
                    type="number"
                    value={scheduleAmount}
                    onChange={(e) => setScheduleAmount(Number(e.target.value))}
                    className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSchedule} className="flex-1 bg-primary text-white text-sm font-500 rounded-md py-2 hover:bg-primary/90 transition-colors">Save Schedule</button>
                  <button onClick={() => setShowScheduleForm(false)} className="px-4 text-sm font-500 text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-600 text-foreground mb-3">Bill Summary</h4>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Bill Amount', value: fx(formatRupiah(bill.amount, true)), bold: true },
                { label: 'Amount Paid', value: bill.paid > 0 ? fx(formatRupiah(bill.paid, true)) : '—', color: 'text-success' },
                { label: 'Outstanding', value: fx(formatRupiah(bill.outstanding, true)), color: bill.outstanding > 0 ? 'text-danger font-700' : 'text-success' },
              ].map((row) => (
                <div key={`bill-sum-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`tabular-nums ${row.color || ''} ${row.bold ? 'font-600' : ''}`}>{row.value}</span>
                </div>
              ))}
              {bill.amount > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Payment Progress</span>
                    <span className="font-600">{progressPct}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${progressPct === 100 ? 'bg-success' : progressPct > 0 ? 'bg-primary' : 'bg-secondary'}`} style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-600 text-foreground mb-3">Bill Details</h4>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Bill Date', value: bill.billDate },
                { label: 'Due Date', value: bill.dueDate },
                { label: 'Days Overdue', value: bill.daysOverdue > 0 ? `${bill.daysOverdue} days` : 'Not overdue', color: bill.daysOverdue > 0 ? 'text-danger font-600' : 'text-success' },
                { label: 'Payment Method', value: bill.paymentMethod },
                { label: 'Approval Status', value: bill.approvalStatus, color: bill.approvalStatus === 'Approved' ? 'text-success' : 'text-warning' },
                { label: 'Priority', value: bill.priority },
              ].map((row) => (
                <div key={`bill-detail-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`font-500 ${row.color || ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-600 text-foreground">Notes</h4>
              <button onClick={() => toast.info('Note saved')} className="text-xs text-primary hover:underline font-500">Save</button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this bill..."
              rows={3}
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}