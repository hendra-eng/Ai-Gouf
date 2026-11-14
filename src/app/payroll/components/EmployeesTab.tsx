'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { Field, MoneyInput, Modal, SectionCard, TD, TH } from './payrollUi';
import type { PayrollStore } from '../lib/payrollStore';
import { PTKP_OPTIONS, type Employee } from '../lib/payrollTypes';
import { terCategory } from '../lib/payrollCalc';
import { rupiah } from '../lib/payrollExport';

type Draft = Omit<Employee, 'id'> & { id?: string };

const blank = (n: number): Draft => ({
  nip: `EMP-${String(n).padStart(3, '0')}`, name: '', position: '', department: '', branch: '',
  employmentType: 'PKWTT', joinDate: new Date().toISOString().slice(0, 10), npwp: '', ptkp: 'TK/0',
  baseSalary: 0, fixedAllowance: 0, variableAllowance: 0, bankName: '', bankAccount: '',
  bpjsTk: true, bpjsKes: true, active: true,
});

export default function EmployeesTab({ store }: { store: PayrollStore }) {
  const { employees } = store;
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('Semua');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const departments = useMemo(() => ['Semua', ...Array.from(new Set(employees.map(e => e.department).filter(Boolean)))], [employees]);
  const filtered = useMemo(() => employees.filter(e =>
    (dept === 'Semua' || e.department === dept) &&
    (`${e.name} ${e.nip} ${e.position}`.toLowerCase().includes(q.toLowerCase())),
  ), [employees, q, dept]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error('Nama karyawan wajib diisi');
    if (editing.baseSalary <= 0) return toast.error('Gaji pokok harus lebih dari 0');
    setSaving(true);
    const ok = await store.saveEmployee(editing);
    setSaving(false);
    if (!ok) return; // pesan error sudah ditampilkan store
    toast.success(editing.id ? 'Data karyawan diperbarui' : 'Karyawan ditambahkan');
    setEditing(null);
  };

  const remove = async (e: Employee) => {
    if (!window.confirm(`Hapus ${e.name}? Payroll run yang sudah dibuat tidak ikut terhapus.`)) return;
    if (await store.removeEmployee(e.id)) toast.success('Karyawan dihapus');
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing(prev => (prev ? { ...prev, [k]: v } : prev));

  return (
    <>
      <SectionCard
        title="Data Karyawan"
        subtitle={`${employees.filter(e => e.active).length} aktif dari ${employees.length} karyawan`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama / NIP..."
                className="pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:border-primary/50 w-48"
              />
            </div>
            <select value={dept} onChange={e => setDept(e.target.value)} className="py-1.5 px-2 text-[12px] border border-border rounded-md bg-card">
              {departments.map(d => <option key={d}>{d}</option>)}
            </select>
            <button onClick={() => setEditing(blank(employees.length + 1))} className="fin-btn-primary flex items-center gap-1.5">
              <Plus size={14} /> Tambah Karyawan
            </button>
          </div>
        }
      >
        {employees.length === 0 ? (
          <EmptyState
            icon={Users} title="Belum ada karyawan"
            description="Tambahkan karyawan satu per satu, atau muat data contoh untuk mencoba fitur payroll."
            action={{ label: 'Tambah karyawan', onClick: () => setEditing(blank(1)) }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {['NIP', 'Nama', 'Jabatan', 'Departemen', 'PTKP / TER', 'Gaji Pokok', 'Tunjangan', 'BPJS', 'Status', ''].map(c => <th key={c} className={TH}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className={`${TD} text-primary font-medium`}>{e.nip}</td>
                    <td className={TD}>
                      <div className="font-medium text-foreground">{e.name}</div>
                      <div className="text-[11px] text-muted-foreground">{e.employmentType} • {e.npwp ? 'NPWP ✓' : <span className="text-amber-600">Tanpa NPWP</span>}</div>
                    </td>
                    <td className={`${TD} text-muted-foreground`}>{e.position || '—'}</td>
                    <td className={`${TD} text-muted-foreground`}>{e.department || '—'}</td>
                    <td className={TD}>{e.ptkp} <span className="text-muted-foreground">• TER {terCategory(e.ptkp)}</span></td>
                    <td className={`${TD} financial-value`}>{rupiah(e.baseSalary)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(e.fixedAllowance + e.variableAllowance)}</td>
                    <td className={TD}>
                      <span className="text-[11px] text-muted-foreground">{e.bpjsTk ? 'TK' : '—'} / {e.bpjsKes ? 'Kes' : '—'}</span>
                    </td>
                    <td className={TD}><StatusBadge label={e.active ? 'Aktif' : 'Nonaktif'} variant={e.active ? 'positive' : 'neutral'} dot /></td>
                    <td className={TD}>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditing({ ...e })} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil size={13} className="text-muted-foreground" /></button>
                        <button onClick={() => remove(e)} className="p-1.5 rounded hover:bg-negative-subtle" title="Hapus"><Trash2 size={13} className="text-negative" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Tidak ada karyawan yang cocok.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editing && (
        <Modal
          wide
          title={editing.id ? 'Edit Karyawan' : 'Tambah Karyawan'}
          subtitle="Data ini dipakai sebagai master saat membuat payroll run"
          onClose={() => setEditing(null)}
          footer={<>
            <button onClick={() => setEditing(null)} className="fin-btn-secondary">Batal</button>
            <button onClick={save} disabled={saving} className="fin-btn-primary disabled:opacity-60">{saving ? 'Menyimpan…' : 'Simpan'}</button>
          </>}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nama lengkap *"><input className="input-base" value={editing.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="NIP"><input className="input-base" value={editing.nip} onChange={e => set('nip', e.target.value)} /></Field>
            <Field label="Jabatan"><input className="input-base" value={editing.position} onChange={e => set('position', e.target.value)} /></Field>
            <Field label="Departemen"><input className="input-base" value={editing.department} onChange={e => set('department', e.target.value)} /></Field>
            <Field label="Cabang"><input className="input-base" value={editing.branch} onChange={e => set('branch', e.target.value)} /></Field>
            <Field label="Tanggal bergabung"><input type="date" className="input-base" value={editing.joinDate} onChange={e => set('joinDate', e.target.value)} /></Field>
            <Field label="Status kerja">
              <select className="input-base" value={editing.employmentType} onChange={e => set('employmentType', e.target.value as Employee['employmentType'])}>
                <option value="PKWTT">PKWTT (Tetap)</option><option value="PKWT">PKWT (Kontrak)</option>
              </select>
            </Field>
            <Field label="NPWP / NIK" hint="Kosongkan bila belum punya — PPh 21 dikenai tarif +20% (dapat dimatikan di Settings).">
              <input className="input-base" value={editing.npwp} onChange={e => set('npwp', e.target.value)} />
            </Field>
            <Field label="Status PTKP" hint={`Kategori TER: ${terCategory(editing.ptkp)}`}>
              <select className="input-base" value={editing.ptkp} onChange={e => set('ptkp', e.target.value as Employee['ptkp'])}>
                {PTKP_OPTIONS.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <div />
            <Field label="Gaji pokok (per bulan) *"><MoneyInput value={editing.baseSalary} onCommit={n => set('baseSalary', n)} /></Field>
            <Field label="Tunjangan tetap" hint="Masuk dasar upah BPJS."><MoneyInput value={editing.fixedAllowance} onCommit={n => set('fixedAllowance', n)} /></Field>
            <Field label="Tunjangan tidak tetap (transport/makan)" hint="Tidak masuk dasar upah BPJS."><MoneyInput value={editing.variableAllowance} onCommit={n => set('variableAllowance', n)} /></Field>
            <div />
            <Field label="Bank"><input className="input-base" value={editing.bankName} onChange={e => set('bankName', e.target.value)} /></Field>
            <Field label="No. rekening"><input className="input-base" value={editing.bankAccount} onChange={e => set('bankAccount', e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 pt-4 border-t border-border text-sm">
            {([
              ['bpjsTk', 'BPJS Ketenagakerjaan (JHT, JP, JKK, JKM)'],
              ['bpjsKes', 'BPJS Kesehatan'],
              ['active', 'Karyawan aktif'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing[k]} onChange={e => set(k, e.target.checked)} className="rounded border-border" />
                {label}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
