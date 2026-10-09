'use client';

import React, { useState, useMemo, useEffect } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import type { PurchaseStatus, PaymentStatus, PurchaseTransaction } from '@/data/purchaseData';
import { useActiveClient } from '@/lib/activeClient';
import { toast } from 'sonner';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi, updatePurchaseTransaction } from '@/lib/purchaseStore';
import { PreviewSection, FieldList, FieldGroupTitle, JournalTable, PickerPagination, PREVIEW_CARD } from '@/app/transactions/components/PreviewLayout';
import { runPurchaseStatusAction } from '@/app/transactions/purchase/components/purchaseStatusActions';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';

const PICKER_PAGE_SIZE = 20;

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

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

  // Debit: Input Tax -- akun per transaksi, fallback akun default backend
  // (db_client._AKUN_DEFAULT_PURCHASE) supaya preview == jurnal yang diposting.
  if (tx.taxAmount > 0) {
    entries.push({
      account: tx.taxAccountName || 'VAT Recoverable (Input Tax)',
      code: tx.taxAccountCode || '1300',
      debit: tx.taxAmount, credit: 0, description: 'Input VAT',
    });
  }

  // Credit: Accounts Payable
  entries.push({
    account: tx.apAccountName || 'Accounts Payable',
    code: tx.apAccountCode || '2100',
    debit: 0, credit: tx.accountsPayable,
    description: [tx.vendor, tx.invoiceNumber].filter(Boolean).join(' — '),
  });

  return entries;
}

export default function PurchasePreviewPage() {
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const { transactions: backendTransactions } = usePurchaseTransactions(activeClientId ?? null);
  const purchaseTransactions = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAccounting, setShowAccounting] = useState(true);
  const [busy, setBusy] = useState<'approve' | 'post' | 'status' | null>(null);
  // Daftar pilih transaksi dipaging 20 item (hasil upload bisa ratusan).
  const [pickerPage, setPickerPage] = useState(1);
  const pickerTotalPages = Math.max(1, Math.ceil(purchaseTransactions.length / PICKER_PAGE_SIZE));
  const pickerPageSafe = Math.min(pickerPage, pickerTotalPages);
  const pickerItems = purchaseTransactions.slice((pickerPageSafe - 1) * PICKER_PAGE_SIZE, pickerPageSafe * PICKER_PAGE_SIZE);

  // Begitu daftar transaksi datang, pilih yang pertama secara default
  // (dulu purchaseTransactions[0] selalu ada karena mock statis -- sekarang
  // baru terisi setelah fetch API selesai).
  useEffect(() => {
    if (!selectedId && purchaseTransactions.length > 0) setSelectedId(purchaseTransactions[0].id);
  }, [selectedId, purchaseTransactions]);

  const txHeader = purchaseTransactions.find(t => t.id === selectedId) || purchaseTransactions[0];
  const { lines: selectedLines } = usePurchaseTransactionLines(txHeader?.id);
  const tx = useMemo(
    () => (txHeader ? { ...txHeader, lines: selectedLines.map(mapTransactionLineToUi) } : null),
    [txHeader, selectedLines],
  );

  if (!tx) {
    return (
      <div className="space-y-6">
        <PurchaseTabs />
        <div className={`${PREVIEW_CARD} p-12 text-center text-sm text-muted-foreground`}>No purchase transactions yet.</div>
      </div>
    );
  }

  const runAction = async (action: 'approve' | 'post') => {
    setBusy(action);
    await runPurchaseStatusAction(action, [tx.id]);
    setBusy(null);
  };

  // Reject / Return for Correction cukup ubah status (tidak menyentuh jurnal).
  const setStatus = async (status: 'rejected' | 'draft') => {
    setBusy('status');
    try {
      await updatePurchaseTransaction(tx.id, { status });
      toast.success(status === 'draft' ? 'Returned to draft for correction' : 'Transaction rejected', { description: tx.purchaseId });
    } catch (err) {
      toast.error('Failed to update status', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const accountingEntries = getAccountingEntries(tx);
  const totalDebit = accountingEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = accountingEntries.reduce((s, e) => s + e.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
      <div className="space-y-6">
        <PurchaseTabs />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Selector Panel */}
          <div className={`${PREVIEW_CARD} p-4 lg:col-span-1 self-start`}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select Purchase</h3>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto scrollbar-thin">
              {pickerItems.map(t => (
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
            <PickerPagination
              page={pickerPageSafe}
              totalPages={pickerTotalPages}
              total={purchaseTransactions.length}
              itemLabel="purchases"
              onPageChange={setPickerPage}
            />
          </div>

          {/* Preview Document — bagian ditumpuk dari atas ke bawah */}
          <div className="lg:col-span-3 space-y-4">
            {/* Header */}
            <div className={`${PREVIEW_CARD} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DocumentTextIcon className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold text-foreground">Purchase Invoice Preview</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{tx.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[tx.status]}`}>{statusLabels[tx.status]}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${paymentColors[tx.paymentStatus]}`}>{paymentLabels[tx.paymentStatus]}</span>
                </div>
              </div>
            </div>

            {/* 1. Purchase Information */}
            <PreviewSection step={1} stepColor="blue" title="Purchase Information">
              <FieldGroupTitle>Vendor</FieldGroupTitle>
              <FieldList rows={[
                { label: 'Vendor Name', value: tx.vendor },
                { label: 'Vendor ID', value: <span className="font-mono">{tx.vendorId || '—'}</span> },
              ]} />
              <FieldGroupTitle>Reference</FieldGroupTitle>
              <FieldList rows={[
                { label: 'Invoice Number', value: <span className="font-mono">{tx.invoiceNumber || '—'}</span> },
                { label: 'PO Number', value: <span className="font-mono">{tx.poNumber || '—'}</span> },
                { label: 'Purchase ID', value: <span className="font-mono">{tx.purchaseId}</span> },
              ]} />
              <FieldGroupTitle>Dates</FieldGroupTitle>
              <FieldList rows={[
                { label: 'Purchase Date', value: tx.purchaseDate || '—' },
                { label: 'Invoice Date', value: tx.invoiceDate || '—' },
                { label: 'Due Date', value: <span className={tx.paymentStatus === 'overdue' ? 'text-red-600' : ''}>{tx.dueDate || '—'}</span> },
                { label: 'Period', value: tx.period || '—' },
              ]} />
              <FieldGroupTitle>Details &amp; Payment Terms</FieldGroupTitle>
              <FieldList rows={[
                { label: 'Category', value: tx.category || '—' },
                { label: 'Payment Terms', value: tx.paymentTerms || '—' },
                { label: 'Currency', value: tx.currency || '—' },
                { label: 'Source', value: tx.sourceDocType || '—' },
              ]} />
              <FieldGroupTitle>Workflow</FieldGroupTitle>
              <FieldList rows={[
                { label: 'Prepared by', value: tx.createdBy || '—' },
                { label: 'Approved by', value: tx.approvedBy || '— Pending —' },
                tx.postedBy ? { label: 'Posted by', value: tx.postedBy } : null,
              ]} />
            </PreviewSection>

            {/* 2. Line Items */}
            <PreviewSection step={2} stepColor="purple" title="Purchase Line Items" flush>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-slate-50 text-[11px] uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground w-12">No.</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Item / Service</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Code</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Qty</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Unit</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">Unit Price</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Discount</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">Tax Rate</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">Tax Amt</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Total</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">GL Code</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">GL Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tx.lines.map((line, i) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground min-w-[180px]">{line.description}</td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{line.itemCode || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{line.quantity.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{line.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmt(line.unitPrice)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-red-600">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{line.taxRate}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">{fmt(line.taxAmount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(line.total)}</td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-primary whitespace-nowrap">{line.accountCode || '—'}</td>
                        <td className="px-4 py-2.5 text-foreground min-w-[160px]">{line.accountName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Summary */}
              <div className="border-t border-border p-5">
                <FieldList className="max-w-md ml-auto" rows={[
                  { label: 'Subtotal', value: <span className="tabular-nums">{fmt(tx.subtotal)}</span> },
                  tx.discount > 0 ? { label: 'Discount', value: <span className="tabular-nums text-red-600">-{fmt(tx.discount)}</span> } : null,
                  { label: 'Input Tax (VAT 12%)', value: <span className="tabular-nums">{fmt(tx.taxAmount)}</span> },
                  { label: 'Total Payable', strong: true, value: <span className="tabular-nums text-primary">{fmt(tx.total)}</span> },
                  { label: 'Accounts Payable', value: <span className="tabular-nums font-semibold text-red-700">{fmt(tx.accountsPayable)}</span> },
                ]} />
              </div>
            </PreviewSection>

            {/* 3. Accounting Impact */}
            <PreviewSection
              step={3}
              stepColor="emerald"
              title="Accounting Impact (Journal Entry)"
              onHeaderClick={() => setShowAccounting(!showAccounting)}
              flush
              aside={
                <>
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
                </>
              }
            >
              {showAccounting && (
                <JournalTable
                  lines={accountingEntries.map((e, idx) => ({
                    key: idx, code: e.code, name: e.account, description: e.description, debit: e.debit, credit: e.credit,
                  }))}
                  totalDebit={totalDebit}
                  totalCredit={totalCredit}
                  formatAmount={fmt}
                  showDescription
                  labels={{ total: isBalanced ? '✓ Balanced — Total Debit = Total Credit' : '⚠ Unbalanced — Debit ≠ Credit' }}
                />
              )}
            </PreviewSection>

            {/* Action Bar */}
            <div className={`${PREVIEW_CARD} p-4`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Created: {tx.createdDate}</span>
                  <span>·</span>
                  <span>Updated: {tx.updatedDate}</span>
                  {tx.postedTimestamp && <><span>·</span><span>Posted: {tx.postedTimestamp}</span></>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(tx.status === 'draft' || tx.status === 'pending_review') && (
                    <>
                      <button
                        className="je-btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() => setStatus('rejected')}
                      >
                        Reject
                      </button>
                      <button
                        className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                        disabled={busy !== null || !isBalanced}
                        title={isBalanced ? undefined : 'Journal is not balanced'}
                        onClick={() => runAction('approve')}
                      >
                        {busy === 'approve' ? 'Approving…' : 'Approve'}
                      </button>
                    </>
                  )}
                  {tx.status === 'approved' && (
                    <>
                      <button
                        className="je-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() => setStatus('draft')}
                      >
                        Return for Correction
                      </button>
                      <button
                        className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                        disabled={busy !== null || !isBalanced}
                        onClick={() => runAction('post')}
                      >
                        {busy === 'post' ? 'Posting…' : 'Post to GL'}
                      </button>
                    </>
                  )}
                  {tx.status === 'posted' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                      <CheckCircleIcon className="w-4 h-4" />Posted to General Ledger
                    </span>
                  )}
                  {tx.status === 'exception' && (
                    <button className="je-btn-secondary text-xs px-3 py-1.5 text-orange-700 border-orange-200">View Exception</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}