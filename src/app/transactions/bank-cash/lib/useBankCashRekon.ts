'use client';

// Data Journal Preview (jalur pendek) & Overview Cash & Bank, dari backend
// /api/v1/finance/bank-reconciliation (bank_reconciliation_v1.py):
//   - /payments        -> pembayaran hasil rekonsiliasi (satu baris per invoice)
//   - /journal-preview -> jurnal Kas vs Hutang/Piutang beserta baris debit/kreditnya
// Sumbernya SAMA dengan tab Reconciliation, jadi angka di ketiga tab selalu sejalan.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { rekonDaftarPembayaran, rekonJurnalPreview, REKON_EVENT } from '@/app/agent-ai/lib/api';
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
  mutation_description?: string | null;
  source_file?: string | null;
  /** Terisi kalau pembayaran sudah dibatalkan (mis. jurnalnya dibalik). Hanya ada kalau diminta termasuk_dibatalkan. */
  deleted_at?: string | null;
  /** Terisi saat jurnalnya diposting = pembayaran sudah diterapkan ke invoice. Kosong = masih menunggu posting. */
  applied_at?: string | null;
}

/** Info jurnal pembalik untuk jurnal POSTED yang sudah dibalik. */
export interface PembalikanJurnal {
  id: string;
  journalNo: string;
  date: string | null;
  by: string | null;
  at: string | null;
  /** Alasan yang diisi saat membalik (diambil dari deskripsi jurnal pembalik). */
  reason: string;
}

export interface BarisJurnal { no: number; code: string; name: string; debit: number; credit: number }
export type CashBankTxReal = CashBankTx & {
  realLines?: BarisJurnal[];
  /** posted_by / posted_at dari /journal-preview. */
  postedBy?: string | null;
  postedAt?: string | null;
  /** Info mutasi bank asal jurnal ini (dari /payments). */
  mutationRef?: string;
  mutationDescription?: string | null;
  sourceFile?: string | null;
  /** Ada = jurnal ini sudah dibalik (jurnal asal tetap POSTED, dinetralkan oleh jurnal pembalik). */
  reversal?: PembalikanJurnal | null;
};

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

/**
 * Pembayaran sudah diterapkan ke invoice = jurnalnya sudah diposting. Selama belum (DRAFT/APPROVED)
 * pembayaran berstatus "dalam proses" dan TIDAK dihitung sebagai cash in/out resmi.
 * Kalau backend lama belum mengirim applied_at, status jurnal POSTED dipakai sebagai gantinya.
 */
export function sudahDiterapkan(p: PembayaranRekon): boolean {
  if (p.applied_at !== undefined) return !!p.applied_at;
  return p.journal_status === 'POSTED';
}

/** Tahap pembayaran untuk ditampilkan: Diposting / Disetujui (menunggu posting) / Draft (menunggu approve). */
export function tahapPembayaran(p: PembayaranRekon): 'Diposting' | 'Disetujui' | 'Draft' {
  if (sudahDiterapkan(p)) return 'Diposting';
  return p.journal_status === 'APPROVED' ? 'Disetujui' : 'Draft';
}

/** Hanya pembayaran aktif (backend sudah menyaring yang dibatalkan). Ikut memuat ulang saat data rekonsiliasi berubah. */
export function usePembayaranRekon() {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const [payments, setPayments] = useState<PembayaranRekon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const reqId = useRef(0);

  const refresh = useCallback(async () => setVersi((v) => v + 1), []);

  // Match / unmatch / approve / post / reverse di tab lain -> muat ulang otomatis.
  useEffect(() => {
    const onBerubah = () => setVersi((v) => v + 1);
    window.addEventListener(REKON_EVENT, onBerubah);
    return () => window.removeEventListener(REKON_EVENT, onBerubah);
  }, []);

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
  return useJurnalRekonBase(null);
}

/**
 * Hanya jurnal POSTED (status disaring di server lewat ?status=POSTED) -- untuk tab Posted.
 * Jurnal yang sudah dibalik ikut dikembalikan dengan `reversal` terisi; pemanggil yang memutuskan
 * mau menampilkannya atau tidak.
 */
export function usePostedJurnalRekon() {
  return useJurnalRekonBase('POSTED');
}

function useJurnalRekonBase(status: 'POSTED' | null) {
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
    // Tab Posted butuh pembayaran yang sudah dibatalkan juga, supaya jurnal yang sudah dibalik
    // (pembayarannya dibatalkan saat reversal) masih bisa dipetakan ke invoice & mutasi bank asalnya.
    Promise.all([rekonJurnalPreview(clientId, status), rekonDaftarPembayaran(clientId, null, status === 'POSTED')])
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
  }, [clientId, versi, status]);

  return { txs, loading, error, refresh };
}

function susunTx(jurnal: any[], bayar: PembayaranRekon[]): CashBankTxReal[] {
  // Outstanding sebelum/sesudah per pembayaran: total invoice dikurangi pembayaran aktif
  // yang lebih awal untuk invoice yang sama (urut tanggal bayar, lalu waktu dibuat).
  // Pembayaran yang sudah dibatalkan TIDAK ikut dihitung.
  const perInvoice = new Map<string, PembayaranRekon[]>();
  for (const p of bayar) {
    if (p.deleted_at) continue;
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
    if (je.status !== 'DRAFT' && je.status !== 'APPROVED' && je.status !== 'POSTED') continue; // REJECTED/REVERSED tidak ditampilkan
    const pays = bayar.filter((p) => p.journal_entry_id === je.id);
    if (pays.length === 0) {
      // Jurnal tanpa invoice (biaya admin, bunga, transfer antar bank, dst): tidak punya pembayaran.
      if (je.non_invoice) hasil.push(susunTxNonInvoice(je));
      continue;
    }
    const p0 = pays[0];
    const receipt = p0.direction === 'cash_receipt';
    const dibalik = !!je.reversal_id;
    const amount = pays.reduce((n, p) => n + p.amount, 0);
    const pihak = Array.from(new Set(pays.map((p) => p.party).filter(Boolean))).join(', ') || '-';
    const noInvoice = pays.map((p) => p.invoice_no).filter(Boolean).join(', ') || '-';
    // Jurnal yang sudah dibalik: pembayarannya dibatalkan, jadi outstanding sebelum/sesudah tidak bermakna.
    const rentang = pays.map((p) => (dibalik ? { before: 0, after: 0 } : sebelumSesudah.get(p.id) || { before: 0, after: 0 }));
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
      // DRAFT = baru dicocokkan, APPROVED = sudah disetujui (siap diposting), POSTED = masuk buku besar.
      posting_status: je.status === 'POSTED' ? 'Posted' : je.status === 'APPROVED' ? 'Approved' : 'Draft',
      matchStatus: 'matched',
      linkedInvoice: {
        no: noInvoice,
        type: receipt ? 'Sales' : 'Purchase',
        counterpartyAccount:
          p0.counter_nama_akun ? `${p0.counter_no_akun ? p0.counter_no_akun + ' - ' : ''}${p0.counter_nama_akun}` : receipt ? 'Piutang Usaha' : 'Hutang Usaha',
        outstandingBefore: rentang.reduce((n, r) => n + r.before, 0),
        outstandingAfter: rentang.reduce((n, r) => n + r.after, 0),
      },
      postedBy: je.posted_by ?? null,
      postedAt: je.posted_at ?? null,
      mutationRef: p0.bank_mutation_ref,
      mutationDescription: p0.mutation_description ?? null,
      sourceFile: p0.source_file ?? null,
      reversal: dibalik
        ? {
            id: String(je.reversal_id),
            journalNo: String(je.reversal_no ?? ''),
            date: je.reversal_date ? String(je.reversal_date).slice(0, 10) : null,
            by: je.reversal_by ?? null,
            at: je.reversal_at ?? null,
            // Deskripsi jurnal pembalik: "Pembalik <no jurnal asal>: <alasan>".
            reason: String(je.reversal_description ?? '').replace(/^[^:]*:\s*/, ''),
          }
        : null,
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

/** Jurnal hasil rekonsiliasi tanpa invoice -> CashBankTx (linkedInvoice = null). */
function susunTxNonInvoice(je: any): CashBankTxReal {
  const lines: any[] = je.lines || [];
  // Baris Bank = akun ber-jenis_kas 'bank'. Debit di Bank = uang masuk; kredit = uang keluar.
  const bankLine = lines.find((l) => String(l.jenis_kas ?? '').toLowerCase() === 'bank');
  const masuk = bankLine ? num(bankLine.debit) > 0 : num(lines[0]?.debit) > 0;
  const amount = bankLine ? num(bankLine.debit) || num(bankLine.credit) : lines.reduce((n, l) => n + num(l.debit), 0);
  const dibalik = !!je.reversal_id;
  // Deskripsi jurnal = "<kategori>: <keterangan mutasi>".
  const [kategori, ...sisa] = String(je.description ?? '').replace(/^Rekonsiliasi bank [^:]*:\s*/, '').split(':');
  return {
    id: je.id,
    tx_no: je.journal_no,
    counterparty: kategori?.trim() || 'Tanpa invoice',
    tx_date: String(je.posting_date).slice(0, 10),
    amount,
    direction: masuk ? 'Cash Receipt' : 'Cash Payment',
    bank_account: bankLine ? `${bankLine.no_akun ? bankLine.no_akun + ' - ' : ''}${bankLine.nama_akun ?? ''}` : '',
    transaction_type: 'Tanpa Invoice',
    tax_status: 'Non-Taxable',
    dpp: amount,
    ppn: 0,
    posting_status: je.status === 'POSTED' ? 'Posted' : je.status === 'APPROVED' ? 'Approved' : 'Draft',
    matchStatus: 'matched',
    linkedInvoice: null,
    postedBy: je.posted_by ?? null,
    postedAt: je.posted_at ?? null,
    mutationRef: je.reference ?? undefined,
    mutationDescription: sisa.join(':').trim() || null,
    sourceFile: null,
    reversal: dibalik
      ? {
          id: String(je.reversal_id),
          journalNo: String(je.reversal_no ?? ''),
          date: je.reversal_date ? String(je.reversal_date).slice(0, 10) : null,
          by: je.reversal_by ?? null,
          at: je.reversal_at ?? null,
          reason: String(je.reversal_description ?? '').replace(/^[^:]*:\s*/, ''),
        }
      : null,
    realLines: lines.map((l: any) => ({
      no: num(l.line_no),
      code: String(l.no_akun ?? ''),
      name: String(l.nama_akun ?? ''),
      debit: num(l.debit),
      credit: num(l.credit),
    })),
  };
}

/** Pembayaran rekon dikelompokkan per invoice (kunci = id invoice Purchase atau Sales). */
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

/** Total nominal yang sudah dicocokkan tetapi jurnalnya belum diposting ("dalam proses"). */
export function totalDalamProses(items: PembayaranRekon[] | undefined): number {
  return (items || []).filter((p) => !sudahDiterapkan(p)).reduce((n, p) => n + p.amount, 0);
}