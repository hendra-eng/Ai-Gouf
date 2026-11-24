'use client';

// Top 10 Items by Value -- treemap (peta blok): LUAS blok = peringkat nilai stok item (#1 terbesar, #10 terkecil), WARNA blok = perubahan nilai stok
// dibanding akhir bulan sebelumnya (hijau = naik, merah = turun; makin pekat = makin besar perubahannya,
// hijau "New" = barang baru / tidak ada stok akhir bulan lalu). Klik blok membuka detail item.

import React from 'react';
import { type TopItem } from '@/lib/inventoryStore';
import { formatTanggalSingkat } from '@/lib/salesStore';

const FULL_SCALE = 90;   // |perubahan| >= 90% = warna paling pekat (legenda -90% .. +90%)
// Perkiraan ukuran kotak di layar (px) untuk memilih seberapa lengkap teks di tiap blok.
const BOX_W = 1400;
const BOX_H = 460;

// Komposisi 10 blok ala heatmap crypto (landscape, lebar penuh), sengaja "berantakan": garis pemisah bergeser-geser,
// tidak ada kolom lurus penuh. Nomor peringkat = urutan LUAS: #1 terbesar -> #10 terkecil, selisih antar-peringkat jelas.
// Satuan persen (kiri, atas, lebar, tinggi). Luas (%): 26.4, 17.0, 13.2, 11.4, 8.4, 6.6, 5.6, 4.6, 3.9, 2.9.
const LAYOUT10: { l: number; t: number; w: number; h: number }[] = [
  { l: 0, t: 0, w: 40, h: 66 },     // #1  kiri atas
  { l: 0, t: 66, w: 50, h: 34 },    // #2  kiri bawah, lebih lebar dari #1
  { l: 40, t: 0, w: 30, h: 44 },    // #3
  { l: 70, t: 0, w: 30, h: 38 },    // #4
  { l: 70, t: 38, w: 30, h: 28 },   // #5
  { l: 40, t: 44, w: 30, h: 22 },   // #6
  { l: 50, t: 66, w: 28, h: 20 },   // #7
  { l: 78, t: 79, w: 22, h: 21 },   // #8
  { l: 50, t: 86, w: 28, h: 14 },   // #9
  { l: 78, t: 66, w: 22, h: 13 },   // #10
];

// Fallback bila item < 10: squarify dengan bobot menurun sesuai peringkat (#1 paling besar).
const RANK_WEIGHT = [10, 6, 4, 3, 2.5, 2, 1.7, 1.4, 1.2, 1];
function fallbackLayout(n: number) {
  const W = 300, H = 100;
  const weights = Array.from({ length: n }, (_, i) => RANK_WEIGHT[i] ?? RANK_WEIGHT[RANK_WEIGHT.length - 1]);
  const total = weights.reduce((x, y) => x + y, 0);
  const areas = weights.map(v => (v / total) * W * H);
  const out: { l: number; t: number; w: number; h: number }[] = new Array(n);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const worst = (row: number[], side: number) => {
    const s = sum(row);
    return Math.max((side * side * Math.max(...row)) / (s * s), (s * s) / (side * side * Math.min(...row)));
  };
  let x = 0, y = 0, w = W, h = H, i = 0;
  const put = (k: number, rx: number, ry: number, rw: number, rh: number) => { out[k] = { l: (rx / W) * 100, t: (ry / H) * 100, w: (rw / W) * 100, h: (rh / H) * 100 }; };
  while (i < n) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < n && worst([...row, areas[j]], side) <= worst(row, side)) { row.push(areas[j]); j++; }
    const s = sum(row);
    if (w >= h) {
      const cw = s / h; let cy = y;
      row.forEach((a, k) => { const ch = a / cw; put(i + k, x, cy, cw, ch); cy += ch; });
      x += cw; w -= cw;
    } else {
      const rh = s / w; let cx = x;
      row.forEach((a, k) => { const cw = a / rh; put(i + k, cx, y, cw, rh); cx += cw; });
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}

// Rupiah selalu ditulis penuh dan tanpa angka di belakang koma: 12623571.43 -> "Rp 12.623.571".
const rupiah = (n: number) => `${n < 0 ? '-' : ''}Rp ${Math.round(Math.abs(n)).toLocaleString('id-ID')}`;

// Gradasi tipis per blok (diagonal): sedikit lebih terang di kiri atas, sedikit lebih gelap di kanan bawah (+-6%), agar tidak kaku.
function softGradient(color: string) {
  const m = color.match(/\d+/g);
  const rgb = color.startsWith('#')
    ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
    : (m ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const to = (k: number, target: number) => `rgb(${rgb.map(v => Math.round(v + (target - v) * k)).join(',')})`;
  return `linear-gradient(135deg, ${to(0.07, 255)} 0%, ${color} 50%, ${to(0.07, 0)} 100%)`;
}

// --- Warna: hijau/merah dari palet halaman (emerald-500 -> emerald-900, red-500 -> red-900) ---
const GREEN: [number, number, number][] = [[16, 185, 129], [4, 78, 56]];
const RED: [number, number, number][] = [[239, 68, 68], [127, 29, 29]];
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

// Barang baru (akhir bulan lalu belum ada stok): emerald tua -> emerald sedang menurut peringkat, supaya ada kedalaman
// dan tetap nyambung dengan hijau sidebar. Teks putih tetap kontras.
const NEW_FROM: [number, number, number] = [6, 95, 70];    // emerald-800
const NEW_TO: [number, number, number] = [5, 150, 105];    // emerald-600
const NEW_GREEN = '#059669';

function tone(p: number | null, rank = 0) {
  if (p === null) return { bg: mix(NEW_FROM, NEW_TO, Math.min(rank / 9, 1)), fg: '#FFFFFF', sub: 'rgba(255,255,255,.78)' };
  if (Math.abs(p) < 0.05) return { bg: '#737373', fg: '#FFFFFF', sub: 'rgba(255,255,255,.75)' };
  const t = Math.min(Math.abs(p) / FULL_SCALE, 1);
  const [a, b] = p > 0 ? GREEN : RED;
  return { bg: mix(a, b, t), fg: '#FFFFFF', sub: 'rgba(255,255,255,.78)' };
}

function pctText(p: number | null) {
  if (p === null) return 'New';
  const a = Math.abs(p);
  const body = a >= 1000 ? '999+' : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${body}%`;
}

function Legend({ hasNew }: { hasNew: boolean }) {
  const stops = [mix(RED[1], RED[1], 0), mix(RED[0], RED[1], 0), '#737373', mix(GREEN[0], GREEN[1], 0), mix(GREEN[0], GREEN[1], 1)];
  const left = `linear-gradient(to right, ${mix(RED[0], RED[1], 1)}, ${stops[1]}, #737373, ${stops[3]}, ${stops[4]})`;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-neutral-500">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">−{FULL_SCALE}%</span>
        <span className="h-2 w-40 rounded-full" style={{ background: left }} />
        <span className="tabular-nums">+{FULL_SCALE}%</span>
      </div>
      {hasNew && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: NEW_GREEN }} /> New item (no stock last month)</span>}
      <span>Tile size = rank by stock value</span>
    </div>
  );
}

export default function InvTopTreemap({ items, topDate, prevDate, loading, onOpen }: {
  items: TopItem[]; topDate?: string; prevDate?: string; loading?: boolean; onOpen: (id: string) => void;
}) {
  if (loading) return <div className="h-[460px] animate-pulse rounded-[10px] bg-neutral-100" />;
  if (!items.length) {
    return <div className="rounded-[10px] border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">No stock yet.</div>;
  }
  const shown = items.slice(0, 10);
  const boxes = shown.length === 10
    ? LAYOUT10
    : fallbackLayout(shown.length);
  const prevText = prevDate ? formatTanggalSingkat(prevDate) : 'last month';
  const topText = topDate ? formatTanggalSingkat(topDate) : 'last month';

  return (
    <div className="space-y-3">
      <div className="relative h-[560px] w-full overflow-hidden rounded-[10px] border border-neutral-300 bg-white shadow-sm sm:h-[460px]">
        {shown.map((it, n) => {
          const b = boxes[n];
          // Backend lama (belum direstart) belum mengirim change_pct -> undefined; samakan dengan null agar tidak jadi warna invalid.
          const chg = typeof it.change_pct === 'number' && Number.isFinite(it.change_pct) ? it.change_pct : null;
          const prevVal = Number(it.value_prev_month) || 0;
          const c = tone(chg, n);
          const wpx = (b.w / 100) * BOX_W, hpx = (b.h / 100) * BOX_H;
          const big = wpx >= 380 && hpx >= 240;               // tampilan penuh
          const mid = !big && wpx >= 170 && hpx >= 120;       // tampilan sedang
          const tip = `${it.name} (${it.code})\n${topText}: ${rupiah(it.value)}\n${prevText}: ${prevVal > 0 ? rupiah(prevVal) : '—'}\nChange: ${pctText(chg)}`;
          return (
            <div key={it.id} className="absolute p-[1.5px]" style={{ left: `${b.l}%`, top: `${b.t}%`, width: `${b.w}%`, height: `${b.h}%` }}>
              <button type="button" title={tip} onClick={() => onOpen(it.id)}
                className="relative flex h-full w-full min-w-0 flex-col items-center justify-center overflow-hidden rounded-[5px] px-2 text-center transition duration-200 hover:brightness-110 hover:ring-2 hover:ring-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                style={{ background: softGradient(c.bg), color: c.fg }}>
                <span className={`absolute flex items-center ${big ? 'left-3 top-2.5 gap-2' : 'left-2 top-1.5 gap-1.5'}`}>
                  <span className={`font-semibold tabular-nums ${big ? 'text-xs' : 'text-[10px]'}`} style={{ color: c.sub }}>#{n + 1}</span>
                  <span className={`inline-flex items-center rounded-full bg-white/20 font-semibold uppercase leading-none tracking-wider ${big ? 'px-2.5 py-1 text-xs' : mid ? 'px-2 py-[3px] text-[10px]' : 'px-1.5 py-[2px] text-[9px]'}`}>{pctText(chg)}</span>
                </span>
                <p className={`max-w-full truncate font-semibold tracking-tight ${big ? 'text-2xl' : mid ? 'text-sm' : 'text-xs'}`}>{it.name}</p>
                <p className={`max-w-full truncate font-semibold tabular-nums tracking-tight ${big ? 'mt-1 text-4xl' : mid ? 'mt-0.5 text-xl' : 'mt-0 text-sm'}`}>
                  {rupiah(it.value)}
                </p>
              </button>
            </div>
          );
        })}
      </div>
      <Legend hasNew={shown.some(i => typeof i.change_pct !== 'number')} />
    </div>
  );
}