'use client';

// [BARU] Sambungkan bagian "Cash Flow Forecast" (grafik) & "Projected Cash
// Position" (tabel) di halaman Cash Flow ke tabel proyeksi client aktif:
//   ..._Cash Flow_cash_flow_forecast (schema 3_Financial)
//   -> GET /api/client/{id}/cash-flow-forecast (ambilCashFlowForecast di
//      agent-ai/lib/api.js) -> dbc.daftar_cash_flow_forecast().
// Pola koneksinya sama dengan useCashFlowData.ts: baca `activeClientId`
// dari context global, fetch dari backend. Backend mengirim Rupiah penuh;
// di sini dibagi 1 juta (satuan "Jt") supaya sejajar dengan CF_MONTHLY &
// fungsi fx() di cash-flow/page.tsx.
// Kalau client belum punya baris proyeksi (atau request gagal), hasilnya
// array kosong -- halaman tetap tampil, hanya tanpa bagian proyeksi.
//
// [DIUBAH -- cache lewat TanStack Query] Sama seperti useProfitLossData.ts
// & usePLInsights.ts: fetch di-cache 60 detik supaya buka-ulang halaman
// Cash Flow tidak fetch ulang dari nol tiap kali.

import { useQuery } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { ambilCashFlowForecast } from '@/app/agent-ai/lib/api';

export interface CFForecastRow {
  month: string;   // mis. "Sep 2026" -- sama dengan format CF_FORECAST lama
  tahun: number;
  bulan: number;   // 1..12
  beginCash: number; operatingCF: number; investingCF: number;
  financingCF: number; netChange: number; endCash: number;
  isForecast: true;
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function jutaan(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

async function fetchCashFlowForecast(clientId: string): Promise<CFForecastRow[]> {
  const res: any = await ambilCashFlowForecast(clientId);
  const data: any[] = Array.isArray(res?.forecast) ? res.forecast : [];
  return data.map((r) => ({
    month: `${NAMA_BULAN[(r.bulan || 1) - 1] || `Bulan ${r.bulan}`} ${r.tahun}`,
    tahun: Number(r.tahun),
    bulan: Number(r.bulan),
    beginCash: jutaan(r.begin_cash),
    operatingCF: jutaan(r.operating_cf),
    investingCF: jutaan(r.investing_cf),
    financingCF: jutaan(r.financing_cf),
    netChange: jutaan(r.net_change),
    endCash: jutaan(r.end_cash),
    isForecast: true as const,
  }));
}

export function useCashFlowForecast(): { loading: boolean; CF_FORECAST: CFForecastRow[] } {
  const { activeClientId, hydrated } = useActiveClient();

  const query = useQuery({
    queryKey: ['cash-flow-forecast', activeClientId],
    queryFn: () => fetchCashFlowForecast(activeClientId as string),
    enabled: hydrated && !!activeClientId,
    staleTime: 60 * 1000,
  });

  return {
    loading: !hydrated || (!!activeClientId && query.isPending),
    CF_FORECAST: activeClientId ? query.data ?? [] : [],
  };
}