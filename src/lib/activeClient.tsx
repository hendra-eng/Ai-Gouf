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
// localStorage key SENGAJA dipakai sama dengan yang sebelumnya dipakai
// /agent-ai/context/ClientContext.jsx ("ai_gouf_active_client") supaya
// pilihan client yang sudah tersimpan dari sesi sebelumnya tetap kebaca,
// tidak reset ke kosong begitu context ini pindah ke root.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useClientsList, type Client } from '@/lib/clientsStore';

const STORAGE_KEY = 'ai_gouf_active_client';

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
}

const ActiveClientContext = createContext<ActiveClientContextValue | undefined>(undefined);

export function ActiveClientProvider({ children }: { children: ReactNode }) {
  const { clients, loading, error, refresh } = useClientsList();
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeClientName, setActiveClientName] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Baca pilihan tersimpan dari sesi sebelumnya (sekali saja, saat mount).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { id?: string | number; nama?: string | null };
        if (parsed.id != null) {
          setActiveClientId(String(parsed.id));
          setActiveClientName(parsed.nama ?? null);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  // Begitu daftar client (asli, dari backend) sudah siap: pastikan client
  // yang aktif masih valid (belum dihapus). Kalau tidak valid / belum ada
  // pilihan sama sekali, jatuhkan ke client pertama di daftar -- konsisten
  // dengan perilaku dropdown "Switch Company" yang lama di Topbar.
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

  const setActiveClient = useCallback((id: string | null, name?: string | null) => {
    setActiveClientId(id);
    setActiveClientName(name ?? null);
    if (typeof window === 'undefined') return;
    if (id) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, nama: name ?? null }));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo<ActiveClientContextValue>(
    () => ({ clients, activeClientId, activeClientName, setActiveClient, loading, error, refresh }),
    [clients, activeClientId, activeClientName, setActiveClient, loading, error, refresh]
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
