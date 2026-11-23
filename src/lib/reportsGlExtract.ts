// Pengisi kolom tambahan sheet GL dari data transaksi yang SUDAH ADA di aplikasi (tanpa AI, tanpa menebak):
//   D  Bank              nama akun, hanya untuk baris akun bank
//   M  Payment ID        hanya bila tertulis eksplisit di keterangan ("Payment ID: ...", "Pay No ...")
//   N  Order ID          hanya bila tertulis eksplisit ("Order ID: ...", "Order #...")
//   R  Refund            "Refund" bila keterangan menyebut refund / pengembalian dana / retur penjualan
//   T  No Kamar/No Rekon hanya bila tertulis ("Kamar 205", "Room 12B")
// Kolom rekonsiliasi (rekon, selisih, Rekon Pendapatan, NOMINAL, LOOKUP, Check) sengaja TIDAK diisi: datanya dari luar
// aplikasi (rekening koran / laporan PMS). Kolom reklass (AB-AD) butuh keputusan akuntan.
// Semua sel hasil ekstraksi diberi latar biru muda (sama seperti Isi AI) supaya direview.

export interface GlExtra { idx: number; col: number; value: string }

export const GL_COL_BANK = 4;
export const GL_COL_PAYMENT = 13;
export const GL_COL_ORDER = 14;
export const GL_COL_REFUND = 18;
export const GL_COL_ROOM = 20;

// ID harus mengandung minimal 1 angka supaya kata biasa ("Payment for ...") tidak ikut terambil.
const ID = String.raw`(?=[A-Z0-9\-\/_]*\d)([A-Z0-9][A-Z0-9\-\/_]{2,})`;
const PAYMENT_RE = new RegExp(String.raw`\b(?:payment|pay|pmt)\b\s*(?:id|no|number|ref)?\s*[:#.\-]?\s*${ID}`, 'i');
const ORDER_RE = new RegExp(String.raw`\border\b\s*(?:id|no|number)?\s*[:#.\-]?\s*${ID}`, 'i');
const ROOM_RE = /\b(?:no\.?\s*kamar|kamar|room|rm)\s*[:#.\-]?\s*(\d{1,4}[A-Z]?)\b/i;
const REFUND_RE = /\b(refund|pengembalian\s+dana|retur\s+penjualan|chargeback)\b/i;
const BANK_NAME_RE = /\b(bank|bca|bni|bri|mandiri|cimb|permata|danamon|ocbc|maybank|btn|btpn)\b/i;
const NOT_BANK_RE = /piutang|receivable|utang|hutang|payable|biaya|beban|expense|fee|charge/i;

const first = (re: RegExp, text: string): string | null => {
  const m = re.exec(text);
  return m ? m[1].toUpperCase() : null;
};

/** Sel tambahan untuk satu baris GL. `idx` = indeks baris di array rows (diisi pemanggil). */
export function extrasForLine(idx: number, accountName: string, description: string): GlExtra[] {
  const out: GlExtra[] = [];
  const text = description ?? '';
  const name = (accountName ?? '').trim();
  if (name && BANK_NAME_RE.test(name) && !NOT_BANK_RE.test(name)) out.push({ idx, col: GL_COL_BANK, value: name });
  const pay = first(PAYMENT_RE, text);
  if (pay) out.push({ idx, col: GL_COL_PAYMENT, value: pay });
  const order = first(ORDER_RE, text);
  if (order) out.push({ idx, col: GL_COL_ORDER, value: order });
  if (REFUND_RE.test(text)) out.push({ idx, col: GL_COL_REFUND, value: 'Refund' });
  const room = first(ROOM_RE, text);
  if (room) out.push({ idx, col: GL_COL_ROOM, value: room });
  return out;
}