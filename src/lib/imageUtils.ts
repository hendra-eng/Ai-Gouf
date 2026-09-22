// Helper gambar untuk upload logo klien (halaman Clients -> Add/Edit Client).
//
// Logo disimpan di backend (management_clients.logo) sebagai data URL base64,
// dan ikut terkirim di SETIAP daftar klien, jadi gambar WAJIB dikecilkan dulu
// di browser sebelum dikirim -- bukan disimpan mentah.

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_INPUT_BYTES = 2 * 1024 * 1024; // file asli maks 2MB
const MAX_DIMENSION = 256; // px, sisi terpanjang setelah dikecilkan
const MAX_OUTPUT_LENGTH = 300_000; // panjang string data URL; backend menolak > 400_000

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image file could not be read.'));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Baca file gambar dari <input type="file">, kecilkan (maks 256px, rasio
 * dipertahankan), dan kembalikan sebagai data URL. PNG dipertahankan supaya
 * transparansi logo tidak hilang; kalau hasilnya masih terlalu besar, dipaksa
 * ke JPEG (latar putih).
 *
 * Melempar Error dengan pesan yang siap ditampilkan ke user.
 */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Logo must be a PNG, JPEG, or WebP image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Logo file is too large (max 2 MB).');
  }

  const img = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The image could not be processed.');
  ctx.drawImage(img, 0, 0, width, height);

  const png = canvas.toDataURL('image/png');
  if (png.length <= MAX_OUTPUT_LENGTH) return png;

  // PNG terlalu besar (mis. logo berupa foto) -> JPEG dengan latar putih.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  if (jpeg.length > MAX_OUTPUT_LENGTH) {
    throw new Error('Logo is too complex. Please use a simpler or smaller image.');
  }
  return jpeg;
}
