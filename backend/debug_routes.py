"""
debug_routes.py -- jalankan dari folder backend:

    python debug_routes.py

Hasilnya ditulis ke debug_routes_output.txt (di folder yang sama) --
BUKA FILE ITU dan kirim isinya, jangan copy dari terminal (supaya tidak
kepotong). File ini jauh lebih ringkas dari versi sebelumnya: cuma
menampilkan nama atribut (bukan nilai penuh semuanya) + nilai dari
kandidat atribut yang paling mungkin relevan (path/prefix/routes/dst).
"""
import main

KANDIDAT_ATRIBUT = [
    "path", "prefix", "routes", "router", "app", "endpoint",
    "path_regex", "path_format", "name", "methods",
]

baris_output = []

def tulis(s=""):
    baris_output.append(s)

def _describe(route, depth=0, batas_sub=3):
    indent = "  " * depth
    tipe = type(route).__name__
    tulis(f"{indent}type={tipe}")

    # Cuma nama atribut publik non-callable -- biar ringkas, tidak print
    # nilainya semua.
    nama_atribut = [
        a for a in dir(route)
        if not a.startswith("_") and not callable(getattr(route, a, None))
    ]
    tulis(f"{indent}atribut tersedia: {nama_atribut}")

    # Nilai untuk kandidat atribut yang relevan saja.
    for attr in KANDIDAT_ATRIBUT:
        if hasattr(route, attr) and attr != "routes":
            try:
                val = getattr(route, attr)
                val_str = repr(val)
                if len(val_str) > 150:
                    val_str = val_str[:150] + "...(dipotong)"
                tulis(f"{indent}  {attr} = {val_str}")
            except Exception as e:
                tulis(f"{indent}  {attr} = <error: {e}>")

    sub = getattr(route, "routes", None)
    if sub:
        tulis(f"{indent}  routes: {len(sub)} item")
        if depth < batas_sub:
            for s in sub[:3]:
                _describe(s, depth + 1, batas_sub)
            if len(sub) > 3:
                tulis(f"{indent}  ... ({len(sub) - 3} item lain tidak ditampilkan)")


tulis(f"Total route di app.routes: {len(main.app.routes)}")
tulis()
for i, r in enumerate(main.app.routes):
    tulis(f"[{i}] {'-'*50}")
    _describe(r)
    tulis()

with open("debug_routes_output.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(baris_output))

print("Selesai -- buka file debug_routes_output.txt di folder ini.")