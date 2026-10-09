import React from 'react';
import { Sparkles } from 'lucide-react';

/** Placeholder tab Settings yang belum dibangun (Purchase, Product, Account Mapping). */
export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center shadow-sm">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 text-primary ring-1 ring-blue-100">
        <Sparkles size={22} />
      </span>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <span className="mt-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Coming soon</span>
    </div>
  );
}
