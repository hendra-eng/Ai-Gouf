'use client';

// Rekonsiliasi manual ke transaksi BUKU yang sudah dicatat (Cash Receipt / Cash Payment, AR receipt,
// AP payment) -- baris mutasi bank ditautkan ke transaksi itu tanpa jurnal baru. Dipakai di panel
// kanan halaman Reconciliation saat sebuah mutasi dipilih. (Permintaan user 2026-11-18.)

import React, { useEffect, useMemo, useState } from 'react';
import { BookCheck, ChevronDown, ChevronRight, Link2, Loader2, Search } from 'lucide-react';
import { fetchBcBookCandidates, type BcBookCandidate } from '@/lib/bankCashStore';

const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const fmtTgl = (iso: string | null) => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function BookMatchPanel({ clientId, mutationId, nominal, busy, onLink }: {
  clientId: string | null;
  mutationId: string;
  nominal: number;
  busy: boolean;
  onLink: (transactionId: string, txNumber: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<BcBookCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [cari, setCari] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let batal = false;
    setLoading(true);
    setError(null);
    fetchBcBookCandidates(clientId, mutationId)
      .then(r => { if (!batal) setRows(r ?? []); })
      .catch(e => { if (!batal) { setError(e instanceof Error ? e.message : 'Failed to load transactions.'); setRows([]); } })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [clientId, mutationId, tick]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.tx_number, r.counterparty, r.description, r.reference, r.category, String(r.amount)]
      .some(v => (v ?? '').toLowerCase().includes(q)));
  }, [rows, cari]);
  const nPas = rows.filter(r => r.exact_amount).length;

  const link = async (r: BcBookCandidate) => {
    await onLink(r.transaction_id, r.tx_number);
    setTick(t => t + 1);
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown size={14} className="text-neutral-500" /> : <ChevronRight size={14} className="text-neutral-500" />}
        <BookCheck size={14} className="text-emerald-700" />
        <span className="text-xs font-semibold text-neutral-900">Match an existing transaction</span>
        <span className="text-[11px] text-neutral-500">
          {loading ? 'loading…' : `${nPas} with the same amount · ${rows.length} open`}
        </span>
      </button>
      {open && (
        <div className="border-t border-neutral-100 px-3 pb-3 pt-2">
          <p className="mb-2 text-[11px] text-neutral-500">
            Already recorded this in Cash Receipt / Cash Payment? Link the bank line to it — no new journal is created.
            Only transactions on this bank account, in the same direction and with exactly {rp(nominal)} can be reconciled.
          </p>
          {rows.length > 5 && (
            <div className="relative mb-2">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Search number, party, description, amount…"
                className="w-full rounded-md border border-neutral-300 bg-white py-1.5 pl-7 pr-2 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none" />
            </div>
          )}
          {error ? (
            <p className="py-3 text-center text-xs text-red-700">{error}</p>
          ) : loading && rows.length === 0 ? (
            <p className="flex items-center justify-center gap-1.5 py-3 text-xs text-neutral-500"><Loader2 size={12} className="animate-spin" /> Loading…</p>
          ) : tampil.length === 0 ? (
            <p className="py-3 text-center text-xs text-neutral-500">
              {rows.length === 0 ? 'No open transactions on this account in this direction.' : 'No transaction matches your search.'}
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-neutral-100 overflow-y-auto">
              {tampil.map(r => (
                <li key={r.transaction_id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="font-semibold text-neutral-900">{r.tx_number}</span>
                      <span className="text-neutral-500">{fmtTgl(r.tx_date)}{r.days_apart ? ` · ${r.days_apart}d apart` : ''}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600">{r.status}</span>
                    </p>
                    <p className="truncate text-[11px] text-neutral-500">
                      {[r.counterparty, r.category, r.description].filter(Boolean).join(' · ') || '-'}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs tabular-nums ${r.exact_amount ? 'font-semibold text-neutral-900' : 'text-neutral-400 line-through'}`}
                    title={r.exact_amount ? 'Same amount as the bank line' : 'Amount differs from the bank line'}>
                    {rp(r.amount)}
                  </span>
                  <button type="button" onClick={() => link(r)} disabled={busy || !r.exact_amount}
                    title={r.exact_amount ? 'Reconcile the bank line with this transaction' : 'The amount must equal the bank line'}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-neutral-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />} Reconcile
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
