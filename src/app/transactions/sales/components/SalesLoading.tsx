'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { salesFont } from './salesFont';

// Kartu status "memuat" / "kosong" bersama untuk halaman Sales -- gaya netral
// (abu + hitam, font Inter) sama dengan tab Overview, Source Data & Sales Transaction.
// loading = true  -> spinner + teks; loading = false -> ikon `emptyIcon` + teks.
export default function SalesLoading({
  loading,
  message,
  emptyIcon: EmptyIcon,
  className = '',
}: {
  loading: boolean;
  message: string;
  emptyIcon?: React.ElementType;
  className?: string;
}) {
  return (
    <div
      role={loading ? 'status' : undefined}
      aria-live="polite"
      className={`${salesFont.className} flex flex-col items-center justify-center gap-3 rounded-[10px] border border-neutral-300 bg-white px-6 py-16 text-center shadow-sm ${className}`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 ring-1 ring-neutral-200">
        {loading ? (
          <Loader2 size={20} className="animate-spin text-neutral-700" />
        ) : (
          EmptyIcon && <EmptyIcon size={20} className="text-neutral-700" />
        )}
      </span>
      <p className="text-sm font-semibold text-neutral-900">{message}</p>
    </div>
  );
}