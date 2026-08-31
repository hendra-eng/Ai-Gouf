"""
Skrip fix akun "staging" di COA -- untuk semua client yang sudah punya COA
(dilewati kalau COA client kosong), supaya validasi
cari_akun_staging_dari_coa() (kertas_kerja.py) lolos dan kertas kerja bisa
digenerate dari PDF rekening koran.

Berdasarkan hasil cek sebelumnya, dipakai akun clearing yang sudah ada di
COA sebagai staging:
    - "21200003" AP PAYMENT CLEARANCE  -> staging liability (Normal Saldo = Credit)
    - "11300999" AR PAYMENT CLEARANCE  -> staging asset     (Normal Saldo = Debit)

Jalankan dari folder backend/:
    python fix_akun_staging.py
"""

from dotenv import load_dotenv
load_dotenv()  # WAJIB sebelum import db_client, supaya DATABASE_URL dari
                # .env kepakai -- tanpa ini db_client fallback ke
                # sqlite:///ai_gouf.db default yang beda dari DB asli app.

import db_client

NO_AKUN_LIABILITY = "21200003"  # AP PAYMENT CLEARANCE
NO_AKUN_ASSET = "11300999"      # AR PAYMENT CLEARANCE


def fix_satu_client(client_id: int) -> bool:
    daftar = db_client.ambil_coa_client(client_id)
    if not daftar:
        print(f"-- Client {client_id}: COA kosong, dilewati.")
        return False

    berhasil = True
    for no_akun, saldo_target, label in [
        (NO_AKUN_LIABILITY, "Credit", "liability"),
        (NO_AKUN_ASSET, "Debit", "asset"),
    ]:
        akun = db_client.cari_akun_coa(client_id, no_akun)
        if akun is None:
            print(f"❌ Client {client_id}: akun {no_akun} ({label}) tidak ditemukan.")
            berhasil = False
            continue

        keterangan_lama = akun.get("keterangan") or ""
        keterangan_baru = keterangan_lama
        if "staging" not in keterangan_lama.lower():
            keterangan_baru = (keterangan_lama + " staging").strip()

        ok = db_client.update_akun_coa(
            akun["id"],
            normal_saldo=saldo_target,
            keterangan=keterangan_baru,
        )
        if ok:
            print(
                f"✅ Client {client_id}: akun {no_akun} ({akun['nama_akun']}) "
                f"-> normal_saldo='{saldo_target}', keterangan='{keterangan_baru}'"
            )
        else:
            print(f"❌ Client {client_id}: gagal update akun {no_akun}.")
            berhasil = False

    return berhasil


if __name__ == "__main__":
    for client_id in range(1, 9):
        fix_satu_client(client_id)
    print("\nSelesai. Coba generate kertas kerja lagi untuk client yang berhasil di atas.")