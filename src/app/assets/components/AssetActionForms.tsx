'use client';
// Form aksi yang dipakai FixedAssetRegister.tsx:
//  * AssetForm      -> tambah aset baru / edit aset yang ada (mode ditentukan lewat prop `asset`)
//  * DisposeAssetForm -> tandai aset sebagai disposed (permanen)
import React, { useState } from 'react';
import { toast } from 'sonner';
import type { AddAssetInput, RegisterAsset, UpdateAssetInput } from '../lib/assetRegisterBridge';

const inputCls =
  'w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const CATEGORY_SUGGESTIONS = [
  'Vehicles', 'Warehouse Equipment', 'Computer Equipment', 'IT Equipment',
  'Furniture & Fixtures', 'Equipment', 'Buildings', 'Land',
];

// ─── Tambah / Edit aset ─────────────────────────────────────────────────────
interface AssetFormProps {
  /** Diisi -> mode edit (prefill dari aset ini). Kosong -> mode tambah baru. */
  asset?: RegisterAsset | null;
  onSave: (input: AddAssetInput | UpdateAssetInput) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}

export function AssetForm({ asset, onSave, onDone, onCancel }: AssetFormProps) {
  const isEdit = !!asset;
  const [name, setName] = useState(asset?.name || '');
  const [category, setCategory] = useState(asset?.category || CATEGORY_SUGGESTIONS[0]);
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDateISO || todayISO());
  const [cost, setCost] = useState(asset ? String(asset.cost) : '');
  const [residualValue, setResidualValue] = useState(asset ? String(asset.residualValue) : '0');
  const [usefulLifeYears, setUsefulLifeYears] = useState(asset?.usefulLifeYears != null ? String(asset.usefulLifeYears) : '');
  const [method, setMethod] = useState<'Straight-line' | 'Declining-balance'>(asset?.method || 'Straight-line');
  const [location, setLocation] = useState(asset?.location && asset.location !== '—' ? asset.location : '');
  const [department, setDepartment] = useState(asset?.department && asset.department !== '—' ? asset.department : '');
  const [saving, setSaving] = useState(false);

  const simpan = async () => {
    const nama = name.trim();
    if (!nama) { toast.error('Nama aset tidak boleh kosong'); return; }
    const nominal = Number(cost);
    if (!Number.isFinite(nominal) || nominal < 0) { toast.error('Cost harus angka >= 0'); return; }
    const residu = Number(residualValue || 0);
    if (!Number.isFinite(residu) || residu < 0) { toast.error('Residual value harus angka >= 0'); return; }
    if (residu > nominal) { toast.error('Residual value tidak boleh melebihi cost'); return; }
    const umur = usefulLifeYears ? Number(usefulLifeYears) : undefined;
    if (usefulLifeYears && (!Number.isInteger(umur) || (umur as number) <= 0)) {
      toast.error('Useful life harus bilangan bulat tahun > 0');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: nama,
        category: category.trim() || undefined,
        purchase_date: purchaseDate || undefined,
        cost: nominal,
        residual_value: residu,
        useful_life_years: umur,
        depreciation_method: method,
        location: location.trim() || undefined,
        department: department.trim() || undefined,
      });
      toast.success(isEdit ? `${nama} berhasil diperbarui` : `${nama} ditambahkan ke register`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan aset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-lg shadow-card-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground mb-4">{isEdit ? `Edit Asset — ${asset?.id}` : 'Add Asset'}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Asset Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="mis. Toyota Avanza Operasional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} list="asset-category-suggestions" className={inputCls} />
              <datalist id="asset-category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Purchase Date</label>
              <input type="date" value={purchaseDate} max={todayISO()} onChange={(e) => setPurchaseDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Cost (IDR)</label>
              <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Residual Value (IDR)</label>
              <input type="number" min={0} value={residualValue} onChange={(e) => setResidualValue(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Useful Life (years)</label>
              <input type="number" min={1} step={1} value={usefulLifeYears} onChange={(e) => setUsefulLifeYears(e.target.value)} className={inputCls} placeholder="mis. 8" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Depreciation Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputCls}>
                <option value="Straight-line">Straight-line</option>
                <option value="Declining-balance">Declining-balance</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="mis. Denpasar" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Department</label>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls} placeholder="mis. Operasional" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={simpan}
              disabled={saving}
              className="flex-1 bg-primary text-white text-sm font-medium rounded-md py-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? 'Menyimpan…' : isEdit ? 'Save Changes' : 'Add Asset'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-4 text-sm font-medium text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dispose aset ───────────────────────────────────────────────────────────
interface DisposeAssetFormProps {
  asset: RegisterAsset;
  onDispose: (disposalDate: string, disposalValue: number) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}

export function DisposeAssetForm({ asset, onDispose, onDone, onCancel }: DisposeAssetFormProps) {
  const [disposalDate, setDisposalDate] = useState(todayISO());
  const [disposalValue, setDisposalValue] = useState('0');
  const [saving, setSaving] = useState(false);

  const simpan = async () => {
    const nilai = Number(disposalValue || 0);
    if (!Number.isFinite(nilai) || nilai < 0) { toast.error('Disposal value harus angka >= 0'); return; }
    if (!disposalDate) { toast.error('Pilih tanggal disposal'); return; }
    setSaving(true);
    try {
      await onDispose(disposalDate, nilai);
      toast.success(`${asset.name} ditandai disposed`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menandai aset sebagai disposed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-lg shadow-card-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground mb-1">Dispose Asset</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {asset.id} — {asset.name}. Tindakan ini permanen, tidak bisa dibatalkan lewat halaman ini.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Disposal Date</label>
            <input type="date" value={disposalDate} max={todayISO()} onChange={(e) => setDisposalDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Disposal Value (IDR)</label>
            <input type="number" min={0} value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={simpan}
              disabled={saving}
              className="flex-1 bg-danger text-white text-sm font-medium rounded-md py-2 hover:bg-danger/90 transition-colors disabled:opacity-60"
            >
              {saving ? 'Menyimpan…' : 'Confirm Dispose'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-4 text-sm font-medium text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}