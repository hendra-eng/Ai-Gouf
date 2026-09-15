// POST /api/session/logout -- hapus cookie httpOnly sesi login.
// Tidak perlu memberitahu backend (JWT bersifat stateless, tidak ada
// tabel sesi yang perlu dibersihkan) -- cukup hapus cookie di sisi
// browser supaya request berikutnya tidak lagi membawa token lama.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/session';

export async function POST() {
  const response = NextResponse.json({ status: 'success', message: 'Logout berhasil.' });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
