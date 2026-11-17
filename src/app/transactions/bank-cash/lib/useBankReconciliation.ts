'use client';

// Hook tab Reconciliation: mutasi Bank Feed (database) <-> invoice Sales/Purchase
// atau akun bebas, lewat /api/v1/transactions/bank-cash/mutations/...
// (backend modules/transactions/bank_cash_v1.py). Hasil pencocokan = transaksi
// Cash & Bank DRAFT yang lanjut Approve -> Post di tab Journal Preview.

import { useCallback, useMemo, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { saveAccountMapping } from '@/lib/settingsStore';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
import {
  applyBcAdjustments,
  autoMatchMutations,
  createBcAutoRule,
  deleteBcAutoRule,
  updateBcAutoRule,
  updateBcAutoSettings,
  isAdjustCandidate,
  matchMutationToAccounts,
  matchMutationToInvoices,
  pairTransferMutation,
  transferMutation,
  unmatchMutation,
  useBcPendingTransfers,
  updateBcAdjustmentSettings,
  BC_AUTO_SETTINGS_DEFAULT,
  useBcAccounts,
  useBcAdjustmentSettings,
  useBcAutoRules,
  useBcAutoRuleSuggestions,
  useBcAutoSettings,
  useBcRuleMatches,
  useBcSuggestions,
  useBcTransactions,
  type BcAdjustmentInput,
  type BcAdjustmentSettings,
  type BcAdjustmentSummary,
  type BcApplyAdjustmentItem,
  type BcAutoRuleInput,
  type BcAutoSettings,
  type BcRuleMatch,
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
  /** Selisih kecil yang ditutup lewat adjustment saat match (null = tidak ada). */
  adjustment?: BcAdjustmentSummary | null;
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
  const adj = useBcAdjustmentSettings(clientId);
  const ar = useBcAutoRules(clientId);
  const rm = useBcRuleMatches(clientId);
  const rs = useBcAutoRuleSuggestions(clientId);
  const au = useBcAutoSettings(clientId);
  const pt = useBcPendingTransfers(clientId);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [autoRunning, setAutoRunning] = useState(false);
  const [applying, setApplying] = useState(false);

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
        adjustment: t.adjustment ?? null,
      };
    }
    return peta;
  }, [tx.transactions]);

  /** Kandidat selisih kecil teratas per mutasi (hanya yang memang butuh adjustment). */
  const saranSelisih = useMemo(() => {
    const peta: Record<string, SaranKandidat> = {};
    for (const s of sg.suggestions) {
      if (s.auto_match) continue; // pas persis: tidak perlu adjustment
      const c = s.candidates.find(isAdjustCandidate);
      if (c) peta[s.mutation_id] = c;
    }
    return peta;
  }, [sg.suggestions]);

  /** Mutasi unmatched -> aturan otomatis yang akan mencatatnya saat Auto-match jalan. */
  const aturanPerMutasi = useMemo(() => {
    const peta: Record<string, BcRuleMatch> = {};
    for (const r of rm.ruleMatches) peta[r.mutation_id] = r;
    return peta;
  }, [rm.ruleMatches]);

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
    adj.refresh();
    ar.refresh();
    rm.refresh();
    au.refresh();
    rs.refresh();
  }, [refetch, sg.refresh, tx.refresh, adj.refresh, ar.refresh, rm.refresh, au.refresh, rs.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Cocokkan 1 mutasi ke kandidat (1..n invoice). Melempar Error kalau ditolak backend.
   * `adjustment` = izin menutup selisih kecil (kategori/akun/catatan); nominalnya dihitung server.
   * Tanpa `adjustment`, total alokasi harus sama dengan nominal mutasi (perilaku lama).
   */
  const cocokkan = useCallback(async (m: BankFeedMutation, kandidat: SaranKandidat, adjustment?: BcAdjustmentInput | null) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => matchMutationToInvoices(
      cid, m.id, kandidat.allocations.map(a => ({ type: a.type, invoice_id: a.invoice_id, amount: a.amount })),
      null, adjustment ?? null,
    ));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Terapkan saran selisih kecil ke banyak mutasi sekaligus (server memilih saran teratas). */
  const terapkanSelisih = useCallback(async (mutationIds: string[]) => {
    const cid = wajibKlien();
    const items: BcApplyAdjustmentItem[] = mutationIds.map(id => ({ mutation_id: id }));
    setApplying(true);
    try {
      const { data } = await applyBcAdjustments(cid, items);
      return data;
    } finally {
      setApplying(false);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ubah batas & on/off adjustment (Level 5+). Melempar Error kalau ditolak. */
  const simpanPengaturanAdjustment = useCallback(async (
    enabled: boolean, limit: number, akun?: Record<string, string | null>,
  ): Promise<BcAdjustmentSettings> => {
    const cid = wajibKlien();
    // Akun adjustment disimpan lewat Account Mapping (sumber yang sama dengan Settings), jadi dua tempat itu selalu sinkron.
    if (akun && Object.keys(akun).length) await saveAccountMapping(cid, akun);
    const { data } = await updateBcAdjustmentSettings(cid, { enabled, limit });
    adj.refresh();
    sg.refresh();
    return data;
  }, [clientId, adj.refresh, sg.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Catat mutasi tanpa invoice (akun lawan bebas) sebagai transaksi DRAFT. */
  const catatNonInvoice = useCallback(async (m: BankFeedMutation, kategori: string, baris: BarisLawanInput[]) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => matchMutationToAccounts(cid, m.id, {
      category: kategori,
      lines: baris.map(b => ({ type: 'account', coa_id: b.coaId, side: b.side, amount: b.amount, description: b.description || null })),
    }));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Transfer antar akun bank: mutasi ini ke/dari `akunLainId`; mutasi lawan yang cocok ikut tertaut otomatis. */
  const transfer = useCallback(async (m: BankFeedMutation, akunLainId: string) => {
    const cid = wajibKlien();
    return denganBusy(m.id, async () => (await transferMutation(cid, m.id, akunLainId)).data);
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tautkan mutasi ke transfer yang sudah dicatat dari akun lawannya (tanpa jurnal baru). */
  const pasangkanTransfer = useCallback(async (m: BankFeedMutation, transactionId: string) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => pairTransferMutation(cid, m.id, transactionId));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Batalkan pencocokan (transaksi draft/approved dihapus, mutasi kembali unmatched). */
  const batalkan = useCallback(async (m: BankFeedMutation) => {
    const cid = wajibKlien();
    await denganBusy(m.id, () => unmatchMutation(cid, m.id));
  }, [clientId, denganBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Simpan aturan otomatis baru / ubah yang ada (id diisi = ubah). Melempar Error kalau ditolak backend. */
  const simpanAturan = useCallback(async (input: BcAutoRuleInput, id?: string) => {
    const cid = wajibKlien();
    const { data } = id ? await updateBcAutoRule(cid, id, input) : await createBcAutoRule(cid, input);
    return data;
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hapusAturan = useCallback(async (id: string) => {
    await deleteBcAutoRule(wajibKlien(), id);
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Nyalakan/matikan auto-match setelah upload (Level 5+). */
  const simpanAutoSetelahUpload = useCallback(async (aktif: boolean) => {
    await updateBcAutoSettings(wajibKlien(), { auto_match_on_upload: aktif });
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ubah pengaturan auto-match (on/off per jenis, auto-approve invoice, baris confidence rendah). Level 5+. */
  const simpanAutoSettings = useCallback(async (patch: Partial<BcAutoSettings>) => {
    await updateBcAutoSettings(wajibKlien(), patch);
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cocokkan otomatis mutasi yang kandidat invoicenya pasti (opsional: hanya satu akun bank). */
  const autoCocokkan = useCallback(async (bankCoaId?: string | null) => {
    const cid = wajibKlien();
    setAutoRunning(true);
    try {
      const { data } = await autoMatchMutations(cid, bankCoaId);
      return {
        matched: data.matched.length, ruleMatched: data.rule_matched.length, unmatched: data.skipped,
        autoApproved: data.auto_approved ?? 0,
        lowSkipped: data.low_confidence_skipped ?? 0,
        lowMatched: data.low_confidence_matched ?? 0,
        skippedBySetting: data.skipped_by_setting ?? 0,
      };
    } finally {
      setAutoRunning(false);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    mutations,
    saran,
    saranSelisih,
    pengaturanAdjustment: adj.settings,
    aturan: ar.rules,
    saranAturan: rs.suggestions,
    aturanPerMutasi,
    autoSetelahUpload: au.settings?.auto_match_on_upload ?? false,
    autoSettings: au.settings ?? BC_AUTO_SETTINGS_DEFAULT,
    simpanAutoSettings,
    simpanAturan,
    hapusAturan,
    simpanAutoSetelahUpload,
    applying,
    terapkanSelisih,
    simpanPengaturanAdjustment,
    pembayaran,
    loading: loadingFeed || sg.loading,
    error: errorFeed || sg.error || tx.error,
    busy,
    autoRunning,
    cocokkan,
    catatNonInvoice,
    transfer,
    pasangkanTransfer,
    transferMenunggu: pt.pending,
    akunLawan,
    batalkan,
    autoCocokkan,
    muatUlang,
  };
}