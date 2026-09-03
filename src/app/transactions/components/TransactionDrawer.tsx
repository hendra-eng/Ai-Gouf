'use client';
import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, ExternalLink, Copy, CheckCircle, AlertTriangle, FileText, Clock, ArrowUpRight } from 'lucide-react';
import { Transaction, getTransactionGroup, PAYMENT_STATUS_VARIANT } from './transactionData';
import { expenseOutstanding, expenseBillStatus, expenseDaysOverdue } from '../lib/apBridge';
import StatusBadge from '@/components/ui/StatusBadge';
import { toast } from 'sonner';

interface TransactionDrawerProps {
  transaction: Transaction;
  onClose: () => void;
}

function formatAmount(v: number) {
  if (v === 0) return '—';
  return `Rp ${v.toLocaleString('id-ID')}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Posted: 'info',
  Draft: 'warning',
  Reconciled: 'positive',
  Voided: 'negative',
};

// Backend integration point: replace with /api/transactions/:id/audit-trail
const mockAuditTrail = [
  { id: 'audit-001', user: 'Rizky Wardana', action: 'Posted', time: '25 Aug 2026, 08:14 WIB', detail: 'Jurnal diposting ke buku besar' },
  { id: 'audit-002', user: 'Siti Rahayu', action: 'Created', time: '25 Aug 2026, 07:52 WIB', detail: 'Jurnal dibuat dari invoice' },
];

export default function TransactionDrawer({ transaction: tx, onClose }: TransactionDrawerProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const hasAnomaly = tx.notes?.includes('Anomali') || tx.notes?.includes('anomali');
  const isBalanced = tx.debit === tx.credit || (tx.debit > 0 && tx.credit === 0) || (tx.credit > 0 && tx.debit === 0);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} disalin`));
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-foreground/20 z-40 fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-card border-l border-border z-50 flex flex-col shadow-drawer slide-in-right overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge variant={statusVariant[tx.status] || 'neutral'} label={tx.status} dot />
              {hasAnomaly && <span className="badge-warning">⚠ Anomali</span>}
            </div>
            <h2 className="text-base font-bold text-foreground">{tx.txId}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{tx.jeId} · {formatDate(tx.date)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Tutup panel detail"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-5 space-y-5">
            {/* Anomaly alert */}
            {hasAnomaly && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-warning-subtle border border-warning/30">
                <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Anomali Terdeteksi</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tx.notes}</p>
                </div>
              </div>
            )}

            {/* Core details */}
            <div className="card-elevated rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detail Transaksi</p>

              {[
                { label: 'TX ID', value: tx.txId, copyable: true },
                { label: 'No Voucher', value: tx.voucherNo, copyable: true },
                { label: 'Jurnal Entri', value: tx.jeId, copyable: true },
                { label: 'Tanggal', value: formatDate(tx.date), copyable: false },
                { label: 'Kode Akun', value: `${tx.accountCode} — ${tx.accountName}`, copyable: false },
                { label: 'Deskripsi', value: tx.description, copyable: false },
                { label: 'Referensi', value: tx.reference, copyable: true },
                { label: 'Pihak', value: tx.party, copyable: false },
                { label: 'Kategori', value: tx.category, copyable: false },
                { label: 'Tipe', value: tx.type.charAt(0).toUpperCase() + tx.type.slice(1), copyable: false },
                { label: 'Saldo Akhir', value: formatAmount(tx.saldoAkhir), copyable: false },
                { label: 'Cek Rekonsiliasi', value: tx.cek ? 'Sudah dicek' : 'Belum dicek', copyable: false },
              ].map((row) => (
                <div key={`drawer-${row.label}`} className="flex items-start justify-between gap-3">
                  <span className="text-xs text-muted-foreground flex-shrink-0 w-28">{row.label}</span>
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                    <span className="text-xs font-medium text-foreground text-right">{row.value}</span>
                    {row.copyable && (
                      <button
                        onClick={() => copyToClipboard(row.value, row.label)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      >
                        <Copy size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* [BARU] Status pembayaran ke vendor — hanya untuk transaksi
                kelompok Expense, sekaligus jadi pratinjau bagaimana baris ini
                muncul di halaman Account Payable. */}
            {getTransactionGroup(tx) === 'expense' && (
              <div className="card-elevated rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status Pembayaran ke Vendor (AP)</p>
                  <StatusBadge variant={PAYMENT_STATUS_VARIANT[tx.paymentStatus || 'Belum Dibayar']} label={tx.paymentStatus || 'Belum Dibayar'} dot />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Jatuh Tempo</p>
                    <p className="text-xs font-medium text-foreground">{tx.dueDate ? formatDate(tx.dueDate) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Sisa Belum Dibayar</p>
                    <p className={`text-xs font-semibold ${expenseOutstanding(tx) > 0 ? 'text-negative' : 'text-positive'}`}>
                      {formatAmount(expenseOutstanding(tx))}
                    </p>
                  </div>
                </div>
                {expenseOutstanding(tx) > 0 && expenseBillStatus(tx) === 'Overdue' && (
                  <p className="text-2xs text-negative">Sudah terlambat {expenseDaysOverdue(tx)} hari dari jatuh tempo.</p>
                )}
                <Link
                  href="/accounts-payable"
                  className="inline-flex items-center gap-1 text-2xs font-semibold text-primary hover:underline"
                >
                  Lihat status ini di Account Payable
                  <ArrowUpRight size={11} />
                </Link>
              </div>
            )}

            {/* Journal entry (double-entry) */}
            <div className="card-elevated rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jurnal Entri (Double Entry)</p>
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${isBalanced ? 'text-positive' : 'text-negative'}`}>
                  <CheckCircle size={12} />
                  {isBalanced ? 'Seimbang' : 'Tidak Seimbang'}
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Akun</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Debit</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-foreground">{tx.accountCode}</p>
                      <p className="text-[10px] text-muted-foreground">{tx.accountName}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold font-mono ${tx.debit > 0 ? 'text-foreground' : 'text-muted-foreground/30'}`}>
                        {formatAmount(tx.debit)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold font-mono ${tx.credit > 0 ? 'text-positive' : 'text-muted-foreground/30'}`}>
                        {formatAmount(tx.credit)}
                      </span>
                    </td>
                  </tr>
                  {/* Counter entry */}
                  <tr className="border-b border-border/50 bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-foreground">
                        {tx.debit > 0 ? '2101' : '1101'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {tx.debit > 0 ? 'Kas & Bank (contra)' : 'Pendapatan / Kewajiban (contra)'}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold font-mono ${tx.credit > 0 ? 'text-foreground' : 'text-muted-foreground/30'}`}>
                        {tx.credit > 0 ? formatAmount(tx.credit) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold font-mono ${tx.debit > 0 ? 'text-positive' : 'text-muted-foreground/30'}`}>
                        {tx.debit > 0 ? formatAmount(tx.debit) : '—'}
                      </span>
                    </td>
                  </tr>
                  {/* Total row */}
                  <tr className="bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-bold text-foreground">Total</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-bold font-mono text-foreground">
                        {formatAmount(Math.max(tx.debit, tx.credit))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-bold font-mono text-foreground">
                        {formatAmount(Math.max(tx.debit, tx.credit))}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {tx.notes && (
              <div className="card-elevated rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Catatan</p>
                <p className="text-sm text-foreground leading-relaxed">{tx.notes}</p>
              </div>
            )}

            {/* Audit trail */}
            <div className="card-elevated rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Audit Trail</p>
              <div className="space-y-3">
                {mockAuditTrail.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Clock size={12} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">{entry.user}</span>
                        <span className="text-[10px] text-muted-foreground">{entry.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.action}: {entry.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-4 border-t border-border bg-muted/20 flex-shrink-0">
          <button
            onClick={() => toast.success(`Voucher untuk ${tx.id} sedang dicetak`)}
            className="btn-secondary flex-1 text-xs py-2 gap-1.5"
          >
            <FileText size={13} />
            Cetak Voucher
          </button>
          <button
            onClick={() => toast.info(`Membuka jurnal untuk ${tx.id}`)}
            className="btn-secondary flex-1 text-xs py-2 gap-1.5"
          >
            <ExternalLink size={13} />
            Buka Jurnal
          </button>
          <button
            onClick={onClose}
            className="btn-primary flex-1 text-xs py-2"
          >
            Tutup
          </button>
        </div>
      </div>
    </>
  );
}
