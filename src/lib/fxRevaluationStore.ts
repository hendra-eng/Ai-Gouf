'use client';

// FX Revaluation (Fase 3A kurs) -- terhubung ke backend modules/finance/fx_revaluation_v1.py
// (/api/v1/finance/fx-revaluation/...). Revaluasi akhir periode saldo AR/AP valas: pratinjau -> posting jurnal
// revaluasi + jurnal pembalik otomatis, riwayat run, pembatalan. Setiap aksi tulis memancarkan event
// supaya daftar riwayat memuat ulang.

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const FX_REVALUATION_EVENT = 'gouf-fx-revaluation-changed';
const api = createV1Api('/api/v1/finance/fx-revaluation', FX_REVALUATION_EVENT);

export const useFxRevaluationData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) =>
  useV1Data(FX_REVALUATION_EVENT, key, fn, awal);

export interface RevalRate { currency: string; rate: number; rate_date: string | null; source: 'master' | 'manual' }
export interface RevalDocument {
  type: 'ar' | 'ap'; id: string; no: string; party: string; date: string; currency: string;
  foreign_outstanding: number; booking_rate: number; carried_idr: number; closing_rate: number; revalued_idr: number;
  difference: number; effect: 'gain' | 'loss' | null; account_code: string; account_name: string;
}
export interface RevalJournalLine { account_code: string; account_name: string; description: string; debit: number; credit: number }
export interface RevalRun {
  id: string; as_of: string; reversal_date: string; status: 'posted' | 'cancelled'; rates: Record<string, number> | null;
  total_gain: number; total_loss: number; net_effect: number; document_count: number;
  journal_id: string | null; reversal_journal_id: string | null; notes: string | null;
  created_at: string | null; created_by_name: string | null;
  cancelled_at: string | null; cancelled_by_name: string | null; cancel_reason: string | null;
  documents?: RevalDocument[];
}
export interface RevalPreview {
  as_of: string; reversal_date: string; rates: RevalRate[]; missing_rates: string[];
  accounts_ready: { gain: boolean; loss: boolean };
  documents: RevalDocument[];
  totals: { gain: number; loss: number; net: number; document_count: number };
  journal: RevalJournalLine[]; can_run: boolean; issues: string[]; existing_run: RevalRun | null;
}
export interface RevalRunResult {
  run: RevalRun; journal: RevalJournalLine[]; reversal_journal: RevalJournalLine[];
  journal_number: string; reversal_journal_number: string;
}

export const previewRevaluation = async (clientId: string, asOf: string, rates: Record<string, number> = {}) =>
  (await api.send<RevalPreview>('POST', '/preview', { client_id: clientId, as_of: asOf, rates: Object.keys(rates).length ? rates : null }, {}, false)).data;

export const runRevaluation = async (clientId: string, asOf: string, rates: Record<string, number> = {}, notes = '') =>
  (await api.send<RevalRunResult>('POST', '/run', {
    client_id: clientId, as_of: asOf, rates: Object.keys(rates).length ? rates : null, notes: notes.trim() || null,
  })).data;

export const fetchRevaluationRuns = (clientId: string, s?: AbortSignal) => api.get<RevalRun[]>('/runs', { client_id: clientId }, s);

export const cancelRevaluation = async (clientId: string, runId: string, reason = '') =>
  (await api.send<RevalRun>('POST', `/runs/${runId}/cancel`, { reason: reason.trim() || null }, { client_id: clientId })).data;
