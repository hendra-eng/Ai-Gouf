// Tugas AI penghuni kantor (Nova, Aria, Echo, Axiom, ... — lihat src/app/agentic-ai/ai-roster.ts).
// Pola sama dengan tugasKantor.ts (Neo / Atlas / Zeno): tugas disimpan dengan waktu berakhir ABSOLUT, jadi tetap berlaku
// setelah refresh, dan tugas yang sudah lewat waktu otomatis dianggap selesai (tidak ada "tugas hantu").
//
// AI HANYA duduk di mejanya selama ada tugas di sini. Tanpa tugas, AI berdiri santai di ruangannya dan boleh berkunjung
// ke ruangan lain (lihat src/app/agentic-ai/pet-direktur.ts). Halaman Agentic AI hanya mendengarkan EVENT_TUGAS_AI.
//
// CARA MEMBERI TUGAS (dari bagian mana pun di aplikasi, mis. saat backend / agen memulai pekerjaan untuk AI itu):
//   import { berikanTugasAI, selesaiTugasAI } from '@/lib/tugasAI';
//   berikanTugasAI('Nova');            // Nova pulang ke mejanya & duduk (maksimal DURASI_KERJA_AI_MS)
//   selesaiTugasAI('Nova');            // Nova bangun & kembali santai
// Untuk uji cepat tanpa backend: buka halaman Agentic AI dengan ?kerja=Nova,Aria (kedua AI itu duduk bekerja).

export const EVENT_TUGAS_AI = 'kantor-tugas-ai';
export const DURASI_KERJA_AI_MS = 120000;
const KUNCI_SIMPAN = 'kantor-tugas-ai-v1';

// nama AI -> waktu berakhir (epoch ms)
const tugas: Record<string, number> = {};
const timer: Record<string, ReturnType<typeof setTimeout>> = {};
let sudahMuat = false;

const adaWindow = () => typeof window !== 'undefined';

function simpan(): void {
  if (!adaWindow()) return;
  try {
    window.localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(tugas));
  } catch {
    /* penyimpanan penuh / diblokir: state tetap jalan di memori */
  }
}

function umumkan(): void {
  if (!adaWindow()) return;
  window.dispatchEvent(new CustomEvent(EVENT_TUGAS_AI));
}

function jadwalkan(nama: string): void {
  if (timer[nama]) clearTimeout(timer[nama]);
  const sisa = tugas[nama] - Date.now();
  if (!(sisa > 0)) {
    delete tugas[nama];
    return;
  }
  // setTimeout maksimum ~24 hari; durasi tugas jauh di bawah itu
  timer[nama] = setTimeout(() => {
    delete timer[nama];
    if (tugas[nama] !== undefined && tugas[nama] <= Date.now()) {
      delete tugas[nama];
      simpan();
      umumkan();
    }
  }, Math.min(sisa + 50, 2147483000));
}

function muat(): void {
  if (sudahMuat || !adaWindow()) return;
  sudahMuat = true;
  try {
    const mentah = window.localStorage.getItem(KUNCI_SIMPAN);
    if (!mentah) return;
    const data = JSON.parse(mentah) as Record<string, unknown>;
    const kini = Date.now();
    for (const [nama, berakhir] of Object.entries(data)) {
      if (typeof berakhir === 'number' && Number.isFinite(berakhir) && berakhir > kini) {
        tugas[nama] = berakhir;
        jadwalkan(nama);
      }
    }
  } catch {
    /* data rusak: abaikan */
  }
}

function bersihkanKadaluarsa(): void {
  const kini = Date.now();
  let berubah = false;
  for (const nama of Object.keys(tugas)) {
    if (tugas[nama] <= kini) {
      delete tugas[nama];
      berubah = true;
    }
  }
  if (berubah) simpan();
}

// Daftar nama AI yang sedang punya tugas (harus duduk di mejanya).
export function tugasAISaatIni(): string[] {
  muat();
  bersihkanKadaluarsa();
  return Object.keys(tugas);
}

export function berikanTugasAI(nama: string, durasiMs: number = DURASI_KERJA_AI_MS): void {
  muat();
  tugas[nama] = Date.now() + Math.max(1000, durasiMs);
  jadwalkan(nama);
  simpan();
  umumkan();
}

export function selesaiTugasAI(nama: string): void {
  muat();
  if (timer[nama]) {
    clearTimeout(timer[nama]);
    delete timer[nama];
  }
  if (tugas[nama] === undefined) return;
  delete tugas[nama];
  simpan();
  umumkan();
}

// Uji cepat tanpa backend: ?kerja=Nova,Aria (atau ?tugaspenghuni=...) -> AI itu duduk bekerja selama halaman terbuka.
export function tugasAIDariUrl(): string[] {
  if (!adaWindow()) return [];
  const q = new URLSearchParams(window.location.search);
  const v = q.get('kerja') ?? q.get('tugaspenghuni');
  return v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
}