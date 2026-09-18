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
   * [BARU -- FIX flash-ke-0] false SEBENTAR saja di render pertama, sebelum
   * context ini sempat selesai proses inisialisasi awal (dulu: baca
   * localStorage; sekarang: cuma menunggu satu tick render pertama).
   * Semua hook data (useProfitLossData, useBalanceSheetData, KPIBentoGrid,
   * dst) HARUS menunggu `hydrated === true` sebelum menyimpulkan
   * "activeClientId null = memang tidak ada client dipilih". Sebelum fix
   * ini, hook-hook tsb langsung menganggap activeClientId null di render
   * pertama sebagai "kosong" dan menampilkan angka 0 -- padahal
   * sebenarnya baru "belum sempat di-set ke client pertama", bukan
   * "memang kosong".
   */
  hydrated: boolean;
}

const ActiveClientContext = createContext<ActiveClientContextValue | undefined>(undefined);

export function ActiveClientProvider({ children }: { children: ReactNode }) {
  const { clients, loading, error, refresh } = useClientsList();
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeClientName, setActiveClientName] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // [DIUBAH] Sengaja tidak lagi membaca localStorage di sini -- setiap
  // halaman dibuka baru, client aktif SELALU jatuh ke client pertama di
  // database (lihat effect di bawah), bukan client terakhir yang dipilih
  // sebelumnya. Effect ini sekarang cuma menandai bahwa render pertama
  // sudah lewat, supaya effect fallback-ke-client-pertama di bawah boleh
  // mulai jalan.
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Begitu daftar client (asli, dari backend) sudah siap: pastikan client
  // yang aktif masih valid (belum dihapus). Kalau tidak valid / belum ada
  // pilihan sama sekali (selalu begitu sekarang, tiap halaman baru dibuka),
  // jatuhkan ke client pertama di daftar -- konsisten dengan perilaku
  // dropdown "Switch Company" yang lama di Topbar.
  useEffect(() => {
    if (!hydrated || loading) return;
    if (clients.length === 0) {
      if (activeClientId !== null) {
        setActiveClientId(null);
        setActiveClientName(null);
      }
      return;
    }
    const stillValid = activeClientId !== null && clients.some((c) => c.id === activeClientId);
    if (!stillValid) {
      const first = clients[0];
      setActiveClientId(first.id);
      setActiveClientName(first.companyName);
    }
    // Sengaja tidak include activeClientId di deps -- efek ini cuma perlu
    // jalan ulang saat DAFTAR client berubah (mis. client dihapus), bukan
    // tiap kali user pilih client baru (itu sudah ditangani setActiveClient).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, loading, hydrated]);

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