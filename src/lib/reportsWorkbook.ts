// Download "Financial Statement" workbook dari halaman Reports (src/app/reports).
//
// TAHAP 1 (sekarang): SEMUA 6 sheet sudah terisi template dari workbook acuan:
// COA (reportsCoaSheet.ts), GL (reportsGlSheet.ts), ADJ/TB/BS/PNL CF
// (reportsSheetSpec.ts + reportsSheets/*.json). GL & ADJ hanya struktur + contoh baris;
// data transaksi diisi nanti dari aplikasi. Urutan & nama sheet mengikuti workbook
// acuan (PT_BIT_WS_Financial_Statement). Isi tiap sheet diisi bertahap nanti:
// tambahkan fungsi pengisi di REPORT_SHEETS (properti `fill`).

import type { Worksheet } from 'exceljs';
import { fillCoaSheet, markMissingCategory, FIRST_DATA_ROW as COA_FIRST_DATA_ROW } from './reportsCoaSheet';
import { fillGlSheet, FIRST_DATA_ROW as GL_FIRST_DATA_ROW } from './reportsGlSheet';
import { fillAdjSheet } from './reportsAdjSheet';
import { fetchReportsSourceData, coaSheetRows, glSheetRows, adjSheetRows, type ReportsSourceData } from './reportsData';
import { addStatusColumn } from './reportsStatus';
import { describeAiResult, markAiCell, REPORTS_AI_ENABLED, runReportsAiFill, type AiProgress, type ReportsAiResult } from './reportsAiFill';
import { colLetter, fillTbSheet, relabelTbHeaders, type TbSheetResult } from './reportsTbSheet';
import { fetchSaldoRk, fillSaldoRk, TB_COL_SALDO_RK, TB_COL_SELISIH_RK, type SaldoRkData } from './reportsSaldoRk';
import { fillBsSheet, fillPnlSheet } from './reportsStatementSheets';
import { applySheetSpec, dropSpecCells, dropSpecRows, normalizeSpecCf, permuteSpecColumns, shiftSpecColumns, shiftSpecRows, type SheetSpec } from './reportsSheetSpec';
import {
  boxBorders, HEADER_FILL_ARGB, normalizeFonts, polishHeaderRows, TITLE_BLOCK_ROWS, unfreezeTopRows, writeTitleBlock,
  type SheetTitle,
} from './reportsFormat';

export interface ReportSheetDef {
  /** Nama tab di Excel (maks 31 karakter, sama dengan workbook acuan). */
  name: string;
  /** Report di aplikasi yang jadi sumber isi sheet ini (info saja, untuk tahap isi data). */
  source: string;
  /** Nomor baris header yang dirapikan (lebar kolom, rata tengah, wrap). */
  headerRows: number[];
  /** Kolom terakhir tabel utama (nomor 1-based). Dipakai untuk merapikan sel header kosong di dalam tabel; isi di kanannya tetap dibawa. */
  lastCol: number;
  /** Blok judul di atas sheet: nama PT, judul, periode, dan deskripsi (bahasa Indonesia). */
  title: SheetTitle;
  /** Pengisi isi sheet. Kosong = sheet dibiarkan kosong. */
  fill?: (ws: Worksheet, ctx: ReportsWorkbookContext) => void | Promise<void>;
}

export interface ReportsWorkbookContext {
  companyName: string;
  /** Teks periode untuk ditampilkan, mis. "Jan – Oct 2026". */
  periodLabel: string;
  /** Tahun buku dan bulan akhir (1-12); periode = 1 Januari s.d. akhir bulan tsb. */
  year: number;
  endMonth: number;
  managementClientId: string | null;
  /** Data asli (COA, GL, TB; semua status jurnal). Kosong = template tanpa isi. Diisi oleh downloadReportsWorkbook. */
  data?: ReportsSourceData;
  /** Saldo akhir rekening koran per akun bank (dari Bank & Cash, tanpa AI). Diisi oleh downloadReportsWorkbook; null/kosong = kolom Saldo RK dibiarkan kosong. */
  saldoRk?: SaldoRkData | null;
  /** Hasil Isi AI (Supplier/Customer GL, Notes TB, catatan selisih PNL CF). Kosong = tidak ada yang diisi AI. Diisi oleh downloadReportsWorkbook. */
  ai?: ReportsAiResult;
  /** Jumlah sel yang diisi AI per sheet (GL / COA / TB); diisi oleh pengisi sheet, dipakai untuk pesan ringkasan. */
  aiFilled?: Record<string, number>;
  /** Laporan progres Isi AI untuk tombol Download (opsional). */
  onProgress?: (p: AiProgress) => void;
  /** Peta baris sheet TB, diisi oleh sheet TB dan dipakai BS & PNL CF (urutan sheet: TB lebih dulu). */
  tbLayout?: TbSheetResult;
}

// Sheet berbasis spesifikasi JSON (dimuat saat dibutuhkan agar bundle tetap ringan).
const fromSpec =
  (load: () => Promise<{ default: unknown }>, transform?: (s: SheetSpec) => SheetSpec): ReportSheetDef['fill'] =>
  async (ws, ctx) => {
    const raw = (await load()).default as SheetSpec;
    const spec = transform ? transform(raw) : raw;
    applySheetSpec(ws, spec, { companyName: ctx.companyName });
  };

// Baris header terakhir TB (baris 5-6); semua baris di bawahnya dikosongkan.
const TB_HEADER_LAST_ROW = 6;

/** Buang semua isi di bawah baris `lastRow` (sel, merge, tinggi baris) dan pangkas rentang filternya. */
function dropRowsBelow(spec: SheetSpec, lastRow: number): SheetSpec {
  const rowsOf = (ref: string) => [...ref.matchAll(/\d+/g)].map(m => Number(m[0]));
  return {
    ...spec,
    cells: spec.cells.filter(([r]) => r <= lastRow),
    merges: spec.merges.filter(m => Math.max(...rowsOf(m)) <= lastRow),
    rows: Object.fromEntries(Object.entries(spec.rows).filter(([r]) => Number(r) <= lastRow)),
    filter: spec.filter ? spec.filter.replace(/(\d+)$/, String(lastRow)) : null,
  };
}

// TEMPLATE KOSONG: tiap sheet hanya membawa judul + header; seluruh isi tabel (akun, angka, rumus, catatan) dikosongkan
// dan nanti diisi dari data aplikasi. Aturan highlight (angka negatif, kode akun ganda) berlaku sampai baris ini.
const CF_LAST_ROW = 5000;

// Semua baris template (header, tabel) digeser ke bawah sebanyak baris blok judul. Nomor baris di bawah = nomor baris acuan + T.
const T = TITLE_BLOCK_ROWS;

/** kode akun (kode sistem maupun kode tampilan) -> Category COA (account_sub). */
function categoryLookup(ctx: ReportsWorkbookContext): (code: string) => string | null | undefined {
  const cat = new Map<string, string | null>();
  for (const a of ctx.data?.coa ?? []) {
    cat.set(String(a.acc_no), a.account_sub);
    if (a.source_acc_no) cat.set(String(a.source_acc_no), a.account_sub);
  }
  // Hanya Category resmi dari COA (tidak ada pengisian AI/tebakan di mana pun): BS dan arus kas memakainya untuk
  // menentukan akun kas/bank, aset tetap, dan utang jangka panjang. Category kosong ditandai di sheet COA, bukan ditebak.
  return code => cat.get(code);
}

export const REPORT_SHEETS: ReportSheetDef[] = [
  { name: 'COA', source: 'Chart of Accounts', headerRows: [2 + T], lastCol: 5,
    title: {
      title: 'DAFTAR AKUN (CHART OF ACCOUNTS)',
      description: 'Daftar seluruh akun perusahaan beserta nomor, nama, tipe, dan kategorinya. Nomor dan nama akun di sheet ini menjadi acuan penamaan akun di sheet GL, ADJ, TB, BS, dan PNL CF.',
      period: 'year', firstCol: 1, lastCol: 5,
    },
    fill: (ws, ctx) => {
      const d = ctx.data ? coaSheetRows(ctx.data) : null;
      fillCoaSheet(ws, d?.rows ?? [], T, d?.statuses ?? []);
      // Category kosong tidak diisi AI (Neraca dan Arus Kas memakainya): hanya diberi penanda kuning dan catatan sel.
      for (const m of d?.missingCategory ?? []) markMissingCategory(ws, COA_FIRST_DATA_ROW + T + m.idx, m.impactsFs);
      if (ctx.aiFilled && d?.missingCategory.length) {
        ctx.aiFilled.CatKosong = d.missingCategory.length;
        ctx.aiFilled.CatKosongFs = d.missingCategory.filter(m => m.impactsFs).length;
      }
    } },
  { name: 'GL', source: 'General Ledger', headerRows: [3 + T], lastCol: 15,
    title: {
      title: 'BUKU BESAR (GENERAL LEDGER)',
      description: 'Rincian transaksi jurnal perusahaan per akun dan per bank selama periode laporan, berisi tanggal, keterangan, pihak terkait, debit, kredit, dan saldo. Sheet ini menjadi sumber data untuk Neraca Saldo (TB).',
      period: 'range', firstCol: 1, lastCol: 11,
    },
    fill: (ws, ctx) => {
      const d = ctx.data ? glSheetRows(ctx.data, ctx.ai) : null;
      fillGlSheet(ws, d?.rows ?? [], T, d?.statuses ?? []);
      // Supplier/Customer hasil AI atau pola data (kolom H) diberi latar biru muda.
      for (const idx of d?.autoParty ?? []) markAiCell(ws, GL_FIRST_DATA_ROW + T + idx, 8);
      if (ctx.aiFilled && d?.autoParty.length) ctx.aiFilled.GL = d.autoParty.length;
    } },
  { name: 'ADJ', source: 'Adjustment', headerRows: [3 + T], lastCol: 16,
    title: {
      title: 'JURNAL PENYESUAIAN (ADJUSTMENT)',
      description: 'Jurnal penyesuaian (adjusting entry, misalnya penyesuaian pajak) yang ditambahkan ke Neraca Saldo. Jurnal ini hanya muncul di sheet ini, tidak di GL. Setiap jurnal memuat akun, tanggal, keterangan, serta nilai debit dan kredit.',
      period: 'range', firstCol: 1, lastCol: 11,
    },
    fill: async (ws, ctx) => {
      // Judul lama (A2 "ADJUSTMENT 2026") diganti blok judul baru; sisanya (ringkasan baris 2) ikut bergeser.
      await fromSpec(() => import('./reportsSheets/adj.json'), s => shiftSpecRows(dropSpecCells(dropRowsBelow(s, 3), [[2, 1]]), T))!(ws, ctx);
      // Baris ringkasan di atas header: kotak hitam penuh hanya sampai kolom Balance (K), seperti GL.
      boxBorders(ws, 2 + T, 2 + T, 1, 11);
      // Header (A3:P3): bergaris hitam penuh, termasuk kolom Check Weda. Baris data dikosongkan.
      boxBorders(ws, 3 + T, 3 + T, 1, 16);
      // Baris jurnal penyesuaian (semua status) + kolom Q "Status Transaksi" (status asli per jurnal).
      // Baris ini TIDAK ada di sheet GL (dibuang di glSheetRows), jadi kolom ADJ di TB tidak menghitung dua kali.
      const d = ctx.data ? adjSheetRows(ctx.data) : null;
      fillAdjSheet(ws, d?.rows ?? [], T, d?.statuses ?? []);
    } },
  { name: 'TB', source: 'Trial Balance', headerRows: [5 + T, 6 + T], lastCol: 77,
    title: {
      title: 'NERACA SALDO (TRIAL BALANCE)',
      description: 'Saldo setiap akun per bulan: saldo awal, mutasi debit dan kredit, penyesuaian, serta saldo setelah penyesuaian, ditambah akumulasi tahun berjalan (YTD). Sheet ini menjadi sumber data untuk Neraca (BS) dan Laba Rugi (PNL CF).',
      period: 'range', firstCol: 1, lastCol: 12,
    },
    fill: async (ws, ctx) => {
      // Kolom kosong BZ-CB (78-80) dibuang: blok Check s.d. Notes digeser 3 kolom ke kiri supaya menempel di YTD 2026.
      await fromSpec(() => import('./reportsSheets/tb.json'), s =>
        // Blok Saldo RK (CA-CB) dipindah ke paling kanan, sesudah Notes: urutan jadi Check, check weda, Notes, Saldo RK.
        // Highlight merah muda (angka negatif, kode akun ganda) berlaku di seluruh tabel, bukan di sel tertentu.
        // Judul lama (A2 nama PT, A3 "TRIAL BALANCE") diganti blok judul baru; baris bantu bulan ikut bergeser.
        normalizeSpecCf(
          shiftSpecRows(
            // Baris 1 (penghitung urutan kolom) dibuang: tidak dipakai rumus mana pun. Baris 4 (nomor bulan) DIPERTAHANKAN
            // karena dirujuk rumus SUMIFS di tabel TB ($E$4 / $F$4 = bulan yang difilter dari GL).
            dropSpecRows(dropSpecCells(
              dropRowsBelow(permuteSpecColumns(shiftSpecColumns(s, 81, 3), { 79: 81, 80: 82, 81: 79, 82: 80 }), TB_HEADER_LAST_ROW),
              [[2, 1], [3, 1]],
            ), [1]),
            T,
          ),
          { negative: `J${7 + T}:CD${CF_LAST_ROW}`, duplicates: `A${7 + T}:A${CF_LAST_ROW}` },
        ))!(ws, ctx);
      // Blok kolom kerja di kanan YTD: Check (BZ, TRUE/FALSE), check weda (CA), Notes (CB), Saldo RK (CC-CD).
      // Semuanya diberi header 2 baris (seperti header TB lain) dan kotak hitam dari header sampai baris terakhir tabel.
      const FIRST_CHECK_COL = 78;
      const LAST_CHECK_COL = 82;
      ws.getCell(5 + T, FIRST_CHECK_COL).value = 'Check';
      for (let col = FIRST_CHECK_COL; col <= LAST_CHECK_COL; col++) {
        for (const r of [5 + T, 6 + T]) {
          const c = ws.getCell(r, col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
          c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
        }
      }
      // Judul kolom Saldo RK / Selisih ditulis eksplisit (sebelumnya CD kosong karena tidak ada di template).
      ws.getCell(5 + T, TB_COL_SALDO_RK).value = 'Saldo RK';
      ws.getCell(5 + T, TB_COL_SELISIH_RK).value = 'Selisih';
      boxBorders(ws, 5 + T, 6 + T, FIRST_CHECK_COL, LAST_CHECK_COL);
      // Header 2 baris yang baris bawahnya kosong (hanya tombol filter) digabung vertikal jadi 1 sel header tebal;
      // yang punya sub-header (ADJ -> DEBIT/KREDIT) tetap 2 tingkat.
      for (let col = 1; col <= LAST_CHECK_COL; col++) {
        const top = ws.getCell(5 + T, col);
        const bottom = ws.getCell(6 + T, col);
        const bottomEmpty = bottom.value === null || bottom.value === undefined || bottom.value === '';
        if (top.isMerged || bottom.isMerged || !bottomEmpty) continue;
        ws.mergeCells(5 + T, col, 6 + T, col);
      }
      if ((ws.getColumn(FIRST_CHECK_COL).width ?? 0) < 12) ws.getColumn(FIRST_CHECK_COL).width = 12;
      // Judul kolom ber-tahun/bulan (acuan hardcode 2026) mengikuti tahun terpilih.
      relabelTbHeaders(ws, 5 + T, ctx.year);
      // Baris akun + saldo awal + rumus ke GL/ADJ (hanya kalau data aplikasi tersedia; template kosong = header saja).
      const tbRows = fillTbSheet(ws, ctx.data?.tb, T);
      ctx.tbLayout = tbRows;
      // Kolom Notes (kolom ke-80): dugaan penyebab akun yang janggal dari Isi AI, selalu berawalan "Dugaan AI:" dan berlatar biru muda.
      const NOTES_COL = 80;
      let tbNotes = 0;
      for (const ref of tbRows.refs) {
        const note = ref.kind === 'account' ? ctx.ai?.catatan.get(ref.code) : undefined;
        if (!note) continue;
        const cell = ws.getCell(ref.row, NOTES_COL);
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') continue; // jangan timpa isi yang sudah ada
        cell.value = note;
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
        markAiCell(ws, ref.row, NOTES_COL);
        tbNotes += 1;
      }
      if (ctx.aiFilled && tbNotes) ctx.aiFilled.TB = tbNotes;
      // Kolom Saldo RK (CC) + selisih terhadap saldo TB (CD): dari rekening koran yang sudah tersimpan di Bank & Cash.
      const rk = fillSaldoRk(ws, tbRows.refs, ctx.saldoRk, ctx.endMonth);
      if (ctx.aiFilled && rk.compared) ctx.aiFilled.RK = rk.compared;
      if (ctx.aiFilled && rk.flagged) ctx.aiFilled.RKFlag = rk.flagged;
      if (rk.compared || rk.flagged) {
        if ((ws.getColumn(TB_COL_SALDO_RK).width ?? 0) < 18) ws.getColumn(TB_COL_SALDO_RK).width = 18;
        if ((ws.getColumn(TB_COL_SELISIH_RK).width ?? 0) < 34) ws.getColumn(TB_COL_SELISIH_RK).width = 34; // muat penanda teks
      }
      if ((ws.getColumn(NOTES_COL).width ?? 0) < 40) ws.getColumn(NOTES_COL).width = 40;
      // Kolom CE "Status Transaksi" di kanan Saldo RK (header 2 baris digabung vertikal): status per akun dari Trial Balance.
      addStatusColumn(ws, {
        col: LAST_CHECK_COL + 1, headerRow: 5 + T, headerRowEnd: 6 + T,
        firstDataRow: tbRows.firstDataRow, values: tbRows.statuses,
      });
    } },
  { name: 'BS', source: 'Balance Sheet', headerRows: [4 + T], lastCol: 19,
    title: {
      title: 'LAPORAN POSISI KEUANGAN (NERACA)',
      description: 'Posisi aset, liabilitas, dan ekuitas perusahaan per bulan beserta akumulasi tahun berjalan (YTD), diambil dari Neraca Saldo (TB).',
      period: 'asof', firstCol: 2, lastCol: 13,
    },
    fill: async (ws, ctx) => {
      // Catatan manual di luar tabel (kolom T dst. dan di bawah baris 57) tidak dibawa; filter dipangkas ke A4:S57.
      // Judul lama (B1 nama PT, B2 "BALANCE SHEET", B3 periode) diganti blok judul baru.
      await fromSpec(() => import('./reportsSheets/bs.json'), s => normalizeSpecCf(shiftSpecRows(dropSpecCells(dropRowsBelow({
        ...s,
        cells: s.cells.filter(([, c]) => c <= 19),
        filter: s.filter ? s.filter.replace(/^([A-Z]+\d+:)[A-Z]+(\d+)$/, '$1S$2') : null,
      }, 4), [[1, 2], [2, 2], [3, 2]]), T), { negative: `D${5 + T}:R${CF_LAST_ROW}`, duplicates: `B${5 + T}:B${CF_LAST_ROW}` }))!(ws, ctx);
      // Kolom "X" (S) diganti jadi "Check" dan dibuat tabel seperti kolom Check di TB:
      // header hijau tua (diatur polishHeaderRows) + kotak hitam dari header sampai baris terakhir tabel (57), isi rata tengah.
      const CHECK_COL = 19;
      ws.getCell(4 + T, CHECK_COL).value = 'Check';
      boxBorders(ws, 4 + T, 4 + T, CHECK_COL, CHECK_COL);
      if ((ws.getColumn(CHECK_COL).width ?? 0) < 12) ws.getColumn(CHECK_COL).width = 12;
      // Baris akun + total, dirujuk ke sheet TB (rantai GL -> TB -> BS). Aset tetap dipisah lewat Category COA.
      const bs = fillBsSheet(ws, ctx.tbLayout, categoryLookup(ctx), T, ctx.year);
      // Kolom T "Status Transaksi" di kanan Check: status akun yang dirujuk di TB.
      addStatusColumn(ws, { col: CHECK_COL + 1, headerRow: 4 + T, firstDataRow: bs.firstDataRow, values: bs.statuses });
    } },
  { name: 'PNL CF', source: 'Profit & Loss + Cash Flow', headerRows: [5 + T], lastCol: 22,
    title: {
      title: 'LAPORAN LABA RUGI DAN ARUS KAS',
      description: 'Pendapatan, beban, dan laba rugi perusahaan per bulan beserta akumulasi tahun berjalan (YTD), ditambah arus kas (metode tidak langsung) dari perubahan saldo akun neraca, diambil dari Neraca Saldo (TB).',
      period: 'range', firstCol: 5, lastCol: 16,
    },
    fill: async (ws, ctx) => {
      // Semua isi di luar tabel (kolom W dst. = kolom kerja YTD/selisih/catatan, dan baris di bawah 118) tidak dibawa;
      // filter dipangkas ke E5:V118 dan aturan highlight untuk kolom yang dibuang ikut dihapus.
      // Judul lama (E1 nama PT, E2 "PROFIT AND LOSS", B3/E3/E4 periode) diganti blok judul baru.
      await fromSpec(() => import('./reportsSheets/pnlcf.json'), s => normalizeSpecCf(shiftSpecRows(dropSpecCells(dropRowsBelow({
        ...s,
        cells: s.cells.filter(([, c]) => c <= 22),
        filter: s.filter ? s.filter.replace(/^([A-Z]+\d+:)[A-Z]+(\d+)$/, '$1V$2') : null,
      }, 5), [[1, 5], [2, 5], [3, 2], [3, 5], [4, 5]]), T), { negative: `G${6 + T}:U${CF_LAST_ROW}`, duplicates: `E${6 + T}:E${CF_LAST_ROW}` }))!(ws, ctx);
      // Kolom tanpa judul di kanan YTD 2026 (V, TRUE/FALSE) diberi judul "Check" dan dibuat tabel seperti Check di TB/BS:
      // header hijau tua (diatur polishHeaderRows) + kotak hitam dari header sampai baris terakhir tabel (118), isi rata tengah.
      const CHECK_COL = 22;
      ws.getCell(5 + T, CHECK_COL).value = 'Check';
      boxBorders(ws, 5 + T, 5 + T, CHECK_COL, CHECK_COL);
      if ((ws.getColumn(CHECK_COL).width ?? 0) < 12) ws.getColumn(CHECK_COL).width = 12;
      // Baris akun + subtotal + PROFIT/(LOSS), dirujuk ke sheet TB; baris selisih terhadap TB di bawahnya.
      const pnl = fillPnlSheet(ws, ctx.data?.tb, ctx.tbLayout, T, ctx.year, categoryLookup(ctx));
      // Kolom W "Status Transaksi" di kanan Check: status akun yang dirujuk di TB.
      addStatusColumn(ws, { col: CHECK_COL + 1, headerRow: 5 + T, firstDataRow: pnl.firstDataRow, values: pnl.statuses });
      // Kolom X "Notes": catatan AI untuk 2 baris SELISIH. Berupa rumus: catatan HANYA tampil kalau selisih di baris itu tidak nol
      // (nilai selisih baru diketahui saat Excel menghitung), jadi tidak ada catatan menyesatkan saat selisihnya 0.
      const sel = pnl.selisih;
      if (sel && ctx.ai) {
        const NOTE_COL = CHECK_COL + 2;
        const from = colLetter(sel.firstCol);
        const to = colLetter(sel.lastCol);
        let pnlNotes = 0;
        for (const [jenis, row] of [['profit', sel.profit], ['kas', sel.kas]] as const) {
          const note = ctx.ai.catatanPnl.get(jenis);
          if (!note || !row) continue;
          const literal = note.replace(/\s+/g, ' ').slice(0, 200).replace(/"/g, '""'); // literal rumus Excel maks. 255 karakter
          const cell = ws.getCell(row, NOTE_COL);
          cell.value = { formula: `IF(SUMPRODUCT(ABS(${from}${row}:${to}${row}))>0.5,"${literal}","")` };
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
          markAiCell(ws, row, NOTE_COL);
          pnlNotes += 1;
        }
        if (pnlNotes) {
          const head = ws.getCell(5 + T, NOTE_COL);
          head.value = 'Notes';
          head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
          head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
          if ((ws.getColumn(NOTE_COL).width ?? 0) < 60) ws.getColumn(NOTE_COL).width = 60;
          if (ctx.aiFilled) ctx.aiFilled.PNL = pnlNotes;
        }
      }
    } },
];

// Catatan di blok judul tiap sheet: sumber data & arti kolom Status Transaksi.
const STATUS_NOTE = ' Data diambil dari Journal Preview (semua status, tidak hanya Posted); kolom Status Transaksi menunjukkan status transaksinya di aplikasi.';

function namaFileAman(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'Company';
}

export async function buildReportsWorkbook(ctx: ReportsWorkbookContext) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'zafeb';
  wb.created = new Date();
  // Angka TB/BS/PNL CF berupa rumus: paksa Excel menghitung ulang saat file dibuka (exceljs tidak menyimpan hasil hitungan).
  wb.calcProperties = { fullCalcOnLoad: true };

  for (const def of REPORT_SHEETS) {
    const ws = wb.addWorksheet(def.name);
    if (def.fill) await def.fill(ws, ctx);
    polishHeaderRows(ws, def.headerRows, def.lastCol);
    unfreezeTopRows(ws); // tidak ada baris atas yang terkunci, seperti GL
    writeTitleBlock(ws, ctx, { ...def.title, description: def.title.description + STATUS_NOTE }); // nama PT, judul, periode, dan deskripsi (bahasa Indonesia) di atas sheet
    normalizeFonts(ws, TITLE_BLOCK_ROWS); // satu jenis & ukuran font di semua sheet (blok judul tetap pakai ukurannya sendiri)
  }
  return wb;
}

/**
 * Unduh workbook. Mengembalikan pesan ringkasan Isi AI (sel yang terisi / yang tidak sempat terisi) atau null.
 * Isi AI TIDAK PERNAH menggagalkan download: kalau gagal, file tetap terunduh dengan sel kosong.
 */
export async function downloadReportsWorkbook(ctx: ReportsWorkbookContext): Promise<string | null> {
  // Semua sheet membaca Journal Preview (semua status), bukan hanya posted.
  const data = await fetchReportsSourceData(ctx);
  let ai: ReportsAiResult | undefined;
  if (REPORTS_AI_ENABLED && ctx.managementClientId) {
    try {
      ai = await runReportsAiFill(data, { managementClientId: ctx.managementClientId, onProgress: ctx.onProgress });
    } catch {
      ai = undefined; // runReportsAiFill tidak melempar error, ini hanya pengaman tambahan
    }
  }
  const aiFilled: Record<string, number> = {};
  const saldoRk = await fetchSaldoRk(ctx); // tanpa AI; gagal = kolom Saldo RK kosong
  const wb = await buildReportsWorkbook({ ...ctx, data, ai, aiFilled, saldoRk });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Financial_Statement_${namaFileAman(ctx.companyName)}_${ctx.year}${String(ctx.endMonth).padStart(2, '0')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const notice = describeAiResult(ai, aiFilled);
  const rk = aiFilled.RK ? `Saldo RK compared for ${aiFilled.RK} bank account(s) from uploaded bank statements.` : null;
  const rkFlag = aiFilled.RKFlag
    ? `${aiFilled.RKFlag} bank account(s) were NOT compared (foreign currency, statement not reaching period end, or balance unreadable): see the yellow cells in the TB sheet.`
    : null;
  const catKosong = aiFilled.CatKosong
    ? `${aiFilled.CatKosong} active account(s) have no Category in the COA${aiFilled.CatKosongFs ? ` (${aiFilled.CatKosongFs} asset/liability account(s) can shift the Balance Sheet / Cash Flow split)` : ''}: `
      + 'see the yellow cells in the COA sheet, fill them in Chart of Accounts, then download again.'
    : null;
  return [notice, rk, rkFlag, catKosong].filter(Boolean).join(' ') || null;
}