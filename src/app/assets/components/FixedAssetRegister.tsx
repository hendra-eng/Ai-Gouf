'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import { useCurrency } from '@/lib/currency';
import { formatIDR } from '@/lib/financialData';
import { useAssetRegisterData } from '../lib/assetRegisterBridge';
import { AssetForm, DisposeAssetForm } from './AssetActionForms';

interface DisplayRow {
  id: string; dbId: string; name: string; category: string; purchaseDate: string; cost: string;
  usefulLife: string; method: string; accDepr: string; nbv: string;
  status: 'active' | 'maintenance' | 'fully-depreciated' | 'disposed';
  location: string; dept: string;
  rawCost: number; rawResidual: number; rawUsefulLife: number | null; rawMethod: string;
  rawCategory: string; rawLocation: string; rawDept: string; rawPurchaseDate: string;
}

// [UBAH] Data contoh dikosongkan -- kalau client aktif belum pernah upload
// file "Aset Tetap" (lihat lib/assetRegisterBridge.ts, isSampleData), tabel
// ini akan tampil kosong (0 baris) sampai data asli tersedia.
const SAMPLE_FIXED_ASSETS: DisplayRow[] = [];

const columns = ['Asset ID', 'Asset Name', 'Category', 'Purchase Date', 'Cost', 'Useful Life', 'Method', 'Acc. Depr.', 'Net Book Value', 'Status', 'Location', 'Department'];

export default function FixedAssetRegister() {
  const { fx } = useCurrency();
  const registerData = useAssetRegisterData();
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [perPage] = useState(8);
  const [addOpen, setAddOpen] = useState(false);
  const [editingDbId, setEditingDbId] = useState<string | null>(null);
  const [disposingDbId, setDisposingDbId] = useState<string | null>(null);

  const editingAsset = editingDbId ? registerData.assets.find((a) => a.dbId === editingDbId) || null : null;
  const disposingAsset = disposingDbId ? registerData.assets.find((a) => a.dbId === disposingDbId) || null : null;

  // Kalau client aktif punya register real (sudah upload file "Aset
  // Tetap"), pakai itu. Kalau belum, jatuh ke data contoh supaya halaman
  // tidak pernah kosong (sama seperti pola bridge lain di dashboard ini).
  const fixedAssets: DisplayRow[] = useMemo(() => {
    if (registerData.isSampleData) return SAMPLE_FIXED_ASSETS;
    return registerData.assets.map((a) => ({
      id: a.id,
      dbId: a.dbId,
      name: a.name,
      category: a.category,
      purchaseDate: a.purchaseDate,
      cost: formatIDR(a.cost / 1_000_000, true),
      usefulLife: a.usefulLifeYears != null ? `${a.usefulLifeYears} yr` : '—',
      method: a.method,
      accDepr: a.accumulatedDepreciation > 0 ? `(${formatIDR(a.accumulatedDepreciation / 1_000_000, true)})` : 'Rp 0',
      nbv: formatIDR(a.netBookValue / 1_000_000, true),
      status: a.status,
      location: a.location,
      dept: a.department,
      rawCost: a.cost,
      rawResidual: a.residualValue,
      rawUsefulLife: a.usefulLifeYears,
      rawMethod: a.method,
      rawCategory: a.category,
      rawLocation: a.location,
      rawDept: a.department,
      rawPurchaseDate: a.purchaseDateISO || '',
    }));
  }, [registerData]);

  const filtered = fixedAssets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.id.toLowerCase().includes(search.toLowerCase()) ||
    a.category.toLowerCase().includes(search.toLowerCase())
  );

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  return (
    <div className="fin-card mb-6">
      <div className="p-5 border-b border-border">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[14px] font-600 text-foreground">Fixed Asset Register</div>
            <div className="text-[11px] text-muted-foreground">Complete register of company fixed assets and depreciation</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon name="MagnifyingGlassIcon" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search assets..."
                className="pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:border-primary/50 w-48"
              />
            </div>
            <button
              onClick={() => toast.info('Filter aset', { description: 'Filter lanjutan berdasarkan kategori, status, dan lokasi' })}
              className="fin-btn-secondary flex items-center gap-1.5 text-[12px]"
            >
              <Icon name="FunnelIcon" size={13} />
              Filter
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="fin-btn-primary flex items-center gap-1.5 text-[12px]"
            >
              <Icon name="PlusIcon" size={13} />
              Add Asset
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map(col => (
                <th
                  key={`col-${col}`}
                  onClick={() => handleSort(col.toLowerCase())}
                  className="text-left px-4 py-3 font-600 text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground select-none"
                >
                  <span className="flex items-center gap-1">
                    {col}
                    <Icon name="ChevronUpDownIcon" size={11} className="text-muted-foreground/50" />
                  </span>
                </th>
              ))}
              <th className="text-left px-4 py-3 font-600 text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(asset => (
              <tr key={`asset-row-${asset.id}`} className="border-b border-border hover:bg-muted/30 transition-colors group">
                <td className="px-4 py-3 font-500 text-primary whitespace-nowrap">{asset.id}</td>
                <td className="px-4 py-3 text-foreground font-500 max-w-[180px]">
                  <div className="truncate" title={asset.name}>{asset.name}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.category}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.purchaseDate}</td>
                <td className="px-4 py-3 font-500 text-foreground financial-value whitespace-nowrap">{fx(asset.cost)}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.usefulLife}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.method}</td>
                <td className="px-4 py-3 text-negative font-500 financial-value whitespace-nowrap">{fx(asset.accDepr)}</td>
                <td className="px-4 py-3 font-600 text-foreground financial-value whitespace-nowrap">{fx(asset.nbv)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <FinancialStatusBadge variant={asset.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.location}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{asset.dept}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingDbId(asset.dbId)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="Edit asset"
                      disabled={registerData.isSampleData}
                    >
                      <Icon name="PencilIcon" size={13} className="text-muted-foreground hover:text-foreground" />
                    </button>
                    {asset.status !== 'disposed' && (
                      <button
                        onClick={() => setDisposingDbId(asset.dbId)}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Dispose asset"
                        disabled={registerData.isSampleData}
                      >
                        <Icon name="TrashIcon" size={13} className="text-muted-foreground hover:text-danger" />
                      </button>
                    )}
                    <button
                      onClick={() => toast.info(`Membuka journal entry untuk ${asset.id}`)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="View journal entry"
                    >
                      <Icon name="DocumentTextIcon" size={13} className="text-muted-foreground hover:text-primary" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} assets
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name="ChevronLeftIcon" size={13} className="text-muted-foreground" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={`page-${p}`}
              onClick={() => setPage(p)}
              className={`w-7 h-7 rounded text-[11px] font-500 transition-colors ${p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name="ChevronRightIcon" size={13} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {addOpen && (
        <AssetForm
          onSave={(input) => registerData.addAsset(input as Parameters<typeof registerData.addAsset>[0])}
          onDone={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      )}
      {editingAsset && (
        <AssetForm
          asset={editingAsset}
          onSave={(input) => registerData.updateAsset(editingAsset.dbId, input)}
          onDone={() => setEditingDbId(null)}
          onCancel={() => setEditingDbId(null)}
        />
      )}
      {disposingAsset && (
        <DisposeAssetForm
          asset={disposingAsset}
          onDispose={(date, value) => registerData.disposeAsset(disposingAsset.dbId, date, value)}
          onDone={() => setDisposingDbId(null)}
          onCancel={() => setDisposingDbId(null)}
        />
      )}
    </div>
  );
}