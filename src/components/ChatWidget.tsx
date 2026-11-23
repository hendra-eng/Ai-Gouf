'use client';
// Bubble chat AI di pojok kanan bawah (pengganti halaman /zafeb-ai).
// Klik tombol bulat -> panel chat muncul; klik lagi / tombol X -> tertutup.
// Pakai backend yang sama dengan halaman lama: api.chatStream() + buatPercakapan().
import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronLeft, Clock, Copy, Maximize2, Minimize2,
  Paperclip, RotateCcw, Send, Sparkles, Square, Trash2, TrendingUp, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
// @ts-ignore -- api.js adalah file JS
import {
  chatStream, buatPercakapan, aiBacaFileStream, aiBacaBanyakFile,
  daftarPercakapan, pesanPercakapan, hapusPercakapan, simpanPesanPercakapan,
} from '@/app/zafeb-ai/lib/api';

type Pesan = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: string;
  images?: string[];
  waktu?: number;
};
type Lampiran = { id: string; file: File; url: string };
type ItemPercakapan = { id: number | string; judul?: string; waktu?: number; cuplikan?: string };

const MAKS_GAMBAR = 4;
const MAKS_BYTE = 5 * 1024 * 1024; // batas gambar Claude API: 5MB
const TIPE_GAMBAR = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const ID_SAPAAN = 'sapaan';
const SAPAAN: Pesan = { id: ID_SAPAAN, role: 'assistant', text: '' };

let idSeq = 0;
const baruId = () => `m${Date.now().toString(36)}${++idSeq}`;

const SARAN: { teks: string; ikon: React.ComponentType<{ size?: number }> }[] = [
  { teks: 'Ringkasan keuangan periode ini', ikon: TrendingUp },
  { teks: 'Piutang yang sudah jatuh tempo', ikon: Clock },
  { teks: 'Kenapa laba bersih berubah?', ikon: Sparkles },
];

const CSS = `
@keyframes zw-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes zw-ring{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.65);opacity:0}}
@keyframes zw-pop{0%{transform:scale(0)}70%{transform:scale(1.2)}100%{transform:scale(1)}}
@keyframes zw-caret{0%,49%{opacity:1}50%,100%{opacity:0}}
.zw-in{animation:zw-in .28s cubic-bezier(.22,1,.36,1) both}
.zw-ring{animation:zw-ring 1.8s ease-out infinite}
.zw-pop{animation:zw-pop .3s cubic-bezier(.22,1,.36,1) both}
.zw-caret{animation:zw-caret 1s steps(1) infinite}
@keyframes zw-geser{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.zw-geser{animation:zw-geser .24s cubic-bezier(.22,1,.36,1) both}
@media (prefers-reduced-motion:reduce){.zw-geser,.zw-in,.zw-ring,.zw-pop,.zw-caret{animation:none}}
`;

// ---------- util ----------
const dua = (n: number) => String(n).padStart(2, '0');
const jamMenit = (t: number) => {
  const d = new Date(t);
  return `${dua(d.getHours())}:${dua(d.getMinutes())}`;
};
const kunciHari = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const labelHari = (t: number) => {
  const sekarang = Date.now();
  if (kunciHari(t) === kunciHari(sekarang)) return 'Hari ini';
  if (kunciHari(t) === kunciHari(sekarang - 86400000)) return 'Kemarin';
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

const keMs = (v: any): number | undefined => {
  if (v == null || v === '') return undefined;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : undefined;
};
const waktuRelatif = (t?: number) => {
  if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'Baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} mnt`;
  if (s < 86400) return `${Math.floor(s / 3600)} j`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} hr`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))} bln`;
  return `${Math.floor(s / (86400 * 365))} th`;
};

// ---------- logo ----------
function Wajah({ size, bg, fg }: { size: number; bg: string; fg: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2" y="4" width="24" height="20" rx="8" fill={bg} />
      <circle cx="10.5" cy="13" r="2" fill={fg} />
      <circle cx="17.5" cy="13" r="2" fill={fg} />
    </svg>
  );
}

// ---------- render jawaban AI (markdown ringan, tanpa library) ----------
type Blok =
  | { t: 'p'; s: string }
  | { t: 'h'; s: string; lv: number }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'code'; s: string }
  | { t: 'table'; head: string[]; rows: string[][] };

const RE_UL = /^\s*[-*•]\s+/;
const RE_OL = /^\s*\d+[.)]\s+/;
const potongSel = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const barisPemisahTabel = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');

function parseBlok(teks: string): Blok[] {
  const baris = teks.replace(/\r/g, '').split('\n');
  const out: Blok[] = [];
  let i = 0;
  while (i < baris.length) {
    const l = baris[i];
    if (!l.trim()) { i++; continue; }
    if (l.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < baris.length && !baris[i].trim().startsWith('```')) { buf.push(baris[i]); i++; }
      i++;
      out.push({ t: 'code', s: buf.join('\n') });
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < baris.length && barisPemisahTabel(baris[i + 1])) {
      const head = potongSel(l);
      i += 2;
      const rows: string[][] = [];
      while (i < baris.length && /^\s*\|/.test(baris[i])) { rows.push(potongSel(baris[i])); i++; }
      out.push({ t: 'table', head, rows });
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push({ t: 'h', s: h[2], lv: h[1].length }); i++; continue; }
    if (RE_UL.test(l)) {
      const items: string[] = [];
      while (i < baris.length && RE_UL.test(baris[i])) { items.push(baris[i].replace(RE_UL, '')); i++; }
      out.push({ t: 'ul', items });
      continue;
    }
    if (RE_OL.test(l)) {
      const items: string[] = [];
      while (i < baris.length && RE_OL.test(baris[i])) { items.push(baris[i].replace(RE_OL, '')); i++; }
      out.push({ t: 'ol', items });
      continue;
    }
    const buf = [l];
    i++;
    while (i < baris.length && baris[i].trim() && !/^\s*(\||#{1,4}\s|[-*•]\s|\d+[.)]\s|```)/.test(baris[i])) { buf.push(baris[i]); i++; }
    out.push({ t: 'p', s: buf.join('\n') });
  }
  return out;
}

const Caret = () => <span className="zw-caret ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] bg-neutral-300" />;

function Inline({ s, caret }: { s: string; caret?: boolean }) {
  const bagian = s.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|Rp\s?-?\d+(?:[.,]\d+)*)/g);
  return (
    <>
      {bagian.map((p, k) => {
        if (p.length > 4 && p.startsWith('**') && p.endsWith('**'))
          return <strong key={k} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
        if (p.length > 2 && p.startsWith('`') && p.endsWith('`'))
          return <code key={k} className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[12px] text-neutral-200">{p.slice(1, -1)}</code>;
        if (/^Rp\s?-?\d/.test(p))
          return <span key={k} className="whitespace-nowrap font-medium tabular-nums text-white">{p}</span>;
        return <React.Fragment key={k}>{p}</React.Fragment>;
      })}
      {caret && <Caret />}
    </>
  );
}

const sepertiAngka = (c: string) => /^[\s\-+(]*(Rp\s?)?\d[\d.,]*\s*(%|jt|rb|M)?\)?\s*$/i.test(c);

function Markdown({ text, caret }: { text: string; caret?: boolean }) {
  const blok = parseBlok(text);
  return (
    <div className="space-y-2">
      {blok.map((b, idx) => {
        const akhir = idx === blok.length - 1;
        if (b.t === 'p') return <p key={idx} className="whitespace-pre-wrap break-words"><Inline s={b.s} caret={caret && akhir} /></p>;
        if (b.t === 'h')
          return (
            <div key={idx} className={['font-semibold text-white tracking-tight', b.lv <= 2 ? 'text-[14.5px]' : 'text-[13.5px]'].join(' ')}>
              <Inline s={b.s} caret={caret && akhir} />
            </div>
          );
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t === 'ul' ? 'ul' : 'ol';
          return (
            <Tag key={idx} className={[b.t === 'ul' ? 'list-disc' : 'list-decimal', 'space-y-1 pl-5 marker:text-neutral-500'].join(' ')}>
              {b.items.map((it, k) => (
                <li key={k} className="pl-0.5"><Inline s={it} caret={caret && akhir && k === b.items.length - 1} /></li>
              ))}
            </Tag>
          );
        }
        if (b.t === 'code')
          return (
            <pre key={idx} className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-[12px] leading-relaxed text-neutral-300">
              {b.s}
            </pre>
          );
        const angka = b.head.map((_, c) => b.rows.length > 0 && b.rows.every((r) => !r[c] || sepertiAngka(r[c])));
        return (
          <div key={idx} className="my-1 overflow-x-auto rounded-lg border border-neutral-700/70">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="bg-neutral-800/70 text-neutral-300">
                <tr>
                  {b.head.map((hd, c) => (
                    <th key={c} className={['whitespace-nowrap px-3 py-2 font-semibold', angka[c] ? 'text-right' : 'text-left'].join(' ')}>
                      <Inline s={hd} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="hover:bg-white/[0.03]">
                    {b.head.map((_, c) => (
                      <td key={c} className={['px-3 py-1.5', angka[c] ? 'whitespace-nowrap text-right tabular-nums' : ''].join(' ')}>
                        <Inline s={r[c] ?? ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ---------- komponen utama ----------
export default function ChatWidget() {
  const { activeClientId, activeClientName } = useActiveClient();
  const { user } = useAuth();
  const pathname = usePathname(); // halaman yang sedang dibuka -> dikirim ke Zake agar jawabannya sesuai konteks
  const [open, setOpen] = useState(false);
  const [besar, setBesar] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<Pesan[]>([SAPAAN]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lampiran, setLampiran] = useState<Lampiran[]>([]);
  const [infoLampiran, setInfoLampiran] = useState<string | null>(null);
  const [tombolBawah, setTombolBawah] = useState(false);
  const [disalin, setDisalin] = useState<string | null>(null);
  const [salam, setSalam] = useState('Halo');
  const [layar, setLayar] = useState<'chat' | 'daftar'>('chat');
  const [daftar, setDaftar] = useState<ItemPercakapan[]>([]);
  const [memuatDaftar, setMemuatDaftar] = useState(false);
  const [gagalDaftar, setGagalDaftar] = useState(false);
  const [membukaId, setMembukaId] = useState<string | number | null>(null);
  const [konfirmHapus, setKonfirmHapus] = useState<string | number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const percakapanIdRef = useRef<number | string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dekatDasarRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // efek mengetik: potongan dari backend ditampung, lalu ditulis ke layar dengan kecepatan stabil
  const antrianRef = useRef<{ id: string; buf: string }>({ id: '', buf: '' });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const penungguRef = useRef<(() => void)[]>([]);

  const namaDepan = (user?.nama || user?.username || '').trim().split(/\s+/)[0] || '';

  // ---- scroll ----
  const keBawah = (halus = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: halus ? 'smooth' : 'auto' });
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const jarak = el.scrollHeight - el.scrollTop - el.clientHeight;
    dekatDasarRef.current = jarak < 80;
    setTombolBawah(jarak > 160);
  };
  useEffect(() => {
    if (open && layar === 'chat' && dekatDasarRef.current) keBawah(false);
  }, [messages, open, besar, layar]);

  // ---- efek buka panel ----
  useEffect(() => {
    if (open) {
      setUnread(0);
      const jam = new Date().getHours();
      setSalam(jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 19 ? 'Selamat sore' : 'Selamat malam');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ---- efek ketik ----
  const berhentiTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    penungguRef.current.splice(0).forEach((f) => f());
  };
  const batalkanKetik = () => {
    antrianRef.current.buf = '';
    berhentiTimer();
  };
  const tungguKetikSelesai = () =>
    new Promise<void>((res) => {
      if (!timerRef.current && !antrianRef.current.buf) res();
      else penungguRef.current.push(res);
    });
  const ketik = (id: string, potongan: string) => {
    const a = antrianRef.current;
    if (a.id !== id) { a.id = id; a.buf = ''; }
    a.buf += potongan;
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      const q = antrianRef.current;
      if (!q.buf) { berhentiTimer(); return; }
      const n = Math.max(2, Math.ceil(q.buf.length / 30));
      const ambil = q.buf.slice(0, n);
      q.buf = q.buf.slice(n);
      setMessages((prev) => prev.map((m) => (m.id === q.id ? { ...m, status: undefined, text: m.text + ambil } : m)));
      if (!q.buf) berhentiTimer();
    }, 18);
  };
  useEffect(() => () => batalkanKetik(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ganti client aktif -> mulai obrolan baru (konteks beda client).
  useEffect(() => {
    abortRef.current?.abort();
    batalkanKetik();
    percakapanIdRef.current = null;
    setMessages([SAPAAN]);
    setLayar('chat');
    setDaftar([]);
  }, [activeClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tinggi textarea TETAP satu baris -- tidak mengembang. Teks panjang digulir di dalam (tanpa scrollbar).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '28px';
  }, [input]);

  const updateById = (id: string, fn: (p: Pesan) => Pesan) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

  // ---- lampiran gambar ----
  const tambahGambar = (daftar: FileList | File[]) => {
    const baru: Lampiran[] = [];
    let ditolak: string | null = null;
    for (const f of Array.from(daftar)) {
      if (!TIPE_GAMBAR.includes(f.type)) { ditolak = 'Hanya gambar PNG, JPG, GIF, atau WEBP.'; continue; }
      if (f.size > MAKS_BYTE) { ditolak = 'Ukuran gambar maksimal 5 MB.'; continue; }
      baru.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, url: URL.createObjectURL(f) });
    }
    setLampiran((prev) => {
      const gabung = [...prev, ...baru];
      if (gabung.length > MAKS_GAMBAR) {
        ditolak = `Maksimal ${MAKS_GAMBAR} gambar per pesan.`;
        gabung.slice(MAKS_GAMBAR).forEach((l) => URL.revokeObjectURL(l.url));
        return gabung.slice(0, MAKS_GAMBAR);
      }
      return gabung;
    });
    setInfoLampiran(ditolak);
    if (ditolak) setTimeout(() => setInfoLampiran(null), 3500);
  };

  const hapusLampiran = (id: string) => {
    setLampiran((prev) => {
      const t = prev.find((l) => l.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((l) => l.id !== id);
    });
  };

  // ---- kirim ----
  const kirim = async (teksLangsung?: string) => {
    const text = (teksLangsung ?? input).trim();
    const gambar = teksLangsung ? [] : lampiran;
    if ((!text && gambar.length === 0) || sending) return;
    setInput('');
    setLampiran([]); // object URL dibiarkan hidup, dipakai tampilan bubble
    setSending(true);

    // Riwayat dikirim tanpa sapaan awal.
    const riwayat = messages
      .filter((m) => m.id !== ID_SAPAAN && (m.text || m.images?.length))
      .map((m) => ({ role: m.role, content: m.text || '[mengirim gambar]' }));

    const idAi = baruId();
    dekatDasarRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: baruId(), role: 'user', text, images: gambar.map((g) => g.url), waktu: Date.now() },
      { id: idAi, role: 'assistant', text: '', status: gambar.length ? 'Membaca gambar' : 'Thinking', waktu: Date.now() },
    ]);

    if (percakapanIdRef.current == null) {
      try {
        const baru = await buatPercakapan(activeClientId);
        percakapanIdRef.current = baru.id;
      } catch (e) {
        console.error('Gagal membuat percakapan baru:', e);
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let adaJawaban = false;
    let jawabanGambar = ''; // jalur gambar tidak lewat chatStream -> disimpan manual setelah selesai

    try {
      if (gambar.length > 0) {
        const pertanyaan = text || (gambar.length > 1 ? 'Jelaskan gambar-gambar ini.' : 'Jelaskan gambar ini.');
        if (gambar.length === 1) {
          for await (const potongan of aiBacaFileStream(gambar[0].file, pertanyaan)) {
            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            adaJawaban = true;
            jawabanGambar += potongan;
            ketik(idAi, potongan);
          }
        } else {
          const hasil = await aiBacaBanyakFile(gambar.map((g) => g.file), pertanyaan);
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          adaJawaban = !!hasil?.jawaban;
          if (adaJawaban) { jawabanGambar = hasil.jawaban; ketik(idAi, hasil.jawaban); }
        }
      } else {
        for await (const evt of chatStream(text, riwayat, [], activeClientId, percakapanIdRef.current, controller.signal, { halaman: pathname } as any)) {
          if (evt.type === 'step') {
            updateById(idAi, (p) => (p.text ? p : { ...p, status: evt.label || p.status }));
            continue;
          }
          adaJawaban = true;
          ketik(idAi, evt.text);
        }
      }
      await tungguKetikSelesai();
      // Pesan teks disimpan otomatis oleh backend (chatStream). Pesan bergambar disimpan di sini.
      if (gambar.length > 0 && adaJawaban && percakapanIdRef.current != null) {
        try {
          await simpanPesanPercakapan(percakapanIdRef.current, [
            { role: 'user', content: text ? `${text}\n[mengirim gambar]` : '[mengirim gambar]' },
            { role: 'assistant', content: jawabanGambar },
          ]);
        } catch (e) {
          console.error('Gagal menyimpan percakapan bergambar:', e);
        }
      }
      if (!adaJawaban) updateById(idAi, (p) => ({ ...p, status: undefined, text: p.text || '(tidak ada jawaban)' }));
      if (!openRef.current) setUnread((n) => n + 1);
    } catch (e: any) {
      batalkanKetik();
      const dihentikan = e?.name === 'AbortError';
      updateById(idAi, (p) => ({
        ...p,
        status: undefined,
        text: dihentikan ? (p.text ? p.text + '\n\n⏹️ Dihentikan.' : '⏹️ Dihentikan.') : `⚠️ ${e?.message || 'Terjadi kesalahan'}`,
      }));
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    batalkanKetik(); // kalau jawaban sudah selesai diterima tapi masih "diketik", langsung tampilkan yang sudah ada
  };

  const obrolanBaru = () => {
    abortRef.current?.abort();
    batalkanKetik();
    percakapanIdRef.current = null;
    setMessages([SAPAAN]);
    setInput('');
  };

  const salin = async (m: Pesan) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setDisalin(m.id);
      setTimeout(() => setDisalin((x) => (x === m.id ? null : x)), 1600);
    } catch {
      /* clipboard bisa diblokir browser -- abaikan */
    }
  };

  // ---- riwayat percakapan ----
  const muatDaftar = async () => {
    setMemuatDaftar(true);
    setGagalDaftar(false);
    try {
      const res: any = await daftarPercakapan(activeClientId, 'client');
      const list: any[] = res?.percakapan || [];
      setDaftar(
        list.map((c) => ({
          id: c.id,
          judul: c.judul,
          waktu: keMs(c.diperbarui_pada ?? c.updated_at ?? c.terakhir_pada ?? c.dibuat_pada ?? c.created_at ?? c.waktu),
          cuplikan: c.pesan_terakhir ?? c.cuplikan ?? c.ringkasan ?? undefined,
        })),
      );
    } catch {
      // riwayat hanya untuk level tertentu (backend bisa balas 403) -- tampilkan pesan, jangan merusak chat
      setDaftar([]);
      setGagalDaftar(true);
    } finally {
      setMemuatDaftar(false);
    }
  };

  const keDaftar = () => {
    setKonfirmHapus(null);
    setLayar('daftar');
    muatDaftar();
  };

  const bukaPercakapan = async (id: string | number) => {
    // percakapan yang sedang aktif: cukup kembali ke chat
    if (percakapanIdRef.current != null && String(percakapanIdRef.current) === String(id) && messages.length > 1) {
      dekatDasarRef.current = true;
      setLayar('chat');
      return;
    }
    abortRef.current?.abort();
    batalkanKetik();
    setMembukaId(id);
    try {
      const res: any = await pesanPercakapan(id);
      const pesan: Pesan[] = (res?.pesan || []).map((p: any) => ({
        id: baruId(),
        role: p.role === 'user' ? 'user' : 'assistant',
        text: p.content ?? '',
        waktu: keMs(p.created_at ?? p.dibuat_pada ?? p.waktu),
      }));
      percakapanIdRef.current = id;
      setMessages(pesan.length ? pesan : [SAPAAN]);
      setInput('');
      dekatDasarRef.current = true;
      setLayar('chat');
    } catch (e: any) {
      setGagalDaftar(true);
      console.error('Gagal membuka percakapan:', e);
    } finally {
      setMembukaId(null);
    }
  };

  const hapusItem = async (id: string | number) => {
    try {
      await hapusPercakapan(id);
    } catch (e) {
      console.error('Gagal menghapus percakapan:', e);
      return;
    } finally {
      setKonfirmHapus(null);
    }
    setDaftar((prev) => prev.filter((c) => c.id !== id));
    if (percakapanIdRef.current != null && String(percakapanIdRef.current) === String(id)) obrolanBaru();
  };

  const mulaiBaru = () => {
    obrolanBaru();
    dekatDasarRef.current = true;
    setLayar('chat');
  };

  const kosong = messages.length === 1;
  const tampil = messages.filter((m) => m.id !== ID_SAPAAN);
  const idxTerakhir = tampil.length - 1;

  return (
    <>
      <style>{CSS}</style>

      {/* Panel chat -- tema gelap monokrom, senada halaman Sales */}
      <div
        role="dialog"
        aria-label="Chat AI"
        aria-hidden={!open}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => {
          if (e.dataTransfer?.files?.length) { e.preventDefault(); tambahGambar(e.dataTransfer.files); }
        }}
        className={[
          'fixed z-[60] flex flex-col overflow-hidden bg-[#080808] text-neutral-100',
          'border border-neutral-700/70 shadow-[0_28px_70px_-14px_rgba(0,0,0,0.6)]',
          'right-0 bottom-0 w-full h-[var(--app-dvh)] rounded-none',
          'sm:right-6 sm:bottom-24 sm:rounded-xl',
          besar ? 'sm:w-[680px] sm:h-[min(820px,calc(var(--app-dvh)_-_8rem))]' : 'sm:w-[400px] sm:h-[min(640px,calc(var(--app-dvh)_-_8rem))]',
          'origin-bottom-right transition-[opacity,transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          open ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-95 translate-y-3 pointer-events-none',
        ].join(' ')}
      >
        {/* Garis aksen tipis di atas */}
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-gradient-to-r from-neutral-600 via-white to-neutral-600" />

        {layar === 'daftar' ? (
          /* Header layar Pesan (riwayat) */
          <div className="relative z-10 flex items-center gap-3 px-4 pt-5 pb-4 bg-gradient-to-b from-neutral-800 to-neutral-900 border-b border-neutral-700 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)]">
            <div className="w-8 shrink-0" />
            <div className="flex-1 text-center text-[15px] font-bold tracking-tight text-white">Pesan</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Tutup"
              className="h-8 w-8 rounded-md flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X size={17} />
            </button>
          </div>
        ) : (
        /* Header chat */
        <div className="relative z-10 flex items-center gap-2 px-3 pt-5 pb-4 bg-gradient-to-b from-neutral-800 to-neutral-900 border-b border-neutral-700 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)]">
          <button
            type="button"
            onClick={keDaftar}
            title="Riwayat pesan"
            aria-label="Kembali ke daftar pesan"
            className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-[0_0_0_4px_rgba(255,255,255,0.08)]">
            <Wajah size={30} bg="#0a0a0a" fg="#ffffff" />
          </div>
          <div className="flex-1 min-w-0 pl-1">
            <div className="text-[15px] font-bold tracking-tight leading-tight text-white">Zake</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-neutral-300 leading-tight min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{activeClientName ? `Online · ${activeClientName}` : 'Online'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBesar((b) => !b)}
            title={besar ? 'Perkecil' : 'Perbesar'}
            className="hidden sm:flex h-8 w-8 rounded-md items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            {besar ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={obrolanBaru}
            title="Obrolan baru"
            className="h-8 w-8 rounded-md flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Tutup"
            className="h-8 w-8 rounded-md flex items-center justify-center text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X size={17} />
          </button>
        </div>
        )}

        {layar === 'daftar' ? (
          /* Layar Pesan: daftar percakapan */
          <div className="zw-geser relative flex min-h-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.045),transparent_60%)]">
            <div className="flex-1 overflow-y-auto px-4 pt-2 scrollbar-thin">
              {memuatDaftar && daftar.length === 0 ? (
                <div className="space-y-3 pt-4">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="flex items-center gap-3 px-1 py-3">
                      <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-neutral-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-800" />
                        <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-900" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : daftar.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center pb-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-500">
                    <Sparkles size={20} />
                  </div>
                  <p className="mt-4 text-[13.5px] font-medium text-neutral-200">
                    {gagalDaftar ? 'Riwayat belum bisa dimuat' : 'Belum ada percakapan'}
                  </p>
                  <p className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-neutral-500">
                    {gagalDaftar
                      ? 'Coba lagi sebentar, atau mulai obrolan baru.'
                      : 'Mulai bertanya, dan obrolanmu akan tersimpan di sini.'}
                  </p>
                  {gagalDaftar && (
                    <button type="button" onClick={muatDaftar} className="mt-3 rounded-full border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300 hover:border-neutral-500 hover:text-white">
                      Coba lagi
                    </button>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-neutral-800/80">
                  {daftar.map((c) => {
                    const aktif = percakapanIdRef.current != null && String(percakapanIdRef.current) === String(c.id);
                    const judul = 'Zake'; // nama AI selalu tetap, bukan judul hasil percakapan
                    const konfirm = konfirmHapus === c.id;
                    return (
                      <li key={String(c.id)} className="group relative">
                        <button
                          type="button"
                          onClick={() => bukaPercakapan(c.id)}
                          disabled={membukaId != null}
                          className="flex w-full items-center gap-3 rounded-lg px-1 py-3.5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-60"
                        >
                          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200">
                            <Wajah size={26} bg="#0a0a0a" fg="#ffffff" />
                            {aktif && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0b0b] bg-emerald-500" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[13.5px] font-semibold text-white">{judul}</span>
                              <span className="shrink-0 text-[11.5px] tabular-nums text-neutral-500 transition-opacity group-hover:opacity-0">
                                {membukaId === c.id ? '...' : waktuRelatif(c.waktu)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[12.5px] text-neutral-500">
                              {c.cuplikan ? c.cuplikan.replace(/\*\*|`/g, '') : (aktif ? 'Percakapan saat ini' : 'Ketuk untuk membuka')}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => (konfirm ? hapusItem(c.id) : setKonfirmHapus(c.id))}
                          onBlur={() => setKonfirmHapus((x) => (x === c.id ? null : x))}
                          title={konfirm ? 'Klik lagi untuk menghapus' : 'Hapus percakapan'}
                          aria-label={`Hapus percakapan ${judul}`}
                          className={[
                            'absolute right-1 top-3 flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-all',
                            konfirm
                              ? 'bg-red-500/15 text-red-400 opacity-100'
                              : 'text-neutral-500 opacity-0 hover:bg-white/10 hover:text-white focus:opacity-100 group-hover:opacity-100',
                          ].join(' ')}
                        >
                          <Trash2 size={13} />
                          {konfirm && 'Hapus?'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-center px-4 pb-6 pt-3">
              <button
                type="button"
                onClick={mulaiBaru}
                className="flex items-center gap-2.5 rounded-xl bg-white px-5 py-2.5 text-[13px] font-semibold text-neutral-900 shadow-[0_10px_24px_-8px_rgba(255,255,255,0.3)] transition-transform hover:scale-[1.03] active:scale-95"
              >
                Tanya sesuatu
                <Send size={14} />
              </button>
            </div>
          </div>
        ) : (
        <>
        {/* Area pesan */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-full overflow-y-auto px-4 pt-6 pb-5 scrollbar-thin bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.045),transparent_60%)]"
          >
            {kosong ? (
              /* Layar sambutan */
              <div className="zw-in flex min-h-full flex-col items-center justify-center pb-6 text-center">
                <div className="h-16 w-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_0_6px_rgba(255,255,255,0.06),0_18px_40px_-12px_rgba(255,255,255,0.25)]">
                  <Wajah size={44} bg="#0a0a0a" fg="#ffffff" />
                </div>
                <h2 className="mt-5 text-[19px] font-semibold tracking-tight text-white">
                  {salam}{namaDepan ? `, ${namaDepan}` : ''}
                </h2>
                <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-neutral-400">
                  Ada yang bisa saya bantu soal data keuangan{activeClientName ? ` ${activeClientName}` : ''}?
                </p>
                <div className="mt-6 flex w-full max-w-[340px] flex-col gap-2">
                  {SARAN.map(({ teks, ikon: Ikon }, k) => (
                    <button
                      key={teks}
                      type="button"
                      onClick={() => kirim(teks)}
                      style={{ animationDelay: `${120 + k * 70}ms` }}
                      className="zw-in group flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-neutral-300">
                        <Ikon size={14} />
                      </span>
                      <span className="flex-1 text-[12.5px] font-medium text-neutral-200">{teks}</span>
                      <ArrowUpRight size={14} className="text-neutral-600 transition-colors group-hover:text-white" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {tampil.map((m, i) => {
                  const baruHari = i === 0 || (m.waktu && tampil[i - 1].waktu && kunciHari(m.waktu) !== kunciHari(tampil[i - 1].waktu!));
                  const adalahUser = m.role === 'user';
                  const sedangMengetik = sending && i === idxTerakhir && !adalahUser && !!m.text;
                  return (
                    <React.Fragment key={m.id}>
                      {baruHari && m.waktu && (
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-neutral-800" />
                          <span className="text-[10.5px] font-medium uppercase tracking-wider text-neutral-500">{labelHari(m.waktu)}</span>
                          <div className="h-px flex-1 bg-neutral-800" />
                        </div>
                      )}
                      <div className={['zw-in group flex gap-2', adalahUser ? 'justify-end' : 'items-start'].join(' ')}>
                        {!adalahUser && (
                          <div className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-neutral-200 flex items-center justify-center">
                            <Wajah size={18} bg="#0a0a0a" fg="#ffffff" />
                          </div>
                        )}
                        <div className={['flex min-w-0 max-w-[84%] flex-col', adalahUser ? 'items-end' : 'items-start'].join(' ')}>
                          <div
                            className={[
                              'px-3.5 py-2.5 text-[13.5px] leading-relaxed break-words',
                              adalahUser
                                ? 'whitespace-pre-wrap bg-gradient-to-br from-white to-neutral-300 text-neutral-900 font-medium rounded-2xl rounded-br-md shadow-[0_6px_16px_-6px_rgba(255,255,255,0.25)]'
                                : 'max-w-full bg-neutral-900 text-neutral-100 border border-neutral-700/70 rounded-2xl rounded-tl-md',
                            ].join(' ')}
                          >
                            {m.images && m.images.length > 0 && (
                              <div className={['grid gap-1.5', m.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1', m.text ? 'mb-2' : ''].join(' ')}>
                                {m.images.map((u, k) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={k} src={u} alt="" className="w-full max-h-44 rounded-lg object-cover" />
                                ))}
                              </div>
                            )}
                            {m.status && !m.text ? (
                              <span className="inline-flex items-center gap-2 text-neutral-400">
                                <span className="inline-flex gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.3s]" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.15s]" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce" />
                                </span>
                                <span className="text-xs">{m.status}</span>
                              </span>
                            ) : adalahUser ? (
                              m.text
                            ) : (
                              <Markdown text={m.text} caret={sedangMengetik} />
                            )}
                          </div>
                          {(m.text || adalahUser) && (
                            <div className="mt-1 flex items-center gap-2 px-1 text-[10.5px] text-neutral-600">
                              {m.waktu && <span className="tabular-nums">{jamMenit(m.waktu)}</span>}
                              {!adalahUser && m.text && !sedangMengetik && (
                                <button
                                  type="button"
                                  onClick={() => salin(m)}
                                  title="Salin jawaban"
                                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-neutral-500 opacity-0 transition-all hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100"
                                >
                                  {disalin === m.id ? <Check size={11} /> : <Copy size={11} />}
                                  {disalin === m.id ? 'Tersalin' : 'Salin'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tombol scroll ke bawah */}
          {tombolBawah && !kosong && (
            <button
              type="button"
              onClick={() => keBawah(true)}
              title="Ke pesan terbaru"
              className="zw-in absolute bottom-3 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-600 bg-neutral-900/95 text-neutral-200 shadow-lg backdrop-blur hover:bg-neutral-800 hover:text-white"
            >
              <ArrowDown size={15} />
            </button>
          )}
        </div>

        {/* Pratinjau lampiran: di atas footer, latar hitam sama seperti area chat */}
        {(infoLampiran || lampiran.length > 0) && (
          <div className="px-4 pt-3 pb-2 bg-[#080808]">
            {infoLampiran && <div className="px-1 pb-1.5 text-[11px] text-amber-400">{infoLampiran}</div>}
            {lampiran.length > 0 && (
              <div className="flex gap-2 overflow-x-auto px-1 pt-1.5 pb-1 scrollbar-thin">
                {lampiran.map((l) => (
                  <div key={l.id} className="zw-pop relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.url} alt="" className="h-14 w-14 rounded-xl object-cover border border-neutral-600" />
                    <button
                      type="button"
                      onClick={() => hapusLampiran(l.id)}
                      title="Hapus gambar"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-neutral-100 text-neutral-900 flex items-center justify-center shadow"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div className="relative z-10 px-4 pt-3.5 pb-3 bg-neutral-900 border-t border-neutral-700 shadow-[0_-10px_24px_-10px_rgba(0,0,0,0.9)]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) tambahGambar(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-2 rounded-full border border-neutral-600 bg-[#080808] pl-1.5 pr-1.5 py-1.5 transition-colors focus-within:border-neutral-300">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Lampirkan gambar"
              className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-40"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              onPaste={(e) => {
                const f = Array.from(e.clipboardData?.files || []).filter((x) => x.type.startsWith('image/'));
                if (f.length) { e.preventDefault(); tambahGambar(f); }
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  kirim();
                }
              }}
              rows={1}
              placeholder={lampiran.length ? 'Tanya soal gambar ini...' : 'Tulis pertanyaanmu...'}
              className="flex-1 resize-none bg-transparent outline-none text-[13.5px] text-neutral-100 placeholder:text-neutral-500 py-1 h-7 max-h-7 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            />
            {sending ? (
              <button
                type="button"
                onClick={stop}
                title="Stop"
                className="h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-neutral-900 flex items-center justify-center"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => kirim()}
                disabled={!input.trim() && lampiran.length === 0}
                title="Kirim"
                className="h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-neutral-900 flex items-center justify-center hover:bg-white transition-colors disabled:bg-neutral-800 disabled:text-neutral-600"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="mt-2 text-center text-[10.5px] tracking-wide text-neutral-500">
            Zake bisa keliru. Periksa angka penting.
          </div>
        </div>
        </>
        )}
      </div>

      {/* Tombol bubble */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Tutup chat' : 'Buka chat'}
        className={[
          'fixed z-[60] right-6 bottom-6 h-14 w-14 rounded-full bg-neutral-950 text-white',
          'border border-neutral-700 shadow-[0_10px_30px_-6px_rgba(0,0,0,0.6)]',
          'flex items-center justify-center transition-all duration-200 hover:scale-105 hover:border-neutral-500 active:scale-95',
          open ? 'max-sm:hidden' : '',
        ].join(' ')}
      >
        {!open && unread > 0 && (
          <span className="zw-ring pointer-events-none absolute inset-0 rounded-full border-2 border-neutral-300" />
        )}
        {open ? <ChevronDown size={22} /> : <Wajah size={28} bg="#fafafa" fg="#0a0a0a" />}
        {!open && unread > 0 && (
          <span className="zw-pop absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center ring-2 ring-neutral-950">
            {unread}
          </span>
        )}
      </button>
    </>
  );
}