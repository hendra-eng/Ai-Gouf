'use client';

// Management > Exchange Rates: master kurs terhadap IDR (global, dipakai semua klien).
// Tema elegant monokrom (neutral-*) disamakan dengan halaman Sales / FX Transfers.
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
import { btnOutline, btnPrimary, btnSmall, EmptyRow, FormField, inputCls } from '@/components/arap/arapSalesUi';
import { Modal } from '@/components/shared/moduleUi';
import PageHeading from '@/components/shared/PageHeading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

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
    <div className={`min-h-screen bg-background pb-16 ${salesFont.className}`}>
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10">
        <PageHeading
          title="Exchange Rates"
          description="Master kurs terhadap IDR (IDR per 1 unit mata uang asing). Dipakai semua klien dan terisi otomatis di form transaksi."
          actions={<>
            <button onClick={refreshSemua} className={btnOutline} aria-label="Refresh"><RefreshCcw size={14} className={list.loading ? 'animate-spin' : ''} /> Refresh</button>
            {bisaTulis && <>
              <button onClick={() => setTarik(true)} className={btnOutline}><CloudDownload size={14} /> Fetch rates</button>
              <button onClick={() => setTempel(true)} className={btnOutline}><ClipboardPaste size={14} /> Paste import</button>
              <button onClick={() => setForm({ row: null })} className={btnPrimary}><Plus size={14} /> Add rate</button>
            </>}
          </>}
        />

        {!bisaTulis && user && (
          <div className="flex items-start gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-xs text-neutral-700">
            <Info size={14} className="mt-0.5 shrink-0" /> Exchange rates can be changed by Manager level and above. You can view them here.
          </div>
        )}
        {meta.error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{meta.error}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {latest.loading && latest.data.length === 0 ? [0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-neutral-100" />)
            : latest.data.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-5 text-sm text-neutral-500 sm:col-span-2 xl:col-span-4">
                No exchange rates yet. {bisaTulis ? 'Use “Fetch rates” to pull the latest USD/SGD rates, or add one manually.' : 'Ask a Manager to add the first rates.'}
              </div>
            ) : latest.data.slice(0, 8).map(r => <LatestCard key={r.currency} r={r} />)}
        </div>

        <section className="relative rounded-xl border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-xl before:bg-neutral-800">
          <div className="flex flex-col gap-3 rounded-t-xl border-b border-neutral-300 bg-neutral-50 px-5 pb-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">Rate history</h2>
              <p className="mt-0.5 text-xs font-medium text-neutral-500">{list.data.total} rate{list.data.total === 1 ? '' : 's'}. If a date has no rate, forms use the latest earlier rate (weekends and holidays).</p>
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
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[860px] select-text border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:whitespace-nowrap [&>th]:border-y [&>th]:border-neutral-800 [&>th]:font-bold">
                  <th className="px-2 py-2">Date</th><th className="px-2 py-2">Currency</th><th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2 text-right">Rate (IDR)</th><th className="px-2 py-2">Source</th><th className="px-2 py-2">Notes</th>
                  <th className="px-2 py-2">Updated by</th>{bisaTulis && <th className="px-2 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.data.items.length === 0 ? <EmptyRow cols={bisaTulis ? 8 : 7} text="No rates match the filters." loading={list.loading} />
                    : list.data.items.map(r => (
                      <tr key={r.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                        <td className="px-2 py-2 whitespace-nowrap">{tgl(r.rate_date)}</td>
                        <td className="px-2 py-2 font-semibold">{r.currency}</td>
                        <td className="px-2 py-2">{JENIS_LABEL[r.rate_type]}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtRate(r.rate)}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${r.source === 'auto' ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-800'}`}>{r.source === 'auto' ? 'Automatic' : 'Manual'}</span>
                          {r.source_name && <span className="ml-1.5 text-xs text-neutral-500">{r.source_name}</span>}
                        </td>
                        <td className="max-w-[220px] truncate px-2 py-2 text-xs text-neutral-500" title={r.notes ?? ''}>{r.notes || '-'}</td>
                        <td className="px-2 py-2 text-xs text-neutral-500">{r.edited_by_name || r.created_by_name || '-'}</td>
                        {bisaTulis && (
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            <button onClick={() => setForm({ row: r })} className={`${btnSmall} mr-1.5`} aria-label="Edit"><Pencil size={12} /></button>
                            <button onClick={() => hapus(r)} className={`${btnSmall} text-red-700`} aria-label="Delete"><Trash2 size={12} /></button>
                          </td>
                        )}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {list.data.total > PER_HALAMAN && (
            <div className="flex items-center justify-between border-t border-neutral-300 px-5 py-3 text-xs text-neutral-500">
              <span>{page * PER_HALAMAN + 1}–{Math.min(list.data.total, (page + 1) * PER_HALAMAN)} of {list.data.total}</span>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-neutral-300 px-2.5 py-1 hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Prev</button>
                <button disabled={page >= jumlahHalaman - 1} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-neutral-300 px-2.5 py-1 hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Next</button>
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
    <div className="relative rounded-xl border border-neutral-300 bg-white p-4 shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-xl before:bg-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-900">{r.currency} / IDR</span>
        {basi
          ? <span className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] font-semibold text-white"><TriangleAlert size={11} /> {r.days_old}d old</span>
          : <span className="text-[11px] text-neutral-500">{tgl(r.rate_date)}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">{fmtRate(r.rate)}</p>
      <div className="mt-1 flex items-center justify-between text-xs">
        {r.change_pct == null ? <span className="text-neutral-500">No earlier rate</span> : (
          <span className={`inline-flex items-center gap-0.5 font-medium ${naik ? 'text-neutral-900' : turun ? 'text-red-700' : 'text-neutral-500'}`}>
            {naik ? <ArrowUpRight size={13} /> : turun ? <ArrowDownRight size={13} /> : null}{r.change_pct > 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
          </span>
        )}
        <span className="text-neutral-500">{r.source === 'auto' ? 'Automatic' : 'Manual'}</span>
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
      <p className="text-xs text-neutral-500">{hasil.rows.length} valid row{hasil.rows.length === 1 ? '' : 's'}{hasil.bad.length ? `, ${hasil.bad.length} not recognised` : ''}.</p>
      {hasil.bad.length > 0 && <ul className="max-h-24 overflow-y-auto rounded-lg border border-neutral-300 bg-neutral-100 p-3 text-xs text-neutral-700">{hasil.bad.slice(0, 20).map(b => <li key={b}>{b}</li>)}</ul>}
      {galat.length > 0 && <ul className="max-h-24 overflow-y-auto rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">{galat.map(b => <li key={b}>{b}</li>)}</ul>}
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
          <label key={c.code} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${pilih.includes(c.code) ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-700'}`}>
            <input type="checkbox" className="sr-only" checked={pilih.includes(c.code)} onChange={() => toggle(c.code)} /> {c.code}
          </label>
        ))}
      </div>
      <FormField label="Date (optional)" hint="Empty = latest published rate. A weekend date returns the previous business day.">
        <input type="date" value={tanggal} max={hariIni()} onChange={e => setTanggal(e.target.value)} className={inputCls} />
      </FormField>
      {hasil.length > 0 && <ul className="rounded-lg border border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-900">{hasil.map(h => <li key={h}>{h}</li>)}</ul>}
      <p className="text-[11px] text-neutral-500">Fetched rates are saved as “middle” rates. For BI JISDOR or the KMK tax rate, enter them manually or paste them.</p>
    </Modal>
  );
}