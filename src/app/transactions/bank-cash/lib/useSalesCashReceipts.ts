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
//   - Sales belum punya tanggal penerimaan, jadi tren bulanan memakai tanggal
//     invoice (invoice_date).
//
// SCOPE CLIENT (disamakan dengan Bank Feed / Reconciliation / Exceptions):
//   - [FIX] Fetch ke backend memakai client_id = activeClientId (management_clients.id;
//     sebelumnya user.id sehingga tab selalu kosong). Catatan lama: (FK tabel ke
//     management_users), TAPI baris yang ditampilkan disaring lagi berdasarkan
//     management_client_id === activeClientId (dropdown "Switch Company"),
//     supaya tab ini ikut berganti saat company diganti.
//   - Invoice lama yang management_client_id-nya masih NULL tidak akan tampil
//     sampai di-backfill (lihat catatan migrasi).

import { useMemo } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesInvoices } from '@/lib/salesStore';

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
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [invoices, activeClientId]);

  return { rows, loading, error, refresh };
}

/** Tren bulanan nominal diterima. Tahun = tahun invoice terbaru (default: tahun berjalan). */
export function trenBulananDiterima(rows: CashReceiptRow[]): { month: string; total: number; count: number }[] {
  const tahunTerbaru = rows.reduce((maks, r) => {
    const y = new Date(r.date).getFullYear();
    return Number.isFinite(y) && y > maks ? y : maks;
  }, 0);
  const tahun = tahunTerbaru || new Date().getFullYear();
  const bulan = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  rows.forEach(r => {
    const d = new Date(r.date);
    if (isNaN(d.getTime()) || d.getFullYear() !== tahun) return;
    bulan[d.getMonth()].total += r.received;
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
