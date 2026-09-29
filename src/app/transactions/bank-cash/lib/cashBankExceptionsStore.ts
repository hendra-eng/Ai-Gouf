'use client';

// Data layer tab Exceptions di Cash & Bank -- menggantikan MOCK_CASH_BANK_EXCEPTIONS.
//
// Pola sesuai rancangan: DETEKSI dihitung ulang di frontend dari Bank Feed +
// Reconciliation (Bank Feed hanya hidup di sesi browser, jadi backend tidak
// punya datanya), sedangkan tabel financial_transaction_bank_cash_exceptions
// (lewat /api/v1/finance/bank-cash/exceptions) hanya menyimpan status
// PENANGANAN. Keduanya digabung lewat kunci (bank_mutation_ref + exception_type).
//
// Tahap 1 -- yang dideteksi:
//   1. Unmatched bank mutation  (mutasi Bank Feed berstatus 'unmatched')
//   2. Amount mismatch          (mutasi 'matched' tapi nominal != transaksi sistem)
//   3. Duplicate transaction    (mutasi identik muncul lebih dari sekali)
// Belum: Missing counter account & Unbalanced journal (source 'Classification').

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { useTransactions } from '../../context/TransactionsContext';
import type { Transaction } from '../../components/transactionData';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
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
const nominalTx = (tx: Transaction) => tx.debit || tx.credit;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Referensi STABIL untuk satu mutasi: sama walau rekening koran di-upload ulang
 *  (id mutasi di sesi berubah tiap upload, jadi tidak bisa dipakai sebagai kunci). */
function refDasar(m: BankFeedMutation): string {
  const ket = m.description.trim().toLowerCase().replace(/\s+/g, ' ');
  return `MUT-${m.date.replace(/-/g, '')}-${hash(`${m.bankAccount}|${m.date}|${m.debit}|${m.credit}|${ket}`)}`;
}

/** Ref STABIL per mutasi (id sesi -> ref), dengan akhiran #n untuk mutasi identik ke-2 dst.
 *  Logikanya SAMA dengan deteksiException(), supaya ref di Reconciliation dan Exceptions selalu cocok. */
export function refUntukMutasi(mutations: BankFeedMutation[]): Map<string, string> {
  const hitungan = new Map<string, number>();
  const hasil = new Map<string, string>();
  for (const m of mutations) {
    const dasar = refDasar(m);
    const occ = hitungan.get(dasar) ?? 0;
    hitungan.set(dasar, occ + 1);
    hasil.set(m.id, occ > 0 ? `${dasar}#${occ}` : dasar);
  }
  return hasil;
}

function prioritas(nominal: number): 'High' | 'Medium' | 'Low' {
  const n = Math.abs(nominal);
  return n >= BATAS_HIGH ? 'High' : n >= BATAS_MEDIUM ? 'Medium' : 'Low';
}

const ringkas = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s || '-');

export function deteksiException(mutations: BankFeedMutation[], systemTx: Transaction[]): Deteksi[] {
  const hasil: Deteksi[] = [];
  const txById = new Map(systemTx.map((tx) => [tx.id, tx]));
  const sudahDicocokkan = new Set(mutations.filter((m) => m.matchedTxId).map((m) => m.matchedTxId));
  const txBebas = systemTx.filter((tx) => !sudahDicocokkan.has(tx.id));
  const hitungan = new Map<string, number>();

  for (const m of mutations) {
    const dasar = refDasar(m);
    const occ = hitungan.get(dasar) ?? 0;
    hitungan.set(dasar, occ + 1);
    const ref = occ > 0 ? `${dasar}#${occ}` : dasar;
    const nominal = nominalMutasi(m);
    const rekening = m.bankAccount;

    // 1) Duplicate: salinan ke-2 dst dari mutasi yang identik
    if (occ > 0) {
      hasil.push({
        ref, tanggal: m.date, tx_no: ref, counterparty: ringkas(m.description),
        exception_type: 'Duplicate transaction', source: 'Reconciliation', priority: 'High',
        ai_suggestion: 'Ada mutasi identik (tanggal, nominal, rekening, keterangan sama) lebih dari sekali. Cek apakah rekening koran terunggah dua kali atau memang ada dua transaksi.',
        source_snippet: { tanggal: m.date, nominal, rekening },
      });
    }

    // 2) Unmatched bank mutation
    if (m.status === 'unmatched') {
      const kandidat = txBebas.find((tx) => tx.date === m.date && Math.abs(nominalTx(tx) - nominal) < 1);
      hasil.push({
        ref, tanggal: m.date, tx_no: ref, counterparty: ringkas(m.description),
        exception_type: 'Unmatched bank mutation', source: 'Reconciliation', priority: prioritas(nominal),
        ai_suggestion: kandidat
          ? `Kandidat cocok: ${kandidat.txId} (${ringkas(kandidat.description)}) — tanggal dan nominal sama. Cocokkan di tab Reconciliation.`
          : 'Belum ada transaksi sistem dengan tanggal dan nominal yang sama. Buat Cash Receipt/Payment atau periksa input.',
        source_snippet: { tanggal: m.date, [m.credit ? 'kredit' : 'debit']: nominal, rekening },
      });
      continue;
    }

    // 3) Amount mismatch: matched, tapi nominal beda dari transaksi sistem
    const tx = m.matchedTxId ? txById.get(m.matchedTxId) : undefined;
    if (tx) {
      const selisih = nominal - nominalTx(tx);
      if (Math.abs(selisih) >= 1) {
        hasil.push({
          ref, tanggal: m.date, tx_no: tx.txId || ref, counterparty: ringkas(tx.party || m.description),
          exception_type: 'Amount mismatch', source: 'Reconciliation', priority: prioritas(selisih),
          ai_suggestion: `Nominal mutasi bank berbeda ${Math.abs(selisih).toLocaleString('id-ID')} dari transaksi sistem. Cek salah input, potongan/biaya bank, atau pencocokan yang keliru.`,
          source_snippet: { tanggal: m.date, mutasi_bank: nominal, transaksi_sistem: nominalTx(tx), selisih },
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
  const { getByGroup } = useTransactions();
  const clientId = activeClientId ? String(activeClientId) : null;
  const userId: string | null = user?.id ? String(user.id) : null;

  const paymentTx = getByGroup('cash_payment');
  const receiptTx = getByGroup('cash_receipt');
  const systemTx = useMemo(() => [...paymentTx, ...receiptTx], [paymentTx, receiptTx]);

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

  const detected = useMemo(() => deteksiException(mutations, systemTx), [mutations, systemTx]);
  const exceptions = useMemo(() => gabungkan(detected, rows, userId), [detected, rows, userId]);

  /** Simpan penanganan (status / assign). Melempar Error kalau gagal -- pemanggil yang menampilkan toast. */
  const simpan = useCallback(
    async (ex: CashBankExceptionView, patch: { status?: 'Open' | 'In Review' | 'Resolved'; assigned_to?: typeof ME | null }) => {
      if (!clientId) throw new Error('Pilih client terlebih dahulu.');
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
        if (patch.assigned_to === ME && !userId) throw new Error('User tidak ditemukan.');
        payload.assigned_to = patch.assigned_to === ME ? userId : null;
      }
      await upsertBankCashException(payload);
      refresh();
    },
    [clientId, userId, refresh],
  );

  return { exceptions, loading, error, refresh, simpan };
}