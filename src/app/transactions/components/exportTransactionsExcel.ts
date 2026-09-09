import * as XLSX from 'xlsx';
import { Transaction } from './transactionData';

// [BARU] Export transaksi (sesuai filter/tahun yang sedang aktif di halaman)
// menjadi file Excel (.xlsx). Sengaja dibuat sederhana dulu — cukup satu
// sheet, kolom apa adanya dari data transaksi — supaya tombol Export benar-
// benar menghasilkan file yang bisa diunduh. Bisa dirapikan lagi belakangan
// (styling, format Rupiah, dsb) mengikuti pola exportJournalPdf.ts.

function formatTanggal(d: string): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function exportTransactionsToExcel(transactions: Transaction[]): void {
  if (transactions.length === 0) return;

  const rows = transactions.map((tx) => ({
    Tanggal: formatTanggal(tx.date),
    'No. Jurnal': tx.jeId,
    'No. Voucher': tx.voucherNo,
    'Kode Akun': tx.accountCode,
    'Nama Akun': tx.accountName,
    Deskripsi: tx.description,
    Pihak: tx.party,
    Referensi: tx.reference,
    Kategori: tx.category,
    Tipe: tx.type,
    Status: tx.status,
    Debit: tx.debit || 0,
    Kredit: tx.credit || 0,
    'Saldo Akhir': tx.saldoAkhir || 0,
    Catatan: tx.notes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transaksi');

  const fileName = `Transaksi-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
