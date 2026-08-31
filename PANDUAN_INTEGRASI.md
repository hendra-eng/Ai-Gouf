# Panduan Integrasi "Agent AI" ke Dashboard Finova AI

Ini hasil migrasi **frontend** halaman chat AI (project React+Vite "AI Gouf
Consulting") ke dalam project **Next.js** kamu (Finova AI), supaya muncul
saat menu **"Agent AI"** di sidebar diklik.

Backend/API BELUM disambungkan — tampilan akan muncul penuh, tapi fitur
yang butuh server (login, kirim chat, upload file, dst) akan gagal
memanggil API sampai kamu isi `NEXT_PUBLIC_API_BASE_URL` (lihat langkah 4).

## 1. Salin folder ke project kamu

Struktur di dalam zip ini **sudah PERSIS** mengikuti struktur folder
project Next.js kamu. Cukup extract & timpa/gabungkan ke root project:

```
Dashboard/                          <- root project Next.js kamu
├── public/
│   └── agent-ai/
│       └── logo-gouf-icon-cyan.png        <- BARU
└── src/
    └── app/
        └── agent-ai/                      <- FOLDER BARU, seluruhnya
            ├── page.tsx                   <- route "/agent-ai"
            ├── AgentAIView.tsx            <- wrapper full-height
            ├── AgentAIChat.jsx            <- hasil porting ChatPage.jsx
            ├── theme.css                  <- dark theme, sudah di-scope
            ├── components/                <- 10 file .jsx + .css
            ├── context/                   <- AuthContext.jsx, ClientContext.jsx
            └── lib/                       <- api.js, documentTypes.js
```

Tidak ada file project Next.js kamu yang tertimpa — semuanya folder/file
BARU. `Sidebar.tsx` kamu **TIDAK PERLU diubah** karena menu "Agent AI"
(href `/agent-ai`) ternyata sudah ada di sana sejak awal.

## 2. Install dependency yang belum ada

Cek `package.json` project Next.js kamu — semua dependency yang dipakai
kode hasil migrasi ini (`react`, `react-dom`) sudah ada. Tidak ada
package baru yang perlu ditambah untuk tahap frontend ini.

## 3. Jalankan

```bash
npm run dev
```

Buka `http://localhost:4028/agent-ai`, atau klik menu **"Agent AI"** di
sidebar dashboard. Kamu akan melihat tampilan chat gelap (dark theme)
seperti screenshot project aslinya, di dalam layout dashboard Finova AI
(Sidebar & Topbar Next.js tetap tampil di kiri/atas).

## 4. Sambungkan ke backend (langkah selanjutnya, belum dilakukan)

Saat backend FastAPI project "AI Gouf Consulting" sudah siap & bisa
diakses, buat file `.env.local` di root project Next.js:

```
NEXT_PUBLIC_API_BASE_URL=https://alamat-backend-kamu.com
```

Tanpa ini, `lib/api.js` otomatis fallback ke `http://localhost:8000`
(cocok untuk development lokal kalau backend dijalankan di komputer yang
sama).

## Apa saja yang disesuaikan dari kode aslinya (Vite -> Next.js)

Logika/behavior komponen **TIDAK diubah** — hanya bagian yang memang
beda antara Vite dan Next.js:

| Yang diubah | Alasan |
|---|---|
| Semua import path (`../lib/api` dst) diubah relatif ke folder `agent-ai/` | Struktur folder pindah dari project Vite terpisah ke dalam `src/app/agent-ai/` |
| `Sidebar.jsx` -> `AgentSidebar.jsx` | Supaya tidak bentrok nama dengan `Sidebar.tsx` milik dashboard Finova AI (keduanya punya fungsi beda: `AgentSidebar` = riwayat obrolan, `Sidebar.tsx` = menu navigasi utama dashboard) |
| Semua komponen ditambah `"use client"` | Next.js App Router defaultnya Server Component; komponen ini pakai `useState`/`useEffect` jadi wajib ditandai client component |
| `import.meta.env.VITE_API_BASE_URL` -> `process.env.NEXT_PUBLIC_API_BASE_URL` | Cara Next.js membaca environment variable beda dengan Vite |
| Logo (`logo-gouf-icon-cyan.png`) dipindah ke `public/agent-ai/`, dipakai sebagai string path langsung | Import gambar statis di Next.js menghasilkan object `{src, width, height}`, bukan string URL langsung seperti di Vite — kalau dipaksa dipakai di `<img src=...>` biasa akan rusak |
| `theme.css` ditulis ulang, semua selector diberi awalan `.agent-ai-root` | Versi asli pakai selector global (`html`, `body`, `h1`, `a`, `.btn`, dst) yang tanpa di-scope akan **menimpa styling seluruh halaman dashboard lain** (Overview, Transactions, dll), bukan cuma halaman Agent AI |
| `AuthProvider` & `ClientProvider` dipasang lokal di dalam `AgentAIChat.jsx` | Di project Vite aslinya keduanya dipasang sekali di root `App.jsx` untuk semua halaman; di sini dipasang lokal supaya halaman Agent AI tetap berfungsi mandiri tanpa mengubah `layout.tsx` dashboard kamu |
| `App.jsx`, `Sidebar.jsx` (nav utama), `TopNavbar.jsx`, `ClientSwitcher.jsx`, `LoginPage.jsx`, dan 14 halaman lain (`DashboardPage`, `LaporanKeuanganPage`, `RekonsiliasiPage`, dst) dari project Vite **BELUM diporting** | Di luar scope permintaan sekarang (cuma halaman chat "Agent AI" yang diminta tampil dulu). `Sidebar.tsx`/`Topbar.tsx` project Vite juga fungsinya sudah digantikan versi Next.js kamu |

## Catatan / hal yang perlu kamu cek sendiri

- **`tsconfig.json`** project kamu tidak ikut diupload ke aku, jadi aku
  tidak bisa pastikan `"allowJs": true` sudah aktif (dibutuhkan supaya
  Next.js/TypeScript bisa import file `.jsx`/`.js` seperti
  `AgentAIChat.jsx` dari `AgentAIView.tsx`). Ini adalah **default**
  bawaan `create-next-app`, jadi kemungkinan besar sudah otomatis aktif.
  Kalau muncul error "Cannot find module './AgentAIChat'" saat `npm run
  dev`, cek `tsconfig.json` dan pastikan `"allowJs": true`.
- Login (`AuthContext`) & pemilihan client (`ClientContext`) di halaman
  Agent AI ini **terpisah** dari sistem apa pun yang mungkin sudah ada
  di dashboard Next.js kamu (kalau ada) — keduanya baru akan benar-benar
  berfungsi setelah backend tersambung.
- Halaman ini pakai `localStorage` (untuk sesi login & client aktif) --
  aman dipakai di Next.js karena hanya dipanggil di dalam
  `useEffect`/event handler (browser-side), bukan saat render server.

## Sebelum backend disambungkan (fitur yang expected belum jalan)

Karena ini migrasi frontend dulu, hal berikut WAJAR belum bisa dipakai
sampai `NEXT_PUBLIC_API_BASE_URL` diisi & backend online:
- Kirim pesan chat / upload file (akan muncul pesan error "Failed to
  fetch" dari `lib/api.js`)
- Badge status "AI DeepSeek" / "AI Claude" di sidebar (default nonaktif)
- Riwayat percakapan di sidebar (kosong)
- Login

Tampilan (layout, warna, animasi, komponen) semuanya sudah bisa dilihat
sekarang tanpa backend.
