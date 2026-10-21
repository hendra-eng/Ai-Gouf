// snapshotLayar — "berbagi layar" versi teks untuk asisten suara Neo.
//
// Saat pengguna bertanya soal apa yang ada di layar ("angka di kanan atas ini dari apa?"),
// fungsi ini mengambil SEMUA teks yang benar-benar TERLIHAT di viewport beserta posisinya
// (kiri/tengah/kanan x atas/tengah/bawah), lalu dikirim ke backend sebagai konteks tambahan.
// Tidak ada screenshot: hanya teks, jadi ringan dan cocok untuk model teks (Groq).
//
// Dipakai dari VoiceAssistant.tsx:
//   const konteks = perluLayar(ucapan) ? ambilSnapshotLayar() : '';
// Elemen yang dibiarkan tidak ikut: apa pun di dalam [data-voice-ignore] (UI Neo sendiri),
// <script>/<style>, <nav>/<aside> (menu samping = noise), dan input password.

const MAKS_KARAKTER = 6000; // ~2000 token; cukup untuk satu halaman dashboard
const MAKS_PANJANG_TEKS = 120; // satu potongan teks dipotong segini
const MAKS_NODE = 4000; // batas pengaman performa
const TINGGI_BARIS_PX = 22; // teks dengan y berdekatan dianggap satu baris

// ---------- Pelacak posisi kursor mouse (untuk "yang ini" / "angka ini") ----------
let kursorX = -1;
let kursorY = -1;
let kursorTs = 0;

/** Pasang pelacak kursor. Panggil sekali dari useEffect; return fungsi pembersih. */
export function mulaiLacakKursor(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onMove = (e: MouseEvent) => {
    kursorX = e.clientX;
    kursorY = e.clientY;
    kursorTs = Date.now();
  };
  window.addEventListener('mousemove', onMove, { passive: true });
  return () => window.removeEventListener('mousemove', onMove);
}

// ---------- Deteksi: apakah pertanyaan ini menyangkut isi layar? ----------
// Sengaja cukup spesifik supaya snapshot (≈2000 token) tidak dikirim di setiap pertanyaan.
const POLA_LAYAR = new RegExp(
  [
    'layar', 'halaman (ini|itu)', 'yang (ini|itu)', 'angka (ini|itu|di|yang)', 'nilai (ini|itu|di|yang)',
    'sebelah (kiri|kanan|atas|bawah)', '(di|pojok|bagian) (kiri|kanan|atas|bawah|tengah)',
    'maksudnya', 'ini (apa|artinya|maksudnya|dari|datangnya|dihitung|kenapa)', 'itu (apa|artinya|maksudnya|dari|dihitung)',
    '(grafik|chart|diagram|tabel|kolom|baris|kartu|kotak|tombol|kpi|widget|bagian) (ini|itu|di|yang)',
    'lihat(kah)? (ini|itu|angka|grafik|tabel|layar)', 'kamu (lihat|bisa lihat|melihat)', 'yang (kamu|lagi) (lihat|buka)',
    'yang (lagi |sedang )?(tampil|muncul|terbuka|kebuka)', 'jelaskan (ini|angka|grafik|tabel|halaman)',
    'kenapa (angka|nilai|total|saldo)', 'dari mana (angka|nilai|total|saldo)',
  ].join('|'),
  'i'
);

export const perluLayar = (ucapan: string): boolean => POLA_LAYAR.test(ucapan || '');

// ---------- Pengambilan snapshot ----------
type Butir = { teks: string; x: number; y: number; zonaX: 'kiri' | 'tengah' | 'kanan'; zonaY: 'atas' | 'tengah' | 'bawah' };

const SELECTOR_ABAI = '[data-voice-ignore],script,style,noscript,nav,aside,[aria-hidden="true"]';

function zonaDari(cx: number, cy: number): Pick<Butir, 'zonaX' | 'zonaY'> {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const rx = cx / w;
  const ry = cy / h;
  return {
    zonaX: rx < 0.33 ? 'kiri' : rx < 0.66 ? 'tengah' : 'kanan',
    zonaY: ry < 0.25 ? 'atas' : ry < 0.75 ? 'tengah' : 'bawah',
  };
}

function terlihat(el: Element, cache: Map<Element, boolean>): boolean {
  const ada = cache.get(el);
  if (ada !== undefined) return ada;
  let ok = true;
  try {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) ok = false;
  } catch {
    ok = true;
  }
  cache.set(el, ok);
  return ok;
}

function rapikan(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > MAKS_PANJANG_TEKS ? s.slice(0, MAKS_PANJANG_TEKS - 1) + '…' : s;
}

function kumpulkanTeks(): Butir[] {
  const hasil: Butir[] = [];
  const cacheLihat = new Map<Element, boolean>();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (++n > MAKS_NODE) break;
    const isi = rapikan(node.nodeValue || '');
    if (!isi) continue;
    const induk = node.parentElement;
    if (!induk || induk.closest(SELECTOR_ABAI) || !terlihat(induk, cacheLihat)) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // hanya yang berada (sebagian) di dalam viewport
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    hasil.push({ teks: isi, x: cx, y: cy, ...zonaDari(cx, cy) });
  }
  return hasil;
}

function kumpulkanIsian(): Butir[] {
  const hasil: Butir[] = [];
  const els = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select');
  els.forEach((el) => {
    if (el.closest(SELECTOR_ABAI)) return;
    if (el instanceof HTMLInputElement && ['password', 'hidden', 'file', 'checkbox', 'radio', 'button', 'submit'].includes(el.type)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight) return;
    let nilai = '';
    if (el instanceof HTMLSelectElement) nilai = el.selectedOptions?.[0]?.text || '';
    else nilai = el.value || '';
    nilai = rapikan(nilai);
    if (!nilai) return;
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : '') ||
      el.getAttribute('name') ||
      'isian';
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    hasil.push({ teks: `[isian ${rapikan(label || 'isian')}: ${nilai}]`, x: cx, y: cy, ...zonaDari(cx, cy) });
  });
  return hasil;
}

function elemenDiBawahKursor(): string {
  // hanya dianggap relevan kalau mouse bergerak dalam 2 menit terakhir
  if (kursorX < 0 || Date.now() - kursorTs > 120000) return '';
  const el = document.elementFromPoint(kursorX, kursorY);
  if (!el || el === document.body || el === document.documentElement || el.closest('[data-voice-ignore]')) return '';
  let cur: Element | null = el;
  for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
    const t = rapikan((cur as HTMLElement).innerText || cur.textContent || '');
    if (t) {
      const z = zonaDari(kursorX, kursorY);
      return `Kursor mouse pengguna sedang menunjuk elemen di ${z.zonaY}-${z.zonaX}: "${t.slice(0, 200)}"`;
    }
    cur = cur.parentElement;
  }
  return '';
}

/** Ambil snapshot teks layar saat ini. Return string kosong kalau gagal / tidak di browser. */
export function ambilSnapshotLayar(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  try {
    const semua = [...kumpulkanTeks(), ...kumpulkanIsian()].sort((a, b) => a.y - b.y || a.x - b.x);

    // kelompokkan per baris (y berdekatan), lalu per zona-x di dalam baris
    const baris: Butir[][] = [];
    for (const b of semua) {
      const terakhir = baris[baris.length - 1];
      if (terakhir && Math.abs(terakhir[0].y - b.y) <= TINGGI_BARIS_PX / 2) terakhir.push(b);
      else baris.push([b]);
    }

    const sudah = new Set<string>();
    const keluar: string[] = [];
    let panjang = 0;
    for (const grup of baris) {
      grup.sort((a, b) => a.x - b.x);
      const perZona: Record<string, string[]> = {};
      for (const b of grup) {
        const kunci = `${b.zonaY}-${b.zonaX}`;
        const dup = `${kunci}|${b.teks}`;
        if (sudah.has(dup)) continue;
        sudah.add(dup);
        (perZona[kunci] ||= []).push(b.teks);
      }
      const bagian = Object.entries(perZona).map(([k, v]) => `(${k}) ${v.join(' | ')}`);
      if (!bagian.length) continue;
      const line = bagian.join('  ');
      if (panjang + line.length > MAKS_KARAKTER) {
        keluar.push('… (sisa layar dipotong)');
        break;
      }
      keluar.push(line);
      panjang += line.length + 1;
    }

    if (!keluar.length) return '';
    const kursor = elemenDiBawahKursor();
    return [
      `Judul tab: ${rapikan(document.title || '-')}`,
      `Ukuran viewport: ${window.innerWidth}x${window.innerHeight}`,
      'Isi layar (per baris dari atas ke bawah; (posisi) = letak di layar, kiri→kanan):',
      ...keluar,
      kursor,
    ]
      .filter(Boolean)
      .join('\n');
  } catch (e) {
    console.warn('[snapshotLayar] gagal mengambil snapshot:', e);
    return '';
  }
}