'use client';

// Tab Overview: KPI, tren persediaan (chart interaktif = Fixed Asset Trend), komposisi per kategori (donut = Assets by Category),
// top 10 item (treemap), stok menipis.

import React, { useMemo } from 'react';
import { AlertTriangle, Boxes, Layers, PackageX, Wallet } from 'lucide-react';
import { rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchInvOverview, fetchInvTrendYear, INVENTORY_EVENT, qty, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE, useInvData, type InvOverview } from '@/lib/inventoryStore';
import { Card } from '@/components/arap/arapUi';
import FaTrendChart, { type FaPointBuilder, type FaSeries } from '@/app/assets/components/FaTrendChart';
import FaDonut, { FA_DONUT_COLORS, FA_DONUT_OTHERS_COLOR, type FaDonutItem } from '@/app/assets/components/FaDonut';
import { InvKpiRow } from './InvKpi';
import InvCategoryInsights from './InvCategoryInsights';
import InvTopTreemap from './InvTopTreemap';
import type { InvActions } from './InventoryWorkspace';
import { faTableCls, faRowClickable, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow } from './InvTable';

// Chart tren (desain & interaksi sama dengan "Fixed Asset Trend"): Stock In & Stock Out (kolom) + Stock Value (garis).
const INV_SERIES: FaSeries[] = [
  { key: 'stock_in', name: 'Stock In', color: '#2563EB', kind: 'bar' },
  { key: 'stock_out', name: 'Stock Out', color: '#DC2626', kind: 'bar' },
  { key: 'value', name: 'Stock Value', color: '#16A34A', kind: 'line', emphasis: true },
];
const invBuild: FaPointBuilder = (i, get) => {
  const m = get(i);
  return { stock_in: m?.stock_in ?? null, stock_out: m?.stock_out ?? null, value: m?.value ?? null };
};

const BULAN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const bulanTahun = (iso: string) => { const [y, m] = iso.split('-').map(Number); return `${BULAN[(m || 1) - 1]} ${y}`; };

export default function OverviewTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: InvActions }) {
  const ov = useInvData<InvOverview | null>(`iov:${clientId}:${asOf}`, s => fetchInvOverview(clientId, asOf, s), null);
  const d = ov.data;
  const k = d?.kpi;
  const loading = ov.loading && !d;
  const total = d?.by_category.reduce((n, c) => n + c.value, 0) ?? 0;
  // Warna donut sama dengan donut Assets/Sales/Purchase; "Uncategorized" memakai warna abu "Others".
  const donutItems = useMemo<FaDonutItem[]>(() => {
    let n = 0;
    return (d?.by_category ?? []).filter(c => c.value !== 0).map(c => ({
      key: c.category, name: c.category, value: c.value,
      color: c.category === 'Uncategorized' ? FA_DONUT_OTHERS_COLOR : FA_DONUT_COLORS[n++ % FA_DONUT_COLORS.length],
    }));
  }, [d?.by_category]);

  return (
    <div className="space-y-5">
      {ov.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ov.error}</div>}
      {d && (k?.warehouses === 0 || k?.categories === 0) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 sm:flex-row sm:items-center sm:justify-between">
          <span>Set up at least one warehouse and the item categories (with inventory / COGS accounts) before recording stock.</span>
          <button type="button" onClick={actions.setup} className="font-semibold underline hover:no-underline">Open setup</button>
        </div>
      )}
      <InvKpiRow loading={loading} cards={[
        { label: 'Total Items', value: String(k?.total_items ?? 0), icon: Boxes, tone: 'blue', note: 'Active items' },
        { label: 'Total Stock Value', value: rupiah(k?.total_value), icon: Wallet, tone: 'emerald', note: 'At average cost' },
        { label: 'Low Stock Items', value: String(k?.low_stock ?? 0), icon: AlertTriangle, tone: 'amber', note: 'Items at or below minimum' },
        { label: 'Out of Stock', value: String(k?.out_of_stock ?? 0), icon: PackageX, tone: 'red', note: 'Items' },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <FaTrendChart className="xl:col-span-3" title="Inventory Trend" clientId={clientId} asOf={asOf} series={INV_SERIES} build={invBuild}
          fetchYear={fetchInvTrendYear} changeEvent={INVENTORY_EVENT} />

        <Card className="flex flex-col xl:col-span-2" title="Inventory by Category" subtitle="By stock value" action={
          <button type="button" onClick={actions.setup} className="inline-flex items-center gap-1 text-xs font-medium text-[#0F7D4E] hover:underline"><Layers size={13} /> Categories</button>
        }>
          <FaDonut items={donutItems} centerLabel={rupiahShort(total)} centerSubLabel="Stock Value" size={168} integer
            formatLegend={v => rupiah(Math.round(v))} formatCallout={v => rupiahShort(v)} emptyText="No stock yet." />
          <InvCategoryInsights data={d} onItems={() => actions.goTab('items')} />
        </Card>
      </div>

      <FaCard title="Top 10 Items by Value" subtitle={d ? `Stock value at end of ${bulanTahun(d.top_month_date)} · colour = change vs end of ${bulanTahun(d.prev_month_date)} · resets on the 1st` : 'Tile size = rank by stock value'} className="space-y-4">
        <InvTopTreemap items={d?.top_items ?? []} topDate={d?.top_month_date} prevDate={d?.prev_month_date} loading={loading} onOpen={actions.openItem} />
      </FaCard>

      <FaCard title="Low Stock & Out of Stock" subtitle="Active items at or below their minimum stock">
        <div className="overflow-x-auto scrollbar-thin">
          <table className={`${faTableCls} min-w-[720px]`}>
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Item Code</th><th className={thCls}>Item Name</th><th className={thCls}>Category</th><th className={thCls}>Unit</th>
              <th className={`${thCls} text-right`}>Current Stock</th><th className={`${thCls} text-right`}>Minimum</th><th className={thCls}>Status</th>
            </tr></thead>
            <tbody>
              {(loading || !d?.low_stock_items.length) && <FaEmptyRow cols={7} loading={loading} text="All items are above their minimum stock." />}
              {d?.low_stock_items.map(i => (
                <tr key={i.id} className={faRowClickable} onClick={() => actions.openItem(i.id)}>
                  <td className={`${tdCls} font-medium text-blue-700`}>{i.code}</td><td className={tdCls}>{i.name}</td><td className={tdCls}>{i.category ?? '—'}</td>
                  <td className={tdCls}>{i.unit}</td><td className={`${tdCls} text-right`}>{qty(i.qty)}</td><td className={`${tdCls} text-right`}>{qty(i.min_stock)}</td>
                  <td className={tdCls}><FaPill label={STOCK_STATUS_LABEL[i.stock_status]} style={STOCK_STATUS_STYLE[i.stock_status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FaCard>
    </div>
  );
}