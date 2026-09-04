'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { EquityTxRow } from '../lib/equityBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_ROWS: EquityTxRow[] = [
  { id: 'TXN-EQT-0901', date: '2026-08-26', txId: 'TXN-EQT-0901', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Agustus 2026', debit: 0, credit: 230_000_000, amount: 230_000_000, reference: 'JE-2026-0901', jeId: 'JE-2026-0901', variant: 'active' },
  { id: 'TXN-EQT-0880', date: '2026-08-20', txId: 'TXN-EQT-0880', account: 'Surplus Revaluasi', type: 'Equity Adjustment', description: 'Revaluasi gedung kantor Jakarta', debit: 0, credit: 50_000_000, amount: 50_000_000, reference: 'REV-2026-0001', jeId: 'REV-2026-0001', variant: 'active' },
  { id: 'TXN-EQT-0860', date: '2026-08-15', txId: 'TXN-EQT-0860', account: 'Pendapatan Komprehensif Lain', type: 'Retained Earnings Adjustment', description: 'OCI — perubahan nilai investasi Q2 2026', debit: 12_000_000, credit: 0, amount: -12_000_000, reference: 'JE-2026-0860', jeId: 'JE-2026-0860', variant: 'paid' },
  { id: 'TXN-EQT-0820', date: '2026-08-01', txId: 'TXN-EQT-0820', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Juli 2026', debit: 0, credit: 260_000_000, amount: 260_000_000, reference: 'JE-2026-0820', jeId: 'JE-2026-0820', variant: 'active' },
  { id: 'TXN-EQT-0780', date: '2026-07-15', txId: 'TXN-EQT-0780', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Juni 2026', debit: 0, credit: 245_000_000, amount: 245_000_000, reference: 'JE-2026-0780', jeId: 'JE-2026-0780', variant: 'active' },
  { id: 'TXN-EQT-0650', date: '2026-03-15', txId: 'TXN-EQT-0650', account: 'Hutang Dividen', type: 'Dividend', description: 'Pembayaran dividen final FY2025 kepada pemegang saham', debit: 880_000_000, credit: 0, amount: -880_000_000, reference: 'DIV-2026-0001', jeId: 'DIV-2026-0001', variant: 'paid' },
  { id: 'TXN-EQT-0600', date: '2026-02-01', txId: 'TXN-EQT-0600', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Januari 2026', debit: 0, credit: 180_000_000, amount: 180_000_000, reference: 'JE-2026-0600', jeId: 'JE-2026-0600', variant: 'active' },
  { id: 'TXN-EQT-0550', date: '2026-01-31', txId: 'TXN-EQT-0550', account: 'Modal Disetor', type: 'Capital Injection', description: 'Peningkatan modal dari pemegang saham lama', debit: 0, credit: 0, amount: 0, reference: 'CAP-2026-0001', jeId: 'CAP-2026-0001', variant: 'neutral' },
];

interface EquityTransactionsProps {
  isSampleData: boolean;
  rows: EquityTxRow[];
}

export default function EquityTransactions({ isSampleData, rows }: EquityTransactionsProps) {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');

  const source = isSampleData ? SAMPLE_ROWS : rows;
  const types = ['All', 'Profit Allocation', 'Dividend', 'Capital Injection', 'Equity Adjustment', 'Retained Earnings Adjustment'];

  const filtered = useMemo(() => source.filter(t => {
    const matchSearch = t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.txId.toLowerCase().includes(search.toLowerCase()) ||
      t.account.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'All' || t.type === typeFilter;
    return matchSearch && matchType;
  }), [source, search, typeFilter]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="fin-card mb-6">
      <div className="p-5 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-600 text-foreground">Recent Equity Transactions</div>
          <div className="text-[11px] text-muted-foreground">Capital movements, profit allocations, dividends, and adjustments</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Icon name="MagnifyingGlassIcon" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transactions..."
              className="pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:border-primary/50 w-48"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-[12px] bg-muted text-foreground focus:outline-none focus:border-primary/50"
          >
            {types.map(t => (
              <option key={`eq-type-${t}`} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {!isSampleData && source.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No equity transactions yet"
          description="No posted journal lines touching an equity account (Paid-in Capital, Retained Earnings, Dividends, etc.) were found for this client."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['Date', 'Transaction ID', 'Account', 'Type', 'Description', 'Debit', 'Credit', 'Net Amount', 'Reference', 'Status', ''].map(col => (
                  <th key={`eqtxn-col-${col}`} className="text-left px-4 py-3 font-600 text-muted-foreground whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(txn => (
                <tr key={`eqtxn-${txn.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(txn.date)}</td>
                  <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{txn.txId}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{txn.account}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`fin-badge text-[10px] px-2 py-0.5 border ${
                      txn.type === 'Dividend' ? 'bg-negative-subtle text-negative border-red-200' :
                      txn.type === 'Capital Injection' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      txn.type === 'Profit Allocation' ? 'bg-positive-subtle text-positive border-green-200' : 'bg-muted text-muted-foreground border-border'
                    }`}>{txn.type}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                    <div className="truncate" title={txn.description}>{txn.description}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{txn.debit > 0 ? fx(formatMoney(txn.debit, 'IDR')) : '\u2014'}</td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{txn.credit > 0 ? fx(formatMoney(txn.credit, 'IDR')) : '\u2014'}</td>
                  <td className={`px-4 py-3 font-600 financial-value whitespace-nowrap ${txn.amount < 0 ? 'text-negative' : 'text-positive'}`}>
                    {fx(formatMoney(txn.amount, 'IDR'))}
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
                  <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">No transactions match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
