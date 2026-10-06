'use client';

// Settings > Company: seluruh data management_clients company aktif.
// Mode lihat (kartu per kelompok data) <-> mode edit langsung di halaman yang
// sama (bukan pop-up), simpan lewat PUT /api/v1/management/clients/{id}
// (minimal Tahap 5 -- lihat clients_v1.py). Hanya field yang berubah yang dikirim.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BadgeCheck, Briefcase, Building2, CalendarDays, Camera, Contact, FileBadge2, ImageOff, Loader2, MapPin, Pencil, Save, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useCoaIndustries, type CoaIndustry } from '@/lib/clientsStore';
import { fileToLogoDataUrl } from '@/lib/imageUtils';
import {
  fetchAccountants, fetchCompany, updateCompany, useLoader, type Accountant, type CompanyDetail, type CompanyInput,
} from '@/lib/settingsStore';

const ENTITY_TYPES = ['PT', 'PT Tbk', 'CV', 'Firma', 'Koperasi', 'Yayasan', 'UD', 'Perorangan', 'BUMN', 'BUMD'];
const CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR', 'JPY', 'CNY', 'AUD', 'MYR'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Kode kesehatan finansial (sama dengan clientsStore.tsx CODE_TO_STATUS).
const HEALTH: Record<string, { label: string; cls: string }> = {
  healthy: { label: 'Healthy', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  stable: { label: 'Stable', cls: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  attention: { label: 'Attention Required', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-700 ring-red-600/20' },
};

const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2.5 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelCls = 'block text-xs font-semibold text-foreground mb-1.5';

type Form = Record<string, string>;
type Field = {
  key: keyof CompanyDetail;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'date' | 'select' | 'pkp' | 'month' | 'accountant' | 'industry';
  options?: string[];
  placeholder?: string;
  span?: 2 | 3;
  mono?: boolean;
  required?: boolean;
};

const SECTIONS: { title: string; subtitle: string; icon: React.ElementType; fields: Field[] }[] = [
  {
    title: 'Company profile', subtitle: 'How this company is identified across the app.', icon: Building2,
    fields: [
      { key: 'nama_client', label: 'Company name', required: true, span: 2, placeholder: 'PT Contoh Sejahtera' },
      { key: 'client_code', label: 'Client code', mono: true, placeholder: 'CLT-0001' },
      { key: 'tipe_badan_usaha', label: 'Legal entity type', type: 'select', options: ENTITY_TYPES },
      { key: 'industry', label: 'Industry', type: 'industry' },
      { key: 'klasifikasi_lapangan_usaha', label: 'Business classification (KLU)', placeholder: '56101 — Restoran' },
    ],
  },
  {
    title: 'Legal & tax', subtitle: 'Registration numbers and VAT status.', icon: FileBadge2,
    fields: [
      { key: 'npwp', label: 'NPWP', mono: true, placeholder: '01.234.567.8-901.000' },
      { key: 'nomor_akta_nib', label: 'Deed / NIB number', mono: true },
      { key: 'status_pkp', label: 'VAT status', type: 'pkp' },
    ],
  },
  {
    title: 'Contact & PIC', subtitle: 'Who we talk to at this company.', icon: Contact,
    fields: [
      { key: 'nama_pic', label: 'PIC name' },
      { key: 'jabatan_pic', label: 'PIC position', placeholder: 'Finance Manager' },
      { key: 'email', label: 'Email', type: 'email', placeholder: 'finance@company.com' },
      { key: 'no_telepon', label: 'Office phone', mono: true },
      { key: 'no_handphone', label: 'Mobile / WhatsApp', mono: true },
    ],
  },
  {
    title: 'Address', subtitle: 'Registered business address.', icon: MapPin,
    fields: [
      { key: 'alamat', label: 'Street address', type: 'textarea', span: 3 },
      { key: 'kota', label: 'City' },
      { key: 'provinsi', label: 'Province' },
      { key: 'kode_pos', label: 'Postal code', mono: true },
    ],
  },
  {
    title: 'Accounting & engagement', subtitle: 'Bookkeeping defaults and our engagement.', icon: Briefcase,
    fields: [
      { key: 'tahun_buku_mulai', label: 'Fiscal year starts', type: 'month' },
      { key: 'mata_uang_default', label: 'Default currency', type: 'select', options: CURRENCIES },
      { key: 'status', label: 'Financial health', type: 'select', options: Object.keys(HEALTH) },
      { key: 'akuntan_penanggung_jawab', label: 'Responsible accountant', type: 'accountant', span: 2 },
      { key: 'tanggal_mulai_kerjasama', label: 'Engagement start', type: 'date' },
    ],
  },
];

const SEMUA_FIELD = SECTIONS.flatMap(s => s.fields);

function keForm(c: CompanyDetail): Form {
  const f: Form = {};
  for (const fld of SEMUA_FIELD) {
    const v = c[fld.key];
    if (fld.type === 'pkp') f[fld.key] = v === true ? 'true' : v === false ? 'false' : '';
    else if (fld.type === 'date') f[fld.key] = typeof v === 'string' ? v.slice(0, 10) : '';
    else f[fld.key] = v == null ? '' : String(v);
  }
  return f;
}

function keNilai(fld: Field, raw: string): unknown {
  const s = raw.trim();
  if (fld.type === 'pkp') return s === '' ? null : s === 'true';
  if (fld.type === 'date') return s ? `${s}T00:00:00` : null;
  return s || null;
}

const fmtTanggal = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function tampil(fld: Field, c: CompanyDetail, akuntan: Accountant[]): React.ReactNode {
  const v = c[fld.key];
  if (fld.type === 'pkp') {
    if (v == null) return null;
    return v
      ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><BadgeCheck size={12} /> PKP</span>
      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Non-PKP</span>;
  }
  if (v == null || v === '') return null;
  if (fld.key === 'status') {
    const h = HEALTH[String(v).toLowerCase()];
    return h ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${h.cls}`}>{h.label}</span> : String(v);
  }
  if (fld.type === 'month') {
    const n = Number(v);
    return n >= 1 && n <= 12 ? MONTHS[n - 1] : String(v);
  }
  if (fld.type === 'date') {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : fmtTanggal.format(d);
  }
  if (fld.type === 'accountant') {
    const a = akuntan.find(x => x.id === v);
    return a ? <>{a.name} <span className="text-muted-foreground">· {a.role_label}</span></> : String(v);
  }
  return String(v);
}

export default function CompanySettings() {
  const { activeClientId } = useActiveClient();
  const { data: company, setData, loading, error } = useLoader<CompanyDetail | null>(activeClientId, fetchCompany, null);
  const { data: akuntan } = useLoader<Accountant[]>('all', fetchAccountants, []);
  const { industries } = useCoaIndustries();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined = tidak diubah
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ganti company -> keluar dari mode edit.
  useEffect(() => { setEdit(false); setLogo(undefined); }, [activeClientId]);

  const berubah = useMemo(() => {
    if (!company) return {} as CompanyInput;
    const awal = keForm(company);
    const out: Record<string, unknown> = {};
    for (const fld of SEMUA_FIELD) {
      if ((form[fld.key] ?? '') !== (awal[fld.key] ?? '')) out[fld.key] = keNilai(fld, form[fld.key] ?? '');
    }
    if (logo !== undefined && logo !== company.logo) out.logo = logo;
    return out as CompanyInput;
  }, [company, form, logo]);
  const jumlahBerubah = Object.keys(berubah).length;

  const mulaiEdit = () => {
    if (!company) return;
    setForm(keForm(company));
    setLogo(undefined);
    setEdit(true);
  };

  const batal = () => {
    if (jumlahBerubah && !window.confirm('Discard unsaved changes?')) return;
    setEdit(false);
    setLogo(undefined);
  };

  async function simpan() {
    if (!company || saving) return;
    if (!(form.nama_client ?? '').trim()) {
      toast.error('Company name is required.');
      return;
    }
    if (!jumlahBerubah) {
      setEdit(false);
      return;
    }
    setSaving(true);
    try {
      const baru = await updateCompany(company.id, berubah);
      setData(baru);
      setEdit(false);
      setLogo(undefined);
      toast.success('Company updated', { description: `${jumlahBerubah} field${jumlahBerubah > 1 ? 's' : ''} saved.` });
    } catch (e) {
      toast.error('Failed to update company', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function pilihLogo(file: File | undefined) {
    if (!file) return;
    try {
      setLogo(await fileToLogoDataUrl(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read the image.');
    }
  }

  if (loading && !company) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  }
  if (error && !company) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }
  if (!company) return null;

  const logoTampil = logo !== undefined ? logo : company.logo;
  const health = HEALTH[(company.status ?? '').toLowerCase()];

  return (
    <div className={`space-y-5 ${edit ? 'pb-20' : ''}`}>
      {/* Kartu identitas */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="h-20 bg-gradient-to-r from-blue-600 via-blue-500 to-violet-500" />
        <div className="flex flex-col gap-4 px-6 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="relative -mt-10">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-card bg-slate-100 shadow-md">
                {logoTampil
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logoTampil} alt="Company logo" className="h-full w-full object-contain" />
                  : <span className="text-2xl font-bold text-slate-400">{company.nama_client.slice(0, 1).toUpperCase()}</span>}
              </div>
              {edit && (
                <div className="absolute -bottom-1 -right-1 flex gap-1">
                  <button type="button" onClick={() => fileRef.current?.click()} title="Change logo" className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow ring-2 ring-card hover:bg-blue-800">
                    <Camera size={13} />
                  </button>
                  {logoTampil && (
                    <button type="button" onClick={() => setLogo(null)} title="Remove logo" className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-slate-500 shadow ring-2 ring-card hover:text-red-600">
                      <ImageOff size={13} />
                    </button>
                  )}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { pilihLogo(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <div className="pb-1">
              <h2 className="text-lg font-bold text-foreground">{company.nama_client}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {company.client_code && <span className="font-mono">{company.client_code}</span>}
                {company.industry && <span>· {company.industry}</span>}
                {health && <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${health.cls}`}>{health.label}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {company.edited_at && !edit && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays size={12} /> Updated {fmtTanggal.format(new Date(company.edited_at))}
              </span>
            )}
            {!edit && (
              <button onClick={mulaiEdit} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-800">
                <Pencil size={14} /> Edit company
              </button>
            )}
          </div>
        </div>
      </section>

      {SECTIONS.map(sec => {
        const Icon = sec.icon;
        return (
          <section key={sec.title} className="rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex items-start gap-3 border-b border-border px-6 py-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100"><Icon size={16} /></span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{sec.title}</h3>
                <p className="text-xs text-muted-foreground">{sec.subtitle}</p>
              </div>
            </header>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-3">
              {sec.fields.map(fld => (
                <div key={fld.key} className={fld.span === 3 ? 'sm:col-span-3' : fld.span === 2 ? 'sm:col-span-2' : ''}>
                  {edit ? (
                    <>
                      <label className={labelCls}>{fld.label}{fld.required && <span className="text-red-500"> *</span>}</label>
                      <Input fld={fld} value={form[fld.key] ?? ''} onChange={v => setForm(f => ({ ...f, [fld.key]: v }))} akuntan={akuntan} industries={industries} />
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{fld.label}</p>
                      <div className={`mt-1 text-sm ${fld.mono ? 'font-mono' : ''} text-foreground`}>
                        {tampil(fld, company, akuntan) ?? <span className="text-slate-300">Not set</span>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {edit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-6 py-3">
            <p className="text-xs text-muted-foreground">
              {jumlahBerubah ? <span className="font-medium text-amber-700">{jumlahBerubah} unsaved change{jumlahBerubah > 1 ? 's' : ''}</span> : 'No changes yet'}
              <span className="hidden sm:inline"> · Saving requires Tahap 5 (Partner) access.</span>
            </p>
            <div className="flex items-center gap-2">
              <button onClick={batal} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-slate-50 disabled:opacity-50">
                <X size={14} /> Cancel
              </button>
              <button onClick={simpan} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Input({ fld, value, onChange, akuntan, industries }: { fld: Field; value: string; onChange: (v: string) => void; akuntan: Accountant[]; industries: CoaIndustry[] }) {
  const cls = `${inputCls} ${fld.mono ? 'font-mono' : ''}`;
  switch (fld.type) {
    case 'textarea':
      return <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} placeholder={fld.placeholder} className={`${cls} resize-y`} />;
    case 'date':
      return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={cls} />;
    case 'pkp':
      return (
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {([['', 'Not set'], ['true', 'PKP'], ['false', 'Non-PKP']] as const).map(([v, l]) => (
            <button key={l} type="button" onClick={() => onChange(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${value === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
          ))}
        </div>
      );
    case 'month':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Not set</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          {value && !(Number(value) >= 1 && Number(value) <= 12) && <option value={value}>{value}</option>}
        </select>
      );
    case 'industry':
      // Mengubah industry di sini TIDAK mengubah COA yang sudah ada (template hanya dipakai saat client dibuat).
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Not set</option>
          {industries.map(i => <option key={i.id} value={i.name}>{i.kbli_category} · {i.name}</option>)}
          {value && !industries.some(i => i.name === value) && <option value={value}>{value}</option>}
        </select>
      );
    case 'accountant':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Not assigned</option>
          {akuntan.map(a => <option key={a.id} value={a.id}>{a.name} ({a.username}) · {a.role_label}</option>)}
        </select>
      );
    case 'select': {
      const opsi = fld.options ?? [];
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Not set</option>
          {opsi.map(o => <option key={o} value={o}>{fld.key === 'status' ? HEALTH[o]?.label ?? o : o}</option>)}
          {value && !opsi.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    }
    default:
      return <input type={fld.type === 'email' ? 'email' : 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={fld.placeholder} className={cls} />;
  }
}
