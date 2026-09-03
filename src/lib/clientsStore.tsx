'use client';

// Shared client data store.
//
// Both the "Clients" page and the header "Switch Company" dropdown read from
// this single source of truth, so they always show the same list of clients.
//
// [BARU] Sekarang benar-benar terhubung ke backend (FastAPI + Supabase) lewat
// GET/POST /api/client dan PUT /api/client/{id}/profil (lihat main.py), jadi
// data client permanen dan sama di semua device -- bukan lagi localStorage.

import { useEffect, useState, useCallback } from 'react';
import { type Client, type ClientStatus } from '@/lib/clientsMockData';

const CLIENTS_CHANGED_EVENT = 'gouf-clients-changed';

// Backend jalan bareng lewat proxy Next.js (rewrites /api/* -> FastAPI),
// jadi path relatif "/api" biasanya cukup. NEXT_PUBLIC_API_BASE_URL bisa
// dipakai untuk override kalau backend di-deploy di domain terpisah.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

function notifyClientsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
}

/** Bentuk baris client yang dikembalikan backend (lihat db_client.py::daftar_client). */
interface BackendClient {
  id: number;
  nama: string;
  lokasi: string | null;
  tipe: string;
  nomor_wa: string | null;
  email: string | null;
  industry: string | null;
  status: string | null;
  assigned_accountant: string | null;
  contact_name: string | null;
  npwp: string | null;
  address: string | null;
  dibuat_at: string | null;
  jumlah_akun_esb: number;
}

function formatTanggal(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '-';
  }
}

/** Petakan baris dari backend ke bentuk `Client` yang dipakai UI dashboard. */
function petakanDariBackend(row: BackendClient): Client {
  return {
    id: String(row.id),
    companyName: row.nama,
    industry: row.industry || '-',
    status: (row.status as ClientStatus) || 'Stable',
    taxStatus: 'Pending',
    accountingStatus: 'Pending Review',
    assignedAccountant: row.assigned_accountant || '-',
    // [CATATAN] financials & healthScore belum dihitung dari data
    // keuangan asli -- masih nilai default sampai modul laporan
    // keuangan/health-score disambungkan ke halaman Clients ini.
    financials: { revenue: 0, netProfit: 0, cash: 0, ar: 0, ap: 0, grossMargin: 0, revenueGrowth: 0, trendData: [0, 0, 0, 0, 0, 0, 0, 0] },
    healthScore: { overall: 50, liquidity: 50, profitability: 50, cashFlow: 50, solvency: 50, compliance: 50 },
    joinDate: formatTanggal(row.dibuat_at),
    lastActivity: formatTanggal(row.dibuat_at),
    contactName: row.contact_name || '-',
    contactEmail: row.email || '-',
    contactPhone: row.nomor_wa || '-',
    npwp: row.npwp || '-',
    address: row.address || '-',
    aiInsight: 'New client — insufficient data for AI assessment yet.',
  };
}

/** Ambil semua client dari backend. */
export async function getAllClients(): Promise<Client[]> {
  const res = await fetch(`${API_BASE_URL}/api/client`);
  if (!res.ok) {
    throw new Error(`Gagal mengambil daftar client (${res.status})`);
  }
  const data = await res.json();
  const rows: BackendClient[] = data.clients || [];
  return rows.map(petakanDariBackend);
}

/** Tambah client baru lewat backend, lalu beri tahu komponen lain (mis. header switcher). */
export async function addClient(
  newClient: Omit<Client, 'id' | 'financials' | 'healthScore' | 'joinDate' | 'lastActivity' | 'aiInsight'>
): Promise<Client> {
  const form = new FormData();
  form.append('nama', newClient.companyName);
  form.append('tipe', 'accounting');
  if (newClient.contactPhone) form.append('nomor_wa', newClient.contactPhone);
  if (newClient.contactEmail) form.append('email', newClient.contactEmail);
  if (newClient.industry) form.append('industry', newClient.industry);
  if (newClient.status) form.append('status', newClient.status);
  if (newClient.assignedAccountant) form.append('assigned_accountant', newClient.assignedAccountant);
  if (newClient.contactName) form.append('contact_name', newClient.contactName);
  if (newClient.npwp) form.append('npwp', newClient.npwp);
  if (newClient.address) form.append('address', newClient.address);

  const res = await fetch(`${API_BASE_URL}/api/client`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Gagal menambah client (${res.status})`);
  }
  const row = await res.json();
  const client: Client = petakanDariBackend({
    ...row,
    dibuat_at: new Date().toISOString(),
    jumlah_akun_esb: 0,
  });
  notifyClientsChanged();
  return client;
}

/** Update profil client (Company Name TIDAK bisa diubah lewat endpoint ini --
 *  backend cuma expose PUT .../profil utk industry/status/assigned_accountant/
 *  contact_name/npwp/address, dan PUT .../kontak utk email/nomor_wa). Dipakai
 *  menu titik-3 "Edit" di kartu client. */
export async function updateClient(
  clientId: string,
  updates: Pick<Client, 'industry' | 'status' | 'assignedAccountant' | 'contactName' | 'npwp' | 'address' | 'contactEmail' | 'contactPhone'>
): Promise<void> {
  const profilRes = await fetch(`${API_BASE_URL}/api/client/${clientId}/profil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      industry: updates.industry,
      status: updates.status,
      assigned_accountant: updates.assignedAccountant,
      contact_name: updates.contactName,
      npwp: updates.npwp,
      address: updates.address,
    }),
  });
  if (!profilRes.ok) {
    const detail = await profilRes.json().catch(() => ({}));
    throw new Error(detail.detail || `Gagal mengubah profil client (${profilRes.status})`);
  }

  const kontakRes = await fetch(`${API_BASE_URL}/api/client/${clientId}/kontak`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nomor_wa: updates.contactPhone,
      email: updates.contactEmail,
    }),
  });
  if (!kontakRes.ok) {
    const detail = await kontakRes.json().catch(() => ({}));
    throw new Error(detail.detail || `Gagal mengubah kontak client (${kontakRes.status})`);
  }

  notifyClientsChanged();
}

/** Hapus client permanen dari backend. Dipakai menu titik-3 "Delete" di
 *  kartu client. */
export async function deleteClient(clientId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/client/${clientId}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Gagal menghapus client (${res.status})`);
  }
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