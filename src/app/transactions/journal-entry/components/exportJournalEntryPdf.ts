import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// PDF "Journal Entry" yang dicetak dari modal input (NewJournalEntryModal.tsx).
// Susunannya SENGAJA mengikuti form input persis -- urutan & label field
// yang sama (JE Number / Entry Date / Period / Source Type, Description /
// Source Reference, tabel Journal Lines dengan kolom yang sama, baris total
// Balanced/Not balanced, lalu Notes) -- supaya dokumen cetak = tampilan form.
// Yang ditambahkan hanya kop (logo + nama perusahaan klien) dan footer cetak.
//
// Dicetak dari isi form SAAT INI (belum tentu sudah disimpan/balance), jadi
// baris kosong ikut tercetak sebagai baris kosong seperti di form.

export interface JournalEntryPdfLine {
  account_code: string;
  account_name: string;
  description: string;
  cost_center: string;
  debit: string;
  credit: string;
}

export interface JournalEntryPdfData {
  jeNumber: string;
  entryDate: string;
  period: string;
  sourceType: string;
  description: string;
  sourceReference: string;
  notes: string;
  lines: JournalEntryPdfLine[];
}

export interface JournalEntryPdfOptions {
  companyName: string;
  /** Data URL gambar logo klien (management_clients.logo). Kosong = kop teks saja. */
  logoDataUrl?: string | null;
  printedBy: string;
}

const MARGIN = 12;
const LOGO_MAX_W = 32;
const LOGO_MAX_H = 18;

const GRAY_TEXT: [number, number, number] = [107, 114, 128];
const DARK_TEXT: [number, number, number] = [17, 24, 39];
const BORDER: [number, number, number] = [209, 213, 219];
const HEAD_FILL: [number, number, number] = [243, 244, 246];
const OK_FILL: [number, number, number] = [240, 253, 244];
const OK_TEXT: [number, number, number] = [21, 128, 61];
const BAD_FILL: [number, number, number] = [254, 242, 242];
const BAD_TEXT: [number, number, number] = [185, 28, 28];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const fmtCell = (v: string) => {
  const n = Number(v) || 0;
  return n > 0 ? fmt(n) : '';
};

interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

/** Muat logo lewat <canvas> -> PNG, supaya format apa pun (termasuk WebP)
 *  yang tersimpan di backend selalu bisa disisipkan jsPDF. Gagal = null
 *  (PDF tetap dicetak, tanpa logo). */
function loadLogo(dataUrl: string): Promise<LoadedLogo | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function formatTanggalCetak(d: Date): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Kotak field bergaya input (label kecil di atas, nilai di dalam kotak). Mengembalikan tinggi yang dipakai. */
function drawField(doc: jsPDF, label: string, value: string, x: number, y: number, w: number): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GRAY_TEXT);
  doc.text(label, x, y);

  doc.setFontSize(9);
  const wrapped: string[] = doc.splitTextToSize(value || '', w - 4);
  const boxH = Math.max(8, wrapped.length * 4 + 3.5);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y + 1.5, w, boxH, 1, 1, 'S');
  doc.setTextColor(...DARK_TEXT);
  doc.text(wrapped, x + 2, y + 1.5 + 5.2);
  return boxH + 1.5;
}

export async function exportJournalEntryPdf(data: JournalEntryPdfData, options: JournalEntryPdfOptions): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const now = new Date();

  // ── Kop: logo + nama perusahaan (kiri), judul dokumen (kanan) ──
  let textX = MARGIN;
  const logo = options.logoDataUrl ? await loadLogo(options.logoDataUrl) : null;
  if (logo) {
    const ratio = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height);
    const w = logo.width * ratio;
    const h = logo.height * ratio;
    doc.addImage(logo.dataUrl, 'PNG', MARGIN, MARGIN + (LOGO_MAX_H - h) / 2, w, h);
    textX = MARGIN + w + 4;
  }
  if (options.companyName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...DARK_TEXT);
    const nameLines: string[] = doc.splitTextToSize(options.companyName, pageWidth / 2 - textX);
    doc.text(nameLines, textX, MARGIN + LOGO_MAX_H / 2 + 1.5 - ((nameLines.length - 1) * 5) / 2);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...DARK_TEXT);
  doc.text('Journal Entry', pageWidth - MARGIN, MARGIN + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_TEXT);
  doc.text(data.jeNumber || '-', pageWidth - MARGIN, MARGIN + 11.5, { align: 'right' });

  const headerBottom = MARGIN + LOGO_MAX_H + 4;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, headerBottom, pageWidth - MARGIN, headerBottom);

  // ── Field header (grid 4 kolom, sama seperti form input) ──
  const gap = 4;
  const colW = (contentWidth - gap * 3) / 4;
  const colX = (i: number) => MARGIN + i * (colW + gap);
  let y = headerBottom + 8;

  const row1 = [
    drawField(doc, 'JE Number', data.jeNumber, colX(0), y, colW),
    drawField(doc, 'Entry Date', data.entryDate, colX(1), y, colW),
    drawField(doc, 'Period', data.period, colX(2), y, colW),
    drawField(doc, 'Source Type', data.sourceType, colX(3), y, colW),
  ];
  y += Math.max(...row1) + 5;

  const row2 = [
    drawField(doc, 'Description', data.description, colX(0), y, colW * 2 + gap),
    drawField(doc, 'Source Reference (opsional)', data.sourceReference, colX(2), y, colW * 2 + gap),
  ];
  y += Math.max(...row2) + 7;

  // ── Journal Lines ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK_TEXT);
  doc.text('Journal Lines', MARGIN, y);

  const totalDebit = data.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = data.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  autoTable(doc, {
    startY: y + 2.5,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    theme: 'grid',
    head: [['Account Code', 'Account Name', 'Description', 'Cost Center', 'Debit', 'Credit']],
    body: data.lines.map(l => [l.account_code, l.account_name, l.description, l.cost_center, fmtCell(l.debit), fmtCell(l.credit)]),
    foot: [[
      { content: balanced ? 'Balanced' : 'Not balanced', colSpan: 4, styles: { halign: 'right' } },
      fmt(totalDebit),
      fmt(totalCredit),
    ]],
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, minCellHeight: 8, valign: 'middle', textColor: DARK_TEXT, lineColor: BORDER, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: HEAD_FILL, textColor: GRAY_TEXT, fontStyle: 'bold' },
    footStyles: {
      fillColor: balanced ? OK_FILL : BAD_FILL,
      textColor: balanced ? OK_TEXT : BAD_TEXT,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 36 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 24 },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
    },
    // Header kolom Debit/Credit ikut rata kanan seperti di form.
    didParseCell: hook => {
      if (hook.section === 'head' && (hook.column.index === 4 || hook.column.index === 5)) {
        hook.cell.styles.halign = 'right';
      }
      if (hook.section === 'foot' && (hook.column.index === 4 || hook.column.index === 5)) {
        hook.cell.styles.halign = 'right';
      }
    },
  });

  // ── Notes ──
  // @ts-expect-error lastAutoTable ditambahkan jspdf-autotable ke instance jsPDF
  let notesY: number = (doc.lastAutoTable?.finalY ?? y + 20) + 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const noteLines: string[] = doc.splitTextToSize(data.notes || '', contentWidth - 4);
  const notesBoxH = Math.max(14, noteLines.length * 4 + 5);
  if (notesY + notesBoxH + 8 > pageHeight - 16) {
    doc.addPage();
    notesY = MARGIN + 4;
  }
  doc.setFontSize(7);
  doc.setTextColor(...GRAY_TEXT);
  doc.text('Notes (opsional)', MARGIN, notesY);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN, notesY + 1.5, contentWidth, notesBoxH, 1, 1, 'S');
  doc.setFontSize(9);
  doc.setTextColor(...DARK_TEXT);
  doc.text(noteLines, MARGIN + 2, notesY + 1.5 + 5.2);

  // ── Footer tiap halaman ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY_TEXT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.text(`Printed by ${options.printedBy} · ${formatTanggalCetak(now)}`, MARGIN, pageHeight - 8);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  }

  const safeName = (data.jeNumber || 'draft').replace(/[^A-Za-z0-9_-]+/g, '_');
  doc.save(`Journal-Entry-${safeName}.pdf`);
}
