# Backend Python sudah menyatu dengan Dashboard (1 perintah)

Backend FastAPI kamu (`main.py`, `akuntansi_ai.py`, `modules/`, dll) sudah
ada di dalam folder `backend/` project ini. Backend TETAP Python — tidak
ditulis ulang. Yang disatukan cuma cara menjalankan & memanggilnya.

## Struktur sekarang

```
Dashboard/                 <- root project ini
├── backend/                <- backend FastAPI (dari backend_1_real.zip)
│   ├── main.py              <- entry point (uvicorn main:app)
│   ├── akuntansi_ai.py
│   ├── db_client.py
│   ├── modules/
│   ├── requirements.txt
│   └── ...
├── src/                     <- Next.js dashboard (tidak berubah)
├── package.json             <- sudah diubah, lihat "Cara jalanin"
└── next.config.mjs          <- sudah diubah, ada proxy /api/*
```

## Yang harus kamu lakukan (sekali saja)

1. **Install dependency Python backend:**
   ```bash
   cd backend
   pip install -r requirements.txt
   cd ..
   ```
2. **Buat file `.env` di dalam `backend/`** (tidak ikut ter-zip karena
   isinya rahasia/kredensial — DATABASE_URL, ANTHROPIC_API_KEY, JWT
   secret, dll — sesuaikan dengan yang biasa kamu pakai di
   `C:\migrasi-react\backend\.env`).
3. **Install dependency Node** (kalau belum):
   ```bash
   npm install
   ```
   (memasang `concurrently`, dipakai untuk menjalankan frontend+backend
   bersamaan)

## Cara jalanin

```bash
npm run dev
```

Ini menjalankan DUA proses sekaligus dalam SATU terminal (dibedakan
warna & label FRONTEND/BACKEND):
- `next dev -p 4028` → dashboard di `http://localhost:4028`
- `cd backend && uvicorn main:app --reload --port 8000` → backend FastAPI

Kamu tidak perlu lagi buka 2 terminal manual, dan tidak perlu isi
`NEXT_PUBLIC_API_BASE_URL` — semua request `/api/*` dari halaman
"Agent AI" otomatis diteruskan ke backend lewat proxy di
`next.config.mjs`.

## Kenapa terasa satu domain

`next.config.mjs` punya `rewrites()`:
```js
async rewrites() {
  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
  return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
}
```
`lib/api.js` (`src/app/agent-ai/lib/api.js`) `API_BASE_URL` default-nya
kosong `""`, jadi semua fetch jadi path relatif (`/api/...`) yang lewat
proxy ini. Browser cuma pernah memanggil domain dashboard kamu sendiri.

## Catatan tentang isi backend/ yang ikut ter-zip

- File contoh besar (`Contoh_File_Pdf/`, `data/vector_chunks.json` ~10MB,
  `ai_gouf.db`) ikut ter-copy apa adanya dari zip yang kamu upload — tidak
  aku hapus/ubah, cuma dipindah lokasinya.
- `.gitignore` sudah aku tambah aturan untuk `backend/` (skip `.env`,
  `*.db`, `__pycache__`, log) supaya kalau nanti kamu push ke git, file
  sensitif/besar itu tidak ikut ter-commit.
- Ada `backend/package.json` (Node/Express, terpisah dari
  `requirements.txt` Python) — sepertinya sisa scaffold lama yang tidak
  dipakai `main.py`. Aku biarkan apa adanya, tidak dihapus — beri tahu
  aku kalau ternyata memang tidak dipakai supaya bisa dibersihkan.

## Saat deploy ke production nanti

Backend tetap dijalankan sebagai proses Python terpisah di server yang
sama (via `pm2`/`systemd`/Docker, port 8000) — proxy `rewrites()` di atas
tetap menyembunyikannya di balik domain dashboard yang sama. Kalau
backend production dipindah ke domain lain sepenuhnya, set env var
`BACKEND_URL` di server Next.js.
