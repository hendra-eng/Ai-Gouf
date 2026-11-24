'use client';

// Tab Asset Register (Template UI/Fix Assets/6.jpeg): KPI, filter
// (cari, kategori, lokasi, status), tabel aset + ekspor.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, ChevronDown, Clock, Coins, Download, MoreHorizontal, Search, Wrench } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteAsset, fetchRegister, METHOD_LABEL, STATUS_LABEL, STATUS_STYLE, useFaData, type DisplayStatus, type FixedAsset, type Register,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportColumn, type ExportFormat } from '@/lib/tableExport';
import { Menu, MenuItem, sortRows, useSort } from '@/components/arap/arapUi';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { Delta } from '@/components/shared/moduleUi';
import { FaKpiGrid } from './FaKpi';
import { faTableCls, faRowClickable, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow, FaSortTh, FaPager, faBtn } from './FaTable';
import type { FaActions } from './FixedAssetsWorkspace';

type SortKey = 'asset_code' | 'name' | 'acquisition_date' | 'cost' | 'accumulated_depreciation' | 'net_book_value';

export const REGISTER_COLUMNS: ExportColumn<FixedAsset>[] = [
  { header: 'Asset Code', value: a => a.asset_code },
  { header: 'Asset Name', value: a => a.name },
  { header: 'Category', value: a => a.category },
  { header: 'Acquisition Date', value: a => a.acquisition_date },
  { header: 'Cost', value: a => a.cost, type: 'money' },
  { header: 'Accumulated Depreciation', value: a => a.accumulated_depreciation, type: 'money' },
  { header: 'Net Book Value', value: a => a.net_book_value, type: 'money' },
  { header: 'Method', value: a => (a.depreciation_method ? METHOD_LABEL[a.depreciation_method] : '') },
  { header: 'Useful Life (Months)', value: a => a.useful_life_months, type: 'number' },
  { header: 'Location', value: a => a.location },
  { header: 'Branch', value: a => a.branch },
  { header: 'Custodian', value: a => a.custodian },
  { header: 'Status', value: a => STATUS_LABEL[a.display_status] },
];

export default function RegisterTab({ clientId, clientName, asOf, actions }: { clientId: string; clientName: string; asOf: string; actions: FaActions }) {
  const reg = useFaData<Register | null>(`reg:${clientId}:${asOf}`, s => fetchRegister(clientId, asOf, s), null);
  const [cari, setCari] = useState('');
  const [kategori, setKategori] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [status, setStatus] = useState<'' | DisplayStatus>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { sort, onSort } = useSort<SortKey>('asset_code', 'asc');
  const k = reg.data?.kpi;
  const aset = useMemo(() => reg.data?.assets ?? [], [reg.data]);

  const opsiKategori = useMemo(() => Array.from(new Set(aset.map(a => a.category).filter(Boolean))) as string[], [aset]);
  const opsiLokasi = useMemo(() => Array.from(new Set(aset.map(a => a.location).filter(Boolean))) as string[], [aset]);

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const f = aset.filter(a => (!q || [a.asset_code, a.name, a.custodian, a.serial_number, a.description].some(x => (x || '').toLowerCase().includes(q)))
      && (!kategori || a.category === kategori) && (!lokasi || a.location === lokasi) && (!status || a.display_status === status));
    return sortRows(f, a => (a[sort.key] ?? null) as string | number | null, sort.dir);
  }, [aset, cari, kategori, lokasi, status, sort]);
  const tampil = baris.slice(page * pageSize, (page + 1) * pageSize);

  const ekspor = async (format: ExportFormat) => {
    try {
      await downloadTable(format, {
        title: 'Fixed Asset Register', clientName, subtitle: `As of ${fmtDate(asOf)}`, columns: REGISTER_COLUMNS, rows: baris,
        totals: { 'Asset Code': 'Total', Cost: baris.reduce((n, a) => n + a.cost, 0),
          'Accumulated Depreciation': baris.reduce((n, a) => n + a.accumulated_depreciation, 0), 'Net Book Value': baris.reduce((n, a) => n + a.net_book_value, 0) },
        fileName: `Fixed-Asset-Register-${asOf}`, orientation: 'landscape',
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  const hapus = async (a: FixedAsset) => {
    if (!window.confirm(`Delete ${a.asset_code} - ${a.name}? This is only allowed while no journals are posted for the asset.`)) return;
    try {
      toast.success((await deleteAsset(clientId, a.id)).message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {reg.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{reg.error}</div>}
      <FaKpiGrid loading={reg.loading && !reg.data} cards={[
        { label: 'Total Assets', value: rupiah(k?.current.total_cost), icon: Coins, tone: 'emerald',
          delta: <Delta now={k?.current.total_cost} prev={k?.previous.total_cost} suffix="vs. previous year" /> },
        { label: 'Active Assets', value: rupiah(k?.current.active_cost), icon: BarChart3, tone: 'teal',
          delta: <Delta now={k?.current.active_cost} prev={k?.previous.active_cost} suffix="vs. previous year" /> },
        { label: 'Under Construction', value: rupiah(k?.current.under_construction), icon: Wrench, tone: 'amber',
          delta: <Delta now={k?.current.under_construction} prev={k?.previous.under_construction} suffix="vs. previous year" /> },
        { label: 'Assets Near End of Useful Life', value: rupiah(k?.current.near_end), icon: Clock, tone: 'rose',
          delta: <Delta now={k?.current.near_end} prev={k?.previous.near_end} goodWhenDown suffix="vs. previous year" /> },
      ]} />

      <FaCard>
        {/* Header + filter bar -- sama dengan Purchase Source Record List: dropdown di kiri, kolom cari (400px) di kanan */}
        <div className="flex flex-col gap-3 border-b border-border px-0 py-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Asset Register</h3>
            <p className="mt-0.5 text-sm text-neutral-500">View and manage all fixed assets in your organization.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect variant="elegant" value={kategori} onChange={v => { setKategori(v); setPage(0); }}
              options={[{ value: '', label: 'All Categories' }, ...opsiKategori.map(x => ({ value: x, label: x }))]} />
            <FilterSelect variant="elegant" value={lokasi} onChange={v => { setLokasi(v); setPage(0); }}
              options={[{ value: '', label: 'All Locations' }, ...opsiLokasi.map(x => ({ value: x, label: x }))]} />
            <FilterSelect variant="elegant" value={status} onChange={v => { setStatus(v as DisplayStatus | ''); setPage(0); }}
              options={[{ value: '', label: 'All Status' }, ...(Object.keys(STATUS_LABEL) as DisplayStatus[]).map(s => ({ value: s, label: STATUS_LABEL[s] }))]} />
            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search assets by code, name, or keyword..."
                className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            </div>
            <Menu width="w-48" button={open => (
              <button type="button" className={faBtn}><Download size={13} /> Export <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
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
          <table className={`${faTableCls} min-w-[1100px]`}>
            <thead><tr className={tableHeadRow}>
              <FaSortTh label="Asset Code" k="asset_code" sort={sort} onSort={onSort} />
              <FaSortTh label="Asset Name" k="name" sort={sort} onSort={onSort} />
              <th className={thCls}>Category</th>
              <FaSortTh label="Acquisition Date" k="acquisition_date" sort={sort} onSort={onSort} />
              <FaSortTh label="Cost" k="cost" sort={sort} onSort={onSort} align="right" iconFirst />
              <FaSortTh label="Accumulated Depreciation" k="accumulated_depreciation" sort={sort} onSort={onSort} align="right" iconFirst />
              <FaSortTh label="Net Book Value" k="net_book_value" sort={sort} onSort={onSort} align="right" iconFirst />
              <th className={thCls}>Location</th>
              <th className={thCls}>Custodian</th>
              <th className={thCls}>Status</th>
              <th className={`${thCls} w-10`} />
            </tr></thead>
            <tbody>
              {(reg.loading && !reg.data) || !tampil.length ? (
                <FaEmptyRow cols={11} loading={reg.loading && !reg.data} text={aset.length ? 'No assets match the filters.' : 'No fixed assets yet. Click "Add Asset" to register one.'} />
              ) : tampil.map(a => (
                <tr key={a.id} className={faRowClickable} onClick={() => actions.openAsset(a.id)}>
                  <td className={`${tdCls} font-medium`}>{a.asset_code}</td>
                  <td className={tdCls}>
                    {a.name}
                    {a.issues.length > 0 && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700" title={a.issues.join(', ')}>Review</span>}
                  </td>
                  <td className={tdCls}>{a.category ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.acquisition_date)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(a.cost)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(a.accumulated_depreciation)}</td>
                  <td className={`${tdCls} text-right font-medium`}>{rupiah(a.net_book_value)}</td>
                  <td className={tdCls}>{a.location ?? '—'}</td>
                  <td className={tdCls}>{a.custodian ?? '—'}</td>
                  <td className={tdCls}><FaPill label={STATUS_LABEL[a.display_status]} style={STATUS_STYLE[a.display_status]} /></td>
                  <td className={tdCls} onClick={e => e.stopPropagation()}>
                    <Menu width="w-44" button={() => <button type="button" className="rounded p-1 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="Actions"><MoreHorizontal size={13} /></button>}>
                      {close => <>
                        <MenuItem onClick={() => { close(); actions.openAsset(a.id); }}>View details</MenuItem>
                        <MenuItem onClick={() => { close(); actions.editAsset(a); }} disabled={a.status === 'disposed'}>Edit</MenuItem>
                        <MenuItem onClick={() => { close(); actions.newDisposal(a.id); }} disabled={a.status === 'disposed'}>Dispose</MenuItem>
                        <MenuItem danger onClick={() => { close(); hapus(a); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FaPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="assets" />
      </FaCard>
    </div>
  );
}