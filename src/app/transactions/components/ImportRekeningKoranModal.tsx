'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Transaction, kodeBankDariNama, buatVoucherNo, classifyJournalPairCategory, pisahkanTransaksiDuplikat } from './transactionData';
import { useCurrency } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';
import { resolveBackendUrlLangsung, pesanGagalFetchBackend } from '@/lib/backendUrl';
// [BARU] Guard duplikat (Opsi A) perlu tahu transaksi APA SAJA yang sudah
// ada di halaman ini saat ini (state React lokal TransactionsContext) untuk
// dibandingkan terhadap hasil import baru -- lihat pisahkanTransaksiDuplikat.
import { useTransactions } from '../context/TransactionsContext';

interface Props {
  onClose: () => void;
  // Dipanggil sekali user menekan tombol konfirmasi di layar preview.
  onImported: (transactions: Transaction[]) => void;
  // [BARU] 'replace' (default, dipakai halaman Transaksi utama) mengganti
  // SELURUH tabel transaksi dengan hasil import. 'append' (dipakai panel aksi
  // jurnal di 5 sub halaman: Sales/Expense/Cash Payment/Cash Receipt/Other)
  // MENAMBAHKAN hasil import ke transaksi yang sudah ada tanpa menghapus apa
  // pun — dipakai untuk upload data pembelian/penjualan langsung dari sub
  // halaman terkait. 'replace-group' [BARU] MENGGANTI transaksi milik
  // kelompok groupLabel saja (mis. hanya Expense) — kelompok lain tidak
  // disentuh; berbeda dari 'replace' yang mengganti SELURUH tabel. Hanya
  // teks & label tombol yang berbeda di modal ini; halaman pemanggil yang
  // menentukan efek sebenarnya lewat implementasi onImported().
  // [BARU] 'replace-group' juga mengunci sumber dokumen ke
  // 'jurnal_penjualan_kasir' (PDF "Data Penjualan Detail") saja — belum
  // mendukung Excel/rekening koran di mode ini.
  mode?: 'replace' | 'append' | 'replace-group';
  // Label kelompok (mis. "Sales", "Expense") untuk memperjelas konteks upload
  // saat modal dibuka dari salah satu sub halaman. Kosongkan untuk halaman
  // Transaksi utama.
  groupLabel?: string;
}

// Satu baris draf_jurnal dari backend (lihat akuntansi_ai.py::proses_file_rekening_koran)
interface DrafJurnalRow {
  baris: number;
  tanggal: string | null;
  bank: string | null;
  keterangan: string | null;
  no_akun_debet: string | null;
  nama_akun_debet: string | null;
  jml_debet: number | null;
  no_akun_kredit: string | null;
  nama_akun_kredit: string | null;
  jml_kredit: number | null;
  // [BARU] Mutasi MENTAH dari rekening koran (sebelum dijurnalkan) — backend
  // sudah tahu persis arahnya lewat _arah() (MASUK kalau mutasi_kredit > 0,
  // KELUAR kalau mutasi_debet > 0). Ini beda dari jml_debet/jml_kredit di
  // atas, yang nilainya SELALU SAMA BESAR (itu prinsip double-entry) — jadi
  // tidak bisa dipakai untuk tahu arah pergerakan saldo bank. mutasi_debet/
  // mutasi_kredit inilah yang dipakai untuk hitung saldoAkhir, BUKAN
  // menebak dari nama akun.
  mutasi_debet: number | null;
  mutasi_kredit: number | null;
  sumber_kategori: string | null;
  catatan: string | null;
  // [BARU] Hanya terisi utk hasil jenis_dokumen 'jurnal_penjualan_kasir'
  // (lihat akuntansi_ai.py::proses_file_jurnal_penjualan_kasir) -- nomor
  // transaksi asli dari PDF (mis. "KSR-0065719-26"), dipakai sbg voucherNo
  // & reference/party pada drafJurnalPenjualanToTransactions() di bawah.
  no_invoice?: string | null;
  // [BARU] Salah satu dari 11 kategori resmi (Revenue, Payroll, Software,
  // dst — lihat akuntansi_ai.py::kategorikan_dengan_ai), ditentukan AI dari
  // KESELURUHAN konteks transaksi (keterangan+arah+nominal+akun), BUKAN cuma
  // tebak dari nama akun. Hanya terisi untuk baris yang lewat AI — null
  // untuk baris yang resolve dari pola historis/kata kunci COA (lihat
  // proses_dataframe di backend); baris itu fallback ke
  // classifyJournalPairCategory di bawah, sama seperti sebelumnya.
  kategori?: string | null;
  // [BARU] Nomor voucher PERMANEN dari counter database (lihat
  // db_client.py::beri_nomor_voucher_draf_jurnal/ambil_blok_nomor_voucher)
  // -- HANYA terisi kalau upload ini dikirim dengan client_id (client aktif
  // dipilih di header, lihat handleFile di bawah). Kalau backend berhasil
  // memberi nomor ini, PAKAI LANGSUNG (jangan hitung ulang voucherNo sendiri
  // di frontend) -- supaya nomor konsisten/tidak tabrakan dengan upload lain
  // untuk client+bank+bulan yang sama. Null kalau tidak ada client aktif
  // saat upload -- drafJurnalToTransactions() di bawah fallback ke
  // buatVoucherNo() lokal seperti sebelumnya untuk kasus itu.
  //
  // [BARU] Untuk jenis_dokumen 'jurnal_penjualan_kasir', field ini HANYA
  // terisi kalau no_invoice di atas KOSONG di PDF sumber (backend isi
  // voucher pengganti format "PJK-MMYY-urutan" dari counter permanen yang
  // sama) -- baris yang no_invoice-nya sudah ada TIDAK dapat nilai di sini
  // sama sekali, karena nomor asli dari PDF itu sendiri yang dipakai.
  // Lihat drafJurnalPenjualanToTransactions() di bawah.
  voucher?: string | null;
}

interface RekeningKoranHasil {
  ringkasan: {
    jumlah_transaksi: number;
    total_debet: number;
    total_kredit: number;
    balance: boolean;
    selisih: number;
    jumlah_perlu_review: number;
  };
  draf_jurnal: DrafJurnalRow[];
  sheet_dilewati: string[];
  // [BARU - fix saldo awal] Saldo resmi dari blok footer PDF ("SALDO AWAL"/
  // "MUTASI CR"/"MUTASI DB"/"SALDO AKHIR"), dikirim backend HANYA untuk PDF
  // yang lewat jalur fallback ekstraksi posisi-kata (lihat
  // akuntansi_ai.py::proses_file_rekening_koran -> ringkasan_footer, dan
  // _ekstrak_baris_posisi_pdf yang mengisi ringkasan_footer_fallback per
  // sheet). Key-nya nama sheet PDF -- objek kosong {} kalau file ini tidak
  // lewat jalur fallback itu (mis. Excel, atau PDF yang parser standarnya
  // berhasil), yang berarti tidak ada saldo awal resmi untuk diambil di
  // sini dan saldoAwalDariFooter() di bawah akan balik ke 0 seperti
  // perilaku lama.
  ringkasan_footer?: Record<string, {
    saldo_awal?: number | null;
    mutasi_cr?: number | null;
    mutasi_db?: number | null;
    saldo_akhir?: number | null;
    cr_count?: number | null;
    db_count?: number | null;
  }>;
}

// [BARU - fix #9 audit: Saldo Akhir hasil import PDF salah] Sebelumnya
// pemanggil drafJurnalToTransactions() selalu mengirim literal 0 sebagai
// saldoAwal, walau backend sudah mengekstrak saldo awal ASLI dari footer
// PDF (lihat field ringkasan_footer di atas) -- akibatnya kolom "Saldo
// Akhir" pada transaksi hasil import salah (offset dari saldo bank
// sesungguhnya), kecuali kebetulan saldo awal periode itu memang Rp 0.
//
// ringkasan_footer dikelompokkan PER SHEET oleh backend, tapi
// drafJurnalToTransactions() menghitung SATU saldo berjalan untuk seluruh
// batch (asumsi lama: satu import = satu rekening/bank) -- jadi di sini
// cukup ambil saldo_awal dari sheet PERTAMA yang benar-benar punya nilai.
// Kalau tidak ada sama sekali (dict kosong -- jalur Excel/parser standar
// yang tidak melalui fallback posisi-kata), balik ke 0 seperti sebelumnya.
function saldoAwalDariFooter(footer: RekeningKoranHasil['ringkasan_footer']): number {
  if (!footer) return 0;
  for (const info of Object.values(footer)) {
    if (typeof info?.saldo_awal === 'number' && !Number.isNaN(info.saldo_awal)) {
      return info.saldo_awal;
    }
  }
  return 0;
}

// [BARU] 'konfirmasi-duplikat' -- lihat handleConfirm(): dipicu kalau
// pisahkanTransaksiDuplikat() menemukan entri jurnal yang signature-nya sudah
// ada di transaksi yang KEBETULAN sedang tampil (guard ringan, murni
// state lokal), DAN/ATAU kalau deteksiBackend (state, lihat handleFile)
// menandai perlu_konfirmasi.
//
// [FIX - audit #12] deteksiBackend sekarang benar-benar diisi dari server --
// backend/main.py::_proses_dan_simpan_satu_file memanggil
// dedup_transaksi.evaluasi_upload_rekening_koran() + dbc.catat_upload_batch()
// utk tiap upload rekening_koran (kalau ada client aktif), jadi tidak lagi
// "tidak pernah ke-trigger" seperti catatan lama di sini. CATATAN JUJUR: lapis
// fingerprint-per-baris (REVISI_SEBAGIAN/DUPLIKAT_PENUH) baru akurat penuh
// setelah upload rekening koran benar-benar tersimpan ke jurnal_posting --
// lihat temuan #1 di laporan audit, yang sampai saat ini belum diperbaiki.
// Lapis FILE_IDENTIK (hash SHA-256 seluruh file, dicocokkan ke tabel
// UploadBatch yang independen dari jurnal_posting) sudah akurat sejak fix
// ini, tidak tergantung #1.
type Step = 'upload' | 'processing' | 'preview' | 'konfirmasi-duplikat' | 'error';

// Deteksi apakah nama akun ini akun Kas/Bank (bukan akun lawan seperti beban,
// pendapatan, hutang, dll). Dipakai HANYA sebagai fallback kalau backend
// (versi lama) belum mengirim mutasi_debet/mutasi_kredit sama sekali.
function isAkunKasBank(nama: string | null | undefined): boolean {
  const n = (nama || '').toUpperCase();
  return n.includes('KAS') || n.includes('BANK');
}

// Hitung dampak SATU baris mutasi terhadap saldo kas/bank berjalan.
// [DIUBAH] Sekarang pakai mutasi_debet/mutasi_kredit MENTAH dari backend
// (sudah pasti benar, lihat _arah() di akuntansi_ai.py) sebagai sumber utama.
// jml_debet/jml_kredit di jurnal akuntansi TIDAK dipakai untuk ini karena
// nilainya selalu sama besar di kedua sisi (prinsip double-entry), jadi
// tidak bisa menunjukkan arah pergerakan saldo bank.
// Fallback ke tebak nama akun (isAkunKasBank) hanya kalau backend belum
// mengirim mutasi_debet/mutasi_kredit (mis. masih pakai versi API lama).
function dampakSaldoKas(row: DrafJurnalRow): number {
  if (row.mutasi_debet != null || row.mutasi_kredit != null) {
    return (row.mutasi_debet || 0) - (row.mutasi_kredit || 0);
  }
  // --- fallback (backend lama, tidak kirim mutasi_debet/mutasi_kredit) ---
  if (isAkunKasBank(row.nama_akun_debet)) return row.jml_debet || 0;
  if (isAkunKasBank(row.nama_akun_kredit)) return -(row.jml_kredit || 0);
  return 0;
}

// Ubah satu baris draf_jurnal (1 baris mutasi bank) jadi 2 baris Transaction
// (kaki debet + kaki kredit) — mengikuti pola double-entry yang sudah dipakai
// di transactionData.ts (mis. tx-001/tx-002 berbagi jeId yang sama).
//
// [DIUBAH] txId/jeId tetap pakai batchTag (supaya tiap sesi import unik dan
// tidak bentrok dengan data lain), TAPI voucherNo sekarang mengikuti format
// standar "<KodeBank>-<MMDD>-<urutan-per-hari>" — sama seperti voucher di
// transactionData.ts dan sheet rekening koran (mis. BRI-0726-1) — bukan lagi
// timestamp acak. Saldo berjalan (saldoAkhir) dihitung kumulatif dari saldoAwal
// pakai dampakSaldoKas() di atas, BUKAN "jml_debet - jml_kredit" mentah.
function drafJurnalToTransactions(rows: DrafJurnalRow[], batchTag: string, saldoAwal: number): Transaction[] {
  const out: Transaction[] = [];
  const urutanPerHariBank = new Map<string, number>(); // key: "<kodeBank>|<mmdd>"
  let saldoBerjalan = saldoAwal;

  rows.forEach((row) => {
    const jeId = `JE-IMPORT-${batchTag}-${row.baris}`;
    const belumTerkategori = (row.sumber_kategori || '').includes('Belum Terkategori');

    // [BARU] Catatan tambahan untuk baris yang belum kena kategorisasi
    // otomatis — status posting-nya tetap sama (Unposted, lihat di bawah),
    // ini murni penanda supaya user tahu akun yang dipilih sistem perlu
    // dicek ulang sebelum baris ini di-posting.
    const catatanReview = row.catatan
      || (belumTerkategori ? 'Belum terkategori otomatis — cek kembali akun sebelum diposting.' : undefined);

    // [DIUBAH] Kalau backend sudah kirim nomor voucher PERMANEN (row.voucher
    // -- lihat interface DrafJurnalRow di atas), pakai itu langsung. Nomor
    // sementara ala <KodeBank>-<MMDD>-<urutan> di bawah cuma jadi fallback
    // untuk upload TANPA client aktif (backend tidak mint apa pun untuk
    // kasus itu, lihat main.py::_proses_dan_simpan_satu_file) — supaya modal
    // ini tetap bisa dipakai untuk preview cepat tanpa client dipilih.
    let voucherNo = row.voucher || '';
    if (!voucherNo) {
      const kodeBank = kodeBankDariNama(row.bank);
      const mmdd = (row.tanggal || '').slice(5, 10).replace('-', '');
      const urutanKey = `${kodeBank}|${mmdd}`;
      const urutan = (urutanPerHariBank.get(urutanKey) || 0) + 1;
      urutanPerHariBank.set(urutanKey, urutan);
      voucherNo = buatVoucherNo(kodeBank, row.tanggal || '', urutan);
    }

    saldoBerjalan += dampakSaldoKas(row);

    // [DIUBAH] Sebelumnya category diisi salah satu dari 5 LABEL GRUP
    // (Sales/Expense/Cash Payment/Cash Receipt/Other lewat GROUP_LABELS),
    // yang tidak cocok dengan 11 kategori resmi di dropdown filter halaman
    // Transaksi (Revenue, Payroll, Software, dst) — makanya baris hasil
    // import selalu tampil "Other" dan tidak bisa difilter. Sekarang AI
    // (kategorikan_dengan_ai) sudah menentukan field `kategori` langsung
    // dari konteks penuh transaksi — kalau backend mengirimnya, pakai
    // LANGSUNG itu. Baris yang tidak lewat AI (resolve dari pola historis
    // atau kata kunci COA di backend, row.kategori kosong) tetap fallback ke
    // classifyJournalPairCategory (logika kata kunci nama akun) seperti
    // sebelumnya — tidak dihapus, cuma jadi cadangan.
    const category = row.kategori || classifyJournalPairCategory(row.nama_akun_debet, row.nama_akun_kredit);

    const base = {
      date: row.tanggal || '',
      txId: `TXN-IMPORT-${batchTag}-${row.baris}`,
      voucherNo,
      description: row.keterangan || '(tanpa keterangan)',
      reference: row.bank || '',
      party: row.bank || '',
      // [DIUBAH] Semua baris hasil import rekening koran masuk berstatus
      // "Unposted" — baik yang berhasil dikategorikan otomatis maupun yang
      // belum. User meninjau lalu men-posting semuanya sekaligus lewat
      // tombol "Posting Semua" di halaman Transaksi (lihat TransactionsFilterBar).
      status: 'Unposted' as Transaction['status'],
      jeId,
      notes: catatanReview,
      saldoAkhir: saldoBerjalan,
      cek: false,
    };
    out.push({
      id: `${jeId}-D`,
      accountCode: row.no_akun_debet ? String(row.no_akun_debet) : '-',
      accountName: row.nama_akun_debet || 'Belum Terkategori',
      debit: row.jml_debet || 0,
      credit: 0,
      type: 'debit',
      category,
      ...base,
    });
    out.push({
      id: `${jeId}-K`,
      accountCode: row.no_akun_kredit ? String(row.no_akun_kredit) : '-',
      accountName: row.nama_akun_kredit || 'Belum Terkategori',
      debit: 0,
      credit: row.jml_kredit || 0,
      type: 'credit',
      category,
      ...base,
    });
  });
  return out;
}

// [BARU] Versi drafJurnalToTransactions() di atas KHUSUS utk hasil
// 'jurnal_penjualan_kasir' (PDF laporan penjualan detail per-transaksi,
// lihat akuntansi_ai.py::proses_file_jurnal_penjualan_kasir). Beda dari
// rekening koran: TIDAK ada konsep saldo kas berjalan (bukan mutasi bank
// satu akun), jadi saldoAkhir diisi 0 (tidak dipakai/ditampilkan sbg
// running balance yg berarti). voucherNo pakai no_invoice ASLI dari PDF
// (mis. "KSR-0065719-26") supaya gampang ditelusuri balik ke dokumen
// sumbernya, bukan format "<KodeBank>-<MMDD>-<urutan>" ala rekening koran.
//
// [BARU] Kalau no_invoice KOSONG (PDF tidak mencantumkan no transaksi),
// prioritas berikutnya row.voucher -- nomor pengganti PERMANEN format
// "PJK-MMYY-urutan" yang backend isi dari counter database (lihat
// db_client.py::beri_nomor_voucher_draf_jurnal), jadi tetap konsisten
// walau file yang sama diupload ulang. Fallback terakhir baru
// PJ-IMPORT-{batchTag}-{baris} yang cuma dipakai kalau upload ini
// dikirim TANPA client aktif (client_id null -- lihat komentar di tipe
// DrafJurnalRow.voucher di atas), karena backend tidak sempat sentuh
// draf_jurnal sama sekali dalam kasus itu.
function drafJurnalPenjualanToTransactions(rows: DrafJurnalRow[], batchTag: string): Transaction[] {
  const out: Transaction[] = [];

  rows.forEach((row) => {
    const jeId = `JE-IMPORT-${batchTag}-${row.baris}`;
    const belumTerkategori = (row.sumber_kategori || '').includes('Belum Terkategori');
    const catatanReview = row.catatan
      || (belumTerkategori ? 'Belum terkategori otomatis — cek kembali akun sebelum diposting.' : undefined);
    const voucherNo = row.no_invoice || row.voucher || `PJ-IMPORT-${batchTag}-${row.baris}`;

    // [UPDATE -- JALUR B SELESAI] proses_file_jurnal_penjualan_kasir kini
    // ikut mengirim row.kategori (hampir selalu "Revenue" -- lihat
    // kategorikan_penjualan_dengan_ai) untuk baris yang lewat AI. Baris yang
    // resolve dari pola historis/aturan standar penjualan tetap null dari
    // backend, jadi fallback ke classifyJournalPairCategory tetap dipakai
    // sebagai cadangan, sama seperti jalur rekening koran.
    const category = row.kategori || classifyJournalPairCategory(row.nama_akun_debet, row.nama_akun_kredit);

    const base = {
      date: row.tanggal || '',
      txId: `TXN-IMPORT-${batchTag}-${row.baris}`,
      voucherNo,
      description: row.keterangan || '(tanpa keterangan)',
      reference: row.no_invoice || '',
      party: row.no_invoice || '',
      // Sama seperti hasil import rekening koran: semua baris masuk
      // "Unposted" dulu, ditinjau lalu diposting sekaligus dari halaman
      // Transaksi (lihat catatan di drafJurnalToTransactions di atas).
      status: 'Unposted' as Transaction['status'],
      jeId,
      notes: catatanReview,
      saldoAkhir: 0,
      cek: false,
    };
    out.push({
      id: `${jeId}-D`,
      accountCode: row.no_akun_debet ? String(row.no_akun_debet) : '-',
      accountName: row.nama_akun_debet || 'Belum Terkategori',
      debit: row.jml_debet || 0,
      credit: 0,
      type: 'debit',
      category,
      ...base,
    });
    out.push({
      id: `${jeId}-K`,
      accountCode: row.no_akun_kredit ? String(row.no_akun_kredit) : '-',
      accountName: row.nama_akun_kredit || 'Belum Terkategori',
      debit: 0,
      credit: row.jml_kredit || 0,
      type: 'credit',
      category,
      ...base,
    });
  });
  return out;
}

const formatIDR = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

// [DIUBAH] URL backend LANGSUNG (bukan lewat proxy /api/... di next.config.mjs
// rewrites) sekarang dari resolveBackendUrlLangsung() (src/lib/backendUrl.ts)
// -- satu sumber kebenaran dipakai bersama agent-ai/lib/api.js (importBankFeed),
// bukan konstanta lokal duplikat lagi (itu penyebab bug "Failed to fetch" di
// tab Bank Feed: kedua salinan gampang tidak sinkron begitu backend pindah
// host/port, dan fallback hardcode "localhost:8000" salah kalau browser
// bukan di komputer yang sama dengan backend).
//
// Alasan tetap fetch LANGSUNG (bukan lewat proxy Next.js) tidak berubah:
// upload di modal ini (khususnya laporan PDF ribuan halaman) bisa butuh
// beberapa menit diproses server -- proxy rewrites Next.js punya batas
// waktu tunggu (proxyTimeout) yang TIDAK BISA dikonfigurasi lagi di versi
// Next.js sekarang (opsi itu sudah dihapus, lihat
// https://github.com/vercel/next.js/issues/62869), jadi request lambat
// selalu diputus ("socket hang up") walau body size limit sudah dinaikkan
// (lihat middlewareClientMaxBodySize di next.config.mjs -- itu cuma
// mengatasi masalah UKURAN, bukan WAKTU). Backend sudah mengizinkan origin
// ini lewat CORSMiddleware (lihat backend/main.py).

export default function ImportRekeningKoranModal({ onClose, onImported, mode = 'replace', groupLabel }: Props) {
  const { fx } = useCurrency();
  // [BARU] Client yang aktif di header (lihat src/lib/activeClient.tsx) --
  // dikirim sebagai client_id ke /api/proses-file supaya hasil upload ini
  // TERSIMPAN ke riwayat client tsb di backend (lihat main.py::
  // _proses_dan_simpan_satu_file), bukan cuma numpang lewat lokal di
  // TransactionsContext seperti sebelumnya (upload tanpa client_id tetap
  // diproses tapi tidak pernah disimpan/terkait ke client mana pun).
  const { activeClientId, activeClientName } = useActiveClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasil, setHasil] = useState<RekeningKoranHasil | null>(null);
  // [BARU] Daftar baris yang kode banknya cuma hasil tebakan otomatis
  // (bukan dari daftar bank dikenal maupun Claude) — lihat
  // main.py::_proses_dan_simpan_satu_file & db_client.py::
  // beri_nomor_voucher_draf_jurnal. Kosong kalau tidak ada client aktif
  // saat upload (backend tidak mint voucher sama sekali untuk kasus itu).
  const [peringatanVoucher, setPeringatanVoucher] = useState<string[]>([]);
  // [FIX - audit #12] Sinyal duplikat yang BENAR-BENAR dievaluasi & dicatat
  // di server (lihat backend/main.py::_proses_dan_simpan_satu_file ->
  // dedup_transaksi.evaluasi_upload_rekening_koran + dbc.catat_upload_batch),
  // beda dari pisahkanTransaksiDuplikat() di bawah yang murni membandingkan
  // ke transaksi yang KEBETULAN sedang tampil di layar ini. Cuma terisi
  // untuk jenisSumber 'rekening_koran' (lihat backend, di-scope sengaja ke
  // situ dulu). null kalau tidak ada client aktif saat upload (tidak ada
  // dasar utk cek server sama sekali).
  const [deteksiBackend, setDeteksiBackend] = useState<{
    status_keseluruhan: string;
    perlu_konfirmasi: boolean;
    pesan: string;
  } | null>(null);
  const [batchTag] = useState(() => Date.now().toString(36));
  // Default OFF -- kategorisasi cukup dari pola historis + kata kunci COA,
  // tanpa memanggil API AI pihak ketiga sama sekali. Baris yang tidak
  // kecocokan akan ditandai "Belum Terkategori" untuk direview manual,
  // bukan dikirim ke AI. Nyalakan kalau memang ingin AI membantu baris
  // yang sulit (butuh GROQ_API_KEY_KATEGORISASI/GROQ_API_KEY aktif di
  // backend -- kategorisasi jurnal sekarang HANYA lewat Groq, bukan
  // Claude ataupun DeepSeek).
  const [pakaiAI, setPakaiAI] = useState(false);
  // [BARU] Jenis dokumen yang mau diimpor -- menentukan jenis_dokumen apa
  // yang dikirim ke /api/proses-file (lihat main.py::_PEMROSES_DOKUMEN).
  // 'rekening_koran' (default, perilaku lama tidak berubah) = mutasi
  // bank Excel/PDF. 'jurnal_penjualan_kasir' (baru) = laporan PDF
  // "Data Penjualan Detail" per-blok transaksi (No Transaksi/Tanggal/
  // Kode Pel./Nama Pelanggan/Alamat + tabel item + Total Akhir per
  // transaksi) -- lihat akuntansi_ai.py::proses_file_jurnal_penjualan_kasir.
  // [BARU] mode 'replace-group' mengunci ke 'jurnal_penjualan_kasir' sejak
  // awal (belum ada pilihan lain di mode ini — Excel/rekening koran
  // menyusul nanti), supaya user tidak perlu memilih jenis dokumen sama
  // sekali di sub halaman yang pakai mode ini.
  const [jenisSumber, setJenisSumber] = useState<'rekening_koran' | 'jurnal_penjualan_kasir'>(
    mode === 'replace-group' ? 'jurnal_penjualan_kasir' : 'rekening_koran'
  );
  // [BARU] Akses transaksi yang sedang tampil di halaman ini (state React
  // lokal TransactionsContext) -- jadi basis perbandingan signature di
  // pisahkanTransaksiDuplikat(). Guard ini SENGAJA cuma dicek untuk mode
  // 'append'/'replace-group' -- mode 'replace' sudah eksplisit menghapus
  // seluruh tabel lama, jadi peringatan duplikat di situ cuma noise.
  const { transactions: transaksiSaatIni } = useTransactions();
  // [BARU] Menyimpan txs hasil konversi + hasil pisahkanTransaksiDuplikat()
  // selagi menunggu user memilih di step 'konfirmasi-duplikat'.
  const [pendingImport, setPendingImport] = useState<{
    semua: Transaction[];
    entriBaru: Transaction[];
    jumlahDuplikat: number;
    // [FIX - audit #12] Diisi kalau step ini dipicu (juga/hanya) oleh
    // sinyal server (deteksiBackend), supaya pesannya bisa ditampilkan
    // apa adanya -- beda dari jumlahDuplikat di atas yang murni hasil
    // hitungan lokal (pisahkanTransaksiDuplikat).
    pesanBackend: string | null;
  } | null>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setStep('processing');
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      // Paksa backend proses sebagai jenis yang dipilih user di layar upload
      // (bukan auto-deteksi jenis dokumen lain) — lihat _proses_semua_jenis
      // di main.py.
      formData.append('jenis_dokumen', jenisSumber);
      formData.append('pakai_ai', pakaiAI ? 'true' : 'false');
      // [BARU] Sertakan client aktif supaya hasil upload ini tersimpan ke
      // riwayat client tsb di backend, bukan cuma diproses lalu dibuang.
      if (activeClientId) formData.append('client_id', activeClientId);

      const url = `${resolveBackendUrlLangsung()}/api/proses-file`;
      let res: Response;
      try {
        // [BARU] credentials: 'include' ditambahkan untuk konsistensi dengan
        // importBankFeed() (agent-ai/lib/api.js) -- endpoint INI sendiri
        // (/api/proses-file) belum diproteksi jwt_v1_middleware (tidak
        // diawali /api/v1/), jadi belum wajib, tapi aman dipasang sekarang
        // supaya tidak kebobolan lagi kalau endpoint ini nanti dipindah ke
        // grup /api/v1/... yang mewajibkan cookie sesi.
        res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
      } catch (fetchErr) {
        throw new Error(pesanGagalFetchBackend(fetchErr, url));
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Server membalas status ${res.status}`);
      }

      const data = await res.json();

      if (data.tidak_terdeteksi) {
        throw new Error(data.pesan || 'File tidak dikenali sesuai jenis yang dipilih.');
      }

      // [DIUBAH] Kunci hasil sekarang mengikuti jenisSumber yang dipilih
      // (dulu selalu 'rekening_koran') -- bentuk objeknya (ringkasan +
      // draf_jurnal + sheet_dilewati) sama utk kedua jenis, lihat
      // RekeningKoranHasil di atas.
      const rk: RekeningKoranHasil | undefined = data?.hasil?.[jenisSumber];
      if (!rk || !rk.draf_jurnal || rk.draf_jurnal.length === 0) {
        // [BARU] Sebelumnya pesan generik ini membuang alasan spesifik
        // kenapa file gagal dibaca (mis. header tidak dikenali, atau
        // fallback ekstraksi AI juga gagal — lihat sheet_dilewati dari
        // backend, ak.proses_file_rekening_koran) — sekarang ditampilkan
        // supaya user tahu apa yang perlu diperbaiki, bukan cuma "gagal".
        const alasan = Array.isArray(rk?.sheet_dilewati) && rk.sheet_dilewati.length > 0
          ? rk.sheet_dilewati.join(' ')
          : 'Tidak ada baris transaksi yang berhasil dibaca dari file ini.';
        throw new Error(alasan);
      }

      setHasil(rk);
      setPeringatanVoucher(Array.isArray(data?.peringatan_voucher) ? data.peringatan_voucher : []);
      // [FIX - audit #12] Ambil sinyal dedup server-side untuk jenisSumber
      // yang sedang diupload (backend cuma mengisi kunci 'rekening_koran'
      // saat ini, lihat catatan di main.py) -- null kalau tidak ada.
      setDeteksiBackend(data?.deteksi_duplikat?.[jenisSumber] ?? null);
      setStep('preview');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Gagal memproses file. Coba lagi.');
      setStep('error');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // [BARU] Commit final ke TransactionsContext lewat onImported() -- dipanggil
  // langsung dari handleConfirm() kalau tidak ada indikasi duplikat sama
  // sekali, ATAU dari step 'konfirmasi-duplikat' setelah user memilih salah
  // satu dari 3 opsi (lanjutkan semua / hanya yang baru / batalkan).
  const commitImport = (txsUntukDiimpor: Transaction[], jumlahBarisAsli: number) => {
    onImported(txsUntukDiimpor);
    if (mode === 'append') {
      toast.success('Transaksi berhasil ditambahkan', {
        description: `${jumlahBarisAsli} baris mutasi (${txsUntukDiimpor.length} entri jurnal) dari ${fileName} ditambahkan ke transaksi${groupLabel ? ` ${groupLabel}` : ''} yang sudah ada`,
      });
    } else if (mode === 'replace-group') {
      toast.success(`Transaksi ${groupLabel} diganti dengan hasil import`, {
        description: `${jumlahBarisAsli} baris (${txsUntukDiimpor.length} entri jurnal) dari ${fileName} menggantikan seluruh transaksi ${groupLabel} sebelumnya — kelompok lain tidak berubah`,
      });
    } else {
      toast.success('Tabel transaksi diganti dengan hasil import', {
        description: `${jumlahBarisAsli} baris mutasi (${txsUntukDiimpor.length} entri jurnal) dari ${fileName} menggantikan seluruh transaksi sebelumnya`,
      });
    }
    onClose();
  };

  const handleConfirm = () => {
    if (!hasil) return;
    // [DIUBAH] Konverter dipilih sesuai jenisSumber -- rekening koran perlu
    // saldo kas berjalan (dampakSaldoKas), jurnal penjualan kasir tidak
    // (lihat drafJurnalPenjualanToTransactions di atas).
    const txs = jenisSumber === 'jurnal_penjualan_kasir'
      ? drafJurnalPenjualanToTransactions(hasil.draf_jurnal, batchTag)
      : drafJurnalToTransactions(hasil.draf_jurnal, batchTag, saldoAwalDariFooter(hasil.ringkasan_footer));

    // [BARU -- GUARD DUPLIKAT, RENCANA A2 OPSI A] Sebelum addTransactions()/
    // replaceGroup() dieksekusi (lewat onImported -> TransactionsContext),
    // cek dulu apakah entri jurnal hasil import ini kemungkinan sudah pernah
    // ada di transaksi yang sedang tampil. Guard ringan, murni frontend,
    // tidak menyentuh backend/DB sama sekali -- kalau ada indikasi duplikat,
    // tampilkan step konfirmasi supaya user yang putuskan, bukan diam-diam
    // ditambahkan/di-skip.
    // [FIX - audit #12] Sinyal server (deteksiBackend) SELALU dicek, tidak
    // cuma di mode !== 'replace' seperti guard lokal di bawah -- guard lokal
    // sengaja dilewati utk mode 'replace' krn tabel lama memang mau dihapus
    // total, tapi sinyal server tetap relevan di situ: server bisa tahu
    // "file ini sama/hampir sama dengan upload sebelumnya" walau tabel yang
    // sedang tampil di layar sudah diganti/di-reload sejak saat itu (guard
    // lokal tidak akan pernah menangkap kasus ini krn cuma bandingkan ke
    // transaksi yang KEBETULAN sedang tampil sekarang).
    const backendPerluKonfirmasi = deteksiBackend?.perlu_konfirmasi ?? false;

    if (mode !== 'replace') {
      const { entriBaru, jumlahKemungkinanDuplikat } = pisahkanTransaksiDuplikat(txs, transaksiSaatIni);
      if (jumlahKemungkinanDuplikat > 0 || backendPerluKonfirmasi) {
        setPendingImport({
          semua: txs,
          entriBaru,
          jumlahDuplikat: jumlahKemungkinanDuplikat,
          pesanBackend: backendPerluKonfirmasi ? deteksiBackend!.pesan : null,
        });
        setStep('konfirmasi-duplikat');
        return;
      }
    } else if (backendPerluKonfirmasi) {
      // Mode 'replace': tidak ada guard lokal (lihat komentar di atas), tapi
      // sinyal server tetap ditampilkan -- "Hanya Baris Baru" tidak relevan
      // di mode ini (replace selalu ambil txs apa adanya), jadi entriBaru
      // dikosongkan supaya tombol itu otomatis nonaktif di step konfirmasi.
      setPendingImport({ semua: txs, entriBaru: [], jumlahDuplikat: 0, pesanBackend: deteksiBackend!.pesan });
      setStep('konfirmasi-duplikat');
      return;
    }

    commitImport(txs, hasil.ringkasan.jumlah_transaksi);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-700 text-foreground">
              {mode === 'append' && `Upload Data${groupLabel ? ` ${groupLabel}` : ''}`}
              {mode === 'replace-group' && `Ganti Transaksi ${groupLabel} (PDF)`}
              {mode === 'replace' &&
                (jenisSumber === 'jurnal_penjualan_kasir' ? 'Import Jurnal Penjualan Kasir' : 'Import Rekening Koran')}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {mode === 'replace-group'
                ? `Upload PDF laporan "Data Penjualan Detail" (kasir/POS) — hasilnya akan menggantikan seluruh transaksi ${groupLabel} yang sedang tampil di halaman ini. Kelompok transaksi lain tidak terpengaruh.`
                : jenisSumber === 'jurnal_penjualan_kasir'
                ? 'Upload laporan PDF penjualan detail (kasir/POS) — sistem otomatis membaca & menjurnalkan tiap transaksi.'
                : 'Upload file mutasi bank (Excel/PDF) — sistem otomatis membaca & menjurnalkan tiap transaksi.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* [BARU] Indikator client aktif -- supaya jelas hasil upload ini
            akan tersimpan ke client mana (lihat catatan di atas komponen). */}
        <div className={`px-6 py-2.5 text-xs border-b border-border flex items-center gap-2 ${
          activeClientId ? 'bg-secondary/40 text-muted-foreground' : 'bg-warning-subtle text-warning'
        }`}>
          {activeClientId ? (
            <>
              Upload ini akan tersimpan untuk client:{' '}
              <span className="font-600 text-foreground">{activeClientName || '—'}</span>
            </>
          ) : (
            <>
              <AlertTriangle size={12} className="flex-shrink-0" />
              Belum ada client aktif — hasil upload ini tidak akan tersimpan ke riwayat client mana pun.
              Pilih client dulu lewat &quot;Switch Company&quot; di header.
            </>
          )}
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {step === 'upload' && (
            <div className="space-y-4">
              {/* [BARU] Pilihan jenis dokumen -- menentukan jenis_dokumen yang
                  dikirim ke backend (lihat handleFile). Hanya relevan utk
                  halaman Transaksi utama (mode 'replace'); sub halaman lain
                  yang pakai modal ini (mode 'append') masih rekening koran
                  saja, jadi selector disembunyikan disana. */}
              {mode === 'replace' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setJenisSumber('rekening_koran')}
                    className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                      jenisSumber === 'rekening_koran'
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    <p className="font-600">Rekening Koran</p>
                    <p className="text-2xs mt-0.5">Mutasi bank — Excel/PDF</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setJenisSumber('jurnal_penjualan_kasir')}
                    className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                      jenisSumber === 'jurnal_penjualan_kasir'
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    <p className="font-600">Jurnal Penjualan Kasir</p>
                    <p className="text-2xs mt-0.5">Laporan penjualan detail — PDF</p>
                  </button>
                </div>
              )}

              {mode === 'replace' && jenisSumber === 'jurnal_penjualan_kasir' && (
                <p className="text-2xs text-muted-foreground italic">
                  Catatan: laporan PDF ribuan halaman bisa butuh beberapa menit untuk diproses server — biarkan tab ini terbuka sampai selesai.
                </p>
              )}

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg py-12 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-colors"
              >
                <Upload size={28} className="text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-600 text-foreground">Klik untuk pilih file, atau tarik &amp; lepas di sini</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {jenisSumber === 'jurnal_penjualan_kasir'
                      ? 'Format: .pdf laporan "Data Penjualan Detail" per-transaksi (kasir/POS)'
                      : 'Format: .xlsx, .xls, atau .pdf hasil unduhan mutasi bank'}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  // [BARU] mode 'replace-group' baru dukung PDF Jurnal
                  // Penjualan Kasir — Excel/CSV menyusul nanti.
                  accept={mode === 'replace-group' ? '.pdf' : '.xlsx,.xls,.pdf,.csv'}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <label className="flex items-start gap-2.5 bg-secondary/50 rounded-lg p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pakaiAI}
                  onChange={(e) => setPakaiAI(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-xs font-600 text-foreground">Gunakan AI untuk baris yang sulit dikategorikan</p>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    Kalau dimatikan (default), kategorisasi hanya dari pola historis &amp; kata kunci COA —
                    tanpa API key, tanpa panggilan ke server AI pihak ketiga. Baris yang tidak cocok akan
                    ditandai &quot;Belum Terkategori&quot; untuk direview manual. Toggle ini juga dipakai untuk
                    bantuan Claude mengenali kode bank pada nomor voucher kalau nama sheet/banknya tidak
                    baku — kalau dimatikan, kode bank yang ambigu akan ditebak dari kata terakhir saja
                    dan ditandai untuk dicek manual.
                  </p>
                  <p className="text-2xs text-muted-foreground mt-1">
                    [BARU] Toggle ini juga menyalakan fallback pembacaan file lewat AI kalau rekening
                    koran gagal dikenali otomatis (format/istilah kolom bank tsb tidak baku) — nyalakan
                    ini kalau file dari bank lain gagal dimuat.
                  </p>
                </div>
              </label>
            </div>
          )}

          {step === 'processing' && (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 size={28} className="text-primary animate-spin" />
              <p className="text-sm font-600 text-foreground">Memproses {fileName}…</p>
              <p className="text-xs text-muted-foreground">Membaca sheet, mencocokkan pola akun, dan menjurnalkan tiap mutasi</p>
            </div>
          )}

          {step === 'error' && (
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle size={28} className="text-negative" />
              <p className="text-sm font-600 text-foreground">Gagal mengimpor file</p>
              <p className="text-xs text-muted-foreground max-w-sm">{errorMsg}</p>
              <button onClick={() => setStep('upload')} className="btn-secondary text-xs py-1.5 px-3 mt-2">
                Coba File Lain
              </button>
            </div>
          )}

          {step === 'konfirmasi-duplikat' && hasil && pendingImport && (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              <AlertTriangle size={28} className="text-warning" />
              <div>
                <p className="text-sm font-600 text-foreground">
                  {pendingImport.jumlahDuplikat > 0
                    ? `${pendingImport.jumlahDuplikat} dari ${hasil.draf_jurnal.length} transaksi tampak sudah pernah diimpor`
                    : 'Server mendeteksi kemungkinan file ini sudah pernah diupload'}
                </p>
                {/* [FIX - audit #12] Pesan dari server (dedup_transaksi.py, dicek
                    terhadap riwayat upload & jurnal tersimpan) -- lebih bisa
                    diandalkan daripada perbandingan lokal di bawah karena tidak
                    tergantung transaksi apa yang KEBETULAN sedang tampil di layar. */}
                {pendingImport.pesanBackend && (
                  <p className="text-xs text-foreground bg-warning-subtle border border-warning/20 rounded-lg p-2 mt-2 max-w-sm text-left">
                    {pendingImport.pesanBackend}
                  </p>
                )}
                {pendingImport.jumlahDuplikat > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Tanggal, akun, nominal, dan keterangannya cocok dengan transaksi yang sudah ada di halaman ini
                    saat ini. Ini bisa berarti file <span className="font-600">{fileName}</span> ini pernah
                    diimpor sebelumnya, atau kebetulan ada transaksi mirip. Silakan pilih:
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
                <button
                  onClick={() => commitImport(pendingImport.semua, hasil.ringkasan.jumlah_transaksi)}
                  className="btn-secondary text-sm py-2 px-4 w-full"
                >
                  Lanjutkan Semua ({hasil.draf_jurnal.length} transaksi)
                </button>
                <button
                  onClick={() => commitImport(pendingImport.entriBaru, pendingImport.entriBaru.length)}
                  disabled={pendingImport.entriBaru.length === 0}
                  className="btn-primary text-sm py-2 px-4 w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* [FIX - audit #12] Sebelumnya dihitung dari
                      `hasil.draf_jurnal.length - jumlahDuplikat`, yang keliru
                      kalau step ini dipicu HANYA oleh sinyal server (jumlahDuplikat
                      lokal = 0 tapi entriBaru juga sengaja dikosongkan di mode
                      'replace' -- lihat handleConfirm) -- pakai entriBaru.length
                      langsung supaya selalu akurat. */}
                  Hanya Baris Baru ({pendingImport.entriBaru.length} transaksi)
                </button>
                <button
                  onClick={() => { setPendingImport(null); setStep('preview'); }}
                  className="text-sm font-500 text-muted-foreground hover:text-foreground transition-colors py-1.5"
                >
                  Batal, kembali ke pratinjau
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && hasil && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet size={16} className="text-primary flex-shrink-0" />
                <span className="font-600 text-foreground truncate">{fileName}</span>
              </div>

              {mode === 'append' && (
                <div className="flex items-start gap-2 bg-info-subtle border border-info/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="text-info mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-foreground">
                    Menekan tombol di bawah akan <span className="font-600">menambahkan</span> data ini ke
                    transaksi yang sudah ada — transaksi lain (termasuk milik kelompok lain) tidak akan
                    terhapus atau berubah.
                  </p>
                </div>
              )}
              {mode === 'replace-group' && (
                <div className="flex items-start gap-2 bg-negative-subtle border border-negative/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="text-negative mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-600">Perhatian:</span> menekan tombol di bawah akan{' '}
                    <span className="font-600">menghapus seluruh transaksi {groupLabel}</span> yang sedang
                    tampil di halaman ini dan menggantinya dengan data dari file ini. Transaksi kelompok
                    lain (Sales, Cash Payment, dll) <span className="font-600">tidak terpengaruh</span>.
                    Aksi ini tidak bisa dibatalkan.
                  </p>
                </div>
              )}
              {mode === 'replace' && (
                <div className="flex items-start gap-2 bg-negative-subtle border border-negative/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="text-negative mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-600">Perhatian:</span> menekan tombol di bawah akan{' '}
                    <span className="font-600">menghapus seluruh transaksi yang sedang ada di tabel</span>{' '}
                    dan menggantinya dengan data dari file ini. Aksi ini tidak bisa dibatalkan.
                  </p>
                </div>
              )}

              {/* [BARU] Info bahwa seluruh baris masuk berstatus Unposted */}
              <div className="flex items-start gap-2 bg-info-subtle border border-info/20 rounded-lg p-3">
                <AlertTriangle size={14} className="text-info mt-0.5 flex-shrink-0" />
                <p className="text-xs text-foreground">
                  Seluruh transaksi hasil import ini akan masuk dengan status{' '}
                  <span className="font-600">Unposted</span>. Tinjau datanya, lalu posting semua
                  sekaligus lewat tombol <span className="font-600">&quot;Posting Semua&quot;</span> di
                  sebelah Filter Lanjutan pada halaman Transaksi.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">Transaksi</p>
                  <p className="text-sm font-600 text-foreground">{hasil.ringkasan.jumlah_transaksi}</p>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">Total Debet</p>
                  <p className="text-sm font-600 text-foreground">{fx(formatIDR(hasil.ringkasan.total_debet))}</p>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">Total Kredit</p>
                  <p className="text-sm font-600 text-foreground">{fx(formatIDR(hasil.ringkasan.total_kredit))}</p>
                </div>
                <div className={`rounded-lg p-3 ${hasil.ringkasan.balance ? 'bg-positive-subtle' : 'bg-negative-subtle'}`}>
                  <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                  <p className={`text-sm font-600 flex items-center gap-1 ${hasil.ringkasan.balance ? 'text-positive' : 'text-negative'}`}>
                    {hasil.ringkasan.balance ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {hasil.ringkasan.balance ? 'Balance' : `Selisih ${fx(formatIDR(hasil.ringkasan.selisih))}`}
                  </p>
                </div>
              </div>

              {hasil.ringkasan.jumlah_perlu_review > 0 && (
                <div className="flex items-start gap-2 bg-warning-subtle border border-warning/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="text-warning mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-foreground">
                    {hasil.ringkasan.jumlah_perlu_review} baris belum terkategori otomatis — akun yang dipilih
                    sistem perlu <span className="font-600">dicek manual</span> sebelum baris ini diposting.
                  </p>
                </div>
              )}

              {/* [BARU] Baris yang KODE BANK-nya (dipakai untuk prefix nomor
                  voucher) cuma hasil tebakan kasar — bukan dari daftar bank
                  dikenal maupun Claude. Nomor voucher tetap dibuat (tidak
                  pernah gagal total), tapi prefix-nya perlu dicek manual. */}
              {peringatanVoucher.length > 0 && (
                <div className="flex items-start gap-2 bg-warning-subtle border border-warning/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="text-warning mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-foreground">
                    <p>
                      {peringatanVoucher.length} baris punya kode bank di nomor voucher yang cuma{' '}
                      <span className="font-600">hasil tebakan otomatis</span> (nama bank/sheet tidak
                      dikenali) — cek kembali nomor voucher baris tersebut setelah import.
                    </p>
                  </div>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary sticky top-0">
                      <tr>
                        <th className="text-left font-600 text-muted-foreground px-3 py-2">Tanggal</th>
                        <th className="text-left font-600 text-muted-foreground px-3 py-2">Keterangan</th>
                        <th className="text-left font-600 text-muted-foreground px-3 py-2">Debet</th>
                        <th className="text-left font-600 text-muted-foreground px-3 py-2">Kredit</th>
                        <th className="text-right font-600 text-muted-foreground px-3 py-2">Nominal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hasil.draf_jurnal.map((row) => (
                        <tr key={row.baris} className="border-t border-border">
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{row.tanggal || '-'}</td>
                          <td className="px-3 py-2 text-foreground max-w-[200px] truncate" title={row.keterangan || ''}>{row.keterangan || '-'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.nama_akun_debet || 'Belum Terkategori'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.nama_akun_kredit || 'Belum Terkategori'}</td>
                          <td className="px-3 py-2 text-right text-foreground whitespace-nowrap">
                            {fx(formatIDR(row.jml_debet || row.jml_kredit || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {hasil.sheet_dilewati?.length > 0 && (
                <p className="text-2xs text-muted-foreground italic">
                  Catatan: {hasil.sheet_dilewati.join(' • ')}
                </p>
              )}
            </div>
          )}
        </div>

        {step === 'preview' && (
          <div className="flex items-center justify-between p-5 border-t border-border bg-secondary/30">
            <button onClick={onClose} className="text-sm font-500 text-muted-foreground hover:text-foreground transition-colors">
              Batal
            </button>
            <button onClick={handleConfirm} className="btn-primary text-sm py-2 px-4">
              {mode === 'append' && `Tambahkan ${hasil?.draf_jurnal.length ?? 0} Transaksi Ini`}
              {mode === 'replace-group' && `Ganti Transaksi ${groupLabel} dengan ${hasil?.draf_jurnal.length ?? 0} Transaksi Ini`}
              {mode === 'replace' && `Ganti Tabel dengan ${hasil?.draf_jurnal.length ?? 0} Transaksi Ini`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}