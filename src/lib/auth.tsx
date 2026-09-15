'use client';

// Context user yang sedang login -- dibaca lewat GET /api/session/me
// (bukan dari localStorage/cookie langsung, karena token JWT-nya sendiri
// disimpan di cookie httpOnly & sengaja TIDAK bisa dibaca dari JS).
// Dipakai Topbar.tsx untuk menampilkan nama/role user yang login, dan
// oleh tombol "Log out".
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface SessionUser {
  id: number;
  username: string;
  role: string;
  role_label: string;
  nama: string | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session/me', { cache: 'no-store' });
      const payload = await res.json().catch(() => null);
      setUser(res.ok && payload?.data ? (payload.data as SessionUser) : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/session/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() harus dipakai di dalam <AuthProvider>.');
  }
  return ctx;
}

// Dipakai Topbar & Sidebar untuk avatar bulat "AB" dari nama/username
// user yang login -- satu tempat supaya keduanya selalu konsisten.
export function userInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}
