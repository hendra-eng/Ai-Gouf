"use client";
import { createContext, useContext, useEffect, useState } from "react";
import * as api from "../lib/api";

const AuthContext = createContext(null);
const STORAGE_KEY = "ai_gouf_session";

/**
 * AuthProvider -- pengganti st.session_state untuk data login.
 * Streamlit otomatis menyimpan session di server; di React kita simpan
 * di localStorage supaya user tidak perlu login ulang tiap refresh
 * (role: tahap_1..tahap_5 -- lihat seed_users.py).
 *
 * [FIX] api.js menyimpan token JWT di variabel memory biasa (_token),
 * yang otomatis hilang tiap kali halaman di-refresh. localStorage di
 * file ini menyimpan datanya lebih awet, tapi dulu tidak pernah
 * "menitipkan" token yang di-restore itu balik ke api.js -- jadi
 * setelah refresh, tampilan kelihatan tetap login, padahal semua
 * request ke backend diam-diam gagal (401) karena tidak ada header
 * Authorization. Baris api.simpanToken(...) di bawah ini yang
 * memperbaikinya.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // [BARU] true selama ~sekejap setelah login sukses -- dipakai
  // <LoginTransitionOverlay/> di App.jsx untuk animasi gelap->terang
  // saat berpindah dari Login ke tampilan dalam.
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setUser(data);
        api.simpanToken(data.token); // [FIX] pasang lagi token ke api.js setelah refresh
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const doLogin = async (username, password) => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.login(username, password); // api.login() sudah panggil simpanToken() sendiri
      setTransitioning(true); // nyalain overlay fade gelap SEBELUM setUser, biar keduanya kebatch bareng
      setUser(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      // durasi harus >= durasi animasi loginFadeDark di LoginTransitionOverlay.css (0.7s)
      window.setTimeout(() => setTransitioning(false), 700);
    } catch (e) {
      setError(e.message || "Login gagal.");
    } finally {
      setLoading(false);
    }
  };

  const doLogout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    api.logout(); // [FIX] hapus juga token di api.js, bukan cuma di localStorage
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, transitioning, login: doLogin, logout: doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}

// Label tahap -> peran, sesuai auth.role_label() di modules/auth.py
export const ROLE_LABELS = {
  tahap_1: "Junior Staff",
  tahap_2: "Senior Staff",
  tahap_3: "Supervisor",
  tahap_4: "Manager",
  tahap_5: "Partner / Direktur (Akses Penuh)",
};