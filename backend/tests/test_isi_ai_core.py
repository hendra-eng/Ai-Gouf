"""
tests/test_isi_ai_core.py
=========================
Inti "Isi AI" untuk tombol Download Excel di halaman Reports (modules/financial_statements/isi_ai_core.py).
Murni logika -- tanpa jaringan, tanpa database: pemanggil model disuntikkan (palsu) dan folder cache memakai tmp_path.
"""

import json
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.financial_statements import isi_ai_core as core


def _konfig(**ubah):
    dasar = dict(
        aktif=True, model_ringan="model-ringan", model_analisis="model-analisis",
        batas_token_unduhan=100_000, batas_token_hari=1_000_000, batas_token_bulan=10_000_000,
        maks_gagal_beruntun=3, jeda_pemutus_detik=300,
    )
    dasar.update(ubah)
    return core.Konfigurasi(**dasar)


class PemanggilPalsu:
    """Menjawab dari fungsi `isi(n_item) -> list[str]`; mencatat jumlah panggilan."""

    def __init__(self, isi=None, token=(100, 20), error=None, teks_mentah=None):
        self.isi, self.token, self.error, self.teks_mentah = isi, token, error, teks_mentah
        self.panggilan = 0
        self.model_terakhir = None

    def __call__(self, model, sistem, prompt_user, max_tokens):
        self.panggilan += 1
        self.model_terakhir = model
        if self.error:
            raise self.error
        if self.teks_mentah is not None:
            return self.teks_mentah, *self.token
        n = prompt_user.count("\n")  # baris item = jumlah "\n" (satu baris judul)
        nilai = self.isi(n) if self.isi else [""] * n
        teks = json.dumps({"hasil": [{"i": i + 1, "v": v} for i, v in enumerate(nilai)]})
        return teks, *self.token


@pytest.fixture
def lingkungan(tmp_path):
    return dict(
        cache=core.CacheHasil(tmp_path),
        anggaran=core.AnggaranToken(tmp_path),
        pemutus=core.PemutusSirkuit(),
    )


def _jalankan(tugas, items, pemanggil, konfig=None, id_unduhan="dl-1", klien="klien-1", env=None):
    env = env
    return core.proses_permintaan(
        klien, tugas, items, id_unduhan,
        pemanggil=pemanggil, konfig=konfig or _konfig(), **env,
    )


# ── Utilitas teks ────────────────────────────────────────────────────────────

def test_tanda_tangan_menyeragamkan_nomor_referensi():
    a = core.tanda_tangan_teks("Transfer dari PT Maju Jaya INV 20260101")
    b = core.tanda_tangan_teks("transfer  dari PT MAJU JAYA inv 20260215")
    assert a == b


def test_nama_harus_tertulis_di_teks():
    assert core.nama_ada_di_teks("PT Maju Jaya", "Terima dari PT Maju Jaya, INV 001")
    assert not core.nama_ada_di_teks("PT Karangan", "Terima dari PT Maju Jaya")
    assert not core.nama_ada_di_teks("PT", "PT Maju Jaya")  # terlalu pendek


def test_topeng_menyamarkan_email_dan_angka_panjang():
    t = core.topeng_teks("Kirim ke budi@mail.com rek 1234567890123")
    assert "budi@mail.com" not in t
    assert "1234567890123" not in t


# ── Validasi hasil model ─────────────────────────────────────────────────────

def test_tugas_kategori_sudah_dihapus():
    # Category COA harus dari COA resmi klien (dipakai Neraca & Arus Kas), tidak boleh ditebak AI.
    assert "kategori" not in core.TUGAS_VALID
    assert "kategori" not in core.UKURAN_BATCH
    assert set(core.TUGAS_VALID) == {"party", "catatan", "catatan_pnl"}


def test_validasi_party_menolak_nama_halusinasi():
    item = {"teks": "Bayar listrik PLN Agustus"}
    assert core.validasi_nilai("party", item, "PLN") == "PLN"
    assert core.validasi_nilai("party", item, "PT Fiktif Abadi") == ""


def test_validasi_catatan_selalu_berawalan_dugaan_ai_dan_dipotong():
    v = core.validasi_nilai("catatan", {}, "Saldo kredit tidak wajar " * 30)
    assert v.startswith("Dugaan AI: ")
    assert len(v) <= core.MAKS_PANJANG_CATATAN


def test_urai_json_menerima_pagar_kode_dan_menolak_sampah():
    assert core.urai_json_hasil('```json\n{"hasil":[{"i":1,"v":"A"}]}\n```') == {1: "A"}
    assert core.urai_json_hasil("bukan json") is None
    assert core.urai_json_hasil('{"hasil":"salah"}') is None


# ── Alur utama ───────────────────────────────────────────────────────────────

def test_party_dedupe_dan_cache(lingkungan):
    items = [{"id": f"s{i}", "teks": "Terima dari PT Maju Jaya"} for i in range(5)]
    pemanggil = PemanggilPalsu(isi=lambda n: ["PT Maju Jaya"] * n)
    hasil = _jalankan("party", items, pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 1                      # lima item sama = satu panggilan
    assert {v for v in hasil["hasil"].values()} == {"PT Maju Jaya"}
    assert len(hasil["hasil"]) == 5

    pemanggil2 = PemanggilPalsu(isi=lambda n: ["PT Maju Jaya"] * n)
    hasil2 = _jalankan("party", items, pemanggil2, env=lingkungan)
    assert pemanggil2.panggilan == 0                     # klik berikutnya: dari cache
    assert hasil2["ringkasan"]["dari_cache"] == 5
    assert len(hasil2["hasil"]) == 5


def test_party_nama_halusinasi_ditolak(lingkungan):
    items = [{"id": "a", "teks": "Terima dari PT Maju Jaya"}]
    pemanggil = PemanggilPalsu(isi=lambda n: ["PT Fiktif Abadi"] * n)
    hasil = _jalankan("party", items, pemanggil, env=lingkungan)
    assert hasil["hasil"] == {}
    assert hasil["ringkasan"]["ditolak"] == 1


def test_model_sesuai_tugas(lingkungan):
    p1 = PemanggilPalsu(isi=lambda n: ["PT Maju Jaya"] * n)
    _jalankan("party", [{"id": "a", "teks": "Terima dari PT Maju Jaya"}], p1, env=lingkungan)
    assert p1.model_terakhir == "model-ringan"
    p2 = PemanggilPalsu(isi=lambda n: ["Saldo kredit, cek jurnal"] * n)
    item = {"id": "1100", "kode": "1100", "nama": "Kas", "saldo_akhir": -500}
    _jalankan("catatan", [item], p2, env=lingkungan)
    assert p2.model_terakhir == "model-analisis"


def test_tugas_kategori_ditolak_dan_tidak_memanggil_ai(lingkungan):
    pemanggil = PemanggilPalsu(isi=lambda n: ["Fixed Asset"] * n)
    kat = {"id": "1500", "kode": "1500", "nama": "Mesin", "klasifikasi": "ASSET",
           "pilihan": ["Fixed Asset", "Current Asset"], "contoh": []}
    with pytest.raises(ValueError):
        _jalankan("kategori", [kat], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 0


def test_catatan_lolos(lingkungan):
    cat = {"id": "1100", "kode": "1100", "nama": "Kas", "saldo_akhir": -500, "alasan": ["saldo berlawanan"]}
    h2 = _jalankan("catatan", [cat], PemanggilPalsu(isi=lambda n: ["mutasi kredit besar, cek jurnal"] * n), env=lingkungan)
    assert h2["hasil"]["1100"].startswith("Dugaan AI: ")


def test_batas_token_unduhan_menghentikan_dan_melaporkan(lingkungan):
    items = [{"id": f"s{i}", "teks": f"Terima dari Pelanggan Nomor{i} abc"} for i in range(200)]
    pemanggil = PemanggilPalsu(isi=lambda n: [""] * n, token=(3000, 1000))
    konfig = _konfig(batas_token_unduhan=6_000)
    h = _jalankan("party", items, pemanggil, konfig=konfig, env=lingkungan)
    assert h["ringkasan"]["alasan_dilewati"] == "batas_unduhan"
    assert h["ringkasan"]["dilewati"] > 0                # tidak diam-diam: jumlah yang dilewati dilaporkan
    assert pemanggil.panggilan < 5


def test_sakelar_darurat_mematikan_ai(lingkungan):
    pemanggil = PemanggilPalsu()
    h = _jalankan("party", [{"id": "a", "teks": "Terima dari PT Maju Jaya"}], pemanggil, konfig=_konfig(aktif=False), env=lingkungan)
    assert pemanggil.panggilan == 0
    assert h["ringkasan"]["alasan_dilewati"] == "dinonaktifkan"


def test_pemutus_terbuka_setelah_gagal_beruntun(lingkungan):
    pemanggil = PemanggilPalsu(error=RuntimeError("API down"))
    konfig = _konfig(maks_gagal_beruntun=2)
    for i in range(2):
        _jalankan("party", [{"id": "a", "teks": f"Terima dari PT Satu{i}"}], pemanggil, konfig=konfig, env=lingkungan)
    sebelum = pemanggil.panggilan
    h = _jalankan("party", [{"id": "a", "teks": "Terima dari PT Tiga"}], pemanggil, konfig=konfig, env=lingkungan)
    assert pemanggil.panggilan == sebelum                # pemutus terbuka: model tidak dipanggil lagi
    assert h["ringkasan"]["alasan_dilewati"] == "pemutus"


def test_json_rusak_diulang_satu_kali_lalu_gagal_model(lingkungan):
    pemanggil = PemanggilPalsu(teks_mentah="maaf, tidak bisa")
    h = _jalankan("party", [{"id": "a", "teks": "Terima dari PT Maju Jaya"}], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 2                      # maksimal 1x ulang
    assert h["ringkasan"]["alasan_dilewati"] == "gagal_model"
    assert h["hasil"] == {}


def test_batas_item_per_permintaan(lingkungan):
    items = [{"id": str(i), "teks": f"Terima dari Pelanggan Nomor{i} abc"} for i in range(core.MAKS_ITEM_PERMINTAAN + 15)]
    h = _jalankan("party", items, PemanggilPalsu(isi=lambda n: [""] * n), env=lingkungan)
    assert h["ringkasan"]["alasan_dilewati"] == "terlalu_banyak"
    assert h["ringkasan"]["dilewati"] >= 15


def test_item_tidak_valid_dihitung_bukan_dikirim(lingkungan):
    pemanggil = PemanggilPalsu()
    h = _jalankan("party", [{"id": "", "teks": "x"}, {"id": "b", "teks": "ab"}], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 0
    assert h["ringkasan"]["tidak_valid"] == 2


def test_tugas_tidak_dikenal_ditolak(lingkungan):
    with pytest.raises(ValueError):
        _jalankan("adjustment", [], PemanggilPalsu(), env=lingkungan)


def test_anggaran_hari_dan_bulan_tercatat_dan_tahan_restart(tmp_path):
    a1 = core.AnggaranToken(tmp_path)
    a1.catat(500, "dl-1")
    a2 = core.AnggaranToken(tmp_path)                    # objek baru = simulasi restart server
    p = a2.pemakaian("dl-1")
    assert p["token_hari"] == 500 and p["token_bulan"] == 500
    assert p["token_unduhan"] == 0                       # hitungan per unduhan hanya di memori


# ── catatan_pnl (baris SELISIH di PNL CF) ────────────────────────────────────

def _item_pnl(**ubah):
    dasar = {"id": "profit", "jenis": "profit", "nama": "Selisih laba/rugi PNL CF terhadap TB",
             "konteks": {"akun_belum_posted": 3, "baris_belum_posted": 12, "akun_tidak_di_coa": 1}}
    dasar.update(ubah)
    return dasar


def test_catatan_pnl_lolos_dan_selalu_dugaan_ai(lingkungan):
    pemanggil = PemanggilPalsu(isi=lambda n: ["ada 12 baris belum posted, cek jurnal draft"] * n)
    h = _jalankan("catatan_pnl", [_item_pnl()], pemanggil, env=lingkungan)
    assert pemanggil.model_terakhir == "model-analisis"
    assert h["hasil"]["profit"].startswith("Dugaan AI: ")


def test_catatan_pnl_jenis_tidak_dikenal_ditolak(lingkungan):
    pemanggil = PemanggilPalsu()
    h = _jalankan("catatan_pnl", [_item_pnl(jenis="lainnya")], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 0
    assert h["ringkasan"]["tidak_valid"] == 1


def test_catatan_pnl_cache_berubah_kalau_konteks_berubah(lingkungan):
    pemanggil = PemanggilPalsu(isi=lambda n: ["cek jurnal"] * n)
    _jalankan("catatan_pnl", [_item_pnl()], pemanggil, env=lingkungan)
    _jalankan("catatan_pnl", [_item_pnl()], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 1                      # konteks sama: dari cache
    baru = _item_pnl(konteks={"akun_belum_posted": 9, "baris_belum_posted": 40, "akun_tidak_di_coa": 1})
    _jalankan("catatan_pnl", [baru], pemanggil, env=lingkungan)
    assert pemanggil.panggilan == 2                      # konteks berubah: tanya lagi


def test_catatan_pnl_tidak_mengirim_teks_bebas_ke_model(lingkungan):
    item = _item_pnl(konteks={"akun_belum_posted": 2, "rahasia": "PT Rahasia Abadi"})
    b = core.bersihkan_item("catatan_pnl", item)
    assert "rahasia" not in b["konteks"]                 # hanya angka yang lolos
