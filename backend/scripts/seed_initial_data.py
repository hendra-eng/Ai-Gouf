"""
scripts/seed_initial_data.py
Script one-time untuk load data awal (peraturan & putusan contoh) ke database.

Cara pakai:
    1. Isi scripts/seed_data/regulations.json dan scripts/seed_data/cases.json
       (lihat contoh format di file .example yang disediakan).
    2. Jalankan: python scripts/seed_initial_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from modules.tax_case_ingestion import ingest_case  # noqa: E402
from modules.tax_ingestion import ingest_document  # noqa: E402
from modules.schemas import DocType  # noqa: E402

SEED_DIR = Path(__file__).resolve().parent / "seed_data"


def _load_json_array(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"{path} harus berisi array JSON, ditemukan: {type(data).__name__}")
    return data


def seed_regulations(regulations_file: Path) -> int:
    count = 0
    for item in _load_json_array(regulations_file):
        payload = dict(item)
        # doc_type di JSON berupa string (mis. "UU"), ingest_document butuh enum DocType.
        if "doc_type" in payload and not isinstance(payload["doc_type"], DocType):
            payload["doc_type"] = DocType(payload["doc_type"])
        ingest_document(**payload)
        count += 1
    return count


def seed_cases(cases_file: Path) -> int:
    count = 0
    for item in _load_json_array(cases_file):
        ingest_case(**item)
        count += 1
    return count


def main() -> None:
    SEED_DIR.mkdir(exist_ok=True)

    regulations_file = SEED_DIR / "regulations.json"
    cases_file = SEED_DIR / "cases.json"

    if regulations_file.exists():
        n = seed_regulations(regulations_file)
        print(f"Berhasil memuat {n} peraturan.")
    else:
        print(
            f"Tidak ditemukan {regulations_file} - lewati seeding peraturan.\n"
            f"Buat file ini berisi array objek dengan field sesuai parameter "
            f"ingest_document() (title, doc_type, full_text, nomor, tahun, url_sumber)."
        )

    if cases_file.exists():
        n = seed_cases(cases_file)
        print(f"Berhasil memuat {n} putusan.")
    else:
        print(
            f"Tidak ditemukan {cases_file} - lewati seeding putusan.\n"
            f"Buat file ini berisi array objek dengan field sesuai parameter "
            f"ingest_case() (nomor_putusan, pengadilan, full_text, ringkasan, "
            f"jenis_sengketa, amar_putusan)."
        )


if __name__ == "__main__":
    main()