import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import type { JeUiEntry, JeUiLine } from '@/lib/journalEntryStore';

export interface JeExportRow extends JeUiEntry {
  lines: JeUiLine[];
}

function formatTanggal(iso: string): string {
  if (!iso) return '-';
  const dt = new Date(iso + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const fmtUsd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Export "Jurnal Umum" (General Journal) ke PDF -- 1 baris per journal
 *  line (debit/kredit), dikelompokkan per JE, ditotal di akhir untuk
 *  membuktikan Debit = Credit. Pola sama dengan
 *  src/app/transactions/components/exportJournalPdf.ts, tapi untuk data
 *  fitur Journal Entry (multi-line asli, bukan model Transaction lama). */
export function exportJournalEntriesToPdf(rows: JeExportRow[], companyName: string = 'PT Nusantara Teknologi Indonesia'): void {
  if (rows.length === 0) return;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.jeNumber.localeCompare(b.jeNumber));

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const generatedAt = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(companyName, 14, 15);
  doc.setFontSize(11);
  doc.text('Jurnal Umum (General Journal)', 14, 21);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Periode: ${formatTanggal(sorted[0]?.date)} — ${formatTanggal(sorted[sorted.length - 1]?.date)}`, 14, 27);
  doc.text(`Total journal entries: ${sorted.length.toLocaleString('id-ID')}`, 14, 32);
  doc.text(`Dicetak: ${generatedAt}`, pageWidth - 14, 15, { align: 'right' });

  const body: (string | number)[][] = [];
  let grandDebit = 0;
  let grandCredit = 0;
  sorted.forEach(je => {
    je.lines.forEach((line, idx) => {
      body.push([
        idx === 0 ? formatTanggal(je.date) : '',
        idx === 0 ? je.jeNumber : '',
        idx === 0 ? je.status : '',
        line.accountCode,
        line.accountName,
        line.description || je.description,
        line.debit ? fmtUsd(line.debit) : '-',
        line.credit ? fmtUsd(line.credit) : '-',
      ]);
      grandDebit += line.debit;
      grandCredit += line.credit;
    });
  });

  autoTable(doc, {
    startY: 37,
    head: [['Tanggal', 'No. Jurnal', 'Status', 'Kode Akun', 'Nama Akun', 'Deskripsi', 'Debit (USD)', 'Credit (USD)']],
    body,
    foot: [['', '', '', '', '', 'TOTAL', fmtUsd(grandDebit), fmtUsd(grandCredit)]],
    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 28 }, 2: { cellWidth: 18 }, 3: { cellWidth: 20 },
      4: { cellWidth: 38 }, 5: { cellWidth: 'auto' }, 6: { cellWidth: 26, halign: 'right' }, 7: { cellWidth: 26, halign: 'right' },
    },
    didDrawPage: () => {
      const pageCount = doc.getNumberOfPages();
      const current = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Halaman ${current} dari ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    },
  });

  doc.save(`Jurnal-Umum-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Export ke Excel -- 1 sheet, 1 row per journal line (format GL flat),
 *  dipakai exceljs (bukan xlsx/SheetJS) supaya header bisa diberi styling,
 *  konsisten dengan exportTransactionsExcel.ts. */
export async function exportJournalEntriesToExcel(rows: JeExportRow[]): Promise<void> {
  if (rows.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Jurnal Umum');

  sheet.columns = [
    { header: 'JE Number', key: 'je', width: 20 },
    { header: 'Entry Date', key: 'date', width: 14 },
    { header: 'Posting Date', key: 'postingDate', width: 14 },
    { header: 'Period', key: 'period', width: 12 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Account Code', key: 'accCode', width: 14 },
    { header: 'Account Name', key: 'accName', width: 28 },
    { header: 'Line Description', key: 'lineDesc', width: 34 },
    { header: 'Cost Center', key: 'costCenter', width: 14 },
    { header: 'Debit', key: 'debit', width: 16 },
    { header: 'Credit', key: 'credit', width: 16 },
    { header: 'Created By', key: 'createdBy', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.jeNumber.localeCompare(b.jeNumber));
  sorted.forEach(je => {
    je.lines.forEach(line => {
      sheet.addRow({
        je: je.jeNumber,
        date: je.date,
        postingDate: je.postingDate,
        period: je.period,
        source: je.sourceType,
        status: je.status,
        accCode: line.accountCode,
        accName: line.accountName,
        lineDesc: line.description || je.description,
        costCenter: line.costCenter || '',
        debit: line.debit || null,
        credit: line.credit || null,
        createdBy: je.createdBy,
      });
    });
  });

  sheet.getColumn('debit').numFmt = '#,##0.00';
  sheet.getColumn('credit').numFmt = '#,##0.00';

  const totalDebit = sorted.reduce((s, je) => s + je.totalDebit, 0);
  const totalCredit = sorted.reduce((s, je) => s + je.totalCredit, 0);
  const totalRow = sheet.addRow({ lineDesc: 'TOTAL', debit: totalDebit, credit: totalCredit });
  totalRow.font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `Jurnal-Umum-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
