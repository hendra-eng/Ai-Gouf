// [BARU] ─── JEMBATAN PURCHASE (SUPABASE) → HALAMAN PURCHASE ───────────────
// Satu-satunya tempat yang mengambil data mentah 6 tabel Supabase modul
// Purchase (vendor, purchase_transaction, purchase_line_items, source_data,
// purchase_journal_lines, exceptions -- lihat GET /api/client/{id}/purchase
// di main.py) dan memetakannya ke tipe PurchaseTransaction/PurchaseLine/
// PurchaseSourceRecord/PurchaseException yang SUDAH dipakai semua halaman
// di src/app/transactions/purchase/*. Sebelum modul ini ada, halaman-halaman
// itu membaca array statis kosong dari src/data/purchaseData.ts.
//
// Field bebas (status/severity/tipe dokumen dsb di database cuma varchar,
// bukan enum) dinormalisasi lewat matchEnum() -- toleran beda kapitalisasi/
// spasi/underscore, jatuh ke nilai default kalau tidak ada yang cocok,
// supaya satu ketidakcocokan penulisan tidak bikin seluruh baris gagal
// tampil.
'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { purchaseDataClient } from '@/app/agent-ai/lib/api';
import type {
  PurchaseLine,
  PurchaseTransaction,
  PurchaseSourceRecord,
  PurchaseException,
  PurchaseStatus,
  PaymentStatus,
  PurchaseCategory,
  SourceDocType,
  ExceptionType,
  ExceptionSeverity,
  ExceptionStatus,
} from '@/data/purchaseData';

// ─── Bentuk mentah dari backend (lihat db_client.py::ambil_data_purchase) ──
interface RawVendor { id: string; name: string }
interface RawTransaction {
  id: string; purchase_id: string; vendor_id: string | null;
  invoice_no: string | null; po_number: string | null; category: string | null;
  period: string | null; payment_terms: string | null; currency: string | null;
  source: string | null; purchase_date: string | null; invoice_date: string | null;
  posting_date: string | null; due_date: string | null; subtotal: number; discount: number;
  tax: number; total_payable: number; payment_status: string | null; status: string | null;
  prepared_by: string | null; approved_by: string | null; posted_by: string | null;
  description: string | null; created_at: string | null; updated_at: string | null;
}
interface RawLineItem {
  id: string; purchase_id: string; item_code: string | null; item_name: string | null;
  qty: number; unit: string | null; unit_price: number; discount: number; tax_rate: number;
  tax_amount: number; subtotal: number; total: number; gl_account: string | null;
}
interface RawSourceData {
  id: string; source_id: string | null; type: string | null; vendor: string | null;
  date: string | null; invoice_no: string | null; po_number: string | null; amount: number;
  tax: number; total: number; purchase_ref: string | null; validation: string | null;
  status: string | null;
}
interface RawJournalLine {
  id: string; purchase_id: string; account_code: string | null; account_name: string | null;
  description: string | null; debit: number; credit: number;
}
interface RawException {
  id: string; purchase_id: string | null; reason: string | null; severity: string | null;
  exception_status: string | null; created_at: string | null;
}
interface RawPurchaseResponse {
  vendor: RawVendor[];
  purchase_transaction: RawTransaction[];
  purchase_line_items: RawLineItem[];
  source_data: RawSourceData[];
  purchase_journal_lines: RawJournalLine[];
  exceptions: RawException[];
}

// ─── Helper umum ────────────────────────────────────────────────────────────
// [FIX BUG] Sebelumnya "Partial" (nilai asli di kolom payment_status pada
// database, lihat CHECK constraint purchase_transaction_payment_status_check)
// tidak pernah cocok dengan enum frontend 'partially_paid' -- norm("Partial")
// = "partial", norm("partially_paid") = "partiallypaid", dua string itu beda
// walau dibandingkan case/spasi/underscore-insensitive. Akibatnya transaksi
// dengan payment_status = "Partial" selalu jatuh ke fallback 'unpaid' dan
// tampil salah sebagai "Unpaid" di UI. Alias eksplisit di bawah menutup celah
// itu tanpa mengubah data di database (datanya sendiri sudah benar).
const ENUM_ALIASES: Record<string, string> = {
  partial: 'partiallypaid',
};

function matchEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const norm = (s: string) => {
    const base = s.toLowerCase().replace(/[\s_-]+/g, '');
    return ENUM_ALIASES[base] ?? base;
  };
  const target = norm(raw);
  const found = allowed.find((a) => norm(a) === target);
  return found ?? fallback;
}

const PURCHASE_STATUSES: PurchaseStatus[] = ['draft', 'pending_review', 'approved', 'pending_posting', 'posted', 'rejected', 'exception', 'cancelled'];
const PAYMENT_STATUSES: PaymentStatus[] = ['unpaid', 'partially_paid', 'paid', 'overdue', 'on_hold'];
const PURCHASE_CATEGORIES: PurchaseCategory[] = ['Inventory', 'Office Supplies', 'IT Equipment', 'Professional Services', 'Utilities', 'Maintenance', 'Marketing', 'Travel', 'Fixed Assets', 'Raw Materials', 'Logistics', 'Other'];
const SOURCE_DOC_TYPES: SourceDocType[] = ['Purchase Order', 'Vendor Invoice', 'Goods Receipt', 'Service Receipt', 'Supplier Bill', 'Expense Claim', 'Recurring Purchase', 'Manual'];
const EXCEPTION_SEVERITIES: ExceptionSeverity[] = ['Critical', 'High', 'Medium', 'Low'];
const EXCEPTION_STATUSES: ExceptionStatus[] = ['Open', 'Under Review', 'Requires Correction', 'Resolved', 'Ignored'];
const SOURCE_RECORD_STATUSES = ['Mapped', 'Pending Mapping', 'Validation Error', 'Imported'] as const;
const VALIDATION_STATUSES = ['Valid', 'Pending Validation', 'Invalid'] as const;

// exceptions.reason di database cuma teks bebas (bukan kolom "tipe") --
// dicocokkan ke ExceptionType terdekat lewat kata kunci supaya halaman
// Exceptions tetap bisa mengelompokkan/menyaring per tipe.
const EXCEPTION_TYPE_KEYWORDS: [RegExp, ExceptionType][] = [
  [/invoice.*number|nomor.*invoice/i, 'Missing Invoice Number'],
  [/duplicate|duplikat/i, 'Duplicate Invoice'],
  [/vendor/i, 'Invalid Vendor'],
  [/purchase order|\bpo\b.*mismatch|po tidak sesuai/i, 'Purchase Order Mismatch'],
  [/missing.*purchase order|po.*(hilang|tidak ada)/i, 'Missing Purchase Order'],
  [/price|harga/i, 'Price Mismatch'],
  [/tax|pajak/i, 'Tax Mismatch'],
  [/approval|persetujuan/i, 'Missing Approval'],
  [/period|periode.*tutup|closed/i, 'Closed Accounting Period'],
  [/posting|jurnal/i, 'Posting Failure'],
  [/qty|quantity|kuantitas|jumlah barang/i, 'Quantity Mismatch'],
];
function guessExceptionType(reason: string | null | undefined): ExceptionType {
  const text = reason || '';
  for (const [pattern, type] of EXCEPTION_TYPE_KEYWORDS) {
    if (pattern.test(text)) return type;
  }
  return 'Missing Documentation';
}

function toIsoDate(v: string | null | undefined): string {
  return v || '';
}

function periodLabelFromDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Pemetaan raw -> tipe frontend ──────────────────────────────────────────
function mapVendors(raw: RawVendor[]) {
  return raw.map((v) => ({ id: v.id, name: v.name, category: '', paymentTerms: '' }));
}

function buildAccountNameLookup(journalLines: RawJournalLine[]): Map<string, string> {
  const lookup = new Map<string, string>();
  journalLines.forEach((j) => {
    if (j.account_code && j.account_name && !lookup.has(j.account_code)) {
      lookup.set(j.account_code, j.account_name);
    }
  });
  return lookup;
}

function mapLineItems(raw: RawLineItem[], accountNameLookup: Map<string, string>): PurchaseLine[] {
  return raw.map((li) => ({
    id: li.id,
    itemCode: li.item_code || undefined,
    description: li.item_name || '',
    quantity: li.qty,
    unit: li.unit || '',
    unitPrice: li.unit_price,
    discount: li.discount,
    taxRate: li.tax_rate,
    taxAmount: li.tax_amount,
    subtotal: li.subtotal,
    total: li.total,
    accountCode: li.gl_account || '',
    accountName: (li.gl_account && accountNameLookup.get(li.gl_account)) || li.gl_account || '',
  }));
}

function mapTransactions(
  raw: RawTransaction[],
  vendorNameById: Map<string, string>,
  linesByPurchaseId: Map<string, PurchaseLine[]>,
): PurchaseTransaction[] {
  return raw.map((t) => ({
    id: t.id,
    purchaseId: t.purchase_id,
    purchaseDate: toIsoDate(t.purchase_date),
    invoiceDate: toIsoDate(t.invoice_date),
    invoiceNumber: t.invoice_no || '',
    poNumber: t.po_number || '',
    vendor: (t.vendor_id && vendorNameById.get(t.vendor_id)) || 'Vendor Tidak Diketahui',
    vendorId: t.vendor_id || '',
    sourceDocType: matchEnum(t.source, SOURCE_DOC_TYPES, 'Manual'),
    sourceRef: t.po_number || t.invoice_no || '',
    description: t.description || '',
    category: matchEnum(t.category, PURCHASE_CATEGORIES, 'Other'),
    subtotal: t.subtotal,
    discount: t.discount,
    taxAmount: t.tax,
    total: t.subtotal - t.discount + t.tax,
    accountsPayable: t.total_payable,
    currency: t.currency || 'USD',
    paymentStatus: matchEnum(t.payment_status, PAYMENT_STATUSES, 'unpaid'),
    paymentTerms: t.payment_terms || '',
    dueDate: toIsoDate(t.due_date),
    status: matchEnum(t.status, PURCHASE_STATUSES, 'draft'),
    period: t.period || periodLabelFromDate(t.purchase_date),
    createdBy: t.prepared_by || '',
    approvedBy: t.approved_by || undefined,
    createdDate: toIsoDate(t.created_at),
    updatedDate: toIsoDate(t.updated_at),
    lines: linesByPurchaseId.get(t.purchase_id) || [],
    postingDate: t.posting_date || undefined,
    postedBy: t.posted_by || undefined,
  }));
}

function mapSourceRecords(
  raw: RawSourceData[],
  transactionByPurchaseId: Map<string, RawTransaction>,
): PurchaseSourceRecord[] {
  return raw.map((s) => {
    const related = s.purchase_ref ? transactionByPurchaseId.get(s.purchase_ref) : undefined;
    return {
      id: s.id,
      sourceId: s.source_id || '',
      sourceType: matchEnum(s.type, SOURCE_DOC_TYPES, 'Manual'),
      vendor: s.vendor || 'Vendor Tidak Diketahui',
      vendorId: related?.vendor_id || '',
      sourceDate: toIsoDate(s.date),
      invoiceNumber: s.invoice_no || '',
      poNumber: s.po_number || '',
      description: [s.type, s.invoice_no].filter(Boolean).join(' — ') || s.source_id || '',
      amount: s.amount,
      taxAmount: s.tax,
      totalAmount: s.total,
      currency: related?.currency || 'USD',
      status: matchEnum(s.status, SOURCE_RECORD_STATUSES, 'Pending Mapping'),
      relatedPurchaseId: s.purchase_ref || null,
      period: periodLabelFromDate(s.date),
      createdBy: '',
      createdDate: toIsoDate(s.date),
      validationStatus: matchEnum(s.validation, VALIDATION_STATUSES, 'Pending Validation'),
    };
  });
}

function mapExceptions(
  raw: RawException[],
  transactionByPurchaseId: Map<string, RawTransaction>,
  vendorNameById: Map<string, string>,
): PurchaseException[] {
  return raw.map((e) => {
    const related = e.purchase_id ? transactionByPurchaseId.get(e.purchase_id) : undefined;
    return {
      id: e.id,
      purchaseId: e.purchase_id || '',
      exceptionType: guessExceptionType(e.reason),
      severity: matchEnum(e.severity, EXCEPTION_SEVERITIES, 'Medium'),
      vendor: (related?.vendor_id && vendorNameById.get(related.vendor_id)) || '',
      invoiceNumber: related?.invoice_no || '',
      purchaseDate: related?.purchase_date || toIsoDate(e.created_at),
      amount: related?.total_payable || 0,
      currency: related?.currency || 'USD',
      description: e.reason || '',
      detectedDate: toIsoDate(e.created_at),
      assignedTo: '',
      status: matchEnum(e.exception_status, EXCEPTION_STATUSES, 'Open'),
      period: periodLabelFromDate(e.created_at),
    };
  });
}

export interface PurchaseOverviewKPIs {
  totalPurchases: number;
  totalAmount: number;
  pendingReview: number;
  approved: number;
  posted: number;
  exceptions: number;
  totalTax: number;
  totalAP: number;
  overdueAmount: number;
  thisMonthAmount: number;
}

/** Dipakai juga langsung oleh page.tsx kalau perlu hitung ulang dari daftar yang sudah difilter. */
export function computePurchaseOverviewKPIs(purchaseTransactions: PurchaseTransaction[]): PurchaseOverviewKPIs {
  const now = new Date();
  return {
    totalPurchases: purchaseTransactions.length,
    totalAmount: purchaseTransactions.reduce((s, p) => s + p.total, 0),
    pendingReview: purchaseTransactions.filter((p) => p.status === 'pending_review').length,
    approved: purchaseTransactions.filter((p) => p.status === 'approved').length,
    posted: purchaseTransactions.filter((p) => p.status === 'posted').length,
    exceptions: purchaseTransactions.filter((p) => p.status === 'exception').length,
    totalTax: purchaseTransactions.reduce((s, p) => s + p.taxAmount, 0),
    totalAP: purchaseTransactions.filter((p) => p.paymentStatus !== 'paid').reduce((s, p) => s + p.accountsPayable, 0),
    overdueAmount: purchaseTransactions.filter((p) => p.paymentStatus === 'overdue').reduce((s, p) => s + p.total, 0),
    // [FIX] Sebelumnya dibandingkan ke string bulan hardcode ("Sep 2026"),
    // jadi otomatis basi begitu bulan berganti. Sekarang dicek dari
    // purchaseDate asli terhadap bulan+tahun berjalan.
    thisMonthAmount: purchaseTransactions
      .filter((p) => {
        const d = new Date(p.purchaseDate);
        return !isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, p) => s + p.total, 0),
  };
}

export interface PurchaseVendorSummary { id: string; name: string; category: string; paymentTerms: string }

export interface PurchaseBridgeData {
  loading: boolean;
  isSampleData: boolean;
  vendors: PurchaseVendorSummary[];
  purchaseTransactions: PurchaseTransaction[];
  purchaseSourceRecords: PurchaseSourceRecord[];
  purchaseExceptions: PurchaseException[];
  purchaseOverviewKPIs: PurchaseOverviewKPIs;
  /** ID client aktif -- dibutuhkan halaman pemanggil untuk memanggil
   * updatePurchaseStatus/bulkUpdatePurchaseStatus/updatePurchaseExceptionStatus
   * dari '@/app/agent-ai/lib/api' secara langsung. null kalau belum ada
   * client aktif. */
  activeClientId: string | number | null;
  /** Ambil ulang data dari Supabase -- panggil ini setelah mutasi
   * (approve/reject/post/resolve exception/dll) berhasil supaya halaman
   * langsung menampilkan status terbaru, bukan cache lama. */
  refetch: () => void;
}

const EMPTY: Omit<PurchaseBridgeData, 'activeClientId' | 'refetch'> = {
  loading: false,
  isSampleData: true,
  vendors: [],
  purchaseTransactions: [],
  purchaseSourceRecords: [],
  purchaseExceptions: [],
  purchaseOverviewKPIs: computePurchaseOverviewKPIs([]),
};

/**
 * Hook utama modul Purchase -- panggil ini di tiap halaman
 * `transactions/purchase/*` sebagai pengganti import statis dari
 * `@/data/purchaseData`. Otomatis mengikuti client aktif (Topbar "Switch
 * Company") dan fallback ke state kosong (BUKAN data contoh palsu) kalau
 * belum ada data/gagal fetch, konsisten dengan pola "honest empty state"
 * yang sudah dipakai tab Sales lainnya.
 */
type PurchaseQueryData = Omit<PurchaseBridgeData, 'loading' | 'isSampleData' | 'activeClientId' | 'refetch'>;

async function fetchPurchaseData(activeClientId: string | number): Promise<PurchaseQueryData> {
  const res = (await purchaseDataClient(activeClientId)) as RawPurchaseResponse;

  const vendorNameById = new Map(res.vendor.map((v) => [v.id, v.name]));
  const accountNameLookup = buildAccountNameLookup(res.purchase_journal_lines || []);
  const lines = mapLineItems(res.purchase_line_items || [], accountNameLookup);
  const linesByPurchaseId = new Map<string, PurchaseLine[]>();
  (res.purchase_line_items || []).forEach((li, idx) => {
    const arr = linesByPurchaseId.get(li.purchase_id) || [];
    arr.push(lines[idx]);
    linesByPurchaseId.set(li.purchase_id, arr);
  });
  const transactionByPurchaseId = new Map(res.purchase_transaction.map((t) => [t.purchase_id, t]));

  const purchaseTransactions = mapTransactions(res.purchase_transaction || [], vendorNameById, linesByPurchaseId);
  const purchaseSourceRecords = mapSourceRecords(res.source_data || [], transactionByPurchaseId);
  const purchaseExceptions = mapExceptions(res.exceptions || [], transactionByPurchaseId, vendorNameById);

  return {
    vendors: mapVendors(res.vendor || []),
    purchaseTransactions,
    purchaseSourceRecords,
    purchaseExceptions,
    purchaseOverviewKPIs: computePurchaseOverviewKPIs(purchaseTransactions),
  };
}

/**
 * [DIUBAH -- pakai TanStack Query] Data di-cache per activeClientId lewat
 * queryKey ['purchase', activeClientId]. Begitu satu client pernah
 * di-fetch, pindah tab (Overview/Transaction/Source Data/Posted/dst) baca
 * dari cache ini -- instan, tidak fetch ulang ke backend. Ganti ke client
 * lain baru trigger fetch baru; balik lagi ke client sebelumnya (dalam
 * gcTime yang diset di QueryClientProvider) juga instan dari cache.
 */
export function usePurchaseData(): PurchaseBridgeData {
  const { activeClientId, hydrated } = useActiveClient();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['purchase', activeClientId],
    queryFn: () => fetchPurchaseData(activeClientId as string | number),
    // [FIX flash-ke-0] Jangan enable query dulu sebelum context selesai
    // baca client aktif dari localStorage -- sebelumnya `!!activeClientId`
    // saja bikin query ini "enabled: false" sesaat di render pertama
    // (activeClientId masih null), sehingga `data` tetap undefined dan
    // halaman langsung menampilkan EMPTY (nilai 0) sebelum activeClientId
    // asli sempat terbaca.
    enabled: hydrated && !!activeClientId,
  });

  const refetch = useCallback(() => {
    if (!activeClientId) return;
    queryClient.invalidateQueries({ queryKey: ['purchase', activeClientId] });
  }, [queryClient, activeClientId]);

  const adaDataReal = !!data && data.purchaseTransactions.length > 0;
  // Selama belum hydrated, anggap masih loading (bukan "sudah pasti kosong").
  const loading = !hydrated || isLoading;

  if (!data) {
    return { ...EMPTY, loading, activeClientId: activeClientId ?? null, refetch };
  }
  return { ...data, loading, isSampleData: !adaDataReal, activeClientId: activeClientId ?? null, refetch };
}