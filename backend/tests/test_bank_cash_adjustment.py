"""
tests/test_bank_cash_adjustment.py
==================================
Adjustment selisih kecil di rekonsiliasi Cash & Bank (modules/transactions/bank_cash_willi.py).
Murni logika -- tanpa database: pengaturan & akun di-monkeypatch.
"""

import os
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")

import pytest

from modules.transactions import bank_cash_willi as bc

D = Decimal


def _akun(kode, nama):
    return SimpleNamespace(id=str(uuid.uuid5(uuid.NAMESPACE_DNS, kode)), acc_no=kode, account_name=nama, is_active=True, deleted_at=None,
                           standard_account_code=None, account_sub="OTHER EXPENSE", client_id="c1")


EXP = _akun("6-1001", "Bank Charges")
INC = _akun("8-1001", "Other Income")


def _pengaturan(enabled=True, limit="100", expense=EXP, income=INC):
    return {"enabled": enabled, "limit": D(limit), "accounts": {"expense": expense, "income": income}, "edited_at": None}


@pytest.fixture
def pakai(monkeypatch):
    def _set(**kw):
        p = _pengaturan(**kw)
        monkeypatch.setattr(bc, "_pengaturan_adjustment", lambda session, cid: p)
        monkeypatch.setattr(bc, "_akun", lambda session, cid, coa_id: {EXP.id: EXP, INC.id: INC}[coa_id])
        return p
    return _set


def _inv(debit="0", credit="0"):
    return {"line_type": "sales_invoice", "debit": D(debit), "credit": D(credit)}


def _adj(cat="bank_fee", coa_id=None, note=None):
    return bc.AdjustmentIn(category=cat, coa_id=coa_id, note=note)


def _net(arah, baris):
    d = sum((b["debit"] for b in baris), D(0))
    k = sum((b["credit"] for b in baris), D(0))
    return k - d if arah == "receipt" else d - k


# ---------------------------------------------------------------- arah & sisi
@pytest.mark.parametrize("arah,baris,mutasi,tipe,sisi", [
    ("receipt", "1000000", "999900", "expense", "debit"),    # uang masuk kurang -> biaya/diskon
    ("receipt", "1000000", "1000050", "income", "credit"),   # uang masuk lebih -> pembulatan
    ("payment", "1000000", "999950", "income", "credit"),    # bayar kurang -> diskon pembelian
    ("payment", "1000000", "1000075", "expense", "debit"),   # bayar lebih -> biaya
])
def test_arah_adjustment(arah, baris, mutasi, tipe, sisi):
    t, s, j = bc._arah_adjustment(arah, D(baris), D(mutasi))
    assert (t, s) == (tipe, sisi)
    assert j == abs(D(mutasi) - D(baris))


# ---------------------------------------------------------------- _tambah_adjustment
def test_receipt_kurang_jurnal_seimbang(pakai):
    pakai()
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999900"), _adj(), "invoice")
    assert len(baris) == 2
    a = baris[1]
    assert a["is_adjustment"] and a["adjustment_type"] == "expense" and a["debit"] == D("100") and a["credit"] == 0
    assert a["account_code"] == "6-1001" and a["line_type"] == "account"
    assert _net("receipt", baris) == D("999900")   # = nominal kas -> Dr Bank 999.900 | Dr Adj 100 | Cr Piutang 1.000.000


def test_receipt_lebih_masuk_pendapatan(pakai):
    pakai()
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("1000050"), _adj("rounding"), "invoice")
    assert baris[1]["credit"] == D("50") and baris[1]["adjustment_type"] == "income" and baris[1]["account_code"] == "8-1001"
    assert _net("receipt", baris) == D("1000050")


def test_payment_dua_arah(pakai):
    pakai()
    kurang = bc._tambah_adjustment(None, "c1", "payment", [_inv(debit="500000")], D("500000"), D("499950"), _adj("discount"), "invoice")
    assert kurang[1]["credit"] == D("50") and _net("payment", kurang) == D("499950")
    lebih = bc._tambah_adjustment(None, "c1", "payment", [_inv(debit="500000")], D("500000"), D("500080"), _adj(), "invoice")
    assert lebih[1]["debit"] == D("80") and _net("payment", lebih) == D("500080")


def test_selisih_tepat_di_batas_diterima(pakai):
    pakai()
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999900"), _adj(), "invoice")
    assert baris[1]["debit"] == D("100")


def test_di_atas_batas_ditolak(pakai):
    pakai()
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999899.99"), _adj(), "invoice")
    assert e.value.kode == "ADJUSTMENT_LIMIT_EXCEEDED"
    assert e.value.data["limit"] == 100.0 and e.value.data["adjustable"] is False


def test_batas_per_match_bukan_per_invoice(pakai):
    # 3 invoice, total selisih 250 -> ditolak walau tiap invoice "hanya" ~83.
    pakai()
    baris = [_inv(credit="1000000"), _inv(credit="2000000"), _inv(credit="3000000")]
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", baris, D("6000000"), D("5999750"), _adj(), "invoice")
    assert e.value.kode == "ADJUSTMENT_LIMIT_EXCEEDED"


def test_tanpa_adjustment_tetap_allocation_mismatch(pakai):
    pakai()
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="444050")], D("444050"), D("444000"), None, "invoice")
    assert e.value.kode == "ALLOCATION_MISMATCH"
    assert e.value.data["adjustable"] is True and e.value.data["difference"] == 50.0
    assert "The lines total" in e.value.message


def test_selisih_di_atas_batas_tidak_adjustable_di_detail(pakai):
    pakai()
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("900000"), None, "invoice")
    assert e.value.data["adjustable"] is False


def test_selisih_kecil_di_bawah_050_diserap_jurnal_seimbang(pakai):
    pakai()
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999999.60"), None, "invoice")
    assert len(baris) == 2 and baris[1]["adjustment_category"] == "rounding" and baris[1]["debit"] == D("0.40")
    assert _net("receipt", baris) == D("999999.60")


def test_selisih_di_bawah_050_perilaku_lama_jika_akun_belum_diatur(pakai):
    pakai(expense=None, income=None)
    baris = [_inv(credit="1000000")]
    assert bc._tambah_adjustment(None, "c1", "receipt", baris, D("1000000"), D("999999.60"), None, "invoice") is baris


def test_selisih_di_bawah_050_perilaku_lama_jika_batas_nol(pakai):
    pakai(limit="0")
    baris = [_inv(credit="1000000")]
    assert bc._tambah_adjustment(None, "c1", "receipt", baris, D("1000000"), D("999999.60"), None, "invoice") is baris


def test_selisih_nol_tidak_menambah_baris(pakai):
    pakai()
    baris = [_inv(credit="1000000")]
    assert bc._tambah_adjustment(None, "c1", "receipt", baris, D("1000000"), D("1000000"), _adj(), "invoice") is baris


def test_akun_belum_diatur(pakai):
    pakai(expense=None)
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999950"), _adj(), "invoice")
    assert e.value.kode == "ADJUSTMENT_ACCOUNT_NOT_SET" and e.value.data["account_configured"] is False


def test_akun_override_dari_user(pakai):
    pakai(expense=None)   # default belum diatur, tapi user memilih akun sendiri
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999950"), _adj(coa_id=EXP.id), "invoice")
    assert baris[1]["account_code"] == "6-1001"


def test_fitur_dimatikan(pakai):
    pakai(enabled=False)
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999950"), _adj(), "invoice")
    assert e.value.kode == "ADJUSTMENT_DISABLED"


def test_bukan_invoice_ditolak(pakai):
    pakai()
    with pytest.raises(bc._Gagal) as e:
        bc._tambah_adjustment(None, "c1", "receipt", [], D("1000"), D("950"), _adj(), "non_invoice")
    assert e.value.kode == "ADJUSTMENT_NOT_ALLOWED"


def test_catatan_masuk_deskripsi(pakai):
    pakai()
    baris = bc._tambah_adjustment(None, "c1", "receipt", [_inv(credit="1000000")], D("1000000"), D("999950"), _adj(note="admin BCA"), "invoice")
    assert baris[1]["description"] == "Bank adjustment - Bank admin fee: admin BCA"


# ---------------------------------------------------------------- saran
def _kand(no, party, outstanding, tipe="sales"):
    o = D(outstanding)
    return {"type": tipe, "id": f"id-{no}", "no": no, "party": party, "date": "2026-11-01", "due_date": "2026-11-20",
            "total": float(o), "outstanding": float(o), "refs": [no], "outstanding_dec": o,
            "date_obj": date(2026, 11, 1), "due_obj": date(2026, 11, 20)}


def _mut(credit="0", debit="0", desc=""):
    return SimpleNamespace(id="m1", debit=D(debit), credit=D(credit), mutation_date=date(2026, 11, 10), description=desc)


def test_saran_selisih_kecil_bukan_auto_match(pakai):
    p = pakai()
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444050")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="444000", desc="TRF INV-0001 MAJU JAYA"), kand, adj=p)
    top = s["candidates"][0]
    assert top["kind"] == "single_adjust" and top["adjustable"] is True
    assert top["allocations"][0]["amount"] == 444050.0          # invoice dilunasi penuh
    assert top["adjustment"]["amount"] == 50.0 and top["adjustment"]["type"] == "expense" and top["adjustment"]["ready"]
    assert s["auto_match"] is False and s["adjustment_limit"] == 100.0


def test_saran_selisih_tidak_muncul_tanpa_pengaturan(pakai):
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444050")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="444000", desc="TRF INV-0001"), kand)   # adj=None (perilaku lama)
    assert all(c["kind"] != "single_adjust" for c in s["candidates"])


def test_saran_selisih_di_atas_batas_tidak_muncul(pakai):
    p = pakai()
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444500")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="444000", desc="TRF INV-0001"), kand, adj=p)
    assert all(c["kind"] != "single_adjust" for c in s["candidates"])


def test_saran_selisih_butuh_bukti(pakai):
    p = pakai()
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444050")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="444000", desc="SETORAN TUNAI"), kand, adj=p)
    assert s["candidates"] == []


def test_saran_lebih_bayar_pembelian(pakai):
    p = pakai()
    kand = {"sales": [], "purchase": [_kand("BILL-7", "CV Sumber Rejeki", "500000", tipe="purchase")]}
    s = bc._saran_mutasi(_mut(debit="500060", desc="PAY BILL-7 SUMBER REJEKI"), kand, adj=p)
    top = s["candidates"][0]
    assert top["adjustment"]["type"] == "expense" and top["adjustment"]["side"] == "debit" and top["adjustment"]["amount"] == 60.0


def test_saran_akun_belum_diatur_ditandai(pakai):
    p = pakai(expense=None)
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444050")], "purchase": []}
    top = bc._saran_mutasi(_mut(credit="444000", desc="INV-0001"), kand, adj=p)["candidates"][0]
    assert top["adjustment"]["ready"] is False and top["adjustment"]["needs"] == "ADJUSTMENT_ACCOUNT_NOT_SET"


def test_saran_tepat_tetap_auto_match(pakai):
    p = pakai()
    kand = {"sales": [_kand("INV-0001", "PT Maju Jaya", "444000")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="444000", desc="TRF INV-0001 MAJU JAYA"), kand, adj=p)
    assert s["candidates"][0]["kind"] == "single" and s["auto_match"] is True


def test_saran_kombo_selisih(pakai):
    p = pakai()
    kand = {"sales": [_kand("INV-1", "PT Maju Jaya", "300000"), _kand("INV-2", "PT Maju Jaya", "200050")], "purchase": []}
    s = bc._saran_mutasi(_mut(credit="500000", desc="MAJU JAYA"), kand, adj=p)
    kombo = [c for c in s["candidates"] if c["kind"] == "combo_adjust"]
    assert kombo and kombo[0]["adjustment"]["amount"] == 50.0 and len(kombo[0]["allocations"]) == 2


# ---------------------------------------------------------------- peringatan pola
def _r(tgl, party="PT A", amount=50, tipe="expense"):
    return {"tx_date": tgl, "party": party, "amount": amount, "type": tipe}


HARI_INI = date(2026, 11, 16)


def test_peringatan_kosong_jika_wajar():
    rows = [_r(date(2026, 11, 2), "PT A", 10), _r(date(2026, 10, 5), "PT B", 10), _r(date(2026, 9, 5), "PT C", 10)]
    assert bc._hitung_peringatan(rows, D("100"), HARI_INI, 50) == []


def test_peringatan_lonjakan_bulan_ini():
    rows = [_r(date(2026, 10, 5), amount=20), _r(date(2026, 9, 5), amount=20), _r(date(2026, 8, 5), amount=20)]
    rows += [_r(date(2026, 11, d), party=f"P{d}", amount=50) for d in (1, 2, 3)]
    kode = [a["code"] for a in bc._hitung_peringatan(rows, D("100"), HARI_INI, 50)]
    assert "MONTH_SPIKE" in kode


def test_peringatan_pihak_berulang():
    rows = [_r(date(2026, 10, d), "PT Langganan", 30) for d in (1, 10, 20)]
    a = [x for x in bc._hitung_peringatan(rows, D("100"), HARI_INI, 50) if x["code"] == "REPEAT_PARTY"]
    assert a and a[0]["data"]["party"] == "PT Langganan" and a[0]["data"]["count"] == 3


def test_peringatan_dekat_batas():
    rows = [_r(date(2026, 10, d), f"P{d}", 95) for d in range(1, 7)]
    kode = [a["code"] for a in bc._hitung_peringatan(rows, D("100"), HARI_INI, 100)]
    assert "NEAR_LIMIT_CLUSTER" in kode


def test_peringatan_frekuensi_tinggi():
    rows = [_r(date(2026, 10, d), f"P{d}", 10) for d in range(1, 6)]
    kode = [a["code"] for a in bc._hitung_peringatan(rows, D("100"), HARI_INI, 12)]
    assert "HIGH_FREQUENCY" in kode


def test_peringatan_data_lama_diabaikan():
    rows = [_r(date(2026, 5, d), "PT Lama", 30) for d in (1, 2, 3)]
    assert bc._hitung_peringatan(rows, D("100"), HARI_INI, 0) == []


# ---------------------------------------------------------------- total & export
def _row(tipe="expense", amount=50.0):
    return {"line_id": "l", "transaction_id": "t", "tx_number": "CR-2611-0001", "tx_date": date(2026, 11, 3), "direction": "receipt",
            "status": "posted", "source": "bank_feed", "bank_account": "1-1001 BCA", "party": "PT A", "invoices": ["INV-1", "INV-2"],
            "type": tipe, "category": "bank_fee", "category_label": "Bank admin fee", "amount": amount, "side": "debit",
            "account_code": "6-1001", "account_name": "Bank Charges", "note": "x", "mutation_description": None,
            "created_by": "A", "approved_by": "B", "posted_by": "C"}


def test_total_adjustment():
    t = bc._total_adjustment([_row("expense", 50), _row("expense", 25.5), _row("income", 10)])
    assert t == {"count": 3, "expense": 75.5, "income": 10.0, "net_effect": -65.5}


def test_export_xlsx_terbaca():
    import io
    from openpyxl import load_workbook
    rows = [_row("expense", 50), _row("income", 10)]
    wb = load_workbook(io.BytesIO(bc._bangun_xlsx_adjustment(rows, bc._total_adjustment(rows), "Judul")))
    ws = wb["Adjustments"]
    assert ws["A1"].value == "Judul" and ws["B4"].value == "CR-2611-0001" and ws["G4"].value == "INV-1, INV-2"
    assert ws["J4"].value == 50.0 and ws["K4"].value == "6-1001 Bank Charges"
    assert ws["J7"].value == 50.0 and ws["J8"].value == 10.0 and ws["J9"].value == -40.0
