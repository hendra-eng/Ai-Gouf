'use client';

// FX Bank & Transfers (Fase 3B/3C kurs) -- terhubung ke backend modules/finance/fx_bank_v1.py
// (/api/v1/finance/fx-bank/...). Rekening kas/bank valas, nominal valas transaksi Cash & Bank,
// transfer antar rekening beda mata uang (preview -> posting -> pembalikan).

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const FX_BANK_EVENT = 'gouf-fx-bank-changed';
const api = createV1Api('/api/v1/finance/fx-bank', FX_BANK_EVENT);

export const useFxBankData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) =>
  useV1Data(FX_BANK_EVENT, key, fn, awal);

export interface UnconvertedTx {
  id: string; tx_number: string; tx_date: string; direction: 'receipt' | 'payment';
  amount_idr: number; currency: string | null; description: string | null;
}
export interface BankAccount {
  coa_id: string; account_code: string; account_name: string; kind: string; currency: string; is_foreign: boolean;
  tracking_start?: string; opening_foreign?: number; notes?: string | null;
  foreign_balance?: number; carrying_idr?: number | null; average_rate?: number | null;
  issues?: string[]; unconverted?: UnconvertedTx[];
}
export interface BankAccountsResult { as_of: string; accounts: BankAccount[] }

export interface TransferJournalLine { account_code: string; account_name: string; description: string; debit: number; credit: number }
export interface TransferPreview {
  can_post: boolean; issues: string[]; code?: string;
  from?: { account_code: string; account_name: string; currency: string; amount: number };
  to?: { account_code: string; account_name: string; currency: string; amount: number };
  from_average_rate?: number | null; from_balance?: number | null; rate_in?: number | null;
  value_out_idr?: number; value_in_idr?: number; fx_difference?: number; effect?: 'gain' | 'loss' | null;
  journal?: TransferJournalLine[];
}
export interface FxTransfer {
  id: string; transfer_no: string; transfer_date: string; status: 'posted' | 'reversed';
  from_account_code: string; from_account_name: string; from_currency: string; from_amount: number;
  to_account_code: string; to_account_name: string; to_currency: string; to_amount: number; rate_in: number | null;
  value_out_idr: number; value_in_idr: number; fx_difference: number; effect: 'gain' | 'loss' | null;
  reversal_date: string | null; reversal_reason: string | null; reference: string | null; notes: string | null;
  created_by_name: string | null; reversed_by_name: string | null;
}
export interface TransferInput {
  transfer_date: string; from_coa_id: string; to_coa_id: string; from_amount: number; to_amount: number;
  rate_in?: number | null; reference?: string | null; notes?: string | null;
}

export const fetchBankAccounts = (clientId: string, asOf: string, s?: AbortSignal) =>
  api.get<BankAccountsResult>('/accounts', { client_id: clientId, as_of: asOf }, s);

export const saveForeignAccount = async (clientId: string, v: { coa_id: string; currency: string; tracking_start: string; opening_foreign: number }) =>
  (await api.send('PUT', '/accounts', { client_id: clientId, ...v })).data;

export const removeForeignAccount = async (clientId: string, coaId: string) =>
  (await api.send('DELETE', `/accounts/${coaId}`, undefined, { client_id: clientId })).data;

export const setForeignAmount = async (clientId: string, txId: string, fxAmount: number | null, fxRate: number | null = null) =>
  (await api.send('PUT', `/transactions/${txId}/foreign-amount`, { client_id: clientId, fx_amount: fxAmount, fx_rate: fxRate })).data;

export const previewTransfer = async (clientId: string, t: TransferInput) =>
  (await api.send<TransferPreview>('POST', '/transfers/preview', { client_id: clientId, ...t }, {}, false)).data;

export const postTransfer = async (clientId: string, t: TransferInput) =>
  (await api.send<{ transfer: FxTransfer; journal_number: string }>('POST', '/transfers', { client_id: clientId, ...t })).data;

export const fetchTransfers = (clientId: string, s?: AbortSignal) => api.get<FxTransfer[]>('/transfers', { client_id: clientId }, s);

export const reverseTransfer = async (clientId: string, id: string, reversalDate: string | null, reason: string) =>
  (await api.send<FxTransfer>('POST', `/transfers/${id}/reverse`, {
    client_id: clientId, reversal_date: reversalDate || null, reason: reason.trim() || null,
  })).data;
