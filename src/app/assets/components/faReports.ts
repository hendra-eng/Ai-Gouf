// Definisi kolom tiap laporan Fixed Assets -- dipakai tampilan laporan
// (ReportsTab) dan ekspor PDF / Excel / CSV (src/lib/tableExport.ts).

import { fmtDate, fmtMonth } from '@/lib/receivablesPayablesStore';
import { DISPOSAL_METHOD_LABEL, METHOD_LABEL, REPORT_META, STATUS_LABEL, type DepMethod, type DisposalMethod, type DisplayStatus, type ReportData } from '@/lib/fixedAssetsStore';
import type { ExportColumn, ExportSpec } from '@/lib/tableExport';

type Row = Record<string, unknown>;
const n = (k: string) => (r: Row) => (r[k] as number | null) ?? null;
const s = (k: string) => (r: Row) => (r[k] as string | null) ?? null;

export interface BuiltReport {
  columns: ExportColumn<Row>[];
  rows: Row[];
  totals?: Record<string, string | number | null>;
  orientation: 'portrait' | 'landscape';
}

const jumlah = (rows: Row[], k: string) => rows.reduce((t, r) => t + ((r[k] as number) || 0), 0);

export function buildReport(d: ReportData): BuiltReport {
  const rows = (d.rows ?? []) as Row[];
  switch (d.report_type) {
    case 'asset_register':
    case 'near_end_of_life': {
      const columns: ExportColumn<Row>[] = [
        { header: 'Asset Code', value: s('asset_code') }, { header: 'Asset Name', value: s('name') }, { header: 'Category', value: s('category') },
        { header: 'Acquisition Date', value: r => fmtDate(r.acquisition_date as string) },
        { header: 'Cost', value: n('cost'), type: 'money' }, { header: 'Accumulated Depreciation', value: n('accumulated_depreciation'), type: 'money' },
        { header: 'Net Book Value', value: n('net_book_value'), type: 'money' },
        ...(d.report_type === 'near_end_of_life'
          ? [{ header: 'Useful Life (Months)', value: n('useful_life_months'), type: 'number' as const },
            { header: 'Remaining (Months)', value: n('remaining_life_months'), type: 'number' as const }]
          : [{ header: 'Location', value: s('location') }, { header: 'Custodian', value: s('custodian') }]),
        { header: 'Status', value: r => STATUS_LABEL[r.display_status as DisplayStatus] ?? String(r.display_status ?? '') },
      ];
      return { columns, rows, orientation: 'landscape',
        totals: { 'Asset Code': 'Total', Cost: jumlah(rows, 'cost'), 'Accumulated Depreciation': jumlah(rows, 'accumulated_depreciation'), 'Net Book Value': jumlah(rows, 'net_book_value') } };
    }
    case 'depreciation_schedule': {
      const bulan = d.months ?? [];
      const columns: ExportColumn<Row>[] = [
        { header: 'Asset Code', value: s('asset_code') }, { header: 'Asset Name', value: s('name') },
        { header: 'Method', value: r => METHOD_LABEL[r.method as DepMethod] ?? '' }, { header: 'Cost', value: n('cost'), type: 'money' },
        { header: 'Opening Accum.', value: n('opening_accumulated'), type: 'money' },
        ...bulan.map((m, i) => ({ header: fmtMonth(m), value: (r: Row) => ((r.months as number[])[i] || null), type: 'money' as const })),
        { header: 'Total', value: n('total'), type: 'money' }, { header: 'Closing Accum.', value: n('closing_accumulated'), type: 'money' },
        { header: 'Net Book Value', value: n('nbv'), type: 'money' },
      ];
      const totals: Record<string, string | number | null> = { 'Asset Code': 'Total', Cost: jumlah(rows, 'cost'), 'Opening Accum.': jumlah(rows, 'opening_accumulated'),
        Total: jumlah(rows, 'total'), 'Closing Accum.': jumlah(rows, 'closing_accumulated'), 'Net Book Value': jumlah(rows, 'nbv') };
      bulan.forEach((m, i) => { totals[fmtMonth(m)] = rows.reduce((t, r) => t + ((r.months as number[])[i] || 0), 0); });
      return { columns, rows, totals, orientation: 'landscape' };
    }
    case 'asset_movement': {
      const columns: ExportColumn<Row>[] = [
        { header: 'Category', value: s('category') }, { header: 'Opening Cost', value: n('opening_cost'), type: 'money' },
        { header: 'Additions', value: n('additions'), type: 'money' }, { header: 'Adjustments', value: n('adjustments'), type: 'money' },
        { header: 'Disposals', value: n('disposals'), type: 'money' }, { header: 'Closing Cost', value: n('closing_cost'), type: 'money' },
        { header: 'Opening Accum.', value: n('opening_accum'), type: 'money' }, { header: 'Depreciation', value: n('depreciation'), type: 'money' },
        { header: 'Accum. Adjust', value: n('accum_adjust'), type: 'money' }, { header: 'Accum. Disposed', value: n('accum_disposed'), type: 'money' },
        { header: 'Closing Accum.', value: n('closing_accum'), type: 'money' },
      ];
      const totals: Record<string, string | number | null> = { Category: 'Total' };
      columns.slice(1).forEach(c => { totals[c.header] = rows.reduce((t, r) => t + ((c.value(r) as number) || 0), 0); });
      return { columns, rows, totals, orientation: 'landscape' };
    }
    case 'disposal': {
      const columns: ExportColumn<Row>[] = [
        { header: 'Disposal No.', value: s('disposal_no') }, { header: 'Asset Code', value: s('asset_code') }, { header: 'Asset Name', value: s('name') },
        { header: 'Disposal Date', value: r => fmtDate(r.disposal_date as string) },
        { header: 'Method', value: r => DISPOSAL_METHOD_LABEL[r.method as DisposalMethod] ?? '' }, { header: 'Buyer / Recipient', value: s('counterparty') },
        { header: 'Cost', value: n('cost'), type: 'money' }, { header: 'Accumulated', value: n('accumulated'), type: 'money' },
        { header: 'Net Book Value', value: n('net_book_value'), type: 'money' }, { header: 'Proceeds', value: n('proceeds'), type: 'money' },
        { header: 'Gain / Loss', value: n('gain_loss'), type: 'money' },
      ];
      return { columns, rows, orientation: 'landscape', totals: { 'Disposal No.': 'Total', Cost: jumlah(rows, 'cost'), Accumulated: jumlah(rows, 'accumulated'),
        'Net Book Value': jumlah(rows, 'net_book_value'), Proceeds: jumlah(rows, 'proceeds'), 'Gain / Loss': jumlah(rows, 'gain_loss') } };
    }
    case 'nbv_summary': {
      const semua: Row[] = [
        ...(d.by_category ?? []).map(r => ({ ...r, dimension: 'Category' })),
        ...(d.by_location ?? []).map(r => ({ ...r, dimension: 'Location' })),
        ...(d.by_branch ?? []).map(r => ({ ...r, dimension: 'Branch' })),
      ];
      const columns: ExportColumn<Row>[] = [
        { header: 'Group By', value: s('dimension') }, { header: 'Group', value: s('group') }, { header: 'Assets', value: n('count'), type: 'number' },
        { header: 'Cost', value: n('cost'), type: 'money' }, { header: 'Accumulated', value: n('accumulated'), type: 'money' }, { header: 'Net Book Value', value: n('nbv'), type: 'money' },
      ];
      return { columns, rows: semua, orientation: 'portrait' };
    }
  }
}

export function exportSpec(d: ReportData, b: BuiltReport, filters: string): ExportSpec<Row> {
  const meta = REPORT_META[d.report_type];
  return {
    title: meta.title, clientName: d.client_name, subtitle: `Period ${fmtDate(d.period.from)} – ${fmtDate(d.period.to)}`,
    meta: filters ? [['Filters', filters]] : undefined, columns: b.columns, rows: b.rows, totals: b.totals,
    fileName: `${meta.title.replace(/[^A-Za-z0-9]+/g, '-')}-${d.period.to}`, orientation: b.orientation,
  };
}
