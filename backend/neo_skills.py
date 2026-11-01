"""
neo_skills.py -- memuat panduan halaman Transactions (skill) ke prompt suara Neo, HANYA saat relevan.

Prompt suara sengaja ringkas (token pertama cepat), jadi SKILL.md lengkap tidak dimuat. Yang dimuat
adalah SUARA.md di folder tiap skill (~2-3 KB), dipilih lewat kata kunci ucapan atau teks layar
(bukan hafalan kalimat):
  - cocok ke 1 halaman  -> SUARA.md halaman itu
  - cocok ke 2+ halaman -> peta transactions-overview + 2 halaman terkuat
  - bicara transaksi umum (posting, upload, approve, dst) tanpa halaman jelas -> peta saja
Halaman baru: tambah entri di _HALAMAN.
"""
import os
import re
from typing import Dict, List, Optional, Tuple

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skills")
_PETA = "transactions-overview"
MAKS_HALAMAN = 2

# folder skill -> (kata kunci ucapan, penanda di teks layar)
_HALAMAN: Dict[str, Tuple[re.Pattern, re.Pattern]] = {
    "sales-transaction-flow": (
        re.compile(r"penjualan|sales|seles|invoice|faktur|piutang|pelanggan|customer|buat invoice|receivable"),
        re.compile(r"sales transaction|sales invoice|outstanding ar|buat invoice", re.I),
    ),
    "purchase-transaction-flow": (
        re.compile(r"pembelian|purchase|purchas|\bbill\b|vendor|pemasok|supplier|utang usaha|hutang usaha|buat transaksi|payable"),
        re.compile(r"purchase transaction|purchase preview|create bill|post to gl", re.I),
    ),
    "journal-entry-transaction-flow": (
        re.compile(r"jurnal umum|journal entry|jurnal manual|\bje\b|voucher|create journal|jurnal entri"),
        re.compile(r"je transaction|new journal entry|create journal", re.I),
    ),
    "cash-bank-transaction-flow": (
        re.compile(r"rekening koran|mutasi|\bbank\b|\bkas\b|rekonsiliasi|reconcil|pelunasan|cash receipt|cash payment|auto-match|unmatch|reverse"),
        re.compile(r"cash payment|cash receipt|reconciliation|bank feed|bank mapping", re.I),
    ),
    "other-transaction-flow": (
        re.compile(r"uang muka karyawan|deposit|pinjaman|modal|intercompany|refund|reimburse|other transaction|transaksi lain"),
        re.compile(r"review queue|transaction templates|other transaction|other event", re.I),
    ),
}

# kata umum seputar alur transaksi; tanpa halaman jelas -> peta saja
_UMUM = re.compile(
    r"transaksi|transaction|posting|memposting|diposting|post journal|approve|setujui|exception|pengecualian|"
    r"upload|unggah|source data|sumber data|journal preview|pratinjau jurnal|posted|lima halaman"
)

_cache: Dict[str, Tuple[float, str]] = {}


def _baca(folder: str) -> str:
    path = os.path.join(_DIR, folder, "SUARA.md")
    try:
        mt = os.path.getmtime(path)
        hit = _cache.get(path)
        if hit and hit[0] == mt:
            return hit[1]
        with open(path, encoding="utf-8") as f:
            teks = f.read().replace("\r\n", "\n")
        if teks.startswith("---"):  # buang frontmatter
            teks = teks.split("---", 2)[-1]
        teks = "\n\n" + teks.strip() + "\n"
        _cache[path] = (mt, teks)
        return teks
    except OSError:
        return ""


def pilih_folder(ucapan: str, konteks_layar: Optional[str] = None) -> List[str]:
    """Daftar folder skill yang relevan (urut dari yang disisipkan pertama)."""
    u = (ucapan or "").lower()
    layar = konteks_layar or ""
    skor: List[Tuple[int, str]] = []
    for folder, (pola_ucap, pola_layar) in _HALAMAN.items():
        n = len(pola_ucap.findall(u)) + (3 if pola_layar.search(layar) else 0)
        if n:
            skor.append((n, folder))
    skor.sort(key=lambda x: -x[0])
    if not skor:
        return [_PETA] if _UMUM.search(u) else []
    if len(skor) == 1:
        return [skor[0][1]]
    return [_PETA] + [f for _, f in skor[:MAKS_HALAMAN]]


def blok_untuk(ucapan: str, konteks_layar: Optional[str] = None) -> str:
    """Gabungan panduan yang relevan dengan ucapan/layar; string kosong kalau tidak ada."""
    return "".join(_baca(f) for f in pilih_folder(ucapan, konteks_layar))
