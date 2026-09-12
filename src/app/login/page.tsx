// [FIX] `useSearchParams()` dipakai di form login (untuk baca ?next=...
// setelah login sukses) — Next.js App Router MEWAJIBKAN komponen yang
// memanggil useSearchParams() dibungkus <Suspense> supaya halaman /login
// masih bisa di-prerender sebagai static shell (lihat pesan error build:
// "useSearchParams() should be wrapped in a suspense boundary"). Form asli
// (state, submit, JSX) dipindah utuh ke LoginForm.tsx (client component);
// file ini sekarang cuma pembungkus Suspense di sisi server.
import { Suspense } from 'react';
import LoginForm from './LoginForm';

function LoginFallback() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="text-sm text-slate-400">Memuat...</div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
