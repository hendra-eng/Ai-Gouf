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
  rekonCatatNonInvoice,
  rekonJurnalPreview,
  rekonAutoCocokkan,
  rekonBatalkan,
  rekonDaftarPembayaran,
  ambilCoaClient,
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
  /** true = jurnal tanpa invoice (biaya admin, bunga, dst); `party` berisi kategorinya. */
  nonInvoice?: boolean;
}

/** Akun COA yang bisa dipilih sebagai akun lawan di mutasi tanpa invoice. */
export interface AkunLawan {
  id: string;
  no_akun: string;
  nama_akun: string;
  kategori?: string | null;
  /** 'bank' / 'kas' / null (dari COA.jenis_kas). */
  jenis_kas?: string | null;
}

export interface BarisLawanInput {
  coaId: string;
  side: 'debit' | 'credit';
  amount: number;
  description?: string;
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
  // Saldo menurut buku = total pembayaran hasil pencocokan (penerimaan - pembayaran) untuk mutasi
  // yang ada di Bank Feed sesi ini. Dihitung dari backend, bukan dari TransactionsContext lama.
  const [saldoBuku, setSaldoBuku] = useState(0);
  const reqId = useRef(0);
  const [akunLawan, setAkunLawan] = useState<AkunLawan[]>([]);
  // Akun bank client (untuk memilih rekening bila tidak bisa ditentukan otomatis dari nama rekening mutasi).
  const akunBank = useMemo(() => akunLawan.filter((a) => a.jenis_kas === 'bank'), [akunLawan]);

  const refById = useMemo(() => refUntukMutasi(mutations), [mutations]);
  // Kunci efek = daftar ref (bukan status), supaya menyamakan status lokal tidak memicu loop.
  const kunci = useMemo(() => mutations.map((m) => refById.get(m.id)).join('|'), [mutations, refById]);

  // Nilai terbaru untuk dipakai di dalam efek/callback tanpa jadi dependency.
  const terbaru = useRef({ mutations, refById, matchMutation, unmatchMutation });
  terbaru.current = { mutations, refById, matchMutation, unmatchMutation };

  const muatUlang = useCallback(() => setVersi((v) => v + 1), []);

  // Daftar akun untuk pemilih akun lawan (jalur tanpa invoice). Dimuat sekali per client.
  useEffect(() => {
    if (!clientId) {
      setAkunLawan([]);
      return;
    }
    let batal = false;
    ambilCoaClient(clientId)
      .then((res: any) => {
        if (batal) return;
        const daftar: any[] = Array.isArray(res) ? res : res?.coa || [];
        setAkunLawan(
          daftar
            .filter((a) => a && a.id && a.aktif !== false)
            .map((a) => ({ id: String(a.id), no_akun: String(a.no_akun ?? ''), nama_akun: String(a.nama_akun ?? ''), kategori: a.kategori ?? null, jenis_kas: a.jenis_kas ? String(a.jenis_kas).toLowerCase() : null }))
            .sort((x, y) => x.no_akun.localeCompare(y.no_akun)),
        );
      })
      .catch(() => {
        if (!batal) setAkunLawan([]);
      });
    return () => {
      batal = true;
    };
  }, [clientId]);

  useEffect(() => {
    const { mutations: daftar, refById: refs } = terbaru.current;
    if (!clientId || daftar.length === 0) {
      setSaran({});
      setPembayaran({});
      setSaldoBuku(0);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    (async () => {
      try {
        const kirim = daftar.slice(0, 1000).map((m) => keMutasiBackend(m, refs.get(m.id) as string));
        const [resSaran, resBayar, resJurnal] = await Promise.all([
          rekonSaran(clientId, kirim),
          rekonDaftarPembayaran(clientId),
          rekonJurnalPreview(clientId).catch(() => []),
        ]);
        if (id !== reqId.current) return; // respons basi (client/data sudah berganti)

        const peta: Record<string, SaranMutasi> = {};
        for (const r of ((resSaran?.results || []) as SaranMutasi[])) peta[r.ref] = r;
        setSaran(peta);

        const bayar: Record<string, PembayaranRingkas> = {};
        const refAktif = new Set<string>(daftar.map((m) => refs.get(m.id) as string));
        let bukuBersih = 0;
        for (const p of ((resBayar || []) as any[])) {
          if (p.deleted_at) continue;
          if (refAktif.has(p.bank_mutation_ref)) {
            const nilai = Number(p.amount) || 0;
            bukuBersih += p.direction === 'cash_receipt' ? nilai : -nilai;
          }
          const b = (bayar[p.bank_mutation_ref] ||= { invoices: [], party: p.party || '', journalNo: p.journal_no || null, journalStatus: p.journal_status || null });
          if (p.invoice_no) b.invoices.push(p.invoice_no);
        }
        // Jurnal tanpa invoice (biaya admin, bunga, dst): masuk ke saldo buku & riwayat Reconciled.
        for (const je of ((resJurnal || []) as any[])) {
          if (!je.non_invoice || !refAktif.has(je.reference)) continue;
          if (je.status !== 'DRAFT' && je.status !== 'APPROVED' && je.status !== 'POSTED') continue;
          if (je.reversal_id) continue;
          const baris: any[] = je.lines || [];
          const bank = baris.find((l) => String(l.jenis_kas ?? '').toLowerCase() === 'bank');
          const masuk = Number(bank?.debit) > 0;
          const nilai = Number(bank?.debit) || Number(bank?.credit) || 0;
          bukuBersih += masuk ? nilai : -nilai;
          bayar[je.reference] = {
            invoices: [],
            party: String(je.description ?? '').split(':')[0].trim(),
            journalNo: je.journal_no || null,
            journalStatus: je.status || null,
            nonInvoice: true,
          };
        }
        setPembayaran(bayar);
        setSaldoBuku(bukuBersih);
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
    async (m: BankFeedMutation, kandidat: SaranKandidat, bankCoaId?: string | null) => {
      if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      const ref = terbaru.current.refById.get(m.id) as string;
      tandaiBusy(m.id, true);
      try {
        await rekonCocokkan(
          clientId,
          keMutasiBackend(m, ref),
          kandidat.allocations.map((a) => ({ invoice_id: a.invoice_id, amount: a.amount })),
          { bankCoaId: bankCoaId || null },
        );
        await terbaru.current.matchMutation(m.id, PENANDA_BACKEND + ref);
        muatUlang();
      } finally {
        tandaiBusy(m.id, false);
      }
    },
    [clientId, muatUlang],
  );

  /** Catat mutasi tanpa invoice sebagai jurnal DRAFT. Melempar Error kalau ditolak backend. */
  const catatNonInvoice = useCallback(
    async (m: BankFeedMutation, kategori: string, baris: BarisLawanInput[], bankCoaId?: string | null) => {
      if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      const ref = terbaru.current.refById.get(m.id) as string;
      tandaiBusy(m.id, true);
      try {
        await rekonCatatNonInvoice(
          clientId,
          keMutasiBackend(m, ref),
          kategori,
          baris.map((b) => ({ coa_id: b.coaId, side: b.side, amount: b.amount, description: b.description || null })),
          { bankCoaId: bankCoaId || null },
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
  const autoCocokkan = useCallback(async (bankCoaId?: string | null) => {
    if (!clientId) throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
    const { mutations: daftar, refById: refs } = terbaru.current;
    const belum = daftar.filter((m) => m.status === 'unmatched').slice(0, 1000);
    if (belum.length === 0) return { matched: 0, unmatched: 0 };
    setAutoRunning(true);
    try {
      const res = await rekonAutoCocokkan(clientId, belum.map((m) => keMutasiBackend(m, refs.get(m.id) as string)), bankCoaId || null);
      muatUlang(); // status lokal disamakan lewat already_matched dari /suggest
      return { matched: (res?.matched || []).length as number, unmatched: (res?.unmatched || []).length as number };
    } finally {
      setAutoRunning(false);
    }
  }, [clientId, muatUlang]);

  return { saran, pembayaran, saldoBuku, refById, loading, error, busy, autoRunning, cocokkan, catatNonInvoice, akunLawan, akunBank, batalkan, autoCocokkan, muatUlang };
}