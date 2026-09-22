// GET /api/session/me -- profil user yang sedang login, dibaca dari
// cookie httpOnly (tidak bisa diakses langsung lewat JS di browser).
// Dipakai src/lib/auth.tsx (AuthProvider) supaya UI (mis. Topbar) tahu
// nama/role user yang login tanpa pernah menyentuh token JWT-nya sendiri.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BACKEND_URL, SESSION_COOKIE_NAME } from '@/lib/session';

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ status: 'error', message: 'Belum login.' }, { status: 401 });
  }

  const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);

  if (!backendRes || !backendRes.ok) {
    const response = NextResponse.json({ status: 'error', message: 'Sesi tidak valid atau kadaluarsa.' }, { status: 401 });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  const payload = await backendRes.json();
  return NextResponse.json(payload);
}
