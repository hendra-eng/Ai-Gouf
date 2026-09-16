'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import AppLogo from '@/components/ui/AppLogo';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.status !== 'success') {
        throw new Error(payload?.message || 'Login gagal.');
      }
      await refresh();
      const next = searchParams.get('next') || '/';
      router.replace(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-card">
        <div className="mb-8 flex flex-col items-center text-center">
          <AppLogo size={48} className="mb-4" />
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Gouf Consulting</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Masuk ke Accounting</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Gunakan username &amp; password akun kamu untuk membuka dashboard.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-10 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="rounded-lg border border-negative/30 bg-negative-subtle px-3 py-2 text-sm text-negative">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Memeriksa...' : 'Masuk'}
          </button>
        </form>
      </section>
    </main>
  );
}
