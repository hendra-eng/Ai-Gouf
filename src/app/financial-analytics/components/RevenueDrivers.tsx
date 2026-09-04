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
const SAMPLE_DATA: Record<'customer' | 'product', { id: string; name: string; revenue: number; growth: number; contribution: number; previous: number }[]> = {
  customer: [
    { id: 'cust-1', name: 'PT Maju Bersama Digital', revenue: 1_840_000_000, growth: 18.4, contribution: 21.8, previous: 1_554_000_000 },
    { id: 'cust-2', name: 'CV Solusi Teknindo', revenue: 1_240_000_000, growth: 12.2, contribution: 14.7, previous: 1_105_000_000 },
    { id: 'cust-3', name: 'PT Artha Niaga Nusantara', revenue: 980_000_000, growth: 8.6, contribution: 11.6, previous: 902_000_000 },
    { id: 'cust-4', name: 'PT Kreasi Media Utama', revenue: 860_000_000, growth: 22.4, contribution: 10.2, previous: 702_000_000 },
    { id: 'cust-5', name: 'PT Sinergi Inovasi', revenue: 720_000_000, growth: 6.8, contribution: 8.6, previous: 674_000_000 },
    { id: 'cust-6', name: 'CV Mitra Digital Prima', revenue: 580_000_000, growth: -4.2, contribution: 6.9, previous: 605_000_000 },
    { id: 'cust-7', name: 'Others', revenue: 2_200_000_000, growth: 11.4, contribution: 26.2, previous: 1_975_000_000 },
  ],
  product: [
    { id: 'prod-1', name: 'Enterprise Software License', revenue: 3_200_000_000, growth: 16.8, contribution: 38.0, previous: 2_740_000_000 },
    { id: 'prod-2', name: 'Professional Services', revenue: 2_180_000_000, growth: 10.2, contribution: 25.9, previous: 1_978_000_000 },
    { id: 'prod-3', name: 'Cloud & Infrastructure', revenue: 1_420_000_000, growth: 24.6, contribution: 16.9, previous: 1_139_000_000 },
    { id: 'prod-4', name: 'Support & Maintenance', revenue: 980_000_000, growth: 8.4, contribution: 11.6, previous: 904_000_000 },
    { id: 'prod-5', name: 'Training & Certification', revenue: 640_000_000, growth: -2.8, contribution: 7.6, previous: 658_000_000 },
  ],
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
