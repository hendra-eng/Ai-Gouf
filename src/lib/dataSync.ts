'use client';

// Notifikasi lintas-halaman: dipakai supaya halaman yang menampilkan data
// TRANSAKSIONAL milik satu client (jurnal/Transaksi, KPI, dll) bisa
// otomatis refresh begitu Agent AI selesai memproses & auto-posting file
// upload untuk client yang sedang aktif -- tanpa user harus pindah client
// dulu atau reload halaman manual.
//
// SENGAJA dipisah dari CLIENTS_CHANGED_EVENT di clientsStore.tsx -- event
// itu untuk perubahan DAFTAR client (tambah/hapus/edit client), event di
// sini untuk perubahan DATA milik satu client yang sudah ada (jurnal baru
// masuk/terposting lewat upload Agent AI).

const CLIENT_DATA_CHANGED_EVENT = 'gouf-client-data-changed';

/** Panggil begitu data (jurnal/transaksi) client tertentu berubah di backend
 *  (mis. selesai upload & auto-posting di Agent AI). */
export function notifyClientDataChanged(clientId: string | number | null | undefined) {
  if (typeof window === 'undefined' || clientId == null) return;
  window.dispatchEvent(
    new CustomEvent(CLIENT_DATA_CHANGED_EVENT, { detail: { clientId: String(clientId) } })
  );
}

/**
 * Dengarkan perubahan data client dari mana pun (biasanya dipanggil di
 * dalam useEffect). `onChanged` dipanggil dengan id client yang datanya
 * berubah -- pengecekan "apakah ini client yang lagi aktif di halaman ini"
 * dilakukan oleh pemanggil, supaya helper ini tetap generik. Mengembalikan
 * fungsi cleanup untuk dipanggil saat unmount.
 */
export function listenClientDataChanged(onChanged: (clientId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ clientId: string }>).detail;
    if (detail?.clientId) onChanged(detail.clientId);
  };
  window.addEventListener(CLIENT_DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CLIENT_DATA_CHANGED_EVENT, handler);
}
