'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { FsWarning, UnbalancedJournal } from '@/lib/fsStore';
import { fmtAmount, fmtDate } from './fsFormat';

// Status pengecekan laporan (seimbang / terekonsiliasi) + daftar jurnal
// tidak seimbang & peringatan mapping akun.

export function CheckBanner({ ok, okText, failText, journals }: {
  ok: boolean;
  okText: string;
  failText: string;
  journals?: UnbalancedJournal[];
}) {
  const [open, setOpen] = useState(false);
  if (ok) {
    return (
      <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-xl px-4 py-2.5 text-sm">
        <CheckCircle2 size={16} /> {okText}
      </div>
    );
  }
  return (
    <div className="border border-rose-200 bg-rose-50 text-rose-800 rounded-xl px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} /> <span className="font-medium">{failText}</span>
        {journals && journals.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold hover:underline">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {journals.length} unbalanced journal{journals.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {open && journals && (
        <table className="w-full mt-2 text-xs">
          <thead>
            <tr className="text-left text-rose-700">
              <th className="py-1 font-semibold">Date</th><th className="font-semibold">Source</th><th className="font-semibold">Number</th>
              <th className="text-right font-semibold">Debit</th><th className="text-right font-semibold">Credit</th><th className="text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {journals.map(j => (
              <tr key={`${j.number}-${j.date}`} className="border-t border-rose-200">
                <td className="py-1">{fmtDate(j.date)}</td><td>{j.source}</td><td className="font-mono">{j.number}</td>
                <td className="text-right tabular-nums">{fmtAmount(j.debit)}</td><td className="text-right tabular-nums">{fmtAmount(j.credit)}</td>
                <td className="text-right tabular-nums font-semibold">{fmtAmount(j.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function WarningsPanel({ warnings }: { warnings: FsWarning[] }) {
  const [open, setOpen] = useState(false);
  if (!warnings.length) return null;
  return (
    <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-2.5 text-sm">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <AlertTriangle size={16} className="text-amber-500" />
        <span className="font-medium">{warnings.length} account mapping warning{warnings.length > 1 ? 's' : ''}</span>
        <span className="text-xs text-amber-700">— review in the Mapping tab</span>
        <span className="ml-auto">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-xs">
          {warnings.map((w, i) => (
            <li key={`${w.account_code}-${w.code}-${i}`}><span className="font-mono">{w.account_code}</span> {w.account_name} — {w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
