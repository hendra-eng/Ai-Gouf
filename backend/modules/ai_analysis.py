"""
modules/ai_analysis.py
=======================
Analisis lanjutan pakai AI (DeepSeek) di atas data yang sudah tersimpan
di tabel 'hasil'. Ini beda dari proses ekstraksi/kategorisasi dokumen
di akuntansi_ai.py -- modul ini mengambil hasil yang SUDAH diringkas per
client, lalu minta DeepSeek generate insight/ringkasan tambahan (mis.
deteksi anomali, ringkasan kesehatan keuangan dalam bahasa natural).

Output-nya disimpan ke tabel 'hasil_analisis' lewat db_client.py, supaya
riwayat analisis AI tidak hilang dan bisa dilihat lagi kapan pun tanpa
panggil ulang API (hemat biaya + kuota DeepSeek).

Butuh DEEPSEEK_API_KEY di .env (sudah ada, dipakai juga oleh modul lain).
DeepSeek API kompatibel format dengan OpenAI Chat Completions.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import requests

from .logging_config import get_module_logger

logger = get_module_logger("ai_analysis")

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")


class DeepSeekError(Exception):
    """Dilempar kalau panggilan ke DeepSeek API gagal."""


def _panggil_deepseek(prompt: str, system_prompt: Optional[str] = None) -> str:
    """Panggil DeepSeek chat completion, return teks jawaban mentah."""
    if not DEEPSEEK_API_KEY:
        raise DeepSeekError(
            "DEEPSEEK_API_KEY belum di-set di .env -- tidak bisa memanggil DeepSeek API."
        )

    messages: List[Dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    try:
        resp = requests.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": messages,
                "temperature": 0.3,
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except requests.RequestException as e:
        logger.error(f"❌ Gagal memanggil DeepSeek API: {e}")
        raise DeepSeekError(f"Gagal memanggil DeepSeek API: {e}") from e
    except (KeyError, IndexError) as e:
        logger.error(f"❌ Format respons DeepSeek tidak terduga: {e}")
        raise DeepSeekError(f"Format respons DeepSeek tidak terduga: {e}") from e


_SYSTEM_PROMPT_RINGKASAN = (
    "Kamu adalah asisten akuntan yang menganalisis data hasil pemrosesan "
    "dokumen keuangan sebuah client. Berikan ringkasan singkat, temuan "
    "penting, dan potensi masalah/anomali dalam Bahasa Indonesia yang "
    "jelas dan ringkas. Jawab dalam format JSON dengan key: "
    '"ringkasan" (string), "temuan_penting" (list of string), '
    '"potensi_masalah" (list of string).'
)


def analisis_ringkasan_keuangan(riwayat_hasil: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Minta DeepSeek generate ringkasan & temuan dari riwayat hasil satu
    client (bentuk `riwayat_hasil` sama seperti return dari
    db_client.ambil_hasil_client()).

    Return dict: {"prompt": str, "hasil": dict, "model_ai": str}
    Lempar DeepSeekError kalau panggilan API gagal -- biar endpoint yang
    manggil bisa kasih pesan error yang jelas ke frontend.
    """
    # Ringkas data biar prompt tidak kepanjangan -- ambil poin penting saja
    ringkasan_input = [
        {
            "jenis": h.get("jenis"),
            "tanggal": h.get("dibuat_at"),
            "data": h.get("data"),
        }
        for h in riwayat_hasil[:50]  # batasi biar prompt tidak meledak
    ]

    prompt = (
        "Berikut data hasil pemrosesan dokumen keuangan sebuah client "
        "(format JSON):\n\n"
        f"{json.dumps(ringkasan_input, ensure_ascii=False, default=str)}\n\n"
        "Analisis data ini dan berikan ringkasan sesuai instruksi."
    )

    teks_jawaban = _panggil_deepseek(prompt, system_prompt=_SYSTEM_PROMPT_RINGKASAN)

    try:
        hasil_parsed = json.loads(teks_jawaban)
    except json.JSONDecodeError:
        # DeepSeek kadang bungkus JSON dengan ```json ... ``` -- coba bersihkan
        bersih = teks_jawaban.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            hasil_parsed = json.loads(bersih)
        except json.JSONDecodeError:
            hasil_parsed = {"ringkasan": teks_jawaban, "temuan_penting": [], "potensi_masalah": []}

    return {
        "prompt": prompt,
        "hasil": hasil_parsed,
        "model_ai": DEEPSEEK_MODEL,
    }


# ============================================================
# [BARU] RINGKASAN EKSEKUTIF (#4) -- narasi utk klien NON-AKUNTAN
# ============================================================
# Beda dari analisis_ringkasan_keuangan() di atas: prompt di sini secara
# eksplisit minta bahasa awam (tanpa istilah "debet/kredit/jurnal/
# rekonsiliasi"), krn pembacanya pemilik usaha, bukan akuntan internal.
# Input angka_kunci/per_kategori datang dari
# modules.dashboard.ringkas_eksekutif_dari_riwayat() -- BUKAN riwayat
# mentah -- supaya prompt tetap pendek & tidak ikut membocorkan detail
# teknis (no_akun, sumber_kategori, dst) ke prompt yang isinya memang
# utk konsumsi non-teknis.

_SYSTEM_PROMPT_EKSEKUTIF = (
    "Kamu adalah asisten yang menjelaskan kondisi keuangan sebuah usaha "
    "kepada PEMILIK USAHA yang BUKAN akuntan/tidak paham istilah akuntansi. "
    "Gunakan Bahasa Indonesia yang sederhana dan hangat. JANGAN memakai "
    "istilah teknis akuntansi seperti 'debet', 'kredit', 'jurnal', "
    "'rekonsiliasi', 'akun COA' -- ganti dengan bahasa awam seperti 'uang "
    "masuk', 'uang keluar', 'catatan transaksi', 'yang perlu dicek lagi'. "
    "Jawab HANYA dalam format JSON dengan key: "
    '"ringkasan" (string, 1 paragraf singkat maksimal 4-5 kalimat, nada '
    'positif tapi jujur kalau ada yang perlu perhatian), '
    '"sorotan" (list of string, maksimal 5 poin singkat & mudah dipahami).'
)


def buat_ringkasan_eksekutif(
    angka_kunci: List[Dict[str, Any]],
    per_kategori: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Minta DeepSeek generate narasi ringkasan eksekutif dari angka-angka
    yang sudah disaring modules.dashboard.ringkas_eksekutif_dari_riwayat()
    (kartu_utama & per_kategori) -- versi ringkas untuk klien non-akuntan,
    terpisah dari analisis_ringkasan_keuangan() di atas yang bahasanya
    masih teknis untuk konsumsi internal akuntan.

    Return dict: {"prompt": str, "hasil": dict, "model_ai": str}
    Lempar DeepSeekError kalau panggilan API gagal.
    """
    prompt = (
        "Berikut angka-angka utama kondisi keuangan sebuah usaha, sudah "
        "diringkas dari dokumen-dokumen yang diproses (format JSON):\n\n"
        f"Angka utama: {json.dumps(angka_kunci, ensure_ascii=False, default=str)}\n\n"
        f"Rincian per kategori dokumen: {json.dumps(per_kategori, ensure_ascii=False, default=str)}\n\n"
        "Jelaskan kondisi ini ke pemilik usaha sesuai instruksi."
    )

    teks_jawaban = _panggil_deepseek(prompt, system_prompt=_SYSTEM_PROMPT_EKSEKUTIF)

    try:
        hasil_parsed = json.loads(teks_jawaban)
    except json.JSONDecodeError:
        bersih = teks_jawaban.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            hasil_parsed = json.loads(bersih)
        except json.JSONDecodeError:
            hasil_parsed = {"ringkasan": teks_jawaban, "sorotan": []}

    return {
        "prompt": prompt,
        "hasil": hasil_parsed,
        "model_ai": DEEPSEEK_MODEL,
    }