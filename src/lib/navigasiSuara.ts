// navigasiSuara.ts — mengubah ucapan seperti "buka laba rugi" atau "pindah ke tab source data di halaman purchase"
// menjadi tujuan halaman (+ tab). Tidak memanggil AI sama sekali (instan, gratis, dan tidak bisa "ngawur"
// membuka rute yang tidak ada).
//
// Dua bahasa: sidebar tampil Bahasa Indonesia, tapi semua halaman & tab juga dikenali dengan nama Inggris
// (mis. "budget and forecast", "profit and loss", "source data"). Tambah halaman/tab baru cukup dengan
// menambah satu baris di HALAMAN di bawah. Alias ditulis huruf kecil, tanpa tanda baca.

import { cariHalamanMirip, type EntriNav, type KandidatHalaman } from './salahDengarSuara';

export type HasilNavigasi =
  | { jenis: 'buka'; path: string; nama: string; tabQuery?: string }
  | { jenis: 'kembali' };

type Tab = { nama: string; alias: string[]; path?: string; query?: string };
// aksi: true = halaman form baru / export; boleh dipicu juga dengan kata "buat", "tambah", "export"
type Halaman = { path: string; nama: string; alias: string[]; tab?: Tab[]; aksi?: boolean };

// ---------- alias tab yang dipakai berulang ----------
const A_OVERVIEW = ['overview', 'ringkasan'];
const A_SOURCE = ['source data', 'data sumber', 'sumber data', 'sors data'];
const A_PREVIEW = ['journal preview', 'preview', 'pratinjau jurnal', 'pratinjau', 'jurnal preview'];
const A_EXCEPTIONS = ['exceptions', 'exception', 'pengecualian'];
const A_POSTED = ['posted', 'diposting', 'sudah diposting', 'terposting'];

// tab berbasis rute (tiap tab = halaman sendiri)
const tabRute = (base: string, daftar: [string, string, string[]][]): Tab[] =>
  daftar.map(([sub, nama, alias]) => ({ nama, alias, path: base + sub }));
// tab berbasis state (dibuka lewat ?tab=kunci, lalu event 'neo-tab' bila sudah di halaman itu)
const tabQuery = (daftar: [string, string, string[]][]): Tab[] =>
  daftar.map(([query, nama, alias]) => ({ nama, alias, query }));

export const HALAMAN: Halaman[] = [
  { path: '/', nama: 'Ringkasan', alias: ['ringkasan', 'overview', 'beranda', 'dashboard', 'halaman utama', 'home'] },
  { path: '/agent-ai', nama: 'Agent AI', alias: ['agent ai', 'agen ai', 'halaman agent', 'agent'] },
  {
    path: '/memori-ai', nama: 'Memori AI', alias: ['memori ai', 'memori', 'ingatan ai', 'ingatan', 'memory ai', 'ai memory'],
    tab: tabQuery([
      ['ingatan', 'Ingatan', ['ingatan', 'memori', 'memory', 'memories']],
      ['percakapan', 'Percakapan', ['percakapan', 'riwayat percakapan', 'conversations', 'conversation', 'chat history']],
    ]),
  },

  // ----- Laporan Keuangan -----
  { path: '/financial-statements', nama: 'Laporan Keuangan', alias: ['laporan keuangan', 'financial statements', 'financial statement'] },
  { path: '/financial-statements/profit-loss', nama: 'Laba Rugi', alias: ['laba rugi', 'profit and loss', 'profit loss', 'profit dan loss', 'p and l', 'pnl'] },
  { path: '/financial-statements/balance-sheet', nama: 'Neraca', alias: ['neraca', 'balance sheet'] },
  { path: '/financial-statements/cash-flow', nama: 'Arus Kas', alias: ['arus kas', 'cash flow', 'cashflow'] },
  { path: '/financial-statements/changes-in-equity', nama: 'Laporan Perubahan Ekuitas', alias: ['perubahan ekuitas', 'laporan perubahan ekuitas', 'changes in equity', 'statement of changes in equity'] },
  { path: '/financial-statements/notes', nama: 'Catatan atas Laporan Keuangan', alias: ['catatan atas laporan keuangan', 'catatan laporan keuangan', 'calk', 'notes', 'notes to financial statements'] },
  { path: '/financial-statements/mapping', nama: 'Pemetaan Laporan', alias: ['pemetaan laporan', 'mapping laporan', 'statement mapping', 'financial statement mapping', 'mapping'] },

  // ----- Transaksi -----
  { path: '/transactions', nama: 'Transaksi', alias: ['transaksi', 'transactions'] },
  {
    path: '/transactions/sales', nama: 'Penjualan', alias: ['penjualan', 'sales'],
    tab: tabQuery([
      ['overview', 'Ringkasan', A_OVERVIEW],
      ['source-data', 'Data Sumber', A_SOURCE],
      ['sales-transaction', 'Transaksi Penjualan', ['sales transaction', 'transaksi penjualan', 'transaction', 'transaksi']],
      ['journal-preview', 'Pratinjau Jurnal', A_PREVIEW],
      ['exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['posted', 'Diposting', A_POSTED],
    ]),
  },
  {
    path: '/transactions/purchase', nama: 'Pembelian', alias: ['pembelian', 'purchase', 'purchases'],
    tab: tabRute('/transactions/purchase', [
      ['', 'Ringkasan', A_OVERVIEW],
      ['/source-data', 'Data Sumber', A_SOURCE],
      ['/transaction', 'Transaksi Pembelian', ['purchase transaction', 'transaksi pembelian', 'transaction', 'transaksi']],
      ['/preview', 'Pratinjau Pembelian', [...A_PREVIEW, 'purchase preview', 'pratinjau pembelian']],
      ['/exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['/posted', 'Diposting', A_POSTED],
    ]),
  },
  {
    path: '/transactions/journal-entry', nama: 'Entri Jurnal', alias: ['entri jurnal', 'jurnal umum', 'jurnal', 'journal entry', 'journal entries', 'journal'],
    tab: tabRute('/transactions/journal-entry', [
      ['', 'Ringkasan', A_OVERVIEW],
      ['/source-data', 'Data Sumber', A_SOURCE],
      ['/transactions', 'Transaksi Jurnal', ['je transaction', 'journal transaction', 'transaksi jurnal', 'transaction', 'transaksi']],
      ['/preview', 'Pratinjau Jurnal', A_PREVIEW],
      ['/exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['/posted', 'Diposting', A_POSTED],
    ]),
  },
  {
    path: '/transactions/bank-cash', nama: 'Kas dan Bank', alias: ['kas dan bank', 'kas bank', 'cash bank', 'cash and bank', 'cash dan bank', 'bank', 'kas'],
    tab: tabRute('/transactions/bank-cash', [
      ['/overview', 'Ringkasan', A_OVERVIEW],
      ['/cash-payment', 'Pembayaran Kas', ['cash payment', 'pembayaran kas', 'payment', 'pembayaran']],
      ['/cash-receipt', 'Penerimaan Kas', ['cash receipt', 'penerimaan kas', 'receipt', 'penerimaan']],
      ['/source-data', 'Data Sumber', A_SOURCE],
      ['/reconciliation', 'Rekonsiliasi', ['reconciliation', 'rekonsiliasi', 'bank reconciliation', 'rekonsiliasi bank']],
      ['/journal-preview', 'Pratinjau Jurnal', A_PREVIEW],
      ['/exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['/posted', 'Diposting', A_POSTED],
    ]),
  },
  { path: '/transactions/bank-cash/reconciliation', nama: 'Rekonsiliasi Bank', alias: ['rekonsiliasi bank', 'rekonsiliasi', 'bank reconciliation', 'reconciliation'] },
  {
    path: '/transactions/other', nama: 'Lainnya', alias: ['transaksi lain', 'transaksi lainnya', 'other transactions', 'lainnya', 'lain lain', 'other'],
    tab: tabRute('/transactions/other', [
      ['', 'Ringkasan', A_OVERVIEW],
      ['/source-data', 'Data Sumber', A_SOURCE],
      ['/transaction', 'Transaksi Lainnya', ['other transaction', 'transaksi lainnya', 'transaksi lain', 'transaction', 'transaksi']],
      ['/preview', 'Pratinjau Jurnal', A_PREVIEW],
      ['/exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['/posted', 'Diposting', A_POSTED],
    ]),
  },

  // ----- Form baru & export (halaman di dalam halaman) -----
  { path: '/accounts-receivable/invoices/new', nama: 'Invoice Baru', aksi: true, alias: ['invoice baru', 'faktur baru', 'new invoice', 'create invoice', 'buat invoice', 'tambah invoice', 'buat faktur', 'tambah faktur'] },
  { path: '/accounts-receivable/receipts/new', nama: 'Penerimaan Baru', aksi: true, alias: ['receipt baru', 'penerimaan baru', 'penerimaan pembayaran baru', 'new receipt', 'create receipt', 'buat receipt', 'tambah receipt', 'buat penerimaan', 'tambah penerimaan'] },
  { path: '/accounts-payable/payments/new', nama: 'Pembayaran Utang Baru', aksi: true, alias: ['payment baru', 'pembayaran baru', 'pembayaran utang baru', 'new payment', 'create payment', 'buat payment', 'buat pembayaran', 'tambah payment', 'tambah pembayaran'] },
  { path: '/transactions/purchase/bills/new', nama: 'Bill Pembelian Baru', aksi: true, alias: ['bill baru', 'tagihan baru', 'tagihan pembelian baru', 'new bill', 'create bill', 'buat bill', 'tambah bill', 'buat tagihan pembelian'] },
  { path: '/coa/new', nama: 'Akun Baru', aksi: true, alias: ['akun baru', 'new account', 'create account', 'buat akun', 'tambah akun', 'tambah akun baru'] },
  { path: '/coa/opening-balances/new', nama: 'Saldo Awal Baru', aksi: true, alias: ['saldo awal baru', 'new opening balance', 'create opening balance', 'buat saldo awal', 'tambah saldo awal'] },
  { path: '/accounts-receivable/export', nama: 'Ekspor Piutang', aksi: true, alias: ['export piutang', 'ekspor piutang', 'export accounts receivable', 'export receivable', 'export ar', 'ekspor ar'] },
  { path: '/accounts-payable/export', nama: 'Ekspor Utang', aksi: true, alias: ['export utang', 'ekspor utang', 'export hutang', 'ekspor hutang', 'export accounts payable', 'export payable', 'export ap', 'ekspor ap'] },

  // ----- Piutang & Utang -----
  { path: '/accounts-receivable', nama: 'Piutang Usaha', alias: ['piutang usaha', 'piutang', 'accounts receivable', 'account receivable', 'receivables', 'receivable', 'ar'] },
  { path: '/accounts-payable', nama: 'Utang Usaha', alias: ['utang usaha', 'utang', 'hutang usaha', 'hutang', 'accounts payable', 'account payable', 'payables', 'payable', 'ap'] },

  // ----- Aset, Kewajiban, Ekuitas -----
  { path: '/assets', nama: 'Aset', alias: ['aset', 'asset', 'assets', 'aktiva tetap'] },
  { path: '/liabilities', nama: 'Kewajiban', alias: ['kewajiban', 'liabilitas', 'liabilities', 'liability'] },
  { path: '/equity', nama: 'Ekuitas', alias: ['ekuitas', 'modal', 'equity'] },

  // ----- Perencanaan -----
  { path: '/budget-forecast', nama: 'Anggaran dan Perkiraan', alias: ['anggaran dan perkiraan', 'anggaran dan proyeksi', 'anggaran', 'perkiraan', 'proyeksi', 'budget and forecast', 'budget dan forecast', 'budget', 'forecast'] },
  { path: '/tax-compliance', nama: 'Pajak dan Kepatuhan', alias: ['pajak dan kepatuhan', 'kepatuhan pajak', 'pajak', 'tax and compliance', 'tax compliance', 'tax', 'compliance'] },
  {
    path: '/financial-analytics', nama: 'Analitik Keuangan', alias: ['analitik keuangan', 'financial analytics', 'analitik', 'analytics'],
    tab: tabQuery([
      ['solvency', 'Solvabilitas', ['solvency', 'solvabilitas', 'solvency analysis']],
      ['efficiency', 'Efisiensi', ['efficiency', 'efisiensi', 'operational efficiency', 'efisiensi operasional']],
      ['customer', 'Pelanggan', ['customer', 'customers', 'pelanggan', 'per pelanggan']],
      ['product', 'Produk', ['product', 'products', 'produk', 'per produk']],
      ['category', 'Kategori', ['category', 'categories', 'kategori', 'per kategori']],
    ]),
  },

  // ----- Intelligence -----
  {
    path: '/ai-financial-analyst', nama: 'Analis Keuangan AI', alias: ['analis keuangan ai', 'analis keuangan', 'ai financial analyst', 'financial analyst'],
    tab: [
      { nama: 'Penurunan Laba', alias: ['profit decrease', 'net profit decrease', 'penurunan laba', 'laba turun', 'profit analysis', 'analisis laba'], path: '/ai-financial-analyst?analysis=profit-decrease' },
      { nama: 'Risiko Piutang', alias: ['ar risk', 'receivables risk', 'receivable risk', 'risiko piutang'], path: '/ai-financial-analyst?analysis=ar-risk' },
      { nama: 'Arus Kas', alias: ['cash flow', 'arus kas', 'cash flow analysis'], path: '/ai-financial-analyst?analysis=cash-flow' },
      { nama: 'Perbandingan Kuartal', alias: ['quarter comparison', 'q comparison', 'quarterly comparison', 'perbandingan kuartal', 'banding kuartal'], path: '/ai-financial-analyst?analysis=q-comparison' },
      { nama: 'Anomali Biaya', alias: ['expense anomaly', 'unusual expenses', 'anomali biaya', 'biaya tidak biasa', 'biaya janggal'], path: '/ai-financial-analyst?analysis=expense-anomaly' },
      { nama: 'Risiko Utang', alias: ['ap risk', 'payables risk', 'payable risk', 'risiko utang'], path: '/ai-financial-analyst?analysis=ap-risk' },
    ],
  },
  {
    path: '/audit', nama: 'Audit', alias: ['audit', 'jejak audit', 'audit trail'],
    tab: tabQuery([
      ['all', 'Semua', ['all', 'semua']],
      ['open', 'Terbuka', ['open', 'terbuka']],
      ['high-risk', 'Risiko Tinggi', ['high risk', 'risiko tinggi']],
      ['resolved', 'Selesai', ['resolved', 'selesai', 'terselesaikan']],
    ]),
  },

  // ----- Manajemen -----
  {
    path: '/reports', nama: 'Laporan', alias: ['laporan', 'reports', 'report'],
    tab: tabQuery([
      ['business-overview', 'Ringkasan Bisnis', ['business overview', 'ringkasan bisnis', 'overview', 'ringkasan']],
      ['sales', 'Penjualan', ['sales', 'penjualan']],
      ['purchases', 'Pembelian', ['purchases', 'purchase', 'pembelian']],
      ['inventory', 'Persediaan', ['inventory', 'persediaan']],
      ['fixed-assets', 'Aset Tetap', ['fixed assets', 'fixed asset', 'aset tetap']],
      ['banking', 'Perbankan', ['banking', 'perbankan', 'bank']],
      ['tax', 'Pajak', ['tax', 'pajak']],
      ['production', 'Produksi', ['production', 'produksi']],
      ['scheduled', 'Laporan Terjadwal', ['scheduled reports', 'scheduled report', 'scheduled', 'laporan terjadwal', 'terjadwal']],
    ]),
  },
  { path: '/reports/general-ledger', nama: 'Buku Besar', alias: ['buku besar', 'general ledger', 'ledger'] },
  {
    // tab klien hanya berlaku bila detail klien sedang terbuka
    path: '/clients', nama: 'Klien', alias: ['klien', 'client', 'clients', 'daftar klien'],
    tab: tabQuery([
      ['overview', 'Ringkasan', A_OVERVIEW],
      ['financial', 'Keuangan', ['financial', 'finance', 'keuangan']],
      ['health', 'Skor Kesehatan', ['health score', 'health', 'skor kesehatan', 'kesehatan']],
      ['activity', 'Aktivitas', ['activity', 'aktivitas']],
      ['ai', 'Insight AI', ['ai insights', 'ai insight', 'insights', 'insight ai', 'insight']],
    ]),
  },
  {
    path: '/coa', nama: 'Bagan Akun', alias: ['bagan akun', 'chart of accounts', 'coa', 'daftar akun'],
    tab: [
      { nama: 'Per Klien', alias: ['per klien', 'per client', 'client', 'klien', 'akun klien'], path: '/coa' },
      { nama: 'Belum Ditetapkan', alias: ['unassigned', 'belum ditetapkan', 'belum ditentukan', 'belum di assign', 'tanpa klien'], path: '/coa?view=unassigned' },
    ],
  },
  { path: '/coa/opening-balances', nama: 'Saldo Awal', alias: ['saldo awal', 'opening balance', 'opening balances'] },
  { path: '/year-end-closing', nama: 'Tutup Buku', alias: ['tutup buku', 'tutup buku akhir tahun', 'year end closing', 'year end', 'closing akhir tahun', 'closing'] },
  { path: '/documents', nama: 'Dokumen', alias: ['dokumen', 'documents', 'document'] },
  {
    path: '/payroll', nama: 'Penggajian', alias: ['penggajian', 'payroll', 'gaji'],
    tab: tabQuery([
      ['overview', 'Ringkasan', A_OVERVIEW],
      ['employees', 'Karyawan', ['employees', 'employee', 'karyawan', 'pegawai']],
      ['runs', 'Proses Penggajian', ['payroll run', 'run payroll', 'proses penggajian', 'proses gaji', 'penggajian bulanan']],
      ['tax', 'Pajak dan BPJS', ['tax and bpjs', 'tax bpjs', 'pajak dan bpjs', 'pajak bpjs', 'bpjs']],
      ['settings', 'Pengaturan', ['settings', 'setting', 'pengaturan']],
    ]),
  },

  { path: '/settings', nama: 'Pengaturan', alias: ['pengaturan', 'settings', 'setting'] },
  { path: '/settings/company', nama: 'Pengaturan Perusahaan', alias: ['pengaturan perusahaan', 'setting perusahaan', 'settings company', 'company settings', 'company setting'] },
  { path: '/settings/users', nama: 'Pengaturan Pengguna', alias: ['pengaturan pengguna', 'pengaturan user', 'kelola pengguna', 'manajemen pengguna', 'user settings', 'users settings', 'user management'] },
  { path: '/settings/purchase', nama: 'Pengaturan Pembelian', alias: ['pengaturan pembelian', 'setting pembelian', 'purchase settings', 'purchase setting'] },
  { path: '/settings/product', nama: 'Pengaturan Produk', alias: ['pengaturan produk', 'setting produk', 'product settings', 'product setting'] },
  { path: '/settings/account-mapping', nama: 'Pemetaan Akun', alias: ['pemetaan akun', 'account mapping', 'mapping akun'] },
];

// ---------- mesin pencocok ----------
// kata pemicu: tanpa ini, ucapan dianggap PERTANYAAN biasa dan diserahkan ke AI
// [DIUBAH] ditambah ganti / geser / lompat (dan padanannya): "ganti ke tab source data di sales" = pindah, BUKAN minta penjelasan.
// (mis. "jelaskan apa itu laba rugi" tidak boleh langsung membuka halaman)
const POLA_BUKA =
  /\b(?:buka|bukakan|bukain|membuka|pergi|pindah|pindahkan|menuju|masuk|ke halaman|ke tab|ke menu|arahkan ke|bawa saya ke|bawa aku ke|navigasi ke|ganti|gantikan|geser|menggeser|lompat|melompat|loncat|beralih|berpindah|alihkan|go to|open|switch|change to|move to|jump to|shift to|navigate to|take me to)\b/;
// kata pemicu khusus halaman form baru / export (hanya berlaku untuk halaman bertanda aksi, supaya
// "buatkan ringkasan laba rugi" tetap dijawab AI dan tidak membuka halaman)
const POLA_AKSI = /\b(?:buat|buatkan|bikin|bikinkan|tambah|tambahkan|create|add|new|export|ekspor)\b/;
const POLA_KEMBALI = /\b(?:kembali|balik|mundur)\b/;
const POLA_TAB = /\btab\b/;
// [BARU] "ganti/geser/change" + objek yang BUKAN halaman (mis. "ganti periode laporan", "ganti bahasa") -> biarkan AI yang menjawab.
// Hanya berlaku bila kata kerja langsung diikuti objek ini; "ganti ke ..." (tujuan) tidak terpengaruh.
const POLA_ABAIKAN =
  /\b(?:ganti|gantikan|geser|menggeser|change)\s+(?:periode|bulan|tahun|tanggal|rentang|bahasa|tema|nama|password|kata sandi|filter|mata uang|currency|period|month|year|date|range|language|theme|name)\b/;
const MAKS_KATA = 14; // perintah navigasi itu pendek; kalimat panjang = pertanyaan untuk AI

// "budget and forecast" juga dikenali sebagai "budget dan forecast" / "budget forecast" (dan sebaliknya)
function variasi(alias: string): string[] {
  const out = new Set([alias]);
  for (const [a, b] of [[' and ', ' dan '], [' dan ', ' and ']] as const) {
    if (alias.includes(a)) out.add(alias.split(a).join(b));
  }
  for (const a of [...out]) {
    if (a.includes(' and ')) out.add(a.split(' and ').join(' '));
    if (a.includes(' dan ')) out.add(a.split(' dan ').join(' '));
  }
  return [...out];
}

type Span = [number, number];
const tumpang = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];

// alias terpanjang yang ada di teks (teks sudah dipadding spasi di kedua ujung)
function cariAlias(padded: string, alias: string[], hindar?: Span): { len: number; span: Span } | null {
  let terbaik: { len: number; span: Span } | null = null;
  for (const a0 of alias) {
    for (const a of variasi(a0)) {
      let dari = 0;
      for (;;) {
        const i = padded.indexOf(` ${a} `, dari);
        if (i < 0) break;
        const span: Span = [i + 1, i + 1 + a.length];
        if (!hindar || !tumpang(span, hindar)) {
          if (!terbaik || a.length > terbaik.len) terbaik = { len: a.length, span };
          break;
        }
        dari = i + 1;
      }
    }
  }
  return terbaik;
}

const targetTab = (h: Halaman, t: Tab) => ({
  path: t.path ?? `${h.path}?tab=${t.query}`,
  nama: t.nama.includes(h.nama) ? t.nama : `${t.nama} di ${h.nama}`,
  tabQuery: t.query,
});

// halaman bertab yang sedang dibuka (supaya "buka tab posted" tanpa menyebut halaman tetap jalan)
function halamanBertabSaatIni(path?: string): Halaman | null {
  if (!path) return null;
  const p = path.split('?')[0];
  let terbaik: Halaman | null = null;
  for (const h of HALAMAN) {
    if (!h.tab) continue;
    if (p === h.path || p.startsWith(h.path + '/')) {
      if (!terbaik || h.path.length > terbaik.path.length) terbaik = h;
    }
  }
  return terbaik;
}

export function bacaNavigasi(teksNormal: string, pathSaatIni?: string): HasilNavigasi | null {
  const teks = teksNormal.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  if (!teks) return null;
  const jumlahKata = teks.split(' ').length;
  if (jumlahKata > MAKS_KATA) return null;
  if (POLA_ABAIKAN.test(teks)) return null;

  const pemicuBuka = POLA_BUKA.test(teks);
  if (pemicuBuka || POLA_AKSI.test(teks)) {
    const padded = ` ${teks} `;

    // 1) cari halaman (+ tab di halaman itu) yang disebut di ucapan
    let terbaik: { skor: number; h: Halaman; tab?: Tab } | null = null;
    for (const h of HALAMAN) {
      if (!pemicuBuka && !h.aksi) continue; // pemicu "buat/tambah/export" hanya untuk halaman form baru & export
      const ph = cariAlias(padded, h.alias);
      if (!ph) continue;
      if (!terbaik || (terbaik.skor < 1000 && ph.len > terbaik.skor)) terbaik = { skor: ph.len, h };
      for (const t of h.tab ?? []) {
        const pt = cariAlias(padded, t.alias, ph.span);
        if (!pt) continue;
        const skor = 1000 + ph.len + pt.len;
        if (!terbaik || skor > terbaik.skor) terbaik = { skor, h, tab: t };
      }
    }

    // 2) tab saja, di halaman yang sedang dibuka ("buka tab posted")
    const cur = pemicuBuka ? halamanBertabSaatIni(pathSaatIni) : null;
    let lokal: { len: number; tab: Tab } | null = null;
    if (cur) {
      for (const t of cur.tab ?? []) {
        const pt = cariAlias(padded, t.alias);
        if (pt && (!lokal || pt.len > lokal.len)) lokal = { len: pt.len, tab: t };
      }
    }

    if (terbaik?.tab) return { jenis: 'buka', ...targetTab(terbaik.h, terbaik.tab) };
    if (cur && lokal && (POLA_TAB.test(teks) || !terbaik)) return { jenis: 'buka', ...targetTab(cur, lokal.tab) };
    if (terbaik) return { jenis: 'buka', path: terbaik.h.path, nama: terbaik.h.nama };
    // ada kata "buka"/"ke halaman" tapi halamannya tidak dikenal: lanjut cek "kembali", kalau bukan -> biar AI yang menjawab
  }
  if (jumlahKata <= 5 && POLA_KEMBALI.test(teks) && /\b(?:halaman|sebelumnya|kembali)\b/.test(teks)) {
    return { jenis: 'kembali' };
  }
  return null;
}

// ---------- [BARU] klarifikasi tab: nama tab disebut TANPA halaman, padahal ada di beberapa halaman ----------
// Contoh: "pindah ke tab source data" -> Data Sumber ada di Penjualan, Pembelian, Entri Jurnal, dst.
// VoiceAssistant menanyakannya sendiri (tanpa AI), mengingat pilihan, lalu membuka tab sesuai jawaban berikutnya.
export type KandidatTab = { path: string; nama: string; tabQuery?: string; halaman: string; aliasHalaman: string[] };

export function bacaKlarifikasiTab(teksNormal: string): { nama: string; kandidat: KandidatTab[] } | null {
  const teks = teksNormal.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  if (!teks || teks.split(' ').length > MAKS_KATA || POLA_ABAIKAN.test(teks) || !POLA_BUKA.test(teks)) return null;
  const padded = ` ${teks} `;
  for (const h of HALAMAN) if (cariAlias(padded, h.alias)) return null; // halaman sudah disebut -> bukan kasus ambigu
  const ketemu: { k: KandidatTab; len: number; nama: string }[] = [];
  for (const h of HALAMAN) {
    for (const t of h.tab ?? []) {
      const pt = cariAlias(padded, t.alias);
      if (!pt || (!t.path && !t.query)) continue;
      ketemu.push({ k: { ...targetTab(h, t), halaman: h.nama, aliasHalaman: h.alias }, len: pt.len, nama: t.nama });
    }
  }
  if (ketemu.length === 0) return null;
  const maks = Math.max(...ketemu.map((x) => x.len));
  const terpilih = ketemu.filter((x) => x.len === maks);
  const kandidat: KandidatTab[] = [];
  for (const x of terpilih) if (!kandidat.some((y) => y.path === x.k.path)) kandidat.push(x.k);
  if (new Set(kandidat.map((k) => k.halaman)).size < 2) return null;
  return { nama: terpilih[0].nama, kandidat };
}

// Jawaban atas pertanyaan di atas: sebut nama halamannya ("di penjualan", "yang pembelian") atau urutannya ("yang kedua").
export function pilihKandidatTab(teksNormal: string, kandidat: KandidatTab[]): KandidatTab | null {
  const teks = teksNormal.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  if (!teks) return null;
  const padded = ` ${teks} `;
  let terbaik: KandidatTab | null = null;
  let len = 0;
  let seri = false;
  for (const k of kandidat) {
    const m = cariAlias(padded, k.aliasHalaman);
    if (!m) continue;
    if (m.len > len) { len = m.len; terbaik = k; seri = false; } else if (m.len === len) seri = true;
  }
  if (terbaik && !seri) return terbaik;
  const urut: [RegExp, number][] = [
    [/\b(?:pertama|satu|first|1)\b/, 0], [/\b(?:kedua|dua|second|2)\b/, 1],
    [/\b(?:ketiga|tiga|third|3)\b/, 2], [/\b(?:keempat|empat|fourth|4)\b/, 3],
  ];
  for (const [re, i] of urut) if (re.test(teks) && kandidat[i]) return kandidat[i];
  return null;
}

// ---------- [BARU] salah dengar nama halaman / tab ----------
// Dipanggil HANYA bila bacaNavigasi() = null padahal ucapan jelas perintah buka ("buka neraka" -> Neraca).
// Hasilnya selalu DIKONFIRMASI dulu oleh VoiceAssistant ("Maksudnya buka Neraca?").
const POLA_TANYA_NAV = /^(?:berapa|apa|apakah|siapa|kapan|kenapa|mengapa|bagaimana|gimana|jelaskan|cara|bisakah|how|what|why|when|explain)\b/;

function ratakanHalaman(): EntriNav[] {
  const out: EntriNav[] = [];
  for (const h of HALAMAN) {
    out.push({ path: h.path, nama: h.nama, alias: h.alias });
    for (const t of h.tab ?? []) {
      out.push({
        path: t.path ?? `${h.path}?tab=${t.query}`,
        nama: t.nama.includes(h.nama) ? t.nama : `${t.nama} di ${h.nama}`,
        alias: t.alias,
        tabQuery: t.query,
      });
    }
  }
  return out;
}

export function bacaNavigasiMirip(teksNormal: string): KandidatHalaman[] {
  const teks = teksNormal.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  if (!teks || teks.split(' ').length > MAKS_KATA) return [];
  if (POLA_ABAIKAN.test(teks) || POLA_TANYA_NAV.test(teks)) return [];
  if (!(POLA_BUKA.test(teks) || POLA_AKSI.test(teks))) return [];
  return cariHalamanMirip(teks, ratakanHalaman());
}