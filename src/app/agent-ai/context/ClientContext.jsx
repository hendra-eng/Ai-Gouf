"use client";

// [UBAH] Context "client aktif" khusus halaman Agent AI ini SEKARANG cuma
// pembungkus tipis di atas context GLOBAL (src/lib/activeClient.tsx) yang
// dipasang sekali di root layout (lihat src/components/AppLayout.tsx).
//
// Sebelumnya file ini punya state & fetch daftar client SENDIRI (terpisah
// dari Topbar/halaman Clients), jadi client yang aktif di Agent AI bisa
// beda sendiri dari client yang dipilih di header dashboard -- upload file
// di sini tidak nyambung ke pilihan "Switch Company" di halaman lain.
// Sekarang keduanya baca/tulis ke SATU sumber yang sama, jadi:
//   - Pilih client di header (mana pun halamannya) -> ikut aktif di sini.
//   - Upload file di Agent AI -> otomatis ke client yang sama yang aktif
//     di seluruh dashboard.
//
// Nama field (clients, activeClientId, activeClientName, pilihClient,
// loading, error, muatUlang) SENGAJA dipertahankan sama seperti versi
// lama supaya AgentAIChat.jsx & komponen lain di /agent-ai yang sudah
// pakai useClient() tidak perlu diubah.
import { useActiveClient } from "@/lib/activeClient";

/**
 * ClientProvider -- sekarang cuma passthrough (tidak menyimpan state apa
 * pun sendiri). Provider yang SEBENARNYA (ActiveClientProvider) sudah
 * dipasang satu kali di root layout, membungkus SELURUH dashboard --
 * jadi komponen ini tetap diekspor & tetap dipasang di AgentAIChat.jsx
 * supaya tidak ada import yang patah, tapi tidak lagi melakukan apa-apa
 * selain merender children-nya.
 */
export function ClientProvider({ children }) {
  return children;
}

export function useClient() {
  const { clients, activeClientId, activeClientName, setActiveClient, loading, error, refresh } = useActiveClient();
  return {
    clients,
    activeClientId,
    activeClientName,
    pilihClient: (id, nama) => setActiveClient(id, nama),
    loading,
    error,
    muatUlang: refresh,
  };
}
