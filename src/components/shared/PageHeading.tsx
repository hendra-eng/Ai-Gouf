'use client';

// Header halaman (judul + deskripsi + slot aksi di kanan) dengan gaya yang sama persis dengan halaman Sales
// (app/transactions/sales/components/SalesClient.tsx): font Inter, judul text-2xl font-semibold tracking-tight
// text-neutral-900, deskripsi mt-1 text-sm font-medium text-neutral-500. Dipakai AR, AP, FX Transfers, FX Revaluation.
// Ubah gaya di sini untuk mengubah header keempat halaman sekaligus.

import React from 'react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

export default function PageHeading({ title, description, actions }: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`${salesFont.className} flex flex-wrap items-start justify-between gap-3`}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {description && <p className="mt-1 text-sm font-medium text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}