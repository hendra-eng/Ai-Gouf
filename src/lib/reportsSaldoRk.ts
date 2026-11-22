// Kolom "Saldo RK" di sheet TB (Download Excel, halaman Reports) -- TANPA AI.
//
// Saldo akhir rekening koran sudah tersimpan saat rekening koran diunggah di Bank & Cash, jadi cukup dibaca dari backend
// (GET /api/v1/reports/bank-statement-balances; backend/modules/financial_statements/saldo_rk_v1.py).
// Kolom CC (81) = saldo rekening koran per akun bank, kolom CD (82) = selisih terhadap saldo TB akhir periode (kolom "balance after adjustment" bulan terpilih).
//
// Selisih HANYA dihitung (rumus Excel) bila backend memberi status "ok". Selain itu kolom CD berisi penanda teks + sel
// berwarna kuning + catatan sel yang menjelaskan alasannya, supaya tidak ada selisih besar yang menyesatkan:
//   valas                  rekening valas: Saldo RK dalam mata uang rekening, TB dalam rupiah -> tidak bisa dikurangkan.
//   belum_akhir_periode    rekening koran terbaru berakhir jauh sebelum akhir periode (mis. baru bulan lalu yang diunggah).
//   saldo_tidak_terbaca    file rekening koran tersimpan, tetapi saldo akhirnya kosong.
//   periode_tidak_terbaca  saldo ada, tetapi tanggal akhir rekening koran kosong.
// Akun tanpa rekening koran dibiarkan kosong (selisihnya juga kosong). Kegagalan membaca TIDAK menggagalkan download.
//
// Akun sisi KREDIT (mis. kartu kredit / cerukan yang dicatat sebagai kewajiban): tanda saldo di rekening koran berbeda-beda
// antar bank dan tidak disimpan sistem, jadi tanda tidak ditebak. Yang dibandingkan hanya besarnya: ABS(TB) - ABS(RK).

import type { Worksheet } from 'exceljs';
import { colLetter, DEBIT_GROUPS, TB_COL_YTD, tbColAfter, type TbRowRef } from './reportsTbSheet';
import type { ReportsSourceQuery } from './reportsData';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const SALDO_RK_URL = `${API_BASE_URL}/api/v1/reports/bank-statement-balances`;
const REQUEST_TIMEOUT_MS = 20_000;

export const TB_COL_SALDO_RK = 81; // CC
export const TB_COL_SELISIH_RK = 82; // CD

const NUM_ACCT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
/** Latar kuning: sel Saldo RK / Selisih yang TIDAK dibandingkan dan perlu dilihat reviewer. */
export const SEL_RK_PERINGATAN = 'FFFFEB9C';

export type SaldoRkStatus = 'ok' | 'belum_akhir_periode' | 'saldo_tidak_terbaca' | 'periode_tidak_terbaca' | 'valas';

export interface SaldoRkAccount {
  kode: string;
  kode_sistem: string;
  nama: string;
  /** null = file rekening koran ada, tetapi saldo akhirnya tidak terbaca. */
  saldo: number | null;
  periode_akhir: string; // YYYY-MM-DD, '' = tidak terbaca
  nama_file: string;
  /** Kode mata uang rekening valas (mis. 'USD'); '' = rupiah. */
  mata_uang: string;
  status: SaldoRkStatus;
  selisih_hari: number | null;
}

export interface SaldoRkData { asOf: string; toleranceDays: number; accounts: SaldoRkAccount[] }

export interface SaldoRkFillResult {
  /** Akun yang selisihnya dihitung. */
  compared: number;
  /** Akun yang punya rekening koran tetapi selisihnya TIDAK dihitung dan diberi penanda kuning (valas, telat, saldo/tanggal tidak terbaca). */
  flagged: number;
}

/** Ambil saldo rekening koran per akun bank. Tidak pernah melempar error: gagal = null (kolom dibiarkan kosong). */
export async function fetchSaldoRk(q: ReportsSourceQuery): Promise<SaldoRkData | null> {
  if (!q.managementClientId) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ management_client_id: q.managementClientId, year: String(q.year), end_month: String(q.endMonth) });
    const res = await fetch(`${SALDO_RK_URL}?${params}`, { signal: ctrl.signal, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== 'success') return null;
    return {
      asOf: String(json.data?.as_of ?? ''),
      toleranceDays: Number(json.data?.tolerance_days ?? 0),
      accounts: (json.data?.accounts ?? []) as SaldoRkAccount[],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' ('' tetap ''). */
function fmtTgl(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Format angka rekening valas: kode mata uang di depan angka, mis. "USD" #,##0.00. Kode dibersihkan dari karakter selain huruf. */
function valasFormat(mataUang: string): string {
  const kode = mataUang.replace(/[^A-Za-z]/g, '').toUpperCase();
  return `"${kode}" #,##0.00;[Red]"${kode}" -#,##0.00`;
}

function labelPeringatan(a: SaldoRkAccount): string {
  switch (a.status) {
    case 'valas': return `Valas ${a.mata_uang}, tidak dibandingkan`;
    case 'belum_akhir_periode': return `RK s.d. ${fmtTgl(a.periode_akhir) || '?'}, belum akhir periode`;
    case 'saldo_tidak_terbaca': return 'Saldo RK tidak terbaca';
    case 'periode_tidak_terbaca': return 'Tanggal RK tidak terbaca';
    default: return '';
  }
}

function catatanPeringatan(a: SaldoRkAccount, asOf: string): string {
  const akhir = fmtTgl(asOf) || 'akhir periode laporan';
  const tgl = fmtTgl(a.periode_akhir);
  switch (a.status) {
    case 'valas':
      return `Rekening valas (${a.mata_uang}). Saldo RK dalam ${a.mata_uang}, sedangkan saldo TB dalam rupiah, jadi keduanya tidak bisa dikurangkan langsung. `
        + 'Selisih sengaja tidak dihitung. Bandingkan dengan saldo valas buku di modul FX Bank.';
    case 'belum_akhir_periode':
      return `Rekening koran terbaru berakhir ${tgl || '(tanggal tidak terbaca)'}${a.selisih_hari != null ? `, ${a.selisih_hari} hari sebelum ${akhir}` : ''}. `
        + 'Selisih sengaja tidak dihitung supaya tidak tampak besar hanya karena rekening koran bulan berikutnya belum diunggah. '
        + `Unggah rekening koran sampai ${akhir} di Bank & Cash, lalu unduh ulang.`;
    case 'saldo_tidak_terbaca':
      return 'File rekening koran sudah tersimpan, tetapi saldo akhirnya tidak terbaca (kosong). Saldo bulan yang lebih lama sengaja tidak dipakai karena bukan saldo per akhir periode. '
        + 'Cek file ini di Bank & Cash.';
    case 'periode_tidak_terbaca':
      return 'Saldo rekening koran terbaca, tetapi tanggal akhir periodenya kosong, jadi tidak bisa dipastikan sampai kapan. Selisih tidak dihitung. Cek file ini di Bank & Cash.';
    default:
      return '';
  }
}

function tandaiPeringatan(ws: Worksheet, row: number, col: number): void {
  ws.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEL_RK_PERINGATAN } };
}

/** Tulis Saldo RK + selisih (atau penanda) ke baris akun TB yang punya rekening koran. */
export function fillSaldoRk(ws: Worksheet, refs: TbRowRef[], data: SaldoRkData | null | undefined, endMonth?: number): SaldoRkFillResult {
  const hasil: SaldoRkFillResult = { compared: 0, flagged: 0 };
  if (!data?.accounts.length) return hasil;
  const byCode = new Map<string, SaldoRkAccount>();
  for (const a of data.accounts) {
    if (a.kode) byCode.set(a.kode, a);
    if (a.kode_sistem) byCode.set(a.kode_sistem, a);
  }
  // Saldo TB yang dibandingkan = "balance after adjustment" pada BULAN AKHIR periode (bukan kolom YTD/Desember): akun bank adalah akun
  // neraca dan rekening koran berakhir di akhir periode terpilih. Tanpa endMonth (pemanggil lama) tetap memakai kolom YTD.
  const ytd = colLetter(endMonth && endMonth >= 1 && endMonth <= 12 ? tbColAfter(endMonth) : TB_COL_YTD);
  const rk = colLetter(TB_COL_SALDO_RK);
  for (const ref of refs) {
    if (ref.kind !== 'account') continue;
    const acc = byCode.get(ref.code);
    if (!acc) continue;
    const status: SaldoRkStatus = acc.status ?? 'ok'; // backend lama (tanpa status) = perilaku lama
    const ada = typeof acc.saldo === 'number' && Number.isFinite(acc.saldo);
    const saldo = ws.getCell(ref.row, TB_COL_SALDO_RK);
    const selisih = ws.getCell(ref.row, TB_COL_SELISIH_RK);

    if (ada) {
      saldo.value = acc.saldo as number;
      saldo.numFmt = status === 'valas' && acc.mata_uang ? valasFormat(acc.mata_uang) : NUM_ACCT;
    }
    // Sumber disimpan sebagai catatan sel supaya reviewer tahu rekening koran mana dan sampai tanggal berapa.
    saldo.note = `Rekening koran: ${acc.nama_file || '-'}\n${acc.periode_akhir ? `Saldo akhir per ${fmtTgl(acc.periode_akhir)}` : 'Tanggal saldo akhir tidak terbaca'}`;

    if (status === 'ok' && ada) {
      const sisiDebit = DEBIT_GROUPS.has(ref.group);
      selisih.value = { formula: sisiDebit ? `${ytd}${ref.row}-${rk}${ref.row}` : `ABS(${ytd}${ref.row})-ABS(${rk}${ref.row})` };
      selisih.numFmt = NUM_ACCT;
      if (!sisiDebit) {
        selisih.note = 'Akun sisi kredit (mis. kartu kredit / cerukan). Tanda saldo di rekening koran berbeda-beda antar bank, '
          + 'jadi yang dibandingkan hanya besarnya (tanda + / - diabaikan).';
      }
      hasil.compared += 1;
      continue;
    }

    // Tidak dibandingkan: penanda teks + warna kuning + catatan alasan.
    selisih.value = labelPeringatan({ ...acc, status: status === 'ok' ? 'saldo_tidak_terbaca' : status });
    selisih.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
    selisih.note = catatanPeringatan({ ...acc, status: status === 'ok' ? 'saldo_tidak_terbaca' : status }, data.asOf);
    tandaiPeringatan(ws, ref.row, TB_COL_SALDO_RK);
    tandaiPeringatan(ws, ref.row, TB_COL_SELISIH_RK);
    hasil.flagged += 1;
  }
  return hasil;
}
