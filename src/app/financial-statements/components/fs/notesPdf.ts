import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FsNotes } from '@/lib/fsStore';
import { fmtAmount, fmtDate } from './fsFormat';

// Export CALK ke PDF (jsPDF + autotable) dari data yang sama dengan layar.
// Versi Word dibuat backend (calk_docx.py) dari data yang sama juga.

const M = 16;
const DARK: [number, number, number] = [17, 24, 39];
const GRAY: [number, number, number] = [107, 114, 128];

export function downloadNotesPdf(d: FsNotes, printedBy?: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M + 4;

  const ensure = (h: number) => {
    if (y + h > H - 18) { doc.addPage(); y = M + 4; }
  };

  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text((d.client.company_name || 'Company').toUpperCase(), W / 2, y, { align: 'center' });
  y += 7;
  doc.setFontSize(12);
  doc.text('NOTES TO THE FINANCIAL STATEMENTS', W / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(...GRAY);
  doc.text(`For the period ended ${fmtDate(d.as_of)} · (Expressed in Indonesian Rupiah)`, W / 2, y, { align: 'center' });
  y += 10;

  const compare = d.compare_period;
  d.notes.forEach(n => {
    ensure(14);
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${n.no}. ${n.title.toUpperCase()}`, M, y);
    y += 6;
    if (n.narrative) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const lines: string[] = doc.splitTextToSize(n.narrative, W - M * 2);
      lines.forEach(line => { ensure(5); doc.text(line, M, y); y += 4.6; });
      y += 2;
    }
    n.groups.forEach(g => {
      ensure(20);
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, bottom: 18 },
        theme: 'plain',
        head: [[g.label, fmtDate(d.as_of), ...(compare ? [fmtDate(compare.end)] : [])]],
        body: g.rows.map(r => [`${r.name} (${r.code})${r.override ? ' *' : ''}`, fmtAmount(r.amount), ...(compare ? [fmtAmount(r.compare_amount)] : [])]),
        foot: [['Total', fmtAmount(g.total), ...(compare ? [fmtAmount(g.compare_total)] : [])]],
        showFoot: 'lastPage',
        styles: { fontSize: 8.5, cellPadding: 1.3, textColor: DARK },
        headStyles: { fontStyle: 'bold', lineWidth: { bottom: 0.3 }, lineColor: DARK },
        footStyles: { fontStyle: 'bold', lineWidth: { top: 0.3 }, lineColor: DARK },
        columnStyles: { 1: { halign: 'right', cellWidth: 38 }, 2: { halign: 'right', cellWidth: 38 } },
        didParseCell: h => { if (h.section !== 'body' && h.column.index > 0) h.cell.styles.halign = 'right'; },
      });
      // @ts-expect-error lastAutoTable ditambahkan jspdf-autotable ke instance jsPDF
      y = (doc.lastAutoTable?.finalY ?? y) + 3;
      if (g.rows.some(r => r.override)) {
        ensure(5);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(...GRAY);
        doc.text('* Amount overridden from the system-calculated value (see audit trail).', M, y);
        doc.setTextColor(...DARK);
        y += 4;
      }
      y += 2;
    });
    y += 4;
  });

  const total = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(`Printed${printedBy ? ` by ${printedBy}` : ''} · ${stamp}`, M, H - 9);
    doc.text(`Page ${p} of ${total}`, W - M, H - 9, { align: 'right' });
  }
  const safe = (d.client.company_name || 'client').replace(/[^A-Za-z0-9_-]+/g, '_');
  doc.save(`CALK_${safe}_${d.as_of}.pdf`);
}
