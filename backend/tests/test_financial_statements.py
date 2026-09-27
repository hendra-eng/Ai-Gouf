"""
tests/test_financial_statements.py
===================================
Unit test mesin hitung modules/financial_statements/core.py -- pakai baris
jurnal sintetis (tanpa DB), bentuknya sama dengan output
db_client.ambil_baris_jurnal_posted_transaksi().
"""

import os
import sys
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.financial_statements import core  # noqa: E402


def _jurnal(jid, tgl, *baris, sumber="journal_entry", pihak=None):
    return [
        {"sumber": sumber, "jurnal_id": jid, "nomor": jid, "tanggal": tgl, "keterangan": f"Jurnal {jid}",
         "pihak": pihak, "account_code": kode, "account_name": nama, "debit": d, "kredit": k}
        for kode, nama, d, k in baris
    ]


def _data():
    b = []
    # Tahun lalu: setoran modal + penjualan tunai (laba tahun lalu belum ditutup)
    b += _jurnal("OB-1", date(2025, 6, 1), ("11100001", "KAS", 100_000_000, 0), ("31000001", "MODAL DISETOR", 0, 100_000_000))
    b += _jurnal("OB-2", date(2025, 7, 1), ("11100001", "KAS", 10_000_000, 0), ("41000001", "PENDAPATAN JASA", 0, 10_000_000))
    # Tahun berjalan
    b += _jurnal("S-1", date(2026, 1, 10),
                 ("1120-01", "Piutang Usaha - IDR", 11_100_000, 0),
                 ("4100-01", "Pendapatan Jasa Konsultasi", 0, 10_000_000),
                 ("2100-01", "PPN Keluaran", 0, 1_100_000), sumber="sales", pihak="PT Pelanggan")
    b += _jurnal("R-1", date(2026, 2, 5), ("11100002", "BANK BCA", 11_100_000, 0), ("1120-01", "Piutang Usaha - IDR", 0, 11_100_000))
    b += _jurnal("P-1", date(2026, 2, 8),
                 ("12100001", "PERALATAN KANTOR", 20_000_000, 0),
                 ("11100002", "BANK BCA", 0, 20_000_000))
    b += _jurnal("P-2", date(2026, 2, 12),
                 ("52010004", "BIAYA MAKAN", 1_000_000, 0),
                 ("1300", "VAT Recoverable (Input Tax)", 110_000, 0),
                 ("2100", "Accounts Payable", 0, 1_110_000), sumber="purchase", pihak="Vendor A")
    b += _jurnal("D-1", date(2026, 3, 31),
                 ("65000001", "BEBAN PENYUSUTAN", 500_000, 0),
                 ("12900001", "AKUMULASI PENYUSUTAN PERALATAN", 0, 500_000))
    b += _jurnal("L-1", date(2026, 3, 15), ("11100002", "BANK BCA", 50_000_000, 0), ("22100001", "HUTANG BANK JANGKA PANJANG", 0, 50_000_000))
    b += _jurnal("T-1", date(2026, 3, 20), ("11100001", "KAS", 1_000_000, 0), ("11100002", "BANK BCA", 0, 1_000_000))
    b += _jurnal("DV-1", date(2026, 3, 25), ("32000001", "DIVIDEN", 5_000_000, 0), ("11100002", "BANK BCA", 0, 5_000_000))
    return b


def test_klasifikasi_akun():
    k = core.klasifikasi_akun
    assert k("11100002", "KAS KASIR")["grup"] == "kas"
    assert k("11300003", "PIUTANG USAHA")["grup"] == "piutang_usaha"
    assert k("11300002", "PIUTANG KARYAWAN")["grup"] == "piutang_lain"
    assert k("21200001", "HUTANG USAHA")["grup"] == "hutang_usaha"
    assert k("21200002", "HUTANG KEPADA PEMEGANG SAHAM")["grup"] == "pihak_berelasi"
    assert k("21300001", "BIAYA YMH DIBAYAR GAJI")["grup"] == "akrual"
    assert k("52010013", "BIAYA BBM")["ember_laba_rugi"] == "opex"
    assert k("51000001", "HARGA POKOK PENJUALAN")["ember_laba_rugi"] == "cogs"
    assert k("1300", "VAT Recoverable (Input Tax)")["grup"] == "pajak_dimuka"
    assert k("2100", "Accounts Payable")["kategori"] == "LIABILITAS"
    assert k("12100001", "PERALATAN KANTOR")["lancar"] is False
    assert k("22100001", "HUTANG BANK JANGKA PANJANG")["lancar"] is False
    assert k(None, "Pendapatan Lain")["kategori"] == "PENDAPATAN"


def test_neraca_seimbang_dan_laba_tahun_lalu_terbawa():
    lap = core.susun_laporan_keuangan(_data(), 2026)
    assert lap["periode"]["sampai_bulan"] == 3
    bs = lap["balance_sheet"]
    assert bs["seimbang"], bs["selisih"]
    assert lap["trial_balance"]["seimbang"]
    nama_ekuitas = {i["name"]: i["current"] for i in bs["ekuitas"]["items"]}
    assert nama_ekuitas["Saldo Laba Tahun Lalu"] == 10_000_000
    # Laba 2026: pendapatan 10jt - biaya makan 1jt - penyusutan 0.5jt
    assert lap["profit_loss"]["ringkasan"]["net_profit"] == 8_500_000
    assert nama_ekuitas["Laba Tahun Berjalan"] == 8_500_000
    # Saldo awal kas (akhir 2025) = 110jt
    assert lap["cash_flow"]["ringkasan"]["beginning_cash"] == 110_000_000


def test_laba_rugi_ember():
    pl = core.susun_laporan_keuangan(_data(), 2026)["profit_loss"]
    r = pl["ringkasan"]
    assert r["revenue"] == 10_000_000
    assert r["operating_expenses"] == 1_000_000
    assert r["da"] == 500_000
    assert r["ebitda"] == 9_000_000
    assert [m["label"] for m in pl["bulanan"]] == ["Jan", "Feb", "Mar"]
    assert sum(m["net_profit"] for m in pl["bulanan"]) == r["net_profit"]


def test_arus_kas_langsung_dan_tidak_langsung_rekonsiliasi():
    cf = core.susun_laporan_keuangan(_data(), 2026)["cash_flow"]
    r = cf["ringkasan"]
    assert r["net_operating_cf"] + r["net_investing_cf"] + r["net_financing_cf"] == r["net_change"]
    assert r["net_operating_cf"] == 11_100_000          # penagihan piutang
    assert r["net_investing_cf"] == -20_000_000         # beli peralatan
    assert r["net_financing_cf"] == 45_000_000          # pinjaman 50jt - dividen 5jt
    assert r["customer_collections"] == 11_100_000
    assert r["equipment_purchases"] == -20_000_000
    assert r["debt_proceeds"] == 50_000_000
    assert r["dividend_payments"] == -5_000_000
    for m in cf["bulanan"]:
        assert round(m["operating_cf"] + m["investing_cf"] + m["financing_cf"], 2) == m["net_change"]
    # Transfer kas->bank tidak tercatat sbg arus kas
    assert all(t["id"] != "T-1" for t in cf["recent_transactions"])
    tl = cf["metode_tidak_langsung"]
    assert tl["selisih_rekonsiliasi"] == 0
    assert tl["net_change"] == r["net_change"]


def test_perubahan_ekuitas_cocok_dengan_neraca():
    lap = core.susun_laporan_keuangan(_data(), 2026)
    eq = lap["changes_in_equity"]
    assert eq["ringkasan"]["closing_equity"] == lap["balance_sheet"]["total_ekuitas"]
    assert eq["ringkasan"]["opening_equity"] == 110_000_000
    assert eq["ringkasan"]["net_profit"] == 8_500_000
    assert eq["ringkasan"]["dividends"] == -5_000_000


def test_calk_berisi_pos_bersaldo_saja():
    notes = core.susun_laporan_keuangan(_data(), 2026, nama_perusahaan="PT Uji")["notes"]
    judul = [c["title"] for c in notes["catatan"]]
    assert "Cash & Cash Equivalents" in judul
    assert "Inventories" not in judul  # tidak ada akun persediaan
    kas = next(c for c in notes["catatan"] if c["key"] == "cash")
    assert kas["total"] == 110_000_000 + 11_100_000 - 20_000_000 + 50_000_000 - 5_000_000
    assert [c["no"] for c in notes["catatan"]] == [str(i).zfill(2) for i in range(1, len(judul) + 1)]


def test_periode_eksplisit_dan_tanpa_data():
    lap = core.susun_laporan_keuangan(_data(), 2026, sampai_bulan=1)
    assert lap["balance_sheet"]["seimbang"]
    assert lap["profit_loss"]["ringkasan"]["net_profit"] == 10_000_000
    kosong = core.susun_laporan_keuangan([], 2026, hari_ini=date(2026, 9, 23))
    assert kosong["periode"]["ada_data"] is False
    assert kosong["periode"]["sampai_bulan"] == 9
    assert kosong["balance_sheet"]["total_aset"] == 0
