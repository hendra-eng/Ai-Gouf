// salahDengarSuara.ts — toleransi SALAH DENGAR (speech-to-text) untuk nama client & nama halaman Neo.
// Fungsi MURNI (tanpa React / tanpa AI / tanpa jaringan). Lokasi: src/lib/salahDengarSuara.ts
//
// Masalah: "ganti ke client sau" didengar "client esau" / "sao" / "sow" / "so". Parser lama hanya menoleransi
// 1 huruf beda, hanya untuk kode >= 3 huruf, dan TIDAK bertanya balik. Kode 2 huruf (MM, YM) tidak pernah ditoleransi.
//
// Solusi di file ini:
//  1. Daftar kata yang MIRIP / sering salah dengar untuk tiap kode client & tiap halaman (tabel di bawah).
//  2. Kunci fonetik (sow = sao = saw = sau; "es au" = "esau" = "sau") + jarak edit.
//  3. Hasil BERTINGKAT: 'pasti' (langsung diproses) vs 'mirip' (Neo bertanya: "Maksudnya client SAU, benar?").
//     Bila ada 2-3 kandidat sama dekat, ditanyakan satu per satu: "SAU? ... atau NBM?".
//
// Cara pasang: lihat README di jawaban (3 perubahan kecil di gantiClientSuara.ts, navigasiSuara.ts, VoiceAssistant.tsx).

export type KlienSuara = { id: string; companyName: string; clientCode: string };

// ======================================================================================
// 1. TABEL KATA MIRIP — CLIENT (kunci = clientCode, huruf besar)
//    Ditulis seperti yang MUNGKIN keluar dari mikrofon. Tambah sendiri kalau menemukan salah dengar baru:
//    cukup tambah satu string ke array client yang bersangkutan.
// ======================================================================================
export const SALAH_DENGAR_CLIENT: Record<string, string[]> = {
  SAU:    ['sau', 'sao', 'sow', 'saw', 'so', 'esau', 'es au', 'e sau', 'sa u', 'sauw', 'sawu', 'saul', 'sol', 'zau', 'tsau', 'sauh', 'saos', 'sao u', 'es a u', 'esa u', 'sawo', 'sauk', 'sahu', 'seo', 'sauce', 'sour'],
  NBM:    ['nbm', 'n b m', 'en be em', 'en bi em', 'enbm', 'nbem', 'nabam', 'nbn', 'mbm', 'enbeem', 'embm', 'nbmm', 'nbem', 'anbm', 'en b m', 'n be m', 'nebem', 'n pm', 'npm', 'en pe em'],
  AADL:   ['aadl', 'a a d l', 'a adl', 'aa di el', 'a a de el', 'a a de l', 'ardl', 'adl', 'aadel', 'a dl', 'a a d el', 'ei ei di el', 'aa dl', 'adel', 'ardel'],
  ABE:    ['abe', 'a b e', 'a be e', 'abbe', 'abi', 'ebe', 'abee', 'a be', 'abeh', 'ape', 'abey', 'ai bi i', 'ay bi i', 'obe', 'abbey'],
  BIRAWA: ['birawa', 'bi rawa', 'birawah', 'birowo', 'birawo', 'biro wa', 'birahwa', 'birawan', 'bira wa', 'bi ra wa', 'berawa', 'bilawa', 'birrawa', 'pirawa', 'birawar', 'beirawa'],
  EVITA:  ['evita', 'e vita', 'efita', 'evitta', 'epita', 'evida', 'evitar', 'ebita', 'evitah', 'ifita', 'fita', 'evita', 'ivita', 'avita', 'e fita', 'evieta'],
  MKAJ:   ['mkaj', 'm k a j', 'em ka je', 'em ka ji', 'mkaji', 'mkaj', 'mkaz', 'mcaj', 'em kei jei', 'mkei je', 'mka j', 'mkah', 'mkai', 'em k a j', 'm kaj', 'mkaje', 'mkajj'],
  MMJI:   ['mmji', 'm m j i', 'em em je i', 'em em ji', 'mm ji', 'mmj', 'mmje', 'emm ji', 'mmgi', 'mmci', 'em m ji', 'mmjii', 'mm je i', 'mmdi', 'emmji', 'mmjy'],
  MM:     ['mm', 'm m', 'em em', 'emm', 'mem', 'mmm', 'mim', 'em m', 'im em', 'mom', 'em eem', 'emem', 'm em', 'em-em', 'meem'],
  NPI:    ['npi', 'n p i', 'en pe i', 'en pi ai', 'en pe ai', 'enpi', 'nbi', 'mpi', 'npe', 'en pei', 'enpei', 'npai', 'nppi', 'n pi', 'en pi i', 'ampi'],
  RHOI:   ['rhoi', 'r h o i', 'er ha o i', 'er ha oi', 'roi', 'royi', 'ro i', 'rohi', 'rohoi', 'roy', 'rhoy', 'rooi', 'er ha o', 'ar ha o i', 'rhoyi', 'hoi', 'rhoie', 'er ei o ai'],
  RJI:    ['rji', 'r j i', 'er je i', 'er ji ai', 'er je ai', 'erji', 'rjai', 'rje', 'rgi', 'rzi', 'er jei ai', 'arji', 'arjie', 'rj i', 'rjy', 'er ji i', 'r ji'],
  UBD:    ['ubd', 'u b d', 'u be de', 'yu bi di', 'u be di', 'ubed', 'ubad', 'ubde', 'ubt', 'ubdi', 'obd', 'yubd', 'u bd', 'ubed', 'ubud', 'ubda', 'ubdy'],
  WGS:    ['wgs', 'w g s', 'we ge es', 'we ji es', 'we ge s', 'wegs', 'wgas', 'wgz', 'wags', 'wegees', 'wjs', 'wges', 'we gs', 'wegs', 'double u g s', 'wagas', 'wgss'],
  WSI:    ['wsi', 'w s i', 'we es i', 'we es ai', 'we es ei', 'wesi', 'wesai', 'wsy', 'wsie', 'wassi', 'wisi', 'wsai', 'wes i', 'we s i', 'double u s i', 'wasi', 'wise'],
  YM:     ['ym', 'y m', 'ye em', 'wai em', 'yem', 'yam', 'yim', 'wem', 'wy em', 'yen', 'yum', 'why em', 'ye m', 'yom', 'iem', 'ie em', 'wiem', 'yemm'],
};

// ======================================================================================
// 2. TABEL KATA MIRIP — HALAMAN & TAB (kunci = path atau path?tab=..., nilai = ejaan salah yang mungkin)
//    Dipakai HANYA saat alias resmi di navigasiSuara.ts tidak cocok. Hasilnya selalu DIKONFIRMASI dulu.
// ======================================================================================
export const SALAH_DENGAR_HALAMAN: Record<string, string[]> = {
  '/': ['ringkasan', 'ringkas an', 'ring kasan', 'ringkasa', 'beranda', 'beranda utama', 'dashbor', 'dasbor', 'dashboard utama', 'halaman depan', 'hom'],
  '/agent-ai': ['agen ai', 'agent ei ai', 'eijen ai', 'agent a i', 'agen a i', 'ejen ai', 'agent hai', 'agen hai', 'agent ay', 'agent ei', 'asisten ai'],
  '/memori-ai': ['memori ai', 'memory ai', 'memori a i', 'mamori ai', 'memoria ai', 'memori hai', 'memori ay', 'mamori', 'memoria', 'ingatan ai'],
  '/financial-statements': ['laporan keuangan', 'lapor an keuangan', 'laporan keuangan', 'laporan keuangan', 'laporan kuangan', 'laporan keuagan', 'laporan keu angan', 'financial statemen', 'finansial statement', 'fainansial statement', 'financial setatmen', 'lapuran keuangan', 'laporan keuangn'],
  '/financial-statements/profit-loss': ['laba rugi', 'laba lugi', 'lava rugi', 'laba rugy', 'labarugi', 'laba ruki', 'raba rugi', 'laba rugi', 'laba ruge', 'lapa rugi', 'rugi laba', 'profit and lost', 'profit n loss', 'profit en loss', 'profit dan loss', 'profit loss', 'profit lost', 'p n l', 'pi en el', 'pe en el', 'pnl', 'pnl laporan', 'profit end loss', 'profid and loss', 'proffit and loss'],
  '/financial-statements/balance-sheet': ['neraca', 'neraka', 'neracca', 'ne raca', 'nerasa', 'neraca keuangan', 'neraca saldo', 'ne raka', 'nirakah', 'balans sheet', 'balance shit', 'balance seat', 'balance sheet', 'balans shit', 'balans sit', 'balan sheet', 'belance sheet', 'balance sit'],
  '/financial-statements/cash-flow': ['arus kas', 'aros kas', 'arus kass', 'arus kes', 'arus kash', 'harus kas', 'arus gas', 'arus kos', 'a rus kas', 'aruskas', 'cash flow', 'kas flow', 'kes flow', 'cashflow', 'kash flow', 'cash floor', 'cash flo', 'kesh flow', 'cash flaw'],
  '/financial-statements/changes-in-equity': ['perubahan ekuitas', 'perubahan ekwitas', 'perubahan equity', 'perubahan ekuites', 'peru bahan ekuitas', 'perubahan ekuitas', 'perubahan ekuiti', 'changes in ekuiti', 'chenges in equity', 'changes equity', 'change in equity', 'chages in equity', 'laporan perubahan ekwitas', 'perubahan modal'],
  '/financial-statements/notes': ['calk', 'kalk', 'chalk', 'calc', 'kalc', 'calek', 'kalek', 'cal ka', 'catatan atas laporan keuangan', 'catatan laporan keuangan', 'catetan laporan keuangan', 'notes', 'nots', 'noets', 'nout', 'notes keuangan', 'catatan keuangan'],
  '/financial-statements/mapping': ['pemetaan laporan', 'pemetaan laporan', 'pemataan laporan', 'mapping laporan', 'meping laporan', 'maping', 'mepping', 'meping', 'mapping', 'pemetaan', 'pemetan laporan', 'mapping keuangan', 'maping laporan'],
  '/transactions': ['transaksi', 'transaxi', 'transaksi', 'transaksy', 'transaki', 'tranksaksi', 'transaksi keuangan', 'transakshi', 'trans aksi', 'transaction', 'transaksion', 'transactions', 'tranzaksi', 'transaksi'],
  '/transactions/sales': ['penjualan', 'pen jualan', 'penjualan', 'penjuwalan', 'pejualan', 'penjualn', 'penjualan', 'penjulan', 'penjuallan', 'selles', 'seils', 'sels', 'sail', 'sails', 'sales', 'sale', 'seles', 'sells', 'sale s'],
  '/transactions/purchase': ['pembelian', 'pem belian', 'pembelian', 'pembelia', 'pembelean', 'pembeliyan', 'membelian', 'pembelain', 'purchase', 'pur chase', 'perchase', 'purcase', 'purchese', 'porcase', 'purses', 'pertjes', 'purchas', 'pembellian'],
  '/transactions/journal-entry': ['entri jurnal', 'entry jurnal', 'entri jurnal', 'entri jurnal', 'enteri jurnal', 'jurnal umum', 'jurnal ummum', 'jurnal um um', 'jurnal', 'jurnall', 'jurnal', 'journal entry', 'jurnal entri', 'jurnal entry', 'journal entri', 'jernal entry', 'journal entree', 'jurnal enter i', 'jornal entry', 'journal entery'],
  '/transactions/bank-cash': ['kas dan bank', 'kas bank', 'kas dan ban', 'kas dang bank', 'kas dan bang', 'kas dan benk', 'kas an bank', 'kasdan bank', 'kas dam bank', 'bank dan kas', 'cash and bank', 'cash en bank', 'cash dan bank', 'kash and bank', 'kes and bank', 'cash n bank', 'cash end bank', 'cash and bang', 'kesh dan bank'],
  '/transactions/bank-cash/reconciliation': ['rekonsiliasi', 'rekonsiliasi bank', 'rekonsilasi', 'rekonsiliasi', 'rekonsiliasi', 'rekonsiliasy', 'rekonsilisi', 'rekon', 'rekonsiliasi', 'rekonciliasi', 'rekonsiliasi bang', 'reconciliation', 'rekonsiliation', 'reconsiliation', 'rekonsiliesyen', 'reconcilation', 'reconciliasi', 'rikonsiliasi'],
  '/transactions/other': ['transaksi lain', 'transaksi lainnya', 'transaksi lainya', 'transaksi lainnya', 'transaksi lain nya', 'trasaksi lain', 'transaksi laen', 'lainnya', 'lainya', 'lain nya', 'other', 'oder', 'ader', 'other transaction', 'oder transaction', 'adder transaksi', 'transaksi alder'],
  '/accounts-receivable': ['piutang usaha', 'piutang', 'pi utang', 'piutan', 'piutang usahaa', 'piutang usaa', 'hiutang', 'piutang usahan', 'piutang usahah', 'piutang u saha', 'accounts receivable', 'akun receivable', 'account receivable', 'accounts reseivable', 'accounts riceivable', 'accounts receivabel', 'akaun receivable', 'ar', 'ei ar', 'a er', 'a r'],
  '/accounts-payable': ['utang usaha', 'utang', 'hutang usaha', 'hutang', 'utan', 'utang usahaa', 'u tang', 'hu tang', 'utang usahan', 'utang u saha', 'utang usaa', 'accounts payable', 'akun payable', 'account payable', 'accounts payabel', 'accounts peyable', 'accounts paybel', 'akaun payable', 'ap', 'ei pi', 'a p', 'ei pe'],
  '/assets': ['aset', 'asset', 'asett', 'aset tetap', 'aktiva', 'aktiva tetap', 'aseet', 'aset keuangan', 'esset', 'asets', 'asset', 'ases', 'a set', 'asses', 'asseth'],
  '/liabilities': ['kewajiban', 'ke wajiban', 'kewajiban', 'kewajibn', 'kewajiba', 'kewa jiban', 'kewajipan', 'liabilitas', 'liabilites', 'liabilitis', 'laibilitis', 'liabilities', 'liability', 'laiabilitis', 'laibilites', 'libilities', 'liabiliti'],
  '/equity': ['ekuitas', 'ekwitas', 'ekuites', 'ekuitass', 'ekuitaz', 'eku itas', 'ekuita', 'ekwites', 'ekuitaa', 'equity', 'ekuiti', 'ekwiti', 'equiti', 'ekuity', 'ikuiti', 'ecuity', 'equitty', 'modal'],
  '/budget-forecast': ['anggaran dan perkiraan', 'anggaran dan proyeksi', 'anggaran', 'angaran', 'anggaran dan prakiraan', 'anggaran perkiraan', 'anggaran dam perkiraan', 'budget', 'bujet', 'baget', 'bajet', 'buget', 'budget and forecast', 'bujet and forecast', 'budget n forecast', 'budget end forecast', 'budget dan forkas', 'bajet dan forecast', 'budget forecas', 'budget and forkast', 'bujet en forecast', 'forecast', 'forkas', 'forekas', 'forkast'],
  '/tax-compliance': ['pajak', 'pajak dan kepatuhan', 'pajak kepatuhan', 'pajak dan kepatuan', 'pajak dan kepatuhan', 'pajak dam kepatuhan', 'pajag', 'pajakk', 'pa jak', 'pajak kepatuan', 'kepatuhan pajak', 'tax', 'taks', 'tex', 'teks', 'tax compliance', 'tax kompliance', 'teks compliance', 'tax compliens', 'tax complaince', 'tax and compliance', 'tax en compliance'],
  '/financial-analytics': ['analitik keuangan', 'analitik', 'analitik keuangan', 'analitic keuangan', 'analitik kuangan', 'analitik keuagan', 'analytic keuangan', 'analitik', 'analytics', 'analitiks', 'analytiks', 'anelitik', 'analitics', 'financial analytics', 'financial analytic', 'finansial analytics', 'fainansial analitik', 'financial analitiks', 'financial analytix'],
  '/ai-financial-analyst': ['analis keuangan ai', 'analis keuangan', 'analis keuangan ai', 'analis kuangan ai', 'analis keuangan a i', 'analis keuangan hai', 'analis keuangan ay', 'ai financial analyst', 'a i financial analyst', 'ai finansial analyst', 'ai financial analis', 'hai financial analyst', 'ai fainansial analyst', 'financial analyst', 'finansial analis', 'financial analist', 'ai financial analyzed'],
  '/audit': ['audit', 'odit', 'audit', 'audid', 'audi', 'auditt', 'ordit', 'odid', 'auddit', 'jejak audit', 'jejak odit', 'audit trail', 'odit trail', 'audit trel', 'audit treil', 'odit trel', 'audit tril'],
  '/reports': ['laporan', 'lapuran', 'laporan', 'laporann', 'lapooran', 'la poran', 'laporan', 'laporan bisnis', 'reports', 'ripots', 'riport', 'report', 'ripot', 'rapot', 'reports', 'ripor', 'raport', 'report s'],
  '/reports/general-ledger': ['buku besar', 'buku besaar', 'bukku besar', 'buku bessar', 'bukubesar', 'buku besa', 'buku bezar', 'buku besat', 'puku besar', 'buku besarr', 'general ledger', 'jenderal ledger', 'general lejer', 'general ledjer', 'jeneral ledger', 'general leger', 'jenral lejer', 'general letter', 'generall ledger', 'ledger', 'lejer', 'ledjer', 'leger'],
  '/clients': ['klien', 'client', 'kline', 'klien', 'klian', 'klieen', 'kliyen', 'klieen', 'klin', 'klein', 'daftar klien', 'daftar client', 'clients', 'klain', 'klaien', 'clayen', 'klaian', 'klayen', 'clien', 'daftar klian', 'klien'],
  '/coa': ['bagan akun', 'bagan akun', 'bagan akan', 'bagan akum', 'bangan akun', 'bagang akun', 'bagan akunn', 'bagan agun', 'bagan ekun', 'bagan akuun', 'coa', 'koa', 'ko a', 'c o a', 'se o a', 'si o ei', 'si o a', 'chart of account', 'chart of accounts', 'cart of accounts', 'chat of accounts', 'chart off accounts', 'chart of akun', 'kart of account', 'daftar akun', 'daftar akun'],
  '/coa/opening-balances': ['saldo awal', 'saldo awal', 'saldo awall', 'saldo ahwal', 'salda awal', 'saldo aual', 'saldo awal', 'saldo awa', 'saldo aval', 'saldo awaal', 'opening balance', 'opening balans', 'opening balences', 'opening balances', 'opening belance', 'opening balan', 'opning balance', 'opening bal', 'oppening balance'],
  '/year-end-closing': ['tutup buku', 'tutup buku', 'tutup bukuu', 'tutup bukku', 'tutup bukuk', 'tutup buko', 'tutu buku', 'tutup bukun', 'tutup bukku', 'tutup buku akhir tahun', 'tutup buku akir tahun', 'year end closing', 'yer end closing', 'year and closing', 'year en closing', 'ear end closing', 'year end klosing', 'year end closin', 'year end', 'yer end', 'closing', 'klosing', 'closin'],
  '/documents': ['dokumen', 'dokumen', 'dokumenn', 'dokuman', 'dokumen', 'dokumeen', 'dokumin', 'dukumen', 'dokumen', 'documents', 'dokumens', 'document', 'dokument', 'dokumen s', 'dacumen', 'documen', 'dokumens', 'dokumentz'],
  '/payroll': ['penggajian', 'penggajian', 'penggajian', 'pengajian', 'penggajiaan', 'penggajia', 'penggaji an', 'penggajian', 'pengajian', 'penggajan', 'penggajiaan', 'gaji', 'gajih', 'gajji', 'payroll', 'perol', 'peirol', 'pairol', 'peyrol', 'payrol', 'pay roll', 'pay rool', 'payrole'],
  '/settings': ['pengaturan', 'pengaturan', 'pengaturann', 'pengaturan', 'pengaturan', 'pengatura', 'pengatur an', 'pengaturan', 'pengatoran', 'penggaturan', 'pengatoeran', 'settings', 'setting', 'seting', 'setings', 'setting s', 'setingg', 'setinks', 'settin', 'sating', 'setinss'],
  '/settings/company': ['pengaturan perusahaan', 'setting perusahaan', 'pengaturan perusahaan', 'pengaturan perusaha an', 'pengaturan perusahaan', 'pengaturan prusahaan', 'pengaturan perushaan', 'pengaturan perusahan', 'setting prusahaan', 'setting perusahan', 'company settings', 'kompani setting', 'company seting', 'kampani settings', 'company setings', 'company setting', 'kompany setting'],
  '/settings/users': ['pengaturan pengguna', 'pengaturan user', 'pengaturan pengguna', 'pengaturan penggunaa', 'pengaturan penguna', 'pengaturan pengguna', 'pengaturan pengguna', 'pengaturan yuser', 'kelola pengguna', 'kelola penguna', 'user management', 'yuser management', 'user manajemen', 'user menejemen', 'user manajment', 'users settings', 'yuser setting', 'user setting'],
  '/settings/purchase': ['pengaturan pembelian', 'setting pembelian', 'pengaturan pembelian', 'pengaturan pembelia', 'pengaturan pembelean', 'pengaturan membelian', 'pengaturan pembelian', 'setting pembelia', 'setting membelian', 'purchase settings', 'purchase setting', 'perchase setting', 'purcase setting', 'purses setting', 'purchase seting', 'purchas settings'],
  '/settings/product': ['pengaturan produk', 'setting produk', 'pengaturan produk', 'pengaturan produk', 'pengaturan prodak', 'pengaturan produck', 'pengaturan produg', 'pengaturan produkk', 'setting prodak', 'setting produck', 'product settings', 'product setting', 'prodak setting', 'produk setting', 'product seting', 'prodakt settings', 'prodak settings'],
  '/settings/account-mapping': ['pemetaan akun', 'mapping akun', 'pemetaan akun', 'pemetaan akunn', 'pemetaan akum', 'pemetaan agun', 'pemetaan akan', 'pemetaan akun', 'mapping akun', 'meping akun', 'maping akun', 'mapping akan', 'account mapping', 'akun mapping', 'akaun mapping', 'account maping', 'account meping', 'accounts mapping', 'akaun meping'],

  // ----- form baru & export -----
  '/accounts-receivable/invoices/new': ['invoice baru', 'invois baru', 'inpois baru', 'invoice baru', 'invoys baru', 'infois baru', 'envoice baru', 'faktur baru', 'paktur baru', 'faktur baro', 'new invoice', 'nyu invoice', 'new invois', 'nu invoice', 'create invoice', 'kreat invoice', 'create invois', 'buat invoice', 'buat invois', 'buat infois', 'bikin invoice'],
  '/accounts-receivable/receipts/new': ['receipt baru', 'resit baru', 'risit baru', 'receipt baru', 'resip baru', 'penerimaan baru', 'penerimaan baru', 'penerimaan baro', 'new receipt', 'nyu receipt', 'new resit', 'create receipt', 'kreat receipt', 'buat receipt', 'buat resit', 'buat penerimaan', 'penerimaan pembayaran baru'],
  '/accounts-payable/payments/new': ['payment baru', 'peyment baru', 'pembayaran baru', 'pembayaran baro', 'pembayaran utang baru', 'pembayaran hutang baru', 'new payment', 'nyu payment', 'new peyment', 'create payment', 'kreat payment', 'buat payment', 'buat peyment', 'buat pembayaran', 'bikin pembayaran'],
  '/transactions/purchase/bills/new': ['bill baru', 'bil baru', 'bill baro', 'tagihan baru', 'tagihan baro', 'tagihan pembelian baru', 'new bill', 'nyu bill', 'new bil', 'create bill', 'kreat bill', 'buat bill', 'buat bil', 'buat tagihan', 'bikin bill'],
  '/coa/new': ['akun baru', 'akun baro', 'akan baru', 'agun baru', 'akum baru', 'new account', 'nyu account', 'new akun', 'create account', 'kreat account', 'buat akun', 'buat akan', 'tambah akun', 'tambah akan', 'bikin akun'],
  '/coa/opening-balances/new': ['saldo awal baru', 'saldo awal baro', 'saldo awal baru', 'new opening balance', 'nyu opening balance', 'create opening balance', 'buat saldo awal', 'tambah saldo awal', 'bikin saldo awal'],
  '/accounts-receivable/export': ['export piutang', 'ekspor piutang', 'eksport piutang', 'ekspor piutan', 'export hiutang', 'export piutang usaha', 'export accounts receivable', 'eksport receivable', 'export receivable', 'export ar', 'ekspor a r', 'export ei ar'],
  '/accounts-payable/export': ['export utang', 'ekspor utang', 'eksport utang', 'export hutang', 'ekspor hutang', 'eksport hutang', 'export utan', 'export accounts payable', 'eksport payable', 'export payable', 'export ap', 'ekspor a p', 'export ei pi'],
};

// ======================================================================================
// 3. KUNCI FONETIK + JARAK EDIT
// ======================================================================================
const rapat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Ubah ejaan menjadi kunci bunyi: sow = sao = saw = sau; ph = f; c = k; vokal rangkap diringkas; huruf kembar dibuang. */
export function kunciFonetik(t: string): string {
  let s = rapat(t);
  if (!s) return '';
  s = s
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/kh/g, 'k').replace(/ck/g, 'k').replace(/sy/g, 's').replace(/sh/g, 's')
    .replace(/ng(?=[aiueo])/g, 'ng')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/v/g, 'f').replace(/z/g, 's').replace(/c/g, 'k')
    .replace(/(?:ao|aw|au|ow|ou|oo)/g, 'au') // sau / sao / saw / sow
    .replace(/(?:ei|ey|ay|ai)/g, 'ai')
    .replace(/(?:ee|ie|ii|ea)/g, 'i')
    .replace(/oe/g, 'u')
    .replace(/w/g, 'u').replace(/y/g, 'i')
    .replace(/h(?=$|[^aiueo])/g, '') // 'h' mati: "sauh", "hutang" tetap dekat "utang"
    .replace(/^h(?=[aiueo])/, '')    // "hutang" = "utang", "hiutang" = "piutang" (dekat)
    .replace(/(.)\1+/g, '$1');       // huruf kembar
  return s;
}

export function jarakEdit(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Varian satu ucapan: apa adanya, tanpa awalan "e"/"es" (artefak ejaan huruf: "es au" -> "esau"), tanpa akhiran 'h'/'s'. */
function varian(teks: string): string[] {
  const r = rapat(teks);
  const out = new Set<string>([r]);
  if (r.length >= 3 && /^e[^aiueo]/.test(r)) out.add(r.slice(1)); // "esau" -> "sau"
  if (r.length >= 4 && /^es[aiueo]/.test(r)) out.add(r.slice(2)); // "esau" -> "au" (jarang, tapi murah)
  if (r.length >= 3 && /[hs]$/.test(r)) out.add(r.slice(0, -1));
  return [...out].filter(Boolean);
}

// ======================================================================================
// 4. CLIENT: kandidat mirip (BERTINGKAT)
// ======================================================================================
export type KandidatClient = {
  client: KlienSuara;
  jarak: number; // 0 = cocok persis dengan tabel kata mirip; makin besar makin tidak yakin
  alasan: 'tabel' | 'fonetik';
};

const kodeBersih = (c: KlienSuara) => rapat(c.clientCode);

/**
 * Cari client yang DIMAKSUD dari token sisa (kata selain kata kerja/pengisi).
 * Mengembalikan kandidat terurut dari yang paling mirip. Kosong = tidak ada yang mirip (jujur: "tidak dikenal").
 *  - jarak 0 & satu kandidat      -> aman diproses (tetap ada konfirmasi bawaan KONFIRMASI_GANTI_CLIENT)
 *  - jarak >= 1 atau > 1 kandidat -> WAJIB bertanya balik (lihat susunKonfirmasiClient)
 */
export function cariClientMirip(sisa: string[], daftar: KlienSuara[]): KandidatClient[] {
  const berkode = daftar.filter((c) => kodeBersih(c).length > 0);
  if (berkode.length === 0 || sisa.length === 0) return [];

  // bentuk-bentuk ucapan: tiap token, gabungan token, dan gabungan 2 token berurutan
  const frasa = new Set<string>();
  const tambahFrasa = (s: string) => { const r = rapat(s); if (r) frasa.add(r); };
  sisa.forEach(tambahFrasa);
  tambahFrasa(sisa.join(''));
  for (let i = 0; i + 1 < sisa.length; i++) tambahFrasa(sisa[i] + sisa[i + 1]);
  const spasi = sisa.join(' ');

  const hasil = new Map<string, KandidatClient>();
  const catat = (c: KlienSuara, jarak: number, alasan: 'tabel' | 'fonetik') => {
    const lama = hasil.get(c.id);
    if (!lama || jarak < lama.jarak) hasil.set(c.id, { client: c, jarak, alasan });
  };

  for (const c of berkode) {
    const kode = kodeBersih(c);
    const tabel = (SALAH_DENGAR_CLIENT[c.clientCode.toUpperCase()] ?? []).map(rapat);

    // (a) tabel kata mirip: cocok persis -> jarak 0 (tapi 'alasan: tabel' tetap ditanyakan kalau bukan kode asli)
    if ([...frasa].some((f) => tabel.includes(f)) || tabel.includes(rapat(spasi))) {
      catat(c, [...frasa].includes(kode) ? 0 : 1, 'tabel');
      continue;
    }

    // (b) fonetik + jarak edit. Kode pendek (<=2 huruf) hanya lewat tabel (terlalu mudah keliru).
    if (kode.length <= 2) continue;
    const kunciKode = kunciFonetik(kode);
    const toleransi = kode.length >= 6 ? 2 : 1;
    let terbaik = 99;
    for (const f of frasa) {
      for (const v of varian(f)) {
        const kv = kunciFonetik(v);
        const d = Math.min(jarakEdit(v, kode), jarakEdit(kv, kunciKode));
        if (d < terbaik) terbaik = d;
      }
    }
    // cek juga terhadap tiap entri tabel (ejaan salah yang sudah dikenal): selisih 1 huruf masih diterima
    for (const t of tabel) {
      if (t.length < 3) continue;
      for (const f of frasa) if (f.length >= 3 && jarakEdit(f, t) <= 1) terbaik = Math.min(terbaik, 1);
    }
    if (terbaik <= toleransi) catat(c, Math.max(1, terbaik), 'fonetik');
  }

  return [...hasil.values()].sort((a, b) => a.jarak - b.jarak || (a.alasan === b.alasan ? 0 : a.alasan === 'tabel' ? -1 : 1) || kodeBersih(a.client).length - kodeBersih(b.client).length);
}

/** Pisahkan kandidat yang sama dekatnya dari yang kalah jauh. Maks 3. */
export function kandidatTeratas(k: KandidatClient[]): KandidatClient[] {
  if (k.length === 0) return [];
  // kata yang SUDAH dikenal di tabel lebih dipercaya daripada tebakan bunyi
  const dariTabel = k.filter((x) => x.alasan === 'tabel');
  const pakai = dariTabel.length > 0 ? dariTabel : k;
  const terbaik = pakai[0].jarak;
  return pakai.filter((x) => x.jarak <= terbaik).slice(0, 3);
}

/** Kode pendek dieja per huruf supaya TTS tidak membacanya sebagai kata ("SAU" -> "S A U"). Kode panjang (BIRAWA, EVITA) dibaca biasa. */
export function ejaKode(kode: string): string {
  const k = kode.trim().toUpperCase();
  return k.length <= 4 ? k.split('').join(' ') : k;
}

/** Kalimat konfirmasi untuk dibacakan Neo. Client SELALU disebut dengan KODE, bukan nama perusahaan. */
export function susunKonfirmasiClient(
  kandidat: KlienSuara,
  disebut: string,
  lang: 'id' | 'en',
  sisaAlternatif = 0
): string {
  const kode = ejaKode(kandidat.clientCode);
  if (lang === 'en') {
    return `I heard "${disebut}". Do you mean client ${kode}? Say yes, or no to hear another option.`;
  }
  return sisaAlternatif > 0
    ? `Aku dengarnya "${disebut}". Maksudnya client ${kode}? Katakan ya, atau tidak untuk pilihan lain.`
    : `Aku dengarnya "${disebut}". Maksudnya client ${kode}? Katakan ya atau tidak.`;
}

/** Dua/tiga kandidat sama dekat: "SAU atau NBM?" (tanpa nama perusahaan). */
export function susunPilihanClient(k: KlienSuara[], lang: 'id' | 'en'): string {
  const daftar = k.map((c) => ejaKode(c.clientCode)).join(lang === 'en' ? ' or ' : ' atau ');
  return lang === 'en' ? `Which client: ${daftar}? Please say the code.` : `Maksudnya client ${daftar}? Sebutkan kodenya.`;
}

export const PESAN_TIDAK_DIKENAL = {
  id: (disebut: string, daftar: KlienSuara[]) =>
    `Aku tidak menemukan kode client "${disebut}". Coba eja huruf per huruf, misalnya "en be em". Kode yang ada: ${daftar.filter((c) => kodeBersih(c)).map((c) => ejaKode(c.clientCode)).slice(0, 6).join(', ')}.`,
  en: (disebut: string, daftar: KlienSuara[]) =>
    `I could not find client code "${disebut}". Try spelling it letter by letter. Available codes: ${daftar.filter((c) => kodeBersih(c)).map((c) => ejaKode(c.clientCode)).slice(0, 6).join(', ')}.`,
};

// ======================================================================================
// 5. HALAMAN / TAB: kandidat mirip
// ======================================================================================
export type EntriNav = { path: string; nama: string; alias: string[]; tabQuery?: string };

export type KandidatHalaman = { entri: EntriNav; jarak: number; frasa: string };

const KATA_PEMICU_NAV = new Set([
  'buka', 'bukakan', 'bukain', 'membuka', 'pergi', 'pindah', 'pindahkan', 'menuju', 'masuk', 'ke', 'halaman', 'tab', 'menu', 'ganti', 'geser', 'lompat',
  'tolong', 'dong', 'deh', 'ya', 'aku', 'saya', 'mau', 'ingin', 'neo', 'go', 'to', 'open', 'the', 'please', 'show', 'tampilkan', 'lihat', 'di', 'yang',
  'buat', 'buatkan', 'bikin', 'tambah', 'create', 'new', 'add', 'export', 'ekspor', 'arahkan', 'bawa', 'navigasi',
]);

/**
 * Cari halaman/tab yang paling MIRIP dengan ucapan, untuk dikonfirmasi. Dipakai HANYA saat bacaNavigasi()
 * mengembalikan null padahal ucapan jelas perintah buka (ada kata "buka"/"ke halaman"/dst).
 * `daftarNav` = hasil ratakanHalaman(HALAMAN) dari navigasiSuara.ts.
 */
export function cariHalamanMirip(teksNormal: string, daftarNav: EntriNav[]): KandidatHalaman[] {
  const token = teksNormal.split(' ').filter((t) => t && !KATA_PEMICU_NAV.has(t));
  if (token.length === 0 || token.length > 8) return [];

  // n-gram 1..4 kata dari sisa ucapan
  const frasaUcapan: string[] = [];
  for (let n = Math.min(4, token.length); n >= 1; n--) {
    for (let i = 0; i + n <= token.length; i++) frasaUcapan.push(token.slice(i, i + n).join(' '));
  }

  const hasil: KandidatHalaman[] = [];
  for (const entri of daftarNav) {
    const kunciPath = entri.tabQuery ? `${entri.path}?tab=${entri.tabQuery}` : entri.path;
    const semuaAlias = [...entri.alias, ...(SALAH_DENGAR_HALAMAN[kunciPath] ?? [])];
    let terbaik: KandidatHalaman | null = null;
    for (const a of semuaAlias) {
      const ra = rapat(a);
      if (ra.length < 4) continue; // alias sangat pendek (ar, ap) terlalu mudah keliru -> hanya dicocokkan persis oleh navigasi biasa
      const ka = kunciFonetik(a);
      for (const f of frasaUcapan) {
        const rf = rapat(f);
        if (rf.length < 4) continue;
        const toleransi = Math.max(1, Math.floor(ra.length / 6)); // 4-11 huruf: 1, 12+: 2
        const d = Math.min(jarakEdit(rf, ra), jarakEdit(kunciFonetik(f), ka));
        if (d <= toleransi && (!terbaik || d < terbaik.jarak)) terbaik = { entri, jarak: d, frasa: f };
      }
    }
    if (terbaik) hasil.push(terbaik);
  }
  hasil.sort((a, b) => a.jarak - b.jarak);
  if (hasil.length === 0) return [];
  // buang entri kembar path, ambil yang sama dekatnya dengan yang terbaik, maks 3
  const lihat = new Set<string>();
  return hasil
    .filter((h) => h.jarak <= hasil[0].jarak)
    .filter((h) => { const k = h.entri.path + (h.entri.tabQuery ?? ''); if (lihat.has(k)) return false; lihat.add(k); return true; })
    .slice(0, 3);
}

export function susunKonfirmasiHalaman(h: KandidatHalaman, lang: 'id' | 'en'): string {
  return lang === 'en'
    ? `I heard "${h.frasa}". Do you want to open ${h.entri.nama}? Say yes, or no to cancel.`
    : `Aku dengarnya "${h.frasa}". Maksudnya buka ${h.entri.nama}? Katakan ya atau tidak.`;
}