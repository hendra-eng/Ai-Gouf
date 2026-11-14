// Menunggu backend (uvicorn) siap sebelum Next.js dijalankan, supaya proxy
// /api/* tidak kena ECONNREFUSED saat kedua proses dinyalakan bersamaan.
// Tanpa dependensi tambahan. Maks 90 detik, lalu lanjut tetap jalan.
const url = (process.env.BACKEND_URL || 'http://127.0.0.1:8000') + '/api/health';
const batasMs = 90_000;
const mulai = Date.now();

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

while (Date.now() - mulai < batasMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`[wait-backend] backend siap (${Math.round((Date.now() - mulai) / 100) / 10}s)`);
      process.exit(0);
    }
  } catch {
    // backend belum nyala, coba lagi
  }
  await tidur(500);
}
console.warn('[wait-backend] backend belum siap setelah 90 detik, frontend tetap dijalankan.');
