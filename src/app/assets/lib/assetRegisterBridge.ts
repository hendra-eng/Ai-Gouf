'use client';
// ─── JEMBATAN backend (hasil proses "Aset Tetap") → Fixed Asset Register / Depreciation ──
// Beda dari useAssetsData.ts (yang cuma baca SALDO AKUN neraca lewat
// neracaBridge.ts), file ini membaca hasil PER-UNIT ASET dari modul
// backend proses_aset_tetap() (lihat backend/akuntansi_ai.py) — sumbernya
// hasil upload file "Aset Tetap" (jenis_dokumen === 'aset_tetap'), diambil
// lewat GET /api/client/{client_id}/riwayat (riwayatHasilClient()), dipakai
// juga oleh Note 7 CALK & rekonsiliasi fiskal PPh Badan.
//
// [Keterbatasan yang SENGAJA dibiarkan best-effort]
// 1) Field "location"/"department" TIDAK ada di backend (bukan bagian dari
//    proses_aset_tetap()) — tidak ditampilkan untuk data real (beda dari
//    versi mock lama yang punya kolom ini).
// 2) "method" backend HANYA garis lurus (PSAK 16) — tidak ada opsi saldo
//    menurun seperti di data contoh.
// 3) Status fisik aset ('active'/'maintenance'/'disposed') tidak dilacak
//    backend (itu proses akuntansi, bukan manajemen aset fisik) — hanya
//    dibedakan 'active' vs 'fully-depreciated' berdasarkan nilai buku vs
//    nilai residu.
// 4) Kalau client belum pernah upload file "Aset Tetap", hook ini
//    mengembalikan isSampleData=true dan tiap komponen jatuh ke data
//    contohnya sendiri (fallback bawaan komponen, tidak diubah di sini).

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { riwayatHasilClient } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface RegisterAsset {
  id: string;
  name: string;
  category: string;
  purchaseDate: string;
  cost: number; // rupiah penuh
  usefulLifeYears: number | null;
  method: 'Straight-line';
  accumulatedDepreciation: number;
  netBookValue: number;
  monthlyDepreciation: number;
  status: 'active' | 'fully-depreciated';
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
}

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

function buildFromRaw(raw: any): Omit<AssetRegisterData, 'loading' | 'isSampleData'> {
  const rows: any[] = Array.isArray(raw?.df) ? raw.df : [];

  const assets: RegisterAsset[] = rows.map((r, i) => {
    const cost = num(r.harga_perolehan);
    const nilaiResidu = num(r.nilai_residu);
    const nbv = num(r.nilai_buku_seharusnya ?? cost);
    const accum = num(r.akumulasi_penyusutan_seharusnya);
    const monthlyDep = num(r.penyusutan_per_bulan);
    const isFullyDepreciated = monthlyDep > 0 && nbv <= nilaiResidu + 1;
    return {
      id: String(r.kode_aset || `FA-${i + 1}`),
      name: String(r.nama_aset || `Aset ${i + 1}`),
      category: String(r.kategori || 'Lainnya'),
      purchaseDate: fmtDateLabel(r.tanggal_perolehan),
      cost,
      usefulLifeYears: r.masa_manfaat_tahun != null ? num(r.masa_manfaat_tahun) : null,
      method: 'Straight-line',
      accumulatedDepreciation: accum,
      netBookValue: nbv,
      monthlyDepreciation: monthlyDep,
      status: isFullyDepreciated ? 'fully-depreciated' : 'active',
      needsReview: r.status === 'PERLU REVIEW',
    };
  });

  const totalCost = assets.reduce((s, a) => s + a.cost, 0);
  const totalAccumulatedDepreciation = assets.reduce((s, a) => s + a.accumulatedDepreciation, 0);
  const totalNetBookValue = assets.reduce((s, a) => s + a.netBookValue, 0);
  const totalMonthlyDepreciation = assets.reduce((s, a) => (a.status === 'active' ? s + a.monthlyDepreciation : s), 0);

  // Tren 8 bulan terakhir tahun berjalan: jumlah penyusutan/bulan seluruh
  // aset yang SUDAH diperoleh pada bulan tsb (aset yang dibeli belakangan
  // baru mulai kontribusi sejak bulan perolehannya).
  const now = new Date();
  const monthlyTrend: DepreciationMonthPoint[] = [];
  const monthCount = Math.min(8, now.getMonth() + 1) || 1;
  for (let m = now.getMonth() - monthCount + 1; m <= now.getMonth(); m++) {
    const monthDate = new Date(now.getFullYear(), m, 1);
    let total = 0;
    for (const r of rows) {
      const acqDate = r.tanggal_perolehan ? new Date(String(r.tanggal_perolehan)) : null;
      if (acqDate && !isNaN(acqDate.getTime()) && acqDate <= monthDate) {
        total += num(r.penyusutan_per_bulan);
      }
    }
    monthlyTrend.push({ month: NAMA_BULAN[monthDate.getMonth()], amount: Math.round((total / 1_000_000) * 100) / 100 });
  }

  // Aset mendekati habis masa manfaat (nilai buku < 25% dari nilai
  // penyusutan penuh, atau sisa < 24 bulan berdasar sisa nilai buku / penyusutan bulanan).
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
  const { activeClientId } = useActiveClient();
  const [loading, setLoading] = useState(false);
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
    riwayatHasilClient(activeClientId)
      .then((res: any) => {
        if (requestIdRef.current !== requestId) return;
        const list = ((res?.riwayat || []) as any[]).filter((r) => r.jenis_dokumen === 'aset_tetap');
        if (list.length === 0) {
          setRaw(null);
          return;
        }
        list.sort((a, b) => new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime());
        setRaw(list[0].hasil);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRaw(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  const hasData = raw && Array.isArray(raw.df) && raw.df.length > 0;

  if (!hasData) {
    return {
      loading, isSampleData: true, assets: [], totalCost: 0, totalAccumulatedDepreciation: 0,
      totalNetBookValue: 0, totalMonthlyDepreciation: 0, monthlyTrend: [], nearlyDepreciated: [],
      assetsNearFullDepreciationCount: 0, categoryBreakdown: [], periodLabel: '',
    };
  }

  return { loading, isSampleData: false, ...buildFromRaw(raw) };
}
