'use client';

// Management > Settings (/settings/...).
// - Company: detail management_clients mentah (field backend apa adanya) lewat
//   endpoint yang sudah ada /api/v1/management/clients/{id} (clients_v1.py).
// - User Management: /api/v1/management/settings/users?client_id= (settings_v1.py).
// - Purchase: GET/PUT /api/v1/management/settings/purchase?client_id= (settings_v1.py,
//   tabel management_setting_purchase). PUT = upsert, minimal Tahap 5.
// - Product: GET/PUT /api/v1/management/settings/product?client_id= (subfeature)
//   + CRUD /settings/product/{categories|units} (search + pagination server-side).
// - Account Mapping: GET/PUT /api/v1/management/settings/account-mapping?client_id=
//   (1 akun COA company per input; PUT parsial, null = kosongkan).

import { useCallback, useEffect, useRef, useState } from 'react';
import { swrGet, swrSet } from './swrCache';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const CLIENTS_URL = `${API_BASE_URL}/api/v1/management/clients`;
const SETTINGS_URL = `${API_BASE_URL}/api/v1/management/settings`;
// Sama dengan CLIENTS_CHANGED_EVENT di clientsStore.tsx -- header "Switch Company"
// & halaman Clients ikut refresh setelah data company diubah di Settings.
const CLIENTS_CHANGED_EVENT = 'gouf-clients-changed';

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new Error(json?.message || (typeof detail === 'string' ? detail : '') || `Request gagal (${res.status})`);
  }
  return json.data as T;
}

/** Baris management_clients persis seperti dikembalikan backend. */
export interface CompanyDetail {
  id: string;
  client_code: string | null;
  nama_client: string;
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
  /** Kode kesehatan finansial: healthy/stable/attention/critical (badge halaman Clients). */
  status: string | null;
  akuntan_penanggung_jawab: string | null;
  tanggal_mulai_kerjasama: string | null;
  logo: string | null;
  created_at: string | null;
  edited_at: string | null;
}

export type CompanyInput = Partial<Omit<CompanyDetail, 'id' | 'created_at' | 'edited_at'>>;

export type RoleGroup = 'client' | 'internal' | 'super_admin' | 'unknown';

export interface CompanyUser {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  role: string;
  role_label: string;
  role_group: RoleGroup;
  is_active: boolean;
  is_member: boolean;
  client_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Accountant {
  id: string;
  name: string;
  username: string;
  role_label: string;
  is_active: boolean;
}

export async function fetchCompany(id: string): Promise<CompanyDetail> {
  return baca<CompanyDetail>(await fetch(`${CLIENTS_URL}/${encodeURIComponent(id)}`, { cache: 'no-store' }));
}

export async function updateCompany(id: string, data: CompanyInput): Promise<CompanyDetail> {
  const res = await fetch(`${CLIENTS_URL}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const hasil = await baca<CompanyDetail>(res);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
  return hasil;
}

export async function fetchCompanyUsers(clientId: string): Promise<CompanyUser[]> {
  return baca<CompanyUser[]>(await fetch(`${SETTINGS_URL}/users?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

export async function fetchAccountants(): Promise<Accountant[]> {
  return baca<Accountant[]>(await fetch(`${SETTINGS_URL}/accountants`, { cache: 'no-store' }));
}

export interface PurchaseSetting {
  client_id: string;
  /** false = company belum pernah menyimpan, nilai di bawah = default. */
  exists: boolean;
  preferred_purchase_term: string | null;
  activate_supplier_in_purchase_request: boolean;
  shipping: boolean;
  discount: boolean;
  discount_per_lines: boolean;
  deposit: boolean;
  default_purchase_message: string | null;
  edited_at: string | null;
  /** Pilihan valid preferred_purchase_term (PURCHASE_TERMS di backend). */
  term_options: string[];
}

export type PurchaseSettingInput = Omit<PurchaseSetting, 'client_id' | 'exists' | 'edited_at' | 'term_options'>;

export async function fetchPurchaseSetting(clientId: string): Promise<PurchaseSetting> {
  return baca<PurchaseSetting>(await fetch(`${SETTINGS_URL}/purchase?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

export async function savePurchaseSetting(clientId: string, data: PurchaseSettingInput): Promise<PurchaseSetting> {
  const res = await fetch(`${SETTINGS_URL}/purchase?client_id=${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return baca<PurchaseSetting>(res);
}

export interface ProductSetting {
  client_id: string;
  exists: boolean;
  stock_info_on_sales_purchases: boolean;
  product_variant: boolean;
  edited_at: string | null;
}

export type ProductSettingInput = Pick<ProductSetting, 'stock_info_on_sales_purchases' | 'product_variant'>;

export async function fetchProductSetting(clientId: string): Promise<ProductSetting> {
  return baca<ProductSetting>(await fetch(`${SETTINGS_URL}/product?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

export async function saveProductSetting(clientId: string, data: ProductSettingInput): Promise<ProductSetting> {
  const res = await fetch(`${SETTINGS_URL}/product?client_id=${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return baca<ProductSetting>(res);
}

/** Master product category / unit: segmen URL di backend. */
export type ProductMasterKind = 'categories' | 'units';

export interface ProductMasterItem {
  id: string;
  client_id: string;
  name: string;
  amount: number;
  created_at: string | null;
  edited_at: string | null;
}

export interface ProductMasterInput {
  name: string;
  amount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export async function fetchProductMaster(
  kind: ProductMasterKind, clientId: string, opts: { search?: string; page?: number; pageSize?: number } = {},
): Promise<Paged<ProductMasterItem>> {
  const q = new URLSearchParams({ client_id: clientId, page: String(opts.page ?? 1), page_size: String(opts.pageSize ?? 20) });
  if (opts.search?.trim()) q.set('search', opts.search.trim());
  return baca<Paged<ProductMasterItem>>(await fetch(`${SETTINGS_URL}/product/${kind}?${q}`, { cache: 'no-store' }));
}

export async function createProductMaster(kind: ProductMasterKind, clientId: string, data: ProductMasterInput): Promise<ProductMasterItem> {
  const res = await fetch(`${SETTINGS_URL}/product/${kind}?client_id=${encodeURIComponent(clientId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return baca<ProductMasterItem>(res);
}

export async function updateProductMaster(kind: ProductMasterKind, id: string, data: ProductMasterInput): Promise<ProductMasterItem> {
  const res = await fetch(`${SETTINGS_URL}/product/${kind}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return baca<ProductMasterItem>(res);
}

export async function deleteProductMaster(kind: ProductMasterKind, id: string): Promise<void> {
  await baca<{ id: string }>(await fetch(`${SETTINGS_URL}/product/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export interface MappedCoa {
  id: string;
  acc_no: string;
  account_name: string;
  account_classification: string;
  is_active: boolean;
  /** Akun sudah dihapus dari COA setelah dipetakan -- perlu dipilih ulang. */
  deleted: boolean;
}

export interface AccountMappingItem {
  key: string;
  label: string;
  /** Fitur yang sudah memakai mapping ini; null = baru disimpan, belum dipakai. */
  used_in: string | null;
  coa_id: string | null;
  coa: MappedCoa | null;
}

export interface AccountMappingGroup {
  key: string;
  label: string;
  items: AccountMappingItem[];
}

export interface AccountMapping {
  client_id: string;
  groups: AccountMappingGroup[];
  mapped: number;
  total: number;
  edited_at: string | null;
}

export async function fetchAccountMapping(clientId: string): Promise<AccountMapping> {
  return baca<AccountMapping>(await fetch(`${SETTINGS_URL}/account-mapping?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

/** mappings: {mapping_key: coa_id | null}; key yang tidak dikirim tidak diubah. */
export async function saveAccountMapping(clientId: string, mappings: Record<string, string | null>): Promise<AccountMapping> {
  const res = await fetch(`${SETTINGS_URL}/account-mapping?client_id=${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  });
  return baca<AccountMapping>(res);
}

/** Hook generik: muat ulang saat `key` berubah atau refresh() dipanggil. key null = tidak fetch. */
// Tiap loader (fungsi modul yang stabil) dapat id sendiri supaya dua halaman Settings
// yang sama-sama memakai key client yang sama tidak saling menimpa cache.
const loaderIds = new WeakMap<object, number>();
let loaderSeq = 0;
function loaderId(fn: object): number {
  let id = loaderIds.get(fn);
  if (id === undefined) { id = ++loaderSeq; loaderIds.set(fn, id); }
  return id;
}

export function useLoader<T>(key: string | null, loader: (key: string) => Promise<T>, initial: T) {
  const cacheKey = key ? `settings:${loaderId(loader)}:${key}` : null;
  const [data, setData] = useState<T>(() => (cacheKey ? swrGet<T>(cacheKey) : undefined) ?? initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!key || !cacheKey) return;
    let batal = false;
    // Pindah tab / ganti client: tampilkan data terakhir langsung, segarkan diam-diam.
    // refresh() eksplisit (tick berubah, key sama) tetap menampilkan loading dan tidak
    // menimpa data lokal dengan cache lama.
    const keyBerubah = lastKey.current !== cacheKey;
    lastKey.current = cacheKey;
    const hit = keyBerubah ? swrGet<T>(cacheKey) : undefined;
    if (hit !== undefined) { setData(hit); setLoading(false); } else { setLoading(true); }
    loader(key)
      .then(d => { if (!batal) { swrSet(cacheKey, d); setData(d); setError(null); } })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load data.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
    // loader sengaja tidak masuk deps: selalu fungsi modul (stabil).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return { data, setData, loading, error, refresh };
}
