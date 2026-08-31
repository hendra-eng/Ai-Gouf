// Konfigurasi metrik untuk setiap jenis dokumen yang bisa diproses.
// Dipakai oleh <DocumentResultView> / <HasilTerpadu> supaya 1 komponen bisa
// menampilkan hasil dari ke-15 jenis dokumen tanpa file terpisah untuk
// masing-masing.
//
// Setiap metrik: { key, label, format }
//   key    -> field di object `ringkasan` hasil proses
//   label  -> teks yang ditampilkan
//   format -> "currency" | "number" | "text"
//
// key di sini DICOCOKKAN LANGSUNG ke nama field yang benar-benar dikembalikan
// oleh akuntansi_ai.py (bukan tebakan lagi -- versi sebelumnya banyak yang
// salah, lihat riwayat perbaikan bug #6). Kalau backend berubah nama field,
// update di sini juga.
//
// hasJurnal: false -> jenis dokumen ini TIDAK PERNAH menghasilkan draf
// jurnal (bukan cuma kebetulan kosong kali ini), jadi tab "Draf Jurnal"
// disembunyikan sama sekali oleh DocumentResultView / HasilTerpadu.
// Kalau tidak diisi, dianggap true (tab tetap ditampilkan, walau isinya
// bisa 0 baris tergantung data -- itu kondisi normal, bukan bug).
//
// [FIX] Object key TOP-LEVEL di bawah ini (rekening_koran, penilaian_klien,
// buku_bantu_piutang, bukti_potong_pajak, rekonsiliasi_bank) SEBELUMNYA
// ditulis sbg placeholder pendek (bank, penilaian, piutang, bukti_potong,
// rekon_bank) yang TIDAK cocok dengan jenis dokumen asli dari
// _PEMROSES_DOKUMEN di main.py. Akibatnya 5 dari 15 jenis dokumen tidak
// pernah menemukan config-nya di sini: tidak dapat icon/heading/label
// metrik, DAN tab "Draf Jurnal" tetap tampil walau seharusnya
// disembunyikan (jenisPunyaJurnal() balik ke default `true` kalau cfg
// undefined). Key di sini WAJIB persis sama dengan key di
// _PEMROSES_DOKUMEN (main.py) -- jangan disingkat lagi.

export const DOCUMENT_TYPES = {
  rekening_koran: {
    label: "Rekening Koran",
    icon: "🏦",
    heading: "Hasil Kategorisasi / Jurnal — Rekening Koran",
    tabLabel: "🏦 Rekening Koran",
    metrics: [
      { key: "jumlah_transaksi", label: "Jumlah Transaksi", format: "number" },
      { key: "total_debet", label: "Total Debet", format: "currency" },
      { key: "total_kredit", label: "Total Kredit", format: "currency" },
      { key: "selisih", label: "Selisih", format: "currency" },
    ],
  },
  penjualan: {
    label: "Data Penjualan",
    icon: "🛒",
    heading: "Hasil Kategorisasi / Jurnal — Data Penjualan",
    tabLabel: "🧾 Data Penjualan",
    metrics: [
      { key: "jumlah_transaksi", label: "Jumlah Transaksi", format: "number" },
      { key: "total_penjualan", label: "Total Penjualan", format: "currency" },
      { key: "rata_rata_transaksi", label: "Rata-rata / Transaksi", format: "currency" },
      { key: "selisih", label: "Selisih Jurnal", format: "currency" },
    ],
  },
  penilaian_klien: {
    label: "Penilaian Klien / Maker",
    icon: "📊",
    heading: "📊 Hasil — Penilaian Klien / Maker",
    tabLabel: "📊 Penilaian Klien/Maker",
    hasJurnal: false,
    metrics: [
      { key: "total_klien_dinilai", label: "Klien Dinilai", format: "number" },
      { key: "rata_rata_score", label: "Rata-rata Score", format: "number" },
      { key: "total_temuan", label: "Jumlah Temuan", format: "number" },
      { key: "total_koreksi_otomatis", label: "Koreksi Otomatis", format: "number" },
      { key: "status_global", label: "Status", format: "text" },
    ],
  },
  buku_bantu_piutang: {
    label: "Piutang",
    icon: "💳",
    heading: "📋 Hasil — Buku Bantu Piutang",
    tabLabel: "📋 Buku Bantu Piutang",
    hasJurnal: false,
    metrics: [
      { key: "jumlah_transaksi", label: "Jumlah Transaksi", format: "number" },
      { key: "jumlah_pelanggan", label: "Jumlah Pelanggan", format: "number" },
      { key: "total_piutang", label: "Total Piutang", format: "currency" },
    ],
  },
  faktur_pajak: {
    label: "Faktur Pajak (PPN)",
    icon: "🧾",
    heading: "🧾 Hasil — Faktur Pajak (PPN)",
    tabLabel: "🧾 Faktur Pajak (PPN)",
    metrics: [
      { key: "jumlah_faktur", label: "Jumlah Faktur", format: "number" },
      { key: "total_dpp", label: "Total DPP", format: "currency" },
      { key: "total_ppn", label: "Total PPN", format: "currency" },
      { key: "ppn_keluaran", label: "PPN Keluaran", format: "currency" },
      { key: "ppn_masukan", label: "PPN Masukan", format: "currency" },
    ],
  },
  bukti_potong_pajak: {
    label: "Bukti Potong (PPh 21/23/4(2))",
    icon: "📑",
    heading: "📑 Hasil — Bukti Potong (PPh 21/23/4(2))",
    tabLabel: "📑 Bukti Potong (PPh 21/23/4(2))",
    metrics: [
      { key: "jumlah_bukti_potong", label: "Jumlah Bukti Potong", format: "number" },
      { key: "total_dpp", label: "Total DPP", format: "currency" },
      { key: "total_pph", label: "Total PPh Dipotong", format: "currency" },
    ],
  },
  spt_masa: {
    label: "SPT Masa/Tahunan",
    icon: "📅",
    heading: "📅 Hasil — SPT Masa/Tahunan",
    tabLabel: "📅 SPT Masa/Tahunan",
    metrics: [
      { key: "jumlah_spt", label: "Jumlah SPT", format: "number" },
      { key: "jumlah_kurang_bayar", label: "Kurang Bayar (jumlah)", format: "number" },
      { key: "total_kurang_bayar", label: "Total Kurang Bayar", format: "currency" },
      { key: "jumlah_lebih_bayar", label: "Lebih Bayar (jumlah)", format: "number" },
      { key: "total_lebih_bayar", label: "Total Lebih Bayar", format: "currency" },
      { key: "jumlah_nihil", label: "Nihil (jumlah)", format: "number" },
    ],
  },
  slip_gaji: {
    label: "Slip Gaji Karyawan",
    icon: "💰",
    heading: "💰 Hasil — Slip Gaji Karyawan",
    tabLabel: "💰 Slip Gaji Karyawan",
    metrics: [
      { key: "jumlah_karyawan", label: "Jumlah Karyawan", format: "number" },
      { key: "total_gaji_bruto", label: "Total Gaji Bruto", format: "currency" },
      { key: "total_gaji_bersih_dibayarkan", label: "Total Gaji Bersih", format: "currency" },
      { key: "total_pph21", label: "Total PPh 21", format: "currency" },
      { key: "total_bpjs_kesehatan_karyawan", label: "BPJS Kesehatan (Karyawan)", format: "currency" },
      { key: "total_bpjs_jht_karyawan", label: "BPJS JHT (Karyawan)", format: "currency" },
      { key: "total_bpjs_jp_karyawan", label: "BPJS JP (Karyawan)", format: "currency" },
    ],
  },
  bukti_kas: {
    label: "Bukti Kas Masuk/Keluar",
    icon: "💵",
    heading: "💵 Hasil — Bukti Kas Masuk/Keluar",
    tabLabel: "💵 Bukti Kas Masuk/Keluar",
    metrics: [
      { key: "jumlah_bukti", label: "Jumlah Bukti", format: "number" },
      { key: "jumlah_sheet", label: "Jumlah Sheet/Kas", format: "number" },
      { key: "total_kas_masuk", label: "Total Kas Masuk", format: "currency" },
      { key: "total_kas_keluar", label: "Total Kas Keluar", format: "currency" },
      { key: "saldo_bersih_periode", label: "Saldo Bersih Periode", format: "currency" },
      // [BARU] 4 metrik ini SUDAH ADA di ringkasan backend (akuntansi_ai.py::
      // proses_bukti_kas) sejak lama tapi belum pernah ditambahkan ke sini,
      // jadi tidak pernah tampil di kartu metrik walau datanya sudah benar.
      { key: "jumlah_duplikat", label: "Nomor Duplikat", format: "number" },
      { key: "jumlah_selisih_saldo", label: "Selisih Saldo Berjalan", format: "number" },
      { key: "jumlah_nominal_ekstrim", label: "Nominal Ekstrim", format: "number" },
      // [BARU] Metrik baru dari perbaikan bug "kolom Kas Masuk & Kas Keluar
      // terisi bersamaan" -- lihat catatan [FIX] di proses_bukti_kas().
      { key: "jumlah_ambigu_masuk_keluar", label: "Baris Ambigu (Masuk & Keluar Terisi)", format: "number" },
    ],
  },
  kartu_stok: {
    label: "Kartu Stok/Persediaan",
    icon: "📦",
    heading: "📦 Hasil — Kartu Stok/Persediaan",
    tabLabel: "📦 Kartu Stok/Persediaan",
    metrics: [
      { key: "jumlah_barang", label: "Jumlah Barang", format: "number" },
      { key: "jumlah_baris_mutasi", label: "Jumlah Baris Mutasi", format: "number" },
      { key: "total_qty_masuk", label: "Total Unit Masuk", format: "number" },
      { key: "total_qty_keluar", label: "Total Unit Keluar", format: "number" },
    ],
  },
  aset_tetap: {
    label: "Daftar Aset Tetap & Penyusutan",
    icon: "🏢",
    heading: "🏢 Hasil — Daftar Aset Tetap & Penyusutan",
    tabLabel: "🏢 Aset Tetap",
    metrics: [
      { key: "jumlah_aset", label: "Jumlah Aset", format: "number" },
      { key: "total_harga_perolehan", label: "Total Harga Perolehan", format: "currency" },
      { key: "total_akumulasi_penyusutan_seharusnya", label: "Total Akumulasi Penyusutan", format: "currency" },
      { key: "total_penyusutan_per_bulan", label: "Penyusutan / Bulan", format: "currency" },
    ],
  },
  pembelian: {
    label: "Purchase Order (PO) & Invoice Pembelian",
    icon: "🛒",
    heading: "🛒 Hasil — Purchase Order (PO) & Invoice Pembelian",
    tabLabel: "🛒 PO/Invoice Pembelian",
    metrics: [
      { key: "jumlah_baris", label: "Jumlah Baris", format: "number" },
      { key: "jumlah_baris_po", label: "Jumlah Baris PO", format: "number" },
      { key: "jumlah_baris_invoice", label: "Jumlah Baris Invoice", format: "number" },
      { key: "total_nilai_po", label: "Total Nilai PO", format: "currency" },
      { key: "total_nilai_invoice", label: "Total Nilai Invoice", format: "currency" },
    ],
  },
  // [FIX] Key metrics SEBELUMNYA (saldo_menurut_buku, saldo_menurut_bank,
  // selisih, status_rekonsiliasi) itu field dari ringkasan PER-SHEET
  // (helper sebelum proses_file_rekonsiliasi_bank di akuntansi_ai.py).
  // Tapi ringkasan yang BENAR-BENAR dikirim ke frontend di level atas
  // adalah "ringkasan_gabungan" -- dibuat karena 1 file bisa berisi
  // banyak rekening/sheet sekaligus dan saldo SENGAJA tidak dijumlah
  // lintas rekening (lihat catatan di ringkasan_gabungan, akuntansi_ai.py
  // baris ~6843). Akibatnya ke-4 metrik lama selalu tampil "-" walau
  // datanya benar. Detail saldo per rekening tetap ada, tapi di dalam
  // ringkasan.daftar_sheet[i] (atau hasil.per_sheet[i].ringkasan), bukan
  // di level atas -- kalau nanti mau ditampilkan per-rekening, itu perlu
  // tabel terpisah, bukan lewat metrics[] biasa (yang cuma baca
  // ringkasan[key] langsung).
  rekonsiliasi_bank: {
    label: "Rekonsiliasi Bank",
    icon: "🏦",
    heading: "🏦 Hasil — Rekonsiliasi Bank",
    tabLabel: "🏦 Rekonsiliasi Bank",
    metrics: [
      { key: "jumlah_sheet_direkonsiliasi", label: "Jumlah Rekening/Sheet", format: "number" },
      { key: "jumlah_sheet_balance", label: "Sheet BALANCE", format: "number" },
      { key: "jumlah_sheet_tidak_balance", label: "Sheet Tidak Balance", format: "number" },
      { key: "jumlah_item_total", label: "Jumlah Item Total", format: "number" },
      { key: "jumlah_perlu_review_total", label: "Perlu Review", format: "number" },
    ],
  },
  ap_aging: {
    label: "Buku Bantu Utang (AP Aging)",
    icon: "📑",
    heading: "📑 Hasil — Buku Bantu Utang (AP Aging)",
    tabLabel: "📑 Buku Bantu Utang (AP Aging)",
    hasJurnal: false,
    metrics: [
      { key: "jumlah_invoice", label: "Jumlah Invoice", format: "number" },
      { key: "jumlah_supplier", label: "Jumlah Supplier", format: "number" },
      { key: "total_sisa_utang", label: "Total Sisa Utang", format: "currency" },
      { key: "jumlah_lewat_90_hari", label: "Lewat 90 Hari (jumlah)", format: "number" },
    ],
  },
  absensi: {
    label: "Data Absensi/Timesheet",
    icon: "🕒",
    heading: "🕒 Hasil — Data Absensi/Timesheet",
    tabLabel: "🕒 Absensi/Timesheet",
    hasJurnal: false,
    metrics: [
      { key: "jumlah_karyawan", label: "Jumlah Karyawan", format: "number" },
      { key: "total_hadir", label: "Total Hadir", format: "number" },
      { key: "total_izin", label: "Total Izin", format: "number" },
      { key: "total_sakit", label: "Total Sakit", format: "number" },
      { key: "total_cuti", label: "Total Cuti", format: "number" },
      { key: "total_alpha", label: "Total Alpha", format: "number" },
    ],
  },
};

// Urutan tampil kategori hasil, persis `_urutan_default` di app.py.
// Hanya kategori yang punya data (lihat _kategori_tersedia) yang dirender jadi tab.
export const CATEGORY_ORDER = [
  "rekening_koran", "penjualan", "penilaian_klien", "buku_bantu_piutang", "faktur_pajak", "bukti_potong_pajak",
  "spt_masa", "slip_gaji", "bukti_kas", "kartu_stok", "aset_tetap", "pembelian",
  "rekonsiliasi_bank", "ap_aging", "absensi",
];

export function formatMetricValue(value, format) {
  if (value === undefined || value === null) return "-";
  if (format === "currency") {
    const n = Number(value);
    return Number.isFinite(n) ? `Rp${n.toLocaleString("id-ID")}` : String(value);
  }
  if (format === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("id-ID") : String(value);
  }
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return String(value);
}

// true kalau jenis dokumen ini memang bisa punya draf jurnal (tab "Draf
// Jurnal" boleh ditampilkan). false kalau jenis dokumennya memang tidak
// pernah menghasilkan jurnal sama sekali (lihat akuntansi_ai.py).
export function jenisPunyaJurnal(docType) {
  const cfg = DOCUMENT_TYPES[docType];
  return cfg ? cfg.hasJurnal !== false : true;
}