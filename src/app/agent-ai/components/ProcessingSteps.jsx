"use client";
import "./ProcessingSteps.css";

/**
 * ProcessingSteps -- menampilkan progress step-by-step selagi
 * /api/proses-file/stream berjalan (lihat api.js::prosesFileStream &
 * main.py::proses_file_stream), gantinya loading kosong yang baru
 * menampilkan hasil setelah SEMUANYA selesai.
 *
 * [FIX] Komponen ini di-reuse juga untuk panel "AI sedang menyusun
 * jawaban" di chat teks biasa (lihat AgentAIChat.jsx, fileName="jawaban
 * ini") -- SEBELUM ini label ringkasan selalu hardcode "X jenis dokumen
 * dikenali", padahal buat chat teks yang "step" itu cuma langkah
 * internal AI (baca pola/susun konteks/jawab), BUKAN jenis dokumen sama
 * sekali. Sekarang label ringkasan bisa dikustomisasi lewat prop
 * `labelRingkas` per konteks pemakaian.
 *
 * Props:
 *  - fileName: nama file yang sedang diproses
 *  - steps: array of { step, label, status, pesan? }, status salah satu
 *    dari "processing" | "done" | "skip" | "error" -- urutan sesuai
 *    urutan event SSE diterima (yang terbaru paling bawah).
 *  - selesai: boolean -- kalau true, tampilkan sebagai ringkasan pendek
 *    (bukan daftar penuh) supaya tidak makan tempat setelah hasil muncul.
 *  - labelRingkas: function(jumlahDitemukan) => string -- teks ringkasan
 *    setelah selesai. Default cocok untuk upload file ("N jenis dokumen
 *    dikenali"); untuk chat teks, panggil dengan labelRingkas={() =>
 *    "jawaban selesai disusun"} atau sejenisnya.
 */
export default function ProcessingSteps({
  fileName,
  steps = [],
  selesai = false,
  labelRingkas = (jumlahDitemukan) => `${jumlahDitemukan} jenis dokumen dikenali`,
}) {
  const jumlahDitemukan = steps.filter((s) => s.status === "done").length;
  const sedangBerjalan = steps.find((s) => s.status === "processing");

  if (selesai) {
    return (
      <div className="proc-steps proc-steps-ringkas">
        <span className="proc-steps-icon">✅</span>
        <span>
          <strong>{fileName}</strong> selesai diproses — {labelRingkas(jumlahDitemukan)}.
        </span>
      </div>
    );
  }

  return (
    <div className="proc-steps">
      <div className="proc-steps-header">
        <span className="proc-spinner" aria-hidden="true" />
        <span>
          Memproses <strong>{fileName}</strong>
          {sedangBerjalan ? ` — ${sedangBerjalan.label}...` : "..."}
        </span>
      </div>

      <ul className="proc-steps-list">
        {steps.map((s, i) => (
          <li key={`${s.step}-${i}`} className={`proc-step proc-step-${s.status}`}>
            <span className="proc-step-icon">
              {s.status === "done" && "✅"}
              {s.status === "processing" && "⏳"}
              {s.status === "skip" && "·"}
              {s.status === "error" && "⚠️"}
            </span>
            <span className="proc-step-label">{s.label}</span>
            {s.status === "error" && s.pesan && (
              <span className="proc-step-pesan">{s.pesan}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}