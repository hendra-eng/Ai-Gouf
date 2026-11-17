'use client';

// Form jurnal untuk mutasi TANPA invoice (biaya admin, bunga, pajak bunga, transfer antar bank,
// setoran modal, dst). User memilih akun lawan sendiri (opsi A). Baris Bank dibuat otomatis oleh
// backend dari arah mutasi, jadi di sini hanya baris akun lawan. Jurnal harus seimbang:
//   uang masuk  -> Dr Bank (nominal mutasi)  = total kredit akun lawan - total debit akun lawan
//   uang keluar -> Cr Bank (nominal mutasi)  = total debit akun lawan  - total kredit akun lawan
// Hasilnya jurnal DRAFT yang lanjut ke Approve -> Post di Journal Preview.

import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatIDR } from '../lib/formatMoney';
import type { AkunLawan, BarisLawanInput } from '../lib/useBankReconciliation';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { FilterSelect } from './sourceUi';

const KATEGORI = [
  'Bank charges',
  'Bank interest',
  'Tax on bank interest',
  'Inter-bank transfer',
  'Capital injection',
  'Other',
] as const;

interface Baris {
  key: number;
  coaId: string;
  side: 'debit' | 'credit';
  amount: string;
  cari: string;
}

interface Props {
  /** Nominal mutasi (selalu positif) dan arahnya. */
  nominal: number;
  masuk: boolean;
  akun: AkunLawan[];
  busy: boolean;
  onSubmit: (kategori: string, baris: BarisLawanInput[]) => Promise<void>;
}

let seq = 0;

export default function NonInvoiceForm({ nominal, masuk, akun, busy, onSubmit }: Props) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const sisiUtama: 'debit' | 'credit' = masuk ? 'credit' : 'debit';
  const [buka, setBuka] = useState(false);
  const [kategori, setKategori] = useState<string>(KATEGORI[0]);
  const [baris, setBaris] = useState<Baris[]>(() => [
    { key: ++seq, coaId: '', side: sisiUtama, amount: String(nominal), cari: '' },
  ]);
  const [pesan, setPesan] = useState<string | null>(null);

  // Selisih jurnal: sisi Bank ditambah baris akun lawan harus nol.
  const ringkas = useMemo(() => {
    let debit = masuk ? nominal : 0;
    let kredit = masuk ? 0 : nominal;
    for (const b of baris) {
      const n = Number(b.amount) || 0;
      if (b.side === 'debit') debit += n;
      else kredit += n;
    }
    return { debit, kredit, selisih: Math.round((debit - kredit) * 100) / 100 };
  }, [baris, masuk, nominal]);

  const ubah = (key: number, patch: Partial<Baris>) =>
    setBaris((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const tambah = () => {
    // Baris baru otomatis diisi sisa yang belum seimbang, di sisi yang menutupnya.
    const perlu = -ringkas.selisih;
    setBaris((prev) => [
      ...prev,
      { key: ++seq, coaId: '', side: perlu >= 0 ? 'credit' : 'debit', amount: String(Math.abs(perlu) || ''), cari: '' },
    ]);
  };

  const kirim = async () => {
    setPesan(null);
    if (baris.some((b) => !b.coaId)) return setPesan('Select an account for every line.');
    if (baris.some((b) => !(Number(b.amount) > 0))) return setPesan('Every line amount must be greater than 0.');
    if (Math.abs(ringkas.selisih) > 0.005) return setPesan('The journal is not balanced. Complete the counter-account lines until the difference is 0.');
    try {
      await onSubmit(
        kategori,
        baris.map((b) => ({ coaId: b.coaId, side: b.side, amount: Number(b.amount) })),
      );
      setBuka(false);
    } catch (e: any) {
      setPesan(e?.message || 'Failed to record the line.');
    }
  };

  if (!buka) {
    return (
      <button
        onClick={() => setBuka(true)}
        className="w-full rounded-lg border border-dashed border-neutral-400 px-3 py-2.5 text-left text-xs text-neutral-600 transition-colors hover:border-neutral-700 hover:bg-neutral-50 hover:text-neutral-900"
      >
        <span className="font-semibold text-neutral-900">Not an invoice settlement?</span> Record it as bank charges, interest,
        inter-bank transfer, etc.
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-[10px] border border-neutral-300 bg-neutral-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-neutral-900">Journal without invoice</p>
        <button onClick={() => setBuka(false)} className="rounded-md border border-neutral-300 bg-card px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
          Close
        </button>
      </div>

      <div className="block">
        <span className="text-[11px] text-neutral-500">Transaction type</span>
        <FilterSelect
          value={kategori}
          onChange={setKategori}
          className="mt-1 w-full"
          ariaLabel="Transaction type"
          options={KATEGORI.map((k) => ({ value: k, label: k }))}
        />
      </div>

      <div className="flex justify-between rounded-lg border border-neutral-300 bg-card px-2.5 py-2 text-[11px] text-neutral-600">
        <span>{masuk ? 'Debit — Bank (money in)' : 'Credit — Bank (money out)'}</span>
        <span className="tabular-nums font-semibold text-neutral-900">{formatIDR(nominal, true)}</span>
      </div>

      {baris.map((b) => {
        const q = b.cari.trim().toLowerCase();
        const pilihan = akun.filter(
          (a) => a.id === b.coaId || !q || `${a.no_akun} ${kodeAkun(a.no_akun)} ${a.nama_akun}`.toLowerCase().includes(q),
        ).slice(0, 60);
        return (
          <div key={b.key} className="space-y-1.5 rounded-lg border border-neutral-300 bg-card p-2">
            <input
              value={b.cari}
              onChange={(e) => ubah(b.key, { cari: e.target.value })}
              placeholder="Search account (no. or name)…"
              className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-xs placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <FilterSelect
              value={b.coaId}
              onChange={(v) => ubah(b.key, { coaId: v })}
              className="w-full"
              ariaLabel="Account"
              menuMaxWidth={420}
              options={[
                { value: '', label: '— select account —' },
                ...pilihan.map((a) => ({ value: a.id, label: `${kodeAkun(a.no_akun)} · ${a.nama_akun}` })),
              ]}
            />
            <div className="flex items-center gap-2">
              <FilterSelect
                value={b.side}
                onChange={(v) => ubah(b.key, { side: v as 'debit' | 'credit' })}
                size="sm"
                className="min-w-[88px]"
                ariaLabel="Debit or credit"
                options={[{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={b.amount}
                onChange={(e) => ubah(b.key, { amount: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-right text-xs tabular-nums focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
              {baris.length > 1 && (
                <button
                  onClick={() => setBaris((prev) => prev.filter((x) => x.key !== b.key))}
                  className="p-1 text-neutral-500 transition-colors hover:text-red-600"
                  title="Delete line"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button onClick={tambah} className="flex items-center gap-1 text-[11px] font-semibold text-neutral-900 hover:underline">
        <Plus size={12} /> Add line (e.g. tax)
      </button>

      <div className={`flex justify-between rounded-md px-2.5 py-1.5 text-[11px] tabular-nums ${
        Math.abs(ringkas.selisih) < 0.005 ? 'border border-emerald-300 bg-emerald-100 text-emerald-800' : 'border border-amber-300 bg-amber-100 text-amber-900'
      }`}>
        <span>Debit {formatIDR(ringkas.debit, true)} · Credit {formatIDR(ringkas.kredit, true)}</span>
        <span>{Math.abs(ringkas.selisih) < 0.005 ? 'Balanced' : `Difference ${formatIDR(ringkas.selisih, true)}`}</span>
      </div>

      {pesan && <p className="text-[11px] text-red-700">{pesan}</p>}

      <button
        onClick={kirim}
        disabled={busy}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Create DRAFT journal'}
      </button>
    </div>
  );
}
