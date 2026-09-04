'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import FinancialStatusBadge from '@/components/ui/FinancialStatusBadge';
import { useCurrency } from '@/lib/currency';
import { formatIDR } from '@/lib/financialData';
import { useAssetRegisterData } from '../lib/assetRegisterBridge';

// Data contoh -- dipakai HANYA kalau client aktif belum pernah upload file
// "Aset Tetap" (lihat lib/assetRegisterBridge.ts, isSampleData).
const SAMPLE_FIXED_ASSETS = [
  { id: 'FA-2024-001', name: 'Gedung Kantor Jakarta', category: 'Property', purchaseDate: '15 Mar 2020', cost: 'Rp 850M', usefulLife: '20 yr', method: 'Straight-line', accDepr: '(Rp 170M)', nbv: 'Rp 680M', status: 'active' as const, location: 'Jakarta HQ', dept: 'Operations' },
  { id: 'FA-2024-002', name: 'Server Dell PowerEdge R750', category: 'IT Equipment', purchaseDate: '10 Jan 2023', cost: 'Rp 180M', usefulLife: '5 yr', method: 'Straight-line', accDepr: '(Rp 54M)', nbv: 'Rp 126M', status: 'active' as const, location: 'Data Center', dept: 'IT' },
  { id: 'FA-2024-003', name: 'Toyota Fortuner 2022', category: 'Vehicles', purchaseDate: '20 Apr 2022', cost: 'Rp 520M', usefulLife: '8 yr', method: 'Declining Balance', accDepr: '(Rp 97.5M)', nbv: 'Rp 422.5M', status: 'active' as const, location: 'Jakarta HQ', dept: 'Management' },
  { id: 'FA-2024-004', name: 'Laptop MacBook Pro M3', category: 'Computer Equipment', purchaseDate: '05 Jun 2023', cost: 'Rp 28M', usefulLife: '4 yr', method: 'Straight-line', accDepr: '(Rp 9.8M)', nbv: 'Rp 18.2M', status: 'active' as const, location: 'Jakarta HQ', dept: 'Engineering' },
  { id: 'FA-2024-005', name: 'Mesin Produksi CNC-X200', category: 'Equipment', purchaseDate: '12 Nov 2019', cost: 'Rp 320M', usefulLife: '10 yr', method: 'Straight-line', accDepr: '(Rp 214M)', nbv: 'Rp 106M', status: 'maintenance' as const, location: 'Surabaya Plant', dept: 'Production' },
  { id: 'FA-2024-006', name: 'AC Central Office Floor 3', category: 'Office Equipment', purchaseDate: '18 Feb 2018', cost: 'Rp 45M', usefulLife: '8 yr', method: 'Straight-line', accDepr: '(Rp 45M)', nbv: 'Rp 0', status: 'fully-depreciated' as const, location: 'Jakarta HQ', dept: 'Facilities' },
  { id: 'FA-2024-007', name: 'Honda CRV 2021', category: 'Vehicles', purchaseDate: '30 Jul 2021', cost: 'Rp 480M', usefulLife: '8 yr', method: 'Declining Balance', accDepr: '(Rp 110M)', nbv: 'Rp 370M', status: 'active' as const, location: 'Bandung', dept: 'Sales' },
  { id: 'FA-2024-008', name: 'Software ERP License', category: 'Intangible Assets', purchaseDate: '01 Jan 2024', cost: 'Rp 230M', usefulLife: '5 yr', method: 'Straight-line', accDepr: '(Rp 46M)', nbv: 'Rp 184M', status: 'active' as const, location: 'All Offices', dept: 'IT' },
  { id: 'FA-2024-009', name: 'Forklift Mitsubishi FD30', category: 'Equipment', purchaseDate: '22 Sep 2020', cost: 'Rp 210M', usefulLife: '10 yr', method: 'Straight-line', accDepr: '(Rp 84M)', nbv: 'Rp 126M', status: 'active' as const, location: 'Surabaya Warehouse', dept: 'Logistics' },
  { id: 'FA-2024-010', name: 'Printer Xerox C8000', category: 'Office Equipment', purchaseDate: '14 May 2021', cost: 'Rp 32M', usefulLife: '5 yr', method: 'Straight-line', accDepr: '(Rp 22.4M)', nbv: 'Rp 9.6M', status: 'active' as const, location: 'Jakarta HQ', dept: 'Admin' },
  { id: 'FA-2024-011', name: 'Mesin Offset Heidelberg', category: 'Equipment', purchaseDate: '05 Mar 2016', cost: 'Rp 580M', usefulLife: '10 yr', method: 'Straight-line', accDepr: '(Rp 580M)', nbv: 'Rp 0', status: 'disposed' as const, location: 'Medan', dept: 'Production' },
  { id: 'FA-2024-012', name: 'CCTV System 48 kamera', category: 'Security Equipment', purchaseDate: '08 Aug 2022', cost: 'Rp 65M', usefulLife: '5 yr', method: 'Straight-line', accDepr: '(Rp 26M)', nbv: 'Rp 39M', status: 'active' as const, location: 'All Offices', dept: 'Security' },
];

interface DisplayRow {
  id: string; name: string; category: string; purchaseDate: string; cost: string;
  usefulLife: string; method: string; accDepr: string; nbv: string;
  status: 'active' | 'maintenance' | 'fully-depreciated' | 'disposed';
  location: string; dept: string;
}

const columns = ['Asset ID', 'Asset Name', 'Category', 'Purchase Date', 'Cost', 'Useful Life', 'Method', 'Acc. Depr.', 'Net Book Value', 'Status', 'Location', 'Department'];

export default function FixedAssetRegister() {
  const { fx } = useCurrency();
  const registerData = useAssetRegisterData();
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [perPage] = useState(8);

  // Kalau client aktif punya register real (sudah upload file "Aset
  // Tetap"), pakai itu. Kalau belum, jatuh ke data contoh supaya halaman
  // tidak pernah kosong (sama seperti pola bridge lain di dashboard ini).
  const fixedAssets: DisplayRow[] = useMemo(() => {
    if (registerData.isSampleData) return SAMPLE_FIXED_ASSETS;
    return registerData.assets.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      purchaseDate: a.purchaseDate,
      cost: formatIDR(a.cost / 1_000_000, true),
      usefulLife: a.usefulLifeYears != null ? `${a.usefulLifeYears} yr` : '—',
      method: a.method,
      accDepr: a.accumulatedDepreciation > 0 ? `(${formatIDR(a.accumulatedDepreciation / 1_000_000, true)})` : 'Rp 0',
      nbv: formatIDR(a.netBookValue / 1_000_000, true),
      status: a.status,
      location: '—',
      dept: '—',
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
              onClick={() => toast.info('Form tambah aset baru dibuka')}
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
                      onClick={() => toast.info(`Detail aset ${asset.id}: ${asset.name}`)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="View details"
                    >
                      <Icon name="EyeIcon" size={13} className="text-muted-foreground hover:text-foreground" />
                    </button>
                    <button
                      onClick={() => toast.info(`Mengedit aset ${asset.id}`)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="Edit asset"
                    >
                      <Icon name="PencilIcon" size={13} className="text-muted-foreground hover:text-foreground" />
                    </button>
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
    </div>
  );
}
