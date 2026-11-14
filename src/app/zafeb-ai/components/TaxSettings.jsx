"use client";
import { useState } from "react";
import "./TaxSettings.css";

/**
 * TaxSettings -- port of the "🧾 Pengaturan Faktur Pajak (PPN)" +
 * "📑 Pengaturan Bukti Potong" expanders in app.py's sidebar.
 *
 * Props:
 *  - npwp, onNpwpChange
 *  - tarifPpn (0.11 | 0.12), onTarifChange
 */
export default function TaxSettings({ npwp, onNpwpChange, tarifPpn = 0.11, onTarifChange }) {
  const [openFaktur, setOpenFaktur] = useState(false);
  const [openBuktiPotong, setOpenBuktiPotong] = useState(false);
  const npwpKosong = !npwp?.trim();

  return (
    <>
      {/* ============================================================
          NPWP PERUSAHAAN -- port of "🧾 Pengaturan Faktur Pajak (PPN)"
          ============================================================ */}
      <div className="tax-settings">
        <button className="tax-settings-toggle" onClick={() => setOpenFaktur((o) => !o)}>
          🧾 Pengaturan Faktur Pajak (PPN) {openFaktur ? "▲" : "▼"}
        </button>

        {openFaktur && (
          <div className="tax-settings-body">
            <p className="tax-settings-help">
              Isi NPWP perusahaan (klien) supaya AI bisa menentukan arah tiap Faktur
              Pajak yang diupload (Keluaran = perusahaan jual, Masukan = perusahaan
              beli) dan menyiapkan draf jurnalnya. Kalau kosong, faktur tetap dicek
              formatnya tapi arah &amp; draf jurnal tidak dibuat (lebih aman drpd
              menebak salah).
            </p>

            <label className="sidebar-label">NPWP Perusahaan</label>
            <input
              className="login-input"
              type="text"
              placeholder="mis. 01.234.567.8-901.000"
              value={npwp}
              onChange={(e) => onNpwpChange?.(e.target.value)}
            />

            <label className="sidebar-label" style={{ marginTop: "0.75rem" }}>
              Tarif PPN yang dipakai untuk cross-check
            </label>
            <select
              className="sidebar-select"
              value={tarifPpn}
              onChange={(e) => onTarifChange?.(Number(e.target.value))}
            >
              <option value={0.11}>11% — BKP/JKP non-mewah (default, DPP Nilai Lain, sesuai PMK 131/2024)</option>
              <option value={0.12}>12% — barang mewah (kena PPnBM), DPP penuh</option>
            </select>

            <p className="tax-settings-warning">
              ⚠️ Tarif pajak bisa berubah sewaktu-waktu lewat regulasi baru — cek
              update PMK terbaru sebelum lapor SPT Masa PPN.
            </p>
          </div>
        )}
      </div>

      {/* ============================================================
          BUKTI POTONG PAJAK (PPh 21/23/4(2))
          ============================================================ */}
      <div className="tax-settings">
        <button className="tax-settings-toggle" onClick={() => setOpenBuktiPotong((o) => !o)}>
          📑 Pengaturan Bukti Potong (PPh 21/23/4(2)) {openBuktiPotong ? "▲" : "▼"}
        </button>

        {openBuktiPotong && (
          <div className="tax-settings-body">
            <p className="tax-settings-help">
              Memakai NPWP perusahaan yang sama dengan pengaturan Faktur Pajak di
              atas untuk menentukan arah tiap Bukti Potong yang diupload (Diterima =
              perusahaan dipotong pihak lain → jadi kredit pajak, Dibuat = perusahaan
              memotong pihak lain → jadi utang PPh yang wajib disetor). Kalau NPWP
              perusahaan kosong, Bukti Potong tetap dicek formatnya tapi arah &amp;
              draf jurnal tidak dibuat.
            </p>

            {npwpKosong && (
              <div className="alert alert-info">
                ℹ️ Isi NPWP Perusahaan di bagian &quot;🧾 Pengaturan Faktur Pajak (PPN)&quot; di atas.
              </div>
            )}

            <p className="tax-settings-warning">
              ⚠️ PPh 21 memakai skema TER (tarif tergantung status PTKP karyawan) —
              hanya dicek kewajaran rentang tarifnya, bukan divalidasi pasti.
              Sejumlah objek PPh 4(2) (mis. jasa konstruksi) tarifnya tergantung
              kualifikasi — tetap cek manual.
            </p>
          </div>
        )}
      </div>
    </>
  );
}