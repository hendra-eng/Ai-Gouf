'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useLanguage } from '@/lib/language';
import { getNiceSymmetricTicks, formatAxisValue } from '@/lib/chartTicks';

// Data contoh (juta) -- dipakai kalau komponen tidak diberi prop `data`.
const DEFAULT_CF_MONTHLY: CFMonthlyChartRow[] = [
  { month: 'Jan', operating: 195, investing: -88, financing: -42 },
  { month: 'Feb', operating: 218, investing: -120, financing: -28 },
  { month: 'Mar', operating: 240, investing: -65, financing: -185 },
  { month: 'Apr', operating: 225, investing: -95, financing: 120 },
  { month: 'May', operating: 198, investing: -72, financing: -18 },
  { month: 'Jun', operating: 262, investing: -110, financing: -22 },
  { month: 'Jul', operating: 244, investing: -58, financing: -5 },
  { month: 'Aug', operating: 218, investing: -47, financing: -5 },
];

export interface CFMonthlyChartRow { month: string; operating: number; investing: number; financing: number }

type CFKey = 'operating' | 'investing' | 'financing';

function CustomTooltip({ active, payload, label, t }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; t: (text: string) => string }) {
  if (!active || !payload?.length) return null;
  const net = (payload[0]?.value || 0) + (payload[1]?.value || 0) + (payload[2]?.value || 0);
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-4">
      <p className="text-sm font-bold text-foreground mb-2 pb-2 border-b border-border">{label}</p>
      {payload.map((entry) => (
        <div key={`cftip-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-xs text-muted-foreground">{t(entry.name)}</span>
          </div>
          <span className={`text-xs font-semibold font-mono ${entry.value >= 0 ? 'text-positive' : 'text-negative'}`}>
            {entry.value >= 0 ? '+' : ''}Rp {entry.value.toFixed(0)}Jt
          </span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('Net Cash')}</span>
        <span className={`text-xs font-bold font-mono ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
          {net >= 0 ? '+' : ''}Rp {net.toFixed(0)}Jt
        </span>
      </div>
    </div>
  );
}

const AXIS_WIDTH = 52;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 8; // + margin.left dari BarChart

function getBarColor(key: CFKey) {
  if (key === 'operating') return 'var(--positive)';
  if (key === 'investing') return 'var(--negative)';
  return 'var(--warning)';
}
function getBarOpacity(key: CFKey) {
  if (key === 'operating') return 0.85;
  if (key === 'investing') return 0.75;
  return 0.8;
}

export default function CashFlowChart({ data: cfMonthly = DEFAULT_CF_MONTHLY }: { data?: CFMonthlyChartRow[] }) {
  const { t } = useLanguage();

  // ── Zoom skala harga (drag vertikal di sumbu Y, sama seperti chart lain) ──
  const baseMax = useMemo(
    () => Math.max(1, ...cfMonthly.flatMap((d) => [Math.abs(d.operating), Math.abs(d.investing), Math.abs(d.financing)])) * 1.25,
    [cfMonthly]
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  // Tick "nice" (angka bulat, simetris) untuk label sumbu — domain chart
  // tetap kontinu supaya drag zoom tetap smooth.
  const { ticks: yTicks, step: yStep } = useMemo(
    () => getNiceSymmetricTicks(baseMax / priceZoom, 4),
    [baseMax, priceZoom]
  );
  const yDomain = useMemo<[number, number]>(() => [-baseMax / priceZoom, baseMax / priceZoom], [baseMax, priceZoom]);

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    zoomDragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!zoomDragRef.current) return;
      const deltaY = zoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, zoomDragRef.current.startZoom * factor));
      setPriceZoom(next);
    };
    const onUp = () => {
      zoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetZoom = () => setPriceZoom(1);

  // ── Drag badan bar: tarik ke ATAS -> nilai naik (makin positif), tarik ke
  // BAWAH -> nilai turun (makin negatif). Berlaku sama untuk ketiga kategori;
  // yang membedakan cuma batas clamp-nya: Operating (hijau) dikunci >= 0 saja,
  // Investing (merah) dikunci <= 0 saja, Financing (kuning) bebas dua arah.
  // Lepas -> spring back ke nilai asli. ──
  const [dragBar, setDragBar] = useState<{ key: CFKey; index: number; liveValue: number } | null>(null);
  const dragBarRef = useRef<{
    key: CFKey;
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number;
  } | null>(null);
  const springAnimRef = useRef<number | null>(null);
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const stopSpring = () => {
    if (springAnimRef.current) cancelAnimationFrame(springAnimRef.current);
    springAnimRef.current = null;
  };
  const easeOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);

  const springBack = () => {
    const drag = dragBarRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const duration = 380;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeOutQuint(progress);
      const next = from + (to - from) * eased;
      if (dragBarRef.current) {
        dragBarRef.current = { ...dragBarRef.current, liveValue: next };
        setDragBar({ key: drag.key, index: drag.index, liveValue: next });
      }
      if (progress < 1) {
        springAnimRef.current = requestAnimationFrame(step);
      } else {
        dragBarRef.current = null;
        setDragBar(null);
        springAnimRef.current = null;
      }
    };
    springAnimRef.current = requestAnimationFrame(step);
  };

  const handleBarPointerDown = (key: CFKey, index: number, startValue: number, barHeight: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    const magnitude = Math.abs(startValue);
    let pxPerUnitMagnitude = magnitude !== 0 ? barHeight / magnitude : -1;
    if (!Number.isFinite(pxPerUnitMagnitude) || pxPerUnitMagnitude <= 0) {
      const [dMin, dMax] = yDomainRef.current;
      pxPerUnitMagnitude = 226 / (dMax - dMin || 1);
    }
    // pxPerUnit NEGATIF -> formula next = startValue + deltaY/pxPerUnit berarti
    // drag ke atas (deltaY negatif) menaikkan nilai, drag ke bawah menurunkan.
    const pxPerUnit = -pxPerUnitMagnitude;
    dragBarRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setDragBar({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragBarRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [dMin, dMax] = yDomainRef.current;
      const clampMax = dMax * 1.4;
      const clampMin = dMin * 1.4;
      let next = drag.startValue + deltaY / drag.pxPerUnit;
      if (drag.key === 'operating') next = Math.max(0, Math.min(clampMax, next));
      else if (drag.key === 'investing') next = Math.min(0, Math.max(clampMin, next));
      else next = Math.max(clampMin, Math.min(clampMax, next));
      dragBarRef.current = { ...drag, liveValue: next };
      setDragBar({ key: drag.key, index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (dragBarRef.current) springBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, []);

  // Data yang benar-benar dikirim ke chart: sama seperti cfMonthly, kecuali
  // satu bar (bulan + kategori) yang sedang ditarik/spring-back diganti nilai live-nya.
  const displayData = useMemo(() => {
    if (!dragBar) return cfMonthly;
    return cfMonthly.map((d, i) => (i === dragBar.index ? { ...d, [dragBar.key]: dragBar.liveValue } : d));
  }, [dragBar, cfMonthly]);

  // Badan bar custom: seluruh kotak bisa digenggam & ditarik naik/turun (bukan cuma strip tipis)
  // Untuk nilai negatif (Investing), Recharts kadang mengirim `height` negatif
  // (y = titik bawah, height = jarak ke atas) -- jadi harus di-normalisasi
  // pakai Math.abs + geser y, bukan di-clamp ke 0 (itu yang bikin bar hilang).
  const renderInteractiveBar = (key: CFKey) => (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragBar?.key === key && dragBar?.index === index;
    const color = getBarColor(key);
    const opacity = getBarOpacity(key);
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    return (
      <g>
        <rect
          x={x}
          y={rectY}
          width={width}
          height={h}
          fill={color}
          fillOpacity={opacity}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(key, index, payload[key], h)}
        />
        {/* Perluas area genggam di atas & bawah, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={rectY - 10}
          width={width}
          height={h + 20}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(key, index, payload[key], h)}
        />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={displayData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barSize={20} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            ticks={yTicks}
            tickFormatter={(v) => formatAxisValue(v, yStep, 'Jt', 1)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
            width={AXIS_WIDTH}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip t={t} />} cursor={false} offset={40} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-plus-jakarta-sans)', paddingTop: 12 }}
            formatter={(value: string) => t(value)}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
          <Bar dataKey="operating" name="Operating" fill={getBarColor('operating')} shape={renderInteractiveBar('operating') as any} isAnimationActive={!dragBar} />
          <Bar dataKey="investing" name="Investing" fill={getBarColor('investing')} shape={renderInteractiveBar('investing') as any} isAnimationActive={!dragBar} />
          <Bar dataKey="financing" name="Financing" fill={getBarColor('financing')} shape={renderInteractiveBar('financing') as any} isAnimationActive={!dragBar} />
        </BarChart>
      </ResponsiveContainer>
      {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
      <div
        onMouseDown={handleAxisMouseDown}
        onDoubleClick={resetZoom}
        title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: AXIS_OVERLAY_WIDTH }}
      />
    </div>
  );
}