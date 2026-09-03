'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const CUSTOMERS = [
  { id: 'ca-1', name: 'PT Maju Bersama Digital', revenue: 1_840_000_000, growth: 18.4, outstandingAR: 240_000_000, collectionRate: 96.8, contribution: 21.8, profitability: 'High', dso: 47 },
  { id: 'ca-2', name: 'CV Solusi Teknindo', revenue: 1_240_000_000, growth: 12.2, outstandingAR: 96_000_000, collectionRate: 94.2, contribution: 14.7, profitability: 'High', dso: 28 },
  { id: 'ca-3', name: 'PT Artha Niaga Nusantara', revenue: 980_000_000, growth: 8.6, outstandingAR: 180_000_000, collectionRate: 88.4, contribution: 11.6, profitability: 'Medium', dso: 67 },
  { id: 'ca-4', name: 'PT Kreasi Media Utama', revenue: 860_000_000, growth: 22.4, outstandingAR: 64_000_000, collectionRate: 97.2, contribution: 10.2, profitability: 'High', dso: 27 },
  { id: 'ca-5', name: 'PT Sinergi Inovasi', revenue: 720_000_000, growth: 6.8, outstandingAR: 124_000_000, collectionRate: 91.8, contribution: 8.6, profitability: 'Medium', dso: 63 },
  { id: 'ca-6', name: 'CV Mitra Digital Prima', revenue: 580_000_000, growth: -4.2, outstandingAR: 380_000_000, collectionRate: 72.4, contribution: 6.9, profitability: 'Low', dso: 239 },
  { id: 'ca-7', name: 'PT Dinamika Solusi', revenue: 460_000_000, growth: 14.8, outstandingAR: 48_000_000, collectionRate: 98.1, contribution: 5.5, profitability: 'High', dso: 38 },
  { id: 'ca-8', name: 'CV Teknologi Andalan', revenue: 380_000_000, growth: 9.2, outstandingAR: 72_000_000, collectionRate: 93.6, contribution: 4.5, profitability: 'Medium', dso: 69 },
];

const PROFITABILITY_STYLES: Record<string, string> = {
  High: 'bg-positive-subtle text-positive',
  Medium: 'bg-warning-subtle text-warning',
  Low: 'bg-negative-subtle text-negative',
};

export default function CustomerAnalytics() {
  const { fx } = useCurrency();
  const [sortKey, setSortKey] = useState<string>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  const filtered = CUSTOMERS.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey as keyof typeof a] as number;
    const bv = b[sortKey as keyof typeof b] as number;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: string }) => (
    <Icon
      name={sortKey === col ? (sortDir === 'desc' ? 'ChevronDownIcon' : 'ChevronUpIcon') : 'ChevronUpDownIcon'}
      size={12}
      className={sortKey === col ? 'text-primary' : 'text-muted-foreground'}
    />
  );

  return (
    <div className="card-base">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Customer Financial Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Revenue contribution, AR health, and collection performance</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Highlight badges */}
          <span className="text-2xs font-medium text-positive bg-positive-subtle px-2 py-1 rounded-full border border-positive/20 hidden md:block">
            Top: PT Maju Bersama Digital
          </span>
          <span className="text-2xs font-medium text-negative bg-negative-subtle px-2 py-1 rounded-full border border-negative/20 hidden md:block">
            High AR: CV Mitra Digital
          </span>
          <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
            <Icon name="MagnifyingGlassIcon" size={14} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers..."
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-32"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-border">
              {[
                { key: 'name', label: 'Customer' },
                { key: 'revenue', label: 'Revenue' },
                { key: 'growth', label: 'Growth' },
                { key: 'outstandingAR', label: 'Outstanding AR' },
                { key: 'collectionRate', label: 'Collection Rate' },
                { key: 'contribution', label: 'Contribution %' },
                { key: 'dso', label: 'DSO' },
                { key: 'profitability', label: 'Profitability' },
              ].map((col) => (
                <th
                  key={`ca-th-${col.key}`}
                  onClick={() => col.key !== 'name' && col.key !== 'profitability' && handleSort(col.key)}
                  className={`px-4 py-3 text-left text-xs font-semibold text-muted-foreground select-none ${
                    col.key !== 'name' && col.key !== 'profitability' ? 'cursor-pointer hover:text-foreground transition-colors' : ''
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.key !== 'name' && col.key !== 'profitability' && <SortIcon col={col.key} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((customer) => {
              const isHighAR = customer.outstandingAR > 200_000_000;
              const isTopGrowth = customer.growth > 20;
              return (
                <tr key={customer.id} className="border-b border-border hover:bg-muted/40 transition-colors group cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-2xs font-bold text-primary">{customer.name.charAt(0)}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{customer.name}</p>
                        {isTopGrowth && <span className="text-2xs text-positive">▲ Fastest Growing</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold tabular-nums text-foreground text-right">{fx(formatIDR(customer.revenue, true))}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-semibold tabular-nums ${customer.growth >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {customer.growth >= 0 ? '+' : ''}{customer.growth.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-semibold tabular-nums ${isHighAR ? 'text-negative' : 'text-foreground'}`}>
                      {fx(formatIDR(customer.outstandingAR, true))}
                    </span>
                    {isHighAR && <Icon name="ExclamationCircleIcon" size={12} className="text-negative inline ml-1" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${customer.collectionRate >= 90 ? 'bg-positive' : customer.collectionRate >= 80 ? 'bg-warning' : 'bg-negative'}`}
                          style={{ width: `${customer.collectionRate}%` }}
                        />
                      </div>
                      <span className={`text-sm font-semibold tabular-nums w-14 ${customer.collectionRate >= 90 ? 'text-positive' : customer.collectionRate >= 80 ? 'text-warning' : 'text-negative'}`}>
                        {customer.collectionRate.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-foreground">{customer.contribution.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-semibold tabular-nums ${customer.dso > 90 ? 'text-negative' : customer.dso > 60 ? 'text-warning' : 'text-positive'}`}>
                      {customer.dso}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-2xs font-semibold px-2 py-1 rounded-full ${PROFITABILITY_STYLES[customer.profitability]}`}>
                      {customer.profitability}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
