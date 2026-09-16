'use client';
import React from 'react';
import { X, FileText, User, Calendar, Tag } from 'lucide-react';
import StatusBadge from '../../shared/TabStatusBadge';
import type { PurchaseTransaction } from './PurchaseTransactionTable';

interface Props {
  tx: PurchaseTransaction;
  onClose: () => void;
}

export default function PurchaseDetailPanel({ tx, onClose }: Props) {
  return (
    <div className="p-5 bg-muted/20">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-primary" />
          <div>
            <h4 className="text-sm font-700 text-foreground">{tx.purchaseId}</h4>
            <p className="text-xs text-muted-foreground">Vendor Invoice: {tx.invoiceNumber} · {tx.purchaseOrder}</p>
          </div>
          <StatusBadge status={tx.approvalStatus as 'approved' | 'pending' | 'rejected' | 'draft'} />
          <StatusBadge status={tx.postingStatus as 'posted' | 'draft' | 'pending'} />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Vendor</p>
          <div className="flex items-center gap-1.5">
            <User size={12} className="text-muted-foreground" />
            <span className="text-sm font-500 text-foreground">{tx.vendor}</span>
          </div>
          <p className="text-xs text-muted-foreground">{tx.vendorId}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Purchase Date</p>
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-muted-foreground" />
            <span className="text-sm font-500 text-foreground">{tx.purchaseDate}</span>
          </div>
          <p className="text-xs text-muted-foreground">Due: {tx.dueDate}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Product / Service</p>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-muted-foreground" />
            <span className="text-sm font-500 text-foreground truncate">{tx.productService}</span>
          </div>
          <p className="text-xs text-muted-foreground">{tx.category}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Accounting Period</p>
          <span className="text-sm font-500 text-foreground">{tx.accountingPeriod}</span>
          <p className="text-xs text-muted-foreground">Created by {tx.createdBy}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <h5 className="text-xs font-600 text-muted-foreground uppercase tracking-wider mb-3">Amount Breakdown</h5>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-tabular font-500">${tx.subtotal.toLocaleString()}</span>
            </div>
            {tx.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-tabular text-red-500">-${tx.discount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Input Tax</span>
              <span className="font-tabular text-muted-foreground">${tx.tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm font-700 border-t border-border pt-2">
              <span>Total</span>
              <span className="font-tabular text-primary">${tx.total.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-4">
          <h5 className="text-xs font-600 text-muted-foreground uppercase tracking-wider mb-3">Accounting Impact (GL)</h5>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-6 text-[10px] font-700 text-blue-600 bg-blue-50 rounded px-1 py-0.5">DR</span>
              <span className="text-foreground flex-1 truncate">{tx.expenseAccount}</span>
              <span className="font-tabular font-500">${tx.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-6 text-[10px] font-700 text-blue-600 bg-blue-50 rounded px-1 py-0.5">DR</span>
              <span className="text-foreground flex-1 truncate">{tx.taxAccount}</span>
              <span className="font-tabular font-500">${tx.tax.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-6 text-[10px] font-700 text-emerald-600 bg-emerald-50 rounded px-1 py-0.5">CR</span>
              <span className="text-foreground flex-1 truncate">{tx.apAccount}</span>
              <span className="font-tabular font-500">${tx.total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}