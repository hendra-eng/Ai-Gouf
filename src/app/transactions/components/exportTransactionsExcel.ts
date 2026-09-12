import ExcelJS from 'exceljs';
import { Transaction } from './transactionData';
// [BARU] Dispatcher template per client — lihat exportTemplateRegistry.ts
// untuk daftar client mana pakai template apa.
import { resolveExportTemplate } from './exportTemplates/exportTemplateRegistry';
import { buildSauCashJournalWorkbookBlob } from './exportTemplates/sauCashJournalTemplate';
// [BARU] blob + downloadBlob dipisah ke file kecil ini supaya tidak circular
// import dengan sauCashJournalTemplate.ts (lihat catatan di file itu).
import { downloadBlob, type ExcelExportResult } from './exportTemplates/exportExcelShared';

export { downloadBlob };
export type { ExcelExportResult };

// [GL TEMPLATE] Export mengikuti struktur + tampilan GL_TEMPLATE.xlsx persis
// (1 row = 1 journal line, 85 kolom: GL_Line_ID s/d AI_Processed_At),
// termasuk warna header, warna kolom "derived" (kuning) dan kolom AI (ungu),
// font, ukuran font, lebar kolom, serta format angka/tanggal.
//
// Tahap ini SENGAJA belum mengisi baris data — tombol Export hanya
// menghasilkan file kosong dengan judul, catatan, dan seluruh header +
// styling sesuai template. Mapping dari `transactions` (tabel Transaksi) ke
// kolom-kolom GL ini menyusul di tahap berikutnya.
//
// Dipakai `exceljs` (bukan `xlsx`/SheetJS) khusus untuk export ini, karena
// versi gratis SheetJS tidak bisa menulis styling (warna fill, font, dsb) —
// fitur itu berbayar (Pro) di SheetJS. exceljs open-source & full-featured.

const GL_TITLE = 'GL TEMPLATE – 1 ROW = 1 JOURNAL LINE';
const GL_NOTE =
  'Kolom kuning/derived dapat dihitung sistem. Untuk implementasi database, gunakan primary key GL_Line_ID dan composite unique key minimal Entity_Code + Journal_ID + Journal_Line_No.';

// [header, lebar kolom] — lebar disalin dari GL_TEMPLATE.xlsx
const GL_COLUMNS: { header: string; width: number }[] = [
  { header: 'GL_Line_ID', width: 12.86 },
  { header: 'Entity_Code', width: 13.43 },
  { header: 'Ledger_Code', width: 15.0 },
  { header: 'Fiscal_Year', width: 12.71 },
  { header: 'Period', width: 7.71 },
  { header: 'Posting_Date', width: 14.71 },
  { header: 'Document_Date', width: 17.43 },
  { header: 'Transaction_ID', width: 16.43 },
  { header: 'Journal_ID', width: 11.86 },
  { header: 'Journal_Line_No', width: 18.43 },
  { header: 'Document_Type', width: 17.71 },
  { header: 'Document_No', width: 15.43 },
  { header: 'Batch_ID', width: 10.14 },
  { header: 'Source_System', width: 16.86 },
  { header: 'Source_Module', width: 17.29 },
  { header: 'Source_Record_ID', width: 20.43 },
  { header: 'Account_Code', width: 15.86 },
  { header: 'Account_Name', width: 16.14 },
  { header: 'Account_Class', width: 16.0 },
  { header: 'D_C', width: 5.29 },
  { header: 'Debit_Trans', width: 13.57 },
  { header: 'Credit_Trans', width: 14.43 },
  { header: 'Amount_Signed_Trans', width: 24.29 },
  { header: 'Transaction_Currency', width: 23.86 },
  { header: 'FX_Rate', width: 9.57 },
  { header: 'Functional_Currency', width: 22.43 },
  { header: 'Debit_Functional', width: 18.43 },
  { header: 'Credit_Functional', width: 19.29 },
  { header: 'Amount_Signed_Functional', width: 29.14 },
  { header: 'Description', width: 12.71 },
  { header: 'Seg_Business_Unit', width: 21.14 },
  { header: 'Seg_Branch', width: 13.57 },
  { header: 'Seg_Department', width: 18.29 },
  { header: 'Seg_Cost_Center', width: 19.29 },
  { header: 'Seg_Project', width: 13.57 },
  { header: 'Seg_Product_Service', width: 23.57 },
  { header: 'Seg_Channel', width: 14.71 },
  { header: 'Seg_Location', width: 15.0 },
  { header: 'Seg_Funding_Program', width: 24.57 },
  { header: 'Seg_Intercompany', width: 20.0 },
  { header: 'Seg_Custom', width: 14.0 },
  { header: 'Counterparty_ID', width: 17.86 },
  { header: 'Counterparty_Type', width: 20.71 },
  { header: 'Invoice_No', width: 12.43 },
  { header: 'PO_No', width: 8.14 },
  { header: 'SO_No', width: 10.0 },
  { header: 'Tax_Code', width: 11.29 },
  { header: 'Tax_Base', width: 11.0 },
  { header: 'Tax_Amount', width: 13.57 },
  { header: 'Tax_Invoice_No', width: 17.57 },
  { header: 'Withholding_Slip_No', width: 22.43 },
  { header: 'Related_Party_Flag', width: 20.86 },
  { header: 'Recon_No', width: 11.57 },
  { header: 'Recon_Type', width: 13.86 },
  { header: 'Recon_Group_Key', width: 20.43 },
  { header: 'Recon_Status', width: 15.29 },
  { header: 'Recon_Date', width: 13.57 },
  { header: 'Bank_Account_Code', width: 22.43 },
  { header: 'Bank_Statement_Ref', width: 22.71 },
  { header: 'Payment_Reference', width: 21.86 },
  { header: 'Matching_Key', width: 15.43 },
  { header: 'Match_Method', width: 16.14 },
  { header: 'Match_Confidence_Pct', width: 24.86 },
  { header: 'Unmatched_Reason', width: 21.71 },
  { header: 'Posting_Status', width: 16.43 },
  { header: 'Manual_JE_Flag', width: 17.71 },
  { header: 'Reversal_Flag', width: 15.71 },
  { header: 'Reversal_Of_Journal_ID', width: 26.29 },
  { header: 'Prepared_By', width: 14.29 },
  { header: 'Approved_By', width: 14.71 },
  { header: 'Approval_Date', width: 16.0 },
  { header: 'Source_Document_ID', width: 23.43 },
  { header: 'Attachment_Link', width: 18.0 },
  { header: 'Created_At', width: 12.29 },
  { header: 'Created_By', width: 12.86 },
  { header: 'Data_Quality_Status', width: 21.71 },
  { header: 'Lock_Flag', width: 11.29 },
  { header: 'AI_Category', width: 13.29 },
  { header: 'AI_Risk_Score', width: 15.71 },
  { header: 'AI_Anomaly_Flag', width: 18.0 },
  { header: 'AI_Anomaly_Reason', width: 21.57 },
  { header: 'AI_Suggested_Recon_No', width: 27.29 },
  { header: 'AI_Confidence_Pct', width: 20.43 },
  { header: 'AI_Model_Version', width: 19.43 },
  { header: 'AI_Processed_At', width: 18.29 },
];

export const GL_TEMPLATE_HEADERS = GL_COLUMNS.map((c) => c.header);

// Kolom "kuning" (derived) — bisa dihitung sistem, sesuai catatan template
const YELLOW_DERIVED_COLUMNS = new Set([
  'Fiscal_Year', 'Period', 'D_C', 'Amount_Signed_Trans',
  'Debit_Functional', 'Credit_Functional', 'Amount_Signed_Functional',
  'Recon_Group_Key', 'Matching_Key',
]);

// Kolom "ungu" (hasil AI)
const PURPLE_AI_COLUMNS = new Set([
  'AI_Category', 'AI_Risk_Score', 'AI_Anomaly_Flag', 'AI_Anomaly_Reason',
  'AI_Suggested_Recon_No', 'AI_Confidence_Pct', 'AI_Model_Version', 'AI_Processed_At',
]);

// Kolom tanggal (yyyy-mm-dd) & timestamp (yyyy-mm-dd hh:mm)
const DATE_COLUMNS = new Set(['Posting_Date', 'Document_Date', 'Recon_Date']);
const DATETIME_COLUMNS = new Set(['Approval_Date', 'Created_At', 'AI_Processed_At']);

// Kolom angka desimal (#,##0.00)
const DECIMAL_COLUMNS = new Set([
  'Debit_Trans', 'Credit_Trans', 'Amount_Signed_Trans', 'FX_Rate',
  'Debit_Functional', 'Credit_Functional', 'Amount_Signed_Functional',
  'Tax_Base', 'Tax_Amount', 'Match_Confidence_Pct',
  'AI_Risk_Score', 'AI_Confidence_Pct',
]);

const FONT_NAME = 'Carlito';
const YELLOW_FILL = 'FFFFF2CC';
const PURPLE_FILL = 'FFF4ECF7';
const TITLE_FILL = 'FF17365D';
const NOTE_FILL = 'FFD9EAF7';
const HEADER_FILL = 'FF1F4E78';

// [DIUBAH] Nama fungsi lama dipertahankan sebagai dispatcher publik —
// sekarang menentukan template mana yang dipakai berdasarkan CLIENT AKTIF
// (activeClientId/activeClientName, dikirim dari TransactionsContent.tsx —
// yang mengambilnya dari dropdown "Switch Company" di Topbar lewat
// useActiveClient()). Client yang tidak terdaftar di exportTemplateRegistry
// otomatis tetap pakai template GL default di bawah ini (perilaku lama,
// tidak berubah untuk client lain).
export async function exportTransactionsToExcel(
  transactions: Transaction[],
  clientId?: string | null,
  clientName?: string | null
): Promise<void> {
  const { blob, fileName } = await buildTransactionsExcelBlob(transactions, clientId, clientName);
  downloadBlob(blob, fileName);
}

// [BARU] Versi "build saja" dari dispatcher di atas — dipakai untuk
// menyiapkan file di background (lihat TransactionsContent.tsx: dipanggil
// tiap kali `filtered`/client aktif berubah, termasuk begitu tabel diganti
// oleh hasil import) supaya begitu tombol Export ditekan, blob-nya sudah
// jadi dan tinggal di-download instan lewat downloadBlob() tanpa build ulang.
export async function buildTransactionsExcelBlob(
  transactions: Transaction[],
  clientId?: string | null,
  clientName?: string | null
): Promise<ExcelExportResult> {
  const templateKey = resolveExportTemplate(clientId, clientName);
  if (templateKey === 'sau_cash_journal') {
    // [FIX] Sebelumnya `clientName` (string) yang dikirim sebagai argumen
    // PERTAMA ke buildSauCashJournalWorkbookBlob(), padahal parameter
    // pertama fungsi itu adalah `transactions: Transaction[]` — akibatnya
    // sheet GL selalu kosong (transaksi asli tidak pernah sampai ke
    // template) walau mapping 8 kolomnya sendiri sudah benar. Sekarang
    // `transactions` (SELURUH baris yang sedang tampil/difilter di halaman
    // Transaksi, tanpa batas jumlah) dikirim di posisi yang benar,
    // `clientName` di posisi kedua sesuai signature aslinya.
    return buildSauCashJournalWorkbookBlob(transactions, clientName);
  }
  return buildGlDefaultWorkbookBlob(transactions);
}

async function buildGlDefaultWorkbookBlob(transactions: Transaction[]): Promise<ExcelExportResult> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');

  sheet.columns = GL_COLUMNS.map((c) => ({ width: c.width }));

  const lastColLetter = sheet.getColumn(GL_COLUMNS.length).letter;

  // Baris 1 — judul
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = GL_TITLE;
  titleCell.font = { name: FONT_NAME, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
  titleCell.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 20.25;

  // Baris 2 — catatan
  sheet.mergeCells(`A2:${lastColLetter}2`);
  const noteCell = sheet.getCell('A2');
  noteCell.value = GL_NOTE;
  noteCell.font = { name: FONT_NAME, italic: true, size: 11, color: { argb: 'FF1F2937' } };
  noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NOTE_FILL } };
  noteCell.alignment = { wrapText: true };

  // Baris 3 — kosong (spacer, sama seperti template)

  // Baris 4 — header kolom
  const headerRow = sheet.getRow(4);
  GL_COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: FONT_NAME, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // Baris 5-54 — 50 baris kosong dengan format & warna kolom derived/AI
  // sudah disiapkan (sama seperti template), tapi belum ada nilai data.
  for (let r = 5; r <= 54; r++) {
    const row = sheet.getRow(r);
    GL_COLUMNS.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      cell.font = { name: FONT_NAME, size: 11 };

      if (YELLOW_DERIVED_COLUMNS.has(col.header)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_FILL } };
      } else if (PURPLE_AI_COLUMNS.has(col.header)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_FILL } };
      }

      if (DATE_COLUMNS.has(col.header)) {
        cell.numFmt = 'yyyy-mm-dd';
      } else if (DATETIME_COLUMNS.has(col.header)) {
        cell.numFmt = 'yyyy-mm-dd hh:mm';
      } else if (DECIMAL_COLUMNS.has(col.header)) {
        cell.numFmt = '#,##0.00';
      }
    });
  }

  const fileName = `GL-Transaksi-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { blob, fileName };
}