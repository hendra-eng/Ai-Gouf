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

import { useEffect, useState } from 'react';
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

export function useCashFlowForecast(): { loading: boolean; CF_FORECAST: CFForecastRow[] } {
  const { activeClientId, hydrated } = useActiveClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CFForecastRow[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    if (!activeClientId) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ambilCashFlowForecast(activeClientId)
      .then((res: any) => {
        if (cancelled) return;
        const data: any[] = Array.isArray(res?.forecast) ? res.forecast : [];
        setRows(
          data.map((r) => ({
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
          }))
        );
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrated, activeClientId]);

  return { loading, CF_FORECAST: rows };
}