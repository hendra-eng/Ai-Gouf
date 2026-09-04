// Lapisan pemanggilan API -- membungkus semua endpoint dari main.py.
// Ganti API_BASE_URL sesuai alamat server FastAPI kamu
// (mis. hasil `uvicorn main:app --reload --port 8000`, atau domain ngrok).
//
// Backend pakai JWT (lihat modules/auth.py) -- setelah login, respons
// membawa "token". Token itu disimpan lalu dikirim lewat header
// "Authorization: Bearer <token>" di setiap request berikutnya.

// [DIUBAH] Backend sudah disatukan lewat proxy next.config.mjs (rewrites
// /api/* -> backend FastAPI lokal). Jadi TIDAK perlu lagi domain backend
// terpisah di sini -- cukup path relatif "/api", otomatis diteruskan oleh
// Next.js sendiri ke backend yang jalan bareng lewat `npm run dev`.
// (NEXT_PUBLIC_API_BASE_URL masih bisa dipakai untuk override kalau
// backend di-deploy di domain lain sepenuhnya, tapi default-nya kosong.)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

let _token = null;

export function simpanToken(token) {
  _token = token;
}

export function ambilToken() {
  return _token;
}

// [BARU] Cek status provider AI (DeepSeek/Groq utk chat, Claude/Groq utk
// kategorisasi) lewat GET /api/health. Sengaja TIDAK lewat request() di
// bawah -- endpoint ini publik (tidak butuh JWT, lihat main.py::health()),
// jadi harus tetap bisa dipanggil walau user belum login / token belum
// terpasang (request() akan menolak mengirim kalau _token masih null).
export async function ambilStatusAI() {
  const res = await fetch(`${API_BASE_URL}/api/health`);
  if (!res.ok) {
    throw new Error(`Gagal mengambil status AI (${res.status})`);
  }
  return res.json(); // { status, ai_aktif, claude_aktif, database_aktif }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  // [UBAH -- login dihilangkan] Sebelumnya di sini ada pengecekan: kalau
  // `_token` belum terpasang (path selain "/api/login"), request TIDAK
  // dikirim sama sekali -- langsung throw "Belum login" di sisi frontend.
  // Itu masuk akal SELAMA ada alur login yang pada akhirnya mengisi
  // `_token`. Sekarang tidak ada lagi alur login sama sekali (lihat
  // AgentAIChat.jsx/ClientContext.jsx) -- `_token` memang SENGAJA tidak
  // pernah terisi, jadi pengecekan lama itu akan membuat SEMUA request
  // gagal di awal tanpa pernah benar-benar sampai ke backend.
  //
  // Sekarang: header Authorization cuma ditambahkan KALAU ada token
  // (mis. suatu saat dipasang manual/lewat cara lain) -- kalau tidak,
  // request tetap dikirim apa adanya tanpa header itu. Backend
  // (modules/auth.py::get_current_user) sudah disesuaikan untuk
  // meloloskan request tanpa header Authorization ini.
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }
  // options.signal (AbortSignal) diteruskan apa adanya lewat spread ...options
  // -- lihat prosesFileBatch() untuk pemakaian dari tombol "Stop".
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }
  return res.json();
}

// ------------------------------------------------------------
// Dokumen (bungkus endpoint di main.py)
// ------------------------------------------------------------
export async function daftarJenisDokumen() {
  return request("/api/jenis-dokumen");
}

export async function deteksiFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  return request("/api/deteksi-file", { method: "POST", body: formData });
}

/**
 * [FIX] Sebelumnya jenisDokumen & clientId dikirim lewat QUERY STRING
 * ("?jenis_dokumen=...&client_id=..."), padahal endpoint /api/proses-file
 * di backend membaca field ini lewat `Form(None)` (main.py) -- yaitu HANYA
 * dari body multipart/form-data, BUKAN dari query string. Akibatnya
 * client_id selalu kebaca None di backend, hasil proses TIDAK PERNAH
 * benar-benar tersimpan ke riwayat client manapun -- padahal tidak ada
 * error yang kelihatan sama sekali di frontend (request tetap sukses,
 * cuma diam-diam tidak tersimpan). Sekarang keduanya ikut dimasukkan ke
 * FormData yang sama dengan file, konsisten dengan cara backend
 * membacanya.
 */
export async function prosesFile(file, jenisDokumen /* optional */, clientId /* optional */) {
  const formData = new FormData();
  formData.append("file", file);
  if (jenisDokumen) formData.append("jenis_dokumen", jenisDokumen);
  if (clientId) formData.append("client_id", clientId);
  return request(`/api/proses-file`, { method: "POST", body: formData });
}

/**
 * prosesFileStream -- async generator versi SSE dari prosesFile(), dipanggil
 * ke POST /api/proses-file/stream (lihat main.py). Yield satu OBJEK EVENT
 * tiap kali backend melapor progress, bukan cuma teks -- bentuknya:
 *
 *   { type: "progress", step: "rekening_koran", label: "Rekening Koran (Bank Statement)",
 *     status: "processing" | "done" | "skip" | "error", pesan?: string }
 *   { type: "result", nama_file, hasil, tidak_terdeteksi, pesan?, detail_error?, kertas_kerja? }
 *   { type: "error", pesan: string }
 *
 * Event terakhir SEBELUM selesai selalu "result" (skema identik dgn
 * response prosesFile() biasa) atau "error" (gagal total).
 *
 * [BARU] Kalau file yang diupload adalah PDF DAN clientId diisi, backend
 * TIDAK memproses lewat jalur "deteksi 15 jenis dokumen + auto laporan
 * 18-sheet" seperti biasa -- PDF diasumsikan rekening koran & langsung
 * dirutekan ke kertas_kerja.generate_kertas_kerja() (lihat main.py::
 * proses_file_stream). Event "result" untuk kasus ini TIDAK punya field
 * "hasil" yang berisi (selalu {}), tapi punya field "kertas_kerja" berisi
 * {client_id, tahun, nama_file, file_base64, ringkasan, peringatan} --
 * skema PERSIS sama dengan event "result" generateKertasKerjaStream() di
 * bawah, jadi bisa langsung dirender/didownload lewat unduhFileBase64()
 * yang sama, tanpa logic decode baru.
 *
 * Sengaja TIDAK pakai EventSource bawaan (sama alasan dgn chatStream()
 * di atas: EventSource cuma bisa GET & tidak bisa kirim header
 * Authorization) -- dipakai fetch + ReadableStream manual, SSE di-parse
 * sendiri baris per baris.
 *
 * Pemakaian:
 *   for await (const event of api.prosesFileStream(file, undefined, clientId)) {
 *     if (event.type === "progress") { ...update UI langkah... }
 *     if (event.type === "result") { ...hasil final, sama spt prosesFile()... }
 *     if (event.type === "error") { ...tampilkan error... }
 *   }
 *
 * @param {File} file
 * @param {string} [jenisDokumen] -- opsional, paksa jenis dokumen tertentu
 * @param {number|string|null} [clientId] -- opsional
 */
export async function* prosesFileStream(file, jenisDokumen /* optional */, clientId /* optional */) {
  const headers = {};
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const formData = new FormData();
  formData.append("file", file);
  if (jenisDokumen) formData.append("jenis_dokumen", jenisDokumen);
  if (clientId) formData.append("client_id", clientId);

  const res = await fetch(`${API_BASE_URL}/api/proses-file/stream`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let batasEvent;
    while ((batasEvent = buffer.indexOf("\n\n")) !== -1) {
      const eventMentah = buffer.slice(0, batasEvent);
      buffer = buffer.slice(batasEvent + 2);

      const baris = eventMentah.split("\n").find((l) => l.startsWith("data: "));
      if (!baris) continue;
      const isiData = baris.slice("data: ".length).trim();

      if (isiData === "[DONE]") return;

      let data;
      try {
        data = JSON.parse(isiData);
      } catch {
        continue; // baris tidak valid JSON, lewati
      }

      yield data;
    }
  }
}

/**
 * [BARU] Upload BANYAK file sekaligus dalam SATU request, dibungkus dari
 * POST /api/client/{client_id}/proses-file-batch (lihat main.py) -- endpoint
 * ini sudah lama ada di backend tapi belum pernah dipanggil dari frontend;
 * sebelumnya ChatPage.jsx me-loop file satu-satu lewat prosesFileStream(),
 * jadi TIDAK PERNAH ada "rencana" gabungan ataupun cross-matching lintas
 * file (mis. Rekening Koran <-> Buku Bantu Piutang) yang sebenarnya sudah
 * diimplementasikan di backend.
 *
 * Beda dari prosesFileStream(): TIDAK streaming (SSE) -- satu Promise yang
 * resolve setelah SEMUA file selesai diproses backend (deteksi -> susun
 * rencana -> proses tiap file sesuai urutan rencana -> cross-matching).
 * Response-nya:
 *   {
 *     jumlah_file: number,
 *     rencana: [{ urutan, nama_file, jenis_terdeteksi: string[], alasan }],
 *     hasil_per_file: [{ nama_file, urutan, hasil?, tidak_terdeteksi?, pesan?, error? }],
 *     cross_matching: { dilakukan: bool, jumlah_baris_bank_cocok_ke_piutang? } | null,
 *     laporan_18_sheet: [{ status, tahun?, nama_file?, file_base64?, pesan? }],
 *     kertas_kerja: { status: "berhasil"|"gagal", client_id, tahun, nama_file, file_base64, ringkasan, peringatan } | null,
 *   }
 *
 * [BARU] Semua file .pdf dalam batch ini DIPISAH otomatis oleh backend
 * SEBELUM tahap deteksi/rencana (rencana & hasil_per_file di atas jadi
 * HANYA berisi file non-PDF) -- PDF-PDF itu digabung jadi SATU working
 * paper lewat kertas_kerja.generate_kertas_kerja(), hasilnya ada di field
 * "kertas_kerja" (skema sama dengan event "result" generateKertasKerjaStream(),
 * bisa langsung dirender/didownload lewat unduhFileBase64()). Kalau SEMUA
 * file dalam batch adalah PDF, rencana/hasil_per_file/cross_matching/
 * laporan_18_sheet akan kosong/null, hanya "kertas_kerja" yang terisi.
 *
 * client_id WAJIB (path param di backend) -- endpoint ini tidak punya versi
 * "tanpa client" seperti prosesFile()/prosesFileStream(), karena hasilnya
 * perlu tersimpan ke riwayat client supaya jurnal_posting & laporan
 * keuangan yang di-generate belakangan tahu ini data milik siapa.
 *
 * @param {File[]} files
 * @param {number|string} clientId -- wajib
 * @param {string} [jenisDokumen] -- opsional, paksa SEMUA file di batch ini
 *   diproses sebagai satu jenis dokumen tertentu (biasanya dikosongkan --
 *   biarkan backend mendeteksi jenis tiap file sendiri-sendiri)
 * @param {boolean} [konfirmasiDuplikat=false] -- true kalau user sudah
 *   diberi tahu ada potensi duplikat/revisi (dari upload sebelumnya) dan
 *   memilih tetap lanjutkan semua baris apa adanya
 * @param {AbortSignal} [signal] -- [BARU] opsional, dari AbortController --
 *   dipakai tombol "Stop" untuk membatalkan batch ini di tengah jalan.
 */
export async function prosesFileBatch(files, clientId, jenisDokumen /* optional */, konfirmasiDuplikat = false, signal = undefined) {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  if (jenisDokumen) formData.append("jenis_dokumen", jenisDokumen);
  formData.append("konfirmasi_duplikat", konfirmasiDuplikat ? "true" : "false");
  return request(`/api/client/${clientId}/proses-file-batch`, { method: "POST", body: formData, signal });
}

/**
 * prosesFileBatchStream -- [BARU] versi streaming (SSE) dari
 * prosesFileBatch() -- lihat main.py::proses_file_batch_stream. Yield
 * event SETIAP tahap, mulai dari file yang BARU DITERIMA dari user
 * sampai ke sub-tahap internal generate laporan 18-sheet, PERSIS pola
 * generateKertasKerjaStream() di bawah (raw event object, tidak
 * dibungkus ulang -- ProcessingSteps.jsx sudah paham bentuk
 * {step, label, status, pesan} apa adanya).
 *
 * Event yang di-yield:
 *   { type: "progress", step: string, label: string, status: "processing"|"done"|"skip"|"error", pesan?: string }
 *   { type: "result", jumlah_file, rencana, hasil_per_file, cross_matching, laporan_18_sheet, kertas_kerja }
 *   { type: "error", pesan: string }
 *
 * Daftar "step" yang akan muncul (urut): "baca_file" -> "kertas_kerja"
 * (kalau ada PDF) -> "deteksi" -> "rencana" -> "eksekusi:<nama_file>"
 * (satu per file) -> "cross_matching" (kalau relevan) ->
 * "18sheet:<sub_step>" (banyak, satu per sub-tahap penyusunan laporan
 * 18-sheet -- lihat docstring proses_file_batch_stream di main.py utk
 * daftar lengkap sub_step-nya).
 *
 * Pemakaian:
 *   for await (const evt of api.prosesFileBatchStream(files, clientId)) {
 *     if (evt.type === "progress") { ...update daftar step... }
 *     if (evt.type === "result") { ...hasil final (sama dgn prosesFileBatch)... }
 *     if (evt.type === "error") { ...tampilkan error... }
 *   }
 *
 * @param {File[]} files
 * @param {number|string} clientId -- wajib
 * @param {string} [jenisDokumen] -- opsional, sama seperti prosesFileBatch
 * @param {boolean} [konfirmasiDuplikat=false]
 * @param {AbortSignal} [signal] -- opsional, dari AbortController (tombol "Stop")
 */
export async function* prosesFileBatchStream(files, clientId, jenisDokumen /* optional */, konfirmasiDuplikat = false, signal = undefined) {
  const headers = {};
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  if (jenisDokumen) formData.append("jenis_dokumen", jenisDokumen);
  formData.append("konfirmasi_duplikat", konfirmasiDuplikat ? "true" : "false");

  const res = await fetch(`${API_BASE_URL}/api/client/${clientId}/proses-file-batch/stream`, {
    method: "POST",
    headers,
    signal,
    body: formData,
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let batasEvent;
    while ((batasEvent = buffer.indexOf("\n\n")) !== -1) {
      const eventMentah = buffer.slice(0, batasEvent);
      buffer = buffer.slice(batasEvent + 2);

      const baris = eventMentah.split("\n").find((l) => l.startsWith("data: "));
      if (!baris) continue;
      const isiData = baris.slice("data: ".length).trim();

      if (isiData === "[DONE]") return;

      let data;
      try {
        data = JSON.parse(isiData);
      } catch {
        continue; // baris tidak valid JSON, lewati
      }

      yield data;
    }
  }
}

export async function prosesDanBuatExcel(file, jenisDokumen /* optional */) {
  const formData = new FormData();
  formData.append("file", file);
  const query = jenisDokumen ? `?jenis_dokumen=${encodeURIComponent(jenisDokumen)}` : "";
  return request(`/api/proses-dan-buat-excel${query}`, { method: "POST", body: formData });
}

export function urlUnduhHasil(namaFile) {
  return `${API_BASE_URL}/api/unduh/${namaFile}`;
}

/**
 * chatStream -- async generator yang manggil POST /api/chat/stream dan
 * yield EVENT BERSTRUKTUR (bukan cuma string lagi) supaya frontend bisa
 * bedakan token jawaban dari langkah proses AI ("Membaca pola transaksi",
 * "Menyusun jawaban", dst) -- pola transparansi step-by-step ala Claude
 * Code, sama seperti ProcessingSteps.jsx yang dipakai untuk upload file.
 *
 * [BARU -- BENTUK YIELD BERUBAH] Sebelumnya generator ini yield STRING
 * (potongan teks jawaban) langsung. Sekarang yield OBJECT dengan salah
 * satu bentuk:
 *   - { type: "delta", text: string } -- potongan teks jawaban AI,
 *     pengganti string biasa dulu.
 *   - { type: "step", step: string, label: string, status: "processing"|"done" }
 *     -- satu langkah proses backend (lihat main.py::chat_stream,
 *     event "progress" dari _format_sse_progress()). `step` adalah id
 *     stabil per langkah (mis. "konteks", "susun_prompt", "jawab"),
 *     `label` teks bebas yang ditentukan backend (bisa diganti kapan
 *     saja tanpa ubah kode frontend), `status` menandai langkah baru
 *     mulai atau baru selesai.
 * PEMANGGIL LAMA yang masih mengharapkan string harus disesuaikan --
 * lihat ChatPage.jsx::kirimPesan untuk contoh konsumsi yang benar.
 *
 * [FIX] Sengaja TIDAK pakai `EventSource` bawaan browser: EventSource cuma
 * bisa GET dan tidak bisa kirim header custom seperti "Authorization", jadi
 * token JWT tidak akan pernah terkirim ke endpoint ini kalau pakai
 * EventSource. Di sini dipakai fetch + ReadableStream manual supaya header
 * Authorization tetap ikut terkirim, lalu SSE ("data: ...\n\n") di-parse
 * sendiri baris per baris.
 *
 * Pemakaian:
 *   for await (const evt of api.chatStream(pesan, riwayat)) {
 *     if (evt.type === "delta") teksLengkap += evt.text;
 *     else if (evt.type === "step") { ...update daftar step... }
 *   }
 *
 * @param {string} pesan
 * @param {{role: string, content: string}[]} riwayat
 * @param {string[]} ringkasanData -- ringkasan singkat data yang sudah diproses di obrolan ini
 * @param {number|string|null} clientId -- opsional, dipakai backend ambil jumlah pola/temuan milik client ini
 * @param {number|string|null} percakapanId -- [BARU] opsional, id dari POST /api/percakapan.
 *   Kalau diisi, backend akan menyimpan pesan user & balasan AI permanen ke
 *   tabel percakapan/pesan_chat (lihat api.buatPercakapan/daftarPercakapan/
 *   pesanPercakapan), dan auto-generate judul percakapan dari pesan pertama.
 * @param {AbortSignal} [signal] -- [BARU] opsional, dari AbortController --
 *   dipakai tombol "Stop" (lihat ChatPage.jsx::handleStop) untuk membatalkan
 *   request ini di tengah jalan. Kalau di-abort, fetch() di bawah akan
 *   reject dengan DOMException bernama "AbortError" -- pemanggil (ChatPage)
 *   yang menangkap & menampilkannya secara khusus, bukan sebagai error biasa.
 */
export async function* chatStream(pesan, riwayat = [], ringkasanData = [], clientId = null, percakapanId = null, signal = undefined) {
  const headers = { "Content-Type": "application/json" };
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const res = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      pesan,
      riwayat,
      ringkasan_data: ringkasanData,
      client_id: clientId || null,
      percakapan_id: percakapanId || null,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Satu event SSE dipisah baris kosong ganda ("\n\n")
    let batasEvent;
    while ((batasEvent = buffer.indexOf("\n\n")) !== -1) {
      const eventMentah = buffer.slice(0, batasEvent);
      buffer = buffer.slice(batasEvent + 2);

      const baris = eventMentah.split("\n").find((l) => l.startsWith("data: "));
      if (!baris) continue;
      const isiData = baris.slice("data: ".length).trim();

      if (isiData === "[DONE]") return;

      let data;
      try {
        data = JSON.parse(isiData);
      } catch {
        continue; // baris tidak valid JSON, lewati
      }

      if (data.error) throw new Error(data.error);

      // [BARU] Event step/progress dari backend (main.py::chat_stream,
      // dikirim lewat _format_sse_progress) -- punya field "type":
      // "progress" + "step"/"label"/"status". Diteruskan sebagai event
      // { type: "step", ... } supaya pemanggil bisa render daftar
      // langkah proses AI, terpisah dari token jawaban.
      if (data.type === "progress") {
        yield { type: "step", step: data.step, label: data.label, status: data.status };
        continue;
      }

      if (data.delta) yield { type: "delta", text: data.delta };
    }
  }
}

// ------------------------------------------------------------
// [BARU] Riwayat Percakapan (sidebar "Chat History" ala ChatGPT/Claude)
// ------------------------------------------------------------
// Bungkus endpoint di main.py: POST/GET /api/percakapan,
// GET /api/percakapan/{id}/pesan, DELETE /api/percakapan/{id}.

/**
 * daftarPercakapan -- list percakapan milik user yang login, terbaru
 * dulu. Dipakai buat isi daftar riwayat di <Sidebar conversations=.../>.
 *
 * [PENTING] Endpoint GET /api/percakapan di backend di-guard minimal
 * level Supervisor (tahap_3) -- lihat auth.require_level(3) di main.py.
 * User dengan level di bawah itu akan dapat error 403 di sini. Caller
 * WAJIB menangkap error ini & jatuhkan ke daftar kosong, jangan biarkan
 * seluruh halaman chat ikut gagal cuma gara-gara riwayat tidak bisa dimuat.
 */
export async function daftarPercakapan(clientId /* optional */, jalur /* optional: "client" | "esb_account" */) {
  const params = new URLSearchParams();
  if (clientId != null) params.set("client_id", clientId);
  if (jalur) params.set("jalur", jalur);
  const qs = params.toString();
  return request(`/api/percakapan${qs ? `?${qs}` : ""}`);
}

/**
 * buatPercakapan -- mulai sesi percakapan baru, return {id, judul}.
 * Judul sementara "Percakapan Baru" -- backend auto-ganti dari isi pesan
 * pertama begitu chatStream() dipanggil dengan percakapanId hasil ini.
 */
export async function buatPercakapan(clientId /* optional */, judul /* optional */) {
  return request(`/api/percakapan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId || null, judul: judul || null }),
  });
}

/** pesanPercakapan -- ambil seluruh isi chat (urut kronologis) dari satu percakapan lama, untuk direstore ke UI saat dipilih dari sidebar. */
export async function pesanPercakapan(percakapanId) {
  return request(`/api/percakapan/${percakapanId}/pesan`);
}

export async function hapusPercakapan(percakapanId) {
  return request(`/api/percakapan/${percakapanId}`, { method: "DELETE" });
}

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
export async function login(username, password) {
  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);
  const data = await request("/api/login", { method: "POST", body: formData });
  simpanToken(data.token);
  return data;
}

export function logout() {
  simpanToken(null);
}

// ------------------------------------------------------------
// Client
// ------------------------------------------------------------
/**
 * [FIX] `tipe` sekarang benar-benar opsional. Sebelumnya, memanggil
 * daftarClient() tanpa argumen mengirim "?tipe=undefined" ke backend
 * (encodeURIComponent(undefined) === "undefined"), bukan mengambil semua
 * client seperti yang dimaksud.
 */
export async function daftarClient(tipe /* optional */) {
  const query = tipe ? `?tipe=${encodeURIComponent(tipe)}` : "";
  return request(`/api/client${query}`);
}

export async function tambahClient(nama, lokasi, tipe) {
  const formData = new FormData();
  formData.append("nama", nama);
  if (lokasi) formData.append("lokasi", lokasi);
  formData.append("tipe", tipe);
  return request("/api/client", { method: "POST", body: formData });
}

export async function riwayatHasilClient(clientId) {
  return request(`/api/client/${clientId}/riwayat`);
}

/**
 * [BARU] Audit trail (riwayat perubahan) -- siapa mengubah apa kapan,
 * mencakup auto-fix data, perubahan COA, jawaban klarifikasi, posting/
 * tolak jurnal, dan generate laporan keuangan. Lihat main.py:
 * GET /api/client/{client_id}/audit-log.
 */
export async function auditLogClient(clientId, limit = 200) {
  return request(`/api/client/${clientId}/audit-log?limit=${limit}`);
}

/**
 * [BARU] Live Dashboard per client -- ringkasan total dokumen diproses,
 * jumlah baris jurnal, jumlah yang perlu direview, dan health score.
 * Lihat modules/dashboard.py::ringkas_dashboard_dari_riwayat di backend.
 */
export async function dashboardClient(clientId) {
  return request(`/api/client/${clientId}/dashboard`);
}

/**
 * [BARU] Ringkasan Eksekutif per client -- kartu angka utama
 * (kartu_utama, per_kategori, kesehatan) dihitung real-time dari data
 * tersimpan (gratis, boleh dipanggil berkali-kali), PLUS narasi AI
 * (Saran Cerdas) TERAKHIR yang pernah digenerate untuk client ini
 * (bisa null kalau belum pernah dibuat sama sekali).
 * Lihat modules/dashboard.py::ringkas_eksekutif_dari_riwayat &
 * main.py: GET /api/client/{client_id}/ringkasan-eksekutif
 */
export async function ringkasanEksekutifClient(clientId) {
  return request(`/api/client/${clientId}/ringkasan-eksekutif`);
}

/**
 * [BARU] "Saran Cerdas" -- minta backend generate ULANG narasi AI
 * (DeepSeek) dari angka terkini & simpan sbg riwayat baru. Ini yang
 * benar-benar memanggil DeepSeek (ada biaya/kuota), makanya dipisah jadi
 * POST tersendiri yang dipicu tombol, bukan otomatis jalan tiap kali
 * halaman dibuka. Lihat main.py: POST /api/client/{client_id}/ringkasan-eksekutif
 */
export async function buatSaranCerdas(clientId) {
  return request(`/api/client/${clientId}/ringkasan-eksekutif`, { method: "POST" });
}

/**
 * [BARU] Ringkasan tren saldo bulanan per kategori (ASET/LIABILITAS/dst),
 * dipakai grafik "Tren" di DashboardPage. Lihat main.py:
 * GET /api/client/{client_id}/riwayat-saldo/ringkasan
 *
 * Catatan: datanya baru terisi kalau client ini sudah pernah generate
 * laporan bulanan (POST .../laporan-bulanan/generate) -- kalau belum,
 * `data` akan kosong dan DashboardPage menampilkan pesan "belum ada data".
 */
export async function ringkasanTrenSaldo(clientId, tahun) {
  return request(`/api/client/${clientId}/riwayat-saldo/ringkasan?tahun=${tahun}`);
}

// ------------------------------------------------------------
// [BARU] Klarifikasi (mekanisme tanya balik ke akuntan)
// ------------------------------------------------------------
// Lihat main.py: GET/POST /api/klarifikasi -- pertanyaannya sendiri dibuat
// otomatis di backend (ak.cari_baris_perlu_klarifikasi()) saat file
// diproses, di sini cuma dibungkus jadi 2 fungsi: ambil daftar & jawab.

/**
 * @param {number|string|null} clientId -- opsional, null/undefined berarti semua client
 * @param {string} status -- "pending" (default) | "answered" | "" (semua status)
 */
export async function daftarKlarifikasi(clientId /* optional */, status = "pending") {
  const params = new URLSearchParams();
  if (clientId) params.set("client_id", clientId);
  // Sengaja selalu dikirim (termasuk string kosong) -- backend menganggap
  // status kosong/falsy sbg "tanpa filter status" (lihat main.py).
  params.set("status", status ?? "");
  return request(`/api/klarifikasi?${params.toString()}`);
}

export async function jawabKlarifikasi(pertanyaanId, jawaban) {
  return request(`/api/klarifikasi/${pertanyaanId}/jawab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jawaban }),
  });
}

// ------------------------------------------------------------
// [BARU] 5 Laporan Keuangan Standar (Neraca, Laba Rugi, Perubahan
// Ekuitas, Arus Kas, CALK)
// ------------------------------------------------------------
// Lihat modules/laporan_keuangan.py::generate_5_laporan_keuangan &
// main.py: POST/GET /api/client/{client_id}/laporan-keuangan[/generate]

/**
 * Generate (atau generate ULANG) 5 Laporan Keuangan Standar dari jurnal
 * yang berstatus "terposting" + COA client, untuk 1 periode. Setiap
 * panggilan membuat snapshot BARU -- histori sebelumnya tidak ditimpa.
 *
 * @param {number|string} clientId
 * @param {{
 *   periode: string,               // mis. "2026-07"
 *   tanggal_mulai?: string,        // opsional, format "YYYY-MM-DD"
 *   tanggal_akhir?: string,        // opsional, format "YYYY-MM-DD"
 *   prive_atau_dividen?: number,
 *   setoran_modal_baru?: number,
 *   penyesuaian_ekuitas_manual?: number,
 * }} opsi
 */
export async function generateLaporanKeuangan(clientId, opsi) {
  return request(`/api/client/${clientId}/laporan-keuangan/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      periode: opsi.periode,
      tanggal_mulai: opsi.tanggal_mulai || null,
      tanggal_akhir: opsi.tanggal_akhir || null,
      prive_atau_dividen: opsi.prive_atau_dividen || 0,
      setoran_modal_baru: opsi.setoran_modal_baru || 0,
      penyesuaian_ekuitas_manual: opsi.penyesuaian_ekuitas_manual || 0,
    }),
  });
}

/**
 * Tanpa `periode`: daftar riwayat semua snapshot laporan keuangan client
 * ini (ringkas, tanpa isi lengkap). Dengan `periode`: snapshot TERBARU
 * untuk periode itu (isi lengkap 5 laporan).
 */
export async function ambilLaporanKeuangan(clientId, periode /* optional */) {
  const query = periode ? `?periode=${encodeURIComponent(periode)}` : "";
  return request(`/api/client/${clientId}/laporan-keuangan${query}`);
}

// [BARU] 8 kartu KPI halaman Dashboard utama (KPIBentoGrid.tsx) --
// GET /api/client/{client_id}/kpi-bento, lihat
// backend/modules/laporan_keuangan.py::susun_kpi_bento_dashboard()
// utk detail hasil & keterbatasannya (heuristik AP/Tax Payable, dst).
export async function ambilKpiBento(clientId, tahun /* optional */) {
  const query = tahun ? `?tahun=${encodeURIComponent(tahun)}` : "";
  return request(`/api/client/${clientId}/kpi-bento${query}`);
}

// [BARU] Laporan bulanan (Trial Balance/Laba Rugi/Balance Sheet Jan-Des
// dalam 1 tabel, tiap bulan kumulatif YTD) -- dipakai halaman Financial
// Statements (Profit & Loss, Balance Sheet, Cash Flow) utk chart & tabel
// tren bulanan. Lihat backend/modules/laporan_keuangan.py::
// susun_laporan_bulanan_setahun() utk skema lengkap hasilnya.
//
// GET akan 404 kalau laporan bulanan tahun ini belum PERNAH digenerate
// utk client ini -- pemanggil (lihat useLaporanBulananTahun.ts) sebaiknya
// fallback ke generateLaporanBulanan() saat ambilLaporanBulanan() gagal.
export async function ambilLaporanBulanan(clientId, tahun) {
  return request(`/api/client/${clientId}/laporan-bulanan/${encodeURIComponent(tahun)}`);
}

/**
 * Generate ulang laporan bulanan tahun ini dari jurnal+COA client SEKARANG
 * (snapshot baru, menimpa hasil `laporan_bulanan_{tahun}` yang lama --
 * beda dari laporan-keuangan/generate yang selalu bikin histori baru).
 * @param {number|string} clientId
 * @param {number} tahun
 */
export async function generateLaporanBulanan(clientId, tahun) {
  return request(`/api/client/${clientId}/laporan-bulanan/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tahun }),
  });
}

/** URL unduh template Excel kosong 31 sheet -- dipakai lewat <a href>, bukan fetch. */
export function urlTemplateLaporanKeuangan() {
  return `${API_BASE_URL}/api/template-laporan-keuangan`;
}

// ------------------------------------------------------------
// Export 18-Sheet Lengkap (Excel) -- POST /api/client/{client_id}/export-18-sheet
// ------------------------------------------------------------
// [FIX] Backend sudah pindah dari export-14-sheet ke export-18-sheet
// (lihat main.py: Export18SheetRequest, endpoint POST .../export-18-sheet
// & .../export-18-sheet-json) -- endpoint export-14-sheet yang lama SUDAH
// TIDAK ADA lagi di backend, jadi fungsi lama di sini (exportLaporan14Sheet/
// exportLaporan14SheetJson) memanggil URL yang akan selalu 404. 4 sheet baru
// ditambahkan di backend: "Laporan Perubahan Ekuitas", "Laporan Arus Kas",
// "Catatan Laporan Keuangan (CALK)", "Rekonsiliasi Fiskal" -- disisipkan di
// antara sheet lama (posisi 11-13 & 17), jadi urutan lengkap sekarang:
// Petunjuk & Asumsi, COA, Neraca Saldo Awal, GL <tahun>, Buku Bantu Piutang,
// Buku Bantu Hutang, Buku Bantu Aktiva Tetap, Trial Balance Bulanan, Laba
// Rugi Bulanan, Balance Sheet Bulanan, Laporan Perubahan Ekuitas, Laporan
// Arus Kas, CALK, Ringkasan, BS Lampiran SPT, PNL Lampiran SPT, Rekonsiliasi
// Fiskal, PPh Badan 31E.
//
// Beda dari request() biasa: endpoint ini POST (butuh body JSON + header
// Authorization), tapi responsnya FILE BINARY (StreamingResponse .xlsx),
// bukan JSON -- jadi tidak bisa lewat request()/`<a href>` biasa (yang
// cuma bisa GET tanpa header). Di sini fetch manual -> ambil sebagai
// Blob -> trigger download lewat elemen <a> sementara (createObjectURL).
//
// Menggabungkan otomatis (di backend): COA, jurnal terposting, GL,
// Buku Bantu Piutang/Hutang/Aktiva Tetap, Trial Balance/Laba Rugi/
// Balance Sheet Bulanan, Perubahan Ekuitas, Arus Kas, CALK, PPh Badan 31E,
// Lampiran SPT BS/PNL, Rekonsiliasi Fiskal, Ringkasan -- generate ulang
// otomatis kalau laporan keuangan / PPh Badan tahun itu belum pernah
// dibuat (sama seperti endpoint generate masing-masing).

/**
 * @param {number|string} clientId
 * @param {{
 *   tahun: number,                        // wajib, mis. 2025
 *   tahun_sebelumnya?: number,            // opsional, untuk kolom komparatif Neraca
 *   metode_penyusutan?: "komersial"|"fiskal", // default "komersial"
 *   prive_atau_dividen?: number,
 *   setoran_modal_baru?: number,
 *   penyesuaian_ekuitas_manual?: number,
 *   nama_perusahaan?: string,             // override nama di sheet "Petunjuk & Asumsi"
 *   kompensasi_kerugian_fiskal?: number,
 *   kredit_pajak?: Record<string, number>,
 *   skema_pajak?: string,                 // [BARU] default "Tarif Umum Pasal 17/31E", dipakai HANYA kalau PPh Badan tahun ini belum pernah digenerate
 *   tambahan_peredaran_bruto_lainnya?: number, // [BARU]
 *   retur_pengurangan_peredaran_bruto?: number, // [BARU]
 *   keterangan_peredaran_bruto?: string,  // [BARU]
 * }} opsi
 * @returns {Promise<{filename: string}>} -- resolve setelah file mulai diunduh browser
 */
export async function exportLaporan18Sheet(clientId, opsi) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(`${API_BASE_URL}/api/client/${clientId}/export-18-sheet`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tahun: opsi.tahun,
      tahun_sebelumnya: opsi.tahun_sebelumnya || null,
      metode_penyusutan: opsi.metode_penyusutan || "komersial",
      prive_atau_dividen: opsi.prive_atau_dividen || 0,
      setoran_modal_baru: opsi.setoran_modal_baru || 0,
      penyesuaian_ekuitas_manual: opsi.penyesuaian_ekuitas_manual || 0,
      nama_perusahaan: opsi.nama_perusahaan || null,
      kompensasi_kerugian_fiskal: opsi.kompensasi_kerugian_fiskal || 0,
      kredit_pajak: opsi.kredit_pajak || null,
      skema_pajak: opsi.skema_pajak || "Tarif Umum Pasal 17/31E",
      tambahan_peredaran_bruto_lainnya: opsi.tambahan_peredaran_bruto_lainnya || 0,
      retur_pengurangan_peredaran_bruto: opsi.retur_pengurangan_peredaran_bruto || 0,
      keterangan_peredaran_bruto: opsi.keterangan_peredaran_bruto || null,
    }),
  });

  if (!res.ok) {
    // Error dari endpoint ini tetap JSON (HTTPException FastAPI), beda dari respons sukses (file).
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const blob = await res.blob();

  // Ambil nama file dari header Content-Disposition kalau ada, fallback ke nama default.
  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `Laporan_Keuangan_${opsi.tahun}_18_Sheet.xlsx`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);

  return { filename };
}

/**
 * Versi JSON dari exportLaporan18Sheet() -- dipakai untuk
 * menampilkan ke-18 sheet LANGSUNG DI LAYAR (tab per-sheet), bukan
 * memicu download file. Menerima opsi yang SAMA PERSIS dengan
 * exportLaporan18Sheet() (lihat dokumentasi @param di atasnya).
 *
 * @param {number|string} clientId
 * @param {object} opsi -- sama seperti parameter exportLaporan18Sheet()
 * @returns {Promise<{sheets: Array<{nama: string, rows: any[][]}>}>}
 */
export async function exportLaporan18SheetJson(clientId, opsi) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(`${API_BASE_URL}/api/client/${clientId}/export-18-sheet-json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tahun: opsi.tahun,
      tahun_sebelumnya: opsi.tahun_sebelumnya || null,
      metode_penyusutan: opsi.metode_penyusutan || "komersial",
      prive_atau_dividen: opsi.prive_atau_dividen || 0,
      setoran_modal_baru: opsi.setoran_modal_baru || 0,
      penyesuaian_ekuitas_manual: opsi.penyesuaian_ekuitas_manual || 0,
      nama_perusahaan: opsi.nama_perusahaan || null,
      kompensasi_kerugian_fiskal: opsi.kompensasi_kerugian_fiskal || 0,
      kredit_pajak: opsi.kredit_pajak || null,
      skema_pajak: opsi.skema_pajak || "Tarif Umum Pasal 17/31E",
      tambahan_peredaran_bruto_lainnya: opsi.tambahan_peredaran_bruto_lainnya || 0,
      retur_pengurangan_peredaran_bruto: opsi.retur_pengurangan_peredaran_bruto || 0,
      keterangan_peredaran_bruto: opsi.keterangan_peredaran_bruto || null,
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  return res.json();
}

/**
 * @deprecated [FIX] Nama lama, endpoint export-14-sheet SUDAH TIDAK ADA di
 * backend -- dipertahankan sebagai alias tipis ke exportLaporan18Sheet()
 * SEMATA supaya file lain (mis. halaman React yang belum sempat diaudit di
 * sesi ini) yang masih memanggil exportLaporan14Sheet() tidak langsung
 * pecah/404 kalau lupa di-update. GANTI pemanggilnya ke exportLaporan18Sheet()
 * -- alias ini sebaiknya dihapus setelah semua call-site dipastikan pindah.
 */
export async function exportLaporan14Sheet(clientId, opsi) {
  return exportLaporan18Sheet(clientId, opsi);
}

/** @deprecated lihat catatan exportLaporan14Sheet() di atas -- pakai exportLaporan18SheetJson(). */
export async function exportLaporan14SheetJson(clientId, opsi) {
  return exportLaporan18SheetJson(clientId, opsi);
}

// ------------------------------------------------------------
// [FASE 5/6 -- roadmap CALK] CALK Resmi (docx/PDF) -- BEDA dari
// `laporan.calk` di atas (ambilLaporanKeuangan()/generateLaporanKeuangan()
// balikin field "calk" yang isinya cuma RINCIAN AKUN per kategori +
// kerangka_catatan generik -- itu ringkasan JSON dipakai buat sheet
// Excel/tab preview, BUKAN dokumen resmi).
//
// Endpoint di bawah ini (lihat main.py, modules/calk_export.py) generate
// DOKUMEN CALK LENGKAP bergaya akuntan publik -- dwibahasa ID/EN, 15+
// note bernomor otomatis (Umum, Kebijakan Akuntansi, Kas, Piutang, Aset
// Tetap dst), sebagai file .docx DAN .pdf sekaligus.
// ------------------------------------------------------------

/**
 * Simpan/update profil Note 1 (Umum) & Note 2 (Kebijakan Akuntansi) --
 * akta pendirian, notaris, SK Kemenkumham, susunan komisaris/direksi,
 * dst. Field PERSIS sama dengan CalkProfilRequest (main.py). Tiap
 * panggilan bikin entri baru (histori tidak ditimpa di backend) --
 * ambilCalkProfil() selalu balikin yang TERBARU.
 * @param {number|string} clientId
 * @param {object} profil -- lihat CalkProfilForm.jsx utk field lengkap
 */
export async function simpanCalkProfil(clientId, profil) {
  return request(`/api/client/${clientId}/calk/profil`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profil),
  });
}

/**
 * Ambil profil CALK TERBARU client ini. Balik {profil_id: null, profil: {}}
 * (BUKAN 404) kalau belum pernah diisi.
 */
export async function ambilCalkProfil(clientId) {
  return request(`/api/client/${clientId}/calk/profil`);
}

/**
 * Generate CALK lengkap (docx + pdf) untuk 2 periode (sekarang vs
 * pembanding). Kalau snapshot laporan keuangan periode itu belum ada,
 * backend generate otomatis (asal tanggal_mulai/tanggal_akhir diisi).
 *
 * @param {number|string} clientId
 * @param {{
 *   periode_now: string, tanggal_mulai_now?: string, tanggal_akhir_now: string,
 *   periode_lalu: string, tanggal_mulai_lalu?: string, tanggal_akhir_lalu: string,
 *   pph_badan_analisis_id?: number,
 *   pph_final_umkm?: { peredaran_bruto_now: number, pph_final_now: number,
 *                       peredaran_bruto_lalu?: number, pph_final_lalu?: number, tarif?: number },
 *   pihak_berelasi?: { id: string[], en: string[] },
 *   peristiwa_setelah_neraca?: { id: string[], en: string[] },
 *   tanggal_persetujuan?: string,
 *   nama_penanggung_jawab_id?: string, nama_penanggung_jawab_en?: string,
 * }} opsi
 * @returns {Promise<{calk_id: number, docx_filename: string, pdf_filename: string,
 *   nomor_note_terakhir: number, daftar_note_ditulis: object[], peringatan: string[]}>}
 */
export async function generateCalk(clientId, opsi) {
  return request(`/api/client/${clientId}/calk/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opsi),
  });
}

/** Riwayat semua CALK yang pernah digenerate client ini, terbaru dulu. */
export async function riwayatCalk(clientId) {
  return request(`/api/client/${clientId}/calk/riwayat`);
}

/**
 * [BARU] Riwayat semua perhitungan PPh Badan (Pasal 31E) yang pernah
 * digenerate client ini, terbaru dulu -- dipakai halaman Reports (kategori
 * "tax"). Lihat GET /api/client/{client_id}/pph-badan/riwayat di main.py.
 * @param {number|string} clientId
 * @param {number} [tahunPajak] -- opsional, filter 1 tahun pajak saja
 */
export async function riwayatPphBadan(clientId, tahunPajak) {
  const query = tahunPajak ? `?tahun_pajak=${encodeURIComponent(tahunPajak)}` : "";
  return request(`/api/client/${clientId}/pph-badan/riwayat${query}`);
}

/**
 * Unduh file CALK (docx/pdf) yang sudah digenerate -- pola SAMA dgn
 * exportLaporan18Sheet() di atas (endpoint balikin file binary +
 * butuh header Authorization, jadi tidak bisa lewat `<a href>` polos).
 * @param {number|string} clientId
 * @param {number|string} calkId
 * @param {"pdf"|"docx"} [format="pdf"]
 * @returns {Promise<{filename: string}>}
 */
export async function downloadCalk(clientId, calkId, format = "pdf") {
  const headers = {};
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(
    `${API_BASE_URL}/api/client/${clientId}/calk/${calkId}/download?format=${format}`,
    { headers },
  );

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `CALK_client${clientId}.${format}`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);

  return { filename };
}

// ------------------------------------------------------------
// [BARU] Jurnal Posting (draft -> terposting) -- prasyarat Laporan
// Keuangan, karena generate_5_laporan_keuangan() sengaja hanya memakai
// jurnal yang SUDAH dikonfirmasi, bukan draf mentah hasil proses file.
// ------------------------------------------------------------

/**
 * @param {number|string} clientId
 * @param {string} status -- "draft" (default, "perlu posting") | "terposting" | "ditolak"
 */
export async function daftarJurnalPosting(clientId, status = "draft") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/api/client/${clientId}/jurnal-posting${query}`);
}

export async function konfirmasiPosting(clientId, postingId, opsi = {}) {
  return request(`/api/client/${clientId}/jurnal-posting/${postingId}/konfirmasi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opsi),
  });
}

export async function tolakPosting(clientId, postingId, alasan) {
  return request(`/api/client/${clientId}/jurnal-posting/${postingId}/tolak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alasan }),
  });
}

/**
 * [BARU] Konfirmasi SEKALIGUS semua baris draft milik satu hasil_id (satu
 * file upload), bungkus dari POST /api/client/{client_id}/jurnal-posting/
 * hasil/{hasil_id}/konfirmasi-semua (lihat main.py). Baris yang akunnya
 * masih placeholder (mengandung "/") OTOMATIS DILEWATI oleh backend --
 * tidak pernah salah posting ke akun yang belum jelas, harus tetap
 * dikonfirmasi satu-satu lewat konfirmasiPosting() setelah diisi manual.
 *
 * Dipakai ChatPage.jsx supaya jurnal hasil upload di obrolan langsung
 * ter-posting otomatis (tanpa akuntan wajib mampir ke halaman "Laporan
 * Keuangan" > "Jurnal Perlu Posting" dulu), selama akunnya sudah pasti.
 *
 * @param {number|string} clientId
 * @param {number|string} hasilId
 * @returns {Promise<{pesan: string, diposting: number, dilewati_placeholder: number}>}
 */
export async function konfirmasiPostingMassal(clientId, hasilId) {
  return request(`/api/client/${clientId}/jurnal-posting/hasil/${hasilId}/konfirmasi-semua`, {
    method: "POST",
  });
}

// ------------------------------------------------------------
// [BARU] Rekonsiliasi Lintas-Dokumen (cross-matching)
// ------------------------------------------------------------
// Lihat modules/cross_matching.py::jalankan_rekonsiliasi_lintas_dokumen &
// main.py: GET /api/client/{client_id}/rekonsiliasi-lintas-dokumen
//
// Rule-based (bukan AI generatif) -- mencocokkan 3 pasangan dokumen
// sekaligus dari data yang sudah tersimpan untuk 1 client:
//   1. bank_vs_piutang       -- mutasi bank masuk <-> piutang lunas
//   2. ppn_vs_spt            -- PPN Keluaran (faktur pajak) <-> SPT Masa PPN
//   3. slip_gaji_vs_absensi  -- slip gaji <-> rekap absensi
// Hasil "TIDAK_KETEMU"/"PERLU_DICEK"/"SELISIH" tetap wajib direview
// manusia -- endpoint ini mempercepat proses cari, bukan menggantikan
// keputusan akuntan.

/**
 * @param {number|string} clientId
 * @param {string} [npwpPerusahaan] -- opsional. Kalau diisi, hanya faktur
 *   pajak dengan npwp_penjual == ini yang dihitung sbg PPN Keluaran
 *   perusahaan (lihat cocokkan_ppn_faktur_spt di backend).
 */
export async function rekonsiliasiLintasDokumen(clientId, npwpPerusahaan /* optional */) {
  const query = npwpPerusahaan ? `?npwp_perusahaan=${encodeURIComponent(npwpPerusahaan)}` : "";
  return request(`/api/client/${clientId}/rekonsiliasi-lintas-dokumen${query}`);
}

// ------------------------------------------------------------
// [BARU] Deteksi & Pencegahan Kesalahan -- Pembelian (PO/Invoice)
// ------------------------------------------------------------
// Lihat modules/deteksi_kesalahan_pembelian.py::jalankan_deteksi_kesalahan_pembelian
// & main.py: POST /api/client/{client_id}/deteksi-kesalahan-pembelian
//
// 7 pengecekan rule-based (bukan AI generatif) atas data Pembelian
// (PO/Invoice) yang sudah tersimpan untuk 1 client:
//   1. po_invoice           -- Pencocokan PO <-> Invoice
//   2. pph23_jasa           -- Deteksi PPh 23 atas jasa
//   3. harga_tidak_wajar    -- Deteksi harga tidak wajar (riwayat)
//   4. supplier_baru        -- Deteksi supplier baru
//   5. validasi_tanggal     -- Validasi tanggal
//   6. rekap_supplier       -- Rekap per Supplier
//   7. cross_check_ap_aging -- Cross-check ke AP Aging
// Hasil "PERLU_DICEK"/"PERLU REVIEW"/"SELISIH" tetap wajib direview
// manusia -- endpoint ini mempercepat proses cari, bukan menggantikan
// keputusan akuntan.

/**
 * @param {number|string} clientId
 * @param {string[]} checks -- kode item yang mau dijalankan (lihat daftar di
 *   atas). Array kosong ([]) berarti jalankan SEMUA 7 pengecekan sekaligus.
 * @returns {Promise<Record<string, {hasil: any[], ringkasan: object}>>}
 *   -- object dgn key = kode check yang diminta, value = hasil pengecekan itu.
 */
export async function deteksiKesalahanPembelian(clientId, checks = []) {
  return request(`/api/client/${clientId}/deteksi-kesalahan-pembelian`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checks }),
  });
}

// ------------------------------------------------------------
// [BARU] Chart of Accounts (COA) permanen per client
// ------------------------------------------------------------
// Lihat main.py: GET/POST /api/client/{client_id}/coa,
// POST /api/client/{client_id}/coa/akun,
// PUT/DELETE /api/client/{client_id}/coa/akun/{akun_id}
//
// Satu akun COA berbentuk:
//   { no_akun, nama_akun, kategori?, sub_kategori?, normal_saldo?,
//     saldo_awal?, segment?, arus_kas?, keterangan? }
// kategori (dipakai sbg "Kelompok"): Aset/Liabilitas/Ekuitas/Pendapatan/Beban
//   (bebas, tidak divalidasi ketat)
// sub_kategori: "Subkelompok", mis. "Aset Lancar", "Beban Operasional"
// normal_saldo ("Saldo Normal"): Debit/Kredit
// arus_kas: label bebas, mis. "Kas & Setara Kas"/"Operasi"/"Investasi"/"Pendanaan"/"Nonkas"
// segment: label bebas per client, mis. "Umum"/"Semua"/nama proyek-aset
// keterangan: catatan bebas per akun
//
// Kolom "Laporan" (Balance Sheet / Laba Rugi) TIDAK disimpan di DB --
// diturunkan otomatis dari kategori (lihat LAPORAN_DARI_KATEGORI di
// ChartOfAccountsPage.jsx), supaya tidak ada 2 sumber kebenaran yang bisa
// tidak sinkron kalau kategori diedit belakangan.

/**
 * Ambil seluruh COA permanen milik satu client.
 * @param {number|string} clientId
 * @returns {Promise<{coa: Array}>}
 */
export async function ambilCoaClient(clientId) {
  return request(`/api/client/${clientId}/coa`);
}

/**
 * Simpan COA client sekaligus -- dipakai setelah import file Excel
 * (di-parse di frontend) atau setelah edit banyak baris di tabel.
 * @param {number|string} clientId
 * @param {Array<{no_akun:string,nama_akun:string,kategori?:string,sub_kategori?:string,normal_saldo?:string,saldo_awal?:number}>} akun
 * @param {boolean} [gantiSemua=true] -- true = replace total, false = tambah/update sebagian
 */
export async function simpanCoaBulk(clientId, akun, gantiSemua = true) {
  return request(`/api/client/${clientId}/coa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ akun, ganti_semua: gantiSemua }),
  });
}

/** Tambah satu akun COA baru untuk client. */
export async function tambahAkunCoa(clientId, akun) {
  return request(`/api/client/${clientId}/coa/akun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(akun),
  });
}

/** Perbarui satu akun COA (mis. mengisi kategori yang tadinya kosong). */
export async function updateAkunCoa(clientId, akunId, akun) {
  return request(`/api/client/${clientId}/coa/akun/${akunId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(akun),
  });
}

/** Hapus satu akun COA. */
export async function hapusAkunCoa(clientId, akunId) {
  return request(`/api/client/${clientId}/coa/akun/${akunId}`, {
    method: "DELETE",
  });
}

// ------------------------------------------------------------
// [BARU] Kertas Kerja Laporan Keuangan -- generate dari BANYAK file PDF
// rekening koran sekaligus (lihat modules/kertas_kerja.py::
// generate_kertas_kerja() + tulis_kertas_kerja_excel()).
//
// Backend sekarang mengekstrak file-file PDF itu PARALEL (lihat
// PDF_PARALEL_MAKS di kertas_kerja.py, default 4 file sekaligus) --
// makanya endpoint ini dibuat versi STREAM (SSE), supaya user lihat
// progress PER FILE (bukan loading kosong yang baru menampilkan hasil
// setelah SEMUA file selesai, yang bisa terasa "diam" cukup lama untuk
// batch banyak bulan/bank).
//
// [CATATAN INTEGRASI] Path endpoint di bawah
// ("/api/client/{clientId}/kertas-kerja/generate/stream") mengikuti pola
// penamaan endpoint lain di main.py (mis. .../export-18-sheet,
// .../proses-file-batch) -- SESUAIKAN persis dengan nama route yang
// didaftarkan di main.py kalau ternyata beda. Skema event & cara parsing
// SSE-nya SENGAJA dibuat identik dengan prosesFileStream() di atas
// (fetch + ReadableStream manual, bukan EventSource bawaan -- alasan
// sama: EventSource cuma bisa GET & tidak bisa kirim header
// Authorization), jadi kalau backend memakai helper SSE yang sama
// dengan proses_file_stream() di main.py, format framing "data: ...\n\n"
// otomatis kompatibel tanpa penyesuaian tambahan.
// ------------------------------------------------------------

/**
 * generateKertasKerjaStream -- async generator versi SSE untuk generate
 * Kertas Kerja Laporan Keuangan dari banyak file PDF rekening koran
 * sekaligus. Yield satu OBJEK EVENT tiap kali backend melapor progress:
 *
 *   { type: "progress", file: string, status: "queued"|"processing"|"done"|"cache_hit"|"error", pesan?: string }
 *   { type: "result", client_id, tahun, nama_file, file_base64, ringkasan, peringatan }
 *   { type: "error", pesan: string }
 *
 * Event terakhir SEBELUM selesai selalu "result" (skema sengaja dibuat
 * IDENTIK dengan response endpoint generate-kertas-kerja non-streaming --
 * jadi logic "baca hasil akhir" tidak berubah, cuma cara terima eventnya)
 * atau "error" (gagal total, mis. semua PDF gagal diekstrak / akun
 * staging belum ditandai di COA -- lihat ValueError di
 * kertas_kerja.generate_kertas_kerja()).
 *
 * status "cache_hit" (di luar "queued"|"processing"|"done"|"error" yang
 * sudah dikenal ProcessingSteps.jsx) menandai file yang hasil ekstraksinya
 * diambil dari cache per-file (lihat _muat_cache_ekstraksi_pdf di
 * kertas_kerja.py) -- HAMPIR INSTAN, ditampilkan beda supaya user paham
 * kenapa 1 file selesai jauh lebih cepat dari file lain di batch yang sama.
 *
 * Pemakaian:
 *   for await (const event of api.generateKertasKerjaStream(files, clientId, tahun)) {
 *     if (event.type === "progress") { ...update progress per-file... }
 *     if (event.type === "result") { ...hasil final (file_base64 dkk)... }
 *     if (event.type === "error") { ...tampilkan error... }
 *   }
 *
 * @param {File[]} files -- daftar file PDF rekening koran (boleh multi bulan/bank)
 * @param {number|string} clientId -- wajib (dipakai backend utk cache
 *   jalur ekstraksi per-bank & cache hasil ekstraksi per-file, supaya
 *   retry berikutnya dengan file yang sama jauh lebih cepat)
 * @param {number} [tahun] -- opsional, tahun buku kertas kerja (kalau
 *   dikosongkan, backend menebak dari tanggal transaksi -- lihat
 *   tentukan_tahun_dari_gl() di kertas_kerja.py)
 */
export async function* generateKertasKerjaStream(files, clientId, tahun /* optional */) {
  const headers = {};
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  if (tahun) formData.append("tahun", tahun);

  const res = await fetch(`${API_BASE_URL}/api/client/${clientId}/kertas-kerja/generate/stream`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let batasEvent;
    while ((batasEvent = buffer.indexOf("\n\n")) !== -1) {
      const eventMentah = buffer.slice(0, batasEvent);
      buffer = buffer.slice(batasEvent + 2);

      const baris = eventMentah.split("\n").find((l) => l.startsWith("data: "));
      if (!baris) continue;
      const isiData = baris.slice("data: ".length).trim();

      if (isiData === "[DONE]") return;

      let data;
      try {
        data = JSON.parse(isiData);
      } catch {
        continue; // baris tidak valid JSON, lewati
      }

      yield data;
    }
  }
}

/**
 * unduhFileBase64 -- decode string base64 (mis. `file_base64` dari event
 * "result" generateKertasKerjaStream()) jadi file yang langsung ke-download
 * browser, TANPA request tambahan ke backend (isi file sudah lengkap
 * dikirim lewat event SSE, jadi tidak perlu urlUnduhHasil() terpisah).
 *
 * @param {string} fileBase64
 * @param {string} namaFile -- nama file saat di-download, mis. dari field `nama_file` di event result
 * @param {string} [mimeType] -- default .xlsx (Kertas Kerja selalu Excel)
 */
export function unduhFileBase64(
  fileBase64,
  namaFile,
  mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
) {
  const byteChars = atob(fileBase64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = namaFile || "Kertas_Kerja_Laporan_Keuangan.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// [BARU] AI File Reader -- kirim 1 file (teks/gambar/PDF) + pertanyaan
// bebas ke POST /api/ai-baca-file (lihat main.py::api_ai_baca_file +
// modules/ai_file_reader.py). Backend meneruskan file itu APA ADANYA ke
// Claude API (bukan pipeline akuntansi_ai.py/kertas_kerja.py yang sudah
// ada -- fitur ini berdiri sendiri, tidak mengubah pipeline lain).
// ------------------------------------------------------------

/**
 * aiBacaFile -- upload 1 file + pertanyaan bebas, dapat jawaban dari AI
 * yang langsung "membaca" isi file itu (tanpa parsing manual di frontend
 * ataupun backend).
 *
 * @param {File} file -- file teks (.md/.txt/.csv/.json/.html), gambar
 *   (.png/.jpg/.jpeg/.gif/.webp), atau .pdf
 * @param {string} pertanyaan -- instruksi bebas, mis. "Ringkas dokumen ini"
 * @returns {Promise<{nama_file: string, jawaban: string}>}
 */
export async function aiBacaFile(file, pertanyaan) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pertanyaan", pertanyaan);
  return request("/api/ai-baca-file", { method: "POST", body: formData });
}

// [BARU] aiBacaBanyakFile -- versi banyak file dalam 1 pertanyaan (mis.
// "bandingkan file A dan B", "rekap semua rekening koran ini") --
// lihat POST /api/ai-baca-banyak-file di main.py +
// ai_file_reader.kirim_banyak_file_ke_ai untuk batasan (limit gambar per
// request, limit payload gabungan 32MB).
/**
 * @param {File[]} files -- boleh campur teks/gambar/PDF
 * @param {string} pertanyaan -- instruksi bebas yang berlaku utk SEMUA file
 * @returns {Promise<{nama_file: string[], jawaban: string}>}
 */
export async function aiBacaBanyakFile(files, pertanyaan) {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  formData.append("pertanyaan", pertanyaan);
  return request("/api/ai-baca-banyak-file", { method: "POST", body: formData });
}

// [BARU -- POIN 4] aiBacaFileStream -- versi STREAM dari aiBacaFile, ke
// POST /api/ai-baca-file-stream (lihat main.py::api_ai_baca_file_stream).
//
// BEDA dari generateKertasKerjaStream() di atas: endpoint kertas kerja
// mengirim SSE ("data: {...json...}\n\n" per event terstruktur),
// sedangkan endpoint ini mengirim `text/plain` POLOS -- potongan teks
// jawaban apa adanya, TANPA bungkus JSON/event. Jadi parsing-nya lebih
// sederhana: baca ReadableStream, decode tiap chunk, yield string-nya
// langsung (bukan parse "data: " + JSON.parse seperti stream SSE).
//
// Dipakai di komponen React dengan:
//   for await (const potongan of api.aiBacaFileStream(file, pertanyaan)) {
//     setJawaban((prev) => prev + potongan);
//   }
//
// @param {File} file
// @param {string} pertanyaan
// @returns {AsyncGenerator<string>} potongan teks jawaban, satu per satu
export async function* aiBacaFileStream(file, pertanyaan) {
  const headers = {};
  if (_token) {
    headers["Authorization"] = `Bearer ${_token}`;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("pertanyaan", pertanyaan);

  const res = await fetch(`${API_BASE_URL}/api/ai-baca-file-stream`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok || !res.body) {
    // Endpoint ini balas JSON (HTTPException) kalau gagal SEBELUM stream
    // mulai (400/413/500 -- lihat validasi di main.py, dilakukan sebelum
    // StreamingResponse dibuka) -- baca sebagai JSON di sini, BUKAN
    // sebagai stream teks.
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request gagal (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const potongan = decoder.decode(value, { stream: true });
    if (potongan) yield potongan;
  }
}