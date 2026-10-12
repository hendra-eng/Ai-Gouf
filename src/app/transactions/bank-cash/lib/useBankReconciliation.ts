'use client';

// Hook tab Reconciliation: mutasi Bank Feed (database) <-> invoice Sales/Purchase
// atau akun bebas, lewat /api/v1/transactions/bank-cash/mutations/...
// (backend modules/transactions/bank_cash_v1.py). Hasil pencocokan = transaksi
// Cash & Bank DRAFT yang lanjut Approve -> Post di tab Journal Preview.

import { useCallback, useMemo, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
import {
  autoMatchMutations,
  matchMutationToAccounts,
  matchMutationToInvoices,
  unmatchMutation,
  useBcAccounts,
  useBcSuggestions,
  useBcTransactions,
  type BcCandidate,
  type BcSuggestion,
} from '@/lib/bankCashStore';

export type SaranKandidat = BcCandidate;
export type SaranMutasi = BcSuggestion;

export interface PembayaranRingkas {
  invoices: string[];
  party: string;
  journalNo: string | null;
  journalStatus: string | null;
  /** true = transaksi tanpa invoice (biaya admin, bunga, dst); `party` berisi kategorinya. */
  nonInvoice?: boolean;
}

/** Akun COA yang bisa dipilih sebagai akun lawan di mutasi tanpa invoice. */
export interface AkunLawan {
  id: string;
  no_akun: string;
  nama_akun: string;
  kategori?: string | null;
  /** 'bank' / 'cash_on_hand' / 'petty_cash' / 'transit' / null. */
  jenis_kas?: string | null;
}

export interface BarisLawanInput {
  coaId: string;
  side: 'debit' | 'credit';
  amount: number;
  description?: string;
}

export function useBankReconciliation() {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { mutations, loading: loadingFeed, error: errorFeed, refetch } = useBankFeed();
  const sg = useBcSuggestions(clientId);
  const tx = useBcTransactions(clientId, { status: ['draft', 'approved', 'posted'] });
  const { accounts } = useBcAccounts(clientId);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [autoRunning, setAutoRunning] = useState(false);

  const saran = useMemo(() => {
    const peta: Record<string, SaranMutasi> = {};
    for (const s of sg.suggestions) peta[s.mutation_id] = s;
    return peta;
  }, [sg.suggestions]);

  // Ringkasan transaksi per mutasi (riwayat Reconciled).
  const pembayaran = useMemo(() => {
    const peta: Record<string, PembayaranRingkas> = {};
    for (const t of tx.transactions) {
      if (!t.mutation) continue;
      const inv = t.lines.filter(l => l.line_type !== 'account');
      peta[t.mutation.id] = {
        invoices: inv.map(l => l.invoice_no || '').filter(Boolean),
        party: inv.length ? (t.counterparty || '') : (t.category || ''),
        journalNo: t.tx_number,
        journalStatus: t.status.toUpperCase(),
        nonInvoice: t.kind === 'non_invoice',
      };
    }
    return peta;
  }, [tx.transactions]);

  const akunLawan = useMemo<AkunLawan[]>(
    () => accounts.filter(a => a.is_active).map(a => ({
      id: a.id, no_akun: a.code, nama_akun: a.name, kategori: a.classification, jenis_kas: a.cash_type,
    })),
    [accounts],
  );

  const muatUlang = useCallback(() => {
    refetch();
    sg.refresh();
    tx.refresh();
  }, [refetch, sg.refresh, tx.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const denganBusy = useCallback(async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    setBusy(prev => new Set(prev).add(id));
    try {
      return await fn();
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  const wajibKlien = () => {
    if (!clientId) throw new Error('No active company — select one in the top bar first.');
    return clientId;
  };

  /** Cocokkan 1 mutasi ke kandidat (1..n invoice). Melempar Error kalau ditolak backend. */
  const cocokkan = useCallback(async (m: BankFeedMutation, kandidat: SaranKandidat) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => matchMutationToInvoices(
      cid, m.id, kandidat.allocations.map(a => ({ type: a.type, invoice_id: a.invoice_id, amount: a.amount })),
    ));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Catat mutasi tanpa invoice (akun lawan bebas) sebagai transaksi DRAFT. */
  const catatNonInvoice = useCallback(async (m: BankFeedMutation, kategori: string, baris: BarisLawanInput[]) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => matchMutationToAccounts(cid, m.id, {
      category: kategori,
      lines: baris.map(b => ({ type: 'account', coa_id: b.coaId, side: b.side, amount: b.amount, description: b.description || null })),
    }));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Batalkan pencocokan (transaksi draft/approved dihapus, mutasi kembali unmatched). */
  const batalkan = useCallback(async (m: BankFeedMutation) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => unmatchMutation(cid, m.id));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cocokkan otomatis semua mutasi yang kandidat invoicenya pasti. */
  const autoCocokkan = useCallback(async () => {
    const cid = wajibKlien();
    setAutoRunning(true);
    try {
      const { data } = await autoMatchMutations(cid);
      return { matched: data.matched.length, unmatched: data.skipped };
    } finally {
      setAutoRunning(false);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    mutations,
    saran,
    pembayaran,
    loading: loadingFeed || sg.loading,
    error: errorFeed || sg.error || tx.error,
    busy,
    autoRunning,
    cocokkan,
    catatNonInvoice,
    akunLawan,
    batalkan,
    autoCocokkan,
    muatUlang,
  };
}
