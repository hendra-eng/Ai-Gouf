import ExcelJS from 'exceljs';
import type { Transaction } from '../transactionData';
import { downloadBlob, type ExcelExportResult } from './exportExcelShared';

// [BARU] Template export khusus client "PT Sumber Alodie Utama" (SAU), meniru
// PERSIS struktur & styling file contoh user:
// "1_3_SAU_Cash_Receipt_and_Payment_Journal_202607_Mega (3).xlsx"
// (3 sheet: COA, Sheet1, GL — lihat analisis di percakapan).
//
// [DIUBAH — sheet GL sekarang diisi data asli] Mapping final (lihat
// screenshot user) dari `Transaction` (halaman Transaksi) ke kolom GL:
//   TANGGAL          <- date
//   KODE AKUN        <- accountCode
//   AKUN DEKSRIPSI   <- accountName
//   KODE TRANSAKSI   <- jeId
//   DESKRIPSI        <- description
//   DR               <- debit
//   CR               <- credit
//   VOUCHER          <- voucherNo
// Kolom lain (JENIS TRANSAKSI, DEPARTEMEN, NAMA SUPPLIER/CUSTOMER) SENGAJA
// dibiarkan kosong dulu sesuai instruksi user — cuma 8 kolom di atas yang
// ditambahkan tahap ini. Sheet COA & Sheet1 (legend) TETAP kosong/statis
// seperti sebelumnya, belum termasuk cakupan tahap ini.
//
// Penentuan section (BRI/Mandiri/BCA x RECEIVABLE/PAYMENT): transaksi
// dikelompokkan per `jeId` (satu entri jurnal = sepasang leg debit+kredit
// yang berbagi jeId sama). Di tiap grup dicari leg yang akun-nya
// mengandung nama bank (BRI/MANDIRI/BCA) — leg itu menentukan section
// (arah RECEIVABLE kalau leg bank itu DEBIT/uang masuk, PAYMENT kalau
// KREDIT/uang keluar). Baris yang ditulis ke section adalah leg LAWAN
// (akun non-bank di pasangan itu) karena section sudah menyatakan
// bank+arahnya; kalau grup cuma berisi leg bank itu sendiri (tidak ada
// pasangannya), leg itu yang ditulis sebagai fallback. jeId yang leg
// bank-nya bukan BRI/Mandiri/BCA (mis. BNI) atau tidak menyentuh bank sama
// sekali dilewati — di luar cakupan cash journal 3 bank ini.
//
// [PENTING] TIDAK ADA pembatasan jumlah baris di sini — semua transaksi
// yang cocok ditulis apa adanya ke sheet GL, tidak peduli berapa banyak
// (puluhan/ratusan ribu baris sekalipun), sesuai permintaan user.

const FONT_NAME = 'Calibri';
const HEADER_FILL = 'FF00B0F0'; // biru cyan, sama seperti file contoh
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};
const ACCOUNTING_NUMFMT = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
const DATE_NUMFMT = 'mm-dd-yy';

// Urutan section persis seperti file contoh: per bank, Penerimaan dulu baru
// Pembayaran, urutan bank BRI -> Mandiri -> BCA.
const GL_SECTIONS: { label: string; jenisTransaksi: 'RECEIVABLE' | 'PAYMENT'; bank: string }[] = [
  { label: 'JURNAL PENERIMAAN BANK BRI', jenisTransaksi: 'RECEIVABLE', bank: 'BANK BRI' },
  { label: 'JURNAL PEMBAYARAN BANK BRI', jenisTransaksi: 'PAYMENT', bank: 'BANK BRI' },
  { label: 'JURNAL PENERIMAAN BANK MANDIRI', jenisTransaksi: 'RECEIVABLE', bank: 'BANK MANDIRI' },
  { label: 'JURNAL PEMBAYARAN BANK MANDIRI', jenisTransaksi: 'PAYMENT', bank: 'BANK MANDIRI' },
  { label: 'JURNAL PENERIMAAN BANK BCA', jenisTransaksi: 'RECEIVABLE', bank: 'BANK BCA' },
  { label: 'JURNAL PEMBAYARAN BANK BCA', jenisTransaksi: 'PAYMENT', bank: 'BANK BCA' },
];

function buildCoaSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('COA');
  sheet.columns = [
    { width: 19.29 }, // CAT
    { width: 15.43 }, // ACC NO
    { width: 34.0 }, // DESCRIPTION
    { width: 9.0 },
  ];
  const header = sheet.getRow(1);
  ['CAT', 'ACC NO', 'DESCRIPTION'].forEach((text, idx) => {
    const cell = header.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: FONT_NAME, bold: true, size: 11 };
    cell.border = THIN_BORDER; // [FIX] kelewat sebelumnya — file asli punya border tipis di header
    cell.alignment = { horizontal: 'center' }; // [FIX] kelewat sebelumnya — header file asli rata tengah
  });
  // [FIX] Range AutoFilter kelewat sempit sebelumnya (cuma A1:C1) — file
  // asli filter-nya terpasang jauh melebar ke kanan (sampai kolom XEO),
  // makanya ikon dropdown kelihatan muncul di banyak kolom kosong di
  // sebelah kanan DESCRIPTION juga, bukan cuma di 3 kolom berisi data.
  sheet.autoFilter = { from: 'A1', to: 'XEO30' };

  // [KOSONG, tapi sudah ter-styling] Data akun (Chart of Accounts client)
  // belum diisi datanya — tapi baris-baris di bawah header disiapkan dulu
  // dengan border tipis (sama seperti pola GL) supaya siap diisi.
  for (let r = 2; r <= 30; r += 1) {
    const row = sheet.getRow(r);
    for (let col = 1; col <= 3; col += 1) {
      row.getCell(col).font = { name: FONT_NAME, size: 11 };
      row.getCell(col).border = THIN_BORDER;
    }
  }
}

function buildLegendSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('Sheet1');
  // Legend tetap (bukan "data transaksi", ini bagian dari format) — sama
  // seperti file contoh: memetakan nama jurnal per bank ke jenis transaksi.
  sheet.getCell('A2').value = 'JURNAL PENERIMAAN BANK BRI';
  sheet.getCell('B2').value = 'RECEIVABLE';
  sheet.getCell('A3').value = 'JURNAL PEMBAYARAN BANK BRI';
  sheet.getCell('B3').value = 'PAYMENT';
}

/** Perkiraan panjang tampilan angka dengan format akuntansi (pemisah ribuan + 2 desimal, nol jadi "-"). */
function accountingDisplayText(value: number): string {
  if (!value) return '-';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${formatted})` : formatted;
}

// Kolom yang ditampilkan dengan format akuntansi (DR, CR, D/C) — angka
// MENTAH-nya jauh lebih pendek dari tampilan aslinya di Excel (pemisah
// ribuan + 2 desimal), jadi diukur lewat `accountingDisplayText()`, bukan
// `String(angka)` apa adanya. Kolom 14 (VOUCHER) SENGAJA tidak dimasukkan
// walau numFmt-nya sama — isinya teks (nomor voucher), bukan angka.
const ACCOUNTING_FORMATTED_COLUMNS = new Set([11, 12, 13]);

// [DIUBAH] Hitung & terapkan lebar tiap kolom berdasarkan isi TERPANJANG
// yang benar-benar ada di kolom itu (header, label section, data transaksi
// asli, MAUPUN hasil rumus yang KITA SENDIRI tulis) — supaya tidak ada yang
// terpotong/tampil "###" di Excel karena kolom kesempitan. Sebelumnya semua
// sel rumus dilewati total (dianggap tidak bisa diukur karena hasilnya baru
// dihitung Excel saat file dibuka) — sekarang pola rumus yang kita tulis
// sendiri (No/D-C per baris, total SUBTOTAL & selisih di baris 1) dikenali
// dan hasilnya DIHITUNG ULANG di sini dari data mentah yang sudah ada di
// sheet (kolom K/L asli), supaya perkiraan lebarnya akurat. Rumus lain yang
// tidak kita tulis sendiri (mis. XLOOKUP di G1, bergantung sheet COA) tetap
// dilewati seperti sebelumnya karena memang tidak bisa diperkirakan di sini.
function autoFitColumnWidths(sheet: ExcelJS.Worksheet, columnCount: number, lastRow: number) {
  const PADDING = 2; // spasi ekstra kanan-kiri biar teks tidak mepet ke garis kolom
  const MIN_WIDTH = 8; // lebar minimum wajar walau isi kolom kosong/pendek

  // Jumlah asli debit/kredit dihitung dulu dari kolom K/L (nilai asli, bukan
  // rumus) supaya total SUBTOTAL & selisih di baris 1 bisa diperkirakan.
  let sumDebit = 0;
  let sumCredit = 0;
  for (let row = 3; row <= lastRow; row += 1) {
    const debitVal = sheet.getRow(row).getCell(11).value;
    const creditVal = sheet.getRow(row).getCell(12).value;
    if (typeof debitVal === 'number') sumDebit += debitVal;
    if (typeof creditVal === 'number') sumCredit += creditVal;
  }

  for (let col = 1; col <= columnCount; col += 1) {
    let maxLen = MIN_WIDTH;
    for (let row = 1; row <= lastRow; row += 1) {
      const raw = sheet.getRow(row).getCell(col).value;
      if (raw === null || raw === undefined || raw === '') continue;

      let text: string;
      if (typeof raw === 'object' && raw !== null && 'formula' in (raw as unknown as Record<string, unknown>)) {
        const formula = (raw as ExcelJS.CellFormulaValue).formula;
        if (formula === 'ROW()-ROW($A$2)') {
          text = String(row - 2);
        } else if (/^K\d+-L\d+$/.test(formula)) {
          const debitVal = sheet.getRow(row).getCell(11).value;
          const creditVal = sheet.getRow(row).getCell(12).value;
          const diff = (typeof debitVal === 'number' ? debitVal : 0) - (typeof creditVal === 'number' ? creditVal : 0);
          text = accountingDisplayText(diff);
        } else if (formula === 'SUBTOTAL(9,K3:K1048576)') {
          text = accountingDisplayText(sumDebit);
        } else if (formula === 'SUBTOTAL(9,L3:L1048576)') {
          text = accountingDisplayText(sumCredit);
        } else if (formula === 'K1-L1') {
          text = accountingDisplayText(sumDebit - sumCredit);
        } else {
          continue; // rumus lain (mis. XLOOKUP G1) — tidak bisa diperkirakan di sini
        }
      } else if (raw instanceof Date) {
        text = '00-00-00'; // perkiraan panjang tampilan tanggal (format DATE_NUMFMT mm-dd-yy)
      } else if (typeof raw === 'number' && ACCOUNTING_FORMATTED_COLUMNS.has(col)) {
        text = accountingDisplayText(raw);
      } else {
        text = String(raw);
      }
      maxLen = Math.max(maxLen, text.length);
    }
    sheet.getColumn(col).width = maxLen + PADDING;
  }
}

/** Ubah string tanggal "YYYY-MM-DD" jadi Date lokal (hindari geser 1 hari akibat parsing UTC). */
function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = (dateStr || '').split('-').map((v) => parseInt(v, 10));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

const BANK_KEYWORDS = ['BRI', 'MANDIRI', 'BCA'] as const;

/** Cari leg akun BANK (BRI/Mandiri/BCA) di satu grup transaksi (satu jeId) untuk menentukan section-nya. */
function findBankLeg(group: Transaction[]): { tx: Transaction; bank: string; direction: 'RECEIVABLE' | 'PAYMENT' } | null {
  for (const tx of group) {
    const accountName = (tx.accountName || '').toUpperCase();
    for (const keyword of BANK_KEYWORDS) {
      if (accountName.includes(keyword)) {
        return {
          tx,
          bank: `BANK ${keyword}`,
          direction: (tx.debit || 0) > 0 ? 'RECEIVABLE' : 'PAYMENT',
        };
      }
    }
  }
  return null;
}

/** Kelompokkan `transactions` ke tiap section GL (key: "BANK X|RECEIVABLE"/"BANK X|PAYMENT"). */
function groupTransactionsBySection(transactions: Transaction[]): Map<string, Transaction[]> {
  const byJeId = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = tx.jeId || tx.id;
    const arr = byJeId.get(key) || [];
    arr.push(tx);
    byJeId.set(key, arr);
  }

  const sectionMap = new Map<string, Transaction[]>();
  for (const group of byJeId.values()) {
    const bankLeg = findBankLeg(group);
    if (!bankLeg) continue; // bukan transaksi kas BRI/Mandiri/BCA — di luar cakupan template ini

    // Baris yang ditulis adalah leg LAWAN (bukan leg bank itu sendiri) —
    // kalau tidak ada leg lawan (grup cuma 1 baris = leg bank itu sendiri),
    // pakai leg bank itu sebagai fallback supaya transaksinya tetap muncul.
    const counterLegs = group.filter((tx) => tx !== bankLeg.tx);
    const rowsToShow = counterLegs.length > 0 ? counterLegs : [bankLeg.tx];

    const key = `${bankLeg.bank}|${bankLeg.direction}`;
    const arr = sectionMap.get(key) || [];
    arr.push(...rowsToShow);
    sectionMap.set(key, arr);
  }

  // [BARU] Urutkan baris tiap section dari TANGGAL PALING AWAL ke paling
  // akhir (menaik) — sebelumnya ikut urutan asli `transactions` (yang
  // datang dari halaman Transaksi dalam urutan menurun/terbaru dulu), user
  // minta dibalik jadi menaik. `tx.date` berformat "YYYY-MM-DD" jadi bisa
  // dibandingkan langsung sebagai string tanpa perlu di-parse ke Date.
  // Sort JS stabil, jadi baris dengan tanggal SAMA tetap mempertahankan
  // urutan relatifnya satu sama lain (data pasangan debit/kredit yang
  // sama tidak tertukar/rusak) — cuma arah keseluruhannya yang dibalik.
  for (const arr of sectionMap.values()) {
    arr.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }
  return sectionMap;
}

// [BARU] Kolom yang diminta rata TENGAH khusus untuk baris data/section/
// spacer di sheet GL: No (1), TANGGAL (3), VOUCHER (14). Kolom lain tetap
// tanpa alignment eksplisit (default Excel: teks rata kiri, angka rata
// kanan), tidak diubah sesuai permintaan user ("hanya untuk 3 kolom itu").
const CENTER_COLUMNS = new Set([1, 3, 14]);

/** Tulis satu baris di sheet GL — kalau `tx` null, baris kosong ter-format (placeholder section tanpa data). */
function writeGlRow(sheet: ExcelJS.Worksheet, rowNumber: number, tx: Transaction | null) {
  const row = sheet.getRow(rowNumber);
  for (let col = 1; col <= 14; col += 1) {
    const cell = row.getCell(col);
    cell.font = { name: FONT_NAME, size: 11 };
    cell.border = THIN_BORDER;
    if (CENTER_COLUMNS.has(col)) {
      cell.alignment = { horizontal: 'center' };
    }
  }
  row.getCell(1).value = { formula: 'ROW()-ROW($A$2)' } as ExcelJS.CellFormulaValue;
  row.getCell(3).numFmt = DATE_NUMFMT;
  row.getCell(11).numFmt = ACCOUNTING_NUMFMT;
  row.getCell(12).numFmt = ACCOUNTING_NUMFMT;
  row.getCell(13).value = { formula: `K${rowNumber}-L${rowNumber}` } as ExcelJS.CellFormulaValue;
  row.getCell(13).numFmt = ACCOUNTING_NUMFMT;
  row.getCell(14).numFmt = ACCOUNTING_NUMFMT;

  if (tx) {
    // 8 kolom sesuai mapping final (lihat komentar atas file).
    row.getCell(3).value = parseDateOnly(tx.date);
    row.getCell(6).value = tx.accountCode;
    row.getCell(7).value = tx.accountName;
    row.getCell(8).value = tx.jeId;
    row.getCell(10).value = tx.description;
    row.getCell(11).value = tx.debit || 0;
    row.getCell(12).value = tx.credit || 0;
    row.getCell(14).value = tx.voucherNo;
  }
}

function buildGlSheet(workbook: ExcelJS.Workbook, transactions: Transaction[]) {
  const sheet = workbook.addWorksheet('GL');

  // [DIUBAH — sesuai permintaan] Lebar kolom TIDAK lagi angka statis hasil
  // ukur manual dari satu file contoh. Sekarang dihitung otomatis dari isi
  // terpanjang di tiap kolom lewat `autoFitColumnWidths()` di akhir fungsi
  // ini (setelah semua header/section/baris ditulis) — supaya kalau nanti
  // baris data transaksi asli (DESKRIPSI, NAMA SUPPLIER/CUSTOMER biasanya
  // panjang) ditambahkan di tahap mapping, kolomnya otomatis ikut melebar,
  // tidak ada teks yang kepotong, tanpa perlu balik lagi atur angka lebar.

  // Baris 1 — grand total hidup, pakai SUBTOTAL supaya ikut angka yang
  // sedang tampil kalau file ini nanti di-filter (persis file contoh).
  // [FIX] Di file contoh cuma sel G1 (AKUN DEKSRIPSI) yang punya border —
  // K1:N1 (angka total) sengaja TANPA border juga di file aslinya, jadi
  // dibiarkan tanpa border di sini supaya sama persis.
  const totalRow = sheet.getRow(1);
  totalRow.getCell(7).value = { formula: '_xlfn.XLOOKUP(F1,COA!B:B,COA!C:C)' } as ExcelJS.CellFormulaValue;
  totalRow.getCell(7).border = THIN_BORDER;
  totalRow.getCell(11).value = { formula: 'SUBTOTAL(9,K3:K1048576)' } as ExcelJS.CellFormulaValue;
  totalRow.getCell(12).value = { formula: 'SUBTOTAL(9,L3:L1048576)' } as ExcelJS.CellFormulaValue;
  totalRow.getCell(13).value = { formula: 'SUBTOTAL(9,M3:M1048576)' } as ExcelJS.CellFormulaValue;
  totalRow.getCell(14).value = { formula: 'K1-L1' } as ExcelJS.CellFormulaValue;
  [11, 12, 13, 14].forEach((col) => {
    totalRow.getCell(col).numFmt = ACCOUNTING_NUMFMT;
  });

  // Baris 2 — header kolom, fill biru cyan + bold + border di SEMUA sisi &
  // SEMUA kolom (A-N). Alignment per kolom disamakan dengan file contoh:
  // JENIS TRANSAKSI rata kiri, KODE AKUN rata kanan, sisanya rata tengah.
  const headerLabels = [
    'No', '', 'TANGGAL', 'JENIS TRANSAKSI', 'DEPARTEMEN', 'KODE AKUN', 'AKUN DEKSRIPSI',
    'KODE TRANSAKSI', 'NAMA  SUPPLIER/CUSTOMER', 'DESKRIPSI', 'DR', 'CR', 'D/C', 'VOUCHER',
  ];
  const HEADER_ALIGN: Record<number, 'left' | 'center' | 'right'> = { 4: 'left', 6: 'right' }; // kolom 1-based
  const headerRow = sheet.getRow(2);
  headerLabels.forEach((text, idx) => {
    const col = idx + 1;
    const cell = headerRow.getCell(col);
    cell.value = text;
    cell.font = { name: FONT_NAME, bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: HEADER_ALIGN[col] ?? 'center' };
    cell.border = THIN_BORDER;
  });
  headerRow.getCell(3).numFmt = DATE_NUMFMT;
  [11, 12, 13, 14].forEach((col) => {
    headerRow.getCell(col).numFmt = ACCOUNTING_NUMFMT;
  });

  // [FIX] Baris 3 di file contoh BUKAN spacer kosong tanpa format — dia
  // tetap ikut diberi nomor urut (formula "No" yang sama seperti baris
  // data) dan border tipis di semua kolom, cuma belum ada transaksi.
  // Sebelumnya baris ini sama sekali tidak disentuh, jadi border-nya
  // hilang persis di baris ini.
  const spacerRow = sheet.getRow(3);
  for (let col = 1; col <= 14; col += 1) {
    const cell = spacerRow.getCell(col);
    cell.font = { name: FONT_NAME, size: 11 };
    cell.border = THIN_BORDER;
    if (CENTER_COLUMNS.has(col)) {
      cell.alignment = { horizontal: 'center' };
    }
  }
  spacerRow.getCell(1).value = { formula: 'ROW()-ROW($A$2)' } as ExcelJS.CellFormulaValue;

  // Tiap section diberi border penuh di SEMUA kolom (A-N). Di bawah tiap
  // judul section ditulis SEMUA baris transaksi yang cocok untuk section
  // itu (lihat `groupTransactionsBySection` di atas) — [PENTING] TIDAK ADA
  // pembatasan jumlah baris/slice di sini, jadi kalau datanya puluhan ribu
  // baris pun semuanya tetap ditulis. Kalau section tidak punya transaksi
  // yang cocok, tetap ditulis SATU baris kosong ter-format (perilaku lama)
  // supaya strukturnya tetap kelihatan.
  const sectionRowsMap = groupTransactionsBySection(transactions);
  let currentRow = 4;
  for (const section of GL_SECTIONS) {
    // Baris judul section.
    const sectionRow = sheet.getRow(currentRow);
    sectionRow.getCell(2).value = section.label;
    sectionRow.getCell(3).value = section.label;
    for (let col = 1; col <= 14; col += 1) {
      const cell = sectionRow.getCell(col);
      cell.border = THIN_BORDER;
      cell.font = { name: FONT_NAME, bold: col === 2 || col === 3, size: 11 };
      if (CENTER_COLUMNS.has(col)) {
        cell.alignment = { horizontal: 'center' };
      }
    }
    sectionRow.getCell(1).value = { formula: 'ROW()-ROW($A$2)' } as ExcelJS.CellFormulaValue;
    currentRow += 1;

    const rows = sectionRowsMap.get(`${section.bank}|${section.jenisTransaksi}`) || [];
    if (rows.length === 0) {
      // Tidak ada transaksi yang cocok untuk section ini — tetap tampilkan
      // 1 baris kosong ter-format (border, nomor urut, format tanggal &
      // angka) supaya struktur section tetap kelihatan, persis perilaku
      // lama. [PENTING] Kolom G (AKUN DEKSRIPSI) SENGAJA tidak diisi rumus
      // XLOOKUP di sini karena F (Kode Akun) kosong, XLOOKUP akan error.
      writeGlRow(sheet, currentRow, null);
      currentRow += 1;
    } else {
      for (const tx of rows) {
        writeGlRow(sheet, currentRow, tx);
        currentRow += 1;
      }
    }
  }

  // [BARU] Lebar kolom dihitung di sini, SETELAH semua isi (header, label
  // section) ditulis — lihat `autoFitColumnWidths()` di atas.
  autoFitColumnWidths(sheet, 14, currentRow - 1);

  // [DITAMBAH — sesuai permintaan] Ikon panah dropdown filter di header
  // (row 2) ternyata tetap dipakai user (lihat screenshot contoh), jadi
  // dipasang lagi di sini. Range-nya ikut jumlah baris yang sudah terisi
  // (header + seluruh section+baris kosong) — kalau nanti baris data asli
  // hasil mapping transaksi ditambahkan, range ini perlu diperbarui/dibuat
  // dinamis mengikuti baris terakhir yang benar-benar dipakai.
  sheet.autoFilter = { from: 'A2', to: `N${currentRow - 1}` };
}

/**
 * [BARU] Bangun (TANPA download) workbook 3-sheet (COA, Sheet1, GL) format
 * SAU dan kembalikan sebagai blob + nama file. Dipisah dari proses download
 * supaya bisa dipanggil di background untuk pre-build (lihat
 * TransactionsContent.tsx & buildTransactionsExcelBlob di
 * exportTransactionsExcel.ts).
 * Sheet GL diisi SEMUA `transactions` yang diberikan (tanpa batas jumlah
 * baris — lihat `buildGlSheet`); sheet COA & Sheet1 tetap format saja.
 */
export async function buildSauCashJournalWorkbookBlob(
  transactions: Transaction[],
  clientName?: string | null
): Promise<ExcelExportResult> {
  const workbook = new ExcelJS.Workbook();
  buildCoaSheet(workbook);
  buildLegendSheet(workbook);
  buildGlSheet(workbook, transactions);

  // [DIUBAH] Nama file sekarang meniru pola file contoh user:
  // "1. SAU_Cash_Receipt_and_Payment_Journal_<periode YYYYMM>.xlsx"
  // (di file contoh awalnya "1.3_..." — sesuai permintaan, prefiksnya
  // disederhanakan jadi "1." saja). "SAU" dipakai tetap sebagai singkatan
  // nama client di template ini, bukan `clientName` mentah, supaya polanya
  // konsisten dengan file contoh walau nama client di aplikasi beda-beda.
  const now = new Date();
  const periode = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fileName = `1._SAU_Cash_Receipt_and_Payment_Journal_${periode}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { blob, fileName };
}

/**
 * Bangun & LANGSUNG unduh workbook format SAU — dipakai untuk pemanggilan
 * satu-kali (mis. handleBulkExport di TransactionsContent.tsx) yang tidak
 * lewat jalur pre-build background.
 */
export async function exportSauCashJournalTemplate(
  transactions: Transaction[],
  clientName?: string | null
): Promise<void> {
  const { blob, fileName } = await buildSauCashJournalWorkbookBlob(transactions, clientName);
  downloadBlob(blob, fileName);
}