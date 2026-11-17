'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertCircle, Clock, CheckCircle, ArrowRight } from 'lucide-react';
import type { PurchaseException } from '@/data/purchaseData';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import {
  PurchaseKpiTile, PurchaseCardHeader, StatusPill, MINI_ROW_CLS, type PillStyle,
} from '@/app/transactions/purchase/components/PurchaseKpiTile';

// Kartu "Exception Summary" di tab Overview Purchase. Isinya sama seperti sebelumnya (4 hitungan +
// daftar exception Open / Under Review); tampilannya memakai tema elegant monokrom yang sama dengan
// Sales Overview: empat tile KPI abu/hitam, header chip abu, tombol bergaris abu, dan pill severity
// lembut (merah = Critical, oranye = High, kuning = Medium, hijau = Low) seperti di Purchase Exceptions.

const SEVERITY_STYLE: Record<string, PillStyle> = {
  Critical: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  High: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Medium: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Low: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
};

export default function PurchaseExceptionSummary({ exceptions }: { exceptions: PurchaseException[] }) {
  const total = exceptions.length;
  const open = exceptions.filter((e) => e.status === 'Open').length;
  const review = exceptions.filter((e) => e.status === 'Under Review').length;
  const resolved = exceptions.filter((e) => e.status === 'Resolved').length;
  const attention = exceptions.filter((e) => e.status === 'Open' || e.status === 'Under Review').slice(0, 3);
  const pctOf = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const sub = (n: number) => `${n} / ${total} exceptions`;

  return (
    <div className={`${salesFont.className} card-elevated-md rounded-xl p-5`}>
      <PurchaseCardHeader
        icon={AlertTriangle}
        title="Exception Summary"
        subtitle="Purchase transactions that need review"
        right={
          <Link
            href="/transactions/purchase/exceptions"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50"
          >
            View all exceptions <ArrowRight size={13} />
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PurchaseKpiTile label="Total Exceptions" value={total.toLocaleString('id-ID')} sub={sub(total)} pct={total > 0 ? 100 : 0} pctLabel="of all exceptions" icon={AlertTriangle} />
        <PurchaseKpiTile label="Open" value={open.toLocaleString('id-ID')} sub={sub(open)} pct={pctOf(open)} pctLabel="of all exceptions" icon={AlertCircle} />
        <PurchaseKpiTile label="Under Review" value={review.toLocaleString('id-ID')} sub={sub(review)} pct={pctOf(review)} pctLabel="of all exceptions" icon={Clock} />
        <PurchaseKpiTile label="Resolved" value={resolved.toLocaleString('id-ID')} sub={sub(resolved)} pct={pctOf(resolved)} pctLabel="of all exceptions" icon={CheckCircle} />
      </div>

      {attention.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attention.map((exc) => (
            <li key={exc.id} className={`${MINI_ROW_CLS} flex items-center justify-between gap-3 px-3 py-2.5`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs font-medium text-blue-700">{exc.purchaseId}</span>
                <span className="truncate text-xs text-neutral-600">— {exc.exceptionType}</span>
              </div>
              <StatusPill style={SEVERITY_STYLE[exc.severity]} label={exc.severity} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}