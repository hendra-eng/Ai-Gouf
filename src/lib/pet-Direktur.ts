// "Direktur" AI penghuni kantor (Nova, Aria, Echo, ...): aturan kapan AI boleh keluar ruangan dan ke mana.
// Murni logika (tanpa Three.js / React) supaya bisa diuji sendiri; penghuniOtak.ts menjalankan keputusannya jadi gerakan, OfficeScene.tsx menggambar tubuh 3D-nya
// dan AgenticAIView.tsx yang membaca statusnya untuk bar profil.
//
// ATURAN (sesuai permintaan):
//  1. AI TIDAK duduk di kursi kerja kecuali sedang ada tugas (lihat src/lib/tugasAi.ts). Tanpa tugas = berdiri / jalan-jalan.
//  2. AI yang tidak punya tugas boleh keluar dari ruangannya kapan saja untuk berkunjung ke ruangan LAIN yang ia pilih sendiri.
//  3. TIDAK ADA pola tetap: tidak ada daftar "AI yang boleh keluar", tidak ada urutan, tidak ada ruangan tujuan yang ditentukan.
//     Siapa saja boleh keluar kapan saja, tujuan dipilih acak dari semua ruangan lain di gedung.
//  4. Satu-satunya syarat: ruangan asal tidak boleh kosong. Seorang AI hanya boleh keluar kalau masih ada AI penghuni LAIN
//     dari ruangan yang sama yang berada di dalam ruangan itu (tidak sedang keluar / dalam perjalanan).

export type RuangKunci = 'transactions' | 'ar' | 'ap' | 'perpus' | 'santai' | 'aset' | 'studio' | 'planning' | 'management';

// Semua ruangan di gedung yang boleh dikunjungi (termasuk Santai & Transactions yang tidak punya AI penghuni).
export const SEMUA_RUANG: RuangKunci[] = ['transactions', 'ar', 'ap', 'perpus', 'santai', 'aset', 'studio', 'planning', 'management'];

// AI penghuni per ruangan (sama dengan ai-roster.ts & PET_LOOK di OfficeScene.tsx).
export const PENGHUNI: Partial<Record<RuangKunci, string[]>> = {
  perpus: ['Nova', 'Aria', 'Echo'],
  aset: ['Axiom', 'Byte', 'Cipher', 'Delta'],
  studio: ['Flux', 'Gamma', 'Helix', 'Ion', 'Juno'],
  ar: ['Kilo', 'Lumen', 'Matrix'],
  ap: ['Nexus', 'Omni'],
  planning: ['Pixel', 'Quark', 'Radian', 'Sigma'],
  management: ['Tensor', 'Vector', 'Orion', 'Theta', 'Kappa', 'Omega'],
};

export const RUANG_ASAL: Record<string, RuangKunci> = (() => {
  const out: Record<string, RuangKunci> = {};
  for (const [r, daftar] of Object.entries(PENGHUNI) as [RuangKunci, string[]][]) for (const n of daftar) out[n] = r;
  return out;
})();

// Nama ruangan seperti tertulis di bar profil (RUANG_BOX / ai-roster.ts) -> kunci.
export const NAMA_RUANG_KE_KUNCI: Record<string, RuangKunci> = {
  Transactions: 'transactions',
  'Account Receivable': 'ar',
  'Account Payable': 'ap',
  Research: 'perpus',
  Santai: 'santai',
  Asset: 'aset',
  'Financial Statements': 'studio',
  Planning: 'planning',
  Management: 'management',
};

// duduk = bekerja di meja (ada tugas) | diam = berdiri santai | jalan = sedang berjalan | ngobrol = mengobrol dengan AI lain
export type FasePet = 'duduk' | 'diam' | 'jalan' | 'ngobrol';

export type InfoPet = {
  nama: string;
  asal: RuangKunci; // ruangan asal (tempat mejanya)
  lokasi: RuangKunci | null; // ruangan tempat AI berada sekarang (null = di lorong)
  fase: FasePet;
  tugas: boolean; // sedang diberi tugas -> harus duduk di mejanya
  keluar: boolean; // sudah memutuskan keluar / sedang di luar sampai kembali berdiri di ruangan asalnya
  tujuan: RuangKunci | null; // ruangan yang sedang dituju / dikunjungi
  tuanRumah: string | null; // nama AI yang sedang diajak mengobrol (kalau ini tamu)
  tamu: string | null; // nama AI tamu yang sedang mengunjungi (kalau ini tuan rumah)
};

const INFO: Record<string, InfoPet> = {};

export function daftarPet(nama: string): InfoPet {
  const asal = RUANG_ASAL[nama];
  let i = INFO[nama];
  if (!i) {
    i = INFO[nama] = { nama, asal, lokasi: asal, fase: 'diam', tugas: false, keluar: false, tujuan: null, tuanRumah: null, tamu: null };
  }
  return i;
}

export function hapusPet(nama: string): void {
  const i = INFO[nama];
  if (!i) return;
  // lepaskan pasangan ngobrol supaya tidak ada tamu / tuan rumah yang menunggu AI yang sudah tidak ada
  if (i.tamu && INFO[i.tamu]) INFO[i.tamu].tuanRumah = null;
  if (i.tuanRumah && INFO[i.tuanRumah]?.tamu === nama) INFO[i.tuanRumah].tamu = null;
  delete INFO[nama];
}

export const infoPet = (nama: string): InfoPet | undefined => INFO[nama];
export const semuaInfoPet = (): InfoPet[] => Object.values(INFO);

export function setLokasi(nama: string, lokasi: RuangKunci | null): void {
  const i = INFO[nama];
  if (i) i.lokasi = lokasi;
}
export function setFase(nama: string, fase: FasePet): void {
  const i = INFO[nama];
  if (i) i.fase = fase;
}

// Tugas diberikan / selesai. Tugas membatalkan semua rencana jalan-jalan: AI pulang ke mejanya lalu duduk.
export function setTugas(nama: string, ada: boolean): void {
  const i = INFO[nama];
  if (!i) return;
  i.tugas = ada;
  if (ada) {
    // batalkan obrolan yang sedang berlangsung / menunggu
    if (i.tamu && INFO[i.tamu]) INFO[i.tamu].tuanRumah = null;
    i.tamu = null;
    if (i.tuanRumah && INFO[i.tuanRumah]?.tamu === nama) INFO[i.tuanRumah].tamu = null;
    i.tuanRumah = null;
  }
}

// AI penghuni ruangan `asal` yang benar-benar masih ada di dalam ruangannya (belum / tidak sedang keluar).
// AI yang belum terdaftar (belum muncul di scene) dianggap masih ada di tempatnya.
export function jumlahDiRuangan(asal: RuangKunci, kecuali?: string): number {
  const daftar = PENGHUNI[asal] ?? [];
  let n = 0;
  for (const nm of daftar) {
    if (nm === kecuali) continue;
    const o = INFO[nm];
    if (!o || (!o.keluar && o.lokasi === asal)) n += 1;
  }
  return n;
}

// SYARAT UTAMA: boleh keluar hanya kalau tidak ada tugas, sedang berdiri santai di ruangannya, tidak sedang menerima tamu,
// DAN masih ada AI penghuni lain di dalam ruangan itu (ruangan tidak boleh kosong).
export function bolehKeluar(nama: string): boolean {
  const i = INFO[nama];
  if (!i) return false;
  if (i.tugas || i.keluar || i.tamu !== null || i.fase !== 'diam' || i.lokasi !== i.asal) return false;
  return jumlahDiRuangan(i.asal, nama) >= 1;
}

export function tandaiKeluar(nama: string, tujuan: RuangKunci): void {
  const i = INFO[nama];
  if (!i) return;
  i.keluar = true;
  i.tujuan = tujuan;
}
// Dipanggil saat AI sudah kembali berdiri di ruangan asalnya (atau duduk di mejanya).
export function tandaiPulang(nama: string): void {
  const i = INFO[nama];
  if (!i) return;
  i.keluar = false;
  i.tujuan = null;
  i.tuanRumah = null;
}

// Pilih ruangan tujuan SECARA ACAK dari semua ruangan lain (tidak ada ruangan tetap / urutan tetap per AI).
export function pilihRuangTujuan(dari: RuangKunci | null, rng: () => number = Math.random): RuangKunci {
  const kandidat = SEMUA_RUANG.filter((r) => r !== dari);
  return kandidat[Math.min(kandidat.length - 1, Math.floor(rng() * kandidat.length))];
}

// Cari AI di ruangan `ruang` yang bisa diajak mengobrol: penghuni ruangan itu yang sedang berdiri santai di dalamnya,
// belum punya tamu, dan tidak sedang bekerja. null kalau tidak ada (ruangan tanpa AI, atau semuanya sedang duduk / keluar).
export function pilihTuanRumah(ruang: RuangKunci, tamu: string, rng: () => number = Math.random): string | null {
  const kandidat = (PENGHUNI[ruang] ?? []).filter((n) => {
    const o = INFO[n];
    return !!o && n !== tamu && !o.tugas && !o.keluar && o.fase === 'diam' && o.lokasi === ruang && o.tamu === null;
  });
  if (!kandidat.length) return null;
  return kandidat[Math.min(kandidat.length - 1, Math.floor(rng() * kandidat.length))];
}

export function pasangTamu(tuanRumah: string, tamu: string): void {
  const h = INFO[tuanRumah];
  const t = INFO[tamu];
  if (!h || !t) return;
  h.tamu = tamu;
  t.tuanRumah = tuanRumah;
}
export function lepasTamu(tamu: string): void {
  const t = INFO[tamu];
  if (!t) return;
  const h = t.tuanRumah ? INFO[t.tuanRumah] : undefined;
  if (h && h.tamu === tamu) h.tamu = null;
  t.tuanRumah = null;
}

// Teks status untuk bar profil (AgenticAIView).
export function teksStatus(i: InfoPet): { teks: string; status: 'bekerja' | 'berjalan' | 'rapat' | 'santai' } {
  if (i.fase === 'duduk') return { teks: 'Bekerja di meja', status: 'bekerja' };
  if (i.fase === 'jalan') return { teks: 'Berjalan', status: 'berjalan' };
  if (i.fase === 'ngobrol') return { teks: 'Mengobrol', status: 'rapat' };
  return { teks: 'Santai', status: 'santai' };
}