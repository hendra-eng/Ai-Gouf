'use client';

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Layers, Wallet } from 'lucide-react';
import { useLanguage } from '@/lib/language';

// Kartu "Purchase by Category" & "Payment Status Overview" di tab Overview Purchase.
// Data & angkanya sama seperti sebelumnya (dikirim dari page.tsx); hanya tampilannya disamakan
// dengan kartu Overview lain: card-elevated-md, header ber-ikon, palet hijau brand, baris
// bar bergaya kartu mini, dan dua kotak AP bergaya KPI (garis aksen + chip ikon).

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtAxis = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(n);

const AXIS_BORDER = '#0E2F26'; // hijau sidebar, sama dengan sumbu chart Tren

function CardHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm ring-1 ring-white">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export function PurchaseCategoryCard({ data }: { data: { name: string; value: number }[] }) {
  const { t } = useLanguage();
  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <CardHeader icon={Layers} title={t('Purchase by Category')} subtitle={t('Spend distribution by category')} />
      {data.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradPurchaseCategory" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#0F7D4E" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
              tickLine={false}
              tickFormatter={(v) => fmtAxis(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
              axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
              tickLine={false}
              width={120}
            />
            <Tooltip
              formatter={(v: number) => [fmt(v), 'Amount']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #A7F3D0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)' }}
              cursor={{ fill: '#ECFDF5' }}
            />
            <Bar dataKey="value" fill="url(#gradPurchaseCategory)" radius={[0, 4, 4, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ApTile({ label, value, tone }: { label: string; value: string; tone: 'danger' | 'warn' }) {
  const c = tone === 'danger'
    ? { strip: 'from-[#F87171] to-[#DC2626]', text: 'text-[#B91C1C]', label: 'text-[#DC2626]', border: 'border-red-300', bg: 'to-[#FEF2F2]' }
    : { strip: 'from-[#FBBF24] to-[#D97706]', text: 'text-[#B45309]', label: 'text-[#B45309]', border: 'border-amber-300', bg: 'to-[#FFFBEB]' };
  return (
    <div className={`relative overflow-hidden rounded-xl border ${c.border} bg-gradient-to-br from-white via-white ${c.bg} p-4 pt-5 shadow-sm`}>
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.strip}`} />
      <p className={`text-[11px] font-extrabold uppercase tracking-wide ${c.label}`}>{label}</p>
      <p className={`mt-1.5 truncate text-lg font-extrabold tabular-nums ${c.text}`} title={value}>{value}</p>
    </div>
  );
}

export function PurchasePaymentStatusCard({ data, overdueAmount, outstandingAP }: {
  data: { name: string; value: number; color: string }[];
  overdueAmount: number;
  outstandingAP: number;
}) {
  const { t } = useLanguage();
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <CardHeader icon={Wallet} title={t('Payment Status Overview')} subtitle={t('AP payment distribution')} />
      <ul className="space-y-2">
        {data.map((item) => {
          const pct = Math.round((item.value / total) * 100);
          return (
            <li key={item.name} className="rounded-[10px] border border-border bg-slate-50/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-[#ECFDF5]/60">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-semibold text-foreground">{item.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-bold tabular-nums text-foreground">{item.value}</span>
                  <span className="w-11 rounded-full bg-slate-100 py-0.5 text-center text-[10px] font-bold tabular-nums text-slate-600">{pct}%</span>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(item.value > 0 ? 3 : 0, pct)}%`, backgroundColor: item.color }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <ApTile label="Overdue AP" value={fmt(overdueAmount)} tone="danger" />
        <ApTile label="Outstanding AP" value={fmt(outstandingAP)} tone="warn" />
      </div>
    </div>
  );
}