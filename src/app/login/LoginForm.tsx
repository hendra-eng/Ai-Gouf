'use client';

import React, { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpenCheck, Eye, EyeOff, Landmark, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import AppLogo from '@/components/ui/AppLogo';

// Poin keunggulan di panel merek (kiri, desktop).
const FITUR: { icon: React.ElementType; label: string }[] = [
  { icon: BookOpenCheck, label: 'General ledger & financial statements in real time' },
  { icon: Landmark, label: 'Bank feed reconciliation and cash management' },
  { icon: ShieldCheck, label: 'Period locking and role-based access per client' },
];

const inputCls =
  'w-full rounded-lg border border-border bg-white px-3 py-2.5 text-foreground outline-none transition-shadow placeholder:text-slate-400 focus:border-[#0F7D4E] focus:ring-4 focus:ring-[#0F7D4E]/15';

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
        throw new Error(payload?.message || 'Login failed.');
      }
      await refresh();
      const next = searchParams.get('next') || '/';
      router.replace(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen bg-[#F4FBF7]">
      {/* Panel merek (desktop) — hijau tua senada sidebar */}
      <aside
        className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: 'linear-gradient(150deg, #0E2F26 0%, #0B4A3A 55%, #0B5E5C 100%)' }}
      >
        <GridPattern />
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#22C55E] opacity-20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-[#0F7D4E] opacity-40 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <AppLogo size={40} />
          <span className="text-xl font-bold tracking-tight">zafeb</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Accounting that keeps your books <span className="text-[#4ADE80]">clear</span> and current.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Journals, financial statements, tax and cash in one workspace for every client you manage.
          </p>
          <ul className="mt-8 space-y-3.5 text-sm text-white/85">
            {FITUR.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                  <Icon size={16} className="text-[#4ADE80]" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} zafeb. All rights reserved.</p>
      </aside>

      {/* Area form — latar mint lembut + gradasi & pola titik */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60rem 30rem at 100% 0%, rgba(34,197,94,0.16), transparent 60%), radial-gradient(50rem 28rem at 0% 100%, rgba(11,94,92,0.14), transparent 60%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(rgba(15,125,78,0.2) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          }}
        />

        <div className="relative w-full max-w-md rounded-2xl border border-[#D1FAE5] bg-white/95 p-8 shadow-[0_20px_60px_-20px_rgba(14,47,38,0.35)] backdrop-blur sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <AppLogo src="/assets/images/zafeb-logo.png" size={112} />
            <h1 className="mt-2 text-xl font-semibold text-foreground">Welcome back</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in with your username &amp; password to open the dashboard.
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
                placeholder="Enter your username"
                className={inputCls}
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
                  placeholder="Enter your password"
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold text-white shadow-md shadow-[#0F7D4E]/25 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #0F7D4E 0%, #0B5E5C 100%)' }}
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Signing in...</> : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={12} /> Secure session · Access limited to registered users
          </p>
        </div>
      </section>
    </main>
  );
}

/** Pola grid halus di panel merek. */
function GridPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden="true">
      <defs>
        <pattern id="zafeb-grid" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M44 0H0V44" fill="none" stroke="white" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#zafeb-grid)" />
    </svg>
  );
}
