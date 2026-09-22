// Nama cookie httpOnly tempat access_token (JWT) dari
// POST /api/v1/auth/login disimpan. Dipakai bersama oleh route handler
// di src/app/api/session/* DAN middleware.ts (root) -- taruh di sini
// supaya keduanya selalu pakai nama yang sama.
export const SESSION_COOKIE_NAME = 'gouf_session';

// Backend FastAPI (uvicorn) -- sama seperti yang dipakai next.config.mjs
// untuk proxy /api/*, tapi route handler di sini butuh nilainya sendiri
// karena mereka memanggil backend LANGSUNG (server-to-server), bukan
// lewat rewrite proxy milik browser.
export const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
