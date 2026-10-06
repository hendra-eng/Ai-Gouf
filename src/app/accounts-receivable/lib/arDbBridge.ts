'use client';
// ─── JEMBATAN SUPABASE → ACCOUNTS RECEIVABLE (tabel resmi) ────────────────
// Sumber data halaman Accounts Receivable = 4 tabel AR di schema
// "3_Financial" (customer master + invoice + payment + collection note),
// lewat backend GET /api/client/{id}/ar (db_client.py::ambil_data_ar).
// Modul ini SATU-SATUNYA tempat yang menerjemahkan data mentah 4 tabel itu
// jadi Invoice[] / Customer[] (tipe di @/lib/mockData), supaya fungsi
// turunan di arBridge.ts (arKpisFromInvoices, arAgingFromInvoices,
// arTrendFromInvoices, sparklineFromTrend, collectionForecastFromInvoices)
// bisa dipakai TANPA diubah.
//
// [DIUBAH -- halaman AR dituntaskan]
//  * Halaman TIDAK LAGI jatuh balik ke turunan transaksi Sales. Tabel AR
//    adalah sumber tunggal, karena hanya baris di tabel inilah yang bisa
//    dicatat pembayarannya / diberi catatan / ditandai Disputed.
//  * Hook sekarang juga mengembalikan riwayat pembayaran & catatan, plus
//    fungsi tulis (recordPayment, addNote, setInvoiceStatus) yang otomatis
//    memuat ulang data setelah berhasil.
//  * 'Written Off' tidak lagi dihitung sebagai piutang berjalan
//    (outstanding = 0), supaya total AR, aging, dan forecast tidak
//    menggelembung oleh piutang yang sudah dihapuskan.
//  * DSO dihitung dari hari penagihan yang sebenarnya (tanggal bayar terakhir
//    - tanggal invoice pada invoice yang sudah lunas); kalau belum ada
//    riwayat lunas, dipakai syarat bayar customer (payment_terms_days).
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { arDataClient, catatPembayaranAr, tambahCatatanAr, ubahStatusInvoiceAr } from '@/app/agent-ai/lib/api';
import type { Customer, Invoice, ARStatus, RiskLevel } from '@/lib/mockData';

// ─── Bentuk data mentah dari backend ───────────────────────────────────────
interface RawARCustomer {
  id: string;
  customer_key: string;
  name: string;
  industry: string | null;
  credit_limit: number;
  account_manager: string | null;
  payment_terms_days: number;
  npwp: string | null;
  alamat: string | null;
  aktif: boolean;
}
interface RawARInvoice {
  id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  manual_status: string | null;
  journal_entry_id?: number | null;
}
interface RawARPayment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  method: string | null;
  reference: string | null;
  created_by?: string | null;
  created_at?: string | null;
}
interface RawARCollectionNote {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  note_type: string;
  content: string;
  created_by: string | null;
  created_at: string;
}
interface RawARResponse {
  customer: RawARCustomer[];
  invoice: RawARInvoice[];
  payment: RawARPayment[];
  collection_note: RawARCollectionNote[];
}

// ─── Bentuk tampilan ───────────────────────────────────────────────────────
/** Catatan penagihan -- dipakai CustomerDetailPanel/InvoiceDetailPanel. */
export interface CollectionNoteView {
  id: string;
  customerId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  noteType: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

/** Satu pembayaran invoice (riwayat pembayaran customer/invoice). */
export interface PaymentView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  createdBy: string;
}

export interface ARMappedData {
  invoices: Invoice[];
  customers: Customer[];
  collectionNotes: CollectionNoteView[];
  payments: PaymentView[];
}

// ─── Utilitas ──────────────────────────────────────────────────────────────
function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** Tanggal lokal hari ini (YYYY-MM-DD), bukan UTC -- supaya tidak mundur sehari di pagi hari WIB/WITA. */
export function localTodayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sama dengan invoicePriority() di arBridge.ts, ditambah 'Disputed' -> High (butuh perhatian seperti Overdue ringan). */
function invoicePriority(status: ARStatus, daysOverdue: number): Invoice['priority'] {
  if (status === 'Overdue') return daysOverdue > 45 ? 'Critical' : 'High';
  if (status === 'Disputed') return 'High';
  if (status === 'Due Soon') return 'Medium';
  return 'Low';
}

/**
 * Ubah baris mentah 4 tabel AR jadi Invoice[]/Customer[]/catatan/pembayaran
 * siap pakai. Diexport terpisah (bukan hanya di dalam hook) supaya bisa
 * dites/dipanggil manual.
 */
export function mapARResponseToInvoicesAndCustomers(
  res: RawARResponse,
  refDate: string = localTodayISO()
): ARMappedData {
  const customerRows = res.customer || [];
  const invoiceRows = res.invoice || [];
  const paymentRows = res.payment || [];
  const noteRows = res.collection_note || [];
  const custById = new Map(customerRows.map((c) => [c.id, c]));

  // Total dibayar & tanggal pembayaran terakhir per invoice (satu invoice bisa dicicil beberapa kali).
  const paidByInvoice = new Map<string, number>();
  const lastPaymentDateByInvoice = new Map<string, string>();
  paymentRows.forEach((p) => {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + Number(p.amount));
    const prev = lastPaymentDateByInvoice.get(p.invoice_id);
    if (!prev || p.payment_date > prev) lastPaymentDateByInvoice.set(p.invoice_id, p.payment_date);
  });

  const invoices: Invoice[] = invoiceRows
    .map((inv) => {
      const cust = custById.get(inv.customer_id);
      const amount = Number(inv.amount);
      const paid = Math.min(amount, round2(paidByInvoice.get(inv.id) || 0));
      const writtenOff = inv.manual_status === 'Written Off';
      // Piutang yang sudah dihapuskan (write-off) tidak lagi berjalan.
      const outstanding = writtenOff ? 0 : Math.max(0, round2(amount - paid));
      const daysOverdue = outstanding > 0 ? Math.max(0, daysBetween(inv.due_date, refDate)) : 0;

      // manual_status ('Disputed'/'Written Off') menang mutlak atas
      // perhitungan otomatis -- sesuai desain kolom di Supabase.
      let status: ARStatus;
      if (inv.manual_status === 'Disputed' || inv.manual_status === 'Written Off') {
        status = inv.manual_status;
      } else if (outstanding <= 0) {
        status = 'Paid';
      } else if (daysOverdue > 0) {
        status = 'Overdue';
      } else if (paid > 0) {
        status = 'Partially Paid';
      } else if (daysBetween(refDate, inv.due_date) <= 7) {
        status = 'Due Soon';
      } else {
        status = 'Open';
      }

      return {
        id: inv.id,
        number: inv.invoice_number,
        customerId: inv.customer_id,
        customerName: cust?.name || 'Pelanggan Tidak Diketahui',
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        amount,
        paid,
        outstanding,
        daysOverdue,
        status,
        priority: invoicePriority(status, daysOverdue),
        accountManager: cust?.account_manager || '—',
      } satisfies Invoice;
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const invoicesByCustomer = new Map<string, Invoice[]>();
  invoices.forEach((inv) => {
    const list = invoicesByCustomer.get(inv.customerId) || [];
    list.push(inv);
    invoicesByCustomer.set(inv.customerId, list);
  });

  // Riwayat pembayaran (terbaru dulu) -- lengkap dengan nomor invoice & nama customer.
  const payments: PaymentView[] = paymentRows
    .map((p) => {
      const inv = invoiceById.get(p.invoice_id);
      return {
        id: p.id,
        invoiceId: p.invoice_id,
        invoiceNumber: inv?.number || '—',
        customerId: inv?.customerId || '',
        customerName: inv?.customerName || 'Pelanggan Tidak Diketahui',
        date: p.payment_date,
        amount: Number(p.amount),
        method: p.method || '—',
        reference: p.reference || '—',
        createdBy: p.created_by || '—',
      } satisfies PaymentView;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const paymentsByCustomer = new Map<string, PaymentView[]>();
  payments.forEach((p) => {
    const list = paymentsByCustomer.get(p.customerId) || [];
    list.push(p);
    paymentsByCustomer.set(p.customerId, list);
  });

  // Customer diambil dari MASTER (ar_customer), bukan cuma yang muncul di
  // invoice -- jadi customer aktif tanpa invoice pun tetap muncul di tab "Customers".
  const customers: Customer[] = customerRows
    .map((cust) => {
      const custInvoices = invoicesByCustomer.get(cust.id) || [];
      const totalAR = custInvoices.reduce((s, i) => s + i.outstanding, 0);
      const overdueAR = custInvoices.filter((i) => i.status === 'Overdue').reduce((s, i) => s + i.outstanding, 0);
      const dueSoon = custInvoices.filter((i) => i.status === 'Due Soon').reduce((s, i) => s + i.outstanding, 0);
      const currentAR = Math.max(0, totalAR - overdueAR - dueSoon);
      const ar90Plus = custInvoices.filter((i) => i.daysOverdue > 90).reduce((s, i) => s + i.outstanding, 0);

      // DSO = rata-rata hari penagihan sebenarnya (invoice lunas, bukan write-off);
      // belum ada yang lunas -> pakai syarat bayar customer.
      const collectionDays = custInvoices
        .filter((i) => i.status === 'Paid' && lastPaymentDateByInvoice.has(i.id))
        .map((i) => Math.max(0, daysBetween(i.invoiceDate, lastPaymentDateByInvoice.get(i.id) as string)));
      const dso = collectionDays.length
        ? Math.round(collectionDays.reduce((s, d) => s + d, 0) / collectionDays.length)
        : cust.payment_terms_days || 30;

      const totalBilled = custInvoices.reduce((s, i) => s + i.amount, 0);
      const totalCollected = custInvoices.reduce((s, i) => s + i.paid, 0);
      const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 100;
      const unpaidSorted = custInvoices.filter((i) => i.outstanding > 0).sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
      const maxDaysOverdue = Math.max(0, ...custInvoices.map((i) => i.daysOverdue));
      const riskLevel: RiskLevel = maxDaysOverdue > 90 ? 'Critical' : overdueAR > 0 ? 'High' : dueSoon > 0 ? 'Medium' : 'Low';
      const creditLimit = Number(cust.credit_limit) || 0;
      const creditUtilization = creditLimit > 0 ? Math.round((totalAR / creditLimit) * 1000) / 10 : 0;
      const lastPayment = (paymentsByCustomer.get(cust.id) || [])[0]?.date || '—';

      return {
        id: cust.id,
        name: cust.name,
        code: cust.customer_key,
        industry: cust.industry || 'Tidak Diketahui',
        creditLimit,
        totalAR,
        currentAR,
        overdueAR,
        ar90Plus,
        dso,
        collectionRate,
        riskLevel,
        lastPayment,
        nextExpectedPayment: unpaidSorted[0]?.dueDate || '—',
        accountManager: cust.account_manager || '—',
        creditUtilization,
      } satisfies Customer;
    })
    .sort((a, b) => b.totalAR - a.totalAR);

  const collectionNotes: CollectionNoteView[] = noteRows
    .map((n) => ({
      id: n.id,
      customerId: n.customer_id,
      invoiceId: n.invoice_id,
      invoiceNumber: n.invoice_id ? invoiceById.get(n.invoice_id)?.number || null : null,
      noteType: n.note_type,
      content: n.content,
      createdBy: n.created_by || '—',
      createdAt: n.created_at,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return { invoices, customers, collectionNotes, payments };
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export interface RecordPaymentInput {
  invoiceId: string;
  paymentDate: string; // YYYY-MM-DD
  amount: number;
  method?: string;
  reference?: string;
}
export interface RecordPaymentResult {
  berhasil: boolean;
  pembayaran: { invoice_number: string; sisa_tagihan: number; lunas: boolean };
}
export interface AddNoteInput {
  customerId: string;
  invoiceId?: string | null;
  content: string;
  noteType?: string;
}
export type ManualInvoiceStatus = 'Disputed' | 'Written Off' | null;

export interface ARBridgeData extends ARMappedData {
  /** true selama data pertama kali dimuat. */
  loading: boolean;
  /** true saat sedang memuat ulang (mis. setelah tombol refresh / catat pembayaran). */
  isFetching: boolean;
  /** Pesan error kalau gagal memuat; null kalau tidak ada. */
  error: string | null;
  /** true kalau client aktif belum punya satu pun customer/invoice di 4 tabel AR. */
  isEmpty: boolean;
  activeClientId: string | number | null;
  refetch: () => void;
  recordPayment: (input: RecordPaymentInput) => Promise<RecordPaymentResult>;
  addNote: (input: AddNoteInput) => Promise<void>;
  setInvoiceStatus: (invoiceId: string, status: ManualInvoiceStatus, alasan?: string) => Promise<void>;
}

const EMPTY_DATA: ARMappedData = { invoices: [], customers: [], collectionNotes: [], payments: [] };

async function fetchARData(activeClientId: string | number): Promise<ARMappedData> {
  const res = (await arDataClient(activeClientId)) as RawARResponse;
  return mapARResponseToInvoicesAndCustomers(res);
}

/**
 * Hook Account Receivable dari tabel resmi Supabase. Data di-cache per
 * activeClientId lewat TanStack Query (queryKey ['ar', activeClientId]).
 */
export function useARData(): ARBridgeData {
  const { activeClientId, hydrated } = useActiveClient();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['ar', activeClientId],
    queryFn: () => fetchARData(activeClientId as string | number),
    enabled: hydrated && !!activeClientId,
  });

  const muatUlang = useCallback(async () => {
    if (!activeClientId) return;
    await queryClient.invalidateQueries({ queryKey: ['ar', activeClientId] });
  }, [queryClient, activeClientId]);

  const refetch = useCallback(() => {
    void muatUlang();
  }, [muatUlang]);

  const requireClient = useCallback((): string | number => {
    if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
    return activeClientId;
  }, [activeClientId]);

  const recordPayment = useCallback(
    async (input: RecordPaymentInput) => {
      const res = (await catatPembayaranAr(
        requireClient(), input.invoiceId, input.paymentDate, input.amount, input.method, input.reference
      )) as RecordPaymentResult;
      await muatUlang();
      return res;
    },
    [requireClient, muatUlang]
  );

  const addNote = useCallback(
    async (input: AddNoteInput) => {
      await tambahCatatanAr(requireClient(), input.customerId, input.content, input.invoiceId, input.noteType);
      await muatUlang();
    },
    [requireClient, muatUlang]
  );

  const setInvoiceStatus = useCallback(
    async (invoiceId: string, status: ManualInvoiceStatus, alasan?: string) => {
      await ubahStatusInvoiceAr(requireClient(), invoiceId, status, alasan);
      await muatUlang();
    },
    [requireClient, muatUlang]
  );

  const mapped = data || EMPTY_DATA;
  return {
    ...mapped,
    loading: !hydrated || isLoading,
    isFetching,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    isEmpty: !!data && data.customers.length === 0 && data.invoices.length === 0,
    activeClientId: activeClientId ?? null,
    refetch,
    recordPayment,
    addNote,
    setInvoiceStatus,
  };
}
