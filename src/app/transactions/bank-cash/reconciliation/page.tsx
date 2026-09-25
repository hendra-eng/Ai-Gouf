'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LinkIcon, XMarkIcon } from '@heroicons/react/24/outline';
import CashBankTabs from '../components/CashBankTabs';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR, uniqueJournalTotal } from '../../lib/groupAnalytics';
import { useTransactions } from '../../context/TransactionsContext';
import { Transaction } from '../../components/transactionData';
import { useBankFeed, BankFeedMutation } from '../context/BankFeedContext';

// [BARU] Ringkasan Saldo Menurut Bank vs Menurut Buku — pola & istilah
// disamakan dengan proses_file_rekonsiliasi_bank() di backend
// (akuntansi_ai.py). Dihitung dari mutasi Bank Feed REAL (sudah tersambung
// backend, lihat BankFeedContext.tsx) vs total Cash Payment/Receipt REAL.
function ReconciliationSummary({
  saldoBank,
  saldoBuku,
}: {
  saldoBank: number;
  saldoBuku: number;
}) {
  const selisih = saldoBank - saldoBuku;
  const balance = Math.abs(selisih) < 1;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div className="card-elevated-md rounded-xl p-5">
        <p className="text-xs text-muted-foreground mb-1">Saldo Menurut Bank</p>
        <p className="text-xl font-bold text-foreground font-mono">{formatIDR(saldoBank)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">Dari mutasi Bank Feed</p>
      </div>
      <div className="card-elevated-md rounded-xl p-5">
        <p className="text-xs text-muted-foreground mb-1">Saldo Menurut Buku</p>
        <p className="text-xl font-bold text-foreground font-mono">{formatIDR(saldoBuku)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">Dari Cash Payment + Cash Receipt</p>
      </div>
      <div className={`rounded-xl p-5 border ${balance ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <p className={`text-xs mb-1 ${balance ? 'text-emerald-700' : 'text-amber-700'}`}>Selisih</p>
        <p className={`text-xl font-bold font-mono ${balance ? 'text-emerald-700' : 'text-amber-700'}`}>{formatIDR(selisih)}</p>
        <p className={`text-[11px] mt-1 ${balance ? 'text-emerald-600' : 'text-amber-600'}`}>
          {balance ? 'BALANCE' : 'Ada selisih — cek mutasi yang belum dicocokkan di bawah'}
        </p>
      </div>
    </div>
  );
}

// Kandidat match otomatis: tanggal sama + nominal sama.
function findAutoCandidate(mutation: BankFeedMutation, txs: Transaction[]): Transaction | null {
  const nominalMutasi = mutation.credit || mutation.debit;
  return (
    txs.find((tx) => tx.date === mutation.date && Math.abs((tx.debit || tx.credit) - nominalMutasi) < 1) || null
  );
}

export default function ReconciliationPage() {
  const { getByGroup } = useTransactions();
  const { mutations, loading, error, refetch, matchMutation, unmatchMutation, pendingIds } = useBankFeed();
  const [tab, setTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');

  const paymentTx = getByGroup('cash_payment');
  const receiptTx = getByGroup('cash_receipt');
  const systemTx = useMemo(() => [...paymentTx, ...receiptTx], [paymentTx, receiptTx]);

  const saldoBank = mutations.length > 0 ? mutations[0].balanceAfter : 0;
  const saldoBuku = uniqueJournalTotal(receiptTx) - uniqueJournalTotal(paymentTx);

  const unmatchedMutations = useMemo(() => mutations.filter((m) => m.status === 'unmatched'), [mutations]);
  const matchedMutations = useMemo(() => mutations.filter((m) => m.status === 'matched'), [mutations]);

  // Transaksi sistem yang belum ada mutasi Bank Feed yang match-nya.
  const matchedTxIds = useMemo(() => new Set(mutations.filter((m) => m.matchedTxId).map((m) => m.matchedTxId)), [mutations]);
  const unmatchedSystemTx = useMemo(() => systemTx.filter((tx) => !matchedTxIds.has(tx.id)), [systemTx, matchedTxIds]);

  const [selectedMutation, setSelectedMutation] = useState<string | null>(null);

  const handleMatch = async (mutationId: string, tx: Transaction) => {
    try {
      await matchMutation(mutationId, tx.id);
      setSelectedMutation(null);
      toast.success(`Dicocokkan dengan ${tx.description || tx.txId}`);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mencocokkan mutasi.');
    }
  };

  const handleUnmatch = async (mutationId: string) => {
    try {
      await unmatchMutation(mutationId);
      toast.success('Pencocokan dibatalkan.');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal membatalkan pencocokan.');
    }
  };

  return (
    <div className="p-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refetch} className="font-semibold underline hover:no-underline shrink-0">Coba lagi</button>
        </div>
      )}

      <ReconciliationSummary saldoBank={saldoBank} saldoBuku={saldoBuku} />

      <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border w-fit mb-4">
        {(['unreconciled', 'reconciled'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              tab === t ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'unreconciled' ? `Unreconciled (${unmatchedMutations.length})` : `Reconciled (${matchedMutations.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-12 text-center">Memuat data rekonsiliasi...</p>
      ) : tab === 'unreconciled' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Kolom kiri — mutasi Bank Feed belum cocok */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Bank Feed — Belum Dicocokkan</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Klik satu baris, lalu pilih pasangannya di kolom kanan</p>
            </div>
            {unmatchedMutations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Tidak ada mutasi Bank Feed yang menunggu.</p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {unmatchedMutations.map((m) => {
                  const auto = findAutoCandidate(m, unmatchedSystemTx);
                  const selected = selectedMutation === m.id;
                  const busy = pendingIds.has(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => !busy && setSelectedMutation(selected ? null : m.id)}
                      className={`px-4 py-3 transition-colors ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer'} ${selected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{m.description}</p>
                          <p className="text-[11px] text-muted-foreground">{m.date} · {m.bankAccount}</p>
                        </div>
                        <span className={`text-xs font-mono font-semibold whitespace-nowrap ${m.credit ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatIDR(m.credit || m.debit, true)}
                        </span>
                      </div>
                      {auto && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                          <span className="text-[11px] text-emerald-700 truncate">Kandidat: {auto.description || auto.txId}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMatch(m.id, auto); }}
                            disabled={busy}
                            className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                          >
                            <LinkIcon className="w-3 h-3" /> Cocokkan
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Kolom kanan — transaksi sistem (Cash Payment/Receipt) belum cocok */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Cash Payment/Receipt — Belum Dicocokkan</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedMutation ? 'Pilih transaksi yang sesuai dengan mutasi terpilih' : 'Pilih dulu satu mutasi di kolom kiri'}
              </p>
            </div>
            {unmatchedSystemTx.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Tidak ada transaksi sistem yang menunggu.</p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {unmatchedSystemTx.map((tx) => {
                  const busy = selectedMutation ? pendingIds.has(selectedMutation) : false;
                  return (
                    <div
                      key={tx.id}
                      onClick={() => selectedMutation && !busy && handleMatch(selectedMutation, tx)}
                      className={`px-4 py-3 flex items-center justify-between gap-2 transition-colors ${
                        selectedMutation ? (busy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-primary/5') : 'opacity-70'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{tx.description}</p>
                        <p className="text-[11px] text-muted-foreground">{tx.date} · {tx.voucherNo}</p>
                      </div>
                      <span className={`text-xs font-mono font-semibold whitespace-nowrap ${tx.debit ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {formatIDR(tx.debit || tx.credit, true)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card-elevated-md rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-bold text-foreground">Riwayat Reconciled</h2>
          </div>
          {matchedMutations.length === 0 ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada mutasi yang dicocokkan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Tanggal', 'Mutasi Bank Feed', 'Dicocokkan Dengan', 'Nominal', 'Status', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchedMutations.map((m) => {
                    const tx = systemTx.find((t) => t.id === m.matchedTxId);
                    const busy = pendingIds.has(m.id);
                    return (
                      <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.date}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{m.description}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{tx?.description || '—'}</td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-right whitespace-nowrap">{formatIDR(m.credit || m.debit, true)}</td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge label="Reconciled" variant="positive" /></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleUnmatch(m.id)}
                            disabled={busy}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Batalkan pencocokan"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}