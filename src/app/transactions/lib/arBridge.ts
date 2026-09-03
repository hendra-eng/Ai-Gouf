// [BARU] ─── JEMBATAN SALES → ACCOUNTS RECEIVABLE ──────────────────────────
// Sama seperti apBridge.ts (Expense -> Account Payable), modul ini adalah
// SATU-SATUNYA tempat yang menerjemahkan transaksi kelompok "Sales"
// (halaman Transaksi -> Sales) jadi bentuk data yang dipakai halaman
// Account Receivable (Customer & Invoice). Sebelumnya ARContent.tsx pakai
// `customers`/`invoices` statis dari @/lib/mockData yang sama sekali tidak
// nyambung ke Transaksi — sekarang diturunkan dari transaksi Sales yang
// sesungguhnya, sama seperti AP.
//
// PERBEDAAN PENTING dari apBridge.ts: satu transaksi Expense = satu baris
// (satu leg beban) di transactionData.ts, jadi 1 baris = 1 Bill. Tapi satu
// TRANSAKSI PENJUALAN di jurnal selalu punya DUA leg (mis. debit Kas & Bank
// + kredit Pendapatan, ATAU debit Piutang Usaha + kredit Pendapatan) —
// kalau tiap baris langsung dijadikan 1 Invoice, jumlahnya akan dobel.
// Karena itu di sini transaksi Sales DIKELOMPOKKAN dulu per `reference`
// (fallback ke jeId) sebelum diubah jadi satu baris Invoice.
import { Transaction, getTransactionGroup } from '../components/transactionData';
import type { Customer, Invoice, ARStatus, RiskLevel } from '@/lib/mockData';

export const AR_REFERENCE_DATE = '2026-08-28';

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function customerIdFromParty(party: string): string {
  const slug = (party || 'pelanggan-tidak-diketahui')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `cust-sales-${slug || 'unknown'}`;
}

function customerCodeFromParty(party: string, index: number): string {
  const initials = (party || 'CU')
    .replace(/^(PT|CV|UD)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
  return `${initials || 'CU'}-${String(index + 1).padStart(3, '0')}`;
}

/** Satu "invoice group": kumpulan leg transaksi (debit+kredit) milik satu reference/invoice yang sama. */
interface InvoiceGroup {
  key: string;
  rows: Transaction[];
}

/**
 * Kelompokkan transaksi Sales per invoice sesungguhnya — pakai `reference`
 * kalau ada (mis. "INV-2026-0342"), fallback ke `jeId`, fallback ke `id`
 * sendiri kalau keduanya kosong (supaya tidak ada baris yang hilang).
 */
function groupSalesByInvoice(transactions: Transaction[]): InvoiceGroup[] {
  const salesRows = transactions.filter((tx) => getTransactionGroup(tx) === 'sales');
  const byKey = new Map<string, Transaction[]>();
  salesRows.forEach((tx) => {
    const key = tx.reference || tx.jeId || tx.id;
    const list = byKey.get(key) || [];
    list.push(tx);
    byKey.set(key, list);
  });
  return Array.from(byKey.entries()).map(([key, rows]) => ({ key, rows }));
}

/** Nominal invoice = nilai terbesar di antara leg-leg group (debit & kredit satu jurnal selalu sama besar). */
function invoiceAmount(rows: Transaction[]): number {
  return rows.reduce((max, tx) => Math.max(max, tx.debit || 0, tx.credit || 0), 0);
}

/** Ambil field paymentStatus/dueDate/paidAmount dari leg mana pun di group yang mengisinya (lihat jurnalBridge.ts). */
function invoicePaymentInfo(rows: Transaction[]): { paymentStatus?: Transaction['paymentStatus']; dueDate?: string; paidAmount?: number } {
  const withInfo = rows.find((tx) => tx.paymentStatus !== undefined);
  if (!withInfo) return {};
  return { paymentStatus: withInfo.paymentStatus, dueDate: withInfo.dueDate, paidAmount: withInfo.paidAmount };
}

function invoicePaidAmount(rows: Transaction[], amount: number): number {
  const { paymentStatus, paidAmount } = invoicePaymentInfo(rows);
  if (paymentStatus === 'Lunas') return amount;
  if (paymentStatus === 'Sebagian Dibayar') return Math.min(amount, Math.max(0, paidAmount || 0));
  if (paymentStatus === 'Belum Dibayar') return 0;
  // Tidak ada info paymentStatus sama sekali (mis. data contoh lama) —
  // anggap sudah lunas, karena baris Sales tanpa penanda khusus di data
  // contoh merepresentasikan kas yang SUDAH diterima, bukan invoice terbuka.
  return amount;
}

function invoiceOutstanding(rows: Transaction[]): number {
  const amount = invoiceAmount(rows);
  return Math.max(0, amount - invoicePaidAmount(rows, amount));
}

function invoiceDaysOverdue(rows: Transaction[], dueDate: string, refDate: string = AR_REFERENCE_DATE): number {
  if (invoiceOutstanding(rows) <= 0) return 0;
  const diff = daysBetween(dueDate, refDate);
  return diff > 0 ? diff : 0;
}

function invoiceStatus(rows: Transaction[], dueDate: string, refDate: string = AR_REFERENCE_DATE): ARStatus {
  const amount = invoiceAmount(rows);
  const outstanding = invoiceOutstanding(rows);
  if (outstanding <= 0) return 'Paid';
  const paid = amount - outstanding;
  const daysOverdue = invoiceDaysOverdue(rows, dueDate, refDate);
  if (daysOverdue > 0) return 'Overdue';
  if (paid > 0) return 'Partially Paid';
  const daysUntilDue = daysBetween(refDate, dueDate);
  if (daysUntilDue <= 7) return 'Due Soon';
  return 'Open';
}

function invoicePriority(status: ARStatus, daysOverdue: number): Invoice['priority'] {
  if (status === 'Overdue') return daysOverdue > 45 ? 'Critical' : 'High';
  if (status === 'Due Soon') return 'Medium';
  return 'Low';
}

/** Satu group invoice Sales -> satu baris Invoice di Account Receivable. */
function invoiceFromGroup(group: InvoiceGroup, refDate: string = AR_REFERENCE_DATE): Invoice {
  const { rows, key } = group;
  const first = rows[0];
  const date = rows.reduce((min, tx) => (tx.date < min ? tx.date : min), first.date);
  const { dueDate: infoDueDate } = invoicePaymentInfo(rows);
  const dueDate = infoDueDate || date;
  const amount = invoiceAmount(rows);
  const outstanding = invoiceOutstanding(rows);
  const paid = amount - outstanding;
  const daysOverdue = invoiceDaysOverdue(rows, dueDate, refDate);
  const status = invoiceStatus(rows, dueDate, refDate);
  const party = rows.map((r) => r.party).find(Boolean) || 'Pelanggan Tidak Diketahui';

  return {
    id: first.id,
    number: key,
    customerId: customerIdFromParty(party),
    customerName: party,
    invoiceDate: date,
    dueDate,
    amount,
    paid,
    outstanding,
    daysOverdue,
    status,
    priority: invoicePriority(status, daysOverdue),
    accountManager: '—',
  };
}

/** Ubah SEMUA transaksi Sales jadi daftar Invoice. Pengganti `invoices` mock lama. */
export function invoicesFromTransactions(transactions: Transaction[], refDate: string = AR_REFERENCE_DATE): Invoice[] {
  return groupSalesByInvoice(transactions)
    .map((g) => invoiceFromGroup(g, refDate))
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}

const STATUS_RANK: Record<string, number> = {
  'Overdue': 5, 'Disputed': 4, 'Due Soon': 3, 'Partially Paid': 2, 'Open': 1, 'Paid': 0, 'Written Off': 0,
};

/** Kelompokkan Invoice per pelanggan (party) jadi baris Customer untuk tab "Customers". */
export function customersFromInvoices(invoices: Invoice[]): Customer[] {
  const byCustomer = new Map<string, Invoice[]>();
  invoices.forEach((inv) => {
    const list = byCustomer.get(inv.customerId) || [];
    list.push(inv);
    byCustomer.set(inv.customerId, list);
  });

  return Array.from(byCustomer.entries())
    .map(([customerId, custInvoices], index) => {
      const name = custInvoices[0].customerName;
      const totalAR = custInvoices.reduce((s, i) => s + i.outstanding, 0);
      const overdueAR = custInvoices.filter((i) => i.status === 'Overdue').reduce((s, i) => s + i.outstanding, 0);
      const dueSoon = custInvoices.filter((i) => i.status === 'Due Soon').reduce((s, i) => s + i.outstanding, 0);
      const currentAR = Math.max(0, totalAR - overdueAR - dueSoon);
      const ar90Plus = custInvoices.filter((i) => i.daysOverdue > 90).reduce((s, i) => s + i.outstanding, 0);
      const dso = Math.round(
        custInvoices.reduce((s, i) => s + Math.max(0, daysBetween(i.invoiceDate, i.dueDate)), 0) / custInvoices.length
      ) || 30;
      const totalBilled = custInvoices.reduce((s, i) => s + i.amount, 0);
      const totalCollected = custInvoices.reduce((s, i) => s + i.paid, 0);
      const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 100;
      const paidSorted = custInvoices.filter((i) => i.outstanding === 0).sort((a, b) => (a.invoiceDate > b.invoiceDate ? -1 : 1));
      const unpaidSorted = custInvoices.filter((i) => i.outstanding > 0).sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
      const maxDaysOverdue = Math.max(0, ...custInvoices.map((i) => i.daysOverdue));
      const riskLevel: RiskLevel = maxDaysOverdue > 90 ? 'Critical' : overdueAR > 0 ? 'High' : dueSoon > 0 ? 'Medium' : 'Low';

      return {
        id: customerId,
        name,
        code: customerCodeFromParty(name, index),
        industry: 'Tidak Diketahui',
        creditLimit: 0,
        totalAR,
        currentAR,
        overdueAR,
        ar90Plus,
        dso,
        collectionRate,
        riskLevel,
        lastPayment: paidSorted[0]?.invoiceDate || '—',
        nextExpectedPayment: unpaidSorted[0]?.dueDate || '—',
        accountManager: '—',
        creditUtilization: 0,
      } satisfies Customer;
    })
    .sort((a, b) => b.totalAR - a.totalAR);
}

export interface ARKpis {
  totalAR: number;
  currentAR: number;
  overdueAR: number;
  dueSoonAR: number;
  ar90Plus: number;
  dso: number;
  collectionRate: number;
  badDebtExposure: number;
}

/** Angka-angka KPI di header halaman AR, dihitung langsung dari daftar Invoice. */
export function arKpisFromInvoices(invoices: Invoice[], customers: Customer[]): ARKpis {
  const totalAR = invoices.reduce((s, i) => s + i.outstanding, 0);
  const overdueAR = invoices.filter((i) => i.status === 'Overdue').reduce((s, i) => s + i.outstanding, 0);
  const dueSoonAR = invoices.filter((i) => i.status === 'Due Soon').reduce((s, i) => s + i.outstanding, 0);
  const currentAR = Math.max(0, totalAR - overdueAR - dueSoonAR);
  const ar90Plus = invoices.filter((i) => i.daysOverdue > 90).reduce((s, i) => s + i.outstanding, 0);
  const dso = Math.round(customers.reduce((s, c) => s + c.dso, 0) / (customers.length || 1)) || 0;
  const totalBilled = invoices.reduce((s, i) => s + i.amount, 0);
  const totalCollected = invoices.reduce((s, i) => s + i.paid, 0);
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 100;
  // "Bad debt exposure" -- perkiraan konservatif: piutang lewat 90 hari
  // dianggap berisiko tidak tertagih. Bukan angka write-off resmi (backend
  // belum punya konsep itu), murni indikator risiko dari umur piutang.
  const badDebtExposure = ar90Plus;

  return { totalAR, currentAR, overdueAR, dueSoonAR, ar90Plus, dso, collectionRate, badDebtExposure };
}

const AGING_BUCKETS: { bucket: string; min: number; max: number; color: string }[] = [
  { bucket: 'Current', min: -Infinity, max: 0, color: '#16A34A' },
  { bucket: '1–30 Days', min: 1, max: 30, color: '#2563EB' },
  { bucket: '31–60 Days', min: 31, max: 60, color: '#D97706' },
  { bucket: '61–90 Days', min: 61, max: 90, color: '#EA580C' },
  { bucket: '90+ Days', min: 91, max: Infinity, color: '#DC2626' },
];

export function arAgingFromInvoices(invoices: Invoice[]) {
  const totals = AGING_BUCKETS.map((b) => ({ ...b, amount: 0 }));
  invoices.forEach((inv) => {
    if (inv.outstanding <= 0) return;
    const bucketIndex = inv.daysOverdue <= 0
      ? 0
      : AGING_BUCKETS.findIndex((b) => inv.daysOverdue >= b.min && inv.daysOverdue <= b.max);
    const idx = bucketIndex === -1 ? totals.length - 1 : bucketIndex;
    totals[idx].amount += inv.outstanding;
  });
  const grandTotal = totals.reduce((s, b) => s + b.amount, 0) || 1;
  return totals.map(({ bucket, amount, color }) => ({
    bucket,
    amount,
    percentage: Math.round((amount / grandTotal) * 1000) / 10,
    color,
  }));
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Tren bulanan New Invoices vs Collections — dihitung dari invoiceDate transaksi Sales yang sesungguhnya. */
export function arTrendFromInvoices(invoices: Invoice[]) {
  const byMonth = new Map<number, { newInvoices: number; collections: number }>();
  invoices.forEach((inv) => {
    const d = new Date(inv.invoiceDate);
    if (isNaN(d.getTime())) return;
    const m = d.getMonth();
    const entry = byMonth.get(m) || { newInvoices: 0, collections: 0 };
    entry.newInvoices += inv.amount;
    entry.collections += inv.paid;
    byMonth.set(m, entry);
  });

  let openingAR = 0;
  const monthsWithData = Array.from(byMonth.keys()).sort((a, b) => a - b);
  const firstMonth = monthsWithData[0] ?? new Date().getMonth();
  const lastMonth = monthsWithData[monthsWithData.length - 1] ?? new Date().getMonth();

  const rows: { month: string; openingAR: number; newInvoices: number; collections: number; closingAR: number }[] = [];
  for (let m = firstMonth; m <= lastMonth; m++) {
    const entry = byMonth.get(m) || { newInvoices: 0, collections: 0 };
    const closingAR = Math.max(0, openingAR + entry.newInvoices - entry.collections);
    rows.push({ month: MONTH_LABELS[m], openingAR, newInvoices: entry.newInvoices, collections: entry.collections, closingAR });
    openingAR = closingAR;
  }
  return rows;
}

/** Ambil N angka terakhir dari tren closingAR untuk dipakai sebagai data sparkline KPI card. */
export function sparklineFromTrend(trend: { closingAR: number }[], points = 8): number[] {
  const values = trend.map((t) => t.closingAR);
  if (values.length === 0) return Array.from({ length: points }, () => 0);
  while (values.length < points) values.unshift(values[0]);
  return values.slice(-points);
}

export interface CollectionForecastBucket {
  period: string;
  expected: number;
  probability: number;
}

/** Perkiraan penagihan ke depan (7/14/30/60 hari), dihitung dari dueDate invoice terbuka. */
export function collectionForecastFromInvoices(invoices: Invoice[], refDate: string = AR_REFERENCE_DATE): CollectionForecastBucket[] {
  const unpaid = invoices.filter((i) => i.outstanding > 0);
  // Probabilitas ditagih dibuat menurun terhadap horizon waktu & makin
  // rendah kalau sudah overdue -- heuristik sederhana, BUKAN model statistik
  // (backend belum punya histori collection rate per horizon).
  const bucket = (label: string, maxDay: number, probability: number): CollectionForecastBucket => {
    const inBucket = unpaid.filter((i) => daysBetween(refDate, i.dueDate) <= maxDay);
    return { period: label, expected: inBucket.reduce((s, i) => s + i.outstanding, 0), probability };
  };
  return [
    bucket('7 days', 7, 82),
    bucket('14 days', 14, 74),
    bucket('30 days', 30, 63),
    bucket('60 days', 60, 51),
  ];
}