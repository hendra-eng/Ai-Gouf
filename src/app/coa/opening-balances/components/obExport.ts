'use client';

// Export tab Detail saldo awal ke Excel: kolom sama dengan template import COA
// (opening_balance_import_v1.KOLOM_COA), tapi polos -- tanpa warna, formula,
// dropdown, dan hanya 1 sheet. Dikelompokkan per klasifikasi (urutan
// ACCOUNT_CLASSIFICATIONS), di dalam grup urut kode akun ascending.

import ExcelJS from 'exceljs';
import { ACCOUNT_CLASSIFICATIONS, type CoaAccount } from '@/lib/coaStore';
import { kodeAkun } from '@/lib/accountCode';
import { formatAmount, type OpeningBalanceDetail } from '@/lib/openingBalanceStore';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { labelClassification } from '../../components/coaTheme';
import { branchLabel } from './obUi';

const KOLOM: [string, number][] = [
  ['Source Account Code', 18], ['Source Account Name', 40], ['Source Classification', 20],
  ['Suggested ZAFEB Account Code', 18], ['Suggested ZAFEB Account Name', 40], ['Standard Account Code', 38],
  ['Opening Debit', 18], ['Opening Credit', 18], ['Balance Date', 14], ['Currency', 10],
  ['Branch', 14], ['Department', 14], ['Project', 14], ['Notes', 40],
];
const FMT_ANGKA = '#,##0.00;-#,##0.00';
const urutKode = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface ObExportInput {
  ob: OpeningBalanceDetail;
  clientName: string;
  accounts: CoaAccount[];
  /** Nilai debit/kredit per coa_id (sudah angka). */
  saldo: (coaId: string) => { debit: number; credit: number };
  /** Akun Current Year Earnings (otomatis, tidak dijurnal) + nilainya. */
  isLabaBerjalan: (a: CoaAccount) => boolean;
  laba: number;
}

export async function exportOpeningBalanceXlsx({ ob, clientName, accounts, saldo, isLabaBerjalan, laba }: ObExportInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Opening Balance');
  const tanggal = new Date(`${ob.as_of_date.slice(0, 10)}T00:00:00Z`);

  ws.addRow([`Opening Balance · ${clientName} · FY ${ob.fiscal_year} · ${branchLabel(ob.branch)}`]).font = { bold: true, size: 13 };
  ws.addRow([`As of ${ob.as_of_date.slice(0, 10)} · Status ${ob.status}${ob.journal ? ` · Journal ${ob.journal.je_number}` : ''}`]);
  ws.addRow([]);
  const head = ws.addRow(KOLOM.map(([h]) => h));
  head.font = { bold: true };
  head.eachCell(c => { c.border = { bottom: { style: 'thin' } }; });

  const grup = new Map<string, CoaAccount[]>();
  for (const a of accounts) grup.set(a.account_classification, [...(grup.get(a.account_classification) ?? []), a]);
  const urutanGrup = [...ACCOUNT_CLASSIFICATIONS.filter(k => grup.has(k)), ...[...grup.keys()].filter(k => !(ACCOUNT_CLASSIFICATIONS as readonly string[]).includes(k))];

  let totD = 0, totK = 0;
  for (const kls of urutanGrup) {
    const daftar = [...grup.get(kls)!].sort((x, y) => urutKode.compare(kodeAkun(x.acc_no), kodeAkun(y.acc_no)));
    ws.addRow([labelClassification(kls)]).font = { bold: true };
    let subD = 0, subK = 0;
    for (const a of daftar) {
      const laBer = isLabaBerjalan(a);
      const { debit, credit } = laBer ? { debit: 0, credit: 0 } : saldo(a.id);
      subD += debit; subK += credit;
      const catatan = laBer
        ? `Auto (not journaled): ${laba < 0 ? `(${formatAmount(Math.abs(laba))})` : formatAmount(laba)}`
        : !a.is_active ? 'Inactive account — keep the balance at 0.' : '';
      const r = ws.addRow([
        kodeAkun(a.acc_no), a.account_name, a.account_classification ?? '',
        String(a.acc_no), a.account_name, a.standard_account_code ?? '',
        debit, credit, tanggal, 'IDR', '', '', '', catatan,
      ]);
      r.getCell(9).numFmt = 'dd-mmm-yyyy';
    }
    totD += subD; totK += subK;
    const sub = ws.addRow([`Total ${labelClassification(kls)}`, '', '', '', '', '', subD, subK]);
    sub.font = { bold: true };
    ws.addRow([]);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  ws.addRow(['TOTAL', '', '', '', '', '', r2(totD), r2(totK)]).font = { bold: true };
  ws.addRow(['DIFFERENCE', '', '', '', '', '', r2(totD - totK)]).font = { bold: true };

  KOLOM.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(7).numFmt = FMT_ANGKA;
  ws.getColumn(8).numFmt = FMT_ANGKA;
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  const nama = `Opening_Balance_${(clientName || 'client').replace(/[^\w-]+/g, '_')}_FY${ob.fiscal_year}.xlsx`;
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nama);
}
