// tabSuara.ts — dipakai halaman yang tab-nya berbasis state supaya bisa dipindah lewat suara Neo
// ("buka tab percakapan di halaman memori ai").
// - Halaman dibuka dari halaman lain: Neo membuka URL ...?tab=kunci -> dibaca saat komponen tampil.
// - Sudah di halaman itu: komponen tidak dimuat ulang, jadi Neo mengirim event 'neo-tab'.
// Pakai: useTabSuara(['ingatan', 'percakapan'], (k) => setTab(k as TipeTab));
import { useEffect } from 'react';

export function useTabSuara(kunciValid: readonly string[], pilihTab: (kunci: string) => void) {
  useEffect(() => {
    const valid = (k: unknown): k is string => typeof k === 'string' && kunciValid.includes(k);
    const dariUrl = new URLSearchParams(window.location.search).get('tab');
    if (valid(dariUrl)) pilihTab(dariUrl);
    const h = (e: Event) => {
      const k = (e as CustomEvent).detail?.tab;
      if (valid(k)) pilihTab(k);
    };
    window.addEventListener('neo-tab', h);
    return () => window.removeEventListener('neo-tab', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}