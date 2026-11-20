'use client';

// Editor saldo awal 1 set (/coa/opening-balances/[id]): tabel seluruh akun COA
// klien (dikelompokkan per klasifikasi) dengan input debit/kredit, footer
// sticky berisi total & selisih, serta aksi Save / Post / Revise / Lock.
// Dua tab: "Import Data" (OpeningBalanceImportTab, default) dan "Detail" (editor ini).
//
// Status draft = bisa diedit. Posted/locked = read-only (Revise membalik
// jurnal lama & mengembalikan ke draft). Selisih debit-kredit TIDAK diblok:
// saat post diparkir ke akun penampung.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Calculator, CheckCircle2, ChevronDown, ChevronRight, Download, FileText, GitBranch, Inbox, ListTree, Loader2,
  Lock, LockOpen, RotateCcw, Save, Search, Table2, Trash2, Upload, X,
} from 'lucide-react';
import { ACCOUNT_CLASSIFICATIONS, useClientCoa, type CoaAccount } from '@/lib/coaStore';
import {
  OpeningBalanceError,
  deleteOpeningBalance,
  fetchOpeningBalance,
  formatAmount,
  lockOpeningBalance,
  parseAmount,
  postOpeningBalance,
  reviseOpeningBalance,
  saveOpeningBalanceLines,
  unlockOpeningBalance,
  updateOpeningBalance,
  type OpeningBalanceDetail,
} from '@/lib/openingBalanceStore';
import { useClientsList } from '@/lib/clientsStore';
import { useActiveClient } from '@/lib/activeClient';
import { fetchOpeningBalances } from '@/lib/openingBalanceStore';
import { ObClientSwitcher, ObMissingNotice } from './ObClientSwitcher';
import { labelClassification, themeOf } from '../../components/coaTheme';
import OpeningBalanceImportTab from './OpeningBalanceImportTab';
import { ControlStatusBanner } from './importUi';
import { fetchImportOverview, type ImportControlStatus } from '@/lib/openingBalanceImportStore';
import { exportOpeningBalanceXlsx } from './obExport';
import { StatusBadge, SuspenseSelect, branchLabel, formatDate } from './obUi';
import { btnOutline, btnPrimary, tabBarCls, tabCls, tabListCls } from '@/components/arap/arapSalesUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const NERACA = new Set(['ASSET', 'LIABILITY', 'EQUITY']);

// Akun Current Year Earnings dihitung OTOMATIS = sum(kredit - debit) seluruh akun
// P&L, cuma sbg info: TIDAK dijurnal & tidak masuk total Dr/Cr, karena Financial
// Statements sudah menghitung laba tahun berjalan dari akun P&L (kalau ikut
// dijurnal, laba dobel & jurnal opening tidak balance). Backend menolak akun ini
// sbg baris saldo (opening_balance_v1.STANDARD_CODE_LABA_BERJALAN).
const KODE_LABA_BERJALAN = 'std_equity_current_period_earnings';
const isLabaBerjalan = (a: CoaAccount) => (a.standard_account_code ?? '').trim().toLowerCase() === KODE_LABA_BERJALAN;
const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 ' +
  'transition-shadow focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:bg-neutral-50 disabled:text-neutral-500';
const labelCls = 'mb-1.5 block text-xs font-semibold text-neutral-600';
const hintCls = 'mt-1 text-[11px] text-neutral-500';

type Nilai = { debit: string; credit: string };
type Tab = 'import' | 'detail';
type Aksi = 'save' | 'post' | 'revise' | 'lock' | 'unlock' | 'delete' | null;

function nilaiDariDetail(ob: OpeningBalanceDetail): Record<string, Nilai> {
  const out: Record<string, Nilai> = {};
  for (const l of ob.lines) {
    out[l.coa_id] = { debit: l.debit ? formatAmount(l.debit) : '', credit: l.credit ? formatAmount(l.credit) : '' };
  }
  return out;
}

/** Bentuk kanonik untuk deteksi perubahan (urut per coa_id). */
function kanonik(v: Record<string, Nilai>): string {
  return JSON.stringify(
    Object.entries(v)
      .map(([id, n]) => [id, parseAmount(n.debit), parseAmount(n.credit)] as const)
      .filter(([, d, c]) => d > 0 || c > 0)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

export default function OpeningBalanceEditorClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [ob, setOb] = useState<OpeningBalanceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nilai, setNilai] = useState<Record<string, Nilai>>({});
  const [tersimpan, setTersimpan] = useState('[]');
  const [header, setHeader] = useState({ asOf: '', suspenseId: '', reference: '', notes: '' });
  const [aksi, setAksi] = useState<Aksi>(null);
  const [search, setSearch] = useState('');
  const [hanyaTerisi, setHanyaTerisi] = useState(false);
  const [tertutup, setTertutup] = useState<Set<string>>(new Set());
  const [sorotPenampung, setSorotPenampung] = useState(false);
  const penampungRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('import');
  // Saldo akun kontrol yang masih sementara (detail subledger belum diimpor) / beda dengan file COA.
  const [kontrol, setKontrol] = useState<ImportControlStatus[]>([]);
  const { clients } = useClientsList();
  const { setActiveClient } = useActiveClient();

  // Ganti client langsung dari halaman ini: kalau client tujuan punya opening balance -> buka;
  // kalau belum -> tampilkan pemberitahuan (tanpaOb), tanpa perlu keluar ke halaman COA.
  const [tanpaOb, setTanpaOb] = useState<{ id: string; name: string } | null>(null);
  const [beralih, setBeralih] = useState(false);
  const gantiClient = async (clientId: string) => {
    const c = clients.find(x => x.id === clientId);
    if (!c || beralih) return;
    if (clientId === ob?.client_id) { setTanpaOb(null); return; }
    setBeralih(true);
    try {
      const daftar = await fetchOpeningBalances(clientId);
      setActiveClient(c.id, c.companyName);
      if (daftar.length > 0) {
        const tujuan = [...daftar].sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
        setTanpaOb(null);
        router.push(`/coa/opening-balances/${tujuan.id}`);
      } else {
        setTanpaOb({ id: c.id, name: c.companyName });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch client.');
    } finally {
      setBeralih(false);
    }
  };

  const { accounts, loading: loadingCoa } = useClientCoa(ob?.client_id ?? null);

  const terapkan = useCallback((d: OpeningBalanceDetail) => {
    setOb(d);
    const v = nilaiDariDetail(d);
    setNilai(v);
    setTersimpan(kanonik(v));
    setHeader({ asOf: d.as_of_date.slice(0, 10), suspenseId: d.suspense_account?.id ?? '', reference: d.reference ?? '', notes: d.notes ?? '' });
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchOpeningBalance(id)
      .then(d => { terapkan(d); setLoadError(null); })
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Failed to load opening balance.'));
  }, [id, terapkan]);

  const muatKontrol = useCallback(async () => {
    if (!id) return [] as ImportControlStatus[];
    try {
      const k = (await fetchImportOverview(id)).control_status ?? [];
      setKontrol(k);
      return k;
    } catch {
      return [] as ImportControlStatus[];
    }
  }, [id]);

  useEffect(() => { if (tab === 'detail') muatKontrol(); }, [tab, muatKontrol]);

  const draft = ob?.status === 'draft';
  const awalTahun = !!ob && header.asOf === `${ob.fiscal_year - 1}-12-31`;

  const headerBerubah = !!ob && (
    header.asOf !== ob.as_of_date.slice(0, 10) ||
    header.suspenseId !== (ob.suspense_account?.id ?? '') ||
    header.reference !== (ob.reference ?? '') ||
    header.notes !== (ob.notes ?? '')
  );
  const barisBerubah = kanonik(nilai) !== tersimpan;
  const adaPerubahan = draft && (headerBerubah || barisBerubah);

  // Peringatan saat meninggalkan halaman dengan perubahan belum disimpan.
  useEffect(() => {
    if (!adaPerubahan) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [adaPerubahan]);

  // Akun yang ditampilkan: aktif, atau sudah punya saldo. Cut-off awal tahun -> hanya akun Neraca.
  const akunTampil = useMemo(() => {
    const punyaSaldo = new Set(ob?.lines.map(l => l.coa_id) ?? []);
    return accounts.filter(a => (a.is_active || punyaSaldo.has(a.id)) && (!awalTahun || NERACA.has(a.account_classification)));
  }, [accounts, ob, awalTahun]);

  const totals = useMemo(() => {
    let d = 0, c = 0, n = 0, laba = 0;
    for (const a of akunTampil) {
      const v = nilai[a.id];
      if (!v || isLabaBerjalan(a)) continue;
      const dd = parseAmount(v.debit), cc = parseAmount(v.credit);
      d += dd; c += cc;
      if (dd > 0 || cc > 0) n += 1;
      // Laba = Revenue + Other Income (kredit) - COGS - Expense - Other Expense - Income Tax (debit),
      // dihitung bersih per akun supaya akun kontra ikut benar.
      if (!NERACA.has(a.account_classification)) laba += cc - dd;
    }
    const r = (x: number) => Math.round(x * 100) / 100;
    return { debit: r(d), credit: r(c), count: n, laba: r(laba) };
  }, [akunTampil, nilai]);
  const selisih = Math.round((totals.debit - totals.credit) * 100) / 100;
  const seimbang = Math.abs(selisih) < 0.005;
  const penampung = accounts.find(a => a.id === header.suspenseId) ?? null;

  const grup = useMemo(() => {
    const q = search.trim().toLowerCase();
    const g = new Map<string, CoaAccount[]>();
    for (const a of akunTampil) {
      const v = nilai[a.id];
      const terisi = isLabaBerjalan(a)
        ? Math.abs(totals.laba) > 0.004
        : !!v && (parseAmount(v.debit) > 0 || parseAmount(v.credit) > 0);
      if (hanyaTerisi && !terisi) continue;
      if (q && !`${a.acc_no} ${kodeAkun(a.acc_no)} ${a.account_name} ${a.account_head ?? ''} ${a.account_sub ?? ''}`.toLowerCase().includes(q)) continue;
      g.set(a.account_classification, [...(g.get(a.account_classification) ?? []), a]);
    }
    return ACCOUNT_CLASSIFICATIONS.filter(k => g.has(k)).map(k => [k, g.get(k)!] as const);
  }, [akunTampil, nilai, search, hanyaTerisi, totals.laba]);

  const ubahNilai = (coaId: string, sisi: 'debit' | 'credit', raw: string) => {
    setNilai(prev => {
      const lama = prev[coaId] ?? { debit: '', credit: '' };
      const baru = { ...lama, [sisi]: raw };
      // Satu akun hanya boleh satu sisi: isi debit mengosongkan kredit & sebaliknya.
      if (raw.trim()) baru[sisi === 'debit' ? 'credit' : 'debit'] = '';
      return { ...prev, [coaId]: baru };
    });
  };

  const rapikanNilai = (coaId: string, sisi: 'debit' | 'credit') => {
    setNilai(prev => {
      const v = prev[coaId];
      if (!v) return prev;
      const n = parseAmount(v[sisi]);
      return { ...prev, [coaId]: { ...v, [sisi]: n ? formatAmount(n) : '' } };
    });
  };

  async function simpan(diam = false): Promise<OpeningBalanceDetail | null> {
    if (!ob) return null;
    let hasil: OpeningBalanceDetail = ob;
    if (headerBerubah) {
      hasil = await updateOpeningBalance(ob.id, {
        as_of_date: header.asOf,
        suspense_coa_id: header.suspenseId || null,
        reference: header.reference.trim() || null,
        notes: header.notes.trim() || null,
      });
    }
    if (barisBerubah || headerBerubah) {
      const lines = Object.entries(nilai)
        .map(([coa_id, v]) => ({ coa_id, debit: parseAmount(v.debit), credit: parseAmount(v.credit) }))
        .filter(l => (l.debit > 0 || l.credit > 0) && akunTampil.some(a => a.id === l.coa_id && !isLabaBerjalan(a)));
      hasil = await saveOpeningBalanceLines(ob.id, lines);
    }
    terapkan(hasil);
    if (!diam) toast.success('Opening balance saved');
    return hasil;
  }

  async function jalankan(jenis: Exclude<Aksi, null>, fn: () => Promise<void>) {
    if (aksi) return;
    setAksi(jenis);
    try {
      await fn();
    } catch (e) {
      const err = e as OpeningBalanceError;
      if (err?.code === 'SUSPENSE_REQUIRED') {
        setSorotPenampung(true);
        penampungRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      toast.error(err?.message || 'Something went wrong.');
    } finally {
      setAksi(null);
    }
  }

  const onSave = () => jalankan('save', async () => { await simpan(); });

  const onPost = () => jalankan('post', async () => {
    if (!seimbang && !header.suspenseId) {
      setSorotPenampung(true);
      penampungRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      throw new OpeningBalanceError(`Out of balance by ${formatAmount(Math.abs(selisih))}. Choose a suspense account first.`, 'SUSPENSE_REQUIRED_LOCAL');
    }
    if (totals.count === 0) throw new OpeningBalanceError('Fill in at least one balance before approving.');
    // Posting tetap boleh walau detail subledger belum diimpor (keputusan bisnis 2026-10-31) -- cukup diingatkan.
    const pending = (await muatKontrol()).filter(k => k.status === 'pending');
    const catatanDetail = pending.length
      ? `

Provisional balances — subledger detail still required for: ${pending.map(k => `${k.label} (${formatAmount(k.opening_balance)})`).join(', ')}. `
        + 'You can approve now; to import the detail later, use Revise, approve the import, then approve again.'
      : '';
    const pesan = (seimbang
      ? `Approve opening balance FY ${ob!.fiscal_year} (${branchLabel(ob!.branch)})? An opening journal will be created.`
      : `Debit and credit differ by ${formatAmount(Math.abs(selisih))}. The difference will be parked in ${kodeAkun(penampung?.acc_no)} ${penampung?.account_name}. Approve anyway?`)
      + catatanDetail;
    if (!window.confirm(pesan)) return;
    if (adaPerubahan) await simpan(true);
    const d = await postOpeningBalance(ob!.id);
    terapkan(d);
    toast.success('Opening balance approved', { description: d.journal ? `Journal ${d.journal.je_number}` : undefined });
  });

  const onRevise = () => jalankan('revise', async () => {
    if (!window.confirm(`Revise this opening balance? Journal ${ob!.journal?.je_number ?? ''} will be reversed and the set goes back to draft.`)) return;
    const d = await reviseOpeningBalance(ob!.id, 'Revisi saldo awal');
    terapkan(d);
    toast.success('Back to draft', { description: 'The previous opening journal was reversed.' });
  });

  const onLock = () => jalankan('lock', async () => {
    if (!window.confirm('Lock this opening balance? It can only be unlocked by Tahap 5 or above.')) return;
    terapkan(await lockOpeningBalance(ob!.id));
    toast.success('Opening balance locked');
  });

  const onUnlock = () => jalankan('unlock', async () => {
    terapkan(await unlockOpeningBalance(ob!.id));
    toast.success('Opening balance unlocked');
  });

  const onDelete = () => jalankan('delete', async () => {
    if (!window.confirm('Delete this draft opening balance?')) return;
    await deleteOpeningBalance(ob!.id);
    toast.success('Opening balance deleted');
    router.push('/coa/opening-balances');
  });

  // Export = semua akun yang tampil (abaikan search/filter), nilai sesuai layar (termasuk yang belum disimpan).
  const [mengekspor, setMengekspor] = useState(false);
  const onExport = async () => {
    if (!ob || mengekspor) return;
    setMengekspor(true);
    try {
      await exportOpeningBalanceXlsx({
        ob,
        clientName: clients.find(c => c.id === ob.client_id)?.companyName ?? '',
        accounts: akunTampil,
        saldo: coaId => ({ debit: parseAmount(nilai[coaId]?.debit ?? ''), credit: parseAmount(nilai[coaId]?.credit ?? '') }),
        isLabaBerjalan,
        laba: awalTahun ? 0 : totals.laba,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export.');
    } finally {
      setMengekspor(false);
    }
  };

  const toggleGrup = (k: string) => setTertutup(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  if (loadError) {
    return (
      <div className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto max-w-md rounded-lg border border-neutral-300 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><Inbox size={18} /></div>
          <h2 className="text-sm font-semibold text-neutral-900">Opening balance not found</h2>
          <p className="mt-1 text-xs text-neutral-500">{loadError}</p>
          <Link href="/coa/opening-balances" className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50">
            <ArrowLeft size={14} /> Back to opening balances
          </Link>
        </div>
      </div>
    );
  }

  if (!ob) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-neutral-500">
        <Loader2 size={16} className="animate-spin" /> Loading opening balance…
      </div>
    );
  }

  const jumlahTampil = grup.reduce((n, [, daftar]) => n + daftar.length, 0);

  return (
    <div className={`${salesFont.className} min-h-screen bg-background ${tab === 'detail' ? 'pb-32' : 'pb-10'}`}>
      {/* Header: gaya Sales (monokrom) */}
      <div>
        <div className="mx-auto max-w-screen-2xl px-6 pt-5 lg:px-8 xl:px-10">
          <nav className="mb-3 flex items-center gap-1 text-xs font-medium text-neutral-500">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-neutral-900">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <Link href="/coa/opening-balances" className="hover:text-neutral-900">Opening balances</Link>
            <ChevronRight size={12} />
            <span className="font-semibold text-neutral-900">{tanpaOb ? tanpaOb.name : `FY ${ob.fiscal_year} · ${branchLabel(ob.branch)}`}</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Link href="/coa/opening-balances" title="Back" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
                <ArrowLeft size={18} />
              </Link>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{tanpaOb ? 'Opening Balance' : `Opening Balance FY ${ob.fiscal_year}`}</h1>
                  {!tanpaOb && <StatusBadge status={ob.status} />}
                  {!tanpaOb && ob.revision > 0 && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-200">Rev {ob.revision}</span>}
                </div>
                {tanpaOb ? (
                  <p className="mt-1 text-sm font-medium text-neutral-500">{tanpaOb.name} · not created yet</p>
                ) : (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm font-medium text-neutral-500">
                  <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {branchLabel(ob.branch)}</span>
                  <span>As of {formatDate(ob.as_of_date)} · {ob.is_year_start ? 'Start of year' : 'Mid-year cut-off'}</span>
                  {ob.journal && <span className="inline-flex items-center gap-1"><FileText size={12} /> <span className="font-mono">{ob.journal.je_number}</span></span>}
                </p>
                )}
              </div>
            </div>
            <div className={`flex flex-wrap items-center gap-2 ${tanpaOb ? 'hidden' : ''}`}>
              {draft && (
                <button onClick={onDelete} disabled={!!aksi} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {aksi === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                </button>
              )}
              {ob.status === 'posted' && (
                <>
                  <button onClick={onRevise} disabled={!!aksi} className={btnOutline}>
                    {aksi === 'revise' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Revise
                  </button>
                  <button onClick={onLock} disabled={!!aksi} className={btnPrimary}>
                    {aksi === 'lock' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock
                  </button>
                </>
              )}
              {ob.status === 'locked' && (
                <button onClick={onUnlock} disabled={!!aksi} className={btnOutline}>
                  {aksi === 'unlock' ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Tab: Import Data | Detail */}
        <div className={`mx-auto mt-5 max-w-screen-2xl px-6 lg:px-8 xl:px-10 ${tanpaOb ? 'hidden' : ''}`}>
          <div className={tabBarCls}>
            <div className={tabListCls}>
              {([['import', 'Import Data', Upload], ['detail', 'Detail', Table2]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={tabCls(tab === k)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tanpaOb && (
        <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 pb-6 lg:px-8 xl:px-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">Opening Balance</h2>
              <p className="mt-1 text-sm font-medium text-neutral-500">Import opening data and templates for new client onboarding.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(240px,1fr)_180px]">
              <div>
                <p className="mb-1 text-xs font-semibold text-neutral-600">Client</p>
                <ObClientSwitcher value={tanpaOb.id} onChange={gantiClient} disabled={beralih} />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-neutral-600">Period</p>
                <div className="flex h-10 w-full items-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-semibold text-neutral-400 shadow-sm">—</div>
              </div>
            </div>
          </div>
          <ObMissingNotice clientName={tanpaOb.name} />
        </div>
      )}

      {!tanpaOb && tab === 'import' && (
        <div className="mx-auto max-w-screen-2xl px-6 pt-5 pb-6 lg:px-8 xl:px-10">
          <OpeningBalanceImportTab ob={ob} clientName={clients.find(c => c.id === ob.client_id)?.companyName ?? ''} onGantiClient={gantiClient} beralih={beralih} />
        </div>
      )}

      {!tanpaOb && tab === 'detail' && <>
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 pb-6 lg:px-8 xl:px-10">
        {/* Banner status */}
        {!draft && Math.abs(ob.difference) > 0.004 && ob.suspense_account && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">
              The balances were <span className="font-semibold">{formatAmount(Math.abs(ob.difference))}</span> out of balance. The difference is parked in{' '}
              <span className="font-semibold">{kodeAkun(ob.suspense_account.acc_no)} · {ob.suspense_account.account_name}</span>. Fix the balances and{' '}
              {ob.status === 'posted' ? 'use Revise' : 'unlock, then Revise'}, or reclassify it with a regular journal entry.
            </p>
          </div>
        )}
        <ControlStatusBanner items={kontrol} obId={ob.id} />
        {!draft && (
          <div className="flex items-start gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
            {ob.status === 'locked' ? <Lock size={16} className="mt-0.5 shrink-0 text-neutral-700" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
            <p className="text-xs font-medium leading-relaxed text-neutral-700">
              {ob.status === 'locked'
                ? 'This opening balance is locked and read-only. Unlocking requires Tahap 5 or above.'
                : <>Posted as journal <span className="font-mono font-semibold">{ob.journal?.je_number}</span> — it is already reflected in the financial statements. Use <span className="font-semibold">Revise</span> to change the balances.</>}
            </p>
          </div>
        )}

        {/* Pengaturan header */}
        <section className="relative overflow-hidden rounded-lg border border-neutral-300 bg-white p-5 pt-6 shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-neutral-800">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={labelCls}>Cut-off date</label>
              <input
                type="date"
                value={header.asOf}
                min={`${ob.fiscal_year - 1}-12-31`}
                max={`${ob.fiscal_year}-12-30`}
                disabled={!draft}
                onChange={e => setHeader(h => ({ ...h, asOf: e.target.value }))}
                className={inputCls}
              />
              <p className={hintCls}>
                {awalTahun ? 'Start of year — balance sheet accounts only.' : 'Mid-year — P&L year-to-date allowed.'}
              </p>
            </div>
            <div ref={penampungRef} className={`rounded-lg transition-shadow ${sorotPenampung ? 'ring-4 ring-amber-200' : ''}`}>
              <label className={labelCls}>Suspense account</label>
              <SuspenseSelect
                accounts={accounts}
                value={header.suspenseId}
                onChange={v => { setHeader(h => ({ ...h, suspenseId: v })); setSorotPenampung(false); }}
                disabled={!draft}
                className={inputCls}
              />
              <p className={hintCls}>Receives any debit/credit difference on posting.</p>
            </div>
            <div>
              <label className={labelCls}>Reference</label>
              <input value={header.reference} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} disabled={!draft} placeholder="Audited balance sheet" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} disabled={!draft} placeholder="Optional" className={inputCls} />
            </div>
          </div>
        </section>

        {/* Tabel saldo per akun */}
        <div className="relative overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-0.5 before:bg-neutral-800">
          {/* Toolbar */}
          <div className="border-b border-neutral-300 bg-neutral-50 px-5 pb-4 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search ACC No, account name, head, or sub…"
                  className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-10 pr-9 text-sm text-neutral-900 placeholder:text-neutral-400 transition-shadow focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-900" aria-label="Clear search"><X size={14} /></button>
                )}
              </div>
              <div className="inline-flex shrink-0 rounded-lg border border-neutral-300 bg-white p-0.5">
                {([[false, 'All accounts'], [true, `Filled (${totals.count})`]] as const).map(([v, label]) => (
                  <button
                    key={String(v)}
                    onClick={() => setHanyaTerisi(v)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      hanyaTerisi === v ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={onExport} disabled={mengekspor || akunTampil.length === 0} className={btnOutline}>
                {mengekspor ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export
              </button>
            </div>
            {awalTahun && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
                <span className="h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                P&amp;L accounts are hidden for a start-of-year cut-off — last year&apos;s profit belongs in retained earnings.
              </p>
            )}
          </div>

          {/* Tabel */}
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:shadow-[inset_0_1px_0_0_#262626,inset_0_-1px_0_0_#262626] [&>th]:font-bold">
                  <th className="px-5 py-3">Account</th>
                  <th className="w-20 px-4 py-3 text-center">Normal</th>
                  <th className="w-56 px-4 py-3 text-right">Debit</th>
                  <th className="w-56 px-4 py-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-400">
                {loadingCoa && accounts.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-5 py-3.5">
                        <div className="h-4 animate-pulse rounded-md bg-neutral-100" style={{ width: `${60 + ((i * 7) % 35)}%` }} />
                      </td>
                    </tr>
                  ))
                ) : grup.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-16">
                      <div className="flex flex-col items-center text-center">
                        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200">
                          {akunTampil.length === 0 ? <ListTree size={20} /> : <Search size={20} />}
                        </span>
                        <p className="text-sm font-semibold text-neutral-900">
                          {akunTampil.length === 0 ? 'No accounts yet' : hanyaTerisi ? 'No balances filled in yet' : 'No matching accounts'}
                        </p>
                        <p className="mt-1 max-w-sm text-xs text-neutral-500">
                          {akunTampil.length === 0 ? 'This client has no chart of accounts yet.' : hanyaTerisi ? 'Enter a debit or credit amount to see it here.' : 'Try another keyword or clear the filters.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : grup.map(([kls, daftar]) => {
                  const t = themeOf(kls);
                  const tutup = tertutup.has(kls);
                  const dijurnal = daftar.filter(a => !isLabaBerjalan(a));
                  const subD = dijurnal.reduce((s, a) => s + parseAmount(nilai[a.id]?.debit ?? ''), 0);
                  const subK = dijurnal.reduce((s, a) => s + parseAmount(nilai[a.id]?.credit ?? ''), 0);
                  return (
                    <React.Fragment key={kls}>
                      <tr className="cursor-pointer bg-neutral-100 transition-colors hover:bg-neutral-200" onClick={() => toggleGrup(kls)}>
                        <td className="px-5 py-2.5" colSpan={2}>
                          <span className="inline-flex items-center gap-2 text-xs font-bold text-neutral-900">
                            {tutup ? <ChevronRight size={14} className="text-neutral-500" /> : <ChevronDown size={14} className="text-neutral-500" />}
                            <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                            {labelClassification(kls)}
                            <span className="rounded-full bg-white px-1.5 text-[10px] font-semibold tabular-nums text-neutral-600 ring-1 ring-neutral-300">{daftar.length}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-neutral-700">{subD ? formatAmount(subD) : ''}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-neutral-700">{subK ? formatAmount(subK) : ''}</td>
                      </tr>
                      {!tutup && daftar.map(a => {
                        if (isLabaBerjalan(a)) return <BarisLabaBerjalan key={a.id} akun={a} laba={totals.laba} awalTahun={awalTahun} />;
                        const v = nilai[a.id] ?? { debit: '', credit: '' };
                        const d = parseAmount(v.debit), c = parseAmount(v.credit);
                        const terisi = d > 0 || c > 0;
                        const tidakNormal = (a.normal_balance === 'DEBIT' && c > 0) || (a.normal_balance === 'CREDIT' && d > 0);
                        return (
                          <tr key={a.id} className={`transition-colors ${terisi ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
                            <td className="px-5 py-2.5">
                              <div className="flex items-center gap-3">
                                <span className={`h-8 w-0.5 shrink-0 rounded-full bg-neutral-800 ${a.is_active ? '' : 'opacity-20'}`} />
                                <div className="min-w-0">
                                  <p className="font-mono text-[11px] text-neutral-500">{kodeAkun(a.acc_no)}</p>
                                  <div className="flex items-center gap-2">
                                    <p className={`truncate text-sm font-medium ${a.is_active ? 'text-neutral-900' : 'text-neutral-500'}`}>{a.account_name}</p>
                                    {tidakNormal && (
                                      <span title="Balance is on the opposite side of this account's normal balance (fine for contra accounts)." className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                                        <AlertTriangle size={10} /> Abnormal
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {a.normal_balance ? (
                                <span className="inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-700 ring-1 ring-neutral-200">
                                  {a.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'}
                                </span>
                              ) : <span className="text-neutral-300">—</span>}
                            </td>
                            {(['debit', 'credit'] as const).map(sisi => (
                              <td key={sisi} className="px-4 py-1.5">
                                <input
                                  value={v[sisi]}
                                  onChange={e => ubahNilai(a.id, sisi, e.target.value)}
                                  onBlur={() => rapikanNilai(a.id, sisi)}
                                  disabled={!draft}
                                  inputMode="decimal"
                                  placeholder="0"
                                  aria-label={`${sisi} ${kodeAkun(a.acc_no)}`}
                                  className="w-full rounded-lg border border-transparent bg-transparent px-2.5 py-1.5 text-right font-mono text-sm tabular-nums text-neutral-900 placeholder:text-neutral-300 transition-shadow hover:border-neutral-300 focus:border-neutral-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:hover:border-transparent"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {akunTampil.length > 0 && (
            <div className="flex items-center justify-between border-t border-neutral-300 bg-neutral-50 px-5 py-2.5 text-xs text-neutral-500">
              <span>Showing <span className="font-semibold text-neutral-900">{jumlahTampil}</span> of {akunTampil.length} accounts</span>
              {(search || hanyaTerisi) && (
                <button onClick={() => { setSearch(''); setHanyaTerisi(false); }} className="font-semibold text-neutral-900 hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer sticky: total, selisih, aksi */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-300 bg-white shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
        <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-6 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8 xl:px-10">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {!awalTahun && (
              <div title="Current year earnings = Σ(credit − debit) of all P&L accounts. Info only — not journaled." className="border-r border-neutral-300 pr-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Current year earnings · auto</p>
                <p className={`font-mono text-base font-semibold tabular-nums ${totals.laba < 0 ? 'text-rose-600' : 'text-neutral-900'}`}>
                  {totals.laba < 0 ? `(${formatAmount(Math.abs(totals.laba))})` : formatAmount(totals.laba)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Total debit</p>
              <p className="font-mono text-base font-semibold tabular-nums text-neutral-900">{formatAmount(totals.debit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Total credit</p>
              <p className="font-mono text-base font-semibold tabular-nums text-neutral-900">{formatAmount(totals.credit)}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${seimbang ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
              {seimbang ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{seimbang ? 'Balanced' : 'Difference'}</p>
                <p className="text-xs font-semibold">
                  {seimbang
                    ? 'Debit equals credit'
                    : <>
                        <span className="font-mono tabular-nums">{formatAmount(Math.abs(selisih))}</span>
                        {' → '}
                        {penampung ? `${kodeAkun(penampung.acc_no)} (${selisih > 0 ? 'credit' : 'debit'})` : 'choose a suspense account'}
                      </>}
                </p>
              </div>
            </div>
          </div>
          {draft && (
            <div className="flex items-center gap-2">
              {adaPerubahan && (
                <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
                </span>
              )}
              <button onClick={onSave} disabled={!!aksi || !adaPerubahan} className={btnOutline}>
                {aksi === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
              </button>
              <button onClick={onPost} disabled={!!aksi} className={btnPrimary}>
                {aksi === 'post' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
              </button>
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

/** Baris akun Current Year Earnings: nilai otomatis (read-only), tidak dijurnal. */
function BarisLabaBerjalan({ akun, laba, awalTahun }: { akun: CoaAccount; laba: number; awalTahun: boolean }) {
  const nilai = awalTahun ? 0 : laba;
  const teks = Math.abs(nilai) < 0.005 ? '0' : formatAmount(Math.abs(nilai));
  const sel = (aktif: boolean) => (
    <td className="px-4 py-1.5">
      <div className={`rounded-lg border border-dashed px-2.5 py-1.5 text-right font-mono text-sm tabular-nums ${aktif ? 'border-neutral-400 bg-white font-semibold text-neutral-900' : 'border-transparent text-neutral-300'}`}>
        {aktif ? teks : '—'}
      </div>
    </td>
  );
  return (
    <tr className="bg-neutral-50">
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="h-8 w-0.5 shrink-0 rounded-full bg-neutral-800" />
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-neutral-500">{kodeAkun(akun.acc_no)}</p>
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-neutral-900">{akun.account_name}</p>
              <span
                title={awalTahun
                  ? 'Start-of-year cut-off: current year earnings start at 0 — last year’s profit belongs in Retained Earnings.'
                  : 'Auto = Σ(credit − debit) of all P&L accounts (Revenue + Other Income − COGS − Expense − Other Expense − Income Tax). Info only: not journaled, because the financial statements already derive current year earnings from the P&L accounts.'}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-300"
              >
                <Calculator size={10} /> Auto · not journaled
              </span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-center">
        <span className="inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-700 ring-1 ring-neutral-200">Cr</span>
      </td>
      {/* Laba -> sisi kredit (normal); rugi -> sisi debit. */}
      {sel(nilai < 0)}
      {sel(nilai >= 0)}
    </tr>
  );
}