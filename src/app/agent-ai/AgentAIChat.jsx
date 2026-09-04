"use client";
// [MIGRASI] Diporting dari project React+Vite "AI Gouf Consulting" (ChatPage.jsx)
// ke dalam Next.js App Router sebagai halaman "Agent AI" di dashboard Finova AI.
// Path import di bawah ini disesuaikan (semua jadi relatif ke folder
// src/app/agent-ai/ ini sendiri, bukan lagi ../lib atau ../components dari
// project Vite yang lama). Logika komponen TIDAK diubah.
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import ChatComposer from "./components/ChatComposer";
import ChatBubble from "./components/ChatBubble";
import ArtifactPanel from "./components/ArtifactPanel";
import StatusIndicator from "./components/StatusIndicator";
import ProcessingSteps from "./components/ProcessingSteps";
import HasilTerpadu from "./components/HasilTerpadu";
import TaxSettings from "./components/TaxSettings";
import ChecklistPembelian from "./components/ChecklistPembelian";
import DeteksiKesalahanResults from "./components/DeteksiKesalahanResults";
import * as api from "./lib/api";
import { DOCUMENT_TYPES } from "./lib/documentTypes";
import { ClientProvider, useClient } from "./context/ClientContext";
// [BARU] Kabari halaman lain (Transaksi, dst) begitu upload file di sini
// selesai diproses & terposting untuk client aktif -- lihat dataSync.ts.
import { notifyClientDataChanged } from "@/lib/dataSync";
import "./theme.css";

// [MIGRASI Next.js] Asset dipindah ke /public/agent-ai/ (bukan lagi
// di-import sebagai module JS) -- import gambar statis di Next.js
// menghasilkan OBJECT (StaticImageData: {src, width, height}), bukan
// string URL langsung, jadi tidak bisa dipakai langsung di <img src=.../>
// biasa seperti di project Vite aslinya. Path public/ selalu berupa
// string URL, jadi lebih aman dipakai persis seperti sebelumnya.
const logoIcon = "/agent-ai-migration/images/logo-gouf-icon-cyan.png";

// [BARU] Decode base64 hasil laporan_14_sheet (lihat main.py::
// _auto_generate_laporan_14_sheet) jadi file Excel & langsung trigger
// download browser -- supaya begitu upload selesai, laporan 14-sheet
// langsung ada di folder Downloads user TANPA harus buka panel "Buat
// Laporan Keuangan Lengkap (18 Sheet)" di <HasilTerpadu> & klik generate
// manual dulu.
function unduhBase64Excel(base64, namaFile) {
  try {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = namaFile;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

// [MIGRASI] Di project Vite aslinya, <ClientProvider> dipasang SATU KALI
// di root App.jsx, membungkus seluruh routing (semua halaman berbagi
// context yang sama). Karena halaman ini sekarang berdiri sendiri di
// dalam Next.js (belum ada ClientProvider di level dashboard), dipasang
// lokal di sini supaya useClient() di dalam AgentAIChatInner & anak-
// anaknya tetap berfungsi. Kalau nanti data client MEMANG mau dibagi ke
// seluruh dashboard (bukan cuma halaman Agent AI ini), pindahkan
// <ClientProvider> ini ke src/app/layout.tsx (root layout) sekali saja.
// [UBAH -- login dihilangkan] <AuthProvider> dicabut -- Dashboard ini
// punya sistem login sendiri di level lain (lihat topbar: nama user,
// client aktif, dst), jadi halaman Agent AI ini tidak perlu login
// terpisah lagi. Backend (modules/auth.py::get_current_user) sudah
// disesuaikan supaya tidak lagi menolak request tanpa token -- lihat
// catatan di sana.
export default function AgentAIChat() {
  return (
    <ClientProvider>
      <AgentAIChatInner />
    </ClientProvider>
  );
}

function AgentAIChatInner() {
  // [FIX -- riwayat percakapan ASLI] Sebelumnya conversations cuma array
  // hardcode 1 item palsu ("Faktur Pajak Juli") yang tidak pernah
  // terhubung ke backend sama sekali -- klik/hapus di sidebar cuma
  // ubah-ubah state lokal, tidak pernah benar-benar membuka obrolan lama.
  // Backend (db_client.py: Percakapan/PesanChat, main.py: /api/percakapan)
  // ternyata SUDAH lengkap dipersiapkan untuk fitur ini -- di sini tinggal
  // disambungkan: daftarPercakapan = daftar riwayat utk sidebar,
  // activePercakapanId = percakapan yang lagi dibuka/diketik (null berarti
  // "obrolan baru", belum tersimpan sebagai baris di DB sampai pesan
  // pertama benar-benar dikirim -- sama seperti perilaku ChatGPT/Claude).
  const [daftarPercakapan, setDaftarPercakapan] = useState([]);
  const [activePercakapanId, setActivePercakapanId] = useState(null);

  // [FIX] Sebelumnya halaman ini fetch clients & simpan activeClientId
  // SENDIRI (leftover dari sebelum ClientContext ada), lalu coba
  // dioper ke <Sidebar clients=... activeClientId=... onSelectClient=.../>
  // -- padahal Sidebar TIDAK PERNAH menerima/menampilkan props itu (lihat
  // Sidebar.jsx, tidak ada di parameter destructuring-nya), jadi user
  // TIDAK PERNAH punya cara memilih client di halaman chat ini.
  // activeClientId selalu null, artinya hasil upload tidak pernah
  // tersimpan ke riwayat client manapun walau sudah "[FIX]" dikirim ke
  // backend. Sekarang pakai useClient() -- context GLOBAL yang sama
  // dipakai <ClientSwitcher/> di layout -- supaya client yang aktif di
  // seluruh app juga otomatis aktif di sini.
  const { activeClientId } = useClient();

  // [BARU -- ArtifactPanel] Panel geser di kanan, dipakai SATU state utk
  // SEMUA sumber file yang bisa diklik dalam obrolan ini:
  //  1. Chip file di bubble USER (file yang diupload user)
  //  2. Chip file di bubble ASSISTANT (file yang DIBUAT AI, mis. laporan
  //     14-sheet yang otomatis di-generate saat upload batch selesai --
  //     lihat handleSend, blok `hasilBatch.laporan_14_sheet`)
  //  3. Kartu "Buat Laporan Keuangan Lengkap (18 Sheet)" di <HasilTerpadu>
  // Ketiganya cukup panggil bukaArtifactPanel(namaFile, meta?) yang sama
  // -- persis seperti panel "artifact" Claude: apa pun file yang
  // ditawarkan AI, kotaknya klik-able dan buka panel yang sama di kanan.
  //
  // [FIX -- animasi geser halus, bukan "blink"] Dulu ada 1 state
  // (artifactAktif: objek | null) yang SEKALIGUS dipakai utk (a) isi
  // panel DAN (b) apakah <ArtifactPanel/> dirender sama sekali --
  // begitu ditutup, komponennya langsung di-unmount total dari DOM,
  // jadi tidak ada apa pun yang bisa dianimasikan CSS-nya (elemen
  // hilang instan, .main-container melompat ke lebar penuh instan).
  //
  // Sekarang dipecah jadi 2 state terpisah:
  //  - artifactAktif: ISI panel (title/meta) -- SENGAJA tidak pernah
  //    di-reset ke null saat ditutup, cuma diganti saat file BARU
  //    dibuka. Ini murni supaya selama animasi menutup (~0.48s, lihat
  //    ArtifactPanel.css) judul lama masih ada di DOM, tidak "berkedip
  //    kosong" duluan sebelum lebarnya benar-benar menciut ke 0.
  //  - artifactOpen: true/false -- SATU-SATUNYA yang menentukan
  //    lebar/visibilitas panel (lihat prop `open` di <ArtifactPanel/>
  //    & class `.artifact-panel--open` di CSS-nya).
  const [artifactAktif, setArtifactAktif] = useState(null); // { title, meta } | null -- isi panel
  const [artifactOpen, setArtifactOpen] = useState(false); // panel sedang terbuka/tertutup

  const bukaArtifactPanel = (namaFile, meta = "") => {
    setArtifactAktif({ title: namaFile, meta });
    setArtifactOpen(true);
  };

  const tutupArtifactPanel = () => {
    setArtifactOpen(false); // isi (artifactAktif) sengaja TIDAK direset di sini, lihat catatan di atas
  };

  const [npwp, setNpwp] = useState("");
  const [tarifPpn, setTarifPpn] = useState(0.11);
  const [messages, setMessages] = useState([]); // { role, text }
  const [resultsByCategory, setResultsByCategory] = useState({}); // { [kategori]: {ringkasan, masalah, draf_jurnal} }
  const [sending, setSending] = useState(false);

  // [BARU -- TOMBOL STOP] AbortController dari request yang SEDANG jalan
  // (chatStream utk teks, atau prosesFileBatch utk upload file) -- dibuat
  // ulang tiap kali handleSend mulai, disimpan di ref (bukan state) karena
  // cuma dipakai imperatif oleh handleStop, tidak perlu memicu render.
  // null berarti tidak ada request yang bisa di-stop saat ini.
  const abortControllerRef = useRef(null);

  // [BARU] Dipanggil saat user menekan tombol "Stop" di ChatComposer (cuma
  // muncul selama `sending` true). Membatalkan fetch yang sedang berjalan --
  // fetch() akan reject dengan DOMException("AbortError"), ditangkap secara
  // khusus di blok catch handleSend (lihat di bawah) supaya pesannya bilang
  // "dihentikan oleh pengguna", bukan ditampilkan sebagai error backend.
  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  // [BARU -- EFEK NGETIK] Groq (openai/gpt-oss-20b) generate JAUH lebih
  // cepat daripada DeepSeek (500-1000 token/detik) -- seringkali seluruh
  // jawaban selesai & terkirim dalam hitungan ratusan milidetik, sampai-
  // sampai browser cuma sempat 1-2 kali `reader.read()` sebelum stream
  // selesai. Kalau langsung setMessages() per potongan (perilaku lama),
  // semua update itu numpuk dalam satu-dua render React yang nyaris
  // bersamaan -- USER LIHAT "nunggu diam, lalu semua teks muncul
  // sekaligus", walau secara teknis backend tetap mengirim per-chunk.
  //
  // Fix: potongan yang datang dari stream TIDAK langsung ditulis ke state
  // -- ditampung dulu ke antrian (ref, bukan state, supaya tidak memicu
  // render tiap kali), lalu "diketik" ke layar oleh interval terpisah
  // dengan kecepatan TETAP (tidak tergantung seberapa cepat network
  // mengirim). Efeknya konsisten mirip ChatGPT/Claude baik provider-nya
  // Groq yang kilat maupun DeepSeek yang lebih pelan.
  const antrianKetikRef = useRef("");       // teks yang belum "diketik" ke layar
  const timerKetikRef = useRef(null);        // id dari setInterval yang aktif
  const streamSelesaiRef = useRef(false);    // true kalau semua potongan sudah diterima dari backend
  // [BARU] Callback yang dipanggil TEPAT saat efek ketik benar-benar tuntas
  // (semua karakter sudah muncul di layar DAN stream sudah selesai) --
  // dipakai handleSend untuk setSending(false) di waktu yang tepat, bukan
  // langsung setelah network request selesai (lihat mulaiEfekKetikJikaBelum).
  const onSelesaiKetikRef = useRef(null);

  // [BARU -- SCROLL PESAN USER KE ATAS LAYAR] Meniru perilaku claude.ai:
  // begitu user kirim pesan baru, layar otomatis scroll supaya bubble
  // pesan user itu berada di BAGIAN ATAS viewport, lalu jawaban assistant
  // "mengisi" ruang di bawahnya sambil di-generate (streaming) -- bukan
  // scroll ke paling bawah seperti chat app pada umumnya. Efeknya: user
  // bisa langsung baca jawaban dari awal tanpa pertanyaannya sendiri
  // "tertendang" keluar layar oleh jawaban yang panjang.
  //
  // pesanRefs menyimpan node DOM tiap bubble (diisi lewat callback ref di
  // JSX render, indexnya sama dengan index di array `messages`).
  // jumlahPesanUserRef melacak berapa pesan role "user" yang SUDAH pernah
  // dipicu scroll-nya, supaya efek ini hanya jalan saat ADA pesan user
  // BARU (bukan tiap kali `messages` berubah karena alasan lain, mis.
  // efek ngetik assistant yang juga panggil setMessages tiap tick).
  const pesanRefs = useRef([]);
  const jumlahPesanUserRef = useRef(0);

  useEffect(() => {
    const indexPesanUser = [];
    messages.forEach((m, i) => {
      if (m.role === "user") indexPesanUser.push(i);
    });
    if (indexPesanUser.length > jumlahPesanUserRef.current) {
      const indexTerbaru = indexPesanUser[indexPesanUser.length - 1];
      const el = pesanRefs.current[indexTerbaru];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    jumlahPesanUserRef.current = indexPesanUser.length;
  }, [messages]);
  const KECEPATAN_KETIK_MS = 15;             // jeda antar "ketikan", ms -- makin kecil makin cepat
  const KARAKTER_PER_KETIK = 3;              // jumlah karakter yang muncul tiap tick

  const hentikanEfekKetik = () => {
    if (timerKetikRef.current) {
      clearInterval(timerKetikRef.current);
      timerKetikRef.current = null;
    }
    antrianKetikRef.current = "";
    streamSelesaiRef.current = false;
    onSelesaiKetikRef.current = null;
  };

  // Bersihkan interval efek-ketik kalau halaman ini di-unmount di tengah
  // stream masih jalan (mis. user pindah halaman) -- mencegah memory leak
  // & "Can't perform a React state update on an unmounted component".
  useEffect(() => {
    return () => hentikanEfekKetik();
  }, []);

  const mulaiEfekKetikJikaBelum = () => {
    if (timerKetikRef.current) return; // sudah jalan, tidak perlu interval baru
    timerKetikRef.current = setInterval(() => {
      if (antrianKetikRef.current.length === 0) {
        if (streamSelesaiRef.current) {
          // Semua sudah diketik & stream sudah selesai -- berhenti, lalu
          // panggil callback (kalau ada) supaya pemanggil (handleSend) tahu
          // efek ketik benar-benar tuntas -- dipakai utk buka kunci
          // composer (setSending(false)) tepat saat ini, bukan lebih awal.
          clearInterval(timerKetikRef.current);
          timerKetikRef.current = null;
          const selesai = onSelesaiKetikRef.current;
          onSelesaiKetikRef.current = null;
          selesai?.();
        }
        return; // antrian kosong tapi stream belum selesai -- tunggu potongan berikutnya
      }
      const potonganTampil = antrianKetikRef.current.slice(0, KARAKTER_PER_KETIK);
      antrianKetikRef.current = antrianKetikRef.current.slice(KARAKTER_PER_KETIK);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const salinan = [...prev];
        const pesanTerakhir = salinan[salinan.length - 1];
        salinan[salinan.length - 1] = {
          ...pesanTerakhir,
          text: (pesanTerakhir.text || "") + potonganTampil,
          // [BARU] Karakter jawaban ASLI sudah mulai muncul -- status
          // "Thinking" (kalau ada) tidak relevan lagi, dihapus di sini.
          status: undefined,
        };
        return salinan;
      });
    }, KECEPATAN_KETIK_MS);
  };
  // [BARU] Progress step-by-step per file yang sedang diproses lewat
  // /api/proses-file/stream -- satu entri per file, dihapus otomatis
  // beberapa detik setelah selesai (lihat handleSend).
  const [prosesFiles, setProsesFiles] = useState([]); // [{ id, fileName, steps, selesai }]

  // [BARU] Status provider AI (badge "AI DeepSeek"/"AI Claude" di Sidebar) --
  // sebelumnya aiActive di-hardcode `true` (lihat pemakaian <Sidebar> di
  // bawah), jadi badge selalu hijau tanpa peduli DEEPSEEK_API_KEY/
  // ANTHROPIC_API_KEY beneran terisi atau tidak. Sekarang diambil dari
  // GET /api/health (lihat api.ambilStatusAI()) sekali saat halaman ini
  // mount, plus di-refresh tiap 60 detik supaya kalau key ditambah/dicabut
  // di .env lalu server di-restart, badge ikut update tanpa perlu reload
  // manual halaman React-nya.
  const [statusAI, setStatusAI] = useState({ aiActive: false, claudeActive: false });

  useEffect(() => {
    let dibatalkan = false;
    async function muatStatusAI() {
      try {
        const res = await api.ambilStatusAI();
        if (!dibatalkan) {
          setStatusAI({ aiActive: !!res.ai_aktif, claudeActive: !!res.claude_aktif });
        }
      } catch {
        // Diam-diam biarkan default (false) kalau backend belum jalan --
        // badge akan tampil NONAKTIF, sesuai kondisi sebenarnya.
      }
    }
    muatStatusAI();
    const interval = setInterval(muatStatusAI, 60000);
    return () => {
      dibatalkan = true;
      clearInterval(interval);
    };
  }, []);

  // [BARU] Checklist "Deteksi & pencegahan kesalahan" (7 pengecekan utk
  // data Pembelian PO/Invoice) -- muncul otomatis begitu kategori
  // "pembelian" selesai diproses (lihat handleSend). hasilDeteksiKesalahan
  // menampung respons /api/client/{id}/deteksi-kesalahan-pembelian setelah
  // user memilih item & menekan "Kerjakan sekarang".
  const [showChecklistPembelian, setShowChecklistPembelian] = useState(false);
  const [hasilDeteksiKesalahan, setHasilDeteksiKesalahan] = useState(null);
  const [runningDeteksiKesalahan, setRunningDeteksiKesalahan] = useState(false);

  // [FIX -- selalu mulai obrolan baru] Sebelumnya effect ini menarik ulang
  // riwayat hasil lewat api.riwayatHasilClient() dan mengisi ulang
  // resultsByCategory dengan hasil TERAKHIR yang pernah diproses client
  // ini -- akibatnya begitu app dibuka lagi (activeClientId otomatis
  // dimuat balik dari localStorage oleh ClientContext) ATAU client
  // di-switch, kartu-kartu hasil dari sesi sebelumnya langsung muncul
  // lagi, terasa seperti masih di "obrolan lama". Effect ini juga cuma
  // reset resultsByCategory -- messages/prosesFiles/checklist ikut
  // kebawa dari client sebelumnya.
  //
  // Sekarang effect ini SELALU reset total state percakapan (bukan fetch
  // riwayat lagi) tiap kali activeClientId berubah -- termasuk pada mount
  // pertama, karena activeClientId ikut berubah begitu ClientContext
  // selesai memuat client tersimpan. Riwayat lengkap tetap bisa dibuka
  // manual lewat halaman "Riwayat" (RiwayatClientPage), bukan otomatis
  // ditampilkan lagi sebagai kelanjutan chat.
  // [BARU] Muat ulang daftar riwayat percakapan (sidebar "Chat History")
  // milik client yang aktif. GET /api/percakapan di backend digerbang
  // minimal level Supervisor (tahap_3) -- role di bawah itu akan dapat
  // 403, sengaja ditangkap di sini supaya sidebar cuma tampil kosong,
  // bukan bikin seluruh halaman chat ikut error.
  const muatDaftarPercakapan = async (clientId) => {
    try {
      const res = await api.daftarPercakapan(clientId, "client");
      setDaftarPercakapan(res.percakapan || []);
    } catch {
      setDaftarPercakapan([]);
    }
  };

  useEffect(() => {
    setMessages([]);
    setResultsByCategory({});
    setProsesFiles([]);
    setShowChecklistPembelian(false);
    setHasilDeteksiKesalahan(null);
    setRunningDeteksiKesalahan(false);
    setActivePercakapanId(null);
    muatDaftarPercakapan(activeClientId);
  }, [activeClientId]);

  const isLanding = messages.length === 0;

  // [FIX -- chat teks tidak boleh munculkan panel riwayat lama] Sebelumnya
  // HasilTerpadu (Live Dashboard/Saran Cerdas/panel 18-Sheet) cuma
  // disembunyikan lewat `isLanding || sending` -- itu cukup untuk kasus
  // UPLOAD FILE, tapi begitu user kirim CHAT TEKS BIASA (tanpa upload),
  // `isLanding` langsung jadi false dan `sending` balik false setelah AI
  // selesai jawab, jadi clientId tetap ke-pass ke HasilTerpadu. Komponen
  // itu sendiri (lihat HasilTerpadu.jsx) menarik Live Dashboard & Saran
  // Cerdas dari SELURUH RIWAYAT TERSIMPAN client di database begitu
  // clientId terisi -- BUKAN dari resultsByCategory sesi ini -- jadi
  // angka/panel dari obrolan-obrolan lama client itu ikut nongol lagi
  // meski obrolan yang sedang berjalan ini baru & belum upload apa-apa.
  //
  // Sekarang panel itu cuma ditampilkan kalau memang ADA hasil yang
  // benar-benar diproses DI SESI OBROLAN INI (resultsByCategory berisi
  // minimal satu kategori dengan hasil non-null) -- chat teks tanpa
  // upload file tidak lagi memicu panel riwayat lama muncul.
  const adaHasilSesiIni = Object.values(resultsByCategory).some((h) => h != null);

  const handleSend = async (text, files) => {
    if (!text && files.length === 0) return;
    setMessages((prev) => [...prev, { role: "user", text, files: files.map((f) => f.name) }]);

    if (files.length === 0) {
      // [BARU] Kunci composer (tidak bisa kirim pesan/upload lagi) selama
      // AI masih memproses & menulis jawaban -- sebelumnya `sending` cuma
      // di-set di jalur upload file, jadi chat teks biasa tidak pernah
      // mengunci composer sama sekali. setSending(false) dipanggil lewat
      // onSelesaiKetikRef, TEPAT saat efek ketik selesai menulis semua
      // karakter ke layar (lihat mulaiEfekKetikJikaBelum), bukan langsung
      // setelah network request selesai.
      setSending(true);

      // [FIX] Sebelumnya balasan hardcode "Baik, ada yang bisa dibantu lagi?"
      // -- sekarang benar-benar manggil /api/chat/stream (DeepSeek, streaming)
      // lewat api.chatStream(), dengan efek ngetik kata-per-kata.
      // TODO: kalau text diawali "/" (mis. "/prediksi", "/anomali"), itu jalur
      // command di app.py (lihat proses_pesan_chat()) -- belum ditangani di sini.

      // riwayat dikirim dalam format {role, content} sesuai PesanRiwayat di main.py
      const riwayat = messages.map((m) => ({ role: m.role, content: m.text }));

      // [BARU] Ringkasan data yang sudah diproses di obrolan ini, dikirim
      // ke backend supaya AI bisa jawab dengan konteks (mis. "kenapa ada
      // yang perlu direview di faktur pajak saya?") -- bukan jawab buta
      // sama sekali soal data yang barusan diupload.
      const ringkasanData = Object.entries(resultsByCategory)
        .filter(([, hasil]) => hasil != null)
        .map(([kategori, hasil]) => {
          const label = DOCUMENT_TYPES[kategori]?.label || kategori;
          const jumlahBaris = hasil.draf_jurnal?.length ?? 0;
          const jumlahMasalah = hasil.masalah?.length ?? 0;
          return `${label}: ${jumlahBaris} baris diproses, ${jumlahMasalah} perlu direview`;
        });

      // [BARU] Bubble assistant kosong dulu dengan status "Thinking" --
      // sebelum ini, layar diam total sampai token pertama sampai (apalagi
      // sekarang pakai gpt-oss-20b yang reasoning dulu sebelum jawab).
      // "status" otomatis dihapus begitu karakter pertama benar-benar
      // "diketik" ke layar (lihat mulaiEfekKetikJikaBelum di atas), lalu
      // digantikan teks jawaban asli.
      // [BARU -- TRANSPARANSI PROSES] `steps` menampung daftar langkah
      // proses AI yang dikirim backend lewat event "step" (lihat
      // api.chatStream & main.py::chat_stream) -- dirender di atas teks
      // jawaban lewat <ProcessingSteps/>, mirip panel "Menjalankan N
      // perintah..." ala Claude Code. Kosong di awal, diisi bertahap
      // begitu event step masuk (lihat loop for-await di bawah).
      setMessages((prev) => [...prev, { role: "assistant", text: "", status: "Thinking", steps: [] }]);

      // [BARU] Percakapan baru belum punya baris di DB sampai pesan
      // PERTAMA benar-benar dikirim (activePercakapanId masih null) --
      // dibuat di sini secara lazy, bukan begitu user klik "Obrolan Baru",
      // supaya tidak ada baris kosong "Percakapan Baru" menumpuk di
      // sidebar tiap kali tombol itu ditekan tanpa jadi ngobrol.
      // Pakai variabel lokal (bukan langsung baca activePercakapanId)
      // karena setActivePercakapanId belum tentu ke-apply sebelum
      // chatStream() di bawah dipanggil (setState di React itu async).
      let percakapanIdUntukPesanIni = activePercakapanId;
      if (percakapanIdUntukPesanIni == null) {
        try {
          const baru = await api.buatPercakapan(activeClientId);
          percakapanIdUntukPesanIni = baru.id;
          setActivePercakapanId(baru.id);
        } catch (e) {
          // Gagal buat baris percakapan (mis. DB down) tidak boleh
          // menggagalkan chat itu sendiri -- lanjut tanpa persistensi,
          // cuma tidak akan muncul di riwayat sidebar nanti.
          console.error("Gagal membuat percakapan baru:", e);
        }
      }

      // Reset antrian efek-ketik sebelum stream baru mulai -- jaga-jaga
      // ada sisa dari percakapan sebelumnya yang belum sempat kosong.
      hentikanEfekKetik();

      // [BARU -- TOMBOL STOP] Controller baru utk request ini -- signal-nya
      // diteruskan ke api.chatStream() supaya fetch bisa dibatalkan lewat
      // handleStop().
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // [BARU -- TRANSPARANSI PROSES] Update daftar steps di bubble
      // assistant TERAKHIR (yang barusan ditambahkan di atas). Dipisah
      // jadi fungsi kecil supaya loop for-await di bawah tetap ringkas.
      // Kalau step dengan id yang sama sudah ada (mis. "processing" lalu
      // "done" untuk step "konteks"), yang lama diganti -- bukan
      // ditambah duplikat.
      const perbaruiStepBubbleTerakhir = (evtStep) => {
        setMessages((prev) => {
          const copy = [...prev];
          const idxTerakhir = copy.length - 1;
          const last = copy[idxTerakhir];
          if (!last || last.role !== "assistant") return prev;
          const stepsLama = (last.steps || []).filter((s) => s.step !== evtStep.step);
          copy[idxTerakhir] = {
            ...last,
            steps: [...stepsLama, { step: evtStep.step, label: evtStep.label, status: evtStep.status }],
          };
          return copy;
        });
      };

      try {
        // [FIX -- lihat catatan efek ngetik di atas] Potongan teks dari
        // backend TIDAK langsung ditulis ke state -- ditampung ke
        // antrianKetikRef, lalu interval terpisah (mulaiEfekKetikJikaBelum)
        // yang menulis ke layar dengan kecepatan tetap. Ini yang memberi
        // efek "mengetik" konsisten meski Groq mengirim seluruh jawaban
        // dalam sekejap.
        //
        // [BARU -- TRANSPARANSI PROSES] api.chatStream() sekarang yield
        // OBJECT ({ type: "delta"|"step", ... }) alih-alih string mentah
        // -- lihat api.js. Event "step" diteruskan ke
        // perbaruiStepBubbleTerakhir() supaya <ProcessingSteps/> di
        // bubble ini ikut ter-update real-time; event "delta" tetap
        // masuk ke antrian efek-ketik seperti sebelumnya.
        for await (const evt of api.chatStream(text, riwayat, ringkasanData, activeClientId, percakapanIdUntukPesanIni, controller.signal)) {
          if (evt.type === "step") {
            perbaruiStepBubbleTerakhir(evt);
            continue;
          }
          // evt.type === "delta"
          antrianKetikRef.current += evt.text;
          mulaiEfekKetikJikaBelum();
        }
        streamSelesaiRef.current = true; // biar interval berhenti sendiri begitu antrian habis
        abortControllerRef.current = null; // selesai normal -- tidak ada lagi yang bisa di-stop
        // [BARU] Judul percakapan di-auto-generate backend dari pesan
        // pertama (lihat main.py::chat_stream) -- refresh daftar sidebar
        // supaya "Percakapan Baru" langsung berganti jadi judul aslinya,
        // dan percakapan baru ini naik ke posisi teratas.
        if (percakapanIdUntukPesanIni != null) {
          muatDaftarPercakapan(activeClientId);
        }

        // [BARU] Buka kunci composer TEPAT saat efek ketik tuntas -- kalau
        // interval masih jalan (kasus normal, masih ada sisa karakter yang
        // belum "diketik"), titip callback yang akan dipanggil begitu
        // interval berhenti sendiri (lihat mulaiEfekKetikJikaBelum). Kalau
        // interval sudah tidak jalan sama sekali (mis. jawaban kosong),
        // tidak ada yang perlu ditunggu -- buka kunci sekarang juga.
        if (timerKetikRef.current) {
          onSelesaiKetikRef.current = () => setSending(false);
        } else {
          setSending(false);
        }
      } catch (e) {
        // Error -- hentikan efek ketik & antrian yang mungkin masih
        // tertunda, langsung tampilkan pesan error apa adanya (tidak perlu
        // diketik pelan-pelan).
        hentikanEfekKetik();
        abortControllerRef.current = null;
        // [BARU -- TOMBOL STOP] User yang membatalkan sendiri (bukan error
        // backend/network) -- fetch reject dengan nama "AbortError" persis
        // begini baik di Chrome/Firefox/Safari. Pesannya dibedakan supaya
        // tidak kelihatan seperti bug/kegagalan.
        const teksBerhenti = e.name === "AbortError";
        setMessages((prev) => {
          const salinan = [...prev];
          salinan[salinan.length - 1] = teksBerhenti
            ? { role: "assistant", text: "⏹️ Dihentikan." }
            : { role: "assistant", text: `⚠️ ${e.message}` };
          return salinan;
        });
        setSending(false);
      }
      return;
    }

    setSending(true);
    const gagal = [];
    const kategoriBaru = [];
    // [BARU] Simpan hasil mentah per kategori yang baru selesai diproses di
    // upload ini (bukan resultsByCategory -- itu state, tidak langsung
    // ke-update sinkron di dalam loop yang sama), supaya bisa dipakai
    // menyusun pesan proaktif di bawah tanpa panggil ulang API.
    const hasilPerKategoriBaru = {};

    // [FIX - upload banyak file sekaligus] Sebelumnya di sini ada loop
    // `for (const file of files)` yang memproses file SATU-SATU lewat
    // prosesFileStream() -- tiap file dikirim & diproses lepas dari file
    // lain, jadi AI tidak pernah "melihat" ke-6 file itu sebagai satu
    // batch. Akibatnya: tidak ada rencana pemrosesan yang disusun dulu
    // (mis. Aset Tetap/Piutang diproses lebih dulu sebelum Rekening
    // Koran, supaya bisa dicocokkan), tidak ada cross-matching otomatis
    // Rekening Koran <-> Buku Bantu Piutang, dan kalau user upload jenis
    // dokumen yang sama 2x tidak ada peringatan potensi duplikat lintas
    // file. Backend SUDAH punya endpoint utk ini
    // (POST /api/client/{client_id}/proses-file-batch, lihat main.py)
    // yang melakukan tahap DETEKSI -> RENCANA -> EKSEKUSI -> cross-
    // matching sekaligus untuk semua file dalam SATU request -- di sini
    // sekarang dipanggil lewat api.prosesFileBatch().
    //
    // client_id WAJIB untuk endpoint batch ini (beda dari prosesFile()/
    // prosesFileStream() yang boleh tanpa client) -- kalau belum ada
    // client aktif, tidak ada tempat menyimpan hasil & jurnalnya, jadi
    // di sini diminta pilih client dulu alih-alih diam-diam gagal.
    if (!activeClientId) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            "⚠️ Pilih client dulu di sidebar sebelum upload banyak file sekaligus, supaya aku bisa " +
            "menyusun rencana pemrosesan & hasilnya tersimpan ke riwayat client yang benar.",
        },
      ]);
      setSending(false);
      return;
    }

    const idProsesBatch = `batch-${Date.now()}`;
    setProsesFiles((prev) => [
      ...prev,
      {
        id: idProsesBatch,
        fileName: `${files.length} file`,
        // [BARU -- TRANSPARANSI PROSES] Kosong di awal -- diisi bertahap
        // begitu event "progress" masuk lewat api.prosesFileBatchStream()
        // di bawah, dimulai dari step "baca_file" (lihat main.py::
        // proses_file_batch_stream). Sebelumnya di sini ada 1 step
        // statis "Menganalisa & memproses semua file..." yang tidak
        // pernah berubah sampai semuanya selesai -- sekarang user lihat
        // tiap tahap SATU PER SATU, persis panel "Menjalankan N
        // perintah..." ala Claude Code.
        steps: [],
        selesai: false,
      },
    ]);

    // [BARU -- TOMBOL STOP] Controller baru utk batch ini -- signal-nya
    // diteruskan ke api.prosesFileBatch() supaya request bisa dibatalkan
    // lewat handleStop() selama masih diproses backend.
    const controllerBatch = new AbortController();
    abortControllerRef.current = controllerBatch;

    // [BARU -- TRANSPARANSI PROSES] Update daftar steps di kartu
    // ProcessingSteps untuk batch upload ini. Kalau step dengan id yang
    // sama sudah ada (mis. "baca_file" "processing" lalu "done"), yang
    // lama diganti -- bukan ditambah duplikat. Pola yang SAMA dengan
    // perbaruiStepBubbleTerakhir() di handleSend (chat teks) di atas,
    // cuma target state-nya prosesFiles, bukan messages.
    const perbaruiStepProsesBatch = (evt) => {
      setProsesFiles((prev) => prev.map((p) => {
        if (p.id !== idProsesBatch) return p;
        const stepsLama = p.steps.filter((s) => s.step !== evt.step);
        return {
          ...p,
          steps: [...stepsLama, { step: evt.step, label: evt.label, status: evt.status, pesan: evt.pesan }],
        };
      }));
    };

    try {
      // [BARU -- TRANSPARANSI PROSES] api.prosesFileBatchStream()
      // menggantikan api.prosesFileBatch() -- alih-alih menunggu SATU
      // Promise sampai semuanya selesai, di sini setiap event "progress"
      // (mulai dari "baca_file" -- file yang baru diterima dari user --
      // sampai ke sub-tahap generate laporan 18-sheet) langsung
      // memperbarui kartu ProcessingSteps di layar. Event "result" (di
      // akhir stream) berisi data YANG SAMA PERSIS dengan return value
      // prosesFileBatch() lama, jadi seluruh logic di bawah ini (baca
      // hasilBatch.rencana/hasil_per_file/dst) TIDAK PERLU berubah.
      let hasilBatch = null;
      for await (const evt of api.prosesFileBatchStream(files, activeClientId, undefined, false, controllerBatch.signal)) {
        if (evt.type === "progress") {
          perbaruiStepProsesBatch(evt);
        } else if (evt.type === "error") {
          throw new Error(evt.pesan || "Gagal memproses batch file.");
        } else if (evt.type === "result") {
          hasilBatch = evt;
        }
      }
      if (!hasilBatch) {
        throw new Error("Stream selesai tanpa hasil akhir dari server.");
      }
      abortControllerRef.current = null; // selesai normal

      setProsesFiles((prev) => prev.map((p) => (p.id === idProsesBatch ? { ...p, selesai: true } : p)));

      // [BARU] Tampilkan rencana yang disusun backend SEBELUM hasil --
      // ini bagian yang bikin AI kelihatan "menganalisa dulu apa yang
      // harus dilakukan", bukan langsung lempar hasil tanpa konteks.
      if (hasilBatch.rencana?.length > 0) {
        const teksRencana = hasilBatch.rencana
          .map((l) => {
            const jenis =
              l.jenis_terdeteksi.length > 0
                ? l.jenis_terdeteksi.map((k) => DOCUMENT_TYPES[k]?.label || k).join(", ")
                : "tidak dikenali";
            return `${l.urutan}. "${l.nama_file}" → ${jenis}`;
          })
          .join("\n");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `📋 Rencana pemrosesan ${files.length} file:\n${teksRencana}` },
        ]);
      }

      for (const hasilFile of hasilBatch.hasil_per_file || []) {
        if (hasilFile.error || hasilFile.tidak_terdeteksi) {
          gagal.push(`"${hasilFile.nama_file}": ${hasilFile.error || hasilFile.pesan || "jenis dokumen tidak dikenali."}`);
          continue;
        }
        for (const [jenisDokumen, hasil] of Object.entries(hasilFile.hasil || {})) {
          setResultsByCategory((prev) => ({ ...prev, [jenisDokumen]: hasil }));
          kategoriBaru.push(jenisDokumen);
          hasilPerKategoriBaru[jenisDokumen] = hasil;
        }
      }

      // [BARU] Cross-matching lintas file (Rekening Koran <-> Buku Bantu
      // Piutang) sudah dijalankan backend kalau dua-duanya ada di batch
      // ini -- kabari hasilnya, bukan cuma diam-diam tersimpan.
      if (hasilBatch.cross_matching?.dilakukan) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              `🔗 Rekening Koran & Buku Bantu Piutang otomatis dicocokkan: ` +
              `${hasilBatch.cross_matching.jumlah_baris_bank_cocok_ke_piutang} baris mutasi bank ` +
              `berhasil ditautkan ke invoice piutang.`,
          },
        ]);
      }

      // [BARU] Kertas Kerja (working paper) -- file .pdf dalam batch ini
      // DIPISAH & digabung backend jadi satu working paper lewat
      // kertas_kerja.generate_kertas_kerja() (lihat main.py::
      // proses_file_batch, field respons "kertas_kerja"), BUKAN lagi ikut
      // "diklasifikasi jadi jurnal + auto laporan lengkap" seperti dokumen
      // Excel lainnya -- PDF rekening koran memang butuh dikoreksi dulu
      // lewat working paper sebelum laporan final digenerate, bukan
      // langsung jadi dari klasifikasi mentah AI.
      if (hasilBatch.kertas_kerja) {
        const kk = hasilBatch.kertas_kerja;
        if (kk.file_base64) {
          const berhasilUnduh = unduhBase64Excel(kk.file_base64, kk.nama_file);
          const jumlahTransaksi = kk.ringkasan?.jumlah_transaksi;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text:
                (berhasilUnduh
                  ? `📊 Kertas Kerja Laporan Keuangan tahun ${kk.tahun} berhasil dibuat & diunduh: ${kk.nama_file}`
                  : `📊 Kertas Kerja Laporan Keuangan tahun ${kk.tahun} berhasil dibuat, tapi browser gagal auto-download -- unduh manual dari sini.`) +
                (jumlahTransaksi ? ` (${jumlahTransaksi} transaksi diklasifikasi)` : "") +
                "\n\nCek kolom \"Status Validasi\" di sheet GL untuk baris yang masih perlu dikoreksi manual sebelum laporan final digenerate.",
              // [BARU] Object kaya (bukan cuma nama file) supaya
              // ChatBubble render kartu besar (ikon+subtitle+tombol
              // Unduh), sama seperti kartu laporan_18_sheet di bawah --
              // sebelumnya cuma string nama file -> jatuh ke chip pil
              // kecil TANPA tombol Unduh sama sekali.
              files: [{
                nama: kk.nama_file,
                tipe: "Excel",
                sheetInfo: `${kk.jumlah_sheet || 14} Sheet`,
                base64: kk.file_base64,
              }],
            },
          ]);
          if (kk.peringatan?.length > 0) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `⚠️ ${kk.peringatan.length} peringatan dari proses kertas kerja:\n` + kk.peringatan.map((p) => `- ${p}`).join("\n") },
            ]);
          }
        } else if (kk.status === "gagal") {
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ Gagal membuat kertas kerja: ${kk.pesan}` }]);
        }
      }

      // [BARU] Laporan Keuangan 18-Sheet -- backend sudah AUTO-GENERATE
      // laporan ini di dalam respons batch yang sama (lihat main.py::
      // _auto_generate_laporan_18_sheet), jadi di sini TINGGAL diunduh
      // langsung, tanpa akuntan harus koreksi/posting manual dulu atau
      // buka panel terpisah untuk klik "Generate". Kalau ada data yang
      // memang belum ada sama sekali (mis. COA client masih kosong),
      // backend tidak memaksakan -- pesannya ditampilkan di sini supaya
      // user tahu persis file apa yang perlu diupload dulu.
      //
      // [FIX -- MISMATCH FIELD] Sebelumnya di sini dibaca
      // `hasilBatch.laporan_14_sheet` -- backend (main.py::
      // _auto_generate_laporan_18_sheet) sudah lama mengirim field
      // bernama `laporan_18_sheet`, BUKAN `laporan_14_sheet` (nama lama,
      // sisa sebelum backend di-rename dari 14 ke 18 sheet). Karena nama
      // field tidak pernah cocok, `hasilBatch.laporan_14_sheet` SELALU
      // `undefined` -> `|| []` -> array kosong -> blok ini TIDAK PERNAH
      // benar-benar jalan, walau backend sudah mengirim laporannya. Cukup
      // ganti nama field yang dibaca, logic di dalam loop tidak berubah.
      for (const lap of hasilBatch.laporan_18_sheet || []) {
        if (lap.status === "berhasil" && lap.file_base64) {
          const berhasilUnduh = unduhBase64Excel(lap.file_base64, lap.nama_file);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: berhasilUnduh
                ? `📊 Laporan Keuangan 18-Sheet tahun ${lap.tahun} otomatis dibuat & diunduh: ${lap.nama_file}`
                : `📊 Laporan Keuangan 18-Sheet tahun ${lap.tahun} berhasil dibuat, tapi browser gagal auto-download -- buka panel "Buat Laporan Keuangan Lengkap (18 Sheet)" di bawah untuk mengunduh manual.`,
              // [BARU] Kotak file yang bisa diklik (buka ArtifactPanel di
              // kanan) muncul di bawah pesan ini -- sama pola dengan chip
              // file upload user, lihat ChatBubble.jsx. Object kaya (bukan
              // cuma nama file) supaya dirender jadi kartu besar dgn
              // tombol "Unduh" sendiri, bukan cuma chip pil kecil.
              files: [{
                nama: lap.nama_file,
                tipe: "Excel",
                sheetInfo: "18 Sheet",
                base64: lap.file_base64,
              }],
            },
          ]);
        } else if (lap.status === "perlu_file") {
          setMessages((prev) => [...prev, { role: "assistant", text: `📎 ${lap.pesan}` }]);
        } else if (lap.status === "gagal") {
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ ${lap.pesan}` }]);
        }
      }
    } catch (e) {
      abortControllerRef.current = null;
      setProsesFiles((prev) => prev.map((p) => (p.id === idProsesBatch ? { ...p, selesai: true } : p)));
      // [BARU -- TOMBOL STOP] Sama seperti jalur chat teks -- bedakan
      // pembatalan manual dari error sungguhan supaya pesannya tidak
      // kelihatan seperti bug.
      if (e.name === "AbortError") {
        setMessages((prev) => [...prev, { role: "assistant", text: "⏹️ Dihentikan." }]);
      } else {
        gagal.push(`Upload batch gagal: ${e.message}`);
      }
    }

    setSending(false);
    // Kartu ringkas "selesai" dibiarkan kelihatan sebentar biar user
    // sempat lihat, baru dibersihkan dari layar.
    setTimeout(() => {
      setProsesFiles((prev) => prev.filter((p) => !p.selesai));
    }, 4000);

    if (kategoriBaru.length > 0) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Berikut hasil yang berhasil diproses:" },
      ]);
    }
    if (gagal.length > 0) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `⚠️ Gagal memproses ${gagal.length} file:\n` + gagal.map((g) => `- ${g}`).join("\n") },
      ]);
    }

    // [BARU] Data Pembelian (PO/Invoice) baru selesai diproses -- tawarkan
    // checklist "Deteksi & pencegahan kesalahan" (7 pengecekan, lihat
    // ChecklistPembelian.jsx / modules/deteksi_kesalahan_pembelian.py)
    // supaya akuntan langsung bisa pilih mau mulai dari mana.
    if (kategoriBaru.includes("pembelian")) {
      setHasilDeteksiKesalahan(null);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Deteksi & pencegahan kesalahan" },
      ]);
      setShowChecklistPembelian(true);
    }

    // [BARU] Rekonsiliasi Bank / AP Aging / Absensi -- beda dengan Pembelian,
    // ketiga jenis ini SUDAH melakukan validasi rule-based lengkap sendiri
    // saat diproses (lihat proses_rekonsiliasi_bank/proses_ap_aging/
    // proses_absensi di akuntansi_ai.py), jadi tidak perlu checklist
    // terpisah -- cukup pesan ringkas yang menonjolkan temuan paling
    // penting supaya akuntan langsung tahu ke mana harus lihat dulu di
    // <HasilTerpadu>, tanpa perlu buka satu-satu tab "Perlu Direview".
    const catatanProaktif = [];
    if (kategoriBaru.includes("rekonsiliasi_bank")) {
      const r = hasilPerKategoriBaru.rekonsiliasi_bank?.ringkasan || {};
      if ((r.jumlah_sheet_tidak_balance || 0) > 0) {
        catatanProaktif.push(
          `🏦 Rekonsiliasi Bank: ${r.jumlah_sheet_tidak_balance} dari ${r.jumlah_sheet_direkonsiliasi} rekening BELUM BALANCE -- ` +
          `buka tab "Rekonsiliasi Bank" → "Per Rekening" untuk lihat rekening mana saja & "Perlu Direview" untuk selisihnya.`
        );
      }
    }
    if (kategoriBaru.includes("ap_aging")) {
      const r = hasilPerKategoriBaru.ap_aging?.ringkasan || {};
      if ((r.jumlah_lewat_90_hari || 0) > 0) {
        catatanProaktif.push(
          `📑 AP Aging: ${r.jumlah_lewat_90_hari} invoice sudah lewat jatuh tempo >90 hari -- ` +
          `prioritas tinggi utk ditindaklanjuti, lihat tab "Buku Bantu Utang (AP Aging)" → "Tindak Lanjut".`
        );
      }
    }
    if (kategoriBaru.includes("absensi")) {
      const r = hasilPerKategoriBaru.absensi?.ringkasan || {};
      if ((r.total_alpha || 0) > 0) {
        catatanProaktif.push(
          `🕒 Absensi: tercatat ${r.total_alpha} alpha pada periode ini -- cek tab "Absensi/Timesheet" → "Perlu Direview", ` +
          `lalu cocokkan manual ke potongan di Slip Gaji periode yang sama.`
        );
      }
    }
    if (catatanProaktif.length > 0) {
      setMessages((prev) => [...prev, { role: "assistant", text: catatanProaktif.join("\n\n") }]);
    }

    // [BARU -- auto-posting] Setelah batch selesai, draf jurnal semua file
    // yang berhasil sudah masuk ke antrean "Jurnal Posting" (lihat
    // _proses_dan_simpan_satu_file di backend -- ditarik otomatis kecuali
    // rekening_koran yang butuh konfirmasi duplikat dulu).
    //
    // [FIX] Sebelumnya di sini CUMA pesan teks yang menyuruh user pindah ke
    // halaman "Laporan Keuangan" > "Jurnal Perlu Posting" untuk konfirmasi
    // manual satu-satu, baru generate laporan -- padahal backend SUDAH
    // punya endpoint konfirmasi MASSAL per hasil_id (lihat main.py::
    // api_konfirmasi_posting_massal) yang otomatis melewati baris dgn akun
    // placeholder (tetap aman, tidak pernah asal posting ke akun yang
    // belum jelas). Sekarang dipanggil di sini utk tiap hasil_id dari
    // kategori yg BARU diproses di batch ini -- supaya jurnal yang akunnya
    // sudah pasti langsung "terposting" tanpa mampir ke halaman lain, dan
    // panel "Buat Laporan Keuangan Lengkap (18 Sheet)" di <HasilTerpadu>
    // (selalu tampil begitu ada client aktif) langsung siap dipakai.
    if (kategoriBaru.length > 0 && activeClientId) {
      // [BARU] Data batch ini SUDAH tersimpan di backend untuk
      // `activeClientId` (draf jurnal dibuat sebelum blok ini jalan) --
      // kabari halaman lain (mis. Transaksi, kalau lagi dibuka di tab/
      // client yang sama) sekarang juga, tidak perlu tunggu hasil
      // auto-posting di bawah supaya baris "Unposted" pun langsung
      // kelihatan meski auto-posting gagal/tertunda.
      notifyClientDataChanged(activeClientId);
      try {
        const draftSaatIni = await api.daftarJurnalPosting(activeClientId, "draft");
        const hasilIdPerlu = [
          ...new Set(
            (draftSaatIni.jurnal || [])
              .filter((j) => kategoriBaru.includes(j.jenis_dokumen))
              .map((j) => j.hasil_id)
              .filter((id) => id != null)
          ),
        ];

        let totalDiposting = 0;
        let totalDilewati = 0;
        for (const hasilId of hasilIdPerlu) {
          try {
            const r = await api.konfirmasiPostingMassal(activeClientId, hasilId);
            totalDiposting += r.diposting || 0;
            totalDilewati += r.dilewati_placeholder || 0;
          } catch {
            // satu hasil_id gagal (mis. race condition) tidak boleh
            // menggagalkan sisanya -- lanjut ke hasil_id berikutnya.
          }
        }

        const bagianPosting =
          totalDiposting > 0
            ? `✅ ${totalDiposting} baris jurnal otomatis diposting.`
            : "";
        const bagianPlaceholder =
          totalDilewati > 0
            ? `${totalDiposting > 0 ? " " : ""}⚠️ ${totalDilewati} baris masih perlu akun manual (masih placeholder) -- ` +
              `buka "Laporan Keuangan" → "Jurnal Perlu Posting" untuk melengkapinya.`
            : "";

        if (bagianPosting || bagianPlaceholder) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: (bagianPosting + bagianPlaceholder).trim() },
          ]);
        }
        // [BARU] Status jurnal baru saja berubah lagi (draft -> posted) --
        // kabari ulang supaya kolom "Status" di tabel Transaksi ikut
        // update, bukan cuma baris barunya saja yang muncul.
        if (totalDiposting > 0) {
          notifyClientDataChanged(activeClientId);
        }
        // [FIX] Sebelumnya di sini ada pesan tambahan "📊 Laporan Keuangan
        // Lengkap (18 Sheet) siap dibuat -- lihat panel di bawah." begitu
        // totalDiposting > 0 -- sekarang MENYESATKAN karena laporan
        // 14-sheet-nya sudah otomatis dibuat & diunduh lebih awal (lihat
        // blok "laporan_14_sheet" di atas), sebelum baris ini sempat
        // jalan. Dihapus supaya tidak ada pesan ganda/basi yang menyuruh
        // user buka panel & klik generate manual padahal filenya sudah
        // ada di Downloads.
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `⚠️ Gagal memposting otomatis: ${e.message}. Buka "Laporan Keuangan" → "Jurnal Perlu Posting" untuk posting manual.` },
        ]);
      }
    }
  };

  // [BARU] Dipanggil saat user menekan "Kerjakan sekarang" di
  // <ChecklistPembelian>. Menjalankan pengecekan yang dicentang lewat
  // /api/client/{id}/deteksi-kesalahan-pembelian, lalu menampilkan
  // hasilnya lewat <DeteksiKesalahanResults>.
  const handleSubmitChecklistPembelian = async (checks) => {
    setShowChecklistPembelian(false);
    if (!activeClientId) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "⚠️ Pilih client dulu di sidebar sebelum menjalankan pengecekan ini, supaya hasilnya tahu data pembelian milik siapa yang mau dicek." },
      ]);
      return;
    }
    setRunningDeteksiKesalahan(true);
    setMessages((prev) => [...prev, { role: "assistant", text: "🔍 Menjalankan pengecekan yang dipilih..." }]);
    try {
      const hasil = await api.deteksiKesalahanPembelian(activeClientId, checks);
      setHasilDeteksiKesalahan(hasil);
      setMessages((prev) => [...prev, { role: "assistant", text: "Selesai! Berikut hasilnya:" }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ Gagal menjalankan pengecekan: ${e.message}` }]);
    } finally {
      setRunningDeteksiKesalahan(false);
    }
  };

  // [BARU] User pilih "Something else" di checklist -- kirim sbg pesan
  // chat biasa (masuk jalur /api/chat/stream yang sudah ada) supaya AI
  // bisa menjawab bebas sesuai permintaan, bukan salah satu dari 7 kode
  // pengecekan tetap.
  const handleSomethingElseChecklistPembelian = (teks) => {
    setShowChecklistPembelian(false);
    handleSend(teks, []);
  };

  // [BARU] Tombol "🆕 Obrolan Baru" -- reset layar ke kosong DAN lepas
  // activePercakapanId (jadi null). Sengaja TIDAK langsung memanggil
  // api.buatPercakapan() di sini -- baris percakapan baru di DB baru
  // dibuat nanti secara lazy pas pesan pertama benar-benar dikirim (lihat
  // handleSend), supaya klik tombol ini berkali-kali tanpa ngobrol tidak
  // numpuk baris "Percakapan Baru" kosong di sidebar.
  const handleObrolanBaru = () => {
    // [FIX] Sebelumnya diisi 1 pesan sambutan assistant -- itu membuat
    // `messages.length` > 0, jadi `isLanding` jadi false dan layar
    // sambutan besar (logo + subtitle "Upload satu file Excel...") tidak
    // pernah muncul lagi setelah klik "Obrolan Baru". Sekarang dikosongkan
    // supaya kembali ke tampilan landing seperti saat pertama buka app.
    setMessages([]);
    setResultsByCategory({});
    setShowChecklistPembelian(false);
    setHasilDeteksiKesalahan(null);
    setRunningDeteksiKesalahan(false);
    setActivePercakapanId(null);
  };

  // [BARU] Klik salah satu judul di daftar riwayat sidebar -- tarik ulang
  // seluruh isi chat percakapan itu (GET /api/percakapan/{id}/pesan) dan
  // ganti activePercakapanId supaya balasan berikutnya nyambung ke
  // percakapan yang sama (bukan bikin percakapan baru lagi). Hasil
  // upload file (resultsByCategory) TIDAK ikut disimpan per-percakapan
  // di backend saat ini -- jadi ikut dikosongkan biar tidak salah
  // mencampur hasil upload sesi lain ke obrolan lama yang baru dibuka.
  const handlePilihPercakapan = async (id) => {
    if (id === activePercakapanId) return;
    setResultsByCategory({});
    setShowChecklistPembelian(false);
    setHasilDeteksiKesalahan(null);
    setRunningDeteksiKesalahan(false);
    try {
      const res = await api.pesanPercakapan(id);
      const pesanDirestore = (res.pesan || []).map((p) => ({ role: p.role, text: p.content }));
      setMessages(pesanDirestore);
      setActivePercakapanId(id);
    } catch (e) {
      setMessages([{ role: "assistant", text: `⚠️ Gagal membuka percakapan ini: ${e.message}` }]);
    }
  };

  // [BARU] Klik ikon 🗑️ di satu item riwayat -- hapus permanen dari DB.
  // Kalau yang dihapus adalah percakapan yang lagi aktif/dibuka, langsung
  // balik ke kondisi "obrolan baru" (bukan biarkan layar nampilin pesan
  // dari percakapan yang barusan dihapus).
  const handleHapusPercakapan = async (id) => {
    try {
      await api.hapusPercakapan(id);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ Gagal menghapus percakapan: ${e.message}` }]);
      return;
    }
    setDaftarPercakapan((prev) => prev.filter((c) => c.id !== id));
    if (id === activePercakapanId) {
      handleObrolanBaru();
    }
  };

  return (
    <div className="app-shell agent-ai-root">
      <div className={`main-container ${isLanding ? "landing" : ""}`}>
        {isLanding && (
          <>
            <h1 className="landing-title">
              <Image src={logoIcon} alt="Gouf Consulting" className="landing-logo" width={459} height={543} />
              AI Gouf Consulting
            </h1>
            <p className="landing-subtitle">Upload satu file Excel — dan aku akan menyelesaikan semua masalahmu!</p>
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} ref={(el) => { pesanRefs.current[i] = el; }}>
            <ChatBubble role={m.role} files={m.files} onFileClick={bukaArtifactPanel} onDownloadFile={unduhBase64Excel}>
              {/* [BARU -- TRANSPARANSI PROSES] Daftar langkah proses AI
                  untuk PESAN INI (mis. "Membaca pola transaksi",
                  "Menyusun jawaban") -- muncul DI ATAS teks jawaban,
                  reuse komponen ProcessingSteps yang sama dengan upload
                  file. `selesai` true begitu teks jawaban sudah mulai
                  muncul (m.text terisi) -- di titik itu daftar step
                  otomatis mengecil jadi ringkasan satu baris, konsisten
                  dgn perilaku ProcessingSteps di alur upload file. */}
              {m.role === "assistant" && m.steps?.length > 0 && (
                <ProcessingSteps
                  fileName="jawaban ini"
                  steps={m.steps}
                  selesai={!!m.text}
                  labelRingkas={() => "jawaban selesai disusun"}
                />
              )}
              {m.status && !m.text ? (
                <StatusIndicator label={m.status} />
              ) : (
                <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
              )}
            </ChatBubble>
          </div>
        ))}

        {prosesFiles.map((p) => (
          <ProcessingSteps key={p.id} fileName={p.fileName} steps={p.steps} selesai={p.selesai} />
        ))}

        {/* [FIX] HasilTerpadu me-render Live Dashboard/Saran Cerdas/panel
            18-Sheet begitu prop clientId terisi (lihat HasilTerpadu.jsx:
            `if (!clientId) return null`) -- angkanya diambil dari SELURUH
            riwayat client, bukan dari sesi chat ini.
            [FIX -- lanjutan, chat teks tanpa upload] `isLanding || sending`
            saja TIDAK CUKUP: begitu user kirim CHAT TEKS BIASA (tanpa
            upload file), isLanding langsung false dan sending balik false
            setelah AI selesai jawab -- clientId tetap ke-pass, jadi panel
            Live Dashboard/Saran Cerdas dari RIWAYAT LAMA client itu ikut
            nongol lagi walau obrolan ini baru & belum upload apa pun,
            kelihatan seperti "bekas obrolan lama" nyangkut.
            Sekarang clientId cuma diteruskan kalau memang ADA hasil yang
            benar-benar diproses DI SESI OBROLAN INI (adaHasilSesiIni --
            resultsByCategory berisi minimal 1 kategori non-null), DAN
            tidak sedang `sending`. Chat teks murni (tanya-jawab tanpa
            upload) tidak lagi memicu panel riwayat lama sama sekali. */}
        <HasilTerpadu resultsByCategory={resultsByCategory} clientId={adaHasilSesiIni && !sending ? activeClientId : null} onFileClick={bukaArtifactPanel} />

        {showChecklistPembelian && (
          <ChecklistPembelian
            onSubmit={handleSubmitChecklistPembelian}
            onClose={() => setShowChecklistPembelian(false)}
            onSomethingElse={handleSomethingElseChecklistPembelian}
          />
        )}

        {runningDeteksiKesalahan && (
          <p className="dkp-loading">🔍 Menjalankan pengecekan...</p>
        )}

        {hasilDeteksiKesalahan && (
          <DeteksiKesalahanResults hasilPerCheck={hasilDeteksiKesalahan} />
        )}

        {/* [BARU -- RUANG UNTUK SCROLL PESAN TERBARU KE ATAS] scrollIntoView
            di useEffect atas TIDAK BISA mendorong bubble pesan user ke
            paling atas viewport kalau konten DI BAWAHNYA belum cukup
            tinggi untuk mengisi sisa layar (mis. pesan baru saja dikirim,
            jawaban assistant belum/baru mulai di-generate) -- scrollTop
            browser dibatasi oleh total tinggi konten, jadi scroll
            berhenti di posisi maksimal yang tersedia, bukan tepat di
            atas. Spacer kosong ini menyediakan "ruang cadangan" supaya
            pesan terbaru selalu BISA didorong ke paling atas, sama
            seperti perilaku claude.ai. Disembunyikan saat isLanding
            (belum ada pesan sama sekali) supaya tidak ada gap kosong
            aneh di layar sambutan awal.
            [FIX -- posisi] Sebelumnya spacer ini ditaruh LANGSUNG setelah
            daftar pesan (SEBELUM ProcessingSteps/HasilTerpadu/dll) --
            akibatnya panel hasil proses file selalu terdorong 65vh ke
            bawah dari teks pesan terakhir, kelihatan seperti jarak kosong
            raksasa yang aneh. Fungsinya (reserve ruang scroll) tidak
            butuh berada persis di situ -- cukup ada DI SUATU TEMPAT di
            bagian bawah area scroll, jadi dipindah ke sini (paling akhir,
            setelah semua panel hasil, sebelum composer) supaya hasil
            proses file langsung menyambung rapat dengan teks di atasnya. */}
        {!isLanding && <div aria-hidden="true" style={{ minHeight: "65vh" }} />}

        {/* [BARU] disabled={sending} -- user tidak bisa kirim pesan baru
            ATAU upload file baru selama AI masih memproses pesan
            sebelumnya, layaknya AI chat pada umumnya. Lihat state
            `sending` yang sudah ada (di-set true saat handleSend mulai,
            balik false setelah balasan selesai/error). */}
        <ChatComposer onSend={handleSend} isLanding={isLanding} disabled={sending} onStop={handleStop} />
      </div>

      {/* [BARU -- ArtifactPanel] Kolom ketiga di .app-shell (sejajar
          Sidebar & .main-container), bukan modal/overlay -- supaya chat
          tetap terlihat & bisa digulir di kiri selagi panel terbuka.
          [FIX] SELALU dirender (tidak lagi `{artifactAktif && ...}`) --
          buka/tutup sekarang murni lewat prop `open`, yang mengontrol
          animasi `width` di CSS (lihat catatan panjang di
          ArtifactPanel.jsx & ArtifactPanel.css). Ini yang bikin chat &
          panel tergeser BARENG dengan halus, bukan "blink" berpindah
          tempat instan seperti sebelumnya. */}
      <ArtifactPanel
        open={artifactOpen}
        title={artifactAktif?.title}
        meta={artifactAktif?.meta}
        onClose={tutupArtifactPanel}
      />
    </div>
  );
}