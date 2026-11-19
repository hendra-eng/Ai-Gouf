"""Tes riwayat percakapan Zake (modules/percakapan_zafeb.py + penyimpanan otomatis di chat_zafeb).

Jalan tanpa Supabase: `db_client` & `modules.auth` di-stub, database = SQLite di memori.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")  # harus sebelum db_client di-import

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db_client as dbc
from modules import chat_zafeb as cz
from modules import percakapan_zafeb as pz

USER = {"id": "user-A", "username": "a", "role": "tahap_3", "nama": "A"}


@pytest.fixture()
def app_klien(monkeypatch):
    # Hanya 2 tabel riwayat yang dibuat (tabel lain di db_client khusus PostgreSQL).
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    pz.ZakePercakapan.__table__.create(engine)
    pz.ZakePesan.__table__.create(engine)
    monkeypatch.setattr(dbc, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(dbc, "ambil_client", lambda cid: {"nama": "PT Contoh"})

    holder = {"user": dict(USER)}
    app = FastAPI()
    app.include_router(pz.router)
    app.include_router(cz.router)
    app.dependency_overrides[pz.auth.get_current_user] = lambda: holder["user"]

    # Claude dimatikan -> jawaban palsu
    monkeypatch.setattr(cz, "_jawab_claude_stream", lambda *a, **k: iter(["Halo ", "dunia"]))
    monkeypatch.setattr(cz, "_jawab_claude", lambda *a, **k: "Halo dunia")
    return TestClient(app), holder, pz


def _chat(klien, pid, pesan="Ringkasan keuangan periode ini", tanpa_stream=False, client_id="c1"):
    return klien.post("/api/chat/stream", json={
        "pesan": pesan, "riwayat": [], "client_id": client_id,
        "percakapan_id": pid, "tanpa_stream": tanpa_stream,
    })


def test_obrolan_tersimpan_dan_muncul_di_daftar(app_klien):
    klien, _, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    res = _chat(klien, pid)
    assert "[DONE]" in res.text

    daftar = klien.get("/api/percakapan", params={"client_id": "c1", "jalur": "client"}).json()["percakapan"]
    assert len(daftar) == 1
    assert daftar[0]["id"] == pid
    assert daftar[0]["judul"] == "Ringkasan keuangan periode ini"  # judul otomatis dari pesan pertama
    assert daftar[0]["pesan_terakhir"] == "Halo dunia"
    assert daftar[0]["diperbarui_pada"]

    isi = klien.get(f"/api/percakapan/{pid}/pesan").json()["pesan"]
    assert [(m["role"], m["content"]) for m in isi] == [
        ("user", "Ringkasan keuangan periode ini"), ("assistant", "Halo dunia"),
    ]


def test_obrolan_berlanjut_di_percakapan_yang_sama(app_klien):
    klien, _, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    _chat(klien, pid, "pertanyaan 1")
    _chat(klien, pid, "pertanyaan 2", tanpa_stream=True)
    isi = klien.get(f"/api/percakapan/{pid}/pesan").json()["pesan"]
    assert [m["content"] for m in isi] == ["pertanyaan 1", "Halo dunia", "pertanyaan 2", "Halo dunia"]
    assert len(klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"]) == 1


def test_obrolan_kosong_tidak_tampil_di_riwayat(app_klien):
    klien, _, _ = app_klien
    klien.post("/api/percakapan", json={"client_id": "c1"})
    assert klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"] == []


def test_daftar_dipisah_per_client(app_klien):
    klien, _, _ = app_klien
    p1 = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    p2 = klien.post("/api/percakapan", json={"client_id": "c2"}).json()["id"]
    _chat(klien, p1, client_id="c1")
    _chat(klien, p2, client_id="c2")
    assert [x["id"] for x in klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"]] == [p1]
    assert [x["id"] for x in klien.get("/api/percakapan", params={"client_id": "c2"}).json()["percakapan"]] == [p2]


def test_tidak_bisa_akses_obrolan_milik_user_lain(app_klien):
    klien, holder, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    _chat(klien, pid)
    holder["user"] = {"id": "user-B", "username": "b", "role": "tahap_3", "nama": "B"}
    assert klien.get(f"/api/percakapan/{pid}/pesan").status_code == 404
    assert klien.delete(f"/api/percakapan/{pid}").status_code == 404
    assert klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"] == []
    _chat(klien, pid, "nyelonong")  # chat tetap jalan, tapi tidak boleh menulis ke obrolan orang lain
    holder["user"] = dict(USER)
    assert len(klien.get(f"/api/percakapan/{pid}/pesan").json()["pesan"]) == 2


def test_hapus_percakapan(app_klien):
    klien, _, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    _chat(klien, pid)
    assert klien.delete(f"/api/percakapan/{pid}").json() == {"dihapus": True}
    assert klien.get(f"/api/percakapan/{pid}/pesan").status_code == 404
    assert klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"] == []


def test_tambah_pesan_manual_untuk_jalur_gambar(app_klien):
    klien, _, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    r = klien.post(f"/api/percakapan/{pid}/pesan", json={"pesan": [
        {"role": "user", "content": "Apa ini?\n[mengirim gambar]"},
        {"role": "assistant", "content": "Ini faktur."},
    ]})
    assert r.json() == {"tersimpan": 2}
    daftar = klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"]
    assert daftar[0]["judul"].startswith("Apa ini?")


def test_chat_tetap_jalan_tanpa_percakapan_id_atau_id_rusak(app_klien):
    klien, _, _ = app_klien
    assert "Halo" in _chat(klien, None).text
    assert "Halo" in _chat(klien, "bukan-uuid").text
    assert klien.get("/api/percakapan/bukan-uuid/pesan").status_code == 404


def test_gagal_simpan_tidak_menggagalkan_chat(app_klien, monkeypatch):
    klien, _, pz = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]

    class SesiRusak:
        def __call__(self):
            raise RuntimeError("db mati")
    monkeypatch.setattr(dbc, "SessionLocal", SesiRusak())
    res = _chat(klien, pid)
    assert "Halo" in res.text and "[DONE]" in res.text


def test_judul_panjang_dipotong(app_klien):
    klien, _, _ = app_klien
    pid = klien.post("/api/percakapan", json={"client_id": "c1"}).json()["id"]
    _chat(klien, pid, "x" * 300)
    judul = klien.get("/api/percakapan", params={"client_id": "c1"}).json()["percakapan"][0]["judul"]
    assert len(judul) <= 60 and judul.endswith("…")
