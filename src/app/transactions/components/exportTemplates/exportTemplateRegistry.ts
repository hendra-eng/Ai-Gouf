// [BARU] Peta "client aktif -> template export Excel yang dipakai".
//
// Dicocokkan lewat NAMA client (bukan id) karena di percakapan user cuma
// menyebut nama perusahaan ("PT Sumber Alodie Utama"), belum id numerik
// aslinya dari backend. Kalau nanti mau lebih pasti (tahan ganti nama
// client), tinggal tambah pencocokan lewat `clientId` juga — lihat
// `CLIENT_EXPORT_TEMPLATE_BY_ID` di bawah.
//
// Client yang TIDAK ada di daftar ini otomatis tetap pakai template GL
// default (GL_TEMPLATE 85 kolom, lihat exportTransactionsExcel.ts) — jadi
// aman ditambah client baru kapan saja tanpa merusak yang sudah ada.

export type ExportTemplateKey = 'gl_default' | 'sau_cash_journal';

/** Cocokkan lewat nama client (dibandingkan tanpa peduli besar/kecil huruf & spasi ganda). */
const CLIENT_EXPORT_TEMPLATE_BY_NAME: Record<string, ExportTemplateKey> = {
  'pt sumber alodie utama': 'sau_cash_journal',
};

/** Cocokkan lewat id client asli dari backend — isi di sini kalau sudah tahu id-nya, lebih tahan ganti nama. */
const CLIENT_EXPORT_TEMPLATE_BY_ID: Record<string, ExportTemplateKey> = {
  // '12': 'sau_cash_journal',
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveExportTemplate(clientId?: string | null, clientName?: string | null): ExportTemplateKey {
  if (clientId && CLIENT_EXPORT_TEMPLATE_BY_ID[clientId]) {
    return CLIENT_EXPORT_TEMPLATE_BY_ID[clientId];
  }
  if (clientName && CLIENT_EXPORT_TEMPLATE_BY_NAME[normalizeName(clientName)]) {
    return CLIENT_EXPORT_TEMPLATE_BY_NAME[normalizeName(clientName)];
  }
  return 'gl_default';
}