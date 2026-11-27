'use client';

// Tab Cash Receipt = invoice Sales yang sudah diposting (piutang tercatat)
// beserta status penerimaannya. Total / diterima / dalam proses dihitung
// backend (GET /api/v1/transactions/bank-cash/open-invoices?type=sales):
//   paid        = paid_amount invoice (bertambah saat transaksi Cash & Bank diposting)
//   in_process  = transaksi Cash & Bank draft/approved (invoice belum berubah)
// Kolom Mutasi Bank & Jurnal dari baris alokasi transaksi (useBankCashRekon).

import { useMemo } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useBcOpenInvoices } from '@/lib/bankCashStore';
import { usePembayaranRekon, kelompokkanPerInvoice, sudahDiterapkan, type PembayaranRekon } from './useBankCashRekon';
import { hariIniLokal } from './hariIni';

export type ReceiptStatus = 'paid' | 'partial' | 'unpaid';

export interface CashReceiptRow {
  id: string;
  invoiceNo: string;
  customer: string;
  description: string;
  category: string;
  date: string; // invoice_date (YYYY-MM-DD)
  dueDate: string;
  total: number;
  received: number;
  /** Sisa piutang menurut buku (belum termasuk penerimaan yang masih dalam proses). */
  outstanding: number;
  receiptStatus: ReceiptStatus;
  isOverdue: boolean;
  /** Bagian `received` yang tidak berasal dari transaksi Cash & Bank (saldo awal, tunai saat import). */
  paidOutside: number;
  /** Cache paid_amount invoice tertinggal dari penerimaan yang sudah diposting (angka received tetap benar). */
  paidMismatch: boolean;
  /** Penerimaan Cash & Bank untuk invoice ini (mutasi bank + transaksi). */
  rekon: PembayaranRekon[];
  /** Nominal yang sudah dicocokkan/diinput tetapi transaksinya belum diposting. */
  dalamProses: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function useCashReceiptsFromSales(): {
  rows: CashReceiptRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { invoices, loading, error, refresh } = useBcOpenInvoices(clientId, 'sales');
  const { payments, loading: loadingRekon, refresh: refreshRekon } = usePembayaranRekon();
  const perInvoice = useMemo(() => kelompokkanPerInvoice(payments), [payments]);

  const rows = useMemo<CashReceiptRow[]>(() => {
    const today = hariIniLokal(); // hanya cadangan; status overdue utama dari backend (is_overdue)
    return invoices
      .map(i => {
        const received = Math.min(Math.max(i.paid, 0), i.total);
        const outstanding = Math.max(i.total - i.paid, 0);
        const dueDate = i.due_date || '';
        return {
          id: i.id,
          invoiceNo: i.no,
          customer: i.party || '',
          description: i.description || '',
          category: i.category || 'Other',
          date: i.date,
          dueDate,
          total: i.total,
          received,
          outstanding,
          receiptStatus: (outstanding <= 0.005 ? 'paid' : received > 0.005 ? 'partial' : 'unpaid') as ReceiptStatus,
          isOverdue: i.is_overdue ?? (outstanding > 0.005 && !!dueDate && dueDate < today),
          paidOutside: i.paid_outside_cash_bank ?? 0,
          paidMismatch: !!i.paid_cache_mismatch,
          rekon: perInvoice.get(i.id) || [],
          dalamProses: i.in_process,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [invoices, perInvoice]);

  const refreshSemua = () => {
    refresh();
    refreshRekon();
  };

  return { rows, loading: loading || loadingRekon, error, refresh: refreshSemua };
}

/**
 * Tren bulanan nominal diterima. Tahun = tahun kejadian terbaru (default: tahun berjalan).
 * Pembayaran hasil rekonsiliasi yang jurnalnya sudah DIPOSTING dihitung pada TANGGAL BAYAR-nya
 * (payment_date), sama seperti tab Posted/Overview. Sisa nominal yang sudah tercatat di invoice
 * tetapi tidak berasal dari rekonsiliasi (mis. diinput manual di halaman) belum punya tanggal
 * bayar, jadi dihitung pada tanggal invoice.
 */
/**
 * Daftar kejadian penerimaan (tanggal + nominal) -- dasar tren bulanan & chart ala Sales.
 * Pembayaran hasil rekonsiliasi yang sudah diposting dihitung pada tanggal bayarnya; sisa nominal
 * di invoice yang tidak berasal dari rekonsiliasi dihitung pada tanggal invoice.
 */
export function kejadianDiterima(rows: CashReceiptRow[]): { tanggal: string; nominal: number }[] {
  const kejadian: { tanggal: string; nominal: number }[] = [];
  rows.forEach(r => {
    let dijelaskan = 0;
    (r.rekon || []).filter(sudahDiterapkan).forEach(p => {
      kejadian.push({ tanggal: p.payment_date, nominal: p.amount });
      dijelaskan += p.amount;
    });
    const sisa = r.received - dijelaskan;
    if (sisa > 0.005) kejadian.push({ tanggal: r.date, nominal: sisa });
  });
  return kejadian;
}

export function trenBulananDiterima(rows: CashReceiptRow[]): { month: string; total: number; count: number }[] {
  const kejadian = kejadianDiterima(rows);
  const tahunTerbaru = kejadian.reduce((maks, k) => {
    const y = new Date(k.tanggal).getFullYear();
    return Number.isFinite(y) && y > maks ? y : maks;
  }, 0);
  const tahun = tahunTerbaru || new Date().getFullYear();
  const bulan = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  kejadian.forEach(k => {
    const d = new Date(k.tanggal);
    if (isNaN(d.getTime()) || d.getFullYear() !== tahun) return;
    bulan[d.getMonth()].total += k.nominal;
    bulan[d.getMonth()].count += 1;
  });
  return MONTH_LABELS.map((label, i) => ({ month: label, total: bulan[i].total, count: bulan[i].count }));
}

export function rincianPerKategori(rows: CashReceiptRow[]): { name: string; value: number }[] {
  const peta = new Map<string, number>();
  rows.forEach(r => peta.set(r.category || 'Other', (peta.get(r.category || 'Other') || 0) + r.total));
  return Array.from(peta.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function customerTerbesar(rows: CashReceiptRow[], limit = 5): { name: string; amount: number; count: number }[] {
  const peta = new Map<string, { amount: number; count: number }>();
  rows.forEach(r => {
    const key = r.customer || '—';
    const cur = peta.get(key) ?? { amount: 0, count: 0 };
    cur.amount += r.total;
    cur.count += 1;
    peta.set(key, cur);
  });
  return Array.from(peta.entries()).map(([name, v]) => ({ name, amount: v.amount, count: v.count })).sort((a, b) => b.amount - a.amount).slice(0, limit);
}