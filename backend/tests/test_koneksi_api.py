"""
test_koneksi_api.py
====================
Smoke test SEDERHANA untuk memastikan koneksi ke DeepSeek API jalan (API key
valid, library ter-install, dsb). Ini BUKAN unit test logika akuntansi --
untuk itu lihat test_akuntansi_ai.py yang jalan sepenuhnya lokal tanpa
API key/koneksi internet.

Jalankan manual saja saat butuh cek konektivitas (mis. setelah ganti API key),
JANGAN dimasukkan ke test suite otomatis/CI karena akan gagal kalau tidak ada
internet atau kuota API habis -- itu bukan indikasi ada bug di kode.

Cara pakai:
    export DEEPSEEK_API_KEY="key-kamu-yang-baru"   # JANGAN hardcode di kode
    python3 test_koneksi_api.py
"""
import os
import sys

try:
    import openai
except ImportError:
    print("❌ Library openai belum terinstall. Jalankan:")
    print("   pip install openai")
    sys.exit(1)


def main():
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("❌ DEEPSEEK_API_KEY belum di-set. Jalankan:\n"
              '   export DEEPSEEK_API_KEY="key-kamu-yang-baru"')
        sys.exit(1)

    print(f"🔑 API Key found: {api_key[:8]}...{api_key[-4:]}")

    try:
        client = openai.OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        response = client.chat.completions.create(
            model="deepseek-chat",
            max_tokens=100,
            temperature=0,
            messages=[
                {"role": "user", "content": "Halo, kamu bisa bantu kategorisasi transaksi akuntansi?"}
            ],
        )
    except openai.APIError as e:
        print(f"❌ API Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Gagal terhubung ke API: {type(e).__name__}: {e}")
        sys.exit(1)

    print("✅ Koneksi API berhasil. Contoh respons:")
    teks = response.choices[0].message.content
    print(teks[:200] + "..." if len(teks) > 200 else teks)
    print("\n✅ Test selesai!")


if __name__ == "__main__":
    main()