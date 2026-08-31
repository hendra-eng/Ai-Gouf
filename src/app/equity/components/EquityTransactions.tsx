'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/equity/transactions?page=...
const transactions = [
  { id: 'TXN-EQT-0901', date: '26 Aug 2026', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Agustus 2026', debit: '—', credit: 'Rp 230M', amount: 'Rp 230M', ref: 'JE-2026-0901', status: 'active' as const },
  { id: 'TXN-EQT-0880', date: '20 Aug 2026', account: 'Surplus Revaluasi', type: 'Equity Adjustment', description: 'Revaluasi gedung kantor Jakarta', debit: '—', credit: 'Rp 50M', amount: 'Rp 50M', ref: 'REV-2026-0001', status: 'active' as const },
  { id: 'TXN-EQT-0860', date: '15 Aug 2026', account: 'Pendapatan Komprehensif Lain', type: 'Retained Earnings Adjustment', description: 'OCI — perubahan nilai investasi Q2 2026', debit: 'Rp 12M', credit: '—', amount: '(Rp 12M)', ref: 'JE-2026-0860', status: 'active' as const },
  { id: 'TXN-EQT-0820', date: '1 Aug 2026', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Juli 2026', debit: '—', credit: 'Rp 260M', amount: 'Rp 260M', ref: 'JE-2026-0820', status: 'active' as const },
  { id: 'TXN-EQT-0780', date: '15 Jul 2026', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Juni 2026', debit: '—', credit: 'Rp 245M', amount: 'Rp 245M', ref: 'JE-2026-0780', status: 'active' as const },
  { id: 'TXN-EQT-0650', date: '15 Mar 2026', account: 'Hutang Dividen', type: 'Dividend', description: 'Pembayaran dividen final FY2025 kepada pemegang saham', debit: 'Rp 880M', credit: '—', amount: '(Rp 880M)', ref: 'DIV-2026-0001', status: 'paid' as const },
  { id: 'TXN-EQT-0600', date: '1 Feb 2026', account: 'Laba Ditahan', type: 'Profit Allocation', description: 'Alokasi laba bersih Januari 2026', debit: '—', credit: 'Rp 180M', amount: 'Rp 180M', ref: 'JE-2026-0600', status: 'active' as const },
  { id: 'TXN-EQT-0550', date: '31 Jan 2026', account: 'Modal Disetor', type: 'Capital Injection', description: 'Peningkatan modal dari pemegang saham lama', debit: '—', credit: 'Rp 0', amount: 'Rp 0', ref: 'CAP-2026-0001', status: 'neutral' as const },
];

export default function EquityTransactions() {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');

  const types = ['All', 'Profit Allocation', 'Dividend', 'Capital Injection', 'Equity Adjustment', 'Retained Earnings Adjustment'];

  const filtered = transactions.filter(t => {
    const matchSearch = t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.account.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'All' || t.type === typeFilter;
    return matchSearch && matchType;
  });

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
            {filtered.map(txn => {
              const isNegative = txn.amount.startsWith('(');
              return (
                <tr key={`eqtxn-${txn.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{txn.date}</td>
                  <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{txn.id}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{txn.account}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`fin-badge text-[10px] px-2 py-0.5 border ${
                      txn.type === 'Dividend' ? 'bg-negative-subtle text-negative border-red-200' :
                      txn.type === 'Capital Injection' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      txn.type === 'Profit Allocation'? 'bg-positive-subtle text-positive border-green-200' : 'bg-muted text-muted-foreground border-border'
                    }`}>{txn.type}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                    <div className="truncate" title={txn.description}>{txn.description}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.debit)}</td>
                  <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.credit)}</td>
                  <td className={`px-4 py-3 font-600 financial-value whitespace-nowrap ${isNegative ? 'text-negative' : 'text-positive'}`}>
                    {fx(txn.amount)}
                  </td>
                  <td className="px-4 py-3 text-primary whitespace-nowrap">{txn.ref}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <FinancialStatusBadge variant={txn.status} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toast.info(`Membuka journal entry ${txn.ref}`)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                      title="View journal entry"
                    >
                      <Icon name="ArrowTopRightOnSquareIcon" size={13} className="text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
