'use client';

// Badge angka di menu Sidebar. Datanya dihitung backend dari database untuk company aktif
// (backend/modules/management/nav_badges_v1.py) -- hanya hal yang perlu dicek orang
// (exception terbuka, jurnal menunggu review, invoice/bill jatuh tempo, stok di bawah minimum, dst).
// Menu yang tidak ada di hasil = tidak ada yang perlu dicek, jadi tidak diberi badge.

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createV1Api } from '@/lib/v1Api';
import { useActiveClient } from '@/lib/activeClient';

export interface NavBadge {
  count: number;
  /** warning = perlu dicek, negative = mendesak (mis. AR/AP telat > 60 hari, temuan pajak High). */
  severity: 'warning' | 'negative';
  /** Penjelasan singkat untuk tooltip, mis. "3 invoices overdue". */
  label: string;
}

interface NavBadgesResponse {
  as_of: string;
  badges: Record<string, NavBadge>;
}

/** Event yang bisa dipancarkan halaman setelah mengubah data, supaya badge dihitung ulang segera. */
export const NAV_BADGES_EVENT = 'nav-badges:changed';

const api = createV1Api('/api/v1/notifications', NAV_BADGES_EVENT);
const KOSONG: Record<string, NavBadge> = {};

export function refreshNavBadges() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAV_BADGES_EVENT));
}

export function useNavBadges(): Record<string, NavBadge> {
  const { activeClientId, hydrated } = useActiveClient();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['nav-badges', activeClientId],
    queryFn: ({ signal }) => api.get<NavBadgesResponse>('/nav-badges', { client_id: activeClientId as string }, signal),
    enabled: hydrated && !!activeClientId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    const onChange = () => queryClient.invalidateQueries({ queryKey: ['nav-badges'] });
    window.addEventListener(NAV_BADGES_EVENT, onChange);
    return () => window.removeEventListener(NAV_BADGES_EVENT, onChange);
  }, [queryClient]);

  // Gagal / belum ada client aktif -> tanpa badge (bukan angka palsu).
  return useMemo(() => data?.badges ?? KOSONG, [data]);
}
