// "Isi AI" untuk tombol Download Excel di halaman Reports (src/app/reports).
//
// Saat Download ditekan, setelah data COA/GL/TB/ADJ terambil, modul ini mengumpulkan SEL KOSONG yang masuk akal
// dibantu AI untuk PT dan periode terpilih, lalu mengisinya sampai baris terakhir:
//   party     GL  kolom Supplier/Customer yang kosong  -> nama pihak dari keterangan transaksi
//   catatan   TB  kolom Notes untuk akun yang janggal  -> dugaan penyebab singkat (selalu berawalan "Dugaan AI:")
//   catatan_pnl  PNL CF  catatan untuk 2 baris SELISIH (profit dan kas/bank terhadap TB); di Excel hanya tampil kalau selisihnya tidak nol
// Jurnal penyesuaian (ADJ) TIDAK diisi AI: isinya mengubah angka TB/BS/PNL CF.
// Category COA (account_sub) juga TIDAK diisi AI: Neraca dan Arus Kas memakainya untuk memisahkan aset tetap, kas/bank, dan
// utang jangka panjang, jadi harus dari COA resmi klien. Akun yang Category-nya kosong hanya diberi penanda (reportsCoaSheet.ts).
//
// Urutan hemat token (backend/modules/financial_statements/isi_ai_core.py menangani cache & anggaran):
//   1. POLA DATA dulu, tanpa AI: nama pihak yang sudah dikenal dari baris lain.
//   2. Sisanya dedupe berdasarkan tanda tangan teks (nomor referensi diseragamkan), lalu dikirim per kelompok <= 60.
//   3. Berhenti begitu backend melapor batas pemakaian / pemutus / sakelar darurat; sisanya dilaporkan, bukan diam-diam kosong.
// Kegagalan modul ini TIDAK PERNAH menggagalkan download: file tetap terunduh dengan sel kosong.

import type { ReportsSourceData } from './reportsData';
import type { Worksheet } from 'exceljs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const AI_FILL_URL = `${API_BASE_URL}/api/v1/reports/ai-fill`;

/** Matikan dari frontend dengan NEXT_PUBLIC_REPORTS_AI_FILL=off (sakelar darurat sisi server: REPORTS_AI_AKTIF=false). */
export const REPORTS_AI_ENABLED = process.env.NEXT_PUBLIC_REPORTS_AI_FILL !== 'off';

export type AiTask = 'party' | 'catatan' | 'catatan_pnl';

export interface AiProgress { label: string; done: number; total: number }

export interface ReportsAiResult {
  /** tanda tangan keterangan -> nama pihak (dari pola data atau AI; tetap divalidasi ulang per baris saat dipakai). */
  party: Map<string, string>;
  /** kode akun TB -> catatan "Dugaan AI: ...". */
  catatan: Map<string, string>;
  /** jenis baris selisih PNL CF ('profit' | 'kas') -> catatan "Dugaan AI: ...". */
  catatanPnl: Map<string, string>;
  /** Item yang tidak sempat terisi, dan alasan dari backend (batas_unduhan / batas_hari / batas_bulan / pemutus / dinonaktifkan / gagal_model / waktu). */
  skipped: number;
  skippedReason: string | null;
  /** Pesan kegagalan jaringan/server bila ada (download tetap jalan). */
  error: string | null;
}

export const SEL_AI_FILL = 'FFDDEBF7'; // biru muda: sel yang diisi otomatis dan perlu direview

// ── Utilitas teks (cerminan isi_ai_core.py) ──────────────────────────────────

/** Kunci dedupe: spasi dirapikan, huruf besar, angka panjang (nomor referensi) diseragamkan. */
export function textSignature(text: string): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase().replace(/\d{3,}/g, '#');
}

const alnum = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Anti-halusinasi: nama pihak harus benar-benar tertulis di keterangan baris itu. */
export function nameInText(name: string, text: string): boolean {
  const n = alnum(name);
  return n.length >= 3 && alnum(text).includes(n);
}

/** Keterangan yang jelas BUKAN nama pihak: tidak dikirim ke AI sama sekali (hemat token). */
const NON_PARTY_RE = /saldo awal|opening|pembulatan|round|biaya admin|admin fee|bank charge|biaya bank|bunga|interest|penutup|closing|penyusutan|depreciation|reklas|reclass|koreksi|adjust|memorial/i;

const PROFIT_ACCOUNT_RE = /current\s*year|current\s*period|current\s*earning|tahun\s*berjalan|laba\s*(\(?rugi\)?\s*)?berjalan/i;

const CHUNK = 60;
const MAX_UNIQUE = { party: 300, catatan: 40 } as const;
const CASH_NAME_RE = /\b(kas|bank|cash)\b/i;
const REQUEST_TIMEOUT_MS = 60_000;
const TOTAL_TIMEOUT_MS = 150_000;
const STOP_REASONS = new Set(['batas_unduhan', 'batas_hari', 'batas_bulan', 'pemutus', 'dinonaktifkan']);

// ── Pengumpul item ───────────────────────────────────────────────────────────

interface PartyItem { id: string; teks: string }

/** Nama pihak dikenal dari baris lain + kandidat unik (per tanda tangan) yang masih perlu dicari. */
function collectParty(data: ReportsSourceData): { resolved: Map<string, string>; candidates: PartyItem[] } {
  const names = new Map<string, string>(); // alnum -> nama asli
  for (const acc of data.gl.accounts) {
    for (const l of acc.lines) {
      const p = (l.party ?? '').trim();
      if (p && alnum(p).length >= 5) names.set(alnum(p), p);
    }
  }
  const lexicon = [...names.entries()].sort((a, b) => b[0].length - a[0].length).slice(0, 1500);

  const unique = new Map<string, { teks: string; count: number }>();
  for (const acc of data.gl.accounts) {
    for (const l of acc.lines) {
      if (l.is_adjustment || (l.party ?? '').trim()) continue;
      const teks = (l.description ?? '').trim();
      if (teks.length < 4 || NON_PARTY_RE.test(teks)) continue;
      const sig = textSignature(teks);
      const cur = unique.get(sig);
      if (cur) cur.count += 1; else unique.set(sig, { teks, count: 1 });
    }
  }

  const resolved = new Map<string, string>();
  const left: Array<{ sig: string; teks: string; count: number }> = [];
  for (const [sig, v] of unique) {
    const at = alnum(v.teks);
    const hit = lexicon.find(([key]) => at.includes(key));
    if (hit) resolved.set(sig, hit[1]); else left.push({ sig, ...v });
  }
  left.sort((a, b) => b.count - a.count); // yang paling sering muncul dikerjakan lebih dulu
  return { resolved, candidates: left.slice(0, MAX_UNIQUE.party).map(x => ({ id: x.sig, teks: x.teks })) };
}

interface CatatanItem {
  id: string; kode: string; nama: string; grup: string; sisi_normal: string; saldo_awal: number;
  total_debit: number; total_kredit: number; saldo_akhir: number; belum_posted: number; di_coa: boolean;
  alasan: string[]; transaksi_besar: Array<{ ket: string; debit: number; kredit: number }>;
}

function collectCatatan(data: ReportsSourceData): CatatanItem[] {
  const glByCode = new Map(data.gl.accounts.map(a => [String(a.account_code), a]));
  const out: Array<CatatanItem & { _skor: number }> = [];
  for (const g of data.tb.groups) {
    for (const a of g.accounts) {
      if (PROFIT_ACCOUNT_RE.test(a.account_name)) continue; // baris turunan, bukan akun biasa
      const aktif = a.opening_balance !== 0 || a.total_debit !== 0 || a.total_kredit !== 0;
      if (!aktif) continue;
      const alasan: string[] = [];
      if (a.ytd < -0.5) alasan.push('saldo berlawanan dengan sisi normal akun');
      if (!a.in_coa) alasan.push('akun tidak ada di COA klien');
      if (!alasan.length) continue;
      const lines = glByCode.get(String(a.account_code))?.lines ?? [];
      const besar = [...lines].sort((x, y) => Math.max(y.debit, y.credit) - Math.max(x.debit, x.credit)).slice(0, 4)
        .map(l => ({ ket: l.description ?? '', debit: l.debit, kredit: l.credit }));
      out.push({
        id: String(a.account_code), kode: String(a.account_code), nama: a.account_name, grup: g.key, sisi_normal: a.normal_balance,
        saldo_awal: a.opening_balance, total_debit: a.total_debit, total_kredit: a.total_kredit, saldo_akhir: a.ytd,
        belum_posted: a.unposted_lines, di_coa: a.in_coa, alasan, transaksi_besar: besar, _skor: Math.abs(a.ytd),
      });
    }
  }
  return out.sort((a, b) => b._skor - a._skor).slice(0, MAX_UNIQUE.catatan).map(({ _skor, ...rest }) => rest);
}

interface CatatanPnlItem { id: string; jenis: 'profit' | 'kas'; nama: string; konteks: Record<string, number> }

/**
 * Item untuk baris SELISIH di PNL CF. Hanya hitungan ringkas (tanpa angka rupiah dan tanpa nama pihak) yang dikirim ke AI,
 * dan item dibuat HANYA bila ada petunjuk dari data (baris belum posted, akun di luar COA, saldo berlawanan, jurnal penyesuaian).
 */
function collectCatatanPnl(data: ReportsSourceData): CatatanPnlItem[] {
  const adjLines = (data.adj?.entries ?? []).reduce((n, e) => n + (e.lines?.length ?? 0), 0);
  const scan = (pick: (a: { account_name: string }, tipe: string, key: string) => boolean) => {
    let akun = 0, akunBelumPosted = 0, barisBelumPosted = 0, diLuarCoa = 0, berlawanan = 0;
    for (const g of data.tb.groups) {
      for (const a of g.accounts) {
        if (PROFIT_ACCOUNT_RE.test(a.account_name) || !pick(a, g.tipe, g.key)) continue;
        akun += 1;
        if (a.unposted_lines > 0) { akunBelumPosted += 1; barisBelumPosted += a.unposted_lines; }
        if (!a.in_coa) diLuarCoa += 1;
        if (a.ytd < -0.5) berlawanan += 1;
      }
    }
    return { akun, akunBelumPosted, barisBelumPosted, diLuarCoa, berlawanan };
  };
  const items: CatatanPnlItem[] = [];
  const p = scan((_a, tipe) => tipe === 'pnl');
  if (p.akunBelumPosted + p.diLuarCoa + p.berlawanan + adjLines > 0) {
    items.push({ id: 'profit', jenis: 'profit', nama: 'Selisih laba/rugi PNL CF terhadap TB', konteks: {
      akun_laba_rugi: p.akun, akun_belum_posted: p.akunBelumPosted, baris_belum_posted: p.barisBelumPosted,
      akun_tidak_di_coa: p.diLuarCoa, akun_saldo_berlawanan: p.berlawanan, baris_penyesuaian: adjLines,
    } });
  }
  const k = scan((a, _tipe, key) => key === 'ASSET' && CASH_NAME_RE.test(a.account_name));
  if (k.akunBelumPosted + k.diLuarCoa + k.berlawanan + adjLines > 0 && k.akun > 0) {
    items.push({ id: 'kas', jenis: 'kas', nama: 'Selisih saldo kas/bank arus kas terhadap TB', konteks: {
      akun_kas_bank: k.akun, akun_belum_posted: k.akunBelumPosted, baris_belum_posted: k.barisBelumPosted,
      akun_tidak_di_coa: k.diLuarCoa, akun_saldo_berlawanan: k.berlawanan, baris_penyesuaian: adjLines,
    } });
  }
  return items;
}

// ── Pemanggilan endpoint ─────────────────────────────────────────────────────

interface ServerSummary { alasan_dilewati: string | null; dilewati: number }
interface ServerResult { hasil: Record<string, string>; ringkasan: ServerSummary }

async function callAiFill(
  task: AiTask, clientId: string, downloadId: string, items: unknown[], outer?: AbortSignal,
): Promise<ServerResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(AI_FILL_URL, {
      method: 'POST', cache: 'no-store', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ management_client_id: clientId, tugas: task, id_unduhan: downloadId, items }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== 'success') throw new Error(json?.message || `Request failed (${res.status})`);
    return json.data as ServerResult;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export function newDownloadId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `dl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RunAiFillOptions {
  managementClientId: string;
  downloadId?: string;
  onProgress?: (p: AiProgress) => void;
  signal?: AbortSignal;
}

/** Kumpulkan sel kosong, isi dari pola data, lalu minta AI untuk sisanya. Tidak pernah melempar error. */
export async function runReportsAiFill(data: ReportsSourceData, opt: RunAiFillOptions): Promise<ReportsAiResult> {
  const result: ReportsAiResult = {
    party: new Map(), catatan: new Map(), catatanPnl: new Map(), skipped: 0, skippedReason: null, error: null,
  };
  const downloadId = opt.downloadId ?? newDownloadId();
  const started = Date.now();

  const party = collectParty(data);
  const catatan = collectCatatan(data);
  const catatanPnl = collectCatatanPnl(data);
  for (const [k, v] of party.resolved) result.party.set(k, v);

  const jobs: Array<{ task: AiTask; label: string; items: unknown[]; apply: (hasil: Record<string, string>) => void }> = [
    { task: 'party', label: 'Supplier/Customer', items: party.candidates,
      apply: h => { for (const [k, v] of Object.entries(h)) if (v) result.party.set(k, v); } },
    { task: 'catatan', label: 'TB notes', items: catatan,
      apply: h => { for (const [k, v] of Object.entries(h)) if (v) result.catatan.set(k, v); } },
    { task: 'catatan_pnl', label: 'PNL CF notes', items: catatanPnl,
      apply: h => { for (const [k, v] of Object.entries(h)) if (v) result.catatanPnl.set(k, v); } },
  ];
  const total = jobs.reduce((n, j) => n + j.items.length, 0);
  let done = 0;
  let consecutiveErrors = 0;
  let stop = false;

  for (const job of jobs) {
    for (let i = 0; i < job.items.length; i += CHUNK) {
      const chunk = job.items.slice(i, i + CHUNK);
      if (stop || opt.signal?.aborted) { result.skipped += chunk.length; continue; }
      if (Date.now() - started > TOTAL_TIMEOUT_MS) {
        stop = true; result.skipped += chunk.length; result.skippedReason ??= 'waktu'; continue;
      }
      opt.onProgress?.({ label: job.label, done, total });
      try {
        const out = await callAiFill(job.task, opt.managementClientId, downloadId, chunk, opt.signal);
        consecutiveErrors = 0;
        job.apply(out.hasil ?? {});
        const reason = out.ringkasan?.alasan_dilewati ?? null;
        if (out.ringkasan?.dilewati) {
          result.skipped += out.ringkasan.dilewati;
          if (reason) result.skippedReason ??= reason;
        }
        if (reason && STOP_REASONS.has(reason)) stop = true;
      } catch (e) {
        consecutiveErrors += 1;
        result.skipped += chunk.length;
        result.error = e instanceof Error ? e.message : 'AI fill failed.';
        if (consecutiveErrors >= 2) stop = true; // jangan terus mencoba kalau server bermasalah
      }
      done += chunk.length;
      opt.onProgress?.({ label: job.label, done, total });
    }
  }
  return result;
}

// ── Penerapan ke sheet ───────────────────────────────────────────────────────

/** Beri latar biru muda pada sel yang diisi otomatis (garis dan font sel tidak diubah). */
export function markAiCell(ws: Worksheet, row: number, col: number): void {
  ws.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEL_AI_FILL } };
}

/** Nama pihak untuk satu baris GL: nilai asli kalau ada, kalau kosong pakai hasil otomatis yang LOLOS validasi baris itu. */
export function partyForLine(ai: ReportsAiResult | undefined, original: string, description: string): { value: string; auto: boolean } {
  if ((original ?? '').trim()) return { value: original, auto: false };
  const name = ai?.party.get(textSignature(description ?? ''));
  if (name && nameInText(name, description ?? '')) return { value: name, auto: true };
  return { value: original ?? '', auto: false };
}

export function describeAiResult(ai: ReportsAiResult | undefined, filled: Record<string, number>): string | null {
  if (!ai) return null;
  const parts: string[] = [];
  if (filled.GL) parts.push(`${filled.GL} Supplier/Customer cells in GL`);
  if (filled.TB) parts.push(`${filled.TB} notes in TB`);
  if (filled.PNL) parts.push(`${filled.PNL} difference note(s) in PNL CF`);
  const lines: string[] = [];
  if (parts.length) lines.push(`Auto-filled ${parts.join(', ')} (light-blue cells, please review).`);
  if (ai.skipped > 0) {
    const why: Record<string, string> = {
      batas_unduhan: 'the per-download AI limit was reached', batas_hari: "today's AI limit was reached",
      batas_bulan: "this month's AI limit was reached", pemutus: 'AI is paused after repeated errors',
      dinonaktifkan: 'AI fill is switched off', gagal_model: 'the AI model returned unusable answers', waktu: 'the time limit was reached',
      terlalu_banyak: 'there were too many items',
    };
    lines.push(`${ai.skipped} item(s) were left empty because ${(ai.skippedReason && why[ai.skippedReason]) || 'the AI service was unavailable'}.`);
  } else if (ai.error) {
    lines.push(`AI fill was skipped: ${ai.error}`);
  }
  return lines.length ? lines.join(' ') : null;
}