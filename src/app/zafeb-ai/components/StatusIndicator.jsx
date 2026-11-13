"use client";
import "./StatusIndicator.css";

/**
 * StatusIndicator -- label status singkat dengan spinner + tanda ">"
 * berkedip, buat kasih tahu user AI sedang MENGERJAKAN SESUATU sebelum
 * hasilnya siap (mis. "Thinking", "Membaca File", "Mengklasifikasi
 * Transaksi") -- padanan visual dari "Thinking>" / "Editing File>".
 *
 * Reusable di mana saja: tinggal <StatusIndicator label="..." />.
 * Dipakai pertama kali di ChatPage.jsx (bubble assistant kosong, sebelum
 * token pertama dari AI sampai) -- lihat catatan di sana.
 *
 * Props:
 *  - label: teks status, TANPA tanda ">" (ditambahkan otomatis di sini)
 */
export default function StatusIndicator({ label = "Memproses" }) {
  return (
    <div className="status-indicator">
      <span className="status-indicator-spinner" aria-hidden="true" />
      <span className="status-indicator-label">
        {label}
        <span className="status-indicator-chevron">&gt;</span>
      </span>
    </div>
  );
}