'use client';
import React from 'react';
import { useLanguage } from '@/lib/language';
import { useEquityStatement } from '../../lib/useStatementData';

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

// Angka dalam JUTA rupiah (2 desimal), negatif dalam kurung.
function fmt(v: number): string {
  if (Math.abs(v) < 0.005) return DASH;
  const teks = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${teks})` : teks;
}

const KOLOM_MUTASI = [
  { key: 'capital', label: 'Capital Contributions' },
  { key: 'profit', label: 'Net Profit for Period' },
  { key: 'dividends', label: 'Dividends / Drawings' },
  { key: 'adj', label: 'Other Adjustments' },
] as const;

type BarisEkuitas = ReturnType<typeof useEquityStatement>['rows'][number];

/** Susun baris tabel: per komponen -> header, saldo awal, mutasi, total. */
function susunBaris(komponen: BarisEkuitas[], totals: ReturnType<typeof useEquityStatement>['totals']): ERow[] {
  const baris: ERow[] = [];
  const kosong = { opening: DASH, capital: DASH, profit: DASH, dividends: DASH, adj: DASH };
  for (const k of komponen) {
    baris.push({ id: `${k.key}-h`, label: k.label, indent: false, isTotal: false, isSection: true, isGrand: false, opening: null, capital: null, profit: null, dividends: null, adj: null, closing: null });
    if (Math.abs(k.opening) >= 0.005) {
      baris.push({ id: `${k.key}-open`, label: 'Opening Balance', indent: true, isTotal: false, isSection: false, isGrand: false, ...kosong, opening: fmt(k.opening), closing: fmt(k.opening) });
    }
    for (const kol of KOLOM_MUTASI) {
      if (Math.abs(k[kol.key]) < 0.005) continue;
      baris.push({ id: `${k.key}-${kol.key}`, label: kol.label, indent: true, isTotal: false, isSection: false, isGrand: false, ...kosong, [kol.key]: fmt(k[kol.key]), closing: fmt(k[kol.key]) });
    }
    baris.push({
      id: `${k.key}-t`, label: `Total ${k.label}`, indent: false, isTotal: true, isSection: false, isGrand: false,
      opening: fmt(k.opening), capital: fmt(k.capital), profit: fmt(k.profit), dividends: fmt(k.dividends), adj: fmt(k.adj), closing: fmt(k.closing),
    });
  }
  baris.push({
    id: 'grand', label: 'TOTAL EQUITY', indent: false, isTotal: true, isSection: false, isGrand: true,
    opening: fmt(totals.opening), capital: fmt(totals.capital), profit: fmt(totals.profit), dividends: fmt(totals.dividends), adj: fmt(totals.adj), closing: fmt(totals.closing),
  });
  return baris;
}

const COL_HEADERS = [
  { id: 'ch-comp',  label: 'Equity Component',       align: 'left'  },
  { id: 'ch-open',  label: 'Opening Balance',         align: 'right' },
  { id: 'ch-cap',   label: 'Capital Contributions',   align: 'right' },
  { id: 'ch-prof',  label: 'Net Profit / (Loss)',     align: 'right' },
  { id: 'ch-div',   label: 'Dividends / Drawings',    align: 'right' },
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
  // Data dari API /api/v1/financial-statements (transaksi posted).
  const eq = useEquityStatement();
  const rows = susunBaris(eq.rows, eq.totals);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Statement of Changes in Equity')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {eq.companyName} · {eq.periodLabel} · {t('All figures in IDR millions')}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded-md font-medium">IDR (Jt)</span>
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
        <span>{t('Amounts in millions of Indonesian Rupiah (IDR)')}</span>
        <span>{t('Source: posted transactions')}</span>
      </div>
    </div>
  );
}