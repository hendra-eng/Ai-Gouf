import { Inter } from 'next/font/google';

// Font bersama untuk tab Overview & Source Data (halaman Sales).
// Inter: netral, sangat terbaca di tabel padat, angka bisa tabular (rata) --
// serasi dengan desain monokrom (abu + hitam). Ganti di sini untuk mengubah
// font kedua tab sekaligus.
export const salesFont = Inter({ subsets: ['latin'], display: 'swap' });