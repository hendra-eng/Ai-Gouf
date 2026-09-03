// [BARU] ─── JEMBATAN EXPENSE → ACCOUNT PAYABLE ────────────────────────────
// Modul ini adalah SATU-SATUNYA tempat yang menerjemahkan transaksi di
// kelompok "Expense" (halaman Transaksi → Expense) menjadi bentuk data yang
// dipakai halaman Account Payable (Vendor & Bill). Sebelumnya halaman AP
// punya data mock sendiri yang sama sekali terpisah dari Transaksi — sekarang
// SEMUA transaksi Expense, apapun status posting-nya (Unposted/Posted/Draft/
// Reconciled/Voided), otomatis diikutkan di sini; yang membedakan
// "sudah jadi tagihan terbuka atau tidak" adalah field `paymentStatus` /
// `dueDate` / `paidAmount` (lihat transactionData.ts), BUKAN field `status`.
//
// Kalau butuh ubah cara AP menghitung sesuatu (mis. definisi "Due Soon",
// aging bucket, dsb), cukup ubah di sini — halaman AP tinggal pakai hasilnya.
import { Transaction, getTransactionGroup } from '../components/transactionData';
import type { Vendor, Bill, APStatus, RiskLevel, CollectionPriority } from '@/lib/mockData';

// Tanggal acuan "hari ini" untuk perhitungan Overdue/Due Soon — disamakan
// dengan label "Last updated" yang selama ini tampil statis di header
// halaman Account Payable, supaya konsisten.
export const AP_REFERENCE_DATE = '2026-08-28';

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// ID vendor dibuat deterministik dari nama pihak (party) supaya transaksi
// Expense dengan vendor yang sama selalu ke-mapping ke satu baris Vendor
// yang sama di AP, walau datanya berubah-ubah (tambah/edit transaksi).
function vendorIdFromParty(party: string): string {
  const slug = (party || 'vendor-tidak-diketahui')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `vend-exp-${slug || 'unknown'}`;
}

function vendorCodeFromParty(party: string, index: number): string {
  const initials = (party || 'VN')
    .replace(/^(PT|CV|UD)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
  return `${initials || 'VN'}-${String(index + 1).padStart(3, '0')}`;
}

/** Nominal yang sudah dibayar untuk satu transaksi Expense (0 s/d amount). */
export function expensePaidAmount(tx: Transaction): number {
  const amount = tx.debit || 0;
  if (tx.paymentStatus === 'Lunas') return amount;
  if (tx.paymentStatus === 'Sebagian Dibayar') return Math.min(amount, Math.max(0, tx.paidAmount || 0));
  return 0;
}

/** Sisa yang masih harus dibayar ke vendor (jadi saldo AP transaksi ini). */
export function expenseOutstanding(tx: Transaction): number {
  return Math.max(0, (tx.debit || 0) - expensePaidAmount(tx));
}

/** Jumlah hari keterlambatan dari tanggal jatuh tempo terhadap tanggal acuan (0 kalau belum jatuh tempo / sudah lunas). */
export function expenseDaysOverdue(tx: Transaction, refDate: string = AP_REFERENCE_DATE): number {
  if (expenseOutstanding(tx) <= 0) return 0;
  const due = tx.dueDate || tx.date;
  const diff = daysBetween(due, refDate); // positif = refDate sesudah due -> terlambat
  return diff > 0 ? diff : 0;
}

/** Status ala Account Payable (Paid/Overdue/Due Soon/Pending Approval/Open) untuk satu transaksi Expense. */
export function expenseBillStatus(tx: Transaction, refDate: string = AP_REFERENCE_DATE): APStatus {
  if (expenseOutstanding(tx) <= 0) return 'Paid';
  const daysOverdue = expenseDaysOverdue(tx, refDate);
  if (daysOverdue > 0) return 'Overdue';
  const due = tx.dueDate || tx.date;
  const daysUntilDue = daysBetween(refDate, due); // positif = jatuh tempo di masa depan
  if (daysUntilDue <= 7) return 'Due Soon';
  if (tx.status === 'Draft' || tx.status === 'Unposted') return 'Pending Approval';
  return 'Open';
}

function expenseBillPriority(status: APStatus, daysOverdue: number): CollectionPriority {
  if (status === 'Overdue') return daysOverdue > 45 ? 'Critical' : 'High';
  if (status === 'Due Soon') return 'Medium';
  return 'Low';
}

function expensePaymentMethod(tx: Transaction): string {
  const cat = (tx.category || '').toLowerCase();
  if (cat === 'utilities' || cat === 'software') return 'Auto Debit';
  if ((tx.party || '').toLowerCase().includes('petty cash')) return 'Cash';
  return 'Bank Transfer';
}

// [BARU] ─── AKSI DARI ACCOUNTS PAYABLE → TULIS BALIK KE TRANSAKSI EXPENSE ──
// Tombol "Mark Paid" / "Schedule Payment" di halaman AP sebelumnya cuma
// menampilkan toast tanpa benar-benar mengubah data (koneksi satu arah,
// Expense -> AP doang). Dua fungsi di bawah ini membuat aksi tsb benar-benar
// menulis balik ke transaksi Expense sumbernya (lewat saveEdit() dari
// TransactionsContext) supaya kalau user tekan "Mark Paid" di AP, transaksi
// yang sama di halaman Expense juga langsung ikut berubah jadi "Lunas" —
// dan sebaliknya, karena AP dihitung ulang dari transaksi, tagihan itu hilang
// dari daftar AP yang belum lunas.

/** Tandai transaksi Expense sumber satu Bill sebagai Lunas (dibayar penuh). */
export function markExpenseTxPaid(tx: Transaction): Transaction {
  return { ...tx, paymentStatus: 'Lunas', paidAmount: tx.debit || 0 };
}

/** Jadwalkan ulang tanggal jatuh tempo transaksi Expense sumber satu Bill. */
export function rescheduleExpenseTx(tx: Transaction, newDueDateISO: string): Transaction {
  return { ...tx, dueDate: newDueDateISO };
}

/** Satu transaksi Expense -> satu baris Bill (tagihan) di Account Payable. */
export function billFromExpenseTx(tx: Transaction, refDate: string = AP_REFERENCE_DATE): Bill {
  const daysOverdue = expenseDaysOverdue(tx, refDate);
  const status = expenseBillStatus(tx, refDate);
  return {
    id: tx.id,
    number: tx.txId,
    vendorId: vendorIdFromParty(tx.party),
    vendorName: tx.party || 'Vendor Tidak Diketahui',
    billDate: tx.date,
    dueDate: tx.dueDate || tx.date,
    amount: tx.debit || 0,
    paid: expensePaidAmount(tx),
    outstanding: expenseOutstanding(tx),
    daysOverdue,
    status,
    priority: expenseBillPriority(status, daysOverdue),
    paymentMethod: expensePaymentMethod(tx),
    approvalStatus: tx.status === 'Draft' || tx.status === 'Unposted' ? 'Pending' : 'Approved',
  };
}

/**
 * Filter + konversi SEMUA transaksi Expense (apapun status posting-nya) jadi
 * daftar Bill. Ini fungsi utama yang dipakai halaman AP sebagai pengganti
 * `bills` mock lama.
 */
export function billsFromTransactions(transactions: Transaction[], refDate: string = AP_REFERENCE_DATE): Bill[] {
  return transactions
    .filter((tx) => getTransactionGroup(tx) === 'expense')
    .map((tx) => billFromExpenseTx(tx, refDate))
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}

const STATUS_RANK: Record<string, number> = { 'Overdue': 4, 'Due Soon': 3, 'Pending Approval': 2, 'Open': 1, 'Paid': 0 };

/** Kelompokkan Bill per vendor (party) jadi baris Vendor untuk tab "Vendors". */
export function vendorsFromBills(bills: Bill[]): Vendor[] {
  const byVendor = new Map<string, Bill[]>();
  bills.forEach((b) => {
    const list = byVendor.get(b.vendorId) || [];
    list.push(b);
    byVendor.set(b.vendorId, list);
  });

  return Array.from(byVendor.entries())
    .map(([vendorId, vendorBills], index) => {
      const name = vendorBills[0].vendorName;
      const totalAP = vendorBills.reduce((s, b) => s + b.outstanding, 0);
      const overdueAP = vendorBills.filter((b) => b.status === 'Overdue').reduce((s, b) => s + b.outstanding, 0);
      const dueSoon = vendorBills.filter((b) => b.status === 'Due Soon').reduce((s, b) => s + b.outstanding, 0);
      const currentAP = Math.max(0, totalAP - overdueAP - dueSoon);
      const maxDaysOverdue = Math.max(0, ...vendorBills.map((b) => b.daysOverdue));
      const avgPaymentDays = Math.round(
        vendorBills.reduce((s, b) => s + Math.max(0, daysBetween(b.billDate, b.dueDate)), 0) / vendorBills.length
      ) || 30;
      const unpaidSorted = vendorBills
        .filter((b) => b.outstanding > 0)
        .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
      const riskLevel: RiskLevel = maxDaysOverdue > 60 ? 'Critical' : overdueAP > 0 ? 'High' : dueSoon > 0 ? 'Medium' : 'Low';
      const worstStatus = vendorBills.reduce((worst, b) => (STATUS_RANK[b.status] > STATUS_RANK[worst] ? b.status : worst), 'Paid' as APStatus);

      return {
        id: vendorId,
        name,
        code: vendorCodeFromParty(name, index),
        category: vendorBills[0] ? mostCommonCategoryLabel(vendorBills) : 'Lainnya',
        totalAP,
        currentAP,
        overdueAP,
        dueSoon,
        paymentTerms: `Net ${avgPaymentDays}`,
        avgPaymentDays,
        creditExposure: totalAP,
        riskLevel,
        nextPayment: unpaidSorted[0]?.dueDate || '—',
        status: worstStatus === 'Paid' ? 'Open' : worstStatus,
      } satisfies Vendor;
    })
    .sort((a, b) => b.totalAP - a.totalAP);
}

// Label kategori vendor ditampilkan pakai nama akun/beban transaksi
// pertamanya saja (mis. "Beban Software & Lisensi") — cukup deskriptif tanpa
// perlu daftar mapping kategori vendor terpisah.
function mostCommonCategoryLabel(bills: Bill[]): string {
  return 'Vendor Operasional';
}

export interface APKpis {
  totalAP: number;
  currentAP: number;
  overdueAP: number;
  dueSoonAP: number;
  dueThisWeek: number;
  dueThisWeekCount: number;
  dueThisMonth: number;
  dueThisMonthCount: number;
  avgPaymentDays: number;
  paymentForecast30d: number;
  vendorConcentrationPct: number;
}

/** Angka-angka KPI di header halaman AP, dihitung langsung dari daftar Bill. */
export function apKpisFromBills(bills: Bill[], vendors: Vendor[], refDate: string = AP_REFERENCE_DATE): APKpis {
  const totalAP = bills.reduce((s, b) => s + b.outstanding, 0);
  const overdueAP = bills.filter((b) => b.status === 'Overdue').reduce((s, b) => s + b.outstanding, 0);
  const dueSoonAP = bills.filter((b) => b.status === 'Due Soon').reduce((s, b) => s + b.outstanding, 0);
  const currentAP = Math.max(0, totalAP - overdueAP - dueSoonAP);

  const dueThisWeekBills = bills.filter((b) => b.outstanding > 0 && daysBetween(refDate, b.dueDate) >= 0 && daysBetween(refDate, b.dueDate) <= 7);
  const dueThisMonthBills = bills.filter((b) => b.outstanding > 0 && daysBetween(refDate, b.dueDate) >= 0 && daysBetween(refDate, b.dueDate) <= 30);

  const avgPaymentDays = Math.round(
    vendors.reduce((s, v) => s + v.avgPaymentDays, 0) / (vendors.length || 1)
  ) || 0;

  const top10Total = vendors.slice(0, 10).reduce((s, v) => s + v.totalAP, 0);
  const vendorConcentrationPct = totalAP > 0 ? Math.round((top10Total / totalAP) * 1000) / 10 : 0;

  return {
    totalAP,
    currentAP,
    overdueAP,
    dueSoonAP,
    dueThisWeek: dueThisWeekBills.reduce((s, b) => s + b.outstanding, 0),
    dueThisWeekCount: dueThisWeekBills.length,
    dueThisMonth: dueThisMonthBills.reduce((s, b) => s + b.outstanding, 0),
    dueThisMonthCount: dueThisMonthBills.length,
    avgPaymentDays,
    paymentForecast30d: dueThisMonthBills.reduce((s, b) => s + b.outstanding, 0),
    vendorConcentrationPct,
  };
}

// ─── AGING & TREN — untuk chart di tab Overview ────────────────────────────
const AGING_BUCKETS: { bucket: string; min: number; max: number; color: string }[] = [
  { bucket: 'Current', min: -Infinity, max: 0, color: '#16A34A' },
  { bucket: '1–30 Days', min: 1, max: 30, color: '#2563EB' },
  { bucket: '31–60 Days', min: 31, max: 60, color: '#D97706' },
  { bucket: '61–90 Days', min: 61, max: 90, color: '#EA580C' },
  { bucket: '90+ Days', min: 91, max: Infinity, color: '#DC2626' },
];

export function apAgingFromBills(bills: Bill[]) {
  const totals = AGING_BUCKETS.map((b) => ({ ...b, amount: 0 }));
  bills.forEach((bill) => {
    if (bill.outstanding <= 0) {
      totals[0].amount += bill.outstanding; // tidak pernah terjadi (outstanding 0), dijaga saja
      return;
    }
    const bucketIndex = bill.daysOverdue <= 0
      ? 0
      : AGING_BUCKETS.findIndex((b) => bill.daysOverdue >= b.min && bill.daysOverdue <= b.max);
    const idx = bucketIndex === -1 ? totals.length - 1 : bucketIndex;
    totals[idx].amount += bill.outstanding;
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

/** Tren bulanan New Bills vs Payments — dihitung dari billDate transaksi Expense yang sesungguhnya. */
export function apTrendFromBills(bills: Bill[]) {
  const byMonth = new Map<number, { newBills: number; payments: number }>();
  bills.forEach((b) => {
    const d = new Date(b.billDate);
    if (isNaN(d.getTime())) return;
    const m = d.getMonth();
    const entry = byMonth.get(m) || { newBills: 0, payments: 0 };
    entry.newBills += b.amount;
    entry.payments += b.paid;
    byMonth.set(m, entry);
  });

  let openingAP = 0;
  const monthsWithData = Array.from(byMonth.keys()).sort((a, b) => a - b);
  const firstMonth = monthsWithData[0] ?? new Date().getMonth();
  const lastMonth = monthsWithData[monthsWithData.length - 1] ?? new Date().getMonth();

  const rows: { month: string; openingAP: number; newBills: number; payments: number; closingAP: number }[] = [];
  for (let m = firstMonth; m <= lastMonth; m++) {
    const entry = byMonth.get(m) || { newBills: 0, payments: 0 };
    const closingAP = Math.max(0, openingAP + entry.newBills - entry.payments);
    rows.push({ month: MONTH_LABELS[m], openingAP, newBills: entry.newBills, payments: entry.payments, closingAP });
    openingAP = closingAP;
  }
  return rows;
}

/** Ambil N angka terakhir dari tren closingAP untuk dipakai sebagai data sparkline KPI card. */
export function sparklineFromTrend(trend: { closingAP: number }[], points = 8): number[] {
  const values = trend.map((t) => t.closingAP);
  if (values.length === 0) return Array.from({ length: points }, () => 0);
  while (values.length < points) values.unshift(values[0]);
  return values.slice(-points);
}

export interface PaymentForecastBucket {
  period: string;
  amount: number;
  bills: number;
}

/** Kebutuhan kas ke depan (Today / This Week / Next Week / This Month), dihitung dari dueDate transaksi Expense. */
export function paymentForecastFromBills(bills: Bill[], refDate: string = AP_REFERENCE_DATE): PaymentForecastBucket[] {
  const unpaid = bills.filter((b) => b.outstanding > 0);
  const bucket = (label: string, minDay: number, maxDay: number): PaymentForecastBucket => {
    const inBucket = unpaid.filter((b) => {
      const d = daysBetween(refDate, b.dueDate);
      return d >= minDay && d <= maxDay;
    });
    return { period: label, amount: inBucket.reduce((s, b) => s + b.outstanding, 0), bills: inBucket.length };
  };
  return [
    bucket('Today', -Infinity, 0),
    bucket('This Week', 1, 7),
    bucket('Next Week', 8, 14),
    bucket('This Month', 1, 30),
  ];
}
