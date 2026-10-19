'use client';

// Tab Cash Payment = tagihan Purchase yang sudah diposting (hutang tercatat)
// beserta status pembayarannya. Total / dibayar / dalam proses dihitung
// backend (GET /api/v1/transactions/bank-cash/open-invoices?type=purchase):
//   paid        = pelunasan dari transaksi Cash & Bank yang sudah POSTED
//                 (transaksi lama yang ditandai lunas manual dianggap lunas)
//   in_process  = transaksi Cash & Bank draft/approved (invoice belum berubah)
// Kolom Mutasi Bank & Jurnal dari baris alokasi transaksi (useBankCashRekon).

import { useMemo } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useBcOpenInvoices } from '@/lib/bankCashStore';
import type { PaymentStatus } from '@/lib/data/purchaseData';
import { usePembayaranRekon, kelompokkanPerInvoice, sudahDiterapkan, type PembayaranRekon } from './useBankCashRekon';

export interface CashPaymentRow {
  id: string;
  purchaseId: string;
  invoiceNumber: string;
  vendor: string;
  description: string;
  category: string;
  date: string; // purchaseDate (YYYY-MM-DD)
  dueDate: string;
  total: number;
  paid: number;
  /** Sisa hutang menurut buku (belum termasuk pembayaran yang masih dalam proses). */
  outstanding: number;
  paymentStatus: PaymentStatus;
  isOverdue: boolean;
  /** Pembayaran Cash & Bank untuk invoice ini (mutasi bank + transaksi). */
  rekon: PembayaranRekon[];
  /** Nominal yang sudah dicocokkan/diinput tetapi transaksinya belum diposting. */
  dalamProses: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function useCashPaymentsFromPurchase(): {
  rows: CashPaymentRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { invoices, loading, error, refresh } = useBcOpenInvoices(clientId, 'purchase');
  const { payments, loading: loadingRekon, refresh: refreshRekon } = usePembayaranRekon();
  const perInvoice = useMemo(() => kelompokkanPerInvoice(payments), [payments]);

  const rows = useMemo<CashPaymentRow[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return invoices
      .map(i => {
        const outstanding = Math.max(i.total - i.paid, 0);
        const dueDate = i.due_date || '';
        const isOverdue = outstanding > 0.005 && !!dueDate && dueDate < today;
        const asal = (i.payment_status || 'unpaid') as PaymentStatus;
        const paymentStatus: PaymentStatus =
          outstanding <= 0.005 ? 'paid'
          : i.paid > 0.005 ? 'partially_paid'
          : asal === 'on_hold' ? 'on_hold'
          : isOverdue ? 'overdue' : 'unpaid';
        return {
          id: i.id,
          purchaseId: i.purchase_no || i.no,
          invoiceNumber: i.invoice_number || '',
          vendor: i.party || '',
          description: i.description || '',
          category: i.category || 'Other',
          date: i.purchase_date || i.date,
          dueDate,
          total: i.total,
          paid: i.paid,
          outstanding,
          paymentStatus,
          isOverdue,
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
 * Tren bulanan nominal dibayar. Tahun = tahun kejadian terbaru (default: tahun berjalan).
 * Pembayaran hasil rekonsiliasi yang jurnalnya sudah DIPOSTING dihitung pada TANGGAL BAYAR-nya
 * (payment_date), sama seperti tab Posted/Overview. Sisa nominal yang sudah tercatat di invoice
 * tetapi tidak berasal dari rekonsiliasi (mis. diinput manual di halaman) belum punya tanggal
 * bayar, jadi dihitung pada tanggal invoice.
 */
export function trenBulananDibayar(rows: CashPaymentRow[]): { month: string; total: number; count: number }[] {
  const kejadian: { tanggal: string; nominal: number }[] = [];
  rows.forEach(r => {
    let dijelaskan = 0;
    (r.rekon || []).filter(sudahDiterapkan).forEach(p => {
      kejadian.push({ tanggal: p.payment_date, nominal: p.amount });
      dijelaskan += p.amount;
    });
    const sisa = r.paid - dijelaskan;
    if (sisa > 0.005) kejadian.push({ tanggal: r.date, nominal: sisa });
  });
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

export function rincianPerKategori(rows: CashPaymentRow[]): { name: string; value: number }[] {
  const peta = new Map<string, number>();
  rows.forEach(r => peta.set(r.category || 'Other', (peta.get(r.category || 'Other') || 0) + r.total));
  return Array.from(peta.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function vendorTerbesar(rows: CashPaymentRow[], limit = 5): { name: string; amount: number }[] {
  const peta = new Map<string, number>();
  rows.forEach(r => peta.set(r.vendor || '—', (peta.get(r.vendor || '—') || 0) + r.total));
  return Array.from(peta.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, limit);
}