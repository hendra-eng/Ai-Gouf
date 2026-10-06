'use client';
import React, { useState } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';
import { Transaction, getTransactionGroup, PAYMENT_STATUS_OPTIONS } from './transactionData';

interface Props {
  transaction: Transaction;
  onClose: () => void;
  // [DIUBAH — persist ke backend] Mode edit (isNew=false): dipanggil dengan
  // SATU Transaction (leg yang diedit) — parent yang menimpa entri lama di
  // state `transactions` DAN mengirim PATCH ke backend lewat sibling-nya
  // (lihat TransactionsContext.saveEdit/jurnalBridge.buildUpdatePayloadFromPair).
  // [DIUBAH — sinkron otomatis kaki pasangan] Kalau nominal (Debit/Kredit)
  // baris ini diubah dan pasangannya (siblingTransaction) diketahui, mode
  // edit JUGA bisa memanggil onSave dengan ARRAY 2 Transaction: [leg yang
  // diedit, leg pasangan yang nominalnya sudah ikut disesuaikan] — supaya
  // jurnal tidak pernah tersimpan dalam keadaan tidak balance. Array 2 di
  // mode edit ini beda dari array mode isNew: parent membedakannya lewat
  // apakah id kedua Transaction itu sama dengan transaction.id yang sedang
  // diedit (lihat handleSaveEdit di TransactionsContent.tsx).
  //
  // Mode baru (isNew=true): dipanggil dengan ARRAY berisi TEPAT 2 Transaction
  // (leg debet + leg kredit) — backend jurnal_posting SELALU menyimpan kedua
  // sisi sekaligus dalam satu baris (no_akun_debet & no_akun_kredit sama-sama
  // NOT NULL), jadi jurnal baru wajib double-entry lengkap sejak dibuat, tidak
  // bisa cuma satu kaki seperti sebelumnya (baris satu-kaki dulu memang bisa
  // dibuat di UI tapi TIDAK PERNAH benar-benar tersimpan ke server).
  onSave: (result: Transaction | Transaction[]) => void;
  // [BARU] true saat modal dipakai untuk tombol "+ Jurnal Baru" di halaman
  // Transaksi utama / panel aksi jurnal 5 sub halaman — mengubah judul/label
  // tombol DAN bentuk form (lihat komentar onSave di atas). `transaction`
  // tetap wajib diisi (berupa template kosong) supaya field bersama
  // (tanggal/deskripsi/kategori/dll) tidak perlu logic terpisah untuk state
  // kosong.
  isNew?: boolean;
  // [BARU — fix sinkron kaki pasangan] Leg lain (jeId sama, id beda) milik
  // jurnal yang sama dengan `transaction`, kalau ada — dicari parent dari
  // seluruh daftar transaksi (TransactionsContext) sebelum modal dibuka.
  // Dipakai mode edit untuk mendeteksi & otomatis menyesuaikan nominal
  // pasangannya kalau nominal baris ini diubah. null/undefined kalau
  // baris ini memang tidak punya pasangan (mis. data lama satu-kaki).
  siblingTransaction?: Transaction | null;
}

// Kategori yang sudah dikenal sistem (dipakai untuk dropdown, tapi tetap boleh
// isi kategori baru lewat opsi "Kategori lain..." di bawah select).
const KNOWN_CATEGORIES = [
  'Revenue', 'Payroll', 'Software', 'Rent', 'Tax', 'Marketing', 'Travel',
  'CapEx', 'AP Payment', 'Utilities', 'Financing',
  // [DIPERBAIKI] 'Lainnya' tadinya tidak ada di daftar ini, padahal itu
  // kategori fallback yang SUNGGUH-SUNGGUH dipakai backend/jalur import
  // sekarang (lihat classifyAccountNameToCategory & classifyJournalPairCategory
  // di transactionData.ts -- baris yang nama akunnya tidak cocok kata kunci
  // manapun diberi category: 'Lainnya', bukan salah satu dari 11 kategori di
  // atas). categoryOptions di TransactionsFilterBar.tsx sudah menyertakan
  // 'Lainnya' sebagai opsi filter; dropdown di sini disamakan supaya
  // konsisten -- sebelum fix ini, transaksi berkategori 'Lainnya' selalu
  // jatuh ke mode "Kategori lain..." (input bebas) saat dibuka di modal
  // edit, padahal itu bukan kategori custom/tidak dikenal.
  'Lainnya',
  // [DIUBAH] Sebelumnya komentar di sini bilang baris hasil import "sekarang
  // diberi salah satu dari 5 label grup ini (lihat classifyByAccountName)" --
  // itu sudah tidak akurat. Jalur import (drafJurnalToTransactions di
  // ImportRekeningKoranModal.tsx) & jurnalBridge.ts backend SEKARANG
  // sama-sama pakai classifyJournalPairCategory(), yang menghasilkan salah
  // satu dari 11 kategori resmi di atas atau 'Lainnya' -- BUKAN 5 label grup
  // ini. classifyByAccountName() sendiri sekarang cuma dipakai sebagai
  // fallback TERAKHIR di getTransactionGroup() (lihat transactionData.ts),
  // bukan lagi sumber category baris hasil import.
  //
  // 5 label ini TETAP dipertahankan di daftar (bukan dihapus) karena masih
  // pilihan manual yang valid & benar-benar berfungsi: CATEGORY_TO_GROUP
  // (transactionData.ts) memetakan tiap label ini langsung ke grup sub
  // halamannya sendiri (mis. pilih 'Sales' -> pasti masuk grup 'sales'),
  // jadi cocok dipakai user yang mau menandai jurnal manual langsung ke satu
  // dari 5 sub halaman tanpa peduli kategori akuntansi rincinya. Yang perlu
  // diketahui: opsi ini TIDAK muncul di dropdown filter Kategori halaman
  // Transaksi utama (categoryOptions di TransactionsFilterBar.tsx cuma
  // berisi 11 kategori resmi + 'Lainnya', tidak termasuk 5 label ini) --
  // transaksi yang ditandai salah satu dari 5 label ini tetap bisa dicari
  // lewat 5 sub halaman (Sales/Expense/dll), hanya saja tidak lewat filter
  // Kategori di halaman utama.
  'Sales', 'Purchase', 'Cash Payment', 'Cash Receipt', 'Other',
];

const typeOptions: Transaction['type'][] = ['debit', 'credit', 'journal'];
const statusOptions: Transaction['status'][] = ['Unposted', 'Posted', 'Draft', 'Reconciled', 'Voided'];

function toNumberInput(v: string): number {
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Field string wajib pada Transaction seharusnya tidak pernah null/undefined
// menurut tipenya — tapi data hasil import (lewat backend) kadang punya nilai
// null yang lolos dari pengecekan TypeScript di runtime. Normalisasi di sini
// mencegah error "Cannot read properties of undefined/null (reading 'trim')"
// saat modal dibuka dengan baris transaksi yang datanya tidak lengkap.
function normalisasiTransaksi(tx: Transaction): Transaction {
  return {
    ...tx,
    date: tx.date ?? '',
    accountCode: tx.accountCode ?? '',
    accountName: tx.accountName ?? '',
    description: tx.description ?? '',
    reference: tx.reference ?? '',
    party: tx.party ?? '',
    category: tx.category ?? '',
    notes: tx.notes ?? undefined,
    debit: Number.isFinite(tx.debit) ? tx.debit : 0,
    credit: Number.isFinite(tx.credit) ? tx.credit : 0,
  };
}

export default function TransactionEditModal({ transaction, onClose, onSave, isNew = false, siblingTransaction = null }: Props) {
  const [form, setForm] = useState<Transaction>(() => normalisasiTransaksi(transaction));
  // Kalau kategori transaksi belum ada di daftar dikenal, tampilkan sebagai
  // input bebas dari awal (bukan dropdown) supaya nilainya tidak "hilang".
  const [useCustomCategory, setUseCustomCategory] = useState(
    !KNOWN_CATEGORIES.includes(transaction.category ?? '')
  );

  // [BARU — mode isNew] Dua sisi akun jurnal baru. Nominal SENGAJA satu
  // field saja (bukan Debit & Kredit terpisah seperti mode edit) karena
  // jurnal double-entry yang balance selalu punya nominal yang sama persis
  // di kedua sisi — memisahkannya jadi 2 input cuma membuka celah salah
  // ketik jadi tidak balance. `form.debit` dipakai sbg penyimpan nilai
  // nominal bersama ini (form.credit tidak dipakai sama sekali di mode ini).
  const [debetCode, setDebetCode] = useState('');
  const [debetName, setDebetName] = useState('');
  const [kreditCode, setKreditCode] = useState('');
  const [kreditName, setKreditName] = useState('');

  const setField = <K extends keyof Transaction>(key: K, value: Transaction[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const bothZero = form.debit === 0 && form.credit === 0;
  const bothFilled = form.debit > 0 && form.credit > 0;

  // [DIUBAH — fix cek balance dgn pasangan jurnal] Perbandingan LAMA di sini
  // ("form.debit === form.credit") tidak pernah bisa kena kalau bothFilled
  // sudah dilarang (satu baris cuma boleh isi Debit ATAU Kredit) — jadi
  // banner peringatannya dulu TIDAK PERNAH tampil sama sekali, walau
  // nominal baris ini sudah beda jauh dari pasangannya. Perbandingan yang
  // benar adalah nominal baris ini vs nominal SIBLING (leg lain, jeId
  // sama) — itu yang menentukan jurnal double-entry-nya tetap balance atau
  // tidak, bukan debit vs kredit dalam satu baris yang sama.
  const thisAmount = form.debit || form.credit || 0;
  const siblingAmount = siblingTransaction ? (siblingTransaction.debit || siblingTransaction.credit || 0) : null;
  const amountChanged = thisAmount !== (transaction.debit || transaction.credit || 0);
  const unbalancedWithSibling = !isNew && amountChanged && siblingTransaction != null && thisAmount !== siblingAmount;
  // Nominal diubah tapi tidak ada data pasangan sama sekali (mis. baris
  // lama satu-kaki) — tidak ada yang bisa disesuaikan otomatis, jadi tetap
  // ingatkan user untuk cek manual seperti perilaku lama.
  const amountChangedNoSibling = !isNew && amountChanged && siblingTransaction == null;

  const errors: string[] = [];
  if (isNew) {
    // [BARU] Jurnal baru WAJIB double-entry lengkap (dua akun + satu
    // nominal) sejak awal — lihat komentar onSave di Props di atas soal
    // kenapa backend mengharuskan ini.
    if (!debetCode.trim()) errors.push('Kode akun sisi Debet wajib diisi.');
    if (!debetName.trim()) errors.push('Nama akun sisi Debet wajib diisi.');
    if (!kreditCode.trim()) errors.push('Kode akun sisi Kredit wajib diisi.');
    if (!kreditName.trim()) errors.push('Nama akun sisi Kredit wajib diisi.');
    if (debetCode.trim() && kreditCode.trim() && debetCode.trim() === kreditCode.trim()) {
      errors.push('Akun Debet dan Kredit tidak boleh sama.');
    }
    if (!form.debit || form.debit <= 0) errors.push('Nominal wajib diisi, lebih besar dari 0.');
  } else {
    if (!String(form.accountCode || '').trim()) errors.push('Kode akun wajib diisi.');
    if (!String(form.accountName || '').trim() || form.accountName === 'Belum Terkategori') {
      errors.push('Nama akun masih "Belum Terkategori" — pilih akun yang sesuai.');
    }
    if (bothZero) errors.push('Isi salah satu nominal Debit atau Kredit.');
    if (bothFilled) errors.push('Baris ini hanya boleh punya salah satu: Debit ATAU Kredit, tidak keduanya.');
  }
  if (!String(form.description || '').trim()) errors.push('Deskripsi wajib diisi.');
  if (!form.date) errors.push('Tanggal wajib diisi.');

  const canSave = errors.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    if (isNew) {
      // [BARU] Susun sepasang leg (debet + kredit) berbagi jeId/voucherNo
      // yang sama, meniru pola drafJurnalToTransactions() di
      // ImportRekeningKoranModal.tsx — supaya jurnal manual berperilaku
      // sama persis dgn hasil import di seluruh app (getTransactionGroup,
      // groupAnalytics, apBridge/arBridge, dll).
      const nominal = form.debit || 0;
      const base = {
        date: form.date,
        jeId: form.jeId,
        voucherNo: form.voucherNo,
        description: form.description,
        reference: form.reference,
        party: form.party,
        category: form.category,
        status: form.status,
        notes: form.notes,
        saldoAkhir: 0,
        cek: false,
        paymentStatus: form.paymentStatus,
        dueDate: form.dueDate,
        paidAmount: form.paidAmount,
      };
      const debetTx: Transaction = {
        ...base,
        id: `${form.jeId}-D`,
        txId: `${form.txId}-D`,
        accountCode: debetCode.trim(),
        accountName: debetName.trim(),
        debit: nominal,
        credit: 0,
        type: 'debit',
      };
      const kreditTx: Transaction = {
        ...base,
        id: `${form.jeId}-K`,
        txId: `${form.txId}-K`,
        accountCode: kreditCode.trim(),
        accountName: kreditName.trim(),
        debit: 0,
        credit: nominal,
        type: 'credit',
      };
      onSave([debetTx, kreditTx]);
      return;
    }

    // [DIUBAH — sinkron otomatis kaki pasangan] Nominal baris ini berubah
    // dan pasangannya (jeId sama) diketahui -> kirim SEPASANG Transaction
    // (baris ini + pasangan yang nominalnya sudah disesuaikan) supaya
    // parent (TransactionsContent.handleSaveEdit -> TransactionsContext.
    // saveEdit) menyimpan & mem-PATCH keduanya sekaligus, dan jurnal tidak
    // pernah berakhir dalam keadaan tidak balance di backend maupun layar.
    if (unbalancedWithSibling && siblingTransaction) {
      const updatedSibling: Transaction = {
        ...siblingTransaction,
        debit: siblingTransaction.debit > 0 ? thisAmount : 0,
        credit: siblingTransaction.credit > 0 ? thisAmount : 0,
      };
      onSave([form, updatedSibling]);
      return;
    }

    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-xl font-700 text-foreground">{isNew ? 'Tambah Jurnal Baru' : 'Edit Transaksi'}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isNew ? 'Isi detail transaksi di bawah, lalu simpan.' : `${form.txId} · ${form.jeId}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form id="edit-transaction-form" onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Tanggal</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
                className="input-base text-sm"
                required
              />
            </div>
            {/* [BARU] "Tipe" (debit/credit/journal) hanya relevan untuk edit
                satu leg yang sudah ada — jurnal baru selalu dua leg
                (debet+kredit) sekaligus, tipe tiap leg otomatis ditentukan,
                tidak perlu dipilih manual. */}
            {!isNew && (
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Tipe</label>
                <select
                  value={form.type}
                  onChange={(e) => setField('type', e.target.value as Transaction['type'])}
                  className="input-base text-sm cursor-pointer"
                >
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {isNew ? (
            // [BARU] Mode jurnal baru: dua sisi akun sekaligus (double-entry
            // lengkap wajib sejak dibuat — lihat komentar onSave di Props).
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3 space-y-3">
                <p className="text-xs font-700 text-foreground">Sisi Debet</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Kode Akun</label>
                    <input
                      type="text" value={debetCode} onChange={(e) => setDebetCode(e.target.value)}
                      placeholder="mis. 5401" className="input-base text-sm font-mono" required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nama Akun</label>
                    <input
                      type="text" value={debetName} onChange={(e) => setDebetName(e.target.value)}
                      placeholder="mis. Beban Sewa Kantor" className="input-base text-sm" required
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-3">
                <p className="text-xs font-700 text-foreground">Sisi Kredit</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Kode Akun</label>
                    <input
                      type="text" value={kreditCode} onChange={(e) => setKreditCode(e.target.value)}
                      placeholder="mis. 1101" className="input-base text-sm font-mono" required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nama Akun</label>
                    <input
                      type="text" value={kreditName} onChange={(e) => setKreditName(e.target.value)}
                      placeholder="mis. Kas & Bank — BCA" className="input-base text-sm" required
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Kode Akun</label>
                <input
                  type="text"
                  value={form.accountCode}
                  onChange={(e) => setField('accountCode', e.target.value)}
                  placeholder="mis. 1101"
                  className="input-base text-sm font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nama Akun</label>
                <input
                  type="text"
                  value={form.accountName}
                  onChange={(e) => setField('accountName', e.target.value)}
                  placeholder="mis. Kas & Bank — BCA"
                  className="input-base text-sm"
                  required
                />
              </div>
            </div>
          )}
          {/* [BARU] Field di bawah ini (Deskripsi, Nominal, Referensi/Pihak,
              Kategori/Status, pembayaran vendor) dipakai bersama oleh mode
              edit maupun mode "+ Jurnal Baru" — lihat komentar onSave di
              Props soal kenapa `transaction` dipakai sbg template kosong. */}

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Deskripsi</label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              className="input-base text-sm resize-none"
              required
            />
          </div>

          {isNew ? (
            // [BARU] Satu input nominal saja — dipakai sbg jumlah kedua sisi
            // (debet=kredit, lihat handleSubmit) supaya tidak ada celah salah
            // ketik bikin jurnal baru tidak balance (lihat komentar
            // debetCode/debetName state di atas).
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nominal (Rp)</label>
              <input
                type="number"
                min={0}
                value={form.debit || ''}
                onChange={(e) => setField('debit', toNumberInput(e.target.value))}
                placeholder="0"
                className="input-base text-sm font-mono"
                required
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Debit (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={form.debit || ''}
                  onChange={(e) => setField('debit', toNumberInput(e.target.value))}
                  placeholder="0"
                  className="input-base text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Kredit (Rp)</label>
                <input
                  type="number"
                  min={0}
                  value={form.credit || ''}
                  onChange={(e) => setField('credit', toNumberInput(e.target.value))}
                  placeholder="0"
                  className="input-base text-sm font-mono"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Referensi</label>
              <input
                type="text"
                value={form.reference}
                onChange={(e) => setField('reference', e.target.value)}
                className="input-base text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Pihak</label>
              <input
                type="text"
                value={form.party}
                onChange={(e) => setField('party', e.target.value)}
                className="input-base text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Kategori</label>
              {useCustomCategory ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setField('category', e.target.value)}
                    className="input-base text-sm flex-1"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setUseCustomCategory(false)}
                    className="text-xs text-primary whitespace-nowrap"
                  >
                    Pilih dari daftar
                  </button>
                </div>
              ) : (
                <select
                  value={form.category}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') { setUseCustomCategory(true); return; }
                    setField('category', e.target.value);
                  }}
                  className="input-base text-sm cursor-pointer"
                >
                  {KNOWN_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="__custom__">Kategori lain...</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as Transaction['status'])}
                className="input-base text-sm cursor-pointer"
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* [BARU] Field pembayaran ke vendor — hanya tampil untuk transaksi
              kelompok Expense, karena field inilah yang menghubungkan baris
              ini ke halaman Account Payable (lihat apBridge.ts). */}
          {getTransactionGroup(form) === 'purchase' && (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 space-y-4">
              <p className="text-xs font-semibold text-primary">Status Pembayaran ke Vendor (Account Payable)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Status Pembayaran</label>
                  <select
                    value={form.paymentStatus || 'Belum Dibayar'}
                    onChange={(e) => {
                      const next = e.target.value as NonNullable<Transaction['paymentStatus']>;
                      setField('paymentStatus', next);
                      if (next === 'Belum Dibayar') setField('paidAmount', 0);
                      if (next === 'Lunas') setField('paidAmount', form.debit);
                    }}
                    className="input-base text-sm cursor-pointer"
                  >
                    {PAYMENT_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Tanggal Jatuh Tempo</label>
                  <input
                    type="date"
                    value={form.dueDate || ''}
                    onChange={(e) => setField('dueDate', e.target.value)}
                    className="input-base text-sm"
                  />
                </div>
              </div>
              {form.paymentStatus === 'Sebagian Dibayar' && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Jumlah Sudah Dibayar (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    max={form.debit || undefined}
                    value={form.paidAmount ?? 0}
                    onChange={(e) => setField('paidAmount', toNumberInput(e.target.value))}
                    className="input-base text-sm font-mono"
                  />
                  <p className="text-2xs text-muted-foreground mt-1">
                    Sisa akan otomatis tercatat sebagai tagihan terbuka (outstanding) di Account Payable: Rp{' '}
                    {Math.max(0, (form.debit || 0) - (form.paidAmount ?? 0)).toLocaleString('id-ID')}
                  </p>
                </div>
              )}
              <p className="text-2xs text-muted-foreground">
                Berapapun status posting jurnal di atas (Unposted/Posted/dll), baris ini akan tetap muncul sebagai
                tagihan di halaman Account Payable selama Status Pembayaran belum &quot;Lunas&quot;.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Catatan (opsional)</label>
            <textarea
              value={form.notes || ''}
              onChange={(e) => setField('notes', e.target.value || undefined)}
              rows={2}
              className="input-base text-sm resize-none"
              placeholder="Catatan tambahan..."
            />
          </div>

          {unbalancedWithSibling && (
            <div className="flex items-start gap-2 bg-warning-subtle border border-warning/20 rounded-lg p-3">
              <AlertTriangle size={14} className="text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                Nominal baris ini berubah jadi tidak sama dengan pasangan jurnalnya
                ({siblingTransaction?.accountName || 'baris lain'}, Rp {siblingAmount?.toLocaleString('id-ID')}).
                Kalau disimpan, nominal pasangan itu akan ikut disesuaikan otomatis jadi Rp{' '}
                {thisAmount.toLocaleString('id-ID')} supaya jurnal tetap balance.
              </p>
            </div>
          )}

          {amountChangedNoSibling && (
            <div className="flex items-start gap-2 bg-warning-subtle border border-warning/20 rounded-lg p-3">
              <AlertTriangle size={14} className="text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                Nominal baris ini diubah, tapi pasangan jurnalnya (baris debet/kredit lain dengan Jurnal
                Entri yang sama) tidak ditemukan — pastikan disesuaikan manual sendiri kalau ada.
              </p>
            </div>
          )}

          {errors.length > 0 && (
            <div className="flex items-start gap-2 bg-negative-subtle border border-negative/20 rounded-lg p-3">
              <AlertTriangle size={14} className="text-negative mt-0.5 flex-shrink-0" />
              <ul className="text-xs text-foreground space-y-0.5">
                {errors.map((err) => <li key={err}>{err}</li>)}
              </ul>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-border bg-secondary/30 flex-shrink-0">
          <button onClick={onClose} className="text-sm font-500 text-muted-foreground hover:text-foreground transition-colors">
            Batal
          </button>
          <button
            type="submit"
            form="edit-transaction-form"
            disabled={!canSave}
            className={`btn-primary text-sm py-2 px-4 gap-1.5 flex items-center ${!canSave ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Save size={14} />
            {isNew ? 'Simpan Jurnal Baru' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  );
}