'use client';

// [BARU] Sambungkan panel "AI Performance Insights" di halaman Profit & Loss
// ke tabel insight client aktif:
//   ..._profit and loss_finance_insights (schema 3_Financial)
//   -> GET /api/client/{id}/pl-insights (ambilPlInsights di
//      agent-ai/lib/api.js) -> dbc.daftar_pl_insights().
// Hanya baris dengan modul = "profit_loss" yang diambil (default backend).
// Bentuk hasil = props `insights` milik AIInsightsPanel. Kalau client belum
// punya insight (atau request gagal), hasilnya array kosong.

import { useEffect, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilPlInsights } from '@/app/agent-ai/lib/api';

export interface PLInsight {
  id: number;
  title: string;
  description: string;
  metric: string;
  severity: 'positive' | 'negative' | 'warning' | 'neutral';
}

export function usePLInsights(): { loading: boolean; insights: PLInsight[] } {
  const { activeClientId, hydrated } = useActiveClient();
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<PLInsight[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    if (!activeClientId) {
      setInsights([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ambilPlInsights(activeClientId, 'profit_loss')
      .then((res: any) => {
        if (cancelled) return;
        const data: any[] = Array.isArray(res?.insights) ? res.insights : [];
        setInsights(
          data.map((r) => ({
            id: Number(r.id),
            title: String(r.title ?? ''),
            description: String(r.description ?? ''),
            metric: String(r.metric ?? ''),
            severity: (['positive', 'negative', 'warning', 'neutral'].includes(r.severity) ? r.severity : 'neutral') as PLInsight['severity'],
          }))
        );
      })
      .catch(() => { if (!cancelled) setInsights([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrated, activeClientId]);

  return { loading, insights };
}