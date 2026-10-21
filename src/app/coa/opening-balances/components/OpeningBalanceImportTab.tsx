'use client';

// Tab "Import Data" di editor saldo awal: 5 modul import data onboarding klien
// (COA legacy + saldo non-subledger, AR, AP, persediaan, aset tetap).
// Upload -> backend memvalidasi & menyimpan 1 batch -> user dibawa ke halaman
// review batch (submit -> approve/reject). Tombol "Monitor" membuka riwayat
// batch per modul. Semua template dibuat server (dropdown dari data klien).
// Download Template & Import butuh setup modul itu lengkap (backend mengirim
// missing_mappings + setup) -> kalau belum, tampilkan dialog info + link ke
// Settings > Account Mapping atau Fixed Assets > Categories (modul asset);
// backend juga menolak, kode MAPPING_REQUIRED.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, Clock, CloudUpload, FileText, History, Info, Layers, Loader2, X } from 'lucide-react';
import type { OpeningBalanceDetail } from '@/lib/openingBalanceStore';
import {
  downloadImportTemplate,
  fetchImportOverview,
  uploadImportFile,
  type ImportModule,
  type ImportModuleSummary,
} from '@/lib/openingBalanceImportStore';
import { BatchStatusBadge, IMPORT_MODULE_META, type ImportModuleMeta } from './importUi';

const fmtPeriode = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

export default function OpeningBalanceImportTab({ ob, clientName }: { ob: OpeningBalanceDetail; clientName: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<ImportModule | null>(null);
  const [sibuk, setSibuk] = useState<{ module: ImportModule; jenis: 'upload' | 'template' } | null>(null);
  const [ringkasan, setRingkasan] = useState<ImportModuleSummary[] | null>(null);
  const [infoMapping, setInfoMapping] = useState<{ mod: ImportModuleMeta; kurang: string[]; setup: ImportModuleSummary['setup'] } | null>(null);

  const muat = useCallback(() => {
    fetchImportOverview(ob.id)
      .then(d => setRingkasan(d.modules))
      .catch(e => toast.error(e instanceof Error ? e.message : 'Failed to load import status.'));
  }, [ob.id]);

  useEffect(() => { muat(); }, [muat]);

  const ringkasanOf = (k: ImportModule) => ringkasan?.find(m => m.module === k) ?? null;
  const total = IMPORT_MODULE_META.length;
  const imported = ringkasan?.filter(m => m.latest?.status === 'approved').length ?? 0;
  const draft = ob.status === 'draft';

  const [y, m] = ob.as_of_date.slice(0, 7).split('-').map(Number);
  const periode = fmtPeriode.format(new Date(y, m - 1, 1));

  // true = Account Mapping modul belum lengkap -> dialog info ditampilkan.
  const cekMapping = (mod: ImportModuleMeta) => {
    const r = ringkasanOf(mod.key);
    const kurang = r?.missing_mappings ?? [];
    if (r && kurang.length > 0) setInfoMapping({ mod, kurang, setup: r.setup });
    return kurang.length > 0;
  };

  const pilihFile = (k: ImportModule) => {
    const mod = IMPORT_MODULE_META.find(x => x.key === k);
    if (mod && cekMapping(mod)) return;
    setTarget(k);
    fileRef.current?.click();
  };

  async function unggah(f: File) {
    const k = target;
    if (!k) return;
    setSibuk({ module: k, jenis: 'upload' });
    try {
      const b = await uploadImportFile(ob.id, k, f);
      if (b.blocking_issues.length > 0) {
        toast.warning('File uploaded with errors', { description: b.blocking_issues.join(' ') });
      } else {
        toast.success('File uploaded and validated', { description: `${b.total_rows} row${b.total_rows === 1 ? '' : 's'} ready for review.` });
      }
      router.push(`/coa/opening-balances/${ob.id}/imports/${k}/${b.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.');
      muat();
    } finally {
      setSibuk(null);
      setTarget(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function unduhTemplate(mod: ImportModuleMeta) {
    if (cekMapping(mod)) return;
    setSibuk({ module: mod.key, jenis: 'template' });
    try {
      await downloadImportTemplate(ob.id, mod.key);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to download the template.');
    } finally {
      setSibuk(null);
    }
  }

  const fieldCls = 'flex h-10 w-full items-center rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-sm';

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => e.target.files?.[0] && unggah(e.target.files[0])} />

      {/* Judul + konteks client/period (terkunci ke set saldo awal ini) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Opening Balance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Import opening data and templates for new client onboarding.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(240px,1fr)_180px]">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Client</p>
            <div className={fieldCls} title="Fixed to this opening balance set"><span className="truncate uppercase">{clientName || '—'}</span></div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Period</p>
            <div className={fieldCls} title="Cut-off month of this opening balance set">{periode}</div>
          </div>
        </div>
      </div>

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {([
          ['Total Modules', total, Layers, 'bg-sky-50 text-sky-600'],
          ['Imported', imported, CheckCircle2, 'bg-emerald-50 text-emerald-600'],
          ['Pending', total - imported, Clock, 'bg-amber-50 text-amber-600'],
          ['Reconciled', 0, BarChart3, 'bg-violet-50 text-violet-600'],
        ] as const).map(([label, val, Icon, cls]) => (
          <div key={label} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${cls}`}><Icon size={26} /></div>
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{ringkasan ? val : '–'}</p>
            </div>
          </div>
        ))}
      </div>

      {!draft && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <Info size={16} className="shrink-0 text-amber-600" />
          This opening balance is {ob.status}. Uploads are disabled — use Revise on the Detail tab to import new data.
        </div>
      )}

      {/* Daftar modul import */}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {IMPORT_MODULE_META.map(mod => {
          const r = ringkasanOf(mod.key);
          const Icon = mod.icon;
          const latest = r?.latest ?? null;
          return (
            <div key={mod.key} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{mod.no}</span>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${mod.iconCls}`}><Icon size={20} /></div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{mod.title}</p>
                  <p className="text-xs text-muted-foreground">{mod.desc}</p>
                  {!!r?.missing_mappings.length && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                      <AlertTriangle size={12} /> Setup required ({r.setup.label}): {r.missing_mappings.join(', ')}
                    </p>
                  )}
                  {latest && (
                    <Link href={`/coa/opening-balances/${ob.id}/imports/${mod.key}/${latest.id}`} className="mt-0.5 block truncate text-[11px] font-medium text-sky-700 hover:underline">
                      {latest.file_name} · {latest.total_rows} row{latest.total_rows === 1 ? '' : 's'}
                      {latest.error_rows > 0 && ` · ${latest.error_rows} error${latest.error_rows === 1 ? '' : 's'}`}
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 lg:justify-end">
                {ringkasan ? <BatchStatusBadge batch={latest} className="w-36" /> : <span className="w-36" />}
                <button
                  onClick={() => pilihFile(mod.key)}
                  disabled={!!sibuk || !draft}
                  title={draft ? undefined : 'Opening balance is not in draft'}
                  className="flex h-10 w-28 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:opacity-50"
                >
                  {sibuk?.module === mod.key && sibuk.jenis === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />} Import
                </button>
                <button
                  onClick={() => unduhTemplate(mod)}
                  disabled={!!sibuk}
                  className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  {sibuk?.module === mod.key && sibuk.jenis === 'template' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} Download Template
                </button>
                <Link
                  href={`/coa/opening-balances/${ob.id}/imports/${mod.key}`}
                  title="Import history & approval"
                  className="relative flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50"
                >
                  <History size={16} /> Monitor
                  {!!r?.pending_approval && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                      {r.pending_approval}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {infoMapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setInfoMapping(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><AlertTriangle size={18} /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">Setup required</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Before using <span className="font-medium text-foreground">{infoMapping.mod.title}</span>, complete the following in{' '}
                  <span className="font-medium text-foreground">{infoMapping.setup.label}</span>:
                </p>
                <ul className="mt-3 space-y-1.5">
                  {infoMapping.kurang.map(k => (
                    <li key={k} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {k}
                    </li>
                  ))}
                </ul>
              </div>
              <button onClick={() => setInfoMapping(null)} title="Close" className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setInfoMapping(null)} className="h-9 rounded-xl border border-border px-4 text-sm font-medium hover:bg-slate-50">Close</button>
              <Link href={infoMapping.setup.href} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-blue-800">
                Go to {infoMapping.setup.label.split(' > ').pop()} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3.5">
        <Info size={18} className="shrink-0 text-sky-600" />
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-sky-800">Recommended sequence:</span> COA &amp; non-subledger first, then AR, AP, Inventory, and Fixed Assets.
        </p>
      </div>
    </div>
  );
}
