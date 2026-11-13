"use client";
import "./ChatBubble.css";

/**
 * ChatBubble -- port of .st-key-msgu_ (user) / .st-key-msga_ (assistant)
 *
 * [BARU] Sekarang bisa menampilkan chip nama file yang diupload user --
 * sebelumnya begitu user upload file (terutama TANPA ketik teks apa pun),
 * bubble user-nya kosong sama sekali, jadi tidak kelihatan file apa yang
 * baru saja dikirim sampai pesan assistant "📋 Rencana pemrosesan..."
 * muncul belakangan.
 *
 * [BARU -- kartu file besar utk file BUATAN AI] Sebelumnya file dari AI
 * (kertas kerja, laporan 18-sheet) dirender SAMA seperti chip file upload
 * user -- pil kecil `📎 nama_file`, tanpa cara untuk unduh ulang kalau
 * auto-download browser gagal/ke-skip. Sekarang `files` bisa diisi
 * OBJECT (bukan cuma string) berisi info tambahan + `base64` -- kalau
 * ada, dirender sebagai KARTU (ikon dokumen, nama, subtitle tipe file,
 * tombol "Unduh" hijau terpisah). String polos (dipakai chip upload
 * user) tetap dirender sebagai pil kecil lama, TIDAK BERUBAH.
 *
 * Props:
 *  - role: "user" | "assistant"
 *  - children: isi pesan (teks/elemen) yang mau ditampilkan di dalam bubble
 *  - files: array, opsional -- tiap item BOLEH:
 *      (a) string -- nama file saja -> dirender chip pil kecil lama
 *      (b) object { nama, tipe?, sheetInfo?, base64? } -- dirender kartu
 *          besar. `tipe` mis. "Excel", `sheetInfo` mis. "14 Sheet".
 *          Kalau `base64` diisi, tombol "Unduh" bisa dipakai untuk
 *          unduh ulang kapan saja (tidak cuma sekali saat pesan baru
 *          datang).
 *    Untuk role "user" chip/kartu tampil DI ATAS teks (file yang
 *    diupload user). Untuk role "assistant" tampil DI BAWAH teks (file
 *    yang DIBERIKAN AI ke user) -- sama seperti pola "artifact" Claude.
 *  - onFileClick: dipanggil dengan (namaFile) saat kartu/chip diklik --
 *    dipakai pemanggil (ChatPage) untuk membuka <ArtifactPanel/> di sisi
 *    kanan. Kalau tidak dikasih, chip/kartu tetap tampil tapi bagian
 *    itu tidak bisa diklik.
 *  - onDownloadFile: dipanggil dengan (base64, namaFile) saat tombol
 *    "Unduh" di kartu besar diklik -- dipakai pemanggil (ChatPage) utk
 *    trigger ulang download browser (lihat unduhBase64Excel). Kalau
 *    item file tidak punya `base64` atau prop ini tidak dikasih, tombol
 *    "Unduh" tidak ditampilkan (fallback ke kartu tanpa tombol, tetap
 *    bisa diklik untuk buka panel lewat onFileClick).
 */
export default function ChatBubble({ role = "assistant", children, files = [], onFileClick, onDownloadFile }) {
  const adaFile = files && files.length > 0;

  const barisChipFile = adaFile && (
    <div className="msg-file-chip-row">
      {files.map((item, i) => {
        const isKartu = item && typeof item === "object";
        const nama = isKartu ? item.nama : item;
        const key = `${nama}-${i}`;

        if (isKartu) {
          const bisaUnduh = Boolean(item.base64 && onDownloadFile);
          const subtitle = [item.tipe, item.sheetInfo].filter(Boolean).join(" · ");
          return (
            <div className="msg-file-card" key={key}>
              <button
                type="button"
                className="msg-file-card__main"
                onClick={() => onFileClick && onFileClick(nama)}
                disabled={!onFileClick}
              >
                <span className="msg-file-card__icon" aria-hidden="true">📄</span>
                <span className="msg-file-card__info">
                  <span className="msg-file-card__name">{nama}</span>
                  {subtitle && <span className="msg-file-card__meta">{subtitle}</span>}
                </span>
              </button>
              {bisaUnduh && (
                <button
                  type="button"
                  className="msg-file-card__download-btn"
                  onClick={() => onDownloadFile(item.base64, nama)}
                >
                  Unduh
                </button>
              )}
            </div>
          );
        }

        return onFileClick ? (
          <button
            type="button"
            className="msg-file-chip msg-file-chip--clickable"
            key={key}
            onClick={() => onFileClick(nama)}
          >
            📎 {nama}
          </button>
        ) : (
          <span className="msg-file-chip" key={key}>
            📎 {nama}
          </span>
        );
      })}
    </div>
  );

  if (role === "user") {
    return (
      <div className="msg-user">
        <div className="msg-user-bubble">
          {barisChipFile}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-assistant">
      <div className="msg-assistant-content">{children}</div>
      {/* [BARU] Kotak file dari AI -- di LUAR .msg-assistant-content (bukan
          di dalam bubble kaca seperti user) supaya kelihatan seperti
          lampiran terpisah dari teks jawaban, konsisten dgn HasilTerpadu. */}
      {barisChipFile}
    </div>
  );
}