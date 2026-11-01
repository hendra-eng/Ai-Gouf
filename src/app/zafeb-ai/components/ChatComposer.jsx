"use client";
import { useEffect, useRef, useState } from "react";
import "./ChatComposer.css";

/**
 * ChatComposer -- port of .st-key-composer_bar
 *
 * Props:
 *  - onSend(text, files): called when user submits
 *  - isLanding: true when no messages yet (composer sits inline, not fixed)
 *  - disabled: [BARU] true selama AI masih memproses pesan sebelumnya --
 *    layaknya AI chat pada umumnya (ChatGPT/Claude dst), user tidak bisa
 *    kirim pesan baru ATAU upload file baru sampai balasan sebelumnya
 *    selesai. Tombol upload dan tombol kirim dinonaktifkan (kolom teks
 *    TETAP bisa diketik, lihat di bawah); submit form juga diblokir sebagai
 *    jaga-jaga kalau ada yang tetap memaksa submit lewat keyboard (mis.
 *    Enter).
 *  - onStop: [BARU] dipanggil saat user menekan tombol "Stop" -- tombol ini
 *    HANYA dirender selama `disabled` true (persis saat AI sedang memproses
 *    file/pertanyaan), muncul di sebelah kiri tombol "Kirim", layaknya
 *    tombol stop di ChatGPT/Claude. Kalau prop ini tidak diisi, tombolnya
 *    tidak dirender sama sekali (tidak wajib dipakai pemanggil).
 */
export default function ChatComposer({ onSend, isLanding = false, disabled = false, onStop }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  // [BARU -- INPUT SUARA] Web Speech API bawaan browser (SpeechRecognition /
  // webkitSpeechRecognition) -- TIDAK butuh endpoint backend baru, semua
  // rekam+transkrip terjadi di browser. `recognitionRef` menyimpan instance
  // aktif; `listening` cuma soal tampilan tombol (merah berdenyut saat
  // merekam). Bahasa dipatok "id-ID" karena UI app ini berbahasa Indonesia.
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const SpeechRecognitionCtor =
    typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const dukungSuara = Boolean(SpeechRecognitionCtor);

  const toggleVoice = () => {
    if (!dukungSuara) return;

    if (listening) {
      // User klik lagi saat masih merekam -- stop manual.
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "id-ID";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    // continuous=false: berhenti otomatis begitu user diam sejenak --
    // konsisten dgn tombol mic di kebanyakan app chat (bukan rekam terus
    // sampai ditekan lagi).

    recognition.onresult = (e) => {
      const transkrip = Array.from(e.results)
        .map((r) => r[0]?.transcript || "")
        .join(" ")
        .trim();
      if (!transkrip) return;
      // Ditambahkan ke teks yang sudah diketik (bukan mengganti), supaya
      // bisa dipakai gantian ketik+bicara.
      setText((prev) => (prev ? `${prev} ${transkrip}` : transkrip));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  // Hentikan rekaman kalau komponen unmount di tengah proses merekam --
  // mencegah recognition tetap jalan di background setelah user pindah
  // halaman.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const handleFileChange = (e) => {
    if (disabled) return;
    const newFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...newFiles]);
    e.target.value = ""; // allow re-selecting the same file
  };

  const removeFile = (index) => {
    if (disabled) return;
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
    if (!text.trim() && files.length === 0) return;
    onSend?.(text.trim(), files);
    setText("");
    setFiles([]);
  };

  return (
    <div className={`composer-wrap ${isLanding ? "landing" : "fixed"}`}>
      {files.length > 0 && (
        <div className="chip-file-row">
          {files.map((f, i) => (
            <button
              key={`${f.name}-${i}`}
              type="button"
              className="chip-file"
              onClick={() => removeFile(i)}
              disabled={disabled}
              title="Hapus file"
            >
              {f.name} ✕
            </button>
          ))}
        </div>
      )}

      <form className={`composer-bar ${disabled ? "is-disabled" : ""}`} onSubmit={handleSubmit}>
        <button
          type="button"
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Upload file"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          disabled={disabled}
          onChange={handleFileChange}
        />

        <input
          type="text"
          className="composer-input"
          placeholder={disabled ? "AI sedang memproses... (kamu tetap bisa mengetik)" : "Tulis pesan..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {/* [BARU] Tombol Stop -- HANYA muncul selama `disabled` (AI sedang
            memproses). type="button" (bukan "submit") supaya tidak ikut
            memicu handleSubmit form; klik memanggil onStop() langsung dari
            pemanggil (ChatPage), yang membatalkan request yang sedang
            berjalan lewat AbortController. */}
        {disabled && onStop && (
          <button
            type="button"
            className="stop-btn"
            onClick={onStop}
            aria-label="Hentikan"
            title="Hentikan"
          >
            <span className="stop-btn-icon" aria-hidden="true" />
          </button>
        )}

        {/* [BARU -- INPUT SUARA] Selalu dirender tepat di sebelah kiri
            "Kirim" -- kalau tombol Stop di atas juga muncul (disabled),
            Stop otomatis nempatkan diri SEBELUM tombol ini dalam urutan
            DOM, jadi Suara "tergeser" ke kanan Stop tanpa logic tambahan.
            TIDAK ikut dinonaktifkan oleh `disabled` -- konsisten dengan
            kolom teks yang juga tetap bisa dipakai selagi AI memproses,
            supaya user bisa menyiapkan pertanyaan berikutnya lewat suara. */}
        <button
          type="button"
          className={`voice-btn ${listening ? "is-listening" : ""}`}
          onClick={toggleVoice}
          disabled={!dukungSuara}
          aria-label={listening ? "Berhenti merekam" : "Rekam suara"}
          title={
            dukungSuara
              ? listening
                ? "Berhenti merekam"
                : "Bicara untuk menulis pesan"
              : "Browser ini tidak mendukung input suara"
          }
        >
          {/* [BARU] SVG outline mic (bukan emoji 🎤) -- pakai currentColor
              supaya otomatis ikut warna tombol (abu-abu normal, cyan saat
              hover, merah saat .is-listening lewat CSS). */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        <button
          type="submit"
          className="send-btn"
          disabled={disabled || (!text.trim() && files.length === 0)}
        >
          Kirim
        </button>
      </form>
    </div>
  );
}