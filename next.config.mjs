import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  distDir: process.env.DIST_DIR || '.next',
  // [BARU] Proxy semua /api/* dari Next.js ke backend FastAPI (jalan di
  // localhost:8000). Dengan ini browser cuma pernah memanggil domain
  // dashboard kamu sendiri (mis. yourapp.com/api/...) -- backend Python
  // tidak pernah terlihat sebagai server terpisah, walau di belakang
  // layar tetap 2 proses (Next.js port 3000/4028 + uvicorn port 8000).
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  // [BARU] Next.js membuffer body request di memori saat di-proxy lewat
  // rewrites() di atas (fitur "proxy" internal Next 15+), dengan batas
  // default HANYA 10MB -- kalau dilewati, body dipotong lalu koneksi ke
  // backend putus ("socket hang up"), yang tampil ke user cuma
  // "Server membalas status 500" generik (bukan pesan error asli, karena
  // request-nya sendiri tidak pernah utuh sampai ke FastAPI). Ini yang
  // kejadian waktu upload PDF "Data Penjualan Detail" > 10MB dari modal
  // import di halaman Expense.
  // [DIUBAH] Dinaikkan ke 2GB (dari 50MB sebelumnya) atas permintaan user
  // supaya upload besar apa pun (Excel/PDF berhalaman ribuan) tidak lagi
  // kena limit ini. CATATAN: angka ini dibatasi RAM server, BUKAN backend
  // -- Next.js buffer SELURUH body ini ke memori sebelum diteruskan ke
  // FastAPI (lihat docs resminya), jadi makin besar limitnya, makin besar
  // pula RAM yang terpakai KALAU ada file sebesar itu benar-benar
  // diupload. Backend FastAPI/Starlette sendiri (lihat /api/proses-file di
  // backend/main.py) tidak punya batas ukuran file bawaan -- dia streaming
  // ke disk, bukan Next.js layer ini yang jadi bottleneck-nya. Turunkan
  // lagi angka ini kalau server sering kehabisan RAM saat upload besar.
  // Nama opsi ini `middlewareClientMaxBodySize` di Next.js 15.x -- versi
  // Next yang lebih baru menamainya `proxyClientMaxBodySize`.
  experimental: {
    middlewareClientMaxBodySize: '2gb',
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
    qualities: [75, 85, 100],
  },
  webpack(
    config,
    {
      dev: dev
    }
  ) {
    if (dev) {
      config.module.rules.push({
        test: /\.(jsx|tsx)$/,
        exclude: [/node_modules/],
        use: [{
          loader: '@dhiwise/component-tagger/nextLoader',
        }],
      });
      const ignoredPaths = (process.env.WATCH_IGNORED_PATHS || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      config.watchOptions = {
        ignored: ignoredPaths.length
          ? ignoredPaths.map((p) => `**/${p.replace(/^\/+|\/+$/g, '')}/**`)
          : undefined,
      };
    }
    return config;
  },
};
export default nextConfig;