'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardCheck } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { LiabilityObligation } from '../lib/liabilitiesBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_OBLIGATIONS: LiabilityObligation[] = [
  { id: 'OBL-2026-001', liability: 'PPh 21 Agustus 2026', type: 'Tax Payable', creditor: 'Direktorat Jenderal Pajak', dueDate: '2026-09-08', amount: 182_000_000, daysRemaining: 13, status: 'due-soon', reference: 'SAMPLE' },
  { id: 'OBL-2026-002', liability: 'Hutang Dagang — PT Sinar Abadi', type: 'Accounts Payable', creditor: 'PT Sinar Abadi Makmur', dueDate: '2026-09-15', amount: 142_000_000, daysRemaining: 20, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-003', liability: 'Cicilan KPR Gedung Surabaya', type: 'Long-Term Debt', creditor: 'Bank Mandiri', dueDate: '2026-10-01', amount: 48_000_000, daysRemaining: 36, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-004', liability: 'Hutang Dagang — CV Maju Jaya', type: 'Accounts Payable', creditor: 'CV Maju Jaya Teknik', dueDate: '2026-10-10', amount: 88_000_000, daysRemaining: 45, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-005', liability: 'PPN Masa Agustus 2026', type: 'Tax Payable', creditor: 'Direktorat Jenderal Pajak', dueDate: '2026-09-25', amount: 62_000_000, daysRemaining: 30, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-006', liability: 'Hutang Bank BRI — Kredit Modal Kerja', type: 'Short-Term Debt', creditor: 'Bank Rakyat Indonesia', dueDate: '2026-11-20', amount: 120_000_000, daysRemaining: 86, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-007', liability: 'Sewa Kantor Bandung — Q4 2026', type: 'Lease Liability', creditor: 'PT Graha Properti Nusantara', dueDate: '2026-10-01', amount: 24_000_000, daysRemaining: 36, status: 'scheduled', reference: 'SAMPLE' },
  { id: 'OBL-2026-008', liability: 'Hutang Dagang — PT Bintang Mas', type: 'Accounts Payable', creditor: 'PT Bintang Mas Sejahtera', dueDate: '2026-08-28', amount: 58_000_000, daysRemaining: -2, status: 'overdue', reference: 'SAMPLE' },
  { id: 'OBL-2026-009', liability: 'Cicilan Leasing Forklift', type: 'Lease Liability', creditor: 'BFI Finance Indonesia', dueDate: '2026-09-05', amount: 8_400_000, daysRemaining: 10, status: 'due-soon', reference: 'SAMPLE' },
  { id: 'OBL-2026-010', liability: 'Hutang Obligasi — BNI', type: 'Long-Term Debt', creditor: 'Bank Negara Indonesia', dueDate: '2028-03-15', amount: 500_000_000, daysRemaining: 566, status: 'scheduled', reference: 'SAMPLE' },
];

interface LiabilityDueScheduleProps {
  isSampleData: boolean;
  obligations: LiabilityObligation[];
}

export default function LiabilityDueSchedule({ isSampleData, obligations }: LiabilityDueScheduleProps) {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const perPage = 8;

  const source = isSampleData ? SAMPLE_OBLIGATIONS : obligations;

  const filtered = useMemo(() => source.filter(o => {
    const matchSearch = o.liability.toLowerCase().includes(search.toLowerCase()) ||
      o.creditor.toLowerCase().includes(search.toLowerCase()) ||
      o.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'All' || o.status === statusFilter.toLowerCase().replace(' ', '-');
    return matchSearch && matchStatus;
  }), [source, search, statusFilter]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="fin-card mb-6">
      <div className="p-5 border-b border-border">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[14px] font-600 text-foreground">Upcoming Liability Obligations</div>
            <div className="text-[11px] text-muted-foreground">All scheduled payments, payables, and debt obligations</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Icon name="MagnifyingGlassIcon" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search obligations..."
                className="pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:border-primary/50 w-48"
              />
            </div>
            <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
              {['All', 'Due Soon', 'Overdue', 'Scheduled'].map(s => (
                <button
                  key={`status-filter-${s}`}
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                  className={`px-3 py-1 text-[11px] font-500 rounded transition-colors whitespace-nowrap ${statusFilter === s ? 'bg-card text-foreground card-shadow' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!isSampleData && source.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No outstanding obligations"
          description="No liability transactions with an amount still outstanding were found for this client's posted journals."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {['ID', 'Liability', 'Type', 'Creditor / Vendor', 'Due Date', 'Amount', 'Days Remaining', 'Status', ''].map(col => (
                    <th key={`due-col-${col}`} className="text-left px-4 py-3 font-600 text-muted-foreground whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(o => (
                  <tr key={`due-row-${o.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{o.id}</td>
                    <td className="px-4 py-3 text-foreground font-500 max-w-[200px]">
                      <div className="truncate" title={o.liability}>{o.liability}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{o.type}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[160px]">
                      <div className="truncate" title={o.creditor}>{o.creditor}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[12px] font-500 ${o.daysRemaining <= 14 ? 'text-negative' : o.daysRemaining <= 30 ? 'text-warning' : 'text-foreground'}`}>
                        {fmtDate(o.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-600 text-foreground financial-value whitespace-nowrap">{fx(formatMoney(o.amount, 'IDR'))}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[12px] font-600 financial-value ${o.daysRemaining <= 0 ? 'text-negative' : o.daysRemaining <= 14 ? 'text-negative' : o.daysRemaining <= 30 ? 'text-warning' : 'text-muted-foreground'}`}>
                        {o.daysRemaining <= 0 ? `${Math.abs(o.daysRemaining)}d overdue` : `${o.daysRemaining} days`}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FinancialStatusBadge variant={o.status} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toast.info(`Membuka detail kewajiban ${o.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                        title="View details"
                      >
                        <Icon name="ArrowTopRightOnSquareIcon" size={13} className="text-muted-foreground" />
                      </button>
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No obligations match your filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">
              Showing {filtered.length === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} obligations
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name="ChevronLeftIcon" size={13} className="text-muted-foreground" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={`due-page-${p}`}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded text-[11px] font-500 transition-colors ${p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name="ChevronRightIcon" size={13} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
