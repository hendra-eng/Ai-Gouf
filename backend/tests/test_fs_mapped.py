"""Unit test modules/financial_statements/mapped.py -- FS berbasis mapping COA (tanpa DB)."""

from datetime import date

from modules.financial_statements import mapped

ATURAN = [
    {"standard_account_code": "std_asset_current_cash", "cash_flow_category": "CASH", "cash_flow_line": "Cash", "note_key": "cash"},
    {"standard_account_code": "std_asset_current_receivable", "cash_flow_category": "OPERATING", "cash_flow_line": "(Increase)/decrease in other receivables", "note_key": "receivables"},
    {"standard_account_code": "std_asset_current_receivable_trade", "cash_flow_category": "OPERATING", "cash_flow_line": "(Increase)/decrease in trade receivables", "note_key": "receivables"},
    {"standard_account_code": "std_asset_noncurrent_ppe", "cash_flow_category": "INVESTING", "cash_flow_line": "Acquisition of PPE", "note_key": "fixed_assets"},
    {"standard_account_code": "std_asset_noncurrent_ppe_accum_depreciation", "cash_flow_category": "NON_CASH", "cash_flow_line": "Depreciation", "note_key": "fixed_assets"},
    {"standard_account_code": "std_liability_current_payable_trade", "cash_flow_category": "OPERATING", "cash_flow_line": "Increase/(decrease) in trade payables", "note_key": "payables"},
    {"standard_account_code": "std_equity_share_capital", "cash_flow_category": "FINANCING", "cash_flow_line": "Capital injection", "equity_component": "share_capital", "note_key": "equity"},
    {"standard_account_code": "std_equity_retained_earnings", "cash_flow_category": "NON_CASH", "cash_flow_line": "RE adj", "equity_component": "retained_earnings", "note_key": "equity"},
    {"standard_account_code": "std_revenue", "note_key": "revenue"},
    {"standard_account_code": "std_expense", "note_key": "operating_expenses"},
]


def _c(acc, nama, klas, head, sub, std, cid=None):
    return {"id": cid or f"id-{acc}", "acc_no": acc, "account_name": nama, "account_classification": klas,
            "account_head": head, "account_sub": sub, "standard_account_code": std, "is_active": True}


COA = [
    _c("1101", "Kas Besar", "ASSET", "CURRENT ASSET", "CASH & CASH EQUIVALENTS", "std_asset_current_cash_on_hand"),
    _c("1102", "Bank BCA", "ASSET", "CURRENT ASSET", "CASH & CASH EQUIVALENTS", "std_asset_current_cash_bank"),
    _c("1201", "Piutang Usaha", "ASSET", "CURRENT ASSET", "TRADE RECEIVABLES", "std_asset_current_receivable_trade"),
    _c("1501", "Peralatan", "ASSET", "NON-CURRENT ASSET", "PROPERTY, PLANT & EQUIPMENT", "std_asset_noncurrent_ppe_equipment"),
    _c("1502", "Akum. Peny. Peralatan", "ASSET", "NON-CURRENT ASSET", "ACCUMULATED DEPRECIATION", "std_asset_noncurrent_ppe_accum_depreciation"),
    _c("2101", "Hutang Usaha", "LIABILITY", "CURRENT LIABILITY", "TRADE PAYABLES", "std_liability_current_payable_trade"),
    _c("2901", "Hutang Lain Tanpa Std", "LIABILITY", "CURRENT LIABILITY", "OTHER PAYABLES", None),
    _c("3101", "Modal Saham", "EQUITY", "EQUITY", "SHARE CAPITAL", "std_equity_share_capital"),
    _c("3201", "Laba Ditahan", "EQUITY", "EQUITY", "RETAINED EARNINGS", "std_equity_retained_earnings"),
    _c("4101", "Penjualan", "REVENUE", "OPERATING REVENUE", "SALES REVENUE", "std_revenue_operating_sales"),
    _c("5101", "HPP", "COST OF SALES", "COST OF REVENUE", "OTHER COST OF SALES", "std_cost_of_sales_other"),
    _c("6101", "Beban Gaji", "EXPENSE", "OPERATING EXPENSE", "SALARIES & WAGES", "std_expense_operating_salary_wages"),
    _c("6201", "Beban Penyusutan", "EXPENSE", "OPERATING EXPENSE", "DEPRECIATION", "std_expense_operating_depreciation"),
]


def _j(tgl, nomor, *baris, segmen=None):
    return [{"sumber": "journal_entry", "jurnal_id": nomor, "nomor": nomor, "tanggal": tgl, "keterangan": nomor, "pihak": None,
             "account_code": kode, "account_name": kode, "debit": d, "kredit": k, "segmen": segmen or {}}
            for kode, d, k in baris]


BARIS = (
    # 2025: setoran modal, penjualan tunai -> laba 2025 belum ditutup
    _j(date(2025, 1, 2), "A1", ("1102", 1000, 0), ("3101", 0, 1000))
    + _j(date(2025, 6, 1), "A2", ("1101", 300, 0), ("4101", 0, 300))
    # 2026
    + _j(date(2026, 1, 10), "B1", ("1201", 500, 0), ("4101", 0, 500), segmen={"branch": "JKT"})
    + _j(date(2026, 1, 10), "B2", ("5101", 200, 0), ("2101", 0, 200))
    + _j(date(2026, 2, 5), "B3", ("1501", 400, 0), ("1102", 0, 400))
    + _j(date(2026, 2, 28), "B4", ("6201", 40, 0), ("1502", 0, 40))
    + _j(date(2026, 2, 28), "B5", ("6101", 100, 0), ("1101", 0, 100), segmen={"branch": "BDG"})
    + _j(date(2026, 3, 1), "B6", ("1101", 50, 0), ("2901", 0, 50))
    + _j(date(2026, 3, 2), "B7", ("1101", 10, 0), ("9999", 0, 10))   # kode di luar COA
)


def _buku(mapping=None):
    return mapped.Buku(BARIS, mapped.susun_peta_akun(COA, mapping or {}, ATURAN))


def _baris(neraca, seksi):
    s = next(x for x in neraca["sections"] if x["key"] == seksi)
    return {l["label"]: l for l in s["lines"]}


def test_aturan_prefix_terpanjang():
    assert mapped.cocokkan_aturan("std_asset_current_receivable_trade", ATURAN)["cash_flow_line"].endswith("trade receivables")
    assert mapped.cocokkan_aturan("std_asset_current_receivable_employee", ATURAN)["cash_flow_line"].endswith("other receivables")
    assert mapped.cocokkan_aturan("std_asset_current_cashier", ATURAN) is None  # bukan batas kata
    assert mapped.label_judul("PROPERTY, PLANT & EQUIPMENT") == "Property, Plant & Equipment"


def test_neraca_dikelompokkan_head_sub_dan_seimbang():
    buku = _buku()
    n = mapped.susun_neraca(buku, date(2026, 3, 31), date(2025, 12, 31))
    lancar = _baris(n, "current_assets")
    assert lancar["Cash & Cash Equivalents"]["amount"] == 1000 - 400 + 300 - 100 + 50 + 10
    assert {a["code"] for a in lancar["Cash & Cash Equivalents"]["accounts"]} == {"1101", "1102"}
    tetap = _baris(n, "non_current_assets")
    assert tetap["Accumulated Depreciation"]["amount"] == -40
    # Kode di luar COA dihitung (digit 9 -> laba rugi, ikut laba) & di-flag.
    assert any(w["code"] == "not_in_coa" and w["account_code"] == "9999" for w in mapped.susun_laba_rugi(buku, date(2026, 1, 1), date(2026, 3, 31))["warnings"])
    ekuitas = _baris(n, "equity")
    re_line = ekuitas["Retained Earnings"]
    assert any(a.get("computed") and a["amount"] == 300 for a in re_line["accounts"])  # laba 2025 belum ditutup
    laba_2026 = 500 - 200 - 40 - 100 + 10
    assert ekuitas["Current Year Earnings"]["amount"] == laba_2026
    assert n["check"]["balanced"] and n["check"]["difference"] == 0
    assert n["totals"]["compare_assets"] == 1300
    assert n["check"]["compare_difference"] == 0


def test_akun_baru_otomatis_masuk_tanpa_hardcode_nama():
    coa = COA + [_c("1103", "Rekening Baru Apa Saja", "ASSET", "CURRENT ASSET", "CASH & CASH EQUIVALENTS", "std_asset_current_cash_bank")]
    baris = BARIS + _j(date(2026, 3, 5), "C1", ("1103", 70, 0), ("3101", 0, 70))
    buku = mapped.Buku(baris, mapped.susun_peta_akun(coa, {}, ATURAN))
    n = mapped.susun_neraca(buku, date(2026, 3, 31))
    assert "1103" in {a["code"] for a in _baris(n, "current_assets")["Cash & Cash Equivalents"]["accounts"]}
    assert buku.peta["1103"]["cash_flow_category"] == "CASH"


def test_override_mapping_klien():
    buku = _buku({"id-2901": {"fs_section": "non_current_liabilities", "fs_line": "Long-term Other", "cash_flow_category": "FINANCING"}})
    n = mapped.susun_neraca(buku, date(2026, 3, 31))
    assert _baris(n, "non_current_liabilities")["Long-term Other"]["amount"] == 50
    assert buku.peta["2901"]["mapping_source"] == "client"


def test_laba_rugi_subtotal_pembanding_segmen_bulanan():
    buku = _buku()
    lr = mapped.susun_laba_rugi(buku, date(2026, 1, 1), date(2026, 3, 31), (date(2025, 1, 1), date(2025, 3, 31)), bulanan=True)
    s = lr["summary"]
    assert s["gross_profit"]["amount"] == 300
    assert s["operating_profit"]["amount"] == 160
    assert s["net_profit"]["amount"] == 160 - 10 * -1  # 9999 (digit 9 = income tax) kredit 10 -> pajak -10
    assert s["net_profit"]["compare_amount"] == 0
    assert lr["months"] == ["2026-01", "2026-02", "2026-03"]
    assert s["net_profit"]["monthly"] == [300, -140, 10]
    jkt = mapped.susun_laba_rugi(buku, date(2026, 1, 1), date(2026, 3, 31), segmen=("branch", "jkt"))
    assert jkt["summary"]["net_profit"]["amount"] == 500
    jenis = [r["type"] for r in lr["rows"]]
    assert jenis.count("subtotal") == 4


def test_perubahan_ekuitas_rekonsiliasi_dan_transfer_laba():
    buku = _buku()
    sce = mapped.susun_perubahan_ekuitas(buku, date(2026, 1, 1), date(2026, 3, 31))
    assert sce["check"]["reconciled"]
    rows = {r["key"]: r for r in sce["rows"]}
    assert rows["opening"]["values"]["share_capital"] == 1000
    # Per 31 Des 2025, laba 2025 masih "current year"; masuk 2026 dipindah ke retained earnings.
    assert rows["opening"]["values"]["current_year_earnings"] == 300
    assert rows["retained_earnings_transfer"]["values"]["retained_earnings"] == 300
    assert rows["retained_earnings_transfer"]["values"]["current_year_earnings"] == -300
    assert rows["profit"]["values"]["current_year_earnings"] == 170
    assert rows["closing"]["total"] == sce["check"]["balance_sheet_equity"] == 1470


def test_arus_kas_tidak_langsung_rekonsiliasi_dan_flag_unmapped():
    buku = _buku()
    cf = mapped.susun_arus_kas(buku, date(2026, 1, 1), date(2026, 3, 31))
    assert cf["opening_cash"] == 1300
    assert cf["balance_sheet_ending_cash"] == 1300 - 400 - 100 + 50 + 10
    assert cf["check"]["reconciled"] and cf["ending_cash"] == cf["balance_sheet_ending_cash"]
    assert cf["operating"]["net_profit"] == 170
    assert [l["amount"] for l in cf["operating"]["non_cash_adjustments"]] == [40]
    assert cf["investing"]["total"] == -400
    tanpa = {a["code"] for a in cf["unmapped_accounts"]}
    assert "2901" in tanpa  # tidak punya standard code -> belum ada mapping cash flow
    assert cf["operating"]["unmapped"][0]["amount"] == 50


def test_awal_pnl_klien_mulai_pertengahan_tahun():
    baris = _j(date(2026, 7, 15), "M1", ("1101", 100, 0), ("4101", 0, 100))
    buku = mapped.Buku(baris, mapped.susun_peta_akun(COA, {}, ATURAN))
    assert buku.awal_pnl(date(2026, 9, 30)) == date(2026, 7, 1)
    # Periode SEBELUM pembukuan mulai: awal tetap 1 Januari (bukan rentang terbalik).
    assert buku.awal_pnl(date(2026, 6, 30)) == date(2026, 1, 1)
    assert buku.awal_pnl(date(2027, 3, 31)) == date(2027, 1, 1)


def test_jurnal_tidak_seimbang_dilaporkan():
    baris = BARIS + _j(date(2026, 3, 10), "BAD", ("1201", 11000, 0), ("4101", 0, 10000), ("2101", 0, 900))
    buku = mapped.Buku(baris, mapped.susun_peta_akun(COA, {}, ATURAN))
    n = mapped.susun_neraca(buku, date(2026, 3, 31))
    assert not n["check"]["balanced"] and n["check"]["difference"] == 100
    assert [j["number"] for j in n["check"]["unbalanced_journals"]] == ["BAD"]
    cf = mapped.susun_arus_kas(buku, date(2026, 1, 1), date(2026, 3, 31))
    assert [j["number"] for j in cf["check"]["unbalanced_journals"]] == ["BAD"]


def test_calk_grup_override_dan_akun_tanpa_note():
    buku = _buku()
    notes = [
        {"id": "n1", "note_key": "cash", "title": "Cash", "statement": "BALANCE_SHEET", "note_type": "account", "template_id": "t", "narrative": None, "template_narrative": "As at {period_end}."},
        {"id": "n2", "note_key": "fixed_assets", "title": "PPE", "statement": "BALANCE_SHEET", "note_type": "account", "template_id": "t", "narrative": None, "template_narrative": None},
    ]
    ov = {"n1": {"1101": {"id": "o1", "override_value": 999, "system_value": 260, "reason": "audit adj"}}}
    calk = mapped.susun_calk(buku, notes, ov, {}, date(2026, 3, 31), date(2026, 1, 1), (date(2025, 1, 1), date(2025, 12, 31)), {"period_end": "31 March 2026"})
    kas = calk["notes"][0]
    assert kas["narrative"] == "As at 31 March 2026."
    g = kas["groups"][0]
    assert g["system_total"] == 860 and g["total"] == 999 + 600 and not g["reconciled"]
    assert kas["has_override"]
    ppe = calk["notes"][1]
    assert [g["label"] for g in ppe["groups"]] == ["Property, Plant & Equipment", "Accumulated Depreciation"]
    assert "2101" in {a["code"] for a in calk["accounts_without_note"]}
