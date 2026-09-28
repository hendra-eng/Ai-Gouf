'use client';

// Tombol "Print" + dropdown pilihan format (CSV / Excel / PDF) untuk daftar
// transaksi & detail transaksi. Isi laporannya disusun pemanggil lewat
// onPrint(format) -- biasanya memanggil printReport() dari @/lib/printExport.
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Printer, ChevronDown, FileText, FileSpreadsheet, Sheet, Loader2 } from 'lucide-react';
import type { PrintFormat } from '@/lib/printExport';

interface PrintMenuProps {
  onPrint: (format: PrintFormat) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  /** Arah dropdown -- 'right' = rata kanan tombol (default). */
  align?: 'left' | 'right';
  className?: string;
}

const OPTIONS: { format: PrintFormat; label: string; hint: string; icon: React.ReactNode }[] = [
  { format: 'pdf', label: 'PDF', hint: 'Printable document', icon: <FileText size={14} className="text-red-600" /> },
  { format: 'excel', label: 'Excel (.xlsx)', hint: 'Spreadsheet with formatting', icon: <FileSpreadsheet size={14} className="text-emerald-600" /> },
  { format: 'csv', label: 'CSV', hint: 'Plain comma-separated data', icon: <Sheet size={14} className="text-slate-600" /> },
];

export default function PrintMenu({ onPrint, label = 'Print', disabled, align = 'right', className }: PrintMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<PrintFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: PrintFormat) => {
    setOpen(false);
    setBusy(format);
    try {
      await onPrint(format);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`relative ${className ?? ''}`} ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-foreground bg-card hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
        {busy ? 'Preparing…' : label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-56 bg-card border border-border rounded-lg shadow-card-md z-40 overflow-hidden`}>
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Choose format</p>
          {OPTIONS.map(o => (
            <button
              key={o.format}
              type="button"
              onClick={() => run(o.format)}
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors"
            >
              <span className="mt-0.5">{o.icon}</span>
              <span>
                <span className="block text-xs font-medium text-foreground">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
