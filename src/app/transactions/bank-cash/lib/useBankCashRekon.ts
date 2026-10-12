'use client';

// Tampilan turunan dari transaksi Cash & Bank (src/lib/bankCashStore.ts):
//   - PembayaranRekon = 1 baris alokasi pelunasan invoice (Sales/Purchase),
//     dipakai tab Cash Payment / Cash Receipt (kolom Mutasi Bank & Jurnal).
//   - CashBankTxReal  = 1 transaksi dalam bentuk tabel tab Posted.
// Semua dimuat ulang otomatis lewat BANK_CASH_EVENT.

import { useMemo } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useBcTransactions, type BcTransaction } from '@/lib/bankCashStore';
import type { CashBankTx } from './cashBankMock';

export interface PembayaranRekon {
  /** id baris transaksi (alokasi). */
  id: string;
  direction: 'cash_payment' | 'cash_receipt';
  payment_date: string;
  amount: number;
  bank_account: string | null;
  /** id mutasi Bank Feed ('' untuk transaksi manual). */
  bank_mutation_ref: string;
  purchase_id: string | null;
  sales_id: string | null;
  invoice_no: string | null;
  party: string | null;
  created_at: string | null;
  /** id transaksi Cash & Bank. */
  journal_entry_id: string;
  journal_no: string;
  journal_status: 'DRAFT' | 'APPROVED' | 'POSTED';
  mutation_description?: string | null;
  /** Terisi saat transaksinya diposting = pelunasan sudah diterapkan ke invoice. */
  applied_at: string | null;
}

/** Info pembalikan untuk transaksi yang sudah di-reverse. */
export interface PembalikanJurnal {
  id: string;
  journalNo: string;
  date: string | null;
  by: string | null;
  at: string | null;
  reason: string;
}

export interface BarisJurnal { no: number; code: string; name: string; debit: number; credit: number }

export type CashBankTxReal = CashBankTx & {
  realLines?: BarisJurnal[];
  postedBy?: string | null;
  postedAt?: string | null;
  mutationRef?: string;
  mutationDescription?: string | null;
  sourceFile?: string | null;
  reversal?: PembalikanJurnal | null;
};

const STATUS_JURNAL: Record<string, PembayaranRekon['journal_status']> = { draft: 'DRAFT', approved: 'APPROVED', posted: 'POSTED' };

/** Pelunasan sudah diterapkan ke invoice = transaksinya sudah diposting. */
export function sudahDiterapkan(p: PembayaranRekon): boolean {
  return !!p.applied_at;
}

export function tahapPembayaran(p: PembayaranRekon): 'Posted' | 'Approved' | 'Draft' {
  if (sudahDiterapkan(p)) return 'Posted';
  return p.journal_status === 'APPROVED' ? 'Approved' : 'Draft';
}

/** Pecah transaksi aktif (draft/approved/posted) jadi baris alokasi invoice. */
export function keDaftarPembayaran(txs: BcTransaction[]): PembayaranRekon[] {
  const hasil: PembayaranRekon[] = [];
  for (const t of txs) {
    if (t.status === 'reversed') continue;
    for (const l of t.lines) {
      if (l.line_type === 'account') continue;
      hasil.push({
        id: l.id,
        direction: t.direction === 'receipt' ? 'cash_receipt' : 'cash_payment',
        payment_date: t.tx_date,
        amount: l.amount,
        bank_account: `${t.bank_account_code} - ${t.bank_account_name}`,
        bank_mutation_ref: t.mutation?.id ?? '',
        purchase_id: l.purchase_transaction_id,
        sales_id: l.sales_invoice_id,
        invoice_no: l.invoice_no,
        party: l.party,
        created_at: t.created_at,
        journal_entry_id: t.id,
        journal_no: t.tx_number,
        journal_status: STATUS_JURNAL[t.status],
        mutation_description: t.mutation?.description ?? null,
        applied_at: t.status === 'posted' ? t.posted_at : null,
      });
    }
  }
  return hasil;
}

/** Baris alokasi invoice dari semua transaksi aktif klien aktif. */
export function usePembayaranRekon() {
  const { activeClientId } = useActiveClient();
  const { transactions, loading, error, refresh } = useBcTransactions(activeClientId ? String(activeClientId) : null, {
    status: ['draft', 'approved', 'posted'],
  });
  const payments = useMemo(() => keDaftarPembayaran(transactions), [transactions]);
  return { payments, loading, error, refresh };
}

/** Transaksi -> bentuk baris tab Posted. */
export function keTxPosted(t: BcTransaction): CashBankTxReal {
  const receipt = t.direction === 'receipt';
  const inv = t.lines.filter(l => l.line_type !== 'account');
  const akunLawan = t.lines.map(l => `${l.account_code} - ${l.account_name}`);
  return {
    id: t.id,
    tx_no: t.tx_number,
    counterparty: t.counterparty || t.category || '-',
    tx_date: t.tx_date,
    amount: t.amount,
    direction: receipt ? 'Cash Receipt' : 'Cash Payment',
    bank_account: `${t.bank_account_code} - ${t.bank_account_name}`,
    transaction_type: t.category || (receipt ? 'Cash Receipt' : 'Cash Payment'),
    tax_status: 'Non-Taxable',
    dpp: t.amount,
    ppn: 0,
    posting_status: t.status === 'posted' || t.status === 'reversed' ? 'Posted' : t.status === 'approved' ? 'Approved' : 'Draft',
    matchStatus: t.mutation ? 'matched' : 'unmatched',
    linkedInvoice: inv.length
      ? {
          no: inv.map(l => l.invoice_no).filter(Boolean).join(', ') || '-',
          type: receipt ? 'Sales' : 'Purchase',
          counterpartyAccount: Array.from(new Set(akunLawan)).join(', '),
          outstandingBefore: 0,
          outstandingAfter: 0,
        }
      : null,
    postedBy: t.posted_by_name,
    postedAt: t.posted_at,
    mutationRef: t.mutation?.id,
    mutationDescription: t.mutation?.description ?? null,
    sourceFile: null,
    reversal: t.status === 'reversed'
      ? {
          id: t.id,
          journalNo: `RV-${t.tx_number}`,
          date: t.reversal_date,
          by: t.reversed_by_name,
          at: t.reversed_at,
          reason: t.reversal_reason || '',
        }
      : null,
    realLines: t.journal.map(j => ({ no: j.line_no, code: j.account_code, name: j.account_name, debit: j.debit, credit: j.credit })),
  };
}

/** Transaksi posted + reversed untuk tab Posted (reversed membawa info `reversal`). */
export function usePostedJurnalRekon() {
  const { activeClientId } = useActiveClient();
  const { transactions, loading, error, refresh } = useBcTransactions(activeClientId ? String(activeClientId) : null, {
    status: ['posted', 'reversed'],
  });
  const txs = useMemo(() => transactions.map(keTxPosted), [transactions]);
  return { txs, loading, error, refresh };
}

/** Pembayaran dikelompokkan per invoice (kunci = id invoice Purchase atau Sales). */
export function kelompokkanPerInvoice(payments: PembayaranRekon[]): Map<string, PembayaranRekon[]> {
  const peta = new Map<string, PembayaranRekon[]>();
  for (const p of payments) {
    const k = p.purchase_id || p.sales_id;
    if (!k) continue;
    const arr = peta.get(k);
    if (arr) arr.push(p);
    else peta.set(k, [p]);
  }
  return peta;
}
