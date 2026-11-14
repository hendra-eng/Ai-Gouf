"use client";
import "./ArtifactPanel.css";

/**
 * ArtifactPanel -- panel geser di sisi kanan layar chat, mirip panel
 * "Pasted content" / artifact viewer di Claude. Muncul sebagai kolom
 * ketiga di sebelah <Sidebar/> dan .main-container (lihat ChatPage.jsx),
 * BUKAN modal/overlay -- supaya chat tetap bisa dibaca & digulir di
 * sebelah kiri sambil panel terbuka, sama seperti referensi di gambar.
 *
 * [FIX -- animasi geser halus] Sebelumnya komponen ini di-mount/unmount
 * total lewat `{artifactAktif && <ArtifactPanel/>}` di ChatPage -- begitu
 * muncul/hilang dari DOM, browser TIDAK PUNYA state sebelumnya utk
 * di-transisi-kan (elemen baru langsung "ada" di lebar penuh, atau
 * langsung "hilang" total), jadi .main-container ikut melompat instan ke
 * lebar barunya. Efeknya kelihatan seperti "blink"/berpindah tempat,
 * bukan tergeser halus.
 *
 * Sekarang komponen ini SELALU dirender di DOM (lihat ChatPage.jsx, tidak
 * ada lagi kondisi `artifactAktif &&`) -- buka/tutup dikontrol murni lewat
 * prop `open` yang menambah/hapus class `artifact-panel--open`. Class itu
 * mengubah `width` panel dari 0 -> lebar penuh lewat CSS `transition`
 * (lihat ArtifactPanel.css) -- karena .main-container adalah flex
 * sibling-nya, browser otomatis ikut menganimasikan lebar teks chat
 * SETIAP frame mengikuti animasi width ini, jadi keduanya tergeser
 * bersamaan dgn kecepatan yang sama, murni lewat CSS (bukan JS).
 *
 * Props:
 *  - open: boolean -- true = panel terbuka (lebar penuh), false = tertutup
 *    (lebar 0, disembunyikan tapi TETAP ada di DOM)
 *  - title: nama file/artifact yang ditampilkan di header
 *  - meta: teks kecil di bawah judul (mis. "10.62 KB · 395 lines") -- opsional
 *  - onClose: dipanggil saat tombol ✕ ditekan (menutup panel)
 *  - onBack: dipanggil saat tombol ← ditekan -- opsional; kalau tidak
 *    dikasih, tombol back tidak ditampilkan (khusus dipakai kalau nanti
 *    ada navigasi "balik ke daftar file" di dalam panel yang sama)
 */
export default function ArtifactPanel({ open = false, title = "Untitled", meta = "", onClose, onBack }) {
  return (
    <aside
      className={`artifact-panel${open ? " artifact-panel--open" : ""}`}
      // [BARU] Disembunyikan dari screen reader & keyboard tab order saat
      // tertutup -- panel tetap ada di DOM (lebar 0) tapi tidak boleh ikut
      // "kefokus"/terbaca padahal user tidak melihatnya.
      aria-hidden={!open}
      inert={!open ? "" : undefined}
    >
      <div className="artifact-panel__header">
        {onBack && (
          <button
            type="button"
            className="artifact-panel__icon-btn"
            onClick={onBack}
            aria-label="Kembali"
          >
            ←
          </button>
        )}

        <div className="artifact-panel__titles">
          <span className="artifact-panel__title" title={title}>{title}</span>
          {meta && <span className="artifact-panel__meta">{meta}</span>}
        </div>

        <button
          type="button"
          className="artifact-panel__icon-btn"
          onClick={onClose}
          aria-label="Tutup panel"
        >
          ✕
        </button>
      </div>

      <div className="artifact-panel__body">
        {/* [TODO -- belum diisi] Nanti di sini: isi file/teks asli
            (mis. <pre> dengan nomor baris untuk kode, atau render biasa
            untuk teks/markdown). Sengaja dikosongkan dulu sesuai request:
            "desainnya saja dulu ... isinya jangan disi dulu gapapa". */}
        <p className="artifact-panel__placeholder">Konten belum tersedia.</p>
      </div>
    </aside>
  );
}