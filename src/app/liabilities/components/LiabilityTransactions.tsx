'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/liabilities/transactions?page=...
const transactions = [
  { id: 'TXN-LIB-0892', date: '26 Aug 2026', account: 'Hutang PPh 21', description: 'Accrual pajak penghasilan Agustus 2026', debit: '—', credit: 'Rp 182M', creditor: 'DJP', ref: 'JE-2026-0892', status: 'active' as const },
  { id: 'TXN-LIB-0885', date: '25 Aug 2026', account: 'Hutang Dagang', description: 'Pembelian bahan baku dari PT Sinar Abadi', debit: '—', credit: 'Rp 142M', creditor: 'PT Sinar Abadi Makmur', ref: 'PO-2026-0488', status: 'active' as const },
  { id: 'TXN-LIB-0878', date: '22 Aug 2026', account: 'Hutang Dagang', description: 'Pembayaran hutang dagang CV Maju Jaya', debit: 'Rp 95M', credit: '—', creditor: 'CV Maju Jaya Teknik', ref: 'PAY-2026-0312', status: 'paid' as const },
  { id: 'TXN-LIB-0871', date: '20 Aug 2026', account: 'Hutang Bank BRI', description: 'Cicilan kredit modal kerja Agustus 2026', debit: 'Rp 20M', credit: '—', creditor: 'Bank Rakyat Indonesia', ref: 'PAY-2026-0305', status: 'paid' as const },
  { id: 'TXN-LIB-0864', date: '15 Aug 2026', account: 'Beban Akrual', description: 'Accrual beban gaji Agustus 2026', debit: '—', credit: 'Rp 68M', creditor: 'Internal Payroll', ref: 'JE-2026-0864', status: 'active' as const },
  { id: 'TXN-LIB-0857', date: '10 Aug 2026', account: 'Hutang Sewa', description: 'Kewajiban sewa kantor Bandung Q4 2026', debit: '—', credit: 'Rp 24M', creditor: 'PT Graha Properti', ref: 'JE-2026-0857', status: 'scheduled' as const },
  { id: 'TXN-LIB-0850', date: '5 Aug 2026', account: 'Hutang PPN', description: 'Accrual PPN Masa Juli 2026', debit: 'Rp 58M', credit: '—', creditor: 'DJP', ref: 'PAY-2026-0291', status: 'paid' as const },
  { id: 'TXN-LIB-0843', date: '1 Aug 2026', account: 'Hutang Obligasi BNI', description: 'Pembayaran bunga obligasi semester 1 2026', debit: 'Rp 24.1M', credit: '—', creditor: 'Bank Negara Indonesia', ref: 'PAY-2026-0280', status: 'paid' as const },
];

export default function LiabilityTransactions() {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const filtered = transactions.filter(t =>
    t.account.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase()) ||
    t.creditor.toLowerCase().includes(search.toLowerCase())
  );

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
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{txn.date}</td>
                <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{txn.id}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap">{txn.account}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                  <div className="truncate" title={txn.description}>{txn.description}</div>
                </td>
                <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.debit)}</td>
                <td className="px-4 py-3 text-foreground financial-value whitespace-nowrap">{fx(txn.credit)}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-[140px]">
                  <div className="truncate" title={txn.creditor}>{txn.creditor}</div>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
