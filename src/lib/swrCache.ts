// Cache in-memory sederhana (stale-while-revalidate) untuk hook data per-halaman.
//
// Masalah yang diselesaikan: hook seperti useJeDrafts / usePurchaseTransactions /
// useSalesInvoices selalu mulai dari `loading = true` + data kosong tiap kali
// komponen di-mount. Karena tiap tab adalah route sendiri, pindah tab = mount
// ulang = "Loading…" muncul lagi walau datanya baru saja diambil.
//
// Dengan cache ini hook mulai dari data terakhir (tanpa loading), lalu tetap
// mengambil data terbaru di belakang layar dan menggantinya saat tiba.
// Setiap mutasi (notifyXxxChanged) memanggil swrClear(prefix) supaya data lama
// tidak ikut tampil sesudah ada perubahan.

const store = new Map<string, unknown>();

export function swrGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function swrSet<T>(key: string, value: T): void {
  store.set(key, value);
}

export function swrClear(prefix: string): void {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
}
