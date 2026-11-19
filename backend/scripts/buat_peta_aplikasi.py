#!/usr/bin/env python3
"""
scripts/buat_peta_aplikasi.py
=============================
Membaca source frontend (Next.js, folder `src/`) lalu menulis "peta aplikasi"
yang dibaca Zake (modules/chat_zafeb.py) supaya Zake tahu isi aplikasi:
jumlah halaman, komponen di tiap halaman, dan semua tombol/tab/link/field.

Peta dibuat DARI KODE, bukan ditulis manual -> selalu cocok dengan aplikasi.
JALANKAN ULANG setiap selesai menambah/mengubah halaman atau tombol:

    python scripts/buat_peta_aplikasi.py                 # src ada di ../src
    python scripts/buat_peta_aplikasi.py --src /path/ke/src

Hasil:
    data/peta_aplikasi.md     -> dimuat ke system prompt Zake
    data/peta_aplikasi.json   -> versi mesin (statistik, dipakai tes)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
EXT = (".tsx", ".ts", ".jsx", ".js")

# Komponen yang muncul di SEMUA halaman -> dicatat sekali di bagian "Global".
GLOBAL_FILES = {
    "components/AppLayout.tsx", "components/Sidebar.tsx", "components/Topbar.tsx",
    "components/GlobalHeader.tsx", "components/ChatWidget.tsx", "components/CompanySwitcher.tsx",
}

# Halaman peninggalan / alat internal: tetap dicatat tapi diberi tanda.
CATATAN_HALAMAN = {
    "/zafeb-ai": "halaman lama; fungsinya sudah digantikan bubble chat Zake di pojok kanan bawah",
    "/transactions/other/legacy-overview": "halaman lama (legacy) untuk Other Transaction",
}


# ----------------------------------------------------------------- util teks
def hapus_komentar(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"(?m)(^|\s)//[^\n]*", r"\1", s)
    return s


def kode_bocor(t: str) -> bool:
    """True kalau teks tampak potongan kode (bukan label untuk manusia)."""
    return bool(re.search(r"\$\{|[{}]|&&|\?\s|=>|\bnull\b|\bundefined\b", t))


def rapikan(t: str) -> str:
    t = re.sub(r"\s+", " ", t).strip()
    t = t.replace("&amp;", "&").replace("&nbsp;", " ").replace("&middot;", "·")
    return t


def kurung_tutup(s: str, i: int, buka: str = "{", tutup: str = "}") -> int:
    """i menunjuk `buka`. Kembalikan indeks `tutup` pasangannya (peka string)."""
    depth, n, quote = 0, len(s), None
    while i < n:
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        else:
            if c in "'\"`":
                quote = c
            elif c == buka:
                depth += 1
            elif c == tutup:
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return n - 1


def baca_tag_buka(s: str, i: int):
    """i menunjuk '<'. Return (indeks setelah '>', string atribut, self_closing)."""
    n, j, quote = len(s), i + 1, None
    while j < n and (s[j].isalnum() or s[j] in "._:-"):
        j += 1
    mulai_attr = j
    while j < n:
        c = s[j]
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c == "{":
            j = kurung_tutup(s, j)
        elif c == ">":
            self_close = s[j - 1] == "/"
            return j + 1, s[mulai_attr:j].rstrip("/"), self_close
        j += 1
    return n, s[mulai_attr:], False


def atribut(attrs: str, nama: str) -> str | None:
    m = re.search(rf"(?<![\w-]){re.escape(nama)}\s*=\s*(\"([^\"]*)\"|'([^']*)'|\{{)", attrs)
    if not m:
        return None
    if m.group(2) is not None:
        return m.group(2)
    if m.group(3) is not None:
        return m.group(3)
    ujung = kurung_tutup(attrs, m.end() - 1)
    return ekspresi_ke_teks(attrs[m.end():ujung])


def ekspresi_ke_teks(expr: str) -> str:
    """Ambil teks manusiawi dari ekspresi JSX: t('..'), string literal, ternary."""
    expr = expr.strip()
    if ".map(" in expr or "<" in expr:
        return ""
    ts = re.findall(r"\bt\(\s*(['\"`])(.*?)\1", expr)
    if ts:
        return " / ".join(x[1] for x in ts)
    lits = re.findall(r"(['\"`])((?:\\.|(?!\1).){1,80})\1", expr)
    bagus = []
    for _, v in lits:
        v = re.sub(r"\$\{[^}]*\}", "…", v).strip()
        if len(v) >= 2 and re.search(r"[A-Za-z]{2}", v) and not re.search(
            r"(^|\s)(bg|text|px|py|flex|border|rounded|hover|w-|h-|gap|items|justify|font|opacity)[-:]", v
        ):
            bagus.append(v)
    return " / ".join(x for x in dict.fromkeys(bagus) if not kode_bocor(x))


def teks_anak(inner: str, ikon_set: set[str]):
    """Teks yang tampak di dalam elemen + nama ikon (lucide)."""
    out, ikon, i, n = [], [], 0, len(inner)
    while i < n:
        c = inner[i]
        if c == "<":
            if inner.startswith("</", i) or inner.startswith("<>", i):
                j = inner.find(">", i)
                i = (j + 1) if j != -1 else n
                continue
            m = re.match(r"<([A-Za-z][\w.]*)", inner[i:])
            if not m:
                out.append(c)
                i += 1
                continue
            nama = m.group(1)
            j, attr_ik, sc = baca_tag_buka(inner, i)
            if nama in ikon_set:
                ikon.append(nama)
            elif nama == "Icon":
                nm = atribut(attr_ik, "name")
                if nm:
                    ikon.append(nm)
            i = j
            out.append(" ")
        elif c == "{":
            j = kurung_tutup(inner, i)
            ex = inner[i + 1:j]
            teks_ex = ekspresi_ke_teks(ex)
            if not teks_ex and re.fullmatch(r"\s*[A-Za-z_][\w.?]*(\[[^\]]*\])?\s*", ex):
                teks_ex = f"⟨{ex.strip()}⟩"   # label diambil dari variabel/daftar data
            out.append(" " + teks_ex + " ")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return rapikan("".join(out)), ikon


# ----------------------------------------------------------------- resolusi import
class Proyek:
    def __init__(self, src: Path):
        self.src = src
        self.cache: dict[Path, str] = {}

    def baca(self, p: Path) -> str:
        if p not in self.cache:
            self.cache[p] = hapus_komentar(p.read_text(encoding="utf-8", errors="ignore"))
        return self.cache[p]

    def resolve(self, dari: Path, spec: str) -> Path | None:
        if spec.startswith("@/"):
            base = self.src / spec[2:]
        elif spec.startswith("."):
            base = (dari.parent / spec).resolve()
        else:
            return None
        cands = [base] + [Path(str(base) + e) for e in EXT] + [base / ("index" + e) for e in EXT]
        for c in cands:
            if c.is_file():
                return c
        return None

    def rel(self, p: Path) -> str:
        return p.relative_to(self.src).as_posix()


RE_IMPORT = re.compile(r"""(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]""")


def pohon_komponen(pr: Proyek, halaman: Path) -> list[Path]:
    """Semua file UI (.tsx) yang dipakai sebuah halaman, urut penemuan."""
    urut, lihat, antre = [], set(), [halaman]
    while antre:
        f = antre.pop(0)
        if f in lihat:
            continue
        lihat.add(f)
        urut.append(f)
        for spec in RE_IMPORT.findall(pr.baca(f)):
            t = pr.resolve(f, spec)
            if not t or t.suffix not in (".tsx", ".jsx"):
                continue
            r = pr.rel(t)
            if r.startswith("lib/") or r in GLOBAL_FILES:
                continue
            antre.append(t)
    return urut


# ----------------------------------------------------------------- ekstraksi elemen
def ekstrak_file(pr: Proyek, f: Path) -> dict:
    s = pr.baca(f)
    ikon_set = set()
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*['\"]lucide-react['\"]", s):
        for x in m.group(1).split(","):
            ikon_set.add(x.strip().split(" as ")[-1].strip())

    hasil = {
        "tombol": [], "link": [], "judul": [], "tab": [], "field": [], "navigasi": [],
    }

    # --- tombol (<button> dan wrapper aksi)
    for m in re.finditer(r"<(button|OtherActionButtons)\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        teks, ikon = "", []
        if not sc and m.group(1) == "button":
            k = s.find("</button>", j)
            if k != -1:
                teks, ikon = teks_anak(s[j:k], ikon_set)
        label = (
            teks
            or atribut(attrs, "title")
            or atribut(attrs, "aria-label")
            or (f"[ikon {nama_ikon(ikon[0])}]" if ikon else "")
        )
        dinamis = False
        if "⟨" in label:
            sisa = re.sub(r"⟨[^⟩]*⟩", "", label).strip(" /·-")
            if not re.search(r"[A-Za-z]{2}", sisa):
                label = "[label dari data: " + ", ".join(re.findall(r"⟨([^⟩]*)⟩", label)) + "]"
                dinamis = True
            else:
                label = re.sub(r"⟨([^⟩]*)⟩", r"<\1>", label)
        if m.group(1) != "button":
            label = f"[grup aksi {m.group(1)}]"
        if not label or kode_bocor(label) or not re.search(r"[A-Za-z]{2}", label):
            label = "[tombol tanpa label]"
        onclick = ""
        mo = re.search(r"onClick\s*=\s*\{", attrs)
        if mo:
            ujung = kurung_tutup(attrs, mo.end() - 1)
            onclick = attrs[mo.end():ujung]
        tujuan = re.findall(r"(?:router\.(?:push|replace)|window\.location\.(?:assign|href\s*=))\(?\s*['\"`]([^'\"`]+)['\"`]", onclick)
        tipe = atribut(attrs, "type") or ""
        hasil["tombol"].append({
            "label": label[:90],
            "tipe": tipe,
            "tujuan": tujuan[0] if tujuan else "",
            "nonaktif": bool(re.search(r"(?<![\w-])disabled\b", attrs)),
            "tooltip": (atribut(attrs, "title") or "")[:90],
            "dinamis": dinamis,
        })

    # --- link
    for m in re.finditer(r"<(Link|a)\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        href = atribut(attrs, "href") or ""
        teks = ""
        if not sc:
            k = s.find("</" + m.group(1) + ">", j)
            if k != -1:
                teks, ikon = teks_anak(s[j:k], ikon_set)
                teks = teks or (f"[ikon {ikon[0]}]" if ikon else "")
        if href and href != "#":
            hasil["link"].append({"label": (teks or atribut(attrs, "title") or atribut(attrs, "aria-label") or "")[:80], "href": href[:90]})

    # --- judul
    for m in re.finditer(r"<h([1-3])\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        k = s.find(f"</h{m.group(1)}>", j)
        if k != -1:
            t, _ = teks_anak(s[j:k], ikon_set)
            if t and not kode_bocor(t) and "⟨" not in t:
                hasil["judul"].append(t[:100])
    for m in re.finditer(r"<(?:PageHeader|PageHeading)\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        t = atribut(attrs, "title")
        if t and not kode_bocor(t):
            hasil["judul"].append(t[:100])

    # --- TAB ASLI: array bernama tabs/TABS/*Tabs, atau items={[...]} milik <TabNav>
    hasil["tab_asli"] = []
    kandidat = [m.end() - 1 for m in re.finditer(
        r"(?:const|let)\s+\w*(?:[Tt]abs?|TABS?)\w*\s*(?::[^=]+)?=\s*\[", s)]
    kandidat += [m.end() - 1 for m in re.finditer(r"<TabNav\b[^>]*?items\s*=\s*\{\s*\[", s, flags=re.S)]
    for pos in kandidat:
        ujung = kurung_tutup(s, pos, "[", "]")
        for mm in re.finditer(r"label\s*:\s*(?:t\()?['\"`]([^'\"`]{2,60})['\"`]", s[pos:ujung]):
            if not kode_bocor(mm.group(1)):
                hasil["tab_asli"].append(mm.group(1))

    # --- label bernama lain {key:'x', label:'Y'} (tab, kolom tabel, opsi filter, KPI)
    for m in re.finditer(r"\{\s*(?:id|key|value)\s*:\s*['\"]([\w:./-]+)['\"]\s*,\s*label\s*:\s*(?:t\()?['\"`]([^'\"`]{2,60})['\"`]", s):
        if not kode_bocor(m.group(2)):
            hasil["tab"].append(m.group(2))
    for m in re.finditer(r"\{\s*label\s*:\s*(?:t\()?['\"`]([^'\"`]{2,60})['\"`]\s*,\s*(?:id|key|value)\s*:", s):
        if not kode_bocor(m.group(1)):
            hasil["tab"].append(m.group(1))

    # --- field input
    for m in re.finditer(r"<(input|select|textarea)\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        tp = atribut(attrs, "type") or m.group(1)
        if tp in ("hidden",):
            continue
        nama = atribut(attrs, "placeholder") or atribut(attrs, "aria-label") or atribut(attrs, "title") or atribut(attrs, "name") or ""
        hasil["field"].append(f"{tp}:{nama}"[:70] if nama else tp)
    for m in re.finditer(r"<label\b", s):
        j, attrs, sc = baca_tag_buka(s, m.start())
        k = s.find("</label>", j)
        if k != -1:
            t, _ = teks_anak(s[j:k], ikon_set)
            if t and len(t) < 60:
                hasil["field"].append("label:" + t)

    for m in re.finditer(r"router\.(?:push|replace)\(\s*['\"`]([^'\"`$]+)['\"`]", s):
        hasil["navigasi"].append(m.group(1))
    return hasil


def nama_ikon(n: str) -> str:
    n = re.sub(r"Icon$", "", n)
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", n)


def uniq(seq):
    return list(OrderedDict.fromkeys(x for x in seq if x))


# ----------------------------------------------------------------- sidebar
def baca_menu(pr: Proyek) -> list[dict]:
    p = pr.src / "components/Sidebar.tsx"
    if not p.exists():
        return []
    s = pr.baca(p)
    mulai = s.find("const navGroups")
    if mulai == -1:
        return []
    blok = s[mulai:]
    out, grup = [], None
    for baris in blok.split("\n"):
        mg = re.match(r"\s{4}label:\s*['\"]([^'\"]+)['\"],\s*$", baris)
        if mg:
            grup = mg.group(1)
            continue
        for m in re.finditer(r"label:\s*['\"]([^'\"]+)['\"].*?href:\s*['\"]([^'\"]+)['\"]", baris):
            anak = "label: " in baris and baris.count("{ id:") == 1 and baris.startswith("          ")
            out.append({"grup": grup, "label": m.group(1), "href": m.group(2), "anak": anak})
    return out


# ----------------------------------------------------------------- rute
def rute_dari_file(pr: Proyek, p: Path) -> str:
    bagian = [x for x in p.parent.relative_to(pr.src / "app").parts if not (x.startswith("(") and x.endswith(")"))]
    bagian = [":" + x[1:-1] if x.startswith("[") and x.endswith("]") else x for x in bagian]
    return "/" + "/".join(bagian)


# ----------------------------------------------------------------- hak akses (role)
# Arti tiap konstanta level yang dipakai di kode frontend (dibaca nilainya dari kode).
ARTI_LEVEL = {
    "LEVEL_INPUT": "membuat/mengedit/menghapus draft dan mengirim (submit) dokumen",
    "LEVEL_POST": "posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted",
    "JE_LEVEL_APPROVE": "approve / reject / reopen / hapus jurnal (Journal Entry)",
    "JE_LEVEL_POST": "posting jurnal ke buku besar (Journal Entry)",
    "LEVEL_BALIK_JURNAL": "membalik jurnal yang sudah diposting (Cash & Bank)",
}


def baca_role_backend() -> list[dict]:
    p = BACKEND / "modules" / "auth" / "core.py"
    if not p.exists():
        return []
    s = p.read_text(encoding="utf-8", errors="ignore")
    out = [{"role": m.group(1), "level": int(m.group(2)), "label": m.group(3)}
           for m in re.finditer(r'"(tahap_\d)"\s*:\s*\{\s*"level"\s*:\s*(\d+)\s*,\s*"label"\s*:\s*"([^"]+)"', s)]
    out.append({"role": "super_admin", "level": 999, "label": "Super Admin (di atas Tahap 5)"})
    return out


def nilai_level(pr: Proyek) -> dict[str, int]:
    nilai: dict[str, int] = {}
    for f in pr.src.rglob("*"):
        if f.suffix in EXT:
            for m in re.finditer(r"\bconst\s+((?:JE_)?LEVEL_[A-Z_]+)\s*=\s*(\d+)", pr.baca(f)):
                nilai.setdefault(m.group(1), int(m.group(2)))
    return nilai


def catatan_level(pr: Proyek, files: list[Path], nilai: dict[str, int]) -> list[str]:
    teks = "\n".join(pr.baca(f) for f in files)
    # file di lib/ (store) ikut dilihat lewat nama konstanta yang dipakai di komponen
    out = []
    for nama, arti in ARTI_LEVEL.items():
        if re.search(rf"\b{nama}\b", teks) and nama in nilai:
            out.append(f"level {nilai[nama]}+ ({nama}): {arti}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(BACKEND.parent / "src"))
    ap.add_argument("--out", default=str(BACKEND / "data"))
    a = ap.parse_args()
    src = Path(a.src).resolve()
    if not (src / "app").is_dir():
        sys.exit(f"Folder src/app tidak ditemukan di {src}. Pakai --src.")
    pr = Proyek(src)

    halaman = sorted((src / "app").rglob("page.tsx"), key=lambda p: rute_dari_file(pr, p))
    menu = baca_menu(pr)
    href_menu = {m["href"]: m for m in menu}
    peran = baca_role_backend()
    nilai = nilai_level(pr)

    data_halaman = []
    total = {"tombol": 0, "tanpa_label": 0, "link": 0, "tab": 0, "field": 0}
    for pg in halaman:
        rute = rute_dari_file(pr, pg)
        files = pohon_komponen(pr, pg)
        agg = {k: [] for k in ("tombol", "link", "judul", "tab", "tab_asli", "field", "navigasi")}
        for f in files:
            e = ekstrak_file(pr, f)
            for k in agg:
                agg[k].extend(e[k])
        tb, lihat, kosong = [], set(), 0
        for t in agg["tombol"]:
            if t["label"] == "[tombol tanpa label]":
                kosong += 1
                continue
            key = (t["label"], t["tujuan"])
            if key in lihat:
                continue
            lihat.add(key)
            tb.append(t)
        lk, lihat = [], set()
        for l in agg["link"]:
            key = (l["label"], l["href"])
            if key in lihat:
                continue
            lihat.add(key)
            lk.append(l)
        item = {
            "rute": rute,
            "menu": href_menu.get(rute, {}).get("label"),
            "grup_menu": href_menu.get(rute, {}).get("grup"),
            "file": pr.rel(pg),
            "jumlah_file_komponen": len(files) - 1,
            "komponen": uniq(Path(pr.rel(f)).stem for f in files[1:]),
            "judul": uniq(agg["judul"])[:12],
            "tab": uniq(agg["tab_asli"]),
            "label_lain": [x for x in uniq(agg["tab"]) if x not in set(agg["tab_asli"])][:40],
            "tombol": tb,
            "tombol_tanpa_label": kosong,
            "link": lk,
            "field": uniq(agg["field"]),
            "navigasi": uniq(agg["navigasi"]),
            "hak_akses": catatan_level(pr, files, nilai),
            "catatan": CATATAN_HALAMAN.get(rute, ""),
        }
        total["tombol"] += len(tb)
        total["tanpa_label"] += kosong
        total["link"] += len(lk)
        total["tab"] += len(item["tab"])
        total["field"] += len(item["field"])
        data_halaman.append(item)

    glob = {"tombol": [], "link": []}
    for rel in sorted(GLOBAL_FILES):
        p = src / rel
        if p.exists():
            e = ekstrak_file(pr, p)
            glob["tombol"].extend(t["label"] + (f" → {t['tujuan']}" if t["tujuan"] else "")
                                  for t in e["tombol"] if t["label"] != "[tombol tanpa label]")
            glob["link"].extend(f"{l['label']} → {l['href']}" for l in e["link"] if l["label"])
    glob = {k: uniq(v) for k, v in glob.items()}

    ringkas = {
        "dibuat": datetime.now().isoformat(timespec="seconds"),
        "jumlah_halaman": len(data_halaman),
        "jumlah_menu": len(menu),
        "jumlah_grup_menu": len({m["grup"] for m in menu}),
        "jumlah_file_tsx": sum(1 for _ in src.rglob("*.tsx")),
        "jumlah_tag_button": sum(len(re.findall(r"<button\b", pr.baca(f))) for f in src.rglob("*.tsx")),
        "total": total,
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "peta_aplikasi.json").write_text(json.dumps({
        "ringkas": ringkas, "menu": menu, "peran": peran, "nilai_level": nilai,
        "arti_level": ARTI_LEVEL, "global": glob, "halaman": data_halaman,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # versi baca-manusia (sama isinya, untuk dicek/di-review)
    # muat file modul langsung (tanpa menjalankan modules/__init__.py yang berat)
    import importlib.util
    spec = importlib.util.spec_from_file_location("peta_aplikasi_rt", BACKEND / "modules" / "peta_aplikasi.py")
    rt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rt)
    (out / "peta_aplikasi.md").write_text(rt.teks_lengkap(json.loads((out / "peta_aplikasi.json").read_text(encoding="utf-8"))), encoding="utf-8")
    print(f"OK: {len(data_halaman)} halaman, {total['tombol']} tombol berlabel "
          f"(+{total['tanpa_label']} tanpa label), {total['link']} link, {len(menu)} menu -> {out}")


if __name__ == "__main__":
    main()
