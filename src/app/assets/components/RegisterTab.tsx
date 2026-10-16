'use client';

// Tab Asset Register (Template UI/Fix Assets/6.jpeg): KPI, filter
// (cari, kategori, lokasi, status), tabel aset + ekspor.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, Building2, ChevronDown, Clock, Coins, Download, MoreHorizontal, Search, Wrench } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteAsset, fetchRegister, METHOD_LABEL, STATUS_LABEL, STATUS_STYLE, useFaData, type DisplayStatus, type FixedAsset, type Register,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportColumn, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, EmptyRow, inputCls, Menu, MenuItem, NumberPager, SortTh, sortRows, useSort } from '@/components/arap/arapUi';
import { Delta, KpiGrid, Pill, tdCls } from '@/components/shared/moduleUi';
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
      <KpiGrid loading={reg.loading && !reg.data} cards={[
        { label: 'Total Assets', value: rupiah(k?.current.total_cost), icon: Coins, tone: 'green',
          delta: <Delta now={k?.current.total_cost} prev={k?.previous.total_cost} suffix="vs. previous year" /> },
        { label: 'Active Assets', value: rupiah(k?.current.active_cost), icon: BarChart3, tone: 'green',
          delta: <Delta now={k?.current.active_cost} prev={k?.previous.active_cost} suffix="vs. previous year" /> },
        { label: 'Under Construction', value: rupiah(k?.current.under_construction), icon: Wrench, tone: 'blue',
          delta: <Delta now={k?.current.under_construction} prev={k?.previous.under_construction} suffix="vs. previous year" /> },
        { label: 'Assets Near End of Useful Life', value: rupiah(k?.current.near_end), icon: Clock, tone: 'amber',
          delta: <Delta now={k?.current.near_end} prev={k?.previous.near_end} goodWhenDown suffix="vs. previous year" /> },
      ]} />

      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Building2 size={20} /></span>
          <div>
            <h2 className="text-lg font-bold text-foreground">Asset Register</h2>
            <p className="text-xs text-muted-foreground">View and manage all fixed assets in your organization.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-5 pb-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search assets by code, name, or keyword..." className={`${inputCls} pl-9`} />
          </div>
          <select value={kategori} onChange={e => { setKategori(e.target.value); setPage(0); }} className={`${inputCls} lg:w-48`}>
            <option value="">All Categories</option>{opsiKategori.map(x => <option key={x}>{x}</option>)}
          </select>
          <select value={lokasi} onChange={e => { setLokasi(e.target.value); setPage(0); }} className={`${inputCls} lg:w-44`}>
            <option value="">All Locations</option>{opsiLokasi.map(x => <option key={x}>{x}</option>)}
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value as DisplayStatus | ''); setPage(0); }} className={`${inputCls} lg:w-48`}>
            <option value="">All Status</option>
            {(Object.keys(STATUS_LABEL) as DisplayStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <Menu width="w-48" button={open => (
            <button type="button" className={btnOutline}><Download size={15} /> Export <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
          )}>
            {close => <>
              <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel (.xlsx)</MenuItem>
              <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
              <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
            </>}
          </Menu>
        </div>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              <SortTh label="Asset Code" k="asset_code" sort={sort} onSort={onSort} />
              <SortTh label="Asset Name" k="name" sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left font-medium">Category</th>
              <SortTh label="Acquisition Date" k="acquisition_date" sort={sort} onSort={onSort} />
              <SortTh label="Cost" k="cost" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Accumulated Depreciation" k="accumulated_depreciation" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Net Book Value" k="net_book_value" sort={sort} onSort={onSort} align="right" />
              <th className="px-3 py-2.5 text-left font-medium">Location</th>
              <th className="px-3 py-2.5 text-left font-medium">Custodian</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(reg.loading && !reg.data) || !tampil.length ? (
                <EmptyRow cols={11} loading={reg.loading && !reg.data} text={aset.length ? 'No assets match the filters.' : 'No fixed assets yet. Click "Add Asset" to register one.'} />
              ) : tampil.map(a => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.openAsset(a.id)}>
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
                  <td className={tdCls}><Pill label={STATUS_LABEL[a.display_status]} style={STATUS_STYLE[a.display_status]} /></td>
                  <td className={tdCls} onClick={e => e.stopPropagation()}>
                    <Menu width="w-44" button={() => <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
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
        <NumberPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="assets" />
      </section>
    </div>
  );
}
