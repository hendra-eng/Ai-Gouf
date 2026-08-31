"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as api from "../lib/api";

const ClientContext = createContext(null);
const STORAGE_KEY = "ai_gouf_active_client";

// [UBAH -- login dihilangkan] GET /api/client di backend TETAP di-guard
// Depends(auth.require_level(3)) di main.py, tapi backend sekarang
// selalu meloloskan request tanpa token sebagai user tahap_5 (lihat
// modules/auth.py::DEFAULT_USER_TANPA_LOGIN) -- jadi level-check
// frontend yang sebelumnya ada di sini (berdasarkan `user.role` dari
// AuthContext) sudah tidak relevan lagi & dicabut. Daftar client
// sekarang selalu di-fetch begitu provider ini mount.

/**
 * ClientProvider -- context GLOBAL untuk "klien yang sedang aktif".
 *
 * Kenapa ini perlu (bukan cuma dropdown per-halaman kayak sebelumnya):
 *   Firm ini pegang banyak klien sekaligus. Tanpa context global, tiap
 *   pipeline (Riwayat, Klarifikasi, Laporan Keuangan, Rekonsiliasi,
 *   Alert Anomali, dst -- total 15) harus punya dropdown pilih-klien
 *   sendiri-sendiri, dan gampang salah pilih klien di satu halaman tanpa
 *   sadar klien yang aktif di halaman lain beda.
 *
 * Cara kerja:
 *   1. Begitu user login, provider ini fetch daftar client (api.daftarClient()).
 *   2. User pilih klien lewat <ClientSwitcher /> (biasanya ditaruh di
 *      header/sidebar yang tampil di SEMUA halaman).
 *   3. Pilihan itu disimpan di sini (activeClient) DAN di localStorage,
 *      supaya tetap aktif walau di-refresh.
 *   4. Semua halaman pipeline tinggal panggil `useClient()` untuk baca
 *      `activeClientId` -- tidak perlu terima clientId lewat props lagi.
 *
 * PENTING (backend belum handle ini): saat ini TIDAK ada tabel relasi
 * maker <-> client di db_client.py, jadi context ini murni soal
 * kenyamanan navigasi (mana klien yang lagi dilihat), BUKAN pembatasan
 * akses. Kalau nanti perlu "maker A cuma boleh lihat client tertentu",
 * itu perlu endpoint & tabel baru di backend -- lihat catatan di PR ini.
 */
export function ClientProvider({ children }) {
  const [clients, setClients] = useState([]);
  const [activeClientId, setActiveClientId] = useState(null);
  const [activeClientName, setActiveClientName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Muat ulang daftar client dari server (dipanggil sekali saat mount,
  // dan bisa dipanggil manual lagi setelah tambah client baru).
  const muatDaftarClient = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // [FIX] GET /api/client (lihat main.py) membalas {"clients": [...]},
      // bukan array langsung -- sebelumnya kode ini salah set `clients`
      // ke objek pembungkusnya, bukan ke array di dalamnya.
      const res = await api.daftarClient();
      const daftar = res?.clients || [];
      setClients(daftar);

      // Kalau ada client aktif tersimpan dari sesi sebelumnya, pastikan
      // masih valid (belum dihapus) sebelum dipakai lagi.
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const { id, nama } = JSON.parse(saved);
          const masihAda = daftar.some((c) => c.id === id);
          if (masihAda) {
            setActiveClientId(id);
            setActiveClientName(nama);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (e) {
      setError(e.message || "Gagal memuat daftar client.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    muatDaftarClient();
  }, [muatDaftarClient]);

  const pilihClient = useCallback((id, nama) => {
    setActiveClientId(id);
    setActiveClientName(nama);
    if (id) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, nama }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = {
    clients,               // daftar semua client (buat dropdown)
    activeClientId,        // dipakai semua pipeline: api.xxx(activeClientId, ...)
    activeClientName,      // dipakai buat tampilan ("Sedang lihat: PT Maju Jaya")
    pilihClient,           // (id, nama) => void -- panggil ini dari ClientSwitcher
    loading,
    error,
    muatUlang: muatDaftarClient,
  };

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient harus dipakai di dalam <ClientProvider>");
  return ctx;
}