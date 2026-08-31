'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/assets/transactions?page=...
const transactions = [
  { id: 'TXN-AST-0881', date: '26 Aug 2026', asset: 'Server Dell PowerEdge R750', type: 'Depreciation', account: 'Beban Penyusutan', debit: 'Rp 3M', credit: '—', ref: 'JE-2026-0881', user: 'Siti Rahayu', status: 'paid' as const },
  { id: 'TXN-AST-0880', date: '25 Aug 2026', asset: 'Software ERP License', type: 'Depreciation', account: 'Beban Penyusutan', debit: 'Rp 3.83M', credit: '—', ref: 'JE-2026-0880', user: 'Siti Rahayu', status: 'paid' as const },
  { id: 'TXN-AST-0875', date: '20 Aug 2026', asset: 'CCTV System 48 kamera', type: 'Acquisition', account: 'Aset Tetap', debit: '—', credit: 'Rp 65M', ref: 'PO-2026-0145', user: 'Budi Santoso', status: 'active' as const },
  { id: 'TXN-AST-0870', date: '15 Aug 2026', asset: 'Mesin Produksi CNC-X200', type: 'Transfer', account: 'Aset Tetap', debit: '—', credit: '—', ref: 'TRF-2026-0022', user: 'Ahmad Fauzi', status: 'active' as const },
  { id: 'TXN-AST-0862', date: '10 Aug 2026', asset: 'Mesin Offset Heidelberg', type: 'Disposal', account: 'Akumulasi Penyusutan', debit: 'Rp 580M', credit: 'Rp 580M', ref: 'DIS-2026-0003', user: 'Rizky Wardana', status: 'disposed' as const },
  { id: 'TXN-AST-0855', date: '05 Aug 2026', asset: 'Toyota Fortuner 2022', type: 'Depreciation', account: 'Beban Penyusutan', debit: 'Rp 5.42M', credit: '—', ref: 'JE-2026-0855', user: 'Siti Rahayu', status: 'paid' as const },
  { id: 'TXN-AST-0848', date: '01 Aug 2026', asset: 'Gedung Kantor Jakarta', type: 'Revaluation', account: 'Surplus Revaluasi', debit: '—', credit: 'Rp 50M', ref: 'REV-2026-0001', user: 'Rizky Wardana', status: 'active' as const },
];

export default function AssetTransactions() {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const filtered = transactions.filter(t =>
    t.asset.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase()) ||
    t.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fin-card mb-6">
      <div className="p-5 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-600 text-foreground">Recent Asset Transactions</div>
          <div className="text-[11px] text-muted-foreground">Acquisitions, depreciation, disposals, and adjustments</div>
        </div>
        <div className="flex items-center gap-2">
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
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {['Date', 'Transaction ID', 'Asset', 'Type', 'Account', 'Debit', 'Credit', 'Reference', 'User', 'Status', ''].map(col => (
                <th key={`asttxn-col-${col}`} className="text-left px-4 py-3 font-600 text-muted-foreground whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(txn => (
              <tr key={`asttxn-${txn.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{txn.date}</td>
                <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{txn.id}</td>
                <td className="px-4 py-3 text-foreground max-w-[160px]">
                  <div className="truncate" title={txn.asset}>{txn.asset}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`fin-badge text-[10px] px-2 py-0.5 border ${
                    txn.type === 'Acquisition' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    txn.type === 'Depreciation' ? 'bg-muted text-muted-foreground border-border' :
                    txn.type === 'Disposal' ? 'bg-negative-subtle text-negative border-red-200' :
                    txn.type === 'Revaluation'? 'bg-ai-subtle text-ai border-purple-200' : 'bg-warning-subtle text-warning border-amber-200'
                  }`}>{txn.type}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{txn.account}</td>
                <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.debit)}</td>
                <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.credit)}</td>
                <td className="px-4 py-3 text-primary whitespace-nowrap">{txn.ref}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{txn.user}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
