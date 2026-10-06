'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { type Invoice, formatRupiah, arStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type {
  AddNoteInput,
  CollectionNoteView,
  ManualInvoiceStatus,
  PaymentView,
  RecordPaymentInput,
  RecordPaymentResult,
} from '../lib/arDbBridge';
import { exportInvoiceDetailCsv } from '../lib/arExport';
import { CollectionNotesSection, RecordPaymentForm } from './ARActionForms';

// [DIUBAH -- halaman AR dituntaskan] Panel ini sekarang membaca & menulis
// ke tabel AR di Supabase: catat pembayaran (ar_payment), riwayat pembayaran,
// catatan penagihan (ar_collection_note), dan penanda Disputed / Written Off
// (ar_invoice.manual_status). Sebelumnya semua tombolnya hanya menampilkan toast.
interface Props {
  invoice: Invoice;
  /** Pembayaran milik invoice ini (terbaru dulu). */
  payments: PaymentView[];
  /** Catatan penagihan milik invoice ini (terbaru dulu). */
  notes: CollectionNoteView[];
  /** Aksi yang langsung dibuka saat panel muncul (dari tombol di tabel/kartu collections). */
  initialAction?: 'payment' | 'note';
  onClose: () => void;
  onRecordPayment: (input: RecordPaymentInput) => Promise<RecordPaymentResult>;
  onAddNote: (input: AddNoteInput) => Promise<void>;
  onSetStatus: (invoiceId: string, status: ManualInvoiceStatus, alasan?: string) => Promise<void>;
  onViewCustomer: (customerId: string) => void;
}

type StatusAction = { target: ManualInvoiceStatus; label: string; hint: string };

function hariAntara(dariISO: string, keISO: string): number {
  const a = new Date(dariISO).getTime();
  const b = new Date(keISO).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export default function InvoiceDetailPanel({
  invoice, payments, notes, initialAction, onClose, onRecordPayment, onAddNote, onSetStatus, onViewCustomer,
}: Props) {
  const { fx } = useCurrency();
  const router = useRouter();
  const writtenOff = invoice.status === 'Written Off';
  const canPay = invoice.outstanding > 0 && !writtenOff;
  const [showPaymentForm, setShowPaymentForm] = useState(initialAction === 'payment' && canPay);
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState<StatusAction | null>(null);
  const [alasan, setAlasan] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const progressPct = invoice.amount > 0 ? Math.round((invoice.paid / invoice.amount) * 100) : 0;
  const netDays = hariAntara(invoice.invoiceDate, invoice.dueDate);

  // Pilihan penanda manual sesuai status invoice sekarang.
  const flagOptions: StatusAction[] = [];
  if (invoice.status === 'Disputed') {
    flagOptions.push({ target: null, label: 'Clear dispute', hint: 'Status invoice kembali dihitung otomatis' });
  } else if (writtenOff) {
    flagOptions.push({ target: null, label: 'Cancel write-off', hint: 'Piutang kembali dihitung sebagai AR berjalan' });
  } else {
    flagOptions.push({ target: 'Disputed', label: 'Mark as Disputed', hint: 'Pelanggan menolak / mempersoalkan tagihan' });
    if (invoice.outstanding > 0) {
      flagOptions.push({ target: 'Written Off', label: 'Write off', hint: 'Sisa tagihan dihapuskan, tidak lagi dihitung sebagai AR' });
    }
  }

  const konfirmasiStatus = async () => {
    if (!pendingAction) return;
    setSavingStatus(true);
    try {
      await onSetStatus(invoice.id, pendingAction.target, alasan.trim() || undefined);
      toast.success(`${invoice.number}: ${pendingAction.label} berhasil`);
      setPendingAction(null);
      setAlasan('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengubah status invoice');
    } finally {
      setSavingStatus(false);
    }
  };

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
              onClick={() => setShowPaymentForm((v) => !v)}
              disabled={!canPay}
              title={canPay ? 'Catat pembayaran invoice ini' : writtenOff ? 'Invoice sudah di-write-off' : 'Invoice sudah lunas'}
              className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
              onClick={() => { exportInvoiceDetailCsv(invoice, payments); toast.success('Detail invoice diekspor (CSV)'); }}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-secondary transition-colors"
            >
              <Icon name="ArrowDownTrayIcon" size={12} />
              Export
            </button>
            <div className="relative">
              <button
                onClick={() => setShowFlagMenu((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-danger border border-red-200 rounded-md px-2.5 py-1.5 hover:bg-danger-bg transition-colors"
              >
                <Icon name="FlagIcon" size={12} />
                Flag Risk
              </button>
              {showFlagMenu && (
                <div className="absolute left-0 mt-1 w-64 bg-card border border-border rounded-md shadow-card-lg z-20 py-1">
                  {flagOptions.map((opt) => (
                    <button
                      key={`flag-opt-${opt.label}`}
                      onClick={() => { setPendingAction(opt); setShowFlagMenu(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors"
                    >
                      <p className="text-sm font-medium text-foreground">{opt.label}</p>
                      <p className="text-2xs text-muted-foreground">{opt.hint}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Konfirmasi perubahan status manual */}
          {pendingAction && (
            <div className="bg-warning-bg border border-yellow-200 rounded-lg p-4 slide-up">
              <h4 className="text-sm font-semibold text-foreground mb-1">{pendingAction.label}?</h4>
              <p className="text-xs text-muted-foreground mb-3">{pendingAction.hint}. Perubahan dicatat otomatis di catatan penagihan.</p>
              <textarea
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Alasan (opsional)"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={konfirmasiStatus}
                  disabled={savingStatus}
                  className="flex-1 bg-primary text-white text-sm font-medium rounded-md py-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {savingStatus ? 'Menyimpan…' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setPendingAction(null); setAlasan(''); }}
                  disabled={savingStatus}
                  className="px-4 text-sm font-medium text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Payment Form */}
          {showPaymentForm && canPay && (
            <RecordPaymentForm
              invoices={[invoice]}
              fixedInvoiceId={invoice.id}
              onRecord={onRecordPayment}
              onDone={() => setShowPaymentForm(false)}
              onCancel={() => setShowPaymentForm(false)}
            />
          )}

          {/* Invoice Summary */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">Invoice Summary</h4>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Invoice Amount', value: fx(formatRupiah(invoice.amount, true)), bold: true },
                { label: 'Amount Paid', value: invoice.paid > 0 ? fx(formatRupiah(invoice.paid, true)) : '—', color: 'text-success' },
                {
                  label: writtenOff ? 'Written Off' : 'Outstanding',
                  value: writtenOff ? fx(formatRupiah(Math.max(0, invoice.amount - invoice.paid), true)) : fx(formatRupiah(invoice.outstanding, true)),
                  color: writtenOff ? 'text-muted-foreground' : invoice.outstanding > 0 ? 'text-danger font-bold' : 'text-success',
                },
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
                { label: 'Payment Terms', value: netDays > 0 ? `Net ${netDays}` : 'Due on receipt' },
                { label: 'Priority', value: invoice.priority },
              ].map((row) => (
                <div key={`inv-date-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`font-medium ${row.color || ''}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment History */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">Payment History</h4>
            {payments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Belum ada pembayaran untuk invoice ini.</p>
            ) : (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{fx(formatRupiah(p.amount, true))}</p>
                      <p className="text-2xs text-muted-foreground">{p.method} · {p.reference}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{p.date}</p>
                      <p className="text-2xs text-muted-foreground">oleh {p.createdBy}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Collection Notes */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3">Collection Notes</h4>
            <CollectionNotesSection
              notes={notes}
              customerId={invoice.customerId}
              invoiceId={invoice.id}
              onAdd={onAddNote}
              autoFocus={initialAction === 'note'}
            />
          </div>

          {/* Navigate to customer */}
          <button
            className="w-full flex items-center justify-between p-3 bg-secondary/50 rounded-lg hover:bg-secondary transition-colors text-sm"
            onClick={() => onViewCustomer(invoice.customerId)}
          >
            <span className="font-medium text-foreground">View Customer Profile</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
