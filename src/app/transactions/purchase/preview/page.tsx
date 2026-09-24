'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { useCurrency } from '@/lib/currency';
import { formatRupiah } from '@/lib/mockData';
import type { PurchaseStatus, PaymentStatus, PurchaseTransaction } from '@/data/purchaseData';
import { usePurchaseData } from '@/app/transactions/purchase/purchasebridge';
import { updatePurchaseStatus } from '@/app/agent-ai/lib/api';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  BuildingStorefrontIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';


const statusColors: Record<PurchaseStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

const paymentColors: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-50 text-red-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid: 'bg-green-50 text-green-700',
  overdue: 'bg-red-100 text-red-800',
  on_hold: 'bg-slate-100 text-slate-600',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

// Accounting impact for a purchase transaction
function getAccountingEntries(tx: PurchaseTransaction) {
  const entries: { account: string; code: string; debit: number; credit: number; description: string }[] = [];

  // Group lines by account
  const accountMap: Record<string, { name: string; amount: number }> = {};
  tx.lines.forEach(line => {
    if (!accountMap[line.accountCode]) {
      accountMap[line.accountCode] = { name: line.accountName, amount: 0 };
    }
    accountMap[line.accountCode].amount += line.subtotal - line.discount;
  });

  // Debit: Expense/Inventory/Asset accounts
  Object.entries(accountMap).forEach(([code, info]) => {
    entries.push({ account: info.name, code, debit: info.amount, credit: 0, description: tx.description });
  });

  // Debit: Input Tax (VAT Recoverable)
  if (tx.taxAmount > 0) {
    entries.push({ account: 'VAT Recoverable (Input Tax)', code: '1300', debit: tx.taxAmount, credit: 0, description: `Input VAT @ 12%` });
  }

  // Credit: Accounts Payable
  entries.push({ account: 'Accounts Payable', code: '2100', debit: 0, credit: tx.accountsPayable, description: `${tx.vendor} — ${tx.invoiceNumber}` });

  return entries;
}

export default function PurchasePreviewPage() {
  // [DIUBAH] purchaseStore.tsx -> purchasebridge.ts, lihat catatan di
  // src/app/transactions/purchase/page.tsx.
  const { purchaseTransactions, activeClientId, refetch } = usePurchaseData();
  const { fx } = useCurrency();
  const fmt = (n: number) => fx(formatRupiah(n, true));
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAccounting, setShowAccounting] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Begitu daftar transaksi datang, pilih yang pertama secara default
  // (dulu purchaseTransactions[0] selalu ada karena mock statis -- sekarang
  // baru terisi setelah fetch API selesai).
  useEffect(() => {
    if (!selectedId && purchaseTransactions.length > 0) setSelectedId(purchaseTransactions[0].id);
  }, [selectedId, purchaseTransactions]);

  // [DIUBAH] purchasebridge.ts sudah menyertakan `lines` langsung di tiap
  // transaksi, jadi tidak perlu lazy-fetch line terpisah lagi.
  const tx = purchaseTransactions.find(t => t.id === selectedId) || purchaseTransactions[0] || null;

  if (!tx) {
    return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />
        <div className="je-card p-12 text-center text-sm text-muted-foreground">No purchase transactions yet.</div>
      </div>
    );
  }

  const accountingEntries = getAccountingEntries(tx);
  const totalDebit = accountingEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = accountingEntries.reduce((s, e) => s + e.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handleStatusChange = (status: PurchaseStatus, alasan?: string) => {
    if (!activeClientId) { toast.error('Client aktif belum dipilih.'); return; }
    setActionLoading(true);
    updatePurchaseStatus(activeClientId, tx.id, status, alasan)
      .then(() => { toast.success(`Status diperbarui ke "${statusLabels[status]}".`); refetch(); })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Gagal memperbarui status.'))
      .finally(() => setActionLoading(false));
  };

  const handleReject = () => {
    const alasan = window.prompt('Alasan penolakan (opsional):') || undefined;
    handleStatusChange('rejected', alasan);
  };

  const handlePostToGl = () => {
    if (!isBalanced) { toast.error('Tidak bisa posting: jurnal belum balance (Debit ≠ Credit).'); return; }
    if (!window.confirm('Posting ke General Ledger tidak dapat dibatalkan. Lanjutkan?')) return;
    handleStatusChange('posted');
  };

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Selector Panel */}
          <div className="je-card p-4 lg:col-span-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select Purchase</h3>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto scrollbar-thin">
              {purchaseTransactions.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs ${
                    selectedId === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <p className="font-mono font-semibold">{t.purchaseId}</p>
                  <p className={`truncate mt-0.5 ${selectedId === t.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{t.vendor}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${selectedId === t.id ? 'bg-white/20 text-white' : statusColors[t.status]}`}>
                      {statusLabels[t.status]}
                    </span>
                    <span className={`font-semibold tabular-nums ${selectedId === t.id ? 'text-primary-foreground' : ''}`}>{fmt(t.total)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview Document */}
          <div className="lg:col-span-3 space-y-4">
            {/* Header */}
            <div className="je-card p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <DocumentTextIcon className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold text-foreground">Purchase Invoice Preview</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{tx.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[tx.status]}`}>{statusLabels[tx.status]}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${paymentColors[tx.paymentStatus]}`}>{paymentLabels[tx.paymentStatus]}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BuildingStorefrontIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vendor</p>
                  </div>
                  <p className="text-sm font-bold text-foreground">{tx.vendor}</p>
                  <p className="text-xs text-muted-foreground">{tx.vendorId}</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DocumentTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</p>
                  </div>
                  <p className="text-sm font-medium text-foreground">Invoice: <span className="font-mono font-bold">{tx.invoiceNumber}</span></p>
                  <p className="text-xs text-muted-foreground">PO: <span className="font-mono">{tx.poNumber}</span></p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dates</p>
                  </div>
                  <p className="text-xs text-foreground">Purchase: <span className="font-medium">{tx.purchaseDate}</span></p>
                  <p className="text-xs text-foreground">Invoice: <span className="font-medium">{tx.invoiceDate}</span></p>
                  <p className="text-xs text-foreground">Due: <span className={`font-medium ${tx.paymentStatus === 'overdue' ? 'text-red-600' : ''}`}>{tx.dueDate}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Purchase Details</p>
                  <p className="text-xs text-foreground">ID: <span className="font-mono font-medium">{tx.purchaseId}</span></p>
                  <p className="text-xs text-foreground">Category: <span className="font-medium">{tx.category}</span></p>
                  <p className="text-xs text-foreground">Period: <span className="font-medium">{tx.period}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment Terms</p>
                  <p className="text-xs text-foreground">Terms: <span className="font-medium">{tx.paymentTerms}</span></p>
                  <p className="text-xs text-foreground">Currency: <span className="font-medium">{tx.currency}</span></p>
                  <p className="text-xs text-foreground">Source: <span className="font-medium">{tx.sourceDocType}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Workflow</p>
                  <p className="text-xs text-foreground">Prepared by: <span className="font-medium">{tx.createdBy}</span></p>
                  <p className="text-xs text-foreground">Approved by: <span className="font-medium">{tx.approvedBy || '— Pending —'}</span></p>
                  {tx.postedBy && <p className="text-xs text-foreground">Posted by: <span className="font-medium">{tx.postedBy}</span></p>}
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="je-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Purchase Line Items</h3>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Item / Service</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Code</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Qty</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Unit</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Unit Price</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Discount</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Tax Rate</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Tax Amt</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Subtotal</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Total</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">GL Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tx.lines.map(line => (
                      <tr key={line.id} className="table-row-hover">
                        <td className="px-4 py-2.5 font-medium text-foreground max-w-[200px]">
                          <p>{line.description}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{line.itemCode || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{line.quantity.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{line.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{line.taxRate}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmt(line.taxAmount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(line.subtotal)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(line.total)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          <span className="font-mono">{line.accountCode}</span> · {line.accountName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Summary */}
              <div className="border-t border-border p-5">
                <div className="flex justify-end">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="tabular-nums font-medium">{fmt(tx.subtotal)}</span>
                    </div>
                    {tx.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Discount</span>
                        <span className="tabular-nums font-medium text-red-600">-{fmt(tx.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Input Tax (VAT 12%)</span>
                      <span className="tabular-nums font-medium">{fmt(tx.taxAmount)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
                      <span className="text-foreground">Total Payable</span>
                      <span className="tabular-nums text-primary">{fmt(tx.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Accounts Payable</span>
                      <span className="tabular-nums font-semibold text-red-700">{fmt(tx.accountsPayable)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Accounting Impact */}
            <div className="je-card overflow-hidden">
              <button
                className="w-full px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between"
                onClick={() => setShowAccounting(!showAccounting)}
              >
                <h3 className="text-sm font-semibold text-foreground">Accounting Impact (Journal Entry)</h3>
                <div className="flex items-center gap-2">
                  {isBalanced ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                      <CheckCircleIcon className="w-3.5 h-3.5" />Balanced
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-700 font-medium bg-red-50 px-2 py-0.5 rounded-full">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5" />Unbalanced
                    </span>
                  )}
                  {showAccounting ? <ChevronUpIcon className="w-4 h-4 text-muted-foreground" /> : <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
              {showAccounting && (
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Account Code</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Account Name</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Description</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Debit</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {accountingEntries.map((entry, idx) => (
                        <tr key={idx} className={`table-row-hover ${entry.debit > 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className="px-4 py-2.5 font-mono font-semibold text-primary">{entry.code}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{entry.account}</td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{entry.description}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                            {entry.debit > 0 ? fmt(entry.debit) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                            {entry.credit > 0 ? fmt(entry.credit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={`border-t-2 ${isBalanced ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                        <td colSpan={3} className={`px-4 py-2.5 font-bold text-sm ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
                          {isBalanced ? '✓ Balanced — Total Debit = Total Credit' : '⚠ Unbalanced — Debit ≠ Credit'}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums text-sm ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totalDebit)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums text-sm ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totalCredit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="je-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Created: {tx.createdDate}</span>
                  <span>·</span>
                  <span>Updated: {tx.updatedDate}</span>
                  {tx.postedTimestamp && <><span>·</span><span>Posted: {tx.postedTimestamp}</span></>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {tx.status === 'draft' && (
                    <button
                      className="je-btn-secondary text-xs px-3 py-1.5 opacity-50 cursor-not-allowed"
                      disabled
                      title="Tidak ada perubahan untuk disimpan di halaman pratinjau ini"
                    >
                      Save Draft
                    </button>
                  )}
                  {tx.status === 'draft' && (
                    <button className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-50" onClick={() => handleStatusChange('pending_review')} disabled={actionLoading}>
                      Submit for Review
                    </button>
                  )}
                  {tx.status === 'pending_review' && (
                    <>
                      <button className="je-btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 disabled:opacity-50" onClick={handleReject} disabled={actionLoading}>Reject</button>
                      <button className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-50" onClick={() => handleStatusChange('approved')} disabled={actionLoading}>Approve</button>
                    </>
                  )}
                  {tx.status === 'approved' && (
                    <>
                      <button className="je-btn-secondary text-xs px-3 py-1.5 disabled:opacity-50" onClick={() => handleStatusChange('pending_review')} disabled={actionLoading}>Return for Correction</button>
                      <button className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-50" onClick={handlePostToGl} disabled={actionLoading}>Post to GL</button>
                    </>
                  )}
                  {tx.status === 'posted' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                      <CheckCircleIcon className="w-4 h-4" />Posted to General Ledger
                    </span>
                  )}
                  {tx.status === 'exception' && (
                    <button className="je-btn-secondary text-xs px-3 py-1.5 text-orange-700 border-orange-200" onClick={() => router.push('/transactions/purchase/exceptions')}>View Exception</button>
                  )}
                  <button className="je-btn-secondary text-xs px-3 py-1.5" onClick={() => router.push('/transactions/purchase/source-data')}>View Source</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}