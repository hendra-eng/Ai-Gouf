'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCurrency } from '@/lib/currency';
import { formatIDR } from '@/lib/financialData';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import { useAssetRegisterData } from '../lib/assetRegisterBridge';

// Spring-back setelah drag bar dilepas — pola & durasi sama persis dengan
// chart lain (Equity Movement, PL Waterfall, Debt Maturity, dst).
const DEPR_SPRING_DURATION_MS = 420;
const deprEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// [UBAH] Data contoh dikosongkan -- HANYA dipakai kalau client aktif belum
// upload file "Aset Tetap". Semua nilai 0 / array kosong sampai ada data asli.
const SAMPLE_MONTHLY_DEPRECIATION = [
  { month: 'Jan', amount: 0 },
  { month: 'Feb', amount: 0 },
  { month: 'Mar', amount: 0 },
  { month: 'Apr', amount: 0 },
  { month: 'May', amount: 0 },
  { month: 'Jun', amount: 0 },
  { month: 'Jul', amount: 0 },
  { month: 'Aug', amount: 0 },
];

const SAMPLE_NEARLY_DEPRECIATED: { id: string; name: string; nbv: string; remaining: string; pct: number }[] = [];

const SAMPLE_SUMMARY_STATS = [
  { label: 'Depreciation This Period', value: 'Rp 0', sub: '' },
  { label: 'Accumulated Depreciation', value: 'Rp 0', sub: 'All fixed assets' },
  { label: 'Remaining Book Value', value: 'Rp 0', sub: 'Net book value' },
  { label: 'Assets Near Full Depr.', value: '0 assets', sub: 'Within 24 months' },
];

export default function DepreciationSection() {
  const { fx } = useCurrency();
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  const registerData = useAssetRegisterData();

  const monthlyDepreciation = registerData.isSampleData ? SAMPLE_MONTHLY_DEPRECIATION : registerData.monthlyTrend;

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — pola sama persis dengan
  // Debt Maturity Profile / Financial Overview. Tarik naik/turun di area
  // label sumbu Y buat zoom in/out skala, double-click buat reset. ──
  const baseMax = useMemo(
    () => Math.max(0, ...monthlyDepreciation.map((d) => d.amount)) * 1.15 || 1,
    [monthlyDepreciation]
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: yTicks } = useMemo(
    () => getNiceTicksFromZero(baseMax / priceZoom, 5),
    [baseMax, priceZoom]
  );
  const yDomain = useMemo<[number, number]>(
    () => [0, baseMax / priceZoom],
    [baseMax, priceZoom]
  );

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

  // ── Fitur 2: Drag badan bar (preview realtime, spring-back saat dilepas) —
  // pola sama persis dengan Debt Maturity Profile / PL Waterfall. Bar tidak
  // stacked & selalu positif (anchor di bawah/nol), jadi arahnya satu: tarik
  // ATAS = nilai makin besar. ──
  const [barDrag, setBarDrag] = useState<{ index: number; liveValue: number } | null>(null);
  const barDragRef = useRef<{
    index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
  } | null>(null);
  const barAnimRef = useRef<number | null>(null);

  const stopBarSpring = () => {
    if (barAnimRef.current) cancelAnimationFrame(barAnimRef.current);
    barAnimRef.current = null;
  };

  const barSpringBack = useCallback(() => {
    const drag = barDragRef.current;
    if (!drag) return;
    stopBarSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / DEPR_SPRING_DURATION_MS);
      const eased = deprEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (barDragRef.current) barDragRef.current.liveValue = next;
      setBarDrag({ index, liveValue: next });
      if (elapsed < 1) {
        barAnimRef.current = requestAnimationFrame(step);
      } else {
        barDragRef.current = null;
        barAnimRef.current = null;
        setBarDrag(null);
      }
    };
    barAnimRef.current = requestAnimationFrame(step);
  }, []);

  // Data yang benar-benar dikirim ke chart: sama seperti monthlyDepreciation,
  // kecuali satu bar yang sedang ditarik/spring-back diganti nilai live-nya.
  // Data asli (props/registerData) TIDAK pernah dimutasi.
  const monthlyDisplayData = useMemo(() => {
    if (!barDrag) return monthlyDepreciation;
    return monthlyDepreciation.map((d, i) => (i === barDrag.index ? { ...d, amount: barDrag.liveValue } : d));
  }, [monthlyDepreciation, barDrag]);

  // Reset drag & zoom kalau data berubah (mis. ganti client aktif) — index
  // bar & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopBarSpring();
    barDragRef.current = null;
    setBarDrag(null);
    setPriceZoom(1);
  }, [monthlyDepreciation]);

  const handleBarPointerDown = (index: number, startValue: number, barHeight: number) => (
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    stopBarSpring();
    let pxPerUnit = startValue !== 0 ? -barHeight / startValue : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    barDragRef.current = { index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setBarDrag({ index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = barDragRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const maxValue = (baseMax / priceZoom) * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setBarDrag({ index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (barDragRef.current) barSpringBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [barSpringBack, baseMax, priceZoom]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik, plus
  // overlay transparan di atas biar area genggam tetap besar walau bar-nya
  // pendek — persis pola Debt Maturity Profile.
  const renderDraggableBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = barDrag?.index === index;
    const dragHandlers = handleBarPointerDown(index, payload.amount, height);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="var(--primary)"
          opacity={0.85}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? 'var(--primary)' : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam ke atas, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={y - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
      </g>
    );
  };
  renderDraggableBar.displayName = 'RenderDraggableBar';

  const nearlyDepreciated = useMemo(() => {
    if (registerData.isSampleData) return SAMPLE_NEARLY_DEPRECIATED;
    return registerData.nearlyDepreciated.map((a) => ({
      id: a.id, name: a.name, nbv: formatIDR(a.nbv / 1_000_000, true),
      remaining: `${a.remainingMonths} months`, pct: Math.min(100, Math.max(0, Math.round(a.pct))),
    }));
  }, [registerData]);

  const summaryStats = useMemo(() => {
    if (registerData.isSampleData) return SAMPLE_SUMMARY_STATS;
    return [
      { label: 'Depreciation This Period', value: formatIDR(registerData.totalMonthlyDepreciation / 1_000_000, true), sub: registerData.periodLabel },
      { label: 'Accumulated Depreciation', value: formatIDR(registerData.totalAccumulatedDepreciation / 1_000_000, true), sub: 'All fixed assets' },
      { label: 'Remaining Book Value', value: formatIDR(registerData.totalNetBookValue / 1_000_000, true), sub: 'Net book value' },
      { label: 'Assets Near Full Depr.', value: `${registerData.assetsNearFullDepreciationCount} assets`, sub: 'Within 24 months' },
    ];
  }, [registerData]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Chart + Summary */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[14px] font-600 text-foreground">Depreciation Analysis</div>
            <div className="text-[11px] text-muted-foreground">Monthly depreciation expense</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {summaryStats.map((s, i) => (
            <div key={`depr-stat-${i}`} className="bg-muted/50 rounded-lg p-3">
              <div className="text-[10px] font-600 text-muted-foreground uppercase tracking-wide mb-1">{s.label}</div>
              <div className="text-[16px] font-700 text-foreground financial-value">{fx(s.value)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="relative">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyDisplayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}M`}
                width={45}
                ticks={yTicks}
                domain={yDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                formatter={(v: number) => [fx(`Rp ${v}M`), 'Depreciation']}
                cursor={false}
              />
              <Bar dataKey="amount" name="Monthly Depreciation" shape={renderDraggableBar as any} isAnimationActive={!barDrag} />
            </BarChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
          <div
            onMouseDown={handleAxisMouseDown}
            onDoubleClick={resetZoom}
            title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 45 }}
          />
        </div>
      </div>

      {/* Nearly Depreciated */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Assets Near Full Depreciation</div>
        <div className="text-[11px] text-muted-foreground mb-4">Approaching end of useful life</div>
        <div className="space-y-3">
          {nearlyDepreciated.map(asset => (
            <div
              key={`near-depr-${asset.id}`}
              className="group cursor-pointer"
              onClick={() => toast.info(`Membuka detail aset ${asset.id}`)}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-500 text-foreground truncate">{asset.name}</div>
                  <div className="text-[10px] text-muted-foreground">{asset.id} · NBV: {fx(asset.nbv)}</div>
                </div>
                <div className="text-[11px] font-600 text-foreground ml-2 shrink-0">{asset.remaining}</div>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${asset.pct}%`,
                    background: asset.pct > 80 ? 'var(--negative)' : asset.pct > 60 ? 'var(--warning)' : 'var(--primary)',
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{asset.pct}% depreciated</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}