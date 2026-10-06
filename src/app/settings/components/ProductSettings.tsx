'use client';

// Settings > Product (goods & services):
// - Basic setting: tabel master Product category & Product unit (nama + amount
//   manual). Search + pagination 20/hal dikerjakan backend; add/edit lewat
//   pop-up, delete = soft delete (settings_v1.py, migration 28).
// - Subfeature settings: checkbox stock info & product variant (upsert).
// Semua simpan/hapus butuh Tahap 5, sama seperti tab Company/Purchase.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Boxes, ChevronLeft, ChevronRight, Loader2, Package, Pencil, Plus, Ruler, Save, Search, Tags, ToggleLeft, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  createProductMaster, deleteProductMaster, fetchProductMaster, fetchProductSetting, saveProductSetting, updateProductMaster,
  useLoader, type Paged, type ProductMasterItem, type ProductMasterKind, type ProductSetting, type ProductSettingInput,
} from '@/lib/settingsStore';

const PAGE_SIZE = 20;

const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2.5 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelCls = 'block text-xs font-semibold text-foreground mb-1.5';

const fmtAmount = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

export default function ProductSettings() {
  const { activeClientId } = useActiveClient();

  if (!activeClientId) {
    return <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Select a company to configure product settings.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-primary ring-1 ring-blue-100"><Package size={18} /></span>
        <div>
          <h2 className="text-base font-bold text-foreground">Goods &amp; Services</h2>
          <p className="text-xs text-muted-foreground">Master data and optional features for products.</p>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Basic setting</h3>
        <div className="grid grid-cols-1 gap-5">
          <MasterTable key={`cat-${activeClientId}`} clientId={activeClientId} kind="categories" title="Product category" column="Product category" icon={Tags} />
          <MasterTable key={`unit-${activeClientId}`} clientId={activeClientId} kind="units" title="Product unit" column="Unit" icon={Ruler} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Subfeature settings</h3>
        <SubfeatureSettings clientId={activeClientId} />
      </div>
    </div>
  );
}

// ── Tabel master (category / unit) ─────────────────────────────────────────

type Modal = { mode: 'add' } | { mode: 'edit'; item: ProductMasterItem } | { mode: 'delete'; item: ProductMasterItem } | null;

function MasterTable({ clientId, kind, title, column, icon: Icon }: {
  clientId: string; kind: ProductMasterKind; title: string; column: string; icon: React.ElementType;
}) {
  const [search, setSearch] = useState('');
  const [cari, setCari] = useState(''); // search yang sudah di-debounce
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ProductMasterItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState<Modal>(null);

  useEffect(() => {
    const t = setTimeout(() => { setCari(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let batal = false;
    setLoading(true);
    fetchProductMaster(kind, clientId, { search: cari, page, pageSize: PAGE_SIZE })
      .then(d => {
        if (batal) return;
        // Halaman terakhir kosong setelah hapus -> mundur 1 halaman.
        if (d.items.length === 0 && d.total > 0 && page > 1) setPage(Math.ceil(d.total / PAGE_SIZE));
        else { setData(d); setError(null); }
      })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load data.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [kind, clientId, cari, page, tick]);

  const refresh = () => setTick(t => t + 1);
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const totalPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dari = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const sampai = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100"><Icon size={16} /></span>
          <div>
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-xs text-muted-foreground">{total} {total === 1 ? 'entry' : 'entries'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${column.toLowerCase()}…`}
              className="w-full rounded-xl border border-border bg-slate-50 py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-slate-400 focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-foreground" aria-label="Clear search"><X size={13} /></button>}
          </div>
          <button onClick={() => setModal({ mode: 'add' })} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800">
            <Plus size={14} /> Add
          </button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="w-12 px-5 py-3">#</th>
              <th className="px-4 py-3">{column}</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="w-28 px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={4} className="px-5 py-4"><div className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${50 + i * 12}%` }} /></td></tr>
              ))
            ) : error ? (
              <tr><td colSpan={4} className="py-12 text-center text-sm text-red-600">{error}</td></tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12">
                  <div className="flex flex-col items-center text-center">
                    <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Boxes size={18} /></span>
                    <p className="text-sm font-semibold text-foreground">{cari ? `No matching ${column.toLowerCase()}` : `No ${column.toLowerCase()} yet`}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{cari ? 'Try another keyword.' : 'Click "Add" to create the first one.'}</p>
                  </div>
                </td>
              </tr>
            ) : items.map((it, i) => (
              <tr key={it.id} className={`transition-colors hover:bg-slate-50 ${loading ? 'opacity-60' : ''}`}>
                <td className="px-5 py-2.5 tabular-nums text-slate-400">{dari + i}</td>
                <td className="px-4 py-2.5 font-medium text-foreground">{it.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmtAmount.format(it.amount)}</td>
                <td className="px-5 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModal({ mode: 'edit', item: it })} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-700"><Pencil size={14} /></button>
                    <button onClick={() => setModal({ mode: 'delete', item: it })} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>Showing <span className="font-medium text-foreground">{dari}–{sampai}</span> of <span className="font-medium text-foreground">{total}</span></span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-slate-50 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span className="px-2 tabular-nums">Page {page} / {totalPage}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPage || loading} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-slate-50 disabled:opacity-40" aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        </footer>
      )}

      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <FormModal
          title={modal.mode === 'add' ? `Add ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
          column={column}
          awal={modal.mode === 'edit' ? modal.item : null}
          onClose={() => setModal(null)}
          onSubmit={async v => {
            if (modal.mode === 'edit') await updateProductMaster(kind, modal.item.id, v);
            else await createProductMaster(kind, clientId, v);
            toast.success(`${title} ${modal.mode === 'edit' ? 'updated' : 'added'}`);
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal?.mode === 'delete' && (
        <DeleteModal
          title={`Delete ${title.toLowerCase()}?`}
          name={modal.item.name}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await deleteProductMaster(kind, modal.item.id);
            toast.success(`${title} deleted`);
            setModal(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">{children}</div>
    </div>
  );
}

function FormModal({ title, column, awal, onClose, onSubmit }: {
  title: string; column: string; awal: ProductMasterItem | null; onClose: () => void;
  onSubmit: (v: { name: string; amount: number }) => Promise<void>;
}) {
  const [name, setName] = useState(awal?.name ?? '');
  const [amount, setAmount] = useState(awal ? String(awal.amount) : '0');
  const [saving, setSaving] = useState(false);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const nama = name.trim();
    const nilai = Number(amount || 0);
    if (!nama) { toast.error(`${column} is required.`); return; }
    if (!Number.isFinite(nilai) || nilai < 0) { toast.error('Amount must be a number ≥ 0.'); return; }
    setSaving(true);
    try {
      await onSubmit({ name: nama, amount: Math.round(nilai * 100) / 100 });
    } catch (err) {
      toast.error('Failed to save', { description: err instanceof Error ? err.message : undefined });
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={kirim}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div>
            <label className={labelCls}>{column} <span className="text-red-500">*</span></label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={150} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Amount</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} tabular-nums`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function DeleteModal({ title, name, onClose, onConfirm }: { title: string; name: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function hapus() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      toast.error('Failed to delete', { description: err instanceof Error ? err.message : undefined });
      setBusy(false);
    }
  }
  return (
    <Overlay onClose={onClose}>
      <div className="px-5 py-5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground"><span className="font-medium text-foreground">{name}</span> will be removed from this company.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <button onClick={onClose} disabled={busy} className="h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-slate-50 disabled:opacity-50">Cancel</button>
        <button onClick={hapus} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
        </button>
      </div>
    </Overlay>
  );
}

// ── Subfeature settings ────────────────────────────────────────────────────

const FLAGS: { key: keyof ProductSettingInput; label: string; hint: string }[] = [
  { key: 'stock_info_on_sales_purchases', label: 'Stock info on sales & purchases', hint: 'Show available stock when picking products on sales and purchase forms.' },
  { key: 'product_variant', label: 'Product variant', hint: 'Allow products to have variants (e.g. size, color).' },
];

function SubfeatureSettings({ clientId }: { clientId: string }) {
  const { data: setting, setData, loading, error } = useLoader<ProductSetting | null>(clientId, fetchProductSetting, null);
  const [form, setForm] = useState<ProductSettingInput | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(setting ? { stock_info_on_sales_purchases: setting.stock_info_on_sales_purchases, product_variant: setting.product_variant } : null);
  }, [setting]);

  const berubah = !!form && !!setting && FLAGS.some(f => form[f.key] !== setting[f.key]);

  async function simpan() {
    if (!form || saving) return;
    setSaving(true);
    try {
      setData(await saveProductSetting(clientId, form));
      toast.success('Product subfeatures saved');
    } catch (e) {
      toast.error('Failed to save product subfeatures', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100"><ToggleLeft size={16} /></span>
        <div>
          <h4 className="text-sm font-semibold text-foreground">Product features</h4>
          <p className="text-xs text-muted-foreground">Turn optional product features on or off.</p>
        </div>
      </header>
      <div className="px-5 py-4">
        {loading && !setting ? (
          <div className="space-y-3">{FLAGS.map(f => <div key={f.key} className="h-9 animate-pulse rounded bg-slate-100" />)}</div>
        ) : error && !setting ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : form && (
          <div className="divide-y divide-border">
            {FLAGS.map(f => (
              <label key={f.key} className="flex cursor-pointer items-start gap-3 py-3 first:pt-0 last:pb-0">
                <input
                  type="checkbox"
                  checked={form[f.key]}
                  onChange={e => setForm(v => (v ? { ...v, [f.key]: e.target.checked } : v))}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{f.label}</span>
                  <span className="block text-xs text-muted-foreground">{f.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {berubah ? <span className="font-medium text-amber-700">Unsaved changes</span> : 'Saving requires Tahap 5 (Partner) access.'}
        </p>
        <button onClick={simpan} disabled={saving || !form || (setting?.exists && !berubah)} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </div>
    </section>
  );
}
