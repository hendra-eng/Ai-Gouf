'use client';

// Settings > Account Mapping: 1 akun COA (management_client_coa company aktif)
// per input, dikelompokkan Sales / Purchase / AR-AP / Inventory / Others.
// Katalog grup & input datang dari backend (settings_v1.py
// ACCOUNT_MAPPING_GROUPS). Tiap grup bisa di-collapse. Simpan lewat
// PUT /api/v1/management/settings/account-mapping (hanya input yang berubah
// yang dikirim; null = kosongkan), minimal Tahap 5. Mapping dipakai posting
// Sales/Purchase & default suspense Opening Balance (keterangan "Used in" dari
// backend ACCOUNT_MAPPING_DIPAKAI).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2, Lock, LockOpen, RotateCcw, Save, Search, Waypoints, X } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fetchClientCoa, type CoaAccount } from '@/lib/coaStore';
import { fetchAccountMapping, lockAccountMapping, saveAccountMapping, useLoader, type AccountMapping, type MappedCoa } from '@/lib/settingsStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

type Form = Record<string, string | null>;

const fmtTanggal = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Nilai tersimpan; `pakaiSaran` = input kosong diisi saran backend (default, belum tersimpan). */
function keForm(m: AccountMapping, pakaiSaran = false): Form {
  const f: Form = {};
  m.groups.forEach(g => g.items.forEach(it => { f[it.key] = it.coa_id ?? (pakaiSaran ? it.suggested_coa_id : null); }));
  return f;
}

/** Opsi select: akun aktif company + akun yang sedang terpetakan (walau nonaktif/terhapus). */
type Opsi = { id: string; acc_no: string; account_name: string; account_classification: string; catatan?: string };

export default function AccountMappingSettings() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  const { data: mapping, setData, loading, error } = useLoader<AccountMapping | null>(activeClientId, fetchAccountMapping, null);
  const { data: coa, loading: coaLoading } = useLoader<CoaAccount[]>(activeClientId, id => fetchClientCoa(id), []);
  const [form, setForm] = useState<Form>({});
  const [tutup, setTutup] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState<string | null>(null);

  // Form dibuka dengan saran sebagai default -> terhitung perubahan sampai disimpan.
  const bawaan = useMemo(() => (mapping ? keForm(mapping, true) : {}), [mapping]);
  useEffect(() => { setForm(bawaan); }, [bawaan]);

  const awal = useMemo(() => (mapping ? keForm(mapping) : {}), [mapping]);
  const berubah = useMemo(() => {
    const out: Form = {};
    for (const k of Object.keys(form)) if (form[k] !== awal[k]) out[k] = form[k];
    return out;
  }, [form, awal]);
  const jumlahBerubah = Object.keys(berubah).length;

  // 1 akun COA hanya boleh dipakai 1 input: coa_id -> key input yang memakainya.
  const labelKey = useMemo(() => new Map(mapping?.groups.flatMap(g => g.items.map(it => [it.key, it.label] as const)) ?? []), [mapping]);
  const pemakai = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [k, v] of Object.entries(form)) if (v) m.set(v, [...(m.get(v) ?? []), k]);
    return m;
  }, [form]);
  const jumlahGanda = [...pemakai.values()].filter(ks => ks.length > 1).reduce((n, ks) => n + ks.length, 0);

  // Akun terpetakan yang tidak lagi ada di daftar aktif tetap ditampilkan.
  const opsi = useMemo<Opsi[]>(() => {
    const aktif: Opsi[] = coa.filter(a => a.is_active).map(a => ({ ...a }));
    const ids = new Set(aktif.map(a => a.id));
    const ekstra = new Map<string, Opsi>();
    mapping?.groups.forEach(g => g.items.forEach(it => {
      const c: MappedCoa | null = it.coa;
      if (c && !ids.has(c.id)) ekstra.set(c.id, { ...c, catatan: c.deleted ? 'deleted' : 'inactive' });
    }));
    return [...aktif, ...ekstra.values()];
  }, [coa, mapping]);
  const opsiById = useMemo(() => new Map(opsi.map(o => [o.id, o])), [opsi]);

  async function simpan() {
    if (!activeClientId || saving || !jumlahBerubah) return;
    if (jumlahGanda) { toast.error('Each account can only be mapped once', { description: 'Pick a different account for the inputs marked in red.' }); return; }
    setSaving(true);
    try {
      setData(await saveAccountMapping(activeClientId, berubah));
      toast.success('Account mapping saved', { description: `${jumlahBerubah} account${jumlahBerubah > 1 ? 's' : ''} updated.` });
    } catch (e) {
      toast.error('Failed to save account mapping', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  // Kunci / buka kunci 1 mapping atau semua mapping yang sudah terisi.
  async function kunci(keys: string[], locked: boolean, tanda: string) {
    if (!activeClientId || !keys.length || locking) return;
    if (jumlahBerubah) { toast.error('Save or reset your unsaved changes first.'); return; }
    setLocking(tanda);
    try {
      setData(await lockAccountMapping(activeClientId, keys, locked));
      toast.success(locked ? 'Account mapping locked' : 'Account mapping unlocked', {
        description: locked ? 'Locked accounts cannot be changed from any menu until unlocked.' : undefined,
      });
    } catch (e) {
      toast.error(locked ? 'Failed to lock' : 'Failed to unlock', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLocking(null);
    }
  }

  if (!activeClientId) {
    return <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Select a company to configure account mapping.</div>;
  }
  if (loading && !mapping) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  }
  if (error && !mapping) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }
  if (!mapping) return null;

  const terisi = Object.values(form).filter(Boolean).length;
  const semuaTutup = mapping.groups.every(g => tutup[g.key]);
  const semuaItem = mapping.groups.flatMap(g => g.items);
  const bisaKunci = semuaItem.filter(it => it.coa_id && !it.is_locked).map(it => it.key);
  const terkunci = semuaItem.filter(it => it.is_locked).map(it => it.key);

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-primary ring-1 ring-blue-100"><Waypoints size={18} /></span>
          <div>
            <h2 className="text-base font-bold text-foreground">Account mapping</h2>
            <p className="text-xs text-muted-foreground">
              Default accounts used when posting transactions · <span className="font-medium text-foreground">{terisi}/{mapping.total}</span> mapped
              {' '}· <span className="font-medium text-foreground">{mapping.locked}</span> locked
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <button type="button" onClick={() => kunci(bisaKunci, true, 'all')} disabled={!bisaKunci.length || !!locking}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-slate-50 disabled:opacity-50">
          {locking === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock all mapped
        </button>
        <button type="button" onClick={() => kunci(terkunci, false, 'none')} disabled={!terkunci.length || !!locking}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-slate-50 disabled:opacity-50">
          {locking === 'none' ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock all
        </button>
        <button
          onClick={() => setTutup(Object.fromEntries(mapping.groups.map(g => [g.key, !semuaTutup])))}
          className="flex h-9 items-center gap-1.5 self-start rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-slate-50 sm:self-auto"
        >
          {semuaTutup ? <><ChevronsUpDown size={14} /> Expand all</> : <><ChevronsDownUp size={14} /> Collapse all</>}
        </button>
        </div>
      </div>

      {mapping.locked > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Lock size={16} className="mt-0.5 shrink-0" />
          <span>Locked mappings cannot be changed from any menu — including deleting, deactivating, renaming or renumbering their accounts in the Chart of Accounts — until they are unlocked here.</span>
        </div>
      )}

      {!coaLoading && coa.length === 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>This company has no chart of accounts yet. Add accounts in <Link href="/coa" className="font-semibold underline">Chart of Accounts</Link> first.</span>
        </div>
      )}

      {mapping.groups.map(g => {
        const tertutup = !!tutup[g.key];
        const isi = g.items.filter(it => form[it.key]).length;
        return (
          <section key={g.key} className="rounded-2xl border border-border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setTutup(t => ({ ...t, [g.key]: !t[g.key] }))}
              aria-expanded={!tertutup}
              className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left ${tertutup ? '' : 'border-b border-border'}`}
            >
              <div className="flex items-center gap-3">
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${tertutup ? '-rotate-90' : ''}`} />
                <h3 className="text-sm font-semibold text-foreground">{g.label}</h3>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isi === g.items.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {isi}/{g.items.length} mapped
              </span>
            </button>
            {!tertutup && (
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 md:grid-cols-2">
                {g.items.map(it => {
                  const nilai = form[it.key] ?? null;
                  const pilih = nilai ? opsiById.get(nilai) : undefined;
                  // Saran backend yang masih jadi nilai default (belum tersimpan).
                  const disarankan = !!nilai && !it.coa_id && nilai === it.suggested_coa_id;
                  const lain = nilai ? (pemakai.get(nilai) ?? []).filter(k => k !== it.key) : [];
                  return (
                    <div key={it.key}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          {it.label}
                          {it.is_locked && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"><Lock size={10} /> Locked</span>}
                          {disarankan && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Suggested from the chart of accounts — not saved yet">Suggested</span>}
                          {nilai !== (awal[it.key] ?? null) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved" />}
                        </label>
                        {(it.coa_id || it.is_locked) && (
                          <button type="button" onClick={() => kunci([it.key], !it.is_locked, it.key)} disabled={!!locking || (!it.is_locked && nilai !== (awal[it.key] ?? null))}
                            title={it.is_locked ? 'Unlock this mapping' : 'Lock this mapping'}
                            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold disabled:opacity-40 ${it.is_locked ? 'text-sky-700 hover:bg-sky-50' : 'text-slate-500 hover:bg-slate-100'}`}>
                            {locking === it.key ? <Loader2 size={12} className="animate-spin" /> : it.is_locked ? <LockOpen size={12} /> : <Lock size={12} />}
                            {it.is_locked ? 'Unlock' : 'Lock'}
                          </button>
                        )}
                      </div>
                      <CoaSelect value={nilai} opsi={opsi} loading={coaLoading} disabled={it.is_locked} ganda={lain.length > 0}
                        dipakai={id => (pemakai.get(id) ?? []).filter(k => k !== it.key).map(k => labelKey.get(k) ?? k)}
                        onChange={v => setForm(f => ({ ...f, [it.key]: v }))} />
                      {lain.length > 0 && (
                        <p className="mt-1 text-[11px] font-medium text-red-600">
                          This account is also mapped to {lain.map(k => labelKey.get(k) ?? k).join(', ')} — each account can only be mapped once.
                        </p>
                      )}
                      {it.is_locked && (
                        <p className="mt-1 text-[11px] text-sky-700">Locked{it.locked_by_name ? ` by ${it.locked_by_name}` : ''}{it.locked_at ? ` · ${fmtTanggal.format(new Date(it.locked_at))}` : ''}</p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {it.used_in ? <>Used in: {it.used_in}</> : <span className="text-slate-400">Saved for upcoming features.</span>}
                      </p>
                      {pilih?.catatan && (
                        <p className="mt-1 text-[11px] text-amber-700">This account is {pilih.catatan} in the chart of accounts — pick another one.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {jumlahGanda
              ? <span className="font-medium text-red-600">{jumlahGanda} inputs share the same account — fix them before saving</span>
              : jumlahBerubah
              ? <span className="font-medium text-amber-700">{jumlahBerubah} unsaved change{jumlahBerubah > 1 ? 's' : ''}</span>
              : mapping.edited_at ? `Updated ${fmtTanggal.format(new Date(mapping.edited_at))}` : 'No changes yet'}
            <span className="hidden sm:inline"> · Saving requires Tahap 5 (Partner) access.</span>
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setForm(bawaan)} disabled={saving || Object.keys(form).every(k => form[k] === bawaan[k])} className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-slate-50 disabled:opacity-50">
              <RotateCcw size={14} /> Reset
            </button>
            <button onClick={simpan} disabled={saving || !jumlahBerubah || jumlahGanda > 0} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Select akun COA dengan pencarian ───────────────────────────────────────

const MAKS_TAMPIL = 100;

function CoaSelect({ value, opsi, loading, onChange, disabled, ganda, dipakai }: {
  value: string | null; opsi: Opsi[]; loading: boolean; onChange: (v: string | null) => void; disabled?: boolean;
  /** Akun terpilih juga dipakai input lain. */
  ganda?: boolean;
  /** Label input lain yang sudah memakai akun ini (akun tsb tidak bisa dipilih). */
  dipakai: (id: string) => string[];
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [buka, setBuka] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const pilih = value ? opsi.find(o => o.id === value) : undefined;

  useEffect(() => {
    if (!buka) return;
    const luar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBuka(false); };
    document.addEventListener('mousedown', luar);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', luar); document.removeEventListener('keydown', esc); };
  }, [buka]);

  const hasil = useMemo(() => {
    const k = q.trim().toLowerCase();
    const cocok = k ? opsi.filter(o => o.acc_no.toLowerCase().includes(k) || kodeAkun(o.acc_no).toLowerCase().includes(k) || o.account_name.toLowerCase().includes(k)) : opsi;
    return { list: cocok.slice(0, MAKS_TAMPIL), total: cocok.length };
  }, [opsi, q]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { if (disabled) return; setBuka(b => !b); setQ(''); }}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-80 text-left text-sm transition-shadow focus:outline-none focus:ring-4 focus:ring-blue-100 ${buka ? 'border-blue-400 ring-4 ring-blue-100' : ganda ? 'border-red-400' : 'border-border'}`}
      >
        {pilih ? (
          <span className="min-w-0 truncate text-foreground">
            <span className="font-mono text-xs text-slate-500">{kodeAkun(pilih.acc_no)}</span> · {pilih.account_name}
          </span>
        ) : value ? (
          <span className="truncate text-slate-400">Loading account…</span>
        ) : (
          <span className="text-slate-400">Select account</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); onChange(null); }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-foreground"
              aria-label="Clear"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={14} className="text-slate-400" />
        </span>
      </button>

      {buka && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="relative border-b border-border p-2">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search account no. or name…"
              className="w-full rounded-lg bg-slate-50 py-1.5 pl-7 pr-2 text-sm text-foreground placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {loading && opsi.length === 0 ? (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading accounts…</li>
            ) : hasil.list.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No accounts found.</li>
            ) : hasil.list.map(o => {
              const lain = dipakai(o.id);
              return (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={lain.length > 0}
                  onClick={() => { onChange(o.id); setBuka(false); }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${o.id === value ? 'bg-blue-50' : ''}`}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-blue-600">{o.id === value && <Check size={14} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground"><span className="font-mono text-xs text-slate-500">{kodeAkun(o.acc_no)}</span> · {o.account_name}</span>
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                      {o.account_classification}{o.catatan && <span className="text-amber-600"> · {o.catatan}</span>}
                      {lain.length > 0 && <span className="normal-case tracking-normal text-slate-500"> · used in {lain.join(', ')}</span>}
                    </span>
                  </span>
                </button>
              </li>
              );
            })}
            {hasil.total > hasil.list.length && (
              <li className="px-3 py-2 text-[11px] text-muted-foreground">Showing {hasil.list.length} of {hasil.total} — type to narrow down.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
