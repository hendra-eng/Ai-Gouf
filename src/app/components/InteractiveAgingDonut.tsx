'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';

export interface AgingSlice {
  name: string;
  value: number;
  color: string;
}

export interface AgingLivePreview {
  name: string;
  pct: number;
  value: number;
}

interface Props {
  data: AgingSlice[];
  centerLabel?: string;
  centerSubLabel?: string;
  onActiveChange?: (index: number | null) => void;
  activeIndex?: number | null;
  /** Fired continuously while a segment is being dragged (or springing back)
   *  with the live-preview pct/value for every segment, in the same order
   *  as `data`. Fired with `null` once nothing is being dragged/animated,
   *  so callers can fall back to the real, undragged values. */
  onLiveChange?: (preview: AgingLivePreview[] | null) => void;
}

const CX = 120;
const CY = 120;
const R_OUTER = 96;
const R_INNER = 60;
const HANDLE_HIT = 18; // invisible grab width, in svg units
const VIEWBOX = 240;
const MIN_SEGMENT_DEG = 3; // minimum angular size any segment is allowed to shrink to

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const span = endAngle - startAngle;
  const largeArc = span > 180 ? 1 : 0;
  const p1 = polar(cx, cy, rOuter, startAngle);
  const p2 = polar(cx, cy, rOuter, endAngle);
  const p3 = polar(cx, cy, rInner, endAngle);
  const p4 = polar(cx, cy, rInner, startAngle);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

function normalizeAngle(a: number) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

/**
 * Given the ORIGINAL angular sizes of every segment, and one "pulled" segment
 * whose new size is being driven by the drag, redistribute the remaining
 * (360 - pulledSize) degrees across every other segment proportionally to
 * their original composition. This lets one slice be dragged almost all the
 * way to 360deg while every other color shrinks together, keeping their
 * relative ratio to each other.
 */
function computeLiveLayout(
  baseSizes: number[],
  baseBoundaries: number[],
  N: number,
  pulledIndex: number | null,
  pulledSize: number
) {
  if (pulledIndex === null) {
    return { sizes: baseSizes, boundaries: baseBoundaries };
  }
  const otherBaseTotal = 360 - baseSizes[pulledIndex];
  const remaining = 360 - pulledSize;
  const sizes = new Array(N).fill(0);
  sizes[pulledIndex] = pulledSize;
  for (let j = 0; j < N; j++) {
    if (j === pulledIndex) continue;
    sizes[j] = otherBaseTotal > 0 ? remaining * (baseSizes[j] / otherBaseTotal) : remaining / (N - 1);
  }
  const boundaries = new Array(N).fill(0);
  let cursor = baseBoundaries[pulledIndex]; // anchor: the pulled segment's own start stays fixed
  for (let step = 0; step < N; step++) {
    const idx = (pulledIndex + step) % N;
    boundaries[idx] = cursor;
    cursor += sizes[idx];
  }
  return { sizes, boundaries };
}

export default function InteractiveAgingDonut({ data, centerLabel, centerSubLabel, onActiveChange, activeIndex: activeIndexProp, onLiveChange }: Props) {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const N = data.length;

  const baseSizes = useMemo(() => data.map((d) => (d.value / total) * 360), [data, total]);
  const baseBoundaries = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (let i = 0; i < N; i++) {
      arr.push(acc);
      acc += baseSizes[i];
    }
    return arr;
  }, [baseSizes, N]);

  // which segment is currently being "pulled" (grown/shrunk), and its live size
  const [pulledIndex, setPulledIndex] = useState<number | null>(null);
  const pulledIndexRef = useRef<number | null>(null);
  const [pulledSize, setPulledSize] = useState(0);
  const pulledSizeRef = useRef(0);

  const animRef = useRef<number | null>(null);
  const draggingBoundaryRef = useRef<number | null>(null);
  const [draggingBoundary, setDraggingBoundary] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [internalActive, setInternalActive] = useState<number | null>(null);
  const activeIndex = activeIndexProp !== undefined ? activeIndexProp : internalActive;
  const setActiveIndex = (updater: (prev: number | null) => number | null) => {
    const next = updater(activeIndex ?? null);
    setInternalActive(next);
    onActiveChange?.(next);
  };

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const clientToAngle = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    // Use the SVG's own screen transform so the mapping stays correct
    // regardless of preserveAspectRatio letterboxing (non-square containers,
    // e.g. width="100%" with a fixed height, don't stretch 1:1).
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const angle = (Math.atan2(svgPt.y - CY, svgPt.x - CX) * 180) / Math.PI + 90;
    return normalizeAngle(angle);
  }, []);

  const stopSpring = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  };

  const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

  const springBack = useCallback((index: number) => {
    stopSpring();
    const from = pulledSizeRef.current;
    const target = baseSizes[index];
    const duration = 420; // ms — smooth, no overshoot
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuint(t);
      const next = from + (target - from) * eased;
      pulledSizeRef.current = next;
      setPulledSize(next);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        pulledIndexRef.current = null;
        setPulledIndex(null);
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  }, [baseSizes]);

  // boundaryIdx is the white line BEFORE segment boundaryIdx; dragging it
  // resizes the segment right before it (boundaryIdx - 1).
  const handlePointerDown = (boundaryIdx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    const idx = (boundaryIdx - 1 + N) % N;
    pulledIndexRef.current = idx;
    setPulledIndex(idx);
    pulledSizeRef.current = baseSizes[idx];
    setPulledSize(baseSizes[idx]);
    draggingBoundaryRef.current = boundaryIdx;
    setDraggingBoundary(boundaryIdx);
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const idx = pulledIndexRef.current;
      if (idx === null || draggingBoundaryRef.current === null) return;
      const angle = clientToAngle(e.clientX, e.clientY);
      const anchor = baseBoundaries[idx];
      const rawSize = normalizeAngle(angle - anchor); // instantaneous reading, wraps at 0/360

      // Unwrap relative to the previous frame's size: pick whichever of
      // rawSize-360 / rawSize / rawSize+360 is closest to where the drag
      // already was. This way, once the size is clamped at the min/max,
      // continuing to rotate the cursor past the wrap point keeps producing
      // a candidate beyond the clamp (so it stays "stuck") instead of
      // jumping back down/up the moment the raw angle wraps around.
      const prev = pulledSizeRef.current;
      let size = rawSize;
      for (const candidate of [rawSize - 360, rawSize, rawSize + 360]) {
        if (Math.abs(candidate - prev) < Math.abs(size - prev)) size = candidate;
      }

      const maxSize = 360 - MIN_SEGMENT_DEG * (N - 1);
      size = Math.max(MIN_SEGMENT_DEG, Math.min(maxSize, size));
      pulledSizeRef.current = size;
      setPulledSize(size);
    };
    const handleUp = () => {
      const idx = pulledIndexRef.current;
      draggingBoundaryRef.current = null;
      setDraggingBoundary(null);
      if (idx !== null) springBack(idx);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [baseBoundaries, clientToAngle, springBack, N]);

  const { sizes: liveSizes, boundaries: liveBoundaries } = computeLiveLayout(
    baseSizes,
    baseBoundaries,
    N,
    pulledIndex,
    pulledSize
  );

  const segments = data.map((d, i) => ({
    ...d,
    start: liveBoundaries[i],
    end: liveBoundaries[i] + liveSizes[i],
    index: i,
  }));

  // Report live preview values to the parent while a segment is being
  // dragged or springing back; report null once it's fully settled so the
  // parent can show the real, undragged numbers again.
  useEffect(() => {
    if (pulledIndex === null) {
      onLiveChange?.(null);
      return;
    }
    onLiveChange?.(
      data.map((d, i) => ({
        name: d.name,
        pct: (liveSizes[i] / 360) * 100,
        value: (total * liveSizes[i]) / 360,
      }))
    );
    // liveSizes is derived fresh each render from pulledIndex/pulledSize/data/total,
    // so those are the real dependencies driving this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulledIndex, pulledSize, data, total]);

  // the info box shows whichever segment is being dragged; once released it
  // keeps showing that segment while it springs back, then falls back to
  // whatever was last clicked (or nothing).
  const calloutIndex = pulledIndex !== null ? pulledIndex : activeIndex;
  const callout =
    calloutIndex !== null
      ? {
          name: data[calloutIndex].name,
          color: data[calloutIndex].color,
          pct: (liveSizes[calloutIndex] / 360) * 100,
          value: (total * liveSizes[calloutIndex]) / 360,
          isPreview: pulledIndex !== null,
        }
      : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width="100%"
      height={180}
      style={{ touchAction: 'none', overflow: 'visible' }}
    >
      {segments.map((seg) => {
        const isActive = activeIndex === seg.index;
        const isDimmed = activeIndex !== null && !isActive;
        const outer = isActive ? R_OUTER + 6 : R_OUTER;
        return (
          <path
            key={`aging-seg-${seg.index}`}
            d={arcPath(CX, CY, outer, R_INNER, seg.start, seg.end)}
            fill={seg.color}
            opacity={isDimmed ? 0.35 : 1}
            style={{ cursor: 'pointer', transition: 'opacity 150ms ease, filter 150ms ease' }}
            filter={hoverIndex === seg.index ? 'brightness(1.08)' : undefined}
            onClick={() => setActiveIndex((prev) => (prev === seg.index ? null : seg.index))}
            onPointerEnter={() => setHoverIndex(seg.index)}
            onPointerLeave={() => setHoverIndex(null)}
          />
        );
      })}

      {/* draggable white separators between segments */}
      {baseBoundaries.map((_, i) => {
        const angle = liveBoundaries[i];
        const inner = polar(CX, CY, R_INNER - 3, angle);
        const outer = polar(CX, CY, R_OUTER + 3, angle);
        const isDraggingThis = draggingBoundary === i;
        return (
          <g key={`aging-boundary-${i}`}>
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="#fff"
              strokeWidth={isDraggingThis ? 4 : 3}
              strokeLinecap="round"
              style={{ transition: isDraggingThis ? 'none' : 'stroke-width 150ms ease' }}
              pointerEvents="none"
            />
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="transparent"
              strokeWidth={HANDLE_HIT}
              style={{ cursor: 'grab' }}
              onPointerDown={handlePointerDown(i)}
            />
          </g>
        );
      })}

      {callout ? (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={CX - 46}
            y={CY - 30}
            width={92}
            height={60}
            rx={10}
            fill="var(--card)"
            stroke="var(--border)"
            strokeWidth={1}
          />
          <circle cx={CX - 30} cy={CY - 14} r={4} fill={callout.color} />
          <text x={CX - 20} y={CY - 10.5} fontSize={9} fill="var(--muted-foreground)">
            {t(callout.name)}
          </text>
          <text x={CX} y={CY + 10} textAnchor="middle" fontSize={20} fontWeight={700} fill={callout.color}>
            {callout.pct.toFixed(0)}%
          </text>
          <text x={CX} y={CY + 23} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
            {callout.isPreview ? `${t('estimate')} · ` : ''}{formatMoney(callout.value * 1e6, currency)}
          </text>
        </g>
      ) : (
        <>
          {centerLabel && (
            <text x={CX} y={CY - 4} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--foreground)">
              {centerLabel}
            </text>
          )}
          {centerSubLabel && (
            <text x={CX} y={CY + 14} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
              {centerSubLabel}
            </text>
          )}
        </>
      )}
    </svg>
  );
}