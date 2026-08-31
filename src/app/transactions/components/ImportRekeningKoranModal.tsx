'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, X, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Transaction, kodeBankDariNama, buatVoucherNo } from './transactionData';
import { useCurrency } from '@/lib/currency';

interface Props {
  onClose: () => void;
  // Dipanggil sekali user menekan "Tambahkan ke Transaksi" di layar preview.
  onImported: (transactions: Transaction[]) => void;
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

    const base = {
      date: row.tanggal || '',
      txId: `TXN-IMPORT-${batchTag}-${row.baris}`,
      voucherNo,
      description: row.keterangan || '(tanpa keterangan)',
      reference: row.bank || '',
      party: row.bank || '',
      category: 'Import Rekening Koran',
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
      ...base,
    });
    out.push({
      id: `${jeId}-K`,
      accountCode: row.no_akun_kredit || '-',
      accountName: row.nama_akun_kredit || 'Belum Terkategori',
      debit: 0,
      credit: row.jml_kredit || 0,
      type: 'credit',
      ...base,
    });
  });
  return out;
}

const formatIDR = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export default function ImportRekeningKoranModal({ onClose, onImported }: Props) {
  const { fx } = useCurrency();
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

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setStep('processing');
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      // Paksa backend proses sebagai rekening koran (bukan auto-deteksi jenis
      // dokumen lain) — lihat _proses_semua_jenis di main.py.
      formData.append('jenis_dokumen', 'rekening_koran');
      formData.append('pakai_ai', pakaiAI ? 'true' : 'false');

      const res = await fetch('/api/proses-file', { method: 'POST', body: formData });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Server membalas status ${res.status}`);
      }

      const data = await res.json();

      if (data.tidak_terdeteksi) {
        throw new Error(data.pesan || 'File tidak dikenali sebagai rekening koran/mutasi bank.');
      }

      const rk: RekeningKoranHasil | undefined = data?.hasil?.rekening_koran;
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
    // Import mengganti total tabel transaksi (lihat onImported di TransactionsContent),
    // jadi saldo berjalan dihitung mulai dari 0 mengikuti urutan baris di file.
    const txs = drafJurnalToTransactions(hasil.draf_jurnal, batchTag, 0);
    onImported(txs);
    toast.success('Tabel transaksi diganti dengan hasil import', {
      description: `${hasil.ringkasan.jumlah_transaksi} baris mutasi (${txs.length} entri jurnal) dari ${fileName} menggantikan seluruh transaksi sebelumnya`,
    });
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
            <h2 className="text-xl font-700 text-foreground">Import Rekening Koran</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload file mutasi bank (Excel/PDF) — sistem otomatis membaca &amp; menjurnalkan tiap transaksi.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg py-12 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-colors"
              >
                <Upload size={28} className="text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-600 text-foreground">Klik untuk pilih file, atau tarik &amp; lepas di sini</p>
                  <p className="text-xs text-muted-foreground mt-1">Format: .xlsx, .xls, atau .pdf hasil unduhan mutasi bank</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.pdf,.csv"
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

              <div className="flex items-start gap-2 bg-negative-subtle border border-negative/20 rounded-lg p-3">
                <AlertTriangle size={14} className="text-negative mt-0.5 flex-shrink-0" />
                <p className="text-xs text-foreground">
                  <span className="font-600">Perhatian:</span> menekan tombol di bawah akan{' '}
                  <span className="font-600">menghapus seluruh transaksi yang sedang ada di tabel</span>{' '}
                  dan menggantinya dengan data dari file ini. Aksi ini tidak bisa dibatalkan.
                </p>
              </div>

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
              Ganti Tabel dengan {hasil?.draf_jurnal.length ?? 0} Transaksi Ini
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
