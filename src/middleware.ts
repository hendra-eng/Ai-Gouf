// Gerbang akses halaman dashboard -- jalan SEBELUM setiap request ke
// route yang cocok `config.matcher` di bawah. Tanpa ini, /login memang
// bisa memasang cookie httpOnly, tapi TIDAK ADA yang mencegah orang buka
// langsung "/" atau halaman dashboard lain tanpa login sama sekali.
//
// [PENTING] File ini WAJIB di src/middleware.ts, BUKAN middleware.ts di
// root -- karena project ini pakai struktur `src/app` (App Router di
// dalam src/), jadi Next.js hanya mengenali middleware yang ditaruh di
// level yang sama dengan `src/app`.
//
// Validasi dilakukan dengan memanggil backend GET /api/v1/auth/me
// (bukan verifikasi JWT manual di sini) supaya cuma ADA SATU tempat yang
// tahu cara validasi token (signature, kadaluarsa, dst) -- backend --
// dan tidak perlu duplikat JWT_SECRET_KEY di sisi Next.js.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { BACKEND_URL, SESSION_COOKIE_NAME } from '@/lib/session';

// Halaman yang boleh diakses TANPA login.
const PUBLIC_PAGE_PATHS = new Set(['/login']);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return redirectToLogin(request);
    }
  } catch {
    // Backend tidak bisa dihubungi -- anggap sesi tidak valid (fail
    // closed) daripada diam-diam membiarkan dashboard terbuka.
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/login') {
    loginUrl.searchParams.set('next', next);
  }
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export const config = {
  // Kecualikan: route /api/* (backend proxy & /api/session/* punya
  // pengaman sendiri-sendiri), file statis Next.js, dan aset publik.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf)$).*)',
  ],
};
