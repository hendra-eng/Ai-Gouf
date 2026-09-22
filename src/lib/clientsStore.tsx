'use client';

// Shared client data store.
//
// Both the "Clients" page and the header "Switch Company" dropdown read from
// this single source of truth, so they always show the same list of clients.
//
// [BARU] Sekarang terhubung ke API management_clients (backend/modules/
// management/clients_v1.py: /api/v1/management/clients/...), BUKAN lagi
// /api/client (tabel `clients` lama, integer id). management_clients pakai
// UUID sebagai id -- lihat root/ddl-table & PANDUAN_INTEGRASI kalau ada.
//
// CATATAN PENTING (disepakati sadar akan risikonya): halaman-halaman lain
// yang membaca `activeClientId` dari src/lib/activeClient.tsx (transactions,
// financial-statements, budget-forecast, tax-compliance, reports,
// financial-analytics, documents, audit, dst) masih memanggil endpoint
// backend yang mengharapkan `client_id` INTEGER (tabel `clients` lama).
// Begitu clientsStore ini pindah ke UUID, fetch data di halaman-halaman itu
// akan gagal sampai mereka ikut dimigrasikan ke UUID -- itu di luar scope
// perubahan ini.

import { useEffect, useState, useCallback } from 'react';
import { type Client, type ClientStatus } from '@/lib/clientsMockData';

const CLIENTS_CHANGED_EVENT = 'gouf-clients-changed';

// Backend jalan bareng lewat proxy Next.js (rewrites /api/* -> FastAPI),
// jadi path relatif "/api" biasanya cukup. NEXT_PUBLIC_API_BASE_URL bisa
// dipakai untuk override kalau backend di-deploy di domain terpisah.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const MANAGEMENT_CLIENTS_URL = `${API_BASE_URL}/api/v1/management/clients`;

// [FIX] Sebelumnya fungsi ini membaca token dari localStorage (ambilToken(),
// sisa alur login LAMA) dan kalau dapat 401, langsung hard-redirect ke
// /login (window.location.assign) -- ini SALAH untuk 2 alasan:
//   1. Alur login sekarang menyimpan JWT di cookie httpOnly "gouf_session"
//      (lihat src/app/api/session/login/route.ts), BUKAN localStorage --
//      ambilToken() SELALU null, jadi header Authorization manual di sini
//      tidak pernah benar-benar terpasang. Cookie httpOnly-nya sendiri
//      otomatis ikut terkirim oleh browser tanpa perlu disentuh di sini.
//   2. middleware.ts (root) SUDAH jadi satu-satunya penjaga validitas sesi
//      (baca komentarnya sendiri: "cuma ADA SATU tempat yang tahu cara
//      validasi token") -- redirect independen di sini bikin DUA tempat
//      yang mengambil keputusan logout, dan kalau salah satu 401 sesaat
//      (race condition, dst) user langsung terlempar ke /login walau
//      sesinya sendiri masih valid (loop "login -> masuk dashboard ->
//      logout lagi" yang dilaporkan user). Sekarang: 401 di sini cuma
//      dilempar sebagai error biasa, ditangkap pemanggil (lihat error
//      state di useClientsList), TIDAK memaksa navigasi.
async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

function notifyClientsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
}

/** Amplop response standar /api/v1/... -- lihat backend/modules/api_response.py. */
interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request gagal (${res.status})`);
  }
  return json.data as T;
}

/** Bentuk baris client yang dikembalikan backend (lihat
 *  db_client.py::_management_client_ke_dict / modules/management/clients_v1.py). */
interface BackendManagementClient {
  id: string;
  client_code: string | null;
  nama_client: string | null;
  tipe_badan_usaha: string | null;
  npwp: string | null;
  nomor_akta_nib: string | null;
  status_pkp: boolean | null;
  klasifikasi_lapangan_usaha: string | null;
  email: string | null;
  no_telepon: string | null;
  no_handphone: string | null;
  nama_pic: string | null;
  jabatan_pic: string | null;
  alamat: string | null;
  kota: string | null;
  provinsi: string | null;
  kode_pos: string | null;
  industry: string | null;
  tahun_buku_mulai: string | null;
  mata_uang_default: string | null;
  status: string | null;
  akuntan_penanggung_jawab: string | null;
  tanggal_mulai_kerjasama: string | null;
  logo: string | null;
  created_at: string | null;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

// management_clients.status di DB cuma VARCHAR(10) -- tidak cukup untuk
// menyimpan label penuh "Attention Required" (19 karakter). Simpan kode
// singkat di backend, tapi UI tetap pakai label ClientStatus yang sama
// seperti sebelumnya (StatusBadge, filter, distribusi health tidak berubah).
const STATUS_TO_CODE: Record<ClientStatus, string> = {
  Healthy: 'healthy',
  Stable: 'stable',
  'Attention Required': 'attention',
  Critical: 'critical',
};
const CODE_TO_STATUS: Record<string, ClientStatus> = {
  healthy: 'Healthy',
  stable: 'Stable',
  attention: 'Attention Required',
  critical: 'Critical',
};

function kodeKeStatus(code: string | null): ClientStatus {
  return CODE_TO_STATUS[(code || '').toLowerCase()] || 'Stable';
}

function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '-';
  }
}

/** Petakan baris dari backend (management_clients) ke bentuk `Client` yang dipakai UI dashboard. */
function petakanDariBackend(row: BackendManagementClient): Client {
  return {
    id: row.id,
    clientCode: row.client_code || '-',
    companyName: row.nama_client || '-',
    industry: row.industry || '-',
    status: kodeKeStatus(row.status),
    // [CATATAN] management_clients tidak punya kolom accounting-status --
    // status_pkp (PKP/bukan) dipakai sebagai proxy tax-status yang paling
    // dekat maknanya, sisanya masih placeholder sampai modul laporan
    // keuangan/health-score disambungkan ke tabel ini.
    taxStatus: row.status_pkp ? 'Compliant' : 'Pending',
    accountingStatus: 'Pending Review',
    assignedAccountant: row.akuntan_penanggung_jawab || '-',
    financials: { revenue: 0, netProfit: 0, cash: 0, ar: 0, ap: 0, grossMargin: 0, revenueGrowth: 0, trendData: [0, 0, 0, 0, 0, 0, 0, 0] },
    healthScore: { overall: 50, liquidity: 50, profitability: 50, cashFlow: 50, solvency: 50, compliance: 50 },
    joinDate: formatTanggal(row.tanggal_mulai_kerjasama || row.created_at),
    lastActivity: formatTanggal(row.edited_at || row.created_at),
    contactName: row.nama_pic || '-',
    contactEmail: row.email || '-',
    contactPhone: row.no_handphone || row.no_telepon || '-',
    npwp: row.npwp || '-',
    address: row.alamat || '-',
    logo: row.logo || null,
    aiInsight: 'New client — insufficient data for AI assessment yet.',
  };
}

type ClientFormInput = Omit<Client, 'id' | 'financials' | 'healthScore' | 'joinDate' | 'lastActivity' | 'aiInsight'>;

// [FIX] petakanDariBackend() di atas memakai "-" sebagai placeholder TAMPILAN
// kalau kolom aslinya NULL (mis. akuntan_penanggung_jawab belum diisi).
// AddClientModal (ClientsPageClient.tsx) mem-prefill input form edit dari
// nilai itu apa adanya -- kalau user tidak sempat mengubah field itu lalu
// submit, "-" ikut ter-roundtrip sebagai "nilai baru" ke backend. Untuk
// kolom biasa (varchar) ini cuma menulis "-" secara keliru, tapi untuk
// akuntan_penanggung_jawab (di-cast ::UUID di backend) ini bikin query
// meledak: invalid input syntax for type uuid: "-". Buang placeholder ini
// di titik keluar (sebelum dikirim ke backend) supaya field yang tidak
// disentuh user tetap dianggap "tidak diubah" (partial update).
function bukanPlaceholder(v: string | undefined | null): string | undefined {
  const t = (v ?? '').trim();
  return t && t !== '-' ? t : undefined;
}

/** Payload yang diterima backend (ManagementClientCreateRequest/UpdateRequest). */
function keBackendPayload(c: ClientFormInput): Record<string, unknown> {
  return {
    client_code: bukanPlaceholder(c.clientCode),
    nama_client: c.companyName,
    industry: c.industry || undefined,
    status: STATUS_TO_CODE[c.status] || 'stable',
    nama_pic: bukanPlaceholder(c.contactName),
    email: bukanPlaceholder(c.contactEmail),
    no_handphone: bukanPlaceholder(c.contactPhone),
    npwp: bukanPlaceholder(c.npwp),
    alamat: bukanPlaceholder(c.address),
    akuntan_penanggung_jawab: bukanPlaceholder(c.assignedAccountant),
    // undefined = tidak dikirim (logo tidak diubah), null = hapus logo.
    logo: c.logo,
  };
}

/** Ambil semua client dari backend (yang aktif/belum di-soft-delete saja). */
export async function getAllClients(): Promise<Client[]> {
  const res = await authenticatedFetch(MANAGEMENT_CLIENTS_URL);
  const rows = await baca<BackendManagementClient[]>(res);
  return rows.map(petakanDariBackend);
}

/** Tambah client baru lewat backend, lalu beri tahu komponen lain (mis. header switcher).
 *  Endpoint ini dibatasi role tahap_5/super_admin di backend -- staf non-admin akan
 *  mendapat 403. */
export async function addClient(newClient: ClientFormInput): Promise<Client> {
  const res = await authenticatedFetch(MANAGEMENT_CLIENTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keBackendPayload(newClient)),
  });
  const row = await baca<BackendManagementClient>(res);
  const client = petakanDariBackend(row);
  notifyClientsChanged();
  return client;
}

/** Update data client (nama perusahaan kini BISA diubah -- endpoint baru mendukung
 *  update penuh, beda dari /api/client/{id}/profil lama). Dibatasi role
 *  tahap_5/super_admin di backend. */
export async function updateClient(clientId: string, updates: ClientFormInput): Promise<void> {
  const res = await authenticatedFetch(`${MANAGEMENT_CLIENTS_URL}/${clientId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keBackendPayload(updates)),
  });
  await baca<BackendManagementClient>(res);
  notifyClientsChanged();
}

/** Nonaktifkan (soft-delete) client -- data TIDAK dihapus permanen dari database,
 *  cuma disembunyikan dari daftar default. Dibatasi role tahap_5/super_admin. */
export async function deleteClient(clientId: string): Promise<void> {
  const res = await authenticatedFetch(`${MANAGEMENT_CLIENTS_URL}/${clientId}`, { method: 'DELETE' });
  await baca<null>(res);
  notifyClientsChanged();
}

/** Import beberapa client sekaligus (mis. dari CSV) -- dikirim satu per satu ke backend.
 *  Terima objek `Client` lengkap (hasil parseClientsCsv sudah termasuk id/financials/dll
 *  bikinan lokal) -- field itu diabaikan di sini karena backend membuat id-nya sendiri. */
export async function addImportedClients(imported: Client[]): Promise<void> {
  if (imported.length === 0) return;
  for (const c of imported) {
    await addClient(c);
  }
  notifyClientsChanged();
}

/**
 * React hook that keeps a component's client list in sync with the backend.
 * Re-fetches whenever a client is added elsewhere in the app (same tab, via
 * a custom event) -- there is no cross-tab "storage" event anymore since
 * this is no longer localStorage-backed.
 */
export function useClientsList(): { clients: Client[]; loading: boolean; error: string | null; refresh: () => void } {
  const [list, setList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    setLoading(true);
    getAllClients()
      .then(data => {
        setList(data);
        setError(null);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat client'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    muatUlang();
    window.addEventListener(CLIENTS_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(CLIENTS_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { clients: list, loading, error, refresh: muatUlang };
}

export type { Client, ClientStatus };
