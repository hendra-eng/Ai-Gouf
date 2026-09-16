'use client';

import React from 'react';
import { Construction } from 'lucide-react';

// [BARU] Placeholder kosong untuk tab Sales / Purchase / Journal Entry /
// Cash & Bank / Other di halaman /transactions. Isi sebenarnya menyusul —
// untuk sekarang cukup nampilin state kosong yang rapi.
interface TransactionsTabPlaceholderProps {
  title: string;
}

export default function TransactionsTabPlaceholder({ title }: TransactionsTabPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 rounded-xl border border-dashed border-border bg-card">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Construction size={20} className="text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Konten untuk tab ini belum dibuat.
      </p>
    </div>
  );
}
