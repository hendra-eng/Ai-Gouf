import type { PrintColumn, PrintReport, PrintRow } from '@/lib/printExport';
import type { JeUiEntry, JeUiLine } from '@/lib/journalEntryStore';

// Susunan laporan Print (CSV / Excel / PDF) untuk fitur Journal Entry.
// Daftar = format General Journal flat (1 baris per journal line, total
// Debit = Credit di bawah); detail = 1 JE lengkap dengan baris jurnalnya.

export interface JePrintRow extends JeUiEntry {
  lines: JeUiLine[];
}

const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildJeListReport(rows: JePrintRow[], companyName?: string, printedBy?: string): PrintReport {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.jeNumber.localeCompare(b.jeNumber));
  const columns: PrintColumn[] = [
    { key: 'jeNumber', header: 'JE Number', width: 20 },
    { key: 'date', header: 'Entry Date', width: 12 },
    { key: 'postingDate', header: 'Posting Date', width: 12 },
    { key: 'period', header: 'Period', width: 11 },
    { key: 'source', header: 'Source', width: 12 },
    { key: 'status', header: 'Status', width: 11 },
    { key: 'accountCode', header: 'Account Code', width: 13 },
    { key: 'accountName', header: 'Account Name', width: 28 },
    { key: 'description', header: 'Description', width: 34 },
    { key: 'debit', header: 'Debit (IDR)', type: 'money' },
    { key: 'credit', header: 'Credit (IDR)', type: 'money' },
  ];

  const body: PrintRow[] = [];
  let debit = 0;
  let credit = 0;
  sorted.forEach(je => {
    const lines = je.lines.length > 0 ? je.lines : [null];
    lines.forEach(line => {
      body.push({
        jeNumber: je.jeNumber,
        date: je.date,
        postingDate: je.postingDate,
        period: je.period,
        source: je.sourceType,
        status: statusLabel(je.status),
        accountCode: line?.accountCode ?? '',
        accountName: line?.accountName ?? '',
        description: line?.description || je.description,
        debit: line?.debit || null,
        credit: line?.credit || null,
      });
      debit += line?.debit ?? 0;
      credit += line?.credit ?? 0;
    });
  });

  const first = sorted[0]?.date;
  const last = sorted[sorted.length - 1]?.date;
  return {
    title: 'General Journal',
    fileBase: 'General-Journal',
    companyName,
    printedBy,
    subtitle: `${sorted.length} journal entries${first ? ` · Period ${first} — ${last}` : ''}`,
    orientation: 'landscape',
    table: { columns, rows: body, totals: { description: 'TOTAL', debit, credit } },
  };
}

export function buildJeDetailReport(je: JeUiEntry, lines: JeUiLine[], companyName?: string, printedBy?: string): PrintReport {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return {
    title: 'Journal Entry',
    fileBase: `Journal-Entry-${je.jeNumber}`,
    companyName,
    printedBy,
    subtitle: je.jeNumber,
    orientation: 'portrait',
    fields: [
      ['JE Number', je.jeNumber],
      ['Status', statusLabel(je.status)],
      ['Entry Date', je.date],
      ['Posting Date', je.postingDate || '—'],
      ['Period', je.period],
      ['Source Type', je.sourceType],
      ['Source Reference', je.sourceReference || '—'],
      ['Currency', je.currency],
      ['Created By', je.createdBy],
      ['Reviewed By', je.reviewedBy || '—'],
      ['Approved By', je.approvedBy || '—'],
      ['Last Updated', je.lastUpdated],
      ['Description', je.description],
    ],
    table: {
      columns: [
        { key: 'accountCode', header: 'Account Code', width: 14 },
        { key: 'accountName', header: 'Account Name', width: 30 },
        { key: 'description', header: 'Description', width: 34 },
        { key: 'costCenter', header: 'Cost Center', width: 14 },
        { key: 'debit', header: 'Debit (IDR)', type: 'money' },
        { key: 'credit', header: 'Credit (IDR)', type: 'money' },
      ],
      rows: lines.map(l => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        description: l.description,
        costCenter: l.costCenter || '',
        debit: l.debit || null,
        credit: l.credit || null,
      })),
      totals: { costCenter: Math.abs(debit - credit) < 0.01 ? 'Balanced' : 'Not balanced', debit, credit },
    },
    notes: je.notes,
  };
}
