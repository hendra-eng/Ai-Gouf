"""Unit test modules/financial_statements/general_ledger_v1.susun_general_ledger (tanpa DB)."""

from datetime import date

from modules.financial_statements.general_ledger_v1 import susun_general_ledger


def _b(tgl, kode, debit=0.0, kredit=0.0, nomor="JE-1", nama=None):
    return {"sumber": "journal_entry", "jurnal_id": nomor, "nomor": nomor, "tanggal": tgl, "keterangan": "x",
            "pihak": None, "account_code": kode, "account_name": nama or kode, "debit": debit, "kredit": kredit}


COA = [
    {"acc_no": "1100", "account_name": "Kas", "account_classification": "ASSET", "normal_balance": "DEBIT"},
    {"acc_no": "4100", "account_name": "Pendapatan", "account_classification": "REVENUE", "normal_balance": "CREDIT"},
    {"acc_no": "5100", "account_name": "Beban Sewa", "account_classification": "EXPENSE", "normal_balance": "DEBIT"},
]

BARIS = [
    # tahun lalu: akun neraca terbawa, akun laba rugi direset
    _b(date(2025, 12, 1), "1100", debit=1000, nomor="A"),
    _b(date(2025, 12, 1), "4100", kredit=1000, nomor="A"),
    # sebelum periode, tahun yang sama
    _b(date(2026, 1, 10), "1100", debit=500, nomor="B"),
    _b(date(2026, 1, 10), "4100", kredit=500, nomor="B"),
    # dalam periode
    _b(date(2026, 2, 5), "1100", kredit=200, nomor="C"),
    _b(date(2026, 2, 5), "5100", debit=200, nomor="C"),
    # sesudah periode
    _b(date(2026, 3, 1), "1100", debit=999, nomor="D"),
    _b(date(2026, 3, 1), "4100", kredit=999, nomor="D"),
]


def _per_kode(hasil):
    return {a["account_code"]: a for a in hasil["accounts"]}


def test_saldo_awal_berjalan_dan_akhir():
    hasil = susun_general_ledger(BARIS, COA, date(2026, 2, 1), date(2026, 2, 28), "non_zero")
    akun = _per_kode(hasil)
    assert akun["1100"]["opening_balance"] == 1500
    assert akun["1100"]["closing_balance"] == 1300
    assert akun["1100"]["lines"][0]["balance"] == 1300
    # laba rugi: hanya mutasi sejak 1 Jan tahun start_date
    assert akun["4100"]["opening_balance"] == -500
    assert akun["4100"]["normal_balance"] == "CREDIT"
    assert akun["5100"]["total_debit"] == 200
    assert hasil["totals"]["debit"] == hasil["totals"]["credit"] == 200


def test_mode_include():
    mulai, akhir = date(2026, 2, 1), date(2026, 2, 28)
    assert set(_per_kode(susun_general_ledger(BARIS, COA, mulai, akhir, "with_activity"))) == {"1100", "5100"}
    assert set(_per_kode(susun_general_ledger(BARIS, COA, mulai, akhir, "non_zero"))) == {"1100", "4100", "5100"}
    coa_plus = COA + [{"acc_no": "1200", "account_name": "Bank", "account_classification": "ASSET"}]
    assert "1200" in _per_kode(susun_general_ledger(BARIS, coa_plus, mulai, akhir, "all"))
    terpilih = susun_general_ledger(BARIS, coa_plus, mulai, akhir, "selected", {"1200", "4100"})
    assert set(_per_kode(terpilih)) == {"1200", "4100"}
    assert _per_kode(terpilih)["1200"]["lines"] == []


def test_pnl_klien_mulai_pertengahan_tahun():
    # Klien mulai Mei 2026: OB 31 Mei membawa PNL YTD Jan-Mei -> ikut terakumulasi.
    baris = [
        _b(date(2026, 5, 31), "1100", debit=300, nomor="OB"),
        _b(date(2026, 5, 31), "4100", kredit=300, nomor="OB"),
        _b(date(2026, 6, 10), "1100", debit=100, nomor="J1"),
        _b(date(2026, 6, 10), "4100", kredit=100, nomor="J1"),
    ]
    hasil = susun_general_ledger(baris, COA, date(2026, 6, 1), date(2026, 7, 31))
    akun = _per_kode(hasil)
    assert akun["4100"]["accumulated_from"] == "2026-05-01"
    assert akun["4100"]["balance_basis"] == "ytd"
    assert akun["4100"]["opening_balance"] == -300
    assert akun["4100"]["closing_balance"] == -400
    # Posisi keuangan per bulan; bulan tanpa transaksi tetap muncul dengan saldo terbawa.
    assert akun["1100"]["balance_basis"] == "cumulative"
    assert akun["1100"]["monthly"] == [
        {"month": "2026-06", "debit": 100, "credit": 0, "closing_balance": 400},
        {"month": "2026-07", "debit": 0, "credit": 0, "closing_balance": 400},
    ]


def test_kepala_kode_menentukan_pnl_dan_reset_tahun():
    # COA salah klasifikasi (5xxx ditandai ASSET) -> kepala kode tetap menang.
    coa = [{"acc_no": "5200", "account_name": "Beban", "account_classification": "ASSET", "normal_balance": "DEBIT"}]
    baris = [
        _b(date(2025, 3, 1), "5200", debit=10, nomor="A"),
        _b(date(2025, 12, 1), "5200", debit=20, nomor="B"),
        _b(date(2026, 1, 5), "5200", debit=5, nomor="C"),
    ]
    a = susun_general_ledger(baris, coa, date(2025, 11, 1), date(2026, 1, 31))["accounts"][0]
    assert a["opening_balance"] == 10  # YTD 2025 s.d. Oktober
    assert [l["balance"] for l in a["lines"]] == [30, 5]  # direset di 1 Jan 2026
    assert a["lines"][1]["year_reset"] is True
    assert a["closing_balance"] == 5


def test_akun_tanpa_coa_pakai_heuristik():
    hasil = susun_general_ledger([_b(date(2026, 2, 2), "2100", kredit=50, nama="Hutang Usaha")], [], date(2026, 2, 1), date(2026, 2, 28))
    a = hasil["accounts"][0]
    assert a["account_name"] == "Hutang Usaha"
    assert a["normal_balance"] == "CREDIT"
    assert a["closing_balance"] == -50
