'use client';

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  XMarkIcon, ArrowUpTrayIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon,
} from '@heroicons/react/24/outline';
import { uploadPurchaseSourceFile, type PurchaseImportTransactionResult } from '@/lib/purchaseStore';
import { useActiveClient } from '@/lib/activeClient';
import JePagination, { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';

// ============================================================
// Upload Data Pembelian -- file MENTAH dikirim ke backend
// (purchase_import_v1.py), dicocokkan ke Purchase Import Template milik
// klien aktif (dropdown Switch Company) -- mis. "Data Pembelian Detail"
// SAU. Kalau cocok, backend langsung membuat Purchase Transaction draft +
// baris itemnya. BEDA dari ImportJournalModal: TIDAK ada fallback parsing
// lokal -- laporan pembelian berbentuk blok cetak, bukan tabel flat, jadi
// tanpa template tidak bisa dibaca generik.
// ============================================================

export default function ImportPurchaseModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'upload' | 'result'>('upload');
  const [uploading, setUploading] = useState(false);
  const [notMatched, setNotMatched] = useState<string | null>(null);
  const [results, setResults] = useState<PurchaseImportTransactionResult[]>([]);
  const [summary, setSummary] = useState('');
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeClientId } = useActiveClient();

  const handleFiles = async (files: File[]) => {
    if (!activeClientId) {
      toast.error('Select a company first (Switch Company) before uploading.');
      return;
    }
    setUploading(true);
    setNotMatched(null);
    const semua: PurchaseImportTransactionResult[] = [];
    const tidakCocok: string[] = [];
    let created = 0;
    let detected = 0;
    // 1 file = 1 cabang (mis. CRS/NGY/OL/PCL) -- diproses berurutan.
    for (const file of files) {
      try {
        const hasil = await uploadPurchaseSourceFile(file, activeClientId);
        if (!hasil.template_matched) {
          tidakCocok.push(file.name);
          continue;
        }
        created += hasil.created;
        detected += hasil.transactions_detected;
        semua.push(...hasil.transactions);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`, { description: err instanceof Error ? err.message : undefined });
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (semua.length === 0) {
      if (tidakCocok.length > 0) {
        setNotMatched(`No purchase template matches: ${tidakCocok.join(', ')}. This file format has not been set up for the active company yet.`);
      }
      return;
    }
    setResults(semua);
    setPage(1);
    setSummary(
      `${created} of ${detected} purchase transactions imported as draft` +
      (tidakCocok.length ? ` -- ${tidakCocok.length} file(s) not recognized: ${tidakCocok.join(', ')}` : '') + '.',
    );
    setStep('result');
  };

  const totalPages = Math.max(1, Math.ceil(results.length / JE_PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paginated = results.slice((pageSafe - 1) * JE_PAGE_SIZE, pageSafe * JE_PAGE_SIZE);
  const jumlahGagal = results.filter(r => !r.ok).length;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) handleFiles(files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="je-card bg-card w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Upload Purchase Data</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={uploading ? undefined : handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`border-2 border-dashed border-border rounded-lg py-12 text-center transition-colors ${uploading ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-muted/40'}`}
            >
              <ArrowUpTrayIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">
                {uploading ? 'Reading purchase report…' : 'Drag & drop files here, or click to choose files'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Format: .csv, .xlsx, .xls -- multiple files allowed (1 file per branch)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={e => { const f = Array.from(e.target.files ?? []); if (f.length) handleFiles(f); }}
              />
            </div>
            {notMatched && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{notMatched}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The file is matched to the purchase report template of the active company (e.g. the SAU purchase detail report).
              Each transaction block becomes 1 draft Purchase Transaction with its item lines; discount, tax and other costs follow the printed grand total.
            </p>
          </div>
        )}

        {step === 'result' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
              {summary}
            </div>
            {jumlahGagal > 0 && (
              <p className="text-xs text-red-700">{jumlahGagal} transaction(s) skipped -- see the Notes column.</p>
            )}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/90">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Purchase No</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.map((r, i) => (
                    <tr key={`${r.purchase_no}-${(pageSafe - 1) * JE_PAGE_SIZE + i}`}>
                      <td className="px-3 py-2 font-mono text-primary font-medium whitespace-nowrap">{r.purchase_no}</td>
                      <td className="px-3 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 text-green-700"><CheckCircleIcon className="w-3.5 h-3.5" /> Success</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700"><XCircleIcon className="w-3.5 h-3.5" /> Skipped</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <JePagination page={pageSafe} pageSize={JE_PAGE_SIZE} total={results.length} onPageChange={setPage} itemLabel="transactions" />
            </div>
            <button onClick={onClose} type="button" className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-colors">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
