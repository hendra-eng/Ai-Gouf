'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LinkIcon, XMarkIcon, BoltIcon } from '@heroicons/react/24/outline';
import CashBankTabs from '../components/CashBankTabs';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR, uniqueJournalTotal } from '../../lib/groupAnalytics';
import { useTransactions } from '../../context/TransactionsContext';
import { useBankFeed } from '../context/BankFeedContext';
import { useBankReconciliation, type SaranKandidat } from '../lib/useBankReconciliation';

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

// [DIUBAH] Pencocokan sekarang ke INVOICE Purchase (mutasi debet) dan Sales (mutasi kredit)
// yang masih outstanding -- sumber yang sama dengan tab Cash Payment/Receipt -- lewat backend
// /api/v1/finance/bank-reconciliation. Kalau matched: pembayaran tercatat (saldo invoice
// diperbarui trigger DB) dan jurnal Kas vs Hutang/Piutang terbentuk (DRAFT). Yang belum
// cocok dicatat di tab Exceptions. Sebelumnya: cocok lokal berdasarkan tanggal + nominal.

const namaKandidat = (k: SaranKandidat) =>
  k.allocations.map((a) => a.invoice_no || a.invoice_id.slice(0, 8)).join(' + ');

const pihakKandidat = (k: SaranKandidat) =>
  Array.from(new Set(k.allocations.map((a) => a.party).filter(Boolean))).join(', ') || '-';

export default function ReconciliationPage() {
  const { getByGroup } = useTransactions();
  const { mutations } = useBankFeed();
  const {
    saran, pembayaran, refById, loading, error, busy, autoRunning,
    cocokkan, batalkan, autoCocokkan, muatUlang,
  } = useBankReconciliation();
  const [tab, setTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');
  const [selectedMutation, setSelectedMutation] = useState<string | null>(null);

  const paymentTx = getByGroup('cash_payment');
  const receiptTx = getByGroup('cash_receipt');

  const saldoBank = mutations.length > 0 ? mutations[0].balanceAfter : 0;
  const saldoBuku = uniqueJournalTotal(receiptTx) - uniqueJournalTotal(paymentTx);

  const unmatchedMutations = useMemo(() => mutations.filter((m) => m.status === 'unmatched'), [mutations]);
  const matchedMutations = useMemo(() => mutations.filter((m) => m.status === 'matched'), [mutations]);

  const mutasiTerpilih = useMemo(
    () => unmatchedMutations.find((m) => m.id === selectedMutation) || null,
    [unmatchedMutations, selectedMutation],
  );
  const saranTerpilih = mutasiTerpilih ? saran[refById.get(mutasiTerpilih.id) || ''] : undefined;

  const handleMatch = async (mutationId: string, kandidat: SaranKandidat) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await cocokkan(m, kandidat);
      setSelectedMutation(null);
      toast.success(`Dicocokkan dengan ${namaKandidat(kandidat)}. Jurnal berstatus DRAFT.`);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mencocokkan mutasi.');
    }
  };

  const handleUnmatch = async (mutationId: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await batalkan(m);
      toast.success('Pencocokan dibatalkan.');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal membatalkan pencocokan.');
    }
  };

  const handleAuto = async () => {
    try {
      const r = await autoCocokkan();
      toast.success(`${r.matched} mutasi dicocokkan, ${r.unmatched} belum cocok (dicatat di Exceptions).`);
    } catch (e: any) {
      toast.error(e?.message || 'Auto-match gagal.');
    }
  };

  return (
    <div className="p-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={muatUlang} className="font-semibold underline hover:no-underline shrink-0">Coba lagi</button>
        </div>
      )}

      <ReconciliationSummary saldoBank={saldoBank} saldoBuku={saldoBuku} />

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border w-fit">
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
        {tab === 'unreconciled' && (
          <button
            onClick={handleAuto}
            disabled={autoRunning || loading || unmatchedMutations.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            title="Cocokkan otomatis mutasi yang pasti (nominal pas + nomor invoice/nama pihak, tanpa pesaing). Sisanya dicatat di Exceptions."
          >
            <BoltIcon className="w-3.5 h-3.5" />
            {autoRunning ? 'Mencocokkan…' : 'Auto-match'}
          </button>
        )}
      </div>

      {loading && mutations.length === 0 ? (
        <p className="text-xs text-muted-foreground py-12 text-center">Memuat data rekonsiliasi...</p>
      ) : tab === 'unreconciled' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Kolom kiri — mutasi Bank Feed belum cocok */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Bank Feed — Belum Dicocokkan</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Klik satu baris, lalu pilih invoice pasangannya di kolom kanan</p>
            </div>
            {unmatchedMutations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Tidak ada mutasi Bank Feed yang menunggu.</p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {unmatchedMutations.map((m) => {
                  const s = saran[refById.get(m.id) || ''];
                  const auto = s?.auto_match ? s.candidates[0] : null;
                  const selected = selectedMutation === m.id;
                  const isBusy = busy.has(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => !isBusy && setSelectedMutation(selected ? null : m.id)}
                      className={`px-4 py-3 transition-colors ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'} ${selected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{m.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {m.date} · {m.bankAccount} · {m.credit ? 'Masuk (Sales)' : 'Keluar (Purchase)'}
                          </p>
                        </div>
                        <span className={`text-xs font-mono font-semibold whitespace-nowrap ${m.credit ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatIDR(m.credit || m.debit, true)}
                        </span>
                      </div>
                      {auto && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                          <span className="text-[11px] text-emerald-700 truncate">Kandidat: {namaKandidat(auto)} · {pihakKandidat(auto)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMatch(m.id, auto); }}
                            disabled={isBusy}
                            className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                          >
                            <LinkIcon className="w-3 h-3" /> Cocokkan
                          </button>
                        </div>
                      )}
                      {s?.error && <p className="mt-1.5 text-[11px] text-amber-700">{s.error}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Kolom kanan — invoice outstanding yang cocok untuk mutasi terpilih */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Invoice Outstanding — Kandidat</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {mutasiTerpilih
                  ? mutasiTerpilih.credit
                    ? 'Invoice Sales yang masih ada sisa tagihan'
                    : 'Invoice Purchase (status posted) yang masih ada sisa tagihan'
                  : 'Pilih dulu satu mutasi di kolom kiri'}
              </p>
            </div>
            {!mutasiTerpilih ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Belum ada mutasi yang dipilih.</p>
            ) : !saranTerpilih ? (
              <p className="text-xs text-muted-foreground py-10 text-center">{loading ? 'Mencari kandidat…' : 'Saran belum tersedia.'}</p>
            ) : saranTerpilih.candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 px-6 text-center">
                Tidak ada invoice yang cocok dengan nominal/nama pihak mutasi ini. Pastikan invoicenya sudah berstatus
                posted dan masih ada sisa tagihan; mutasi ini akan tercatat di tab Exceptions.
              </p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {saranTerpilih.candidates.map((k, i) => {
                  const isBusy = busy.has(mutasiTerpilih.id);
                  return (
                    <div
                      key={`${namaKandidat(k)}-${i}`}
                      onClick={() => !isBusy && handleMatch(mutasiTerpilih.id, k)}
                      className={`px-4 py-3 flex items-center justify-between gap-2 transition-colors ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-primary/5'}`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {namaKandidat(k)}{k.kind === 'combo' ? ' (gabungan invoice)' : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {pihakKandidat(k)} · skor {Math.round(k.score * 100)}%
                          {k.exact ? ' · nominal pas' : ' · bayar sebagian'}
                          {k.ref_hit ? ' · no. invoice ada di keterangan' : ''}
                        </p>
                      </div>
                      <span className="text-xs font-mono font-semibold whitespace-nowrap text-foreground">
                        {formatIDR(k.allocations.reduce((n, a) => n + a.amount, 0), true)}
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
                    {['Tanggal', 'Mutasi Bank Feed', 'Dicocokkan Dengan', 'Nominal', 'Jurnal', 'Status', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchedMutations.map((m) => {
                    const p = pembayaran[refById.get(m.id) || ''];
                    const isBusy = busy.has(m.id);
                    return (
                      <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.date}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{m.description}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[220px] truncate">
                          {p ? `${p.invoices.join(', ') || '—'}${p.party ? ` · ${p.party}` : ''}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-right whitespace-nowrap">{formatIDR(m.credit || m.debit, true)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {p?.journalNo ? `${p.journalNo}${p.journalStatus ? ` (${p.journalStatus})` : ''}` : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge label="Reconciled" variant="positive" /></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleUnmatch(m.id)}
                            disabled={isBusy}
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