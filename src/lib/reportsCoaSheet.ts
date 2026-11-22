// Isi sheet "COA" untuk workbook Financial Statement (halaman Reports).
// Disalin dari workbook acuan PT_BIT_WS_Financial_Statement, sheet COA (A2:E147):
// 5 kolom, header baris 2 (merah, teks putih tebal), data mulai baris 3, freeze di A3,
// autofilter A2:E147, kolom Notes = rumus COUNTIF ke sheet BS, dan highlight merah
// untuk Account No yang duplikat.
//
// Baris = [Account No, Account Name, Account Type, Category, Notes berumus?, tebal?]
// `null` = baris kosong pemisah (sama seperti acuan).

import type { Worksheet } from 'exceljs';
import { REPORT_FONT_NAME, REPORT_FONT_SIZE } from './reportsFormat';
import { addStatusColumn } from './reportsStatus';

export type CoaRow = [number | string, string, string, string | null, boolean, boolean] | null;

export const COA_HEADERS = ['Account No', 'Account Name', 'Account Type', 'Category', 'Notes'] as const;

export const COA_ROWS: CoaRow[] = [
  [1000, "ASSETS", "Asset", null, false, true],
  [1100, "Cash and Cash Equivalents", "Asset", "Current Asset", true, false],
  [1101, "Cash on Hand", "Asset", "Current Asset", true, false],
  [1102, "Bank - BCA", "Asset", "Current Asset", true, false],
  [1103, "Bank - BNI", "Asset", "Current Asset", true, false],
  [1104, "MIT", "Asset", "Current Asset", true, false],
  [1105, "Xendit", "Asset", "Current Asset", true, false],
  [1200, "Accounts Receivable", "Asset", "Current Asset", true, false],
  [1201, "Customer Receivable", "Asset", "Current Asset", true, false],
  [1202, "Partner / Agent Receivable", "Asset", "Current Asset", true, false],
  [1300, "Other Current Assets", "Asset", "Current Asset", true, false],
  [1301, "Prepaid Expense", "Asset", "Current Asset", true, false],
  [1302, "Tax Credit / Tax Prepayment", "Asset", "Current Asset", true, false],
  [1303, "Tax Credit - Art.22", "Asset", "Current Asset", true, false],
  [1304, "Employee Advance", "Asset", "Current Asset", true, false],
  [1305, "Shareholder Receivable", "Asset", "Other Current Asset", true, false],
  [1500, "FIXED ASSETS", "Asset", "Fixed Asset", true, false],
  [1501, "Office Equipment", "Asset", "Fixed Asset", true, false],
  [1502, "Computer and IT Equipment", "Asset", "Fixed Asset", true, false],
  [1503, "Accumulated Depreciation", "Contra Asset", "Fixed Asset", true, false],
  null,
  [2000, "LIABILITIES", "Liability", null, false, true],
  [2100, "Accounts Payable", "Liability", "Current Liability", true, false],
  [2101, "Vendor Payable", "Liability", "Current Liability", true, false],
  [2200, "Accrued Expense", "Liability", "Current Liability", true, false],
  [2201, "Accrued Tour Cost", "Liability", "Current Liability", true, false],
  [2202, "Accrued Salary & Benefit", "Liability", "Current Liability", true, false],
  [2300, "Tax Payable", "Liability", "Current Liability", true, false],
  [2301, "Income Tax Payable", "Liability", "Current Liability", true, false],
  [2302, "Withholding Tax Payable", "Liability", "Current Liability", true, false],
  [2303, "BPJS Payable", "Liability", "Current Liability", true, false],
  [2304, "Customer Deposit", "Liability", "Current Liability", true, false],
  [2305, "Tax Payable - Art.21", "Liability", "Current Liability", true, false],
  [2306, "Tax Payable - Art.23", "Liability", "Current Liability", true, false],
  [2307, "Tax Payable - Art.15", "Liability", "Current Liability", true, false],
  [2308, "VAT Payable", "Liability", "Current Liability", true, false],
  [2309, "Tax Payable - Unification", "Liability", "Current Liability", true, false],
  [2310, "Final Tax Payable", "Liability", "Current Liability", true, false],
  null,
  null,
  [3000, "EQUITY", "Equity", "Equity", false, true],
  [3100, "Share Capital", "Equity", "Equity", true, false],
  [3200, "Retained Earnings", "Equity", "Equity", true, false],
  [3300, "Current Year Profit / Loss", "Equity", "Equity", true, false],
  null,
  [4000, "REVENUE", "Revenue", null, false, true],
  [4100, "Tour Revenue", "Revenue", "Operating Revenue", false, false],
  [4110, "Tour Revenue - Paket Tour Besakih", "Revenue", "Operating Revenue", false, false],
  [4111, "Tour Revenue - Paket East Tour", "Revenue", "Operating Revenue", false, false],
  [4112, "Tour Revenue - Paket Tour Custom", "Revenue", "Operating Revenue", false, false],
  [4113, "Tour Revenue - Paket Tour Sekumpul", "Revenue", "Operating Revenue", false, false],
  [4114, "Tour Revenue - Paket Tour Ubud", "Revenue", "Operating Revenue", false, false],
  [4115, "Tour Revenue - Paket Tour Pantai", "Revenue", "Operating Revenue", false, false],
  [4116, "Tour Revenue - Paket Tour Nusa Penida", "Revenue", "Operating Revenue", false, false],
  [4117, "Tour Revenue - Paket Tour Jeep", "Revenue", "Operating Revenue", false, false],
  [4118, "Tour Revenue - Paket Tour Uluwatu", "Revenue", "Operating Revenue", false, false],
  [4119, "Tour Revenue - Paket Tour Lumba-Lumba", "Revenue", "Operating Revenue", false, false],
  [4120, "Tour Revenue - Paket North Tour", "Revenue", "Operating Revenue", false, false],
  [4121, "Tour Revenue - Paket Tour Pura", "Revenue", "Operating Revenue", false, false],
  [4122, "Tour Revenue - Paket Tour Kawah Ijen", "Revenue", "Operating Revenue", false, false],
  [4123, "Tour Revenue - Paket Helicopter Tour", "Revenue", "Operating Revenue", false, false],
  [4124, "Tour Revenue - Paket Wisata Komodo", "Revenue", "Operating Revenue", false, false],
  [4125, "Tour Revenue - Dolphins", "Revenue", "Operating Revenue", false, false],
  [4126, "Tour Revenue - Batur", "Revenue", "Operating Revenue", false, false],
  [4127, "Tour Revenue - Agung", "Revenue", "Operating Revenue", false, false],
  [4128, "Tour Revenue - Mix Tour", "Revenue", "Operating Revenue", false, false],
  [4129, "Tour Revenue - Other Tour Package", "Revenue", "Operating Revenue", false, false],
  [4130, "Tour Revenue - Diving, Snorkling, & Surfing", "Revenue", "Operating Revenue", false, false],
  [4131, "Tour Revenue - Insta Tour", "Revenue", "Operating Revenue", false, false],
  [4132, "Tour Revenue - Rafting", "Revenue", "Operating Revenue", false, false],
  [4133, "Tour Revenue - Paragliding", "Revenue", "Operating Revenue", false, false],
  [4134, "Tour Revenue - Bali Tour", "Revenue", "Operating Revenue", false, false],
  [4135, "Tour Revenue - Cash", "Revenue", "Operating Revenue", false, false],
  [4136, "Tour Revenue - Xendit", "Revenue", "Operating Revenue", false, false],
  [4137, "Tour Revenue - BCA", "Revenue", "Operating Revenue", false, false],
  [4200, "Other Income", "Revenue", "Other Revenue", false, false],
  [4201, "Interest Income (Bank Interest)", "Revenue", "Other Revenue", false, false],
  [4202, "Foreign Exchange Gain", "Revenue", "Other Revenue", false, false],
  null,
  [5000, "COST OF TOUR SERVICES", "Cost", "Cost of Revenue", false, true],
  [5100, "Direct Tour Cost", "Cost", "Cost of Revenue", false, false],
  [5101, "Transportation Cost", "Cost", "Cost of Revenue", false, false],
  [5102, "Driver Vendor Cost", "Cost", "Cost of Revenue", false, false],
  [5103, "Entrance Fee Cost", "Cost", "Cost of Revenue", false, false],
  [5104, "Activity Vendor Cost", "Cost", "Cost of Revenue", false, false],
  [5105, "Helicopter Charter Cost", "Cost", "Cost of Revenue", false, false],
  [5200, "Tour Guide Cost", "Cost", "Cost of Revenue", false, false],
  [5201, "Freelance Guide Fee", "Cost", "Cost of Revenue", false, false],
  [5202, "Guide Incentive", "Cost", "Cost of Revenue", false, false],
  [5210, "Cost Of Tour - Paket Tour Besakih", "Cost", "Cost of Revenue", false, false],
  [5211, "Cost Of Tour - Paket East Tour", "Cost", "Cost of Revenue", false, false],
  [5212, "Cost Of Tour - Paket Tour Custom", "Cost", "Cost of Revenue", false, false],
  [5213, "Cost Of Tour - Paket Tour Sekumpul", "Cost", "Cost of Revenue", false, false],
  [5214, "Cost Of Tour - Paket Tour Ubud", "Cost", "Cost of Revenue", false, false],
  [5215, "Cost Of Tour - Paket Tour Pantai", "Cost", "Cost of Revenue", false, false],
  [5216, "Cost Of Tour - Paket Tour Nusa Penida", "Cost", "Cost of Revenue", false, false],
  [5217, "Cost Of Tour - Paket Tour Jeep", "Cost", "Cost of Revenue", false, false],
  [5218, "Cost Of Tour - Paket Tour Uluwatu", "Cost", "Cost of Revenue", false, false],
  [5219, "Cost Of Tour - Paket Tour Lumba-Lumba", "Cost", "Cost of Revenue", false, false],
  [5220, "Cost Of Tour - Paket North Tour", "Cost", "Cost of Revenue", false, false],
  [5221, "Cost Of Tour - Paket Tour Pura", "Cost", "Cost of Revenue", false, false],
  [5222, "Cost Of Tour - Paket Tour Kawah Ijen", "Cost", "Cost of Revenue", false, false],
  [5223, "Cost Of Tour - Paket Helicopter Tour", "Cost", "Cost of Revenue", false, false],
  [5224, "Cost Of Tour - Paket Wisata Komodo", "Cost", "Cost of Revenue", false, false],
  [5225, "Cost Of Tour - Dolphins", "Cost", "Cost of Revenue", false, false],
  [5226, "Cost Of Tour - Batur", "Cost", "Cost of Revenue", false, false],
  [5227, "Cost Of Tour - Agung", "Cost", "Cost of Revenue", false, false],
  [5228, "Cost Of Tour - Mix Tour", "Cost", "Cost of Revenue", false, false],
  [5229, "Cost Of Tour - Other Tour Package", "Cost", "Cost of Revenue", false, false],
  [5230, "Cost Of Tour - Diving, Snorkling, & Surfing", "Cost", "Cost of Revenue", false, false],
  [5231, "Cost Of Tour - Insta Tour", "Cost", "Cost of Revenue", false, false],
  [5232, "Cost Of Tour - Rafting", "Cost", "Cost of Revenue", false, false],
  [5233, "Cost Of Tour - Paragliding", "Cost", "Cost of Revenue", false, false],
  [5234, "Cost Of Tour - Bali Tour", "Cost", "Cost of Revenue", false, false],
  [5235, "Cost Of Tour - Cash", "Cost", "Cost of Revenue", false, false],
  [5236, "Cost Of Tour - Xendit", "Cost", "Cost of Revenue", false, false],
  [5237, "Cost Of Tour - BCA", "Cost", "Cost of Revenue", false, false],
  null,
  [6000, "OPERATING EXPENSES", "Expense", "Operating Expense", false, false],
  [6100, "Marketing Expense", "Expense", "Operating Expense", false, false],
  [6101, "Google Ads Expense", "Expense", "Marketing", false, false],
  [6102, "Website & Promotion Expense", "Expense", "Marketing", false, false],
  [6200, "Salary & Employee Benefit Expense", "Expense", "Operating Expense", false, false],
  [6201, "Director Salary", "Expense", "Payroll", false, false],
  [6202, "Commissioner Salary", "Expense", "Payroll", false, false],
  [6203, "Employee Salary", "Expense", "Payroll", false, false],
  [6204, "BPJS & Employee Benefit Expense", "Expense", "Payroll", false, false],
  [6300, "Payment Fee", "Expense", "Operating Expense", false, false],
  [6301, "Bank Administration Fee", "Expense", "Bank Charges", false, false],
  [6302, "Payment Gateway Fee (Xendit)", "Expense", "Bank Charges", false, false],
  [6400, "Tax & Compliance Expense", "Expense", "Operating Expense", false, false],
  [6401, "Tax & Professional Service Fee", "Expense", "Professional Fee", false, false],
  [6402, "Income Tax Expense", "Expense", "Tax", false, false],
  [6403, "Withholding Tax Expense", "Expense", "Tax", false, false],
  [6404, "Final Tax Expense", "Expense", "Tax", false, false],
  [6500, "Office Administration Expense", "Expense", "Operating Expense", false, false],
  [6501, "Office Supplies", "Expense", "Administration", false, false],
  [6502, "Software Subscription", "Expense", "Administration", false, false],
  [6503, "Telephone & Internet Expense", "Expense", "Administration", false, false],
  [6504, "Professional Fee", "Expense", "Administration", false, false],
  [6600, "Other Operating Expense", "Expense", "Operating Expense", false, false],
  [6601, "Reimbursement Expense", "Expense", "Operating Expense", false, false],
  [6602, "Miscellaneous Expense", "Expense", "Other Expense", false, false],
  [6603, "Donation Expense", "Expense", "Other Expense", false, false],
  [6604, "Foreign Exchange Loss", "Expense", "Other Expense", false, false],
];

const HEADER_FILL = 'FFC00000';
const FIRST_DATA_ROW = 3;

/** `rows` = baris akun dari aplikasi; default kosong (template hanya header). COA_ROWS di atas hanya contoh acuan. */
export function fillCoaSheet(ws: Worksheet, rows: CoaRow[] = [], top = 0, statuses: string[] = []): void {
  // `top` = jumlah baris judul di atas sheet; header & data digeser sebesar ini.
  const HDR = 2 + top;
  const FIRST = FIRST_DATA_ROW + top;
  // Lebar kolom (A-D sama dengan acuan; E default).
  ws.columns = [
    { width: 11.14 },
    { width: 56.43 },
    { width: 12.86 },
    { width: 18.43 },
    { width: 9 },
  ];

  // Header di baris 2 (baris 1 kosong seperti acuan).
  const headerRow = ws.getRow(HDR);
  COA_HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  // Data.
  rows.forEach((row, idx) => {
    if (!row) return;
    const r = FIRST + idx;
    const [no, name, type, category, hasFormula, bold] = row;
    const excelRow = ws.getRow(r);
    excelRow.getCell(1).value = no;
    excelRow.getCell(2).value = name;
    excelRow.getCell(3).value = type;
    if (category) excelRow.getCell(4).value = category;
    if (hasFormula) {
      excelRow.getCell(5).value = { formula: `COUNTIF(BS!$C:$C,COA!$B${r})` };
    }
    if (bold) {
      // Kolom A-C selalu tebal; Category (D) ikut tebal bila ada isinya.
      for (let c = 1; c <= (category ? 4 : 3); c++) {
        excelRow.getCell(c).font = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE, bold: true };
      }
    }
  });

  const lastRow = Math.max(FIRST + rows.length - 1, HDR);

  // Freeze header + autofilter.
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: HDR, topLeftCell: `A${FIRST}`, activeCell: `A${FIRST}` }];
  ws.autoFilter = `A${HDR}:E${lastRow}`;

  // Kolom F "Status Transaksi": status transaksi tiap akun di aplikasi (Posted / Belum posted / Tidak ada transaksi).
  addStatusColumn(ws, { col: 6, headerRow: HDR, firstDataRow: FIRST, values: statuses });

  // Tab warna biru muda seperti acuan.
  ws.properties.tabColor = { argb: 'FF00B0F0' };

  // Highlight Account No duplikat (merah muda / teks merah tua) seperti acuan.
  ws.addConditionalFormatting({
    ref: `A${FIRST}:A1048576`,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`AND(A${FIRST}<>"",COUNTIF($A$${FIRST}:$A$1048576,A${FIRST})>1)`],
        style: {
          font: { color: { argb: 'FF9C0006' } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
        },
      },
    ],
  });
}