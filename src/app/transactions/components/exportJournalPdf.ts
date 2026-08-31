import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction } from './transactionData';

// [BARU] Export seluruh data transaksi menjadi PDF Jurnal Umum (General
// Journal) — format standar akuntansi: setiap baris transaksi (yang sudah
// berbentuk baris Debit / Kredit di data) ditampilkan berurutan sesuai
// tanggal & No. Jurnal (jeId), lalu ditotal di baris paling bawah untuk
// membuktikan Debit = Kredit (balance).

function formatRupiah(v: number): string {
  if (!v) return '-';
  return v.toLocaleString('id-ID');
}

function formatTanggal(d: string): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function exportJournalToPdf(
  transactions: Transaction[],
  companyName: string = 'PT Nusantara Teknologi Indonesia'
): void {
  if (transactions.length === 0) return;

  // Urutkan berdasarkan tanggal lalu No. Jurnal, supaya baris Debit & Kredit
  // dari satu jurnal entri (jeId) yang sama tampil berdekatan/berurutan.
  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.jeId !== b.jeId) return a.jeId.localeCompare(b.jeId);
    // Baris Debit didahulukan sebelum baris Kredit pada jeId yang sama
    return (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0);
  });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const firstDate = sorted[0]?.date;
  const lastDate = sorted[sorted.length - 1]?.date;
  const generatedAt = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(companyName, 14, 15);
  doc.setFontSize(11);
  doc.text('Jurnal Umum', 14, 21);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Periode: ${formatTanggal(firstDate)} — ${formatTanggal(lastDate)}`, 14, 27);
  doc.text(`Total baris jurnal: ${sorted.length.toLocaleString('id-ID')}`, 14, 32);
  doc.text(`Dicetak: ${generatedAt}`, pageWidth - 14, 15, { align: 'right' });

  const body = sorted.map((tx) => [
    formatTanggal(tx.date),
    tx.jeId,
    tx.voucherNo,
    tx.accountCode,
    tx.accountName,
    tx.description,
    tx.debit ? formatRupiah(tx.debit) : '-',
    tx.credit ? formatRupiah(tx.credit) : '-',
  ]);

  const totalDebit = sorted.reduce((sum, tx) => sum + (tx.debit || 0), 0);
  const totalCredit = sorted.reduce((sum, tx) => sum + (tx.credit || 0), 0);

  autoTable(doc, {
    startY: 37,
    head: [['Tanggal', 'No. Jurnal', 'No. Voucher', 'Kode Akun', 'Nama Akun', 'Deskripsi', 'Debit (Rp)', 'Kredit (Rp)']],
    body,
    foot: [['', '', '', '', '', 'TOTAL', formatRupiah(totalDebit), formatRupiah(totalCredit)]],
    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 26 },
      2: { cellWidth: 22 },
      3: { cellWidth: 18 },
      4: { cellWidth: 38 },
      5: { cellWidth: 'auto' },
      6: { cellWidth: 26, halign: 'right' },
      7: { cellWidth: 26, halign: 'right' },
    },
    didDrawPage: () => {
      const pageCount = doc.getNumberOfPages();
      const current = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Halaman ${current} dari ${pageCount}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' }
      );
    },
  });

  const fileName = `Jurnal-Umum-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
