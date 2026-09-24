// Gerbang akses halaman dashboard -- jalan SEBELUM setiap request ke
// route yang cocok `config.matcher` di bawah.
//
// [PERUBAHAN] Sebelumnya setiap navigasi memanggil backend
// GET /api/v1/auth/me secara langsung (cache: 'no-store') -- ini bikin
// TIAP pindah halaman menunggu satu round-trip network penuh ke backend,
// meskipun user baru saja divalidasi beberapa detik lalu. Sekarang hasil
// validasi di-cache singkat lewat cookie non-httpOnly `gouf_session_ok`
// (cuma berisi timestamp, BUKAN data sensitif) selama SESSION_CHECK_TTL_MS.
// Selama cache masih segar, middleware langsung `NextResponse.next()`
// tanpa network call sama sekali -- ini yang bikin pindah halaman terasa
// instan. Validasi asli (signature, expiry, dst) tetap SATU-SATUNYA di
// backend: begitu cache basi, atau saat data sungguhan di-fetch dari
// halaman manapun, backend tetap yang memutuskan token valid atau tidak.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { BACKEND_URL, SESSION_COOKIE_NAME } from '@/lib/session';

const PUBLIC_PAGE_PATHS = new Set(['/login']);

// Berapa lama hasil "token ini valid" boleh dipercaya tanpa cek ulang
// ke backend. 30 detik cukup untuk bikin navigasi antar halaman terasa
// instan, tapi tetap pendek -- kalau user di-logout paksa / token dicabut,
// paling lambat 30 detik baru kepental ke /login.
const SESSION_CHECK_TTL_MS = 30_000;
const SESSION_CHECK_COOKIE = 'gouf_session_ok';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  // Cache hit: masih dalam TTL -- skip network call, langsung lanjut.
  const checkedAtRaw = request.cookies.get(SESSION_CHECK_COOKIE)?.value;
  const checkedAt = checkedAtRaw ? Number(checkedAtRaw) : 0;
  const isCacheFresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < SESSION_CHECK_TTL_MS;

  if (isCacheFresh) {
    return NextResponse.next();
  }

  // Cache miss/basi: baru di sini kita benar-benar tanya backend.
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return redirectToLogin(request);
    }
  } catch {
    return redirectToLogin(request);
  }

  // Simpan hasil "valid" supaya navigasi 30 detik ke depan tidak perlu
  // network call lagi. Bukan httpOnly -- isinya cuma timestamp, tidak
  // ada data sensitif, jadi aman dibaca/ditulis dari mana saja.
  const response = NextResponse.next();
  response.cookies.set(SESSION_CHECK_COOKIE, String(Date.now()), {
    maxAge: Math.floor(SESSION_CHECK_TTL_MS / 1000),
    sameSite: 'lax',
    path: '/',
  });
  return response;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/login') {
    loginUrl.searchParams.set('next', next);
  }
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(SESSION_COOKIE_NAME);
  response.cookies.delete(SESSION_CHECK_COOKIE);
  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf)$).*)',
  ],
};