// Utilitas bersama untuk menghasilkan tick sumbu Y yang rapi (angka bulat,
// spasi konsisten) — dipakai oleh chart yang skalanya berubah dinamis saat
// di-zoom (drag harga), supaya label tidak "lompat" tidak beraturan
// (mis. 13M, 7M, 4M, 0M) akibat pembulatan angka desimal hasil auto-tick
// bawaan Recharts.

/** Bulatkan step ke angka "nice": 1, 2, atau 5 dikali kelipatan 10. */
function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceResidual: number;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;
  return niceResidual * magnitude;
}

/** Tick untuk domain [0, max] — dipakai chart yang mulai dari nol (P&L, LPE).
 *  PENTING: domain chart TIDAK ikut dibulatkan (tetap kontinu mengikuti drag
 *  zoom piksel demi piksel, biar terasa smooth) — cuma label/gridline-nya
 *  saja yang dihitung di angka bulat terdekat, jadi jumlah gridline yang
 *  tampil bisa berubah organik seiring zoom (persis seperti aplikasi
 *  trading), bukan skala yang "nge-snap" ke titik diskrit. */
export function getNiceTicksFromZero(maxValue: number, tickCount = 5) {
  const safeMax = Math.max(maxValue, 1);
  const step = niceStep(safeMax / tickCount);
  // Jangan Math.round kalau step < 1 (data kosong / nilai kecil) — dulu itu
  // menghasilkan tick duplikat [0,0,0,1,1,1] → error "two children with the same key".
  const norm = (v: number) => (step >= 1 ? Math.round(v) : Number(v.toFixed(6)));
  const ticks: number[] = [0];
  for (let i = 1; i * step <= safeMax + step * 1e-6; i++) {
    ticks.push(norm(i * step));
  }
  if (ticks.length < 2) ticks.push(norm(safeMax));
  return { ticks: Array.from(new Set(ticks)), step };
}

/** Tick simetris di sekitar nol — dipakai chart dua arah (Cash Flow).
 *  Domain tetap kontinu, sama seperti getNiceTicksFromZero di atas. */
export function getNiceSymmetricTicks(maxAbsValue: number, halfTickCount = 4) {
  const safeMax = Math.max(maxAbsValue, 1);
  const step = niceStep(safeMax / halfTickCount);
  const norm = (v: number) => (step >= 1 ? Math.round(v) : Number(v.toFixed(6)));
  const positives: number[] = [];
  for (let i = 1; i * step <= safeMax + step * 1e-6; i++) positives.push(norm(i * step));
  if (positives.length === 0) positives.push(norm(safeMax));
  const uniq = Array.from(new Set(positives));
  const ticks = [...uniq.map((v) => -v).reverse(), 0, ...uniq];
  return { ticks, step };
}

/**
 * Format nilai tick berdasarkan besar step-nya, supaya jumlah desimal pas
 * (tidak 0 desimal kalau step-nya pecahan setelah dibagi divisor — itu yang
 * bikin label kelihatan lompat tidak rata).
 */
export function formatAxisValue(value: number, step: number, unit = 'M', divisor = 1000) {
  const scaled = value / divisor;
  const scaledStep = step / divisor;
  let decimals = 0;
  if (Math.abs(scaledStep % 1) > 1e-6) {
    decimals = Math.abs((scaledStep * 10) % 1) > 1e-6 ? 2 : 1;
  }
  return `${scaled.toFixed(decimals)}${unit}`;
}