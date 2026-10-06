'use client';

// Editor saldo awal 1 set (/coa/opening-balances/[id]): tabel seluruh akun COA
// klien (dikelompokkan per klasifikasi) dengan input debit/kredit, footer
// sticky berisi total & selisih, serta aksi Save / Post / Revise / Lock.
//
// Status draft = bisa diedit. Posted/locked = read-only (Revise membalik
// jurnal lama & mengembalikan ke draft). Selisih debit-kredit TIDAK diblok:
// saat post diparkir ke akun penampung.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, Calculator, CheckCircle2, ChevronDown, ChevronRight, FileText, GitBranch, Inbox, ListTree, Loader2,
  Lock, LockOpen, RotateCcw, Save, Search, Send, Trash2, X,
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
import { labelClassification, themeOf } from '../../components/coaTheme';
import { StatusBadge, SuspenseSelect, branchLabel, formatDate } from './obUi';

const NERACA = new Set(['ASSET', 'LIABILITY', 'EQUITY']);

// Akun Current Year Earnings dihitung OTOMATIS = sum(kredit - debit) seluruh akun
// P&L, cuma sbg info: TIDAK dijurnal & tidak masuk total Dr/Cr, karena Financial
// Statements sudah menghitung laba tahun berjalan dari akun P&L (kalau ikut
// dijurnal, laba dobel & jurnal opening tidak balance). Backend menolak akun ini
// sbg baris saldo (opening_balance_v1.STANDARD_CODE_LABA_BERJALAN).
const KODE_LABA_BERJALAN = 'std_equity_current_period_earnings';
const isLabaBerjalan = (a: CoaAccount) => (a.standard_account_code ?? '').trim().toLowerCase() === KODE_LABA_BERJALAN;
const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';

type Nilai = { debit: string; credit: string };
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
      if (q && !`${a.acc_no} ${a.account_name} ${a.account_head ?? ''} ${a.account_sub ?? ''}`.toLowerCase().includes(q)) continue;
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
    if (totals.count === 0) throw new OpeningBalanceError('Fill in at least one balance before posting.');
    const pesan = seimbang
      ? `Post opening balance FY ${ob!.fiscal_year} (${branchLabel(ob!.branch)})? An opening journal will be created.`
      : `Debit and credit differ by ${formatAmount(Math.abs(selisih))}. The difference will be parked in ${penampung?.acc_no} ${penampung?.account_name}. Post anyway?`;
    if (!window.confirm(pesan)) return;
    if (adaPerubahan) await simpan(true);
    const d = await postOpeningBalance(ob!.id);
    terapkan(d);
    toast.success('Opening balance posted', { description: d.journal ? `Journal ${d.journal.je_number}` : undefined });
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

  const toggleGrup = (k: string) => setTertutup(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  if (loadError) {
    return (
      <div className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><Inbox size={18} /></div>
          <h2 className="text-sm font-semibold text-foreground">Opening balance not found</h2>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <Link href="/coa/opening-balances" className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50">
            <ArrowLeft size={14} /> Back to opening balances
          </Link>
        </div>
      </div>
    );
  }

  if (!ob) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading opening balance…
      </div>
    );
  }

  const tombolSekunder = 'flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50';

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-screen-2xl px-6 py-5">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-foreground">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <Link href="/coa/opening-balances" className="hover:text-foreground">Opening balances</Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">FY {ob.fiscal_year} · {branchLabel(ob.branch)}</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Link href="/coa/opening-balances" title="Back" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground">
                <ArrowLeft size={16} />
              </Link>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-foreground">Opening Balance FY {ob.fiscal_year}</h1>
                  <StatusBadge status={ob.status} />
                  {ob.revision > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Rev {ob.revision}</span>}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {branchLabel(ob.branch)}</span>
                  <span>As of {formatDate(ob.as_of_date)} · {ob.is_year_start ? 'Start of year' : 'Mid-year cut-off'}</span>
                  {ob.journal && <span className="inline-flex items-center gap-1"><FileText size={12} /> <span className="font-mono">{ob.journal.je_number}</span></span>}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {draft && (
                <button onClick={onDelete} disabled={!!aksi} className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                  {aksi === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                </button>
              )}
              {ob.status === 'posted' && (
                <>
                  <button onClick={onRevise} disabled={!!aksi} className={tombolSekunder}>
                    {aksi === 'revise' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Revise
                  </button>
                  <button onClick={onLock} disabled={!!aksi} className="flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50">
                    {aksi === 'lock' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Lock
                  </button>
                </>
              )}
              {ob.status === 'locked' && (
                <button onClick={onUnlock} disabled={!!aksi} className={tombolSekunder}>
                  {aksi === 'unlock' ? <Loader2 size={14} className="animate-spin" /> : <LockOpen size={14} />} Unlock
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
        {/* Banner status */}
        {!draft && Math.abs(ob.difference) > 0.004 && ob.suspense_account && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">
              The balances were <span className="font-semibold">{formatAmount(Math.abs(ob.difference))}</span> out of balance. The difference is parked in{' '}
              <span className="font-semibold">{ob.suspense_account.acc_no} · {ob.suspense_account.account_name}</span>. Fix the balances and{' '}
              {ob.status === 'posted' ? 'use Revise' : 'unlock, then Revise'}, or reclassify it with a regular journal entry.
            </p>
          </div>
        )}
        {!draft && (
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-slate-50 px-4 py-3">
            {ob.status === 'locked' ? <Lock size={16} className="mt-0.5 shrink-0 text-slate-500" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
            <p className="text-xs leading-relaxed text-slate-700">
              {ob.status === 'locked'
                ? 'This opening balance is locked and read-only. Unlocking requires Tahap 5 or above.'
                : <>Posted as journal <span className="font-mono font-semibold">{ob.journal?.je_number}</span> — it is already reflected in the financial statements. Use <span className="font-semibold">Revise</span> to change the balances.</>}
            </p>
          </div>
        )}

        {/* Pengaturan header */}
        <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Cut-off date</label>
            <input
              type="date"
              value={header.asOf}
              min={`${ob.fiscal_year - 1}-12-31`}
              max={`${ob.fiscal_year}-12-30`}
              disabled={!draft}
              onChange={e => setHeader(h => ({ ...h, asOf: e.target.value }))}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {awalTahun ? 'Start of year — balance sheet accounts only.' : 'Mid-year — P&L year-to-date allowed.'}
            </p>
          </div>
          <div ref={penampungRef} className={`rounded-xl transition-shadow ${sorotPenampung ? 'ring-4 ring-amber-200' : ''}`}>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Suspense account</label>
            <SuspenseSelect
              accounts={accounts}
              value={header.suspenseId}
              onChange={v => { setHeader(h => ({ ...h, suspenseId: v })); setSorotPenampung(false); }}
              disabled={!draft}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Receives any debit/credit difference on posting.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Reference</label>
            <input value={header.reference} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} disabled={!draft} placeholder="Audited balance sheet" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Notes</label>
            <input value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} disabled={!draft} placeholder="Optional" className={inputCls} />
          </div>
        </section>

        {/* Tabel saldo per akun */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search ACC No, account name, head, or sub…"
                className="w-full rounded-xl border border-border bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-foreground placeholder:text-slate-400 transition-shadow focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-foreground" aria-label="Clear search"><X size={14} /></button>
              )}
            </div>
            <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
              {([[false, 'All accounts'], [true, `Filled (${totals.count})`]] as const).map(([v, label]) => (
                <button
                  key={String(v)}
                  onClick={() => setHanyaTerisi(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${hanyaTerisi === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {awalTahun && (
            <p className="border-b border-border bg-slate-50 px-5 py-2 text-[11px] text-muted-foreground">
              P&amp;L accounts are hidden for a start-of-year cut-off — last year&apos;s profit belongs in retained earnings.
            </p>
          )}

          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Account</th>
                <th className="w-20 px-4 py-3 text-center">Normal</th>
                <th className="w-56 px-4 py-3 text-right">Debit</th>
                <th className="w-56 px-4 py-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {loadingCoa && accounts.length === 0 ? (
                <tr><td colSpan={4} className="py-14 text-center text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading accounts…</td></tr>
              ) : grup.length === 0 ? (
                <tr><td colSpan={4} className="py-14 text-center text-sm text-muted-foreground">
                  {akunTampil.length === 0 ? 'This client has no chart of accounts yet.' : hanyaTerisi ? 'No balances filled in yet.' : 'No accounts match your search.'}
                </td></tr>
              ) : grup.map(([kls, daftar]) => {
                const t = themeOf(kls);
                const tutup = tertutup.has(kls);
                const dijurnal = daftar.filter(a => !isLabaBerjalan(a));
                const subD = dijurnal.reduce((s, a) => s + parseAmount(nilai[a.id]?.debit ?? ''), 0);
                const subK = dijurnal.reduce((s, a) => s + parseAmount(nilai[a.id]?.credit ?? ''), 0);
                return (
                  <React.Fragment key={kls}>
                    <tr className="cursor-pointer border-y border-border bg-slate-50 hover:bg-slate-100" onClick={() => toggleGrup(kls)}>
                      <td className="px-5 py-2" colSpan={2}>
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                          {tutup ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                          <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                          {labelClassification(kls)}
                          <span className="rounded-md bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">{daftar.length}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-slate-600">{subD ? formatAmount(subD) : ''}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-slate-600">{subK ? formatAmount(subK) : ''}</td>
                    </tr>
                    {!tutup && daftar.map(a => {
                      if (isLabaBerjalan(a)) return <BarisLabaBerjalan key={a.id} akun={a} laba={totals.laba} awalTahun={awalTahun} />;
                      const v = nilai[a.id] ?? { debit: '', credit: '' };
                      const d = parseAmount(v.debit), c = parseAmount(v.credit);
                      const tidakNormal = (a.normal_balance === 'DEBIT' && c > 0) || (a.normal_balance === 'CREDIT' && d > 0);
                      return (
                        <tr key={a.id} className={`border-b border-slate-100 ${d || c ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                          <td className="px-5 py-2">
                            <div className="flex items-center gap-3">
                              <span className="w-24 shrink-0 font-mono text-[11px] text-slate-500">{a.acc_no}</span>
                              <span className={`truncate ${a.is_active ? 'text-foreground' : 'text-slate-400'}`}>{a.account_name}</span>
                              {tidakNormal && (
                                <span title="Balance is on the opposite side of this account's normal balance (fine for contra accounts)." className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                  <AlertTriangle size={10} /> Abnormal
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {a.normal_balance && (
                              <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${a.normal_balance === 'DEBIT' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                                {a.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'}
                              </span>
                            )}
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
                                aria-label={`${sisi} ${a.acc_no}`}
                                className="w-full rounded-lg border border-transparent bg-transparent px-2.5 py-1.5 text-right font-mono text-sm tabular-nums text-foreground placeholder:text-slate-300 transition-shadow hover:border-border focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:hover:border-transparent"
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
      </div>

      {/* Footer sticky: total, selisih, aksi */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-6 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {!awalTahun && (
              <div title="Current year earnings = Σ(credit − debit) of all P&L accounts. Info only — not journaled.">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Current year earnings · auto</p>
                <p className={`font-mono text-base font-bold tabular-nums ${totals.laba < 0 ? 'text-red-600' : 'text-violet-700'}`}>
                  {totals.laba < 0 ? `(${formatAmount(Math.abs(totals.laba))})` : formatAmount(totals.laba)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total debit</p>
              <p className="font-mono text-base font-bold tabular-nums text-foreground">{formatAmount(totals.debit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total credit</p>
              <p className="font-mono text-base font-bold tabular-nums text-foreground">{formatAmount(totals.credit)}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ${seimbang ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
              {seimbang ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{seimbang ? 'Balanced' : 'Difference'}</p>
                <p className="text-xs font-semibold">
                  {seimbang
                    ? 'Debit equals credit'
                    : <>
                        <span className="font-mono tabular-nums">{formatAmount(Math.abs(selisih))}</span>
                        {' → '}
                        {penampung ? `${penampung.acc_no} (${selisih > 0 ? 'credit' : 'debit'})` : 'choose a suspense account'}
                      </>}
                </p>
              </div>
            </div>
          </div>
          {draft && (
            <div className="flex items-center gap-2">
              {adaPerubahan && <span className="mr-1 text-xs font-medium text-amber-700">Unsaved changes</span>}
              <button onClick={onSave} disabled={!!aksi || !adaPerubahan} className={tombolSekunder}>
                {aksi === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
              </button>
              <button
                onClick={onPost}
                disabled={!!aksi}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-800 disabled:opacity-50"
              >
                {aksi === 'post' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Baris akun Current Year Earnings: nilai otomatis (read-only), tidak dijurnal. */
function BarisLabaBerjalan({ akun, laba, awalTahun }: { akun: CoaAccount; laba: number; awalTahun: boolean }) {
  const nilai = awalTahun ? 0 : laba;
  const teks = Math.abs(nilai) < 0.005 ? '0' : formatAmount(Math.abs(nilai));
  const sel = (aktif: boolean) => (
    <td className="px-4 py-1.5">
      <div className={`rounded-lg border border-dashed px-2.5 py-1.5 text-right font-mono text-sm tabular-nums ${aktif ? 'border-violet-200 bg-card font-semibold text-violet-700' : 'border-transparent text-slate-300'}`}>
        {aktif ? teks : '—'}
      </div>
    </td>
  );
  return (
    <tr className="border-b border-slate-100 bg-violet-50">
      <td className="px-5 py-2">
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 font-mono text-[11px] text-slate-500">{akun.acc_no}</span>
          <span className="truncate text-foreground">{akun.account_name}</span>
          <span
            title={awalTahun
              ? 'Start-of-year cut-off: current year earnings start at 0 — last year’s profit belongs in Retained Earnings.'
              : 'Auto = Σ(credit − debit) of all P&L accounts (Revenue + Other Income − COGS − Expense − Other Expense − Income Tax). Info only: not journaled, because the financial statements already derive current year earnings from the P&L accounts.'}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
          >
            <Calculator size={10} /> Auto · not journaled
          </span>
        </div>
      </td>
      <td className="px-4 py-2 text-center">
        <span className="inline-block rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">Cr</span>
      </td>
      {/* Laba -> sisi kredit (normal); rugi -> sisi debit. */}
      {sel(nilai < 0)}
      {sel(nilai >= 0)}
    </tr>
  );
}
