'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Transaction, kodeBankDariNama, buatVoucherNo, classifyByAccountName, GROUP_LABELS } from './transactionData';
import { useCurrency } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';

interface Props {
  onClose: () => void;
  // Dipanggil sekali user menekan tombol konfirmasi di layar preview.
  onImported: (transactions: Transaction[]) => void;
  // [BARU] 'replace' (default, dipakai halaman Transaksi utama) mengganti
  // SELURUH tabel transaksi dengan hasil import. 'append' (dipakai panel aksi
  // jurnal di 5 sub halaman: Sales/Expense/Cash Payment/Cash Reserve/Other)
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
}

type Step = 'upload' | 'processing' | 'preview' | 'error';

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

    const kodeBank = kodeBankDariNama(row.bank);
    const mmdd = (row.tanggal || '').slice(5, 10).replace('-', '');
    const urutanKey = `${kodeBank}|${mmdd}`;
    const urutan = (urutanPerHariBank.get(urutanKey) || 0) + 1;
    urutanPerHariBank.set(urutanKey, urutan);
    const voucherNo = buatVoucherNo(kodeBank, row.tanggal || '', urutan);

    saldoBerjalan += dampakSaldoKas(row);

    // [DIUBAH] Sebelumnya category selalu diisi teks statis
    // 'Import Rekening Koran' untuk kedua leg (debet & kredit) sekaligus lewat
    // `base`, jadi kolom "Kategori" di halaman Transaksi tidak pernah
    // menunjukkan Sales/Expense/dst untuk baris hasil import. Sekarang tiap
    // leg diklasifikasi SENDIRI-SENDIRI dari nama akunnya masing-masing
    // (classifyByAccountName), lalu dipetakan ke salah satu dari 5 label
    // grup yang sama dipakai sub halaman Transaksi (GROUP_LABELS) — jadi
    // category tidak lagi lewat `base` bersama, tapi dihitung per leg.
    const categoryDebet = GROUP_LABELS[classifyByAccountName(row.nama_akun_debet)];
    const categoryKredit = GROUP_LABELS[classifyByAccountName(row.nama_akun_kredit)];

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
      accountCode: row.no_akun_debet || '-',
      accountName: row.nama_akun_debet || 'Belum Terkategori',
      debit: row.jml_debet || 0,
      credit: 0,
      type: 'debit',
      category: categoryDebet,
      ...base,
    });
    out.push({
      id: `${jeId}-K`,
      accountCode: row.no_akun_kredit || '-',
      accountName: row.nama_akun_kredit || 'Belum Terkategori',
      debit: 0,
      credit: row.jml_kredit || 0,
      type: 'credit',
      category: categoryKredit,
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
function drafJurnalPenjualanToTransactions(rows: DrafJurnalRow[], batchTag: string): Transaction[] {
  const out: Transaction[] = [];

  rows.forEach((row) => {
    const jeId = `JE-IMPORT-${batchTag}-${row.baris}`;
    const belumTerkategori = (row.sumber_kategori || '').includes('Belum Terkategori');
    const catatanReview = row.catatan
      || (belumTerkategori ? 'Belum terkategori otomatis — cek kembali akun sebelum diposting.' : undefined);
    const voucherNo = row.no_invoice || `PJ-IMPORT-${batchTag}-${row.baris}`;

    const categoryDebet = GROUP_LABELS[classifyByAccountName(row.nama_akun_debet)];
    const categoryKredit = GROUP_LABELS[classifyByAccountName(row.nama_akun_kredit)];

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
      accountCode: row.no_akun_debet || '-',
      accountName: row.nama_akun_debet || 'Belum Terkategori',
      debit: row.jml_debet || 0,
      credit: 0,
      type: 'debit',
      category: categoryDebet,
      ...base,
    });
    out.push({
      id: `${jeId}-K`,
      accountCode: row.no_akun_kredit || '-',
      accountName: row.nama_akun_kredit || 'Belum Terkategori',
      debit: 0,
      credit: row.jml_kredit || 0,
      type: 'credit',
      category: categoryKredit,
      ...base,
    });
  });
  return out;
}

const formatIDR = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

// [BARU] URL backend LANGSUNG (bukan lewat proxy /api/... di next.config.mjs
// rewrites). Upload di modal ini (khususnya laporan PDF ribuan halaman)
// bisa butuh beberapa menit diproses server -- proxy rewrites Next.js
// punya batas waktu tunggu (proxyTimeout) yang TIDAK BISA dikonfigurasi
// lagi di versi Next.js sekarang (opsi itu sudah dihapus, lihat
// https://github.com/vercel/next.js/issues/62869), jadi request lambat
// selalu diputus ("socket hang up") walau body size limit sudah dinaikkan
// (lihat middlewareClientMaxBodySize di next.config.mjs -- itu cuma
// mengatasi masalah UKURAN, bukan WAKTU). Solusinya: khusus endpoint
// upload berat ini, browser panggil backend FastAPI di port 8000 secara
// langsung, melewati proxy Next.js sepenuhnya. Backend sudah mengizinkan
// origin ini lewat CORSMiddleware (lihat backend/main.py). Override host
// backend lewat env NEXT_PUBLIC_BACKEND_URL kalau backend tidak jalan di
// localhost:8000 (mis. saat production/deploy terpisah).
const BACKEND_URL_LANGSUNG = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

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

      const res = await fetch(`${BACKEND_URL_LANGSUNG}/api/proses-file`, { method: 'POST', body: formData });

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
        throw new Error('Tidak ada baris transaksi yang berhasil dibaca dari file ini.');
      }

      setHasil(rk);
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

  const handleConfirm = () => {
    if (!hasil) return;
    // [DIUBAH] Konverter dipilih sesuai jenisSumber -- rekening koran perlu
    // saldo kas berjalan (dampakSaldoKas), jurnal penjualan kasir tidak
    // (lihat drafJurnalPenjualanToTransactions di atas).
    const txs = jenisSumber === 'jurnal_penjualan_kasir'
      ? drafJurnalPenjualanToTransactions(hasil.draf_jurnal, batchTag)
      : drafJurnalToTransactions(hasil.draf_jurnal, batchTag, 0);
    onImported(txs);
    if (mode === 'append') {
      toast.success('Transaksi berhasil ditambahkan', {
        description: `${hasil.ringkasan.jumlah_transaksi} baris mutasi (${txs.length} entri jurnal) dari ${fileName} ditambahkan ke transaksi${groupLabel ? ` ${groupLabel}` : ''} yang sudah ada`,
      });
    } else if (mode === 'replace-group') {
      toast.success(`Transaksi ${groupLabel} diganti dengan hasil import`, {
        description: `${hasil.ringkasan.jumlah_transaksi} baris (${txs.length} entri jurnal) dari ${fileName} menggantikan seluruh transaksi ${groupLabel} sebelumnya — kelompok lain tidak berubah`,
      });
    } else {
      toast.success('Tabel transaksi diganti dengan hasil import', {
        description: `${hasil.ringkasan.jumlah_transaksi} baris mutasi (${txs.length} entri jurnal) dari ${fileName} menggantikan seluruh transaksi sebelumnya`,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
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
              Pilih client dulu lewat "Switch Company" di header.
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
                    ditandai "Belum Terkategori" untuk direview manual.
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
                  sekaligus lewat tombol <span className="font-600">"Posting Semua"</span> di
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