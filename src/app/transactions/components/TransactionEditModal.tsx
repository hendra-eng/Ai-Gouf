'use client';
import React, { useState } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';
import { Transaction } from './transactionData';

interface Props {
  transaction: Transaction;
  onClose: () => void;
  // Dipanggil dengan versi Transaction yang sudah diedit — parent (TransactionsContent)
  // yang bertanggung jawab menimpa entri lama di state `transactions`.
  onSave: (updated: Transaction) => void;
}

// Kategori yang sudah dikenal sistem (dipakai untuk dropdown, tapi tetap boleh
// isi kategori baru lewat opsi "Kategori lain..." di bawah select).
const KNOWN_CATEGORIES = [
  'Revenue', 'Payroll', 'Software', 'Rent', 'Tax', 'Marketing', 'Travel',
  'CapEx', 'AP Payment', 'Utilities', 'Financing', 'Import Rekening Koran',
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

export default function TransactionEditModal({ transaction, onClose, onSave }: Props) {
  const [form, setForm] = useState<Transaction>(() => normalisasiTransaksi(transaction));
  // Kalau kategori transaksi belum ada di daftar dikenal, tampilkan sebagai
  // input bebas dari awal (bukan dropdown) supaya nilainya tidak "hilang".
  const [useCustomCategory, setUseCustomCategory] = useState(
    !KNOWN_CATEGORIES.includes(transaction.category ?? '')
  );

  const setField = <K extends keyof Transaction>(key: K, value: Transaction[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isBalanced = form.debit === 0 || form.credit === 0 || form.debit === form.credit;
  const bothZero = form.debit === 0 && form.credit === 0;
  const bothFilled = form.debit > 0 && form.credit > 0;

  const errors: string[] = [];
  if (!String(form.accountCode || '').trim()) errors.push('Kode akun wajib diisi.');
  if (!String(form.accountName || '').trim() || form.accountName === 'Belum Terkategori') {
    errors.push('Nama akun masih "Belum Terkategori" — pilih akun yang sesuai.');
  }
  if (!String(form.description || '').trim()) errors.push('Deskripsi wajib diisi.');
  if (bothZero) errors.push('Isi salah satu nominal Debit atau Kredit.');
  if (bothFilled) errors.push('Baris ini hanya boleh punya salah satu: Debit ATAU Kredit, tidak keduanya.');
  if (!form.date) errors.push('Tanggal wajib diisi.');

  const canSave = errors.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-xl font-700 text-foreground">Edit Transaksi</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {form.txId} · {form.jeId}
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
          </div>

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

          {!isBalanced && !bothZero && !bothFilled && (
            <div className="flex items-start gap-2 bg-warning-subtle border border-warning/20 rounded-lg p-3">
              <AlertTriangle size={14} className="text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                Debit dan Kredit baris ini tidak sama besar — pastikan pasangan jurnalnya
                (baris debet/kredit lain dengan Jurnal Entri yang sama) sudah disesuaikan juga.
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
            Simpan Perubahan
          </button>
        </div>
      </div>
    </div>
  );
}
