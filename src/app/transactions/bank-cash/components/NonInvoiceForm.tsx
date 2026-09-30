'use client';

// Form jurnal untuk mutasi TANPA invoice (biaya admin, bunga, pajak bunga, transfer antar bank,
// setoran modal, dst). User memilih akun lawan sendiri (opsi A). Baris Bank dibuat otomatis oleh
// backend dari arah mutasi, jadi di sini hanya baris akun lawan. Jurnal harus seimbang:
//   uang masuk  -> Dr Bank (nominal mutasi)  = total kredit akun lawan - total debit akun lawan
//   uang keluar -> Cr Bank (nominal mutasi)  = total debit akun lawan  - total kredit akun lawan
// Hasilnya jurnal DRAFT yang lanjut ke Approve -> Post di Journal Preview.

import React, { useMemo, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { formatIDR } from '../../lib/groupAnalytics';
import type { AkunLawan, BarisLawanInput } from '../lib/useBankReconciliation';

const KATEGORI = [
  'Biaya admin bank',
  'Bunga bank',
  'Pajak bunga bank',
  'Transfer antar bank',
  'Setoran modal',
  'Lainnya',
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
    if (baris.some((b) => !b.coaId)) return setPesan('Pilih akun untuk setiap baris.');
    if (baris.some((b) => !(Number(b.amount) > 0))) return setPesan('Nominal setiap baris harus lebih dari 0.');
    if (Math.abs(ringkas.selisih) > 0.005) return setPesan('Jurnal belum seimbang. Lengkapi baris akun lawan sampai selisih 0.');
    try {
      await onSubmit(
        kategori,
        baris.map((b) => ({ coaId: b.coaId, side: b.side, amount: Number(b.amount) })),
      );
      setBuka(false);
    } catch (e: any) {
      setPesan(e?.message || 'Gagal mencatat mutasi.');
    }
  };

  if (!buka) {
    return (
      <button
        onClick={() => setBuka(true)}
        className="w-full text-left rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
      >
        <span className="font-semibold text-foreground">Bukan pelunasan invoice?</span> Catat sebagai biaya admin, bunga,
        transfer antar bank, dll.
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-foreground">Jurnal tanpa invoice</p>
        <button onClick={() => setBuka(false)} className="text-[11px] text-muted-foreground hover:text-foreground">
          Tutup
        </button>
      </div>

      <label className="block">
        <span className="text-[11px] text-muted-foreground">Jenis transaksi</span>
        <select
          value={kategori}
          onChange={(e) => setKategori(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
        >
          {KATEGORI.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>

      <div className="rounded-md bg-card border border-border px-2.5 py-2 text-[11px] text-muted-foreground flex justify-between">
        <span>{masuk ? 'Debit — Bank (uang masuk)' : 'Kredit — Bank (uang keluar)'}</span>
        <span className="font-mono font-semibold text-foreground">{formatIDR(nominal, true)}</span>
      </div>

      {baris.map((b) => {
        const q = b.cari.trim().toLowerCase();
        const pilihan = akun.filter(
          (a) => a.id === b.coaId || !q || `${a.no_akun} ${a.nama_akun}`.toLowerCase().includes(q),
        ).slice(0, 60);
        return (
          <div key={b.key} className="rounded-md border border-border bg-card p-2 space-y-1.5">
            <input
              value={b.cari}
              onChange={(e) => ubah(b.key, { cari: e.target.value })}
              placeholder="Cari akun (no. atau nama)…"
              className="w-full rounded-md border border-border px-2 py-1 text-xs"
            />
            <select
              value={b.coaId}
              onChange={(e) => ubah(b.key, { coaId: e.target.value })}
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
            >
              <option value="">— pilih akun —</option>
              {pilihan.map((a) => (
                <option key={a.id} value={a.id}>{a.no_akun} · {a.nama_akun}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <select
                value={b.side}
                onChange={(e) => ubah(b.key, { side: e.target.value as 'debit' | 'credit' })}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <option value="debit">Debit</option>
                <option value="credit">Kredit</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={b.amount}
                onChange={(e) => ubah(b.key, { amount: e.target.value })}
                className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-xs font-mono text-right"
              />
              {baris.length > 1 && (
                <button
                  onClick={() => setBaris((prev) => prev.filter((x) => x.key !== b.key))}
                  className="p-1 text-muted-foreground hover:text-rose-600"
                  title="Hapus baris"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button onClick={tambah} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
        <PlusIcon className="w-3 h-3" /> Tambah baris (mis. pajak)
      </button>

      <div className={`flex justify-between rounded-md px-2.5 py-1.5 text-[11px] font-mono ${
        Math.abs(ringkas.selisih) < 0.005 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}>
        <span>Debit {formatIDR(ringkas.debit, true)} · Kredit {formatIDR(ringkas.kredit, true)}</span>
        <span>{Math.abs(ringkas.selisih) < 0.005 ? 'Seimbang' : `Selisih ${formatIDR(ringkas.selisih, true)}`}</span>
      </div>

      {pesan && <p className="text-[11px] text-rose-700">{pesan}</p>}

      <button
        onClick={kirim}
        disabled={busy}
        className="w-full rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        {busy ? 'Menyimpan…' : 'Buat jurnal DRAFT'}
      </button>
    </div>
  );
}
