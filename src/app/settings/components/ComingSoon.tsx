import React from 'react';
import { Sparkles } from 'lucide-react';

/** Placeholder tab Settings yang belum dibangun (Purchase, Product, Account Mapping). */
export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-6 py-20 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-white text-neutral-700 ring-1 ring-neutral-200">
        <Sparkles size={22} />
      </span>
      <p className="text-base font-semibold text-neutral-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-neutral-500">{description}</p>
      <span className="mt-4 rounded-full bg-neutral-800 px-3 py-1 text-xs font-semibold text-white">Coming soon</span>
    </div>
  );
}
