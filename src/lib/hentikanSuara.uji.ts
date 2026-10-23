// hentikanSuara.uji.ts — jalankan:  npx tsx src/lib/hentikanSuara.uji.ts
import { bacaBerhenti } from './hentikanSuara';
import {
  CONTOH_BERHENTI, CONTOH_BUKAN_BERHENTI, CONTOH_BUKAN_BERHENTI_BARU, CONTOH_BERHENTI_TAPI_ADA_PERTANYAAN, CONTOH_GEMA, buatKombinasi,
} from './hentikanSuara.contoh';

declare const process: { exit(code?: number): never };
let gagal = 0;
let total = 0;
const lapor = (pesan: string) => { gagal++; console.log('  GAGAL:', pesan); };

console.log('1) Harus BERHENTI');
for (const [kategori, daftar] of Object.entries(CONTOH_BERHENTI)) {
  let salah = 0;
  for (const k of daftar) {
    total++;
    const h = bacaBerhenti(k);
    if (!h.berhenti) { salah++; lapor(`[${kategori}] "${k}" tidak dikenali`); }
  }
  console.log(`  ${kategori}: ${daftar.length - salah}/${daftar.length}`);
}
const kombinasi = buatKombinasi();
let salahKombinasi = 0;
for (const k of kombinasi) { total++; if (!bacaBerhenti(k).berhenti) { salahKombinasi++; lapor(`[kombinasi] "${k}"`); } }
console.log(`  kombinasi otomatis: ${kombinasi.length - salahKombinasi}/${kombinasi.length}`);

console.log('2) Harus BUKAN berhenti');
const SEMUA_BUKAN = [...CONTOH_BUKAN_BERHENTI, ...CONTOH_BUKAN_BERHENTI_BARU];
let salahBukan = 0;
for (const k of SEMUA_BUKAN) { total++; if (bacaBerhenti(k).berhenti) { salahBukan++; lapor(`"${k}" salah dianggap berhenti`); } }
console.log(`  ${SEMUA_BUKAN.length - salahBukan}/${SEMUA_BUKAN.length}`);

console.log('3) Berhenti + permintaan baru (tidak murni)');
for (const k of CONTOH_BERHENTI_TAPI_ADA_PERTANYAAN) {
  total++;
  const h = bacaBerhenti(k);
  if (!h.berhenti || h.murni) lapor(`"${k}" -> ${JSON.stringify(h)} (harusnya berhenti=true, murni=false)`);
}

console.log('4) Ajakan berhenti murni tidak dikirim ke AI');
for (const k of ['stop', 'oke udah itu aja cukup', 'kamu menjelaskannya kepanjangan', 'stop disana', 'aku sudah paham neo', 'jangan dilanjutkan']) {
  total++;
  const h = bacaBerhenti(k);
  if (!h.berhenti || !h.murni) lapor(`"${k}" -> ${JSON.stringify(h)} (harusnya murni)`);
}

console.log('5) Gema Neo sendiri diabaikan, tapi "stop"/"neo" tetap lolos');
for (const g of CONTOH_GEMA) { total++; if (bacaBerhenti(g.terdengar, g.neo).berhenti) lapor(`gema "${g.terdengar}" salah dianggap perintah`); }
const neoBicara = 'Saldo kas sudah cukup untuk membayar gaji. Mohon tunggu sebentar, aku ambil datanya.';
for (const k of ['stop', 'neo cukup', 'oke udah itu aja cukup', 'tunggu dulu neo', 'berhenti']) {
  total++;
  if (!bacaBerhenti(k, neoBicara).berhenti) lapor(`"${k}" tidak lolos saat Neo bicara`);
}

console.log(`\nTotal pengujian: ${total}, gagal: ${gagal}`);
process.exit(gagal ? 1 : 0);