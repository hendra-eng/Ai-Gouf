"""
modules/calk_mapping.py
=========================
[FASE 2 -- roadmap CALK] Peta akun COA (kategori + sub_kategori) -> note
CALK, dan fungsi pengelompokan akun neraca/laba-rugi (2 periode: now &
lalu) jadi bentuk siap pakai oleh fungsi tulis_note_* di
modules/calk_export.py (Fase 1, sudah selesai).

TIDAK menghitung ulang saldo apa pun -- murni mengelompokkan output
susun_neraca()/susun_laba_rugi() (laporan_keuangan.py, SUDAH dihitung)
per note, untuk kedua periode sekaligus (dicocokkan per no_akun).

KONVENSI sub_kategori yang DIPAKAI ULANG (SUDAH ada & dipakai fungsi lain
di laporan_keuangan.py -- lihat susun_lampiran_spt_bs()/susun_lampiran_spt_pnl()
-- SENGAJA TIDAK diubah di sini supaya bucket A01-A09/L01-L05 SPT Tahunan
Badan yang sudah jalan tetap benar):
    ASET      : "Kas", "Piutang", "Persediaan", "Aset Lancar",
                "Aset Tetap", "Akumulasi Penyusutan", "Aset Lainnya"
    BEBAN     : "HPP", "Penyusutan", "Lain-lain"
    PENDAPATAN: "Lain-lain" (selain itu dianggap usaha)

KONVENSI BARU (LIABILITAS/EKUITAS BELUM punya sub_kategori baku di
manapun di sistem ini sebelumnya -- aman diperkenalkan DI SINI karena
tidak ada logika lain yang membaca sub_kategori LIABILITAS/EKUITAS
sekarang, jadi tidak ada resiko merusak fitur lain). Kalau field ini
kosong/diisi nilai lain di COA, akun otomatis jatuh ke note fallback
("Lain-lain" note terkait) -- TIDAK PERNAH hilang diam-diam:
    LIABILITAS: "Utang Usaha", "Utang Pajak",
                "Biaya Masih Harus Dibayar" (atau "Beban Masih Harus
                Dibayar", keduanya diterima), fallback -> "Utang Lain-lain"
    EKUITAS   : semua akun EKUITAS default -> Note Modal (belum ada
                pemisahan "Laba Ditahan" -- lihat Keputusan #3 di bawah)

[3 KEPUTUSAN -- SUDAH DIPUTUSKAN: pertahankan fallback yang sudah jalan
 (TIDAK diubah strukturnya), lihat alasan tiap poin. Kalau kelak ada
 client yang butuh perilaku lain, baru diimplementasi saat itu -- lebih
 aman daripada mengubah field yang sudah dipakai fitur lain (SPT
 Tahunan Badan) tanpa kebutuhan nyata di depan mata.]

1. Piutang Usaha vs Piutang Lainnya (Note 4 vs Note 5) SAMA-SAMA
   sub_kategori "Piutang" di COA (tidak ada pembeda formal di COA
   sekarang) -- dibedakan DI SINI lewat KEYWORD nama_akun ("lain" di
   nama akun -> Note 5, selainnya -> Note 4).
   KEPUTUSAN: PERTAHANKAN keyword-matching apa adanya. Opsi menambah
   sub_kategori baru ("Piutang Usaha"/"Piutang Lain-lain") DITOLAK utk
   saat ini -- itu mengubah field yang sudah dipakai susun_lampiran_spt_bs()
   (A02_Piutang, exact-match "Piutang"), jadi berisiko merusak SPT
   Tahunan Badan yang sudah jalan tanpa manfaat langsung (belum ada
   client nyata yang datanya salah klasifikasi karena keyword ini).
   Kalau nanti ketemu client dgn akun spt "Piutang Karyawan" yang salah
   ke-tag "Piutang Usaha", baru pertimbangkan opsi itu -- DAN update
   susun_lampiran_spt_bs()/_bs_rinci() bersamaan, jangan terpisah.

2. Sub_kategori BEBAN "HPP" (Harga Pokok Penjualan) dan "Penyusutan"
   BELUM ada fungsi tulis_note khusus di calk_export.py (cuma ada Note
   13 "Beban Usaha" generik).
   KEPUTUSAN: PERTAHANKAN digabung ke Note 13 Beban Usaha. File
   referensi PT AADL (bisnis jasa/F&B) tidak butuh Note "Beban Pokok
   Penjualan" terpisah, jadi tidak ada urgensi bikin fungsi tulis_note
   baru sekarang. Kalau nanti ada client dagang/manufaktur yang butuh
   Note HPP terpisah (umum di usaha jenis itu), baru tulis
   tulis_note_hpp() baru + tambah entri "hpp" ke DAFTAR_NOTE_CALK dan
   pisahkan _note_key_untuk_beban() dari "beban_usaha".

3. EKUITAS: SEMUA akun ekuitas (Modal Disetor maupun Laba Ditahan kalau
   ada akunnya) default masuk Note 11 Modal apa adanya.
   KEPUTUSAN: PERTAHANKAN. File referensi PT AADL cuma punya akun modal
   per pemegang saham (tidak ada akun "Laba Ditahan" terpisah di
   COA-nya, laba/rugi berjalan masuk lewat baris tambahan otomatis di
   susun_neraca(), bukan akun COA) -- asumsi ini aman utk kasus itu.
   Kalau client lain punya akun "Laba Ditahan" eksplisit di COA-nya dan
   mau dipisah dari Note Modal, baru tambah sub_kategori EKUITAS baru +
   note tersendiri saat itu diperlukan.

[GROUPING MANUAL PIUTANG USAHA -- Note 4, OPSIONAL, lihat fungsi
susun_grouping_piutang_usaha() & param grouping_piutang_usaha di
kelompokkan_akun_calk() di bawah]
kelompokkan_akun_calk() SENDIRI tetap TIDAK mendeteksi cabang/channel
otomatis (tidak ada field COA utk itu, keputusan ini TIDAK berubah).
Tapi kalau pemanggil SUDAH TAHU pengelompokan cabang/channel yang
diinginkan (mis. dari percakapan dgn client, seperti contoh referensi
PT AADL), itu bisa disuplai lewat parameter opsional -- dipetakan by
no_akun (BUKAN keyword nama_akun, supaya presisi & tidak salah
tangkap akun lain yang kebetulan mirip namanya). Kalau parameter ini
tidak diisi, hasilnya PERSIS SAMA seperti sebelumnya (flat, tidak ada
perubahan perilaku default).

[ASET TETAP -- SUMBER DATA BEDA, LIHAT CATATAN INI DULU]
Note 7 (Aset Tetap) BUTUH data mutasi (saldo awal/penambahan/pengurangan/
saldo akhir per kategori aset), BUKAN cuma saldo_akhir titik waktu
seperti note lain -- neraca biasa (susun_neraca()) tidak punya bentuk
ini. Fungsi kelompokkan_akun_calk() di bawah SENGAJA TIDAK mengisi
"aset_tetap" (dikosongkan, kosong=True) -- pemanggil (orchestrator
Fase 3) WAJIB mengisi manual dari sumber lain (kemungkinan besar
modul aset tetap yang sudah ada -- proses_aset_tetap()'s
jadwal_penyusutan_bulanan, cek modules/akuntansi_ai.py -- BELUM
diverifikasi field-nya cocok langsung dgn parameter tulis_note_7_aset_tetap()
di sesi ini, karena akuntansi_ai.py belum diupload).
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple


# ============================================================
# 1. DEFINISI URUTAN & JUDUL NOTE (dipakai utk auto-numbering Fase 3)
# ============================================================
# Urutan list = urutan tampil default (note nomor 3 dst -- Note 1 "Umum"
# & Note 2 "Kebijakan Akuntansi" SELALU ada & tidak lewat peta ini,
# lihat tulis_note_1_umum()/tulis_note_2_kebijakan_akuntansi() di
# calk_export.py). Note 15 "Perpajakan" juga tidak lewat peta ini --
# sumbernya modules.pph_badan, bukan akun COA biasa.
#
# Tiap entri:
#   key                 -- id internal (dipakai orchestrator Fase 3)
#   judul_id/en         -- judul note
#   fungsi              -- nama fungsi tulis_note_* khusus di
#                          calk_export.py, ATAU "akun_generik" kalau
#                          cukup pakai tulis_note_akun_generik() apa
#                          adanya (note yang tidak ada di file referensi
#                          user, ditambahkan preventif spt roadmap Fase 2
#                          poin 6 -- "jangan sampai akun hilang diam-diam")
#   label_jumlah_id/en  -- override label baris total kalau fungsi
#                          "akun_generik" (None = default
#                          "Jumlah {judul}"/"Total {judul}")

DAFTAR_NOTE_CALK: List[Dict[str, Any]] = [
    {"key": "kas", "judul_id": "KAS DAN SETARA KAS", "judul_en": "CASH AND CASH EQUIVALENT",
     "fungsi": "tulis_note_3_kas_dan_setara_kas"},
    {"key": "piutang_usaha", "judul_id": "PIUTANG USAHA", "judul_en": "ACCOUNT RECEIVABLES",
     "fungsi": "tulis_note_4_piutang_usaha"},
    {"key": "piutang_lain", "judul_id": "PIUTANG LAINNYA", "judul_en": "OTHER RECEIVABLE",
     "fungsi": "tulis_note_5_piutang_lainnya"},
    {"key": "persediaan", "judul_id": "PERSEDIAAN", "judul_en": "INVENTORY",
     "fungsi": "akun_generik", "label_jumlah_id": "Jumlah", "label_jumlah_en": "Total"},
    {"key": "biaya_dibayar_dimuka", "judul_id": "BIAYA DIBAYAR DIMUKA", "judul_en": "PREPAID EXPENSES",
     "fungsi": "tulis_note_6_biaya_dibayar_dimuka"},
    {"key": "aset_tetap", "judul_id": "ASET TETAP", "judul_en": "FIXED ASSETS",
     "fungsi": "tulis_note_7_aset_tetap", "sumber_khusus": True},
    {"key": "aset_lain", "judul_id": "ASET LAINNYA", "judul_en": "OTHER ASSETS",
     "fungsi": "akun_generik", "label_jumlah_id": "Jumlah", "label_jumlah_en": "Total"},
    {"key": "utang_usaha", "judul_id": "UTANG USAHA", "judul_en": "TRADE PAYABLES",
     "fungsi": "tulis_note_8_utang_usaha"},
    {"key": "utang_pajak", "judul_id": "UTANG PAJAK", "judul_en": "TAX PAYABLES",
     "fungsi": "tulis_note_9_utang_pajak"},
    {"key": "biaya_masih_harus_dibayar", "judul_id": "BIAYA YANG MASIH HARUS DIBAYAR",
     "judul_en": "ACCRUED EXPENSES", "fungsi": "tulis_note_10_biaya_masih_harus_dibayar"},
    {"key": "utang_lain", "judul_id": "UTANG LAIN-LAIN", "judul_en": "OTHER PAYABLES",
     "fungsi": "akun_generik", "label_jumlah_id": "Jumlah", "label_jumlah_en": "Total"},
    {"key": "modal", "judul_id": "MODAL", "judul_en": "SHARE CAPITAL",
     "fungsi": "tulis_note_11_modal"},
    {"key": "pendapatan_usaha", "judul_id": "PENDAPATAN USAHA", "judul_en": "OPERATING REVENUE",
     "fungsi": "tulis_note_12_pendapatan_usaha"},
    {"key": "beban_usaha", "judul_id": "BEBAN USAHA", "judul_en": "OPERATING EXPENSES",
     "fungsi": "tulis_note_13_beban_usaha"},
    {"key": "pendapatan_beban_lain", "judul_id": "PENDAPATAN (BEBAN) LAIN-LAIN",
     "judul_en": "OTHER INCOME (EXPENSES)", "fungsi": "tulis_note_14_pendapatan_beban_lain"},
]

_PETA_NOTE_BY_KEY: Dict[str, Dict[str, Any]] = {n["key"]: n for n in DAFTAR_NOTE_CALK}


# ============================================================
# 2. ATURAN PENGELOMPOKAN sub_kategori -> note key
# ============================================================
# Tiap fungsi mengembalikan (key, dikenal) -- dikenal=False artinya
# sub_kategori TIDAK cocok konvensi manapun (kosong atau nilai lain),
# jatuh ke fallback -- dipakai kelompokkan_akun_calk() utk mengisi
# daftar "peringatan_sub_kategori_tidak_dikenal" (bukan utk memblokir,
# cuma penanda supaya akuntan bisa cek/lengkapi COA kalau perlu).

def _note_key_untuk_aset(sub_kategori: Optional[str], nama_akun: str) -> Tuple[str, bool]:
    sk = (sub_kategori or "").strip()
    if sk == "Kas":
        return "kas", True
    if sk == "Piutang":
        # [Keputusan #1] dibedakan lewat keyword nama akun, bukan
        # sub_kategori terpisah -- lihat catatan modul.
        return ("piutang_lain" if "lain" in nama_akun.lower() else "piutang_usaha"), True
    if sk == "Persediaan":
        return "persediaan", True
    if sk == "Aset Lancar":
        # Konvensi existing (laporan_keuangan.py A04_Aset_Lancar_Lainnya)
        # -- di praktik lapangan hampir selalu isinya uang muka/beban
        # dibayar dimuka non-kas/piutang/persediaan.
        return "biaya_dibayar_dimuka", True
    if sk in ("Aset Tetap", "Akumulasi Penyusutan"):
        return "aset_tetap", True
    if sk == "Aset Lainnya":
        return "aset_lain", True
    return "aset_lain", False  # fallback -- sub_kategori kosong/tidak dikenal


def _note_key_untuk_liabilitas(sub_kategori: Optional[str]) -> Tuple[str, bool]:
    sk = (sub_kategori or "").strip()
    if sk == "Utang Usaha":
        return "utang_usaha", True
    if sk == "Utang Pajak":
        return "utang_pajak", True
    if sk in ("Biaya Masih Harus Dibayar", "Beban Masih Harus Dibayar"):
        return "biaya_masih_harus_dibayar", True
    return "utang_lain", False  # fallback


def _note_key_untuk_ekuitas(sub_kategori: Optional[str]) -> Tuple[str, bool]:
    # [Keputusan #3] semua EKUITAS default -> Note Modal apa adanya.
    return "modal", True


def _note_key_untuk_pendapatan(sub_kategori: Optional[str]) -> Tuple[str, bool]:
    sk = (sub_kategori or "").strip()
    return ("pendapatan_beban_lain" if sk == "Lain-lain" else "pendapatan_usaha"), True


def _note_key_untuk_beban(sub_kategori: Optional[str]) -> Tuple[str, bool]:
    sk = (sub_kategori or "").strip()
    if sk == "Lain-lain":
        return "pendapatan_beban_lain", True
    if sk in ("HPP", "Penyusutan"):
        # [Keputusan #2] digabung ke Beban Usaha sementara -- lihat
        # catatan modul.
        return "beban_usaha", True
    return "beban_usaha", (sk == "")  # sub_kategori lain (bukan kosong) tetap dianggap "dikenal"
    # (BEBAN memang boleh punya sub_kategori bebas selain HPP/Penyusutan/
    # Lain-lain -- lihat komentar di laporan_keuangan.py baris ~1444,
    # "BEBAN lainnya (sub_kategori apa pun/kosong selain 3 di atas)" itu
    # memang dianggap Beban Usaha biasa, jadi hanya sub_kategori KOSONG
    # yang ditandai sbg fallback perlu-dicek di sini).


# ============================================================
# 3. PENGELOMPOKAN AKUN 2-PERIODE -> BENTUK SIAP PAKAI tulis_note_*
# ============================================================

def kelompokkan_akun_calk(
    neraca_now: Dict[str, Any], neraca_lalu: Dict[str, Any],
    laba_rugi_now: Dict[str, Any], laba_rugi_lalu: Dict[str, Any],
    grouping_piutang_usaha: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Kelompokkan SEMUA akun neraca+laba rugi (2 periode) ke note CALK,
    berdasarkan (kategori, sub_kategori) tiap akun -- lihat aturan di
    atas. TIDAK menghitung ulang saldo (pakai saldo_akhir apa adanya
    dari susun_neraca()/susun_laba_rugi()). SECARA OTOMATIS TIDAK
    menyusun subgrup (mis. pengelompokan per cabang/channel penjualan
    spt Note 4 Piutang Usaha di contoh referensi PT AADL) krn tidak ada
    field COA standar utk "cabang"/"channel" -- TAPI bisa disuplai
    MANUAL lewat parameter grouping_piutang_usaha di bawah kalau
    pemanggil sudah tahu pengelompokannya (lihat
    susun_grouping_piutang_usaha() docstring utk format persis).

    Args:
        neraca_now/lalu   : output susun_neraca() (laporan_keuangan.py)
                             utk tanggal_now/tanggal_lalu -- DUA
                             panggilan terpisah dgn saldo_per_akun yang
                             beda cutoff, dilakukan pemanggil sebelum
                             fungsi ini.
        laba_rugi_now/lalu: output susun_laba_rugi() utk periode
                             berjalan & pembanding (Note 12/13/14 --
                             akun FLOW/akumulasi periode, BUKAN saldo
                             per tanggal -- lihat catatan penting di
                             tulis_note_12_pendapatan_usaha() docstring
                             calk_export.py).
        grouping_piutang_usaha: OPSIONAL -- kalau diisi, note
            "piutang_usaha" disusun ULANG jadi bentuk subgrup+indent
            (format persis Note 4 file referensi PT AADL) lewat
            susun_grouping_piutang_usaha() (lihat docstring fungsi itu
            utk format Dict yang diharapkan). Kalau None (default),
            note "piutang_usaha" tetap FLAT seperti sebelumnya -- TIDAK
            ADA PERUBAHAN PERILAKU dari versi sebelum ini.

    Returns:
        {
          "notes": OrderedDict {note_key: {..config dari DAFTAR_NOTE_CALK,
                                "daftar_akun": [...], "kosong": bool}},
          "peringatan_sub_kategori_tidak_dikenal": [
                {"no_akun", "nama_akun", "kategori", "sub_kategori", "masuk_ke": note_key}, ...
          ],
          "peringatan_grouping_piutang_usaha": [str, ...],  -- [BARU]
                kosong kalau grouping_piutang_usaha None ATAU semua
                no_akun di dalamnya valid & cocok. Lihat
                susun_grouping_piutang_usaha() utk kapan ini terisi
                (mis. no_akun di definisi grouping salah ketik/tidak
                ada di daftar akun piutang usaha aktual).
        }
        Urutan "notes" mengikuti DAFTAR_NOTE_CALK -- pemanggil (Fase 3)
        tinggal loop, skip yang "kosong": True, nomor note auto-increment
        dari situ. Note "aset_tetap" SELALU balik "kosong": True & 
        "daftar_akun": [] dari fungsi ini (sumber datanya bukan neraca/
        laba-rugi biasa, lihat docstring modul) -- pemanggil (Fase 3)
        WAJIB cek sendiri ke sumber data aset tetap (mis. modul mutasi
        aset tetap yang sudah ada) utk menentukan apakah note ini perlu
        tampil, BUKAN mengandalkan flag "kosong" note ini apa adanya.
    """
    hasil: "OrderedDict[str, Dict[str, Any]]" = OrderedDict(
        (n["key"], {**n, "daftar_akun": [], "kosong": True})
        for n in DAFTAR_NOTE_CALK
    )
    peringatan: List[Dict[str, Any]] = []

    def _peta_saldo_lalu(sumber: Dict[str, Any], field: str) -> Dict[str, float]:
        return {a["no_akun"]: a.get("saldo_akhir", 0.0) for a in sumber.get(field, [])}

    def _proses(daftar_now: List[Dict[str, Any]], peta_lalu: Dict[str, float],
                klasifikasi, balik_tanda_untuk: Optional[str] = None) -> None:
        for a in daftar_now:
            if isinstance(klasifikasi, tuple):
                # tanda khusus utk BEBAN (perlu nama_akun juga utk ASET,
                # tapi generic call di sini cukup sub_kategori)
                pass
            key, dikenal = klasifikasi(a)
            if key == "aset_tetap":
                continue  # sumber khusus, lihat docstring modul
            now = a.get("saldo_akhir", 0.0)
            lalu = peta_lalu.get(a["no_akun"], 0.0)
            if balik_tanda_untuk and key == balik_tanda_untuk:
                # [konvensi tanda] beban lain-lain harus NEGATIF supaya
                # baris "Jumlah" di Note 14 jadi neto, konsisten dgn
                # susun_laba_rugi() yg simpan semua beban sbg POSITIF --
                # lihat catatan tanda di tulis_note_14_pendapatan_beban_lain().
                now, lalu = -abs(now), -abs(lalu)
            hasil[key]["daftar_akun"].append({
                "tipe": "akun", "label_id": a["nama_akun"], "label_en": a["nama_akun"],
                "now": now, "lalu": lalu,
                # [BARU] no_akun disertakan (sebelumnya tidak) supaya
                # susun_grouping_piutang_usaha() bisa mencocokkan akun
                # by no_akun (presisi, bukan tebak2 dari nama) --
                # tulis_note_akun_generik()/tulis_note_4_piutang_usaha()
                # SAMA SEKALI tidak baca field ini, jadi aman ditambah
                # tanpa mempengaruhi note lain yang sudah jalan.
                "no_akun": a["no_akun"],
                # [FIX -- rantai keterangan COA -> CALK] Diteruskan dari
                # a["keterangan"] (asalnya AkunCoaRequest.keterangan di
                # main.py, sudah dialirkan sampai sini lewat
                # laporan_keuangan.py::peta_akun_dari_coa()/
                # hitung_saldo_per_akun() -- lihat catatan [FIX] di
                # kedua fungsi itu). calk_export.py::tulis_note_akun_generik()
                # membaca key ini utk auto-translate & render catatan
                # kaki per-akun (lewat terjemahkan_id_ke_en()) -- kosong/
                # None kalau akuntan tidak mengisi apa-apa, note lain
                # yang tidak butuh ini sama sekali tidak terpengaruh.
                "keterangan": a.get("keterangan"),
            })
            hasil[key]["kosong"] = False
            if not dikenal:
                peringatan.append({
                    "no_akun": a["no_akun"], "nama_akun": a["nama_akun"],
                    "kategori": a.get("kategori"), "sub_kategori": a.get("sub_kategori"),
                    "masuk_ke": key,
                })

    _proses(neraca_now.get("aset", []), _peta_saldo_lalu(neraca_lalu, "aset"),
            lambda a: _note_key_untuk_aset(a.get("sub_kategori"), a.get("nama_akun") or ""))
    _proses(neraca_now.get("liabilitas", []), _peta_saldo_lalu(neraca_lalu, "liabilitas"),
            lambda a: _note_key_untuk_liabilitas(a.get("sub_kategori")))
    _proses(neraca_now.get("ekuitas", []), _peta_saldo_lalu(neraca_lalu, "ekuitas"),
            lambda a: _note_key_untuk_ekuitas(a.get("sub_kategori")))
    _proses(laba_rugi_now.get("pendapatan", []), _peta_saldo_lalu(laba_rugi_lalu, "pendapatan"),
            lambda a: _note_key_untuk_pendapatan(a.get("sub_kategori")))
    _proses(laba_rugi_now.get("beban", []), _peta_saldo_lalu(laba_rugi_lalu, "beban"),
            lambda a: _note_key_untuk_beban(a.get("sub_kategori")),
            balik_tanda_untuk="pendapatan_beban_lain")

    peringatan_grouping: List[str] = []
    if grouping_piutang_usaha and not hasil["piutang_usaha"]["kosong"]:
        hasil["piutang_usaha"]["daftar_akun"], peringatan_grouping = susun_grouping_piutang_usaha(
            hasil["piutang_usaha"]["daftar_akun"], grouping_piutang_usaha,
        )

    return {
        "notes": hasil,
        "peringatan_sub_kategori_tidak_dikenal": peringatan,
        "peringatan_grouping_piutang_usaha": peringatan_grouping,
    }


# ============================================================
# 4. GROUPING MANUAL PIUTANG USAHA (Note 4) -- OPSIONAL, by no_akun
# ============================================================

def susun_grouping_piutang_usaha(
    daftar_akun_flat: List[Dict[str, Any]],
    grouping: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Susun ULANG daftar akun piutang usaha (flat, hasil kelompokkan_akun_calk())
    jadi bentuk subgrup+indent -- format PERSIS yang diterima
    tulis_note_4_piutang_usaha() (lihat docstring fungsi itu di
    calk_export.py: {"tipe": "subgrup", ...} diikuti item {"tipe":
    "akun", "indent": True, ...}, campur item {"tipe": "akun"} datar
    utk cabang yang tidak dipecah channel).

    DIPETAKAN by no_akun -- BUKAN keyword nama_akun (beda dari
    Keputusan #1 Piutang Usaha vs Piutang Lainnya di atas, yang memang
    perlu keyword krn tidak ada info lain). Di sini presisi lebih
    penting drpd otomatis, karena salah kelompok cabang tidak ketahuan
    dari total (total tetap benar, cuma tampilannya salah) -- jadi
    LEBIH BAIK akuntan yang tentukan eksplisit per no_akun drpd ditebak
    sistem dari nama akun yang formatnya bisa beda2 tiap client.

    Args:
        daftar_akun_flat: list item {"tipe": "akun", "label_id",
            "label_en", "now", "lalu", "no_akun"} -- persis output
            kelompokkan_akun_calk()["notes"]["piutang_usaha"]["daftar_akun"]
            SEBELUM fungsi ini dipanggil.
        grouping: {
            "cabang": [
                {"label_id": "Omah Soemantri", "label_en": "Omah Soemantri",
                 "no_akun": ["1103.01", "1103.02", ...]},
                {"label_id": "Putu Soemantri", "label_en": "Putu Soemantri",
                 "no_akun": ["1103.05", "1103.06"]},
                ...
            ]
        }
            Urutan list "cabang" = urutan tampil subgrup itu (persis
            file referensi: Omah Soemantri dulu, baru Putu Soemantri).
            Akun yang no_akun-nya TIDAK disebut di manapun dalam
            "cabang" tetap tampil FLAT (baris datar, pakai nama_akun
            aslinya) -- ditaruh SETELAH semua subgrup cabang, urutan
            asli dipertahankan (persis pola "Warung Soemantri"/"Café
            Kapu Soemantri" di file referensi: flat, di akhir).
            Cabang dgn HANYA 1 akun di dalamnya TETAP dibuatkan header
            subgrup (bukan otomatis diratakan) -- kalau akuntan mau
            cabang itu tampil flat/datar, cukup jangan disebut di
            "cabang" sama sekali.

    Returns:
        (daftar_akun_baru, peringatan) -- daftar_akun_baru siap dioper
        langsung ke tulis_note_4_piutang_usaha(). peringatan berisi
        pesan string kalau ada no_akun di definisi "cabang" yang TIDAK
        ketemu di daftar_akun_flat (salah ketik/akun sudah tidak ada
        saldo periode ini) -- TIDAK memblokir, cuma penanda akuntan
        wajib cek ulang definisi grouping-nya. Total nilai (now/lalu)
        SELALU identik dgn input -- fungsi ini murni menyusun ULANG
        urutan/pengelompokan tampilan, TIDAK pernah mengubah/menghapus
        angka akun manapun (akun yg no_akun-nya salah ketik di definisi
        grouping tetap MUNCUL, cuma jatuh ke bagian flat/datar, bukan
        hilang -- konsisten filosofi "akun tidak boleh hilang diam2"
        yang dipakai di seluruh modul ini).
    """
    peringatan: List[str] = []
    peta_akun_by_no: Dict[str, Dict[str, Any]] = {
        item["no_akun"]: item for item in daftar_akun_flat if item.get("no_akun")
    }
    sudah_dipakai: set = set()
    hasil: List[Dict[str, Any]] = []

    for cabang in grouping.get("cabang", []):
        daftar_no_akun = cabang.get("no_akun", [])
        item_cabang: List[Dict[str, Any]] = []
        for no_akun in daftar_no_akun:
            item = peta_akun_by_no.get(no_akun)
            if item is None:
                peringatan.append(
                    f'Grouping piutang usaha: no_akun "{no_akun}" (cabang '
                    f'"{cabang.get("label_id")}") tidak ditemukan di daftar akun '
                    f'piutang usaha aktual periode ini -- kemungkinan salah '
                    f'ketik di definisi grouping, atau akun tidak punya saldo '
                    f'di kedua periode. Dilewati (TIDAK memblokir generate).'
                )
                continue
            item_cabang.append({
                "tipe": "akun", "label_id": item["label_id"], "label_en": item["label_en"],
                "now": item["now"], "lalu": item["lalu"], "indent": True,
                # [FIX -- rantai keterangan COA -> CALK] Sebelumnya field
                # ini DI-DROP saat disusun ulang jadi bentuk subgrup+indent
                # -- akun piutang usaha yang punya catatan per-akun (COA
                # keterangan) diam-diam kehilangan catatannya begitu
                # grouping_piutang_usaha dipakai (opt-in), padahal
                # kalau flat/tidak digrouping catatannya tetap muncul.
                # Sekarang diteruskan apa adanya, konsisten dgn jalur flat.
                "keterangan": item.get("keterangan"),
            })
            sudah_dipakai.add(no_akun)
        if not item_cabang:
            # Semua no_akun cabang ini tidak ketemu -- jangan tampilkan
            # header subgrup kosong tanpa isi, tapi peringatan di atas
            # tetap tercatat.
            continue
        hasil.append({"tipe": "subgrup", "label_id": cabang.get("label_id", ""),
                       "label_en": cabang.get("label_en", cabang.get("label_id", ""))})
        hasil.extend(item_cabang)

    # Akun yang tidak masuk cabang manapun -- tetap tampil, FLAT, di
    # akhir, urutan asli dipertahankan (bukan hilang).
    for item in daftar_akun_flat:
        no_akun = item.get("no_akun")
        if no_akun in sudah_dipakai:
            continue
        hasil.append({
            "tipe": "akun", "label_id": item["label_id"], "label_en": item["label_en"],
            "now": item["now"], "lalu": item["lalu"],
            # [FIX -- rantai keterangan COA -> CALK] Sama seperti item
            # cabang di atas -- jalur flat (akun yang tidak masuk cabang
            # manapun) juga harus mempertahankan keterangan, bukan cuma
            # jalur subgrup.
            "keterangan": item.get("keterangan"),
        })

    return hasil, peringatan