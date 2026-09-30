'use client';

// ─── SUMBER DATA CASH PAYMENT = HALAMAN PURCHASE ───────────────────────────
// Tab Cash Payment (Cash & Bank) TIDAK lagi membaca finance_transaction_bank_cash /
// jurnal_posting. Datanya diambil dari transaksi Purchase (usePurchaseTransactions,
// pola yang sama dengan halaman Purchase: client_id = id akun yang login).
//
// Aturan yang dipakai (ubah di sini kalau berbeda dari maksudmu):
//   - Hanya transaksi Purchase berstatus 'posted' (hutang sudah tercatat).
//   - Nominal dibayar / sisa dihitung dari payment_status + accounts_payable:
//       paid            -> dibayar = total,            sisa = 0
//       partially_paid  -> sisa = accounts_payable,    dibayar = total - sisa
//       unpaid/overdue/on_hold -> dibayar = 0,         sisa = total
//   - Tren bulanan: pembayaran hasil rekonsiliasi yang sudah diposting memakai
//     tanggal bayar (payment_date); sisa yang tidak berasal dari rekonsiliasi
//     (input manual di Purchase) memakai tanggal pembelian (purchaseDate).
//
// SCOPE CLIENT (disamakan dengan Bank Feed / Reconciliation / Exceptions):
//   - [FIX] Fetch ke backend memakai client_id = activeClientId (id
//     management_clients dari "Switch Company"). Di database live, kolom
//     client_id tabel purchase merujuk management_clients, BUKAN
//     management_users -- memakai user.id membuat filter tidak pernah cocok
//     dan tab ini selalu kosong. Baris tetap disaring lagi berdasarkan
//     management_client_id === activeClientId.
//   - Transaksi lama yang management_client_id-nya masih NULL tidak akan
//     tampil sampai di-backfill (lihat catatan migrasi).

import { useEffect, useMemo, useRef } from 'react';
import { REKON_EVENT } from '@/app/agent-ai/lib/api';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, mapTransactionToUi } from '@/lib/purchaseStore';
import type { PaymentStatus } from '@/data/purchaseData';
import { usePembayaranRekon, kelompokkanPerInvoice, totalDalamProses, sudahDiterapkan, type PembayaranRekon } from './useBankCashRekon';

const STATUS_PURCHASE_DIPAKAI = ['posted'];

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
  outstanding: number;
  paymentStatus: PaymentStatus;
  isOverdue: boolean;
  /** Pembayaran hasil rekonsiliasi bank untuk invoice ini (mutasi bank + jurnal). */
  rekon: PembayaranRekon[];
  /** Nominal yang sudah dicocokkan tetapi jurnalnya belum diposting (invoice belum berubah). */
  dalamProses: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function hitungNominal(total: number, accountsPayable: number, status: PaymentStatus) {
  if (status === 'paid') return { paid: total, outstanding: 0 };
  if (status === 'partially_paid') {
    const sisa = Math.min(Math.max(accountsPayable || 0, 0), total);
    return { paid: total - sisa, outstanding: sisa };
  }
  return { paid: 0, outstanding: total };
}

export function useCashPaymentsFromPurchase(): {
  rows: CashPaymentRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { activeClientId } = useActiveClient();
  const { transactions, loading, error, refresh } = usePurchaseTransactions(activeClientId);
  const { payments, loading: loadingRekon, refresh: refreshRekon } = usePembayaranRekon();
  const perInvoice = useMemo(() => kelompokkanPerInvoice(payments), [payments]);

  // Invoice Purchase baru berubah saat jurnal rekon diposting -> muat ulang saat data rekonsiliasi berubah.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const onBerubah = () => refreshRef.current();
    window.addEventListener(REKON_EVENT, onBerubah);
    return () => window.removeEventListener(REKON_EVENT, onBerubah);
  }, []);

  const rows = useMemo<CashPaymentRow[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!activeClientId) return [];
    return transactions
      .filter(t => t.management_client_id === activeClientId)
      .filter(t => STATUS_PURCHASE_DIPAKAI.includes(t.status))
      .map(t => {
        const ui = mapTransactionToUi(t);
        const { paid, outstanding } = hitungNominal(ui.total, ui.accountsPayable, ui.paymentStatus);
        const isOverdue = ui.paymentStatus === 'overdue' || (outstanding > 0 && !!ui.dueDate && ui.dueDate < today);
        return {
          id: ui.id,
          purchaseId: ui.purchaseId,
          invoiceNumber: ui.invoiceNumber,
          vendor: ui.vendor,
          description: ui.description,
          category: ui.category,
          date: ui.purchaseDate,
          dueDate: ui.dueDate,
          total: ui.total,
          paid,
          outstanding,
          paymentStatus: ui.paymentStatus,
          isOverdue,
          rekon: perInvoice.get(ui.id) || [],
          dalamProses: totalDalamProses(perInvoice.get(ui.id)),
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, activeClientId, perInvoice]);

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