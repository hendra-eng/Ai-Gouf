'use client';

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Layers, Wallet } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { PurchaseCardHeader, MINI_ROW_CLS } from '@/app/transactions/purchase/components/PurchaseKpiTile';

// Kartu "Purchase by Category" & "Payment Status Overview" di tab Overview Purchase.
// Data & angkanya sama seperti sebelumnya (dikirim dari page.tsx); tampilannya memakai tema elegant
// monokrom yang sama dengan Sales Overview: Inter, kartu card-elevated-md, header chip abu, grafik
// biru #2563EB dengan grid putus-putus #ececec & sumbu abu gelap #404040, baris mini berborder abu.

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtAxis = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(n);

const AXIS_BORDER = '#404040';  // sama dengan SALES_AXIS_BORDER
const BAR_COLOR = '#2563EB';    // sama dengan SALES_LINE_COLOR

// Label sumbu kategori: rata kiri, mulai tepat di tepi kiri kartu (x = 0) supaya sejajar dengan
// ikon & judul di header. Posisi x dari Recharts sengaja diabaikan.
function CategoryTick({ y, payload }: { y?: number; payload?: { value: string } }) {
  if (y == null || !payload) return null;
  return (
    <text x={0} y={y} dy={4} textAnchor="start" fontSize={11} fontWeight={500} fill="#525252">{payload.value}</text>
  );
}

// Persen kontribusi: "<1%" bila kecil tapi > 0, supaya tidak tampil 0%.
const fmtShare = (v: number, total: number) => {
  const p = total > 0 ? (v / total) * 100 : 0;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

export function PurchaseCategoryCard({ data }: { data: { name: string; value: number }[] }) {
  const { t } = useLanguage();
  // Tanpa kotak tooltip: nilai & persen selalu tampil di ujung bar. Saat kursor lewat, baris itu
  // disorot (bar lain meredup) -- tetap terbaca tanpa popup yang menutupi grafik.
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  // Lebar area label = nama terpanjang (diukur) + celah ke garis sumbu, jadi tidak ada ruang kosong
  // di kiri dan nama panjang ("Professional Services") tidak terpecah dua baris.
  const yAxisWidth = useMemo(() => {
    if (data.length === 0) return 0;
    let widest = Math.max(...data.map((d) => d.name.length)) * 6.4;
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.font = '500 11px Inter, system-ui, sans-serif';
        widest = Math.max(...data.map((d) => ctx.measureText(d.name).width));
      }
    }
    return Math.ceil(widest) + 14;
  }, [data]);
  const renderValueLabel = (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string; index?: number }) => {
    const x = Number(props.x) + Number(props.width) + 8;
    const y = Number(props.y) + Number(props.height) / 2;
    const v = Number(props.value);
    const dim = hover !== null && hover !== props.index;
    return (
      <text x={x} y={y} dy={4} fontSize={11} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 150ms' }}>
        <tspan fontWeight={600} fill="#171717">{fmt(v)}</tspan>
        <tspan dx={6} fontWeight={500} fill="#8a8a8a">{fmtShare(v, total)}</tspan>
      </text>
    );
  };
  return (
    <div className={`${salesFont.className} card-elevated-md flex h-full flex-col rounded-xl p-5`}>
      <PurchaseCardHeader icon={Layers} title={t('Purchase by Category')} subtitle={t('Spend distribution by category')} />
      {data.length === 0 ? (
        <p className="py-10 text-center text-xs text-neutral-500">{t('Belum ada data.')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 120, left: 0, bottom: 0 }}
            onMouseMove={(st: { activeTooltipIndex?: number }) => setHover(typeof st?.activeTooltipIndex === 'number' ? st.activeTooltipIndex : null)}
            onMouseLeave={() => setHover(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#ececec" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#8a8a8a' }}
              axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
              tickLine={false}
              tickFormatter={(v) => fmtAxis(v)}
            />
            {/* Hanya untuk pita sorot baris & pelacakan indeks hover -- tanpa kotak popup. */}
            <Tooltip content={() => null} cursor={{ fill: '#f5f5f5' }} />
            <Bar dataKey="value" fill={BAR_COLOR} radius={[0, 4, 4, 0]} barSize={16}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={BAR_COLOR} fillOpacity={hover === null || hover === i ? 1 : 0.35} style={{ transition: 'fill-opacity 150ms' }} />
              ))}
              <LabelList dataKey="value" content={renderValueLabel} />
            </Bar>
            {/* Sumbu Y ditaruh SETELAH <Bar>: Recharts menggambar sesuai urutan elemen, jadi garis hitam
                sumbu tampil di atas bar biru (bukan tertimpa). */}
            <YAxis
              type="category"
              dataKey="name"
              tick={(p: { y?: number; payload?: { value: string } }) => <CategoryTick y={p.y} payload={p.payload} />}
              axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
              tickLine={false}
              interval={0}
              width={yAxisWidth}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Kotak AP -- sama dengan kartu KPI (garis aksen hitam tipis, label kapital kecil, angka tabular).
function ApTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
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
    <div className={`${salesFont.className} card-elevated-md flex h-full flex-col rounded-xl p-5`}>
      <PurchaseCardHeader icon={Wallet} title={t('Payment Status Overview')} subtitle={t('AP payment distribution')} />
      <ul className="space-y-2">
        {data.map((item) => {
          const pct = Math.round((item.value / total) * 100);
          return (
            <li key={item.name} className={`${MINI_ROW_CLS} px-3 py-2`}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-medium text-neutral-900">{item.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums text-neutral-900">{item.value}</span>
                  <span className="w-10 rounded-full bg-neutral-100 py-0.5 text-center text-[10px] font-semibold tabular-nums text-neutral-600">{pct}%</span>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(item.value > 0 ? 3 : 0, pct)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-300 pt-4">
        <ApTile label="Overdue AP" value={fmt(overdueAmount)} />
        <ApTile label="Outstanding AP" value={fmt(outstandingAP)} />
      </div>
    </div>
  );
}