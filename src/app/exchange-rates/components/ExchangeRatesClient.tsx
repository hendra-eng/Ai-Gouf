'use client';

// Management > Exchange Rates: master kurs terhadap IDR (global, dipakai semua klien).
// Kartu kurs terbaru, daftar kurs + filter, input manual, impor tempel dari spreadsheet,
// dan tarik kurs otomatis. Backend: modules/management/exchange_rates_v1.py.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownRight, ArrowUpRight, CloudDownload, ClipboardPaste, Info, Loader2, Pencil, Plus, RefreshCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  deleteRate, fetchLatestRates, fetchRateMeta, fetchRates, fetchRatesAuto, fmtRate, parsePasteRates, saveRate, saveRatesBulk, useExchangeRateData,
  type ExchangeRate, type LatestRate, type RateInput, type RateList, type RateMeta, type RateSource, type RateType,
} from '@/lib/exchangeRateStore';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { FormField, Modal } from '@/components/shared/moduleUi';

const PER_HALAMAN = 25;
const hariIni = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const tgl = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const KOSONG_LIST: RateList = { total: 0, items: [] };
const JENIS_LABEL: Record<RateType, string> = { middle: 'Middle', buy: 'Buy', sell: 'Sell', tax: 'Tax (KMK)' };

function bisaMenulis(role: string | undefined, levelMin: number | undefined): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  const n = Number(role.match(/^tahap_(\d+)$/)?.[1] ?? 0);
  return n >= (levelMin ?? 4);
}

export default function ExchangeRatesClient() {
  const { user } = useAuth();
  const meta = useExchangeRateData<RateMeta | null>('meta', s => fetchRateMeta(s), null);
  const latest = useExchangeRateData<LatestRate[]>('latest', s => fetchLatestRates('middle', s), []);
  const [currency, setCurrency] = useState('');
  const [rateType, setRateType] = useState<RateType | ''>('');
  const [source, setSource] = useState<RateSource | ''>('');
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [currency, rateType, source, dari, sampai]);
  const kunci = `list:${currency}:${rateType}:${source}:${dari}:${sampai}:${page}`;
  const list = useExchangeRateData<RateList>(kunci, s => fetchRates({
    currency: currency || undefined, rate_type: rateType, source, date_from: dari || undefined, date_to: sampai || undefined,
    limit: PER_HALAMAN, offset: page * PER_HALAMAN,
  }, s), KOSONG_LIST);

  const [form, setForm] = useState<{ row: ExchangeRate | null } | null>(null);
  const [tempel, setTempel] = useState(false);
  const [tarik, setTarik] = useState(false);
  const bisaTulis = bisaMenulis(user?.role, meta.data?.can_write_level);
  const refreshSemua = () => { meta.refresh(); latest.refresh(); list.refresh(); };

  const hapus = async (r: ExchangeRate) => {
    if (!window.confirm(`Delete ${r.currency} ${JENIS_LABEL[r.rate_type]} rate on ${tgl(r.rate_date)}?`)) return;
    try { await deleteRate(r.id); toast.success('Exchange rate deleted.'); } catch (e) { toast.error((e as Error).message); }
  };

  const jumlahHalaman = Math.max(1, Math.ceil(list.data.total / PER_HALAMAN));
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Exchange Rates</h1>
            <p className="mt-1 text-sm text-muted-foreground">Master kurs terhadap IDR (IDR per 1 unit mata uang asing). Dipakai semua klien dan terisi otomatis di form transaksi.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={refreshSemua} className={btnOutline} aria-label="Refresh"><RefreshCcw size={14} className={list.loading ? 'animate-spin' : ''} /> Refresh</button>
            {bisaTulis && <>
              <button onClick={() => setTarik(true)} className={btnOutline}><CloudDownload size={14} /> Fetch rates</button>
              <button onClick={() => setTempel(true)} className={btnOutline}><ClipboardPaste size={14} /> Paste import</button>
              <button onClick={() => setForm({ row: null })} className={btnPrimary}><Plus size={14} /> Add rate</button>
            </>}
          </div>
        </div>

        {!bisaTulis && user && (
          <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
            <Info size={14} className="mt-0.5 shrink-0" /> Exchange rates can be changed by Manager level and above. You can view them here.
          </div>
        )}
        {meta.error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{meta.error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {latest.loading && latest.data.length === 0 ? [0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)
            : latest.data.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                No exchange rates yet. {bisaTulis ? 'Use “Fetch rates” to pull the latest USD/SGD rates, or add one manually.' : 'Ask a Manager to add the first rates.'}
              </div>
            ) : latest.data.slice(0, 8).map(r => <LatestCard key={r.currency} r={r} />)}
        </div>

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-bold text-foreground">Rate history</h2>
              <p className="text-xs text-muted-foreground">{list.data.total} rate{list.data.total === 1 ? '' : 's'}. If a date has no rate, forms use the latest earlier rate (weekends and holidays).</p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls} aria-label="Currency">
                <option value="">All currencies</option>
                {(meta.data?.currencies ?? []).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
              <select value={rateType} onChange={e => setRateType(e.target.value as RateType | '')} className={inputCls} aria-label="Rate type">
                <option value="">All types</option>
                {(meta.data?.rate_types ?? []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <select value={source} onChange={e => setSource(e.target.value as RateSource | '')} className={inputCls} aria-label="Source">
                <option value="">All sources</option><option value="manual">Manual</option><option value="auto">Automatic</option>
              </select>
              <input type="date" value={dari} onChange={e => setDari(e.target.value)} className={inputCls} aria-label="From date" />
              <input type="date" value={sampai} onChange={e => setSampai(e.target.value)} className={inputCls} aria-label="To date" />
              <button onClick={() => { setCurrency(''); setRateType(''); setSource(''); setDari(''); setSampai(''); }} className={btnOutline}>Clear</button>
            </div>
          </div>
          <div className="overflow-x-auto px-5 pb-2">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Currency</th><th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-right">Rate (IDR)</th><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5">Notes</th>
                  <th className="px-3 py-2.5">Updated by</th>{bisaTulis && <th className="px-3 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.loading && list.data.items.length === 0 ? [0, 1, 2].map(i => <tr key={i}><td colSpan={8} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-slate-100" /></td></tr>)
                  : list.data.items.length === 0 ? <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-muted-foreground">No rates match the filters.</td></tr>
                    : list.data.items.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 whitespace-nowrap">{tgl(r.rate_date)}</td>
                        <td className="px-3 py-2.5 font-semibold">{r.currency}</td>
                        <td className="px-3 py-2.5">{JENIS_LABEL[r.rate_type]}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtRate(r.rate)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.source === 'auto' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'}`}>{r.source === 'auto' ? 'Automatic' : 'Manual'}</span>
                          {r.source_name && <span className="ml-1.5 text-xs text-muted-foreground">{r.source_name}</span>}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-muted-foreground" title={r.notes ?? ''}>{r.notes || '-'}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.edited_by_name || r.created_by_name || '-'}</td>
                        {bisaTulis && (
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <button onClick={() => setForm({ row: r })} className={`${btnSmall} mr-1.5`} aria-label="Edit"><Pencil size={12} /></button>
                            <button onClick={() => hapus(r)} className={`${btnSmall} text-red-600`} aria-label="Delete"><Trash2 size={12} /></button>
                          </td>
                        )}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {list.data.total > PER_HALAMAN && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{page * PER_HALAMAN + 1}–{Math.min(list.data.total, (page + 1) * PER_HALAMAN)} of {list.data.total}</span>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-border px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Prev</button>
                <button disabled={page >= jumlahHalaman - 1} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-border px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {form && <RateForm meta={meta.data} row={form.row} onClose={() => setForm(null)} />}
      {tempel && <PasteDialog meta={meta.data} onClose={() => setTempel(false)} />}
      {tarik && <FetchDialog meta={meta.data} onClose={() => setTarik(false)} />}
    </div>
  );
}

function LatestCard({ r }: { r: LatestRate }) {
  const naik = (r.change ?? 0) > 0, turun = (r.change ?? 0) < 0;
  const basi = r.days_old > 4;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">{r.currency} / IDR</span>
        {basi
          ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><TriangleAlert size={11} /> {r.days_old}d old</span>
          : <span className="text-[11px] text-muted-foreground">{tgl(r.rate_date)}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{fmtRate(r.rate)}</p>
      <div className="mt-1 flex items-center justify-between text-xs">
        {r.change_pct == null ? <span className="text-muted-foreground">No earlier rate</span> : (
          <span className={`inline-flex items-center gap-0.5 font-medium ${naik ? 'text-emerald-600' : turun ? 'text-red-600' : 'text-muted-foreground'}`}>
            {naik ? <ArrowUpRight size={13} /> : turun ? <ArrowDownRight size={13} /> : null}{r.change_pct > 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
          </span>
        )}
        <span className="text-muted-foreground">{r.source === 'auto' ? 'Automatic' : 'Manual'}</span>
      </div>
    </div>
  );
}

function RateForm({ meta, row, onClose }: { meta: RateMeta | null; row: ExchangeRate | null; onClose: () => void }) {
  const [f, setF] = useState<RateInput>(() => row
    ? { currency: row.currency, rate_date: row.rate_date, rate_type: row.rate_type, rate: row.rate, source_name: row.source_name, notes: row.notes }
    : { currency: 'USD', rate_date: hariIni(), rate_type: 'middle', rate: 0, source_name: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    if (!f.currency || !f.rate_date || !(f.rate > 0)) { toast.error('Currency, date and a rate greater than zero are required.'); return; }
    setBusy(true);
    try { await saveRate({ ...f, currency: f.currency.toUpperCase() }, row?.id); toast.success('Exchange rate saved.'); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={row ? 'Edit exchange rate' : 'Add exchange rate'}
      subtitle="Saving a rate for a currency, date and type that already exists replaces it."
      footer={<><button onClick={onClose} className={btnOutline}>Cancel</button><button onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Currency" required>
          <input list="fx-currencies" value={f.currency} maxLength={3} onChange={e => setF(x => ({ ...x, currency: e.target.value.toUpperCase() }))} className={inputCls} />
          <datalist id="fx-currencies">{(meta?.currencies ?? []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
        </FormField>
        <FormField label="Rate type">
          <select value={f.rate_type} onChange={e => setF(x => ({ ...x, rate_type: e.target.value as RateType }))} className={inputCls}>
            {(meta?.rate_types ?? [{ key: 'middle' as RateType, label: 'Middle' }]).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </FormField>
        <FormField label="Date" required><input type="date" value={f.rate_date} onChange={e => setF(x => ({ ...x, rate_date: e.target.value }))} className={inputCls} /></FormField>
        <FormField label="Rate (IDR per 1 unit)" required>
          <input type="number" min={0} step="0.000001" value={f.rate || ''} onChange={e => setF(x => ({ ...x, rate: Number(e.target.value) || 0 }))} className={inputCls} />
        </FormField>
        <FormField label="Source name" className="col-span-2"><input value={f.source_name ?? ''} maxLength={100} placeholder="e.g. BI JISDOR, KMK 123/2026" onChange={e => setF(x => ({ ...x, source_name: e.target.value }))} className={inputCls} /></FormField>
        <FormField label="Notes" className="col-span-2"><textarea rows={2} value={f.notes ?? ''} maxLength={1000} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} className={inputCls} /></FormField>
      </div>
    </Modal>
  );
}

function PasteDialog({ meta, onClose }: { meta: RateMeta | null; onClose: () => void }) {
  const [teks, setTeks] = useState('');
  const [jenis, setJenis] = useState<RateType>('middle');
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string[]>([]);
  const hasil = useMemo(() => parsePasteRates(teks, jenis), [teks, jenis]);
  const kirim = async () => {
    if (hasil.rows.length === 0) return;
    setBusy(true);
    try {
      const r = (await saveRatesBulk(hasil.rows)).data;
      toast.success(`${r.created} added, ${r.updated} updated${r.failed ? `, ${r.failed} failed` : ''}.`);
      if (r.failed) setGalat(r.errors.map(e => `Row ${e.row} (${e.currency} ${e.rate_date}): ${e.error}`)); else onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Paste import"
      subtitle="Paste rows copied from a spreadsheet. Columns: currency, date (YYYY-MM-DD), rate, and optionally the type (middle / buy / sell / tax)."
      footer={<><button onClick={onClose} className={btnOutline}>Close</button><button onClick={kirim} disabled={busy || hasil.rows.length === 0} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Import {hasil.rows.length || ''} rate{hasil.rows.length === 1 ? '' : 's'}</button></>}>
      <FormField label="Default type for rows without a type">
        <select value={jenis} onChange={e => setJenis(e.target.value as RateType)} className={inputCls}>
          {(meta?.rate_types ?? [{ key: 'middle' as RateType, label: 'Middle' }]).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </FormField>
      <textarea rows={9} value={teks} onChange={e => { setTeks(e.target.value); setGalat([]); }} placeholder={'USD\t2026-11-12\t16000\nSGD\t2026-11-12\t11750.5\nUSD\t2026-11-12\t15950\ttax'} className={`${inputCls} font-mono text-xs`} />
      <p className="text-xs text-muted-foreground">{hasil.rows.length} valid row{hasil.rows.length === 1 ? '' : 's'}{hasil.bad.length ? `, ${hasil.bad.length} not recognised` : ''}.</p>
      {hasil.bad.length > 0 && <ul className="max-h-24 overflow-y-auto rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{hasil.bad.slice(0, 20).map(b => <li key={b}>{b}</li>)}</ul>}
      {galat.length > 0 && <ul className="max-h-24 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs text-red-700">{galat.map(b => <li key={b}>{b}</li>)}</ul>}
    </Modal>
  );
}

function FetchDialog({ meta, onClose }: { meta: RateMeta | null; onClose: () => void }) {
  const [pilih, setPilih] = useState<string[]>(['USD', 'SGD']);
  const [tanggal, setTanggal] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<string[]>([]);
  const toggle = (c: string) => setPilih(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]));
  const jalan = async () => {
    setBusy(true);
    try {
      const r = (await fetchRatesAuto(pilih, tanggal || null)).data;
      setHasil(r.results.map(x => (x.ok ? `${x.currency}: ${fmtRate(x.rate)} on ${tgl(x.rate_date)}${x.created ? '' : ' (updated)'}` : `${x.currency}: ${x.error}`)));
      if (r.saved) toast.success(`${r.saved} rate${r.saved === 1 ? '' : 's'} saved.`);
      if (r.failed) toast.error(`${r.failed} currency failed.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Fetch rates automatically"
      subtitle={meta ? `${meta.provider.name}. ${meta.provider.note}` : undefined}
      footer={<><button onClick={onClose} className={btnOutline}>Close</button><button onClick={jalan} disabled={busy || pilih.length === 0} className={btnPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />} Fetch</button></>}>
      <div className="flex flex-wrap gap-2">
        {(meta?.currencies ?? []).map(c => (
          <label key={c.code} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-medium ${pilih.includes(c.code) ? 'border-[#0F7D4E] bg-emerald-50 text-[#0F7D4E]' : 'border-border text-muted-foreground'}`}>
            <input type="checkbox" className="sr-only" checked={pilih.includes(c.code)} onChange={() => toggle(c.code)} /> {c.code}
          </label>
        ))}
      </div>
      <FormField label="Date (optional)" hint="Empty = latest published rate. A weekend date returns the previous business day.">
        <input type="date" value={tanggal} max={hariIni()} onChange={e => setTanggal(e.target.value)} className={inputCls} />
      </FormField>
      {hasil.length > 0 && <ul className="rounded-xl bg-slate-50 p-3 text-xs text-foreground">{hasil.map(h => <li key={h}>{h}</li>)}</ul>}
      <p className="text-[11px] text-muted-foreground">Fetched rates are saved as “middle” rates. For BI JISDOR or the KMK tax rate, enter them manually or paste them.</p>
    </Modal>
  );
}
