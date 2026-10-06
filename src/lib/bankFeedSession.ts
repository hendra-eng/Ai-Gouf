// ─── PENYIMPANAN SESI BANK FEED ────────────────────────────────────────────
// Bank Feed (Cash & Bank) sengaja TIDAK disimpan permanen di database:
// hasil ekstraksi rekening koran hanya hidup selama sesi browser. Datanya
// ditaruh di sessionStorage (bukan localStorage) supaya:
//   - tetap ada saat pindah antar halaman / refresh di tab yang sama,
//   - otomatis hilang begitu tab/jendela ditutup,
//   - dihapus eksplisit saat logout (lihat hapusSemuaSesiBankFeed(), dipakai
//     logout() di src/lib/auth.tsx).
// Satu kunci per client supaya data client A tidak bocor ke client B.

export const PREFIX_KUNCI_SESI_BANK_FEED = 'gouf_bank_feed_sesi_v1:';

export function kunciSesiBankFeed(clientId: string): string {
  return `${PREFIX_KUNCI_SESI_BANK_FEED}${clientId}`;
}

export function bacaSesiBankFeed<T = unknown>(clientId: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(kunciSesiBankFeed(clientId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function tulisSesiBankFeed<T = unknown>(clientId: string, list: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (list.length === 0) {
      window.sessionStorage.removeItem(kunciSesiBankFeed(clientId));
    } else {
      window.sessionStorage.setItem(kunciSesiBankFeed(clientId), JSON.stringify(list));
    }
  } catch {
    // Kuota sessionStorage penuh / mode privat -- data tetap hidup di memori
    // React selama halaman terbuka, hanya tidak bertahan saat refresh.
  }
}

export function hapusSemuaSesiBankFeed(): void {
  if (typeof window === 'undefined') return;
  try {
    Object.keys(window.sessionStorage)
      .filter((k) => k.startsWith(PREFIX_KUNCI_SESI_BANK_FEED))
      .forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* abaikan */
  }
}