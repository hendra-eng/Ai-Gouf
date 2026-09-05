import React from 'react';
import { useLanguage } from '@/lib/language';

interface ERow {
  id: string;
  label: string;
  indent: boolean;
  isTotal: boolean;
  isSection: boolean;
  isGrand: boolean;
  opening: string | null;
  capital: string | null;
  profit: string | null;
  dividends: string | null;
  adj: string | null;
  closing: string | null;
}

const DASH = '—';

const rows: ERow[] = [
  // Share Capital
  { id: 'r-sc-h',  label: 'Share Capital',              indent: false, isTotal: false, isSection: true,  isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null },
  { id: 'r-sc-1',  label: 'Opening Balance',             indent: true,  isTotal: false, isSection: false, isGrand: false, opening: '5,000,000', capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '5,000,000' },
  { id: 'r-sc-2',  label: 'Capital Contributions',       indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: '500,000',  profit: DASH,        dividends: DASH,        adj: DASH,       closing: '500,000' },
  { id: 'r-sc-t',  label: 'Total Share Capital',         indent: false, isTotal: true,  isSection: false, isGrand: false, opening: '5,000,000', capital: '500,000',  profit: DASH,        dividends: DASH,        adj: DASH,       closing: '5,500,000' },
  // APIC
  { id: 'r-ap-h',  label: 'Additional Paid-in Capital',  indent: false, isTotal: false, isSection: true,  isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null },
  { id: 'r-ap-1',  label: 'Opening Balance',             indent: true,  isTotal: false, isSection: false, isGrand: false, opening: '1,200,000', capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '1,200,000' },
  { id: 'r-ap-2',  label: 'Share Premium — New Issue',   indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: '250,000',  profit: DASH,        dividends: DASH,        adj: DASH,       closing: '250,000' },
  { id: 'r-ap-t',  label: 'Total APIC',                  indent: false, isTotal: true,  isSection: false, isGrand: false, opening: '1,200,000', capital: '250,000',  profit: DASH,        dividends: DASH,        adj: DASH,       closing: '1,450,000' },
  // Retained Earnings
  { id: 'r-re-h',  label: 'Retained Earnings',           indent: false, isTotal: false, isSection: true,  isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null },
  { id: 'r-re-1',  label: 'Opening Balance',             indent: true,  isTotal: false, isSection: false, isGrand: false, opening: '1,980,000', capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '1,980,000' },
  { id: 'r-re-2',  label: 'Net Profit for Period',       indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: DASH,       profit: '1,840,000', dividends: DASH,        adj: DASH,       closing: '1,840,000' },
  { id: 'r-re-3',  label: 'Dividends Declared',          indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: DASH,       profit: DASH,        dividends: '(420,000)', adj: DASH,       closing: '(420,000)' },
  { id: 'r-re-4',  label: 'Other Adjustments',           indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: DASH,       profit: DASH,        dividends: DASH,        adj: '(35,000)', closing: '(35,000)' },
  { id: 'r-re-t',  label: 'Total Retained Earnings',     indent: false, isTotal: true,  isSection: false, isGrand: false, opening: '1,980,000', capital: DASH,       profit: '1,840,000', dividends: '(420,000)', adj: '(35,000)', closing: '3,365,000' },
  // OCI
  { id: 'r-oc-h',  label: 'Other Comprehensive Income',  indent: false, isTotal: false, isSection: true,  isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null },
  { id: 'r-oc-1',  label: 'Opening Balance',             indent: true,  isTotal: false, isSection: false, isGrand: false, opening: '140,000',  capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '140,000' },
  { id: 'r-oc-2',  label: 'FX Translation & Revaluation',indent: true,  isTotal: false, isSection: false, isGrand: false, opening: DASH,       capital: DASH,       profit: DASH,        dividends: DASH,        adj: '(50,000)', closing: '(50,000)' },
  { id: 'r-oc-t',  label: 'Total OCI',                   indent: false, isTotal: true,  isSection: false, isGrand: false, opening: '140,000',  capital: DASH,       profit: DASH,        dividends: DASH,        adj: '(50,000)', closing: '90,000' },
  // Other Equity
  { id: 'r-oe-h',  label: 'Other Equity',                indent: false, isTotal: false, isSection: true,  isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null },
  { id: 'r-oe-1',  label: 'Opening Balance',             indent: true,  isTotal: false, isSection: false, isGrand: false, opening: '100,000',  capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '100,000' },
  { id: 'r-oe-t',  label: 'Total Other Equity',          indent: false, isTotal: true,  isSection: false, isGrand: false, opening: '100,000',  capital: DASH,       profit: DASH,        dividends: DASH,        adj: DASH,       closing: '100,000' },
  // Grand
  { id: 'r-grand', label: 'TOTAL EQUITY',                indent: false, isTotal: true,  isSection: false, isGrand: true,  opening: '8,420,000', capital: '750,000',  profit: '1,840,000', dividends: '(420,000)', adj: '(85,000)', closing: '10,505,000' },
];

const COL_HEADERS = [
  { id: 'ch-comp',  label: 'Equity Component',       align: 'left'  },
  { id: 'ch-open',  label: 'Opening Balance',         align: 'right' },
  { id: 'ch-cap',   label: 'Capital Contributions',   align: 'right' },
  { id: 'ch-prof',  label: 'Net Profit / (Loss)',     align: 'right' },
  { id: 'ch-div',   label: 'Dividends',               align: 'right' },
  { id: 'ch-adj',   label: 'Other Adjustments',       align: 'right' },
  { id: 'ch-close', label: 'Closing Balance',         align: 'right' },
];

function renderCell(val: string | null) {
  if (!val) return null;
  if (val === DASH) return <span className="text-muted-foreground/40">{DASH}</span>;
  if (val.startsWith('(')) return <span className="text-negative">{val}</span>;
  return <span>{val}</span>;
}

export default function EquityMainTable() {
  const { t } = useLanguage();
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Statement of Changes in Equity')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t('PT Nusantara Teknologi Indonesia · January – August 2026 · All figures in USD')}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded-md font-medium">USD</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              {COL_HEADERS.map(c => (
                <th
                  key={c.id}
                  className={`accounting-th ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {t(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (row.isSection) {
                return (
                  <tr key={row.id} className="bg-muted/60">
                    <td colSpan={7} className="py-2 px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
                      {t(row.label)}
                    </td>
                  </tr>
                );
              }

              const vals = [row.opening, row.capital, row.profit, row.dividends, row.adj, row.closing];

              return (
                <tr
                  key={row.id}
                  className={`row-hover ${row.isGrand ? 'bg-primary/5 border-t-2 border-primary/20' : row.isTotal ? 'bg-muted/30' : ''}`}
                >
                  <td className={`accounting-td text-left ${row.indent ? 'pl-7 text-muted-foreground text-[12px]' : ''} ${row.isGrand ? 'font-bold text-[12px] uppercase tracking-wide' : row.isTotal ? 'font-semibold' : ''}`}>
                    {t(row.label)}
                  </td>
                  {vals.map((v, ci) => (
                    <td
                      key={`td-${row.id}-${ci}`}
                      className={`accounting-td ${row.isGrand ? 'font-bold' : row.isTotal ? 'font-semibold' : ''}`}
                    >
                      {renderCell(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{t('Amounts in United States Dollars (USD)')}</span>
        <span>{t('Prepared in accordance with PSAK')}</span>
      </div>
    </div>
  );
}