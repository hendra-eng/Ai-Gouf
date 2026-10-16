"""
tests/test_assets_inventory_tax.py
==================================
Logika inti modul Fixed Assets, Inventory, dan Tax Compliance yang tidak
butuh database: penyusutan bulanan, mesin stok rata-rata, jatuh tempo pajak,
tebakan jenis akun pajak.
"""

from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.assets_and_equity import fixed_assets_v1 as fa  # noqa: E402
from modules.assets_and_equity import inventory_v1 as inv  # noqa: E402
from modules.planning import tax_compliance_v1 as tax  # noqa: E402

D = Decimal


def _aset(cost=12_000_000, residu=0, umur=48, metode="straight_line", mulai=date(2025, 1, 10), opening=0):
    row = SimpleNamespace(cost=D(cost), residual_value=D(residu), useful_life_months=umur, useful_life_years=None, depreciation_method=metode,
                          depreciation_start_date=mulai, purchase_date=mulai, opening_accumulated_depreciation=D(opening), status="active",
                          coa_id=None, accum_coa_id=None, expense_coa_id=None)
    return fa.Aset(row=row, kategori=None)


def test_garis_lurus_bulanan_dan_bulan_terakhir_menghabiskan_sisa():
    a = _aset()
    assert a.penyusutan_bulan(D(12_000_000), D(0), 1) == D("250000.00")
    # Bulan ke-48 dengan sisa sedikit lebih besar karena pembulatan -> sisa dihabiskan.
    assert a.penyusutan_bulan(D(12_000_000), D("11749999.99"), 48) == D("250000.01")
    assert a.penyusutan_bulan(D(12_000_000), D(12_000_000), 49) == D(0)


def test_saldo_menurun_ganda_dan_lewat_umur_pakai_tarif_garis_lurus():
    a = _aset(metode="declining_balance", umur=10, cost=1_000_000)
    assert a.penyusutan_bulan(D(1_000_000), D(0), 1) == D("200000.00")
    # Lewat umur (akumulasi awal kurang) -> lanjut tarif garis lurus, tidak dibuang sekaligus.
    a2 = _aset(umur=12, cost=1_200_000)
    assert a2.penyusutan_bulan(D(1_200_000), D(100_000), 30) == D("100000.00")


def test_bulan_berjalan_dan_sisa_umur():
    a = _aset(mulai=date(2025, 1, 10), umur=48)
    assert a.bulan_berjalan(date(2025, 1, 1)) == 1
    assert a.bulan_berjalan(date(2025, 12, 1)) == 12
    assert a.sisa_umur(date(2025, 12, 31)) == 36
    assert a.bulan_berjalan(date(2024, 12, 1)) == 0


def _mv(item, wh, tgl, qin=0, qout=0, vin=0, vout=0):
    return inv.Mv(id="", item=item, wh=wh, tanggal=tgl, jenis="x", doc_id="", ref="", sumber=None, qin=D(qin), qout=D(qout),
                  vin=D(vin), vout=D(vout), harga=D(0), balik=False, urut=None)


def test_saldo_rata_rata_dan_tersedia_mencegah_stok_negatif_masa_depan():
    mvs = [_mv("A", "G1", date(2025, 1, 1), qin=10, vin=100_000), _mv("A", "G1", date(2025, 1, 5), qin=10, vin=120_000),
           _mv("A", "G1", date(2025, 1, 20), qout=15, vout=165_000)]
    s, wh = inv._saldo(mvs)
    assert s["A"].qty == D(5) and wh[("A", "G1")] == D(5)
    assert inv._rata_per(mvs, "A", date(2025, 1, 10)) == D(11_000)
    # Per 10 Jan saldo 20, tetapi 20 Jan keluar 15 -> yang aman dikeluarkan bertanggal 10 Jan hanya 5.
    assert inv._tersedia(mvs, "A", "G1", date(2025, 1, 10)) == D(5)
    assert inv._tersedia(mvs, "A", "G2", date(2025, 1, 10)) == D(0)


def test_jatuh_tempo_pajak():
    m = date(2026, 1, 1)
    assert tax.jatuh_tempo_bayar("pph23", m) == date(2026, 2, 15)
    assert tax.jatuh_tempo_bayar("vat", m) == date(2026, 2, 28)
    assert tax.jatuh_tempo_lapor("unifikasi", m) == date(2026, 2, 20)
    assert tax.jatuh_tempo_lapor("ppn", date(2026, 12, 1)) == date(2027, 1, 31)
    assert tax.jatuh_tempo_lapor("annual_corporate", date(2025, 1, 1)) == date(2026, 4, 30)
    assert tax.jatuh_tempo_bayar("pbb", m) is None


def _akun(nama, std=None, kelas="LIABILITY"):
    return SimpleNamespace(account_name=nama, standard_account_code=std, account_classification=kelas)


def test_tebak_jenis_akun_pajak():
    t = tax.tebak_jenis
    assert t(_akun("PPN Keluaran", "std_liability_current_tax_vat_payable"), True) == "vat_output"
    assert t(_akun("HUTANG PAJAK PPN", "std_liability_current_tax_vat_payable"), True) is None
    assert t(_akun("PAJAK MASUKAN", "std_asset_current_tax_vat_receivable", "ASSET"), True) == "vat_input"
    assert t(_akun("PAJAK MASUKAN BELUM DIKREDITKAN", "std_asset_current_tax_vat_receivable", "ASSET"), True) is None
    assert t(_akun("HUTANG PAJAK 4(2) / PP 23", "std_liability_current_tax_income_payable"), True) == "pph4_2"
    assert t(_akun("Hutang Pajak - PPh 21", "std_liability_current_tax_income_payable"), True) == "pph21"
    assert t(_akun("HUTANG PAJAK 25/29", "std_liability_current_tax_income_payable"), True) == "pph29"
    assert t(_akun("Tax Payable Art.23", "std_liability_current_tax_income_payable"), True) == "pph23"
    assert t(_akun("Pajak Dibayar Di Muka - PPh 23", "std_asset_current_tax_income_receivable", "ASSET"), True) == "pph_credit"
    assert t(_akun("Pajak Dibayar Di Muka - PPh 25", "std_asset_current_tax_income_receivable", "ASSET"), True) is None
    assert t(_akun("BIAYA PAJAK", "std_expense_operating_tax_license", "EXPENSE"), True) is None


def test_cek_jurnal_other():
    from modules.transactions import other_v1 as ot
    akun = {"1100": SimpleNamespace(acc_no="1100", account_name="Kas", is_active=True, standard_account_code="std_asset_current_cash_on_hand"),
            "9999": SimpleNamespace(acc_no="9999", account_name="Lain", is_active=False, standard_account_code=None)}
    j = SimpleNamespace(journal_no="OTH-2026-10-0001", journal_date=date(2026, 10, 10), status="draft")
    l = lambda kode, d, k: SimpleNamespace(account_code=kode, debit=D(d), credit=D(k))
    kode = lambda isu: sorted(i["code"] for i in isu)
    assert kode(ot._cek(j, [l("1100", 100, 0), l("1100", 0, 100)], akun, None)) == []
    assert kode(ot._cek(j, [l("1100", 100, 0), l("1100", 0, 90)], akun, None)) == ["unbalanced"]
    assert kode(ot._cek(j, [l("1100", 100, 0), l("9999", 0, 100)], akun, None)) == ["account_inactive", "account_unmapped"]
    assert kode(ot._cek(j, [l("1100", 100, 0), l("4444", 0, 100)], akun, date(2026, 12, 31))) == ["account_missing", "period_locked"]
