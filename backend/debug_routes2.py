"""
debug_routes2.py -- jalankan dari folder backend:

    python debug_routes2.py

Fokus cuma ke 2 route bertipe _IncludedRouter (tax_router & tax_case_router)
-- bongkar isi atribut `include_context` mereka (termasuk atribut privat
berawalan underscore, yang sengaja disembunyikan di skrip debug
sebelumnya) supaya ketahuan di mana sebenarnya path/prefix/sub-router-nya
disimpan.

Hasil ditulis ke debug_routes2_output.txt -- buka file itu, jangan copy
dari terminal.
"""
import main

baris_output = []

def tulis(s=""):
    baris_output.append(s)

def _dump_objek(obj, indent="", batas_dalam=4):
    """Bongkar SEMUA atribut (termasuk privat), rekursif terbatas, cari
    apa pun yang kelihatan seperti path/prefix/routes/router."""
    if batas_dalam <= 0:
        tulis(f"{indent}<batas kedalaman tercapai>")
        return

    tipe = type(obj).__name__
    tulis(f"{indent}[{tipe}]")

    # __dict__ instance kalau ada -- ini biasanya paling informatif untuk
    # objek custom (bukan builtin).
    if hasattr(obj, "__dict__"):
        for k, v in vars(obj).items():
            v_tipe = type(v).__name__
            if isinstance(v, (str, int, float, bool, type(None))):
                tulis(f"{indent}  .{k} ({v_tipe}) = {v!r}")
            elif isinstance(v, (list, tuple, set)):
                tulis(f"{indent}  .{k} ({v_tipe}, {len(v)} item)")
                for item in list(v)[:5]:
                    _dump_objek(item, indent + "      ", batas_dalam - 1)
            elif isinstance(v, dict):
                tulis(f"{indent}  .{k} (dict, {len(v)} item) keys={list(v.keys())[:10]}")
            else:
                tulis(f"{indent}  .{k} ({v_tipe})")
                # Turun satu level lagi untuk objek custom (bukan builtin
                # umum semacam function/module/type), tapi hindari turun
                # ke objek yang jelas besar/tidak relevan (app FastAPI,
                # dependant, dsb).
                if v_tipe not in (
                    "function", "method", "module", "type", "NoneType",
                    "FastAPI", "Dependant",
                ):
                    _dump_objek(v, indent + "      ", batas_dalam - 1)
    else:
        tulis(f"{indent}  (tidak punya __dict__, kemungkinan builtin/slot)")
        for attr in dir(obj):
            if attr.startswith("__"):
                continue
            try:
                val = getattr(obj, attr)
            except Exception:
                continue
            if callable(val):
                continue
            tulis(f"{indent}  .{attr} = {val!r}"[:200])


for i, r in enumerate(main.app.routes):
    if type(r).__name__ == "_IncludedRouter":
        tulis(f"=== route index {i}: _IncludedRouter ===")
        _dump_objek(r)
        tulis()

with open("debug_routes2_output.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(baris_output))

print("Selesai -- buka file debug_routes2_output.txt di folder ini.")