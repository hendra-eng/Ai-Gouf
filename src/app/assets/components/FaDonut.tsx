'use client';

// Donut + legenda untuk halaman Fixed Assets (Assets by Category, Disposal by Reason).
// Desain & interaksinya meniru donut "Purchase Status" di halaman Purchase
// (transactions/purchase/components/PurchaseOverviewCharts.tsx > PurchaseStatusDonutCard),
// tetapi tata letaknya tetap landscape: donut di kiri, legenda di kanan.
//   - klik segmen / baris legenda -> segmen membesar, yang lain meredup, callout di tengah
//   - hover segmen -> sedikit lebih terang
//   - tarik garis pemisah putih -> preview "what-if" (angka legenda ikut berubah) + kembali halus saat dilepas
//   - persen satu desimal yang dijamin berjumlah 100,0% (pembulatan dibagi bersama)
//   - font Inter (salesFont), legenda ber-pill persen abu-abu, baris aktif berlatar abu muda

import React, { useEffect, useMemo, useState } from 'react';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import { allocatePcts, largestRemainder, pctLabel } from '@/app/transactions/bank-cash/components/salesStyleKit';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

export interface FaDonutItem {
  key: string;
  name: string;
  value: number;
  color: string;
}

// Palet donut yang sama dengan kartu donut Sales/Purchase (BreakdownDonutCard); slate = "Others".
export const FA_DONUT_COLORS = ['#2563EB', '#0EA5E9', '#6366F1', '#14B8A6', '#F59E0B', '#EC4899', '#8B5CF6', '#EF4444'];
export const FA_DONUT_OTHERS_COLOR = '#CBD5E1';

export default function FaDonut({
  items, centerLabel, centerSubLabel, formatLegend, formatCallout, integer = false, size = 192, valueClass = '', emptyText = 'No data yet.',
}: {
  items: FaDonutItem[];
  centerLabel?: string;
  centerSubLabel?: string;
  /** Nilai di baris legenda (mis. rupiah penuh atau jumlah). */
  formatLegend: (value: number, index: number) => string;
  /** Nilai kecil di dalam callout tengah donut; default sama dengan legenda. */
  formatCallout?: (value: number, index: number) => string;
  /** Nilai berupa hitungan bulat (mis. jumlah aset) -> dibulatkan bersama supaya jumlahnya pas. */
  integer?: boolean;
  /** Sisi donut dalam px (kotak persegi). */
  size?: number;
  /** Kelas tambahan untuk kolom nilai di legenda (mis. lebar minimum). */
  valueClass?: string;
  emptyText?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);
  const total = useMemo(() => items.reduce((s, d) => s + Math.abs(d.value), 0), [items]);

  // Jumlah segmen bisa berubah -> reset pilihan.
  useEffect(() => { setActive(null); }, [items.length]);

  // Angka yang tampil: nilai asli, atau nilai preview saat garis pemisah ditarik -- dibulatkan
  // bersama supaya persen = 100,0% dan (untuk hitungan) jumlah = total.
  const shownValues = useMemo(() => (live ? live.map(p => p.value) : items.map(d => d.value)), [live, items]);
  const shownTotal = useMemo(() => shownValues.reduce((a, b) => a + b, 0), [shownValues]);
  const shownPcts = useMemo(() => {
    if (shownValues.some(v => v < 0)) {
      const abs = shownValues.reduce((a, b) => a + Math.abs(b), 0);
      return shownValues.map(v => (abs > 0 ? Math.round((v / abs) * 1000) / 10 : 0));
    }
    return allocatePcts(shownValues);
  }, [shownValues]);
  const shownCounts = useMemo(
    () => (shownValues.every(v => v >= 0) ? largestRemainder(shownValues, Math.round(shownTotal)) : shownValues.map(Math.round)),
    [shownValues, shownTotal],
  );
  const toggle = (i: number) => setActive(prev => (prev === i ? null : i));
  const legendValue = (i: number) => (integer ? shownCounts[i] ?? 0 : shownValues[i] ?? 0);
  const callout = formatCallout ?? formatLegend;

  return (
    <div className={`${salesFont.className} flex flex-col items-center gap-3 px-5 pb-5 sm:flex-row`}>
      <div className="shrink-0" style={{ width: size, height: size }}>
        <InteractiveDonutChart
          data={items}
          height={size}
          centerLabel={centerLabel}
          centerSubLabel={centerSubLabel}
          activeIndex={active}
          onActiveChange={setActive}
          onLiveChange={setLive}
          rawValue
          minVisibleDeg={5}
          formatValue={(v, i) => callout(integer ? shownCounts[i] ?? Math.round(v) : v, i)}
          formatPct={(p, i) => pctLabel(shownPcts[i] ?? p, shownValues[i] ?? 1)}
        />
      </div>

      <ul className="w-full min-w-0 space-y-0.5 text-[11px]">
        {(items.length === 0 || total <= 0) && <li className="px-1.5 py-1.5 text-muted-foreground">{emptyText}</li>}
        {items.map((a, i) => (
          <li
            key={`legend-${a.key}`}
            onClick={() => toggle(i)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors ${active === i ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className={`min-w-0 flex-1 break-words leading-tight ${active === i ? 'font-bold' : 'font-medium'} text-foreground`}>{a.name}</span>
            <span className={`${valueClass} shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-foreground`}>{formatLegend(legendValue(i), i)}</span>
            <span className="w-9 shrink-0 rounded-full bg-neutral-100 py-0.5 text-center text-[9.5px] font-semibold tabular-nums text-neutral-600">
              {pctLabel(shownPcts[i] ?? 0, shownValues[i] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}