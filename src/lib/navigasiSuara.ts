// navigasiSuara.ts — mengubah ucapan seperti "buka laba rugi" menjadi tujuan halaman.
// Tidak memanggil AI sama sekali (instan, gratis, dan tidak bisa "ngawur" membuka rute yang tidak ada).
// Tambah halaman baru cukup dengan menambah satu baris di HALAMAN di bawah.

export type HasilNavigasi =
  | { jenis: 'buka'; path: string; nama: string }
  | { jenis: 'kembali' };

type Halaman = { path: string; nama: string; alias: string[] };

// alias ditulis huruf kecil, tanpa tanda baca (persis seperti hasil normalisasi di VoiceAssistant)
const HALAMAN: Halaman[] = [
  { path: '/', nama: 'Overview', alias: ['overview', 'beranda', 'dashboard', 'halaman utama'] },
  { path: '/agent-ai', nama: 'Agent AI', alias: ['agent ai', 'agen ai', 'halaman agent'] },
  { path: '/memori-ai', nama: 'Memori AI', alias: ['memori ai', 'memori', 'ingatan ai', 'ingatan'] },

  { path: '/financial-statements', nama: 'Laporan Keuangan', alias: ['laporan keuangan', 'financial statements', 'financial statement'] },
  { path: '/financial-statements/profit-loss', nama: 'Laba Rugi', alias: ['laba rugi', 'profit and loss', 'profit loss', 'profit dan loss'] },
  { path: '/financial-statements/balance-sheet', nama: 'Neraca', alias: ['neraca', 'balance sheet'] },
  { path: '/financial-statements/cash-flow', nama: 'Arus Kas', alias: ['arus kas', 'cash flow'] },
  { path: '/financial-statements/changes-in-equity', nama: 'Perubahan Ekuitas', alias: ['perubahan ekuitas', 'laporan perubahan ekuitas', 'changes in equity'] },
  { path: '/financial-statements/notes', nama: 'Catatan Laporan Keuangan', alias: ['catatan laporan keuangan', 'catatan atas laporan keuangan', 'calk', 'notes'] },
  { path: '/financial-statements/mapping', nama: 'Pemetaan Laporan', alias: ['pemetaan laporan', 'mapping laporan', 'statement mapping'] },

  { path: '/transactions', nama: 'Transaksi', alias: ['transaksi', 'transactions'] },
  { path: '/transactions/sales', nama: 'Penjualan', alias: ['penjualan', 'sales'] },
  { path: '/transactions/purchase', nama: 'Pembelian', alias: ['pembelian', 'purchase'] },
  { path: '/transactions/journal-entry', nama: 'Jurnal Umum', alias: ['jurnal umum', 'jurnal', 'journal entry'] },
  { path: '/transactions/bank-cash', nama: 'Kas dan Bank', alias: ['kas dan bank', 'kas bank', 'cash bank', 'cash and bank', 'cash dan bank', 'bank'] },
  { path: '/transactions/bank-cash/reconciliation', nama: 'Rekonsiliasi Bank', alias: ['rekonsiliasi bank', 'rekonsiliasi', 'bank reconciliation'] },
  { path: '/transactions/other', nama: 'Transaksi Lain', alias: ['transaksi lain', 'transaksi lainnya'] },

  { path: '/accounts-receivable', nama: 'Piutang', alias: ['piutang', 'account receivable', 'accounts receivable'] },
  { path: '/accounts-payable', nama: 'Utang', alias: ['utang', 'hutang', 'account payable', 'accounts payable'] },

  { path: '/assets', nama: 'Aset', alias: ['aset', 'asset', 'assets', 'aktiva tetap'] },
  { path: '/liabilities', nama: 'Liabilitas', alias: ['liabilitas', 'kewajiban', 'liabilities'] },
  { path: '/equity', nama: 'Ekuitas', alias: ['ekuitas', 'modal', 'equity'] },

  { path: '/budget-forecast', nama: 'Anggaran dan Proyeksi', alias: ['anggaran', 'budget', 'forecast', 'proyeksi', 'budget dan forecast'] },
  { path: '/tax-compliance', nama: 'Pajak', alias: ['pajak', 'tax', 'kepatuhan pajak', 'tax compliance'] },
  { path: '/financial-analytics', nama: 'Analitik Keuangan', alias: ['analitik keuangan', 'financial analytics', 'analitik'] },

  { path: '/ai-financial-analyst', nama: 'Analis Keuangan AI', alias: ['analis keuangan ai', 'analis keuangan', 'ai financial analyst'] },
  { path: '/audit', nama: 'Audit', alias: ['audit', 'jejak audit'] },

  { path: '/reports', nama: 'Laporan', alias: ['laporan', 'reports', 'report'] },
  { path: '/reports/general-ledger', nama: 'Buku Besar', alias: ['buku besar', 'general ledger'] },
  { path: '/clients', nama: 'Klien', alias: ['klien', 'client', 'clients', 'daftar klien'] },
  { path: '/coa', nama: 'Bagan Akun', alias: ['bagan akun', 'chart of accounts', 'coa', 'daftar akun'] },
  { path: '/coa/opening-balances', nama: 'Saldo Awal', alias: ['saldo awal', 'opening balance', 'opening balances'] },
  { path: '/year-end-closing', nama: 'Tutup Buku', alias: ['tutup buku', 'year end closing', 'closing akhir tahun'] },
  { path: '/documents', nama: 'Dokumen', alias: ['dokumen', 'documents'] },
  { path: '/payroll', nama: 'Penggajian', alias: ['penggajian', 'payroll', 'gaji'] },

  { path: '/settings', nama: 'Pengaturan', alias: ['pengaturan', 'settings', 'setting'] },
  { path: '/settings/company', nama: 'Pengaturan Perusahaan', alias: ['pengaturan perusahaan', 'setting perusahaan', 'settings company'] },
  { path: '/settings/users', nama: 'Pengaturan Pengguna', alias: ['pengaturan pengguna', 'pengaturan user', 'kelola pengguna', 'manajemen pengguna'] },
  { path: '/settings/purchase', nama: 'Pengaturan Pembelian', alias: ['pengaturan pembelian', 'setting pembelian'] },
  { path: '/settings/product', nama: 'Pengaturan Produk', alias: ['pengaturan produk', 'setting produk'] },
  { path: '/settings/account-mapping', nama: 'Pemetaan Akun', alias: ['pemetaan akun', 'account mapping', 'mapping akun'] },
];

// kata pemicu: tanpa ini, ucapan dianggap PERTANYAAN biasa dan diserahkan ke AI
// (mis. "jelaskan apa itu laba rugi" tidak boleh langsung membuka halaman)
const POLA_BUKA = /\b(?:buka|bukakan|bukain|membuka|pergi ke|pindah ke|menuju|masuk ke|ke halaman|arahkan ke|bawa saya ke|bawa aku ke|navigasi ke)\b/;
const POLA_KEMBALI = /\b(?:kembali|balik|mundur)\b/;
const MAKS_KATA = 9; // perintah navigasi itu pendek; kalimat panjang = pertanyaan untuk AI

const polaAlias = (a: string) => new RegExp(`(?:^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);

// alias terpanjang dicoba dulu supaya "perubahan ekuitas" menang atas "ekuitas"
const DAFTAR = HALAMAN.flatMap((h) => h.alias.map((a) => ({ h, a, re: polaAlias(a) }))).sort(
  (x, y) => y.a.length - x.a.length
);

export function bacaNavigasi(teksNormal: string): HasilNavigasi | null {
  const teks = teksNormal.trim();
  if (!teks) return null;
  const jumlahKata = teks.split(' ').length;
  if (jumlahKata > MAKS_KATA) return null;

  if (POLA_BUKA.test(teks)) {
    for (const { h, re } of DAFTAR) {
      if (re.test(teks)) return { jenis: 'buka', path: h.path, nama: h.nama };
    }
    // ada kata "buka"/"ke halaman" tapi halamannya tidak dikenal: lanjut cek "kembali", kalau bukan -> biar AI yang menjawab
  }
  if (jumlahKata <= 5 && POLA_KEMBALI.test(teks) && /\b(?:halaman|sebelumnya|kembali)\b/.test(teks)) {
    return { jenis: 'kembali' };
  }
  return null;
}