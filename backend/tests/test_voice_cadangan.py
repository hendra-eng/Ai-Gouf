"""
test_voice_cadangan.py
======================
Tes jalur cadangan asisten suara (voice_claude.pilih_cadangan / jawab_dengan_cadangan) dan pemecah jendela memori.
Tanpa jaringan, tanpa FastAPI: Claude, Groq, dan alat data diganti objek palsu.

Jalankan dari folder backend:  python -m pytest tests/test_voice_cadangan.py
(atau tanpa pytest:            python tests/test_voice_cadangan.py)
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import voice_claude as vc  # noqa: E402


class AkPalsu:
    """Pengganti akuntansi_ai: mencatat argumen tanya_ai_stream."""
    def __init__(self):
        self.panggilan = []

    def tanya_ai_stream(self, pesan, **kw):
        self.panggilan.append((pesan, kw))
        yield "jawaban-cadangan"


class NeoPalsu:
    """Pengganti neo_data_tools: mencatat apakah alat data / daftar client dipakai."""
    def __init__(self, aktif=True):
        self._aktif = aktif
        self.alat_dipakai = 0
        self.daftar_client_diminta = 0

    def aktif(self):
        return self._aktif

    def blok_daftar_klien(self, user, client_id):
        self.daftar_client_diminta += 1
        return "\n[DAFTAR CLIENT] SAU, NBM"

    def jawab_dengan_alat(self, ak, pesan, system_prompt, riwayat, user, **kw):
        self.alat_dipakai += 1
        self.system_prompt_alat = system_prompt
        yield "jawaban-dengan-data"


SISTEM_LENGKAP = "PROMPT-SUARA + [KONTEKS LAYAR] Laba SAU Rp 9 miliar"
SISTEM_BERSIH = vc.prompt_cadangan("PROMPT-SUARA-TANPA-DATA") + "\n[INGATAN] suka kopi"


def _kwargs():
    return {"system_prompt": SISTEM_LENGKAP, "riwayat": [], "provider_utama": "Groq", "max_tokens": 1500}


class TestModeCadangan(unittest.TestCase):
    def _cadangan(self, env, neo=None):
        ak, neo = AkPalsu(), neo or NeoPalsu()
        with mock.patch.dict(os.environ, env, clear=False):
            gen = vc.pilih_cadangan(ak=ak, neo=neo, pesan="berapa laba SAU?", kwargs=_kwargs(),
                                    user={"id": 1}, client_id="c1", system_cadangan=SISTEM_BERSIH)
            return ak, neo, gen

    def test_default_tanpa_data_klien(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-uji", "VOICE_CLAUDE_AKTIF": "1"}):
            os.environ.pop("VOICE_CADANGAN_DATA", None)
            ak, neo = AkPalsu(), NeoPalsu()
            gen = vc.pilih_cadangan(ak=ak, neo=neo, pesan="berapa laba SAU?", kwargs=_kwargs(),
                                    user={"id": 1}, client_id="c1", system_cadangan=SISTEM_BERSIH)
            self.assertEqual(list(gen), ["jawaban-cadangan"])
        self.assertEqual(neo.alat_dipakai, 0, "alat data tidak boleh dipakai di cadangan")
        self.assertEqual(neo.daftar_client_diminta, 0, "daftar client tidak boleh ikut ke cadangan")
        sistem = ak.panggilan[0][1]["system_prompt"]
        self.assertNotIn("Laba SAU", sistem, "snapshot layar tidak boleh ikut ke cadangan")
        self.assertIn("MODE CADANGAN", sistem)
        self.assertIn("suka kopi", sistem, "ingatan AI tetap ikut")
        self.assertEqual(ak.panggilan[0][1]["provider_utama"], "Groq")

    def _mode(self, nilai):
        with mock.patch.dict(os.environ, {"VOICE_CADANGAN_DATA": nilai}):
            return vc.mode_cadangan()

    def test_salah_ketik_jatuh_ke_tanpa(self):
        self.assertEqual(self._mode("TANPA "), "tanpa")
        self.assertEqual(self._mode("kosong-banget"), "tanpa")
        self.assertEqual(self._mode(""), "tanpa")
        self.assertEqual(self._mode("Penuh"), "penuh")

    def test_mode_penuh_perilaku_lama(self):
        ak, neo, gen = self._cadangan({"ANTHROPIC_API_KEY": "sk-uji", "VOICE_CADANGAN_DATA": "penuh"})
        self.assertEqual(list(gen), ["jawaban-dengan-data"])
        self.assertEqual(neo.alat_dipakai, 1)
        self.assertIn("Laba SAU", neo.system_prompt_alat)
        self.assertIn("[DAFTAR CLIENT]", neo.system_prompt_alat)

    def test_mode_penuh_tanpa_alat_pakai_prompt_lengkap(self):
        ak, neo, gen = self._cadangan({"ANTHROPIC_API_KEY": "sk-uji", "VOICE_CADANGAN_DATA": "penuh"}, NeoPalsu(aktif=False))
        list(gen)
        self.assertEqual(ak.panggilan[0][1]["system_prompt"], SISTEM_LENGKAP)

    def test_mode_mati_tidak_ada_cadangan(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-uji", "VOICE_CADANGAN_DATA": "mati"}):
            ak, neo = AkPalsu(), NeoPalsu()
            gen = vc.pilih_cadangan(ak=ak, neo=neo, pesan="x", kwargs=_kwargs(), user={}, client_id=None,
                                    system_cadangan=SISTEM_BERSIH)
            with self.assertRaises(Exception) as c:
                list(gen)
        self.assertIn("cadangan dimatikan", str(c.exception))
        self.assertEqual(ak.panggilan, [])
        self.assertEqual(neo.alat_dipakai, 0)

    def test_claude_tidak_dikonfigurasi_perilaku_lama(self):
        """Tanpa ANTHROPIC_API_KEY, Groq adalah jalur UTAMA: alat data tetap aktif walau mode 'tanpa'/'mati'."""
        for mode in ("tanpa", "mati"):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "", "VOICE_CADANGAN_DATA": mode}):
                ak, neo = AkPalsu(), NeoPalsu()
                gen = vc.pilih_cadangan(ak=ak, neo=neo, pesan="x", kwargs=_kwargs(), user={}, client_id=None,
                                        system_cadangan=SISTEM_BERSIH)
                self.assertEqual(list(gen), ["jawaban-dengan-data"], mode)
                self.assertEqual(neo.alat_dipakai, 1, mode)


class TestAlurLengkap(unittest.TestCase):
    """Claude gagal SEBELUM token -> cadangan sadar-data; gagal SETELAH token -> error, tanpa cadangan."""

    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-uji", "VOICE_CLAUDE_AKTIF": "1"})
        self.env.start()
        os.environ.pop("VOICE_CADANGAN_DATA", None)
        vc._mati_sampai = 0.0
        self.jeda = mock.patch.object(vc, "_jeda_untuk_error", return_value=0)
        self.jeda.start()

    def tearDown(self):
        self.jeda.stop()
        self.env.stop()
        vc._mati_sampai = 0.0

    def _jalankan(self, stream_claude):
        ak, neo = AkPalsu(), NeoPalsu()

        def cad():
            return vc.pilih_cadangan(ak=ak, neo=neo, pesan="q", kwargs=_kwargs(), user={}, client_id="c1",
                                     system_cadangan=SISTEM_BERSIH)

        with mock.patch.object(vc, "_stream_claude", stream_claude):
            gen = vc.jawab_dengan_cadangan(neo, "q", SISTEM_LENGKAP, [], {}, "c1", cadangan=cad, pakai_alat=True)
            hasil, galat = [], None
            try:
                for d in gen:
                    hasil.append(d)
            except Exception as e:  # noqa: BLE001
                galat = e
        return ak, neo, hasil, galat

    def test_claude_gagal_sebelum_token(self):
        def rusak(*a, **k):
            raise RuntimeError("saldo habis")
            yield ""
        ak, neo, hasil, galat = self._jalankan(rusak)
        self.assertIsNone(galat)
        self.assertEqual(hasil, ["jawaban-cadangan"])
        self.assertEqual(neo.alat_dipakai, 0)
        self.assertNotIn("Laba SAU", ak.panggilan[0][1]["system_prompt"])

    def test_claude_gagal_di_tengah_jawaban(self):
        def setengah(*a, **k):
            yield "Laba SAU tahun ini "
            raise RuntimeError("koneksi putus")
        ak, neo, hasil, galat = self._jalankan(setengah)
        self.assertEqual(hasil, ["Laba SAU tahun ini "])
        self.assertIn("Error Claude", str(galat))
        self.assertEqual(ak.panggilan, [], "tidak ada cadangan setelah token keluar")
        self.assertEqual(neo.alat_dipakai, 0)


class TestJendelaMemori(unittest.TestCase):
    def test_ucapan_panjang_tidak_hilang(self):
        try:
            import memori_ai as mem
        except Exception as e:  # noqa: BLE001  (modul bergantung pada database/ORM)
            self.skipTest(f"memori_ai tidak bisa diimpor di lingkungan ini: {e}")
        teks = ("kata " * 4000).strip()
        potongan = mem._jendela_teks(teks)
        self.assertTrue(all(len(p) <= mem.UKURAN_JENDELA_BELAJAR for p in potongan))
        self.assertEqual(" ".join(potongan), teks)


if __name__ == "__main__":
    unittest.main(verbosity=2)