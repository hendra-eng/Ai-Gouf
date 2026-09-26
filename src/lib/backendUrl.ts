// [BARU] Satu sumber kebenaran untuk URL backend FastAPI yang dipanggil
// LANGSUNG dari browser (melewati proxy /api/... di next.config.mjs) --
// dipakai khusus endpoint upload berat (rekening koran di
// ImportRekeningKoranModal.tsx, Bank Feed di agent-ai/lib/api.js) yang
// butuh waktu proses lama, karena proxy rewrites Next.js punya batas waktu
// tunggu yang tidak bisa dikonfigurasi lagi di versi Next.js sekarang.
//
// SEBELUMNYA ada 2 definisi terpisah untuk hal yang sama (satu di
// agent-ai/lib/api.js, satu lagi di ImportRekeningKoranModal.tsx) yang
// gampang tidak sinkron begitu backend pindah host/port -- itu penyebab
// bug "Failed to fetch" di tab Bank Feed: env var yang dibaca
// (NEXT_PUBLIC_BACKEND_URL) tidak pernah benar-benar di-set di mana pun,
// jadi selalu jatuh ke fallback hardcode "http://localhost:8000". Kalau
// browser yang membuka dashboard ini BUKAN komputer yang sama dengan
// tempat backend jalan (mis. dev server diakses dari komputer lain,
// tunnel, atau deploy terpisah), "localhost" di sisi BROWSER berarti
// komputer si user sendiri -- bukan server aplikasinya -- sehingga fetch
// selalu gagal connect sebelum sempat dapat respons apa pun.
//
// Urutan resolusi URL:
//   1. NEXT_PUBLIC_BACKEND_URL kalau di-set eksplisit di .env.local/.env
//      production -- WAJIB diisi kalau backend tidak sehost dengan
//      Next.js (mis. domain/port beda, deploy terpisah, tunnel, dst).
//   2. Kalau tidak di-set DAN kode ini jalan di browser: pakai hostname
//      persis yang sedang dibuka user (window.location.hostname) + port
//      8000 -- jauh lebih aman daripada hardcode "localhost", dan tetap
//      berperilaku sama seperti sebelumnya untuk dev lokal (di situ
//      hostname memang "localhost").
//   3. Fallback terakhir (SSR / tidak ada window) -- praktis tidak pernah
//      kepakai karena semua pemanggil helper ini adalah kode 'use client'.
export function resolveBackendUrlLangsung(): string {
  const eksplisit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (eksplisit) return eksplisit.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
}

export const BACKEND_URL_LANGSUNG = resolveBackendUrlLangsung();

/**
 * Ubah error dari fetch() jadi pesan yang bisa langsung ditindaklanjuti user,
 * BUKAN cuma "Failed to fetch" mentah dari browser. fetch() melempar
 * TypeError kalau request gagal di level jaringan (belum sempat dapat
 * respons HTTP sama sekali) -- beda dari respons !res.ok yang sudah
 * ditangani terpisah di masing-masing pemanggil.
 */
export function pesanGagalFetchBackend(err: unknown, urlDipanggil?: string): string {
  if (err instanceof TypeError) {
    return (
      `Tidak bisa menghubungi server backend${urlDipanggil ? ` di ${urlDipanggil}` : ''}. ` +
      'Pastikan backend FastAPI sedang berjalan dan bisa diakses LANGSUNG dari browser ini ' +
      '(bukan cuma dari server Next.js). Kalau backend jalan di host/port lain, set env ' +
      'NEXT_PUBLIC_BACKEND_URL ke alamat yang benar lalu restart dev server / build ulang.'
    );
  }
  return err instanceof Error ? err.message : 'Terjadi kesalahan tidak diketahui saat menghubungi backend.';
}