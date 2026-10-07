'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import type { PrintFormat, PrintReport } from '@/lib/printExport';

// jsPDF/exceljs berat -> dimuat saat tombol diklik saja, bukan saat halaman dibuka.
async function printReport(report: PrintReport, format: PrintFormat) {
  const mod = await import('@/lib/printExport');
  return mod.printReport(report, format);
}

// Download PDF / CSV / XLSX lewat helper bersama src/lib/printExport.ts.
// `build` dipanggil saat diklik supaya file selalu sesuai data terakhir.
// `extra` = opsi tambahan (mis. Word dari backend untuk CALK).

export default function DownloadMenu({ build, disabled, extra }: {
  build: () => PrintReport;
  disabled?: boolean;
  extra?: { label: string; onClick: () => void | Promise<void> }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = async (fn: () => void | Promise<void>) => {
    setOpen(false);
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const items: { label: string; icon: React.ElementType; color: string; onClick: () => void | Promise<void> }[] = [
    { label: 'PDF', icon: FileText, color: 'text-rose-500', onClick: () => printReport(build(), 'pdf') },
    { label: 'CSV', icon: FileText, color: 'text-slate-500', onClick: () => printReport(build(), 'csv') },
    { label: 'Excel (XLSX)', icon: FileSpreadsheet, color: 'text-blue-600', onClick: () => printReport(build(), 'excel' as PrintFormat) },
    ...(extra ?? []).map(e => ({ ...e, icon: FileText, color: 'text-sky-600' })),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download <ChevronDown size={15} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 bg-card border border-border rounded-xl shadow-lg py-1">
          {items.map(it => {
            const Icon = it.icon;
            return (
              <button key={it.label} type="button" onClick={() => run(it.onClick)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-slate-50">
                <Icon size={16} className={it.color} /> {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
