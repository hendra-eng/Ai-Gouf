'use client';

// Tab Overview (Template UI/Inventory/1.jpeg): KPI, tren nilai persediaan
// (batang nilai + garis qty), komposisi per kategori, top 5 item, stok menipis.

import React from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Boxes, CalendarX, Wallet } from 'lucide-react';
import { fmtMonth, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import { fetchInvOverview, qty, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE, useInvData, type InvOverview } from '@/lib/inventoryStore';
import { Card, EmptyRow } from '@/components/arap/arapUi';
import { KpiGrid, Pill, tableHeadRow, tdCls, thCls } from '@/components/shared/moduleUi';
import type { InvActions } from './InventoryWorkspace';

export const WARNA = ['#0B5E5C', '#0F7D4E', '#86EFAC', '#BBF7D0', '#BFDBFE', '#DBEAFE', '#94A3B8', '#CBD5E1'];

export default function OverviewTab({ clientId, asOf, actions }: { clientId: string; asOf: string; actions: InvActions }) {
  const ov = useInvData<InvOverview | null>(`iov:${clientId}:${asOf}`, s => fetchInvOverview(clientId, asOf, s), null);
  const d = ov.data;
  const k = d?.kpi;
  const loading = ov.loading && !d;
  const total = d?.by_category.reduce((n, c) => n + c.value, 0) ?? 0;

  return (
    <div className="space-y-5">
      {ov.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{ov.error}</div>}
      {d && (k?.warehouses === 0 || k?.categories === 0) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 sm:flex-row sm:items-center sm:justify-between">
          <span>Set up at least one warehouse and the item categories (with inventory / COGS accounts) before recording stock.</span>
          <button type="button" onClick={actions.setup} className="font-semibold underline hover:no-underline">Open setup</button>
        </div>
      )}
      <KpiGrid loading={loading} cards={[
        { label: 'Total Items', value: String(k?.total_items ?? 0), icon: Boxes, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">Active items</span> },
        { label: 'Total Stock Value', value: rupiah(k?.total_value), icon: Wallet, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">At average cost</span> },
        { label: 'Low Stock Items', value: String(k?.low_stock ?? 0), icon: AlertTriangle, tone: 'amber', delta: <span className="text-[11px] text-muted-foreground">Items at or below minimum</span> },
        { label: 'Out of Stock', value: String(k?.out_of_stock ?? 0), icon: CalendarX, tone: 'red', delta: <span className="text-[11px] text-muted-foreground">Items</span> },
      ]} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-7">
        <Card className="xl:col-span-3" title="Inventory Value Trend" subtitle="Month-end stock value and quantity">
          <div className="h-72 px-3 pb-4">
            {loading ? <div className="h-full animate-pulse rounded-xl bg-slate-50" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d?.trend ?? []} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={m => fmtMonth(m).slice(0, 3)} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="v" tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={52} />
                  <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v: number, n: string) => (n === 'Stock Value' ? rupiah(v) : qty(v))} labelFormatter={m => fmtMonth(String(m))} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="v" dataKey="value" name="Stock Value" fill="#0F7D4E" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="q" type="monotone" dataKey="qty" name="Quantity" stroke="#3B82F6" strokeWidth={2} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Inventory by Category">
          <div className="flex flex-col items-center gap-3 px-5 pb-5">
            <div className="relative h-44 w-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d?.by_category ?? []} dataKey="value" nameKey="category" innerRadius={55} outerRadius={82} stroke="none">
                    {(d?.by_category ?? []).map((_, i) => <Cell key={i} fill={WARNA[i % WARNA.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => rupiah(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold">{rupiahShort(total)}</div>
            </div>
            <ul className="w-full space-y-1.5 text-xs">
              {!d?.by_category.length && <li className="text-center text-muted-foreground">No stock yet.</li>}
              {d?.by_category.map((c, i) => (
                <li key={c.category} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: WARNA[i % WARNA.length] }} />
                  <span className="flex-1 truncate">{c.category}</span>
                  <span className="font-medium">{total ? Math.round((c.value / total) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Top 5 Items by Value">
          <table className="w-full text-sm">
            <thead><tr className={tableHeadRow}><th className={thCls}>#</th><th className={thCls}>Item</th><th className={`${thCls} text-right`}>Value</th></tr></thead>
            <tbody className="divide-y divide-border">
              {(loading || !d?.top_items.length) && <EmptyRow cols={3} loading={loading} text="No stock yet." />}
              {d?.top_items.map((i, n) => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.openItem(i.id)}>
                  <td className={tdCls}>{n + 1}</td><td className={tdCls}>{i.name}</td><td className={`${tdCls} text-right`}>{rupiah(i.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Low Stock & Out of Stock" subtitle="Active items at or below their minimum stock">
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Item Code</th><th className={thCls}>Item Name</th><th className={thCls}>Category</th><th className={thCls}>Unit</th>
              <th className={`${thCls} text-right`}>Current Stock</th><th className={`${thCls} text-right`}>Minimum</th><th className={thCls}>Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(loading || !d?.low_stock_items.length) && <EmptyRow cols={7} loading={loading} text="All items are above their minimum stock." />}
              {d?.low_stock_items.map(i => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.openItem(i.id)}>
                  <td className={`${tdCls} font-medium`}>{i.code}</td><td className={tdCls}>{i.name}</td><td className={tdCls}>{i.category ?? '—'}</td>
                  <td className={tdCls}>{i.unit}</td><td className={`${tdCls} text-right`}>{qty(i.qty)}</td><td className={`${tdCls} text-right`}>{qty(i.min_stock)}</td>
                  <td className={tdCls}><Pill label={STOCK_STATUS_LABEL[i.stock_status]} style={STOCK_STATUS_STYLE[i.stock_status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
