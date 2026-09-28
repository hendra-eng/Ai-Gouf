import type { PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import type { useEquityStatement } from '../../lib/useStatementData';

// Laporan Print (CSV / Excel / PDF) Statement of Changes in Equity -- susunan
// baris sama dengan EquityMainTable (per komponen: judul, saldo awal, mutasi,
// total; lalu TOTAL EQUITY), angka dalam JUTA rupiah seperti di layar.

type EquityData = ReturnType<typeof useEquityStatement>;

const MUTASI = [
  { key: 'capital', label: 'Capital Contributions' },
  { key: 'profit', label: 'Net Profit for Period' },
  { key: 'dividends', label: 'Dividends / Drawings' },
  { key: 'adj', label: 'Other Adjustments' },
] as const;

const nz = (v: number) => (Math.abs(v) < 0.005 ? null : v);

export function buildEquityReport(eq: EquityData, t: (s: string) => string, printedBy?: string): PrintReport {
  const rows: PrintRow[] = [];
  const rowStyles: (PrintRowStyle | undefined)[] = [];
  const push = (row: PrintRow, style?: PrintRowStyle) => { rows.push(row); rowStyles.push(style); };

  for (const k of eq.rows) {
    push({ label: t(k.label).toUpperCase() }, 'section');
    if (nz(k.opening) !== null) push({ label: `   ${t('Opening Balance')}`, opening: k.opening, closing: k.opening });
    for (const m of MUTASI) {
      if (nz(k[m.key]) === null) continue;
      push({ label: `   ${t(m.label)}`, [m.key]: k[m.key], closing: k[m.key] });
    }
    push({
      label: `${t('Total')} ${t(k.label)}`,
      opening: nz(k.opening), capital: nz(k.capital), profit: nz(k.profit),
      dividends: nz(k.dividends), adj: nz(k.adj), closing: nz(k.closing),
    }, 'total');
  }

  const tot = eq.totals;
  const reconciled = Math.abs(tot.closing - eq.balanceSheetEquity) < 0.01;
  const re = eq.retainedEarnings;

  return {
    title: t('Statement of Changes in Equity'),
    fileBase: 'Statement-of-Changes-in-Equity',
    companyName: eq.companyName,
    printedBy,
    subtitle: `${eq.periodLabel} · ${t('All figures in IDR millions')}`,
    orientation: 'landscape',
    fields: [
      [t('Period'), eq.periodLabel],
      [t('Currency'), 'IDR (millions)'],
      [t('Basis'), t('Posted transactions only')],
      [t('Balance Sheet Reconciliation'), reconciled ? t('Balanced ✓') : t('Not reconciled to Balance Sheet')],
    ],
    table: {
      columns: [
        { key: 'label', header: t('Equity Component'), width: 38 },
        { key: 'opening', header: t('Opening Balance'), type: 'money' },
        { key: 'capital', header: t('Capital Contributions'), type: 'money' },
        { key: 'profit', header: t('Net Profit / (Loss)'), type: 'money' },
        { key: 'dividends', header: t('Dividends / Drawings'), type: 'money' },
        { key: 'adj', header: t('Other Adjustments'), type: 'money' },
        { key: 'closing', header: t('Closing Balance'), type: 'money' },
      ],
      rows,
      rowStyles,
      totals: {
        label: t('TOTAL EQUITY'),
        opening: tot.opening, capital: tot.capital, profit: tot.profit,
        dividends: tot.dividends, adj: tot.adj, closing: tot.closing,
      },
    },
    // Rekonsiliasi laba ditahan (juta rupiah) -- sama dengan panel di halaman.
    summary: [
      [`${t('Retained Earnings')} — ${t('Opening Balance')}`, re.opening],
      [t('Net Profit for Period'), re.netProfit],
      [t('Dividends / Drawings'), re.dividends],
      [t('Other Adjustments'), re.adjustments],
      [`${t('Retained Earnings')} — ${t('Closing Balance')}`, re.closing],
    ],
    notes: t('Amounts in millions of Indonesian Rupiah (IDR). Source: posted transactions.'),
  };
}
