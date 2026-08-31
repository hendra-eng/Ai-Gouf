"use client";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import "./AgentSidebar.css";

// [MIGRASI Next.js] Lihat catatan sama di ../AgentAIChat.jsx -- asset
// dipindah ke /public/agent-ai/, dipakai sebagai string URL langsung.
const logoIcon = "/agent-ai-migration/images/logo-gouf-icon-cyan.png";

/**
 * Sidebar -- port of the `with st.sidebar:` block in app.py
 *
 * Props:
 *  - aiActive: bool -- DeepSeek API status
 *  - conversations: [{id, judul, aktif}]
 *  - onSelectConversation(id), onNewConversation(), onDeleteConversation(id)
 *  - extraTop: JSX opsional (mis. <TaxSettings />), dirender di bawah status AI
 *  - extraBottom: JSX opsional (mis. link riwayat, tombol logout), dirender paling bawah
 */
export default function AgentSidebar({
  aiActive = false,
  claudeActive = false,
  conversations = [],
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  extraTop,
  extraBottom,
}) {
  const [panduanTerbuka, setPanduanTerbuka] = useState(false);

  // [BARU] Toggle collapse/expand sidebar lewat tombol bulat di tepi
  // kanan sidebar. Konten (.sidebar-content) yang di-collapse/hide,
  // bukan <aside> itu sendiri -- supaya tombolnya tetap punya "rumah"
  // (containing block) untuk position:absolute walau lebar sidebar 0.
  const [collapsed, setCollapsed] = useState(false);

  // [FIX] ref wheel-scroll sekarang nempel ke .sidebar-content (bagian
  // yang overflow-y:auto), BUKAN lagi ke <aside class="app-sidebar">.
  // Sebabnya: .app-sidebar sekarang overflow:visible (supaya tombol
  // toggle yang position:absolute & nongol -14px ke kanan tidak
  // kepotong) -- jadi elemen yang benar-benar discroll dipindah ke
  // wrapper anak ini.
  const scrollRef = useRef(null);

  // [BARU] Scroll wheel manual di sidebar terasa "kaku"/melompat -- itu
  // perilaku default browser (terutama Windows/Chrome), bukan sesuatu
  // yang bisa dihalusin cuma lewat CSS. Hook ini mencegat event wheel,
  // lalu menganimasikan scrollTop pelan-pelan pakai easing (lerp) via
  // requestAnimationFrame, jadi terasa lebih "berat"/momentum, bukan
  // langsung lompat ke posisi akhir.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return; // biarkan scroll native, jangan dipaksa animasi

    // Makin KECIL nilai EASE = makin "berat"/pelan & halus.
    // Makin BESAR nilai EASE = makin responsif (mendekati scroll native).
    const EASE = 0.14;

    let target = el.scrollTop;
    let current = el.scrollTop;
    let rafId = null;

    function tick() {
      current += (target - current) * EASE;
      if (Math.abs(target - current) < 0.5) {
        current = target;
        el.scrollTop = current;
        rafId = null;
        return;
      }
      el.scrollTop = current;
      rafId = requestAnimationFrame(tick);
    }

    function onWheel(e) {
      e.preventDefault();
      target += e.deltaY;
      target = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <aside className={`app-sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* [BARU] Tombol toggle collapse/expand -- posisinya absolute
          nempel di tepi kanan sidebar, nongol setengah keluar biar
          gampang diklik & terlihat jelas batasnya dengan area chat. */}
      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Buka sidebar" : "Tutup sidebar"}
        title={collapsed ? "Buka sidebar" : "Tutup sidebar"}
      >
        {collapsed ? "»" : "«"}
      </button>

      <div className="sidebar-content" ref={scrollRef}>
        <h3>
          <Image src={logoIcon} alt="Gouf Consulting" className="sidebar-logo" width={459} height={543} />
          Gouf Consulting
        </h3>
        <p className="sidebar-caption">Penyedia Jasa Accounting Terbaik</p>

        <div className={`status-badge ${aiActive ? "on" : "off"}`}>
          {aiActive ? "🟢 AI DeepSeek: AKTIF" : "🔴 AI DeepSeek: NONAKTIF"}
        </div>
        {!aiActive && (
          <p className="caption-text">💡 Set DEEPSEEK_API_KEY di .streamlit/secrets.toml</p>
        )}

        {/* [BARU] Badge kedua -- status Claude (Anthropic API), terpisah dari
            badge DeepSeek di atas. Nilainya datang dari field "claude_aktif"
            di /api/health (lihat ambil_api_key_claude() di akuntansi_ai.py). */}
        <div className={`status-badge ${claudeActive ? "on" : "off"}`}>
          {claudeActive ? "🟢 AI Claude: AKTIF" : "🔴 AI Claude: NONAKTIF"}
        </div>
        {!claudeActive && (
          <p className="caption-text">💡 Set ANTHROPIC_API_KEY di .env</p>
        )}

        <hr />

        {extraTop}

        <button className="btn btn-primary sidebar-new-chat" onClick={onNewConversation}>
          Obrolan Baru
        </button>

        <hr />

        <div className="chat-history">
          {conversations.length === 0 && <p className="caption-text">Belum ada obrolan.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={`chat-history-item ${c.aktif ? "active" : ""}`}>
              <button
                className="chat-history-title"
                onClick={() => onSelectConversation?.(c.id)}
                title={c.judul || "Obrolan baru"}
                disabled={c.aktif}
              >
                {c.judul || "Obrolan baru"}
              </button>
              <button
                className="chat-history-delete"
                onClick={() => onDeleteConversation?.(c.id)}
                aria-label={`Hapus obrolan '${c.judul || "Obrolan baru"}'`}
                title={`Hapus obrolan '${c.judul || "Obrolan baru"}'`}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        <hr />

        <button className="btn sidebar-panduan-toggle" onClick={() => setPanduanTerbuka((o) => !o)}>
          📖 Buka Panduan Lengkap
        </button>

        {panduanTerbuka && (
          <div className="sidebar-panduan-body">
            <h4>📖 Panduan Lengkap Pengguna</h4>

            <p><strong>1. Upload File</strong></p>
            <ul>
              <li>Klik ikon 📎 di kotak input bawah</li>
              <li>Pilih file: <code>.xlsx</code>, <code>.xls</code>, <code>.xlsm</code>, <code>.csv</code>, atau <code>.pdf</code></li>
              <li>Bisa upload banyak file sekaligus</li>
            </ul>

            <p><strong>2. Apa yang Bisa Diproses:</strong></p>
            <ul>
              <li>Rekening Koran (multi-bank)</li>
              <li>Data Penjualan (invoice)</li>
              <li>Penilaian Klien / Maker</li>
              <li>Buku Bantu Piutang</li>
              <li>Sheet COA (otomatis terbaca)</li>
              <li>Laporan Keuangan (31 sheet) → otomatis deteksi &amp; generate template kosong</li>
            </ul>

            <p><strong>3. Fitur Utama</strong></p>
            <ul>
              <li>Deteksi kolom otomatis (tidak bergantung urutan)</li>
              <li>Belajar pola historis dari jurnal yang sudah benar</li>
              <li>AI DeepSeek untuk kasus sulit</li>
              <li>Auto-fix kesalahan data penilaian</li>
              <li>Validasi balance jurnal</li>
              <li>Download hasil dalam 1 file Excel</li>
              <li>Deteksi otomatis Laporan Keuangan → generate template 31 sheet kosong</li>
              <li>Auto-backup data setiap kali proses selesai</li>
              <li>Live Dashboard monitoring real-time</li>
              <li>Multi-format Export (Excel, CSV, JSON, PDF)</li>
            </ul>

            <p className="caption-text"><strong>Tips:</strong></p>
            <ul className="caption-text">
              <li>Upload dulu file yang jurnalnya sudah lengkap → AI akan belajar pola</li>
              <li>Upload file COA → akan muncul di filter sheet</li>
              <li>Kemudian upload data bulan berjalan → AI akan otomatis mengisi</li>
              <li>Upload file Laporan Keuangan (31 sheet) → AI akan generate template kosong</li>
            </ul>
          </div>
        )}

        <hr />

        <p><strong>Format File yang Didukung:</strong></p>
        <p>
          • Excel (.xlsx, .xlsm, .xls)<br />
          • CSV<br />
          • PDF
        </p>

        <hr />

        <p className="caption-text">💡 <strong>Tips:</strong> Upload file dengan jurnal lengkap terlebih dahulu supaya AI bisa belajar pola.</p>
        <p className="caption-text">📊 <strong>Laporan Keuangan:</strong> AI akan otomatis deteksi &amp; generate template 31 sheet kosong.</p>

        {extraBottom && <div className="sidebar-extra-bottom">{extraBottom}</div>}
      </div>
    </aside>
  );
}