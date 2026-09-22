'use client';

// Global "active client" context.
//
// Sebelumnya cuma ada /agent-ai/context/ClientContext.jsx yang scope-nya
// lokal ke halaman Agent AI saja (lihat komentar di AgentAIChat.jsx:
// "belum ada ClientProvider di level dashboard"). Akibatnya Topbar (Switch
// Company) punya state client-nya SENDIRI (useState lokal), jadi client
// yang aktif hilang/reset tiap pindah halaman dan tidak nyambung sama
// sekali ke halaman lain (Dashboard, Accounts Payable, dst).
//
// Context ini dipasang SEKALI di root (lihat src/components/AppLayout.tsx)
// supaya SEMUA halaman berbagi satu "client aktif" yang sama:
//   - Topbar (Switch Company) baca & ubah lewat sini.
//   - Tiap halaman baca `activeClientId` dari sini untuk fetch data yang
//     sesuai client tsb.
//   - Upload file (di halaman mana pun) kirim `activeClientId` ini ke
//     backend, jadi hasil upload otomatis "milik" client yang lagi aktif.
//
// Daftar client-nya sendiri masih dari clientsStore.tsx (GET /api/client),
// sumber yang sama yang dipakai halaman /clients -- jadi tidak ada dua
// sumber data client yang berbeda.
//
// [DIUBAH] Sebelumnya context ini menyimpan & membaca pilihan client
// terakhir dari localStorage ("ai_gouf_active_client"), jadi client aktif
// "diingat" lintas sesi. Atas permintaan user: sekarang SENGAJA tidak lagi
// membaca localStorage saat mount -- setiap kali halaman/tab baru dibuka
// (termasuk setelah refresh), client aktif SELALU jatuh ke client PERTAMA
// di database (urutan dari GET /api/client), bukan client terakhir yang
// dipilih. Tombol "Switch Company" di Topbar tetap bisa dipakai untuk
// ganti client sementara selama sesi itu berjalan.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useClientsList, type Client } from '@/lib/clientsStore';

interface ActiveClientContextValue {
  /** Daftar semua client (dari backend, sama seperti halaman /clients). */
  clients: Client[];
  activeClientId: string | null;
  activeClientName: string | null;
  /** Pindah client aktif. Panggil dengan (null, null) untuk mengosongkan. */
  setActiveClient: (id: string | null, name?: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * [BARU -- FIX flash-ke-0, versi diperbaiki] Awalnya `hydrated` diset
   * `true` setelah "satu tick render pertama" TANPA menunggu daftar
   * client (GET /api/client) selesai dimuat. Akibatnya, selama daftar
   * client masih loading (biasa 1-2 detik, bisa lebih), `hydrated` sudah
   * keburu `true` sementara `activeClientId` masih `null` -- semua hook
   * data (KPIBentoGrid, useProfitLossData, dst) langsung menyimpulkan
   * "tidak ada client aktif" dan merender ANGKA 0 ASLI (bukan skeleton),
   * baru diganti data sungguhan begitu client pertama selesai di-resolve.
   * Inilah "flash ke 0 lalu baru muncul data" yang dikeluhkan user.
   *
   * Sekarang: `hydrated` HANYA jadi `true` setelah `clients` (dari
   * useClientsList()) selesai loading DAN activeClientId sudah pasti
   * ter-resolve (ke client pertama, atau `null` kalau memang tidak ada
   * client sama sekali) -- lihat effect resolusi di bawah. Konsumen yang
   * sudah menunggu `hydrated === true` (pola `if (!hydrated) return;`)
   * otomatis ikut diperbaiki tanpa perlu diubah satu-satu.
   */
  hydrated: boolean;
}

const ActiveClientContext = createContext<ActiveClientContextValue | undefined>(undefined);

export function ActiveClientProvider({ children }: { children: ReactNode }) {
  const { clients, loading, error, refresh } = useClientsList();
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeClientName, setActiveClientName] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // [FIX flash-ke-0] Effect ini DULU cuma `setHydrated(true)` tanpa syarat
  // apapun (jalan sekali di render pertama, tidak peduli daftar client
  // sudah siap atau belum) -- itu sebabnya `hydrated` tidak benar-benar
  // berarti "activeClientId sudah pasti final". Sekarang dihapus dari sini
  // dan digabung ke effect resolusi client di bawah, supaya `hydrated`
  // HANYA jadi true setelah resolusi activeClientId betul-betul selesai.

  // Begitu daftar client (asli, dari backend) sudah siap: pastikan client
  // yang aktif masih valid (belum dihapus). Kalau tidak valid / belum ada
  // pilihan sama sekali (selalu begitu sekarang, tiap halaman baru dibuka),
  // jatuhkan ke client pertama di daftar -- konsisten dengan perilaku
  // dropdown "Switch Company" yang lama di Topbar.
  useEffect(() => {
    // [FIX flash-ke-0] `loading` di sini adalah status GET /api/client itu
    // SENDIRI (dari useClientsList()) -- selama masih true, kita BELUM TAHU
    // apakah bakal ada client atau tidak, jadi `hydrated` harus tetap false
    // (biar semua hook data tetap tampilkan skeleton, bukan angka 0).
    if (loading) return;
    if (clients.length === 0) {
      if (activeClientId !== null) {
        setActiveClientId(null);
        setActiveClientName(null);
      }
      setHydrated(true); // resolusi selesai: memang tidak ada client sama sekali
      return;
    }
    const stillValid = activeClientId !== null && clients.some((c) => c.id === activeClientId);
    if (!stillValid) {
      const first = clients[0];
      setActiveClientId(first.id);
      setActiveClientName(first.companyName);
    }
    setHydrated(true); // resolusi selesai: activeClientId sudah pasti (baru di-set atau sudah valid)
    // Sengaja tidak include activeClientId di deps -- efek ini cuma perlu
    // jalan ulang saat DAFTAR client berubah (mis. client dihapus), bukan
    // tiap kali user pilih client baru (itu sudah ditangani setActiveClient).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, loading]);

  // [DIUBAH] Tidak lagi menulis ke localStorage -- pilihan lewat Switch
  // Company ini hanya berlaku untuk sesi/halaman yang sedang berjalan.
  // Begitu halaman dibuka ulang, effect di atas akan mengembalikannya ke
  // client pertama.
  const setActiveClient = useCallback((id: string | null, name?: string | null) => {
    setActiveClientId(id);
    setActiveClientName(name ?? null);
  }, []);

  const value = useMemo<ActiveClientContextValue>(
    () => ({ clients, activeClientId, activeClientName, setActiveClient, loading, error, refresh, hydrated }),
    [clients, activeClientId, activeClientName, setActiveClient, loading, error, refresh, hydrated]
  );

  return <ActiveClientContext.Provider value={value}>{children}</ActiveClientContext.Provider>;
}

export function useActiveClient(): ActiveClientContextValue {
  const ctx = useContext(ActiveClientContext);
  if (!ctx) {
    throw new Error('useActiveClient must be used within an ActiveClientProvider');
  }
  return ctx;
}