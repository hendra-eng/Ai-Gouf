"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TRANSACTIONS = exports.GROUP_LABELS = exports.CATEGORY_TO_GROUP = exports.PAYMENT_STATUS_VARIANT = exports.PAYMENT_STATUS_OPTIONS = void 0;
exports.classifyByAccountName = classifyByAccountName;
exports.getTransactionGroup = getTransactionGroup;
exports.classifyJournalPairCategory = classifyJournalPairCategory;
exports.kodeBankDariNama = kodeBankDariNama;
exports.buatVoucherNo = buatVoucherNo;
exports.tambahHariISO = tambahHariISO;
exports.signatureEntriJurnal = signatureEntriJurnal;
exports.pisahkanTransaksiDuplikat = pisahkanTransaksiDuplikat;
exports.PAYMENT_STATUS_OPTIONS = ['Belum Dibayar', 'Sebagian Dibayar', 'Lunas'];
// Warna badge untuk field paymentStatus — dipakai di kolom tabel Expense,
// TransactionDrawer, dan panel AP supaya konsisten satu warna di semua tempat.
exports.PAYMENT_STATUS_VARIANT = {
    'Lunas': 'positive',
    'Sebagian Dibayar': 'warning',
    'Belum Dibayar': 'negative',
};
exports.CATEGORY_TO_GROUP = {
    Revenue: 'sales',
    Payroll: 'expense',
    Software: 'expense',
    Rent: 'expense',
    Marketing: 'expense',
    Travel: 'expense',
    Utilities: 'expense',
    Tax: 'cash_payment',
    'AP Payment': 'cash_payment',
    CapEx: 'cash_payment',
    Financing: 'cash_reserve',
    // [DIUBAH] 'Lainnya' — kategori fallback resmi untuk baris hasil import
    // yang nama akunnya tidak cocok kata kunci manapun (lihat
    // classifyAccountNameToCategory di bawah). Sebelumnya baris seperti ini
    // "dipinjamkan" ke kategori CapEx supaya mendarat di grup 'other', tapi
    // sekarang CapEx sudah punya arti bisnis sendiri (grup 'cash_payment'),
    // jadi butuh kategori fallback terpisah yang tetap mengarah ke 'other'
    // supaya baris ambigu tetap terlihat di halaman Other untuk ditinjau,
    // bukan ikut nyasar ke Cash Payment seolah-olah itu pembayaran CapEx.
    Lainnya: 'other',
    // [BARU] 5 label grup ini bisa dipilih langsung sebagai kategori manual di
    // TransactionEditModal.tsx (KNOWN_CATEGORIES) — sebelumnya tidak terdaftar
    // di sini sama sekali, jadi kalau dipilih malah jatuh ke fallback tebakan
    // classifyByAccountName(accountName), bukan ke grup yang namanya sendiri.
    // Dipetakan langsung supaya konsisten: pilih "Sales" ya pasti masuk Sales.
    Sales: 'sales',
    Expense: 'expense',
    'Cash Payment': 'cash_payment',
    'Cash Reserve': 'cash_reserve',
    Other: 'other',
};
// [BARU] Fallback KHUSUS untuk baris hasil "Import Rekening Koran" — baris
// itu semuanya diberi category: 'Import Rekening Koran' yang sama (lihat
// ImportRekeningKoranModal.tsx), jadi field `category` saja tidak cukup
// untuk membedakan sales/expense/dst pada data import. Sebagai gantinya kita
// baca `accountName` (nama akun hasil kategorisasi otomatis dari backend,
// mis. "Pendapatan Jasa Konsultasi" atau "Beban Sewa Kantor") dengan
// pencocokan kata kunci akuntansi standar.
function classifyByAccountName(accountName) {
    const n = (accountName || '').toLowerCase();
    if (n.includes('pendapatan') || n.includes('piutang'))
        return 'sales';
    if (n.includes('beban'))
        return 'expense';
    if (n.includes('pajak') || n.includes('ppn') || n.includes('pph') || n.includes('hutang usaha') || n.includes('hutang dagang'))
        return 'cash_payment';
    if (n.includes('kas & bank') || n.includes('kas dan bank') || n.includes('deposito') || n.includes('giro') || n.includes('tabungan'))
        return 'cash_reserve';
    return 'other';
}
// Kategori baru/tidak dikenal (termasuk 'Import Rekening Koran') jatuh ke
// fallback nama akun, supaya tidak ada transaksi yang "hilang" / tidak
// tampil di sub halaman manapun, baik data statis maupun hasil import.
function getTransactionGroup(tx) {
    return exports.CATEGORY_TO_GROUP[tx.category] || classifyByAccountName(tx.accountName);
}
// ─── KATEGORISASI GRANULAR HASIL IMPORT ────────────────────────────────────
// [DIUBAH] Sebelumnya baris hasil import (rekening koran / PDF penjualan
// kasir) diberi field `category` berupa salah satu dari 5 LABEL GRUP
// (Sales/Expense/Cash Payment/Cash Reserve/Other — lewat GROUP_LABELS), jadi
// kolom "Kategori" di tabel & dropdown filter di TransactionsFilterBar (yang
// isinya cuma 11 kategori resmi: Revenue, Payroll, Software, dst) tidak
// pernah cocok untuk data hasil import — makanya semua baris import tampil
// "Other" dan tidak bisa difilter. Fungsi-fungsi di bawah mengklasifikasi
// LANGSUNG ke salah satu dari 11 kategori resmi tsb, bukan ke label grup.
// getTransactionGroup() di atas tetap bisa memetakan kategori resmi ini ke
// grup sub halaman lewat CATEGORY_TO_GROUP seperti sebelumnya — tidak ada
// yang berubah dari sisi pengelompokan 5 sub halaman.
function namaAkunAdalahKasBank(nama) {
    const n = (nama || '').toLowerCase();
    return n.includes('kas') || n.includes('bank');
}
// Klasifikasi SATU nama akun (bukan Kas/Bank) ke salah satu dari 11 kategori
// resmi (+ fallback 'Lainnya'). Fallback terakhir (nama akun tidak dikenali /
// generic "Beban ..." tanpa kata kunci lebih spesifik) jatuh ke 'Lainnya' —
// satu-satunya kategori yang memetakan ke grup 'other' (lihat
// CATEGORY_TO_GROUP), jadi baris ambigu mendarat di halaman Other untuk
// ditinjau, BUKAN ikut nebeng ke kategori CapEx seperti sebelumnya (CapEx
// sekarang punya arti bisnis sendiri di grup Cash Payment, jadi tidak boleh
// lagi dipakai sebagai keranjang sampah). Baris seperti ini sudah otomatis
// ditandai "Belum terkategori otomatis — cek kembali" oleh
// drafJurnalToTransactions, jadi tetap butuh review manual oleh user apa pun
// kategori tebakannya.
function classifyAccountNameToCategory(accountName) {
    const n = (accountName || '').toLowerCase();
    if (n.includes('pendapatan') || n.includes('piutang') || n.includes('penjualan'))
        return 'Revenue';
    if (n.includes('pajak') || n.includes('ppn') || n.includes('pph') || n.includes('pbb'))
        return 'Tax';
    if (n.includes('hutang usaha') || n.includes('hutang dagang') || n.includes('utang usaha') || n.includes('utang dagang'))
        return 'AP Payment';
    if (n.includes('gaji') || n.includes('honor') || n.includes('tunjangan') || n.includes('thr') || n.includes('upah'))
        return 'Payroll';
    if (n.includes('software') || n.includes('lisensi') || n.includes('license') || n.includes('langganan') || n.includes('subscription') || n.includes('saas'))
        return 'Software';
    if (n.includes('sewa'))
        return 'Rent';
    if (n.includes('marketing') || n.includes('iklan') || n.includes('promosi'))
        return 'Marketing';
    if (n.includes('perjalanan') || n.includes('dinas') || n.includes('tiket') || n.includes('akomodasi'))
        return 'Travel';
    if (n.includes('listrik') || n.includes('air') || n.includes('internet') || n.includes('telekomunikasi') || n.includes('telepon') || n.includes('utilitas') || n.includes('pln') || n.includes('pdam'))
        return 'Utilities';
    if (n.includes('aset tetap') || n.includes('peralatan') || n.includes('mesin') || n.includes('kendaraan') || n.includes('gedung') || n.includes('inventaris'))
        return 'CapEx';
    if (n.includes('deposito') || n.includes('pinjaman') || n.includes('modal') || n.includes('obligasi') || n.includes('giro') || n.includes('tabungan'))
        return 'Financing';
    return 'Lainnya';
}
// Klasifikasi SEPASANG kaki jurnal (debet + kredit) sekaligus ke SATU
// kategori resmi yang sama untuk kedua kaki — meniru pola yang sudah dipakai
// data statis di ALL_TRANSACTIONS (mis. tx-001/tx-002 sama-sama 'Revenue'
// walau salah satu kakinya akun Kas & Bank). Kalau salah satu kaki adalah
// akun Kas/Bank, kategori diambil dari kaki LAWANNYA (akun bisnisnya, bukan
// akun kasnya) — supaya mis. penerimaan pembayaran invoice tetap muncul
// sebagai 'Revenue', bukan ikut kategori Kas/Bank yang tidak spesifik.
function classifyJournalPairCategory(namaAkunDebet, namaAkunKredit) {
    const debetKasBank = namaAkunAdalahKasBank(namaAkunDebet);
    const kreditKasBank = namaAkunAdalahKasBank(namaAkunKredit);
    if (debetKasBank && !kreditKasBank)
        return classifyAccountNameToCategory(namaAkunKredit);
    if (kreditKasBank && !debetKasBank)
        return classifyAccountNameToCategory(namaAkunDebet);
    if (debetKasBank && kreditKasBank)
        return 'Financing'; // transfer antar akun kas/bank
    return classifyAccountNameToCategory(namaAkunDebet);
}
exports.GROUP_LABELS = {
    sales: 'Sales',
    expense: 'Expense',
    cash_payment: 'Cash Payment',
    cash_reserve: 'Cash Reserve',
    other: 'Other',
};
// [BARU] Baris hasil import rekening koran sekarang diberi `category` berupa
// salah satu dari 5 label grup di atas (bukan lagi teks statis
// "Import Rekening Koran") — lihat drafJurnalToTransactions() di
// ImportRekeningKoranModal.tsx. Supaya getTransactionGroup() tetap konsisten
// (tidak jatuh lagi ke classifyByAccountName untuk baris yang category-nya
// sudah berupa label grup ini), daftarkan juga 5 label ini ke CATEGORY_TO_GROUP.
Object.keys(exports.GROUP_LABELS).forEach((g) => {
    const group = g;
    exports.CATEGORY_TO_GROUP[exports.GROUP_LABELS[group]] = group;
});
// Backend integration point: replace with /api/transactions?page=&filters=&sort=
exports.ALL_TRANSACTIONS = [
    { id: 'tx-001', date: '2026-08-25', txId: 'TXN-2026-08502', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0342', debit: 320000000, credit: 0, reference: 'INV-2026-0342', party: 'PT Teknindo Maju', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00842', voucherNo: 'BCA-0825-1', saldoAkhir: 1900000000, cek: false },
    { id: 'tx-002', date: '2026-08-25', txId: 'TXN-2026-08501', accountCode: '4101', accountName: 'Pendapatan Jasa Konsultasi', description: 'Pengakuan Pendapatan Invoice #INV-2026-0342', debit: 0, credit: 320000000, reference: 'INV-2026-0342', party: 'PT Teknindo Maju', category: 'Revenue', type: 'journal', status: 'Posted', jeId: 'JE-2026-00842', voucherNo: 'BCA-0825-1', saldoAkhir: 1580000000, cek: false },
    { id: 'tx-003', date: '2026-08-25', txId: 'TXN-2026-08498', accountCode: '5201', accountName: 'Beban Gaji & Tunjangan', description: 'Pembayaran Gaji Agustus 2026 — 87 Karyawan', debit: 485000000, credit: 0, reference: 'PAYROLL-2026-08', party: 'Payroll Dept', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00840', notes: 'Termasuk tunjangan transport dan makan', voucherNo: 'JV-0825-1', saldoAkhir: 1580000000, cek: false, paymentStatus: 'Lunas', dueDate: '2026-08-25', paidAmount: 485000000 },
    { id: 'tx-004', date: '2026-08-24', txId: 'TXN-2026-08491', accountCode: '5301', accountName: 'Beban Software & Lisensi', description: 'Pembelian Software License Microsoft 365 Q3', debit: 42500000, credit: 0, reference: 'PO-2026-00318', party: 'PT Mitra Digital', category: 'Software', type: 'debit', status: 'Posted', jeId: 'JE-2026-00836', voucherNo: 'JV-0824-2', saldoAkhir: 1580000000, cek: false, paymentStatus: 'Belum Dibayar', dueDate: '2026-09-05', paidAmount: 0 },
    { id: 'tx-005', date: '2026-08-24', txId: 'TXN-2026-08488', accountCode: '5401', accountName: 'Beban Sewa Kantor', description: 'Pembayaran Sewa Kantor Jakarta Agustus 2026', debit: 95000000, credit: 0, reference: 'LEASE-2026-08', party: 'PT Graha Sentosa', category: 'Rent', type: 'debit', status: 'Posted', jeId: 'JE-2026-00834', voucherNo: 'JV-0824-1', saldoAkhir: 1580000000, cek: false, paymentStatus: 'Lunas', dueDate: '2026-08-24', paidAmount: 95000000 },
    { id: 'tx-006', date: '2026-08-23', txId: 'TXN-2026-08475', accountCode: '1201', accountName: 'Piutang Usaha', description: 'Penerimaan DP Proyek #PRJ-0088 (50%)', debit: 180000000, credit: 0, reference: 'DP-PRJ-0088', party: 'PT Cahaya Nusantara', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00831', voucherNo: 'JV-0823-2', saldoAkhir: 1580000000, cek: false },
    { id: 'tx-007', date: '2026-08-23', txId: 'TXN-2026-08469', accountCode: '2301', accountName: 'Hutang Pajak — PPN', description: 'Pembayaran PPN Masa Juli 2026 ke DJP', debit: 28400000, credit: 0, reference: 'SSP-PPN-JUL2026', party: 'Direktorat Jenderal Pajak', category: 'Tax', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00828', voucherNo: 'JV-0823-1', saldoAkhir: 1580000000, cek: true },
    { id: 'tx-008', date: '2026-08-22', txId: 'TXN-2026-08455', accountCode: '5501', accountName: 'Beban Marketing & Promosi', description: 'Biaya Iklan Meta Ads Agustus 2026', debit: 38000000, credit: 0, reference: 'META-AUG2026', party: 'Meta Ads Indonesia', category: 'Marketing', type: 'debit', status: 'Posted', jeId: 'JE-2026-00825', voucherNo: 'JV-0822-1', saldoAkhir: 1580000000, cek: false, paymentStatus: 'Belum Dibayar', dueDate: '2026-09-01', paidAmount: 0 },
    { id: 'tx-009', date: '2026-08-22', txId: 'TXN-2026-08448', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0339', debit: 75000000, credit: 0, reference: 'INV-2026-0339', party: 'CV Solusi Kreatif', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00822', voucherNo: 'BCA-0822-1', saldoAkhir: 1580000000, cek: false },
    { id: 'tx-010', date: '2026-08-21', txId: 'TXN-2026-08442', accountCode: '1601', accountName: 'Peralatan & Mesin', description: 'Pembelian Server Dell PowerEdge R750', debit: 185000000, credit: 0, reference: 'PO-2026-00312', party: 'CV Mitra Abadi Jaya', category: 'CapEx', type: 'debit', status: 'Posted', jeId: 'JE-2026-00820', notes: 'Anomali terdeteksi — melebihi range normal vendor', voucherNo: 'JV-0821-2', saldoAkhir: 1505000000, cek: false },
    { id: 'tx-011', date: '2026-08-21', txId: 'TXN-2026-08438', accountCode: '4102', accountName: 'Pendapatan Pengembangan Software', description: 'Milestone 3 Proyek #PRJ-0081 — PT Andalan Tech', debit: 0, credit: 240000000, reference: 'MS3-PRJ-0081', party: 'PT Andalan Teknologi', category: 'Revenue', type: 'journal', status: 'Posted', jeId: 'JE-2026-00818', voucherNo: 'JV-0821-1', saldoAkhir: 1505000000, cek: false },
    { id: 'tx-012', date: '2026-08-20', txId: 'TXN-2026-08425', accountCode: '5601', accountName: 'Beban Perjalanan Dinas', description: 'Reimburse Perjalanan Dinas Surabaya — Tim Sales', debit: 12800000, credit: 0, reference: 'EXP-2026-0244', party: 'Budi Santoso', category: 'Travel', type: 'debit', status: 'Posted', jeId: 'JE-2026-00815', voucherNo: 'JV-0820-1', saldoAkhir: 1505000000, cek: false, paymentStatus: 'Sebagian Dibayar', dueDate: '2026-08-15', paidAmount: 6000000 },
    { id: 'tx-013', date: '2026-08-19', txId: 'TXN-2026-08418', accountCode: '5201', accountName: 'Beban Gaji — Kontrak', description: 'Pembayaran Honorarium Konsultan Senior Juli', debit: 42500000, credit: 0, reference: 'HON-2026-07-04', party: 'Petty Cash — Ops', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00812', notes: 'Petty cash anomali — melebihi batas normal', voucherNo: 'JV-0819-1', saldoAkhir: 1505000000, cek: false, paymentStatus: 'Belum Dibayar', dueDate: '2026-08-19', paidAmount: 0 },
    { id: 'tx-014', date: '2026-08-19', txId: 'TXN-2026-08412', accountCode: '1101', accountName: 'Kas & Bank — Mandiri', description: 'Penerimaan Invoice #INV-2026-0335 — Pelunasan', debit: 155000000, credit: 0, reference: 'INV-2026-0335', party: 'PT Nusa Indah Group', category: 'Revenue', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00810', voucherNo: 'MDR-0819-1', saldoAkhir: 1505000000, cek: true },
    { id: 'tx-015', date: '2026-08-18', txId: 'TXN-2026-08405', accountCode: '2101', accountName: 'Hutang Usaha', description: 'Pembayaran AP #APV-2026-0198 — Vendor IT', debit: 68000000, credit: 0, reference: 'APV-2026-0198', party: 'PT Infrastruktur Digital', category: 'AP Payment', type: 'debit', status: 'Posted', jeId: 'JE-2026-00808', voucherNo: 'JV-0818-2', saldoAkhir: 1350000000, cek: false },
    { id: 'tx-016', date: '2026-08-18', txId: 'TXN-2026-08398', accountCode: '5301', accountName: 'Beban Telekomunikasi', description: 'Tagihan Internet & Telepon Agustus 2026', debit: 8400000, credit: 0, reference: 'TELCO-AUG2026', party: 'Telkom Indonesia', category: 'Utilities', type: 'debit', status: 'Posted', jeId: 'JE-2026-00805', voucherNo: 'JV-0818-1', saldoAkhir: 1350000000, cek: false, paymentStatus: 'Lunas', dueDate: '2026-08-18', paidAmount: 8400000 },
    { id: 'tx-017', date: '2026-08-17', txId: 'TXN-2026-08390', accountCode: '4103', accountName: 'Pendapatan Maintenance', description: 'Renewal Kontrak Maintenance #MTC-2026-042', debit: 0, credit: 48000000, reference: 'MTC-2026-042', party: 'PT Garuda Solusi', category: 'Revenue', type: 'journal', status: 'Draft', jeId: 'JE-2026-00802', notes: 'Pending approval Finance Manager', voucherNo: 'JV-0817-1', saldoAkhir: 1350000000, cek: false },
    { id: 'tx-018', date: '2026-08-16', txId: 'TXN-2026-08382', accountCode: '5501', accountName: 'Beban Marketing', description: 'Biaya Event Tech Summit Jakarta 2026', debit: 85000000, credit: 0, reference: 'EVT-2026-0088', party: 'PT Kreasi Event Pro', category: 'Marketing', type: 'debit', status: 'Posted', jeId: 'JE-2026-00800', voucherNo: 'JV-0816-1', saldoAkhir: 1350000000, cek: false, paymentStatus: 'Belum Dibayar', dueDate: '2026-09-10', paidAmount: 0 },
    { id: 'tx-019', date: '2026-08-15', txId: 'TXN-2026-08374', accountCode: '2302', accountName: 'Hutang PPh 21', description: 'Setoran PPh 21 Masa Juli 2026', debit: 42200000, credit: 0, reference: 'SSP-PPH21-JUL2026', party: 'Direktorat Jenderal Pajak', category: 'Tax', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00798', voucherNo: 'JV-0815-1', saldoAkhir: 1350000000, cek: true },
    { id: 'tx-020', date: '2026-08-14', txId: 'TXN-2026-08368', accountCode: '1101', accountName: 'Kas & Bank — BNI', description: 'Transfer Masuk — Penerimaan Deposito Jatuh Tempo', debit: 500000000, credit: 0, reference: 'DEP-2026-0012', party: 'BNI Deposito', category: 'Financing', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00795', voucherNo: 'BNI-0814-1', saldoAkhir: 1350000000, cek: true },
];
// [BARU] Helper generator dipakai ulang oleh ImportRekeningKoranModal supaya
// nomor voucher hasil import mengikuti pola yang sama persis dengan data di
// atas ("<KodeBank>-<MMDD>-<urutan-per-hari>"), bukan lagi timestamp acak.
function kodeBankDariNama(nama) {
    const n = (nama || '').toUpperCase();
    if (n.includes('BCA'))
        return 'BCA';
    if (n.includes('MANDIRI'))
        return 'MDR';
    if (n.includes('BNI'))
        return 'BNI';
    if (n.includes('BRI'))
        return 'BRI';
    if (n.includes('CIMB'))
        return 'CIMB';
    if (n.includes('PERMATA'))
        return 'PMT';
    return 'JV'; // Jurnal Voucher generik kalau tidak ada nama bank yang cocok
}
function buatVoucherNo(kodeBank, tanggalISO, urutan) {
    // tanggalISO: "2026-08-25" -> "0825"
    const mmdd = (tanggalISO || '').slice(5, 10).replace('-', '');
    return `${kodeBank}-${mmdd || '0000'}-${urutan}`;
}
// [BARU] Default field pembayaran ke vendor untuk transaksi Expense baru
// (dipakai tombol "+ Jurnal Baru" di halaman Expense) — belum dibayar,
// jatuh tempo 30 hari dari tanggal transaksi, sesuai umumnya termin Net 30.
function tambahHariISO(tanggalISO, jumlahHari) {
    const d = new Date(tanggalISO || new Date().toISOString().slice(0, 10));
    if (isNaN(d.getTime()))
        return tanggalISO;
    d.setDate(d.getDate() + jumlahHari);
    return d.toISOString().slice(0, 10);
}
// ─── GUARD DUPLIKAT IMPORT (frontend-only, lihat ImportRekeningKoranModal) ──
// [BARU] Deteksi "kelihatannya sudah pernah diimpor" untuk baris hasil
// import rekening koran / jurnal penjualan kasir SEBELUM ditambahkan ke
// TransactionsContext lewat addTransactions()/replaceGroup().
//
// SENGAJA TIDAK pakai txId atau reference sebagai kunci pembanding:
// - txId selalu baru per sesi import (format TXN-IMPORT-<batchTag>-<baris>,
//   batchTag dari Date.now()) -- upload file yang SAMA dua kali tetap
//   menghasilkan txId yang berbeda, jadi tidak akan pernah "bentrok".
// - reference untuk rekening koran diisi NAMA BANK (mis. "BCA"), sama di
//   SEMUA baris satu file -- kalau dipakai literal, hampir semua baris akan
//   selalu "bentrok" walau isinya beda tanggal/nominal (noise, bukan deteksi
//   yang berguna). Untuk jurnal_penjualan_kasir reference memang unik
//   (no_invoice), tapi supaya satu logika berlaku konsisten untuk kedua
//   jenis sumber, dipakai signature berbasis ISI transaksi di bawah ini --
//   prinsipnya sama seperti fingerprint di backend (modules/dedup_transaksi.py:
//   tanggal+bank+keterangan+nominal+saldo), hanya dihitung di level pasangan
//   debet-kredit (per jeId), bukan per baris Transaction mentah -- karena tiap
//   baris sumber (draf_jurnal) menghasilkan 2 baris Transaction (kaki debet +
//   kaki kredit) yang berbagi jeId yang sama.
function normalisasiKeterangan(s) {
    return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Signature satu ENTRI JURNAL (sepasang baris debet+kredit berbagi jeId yang sama). */
function signatureEntriJurnal(entriSejeId) {
    var _a, _b;
    const debet = entriSejeId.find((e) => e.debit > 0);
    const kredit = entriSejeId.find((e) => e.credit > 0);
    const tanggal = ((_a = entriSejeId[0]) === null || _a === void 0 ? void 0 : _a.date) || '';
    const keterangan = normalisasiKeterangan((_b = entriSejeId[0]) === null || _b === void 0 ? void 0 : _b.description);
    const nominal = (debet === null || debet === void 0 ? void 0 : debet.debit) || (kredit === null || kredit === void 0 ? void 0 : kredit.credit) || 0;
    return `${tanggal}|${(debet === null || debet === void 0 ? void 0 : debet.accountCode) || '-'}|${(kredit === null || kredit === void 0 ? void 0 : kredit.accountCode) || '-'}|${nominal}|${keterangan}`;
}
/** Kelompokkan baris Transaction flat jadi Map<jeId, baris-baris miliknya>. */
function kelompokkanPerJeId(rows) {
    const map = new Map();
    for (const row of rows) {
        const arr = map.get(row.jeId) || [];
        arr.push(row);
        map.set(row.jeId, arr);
    }
    return map;
}
/**
 * Bandingkan `rowsBaru` (hasil konversi draf_jurnal, akan masuk lewat
 * addTransactions/replaceGroup) terhadap `existing` (transaksi yang sudah
 * ada di TransactionsContext saat ini) berdasarkan signatureEntriJurnal().
 * TIDAK memutuskan apa pun sendiri (sama prinsipnya dengan dedup_transaksi.py
 * di backend) -- cuma memisahkan mana yang kemungkinan duplikat, keputusan
 * akhir tetap di tangan user lewat modal konfirmasi.
 */
function pisahkanTransaksiDuplikat(rowsBaru, existing) {
    const signatureLama = new Set();
    for (const entri of kelompokkanPerJeId(existing).values()) {
        signatureLama.add(signatureEntriJurnal(entri));
    }
    const entriBaru = [];
    let jumlahKemungkinanDuplikat = 0;
    for (const [, entri] of kelompokkanPerJeId(rowsBaru)) {
        if (signatureLama.has(signatureEntriJurnal(entri))) {
            jumlahKemungkinanDuplikat += 1;
        }
        else {
            entriBaru.push(...entri);
        }
    }
    return { entriBaru, jumlahKemungkinanDuplikat };
}
