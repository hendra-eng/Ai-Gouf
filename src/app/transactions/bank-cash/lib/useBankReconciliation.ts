'use client';

// Hook rekonsiliasi Bank Feed <-> invoice Purchase/Sales (backend: bank_reconciliation_v1.py).
//
// Bank Feed hanya hidup di sesi browser, jadi mutasi dikirim inline ke backend dengan `ref`
// STABIL (refUntukMutasi). Backend yang jadi sumber kebenaran status "sudah dicocokkan":
// hasil /suggest menandai already_matched, lalu status lokal mutasi disamakan di sini.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
import { refUntukMutasi } from './cashBankExceptionsStore';
import {
  rekonSaran,
  rekonCocokkan,
  rekonAutoCocokkan,
  rekonBatalkan,
  rekonDaftarPembayaran,
} from '@/app/agent-ai/lib/api';

export interface SaranAlokasi {
  invoice_id: string;
  invoice_no: string | null;
  party: string | null;
  outstanding: number;
  amount: number;
}

export interface SaranKandidat {
  kind: 'single' | 'combo';
  exact: boolean;
  ref_hit: boolean;
  party_ratio: number;
  score: number;
  allocations: SaranAlokasi[];
}

export interface SaranMutasi {
  ref: string;
  direction?: 'cash_payment' | 'cash_receipt';
  amount?: number;
  candidates: SaranKandidat[];
  auto_match: boolean;
  already_matched?: boolean;
  error?: string;
}

export interface PembayaranRingkas {
  invoices: string[];
  party: string;
  journalNo: string | null;
  journalStatus: string | null;
}

/** Penanda di BankFeedMutation.matchedTxId bahwa pencocokannya tersimpan di backend (bukan Transaction lokal). */
export const PENANDA_BACKEND = 'bcp:';

function keMutasiBackend(m: BankFeedMutation, ref: string) {
  return {
    ref,
    date: m.date,
    description: m.description,
    debit: m.debit,
    credit: m.credit,
    bank_account: m.bankAccount || null,
    source_file: m.sourceFile || null,
  };
}

export function useBankReconciliation() {
  const { activeClientId } = useActiveClient();
  const { mutations, matchMutation, unmatchMutation } = useBankFeed();
  const clientId = activeClientId ? String(activeClientId) : null;

  const [saran, setSaran] = useState<Record<string, SaranMutasi>>({});
  const [pembayaran, setPembayaran] = useState<Record<string, PembayaranRingkas>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [versi, setVersi] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const reqId = useRef(0);

  const refById = useMemo(() => refUntukMutasi(mutations), [mutations]);
  // Kunci efek = daftar ref (bukan status), supaya menyamakan status lokal tidak memicu loop.
  const kunci = useMemo(() => mutations.map((m) => refById.get(m.id)).join('|'), [mutations, refById]);

  // Nilai terbaru untuk dipakai di dalam efek/callback tanpa jadi dependency.
  const terbaru = useRef({ mutations, refById, matchMutation, unmatchMutation });
  terbaru.current = { mutations, refById, matchMutation, unmatchMutation };

  const muatUlang = useCallback(() => setVersi((v) => v + 1), []);

  useEffect(() => {
    const { mutations: daftar, refById: refs } = terbaru.current;
    if (!clientId || daftar.length === 0) {
      setSaran({});
      setPembayaran({});
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    (async () => {
      try {
        const kirim = daftar.slice(0, 1000).map((m) => keMutasiBackend(m, refs.get(m.id) as string));
        const [resSaran, resBayar] = await Promise.all([
          rekonSaran(clientId, kirim),
          rekonDaftarPembayaran(clientId),
        ]);
        if (id !== reqId.current) return; // respons basi (client/data sudah berganti)

        const peta: Record<string, SaranMutasi> = {};
        for (const r of ((resSaran?.results || []) as SaranMutasi[])) peta[r.ref] = r;
        setSaran(peta);

        const bayar: Record<string, PembayaranRingkas> = {};
        for (const p of ((resBayar || []) as any[])) {
          if (p.deleted_at) continue;
          const b = (bayar[p.bank_mutation_ref] ||= { invoices: [], party: p.party || '', journalNo: p.journal_no || null, journalStatus: p.journal_status || null });
          if (p.invoice_no) b.invoices.push(p.invoice_no);
        }
        setPembayaran(bayar);
        setError(null);

        // Samakan status lokal dengan backend.
        for (const m of terbaru.current.mutations) {
          const ref = terbaru.current.refById.get(m.id) as string;
          const s = peta[ref];
          if (!s) continue;
          if (s.already_matched && m.status === 'unmatched') {
            void terbaru.current.matchMutation(m.id, PENANDA_BACKEND + ref);
          } else if (!s.already_matched && m.status === 'matched' && (m.matchedTxId || '').startsWith(PENANDA_BACKEND)) {
            void terbaru.current.unmatchMutation(m.id);
          }
        }
      } catch (e: any) {
        if (id !== reqId.current) return;
        setError(e?.message || 'Gagal memuat saran rekonsiliasi dari server.');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    })();
  }, [clientId, kunci, versi]);

  const tandaiBusy = (mutationId: string, aktif: boolean) =>
    setBusy((prev) => {
      const n = new Set(prev);
      if (aktif) n.add(mutationId);
      else n.delete(mutationId);
      return n;
    });

  /** Cocokkan 1 mutasi ke kandidat (1..n invoice). Melempar Error kalau ditolak backend. */
  const cocokkan = useCallback(
    async (m: BankFeedMutation, kandidat: SaranKandidat) => {
      if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      const ref = terbaru.current.refById.get(m.id) as string;
      tandaiBusy(m.id, true);
      try {
        await rekonCocokkan(
          clientId,
          keMutasiBackend(m, ref),
          kandidat.allocations.map((a) => ({ invoice_id: a.invoice_id, amount: a.amount })),
        );
        await terbaru.current.matchMutation(m.id, PENANDA_BACKEND + ref);
        muatUlang();
      } finally {
        tandaiBusy(m.id, false);
      }
    },
    [clientId, muatUlang],
  );

  /** Batalkan pencocokan yang tersimpan di backend. */
  const batalkan = useCallback(
    async (m: BankFeedMutation) => {
      if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      const ref = terbaru.current.refById.get(m.id) as string;
      tandaiBusy(m.id, true);
      try {
        if ((m.matchedTxId || '').startsWith(PENANDA_BACKEND)) {
          await rekonBatalkan(clientId, ref);
        }
        await terbaru.current.unmatchMutation(m.id);
        muatUlang();
      } finally {
        tandaiBusy(m.id, false);
      }
    },
    [clientId, muatUlang],
  );

  /** Auto-match semua mutasi belum cocok yang pasti; sisanya dicatat ke Exceptions oleh backend. */
  const autoCocokkan = useCallback(async () => {
    if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
    const { mutations: daftar, refById: refs } = terbaru.current;
    const belum = daftar.filter((m) => m.status === 'unmatched').slice(0, 1000);
    if (belum.length === 0) return { matched: 0, unmatched: 0 };
    setAutoRunning(true);
    try {
      const res = await rekonAutoCocokkan(clientId, belum.map((m) => keMutasiBackend(m, refs.get(m.id) as string)));
      muatUlang(); // status lokal disamakan lewat already_matched dari /suggest
      return { matched: (res?.matched || []).length as number, unmatched: (res?.unmatched || []).length as number };
    } finally {
      setAutoRunning(false);
    }
  }, [clientId, muatUlang]);

  return { saran, pembayaran, refById, loading, error, busy, autoRunning, cocokkan, batalkan, autoCocokkan, muatUlang };
}