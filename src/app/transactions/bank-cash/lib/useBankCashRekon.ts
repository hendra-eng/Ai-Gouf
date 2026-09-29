'use client';

// Data Journal Preview (jalur pendek) & Overview Cash & Bank, dari backend
// /api/v1/finance/bank-reconciliation (bank_reconciliation_v1.py):
//   - /payments        -> pembayaran hasil rekonsiliasi (satu baris per invoice)
//   - /journal-preview -> jurnal Kas vs Hutang/Piutang beserta baris debit/kreditnya
// Sumbernya SAMA dengan tab Reconciliation, jadi angka di ketiga tab selalu sejalan.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { rekonDaftarPembayaran, rekonJurnalPreview } from '@/app/agent-ai/lib/api';
import type { CashBankTx } from './cashBankMock';

export interface PembayaranRekon {
  id: string;
  direction: 'cash_payment' | 'cash_receipt';
  payment_date: string;
  amount: number;
  bank_account: string | null;
  bank_mutation_ref: string;
  purchase_id: string | null;
  sales_id: string | null;
  invoice_no: string | null;
  party: string | null;
  invoice_total: number | null;
  created_at: string | null;
  journal_entry_id: string | null;
  journal_no: string | null;
  journal_status: string | null;
  bank_no_akun: string | null;
  bank_nama_akun: string | null;
  counter_no_akun: string | null;
  counter_nama_akun: string | null;
}

export interface BarisJurnal { no: number; code: string; name: string; debit: number; credit: number }
export type CashBankTxReal = CashBankTx & { realLines?: BarisJurnal[] };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalisasiPembayaran(r: any): PembayaranRekon {
  return {
    ...r,
    amount: num(r.amount),
    invoice_total: r.invoice_total == null ? null : num(r.invoice_total),
  } as PembayaranRekon;
}

/** Hanya pembayaran aktif (backend sudah menyaring yang dibatalkan). */
export function usePembayaranRekon() {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const [payments, setPayments] = useState<PembayaranRekon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const reqId = useRef(0);

  const refresh = useCallback(async () => setVersi((v) => v + 1), []);

  useEffect(() => {
    if (!clientId) {
      setPayments([]);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    rekonDaftarPembayaran(clientId)
      .then((rows: any[]) => {
        if (id !== reqId.current) return;
        setPayments((rows || []).map(normalisasiPembayaran));
        setError(null);
      })
      .catch((e: any) => {
        if (id !== reqId.current) return;
        setPayments([]);
        setError(e?.message || 'Gagal memuat pembayaran dari server.');
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [clientId, versi]);

  return { payments, loading, error, refresh };
}

/** Jurnal hasil rekonsiliasi (DRAFT & POSTED) dalam bentuk CashBankTx untuk komponen Journal Preview. */
export function useJurnalRekonTxs() {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const [txs, setTxs] = useState<CashBankTxReal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const reqId = useRef(0);

  const refresh = useCallback(async () => setVersi((v) => v + 1), []);

  useEffect(() => {
    if (!clientId) {
      setTxs([]);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    Promise.all([rekonJurnalPreview(clientId), rekonDaftarPembayaran(clientId)])
      .then(([jurnal, bayar]: [any[], any[]]) => {
        if (id !== reqId.current) return;
        setTxs(susunTx(jurnal || [], (bayar || []).map(normalisasiPembayaran)));
        setError(null);
      })
      .catch((e: any) => {
        if (id !== reqId.current) return;
        setTxs([]);
        setError(e?.message || 'Gagal memuat jurnal dari server.');
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [clientId, versi]);

  return { txs, loading, error, refresh };
}

function susunTx(jurnal: any[], bayar: PembayaranRekon[]): CashBankTxReal[] {
  // Outstanding sebelum/sesudah per pembayaran: total invoice dikurangi pembayaran aktif
  // yang lebih awal untuk invoice yang sama (urut tanggal bayar, lalu waktu dibuat).
  const perInvoice = new Map<string, PembayaranRekon[]>();
  for (const p of bayar) {
    const k = p.purchase_id || p.sales_id;
    if (!k) continue;
    (perInvoice.get(k) || perInvoice.set(k, []).get(k)!).push(p);
  }
  const sebelumSesudah = new Map<string, { before: number; after: number }>();
  perInvoice.forEach((daftar) => {
    daftar.sort((a, b) => (a.payment_date + (a.created_at || '')).localeCompare(b.payment_date + (b.created_at || '')));
    let terbayar = 0;
    for (const p of daftar) {
      const before = Math.max((p.invoice_total ?? 0) - terbayar, 0);
      sebelumSesudah.set(p.id, { before, after: Math.max(before - p.amount, 0) });
      terbayar += p.amount;
    }
  });

  const hasil: CashBankTxReal[] = [];
  for (const je of jurnal) {
    if (je.status !== 'DRAFT' && je.status !== 'POSTED') continue; // REJECTED/REVERSED tidak ditampilkan
    const pays = bayar.filter((p) => p.journal_entry_id === je.id);
    if (pays.length === 0) continue;
    const p0 = pays[0];
    const receipt = p0.direction === 'cash_receipt';
    const amount = pays.reduce((n, p) => n + p.amount, 0);
    const pihak = Array.from(new Set(pays.map((p) => p.party).filter(Boolean))).join(', ') || '-';
    const noInvoice = pays.map((p) => p.invoice_no).filter(Boolean).join(', ') || '-';
    const rentang = pays.map((p) => sebelumSesudah.get(p.id) || { before: 0, after: 0 });
    hasil.push({
      id: je.id,
      tx_no: je.journal_no,
      counterparty: pihak,
      tx_date: String(je.posting_date || p0.payment_date).slice(0, 10),
      amount,
      direction: receipt ? 'Cash Receipt' : 'Cash Payment',
      bank_account: p0.bank_nama_akun ? `${p0.bank_no_akun ? p0.bank_no_akun + ' - ' : ''}${p0.bank_nama_akun}` : p0.bank_account || '',
      transaction_type: receipt ? 'Penerimaan Piutang' : 'Pembayaran Hutang',
      tax_status: 'Non-Taxable',
      dpp: amount,
      ppn: 0,
      // Backend tidak punya status "approved": jurnal hasil match (dibuat Supervisor ke atas)
      // langsung siap diposting.
      posting_status: je.status === 'POSTED' ? 'Posted' : 'Approved',
      matchStatus: 'matched',
      linkedInvoice: {
        no: noInvoice,
        type: receipt ? 'Sales' : 'Purchase',
        counterpartyAccount:
          p0.counter_nama_akun ? `${p0.counter_no_akun ? p0.counter_no_akun + ' - ' : ''}${p0.counter_nama_akun}` : receipt ? 'Piutang Usaha' : 'Hutang Usaha',
        outstandingBefore: rentang.reduce((n, r) => n + r.before, 0),
        outstandingAfter: rentang.reduce((n, r) => n + r.after, 0),
      },
      realLines: (je.lines || []).map((l: any) => ({
        no: num(l.line_no),
        code: String(l.no_akun ?? ''),
        name: String(l.nama_akun ?? ''),
        debit: num(l.debit),
        credit: num(l.credit),
      })),
    });
  }
  return hasil;
}