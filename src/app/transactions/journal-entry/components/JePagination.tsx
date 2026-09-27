'use client';

import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

// Shared pagination footer for every table in the Journal Entry feature --
// keeps default page size consistent (20 rows) across JE Transaction,
// Journal Preview, Exceptions, Posted, and Source Data.
export const JE_PAGE_SIZE = 20;

interface JePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export default function JePagination({ page, pageSize, total, onPageChange, itemLabel = 'entries' }: JePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (pageSafe - 1) * pageSize + 1;
  const end = Math.min(pageSafe * pageSize, total);

  const pageNumbers = totalPages <= 5
    ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : pageSafe <= 3
    ? [1, 2, 3, 4, 5]
    : pageSafe >= totalPages - 2
    ? Array.from({ length: 5 }, (_, i) => totalPages - 4 + i)
    : Array.from({ length: 5 }, (_, i) => pageSafe - 2 + i);

  if (total === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Showing <span className="font-medium text-foreground">{start}-{end}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> {itemLabel}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(pageSafe - 1)}
          disabled={pageSafe <= 1}
          className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
        {pageNumbers.map(p => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`w-6 h-6 rounded text-xs font-medium transition-colors ${
              p === pageSafe ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onPageChange(pageSafe + 1)}
          disabled={pageSafe >= totalPages}
          className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
