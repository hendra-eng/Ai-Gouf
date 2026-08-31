import sys
sys.path.insert(0, "/home/claude")
from modules.accounting_export import _susun_workbook_18_sheet

coa = [
    {"no_akun": "1000", "nama_akun": "Kas", "kategori": "ASET", "sub_kategori": "Kas",
     "normal_saldo": "DEBET", "saldo_awal": 50_000_000},
    {"no_akun": "1100", "nama_akun": "Piutang Usaha", "kategori": "ASET", "sub_kategori": "Piutang",
     "normal_saldo": "DEBET", "saldo_awal": 20_000_000},
    {"no_akun": "1200", "nama_akun": "Persediaan Barang Dagang", "kategori": "ASET", "sub_kategori": "Persediaan",
     "normal_saldo": "DEBET", "saldo_awal": 10_000_000},
    {"no_akun": "1500", "nama_akun": "Peralatan", "kategori": "ASET", "sub_kategori": "Aset Tetap",
     "normal_saldo": "DEBET", "saldo_awal": 100_000_000},
    {"no_akun": "1590", "nama_akun": "Akumulasi Penyusutan Peralatan", "kategori": "ASET",
     "sub_kategori": "Akumulasi Penyusutan", "normal_saldo": "KREDIT", "saldo_awal": 10_000_000},
    {"no_akun": "2000", "nama_akun": "Hutang Usaha", "kategori": "LIABILITAS", "sub_kategori": "Hutang Usaha",
     "normal_saldo": "KREDIT", "saldo_awal": 15_000_000},
    {"no_akun": "2100", "nama_akun": "Hutang Pajak", "kategori": "LIABILITAS", "sub_kategori": "",
     "normal_saldo": "KREDIT", "saldo_awal": 0},
    {"no_akun": "3000", "nama_akun": "Modal Saham", "kategori": "EKUITAS", "sub_kategori": "Modal",
     "normal_saldo": "KREDIT", "saldo_awal": 155_000_000},
    {"no_akun": "3900", "nama_akun": "Saldo Laba", "kategori": "EKUITAS", "sub_kategori": "Saldo Laba",
     "normal_saldo": "KREDIT", "saldo_awal": 0},
    {"no_akun": "4000", "nama_akun": "Pendapatan Jasa", "kategori": "PENDAPATAN", "sub_kategori": "",
     "normal_saldo": "KREDIT", "saldo_awal": 0},
    {"no_akun": "5000", "nama_akun": "Beban Pokok Penjualan", "kategori": "BEBAN", "sub_kategori": "HPP",
     "normal_saldo": "DEBET", "saldo_awal": 0},
    {"no_akun": "5100", "nama_akun": "Beban Gaji", "kategori": "BEBAN", "sub_kategori": "",
     "normal_saldo": "DEBET", "saldo_awal": 0},
    {"no_akun": "5200", "nama_akun": "Beban Penyusutan", "kategori": "BEBAN", "sub_kategori": "Penyusutan",
     "normal_saldo": "DEBET", "saldo_awal": 0},
]
# check opening balance sheet balances: aset 50+20+10+100-10=170 ; liab+ekuitas 15+0+155+0=170  OK

jurnal = []
jid = 0


def tambah(tgl, ket, akun_d, jd, akun_k, jk, no_dok=None):
    global jid
    jid += 1
    jurnal.append({
        "id": jid, "tanggal": tgl, "keterangan": ket,
        "no_akun_debet": akun_d, "jml_debet": jd,
        "no_akun_kredit": akun_k, "jml_kredit": jk,
        "no_dokumen": no_dok or f"DOC-{jid:04d}",
        "status": "terposting", "jenis_dokumen": "manual",
        "lawan_transaksi": "-", "project_unit": "-",
    })


bulan_akhir = {
    1: "2025-01-28", 2: "2025-02-25", 3: "2025-03-28",
    4: "2025-04-25", 5: "2025-05-28", 6: "2025-06-25",
    7: "2025-07-28", 8: "2025-08-25", 9: "2025-09-28",
    10: "2025-10-25", 11: "2025-11-28", 12: "2025-12-20",
}

for m in range(1, 13):
    tgl = bulan_akhir[m]
    tambah(tgl, f"Jasa tunai bulan {m}", "1000", 20_000_000, "4000", 20_000_000)
    tambah(tgl, f"Jasa kredit bulan {m}", "1100", 8_000_000, "4000", 8_000_000)
    tambah(tgl, f"Penerimaan piutang bulan {m}", "1000", 6_000_000, "1100", 6_000_000)
    tambah(tgl, f"Beli persediaan kredit bulan {m}", "1200", 4_000_000, "2000", 4_000_000)
    tambah(tgl, f"HPP bulan {m}", "5000", 3_000_000, "1200", 3_000_000)
    tambah(tgl, f"Bayar hutang usaha bulan {m}", "2000", 3_500_000, "1000", 3_500_000)
    tambah(tgl, f"Bayar gaji bulan {m}", "5100", 5_000_000, "1000", 5_000_000)
    tambah(tgl, f"Penyusutan bulan {m}", "5200", 1_000_000, "1590", 1_000_000)
    tambah(tgl, f"Setor pajak bulan {m}", "2100", 500_000, "1000", 500_000)
    tambah(tgl, f"Hutang pajak diakui bulan {m}", "5100", 500_000, "2100", 500_000)

# Satu pembelian aset tetap tunai di bulan 6, satu setoran modal di bulan 3
tambah("2025-06-15", "Beli peralatan baru tunai", "1500", 15_000_000, "1000", 15_000_000)
tambah("2025-03-10", "Setoran modal tambahan", "1000", 10_000_000, "3000", 10_000_000)

import datetime

def _bulan_dari_tgl(s):
    return int(s.split("-")[1])

tb = {}
for akun in coa:
    no = akun["no_akun"]
    normal = "debit" if str(akun.get("normal_saldo") or "DEBET").upper().startswith("DEB") else "kredit"
    saldo_awal = akun.get("saldo_awal") or 0
    per_bulan = []
    kum = saldo_awal
    for m in range(1, 13):
        deb = sum(j["jml_debet"] for j in jurnal if j["no_akun_debet"] == no and _bulan_dari_tgl(j["tanggal"]) == m)
        kre = sum(j["jml_kredit"] for j in jurnal if j["no_akun_kredit"] == no and _bulan_dari_tgl(j["tanggal"]) == m)
        if normal == "debit":
            kum = kum + deb - kre
        else:
            kum = kum + kre - deb
        per_bulan.append(round(kum, 2))
    tb[no] = {"per_bulan": per_bulan, "nama_akun": akun["nama_akun"]}

data = {
    "periode": "2025-12",
    "coa": coa,
    "jurnal": jurnal,
    "df_piutang": [], "df_hutang": [], "jadwal_aset": {},
    "laporan_bulanan": {"trial_balance_bulanan": tb},
    "pph_hasil": {}, "neraca": {}, "laba_rugi": {}, "perubahan_ekuitas": {},
    "arus_kas": {}, "calk": {}, "lampiran_rinci": {},
    "tren_piutang": [], "tren_utang": [], "asumsi": {},
}

wb = _susun_workbook_18_sheet(data)
wb.save("/home/claude/test_output.xlsx")
print("saved, sheets:", wb.sheetnames)