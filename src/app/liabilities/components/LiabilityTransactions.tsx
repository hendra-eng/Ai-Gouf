'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { LiabilityTxRow } from '../lib/liabilitiesBridge';

// [UBAH] Data contoh dikosongkan — tampil hanya kalau belum ada client aktif
// / belum ada jurnal (isSampleData); sekarang tetap 0 baris.
const SAMPLE_ROWS: LiabilityTxRow[] = [];

interface LiabilityTransactionsProps {
  isSampleData: boolean;
  rows: LiabilityTxRow[];
}

export default function LiabilityTransactions({ isSampleData, rows }: LiabilityTransactionsProps) {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');

  const source = isSampleData ? SAMPLE_ROWS : rows;

  const filtered = useMemo(() => source.filter(t =>
    t.account.toLowerCase().includes(search.toLowerCase()) ||
    t.txId.toLowerCase().includes(search.toLowerCase()) ||
    t.party.toLowerCase().includes(search.toLowerCase())
  ), [source, search]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="fin-card mb-6">
      <div className="p-5 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-600 text-foreground">Recent Liability Transactions</div>
          <div className="text-[11px] text-muted-foreground">Payables, debt payments, accruals, and tax obligations</div>
        </div>
        <div className="relative">
          <Icon name="MagnifyingGlassIcon" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search transactions..."
            className="pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:border-primary/50 w-48"
          />
        </div>
      </div>

      {!isSampleData && source.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No liability transactions yet"
          description="No posted journal lines touching a liability account (Accounts Payable, Tax Payable, Debt, etc.) were found for this client."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['Date', 'Transaction ID', 'Account', 'Description', 'Debit', 'Credit', 'Vendor / Creditor', 'Reference', 'Status', ''].map(col => (
                  <th key={`libtxn-col-${col}`} className="text-left px-4 py-3 font-600 text-muted-foreground whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(txn => (
                <tr key={`libtxn-${txn.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(txn.date)}</td>
                  <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{txn.txId}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{txn.account}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                    <div className="truncate" title={txn.description}>{txn.description}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{txn.debit > 0 ? fx(formatMoney(txn.debit, 'IDR')) : '\u2014'}</td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{txn.credit > 0 ? fx(formatMoney(txn.credit, 'IDR')) : '\u2014'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[140px]">
                    <div className="truncate" title={txn.party}>{txn.party}</div>
                  </td>
                  <td className="px-4 py-3 text-primary whitespace-nowrap">{txn.reference}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <FinancialStatusBadge variant={txn.variant} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toast.info(`Membuka journal entry ${txn.jeId}`)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                      title="View journal entry"
                    >
                      <Icon name="ArrowTopRightOnSquareIcon" size={13} className="text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No transactions match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}