'use client';

import React from 'react';

// Panel putih dengan garis aksen hitam & header abu -- salinan persis PostedPanel di
// Sales > Posted (dipakai untuk drawer detail, aktivitas, dan aksi cepat).
export default function JePostedPanel({ title, leading, action, children, className = '' }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-center justify-between gap-3 border-b border-neutral-300 bg-neutral-50 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <h3 className="truncate text-sm font-semibold text-neutral-900">{title}</h3>
        </div>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

export const jeIconBadge = (node: React.ReactNode) => (
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">{node}</span>
);