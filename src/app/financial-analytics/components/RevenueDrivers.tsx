'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';

type ViewType = 'customer' | 'product' | 'category';

// [PENTING] Tab Customer & Product TETAP data contoh -- backend jurnal/GL
// tidak punya dimensi "per customer" / "per product", sama seperti catatan
// REVENUE_BY_CUSTOMER di useProfitLossData.ts (financial-statements). Hanya
// tab Category yang tersambung ke data client aktif (diturunkan dari
// sub_kategori COA akun PENDAPATAN, sama seperti REVENUE_BY_CATEGORY di P&L).
// Dikosongkan (tidak ada sample customer/product hardcode) — tab ini akan
// menampilkan empty state sampai dimensi per-customer/per-product tersedia
// di backend jurnal/GL.
const SAMPLE_DATA: Record<'customer' | 'product', { id: string; name: string; revenue: number; growth: number; contribution: number; previous: number }[]> = {
  customer: [],
  product: [],
};

export default function RevenueDrivers() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [view, setView] = useState<ViewType>('category');
  const { revenueByCategory, isSampleData } = useAnalyticsData();

  const items: { id: string; name: string; revenue: number; growth: number; contribution: number; previous: number }[] =
    view === 'category'
      ? revenueByCategory.map((c) => ({ id: c.id, name: c.name, revenue: c.current * 1_000_000, growth: c.growth, contribution: c.contribution, previous: c.previous * 1_000_000 }))
      : SAMPLE_DATA[view];
  const maxRevenue = Math.max(1, ...items.map((i) => i.revenue));

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Revenue Drivers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {view === 'category' && !isSampleData ? 'Connected to active client · Click row to drill down' : 'FY 2026 · Click row to drill down'}
            {view !== 'category' && ' (sample data — no per-customer/product dimension in backend yet)'}
          </p>
        </div>
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {(['customer', 'product', 'category'] as ViewType[]).map((v) => (
            <button
              key={`rv-${v}`}
              onClick={() => setView(v)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                v === view ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            No data yet.
          </div>
        )}
        {items.map((item) => {
          const barWidth = (item.revenue / maxRevenue) * 100;
          const isPositive = item.growth >= 0;
          return (
            <div
              key={item.id}
              className="group cursor-pointer rounded-xl p-3 hover:bg-muted/40 transition-colors border border-transparent hover:border-border"
              onClick={() => router?.push('/transactions')}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-medium text-foreground flex-1 truncate">{item.name}</span>
                <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${isPositive ? 'text-positive' : 'text-negative'}`}>
                  {isPositive ? '+' : ''}{item.growth.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 w-12 text-right">{item.contribution.toFixed(1)}%</span>
                <span className="text-sm font-semibold tabular-nums text-foreground flex-shrink-0 w-20 text-right">{fx(formatIDR(item.revenue, true))}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all duration-500"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-2xs text-muted-foreground">Prev: {fx(formatIDR(item.previous, true))}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router?.push('/transactions');
                  }}
                  className="text-2xs text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Drill Down →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}