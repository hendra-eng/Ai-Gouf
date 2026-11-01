'use client';

// Kode akun yang DITAMPILKAN di seluruh UI (keputusan bisnis 2026-10-24):
// Source Account Code (kode sistem lama klien, management_client_coa.source_acc_no,
// diisi dari Import Legacy COA / form COA), kosong -> acc_no (kode ZAFEB).
//
// acc_no tetap KUNCI internal: nilai yang dikirim ke backend, posting jurnal,
// mapping, filter & grouping laporan -- JANGAN diganti. Ubah hanya saat
// menampilkan (teks UI, export PDF/Excel/CSV, pesan toast):
//
//   const kode = useKodeAkun();      // di komponen -> ikut re-render saat peta dimuat
//   {kode(line.account_code)}
//   kodeAkun(l.account_code)         // di helper non-React (export, bridge)
//   accNoDariKode(teksUser)          // input/import: kode yang diketik user -> acc_no
//
// Peta dimuat per klien aktif dari GET /api/v1/management/coa/client/{id}/codes
// (termasuk akun terhapus supaya jurnal lama tetap tampil), dan dimuat ulang
// saat COA berubah (COA_CHANGED_EVENT). Kode ZAFEB hanya terlihat di halaman COA.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useActiveClient } from './activeClient';
import { COA_CHANGED_EVENT } from './coaStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

let peta = new Map<string, string>();
let balik = new Map<string, string>();

/** Kode akun untuk ditampilkan. Kode yang tidak dikenal dikembalikan apa adanya. */
export function kodeAkun(accNo: string | null | undefined): string {
  if (accNo === null || accNo === undefined) return '';
  const k = String(accNo).trim();
  return peta.get(k) ?? k;
}

/** Kode yang diketik / diimpor user (kode tampilan ATAU kode ZAFEB) -> acc_no. */
export function accNoDariKode(kode: string | null | undefined): string {
  const k = String(kode ?? '').trim();
  return balik.get(k.toLowerCase()) ?? k;
}

function pasangPeta(rows: { acc_no: string; code: string }[]) {
  peta = new Map(rows.map(r => [r.acc_no, r.code]));
  // Kode ZAFEB tetap diterima sebagai input, kode tampilan menang kalau sama.
  balik = new Map(rows.map(r => [r.acc_no.toLowerCase(), r.acc_no]));
  rows.forEach(r => balik.set(r.code.toLowerCase(), r.acc_no));
}

const VersiCtx = createContext(0);

export function AccountCodeProvider({ children }: { children: ReactNode }) {
  const { activeClientId } = useActiveClient();
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    let batal = false;
    const muat = () => {
      if (!activeClientId) {
        pasangPeta([]);
        setVersi(v => v + 1);
        return;
      }
      fetch(`${API_BASE_URL}/api/v1/management/coa/client/${encodeURIComponent(activeClientId)}/codes`, { cache: 'no-store' })
        .then(r => r.json())
        .then(json => {
          if (batal) return;
          pasangPeta(Array.isArray(json?.data) ? json.data : []);
          setVersi(v => v + 1);
        })
        .catch(() => { /* gagal muat -> tetap tampil kode ZAFEB */ });
    };
    muat();
    window.addEventListener(COA_CHANGED_EVENT, muat);
    return () => { batal = true; window.removeEventListener(COA_CHANGED_EVENT, muat); };
  }, [activeClientId]);

  return <VersiCtx.Provider value={versi}>{children}</VersiCtx.Provider>;
}

/** kodeAkun() yang membuat komponen re-render saat peta kode selesai dimuat / berubah.
 *  Referensi fungsi berganti tiap peta berubah -> aman dipakai sebagai deps useMemo. */
export function useKodeAkun(): typeof kodeAkun {
  const versi = useContext(VersiCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (accNo: string | null | undefined) => kodeAkun(accNo), [versi]);
}
