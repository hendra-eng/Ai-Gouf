// Engine upload BATCH (banyak file) yang TIDAK terikat ke komponen React.
//
// Masalah sebelumnya: progres upload ("2/5") disimpan di useState komponen header (SalesClient,
// PurchaseTabs, useStatementUpload). Begitu pindah tab / halaman, komponen itu di-unmount ->
// state hilang -> tombol kembali "Upload File" padahal upload masih jalan di belakang.
//
// Sekarang:
//   1. Loop upload berjalan di level MODUL (di luar React) -> pindah tab/halaman tidak
//      mengganggu, dan komponen mana pun yang dipasang ulang langsung membaca progres yang sama
//      lewat useProgresBatch().
//   2. Antrian file (+ progres) disimpan di IndexedDB. Kalau halaman di-refresh / browser
//      ditutup di tengah batch, <UploadBatchResumer /> (dipasang di AppLayout) melanjutkan sisa
//      file secara otomatis begitu user login lagi.
//   3. navigator.locks dipakai supaya batch yang sama tidak dijalankan dobel kalau ada 2 tab browser.
//
// Handler per modul (sales / purchase / bankcash) ada di uploadBatchHandlers.ts dan
// bank-cash/lib/bankUploadBatch.ts.

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

export type BatchModul = 'sales' | 'purchase' | 'bankcash';

export interface CatatanBatch {
  jenis: 'gagal' | 'peringatan' | 'info';
  teks: string;
}

/** Hasil pemrosesan 1 file. ok=true -> dihitung "berhasil" di angka tombol (x/y). */
export interface HasilFile {
  ok: boolean;
  /** Angka yang dijumlahkan lintas file (mis. { created: 12 }). Ikut tersimpan, jadi tahan refresh. */
  stats?: Record<string, number>;
  catatan?: CatatanBatch[];
}

export interface RingkasanBatch {
  total: number;
  berhasil: number;
  stats: Record<string, number>;
  catatan: CatatanBatch[];
  /** Nama file yang sedang diproses saat halaman di-refresh dan TIDAK diulang (lihat ulangiYangTerputus). */
  terputus: string[];
}

export interface BatchHandler {
  /** Proses 1 file. Handler menangani error & toast per file sendiri; kalau melempar error dihitung gagal. */
  proses: (file: File, konteks: { total: number }) => Promise<HasilFile>;
  /** Dipanggil sekali setelah SEMUA file selesai (juga untuk batch yang dilanjutkan setelah refresh). */
  selesai: (ringkasan: RingkasanBatch) => void;
  /**
   * File yang sedang dikirim saat halaman di-refresh: tidak diketahui sudah tersimpan di server atau belum.
   * true  = kirim ulang (aman bila backend menolak duplikat, mis. rekening koran).
   * false = lewati & beri tahu user supaya dicek manual di Source Data (hindari data dobel).
   */
  ulangiYangTerputus: boolean;
}

interface BatchTersimpan {
  key: string;
  modul: BatchModul;
  clientId: string;
  total: number;
  berhasil: number;
  stats: Record<string, number>;
  catatan: CatatanBatch[];
  sisa: File[];
  sedang: File | null;
  terputus: string[];
  /** Nama/tipe/tanggal file dicatat terpisah: pengaman kalau browser mengembalikan Blob polos dari IndexedDB. */
  sisaMeta?: MetaFile[];
  sedangMeta?: MetaFile | null;
}

export interface MetaFile {
  name: string;
  type: string;
  lastModified: number;
}

export const metaDari = (f: File): MetaFile => ({ name: f.name, type: f.type, lastModified: f.lastModified });

/** File dari IndexedDB -> pastikan tetap File lengkap dengan nama aslinya. */
export function pulihkanFile(f: Blob, meta?: MetaFile | null): File {
  if (f instanceof File && f.name) return f;
  return new File([f], meta?.name || 'file', { type: meta?.type || f.type, lastModified: meta?.lastModified });
}

export interface ProgresBatch {
  berhasil: number;
  total: number;
}

const kunci = (modul: BatchModul, clientId: string) => `${modul}:${clientId}`;

// ───────────────────────── IndexedDB (key-value kecil) ─────────────────────────
// Semua operasi "best effort": kalau IndexedDB tidak tersedia (mis. mode private), batch tetap
// jalan normal di memori -- hanya tidak bisa dilanjutkan setelah refresh.

const DB_NAME = 'gouf-upload-batch';
const STORE_BATCH = 'batches';
export const STORE_REVIEW = 'bankcash-review';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function bukaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_BATCH)) db.createObjectStore(STORE_BATCH, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(STORE_REVIEW)) db.createObjectStore(STORE_REVIEW, { keyPath: 'clientId' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function jalankanTx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await bukaDb();
    if (!db) return null;
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export const idbSimpan = (store: string, nilai: unknown) => jalankanTx(store, 'readwrite', (s) => s.put(nilai));
export const idbHapus = (store: string, key: string) => jalankanTx(store, 'readwrite', (s) => s.delete(key));
export const idbAmbil = <T,>(store: string, key: string) => jalankanTx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
export async function idbAmbilSemua<T>(store: string): Promise<T[]> {
  return (await jalankanTx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
}

// ───────────────────────── State di memori + subscribe ─────────────────────────

const aktif = new Map<string, BatchTersimpan>();
const progres = new Map<string, ProgresBatch>();
const sedangDilanjutkan = new Set<string>();
const listeners = new Set<() => void>();

function umumkan(key: string) {
  const rec = aktif.get(key);
  if (!rec) progres.delete(key);
  else {
    const lama = progres.get(key);
    if (!lama || lama.berhasil !== rec.berhasil || lama.total !== rec.total) progres.set(key, { berhasil: rec.berhasil, total: rec.total });
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Progres batch yang sedang berjalan untuk modul + client ini (null = tidak ada).
 * berhasil = jumlah file yang sudah berhasil, total = jumlah file di batch.
 * Aman dipakai di komponen mana pun: nilainya sama walau komponen di-mount ulang / pindah halaman.
 */
export function useProgresBatch(modul: BatchModul, clientId: string | null): ProgresBatch | null {
  return useSyncExternalStore(
    subscribe,
    () => ambilProgresBatch(modul, clientId),
    () => null,
  );
}

/** Versi non-hook dari useProgresBatch (snapshot saat ini). */
export function ambilProgresBatch(modul: BatchModul, clientId: string | null): ProgresBatch | null {
  return clientId ? progres.get(kunci(modul, clientId)) ?? null : null;
}

// ───────────────────────── Menjalankan batch ─────────────────────────

const salin = (r: BatchTersimpan): BatchTersimpan => ({
  ...r,
  sisa: [...r.sisa],
  stats: { ...r.stats },
  catatan: [...r.catatan],
  terputus: [...r.terputus],
  sisaMeta: r.sisa.map(metaDari),
  sedangMeta: r.sedang ? metaDari(r.sedang) : null,
});

async function kerjakan(rec: BatchTersimpan, handler: BatchHandler) {
  const key = rec.key;
  aktif.set(key, rec);
  umumkan(key);
  await idbSimpan(STORE_BATCH, salin(rec));

  while (rec.sisa.length) {
    const file = rec.sisa.shift() as File;
    rec.sedang = file;
    await idbSimpan(STORE_BATCH, salin(rec)); // jejak "file ini sedang dikirim" sebelum request berangkat

    let hasil: HasilFile;
    try {
      hasil = await handler.proses(file, { total: rec.total });
    } catch (e) {
      hasil = { ok: false, stats: { gagal: 1 }, catatan: [{ jenis: 'gagal', teks: `${file.name}: ${e instanceof Error ? e.message : 'Upload failed'}` }] };
    }

    rec.sedang = null;
    if (hasil.ok) rec.berhasil += 1;
    for (const [k, v] of Object.entries(hasil.stats ?? {})) rec.stats[k] = (rec.stats[k] ?? 0) + v;
    if (hasil.catatan?.length) rec.catatan.push(...hasil.catatan);
    umumkan(key);
    await idbSimpan(STORE_BATCH, salin(rec));
  }

  aktif.delete(key);
  umumkan(key);
  await idbHapus(STORE_BATCH, key);
  try {
    handler.selesai({ total: rec.total, berhasil: rec.berhasil, stats: rec.stats, catatan: rec.catatan, terputus: rec.terputus });
  } catch { /* ringkasan gagal ditampilkan tidak boleh merusak apa pun */ }
}

/**
 * Jalankan fn hanya kalau lock batch ini bisa diambil (mencegah 2 tab menjalankan batch yang sama).
 * Mengembalikan false kalau lock dipegang tab lain (fn tidak dijalankan).
 */
async function denganLock(key: string, fn: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) {
    await fn();
    return true;
  }
  return locks.request(`gouf-upload:${key}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await fn();
    return true;
  });
}

/**
 * Mulai batch baru. Kalau batch untuk modul+client ini masih berjalan, file baru ditambahkan ke
 * antriannya (total ikut bertambah) -- tidak membuat loop kedua.
 */
export function mulaiBatch(modul: BatchModul, clientId: string, files: File[], handler: BatchHandler) {
  if (!files.length) return;
  const key = kunci(modul, clientId);
  const berjalan = aktif.get(key);
  if (berjalan) {
    berjalan.sisa.push(...files);
    berjalan.total += files.length;
    umumkan(key);
    void idbSimpan(STORE_BATCH, salin(berjalan));
    return;
  }
  const rec: BatchTersimpan = { key, modul, clientId, total: files.length, berhasil: 0, stats: {}, catatan: [], sisa: [...files], sedang: null, terputus: [] };
  // Tampilkan progres 0/N seketika (sebelum lock/IndexedDB), supaya tombol langsung berubah.
  aktif.set(key, rec);
  umumkan(key);
  void denganLock(key, () => kerjakan(rec, handler)).then((didapat) => {
    if (didapat) return;
    // Tab browser lain sedang menjalankan batch yang sama -> batalkan tampilan sementara.
    if (aktif.get(key) === rec) {
      aktif.delete(key);
      umumkan(key);
    }
    toast.warning('Another browser tab is already uploading for this company. Wait for it to finish, then try again.');
  });
}

/**
 * Lanjutkan batch yang tersimpan di IndexedDB (setelah refresh / browser ditutup). Dipanggil sekali
 * oleh <UploadBatchResumer /> di AppLayout. `buatHandler` memberi handler sesuai modul.
 */
export async function lanjutkanBatchTersimpan(buatHandler: (modul: BatchModul, clientId: string) => BatchHandler | null) {
  const semua = await idbAmbilSemua<BatchTersimpan>(STORE_BATCH);
  for (const tersimpan of semua) {
    const { key } = tersimpan;
    if (aktif.has(key) || sedangDilanjutkan.has(key)) continue;
    const handler = buatHandler(tersimpan.modul, tersimpan.clientId);
    if (!handler) continue;
    sedangDilanjutkan.add(key);
    void denganLock(key, async () => {
      // Baca ulang di dalam lock: tab lain mungkin sudah menyelesaikan batch ini.
      const rec = await idbAmbil<BatchTersimpan>(STORE_BATCH, key);
      if (!rec) return;
      rec.sisa = rec.sisa.map((f, i) => pulihkanFile(f, rec.sisaMeta?.[i]));
      if (rec.sedang) rec.sedang = pulihkanFile(rec.sedang, rec.sedangMeta);
      if (rec.sedang) {
        if (handler.ulangiYangTerputus) rec.sisa.unshift(rec.sedang);
        else rec.terputus.push(rec.sedang.name);
        rec.sedang = null;
      }
      if (!rec.sisa.length) {
        await idbHapus(STORE_BATCH, key);
        handler.selesai({ total: rec.total, berhasil: rec.berhasil, stats: rec.stats, catatan: rec.catatan, terputus: rec.terputus });
        return;
      }
      await kerjakan(rec, handler);
    }).finally(() => sedangDilanjutkan.delete(key));
  }
}
