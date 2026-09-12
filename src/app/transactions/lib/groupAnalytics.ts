// [BARU] Helper analisa bersama untuk 5 sub halaman Transaksi (Sales,
// Expense, Cash Payment, Cash Receipt, Other). Semua fungsi di sini murni
// mengolah array Transaction yang sudah difilter per kelompok (hasil
// getByGroup() dari TransactionsContext) — tidak ada data dummy di sini.
import { Transaction } from '../components/transactionData';

export function formatIDR(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 1_000_000_000_000) return `Rp ${(amount / 1_000_000_000_000).toFixed(2).replace('.', ',')}T`;
    if (Math.abs(amount) >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(2).replace('.', ',')}M`;
    if (Math.abs(amount) >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(0)}Jt`;
    if (Math.abs(amount) >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}Rb`;
  }
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Nilai satu baris transaksi (satu kaki jurnal): sisi yang terisi, debit atau kredit. */
export function txAmount(tx: Transaction): number {
  return tx.debit + tx.credit;
}

/**
 * [BARU] Kelompokkan baris transaksi per NOMOR JURNAL (`jeId`).
 *
 * [DIUBAH] Sebelumnya baris TANPA jeId (kosong/undefined) langsung
 * diperlakukan sebagai transaksi tersendiri masing-masing. Risikonya: kalau
 * SATU transaksi ekonomi (mis. sisi Kas & sisi Pendapatan untuk invoice yang
 * sama) kebetulan sama-sama tidak punya jeId, keduanya akan dianggap 2
 * transaksi terpisah dan nilainya DIJUMLAH (bukan diambil sisi
 * terbesar seperti journalAmount() normalnya bekerja) — Total Sales bisa
 * jadi 2x lipat dari yang seharusnya.
 *
 * Sekarang ada fallback tingkat 2 sebelum jatuh ke "berdiri sendiri": kalau
 * jeId kosong tapi `reference` (mis. No. Invoice/PO) terisi, baris
 * dikelompokkan lewat `reference` + tanggal sebagai gantinya — di data app
 * ini `reference` memang selalu sama untuk kedua kaki jurnal transaksi yang
 * sama (lihat tx-001/tx-002 di transactionData.ts, sama-sama
 * 'INV-2026-0342'), jadi ini cara aman untuk tetap memasangkan 2 kaki yang
 * memang satu transaksi walau jeId-nya hilang. Tanggal disertakan di kunci
 * supaya nomor reference yang sama tapi beda tanggal (mis. nomor invoice
 * dipakai ulang tahun berikutnya) tidak ikut tergabung secara keliru.
 *
 * Kalau jeId MAUPUN reference sama-sama kosong, baru baris itu diperlakukan
 * berdiri sendiri (tidak ada cara aman untuk mengetahui pasangannya) —
 * lebih aman under-count risiko gabung keliru, daripada over-merge baris
 * yang sebenarnya tidak berhubungan.
 *
 * Dipakai bersama oleh uniqueJournalTotal() dan uniqueJournalCount() (lewat
 * groupByJournalRealized()) supaya definisi "satu transaksi" tetap
 * konsisten di kedua tempat.
 */
function groupByJournal(transactions: Transaction[]): Map<string, Transaction[]> {
  const byJournal = new Map<string, Transaction[]>();
  let fallbackIndex = 0;
  transactions.forEach((tx) => {
    let key: string;
    if (tx.jeId && tx.jeId.trim() !== '') {
      key = `je:${tx.jeId}`;
    } else if (tx.reference && tx.reference.trim() !== '') {
      key = `ref:${tx.reference}|${tx.date}`;
    } else {
      key = `__no-je-${fallbackIndex++}`;
    }
    const rows = byJournal.get(key) || [];
    rows.push(tx);
    byJournal.set(key, rows);
  });
  return byJournal;
}

/**
 * [BARU] Baris transaksi yang TIDAK punya `jeId` sama sekali (kosong/
 * undefined) — dipakai untuk peringatan integritas data di UI (lihat
 * pemakaian di sales/page.tsx). Idealnya daftar ini selalu kosong: seluruh
 * jalur pembuatan transaksi di app ini (ImportRekeningKoranModal,
 * jurnalBridge dari backend, tombol "+ Jurnal Baru") SELALU mengisi jeId.
 * Kalau ada baris yang muncul di sini, artinya datanya datang dari luar
 * jalur normal itu (mis. sumber lain/API lain) dan sebaiknya ditinjau,
 * karena baris seperti ini hanya bisa dikelompokkan dengan aman lewat
 * fallback `reference` (lihat groupByJournal() di atas) — kalau
 * `reference`-nya juga kosong, baris itu ikut dihitung berdiri sendiri dan
 * berisiko salah hitung kalau sebenarnya adalah pasangan kaki jurnal lain.
 */
export function transactionsMissingJeId(transactions: Transaction[]): Transaction[] {
  return transactions.filter((tx) => !tx.jeId || tx.jeId.trim() === '');
}

/**
 * [BARU] Ringkasan SATU jurnal (jeId) yang total debit dan total kredit
 * baris-barisnya TIDAK sama — dipakai untuk peringatan integritas data di
 * UI, pasangan dari transactionsMissingJeId() di atas.
 */
export interface UnbalancedJournal {
  /** jeId jurnal yang tidak balance (atau '—' kalau baris itu sendiri tidak punya jeId). */
  jeId: string;
  debit: number;
  credit: number;
  /** Selisih absolut antara total debit dan total kredit. */
  diff: number;
}

/**
 * [BARU] Deteksi jurnal (grup jeId) yang debit dan kreditnya TIDAK sama —
 * kasus yang selama ini "diam-diam dibenarkan" oleh journalAmount() lewat
 * Math.max(debit, credit) (lihat catatan di journalAmount() di bawah): kalau
 * suatu jurnal tidak balance, Math.max cuma mengambil sisi yang lebih besar
 * tanpa ada tanda apa pun kalau ada yang salah — padahal artinya jurnal itu
 * salah input (mis. debit dan kredit dengan nominal berbeda untuk transaksi
 * yang sama).
 *
 * [PENTING] Grup dengan HANYA 1 baris (mis. hasil tombol "+ Jurnal Baru" —
 * lihat blankTransaction() di TransactionsGroupPanel.tsx, yang memang cuma
 * membuat 1 baris per jeId, bukan pasangan debit+kredit seperti hasil
 * import/data statis) SENGAJA DILEWATI di sini. Baris tunggal seperti itu
 * memang cuma mengisi salah satu sisi (debit ATAU kredit) by design, bukan
 * jurnal yang "seharusnya balance tapi tidak" — kalau ikut diperiksa, SETIAP
 * baris manual akan selalu muncul sebagai "tidak balance" (padahal bukan
 * kasus yang dimaksud di sini), jadi peringatannya jadi bising & tidak
 * berguna. Pemeriksaan hanya relevan untuk jurnal dengan 2 baris kaki atau
 * lebih, yang menurut aturan double-entry memang wajib total debit = total
 * kredit.
 */
export function unbalancedJournals(transactions: Transaction[]): UnbalancedJournal[] {
  const byJournal = groupByJournal(transactions);
  const result: UnbalancedJournal[] = [];
  byJournal.forEach((rows) => {
    if (rows.length < 2) return;
    const debit = rows.reduce((s, r) => s + r.debit, 0);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    // Dibulatkan ke rupiah penuh dulu supaya selisih floating-point yang
    // sangat kecil (mis. 0.00000001 akibat pembagian desimal) tidak ikut
    // dianggap "tidak balance".
    if (Math.round(debit) !== Math.round(credit)) {
      result.push({ jeId: rows[0]?.jeId || '—', debit, credit, diff: Math.abs(debit - credit) });
    }
  });
  return result;
}

/**
 * [BARU] Sama seperti groupByJournal(), tapi MENGECUALIKAN jurnal yang
 * statusnya 'Voided' (dibatalkan/ditolak — lihat mapping 'ditolak' →
 * 'Voided' di jurnalBridge.ts). Sebelum perbaikan ini, jurnal yang sudah
 * batal tetap ikut kehitung sebagai penjualan/beban riil di Total Sales,
 * Jumlah Transaksi, tren bulanan, breakdown kategori, dan Top Customer —
 * padahal transaksi yang dibatalkan seharusnya tidak dianggap terjadi sama
 * sekali secara bisnis.
 *
 * [DIUBAH] Sekarang JUGA mengecualikan jurnal berstatus 'Draft' (pending
 * approval — mis. tx-017 di transactionData.ts, catatan "Pending approval
 * Finance Manager"). 'Draft' TIDAK sama dengan 'Unposted': 'Unposted'
 * adalah status default baris hasil import rekening koran SEBELUM user
 * menekan "Posting Semua" — kejadian ekonominya sudah pasti terjadi (mis.
 * uang sudah masuk ke rekening bank), cuma belum direview/diposting ke buku
 * besar, makanya 'Unposted' TETAP diikutkan di sini dan malah dapat kartu
 * "Belum Diposting" sendiri. 'Draft' berarti transaksinya SENDIRI belum
 * disetujui secara bisnis — bisa saja batal/berubah nominalnya sebelum
 * disetujui — jadi seharusnya belum dianggap sebagai penjualan/beban riil,
 * sama seperti 'Voided'. Pola ini konsisten dengan apBridge.ts (Draft/
 * Unposted ditandai 'Pending Approval', bukan dihitung sebagai tagihan
 * final) dan liabilitiesBridge.ts (Draft/Unposted diberi variant
 * 'scheduled', terpisah dari 'active'/'paid').
 *
 * Nilai jurnal Draft yang dikeluarkan dari sini TIDAK hilang begitu saja —
 * lihat draftJournalTotal() di bawah, dipakai di tiap sub halaman untuk
 * menampilkan nilainya secara terpisah ("X pending approval, belum
 * termasuk Total Sales") supaya user tetap tahu nilainya ada, cuma memang
 * belum final.
 *
 * Status diambil dari baris PERTAMA di tiap grup jeId, sama seperti pola di
 * countJournalsByStatus() — aman karena seluruh kaki jurnal yang sama
 * (mis. sisi Kas & sisi Pendapatan untuk invoice yang sama) biasanya
 * berstatus seragam.
 *
 * [PENTING] countJournalsByStatus(), countJournalsByCategory(), dan
 * countJournalsWhere() SENGAJA TETAP memakai groupByJournal() versi asli
 * (bukan fungsi ini) — fungsi-fungsi itu memang perlu bisa menghitung
 * jurnal berstatus apa pun termasuk 'Voided'/'Draft' itu sendiri (mis.
 * kartu "Belum Diposting" atau draftJournalTotal() di bawah), jadi tidak
 * boleh ikut kehilangan data Voided/Draft dari sumbernya.
 */
function groupByJournalRealized(transactions: Transaction[]): Map<string, Transaction[]> {
  const byJournal = groupByJournal(transactions);
  byJournal.forEach((rows, key) => {
    if (rows[0]?.status === 'Voided' || rows[0]?.status === 'Draft') byJournal.delete(key);
  });
  return byJournal;
}

/**
 * [BARU] Total nilai transaksi dikelompokkan per NOMOR JURNAL (`jeId`), bukan
 * per baris. Satu transaksi ekonomi (satu jeId) sering dicatat sebagai lebih
 * dari satu baris kaki jurnal — misalnya sisi Kas & Bank (uang masuk) dan
 * sisi akun Pendapatan (pengakuan pendapatan) untuk invoice yang sama. Kalau
 * dijumlah pakai txAmount() per baris seperti biasa, nilai transaksi itu akan
 * terhitung DUA KALI (sekali dari kaki Kas, sekali dari kaki Pendapatan).
 *
 * Untuk tiap jeId: jumlahkan semua debit dalam grup itu, jumlahkan semua
 * kredit dalam grup itu, lalu ambil yang LEBIH BESAR di antara keduanya (pada
 * jurnal yang balance/seimbang, total debit = total kredit, jadi hasilnya
 * sama saja; Math.max dipakai sebagai jaga-jaga kalau ada baris yang belum
 * seimbang).
 *
 * [DIUBAH] Sekarang dikelompokkan lewat groupByJournalRealized(),
 * bukan groupByJournal() — jurnal berstatus 'Voided' dikeluarkan dulu
 * sebelum dijumlahkan, supaya transaksi yang sudah dibatalkan tidak ikut
 * menggembungkan Total Sales.
 *
 * [CATATAN] Math.max di sini TETAP diam-diam memilih sisi yang lebih besar
 * kalau suatu jurnal ternyata tidak balance — journalAmount() sendiri
 * sengaja tidak diubah, supaya Total Sales/Expense/dst tidak tiba-tiba
 * "hilang" nilainya gara-gara satu jurnal bermasalah. Yang baru:
 * unbalancedJournals() di atas mendeteksi kasus ini secara terpisah supaya
 * bisa ditampilkan sebagai peringatan di UI (lihat pemakaian di
 * sales/page.tsx dkk) — jadi koreksi otomatis ini sekarang KELIHATAN, bukan
 * lagi murni diam-diam.
 */
/** Total nilai satu grup kaki jurnal (baris-baris dengan jeId yang sama): sisi debit atau kredit yang lebih besar. */
function journalAmount(rows: Transaction[]): number {
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return Math.max(debit, credit);
}

export function uniqueJournalTotal(transactions: Transaction[]): number {
  const byJournal = groupByJournalRealized(transactions);
  let total = 0;
  byJournal.forEach((rows) => {
    total += journalAmount(rows);
  });
  return total;
}

/**
 * [BARU] Total nilai jurnal berstatus 'Draft' (pending approval) dalam
 * kelompok yang diberikan — pasangan dari uniqueJournalTotal(), yang
 * SENGAJA mengeluarkan jurnal Draft dari hitungannya (lihat
 * groupByJournalRealized()). Dipakai di tiap sub halaman Transaksi supaya
 * nilai Draft tetap kelihatan (mis. sebagai subLabel/peringatan di bawah
 * kartu "Total Sales"), bukan cuma diam-diam hilang dari Total Sales/
 * Expense/dst tanpa penjelasan.
 *
 * Dikelompokkan per NOMOR JURNAL (jeId) sama seperti uniqueJournalTotal(),
 * supaya konsisten kalau suatu transaksi Draft kebetulan dicatat lebih dari
 * satu baris kaki jurnal. Pakai groupByJournal() (bukan versi Realized),
 * karena di sini justru baris Draft-lah yang ingin diambil.
 */
export function draftJournalTotal(transactions: Transaction[]): number {
  const byJournal = groupByJournal(transactions);
  let total = 0;
  byJournal.forEach((rows) => {
    if (rows[0]?.status === 'Draft') total += journalAmount(rows);
  });
  return total;
}

/**
 * [BARU] Jumlah transaksi EKONOMI (jumlah nomor jurnal / jeId unik), bukan
 * jumlah baris kaki jurnal. Dipakai berpasangan dengan uniqueJournalTotal()
 * supaya "Rata-rata / Transaksi" (Total Sales ÷ Jumlah Transaksi) tetap
 * konsisten — kalau Jumlah Transaksi masih dihitung per baris sedangkan Total
 * Sales sudah per jeId, rata-ratanya akan salah lagi walau Total Sales-nya
 * sudah benar.
 *
 * [DIUBAH] Sekarang juga lewat groupByJournalRealized() — jurnal
 * 'Voided' tidak ikut dihitung sebagai transaksi, supaya "Rata-rata /
 * Transaksi" dan basis persentase Rekonsiliasi (reconciledCount ÷ txCount di
 * halaman Sales/Expense/dst) tidak digelembungi penyebutnya oleh transaksi
 * yang sudah batal.
 */
export function uniqueJournalCount(transactions: Transaction[]): number {
  return groupByJournalRealized(transactions).size;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang statusnya PERSIS sama dengan
 * `status` yang diminta — dipakai untuk kartu "Belum Diposting" (status
 * 'Unposted') dan "Rekonsiliasi" (status 'Reconciled'), supaya basis
 * hitungnya konsisten per-jurnal seperti uniqueJournalCount(), bukan lagi
 * per-baris kaki jurnal.
 *
 * Status diambil dari baris PERTAMA di tiap grup jeId. Ini aman karena semua
 * kaki jurnal yang sama biasanya diposting/direkonsiliasi bersamaan sehingga
 * statusnya seragam dalam satu jeId (lihat data contoh: tx-001 & tx-002 sama-
 * sama 'Posted' walau kaki jurnalnya berbeda akun). Kalau suatu saat ada
 * baris dalam satu jeId yang statusnya berbeda-beda (data tidak konsisten),
 * fungsi ini akan mengikuti status baris pertama yang ditemukan saja.
 */
export function countJournalsByStatus(transactions: Transaction[], status: Transaction['status']): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (rows[0]?.status === status) count += 1;
  });
  return count;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang kategorinya termasuk dalam daftar
 * `categories` yang diberikan — pola sama dengan countJournalsByStatus(),
 * dipakai untuk kartu ringkasan berbasis kategori (mis. "Beban Rutin" di
 * Expense) supaya basis hitungnya konsisten per-jurnal, bukan per-baris kaki
 * jurnal (satu transaksi dengan 2 kaki jurnal yang kebetulan sama-sama masuk
 * daftar kategori tidak akan terhitung dua kali). Kategori diambil dari baris
 * PERTAMA di tiap grup jeId, sama seperti countJournalsByStatus().
 */
export function countJournalsByCategory(transactions: Transaction[], categories: string[]): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (categories.includes(rows[0]?.category)) count += 1;
  });
  return count;
}

/**
 * [BARU] Jumlah transaksi (jeId unik) yang lolos `predicate`, dengan
 * predicate menerima SELURUH baris dalam satu grup jeId (bukan cuma baris
 * pertama seperti countJournalsByStatus/countJournalsByCategory) — dipakai
 * untuk kondisi yang bisa saja hanya melekat di salah satu kaki jurnal, mis.
 * field `notes` (catatan anomali) yang biasanya cuma terisi di kaki yang
 * bermasalah, bukan di kedua kaki sekaligus. Helper umum ini menggantikan
 * pola `transactions.filter(...).length` berbasis baris untuk kartu
 * ringkasan yang belum punya helper spesifik sendiri.
 */
export function countJournalsWhere(transactions: Transaction[], predicate: (rows: Transaction[]) => boolean): number {
  const byJournal = groupByJournal(transactions);
  let count = 0;
  byJournal.forEach((rows) => {
    if (predicate(rows)) count += 1;
  });
  return count;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * [DIUBAH] Tahun yang dipakai untuk grafik tren bulanan: kalau tidak
 * ditentukan lewat parameter `year` di monthlyTrendFor(), otomatis pakai
 * tahun dengan transaksi TERBANYAK di dalam data yang diberikan (paling
 * relevan untuk ditampilkan) — atau tahun berjalan (`new Date().getFullYear()`)
 * kalau kelompok itu belum punya transaksi sama sekali.
 */
function resolveTrendYear(transactions: Transaction[]): number {
  const byJournal = groupByJournal(transactions);
  const countByYear = new Map<number, number>();
  byJournal.forEach((rows) => {
    const d = new Date(rows[0].date);
    if (isNaN(d.getTime())) return;
    const y = d.getFullYear();
    countByYear.set(y, (countByYear.get(y) || 0) + 1);
  });
  if (countByYear.size === 0) return new Date().getFullYear();
  return Array.from(countByYear.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * [DIUBAH] Tren bulanan (jumlah nominal per bulan) dari transaksi satu
 * kelompok — SELALU mengembalikan 12 titik, Januari s/d Desember, untuk satu
 * tahun (bulan tanpa transaksi tetap tampil dengan total 0, bukan hilang dari
 * grafik). `year` opsional; kalau tidak diisi, otomatis pilih tahun dengan
 * transaksi terbanyak (lihat resolveTrendYear()).
 *
 * [DIUBAH] Sekarang dikelompokkan per NOMOR JURNAL (jeId) dulu sebelum
 * dijumlah ke bulan yang sesuai — supaya transaksi dengan 2 kaki jurnal (mis.
 * Kas + Pendapatan untuk invoice yang sama) tidak menambah nilai bulan itu
 * dua kali. Tanggal yang dipakai untuk menentukan bulan adalah tanggal baris
 * PERTAMA di tiap grup jeId (dalam praktiknya semua kaki jurnal yang sama
 * selalu punya tanggal yang identik).
 *
 * [DIUBAH] Sekarang lewat groupByJournalRealized() — jurnal 'Voided'/'Draft'
 * tidak ikut menambah nilai/jumlah bulan manapun di grafik tren.
 */
export function monthlyTrendFor(transactions: Transaction[], year?: number): { month: string; total: number; count: number }[] {
  const targetYear = year ?? resolveTrendYear(transactions);
  const totals = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  const byJournal = groupByJournalRealized(transactions);
  byJournal.forEach((rows) => {
    const d = new Date(rows[0].date);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() !== targetYear) return;
    const m = d.getMonth();
    totals[m].total += journalAmount(rows);
    totals[m].count += 1;
  });
  return MONTH_LABELS.map((label, i) => ({ month: label, total: totals[i].total, count: totals[i].count }));
}

// [DIUBAH] Sebelumnya breakdown ini mengelompokkan per `tx.category` — itu
// cocok untuk data statis/demo yang tiap barisnya sudah punya kategori rinci
// (Revenue, Payroll, Software, dst). Tapi sejak baris hasil IMPORT rekening
// koran diberi `category` berupa salah satu dari 5 label grup saja (Sales/
// Expense/Cash Payment/Cash Receipt/Other — lihat classifyByAccountName di
// transactionData.ts), semua baris dalam satu sub halaman otomatis punya
// `category` yang SAMA (mis. semuanya "Sales") sehingga breakdown ini
// kolaps jadi cuma 1 batang. Sekarang dikelompokkan per `accountName` (nama
// akun COA yang sebenarnya, mis. "Pendapatan Jasa Konsultasi", "Pendapatan
// Maintenance") supaya tetap pecah rinci untuk data statis MAUPUN data hasil
// import.
//
// [DIUBAH LAGI] Ditemukan bug lanjutan: satu transaksi dengan 2 kaki jurnal
// (mis. "Kas & Bank — BCA" dan "Pendapatan Jasa Konsultasi" untuk invoice
// yang sama) sebelumnya membuat KEDUA nama akun itu muncul sebagai kategori
// terpisah — padahal "Kas & Bank" bukan kategori pendapatan, itu cuma sisi
// lain dari jurnal yang sama (makanya akun kas bisa nongol sebagai kategori
// "terbesar" walau isinya bukan pendapatan). Sekarang dikelompokkan per
// NOMOR JURNAL (jeId) dulu; dari tiap grup dipilih SATU kaki akun yang
// representatif — diutamakan akun PENDAPATAN (accountCode berawalan '4',
// sesuai standar penomoran akun di aplikasi ini). Kalau grup itu tidak
// punya kaki akun pendapatan sama sekali (mis. baris hasil import yang
// belum berpasangan dengan baris pengakuan pendapatan), fallback ke kaki
// dengan nilai terbesar di grup itu supaya transaksinya tetap tampil.
//
// [DIUBAH] Sekarang lewat groupByJournalRealized() — jurnal 'Voided'/'Draft'
// tidak ikut muncul/menambah nilai di breakdown kategori.
export function categoryBreakdown(transactions: Transaction[]): { name: string; value: number }[] {
  const byJournal = groupByJournalRealized(transactions);
  const byAccount = new Map<string, number>();
  byJournal.forEach((rows) => {
    const revenueLeg = rows.find((r) => String(r.accountCode ?? '').startsWith('4'));
    const rep = revenueLeg || rows.reduce((a, b) => (txAmount(b) > txAmount(a) ? b : a));
    byAccount.set(rep.accountName, (byAccount.get(rep.accountName) || 0) + journalAmount(rows));
  });
  return Array.from(byAccount.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * [DIUBAH] Top pihak (customer/vendor/counterparty) berdasarkan total
 * nominal — sekarang dikelompokkan per NOMOR JURNAL (jeId) dulu sebelum
 * dijumlah per pihak, supaya transaksi dengan 2 kaki jurnal (yang keduanya
 * tercatat atas nama pihak yang sama) tidak menghitung nominal customer itu
 * dua kali. Nama pihak diambil dari baris PERTAMA di tiap grup jeId (dalam
 * praktiknya semua kaki jurnal yang sama selalu dicatat atas nama pihak yang
 * sama).
 *
 * [DIUBAH] Sekarang lewat groupByJournalRealized() — jurnal 'Voided'/'Draft'
 * tidak ikut menambah nominal pihak manapun di daftar Top Customer/Vendor.
 */
export function topParties(transactions: Transaction[], limit = 5): { name: string; amount: number }[] {
  const byJournal = groupByJournalRealized(transactions);
  const byParty = new Map<string, number>();
  byJournal.forEach((rows) => {
    const party = rows[0]?.party || '—';
    byParty.set(party, (byParty.get(party) || 0) + journalAmount(rows));
  });
  return Array.from(byParty.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export const CHART_COLORS = ['#14b8a6', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];