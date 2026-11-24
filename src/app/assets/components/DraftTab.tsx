'use client';

// Tab Draft: aset yang disimpan dengan checkbox "Draft" di form Add/Edit Asset
// (asset_fixed_assets.is_draft = true). Belum masuk register / penyusutan / laporan
// sampai di-Register (is_draft -> false).

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, CircleCheck, Download, MoreHorizontal, Search } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  assetToInput, deleteAsset, fetchDrafts, METHOD_LABEL, saveAsset, useFaData, type FixedAsset, type Register,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportColumn, type ExportFormat } from '@/lib/tableExport';
import { Menu, MenuItem, sortRows, useSort } from '@/components/arap/arapUi';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { faTableCls, faRowClickable, tableHeadRow, thCls, tdCls, FaCard, FaEmptyRow, FaSortTh, FaPager, faBtn } from './FaTable';
import type { FaActions } from './FixedAssetsWorkspace';

type SortKey = 'asset_code' | 'name' | 'acquisition_date' | 'original_cost' | 'edited_at';

const DRAFT_COLUMNS: ExportColumn<FixedAsset>[] = [
  { header: 'Asset Code', value: a => a.asset_code },
  { header: 'Asset Name', value: a => a.name },
  { header: 'Category', value: a => a.category },
  { header: 'Acquisition Date', value: a => a.acquisition_date },
  { header: 'Cost', value: a => a.original_cost, type: 'money' },
  { header: 'Method', value: a => (a.depreciation_method ? METHOD_LABEL[a.depreciation_method] : '') },
  { header: 'Location', value: a => a.location },
  { header: 'Created By', value: a => a.created_by_name },
  { header: 'Last Updated', value: a => a.edited_at ?? a.created_at },
];

export default function DraftTab({ clientId, clientName = '', actions }: { clientId: string; clientName?: string; actions: FaActions }) {
  const reg = useFaData<Register | null>(`draft:${clientId}`, s => fetchDrafts(clientId, s), null);
  const [cari, setCari] = useState('');
  const [kategori, setKategori] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [metode, setMetode] = useState('');
  const [busyAll, setBusyAll] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { sort, onSort } = useSort<SortKey>('asset_code', 'asc');
  const aset = useMemo(() => reg.data?.assets ?? [], [reg.data]);

  const opsiKategori = useMemo(() => Array.from(new Set(aset.map(a => a.category).filter(Boolean))) as string[], [aset]);
  const opsiLokasi = useMemo(() => Array.from(new Set(aset.map(a => a.location).filter(Boolean))) as string[], [aset]);
  const opsiMetode = useMemo(() => Array.from(new Set(aset.map(a => a.depreciation_method).filter(Boolean))) as NonNullable<FixedAsset['depreciation_method']>[], [aset]);
  const adaFilter = !!(cari || kategori || lokasi || metode);

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const f = aset.filter(a => (!q || [a.asset_code, a.name, a.category, a.custodian, a.serial_number, a.description]
      .some(x => (x || '').toLowerCase().includes(q)))
      && (!kategori || a.category === kategori) && (!lokasi || a.location === lokasi) && (!metode || a.depreciation_method === metode));
    return sortRows(f, a => (sort.key === 'edited_at' ? (a.edited_at ?? a.created_at) : a[sort.key]) ?? null, sort.dir);
  }, [aset, cari, kategori, lokasi, metode, sort]);
  const tampil = baris.slice(page * pageSize, (page + 1) * pageSize);

  const register = async (a: FixedAsset) => {
    if (!window.confirm(`Register ${a.asset_code} - ${a.name}? It will move to the Asset Register and be included in depreciation and reports.`)) return;
    setBusyId(a.id);
    try {
      await saveAsset(clientId, assetToInput(a, false), a.id);
      toast.success(`${a.asset_code} registered.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const resetFilter = () => { setCari(''); setKategori(''); setLokasi(''); setMetode(''); setPage(0); };

  const ekspor = async (format: ExportFormat) => {
    try {
      await downloadTable(format, {
        title: 'Draft Fixed Assets', clientName, subtitle: `${baris.length} draft${baris.length === 1 ? '' : 's'}`, columns: DRAFT_COLUMNS, rows: baris,
        totals: { 'Asset Code': 'Total', Cost: baris.reduce((n, a) => n + a.original_cost, 0) },
        fileName: 'Draft-Fixed-Assets', orientation: 'landscape',
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  const registerSemua = async () => {
    if (!baris.length) return;
    if (!window.confirm(`Register ${baris.length} draft asset${baris.length === 1 ? '' : 's'}? They will move to the Asset Register and be included in depreciation and reports.`)) return;
    setBusyAll(true);
    let ok = 0;
    const gagal: string[] = [];
    for (const a of baris) {
      try {
        await saveAsset(clientId, assetToInput(a, false), a.id);
        ok += 1;
      } catch (e) {
        gagal.push(`${a.asset_code}: ${(e as Error).message}`);
      }
    }
    setBusyAll(false);
    if (ok) toast.success(`${ok} asset${ok === 1 ? '' : 's'} registered.`);
    if (gagal.length) toast.error(`${gagal.length} failed - ${gagal[0]}`);
  };

  const hapus = async (a: FixedAsset) => {
    if (!window.confirm(`Delete draft ${a.asset_code} - ${a.name}?`)) return;
    try {
      toast.success((await deleteAsset(clientId, a.id)).message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {reg.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{reg.error}</div>}
      <FaCard>
        {/* Header + filter bar -- sama dengan Purchase Source Record List: dropdown di kiri, kolom cari (400px) di kanan */}
        <div className="flex flex-col gap-3 border-b border-border px-0 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Draft Assets</h3>
              <p className="mt-0.5 text-sm text-neutral-500">Assets saved as draft. They are excluded from the register, depreciation and reports until registered.</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>{aset.length} draft{aset.length === 1 ? '' : 's'}</div>
              <div className="text-sm font-semibold text-foreground">{rupiah(aset.reduce((n, a) => n + a.original_cost, 0))}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect variant="elegant" value={kategori} onChange={v => { setKategori(v); setPage(0); }}
              options={[{ value: '', label: 'All Categories' }, ...opsiKategori.map(x => ({ value: x, label: x }))]} />
            <FilterSelect variant="elegant" value={lokasi} onChange={v => { setLokasi(v); setPage(0); }}
              options={[{ value: '', label: 'All Locations' }, ...opsiLokasi.map(x => ({ value: x, label: x }))]} />
            <FilterSelect variant="elegant" value={metode} onChange={v => { setMetode(v); setPage(0); }}
              options={[{ value: '', label: 'All Methods' }, ...opsiMetode.map(x => ({ value: x, label: METHOD_LABEL[x] }))]} />
            {adaFilter && (
              <button type="button" onClick={resetFilter} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">Reset</button>
            )}
            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search drafts by code, name, category..."
                className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            </div>
            <button type="button" onClick={registerSemua} disabled={busyAll || !baris.length} className={faBtn}>
              <CircleCheck size={13} /> {busyAll ? 'Registering...' : 'Register All'}
            </button>
            <Menu width="w-48" button={open => (
              <button type="button" disabled={!baris.length} className={faBtn}><Download size={13} /> Export <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
            )}>
              {close => <>
                <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel (.xlsx)</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
              </>}
            </Menu>
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className={`${faTableCls} min-w-[1000px]`}>
            <thead><tr className={tableHeadRow}>
              <FaSortTh label="Asset Code" k="asset_code" sort={sort} onSort={onSort} />
              <FaSortTh label="Asset Name" k="name" sort={sort} onSort={onSort} />
              <th className={thCls}>Category</th>
              <FaSortTh label="Acquisition Date" k="acquisition_date" sort={sort} onSort={onSort} />
              <FaSortTh label="Cost" k="original_cost" sort={sort} onSort={onSort} align="right" iconFirst />
              <th className={thCls}>Method</th>
              <th className={thCls}>Location</th>
              <th className={thCls}>Created By</th>
              <FaSortTh label="Last Updated" k="edited_at" sort={sort} onSort={onSort} />
              <th className={`${thCls} w-10`} />
            </tr></thead>
            <tbody>
              {(reg.loading && !reg.data) || !tampil.length ? (
                <FaEmptyRow cols={10} loading={reg.loading && !reg.data}
                  text={aset.length ? 'No drafts match the search.' : 'No draft assets. Tick "Draft" in the Add Asset form to save one here.'} />
              ) : tampil.map(a => (
                <tr key={a.id} className={faRowClickable} onClick={() => actions.editAsset(a)}>
                  <td className={`${tdCls} font-medium`}>{a.asset_code}</td>
                  <td className={tdCls}>{a.name}</td>
                  <td className={tdCls}>{a.category ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.acquisition_date)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(a.original_cost)}</td>
                  <td className={tdCls}>{a.depreciation_method ? METHOD_LABEL[a.depreciation_method] : '—'}</td>
                  <td className={tdCls}>{a.location ?? '—'}</td>
                  <td className={tdCls}>{a.created_by_name ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.edited_at ?? a.created_at)}</td>
                  <td className={tdCls} onClick={e => e.stopPropagation()}>
                    <Menu width="w-44" button={() => <button type="button" className="rounded p-1 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="Actions"><MoreHorizontal size={13} /></button>}>
                      {close => <>
                        <MenuItem onClick={() => { close(); actions.editAsset(a); }}>Edit</MenuItem>
                        <MenuItem onClick={() => { close(); register(a); }} disabled={busyId === a.id}><CircleCheck size={14} /> Register</MenuItem>
                        <MenuItem danger onClick={() => { close(); hapus(a); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FaPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="drafts" />
      </FaCard>
    </div>
  );
}