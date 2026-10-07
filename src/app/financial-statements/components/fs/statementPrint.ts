import type { PrintColumn, PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import type { StatementRow } from './StatementTable';
import { fmtMonth } from './fsFormat';

// StatementRow[] (Balance Sheet / P&L) -> PrintReport untuk PDF/CSV/XLSX.
// Semua baris laporan + rincian akun ikut (tidak tergantung expand di layar).

export function buildStatementReport(opts: {
  title: string;
  fileBase: string;
  companyName: string;
  subtitle: string;
  rows: StatementRow[];
  currentLabel: string;
  compareLabel?: string | null;
  months?: string[];
  printedBy?: string;
}): PrintReport {
  const monthly = !!opts.months?.length;
  const compare = !!opts.compareLabel && !monthly;
  const columns: PrintColumn[] = [{ key: 'desc', header: 'Description', width: 48 }];
  (opts.months ?? []).forEach((m, i) => columns.push({ key: `m${i}`, header: fmtMonth(m), type: 'money', width: 15 }));
  columns.push({ key: 'cur', header: monthly ? 'Total' : opts.currentLabel, type: 'money', width: 18 });
  if (compare) {
    columns.push({ key: 'cmp', header: opts.compareLabel!, type: 'money', width: 18 });
    columns.push({ key: 'var', header: 'Variance', type: 'money', width: 16 });
  }

  const rows: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  const push = (desc: string, cur: number | null, cmp: number | null, monthlyVals: number[] | null | undefined, style?: PrintRowStyle) => {
    const row: PrintRow = { desc, cur };
    if (monthly) (opts.months ?? []).forEach((_, i) => { row[`m${i}`] = monthlyVals?.[i] ?? 0; });
    if (compare) {
      row.cmp = cmp;
      row.var = cur !== null && cmp !== null ? cur - cmp : null;
    }
    rows.push(row);
    styles.push(style);
  };

  opts.rows.forEach(r => {
    if (r.kind === 'section') {
      const s = r.section;
      push(s.label.toUpperCase(), null, null, null, 'section');
      s.lines.forEach(l => {
        push(`  ${l.label}`, l.amount, l.compare_amount, l.monthly);
        l.accounts.forEach(a => push(`      ${a.code ? `${a.code} ` : ''}${a.name}`, a.amount, a.compare_amount, a.monthly));
      });
      push(`Total ${s.label}`, s.total, s.compare_total, s.monthly ?? null, 'total');
    } else {
      push(r.label.toUpperCase(), r.amount, r.compare_amount, r.monthly, 'total');
    }
  });

  return {
    title: opts.title,
    fileBase: opts.fileBase,
    companyName: opts.companyName,
    subtitle: opts.subtitle,
    orientation: monthly || compare ? 'landscape' : 'portrait',
    printedBy: opts.printedBy,
    table: { columns, rows, rowStyles: styles },
  };
}
