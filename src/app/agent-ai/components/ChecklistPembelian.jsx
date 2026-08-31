"use client";
import { useState } from "react";
import "./ChecklistPembelian.css";

/**
 * ChecklistPembelian -- modal checklist "Deteksi & pencegahan kesalahan"
 * untuk data Pembelian (PO/Invoice), sesuai desain di screenshot.
 *
 * Kode item HARUS sama persis dengan key di
 * modules/deteksi_kesalahan_pembelian.py::DAFTAR_PENGECEKAN, supaya
 * `checks` yang dikirim ke POST /api/client/{id}/deteksi-kesalahan-pembelian
 * langsung dikenali backend tanpa perlu mapping tambahan.
 *
 * Props:
 *  - onSubmit(checkedKeys: string[]): dipanggil saat tombol "Kerjakan
 *    sekarang" ditekan, dengan daftar kode item yang dicentang.
 *  - onSomethingElse(teks: string): opsional, dipanggil kalau user pilih
 *    "Something else" dan mengetik permintaan bebas.
 *  - onClose(): dipanggil saat modal ditutup (tombol X) tanpa submit.
 */
const DAFTAR_ITEM = [
  { key: "po_invoice", label: "Pencocokan PO ↔ Invoice" },
  { key: "pph23_jasa", label: "Deteksi PPh 23 atas jasa" },
  { key: "harga_tidak_wajar", label: "Deteksi harga tidak wajar (riwayat)" },
  { key: "supplier_baru", label: "Deteksi supplier baru" },
  { key: "validasi_tanggal", label: "Validasi tanggal" },
  { key: "rekap_supplier", label: "Rekap per Supplier" },
  { key: "cross_check_ap_aging", label: "Cross-check ke AP Aging" },
];

export default function ChecklistPembelian({ onSubmit, onSomethingElse, onClose }) {
  const [checked, setChecked] = useState(() => new Set());
  const [showSomethingElse, setShowSomethingElse] = useState(false);
  const [teksLain, setTeksLain] = useState("");

  const toggle = (key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleKerjakan = () => {
    if (checked.size === 0) return;
    onSubmit?.([...checked]);
  };

  const handleKirimLain = (e) => {
    e.preventDefault();
    if (!teksLain.trim()) return;
    onSomethingElse?.(teksLain.trim());
    setTeksLain("");
    setShowSomethingElse(false);
  };

  return (
    <div className="checklist-pembelian">
      <div className="checklist-header">
        <span>Mau mulai dari yang mana? (bisa pilih lebih dari satu, saya kerjakan sekaligus)</span>
        <button type="button" className="checklist-close" onClick={onClose} aria-label="Tutup">
          ✕
        </button>
      </div>

      <div className="checklist-items">
        {DAFTAR_ITEM.map((item, i) => (
          <label key={item.key} className={`checklist-row ${checked.has(item.key) ? "checked" : ""}`}>
            <input
              type="checkbox"
              checked={checked.has(item.key)}
              onChange={() => toggle(item.key)}
            />
            <span className="checklist-label">
              <strong>{i + 1}.</strong> {item.label}
            </span>
          </label>
        ))}

        {!showSomethingElse ? (
          <button
            type="button"
            className="checklist-row checklist-something-else"
            onClick={() => setShowSomethingElse(true)}
          >
            <span className="checklist-checkbox-placeholder" />
            <span className="checklist-label checklist-label-dim">Something else</span>
          </button>
        ) : (
          <form className="checklist-something-else-form" onSubmit={handleKirimLain}>
            <input
              type="text"
              autoFocus
              placeholder="Tulis permintaanmu..."
              value={teksLain}
              onChange={(e) => setTeksLain(e.target.value)}
            />
            <button type="submit" disabled={!teksLain.trim()}>Kirim</button>
          </form>
        )}
      </div>

      <div className="checklist-footer">
        <button
          type="button"
          className="checklist-submit"
          disabled={checked.size === 0}
          onClick={handleKerjakan}
        >
          Kerjakan sekarang {checked.size > 0 ? `(${checked.size})` : ""}
        </button>
      </div>
    </div>
  );
}

export { DAFTAR_ITEM };