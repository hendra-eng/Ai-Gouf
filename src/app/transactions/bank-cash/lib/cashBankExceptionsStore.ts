'use client';

// Data layer tab Exceptions di Cash & Bank.
//
// DETEKSI dihitung ulang di frontend dari mutasi Bank Feed (database) + invoice
// outstanding, sedangkan tabel financial_transaction_bank_cash_exceptions
// (lewat /api/v1/finance/bank-cash/exceptions) hanya menyimpan status
// PENANGANAN. Keduanya digabung lewat kunci (bank_mutation_ref = id mutasi + exception_type).
//
// Yang dideteksi (mutasi berstatus 'ignored' dilewati):
//   1. Unmatched bank mutation  (mutasi berstatus 'unmatched')
//   2. Amount mismatch          (mutasi 'matched' tapi nominal != nominal transaksinya)
//   3. Duplicate transaction    (mutasi identik -- tanggal, rekening, nominal, keterangan -- lebih dari sekali)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
import { BANK_CASH_EVENT } from '@/lib/bankCashStore';
import { useCashPaymentsFromPurchase } from './usePurchaseCashPayments';
import { useCashReceiptsFromSales } from './useSalesCashReceipts';
import type { CashBankException } from './cashBankMock';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const EXCEPTIONS_URL = `${API_BASE_URL}/api/v1/finance/bank-cash/exceptions`;

// Batas prioritas berdasarkan nominal (rupiah). Ubah di sini kalau perlu.
const BATAS_HIGH = 50_000_000;
const BATAS_MEDIUM = 10_000_000;

// ============================================================
// API
// ============================================================

export interface BackendBankCashException {
  id: string;
  client_id: string | null;
  bank_mutation_ref: string;
  exception_type: string;
  source: 'Reconciliation' | 'Classification';
  priority: 'High' | 'Medium' | 'Low';
  status: 'Open' | 'In Review' | 'Resolved';
  ai_suggestion: string | null;
  source_snippet: Record<string, string | number> | null;
  assigned_to: string | null;
  resolved_at: string | null;
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as T;
}

export async function listBankCashExceptions(clientId: string): Promise<BackendBankCashException[]> {
  const res = await fetch(`${EXCEPTIONS_URL}?client_id=${encodeURIComponent(clientId)}`, { credentials: 'include' });
  return baca<BackendBankCashException[]>(res);
}

export interface UpsertPayload {
  client_id: string;
  bank_mutation_ref: string;
  exception_type: string;
  source: 'Reconciliation' | 'Classification';
  priority?: 'High' | 'Medium' | 'Low';
  status?: 'Open' | 'In Review' | 'Resolved';
  ai_suggestion?: string | null;
  source_snippet?: Record<string, string | number> | null;
  assigned_to?: string | null;
}

export async function upsertBankCashException(payload: UpsertPayload): Promise<BackendBankCashException> {
  const res = await fetch(`${EXCEPTIONS_URL}/upsert`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return baca<BackendBankCashException>(res);
}

// ============================================================
// DETEKSI (murni, tanpa state -- gampang dites)
// ============================================================

export interface Deteksi {
  ref: string;
  tanggal: string;
  tx_no: string;
  counterparty: string;
  exception_type: string;
  source: 'Reconciliation' | 'Classification';
  priority: 'High' | 'Medium' | 'Low';
  ai_suggestion: string;
  source_snippet: Record<string, string | number>;
}

const nominalMutasi = (m: BankFeedMutation) => m.credit || m.debit;

/** Sumber pembanding untuk deteksi: invoice yang masih ada sisa (sisi buku) dan pembayaran hasil pencocokan. */
export interface InvoiceSisa { no: string; pihak: string; sisa: number }
export interface SumberDeteksi {
  /** Purchase (posted) yang masih ada sisa hutang -- pasangan mutasi debet. */
  invoicePurchase: InvoiceSisa[];
  /** Sales (Posted/Partial) yang masih ada sisa piutang -- pasangan mutasi kredit. */
  invoiceSales: InvoiceSisa[];
}

/** Kunci isi mutasi untuk mendeteksi baris identik. */
function kunciIsi(m: BankFeedMutation): string {
  const ket = m.description.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${m.bankCoaId}|${m.date}|${m.debit}|${m.credit}|${ket}`;
}

function prioritas(nominal: number): 'High' | 'Medium' | 'Low' {
  const n = Math.abs(nominal);
  return n >= BATAS_HIGH ? 'High' : n >= BATAS_MEDIUM ? 'Medium' : 'Low';
}

const ringkas = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s || '-');

export function deteksiException(mutations: BankFeedMutation[], sumber: SumberDeteksi): Deteksi[] {
  const hasil: Deteksi[] = [];
  const hitungan = new Map<string, number>();

  // Urut kronologis supaya salinan PERTAMA yang dianggap asli.
  const urut = [...mutations].sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  for (const m of urut) {
    if (m.status === 'ignored') continue;
    const kunci = kunciIsi(m);
    const occ = hitungan.get(kunci) ?? 0;
    hitungan.set(kunci, occ + 1);
    const ref = m.id;
    const noRef = `${m.date} · ${m.bankAccount.split(' - ')[0] || 'Bank'}`;
    const nominal = nominalMutasi(m);
    const rekening = m.bankAccount;

    // 1) Duplicate: salinan ke-2 dst dari mutasi yang identik
    if (occ > 0) {
      hasil.push({
        ref, tanggal: m.date, tx_no: noRef, counterparty: ringkas(m.description),
        exception_type: 'Duplicate transaction', source: 'Reconciliation', priority: 'High',
        ai_suggestion: 'An identical bank line (same date, amount, account and description) appears more than once. If these really are two transactions, leave them; if it was misread, ignore one of them in the Bank Feed tab.',
        source_snippet: { date: m.date, amount: nominal, account: rekening },
      });
    }

    // 2) Unmatched bank mutation
    if (m.status === 'unmatched') {
      // Mutasi kredit (uang masuk) dicari ke invoice Sales, mutasi debet (uang keluar) ke Purchase.
      const kandidat = (m.credit ? sumber.invoiceSales : sumber.invoicePurchase).find((i) => Math.abs(i.sisa - nominal) < 1);
      hasil.push({
        ref, tanggal: m.date, tx_no: noRef, counterparty: ringkas(m.description),
        exception_type: 'Unmatched bank mutation', source: 'Reconciliation', priority: prioritas(nominal),
        ai_suggestion: kandidat
          ? `Matching candidate: invoice ${kandidat.no} (${ringkas(kandidat.pihak)}) — its outstanding equals the line amount. Match it in the Reconciliation tab.`
          : `No outstanding ${m.credit ? 'Sales' : 'Purchase'} invoice with the same amount. Check whether the invoice has been posted. If it is not an invoice settlement (bank charges, interest, inter-bank transfer, capital injection), record it via "Not an invoice settlement?" in the Reconciliation tab, or ignore it in the Bank Feed tab.`,
        source_snippet: { date: m.date, [m.credit ? 'credit' : 'debit']: nominal, account: rekening },
      });
      continue;
    }

    // 3) Amount mismatch: matched, tapi nominal transaksinya beda dari nominal mutasi
    const dibayar = m.transaction?.amount;
    if (dibayar !== undefined) {
      const selisih = nominal - dibayar;
      if (Math.abs(selisih) >= 1) {
        hasil.push({
          ref, tanggal: m.date, tx_no: noRef, counterparty: ringkas(m.description),
          exception_type: 'Amount mismatch', source: 'Reconciliation', priority: prioritas(selisih),
          ai_suggestion: `The bank line amount differs by ${Math.abs(selisih).toLocaleString('en-US')} from the recorded payment total. Check for bank deductions/charges, partial payment, or a wrong match.`,
          source_snippet: { date: m.date, bank_line: nominal, recorded_payment: dibayar, difference: selisih },
        });
      }
    }
  }
  return hasil;
}

// ============================================================
// GABUNG deteksi + status penanganan dari tabel
// ============================================================

export interface CashBankExceptionView extends Omit<CashBankException, 'ai_confidence'> {
  ai_confidence: number | null; // deteksi berbasis aturan, bukan AI -> null
  bank_mutation_ref: string;
  has_row: boolean;
}

export const ME = 'me';

export function gabungkan(detected: Deteksi[], rows: BackendBankCashException[], userId: string | null): CashBankExceptionView[] {
  const rowByKey = new Map(rows.map((r) => [`${r.bank_mutation_ref}|${r.exception_type}`, r]));
  return detected.map((d) => {
    const key = `${d.ref}|${d.exception_type}`;
    const row = rowByKey.get(key);
    return {
      id: key,
      bank_mutation_ref: d.ref,
      has_row: !!row,
      tx_no: d.tx_no,
      counterparty: d.counterparty,
      exception_type: d.exception_type,
      source: d.source,
      priority: row?.priority ?? d.priority,
      status: row?.status ?? 'Open',
      ai_confidence: null,
      ai_suggestion: d.ai_suggestion,
      source_snippet: d.source_snippet,
      assigned_to: row?.assigned_to ? (userId && row.assigned_to === userId ? ME : row.assigned_to) : null,
      resolved_at: row?.resolved_at ?? null,
      created_at: d.tanggal || new Date().toISOString(), // dipakai UI sebagai kolom Tanggal
    };
  });
}

// ============================================================
// HOOK
// ============================================================

export function useCashBankExceptions() {
  const { activeClientId } = useActiveClient();
  const { user } = useAuth();
  const { mutations } = useBankFeed();
  const clientId = activeClientId ? String(activeClientId) : null;
  const userId: string | null = user?.id ? String(user.id) : null;

  // Sumber pembanding: invoice Purchase/Sales yang masih ada sisa (di luar yang sedang diproses).
  const { rows: rowsPurchase } = useCashPaymentsFromPurchase();
  const { rows: rowsSales } = useCashReceiptsFromSales();
  const sumber = useMemo<SumberDeteksi>(() => ({
    invoicePurchase: rowsPurchase.filter((r) => r.outstanding - r.dalamProses > 0).map((r) => ({ no: r.invoiceNumber || r.purchaseId, pihak: r.vendor, sisa: r.outstanding - r.dalamProses })),
    invoiceSales: rowsSales.filter((r) => r.outstanding - r.dalamProses > 0).map((r) => ({ no: r.invoiceNo, pihak: r.customer, sisa: r.outstanding - r.dalamProses })),
  }), [rowsPurchase, rowsSales]);

  const [rows, setRows] = useState<BackendBankCashException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!clientId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    listBankCashExceptions(clientId)
      .then((data) => { setRows(data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load exceptions'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Aksi Cash & Bank di tab lain -> muat ulang status penanganan supaya tab ini tidak basi.
  useEffect(() => {
    window.addEventListener(BANK_CASH_EVENT, refresh);
    return () => window.removeEventListener(BANK_CASH_EVENT, refresh);
  }, [refresh]);

  const detected = useMemo(() => deteksiException(mutations, sumber), [mutations, sumber]);
  const exceptions = useMemo(() => gabungkan(detected, rows, userId), [detected, rows, userId]);

  /** Simpan penanganan (status / assign). Melempar Error kalau gagal -- pemanggil yang menampilkan toast. */
  const simpan = useCallback(
    async (ex: CashBankExceptionView, patch: { status?: 'Open' | 'In Review' | 'Resolved'; assigned_to?: typeof ME | null }) => {
      if (!clientId) throw new Error('Select a company first.');
      const payload: UpsertPayload = {
        client_id: clientId,
        bank_mutation_ref: ex.bank_mutation_ref,
        exception_type: ex.exception_type,
        source: ex.source,
        ai_suggestion: ex.ai_suggestion,
        source_snippet: ex.source_snippet as Record<string, string | number> | null,
      };
      if (!ex.has_row) payload.priority = ex.priority;
      if (patch.status) payload.status = patch.status;
      if ('assigned_to' in patch) {
        if (patch.assigned_to === ME && !userId) throw new Error('User not found.');
        payload.assigned_to = patch.assigned_to === ME ? userId : null;
      }
      await upsertBankCashException(payload);
      refresh();
    },
    [clientId, userId, refresh],
  );

  return { exceptions, loading, error, refresh, simpan };
}