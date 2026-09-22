'use client';
// ─── JEMBATAN backend (tabel assets_equity_assets_fixed_assets) → Fixed Asset
// Register / Depreciation ────────────────────────────────────────────────
// [FIX] Sebelumnya file ini membaca hasil upload file "Aset Tetap" lewat
// GET /api/client/{client_id}/riwayat (public.hasil, jenis_dokumen ===
// 'aset_tetap'). Sekarang disambungkan ke tabel relasional ASLI
// assets_equity_assets_fixed_assets (schema 4_Assets_Equity) lewat
// GET /api/client/{client_id}/assets (ambilFixedAssets() di api.js ->
// dbc.ambil_fixed_assets() di backend). Akumulasi penyusutan/nilai
// buku/penyusutan bulanan dihitung backend dari cost, residual_value,
// useful_life_years, purchase_date, depreciation_method -- lihat
// db_client.py::ambil_fixed_assets() untuk detail rumusnya (mendukung
// Straight-line & Declining-balance, sesuai constraint kolom
// depreciation_method di Supabase).
//
// Beda dari useAssetsData.ts (yang baca SALDO AKUN neraca lewat
// neracaBridge.ts untuk KPI & grafik total Assets), file ini murni utk
// register PER-UNIT aset (Fixed Asset Register & Depreciation Section).
//
// [Keterbatasan yang SENGAJA dibiarkan]
// Kalau client aktif belum punya baris apapun di
// assets_equity_assets_fixed_assets, hook ini mengembalikan
// isSampleData=true dan tiap komponen jatuh ke data contohnya sendiri
// (fallback bawaan komponen, tidak diubah di sini) -- sama seperti pola
// bridge lain di dashboard ini.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilFixedAssets, tambahFixedAsset, ubahFixedAsset, disposisiFixedAsset } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface RegisterAsset {
  id: string;
  /** UUID asli baris di Supabase -- dipakai utk edit/dispose (`id` di atas
   * adalah asset_code, mis. "FA-SAU-001", cuma utk tampilan). */
  dbId: string;
  name: string;
  category: string;
  purchaseDate: string;
  /** Tanggal pembelian format ISO (YYYY-MM-DD) -- utk prefill form edit (`purchaseDate` di atas sudah diformat utk tampilan). */
  purchaseDateISO: string | null;
  cost: number; // rupiah penuh
  residualValue: number;
  usefulLifeYears: number | null;
  method: 'Straight-line' | 'Declining-balance';
  accumulatedDepreciation: number;
  netBookValue: number;
  monthlyDepreciation: number;
  // Status yang dipakai badge di tabel register -- 'maintenance'/'disposed'
  // dihormati langsung dari kolom `status` di database; 'fully-depreciated'
  // diturunkan dari angka; sisanya 'active'.
  status: 'active' | 'maintenance' | 'fully-depreciated' | 'disposed';
  location: string;
  department: string;
  needsReview: boolean;
}

export interface DepreciationMonthPoint { month: string; amount: number }
export interface NearlyDepreciatedAsset { id: string; name: string; nbv: number; remainingMonths: number; pct: number }
export interface CategoryTotal { name: string; cost: number; accumulatedDepreciation: number }

export interface AssetRegisterData {
  loading: boolean;
  isSampleData: boolean;
  assets: RegisterAsset[];
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  totalMonthlyDepreciation: number;
  monthlyTrend: DepreciationMonthPoint[];
  nearlyDepreciated: NearlyDepreciatedAsset[];
  assetsNearFullDepreciationCount: number;
  categoryBreakdown: CategoryTotal[];
  periodLabel: string;
  refetch: () => void;
  addAsset: (input: AddAssetInput) => Promise<{ id: string; asset_code: string }>;
  updateAsset: (dbId: string, input: UpdateAssetInput) => Promise<void>;
  disposeAsset: (dbId: string, disposalDate: string, disposalValue: number) => Promise<void>;
}

export interface AddAssetInput {
  name: string;
  category?: string;
  purchase_date?: string; // YYYY-MM-DD
  cost: number;
  residual_value?: number;
  useful_life_years?: number;
  depreciation_method?: 'Straight-line' | 'Declining-balance';
  location?: string;
  department?: string;
}

export type UpdateAssetInput = Partial<AddAssetInput> & {
  needs_review?: boolean;
  status?: 'active' | 'maintenance' | 'inactive';
};

function fmtDateLabel(raw: unknown): string {
  if (!raw) return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return isNaN(n) ? 0 : n;
}

// `raw` di sini adalah respons GET /api/client/{id}/assets, bentuknya
// { assets: [...], ada_data: boolean } -- lihat dbc.ambil_fixed_assets().
function buildFromRaw(raw: any): Omit<AssetRegisterData, 'loading' | 'isSampleData' | 'refetch' | 'addAsset' | 'updateAsset' | 'disposeAsset'> {
  const rows: any[] = Array.isArray(raw?.assets) ? raw.assets : [];

  const assets: RegisterAsset[] = rows.map((r) => ({
    id: String(r.id),
    dbId: String(r.dbId || r.id),
    name: String(r.name || '—'),
    category: String(r.category || 'Lainnya'),
    purchaseDate: fmtDateLabel(r.purchaseDate),
    purchaseDateISO: r.purchaseDate ? String(r.purchaseDate).slice(0, 10) : null,
    cost: num(r.cost),
    residualValue: num(r.residualValue),
    usefulLifeYears: r.usefulLifeYears != null ? num(r.usefulLifeYears) : null,
    method: r.method === 'Declining-balance' ? 'Declining-balance' : 'Straight-line',
    accumulatedDepreciation: num(r.accumulatedDepreciation),
    netBookValue: num(r.netBookValue),
    monthlyDepreciation: num(r.monthlyDepreciation),
    status: (['active', 'maintenance', 'fully-depreciated', 'disposed'] as const).includes(r.status)
      ? r.status
      : 'active',
    location: r.location || '—',
    department: r.department || '—',
    needsReview: Boolean(r.needsReview),
  }));

  const totalCost = assets.reduce((s, a) => s + a.cost, 0);
  const totalAccumulatedDepreciation = assets.reduce((s, a) => s + a.accumulatedDepreciation, 0);
  const totalNetBookValue = assets.reduce((s, a) => s + a.netBookValue, 0);
  const totalMonthlyDepreciation = assets.reduce(
    (s, a) => (a.status === 'active' || a.status === 'maintenance' ? s + a.monthlyDepreciation : s), 0,
  );

  // Tren 8 bulan terakhir tahun berjalan: jumlah penyusutan/bulan seluruh
  // aset yang SUDAH diperoleh pada bulan tsb (pendekatan -- pakai angka
  // penyusutan bulanan SAAT INI, bukan rekonstruksi historis per bulan,
  // karena backend tidak menyimpan histori bulanan per aset).
  const now = new Date();
  const monthlyTrend: DepreciationMonthPoint[] = [];
  const monthCount = Math.min(8, now.getMonth() + 1) || 1;
  for (let m = now.getMonth() - monthCount + 1; m <= now.getMonth(); m++) {
    const monthDate = new Date(now.getFullYear(), m, 1);
    let total = 0;
    for (const r of rows) {
      const acqDate = r.purchaseDate ? new Date(String(r.purchaseDate)) : null;
      if (acqDate && !isNaN(acqDate.getTime()) && acqDate <= monthDate) {
        total += num(r.monthlyDepreciation);
      }
    }
    monthlyTrend.push({ month: NAMA_BULAN[monthDate.getMonth()], amount: Math.round((total / 1_000_000) * 100) / 100 });
  }

  // Aset mendekati habis masa manfaat (sisa umur <= 24 bulan berdasar
  // nilai buku / penyusutan bulanan berjalan).
  const nearlyDepreciated: NearlyDepreciatedAsset[] = assets
    .filter((a) => a.status === 'active' && a.monthlyDepreciation > 0)
    .map((a) => {
      const remainingMonths = Math.round(a.netBookValue / a.monthlyDepreciation);
      const pct = a.cost > 0 ? Math.round((a.accumulatedDepreciation / a.cost) * 1000) / 10 : 0;
      return { id: a.id, name: a.name, nbv: a.netBookValue, remainingMonths, pct };
    })
    .filter((a) => a.remainingMonths <= 24)
    .sort((a, b) => a.remainingMonths - b.remainingMonths)
    .slice(0, 8);

  const catMap: Record<string, { cost: number; accum: number }> = {};
  for (const a of assets) {
    if (!catMap[a.category]) catMap[a.category] = { cost: 0, accum: 0 };
    catMap[a.category].cost += a.cost;
    catMap[a.category].accum += a.accumulatedDepreciation;
  }
  const categoryBreakdown: CategoryTotal[] = Object.entries(catMap)
    .map(([name, v]) => ({ name, cost: v.cost, accumulatedDepreciation: v.accum }))
    .sort((a, b) => b.cost - a.cost);

  return {
    assets, totalCost, totalAccumulatedDepreciation, totalNetBookValue, totalMonthlyDepreciation,
    monthlyTrend, nearlyDepreciated, assetsNearFullDepreciationCount: nearlyDepreciated.length,
    categoryBreakdown, periodLabel: `As of ${NAMA_BULAN[now.getMonth()]} ${now.getFullYear()}`,
  };
}

export function useAssetRegisterData(): AssetRegisterData {
  const { activeClientId, hydrated } = useActiveClient();
  // [FIX flash-ke-0] Default true -- lihat penjelasan di useProfitLossData.ts
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState<any | null>(null);
  const requestIdRef = useRef(0);

  const load = () => {
    if (!activeClientId) {
      setRaw(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    ambilFixedAssets(activeClientId)
      .then((res: any) => {
        if (requestIdRef.current !== requestId) return;
        setRaw(res?.ada_data ? res : null);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRaw(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  };

  useEffect(() => {
    if (!hydrated) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeClientId]);

  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  const hasData = raw && Array.isArray(raw.assets) && raw.assets.length > 0;

  const addAsset = async (input: AddAssetInput) => {
    if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
    const res = (await tambahFixedAsset(activeClientId, input)) as { asset: { id: string; asset_code: string } };
    load();
    return res.asset;
  };

  const updateAsset = async (dbId: string, input: UpdateAssetInput) => {
    if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
    await ubahFixedAsset(activeClientId, dbId, input);
    load();
  };

  const disposeAsset = async (dbId: string, disposalDate: string, disposalValue: number) => {
    if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
    await disposisiFixedAsset(activeClientId, dbId, disposalDate, disposalValue);
    load();
  };

  if (!hasData) {
    return {
      loading, isSampleData: true, assets: [], totalCost: 0, totalAccumulatedDepreciation: 0,
      totalNetBookValue: 0, totalMonthlyDepreciation: 0, monthlyTrend: [], nearlyDepreciated: [],
      assetsNearFullDepreciationCount: 0, categoryBreakdown: [], periodLabel: '',
      refetch: load, addAsset, updateAsset, disposeAsset,
    };
  }

  return { loading, isSampleData: false, ...buildFromRaw(raw), refetch: load, addAsset, updateAsset, disposeAsset };
}