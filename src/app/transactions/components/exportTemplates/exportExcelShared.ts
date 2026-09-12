// [BARU] Tipe & helper kecil yang dipakai bareng oleh exportTransactionsExcel.ts
// (template GL default) dan sauCashJournalTemplate.ts (template client SAU) —
// diletakkan terpisah supaya keduanya tidak saling import satu sama lain
// (exportTransactionsExcel.ts men-dispatch ke sauCashJournalTemplate.ts,
// jadi kalau downloadBlob taruh di exportTransactionsExcel.ts, import baliknya
// jadi circular).

/** Hasil "build" file Excel — cuma blob + nama file, BELUM di-download. */
export interface ExcelExportResult {
  blob: Blob;
  fileName: string;
}

/** Trigger download browser dari blob yang sudah jadi — tanpa build ulang. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
