'use client';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { Field, MoneyInput, SectionCard } from './payrollUi';
import type { PayrollStore } from '../lib/payrollStore';
import { DEFAULT_SETTINGS, type PayrollSettings } from '../lib/payrollTypes';

const Pct = ({ label, k, s, set, hint }: { label: string; k: keyof PayrollSettings; s: PayrollSettings; set: (k: keyof PayrollSettings, v: number) => void; hint?: string }) => (
  <Field label={`${label} (%)`} hint={hint}>
    <input type="number" step="0.01" className="input-base text-right font-mono-nums" value={s[k] as number} onChange={e => set(k, Number(e.target.value))} />
  </Field>
);

/** Input tanggal gajian 1–32: boleh dikosongkan saat mengetik, dirapikan (dibatasi 1–32) saat selesai. */
function PayDayInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    const fixed = Number.isNaN(n) ? value : Math.min(32, Math.max(1, n));
    setText(String(fixed));
    if (fixed !== value) onCommit(fixed);
  };

  return (
    <input
      inputMode="numeric"
      maxLength={2}
      className="input-base"
      value={text}
      onChange={e => {
        const digits = e.target.value.replace(/\D/g, '');
        setText(digits);
        const n = parseInt(digits, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 32) onCommit(n);
      }}
      onBlur={commit}
    />
  );
}

export default function PayrollSettingsTab({ store }: { store: PayrollStore }) {
  const [s, setS] = useState<PayrollSettings>(store.settings);
  useEffect(() => setS(store.settings), [store.settings]);

  const setNum = (k: keyof PayrollSettings, v: number) => setS(p => ({ ...p, [k]: v }));
  const setStr = (k: keyof PayrollSettings, v: string) => setS(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (await store.saveSettings(s)) toast.success('Pengaturan payroll disimpan — run draft dihitung ulang');
  };

  return (
    <>
      <div className="flex items-start gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-5">
        <Info size={15} className="flex-shrink-0 mt-0.5" />
        <span>Tarif BPJS, batas upah JP/Kesehatan, dan kelas risiko JKK berubah berkala dan bisa berbeda per perusahaan. Pastikan angka di bawah sesuai ketentuan terbaru sebelum memproses payroll sungguhan.</span>
      </div>

      <SectionCard title="BPJS Ketenagakerjaan" subtitle="Persentase dari upah (gaji pokok + tunjangan tetap)">
        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Pct label="JHT karyawan" k="jhtEmployee" s={s} set={setNum} />
          <Pct label="JHT perusahaan" k="jhtEmployer" s={s} set={setNum} />
          <Pct label="JP karyawan" k="jpEmployee" s={s} set={setNum} />
          <Pct label="JP perusahaan" k="jpEmployer" s={s} set={setNum} />
          <Pct label="JKK" k="jkkRate" s={s} set={setNum} hint="Sesuai kelas risiko (0,24–1,74%)" />
          <Pct label="JKM" k="jkmRate" s={s} set={setNum} />
          <Field label="Batas upah JP (Rp)" hint="Diperbarui tiap tahun oleh BPJS"><MoneyInput value={s.jpCap} onCommit={n => setNum('jpCap', n)} /></Field>
        </div>
      </SectionCard>

      <SectionCard title="BPJS Kesehatan">
        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Pct label="Karyawan" k="kesEmployee" s={s} set={setNum} />
          <Pct label="Perusahaan" k="kesEmployer" s={s} set={setNum} />
          <Field label="Batas upah (Rp)"><MoneyInput value={s.kesCap} onCommit={n => setNum('kesCap', n)} /></Field>
        </div>
      </SectionCard>

      <SectionCard title="PPh Pasal 21">
        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <Pct label="Biaya jabatan" k="biayaJabatanRate" s={s} set={setNum} hint="Dipakai pada perhitungan tahunan (Desember)" />
          <Field label="Maks biaya jabatan / bulan (Rp)"><MoneyInput value={s.biayaJabatanMonthlyCap} onCommit={n => setNum('biayaJabatanMonthlyCap', n)} /></Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer col-span-2">
            <input type="checkbox" checked={s.nonNpwpSurcharge} onChange={e => setS(p => ({ ...p, nonNpwpSurcharge: e.target.checked }))} className="rounded border-border" />
            Tarif +20% untuk karyawan tanpa NPWP
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Perusahaan & Pembayaran">
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nama perusahaan (header slip gaji)"><input className="input-base" value={s.companyName} onChange={e => setStr('companyName', e.target.value)} /></Field>
          <Field label="Tanggal gajian default (1–32)" hint="Angka di atas jumlah hari dalam bulan otomatis jadi tanggal terakhir bulan itu (mis. 31 atau 32 = akhir bulan).">
            <PayDayInput value={s.payDay} onCommit={n => setNum('payDay', n)} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Akun Jurnal" subtitle="Nama akun untuk pratinjau jurnal penggajian (sesuaikan dengan Chart of Accounts client)">
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Beban gaji & tunjangan"><input className="input-base" value={s.accSalaryExpense} onChange={e => setStr('accSalaryExpense', e.target.value)} /></Field>
          <Field label="Beban BPJS (porsi perusahaan)"><input className="input-base" value={s.accBpjsExpense} onChange={e => setStr('accBpjsExpense', e.target.value)} /></Field>
          <Field label="Hutang gaji"><input className="input-base" value={s.accSalaryPayable} onChange={e => setStr('accSalaryPayable', e.target.value)} /></Field>
          <Field label="Hutang PPh 21"><input className="input-base" value={s.accTaxPayable} onChange={e => setStr('accTaxPayable', e.target.value)} /></Field>
          <Field label="Hutang BPJS"><input className="input-base" value={s.accBpjsPayable} onChange={e => setStr('accBpjsPayable', e.target.value)} /></Field>
          <Field label="Piutang karyawan"><input className="input-base" value={s.accEmployeeReceivable} onChange={e => setStr('accEmployeeReceivable', e.target.value)} /></Field>
        </div>
      </SectionCard>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-muted-foreground">Mengubah tarif akan menghitung ulang semua payroll berstatus draft.</span>
        <div className="flex gap-2">
          <button onClick={() => setS({ ...DEFAULT_SETTINGS, companyName: s.companyName })} className="fin-btn-secondary">Kembalikan default</button>
          <button onClick={save} className="fin-btn-primary">Simpan Pengaturan</button>
        </div>
      </div>
    </>
  );
}