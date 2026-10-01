'use client';

// ─── SUMBER DATA CASH RECEIPT = HALAMAN SALES ──────────────────────────────
// Tab Cash Receipt (Cash & Bank) TIDAK lagi membaca finance_transaction_bank_cash /
// jurnal_posting. Datanya diambil dari invoice Sales (useSalesInvoices, pola yang
// sama dengan halaman Sales: client_id = id akun yang login).
//
// Aturan yang dipakai (ubah di sini kalau berbeda dari maksudmu):
//   - Hanya invoice Sales berstatus posting 'Posted' | 'Partial' | 'Paid'
//     (piutang sudah tercatat di buku besar).
//   - Nominal diterima / sisa langsung dari paid_amount & outstanding_amount
//     milik invoice (Sales sudah menyimpannya).
//   - Tren bulanan: pembayaran hasil rekonsiliasi yang sudah diposting memakai
//     tanggal bayar (payment_date); sisa yang tidak berasal dari rekonsiliasi
//     (input manual di Sales) memakai tanggal invoice (invoice_date).
//
// SCOPE CLIENT (disamakan dengan Bank Feed / Reconciliation / Exceptions):
//   - [FIX] Fetch ke backend memakai client_id = activeClientId (management_clients.id;
//     sebelumnya user.id sehingga tab selalu kosong). Catatan lama: (FK tabel ke
//     management_users), TAPI baris yang ditampilkan disaring lagi berdasarkan
//     management_client_id === activeClientId (dropdown "Switch Company"),
//     supaya tab ini ikut berganti saat company diganti.
//   - Invoice lama yang management_client_id-nya masih NULL tidak akan tampil
//     sampai di-backfill (lihat catatan migrasi).

import { useEffect, useMemo, useRef } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesInvoices } from '@/lib/salesStore';
import { REKON_EVENT } from '@/app/agent-ai/lib/api';
import { usePembayaranRekon, kelompokkanPerInvoice, totalDalamProses, sudahDiterapkan, type PembayaranRekon } from './useBankCashRekon';

const STATUS_SALES_DIPAKAI = ['Posted', 'Partial', 'Paid'];

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
  outstanding: number;
  receiptStatus: ReceiptStatus;
  isOverdue: boolean;
  /** Pembayaran hasil rekonsiliasi bank untuk invoice ini (mutasi bank + jurnal). */
  rekon: PembayaranRekon[];
  /** Nominal yang sudah dicocokkan tetapi jurnalnya belum diposting (invoice belum berubah). */
  dalamProses: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function useCashReceiptsFromSales(): {
  rows: CashReceiptRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  // [FIX] client_id = activeClientId (management_clients.id) -- lihat catatan di usePurchaseCashPayments.ts
  const { activeClientId } = useActiveClient();
  const { invoices, loading, error, refresh } = useSalesInvoices(activeClientId);
  const { payments, loading: loadingRekon, refresh: refreshRekon } = usePembayaranRekon();
  const perInvoice = useMemo(() => kelompokkanPerInvoice(payments), [payments]);

  // Invoice Sales baru berubah saat jurnal rekon diposting -> muat ulang saat data rekonsiliasi berubah.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const onBerubah = () => refreshRef.current();
    window.addEventListener(REKON_EVENT, onBerubah);
    return () => window.removeEventListener(REKON_EVENT, onBerubah);
  }, []);

  const rows = useMemo<CashReceiptRow[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!activeClientId) return [];
    return invoices
      .filter(i => i.management_client_id === activeClientId)
      .filter(i => STATUS_SALES_DIPAKAI.includes(i.posting_status))
      .map(i => {
        const total = Number(i.gross_amount) || 0;
        const received = Math.min(Math.max(Number(i.paid_amount) || 0, 0), total);
        const outstanding = Math.max(Number(i.outstanding_amount) || 0, 0);
        const receiptStatus: ReceiptStatus =
          i.posting_status === 'Paid' || outstanding === 0 ? 'paid' : received > 0 ? 'partial' : 'unpaid';
        const dueDate = i.due_date || '';
        return {
          id: i.id,
          invoiceNo: i.invoice_no,
          customer: i.customer_name,
          description: i.description || '',
          category: i.transaction_type || 'Other',
          date: i.invoice_date,
          dueDate,
          total,
          received,
          outstanding,
          receiptStatus,
          isOverdue: outstanding > 0 && !!dueDate && dueDate < today,
          rekon: perInvoice.get(i.id) || [],
          dalamProses: totalDalamProses(perInvoice.get(i.id)),
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [invoices, activeClientId, perInvoice]);

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
export function trenBulananDiterima(rows: CashReceiptRow[]): { month: string; total: number; count: number }[] {
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

export function customerTerbesar(rows: CashReceiptRow[], limit = 5): { name: string; amount: number }[] {
  const peta = new Map<string, number>();
  rows.forEach(r => peta.set(r.customer || '—', (peta.get(r.customer || '—') || 0) + r.total));
  return Array.from(peta.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, limit);
}