// POST /api/session/login -- "pintu depan" login dari sisi Next.js.
//
// Kenapa tidak langsung fetch POST /api/v1/auth/login dari browser?
// Karena access_token (JWT) hasilnya HARUS disimpan di cookie httpOnly
// (tidak bisa dibaca lewat document.cookie/localStorage -- mencegah XSS
// mencuri token) supaya lebih aman, dan cookie httpOnly HANYA bisa
// di-set oleh server, bukan JavaScript di browser. Jadi alurnya:
//
//   Browser -> POST /api/session/login (route ini, jalan di server Next.js)
//           -> POST {BACKEND_URL}/api/v1/auth/login (fetch server-to-server)
//           <- {access_token, expires_in_hours, user}
//   route ini set-cookie httpOnly berisi access_token, lalu balas ke
//   browser HANYA data user (TANPA access_token) -- token sendiri tidak
//   pernah terlihat oleh JavaScript di sisi client.
import { NextResponse } from 'next/server';
import { BACKEND_URL, SESSION_COOKIE_NAME } from '@/lib/session';

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', message: 'Payload tidak valid.' }, { status: 400 });
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) {
    return NextResponse.json(
      { status: 'error', message: 'Username dan password wajib diisi.' },
      { status: 400 },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Tidak bisa menghubungi server backend.' },
      { status: 502 },
    );
  }

  const payload = await backendRes.json().catch(() => null);
  const accessToken = payload?.data?.access_token;
  if (!backendRes.ok || typeof accessToken !== 'string') {
    return NextResponse.json(
      { status: 'error', message: payload?.message || 'Username atau password salah.' },
      { status: backendRes.status >= 400 ? backendRes.status : 401 },
    );
  }

  const expiresInHours = Number(payload?.data?.expires_in_hours) || 12;
  const response = NextResponse.json({
    status: 'success',
    message: payload?.message || 'Login berhasil.',
    data: { user: payload.data.user },
  });
  response.cookies.set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    // secure: process.env.NODE_ENV === 'production',
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInHours * 60 * 60,
  });
  return response;
}
