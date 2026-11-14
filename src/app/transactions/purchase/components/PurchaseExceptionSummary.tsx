'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertCircle, Clock, CheckCircle, ArrowRight } from 'lucide-react';
import type { PurchaseException } from '@/data/purchaseData';

// Kartu "Exception Summary" di tab Overview Purchase. Isinya sama seperti sebelumnya (4 hitungan
// + daftar exception Open / Under Review), hanya tampilannya disamakan dengan kartu KPI Overview:
// garis aksen atas, chip ikon, bar proporsi + badge persen, dan header ber-ikon seperti kartu
// chart (Purchase Status). Warna mengikuti makna: merah = Open, kuning = Under Review,
// hijau = Resolved.

type Tone = 'total' | 'open' | 'review' | 'resolved';

const TONE: Record<Tone, { strip: string; bar: string; badge: string; value: string }> = {
  total: { strip: 'from-[#6EE7B7] to-[#10B981]', bar: 'from-[#6EE7B7] to-[#10B981]', badge: 'bg-[#ECFDF5] text-[#047857]', value: 'text-[#064E3B]' },
  open: { strip: 'from-[#F87171] to-[#DC2626]', bar: 'from-[#FCA5A5] to-[#DC2626]', badge: 'bg-[#FEE2E2] text-[#DC2626]', value: 'text-[#B91C1C]' },
  review: { strip: 'from-[#FBBF24] to-[#D97706]', bar: 'from-[#FCD34D] to-[#D97706]', badge: 'bg-[#FEF3C7] text-[#B45309]', value: 'text-[#B45309]' },
  resolved: { strip: 'from-[#0F7D4E] to-[#064E3B]', bar: 'from-[#34D399] to-[#0F7D4E]', badge: 'bg-[#D1FAE5] text-[#065F46]', value: 'text-[#064E3B]' },
};

const SEVERITY_DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-orange-500' };
const SEVERITY_PILL: Record<string, string> = {
  Critical: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
};

function ExceptionKpiTile({ label, value, total, tone, icon: Icon }: {
  label: string; value: number; total: number; tone: Tone; icon: React.ElementType;
}) {
  const c = TONE[tone];
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-white via-white to-[#F3FBF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-lg">
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.strip}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-extrabold uppercase tracking-wider text-slate-600">{label}</p>
          <p className={`mt-2 truncate text-4xl font-extrabold leading-none tabular-nums ${c.value}`}>{value.toLocaleString('id-ID')}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.badge}`}>
          <Icon size={18} />
        </span>
      </div>
      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
        <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${c.bar}`} style={{ width: `${value > 0 ? Math.min(Math.max(pct, 3), 100) : 0}%` }} />
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-slate-500">{tone === 'total' ? 'all exceptions' : 'of all exceptions'}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${c.badge}`}>{tone === 'total' ? (total > 0 ? 100 : 0) : pct}%</span>
      </div>
    </div>
  );
}

export default function PurchaseExceptionSummary({ exceptions }: { exceptions: PurchaseException[] }) {
  const total = exceptions.length;
  const open = exceptions.filter((e) => e.status === 'Open').length;
  const review = exceptions.filter((e) => e.status === 'Under Review').length;
  const resolved = exceptions.filter((e) => e.status === 'Resolved').length;
  const attention = exceptions.filter((e) => e.status === 'Open' || e.status === 'Under Review').slice(0, 3);

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF7ED] text-[#EA580C] shadow-sm ring-1 ring-white">
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-foreground">Exception Summary</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Purchase transactions that need review</p>
          </div>
        </div>
        <Link
          href="/transactions/purchase/exceptions"
          className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-primary/60 bg-card px-3 py-1.5 text-xs font-medium text-[#065F46] transition-colors hover:border-primary hover:bg-[#ECFDF5]"
        >
          View all exceptions <ArrowRight size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ExceptionKpiTile label="Total Exceptions" value={total} total={total} tone="total" icon={AlertTriangle} />
        <ExceptionKpiTile label="Open" value={open} total={total} tone="open" icon={AlertCircle} />
        <ExceptionKpiTile label="Under Review" value={review} total={total} tone="review" icon={Clock} />
        <ExceptionKpiTile label="Resolved" value={resolved} total={total} tone="resolved" icon={CheckCircle} />
      </div>

      {attention.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attention.map((exc) => (
            <li key={exc.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-slate-50/60 px-3 py-2.5 transition-colors hover:bg-[#ECFDF5]/60">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[exc.severity] ?? 'bg-amber-400'}`} />
                <span className="font-mono text-xs font-semibold text-primary">{exc.purchaseId}</span>
                <span className="truncate text-xs text-muted-foreground">— {exc.exceptionType}</span>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${SEVERITY_PILL[exc.severity] ?? 'bg-amber-100 text-amber-700'}`}>{exc.severity}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}