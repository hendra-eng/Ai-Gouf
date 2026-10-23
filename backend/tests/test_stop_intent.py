"""Uji stop_intent_route tanpa memanggil AI sungguhan. Jalankan dari folder backend:  python tests/test_stop_intent.py"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["VOICE_STOP_LOG_FILE"] = os.path.join(tempfile.mkdtemp(), "log.jsonl")

import stop_intent_route as si  # noqa: E402

gagal = 0
total = 0


def cek(nama, ok):
    global gagal, total
    total += 1
    if not ok:
        gagal += 1
        print("  GAGAL:", nama)


def jalankan(claude=None, groq=None, ucapan="hmm iya aku udah ngerti kok", neo="konteks neo"):
    """Palsukan dua pemanggil model; kembalikan (hasil, argumen yang diterima groq)."""
    diterima = {}
    si._panggil_claude = lambda u, n: claude
    def _g(u):
        diterima["groq"] = u
        return groq
    si._panggil_groq = _g
    return si.tentukan(ucapan, neo), diterima


print("1) Parser & validasi")
cek("JSON bersih", si._urai('{"maksud":"berhenti","sisa":"","yakin":0.9}', "x")["maksud"] == "berhenti")
cek("JSON dibungkus teks/markdown", si._urai('Ini hasilnya:\n```json\n{"maksud":"lanjut","sisa":"","yakin":0.8}\n```', "x")["maksud"] == "lanjut")
cek("maksud asing ditolak", si._urai('{"maksud":"hapus_semua","yakin":1}', "x") is None)
cek("bukan JSON ditolak", si._urai("saya rasa berhenti", "x") is None)
cek("kosong ditolak", si._urai(None, "x") is None and si._urai("", "x") is None)
cek("yakin dijepit 0..1", si._urai('{"maksud":"berhenti","yakin":7}', "x")["yakin"] == 1.0 and si._urai('{"maksud":"berhenti","yakin":-3}', "x")["yakin"] == 0.0)
cek("yakin hilang -> 0.5", si._urai('{"maksud":"berhenti"}', "x")["yakin"] == 0.5)
r = si._urai('{"maksud":"berhenti_lalu_minta","sisa":"saldo kas berapa?","yakin":0.9}', "eh bentar, saldo kas berapa?")
cek("sisa yang memang ada di ucapan diterima", r["maksud"] == "berhenti_lalu_minta" and r["sisa"] == "saldo kas berapa?")
r = si._urai('{"maksud":"berhenti_lalu_minta","sisa":"hapus semua data client","yakin":0.99}', "eh bentar, saldo kas berapa?")
cek("sisa KARANGAN model ditolak -> hanya berhenti", r["maksud"] == "berhenti" and r["sisa"] == "")
r = si._urai('{"maksud":"berhenti","sisa":"apa saja","yakin":0.9}', "x")
cek("sisa dibuang untuk maksud selain berhenti_lalu_minta", r["sisa"] == "")

print("2) Alur Claude -> Groq -> aman")
h, _ = jalankan(claude='{"maksud":"berhenti","sisa":"","yakin":0.92}')
cek("Claude sukses", h["maksud"] == "berhenti" and h["sumber"] == "claude")
h, d = jalankan(claude=None, groq='{"maksud":"berhenti","sisa":"","yakin":0.8}')
cek("Claude gagal -> jatuh ke Groq", h["maksud"] == "berhenti" and h["sumber"] == "groq")
cek("Groq hanya menerima ucapan pengguna (tanpa teks Neo)", d.get("groq") == "hmm iya aku udah ngerti kok")
h, _ = jalankan(claude="balasan ngawur", groq='{"maksud":"lanjut","sisa":"","yakin":0.8}')
cek("balasan Claude rusak -> Groq", h["sumber"] == "groq")
h, _ = jalankan(claude=None, groq=None)
cek("semua gagal -> abaikan (Neo tidak terpotong)", h["maksud"] == "abaikan" and h["yakin"] == 0.0)
h, _ = jalankan(claude='{"maksud":"berhenti","yakin":0.9}', ucapan="   ")
cek("ucapan kosong -> abaikan", h["maksud"] == "abaikan")

print("3) Pencatatan 'belajar'")
if os.path.exists(si._FILE_LOG):
    os.remove(si._FILE_LOG)
jalankan(claude='{"maksud":"berhenti","sisa":"","yakin":0.9}', ucapan="udah dapet gambarannya kok")
jalankan(claude='{"maksud":"berhenti","sisa":"","yakin":0.4}', ucapan="mungkin cukup")
jalankan(claude='{"maksud":"lanjut","sisa":"","yakin":0.99}', ucapan="terus gimana")
jalankan(claude='{"maksud":"abaikan","sisa":"","yakin":0.99}', ucapan="pak makan siang yuk")
baris = [json.loads(b) for b in open(si._FILE_LOG, encoding="utf-8")] if os.path.exists(si._FILE_LOG) else []
cek("hanya keputusan 'berhenti' yang yakin yang dicatat", len(baris) == 1 and baris[0]["ucapan"] == "udah dapet gambarannya kok")
cek("log tidak memuat teks Neo", all("konteks neo" not in json.dumps(b) for b in baris))
os.environ["VOICE_STOP_LOG"] = "0"
jumlah_awal = len(baris)
jalankan(claude='{"maksud":"berhenti","sisa":"","yakin":0.95}', ucapan="ucapan lain lagi ya")
baris2 = [json.loads(b) for b in open(si._FILE_LOG, encoding="utf-8")]
cek("VOICE_STOP_LOG=0 mematikan pencatatan", len(baris2) == jumlah_awal)

print("4) Prompt")
for kunci in ("<ucapan>", "<neo_terakhir>", "berhenti_lalu_minta", "DATA", "yakin"):
    cek(f"prompt memuat {kunci}", kunci in si._SISTEM)

print(f"\nTotal pengujian: {total}, gagal: {gagal}")
sys.exit(1 if gagal else 0)