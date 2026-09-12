// [BARU] ─── JEMBATAN EXPENSE → ACCOUNT PAYABLE ────────────────────────────
// Modul ini adalah SATU-SATUNYA tempat yang menerjemahkan transaksi di
// kelompok "Purchase" (halaman Transaksi → Purchase) menjadi bentuk data yang
// dipakai halaman Account Payable (Vendor & Bill). Sebelumnya halaman AP
// punya data mock sendiri yang sama sekali terpisah dari Transaksi — sekarang
// SEMUA transaksi Purchase, apapun status posting-nya (Unposted/Posted/Draft/
// Reconciled/Voided), otomatis diikutkan di sini; yang membedakan
// "sudah jadi tagihan terbuka atau tidak" adalah field `paymentStatus` /
// `dueDate` / `paidAmount` (lihat transactionData.ts), BUKAN field `status`.
//
// Kalau butuh ubah cara AP menghitung sesuatu (mis. definisi "Due Soon",
// aging bucket, dsb), cukup ubah di sini — halaman AP tinggal pakai hasilnya.
import { Transaction, getTransactionGroup } from '../components/transactionData';
import type { Vendor, Bill, APStatus, RiskLevel, CollectionPriority } from '@/lib/mockData';

// [DIUBAH — tanggal acuan tidak lagi hardcode] Sebelumnya
// '2026-08-28' tetap (fixed string), makin lama makin basi karena tidak
// pernah ikut berjalan (Overdue/Due Soon/aging melenceng tiap hari).
// Sekarang dihitung ulang setiap kali fungsi ini dipanggil, jadi selalu
// mengikuti tanggal hari ini yang sesungguhnya. Dipakai sebagai NILAI
// DEFAULT parameter `refDate` di seluruh fungsi bawah — default parameter
// di JS/TS dievaluasi ulang setiap kali fungsi dipanggil (bukan sekali saat
// modul dimuat), jadi cukup panggil getApReferenceDate() di posisi
// `refDate: string = ...` supaya otomatis akurat setiap hari tanpa
// perlu diubah manual lagi.
export function getApReferenceDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// ID vendor dibuat deterministik dari nama pihak (party) supaya transaksi
// Purchase dengan vendor yang sama selalu ke-mapping ke satu baris Vendor
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

/** Nominal yang sudah dibayar untuk satu transaksi Purchase (0 s/d amount). */
export function purchasePaidAmount(tx: Transaction): number {
  const amount = tx.debit || 0;
  if (tx.paymentStatus === 'Lunas') return amount;
  if (tx.paymentStatus === 'Sebagian Dibayar') return Math.min(amount, Math.max(0, tx.paidAmount || 0));
  return 0;
}

/** Sisa yang masih harus dibayar ke vendor (jadi saldo AP transaksi ini). */
export function purchaseOutstanding(tx: Transaction): number {
  return Math.max(0, (tx.debit || 0) - purchasePaidAmount(tx));
}

/** Jumlah hari keterlambatan dari tanggal jatuh tempo terhadap tanggal acuan (0 kalau belum jatuh tempo / sudah lunas). */
export function purchaseDaysOverdue(tx: Transaction, refDate: string = getApReferenceDate()): number {
  if (purchaseOutstanding(tx) <= 0) return 0;
  const due = tx.dueDate || tx.date;
  const diff = daysBetween(due, refDate); // positif = refDate sesudah due -> terlambat
  return diff > 0 ? diff : 0;
}

/** Status ala Account Payable (Paid/Overdue/Due Soon/Pending Approval/Open) untuk satu transaksi Purchase. */
export function purchaseBillStatus(tx: Transaction, refDate: string = getApReferenceDate()): APStatus {
  if (purchaseOutstanding(tx) <= 0) return 'Paid';
  const daysOverdue = purchaseDaysOverdue(tx, refDate);
  if (daysOverdue > 0) return 'Overdue';
  const due = tx.dueDate || tx.date;
  const daysUntilDue = daysBetween(refDate, due); // positif = jatuh tempo di masa depan
  if (daysUntilDue <= 7) return 'Due Soon';
  if (tx.status === 'Draft' || tx.status === 'Unposted') return 'Pending Approval';
  return 'Open';
}

function purchaseBillPriority(status: APStatus, daysOverdue: number): CollectionPriority {
  if (status === 'Overdue') return daysOverdue > 45 ? 'Critical' : 'High';
  if (status === 'Due Soon') return 'Medium';
  return 'Low';
}

function purchasePaymentMethod(tx: Transaction): string {
  const cat = (tx.category || '').toLowerCase();
  if (cat === 'utilities' || cat === 'software') return 'Auto Debit';
  if ((tx.party || '').toLowerCase().includes('petty cash')) return 'Cash';
  return 'Bank Transfer';
}

// [BARU] ─── AKSI DARI ACCOUNTS PAYABLE → TULIS BALIK KE TRANSAKSI EXPENSE ──
// Tombol "Mark Paid" / "Schedule Payment" di halaman AP sebelumnya cuma
// menampilkan toast tanpa benar-benar mengubah data (koneksi satu arah,
// Purchase -> AP doang). Dua fungsi di bawah ini membuat aksi tsb benar-benar
// menulis balik ke transaksi Purchase sumbernya (lewat saveEdit() dari
// TransactionsContext) supaya kalau user tekan "Mark Paid" di AP, transaksi
// yang sama di halaman Purchase juga langsung ikut berubah jadi "Lunas" —
// dan sebaliknya, karena AP dihitung ulang dari transaksi, tagihan itu hilang
// dari daftar AP yang belum lunas.

/** Tandai transaksi Purchase sumber satu Bill sebagai Lunas (dibayar penuh). */
export function markPurchaseTxPaid(tx: Transaction): Transaction {
  return { ...tx, paymentStatus: 'Lunas', paidAmount: tx.debit || 0 };
}

/** Jadwalkan ulang tanggal jatuh tempo transaksi Purchase sumber satu Bill. */
export function reschedulePurchaseTx(tx: Transaction, newDueDateISO: string): Transaction {
  return { ...tx, dueDate: newDueDateISO };
}

/** Satu transaksi Purchase -> satu baris Bill (tagihan) di Account Payable. */
export function billFromPurchaseTx(tx: Transaction, refDate: string = getApReferenceDate()): Bill {
  const daysOverdue = purchaseDaysOverdue(tx, refDate);
  const status = purchaseBillStatus(tx, refDate);
  return {
    id: tx.id,
    number: tx.txId,
    vendorId: vendorIdFromParty(tx.party),
    vendorName: tx.party || 'Vendor Tidak Diketahui',
    billDate: tx.date,
    dueDate: tx.dueDate || tx.date,
    amount: tx.debit || 0,
    paid: purchasePaidAmount(tx),
    outstanding: purchaseOutstanding(tx),
    daysOverdue,
    status,
    priority: purchaseBillPriority(status, daysOverdue),
    paymentMethod: purchasePaymentMethod(tx),
    approvalStatus: tx.status === 'Draft' || tx.status === 'Unposted' ? 'Pending' : 'Approved',
    category: tx.category || undefined,
  };
}

// [DIUBAH — fix bill "hantu" Rp 0] Sebelumnya billsFromTransactions()
// asumsi 1 BARIS = 1 Bill. Itu benar untuk data dari backend asli
// (jurnalBridge.ts mengklasifikasi tiap leg independen dari nama akunnya,
// jadi biasanya cuma leg beban yang lolos filter grup 'purchase'). Tapi
// SALAH untuk baris hasil IMPORT rekening koran: drafJurnalToTransactions()
// di ImportRekeningKoranModal.tsx memberi `category` yang SAMA untuk kedua
// leg (debit beban & kredit Kas/Bank/Utang) satu jurnal — kalau category
// itu masuk grup 'purchase', KEDUA leg lolos filter, dan leg lawan (debit=0)
// ikut dijadikan Bill senilai Rp 0 yang menumpang di daftar vendor.
//
// Fix: kelompokkan dulu per jurnal (`jeId`, meniru groupSalesByInvoice() di
// arBridge.ts) sebelum dijadikan Bill, lalu dari tiap grup ambil SATU leg
// yang benar-benar mewakili beban (debit > 0) sebagai representasi Bill-nya.
// Grup berisi 1 baris (kasus normal data backend) tetap menghasilkan hasil
// yang sama seperti sebelumnya.

/** Satu "bill group": kumpulan leg transaksi (debit+kredit) milik satu jurnal (jeId) yang sama. */
interface BillGroup {
  key: string;
  rows: Transaction[];
}

/**
 * Kelompokkan transaksi Purchase per jurnal sesungguhnya — pakai `jeId`,
 * fallback ke `id` sendiri kalau kosong (supaya tidak ada baris yang hilang).
 */
function groupPurchaseByJournal(transactions: Transaction[]): BillGroup[] {
  const purchaseRows = transactions.filter((tx) => getTransactionGroup(tx) === 'purchase');
  const byKey = new Map<string, Transaction[]>();
  purchaseRows.forEach((tx) => {
    const key = tx.jeId || tx.id;
    const list = byKey.get(key) || [];
    list.push(tx);
    byKey.set(key, list);
  });
  return Array.from(byKey.entries()).map(([key, rows]) => ({ key, rows }));
}

/**
 * Dari sekelompok leg satu jurnal, ambil leg yang benar-benar mewakili
 * beban (debit > 0) untuk dijadikan Bill — itulah baris yang jadi vendor,
 * nominal, dan status jatuh tempo tagihannya. Leg lawan (Kas/Bank/Utang,
 * debit = 0) diabaikan supaya tidak jadi "bill hantu" Rp 0. Fallback ke
 * baris pertama kalau (kasus aneh) tidak ada leg berdebit di grup ini,
 * supaya tetap tidak ada data yang hilang.
 */
function pickPurchaseLeg(rows: Transaction[]): Transaction {
  return rows.find((tx) => (tx.debit || 0) > 0) || rows[0];
}

/**
 * Kelompokkan SEMUA transaksi Purchase per jurnal, lalu konversi jadi
 * daftar Bill. Ini fungsi utama yang dipakai halaman AP sebagai pengganti
 * `bills` mock lama.
 */
export function billsFromTransactions(transactions: Transaction[], refDate: string = getApReferenceDate()): Bill[] {
  return groupPurchaseByJournal(transactions)
    .map((group) => billFromPurchaseTx(pickPurchaseLeg(group.rows), refDate))
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

// [DIUBAH — fix dead code] Sebelumnya fungsi ini menerima parameter `bills`
// tapi tidak dipakai sama sekali — selalu return string statis
// 'Vendor Operasional' utk SEMUA vendor. Sekarang benar-benar dihitung dari
// `category` transaksi Purchase sumbernya (lihat billFromPurchaseTx di atas):
// hitung frekuensi tiap category di antara Bill milik vendor ini, lalu
// pakai yang paling sering muncul sebagai label kategori vendor tsb —
// jadi vendor yang sering dibayar utk 'Software' tampil kategori
// "Software", bukan label generik yang sama utk semua vendor.
function mostCommonCategoryLabel(bills: Bill[]): string {
  const counts = new Map<string, number>();
  bills.forEach((b) => {
    const cat = (b.category || '').trim();
    if (!cat) return;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  });
  let label = 'Lainnya';
  let max = 0;
  counts.forEach((count, cat) => {
    if (count > max) {
      max = count;
      label = cat;
    }
  });
  return label;
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
export function apKpisFromBills(bills: Bill[], vendors: Vendor[], refDate: string = getApReferenceDate()): APKpis {
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

/**
 * Tren bulanan New Bills vs Payments — dihitung dari billDate transaksi
 * Purchase yang sesungguhnya.
 *
 * [FIX - audit #10] Sebelumnya dikelompokkan & diurutkan HANYA pakai
 * `d.getMonth()` (0-11), tanpa tahun — kalau data mencakup lebih dari satu
 * tahun (mis. ada bill Nov 2025 & Feb 2026), keduanya ditumpuk jadi satu
 * "bucket" bulan yang sama (Nov 2025 + Nov tahun lain akan digabung kalau
 * ada), DAN urutan baris yang dihasilkan salah kronologis (Feb dianggap
 * "lebih awal" dari Nov karena 1 < 10). Sekarang dikelompokkan & diurutkan
 * pakai index absolut `year * 12 + month` — pola yang sama persis dengan
 * resolveTrendYear()/monthlyTrendFor() di groupAnalytics.ts dan revenueData
 * di OverviewCharts.tsx — supaya kronologis benar lintas tahun & tiap
 * bulan+tahun punya bucket sendiri-sendiri. Label bulan ditambah akhiran
 * "'YY" HANYA kalau rentang data benar-benar mencakup >1 tahun (mengikuti
 * `spansMultipleYears` di OverviewCharts.tsx), supaya tampilan untuk kasus
 * umum (data 1 tahun) tidak berubah sama sekali dari sebelumnya.
 */
export function apTrendFromBills(bills: Bill[]) {
  const byAbsIdx = new Map<number, { year: number; month: number; newBills: number; payments: number }>();
  bills.forEach((b) => {
    const d = new Date(b.billDate);
    if (isNaN(d.getTime())) return;
    const year = d.getFullYear();
    const month = d.getMonth();
    const absIdx = year * 12 + month;
    const entry = byAbsIdx.get(absIdx) || { year, month, newBills: 0, payments: 0 };
    entry.newBills += b.amount;
    entry.payments += b.paid;
    byAbsIdx.set(absIdx, entry);
  });

  const sortedIdx = Array.from(byAbsIdx.keys()).sort((a, b) => a - b);
  const now = new Date();
  const nowAbsIdx = now.getFullYear() * 12 + now.getMonth();
  const firstAbsIdx = sortedIdx[0] ?? nowAbsIdx;
  const lastAbsIdx = sortedIdx[sortedIdx.length - 1] ?? nowAbsIdx;
  const spansMultipleYears = Math.floor(firstAbsIdx / 12) !== Math.floor(lastAbsIdx / 12);

  let openingAP = 0;
  const rows: { month: string; openingAP: number; newBills: number; payments: number; closingAP: number }[] = [];
  for (let absIdx = firstAbsIdx; absIdx <= lastAbsIdx; absIdx++) {
    const year = Math.floor(absIdx / 12);
    const month = absIdx - year * 12;
    const entry = byAbsIdx.get(absIdx) || { year, month, newBills: 0, payments: 0 };
    const closingAP = Math.max(0, openingAP + entry.newBills - entry.payments);
    const label = spansMultipleYears ? `${MONTH_LABELS[month]} '${String(year).slice(-2)}` : MONTH_LABELS[month];
    rows.push({ month: label, openingAP, newBills: entry.newBills, payments: entry.payments, closingAP });
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

/** Kebutuhan kas ke depan (Today / This Week / Next Week / This Month), dihitung dari dueDate transaksi Purchase. */
export function paymentForecastFromBills(bills: Bill[], refDate: string = getApReferenceDate()): PaymentForecastBucket[] {
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