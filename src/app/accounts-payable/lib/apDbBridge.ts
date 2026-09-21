'use client';
// ─── JEMBATAN SUPABASE → ACCOUNTS PAYABLE (tabel resmi) ────────────────────
// Sumber data halaman Accounts Payable = vendor & bill dari modul Purchase
// (financial_transaction_purchase_vendor / financial_transaction_purchase_
// transaction, sudah tersambung sejak halaman Purchase) + 2 tabel BARU
// khusus AP (financial_account_payable_ap_payment, financial_account_
// payable_ap_note), semuanya di schema "3_Financial", lewat backend
// GET /api/client/{id}/ap (db_client.py::ambil_data_ap).
//
// Modul ini SATU-SATUNYA tempat yang menerjemahkan data mentah itu jadi
// Bill[]/Vendor[] (tipe di @/lib/mockData) dari SUMBER TABEL -- supaya
// fungsi turunan yang sudah ada di apBridge.ts (vendorsFromBills,
// apKpisFromBills, apAgingFromBills, apTrendFromBills, sparklineFromTrend,
// paymentForecastFromBills) bisa dipakai TANPA diubah, sama seperti pola
// arDbBridge.ts memakai ulang arBridge.ts.
//
// Pola sama dengan AR yang sudah dituntaskan: halaman TIDAK LAGI jatuh
// balik ke turunan transaksi Purchase/Expense (apBridge.ts's
// billsFromTransactions) -- tabel Purchase + 2 tabel AP inilah SUMBER
// TUNGGAL, karena hanya baris di sinilah yang bisa dicatat pembayarannya /
// diberi catatan / ditandai Disputed/On Hold.
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { apDataClient, catatPembayaranAp, tambahCatatanAp, ubahStatusBillAp } from '@/app/agent-ai/lib/api';
import { vendorsFromBills, getApReferenceDate } from '@/app/transactions/lib/apBridge';
import type { Vendor, Bill, APStatus } from '@/lib/mockData';

// ─── Bentuk data mentah dari backend ───────────────────────────────────────
interface RawAPVendor {
  id: string;
  name: string;
}
interface RawAPBill {
  id: string;
  purchase_id: string;
  vendor_id: string | null;
  invoice_no: string | null;
  category: string | null;
  purchase_date: string | null;
  due_date: string | null;
  total_payable: number;
  payment_status: string | null;
  status: string | null;
  manual_status: string | null;
}
interface RawAPPayment {
  id: string;
  bill_id: string;
  payment_date: string;
  amount: number;
  status: string; // 'Scheduled' | 'Paid' | 'Cancelled'
  method: string | null;
  reference_no: string | null;
  recorded_by?: string | null;
  created_at?: string | null;
}
interface RawAPNote {
  id: string;
  vendor_id: string;
  bill_id: string | null;
  content: string;
  created_by: string | null;
  created_at: string;
}
interface RawAPResponse {
  vendor: RawAPVendor[];
  bill: RawAPBill[];
  payment: RawAPPayment[];
  note: RawAPNote[];
}

// ─── Bentuk tampilan ───────────────────────────────────────────────────────
/** Catatan internal AP -- dipakai VendorDetailPanel/BillDetailPanel. */
export interface APNoteView {
  id: string;
  vendorId: string;
  billId: string | null;
  billNumber: string | null;
  content: string;
  createdBy: string;
  createdAt: string;
}

/** Satu pembayaran/rencana bayar bill (riwayat pembayaran vendor/bill). */
export interface APPaymentView {
  id: string;
  billId: string;
  billNumber: string;
  vendorId: string;
  vendorName: string;
  date: string;
  amount: number;
  status: string;
  method: string;
  referenceNo: string;
  recordedBy: string;
}

export interface APMappedData {
  bills: Bill[];
  vendors: Vendor[];
  notes: APNoteView[];
  payments: APPaymentView[];
}

// ─── Utilitas ──────────────────────────────────────────────────────────────
function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sama dengan purchaseBillPriority() di apBridge.ts, ditambah 'Disputed'/'On Hold' -> High. */
function billPriority(status: APStatus, daysOverdue: number): Bill['priority'] {
  if (status === 'Overdue') return daysOverdue > 45 ? 'Critical' : 'High';
  if (status === 'Disputed' || status === 'On Hold') return 'High';
  if (status === 'Due Soon') return 'Medium';
  return 'Low';
}

/**
 * Ubah baris mentah (vendor, bill, payment, note) jadi Bill[]/Vendor[]/
 * catatan/pembayaran siap pakai. Diexport terpisah supaya bisa
 * dites/dipanggil manual -- sama seperti mapARResponseToInvoicesAndCustomers.
 */
export function mapAPResponseToBillsAndVendors(
  res: RawAPResponse,
  refDate: string = getApReferenceDate()
): APMappedData {
  const vendorRows = res.vendor || [];
  const billRows = res.bill || [];
  const paymentRows = res.payment || [];
  const noteRows = res.note || [];
  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

  // Total dibayar (hanya status 'Paid' -- 'Scheduled' baru rencana, belum
  // mengurangi sisa tagihan, sesuai comment tabel di Supabase) & tanggal
  // pembayaran terakhir per bill.
  const paidByBill = new Map<string, number>();
  const lastPaymentDateByBill = new Map<string, string>();
  const hasScheduledByBill = new Set<string>();
  paymentRows.forEach((p) => {
    if (p.status === 'Paid') {
      paidByBill.set(p.bill_id, (paidByBill.get(p.bill_id) || 0) + Number(p.amount));
      const prev = lastPaymentDateByBill.get(p.bill_id);
      if (!prev || p.payment_date > prev) lastPaymentDateByBill.set(p.bill_id, p.payment_date);
    } else if (p.status === 'Scheduled') {
      hasScheduledByBill.add(p.bill_id);
    }
  });

  const bills: Bill[] = billRows
    .map((b) => {
      const vendor = b.vendor_id ? vendorById.get(b.vendor_id) : undefined;
      const amount = Number(b.total_payable) || 0;
      const paid = Math.min(amount, round2(paidByBill.get(b.id) || 0));
      const outstanding = Math.max(0, round2(amount - paid));
      const dueDate = b.due_date || b.purchase_date || refDate;
      const billDate = b.purchase_date || dueDate;
      const daysOverdue = outstanding > 0 ? Math.max(0, daysBetween(dueDate, refDate)) : 0;

      // manual_status ('Disputed'/'On Hold') menang mutlak atas perhitungan
      // otomatis -- sesuai desain kolom di Supabase (sama seperti AR).
      let status: APStatus;
      if (b.manual_status === 'Disputed' || b.manual_status === 'On Hold') {
        status = b.manual_status;
      } else if (outstanding <= 0) {
        status = 'Paid';
      } else if (daysOverdue > 0) {
        status = 'Overdue';
      } else if (hasScheduledByBill.has(b.id)) {
        status = 'Scheduled';
      } else if (b.status === 'Pending Review') {
        status = 'Pending Approval';
      } else if (daysBetween(refDate, dueDate) <= 7) {
        status = 'Due Soon';
      } else {
        status = 'Open';
      }

      return {
        id: b.id,
        number: b.invoice_no || b.purchase_id,
        vendorId: b.vendor_id || 'vend-tidak-diketahui',
        vendorName: vendor?.name || 'Vendor Tidak Diketahui',
        billDate,
        dueDate,
        amount,
        paid,
        outstanding,
        daysOverdue,
        status,
        priority: billPriority(status, daysOverdue),
        paymentMethod: '—', // diisi ulang di bawah dari pembayaran terakhir
        approvalStatus: b.status === 'Pending Review' ? 'Pending' : 'Approved',
        category: b.category || undefined,
      } satisfies Bill;
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));

  const billById = new Map(bills.map((b) => [b.id, b]));

  // Riwayat pembayaran (terbaru dulu) -- lengkap dengan nomor bill & nama vendor.
  const lastMethodByBill = new Map<string, string>();
  paymentRows.forEach((p) => {
    if (p.status === 'Paid' && p.method) lastMethodByBill.set(p.bill_id, p.method);
  });
  bills.forEach((b) => {
    const method = lastMethodByBill.get(b.id);
    if (method) b.paymentMethod = method;
  });

  const payments: APPaymentView[] = paymentRows
    .map((p) => {
      const bill = billById.get(p.bill_id);
      return {
        id: p.id,
        billId: p.bill_id,
        billNumber: bill?.number || '—',
        vendorId: bill?.vendorId || '',
        vendorName: bill?.vendorName || 'Vendor Tidak Diketahui',
        date: p.payment_date,
        amount: Number(p.amount),
        status: p.status,
        method: p.method || '—',
        referenceNo: p.reference_no || '—',
        recordedBy: p.recorded_by || '—',
      } satisfies APPaymentView;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const notes: APNoteView[] = noteRows
    .map((n) => ({
      id: n.id,
      vendorId: n.vendor_id,
      billId: n.bill_id,
      billNumber: n.bill_id ? billById.get(n.bill_id)?.number || null : null,
      content: n.content,
      createdBy: n.created_by || '—',
      createdAt: n.created_at,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Vendor tanpa bill (aktif tapi belum ada tagihan) tetap tampil di tab
  // "Vendors" -- reuse vendorsFromBills lalu tambahkan vendor master yang
  // belum kebagian bill sama sekali.
  const vendorsWithBills = vendorsFromBills(bills);
  const vendorIdsWithBills = new Set(vendorsWithBills.map((v) => v.id));
  const emptyVendors: Vendor[] = vendorRows
    .filter((v) => !vendorIdsWithBills.has(v.id))
    .map((v) => ({
      id: v.id,
      name: v.name,
      code: v.id.slice(0, 8).toUpperCase(),
      category: 'Lainnya',
      totalAP: 0,
      currentAP: 0,
      overdueAP: 0,
      dueSoon: 0,
      paymentTerms: 'Net 30',
      avgPaymentDays: 30,
      creditExposure: 0,
      riskLevel: 'Low',
      nextPayment: '—',
      status: 'Open',
    } satisfies Vendor));
  const vendors = [...vendorsWithBills, ...emptyVendors];

  return { bills, vendors, notes, payments };
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export interface RecordPaymentInput {
  billId: string;
  paymentDate: string; // YYYY-MM-DD
  amount: number;
  status?: string; // 'Scheduled' | 'Paid' (default) | 'Cancelled'
  method?: string;
  referenceNo?: string;
}
export interface RecordPaymentResult {
  berhasil: boolean;
  pembayaran: { purchase_id: string; status: string };
}
export interface AddNoteInput {
  vendorId: string;
  billId?: string | null;
  content: string;
}
export type ManualBillStatus = 'Disputed' | 'On Hold' | null;

export interface APBridgeData extends APMappedData {
  /** true selama data pertama kali dimuat. */
  loading: boolean;
  /** true saat sedang memuat ulang (mis. setelah tombol refresh / catat pembayaran). */
  isFetching: boolean;
  /** Pesan error kalau gagal memuat; null kalau tidak ada. */
  error: string | null;
  /** true kalau client aktif belum punya satu pun vendor/bill di modul ini. */
  isEmpty: boolean;
  activeClientId: string | number | null;
  refetch: () => void;
  recordPayment: (input: RecordPaymentInput) => Promise<RecordPaymentResult>;
  addNote: (input: AddNoteInput) => Promise<void>;
  setBillStatus: (billId: string, status: ManualBillStatus, alasan?: string) => Promise<void>;
}

const EMPTY_DATA: APMappedData = { bills: [], vendors: [], notes: [], payments: [] };

async function fetchAPData(activeClientId: string | number): Promise<APMappedData> {
  const res = (await apDataClient(activeClientId)) as RawAPResponse;
  return mapAPResponseToBillsAndVendors(res);
}

/**
 * Hook Account Payable dari tabel resmi Supabase. Data di-cache per
 * activeClientId lewat TanStack Query (queryKey ['ap', activeClientId]) --
 * pola sama persis dengan useARData().
 */
export function useAPData(): APBridgeData {
  const { activeClientId, hydrated } = useActiveClient();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['ap', activeClientId],
    queryFn: () => fetchAPData(activeClientId as string | number),
    enabled: hydrated && !!activeClientId,
  });

  const muatUlang = useCallback(async () => {
    if (!activeClientId) return;
    await queryClient.invalidateQueries({ queryKey: ['ap', activeClientId] });
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
      const res = (await catatPembayaranAp(
        requireClient(), input.billId, input.paymentDate, input.amount,
        input.status, input.method, input.referenceNo
      )) as RecordPaymentResult;
      await muatUlang();
      return res;
    },
    [requireClient, muatUlang]
  );

  const addNote = useCallback(
    async (input: AddNoteInput) => {
      await tambahCatatanAp(requireClient(), input.vendorId, input.content, input.billId || undefined);
      await muatUlang();
    },
    [requireClient, muatUlang]
  );

  const setBillStatus = useCallback(
    async (billId: string, status: ManualBillStatus, alasan?: string) => {
      await ubahStatusBillAp(requireClient(), billId, status, alasan);
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
    isEmpty: !!data && data.vendors.length === 0 && data.bills.length === 0,
    activeClientId: activeClientId ?? null,
    refetch,
    recordPayment,
    addNote,
    setBillStatus,
  };
}