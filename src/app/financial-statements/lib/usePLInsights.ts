'use client';

// [BARU] Sambungkan panel "AI Performance Insights" di halaman Profit & Loss
// ke tabel insight client aktif:
//   ..._profit and loss_finance_insights (schema 3_Financial)
//   -> GET /api/client/{id}/pl-insights (ambilPlInsights di
//      agent-ai/lib/api.js) -> dbc.daftar_pl_insights().
// Hanya baris dengan modul = "profit_loss" yang diambil (default backend).
// Bentuk hasil = props `insights` milik AIInsightsPanel. Kalau client belum
// punya insight (atau request gagal), hasilnya array kosong.
//
// [DIUBAH -- cache lewat TanStack Query] Sebelumnya hook ini fetch ulang
// dari nol SETIAP KALI halaman P&L di-mount (termasuk pas user cuma
// pindah halaman lain lalu balik lagi). Sekarang pakai useQuery supaya
// hasilnya di-cache 60 detik -- konsisten dengan useProfitLossData.ts,
// biar dua-duanya bareng bikin buka-ulang P&L jadi instan.

import { useQuery } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { ambilPlInsights } from '@/app/agent-ai/lib/api';

export interface PLInsight {
  id: string;
  title: string;
  description: string;
  metric: string;
  severity: 'positive' | 'negative' | 'warning' | 'neutral';
}

async function fetchPlInsights(clientId: string): Promise<PLInsight[]> {
  const res: any = await ambilPlInsights(clientId, 'profit_loss');
  const data: any[] = Array.isArray(res?.insights) ? res.insights : [];
  return data.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    metric: String(r.metric ?? ''),
    severity: (['positive', 'negative', 'warning', 'neutral'].includes(r.severity) ? r.severity : 'neutral') as PLInsight['severity'],
  }));
}

export function usePLInsights(): { loading: boolean; insights: PLInsight[] } {
  const { activeClientId, hydrated } = useActiveClient();

  const query = useQuery({
    queryKey: ['pl-insights', activeClientId],
    queryFn: () => fetchPlInsights(activeClientId as string),
    enabled: hydrated && !!activeClientId,
    staleTime: 60 * 1000,
  });

  return {
    loading: !hydrated || (!!activeClientId && query.isPending),
    insights: activeClientId ? query.data ?? [] : [],
  };
}