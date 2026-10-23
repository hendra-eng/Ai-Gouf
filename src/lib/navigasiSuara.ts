// navigasiSuara.ts — mengubah ucapan seperti "buka laba rugi" atau "pindah ke tab source data di halaman purchase"
// menjadi tujuan halaman (+ tab). Tidak memanggil AI sama sekali (instan, gratis, dan tidak bisa "ngawur"
// membuka rute yang tidak ada).
//
// Dua bahasa: sidebar tampil Bahasa Indonesia, tapi semua halaman & tab juga dikenali dengan nama Inggris
// (mis. "budget and forecast", "profit and loss", "source data"). Tambah halaman/tab baru cukup dengan
// menambah satu baris di HALAMAN di bawah. Alias ditulis huruf kecil, tanpa tanda baca.

import { cariHalamanMirip, type EntriNav, type KandidatHalaman } from './salahDengarSuara';

export type HasilNavigasi =
  | { jenis: 'buka'; path: string; nama: string; tabQuery?: string; belumTersedia?: boolean }
  | { jenis: 'kembali' };

type Tab = { nama: string; alias: string[]; path?: string; query?: string };
// aksi: true = halaman form baru / export; boleh dipicu juga dengan kata "buat", "tambah", "export"
// kartu: true = kartu di halaman Laporan (nama lengkapnya lebih spesifik daripada nama halaman/tab biasa, jadi diutamakan)
// belum: true = kartu laporan "Coming Soon" (path = halaman Laporan + ?tab=); tabQuery = tab Laporan yang memuat kartu itu
type Halaman = { path: string; nama: string; alias: string[]; tab?: Tab[]; aksi?: boolean; belum?: boolean; tabQuery?: string; kartu?: boolean };

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
    // Halaman Other kini satu workspace dengan tab berbasis ?tab= (bukan lagi rute terpisah per tab)
    tab: tabQuery([
      ['overview', 'Ringkasan', A_OVERVIEW],
      ['categories', 'Kategori', ['categories', 'category', 'kategori', 'jenis transaksi']],
      ['review', 'Antrean Review', ['review queue', 'antrean review', 'antrean persetujuan', 'review', 'approval', 'persetujuan']],
      ['preview', 'Pratinjau Jurnal', A_PREVIEW],
      ['exceptions', 'Pengecualian', A_EXCEPTIONS],
      ['posted', 'Diposting', A_POSTED],
    ]),
  },

  // ----- Form baru & export (halaman di dalam halaman) -----
  { path: '/accounts-receivable/invoices/new', nama: 'Invoice Baru', aksi: true, alias: ['invoice baru', 'faktur baru', 'new invoice', 'create invoice', 'buat invoice', 'tambah invoice', 'buat faktur', 'tambah faktur'] },
  { path: '/accounts-receivable/receipts/new', nama: 'Penerimaan Baru', aksi: true, alias: ['receipt baru', 'penerimaan baru', 'penerimaan pembayaran baru', 'new receipt', 'create receipt', 'buat receipt', 'tambah receipt', 'buat penerimaan', 'tambah penerimaan'] },
  { path: '/accounts-payable/payments/new', nama: 'Pembayaran Utang Baru', aksi: true, alias: ['payment baru', 'pembayaran baru', 'pembayaran utang baru', 'new payment', 'create payment', 'buat payment', 'buat pembayaran', 'tambah payment', 'tambah pembayaran'] },
  { path: '/transactions/sales/invoice/new', nama: 'Invoice Penjualan Baru', aksi: true, alias: ['invoice penjualan baru', 'faktur penjualan baru', 'new sales invoice', 'create sales invoice', 'buat invoice penjualan', 'tambah invoice penjualan'] },
  { path: '/transactions/other/create', nama: 'Transaksi Lainnya Baru', aksi: true, alias: ['transaksi lain baru', 'transaksi lainnya baru', 'new other transaction', 'create other transaction', 'buat transaksi lain', 'buat transaksi lainnya', 'tambah transaksi lain'] },
  { path: '/transactions/purchase/bills/new', nama: 'Bill Pembelian Baru', aksi: true, alias: ['bill baru', 'tagihan baru', 'tagihan pembelian baru', 'new bill', 'create bill', 'buat bill', 'tambah bill', 'buat tagihan pembelian'] },
  { path: '/coa/new', nama: 'Akun Baru', aksi: true, alias: ['akun baru', 'new account', 'create account', 'buat akun', 'tambah akun', 'tambah akun baru'] },
  { path: '/coa/opening-balances/new', nama: 'Saldo Awal Baru', aksi: true, alias: ['saldo awal baru', 'new opening balance', 'create opening balance', 'buat saldo awal', 'tambah saldo awal'] },
  { path: '/accounts-receivable/export', nama: 'Ekspor Piutang', aksi: true, alias: ['export piutang', 'ekspor piutang', 'export accounts receivable', 'export receivable', 'export ar', 'ekspor ar'] },
  { path: '/accounts-payable/export', nama: 'Ekspor Utang', aksi: true, alias: ['export utang', 'ekspor utang', 'export hutang', 'ekspor hutang', 'export accounts payable', 'export payable', 'export ap', 'ekspor ap'] },

  // ----- Piutang & Utang -----
  {
    path: '/accounts-receivable', nama: 'Piutang Usaha', alias: ['piutang usaha', 'piutang', 'accounts receivable', 'account receivable', 'receivables', 'receivable', 'ar'],
    tab: tabQuery([
      ['overview', 'Ringkasan Piutang', A_OVERVIEW],
      ['invoices', 'Invoice Piutang', ['invoices', 'invoice', 'faktur', 'daftar invoice', 'daftar faktur', 'faktur penjualan']],
      ['aging', 'Umur Piutang', ['aging', 'umur piutang', 'ar aging', 'receivable aging', 'receivables aging', 'aging piutang']],
      ['settlements', 'Penagihan', ['collections', 'collection', 'penagihan', 'penerimaan pembayaran', 'tagihan']],
      ['statements', 'Laporan Pelanggan', ['customer statements', 'customer statement', 'statement pelanggan', 'laporan pelanggan', 'rekening koran pelanggan', 'statements']],
      ['posted', 'Piutang Diposting', A_POSTED],
    ]),
  },
  {
    path: '/accounts-payable', nama: 'Utang Usaha', alias: ['utang usaha', 'utang', 'hutang usaha', 'hutang', 'accounts payable', 'account payable', 'payables', 'payable', 'ap'],
    tab: tabQuery([
      ['overview', 'Ringkasan Utang', A_OVERVIEW],
      ['invoices', 'Tagihan Vendor', ['bills', 'bill', 'tagihan vendor', 'tagihan', 'daftar bill', 'daftar tagihan', 'faktur pembelian']],
      ['aging', 'Umur Utang', ['aging', 'umur utang', 'umur hutang', 'ap aging', 'payable aging', 'payables aging', 'aging utang', 'aging hutang']],
      ['settlements', 'Pembayaran Utang', ['payments', 'payment', 'pembayaran utang', 'pembayaran hutang', 'pembayaran vendor', 'pembayaran']],
      ['statements', 'Laporan Vendor', ['vendor statements', 'vendor statement', 'statement vendor', 'laporan vendor', 'rekening koran vendor', 'statements']],
      ['posted', 'Utang Diposting', A_POSTED],
    ]),
  },

  // ----- Aset, Kewajiban, Ekuitas -----
  {
    path: '/inventory', nama: 'Persediaan', alias: ['persediaan', 'inventory', 'inventori', 'stok barang', 'stok'],
    tab: tabQuery([
      ['overview', 'Ringkasan', A_OVERVIEW],
      ['items', 'Daftar Item', ['item list', 'daftar item', 'daftar barang', 'items', 'item']],
      ['movement', 'Pergerakan Stok', ['stock movement', 'pergerakan stok', 'mutasi stok', 'movement']],
      ['adjustments', 'Penyesuaian', ['adjustments', 'adjustment', 'penyesuaian stok', 'penyesuaian']],
      ['transfer', 'Transfer', ['transfer', 'transfer stok', 'pindah gudang']],
      ['reports', 'Laporan Persediaan', ['inventory reports', 'laporan persediaan', 'laporan stok']],
    ]),
  },
  {
    path: '/assets', nama: 'Aset', alias: ['aset', 'asset', 'assets', 'aktiva tetap'],
    tab: tabQuery([
      ['overview', 'Ringkasan Aset', A_OVERVIEW],
      ['register', 'Daftar Aset', ['asset register', 'fixed asset register', 'register aset', 'daftar aset', 'register']],
      ['depreciation', 'Penyusutan', ['depreciation', 'depreciation schedule', 'penyusutan', 'depresiasi', 'jadwal penyusutan']],
      ['disposal', 'Pelepasan Aset', ['disposal', 'disposals', 'pelepasan aset', 'pelepasan', 'penjualan aset']],
      ['reports', 'Laporan Aset', ['asset reports', 'laporan aset', 'reports']],
      ['posted', 'Aset Diposting', A_POSTED],
    ]),
  },
  { path: '/liabilities', nama: 'Kewajiban', alias: ['kewajiban', 'liabilitas', 'liabilities', 'liability'] },
  { path: '/equity', nama: 'Ekuitas', alias: ['ekuitas', 'modal', 'equity'] },

  // ----- Perencanaan -----
  { path: '/budget-forecast', nama: 'Anggaran dan Perkiraan', alias: ['anggaran dan perkiraan', 'anggaran dan proyeksi', 'anggaran', 'perkiraan', 'proyeksi', 'budget and forecast', 'budget dan forecast', 'budget', 'forecast'] },
  {
    path: '/tax-compliance', nama: 'Pajak dan Kepatuhan', alias: ['pajak dan kepatuhan', 'kepatuhan pajak', 'pajak', 'tax and compliance', 'tax compliance', 'tax', 'compliance'],
    tab: tabQuery([
      ['overview', 'Ringkasan Pajak', [...A_OVERVIEW, 'tax summary']],
      ['ledger', 'Buku Pajak', ['tax ledger', 'buku pajak', 'ledger pajak', 'ledger']],
      ['pph', 'PPh', ['pph', 'p p h', 'pajak penghasilan', 'income tax', 'withholding tax']],
      ['vat', 'PPN', ['vat', 'vat report', 'laporan ppn', 'ppn', 'p p n', 'pajak pertambahan nilai', 'value added tax']],
      ['payments', 'Pembayaran Pajak', ['tax payments', 'tax payment', 'pembayaran pajak', 'setoran pajak', 'setoran', 'pembayaran', 'payments']],
      ['reconciliation', 'Rekonsiliasi Pajak', ['tax reconciliation', 'rekonsiliasi pajak', 'reconciliation', 'rekonsiliasi']],
      ['exceptions', 'Pengecualian Pajak', A_EXCEPTIONS],
      ['reports', 'Laporan Pajak', ['tax reports', 'laporan pajak', 'reports']],
    ]),
  },
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

  // ----- Kartu di halaman Laporan (Reports) -----
  // Sumber: src/app/reports/components/ReportsCatalog.tsx (REPORTS). Kartu yang tujuannya sudah punya halaman/tab di atas
  // (Balance Sheet, Profit & Loss, Cash Flow, General Ledger, Bank Reconciliation, Receivables/Payables Aging, Fixed Asset Register,
  // Depreciation Schedule, Tax Summary, VAT Report, Withholding Tax, Posted Cash & Bank) sudah dikenali lewat entri di atas.
  // Di bawah ini kartu yang BELUM punya entri sendiri. belum: true = kartu "Coming Soon" -> Neo membuka tab Laporan-nya dan
  // memberi tahu bahwa laporan itu belum tersedia. Kalau ReportsCatalog berubah (href null -> halaman), ubah entri di sini juga.
  { path: '/transactions/journal-entry/posted', nama: 'Laporan Jurnal', kartu: true, alias: ['journal report', 'laporan jurnal', 'laporan journal'] },
  { path: '/reports?tab=business-overview', nama: 'Neraca Saldo', kartu: true, belum: true, tabQuery: 'business-overview', alias: ['trial balance', 'neraca saldo', 'saldo percobaan'] },
  { path: '/transactions/sales', nama: 'Register Penjualan', kartu: true, alias: ['sales register', 'register penjualan', 'daftar penjualan'] },
  { path: '/reports?tab=sales', nama: 'Penjualan per Pelanggan', kartu: true, belum: true, tabQuery: 'sales', alias: ['sales by customer', 'penjualan per pelanggan', 'penjualan per customer', 'penjualan berdasarkan pelanggan'] },
  { path: '/transactions/purchase/posted', nama: 'Register Pembelian', kartu: true, alias: ['purchase register', 'register pembelian', 'daftar pembelian'] },
  { path: '/reports?tab=purchases', nama: 'Pembelian per Vendor', kartu: true, belum: true, tabQuery: 'purchases', alias: ['purchases by vendor', 'purchase by vendor', 'pembelian per vendor', 'pembelian per pemasok', 'pembelian berdasarkan vendor'] },
  { path: '/reports?tab=inventory', nama: 'Ringkasan Stok', kartu: true, belum: true, tabQuery: 'inventory', alias: ['stock summary', 'ringkasan stok', 'ringkasan persediaan'] },
  { path: '/reports?tab=inventory', nama: 'Laporan Pergerakan Stok', kartu: true, belum: true, tabQuery: 'inventory', alias: ['stock movement report', 'laporan stock movement', 'laporan pergerakan stok', 'laporan mutasi stok'] },
  { path: '/reports?tab=inventory', nama: 'Valuasi Persediaan', kartu: true, belum: true, tabQuery: 'inventory', alias: ['inventory valuation', 'valuasi persediaan', 'penilaian persediaan'] },
  { path: '/transactions/bank-cash', nama: 'Ringkasan Kas dan Bank', kartu: true, alias: ['cash and bank summary', 'cash bank summary', 'ringkasan kas dan bank', 'ringkasan kas bank'] },
  { path: '/reports?tab=production', nama: 'Ringkasan Produksi', kartu: true, belum: true, tabQuery: 'production', alias: ['production summary', 'ringkasan produksi'] },
  { path: '/reports?tab=production', nama: 'Biaya Produksi', kartu: true, belum: true, tabQuery: 'production', alias: ['production cost', 'biaya produksi'] },
  { path: '/assets?tab=register', nama: 'Daftar Aset Tetap', kartu: true, alias: ['fixed asset register', 'laporan fixed asset register', 'laporan daftar aset', 'laporan register aset'] },
  { path: '/assets?tab=depreciation', nama: 'Jadwal Penyusutan', kartu: true, alias: ['depreciation schedule', 'laporan depreciation schedule', 'laporan penyusutan', 'laporan jadwal penyusutan'] },
  { path: '/tax-compliance?tab=vat', nama: 'Laporan PPN', kartu: true, alias: ['vat report', 'laporan vat', 'laporan ppn', 'ppn'] },
  { path: '/tax-compliance?tab=pph', nama: 'PPh Dipotong', kartu: true, alias: ['withholding tax', 'pph', 'pph 21', 'pph 23', 'pph 4 2', 'pph pasal 21', 'pajak penghasilan dipotong'] },
];

// ---------- mesin pencocok ----------
// kata pemicu: tanpa ini, ucapan dianggap PERTANYAAN biasa dan diserahkan ke AI
// [DIUBAH] ditambah ganti / geser / lompat (dan padanannya): "ganti ke tab source data di sales" = pindah, BUKAN minta penjelasan.
// (mis. "jelaskan apa itu laba rugi" tidak boleh langsung membuka halaman)
const POLA_BUKA =
  /\b(?:buka|bukakan|bukain|membuka|pergi|pindah|pindahkan|menuju|masuk|ke halaman|ke tab|ke menu|arahkan ke|bawa saya ke|bawa aku ke|navigasi ke|ganti|gantikan|geser|menggeser|lompat|melompat|loncat|beralih|berpindah|alihkan|go to|open|switch|change to|move to|jump to|shift to|navigate to|take me to|pindahin|pindahkan aku ke|bawa ke|bawain|bawakan|anter|anterin|antar|tampilin|tampilkan|tunjukin|tunjukkan|munculin|munculkan|mau ke|pengen ke|pengin ke|ingin ke|yuk ke|ayo ke|langsung ke|kita ke|cabut ke|gantiin|kasih lihat|kasih liat)\b/;
// [BARU] kata kerja santai yang ambigu ("lihat/cek") -> hanya dianggap perintah buka bila kalimatnya pendek
const POLA_BUKA_LEMAH = /\b(?:lihat|liat|cek|cekin|periksa)\b/;
const POLA_NEGASI_NAV = /\b(?:jangan|tidak|nggak|gak|enggak|ga|bukan|batal|batalkan|tanpa|tak)\b/;
const POLA_TANYA_TENGAH_NAV = /\b(?:berapa|kenapa|mengapa|kapan|siapa|apakah|jelaskan|hitung|hitungkan|bagaimana|gimana)\b/;
// "bisa nggak kamu buka..." = permintaan sopan, bukan negasi
const hapusBasaBasi = (t: string) => t.replace(/\b(?:bisa|bisakah|mau|boleh)\s+(?:nggak|gak|enggak|ga|tidak)\b/g, ' ');
// [BARU] ucapan santai boleh lebih panjang; tapi kalimat panjang yang bernada tanya/negasi tetap diserahkan ke AI
const MAKS_KATA_SANTAI = 30;
function layakSebagaiPerintah(teks: string): boolean {
  const n = teks.split(' ').length;
  if (n > MAKS_KATA_SANTAI) return false;
  if (POLA_NEGASI_NAV.test(hapusBasaBasi(teks))) return false;
  if (n > MAKS_KATA && POLA_TANYA_TENGAH_NAV.test(teks)) return false;
  return true;
}
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
  if (!layakSebagaiPerintah(teks)) return null; // [DIUBAH] dulu: > 14 kata langsung ditolak
  if (POLA_ABAIKAN.test(teks)) return null;

  const pemicuBuka = POLA_BUKA.test(teks) || (jumlahKata <= 8 && POLA_BUKA_LEMAH.test(teks) && !POLA_TANYA_TENGAH_NAV.test(teks));
  if (pemicuBuka || POLA_AKSI.test(teks)) {
    const padded = ` ${teks} `;

    // 1) cari halaman (+ tab di halaman itu) yang disebut di ucapan
    let terbaik: { skor: number; h: Halaman; tab?: Tab } | null = null;
    for (const h of HALAMAN) {
      if (!pemicuBuka && !h.aksi) continue; // pemicu "buat/tambah/export" hanya untuk halaman form baru & export
      const ph = cariAlias(padded, h.alias);
      if (!ph) continue;
      // [BARU] kartu laporan ("sales register", "ringkasan stok") diutamakan atas gabungan halaman+tab yang kebetulan ikut tersebut
      const skorH = h.kartu ? 1000 + ph.len : ph.len;
      if (!terbaik || (h.kartu ? skorH > terbaik.skor : terbaik.skor < 1000 && ph.len > terbaik.skor)) terbaik = { skor: skorH, h };
      for (const t of h.tab ?? []) {
        let pt = cariAlias(padded, t.alias, ph.span);
        // [BARU] nama tab memuat nama halaman ("umur piutang", "pergerakan stok", "laporan persediaan") -> tetap dihitung sebagai tab
        if (!pt) {
          const pl = cariAlias(padded, t.alias);
          if (pl && pl.len > ph.len && pl.span[0] <= ph.span[0] && pl.span[1] >= ph.span[1]) pt = pl;
        }
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
    if (terbaik) return { jenis: 'buka', path: terbaik.h.path, nama: terbaik.h.nama, ...(terbaik.h.belum ? { belumTersedia: true, tabQuery: terbaik.h.tabQuery } : {}) };
    // [BARU] nama tab disebut TANPA halaman dan hanya ada di SATU halaman (mis. "buka tab penyusutan") -> langsung dibuka.
    // Yang ada di beberapa halaman ditanyakan lewat bacaKlarifikasiTab. Alias sangat pendek (< 4 huruf) butuh kata "tab".
    if (pemicuBuka) {
      const calon: { len: number; h: Halaman; t: Tab }[] = [];
      for (const h of HALAMAN) {
        for (const t of h.tab ?? []) {
          const pt = cariAlias(padded, t.alias);
          if (pt && (pt.len >= 4 || POLA_TAB.test(teks))) calon.push({ len: pt.len, h, t });
        }
      }
      if (calon.length > 0) {
        const maks = Math.max(...calon.map((c) => c.len));
        const teratas = calon.filter((c) => c.len === maks);
        if (new Set(teratas.map((c) => c.h.path)).size === 1) return { jenis: 'buka', ...targetTab(teratas[0].h, teratas[0].t) };
      }
    }
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
  if (!teks || !layakSebagaiPerintah(teks) || POLA_ABAIKAN.test(teks) || !(POLA_BUKA.test(teks) || (teks.split(' ').length <= 8 && POLA_BUKA_LEMAH.test(teks) && !POLA_TANYA_TENGAH_NAV.test(teks)))) return null;
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


// ---------- [BARU] Rujukan halaman/tab di dalam PERTANYAAN ("jelaskan neraka", "apa itu tab sumber data") ----------
// bacaNavigasi/bacaNavigasiMirip sengaja mengabaikan kalimat tanya, jadi salah dengar di pertanyaan tidak pernah dikoreksi.
// Fungsi ini dipakai tafsirUcapan.ts: `pasti` = alias cocok persis (bisa >1 halaman bila nama tab ada di banyak halaman),
// `mirip` = tidak cocok persis tapi mirip (salah dengar). `teksSisa` = ucapan tanpa kata tanya/pengisi.
export function cariRujukanHalaman(teksNormal: string, teksSisa: string): { pasti: EntriNav[]; mirip: KandidatHalaman[]; semuaNama: string[] } {
  const semuaNama = HALAMAN.map((h) => h.nama);
  const padded = ` ${teksNormal.replace(/&/g, ' and ').replace(/\s+/g, ' ').trim()} `;
  const daftar = ratakanHalaman();
  const ketemu: { e: EntriNav; len: number }[] = [];
  for (const e of daftar) {
    const c = cariAlias(padded, e.alias);
    if (c) ketemu.push({ e, len: c.len });
  }
  if (ketemu.length > 0) {
    const maks = Math.max(...ketemu.map((x) => x.len));
    const lihat = new Set<string>();
    const pasti = ketemu.filter((x) => x.len === maks).map((x) => x.e).filter((e) => { const k = e.path; if (lihat.has(k)) return false; lihat.add(k); return true; });
    return { pasti, mirip: [], semuaNama };
  }
  return { pasti: [], mirip: teksSisa ? cariHalamanMirip(teksSisa, daftar) : [], semuaNama };
}