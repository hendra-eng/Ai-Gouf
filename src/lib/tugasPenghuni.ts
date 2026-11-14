// Nama lain untuk src/lib/tugasAi.ts (satu penyimpanan tugas saja, supaya tidak ada dua daftar tugas yang saling bertentangan).
// Kode baru sebaiknya langsung memakai berikanTugasAI / selesaiTugasAI dari '@/lib/tugasAi'.
//   berikanTugasPenghuni('Nova');   // Nova duduk di mejanya (tetap berlaku setelah refresh, kadaluarsa otomatis)
//   selesaiTugasPenghuni('Nova');   // Nova berdiri lagi
// Uji tanpa backend: buka halaman dengan ?kerja=Nova,Byte,Tensor (nama dipisah koma).

import { EVENT_TUGAS_AI, DURASI_KERJA_AI_MS, berikanTugasAI, selesaiTugasAI, tugasAISaatIni, tugasAIDariUrl } from './tugasAi';

export const EVENT_TUGAS_PENGHUNI = EVENT_TUGAS_AI;
export const DURASI_TUGAS_PENGHUNI_MS = DURASI_KERJA_AI_MS;
export const berikanTugasPenghuni = berikanTugasAI;
export const selesaiTugasPenghuni = selesaiTugasAI;
export const tugasPenghuniSaatIni = tugasAISaatIni;
export const tugasPenghuniDariUrl = tugasAIDariUrl;