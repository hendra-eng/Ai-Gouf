"use client";
import { useState } from "react";
import { exportLaporan14Sheet } from "../lib/api";
// [FIX -- root cause HMR tidak pernah trigger utk file ini] Sebelumnya file
// ini bernama "Hasilterpadu.jsx"/"Hasilterpadu.css" (huruf t kecil) di disk,
// padahal SEMUA tempat lain (ChatPage.jsx: `import HasilTerpadu from
// "../components/HasilTerpadu"`, juga nama komponennya sendiri di bawah)
// memakai "HasilTerpadu" (T besar). Windows toleran soal ini (case-
// insensitive filesystem) sehingga tetap ke-render normal, tapi Vite jadi
// tidak bisa mencocokkan file yang berubah dgn modul yang di-import --
// akibatnya file ini TIDAK PERNAH muncul di log HMR walau paling sering
// diedit (harus full reload manual tiap kali save). File sudah di-rename
// jadi HasilTerpadu.jsx/HasilTerpadu.css supaya persis sama dgn cara
// dia diimpor di mana-mana.
import "./HasilTerpadu.css";

/**
 * HasilTerpadu -- [DISEDERHANAKAN atas permintaan user, 3 tahap]
 *
 * Tahap 1: dari 4 blok (14-Sheet, Hasil Per Dokumen, Live Dashboard, Saran
 * Cerdas) disederhanakan jadi cuma 1 blok: "Buat Laporan Keuangan Lengkap
 * (14 Sheet)".
 *
 * Tahap 2: blok itu sendiri dipecah jadi 2 lapis terpisah -- (a) penjelasan
 * teks apa yang akan dibuat, TERPISAH di atas, lalu (b) satu kotak
 * sederhana & fungsional: ikon + nama file + subjudul di kiri, tombol
 * "Unduh" di kanan.
 *
 * Tahap 3 (sekarang): kontrol tahun (input + tampilan di nama file) dan
 * tombol "Tampilkan 14 Sheet di Layar" (beserta <Laporan14SheetViewer>)
 * dihapus atas permintaan user -- kartu sekarang cuma berisi penjelasan +
 * satu tombol Unduh. Tahun laporan otomatis memakai tahun berjalan saat
 * tombol Unduh ditekan (tidak lagi bisa diganti dari UI).
 *
 * Kalau nanti Hasil Per Dokumen / Live Dashboard / Saran Cerdas / kontrol
 * tahun / tampilan 14 sheet di layar mau dikembalikan, kodenya masih ada
 * lengkap di riwayat git (lihat versi sebelumnya) -- tidak perlu ditulis
 * ulang dari nol.
 *
 * Props:
 *  - clientId: id client yang lagi aktif di obrolan ini. Kalau kosong,
 *    panel disembunyikan.
 *  - resultsByCategory: tidak dipakai untuk merender apa pun di sini,
 *    tapi tetap diterima sebagai prop supaya ChatPage.jsx tidak perlu
 *    diubah cara memanggilnya.
 *  - onFileClick: [BARU] dipanggil dengan (namaFile, meta) saat KOTAK
 *    (bukan cuma tombol Unduh) diklik -- dipakai pemanggil (ChatPage)
 *    untuk membuka <ArtifactPanel/> di sisi kanan, sama seperti chip
 *    file di ChatBubble. Tombol "Unduh" tetap punya aksinya sendiri
 *    (export/download) dan TIDAK ikut memicu ini (lihat stopPropagation
 *    di handleExportLaporan bawah).
 */
export default function HasilTerpadu({ resultsByCategory = {}, clientId = null, onFileClick }) {
  // ------------------------------------------------------------
  // Buat Laporan Keuangan Lengkap (14-Sheet) -- satu file .xlsx gabungan
  // (COA, GL, Buku Bantu Piutang/Hutang/Aktiva Tetap, Trial Balance/Laba
  // Rugi/Balance Sheet Bulanan, Ringkasan, Lampiran SPT BS/PNL, PPh Badan
  // 31E) dari SEMUA dokumen yang sudah diproses utk client ini.
  // ------------------------------------------------------------
  const [sedangExport, setSedangExport] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportSukses, setExportSukses] = useState(null);

  async function handleExportLaporan(e) {
    // [BARU] Kartu sekarang punya onClick sendiri (buka ArtifactPanel) --
    // stopPropagation supaya klik tombol Unduh TIDAK ikut membuka panel,
    // cukup jalankan aksi unduhnya sendiri.
    e.stopPropagation();
    if (!clientId || sedangExport) return;
    setSedangExport(true);
    setExportError(null);
    setExportSukses(null);
    try {
      // [FIX] Kontrol tahun di UI sudah dihapus -- tahun laporan sekarang
      // selalu tahun berjalan (dihitung saat tombol ditekan), tidak lagi
      // disimpan di state. Endpoint export-14-sheet dipanggil dengan
      // hanya_terposting=False -- SEMUA baris jurnal (draft maupun
      // terposting, termasuk yang akunnya masih placeholder) otomatis ikut
      // ke laporan apa adanya. Baris yang masih perlu dikoreksi ditandai
      // lewat kolom "Status Validasi" di sheet GL <tahun> pada file hasil
      // export.
      const { filename } = await exportLaporan14Sheet(clientId, {
        tahun: new Date().getFullYear(),
      });
      setExportSukses(filename);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setSedangExport(false);
    }
  }

  // [BARU] Klik di mana pun di dalam kotak (ikon, judul, subjudul, area
  // kosong) -- BUKAN tombol Unduh -- membuka <ArtifactPanel/>. Kalau
  // pemanggil tidak mengoper onFileClick, kotak tetap tampil seperti
  // biasa tapi tidak bisa diklik (fallback aman).
  function handleCardClick() {
    onFileClick?.("Laporan_Keuangan_Lengkap.xlsx", "Excel · 14 Sheet");
  }

  if (!clientId) return null;

  return (
    <div className="hasil-terpadu animate-fade">
      {/* ============================================================
          PENJELASAN -- teks apa yang akan dibuat, TERPISAH di atas
          kotak unduh (bukan digabung jadi satu kotak seperti sebelumnya).
          ============================================================ */}
      <p className="empty-state" style={{ textAlign: "left", margin: "0 0 10px" }}>
        📊 Gabungkan COA, GL, Buku Bantu Piutang/Hutang/Aktiva Tetap, Trial Balance/Laba Rugi/Balance
        Sheet Bulanan, Ringkasan, Lampiran SPT BS/PNL, dan PPh Badan 31E dari semua dokumen client ini
        menjadi satu file Excel.
      </p> 

      {/* ============================================================
          KOTAK UNDUH -- ikon + nama file + subjudul di kiri, tombol
          "Unduh" di kanan. [BARU] Seluruh kotak sekarang bisa diklik
          (role="button") untuk buka panel kanan, tombol Unduh tetap
          jalan sendiri lewat stopPropagation di handleExportLaporan.
          ============================================================ */}
      <div
        className="ht-file-card ht-file-card--clickable"
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <div className="ht-file-card-icon" aria-hidden="true">📄</div>
        <div className="ht-file-card-info">
          <div className="ht-file-card-title">
            Laporan_Keuangan_Lengkap.xlsx
          </div>
          <div className="ht-file-card-subtitle">
            Excel &middot; 14 Sheet
          </div>
        </div>
        <div className="ht-file-card-action">
          <button
            className="btn btn-primary"
            onClick={handleExportLaporan}
            disabled={sedangExport}
          >
            {sedangExport ? "Menyusun..." : "Unduh"}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>Gagal membuat laporan: {exportError}</div>
      )}
      {exportSukses && (
        <div className="alert alert-success" style={{ marginTop: 10 }}>✅ {exportSukses} berhasil diunduh.</div>
      )}
      <p className="empty-state" style={{ textAlign: "left", margin: "10px 0 0" }}>
        💡 Semua data (termasuk yang belum dikoreksi) langsung ikut ke laporan -- cek kolom
        &quot;Status Validasi&quot; di sheet GL pada file hasil untuk lihat baris mana yang masih perlu
        dikoreksi.
      </p>
    </div>
  );
}