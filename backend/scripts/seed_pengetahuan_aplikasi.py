from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
#!/usr/bin/env python3
"""
seed_pengetahuan_aplikasi.py
============================
Mengisi ulang PENGETAHUAN TENTANG APLIKASI milik Neo (asisten suara) dan Agent AI.

Kenapa perlu: Neo mode suara memakai prompt ringkas. Semua yang dia tahu soal halaman, tab, KPI dan
tabel aplikasi datang dari fakta GLOBAL di tabel ai_memory_facts (pemilik = "__global__"), lihat
memori_ai.pilih_global() dan blok_pengetahuan_aplikasi(). Fakta global itu hanya bisa diubah lewat
database, jadi kalau halaman aplikasi berubah dan fakta lamanya tidak diperbarui, Neo tetap
"mengingat" aplikasi versi lama.

Cara kerja skrip:
  * Fakta dengan penting=3 SELALU ikut ke prompt (maks 6 oleh MAKS_GLOBAL_SELALU) -> hanya 6 fakta inti.
  * Fakta lain (penting=2) dipilih lewat kecocokan kata kunci dengan pertanyaan (maks AI_GLOBAL_RELEVAN, bawaan 8).
    Karena itu tiap fakta memuat nama halaman dalam bahasa Indonesia DAN Inggris.
  * Tiap fakta mandiri (satu topik), maksimal 500 karakter (batas MAKS_PANJANG_FAKTA).

Pemakaian (jalankan dari folder backend/):
    python scripts/seed_pengetahuan_aplikasi.py                  # pratinjau saja, tidak menyentuh database
    python scripts/seed_pengetahuan_aplikasi.py --terapkan       # tulis ke database
    python scripts/seed_pengetahuan_aplikasi.py --terapkan --pertahankan-lama
                                                                 # tulis fakta baru, JANGAN nonaktifkan fakta global lama

Pada --terapkan (tanpa --pertahankan-lama) fakta global lama hanya DINONAKTIFKAN (aktif=False), tidak dihapus,
jadi bisa dihidupkan lagi. Menjalankan skrip ini dua kali aman: fakta hasil skrip ini diganti, bukan digandakan.

Setelah dijalankan: cache memori di server berumur 60 detik. Tunggu semenit atau restart backend.
Saran .env: AI_GLOBAL_RELEVAN=12 supaya pertanyaan yang menyangkut banyak tab bisa memuat lebih banyak fakta.
"""
import argparse
import sys
from pathlib import Path

SUMBER_SEED = "seed-app-2610"  # sama dengan versi sebelumnya: menjalankan ulang MENGGANTI fakta lama hasil skrip ini  # kolom sumber maks 20 karakter; dipakai untuk mengenali fakta hasil skrip ini
KATEGORI = "umum"
MAKS_PANJANG = 500

# (isi, penting)
FAKTA = []


def f(isi, penting=2):
    FAKTA.append((" ".join(isi.split()), penting))


# =====================================================================
# INTI (penting=3, selalu ikut ke prompt, maks 6)
# =====================================================================
f("Aplikasi ini bernama Gouf Consulting Accounting: dashboard akuntansi web (Next.js + FastAPI + database Supabase) untuk konsultan dan tim finance yang mengelola pembukuan banyak client sekaligus. Semua halaman menampilkan data client yang sedang aktif (dipilih di Switch Company) dan periode yang dipilih di Topbar. Asisten suaranya bernama Neo, tampil sebagai robot kecil yang bisa diseret.", 3)

f("Sidebar punya 6 grup. Overview: Overview (/), Agent AI, Memori AI. Financial: Financial Statements (Profit & Loss, Balance Sheet, Cash Flow, Statement of Changes in Equity, Notes to Financial Statements, Statement Mapping), Transactions (Sales, Purchase, Journal Entry, Cash & Bank, Other), Accounts Receivable, Accounts Payable. Assets & Equity: Fixed Assets, Inventory, Liabilities, Equity.", 3)

f("Lanjutan sidebar. Planning: Budget & Forecast, Tax Compliance, Financial Analytics. Intelligence: AI Financial Analyst, Audit. Management: Reports (termasuk General Ledger), Clients, Chart of Accounts (termasuk Opening Balances), Year-End Closing, Documents, Settings (Company, User Management, Purchase, Product, Account Mapping), Payroll. Halaman login terpisah dan tanpa sidebar.", 3)

f("Topbar global: Switch Company (cari nama atau kode client) mengganti client aktif untuk seluruh aplikasi, Period selector (preset dari Today sampai Last Year, plus Custom Range tanggal mulai dan akhir lalu Apply), menu pengguna dengan profil dan logout. Tampilan bisa dua bahasa (Indonesia dan Inggris), dan mata uang bisa dipilih di beberapa halaman.", 3)

f("Alur umum modul Transactions: Source Data (impor file) lalu Transaction (daftar dan edit) lalu Journal Preview (jurnal otomatis, diperiksa) lalu Exceptions (temuan yang perlu dibereskan) lalu Posted (final). Status berjalan dari Draft ke Ready for Approval atau Approved lalu Posted. Hanya jurnal Posted yang masuk ke General Ledger, laporan keuangan, AR/AP, pajak, dan analitik.", 3)

f("Kemampuan Neo: menjawab lewat suara dalam bahasa Indonesia atau Inggris, membuka halaman dan tab atas perintah suara (mis. buka laba rugi, pindah ke tab posted di sales), mengganti client aktif, membaca isi layar yang sedang terlihat, dan MEMBACA data asli (daftar klien, profil klien, cari akun, saldo akun, ringkasan keuangan, penjualan, pembelian, umur piutang, jurnal terakhir). Neo TIDAK bisa mengubah, menghapus, memposting, menyetujui, atau membayar apa pun lewat suara.", 3)

# =====================================================================
# OVERVIEW (/)
# =====================================================================
f("Halaman Overview (/), judul Financial Overview. Kontrol di kanan atas: dropdown cabang (All Branches atau per cabang), dropdown mata uang, tombol tampilan Actual, Budget, Previous Year, tombol Import (impor rekening koran), Export (CSV transaksi), dan tombol muat ulang. Menampilkan nama client aktif dan waktu data terakhir diperbarui.")

f("Overview punya 8 kartu KPI: Total Revenue (kartu besar), Net Profit, Gross Profit, Cash & Bank, Accounts Receivable, Accounts Payable, EBITDA, Tax Payable. Tiap kartu menampilkan nilai, persentase perubahan, dan sparkline; kartu bisa diklik menuju halaman terkait (Profit & Loss, Balance Sheet, Accounts Receivable, Accounts Payable, Tax Compliance). Mode Budget dan Previous Year membandingkan dengan anggaran atau tahun lalu.")

f("Di bawah KPI, Overview punya grafik Revenue vs Expenses vs Net Profit (bisa di-zoom dengan drag, klik dua kali untuk reset), grafik Actual vs Budget saat mode Budget, dan AR Aging Analysis berbentuk donat interaktif. Lalu tiga kartu pintas: Accounts Receivable (total dan jumlah overdue), Accounts Payable (total dan yang jatuh tempo minggu ini), dan AI Financial Analyst.")

# =====================================================================
# AGENT AI & MEMORI AI
# =====================================================================
f("Agent AI (/agent-ai): halaman chat dengan AI untuk tanya jawab akuntansi dan upload file (ikon klip, bisa banyak file sekaligus, Excel, PDF, gambar). Ada sidebar daftar obrolan, indikator proses bertahap, panel hasil terpadu, pengaturan pajak (NPWP perusahaan), Deteksi Kesalahan Pembelian, dan Checklist Pembelian. Hasil bisa diunduh sebagai Excel, CSV, JSON, atau PDF. Ini halaman yang berbeda dari AI Financial Analyst.")

f("Agent AI mengenali 15 jenis dokumen otomatis: Rekening Koran, Data Penjualan, Penilaian Klien/Maker, Buku Bantu Piutang, Faktur Pajak, Bukti Potong Pajak, SPT, Slip Gaji, Bukti Kas Masuk/Keluar, Kartu Stok, Daftar Aset Tetap, PO dan Invoice Pembelian, Rekonsiliasi Bank, Buku Bantu Utang, Absensi. Yang transaksional dijurnal lalu muncul di Transactions; Penilaian Klien, Kartu Stok, SPT, Rekonsiliasi Bank, Absensi tersimpan tanpa halaman viewer khusus.")

f("Memori AI (/memori-ai) punya dua tab. Ingatan: fakta yang dipelajari AI dari percakapan; bisa ditambah manual, diedit, dinonaktifkan, atau dihapus, dengan kategori (klien, preferensi, aturan, orang, umum, lainnya), tingkat penting 1 sampai 3, dan klien terkait. Percakapan: riwayat percakapan suara dan Agent AI, bisa dibuka atau dihapus. Pengetahuan tentang aplikasi (fakta global) ditampilkan hanya-baca.")

# =====================================================================
# FINANCIAL STATEMENTS
# =====================================================================
f("Financial Statements (/financial-statements) adalah halaman induk laporan keuangan dengan enam sub-halaman: Profit & Loss, Balance Sheet, Cash Flow, Statement of Changes in Equity, Notes to Financial Statements (CALK), dan Statement Mapping. Angka dihitung dari jurnal yang sudah Posted. Ada pemilih periode, banner pemeriksaan (cek keseimbangan), dan menu unduh PDF, CSV, atau Excel.")

f("Profit & Loss (/financial-statements/profit-loss): baris Revenue, Cost of Sales, Gross Profit, Operating Expenses, Operating Profit, Other Income/(Expense), Profit Before Tax, Income Tax Expense, Net Profit. Periode: Monthly, Quarterly, Year to date, Full year, Custom range. Pembanding: tanpa, periode sebelumnya, atau periode sama tahun lalu. Klik akun untuk membuka General Ledger.")

f("Profit & Loss punya beberapa tampilan: Default (tabel laporan), Trend (grafik laba rugi bulanan, Revenue Trend, Key Insights seperti kenaikan atau penurunan revenue terbesar dan laba bersih tertinggi), Comparison (vs kuartal sebelumnya atau kuartal sama tahun lalu, Variance Summary, Quarterly Profit & Loss Trend), dan tampilan Gross/Net (Income, Expenses & Profitability, Revenue Composition, Net Profit Trend).")

f("Balance Sheet (/financial-statements/balance-sheet) punya tampilan: Balance Sheet (Default) dengan posisi dibanding bulan lalu dan tahun lalu, Balance Sheet Trend (posisi bulanan sepanjang tahun), Balance Sheet Comparison (per kuartal tiap tahun buku), dan Assets vs Liabilities. Total utama: Total Assets, Total Liabilities, Total Equity. Ada insight seperti kenaikan aset terbesar.")

f("Cash Flow (/financial-statements/cash-flow) menampilkan laporan arus kas; Statement of Changes in Equity (/financial-statements/changes-in-equity) menampilkan pergerakan ekuitas; Notes to Financial Statements (/financial-statements/notes) adalah CALK. Ketiganya memakai pemilih periode dan menu unduh yang sama dengan laporan lain, dan sumbernya jurnal Posted serta pemetaan di Statement Mapping.")

f("Statement Mapping (/financial-statements/mapping) memetakan tiap akun COA ke laporan. Kolom: Account, Report section / line, Equity, Cash flow, CALK note, Source. Filter sumber: Client, Default, dan Unmapped (akun yang belum dipetakan). Pemetaan menentukan akun masuk ke baris mana di laba rugi, neraca, arus kas, perubahan ekuitas, dan catatan.")

# =====================================================================
# TRANSACTIONS: SALES
# =====================================================================
f("Transactions (/transactions) adalah induk lima modul: Sales, Purchase, Journal Entry, Cash & Bank, Other. Setiap modul punya tab Overview, Source Data (atau Cash Payment dan Cash Receipt di Cash & Bank), transaksi, Journal Preview, Exceptions, dan Posted. Pintasan dari Overview bisa membawa ke modul yang relevan.")

f("Sales (/transactions/sales) punya 6 tab: Overview, Source Data, Sales Transaction, Journal Preview, Exceptions (ada badge jumlah exception yang belum selesai), Posted. Tombol tambah membuka form invoice baru (/transactions/sales/invoice/new). Bisa dibuka langsung ke tab tertentu lewat parameter tab.")

f("Sales Overview: KPI Total Sales, Outstanding AR, Paid Invoices, Overdue Amount, Sales Tax Collected; grafik Monthly Sales Trend dan daftar Top Customers. Ada juga ringkasan per status posting.")

f("Sales Source Data: impor file penjualan (invoice, POS, kasir) dengan template impor. Kolom: Tanggal Transaksi, No. Invoice, Nama Customer, DPP (Sebelum Pajak), PPN (11%), Total Nilai. Pemeriksaan kualitas: format tanggal valid, no. invoice ditemukan, nama customer valid, nilai transaksi valid, duplikat data, baris tidak valid.")

f("Sales Transaction: tabel Invoice #, Date, Customer, Category, Subtotal, Discount, Tax, Total, Payment, Status. Status: Draft, Ready for Approval, Posted. Panel detail punya tab Detail, Pembayaran, Jurnal, Riwayat. Aksi per baris: lihat detail, edit invoice, aksi lainnya. KPI ringkas termasuk Outstanding AR.")

f("Sales Journal Preview: menampilkan Source Document, AI Extraction, Accounting Classification, Tax Treatment, Journal, lalu tombol Approve/Post. Akun yang dipakai: Piutang Usaha, Pendapatan, PPN Keluaran, dan PPh bila ada. Sales Exceptions: KPI Total Exceptions, High Risk, Missing Tax Info, Low Confidence, Duplicate Invoice.")

f("Sales Posted: KPI Total Posted, Nilai Terposting, Posted Hari Ini, Journal Synced, Fully Paid. Aksi: Lihat Jurnal, Buka di General Ledger, Export ke Excel, Rekonsiliasi AR, Cetak Daftar. Invoice yang sudah Posted menjadi piutang di halaman Accounts Receivable.")

# =====================================================================
# TRANSACTIONS: PURCHASE
# =====================================================================
f("Purchase (/transactions/purchase) punya 6 tab, tiap tab adalah rute sendiri: Overview, Source Data, Purchase Transaction, Purchase Preview, Exceptions, Posted. Tombol Create Bill membuka form bill baru (/transactions/purchase/bills/new). Bill yang Posted menjadi utang di halaman Accounts Payable.")

f("Purchase Overview: KPI Total Purchases, Outstanding AP, Pending Review, Posted, Exceptions, Input Tax (VAT), Overdue Amount. Grafik Purchase Volume Trend (mingguan, bulanan, 6 bulan, tahunan), Purchase Status, Purchase by Category, Payment Status Overview, Top Vendors by Spend; juga Recent Purchase Activity dan Exception Summary.")

f("Purchase Source Data: impor file pembelian. Kolom: Tanggal Transaksi, No. Invoice Vendor, Nama Vendor, No. PO, DPP (Sebelum Pajak), PPN (11%), Total Nilai. Pemeriksaan: format tanggal, no. transaksi ditemukan, nama vendor valid, cabang (dept.) ditemukan, nilai valid, duplikat data, baris tidak valid.")

f("Purchase Posted: KPI Posted Purchases, Total Posted Amount, Total Input Tax, Total AP Generated, Accounting Periods. Kolom: Purchase ID, Posting Date, Purchase Date, Invoice No., Vendor, Category, Subtotal, Tax, Total, Payment, Period, Posted By, Approved By. Detail: PO Number, Source Type, Payment Terms, Posted Timestamp, dan baris item (Description, Qty, Unit Price, Tax, Total, GL Account).")

# =====================================================================
# TRANSACTIONS: JOURNAL ENTRY
# =====================================================================
f("Journal Entry (/transactions/journal-entry) untuk jurnal umum. Tab: Overview, Source Data, JE Transaction, Journal Preview, Exceptions, Posted (tab punya badge hitungan). Overview punya KPI grid, grafik Entry Trend, Status Distribution, Exception Breakdown, tabel sumber, dan Activity Feed. Status jurnal: Draft, Pending, Approved, Posted, plus Exceptions.")

f("Journal Entry Source Data: KPI Total Files Uploaded, Awaiting Processing, Processed Successfully, Needs Review. Kolom: Upload Date, Source File, Type, Entity, Period, Entries, Extraction, Mapping, Confidence, Processed By. Detail file: File Preview, AI Extraction Summary, Data Quality Check (format tanggal, no. JE ditemukan, minimal 2 baris per entri, debit sama dengan kredit, duplikat no. JE, entri tidak valid). Ada modal Import Journal.")

f("JE Transaction (General Journal): kolom JE Number, Date, Description, Source, Debit, Credit, Status, Created By, Posting Date, Currency, Reviewed By, Approved By, Posted At. Aksi massal: Approve, Post (ke general ledger), Reopen (kembali draft), Reject, Delete, serta Print All. Tombol New Journal Entry membuka modal dengan baris Account Code, Account Name, Description, Cost Center, Debit, Credit.")

# =====================================================================
# TRANSACTIONS: CASH & BANK
# =====================================================================
f("Cash & Bank (/transactions/bank-cash) punya 8 tab: Overview, Cash Payment, Cash Receipt, Source Data, Reconciliation, Journal Preview, Exceptions, Posted. Tab Source Data adalah pengganti Bank Feed lama: rekening koran diimpor dan disimpan permanen. Ada tombol Transaksi Baru untuk input manual kas atau bank tanpa rekening koran.")

f("Alur Cash & Bank: Sales atau Purchase yang Posted muncul di Cash Receipt atau Cash Payment, rekening koran diimpor di Source Data, lalu Reconciliation mencocokkan baris bank ke invoice atau bill (atau akun lain untuk mutasi non-invoice), kemudian jurnal muncul di Journal Preview untuk Approve lalu Post, dan hasilnya di Posted.")

f("Cash & Bank Overview: ringkasan arus kas, Pipeline (tahapan proses), Net Cash Flow, Unreconciled (belum direkonsiliasi), grafik Monthly Cash Flow, dan Balance per Account (saldo tiap rekening kas atau bank, status rekonsiliasi).")

f("Cash Payment: daftar bill Purchase yang sudah Posted beserta status pembayarannya. KPI Total Paid, Unpaid (Payables), Number of Bills, Average / Bill, Overdue. Grafik Monthly Cash Payment Trend, Payment by Category, Top Vendor. Kolom Date, Purchase No., Vendor, Description, Category, Due Date, Total, Paid, Outstanding, Status, Bank Line, Journal.")

f("Cash Receipt: daftar invoice Sales yang sudah Posted beserta status penerimaannya. KPI Total Received, Unreceived (Receivables), Number of Invoices, Average / Invoice, Overdue. Grafik Monthly Cash Receipt Trend, Receipt by Type, Top Customer. Kolom Date, Invoice No., Customer, Description, Type, Due Date, Total, Received, Outstanding, Status, Bank Line, Journal.")

f("Cash & Bank Source Data: bagian Import Bank Statement, daftar Bank Statement Files, dan Source Data Lines (baris bank; bisa Ignore, Restore to Unmatched, Delete line). Review bank statement membandingkan angka On statement dengan Extracted untuk pengecekan. Ada Extraction Templates (rename atau hapus template ekstraksi per format bank) dan Bank Mapping (pemetaan rekening bank ke akun).")

f("Cash & Bank Reconciliation: tabel per akun (Account, Bank, Books, Difference, Unmatched), daftar Source Data yang Unmatched, daftar Posted Invoices untuk Cash Payment dan Cash Receipt, dan Reconciled History. Baris bank dicocokkan ke invoice, atau untuk mutasi tanpa invoice (biaya admin, bunga, transfer antar bank) memakai form non-invoice dengan akun lawan.")

f("Cash & Bank Journal Preview: daftar Awaiting Approve / Post dengan Transaction Information (tanggal, akun kas atau bank, pihak, deskripsi, referensi, baris Source Data, waktu dibuat dan disetujui) dan tabel jurnal (Type, Invoice / Account, Description, Amount). Exceptions: KPI Total Exceptions, High Risk, Matching Issues, Needs Classification, Low Confidence.")

f("Cash & Bank Posted: KPI Posted Journals, Total Cash In, Total Cash Out, Net Cash Flow. Kolom Journal No., Journal Date, Direction, Counterparty, Linked Invoice, Cash/Bank Account, Amount, Posted By, Posted At, Detail. Detail memuat baris jurnal (Account, Debit, Credit) dan info baris bank. Ada aksi Reverse Journal untuk membalik jurnal.")

# =====================================================================
# TRANSACTIONS: OTHER
# =====================================================================
f("Other (/transactions/other, menu Transactions > Other, Other Transactions) untuk kejadian bisnis khusus di luar Sales, Purchase, dan Cash & Bank. Satu workspace dengan 6 tab berbasis ?tab=: Overview, Categories, Review Queue, Journal Preview, Exceptions, Posted. Tombol: Create Transaction, Transaction Templates, Import, Export. Status: Draft, Pending Review, Approved, Rejected, Posted, Reversed.")

f("Other Overview: Quick Create by Transaction Type (kartu template), Transaction Pipeline (dari kejadian bisnis ke jurnal otomatis), KPI Total Transactions, Under Review, Ready to Post, Posted, Exceptions. Grafik Other Transactions by Month (jumlah dan nilai), daftar Recent Other Transactions, Rule Mapping Summary (Active Rules, Transaction Templates, Auto-Post Enabled, Requires Approval), Top Categories, dan Pending Review.")

f("Tujuh jenis transaksi Other: Employee Advance (uang muka karyawan), Security Deposit (deposit dibayar atau diterima), Loan & Financing (pinjaman, pokok, bunga), Capital & Owner Withdrawal (modal dan penarikan pemilik), Intercompany (antar entitas, Due To dan Due From), Refund & Reimbursement (refund customer dan vendor, reimbursement), Other Approved Events. Tab Categories: kartu per jenis (jumlah total dan posted) plus tabel yang bisa difilter jenis, status, dan pencarian.")

f("Alur Other: Save Draft, Submit for Review, lalu di tab Review Queue (Waiting for Review) transaksi di-Approve atau di-Reject dengan alasan; yang disetujui masuk Approved - Ready to Post. Approve butuh peran Supervisor ke atas; Post ke General Ledger dan Reverse (jurnal pembalik RV-) butuh Manager ke atas; template auto-post langsung posted untuk Manager ke atas. Neo hanya menjelaskan, tidak bisa menjalankan aksi ini.")

f("Other Journal Preview: transaksi yang belum posted, dikelompokkan Blocking errors (tidak bisa disubmit, disetujui, atau diposting sampai diperbaiki) dan Warnings only (boleh diposting tapi perlu ditinjau). Other Exceptions: temuan seperti akun belum diisi, periode tertutup, akun nonaktif atau belum dipetakan, dan review yang terlambat. Other Posted: KPI Posted Transactions, Posted Value, Posted This Month, Reversed (jurnal pembalik RV- terposting); sumber di General Ledger adalah Other.")

f("Form Other (/transactions/other/create): Transaction Information, Journal Preview, Supporting Document, Review & Submit. Field khusus: Loan (Loan Agreement No., Interest Rate per tahun, Loan Term bulan, Maturity Date), Security Deposit (Deposit Type: Rent, Utility, Lease, Tender/Bid Bond, Customs, Other), Employee Advance (Employee ID, Purpose, Settlement Due Date).")

f("Other Transaction Templates: tiap template punya Journal Rules per subjenis dengan akun bawaan (main, bank, offset, extra); ada peringatan bila aturan belum punya akun bawaan. Import Other Transactions menerima CSV atau Excel, satu baris per transaksi, disimpan sebagai draft. Tampilan lama berbasis jurnal masih ada di rute /transactions/other/source-data, /transaction, /preview, /exceptions, /posted, dan /legacy-overview.")


# =====================================================================
# AR & AP
# =====================================================================
f("Accounts Receivable (/accounts-receivable) punya 6 tab: Overview, Invoices, Aging, Collections, Customer Statements, Posted. Tombol: Create Invoice, Record Receipt, dan menu Export (Aging Report PDF/cetak, Aging Report Excel, Invoices Excel, Invoices CSV). Ada pemilih tanggal As of dan tombol muat ulang. Sumber data adalah invoice Sales yang Posted.")

f("KPI Accounts Receivable: Total Receivables, Overdue Invoices, Collected This Month (di tab Invoices diganti Open Invoices Not Yet Due), Avg. Days to Collect, Customers with Balance, masing-masing dibanding bulan lalu. Di tab Collections KPI-nya: Total Receivables, Collected This Month, Promise to Pay, High Priority Accounts. Bucket aging: Current, 1-30, 31-60, 61-90 hari, dan lebih.")

f("Tab Accounts Receivable: Overview (ringkasan dan tren dengan pilihan bulan), Invoices (daftar invoice dan filter customer), Aging (umur piutang per bucket dan per customer), Collections (performa penagihan bulanan, antrean follow-up, janji bayar), Customer Statements (rekening koran per customer), Posted (penerimaan yang sudah diposting). Form Record Receipt di /accounts-receivable/receipts/new, form invoice di /accounts-receivable/invoices/new.")

f("Accounts Payable (/accounts-payable) strukturnya sama dengan AR: 6 tab Overview, Bills, Aging, Payments, Vendor Statements, Posted. Tombol Create Bill (membuka form bill di Purchase), Record Payment (/accounts-payable/payments/new), dan Export. KPI: Total Payables, Overdue Bills, Paid This Month, Avg. Days to Pay, Vendors with Balance. Sumber data adalah bill Purchase yang Posted.")

# =====================================================================
# ASSETS & EQUITY
# =====================================================================
f("Fixed Assets (/assets) punya 6 tab: Overview, Asset Register, Depreciation, Disposal, Reports, Posted. Overview: KPI Total Fixed Assets, Accumulated Depreciation, Net Book Value, Additions This Year, grafik Net Book Value Trend, Assets by Category, dan Assets Near End of Useful Life (sisa umur 24 bulan atau kurang). Ada tombol Post Acquisition Journal, Asset Adjustment, dan Categories.")

f("Fixed Assets Register, Depreciation, Disposal: Asset Register menampilkan daftar aset (Total Assets, Active Assets, Under Construction). Depreciation: KPI Current Month Depreciation, YTD Depreciation, Pending Depreciation Batches, Posted Depreciation Entries; grafik Monthly Depreciation Trend; Depreciation Schedule; tombol Run Depreciation. Disposal: KPI Pending Disposals, Disposed This Year, Disposal Proceeds, Gain / Loss on Disposal, plus Disposal by Reason.")

f("Fixed Assets Reports dan Posted: Reports berisi Fixed Assets Reports, Net Book Value by Category, Recent Generated Reports, dan KPI Assets by Category, Net Book Value, Monthly Depreciation, Disposals in Period. Posted: KPI Posted Entries, Posted This Month, Total Posted Depreciation, Total Posted Disposals.")

f("Inventory (/inventory) punya 6 tab: Overview, Item List, Stock Movement, Adjustments, Transfer, Reports. Overview: KPI Total Items, Total Stock Value, Low Stock Items, Out of Stock; grafik Inventory Value Trend, Inventory by Category, Top 5 Items by Value, dan daftar Low Stock & Out of Stock. Ada Inventory Setup (gudang dan kategori item) dan Import Items.")

f("Liabilities (/liabilities): filter Branch, Currency, Liability Type, Status, Due Date. KPI Total Liabilities, Current Liabilities, Non-Current Liabilities, Accounts Payable, Tax Payable, Short-Term Debt, Long-Term Debt, Total Debt. Ada Liability Composition (per kategori), jadwal jatuh tempo, analisis utang (Debt-to-Equity, Interest Coverage, Interest Expense), insight AI, dan tabel Liability Transactions dengan tautan ke jurnal.")

f("Equity (/equity): filter Branch dan Currency. KPI Total Equity, Paid-in Capital, Retained Earnings, Current Year Profit, Other Equity, Equity Growth. Ada klasifikasi ekuitas, grafik tren ekuitas, grafik pergerakan (Beginning/Ending, Increase, Decrease, Adjustment), Retained Earnings Analysis, insight AI, dan tabel Equity Transactions dengan tautan ke jurnal.")

# =====================================================================
# PLANNING
# =====================================================================
f("Budget & Forecast (/budget-forecast): ada Planning Status, KPI Budget Achievement, Forecast vs Budget, Actual Revenue, Forecast Revenue, Forecast Confidence, Expected Collections, CapEx Budget. Grafik Financial Performance: Budget vs Actual vs Forecast dengan Confidence Range. Variance Analysis berbentuk waterfall (Budgeted EBITDA lalu Revenue Variance, COGS Variance, OpEx Variance sampai Actual EBITDA) dan Budget Allocation.")

f("Budget & Forecast bagian bawah: tabel Monthly Budget Performance (Month, Revenue, COGS, OpEx, EBITDA, Net Profit, masing-masing Budget dan Actual serta Variance). Forecast Assumptions: Revenue Growth, COGS %, Payroll Growth, OpEx Growth, Collection Rate, Tax Rate, CapEx, Interest Expense. Scenario Planning membandingkan skenario Optimistic dan Conservative (Revenue, EBITDA, Net Profit, Ending Cash). Forecast Risks: Revenue Risk, Cash Flow Risk, AR Collection Risk, plus AI Planning Insights.")

f("Tax Compliance (/tax-compliance) punya 8 tab: Overview, Tax Ledger, PPh, VAT, Payments, Reconciliation, Exceptions, Reports. Ada Tax Settings (drawer). Overview: KPI Total Tax Base (DPP), Total PPh Payable, VAT Output, VAT Input, Tax Paid, Unreported Returns, Exceptions; tabel Tax Summary by Type (DPP, Rate, Paid, Reported, Status); grafik Monthly Tax Trend; Payment & Filing Status; Potential Tax Exposure.")

f("Tax Compliance tab rinci. Tax Ledger: Total Tax Records, Total DPP, Total Tax Amount, Unpaid Tax, Unreported Tax, Tax Lifecycle Status, Recent Tax Journal Links. PPh: Total DPP, Paid This Period, Reported, Needs Review, PPh Breakdown by Article, Withholding Gaps. VAT: Output VAT, Input VAT, Net VAT Position, e-Faktur Matched, Unmatched VAT, Draft Returns, VAT Ledger vs General Ledger.")

f("Tax Compliance tab rinci lanjutan. Payments: Total Tax Due, Total Paid, Overdue Tax, Upcoming Due, Payment Success Rate, Unallocated Payments, Upcoming Deadlines, Tax Returns (SPT), tombol Record Tax Payment (SSP / e-Billing). Reconciliation: Tax Ledger vs General Ledger (Reconciled, Unreconciled Amount, Matched Tax Items, Difference Count, Recommended Fixes). Exceptions: Total Exceptions, High Risk, Medium Risk, Overdue Review, Resolved This Month. Reports: pratinjau laporan pajak.")

f("Financial Analytics (/financial-analytics): header, Financial Health (radar Liquidity, Solvency, Efficiency), KPI Gross Margin, EBITDA Margin, Net Margin, Current Ratio, Quick Ratio, Debt-to-Equity, Return on Equity, Financial Trend Explorer, Financial Performance Matrix (Metric, Current, Budget Variance), Financial Anomalies, dan AI Financial Insights. Tab yang bisa dibuka lewat suara: solvency, efficiency, customer, product, category.")

f("Financial Analytics analisis rinci: Profitability (margin vs Internal Target), Growth (Revenue, Gross Profit, EBITDA, Net Profit, Asset, Equity), Liquidity (Current, Quick, Cash Ratio, Working Capital, Cash Runway), Solvency (Debt-to-Equity, Debt Ratio, Interest Coverage), Efficiency (Asset Turnover, DSO, DPO, Cash Conversion Cycle), Revenue Drivers, Expense Drivers, Customer Financial Analysis (Outstanding AR, Collection Rate, Contribution %).")

# =====================================================================
# INTELLIGENCE
# =====================================================================
f("AI Financial Analyst (/ai-financial-analyst): analisis terstruktur berbasis AI yang disimpan sebagai percakapan dan laporan, berbeda dari Agent AI. Ada sidebar percakapan (Rename, Duplicate, Archive, Delete), tombol New Financial Analysis (pilih Company, Period, Branch, Currency), panel konteks (Liquidity, Profitability, Cash Flow, Solvency, Working Capital, Last Updated), dan pertanyaan cepat seperti Why did profit change, Which customers have the highest credit risk, Forecast the next quarter.")

f("Enam jenis analisis di AI Financial Analyst: Penurunan Laba / net profit decrease (Executive Summary, Monthly P&L Trend, Performance Drivers), Risiko Piutang / AR risk, Risiko Utang / AP risk (Total AP, Overdue AP, 90+ Days, DPO, On-Time Payment Rate, Vendor Concentration), Arus Kas / cash flow, Perbandingan Kuartal (Q1 vs Q2), dan Anomali Biaya / expense anomaly. Hasil punya AI Recommendations dan tombol Analyze Further, View Transactions, View AR Aging, View AP Aging, View Report.")

f("Audit (/audit) adalah Audit Center: jejak audit seluruh jurnal termasuk draft. Isi: Audit Progress, KPI Audit Completion, Open Findings, High Risk, Pending Evidence, Adjustments, Controls Tested, Risk Matrix, Audit Findings (aksi Review, Add Evidence, Resolve, Escalate), Audit Activity Timeline, Audit Trail, dan form New Audit Finding. Filter tab: All, Open, High Risk, Resolved.")

# =====================================================================
# MANAGEMENT
# =====================================================================
f("Reports (/reports) adalah katalog laporan dengan 9 tab: Business Overview, Sales, Purchases, Inventory, Fixed Assets, Banking, Tax, Production, Scheduled Reports. Contoh laporan: Balance Sheet, Profit & Loss, Cash Flow Statement, General Ledger, Journal Report, Trial Balance, Sales Register, Receivables Aging, Payables Aging, Stock Summary, Fixed Asset Register, Bank Reconciliation, VAT Report, Withholding Tax. Beberapa laporan bertanda belum tersedia.")

f("Reports: Create Report punya opsi Include Charts, Include Notes, Comparative Period, Preview, Export PDF, Export Excel, Duplicate, Schedule. Periode cepat: This Month, Last Month, This Quarter, Last Quarter, This Year, Last Year, Custom. Scheduled Reports bisa ditambah, dijeda, dilanjutkan, dikirim sekarang, atau dihapus. General Ledger (/reports/general-ledger): kolom Date, Source, Ref No., Description, Debit, Credit, Balance; filter akun (semua, terpilih, yang punya transaksi).")

f("Clients (/clients) menampilkan kesehatan keuangan semua client. KPI Total Clients, Healthy, Stable, Needs Attention, Critical, Avg Health Score, plus Portfolio Health Distribution dan Attention Required. Tampilan Portfolio atau Table (kolom Company, Industry, Status, Tax Status, Health, Accountant). Detail client punya tab Overview, Financial, Health Score, Activity, AI Insights (Liquidity, Profitability, Cash Flow, Solvency, Compliance).")

f("Chart of Accounts (/coa): daftar akun per client (kolom Account, Classification, Normal, Balance, Status) dan tampilan Belum Ditetapkan / Unassigned (pool akun tanpa client). Form akun baru atau edit (/coa/new, /coa/[id]/edit) berisi identitas akun, klasifikasi dan saldo normal, hirarki, standard mapping ke lapisan IFRS, dan catatan.")

f("Opening Balances (/coa/opening-balances): daftar saldo awal per tahun buku, form baru, editor dengan kolom Debit dan Credit. Ada monitor impor dengan modul Import Legacy COA + Non-Subledger Opening Balances, Import Opening AR, Import Opening AP, Import Opening Stock Inventory, Import Asset Register. Status batch: Not Started, Has Errors, Ready, Pending Approval, Imported, Rejected, Cancelled; alur Uploaded, Submitted, Approved.")

f("Year-End Closing (/year-end-closing): Daftar Tahun Buku (Klien, Fiscal Year, Start Date, End Date, Status Open/Closed/Re-opened, Closed By, Closed At, Re-opened By, Actions). Detail tahun yang sudah ditutup memuat Closing Snapshot, Closing Journal, dan Audit Trail. Ada Pre-Closing Checklist per tahun fiskal dan aksi Re-open.")

f("Documents (/documents): workspace dokumen keuangan dengan folder All Documents, Invoices, Receipts, Bank Statements, Tax Documents, Contracts, Audit Evidence, Financial Reports, Other. KPI Total Documents, Processed, Pending Review, Needs Attention. Aksi: Preview, Download, Duplicate, Move, Link Record, Add Tag, Delete, ubah status; ada tanda AI flags.")

f("Settings (/settings) punya lima bagian: Company (profil perusahaan, legal dan pajak NPWP/NIB/status PPN, kontak PIC, alamat, awal tahun buku, mata uang, akuntan penanggung jawab, logo), User Management (User, Role, Status, Type; role client, internal staff, super admin), Purchase (term pembayaran, fitur pembelian), Product (kategori dan satuan produk, variant, info stok), dan Account Mapping (akun bawaan untuk jurnal otomatis, bisa dikunci).")

f("Payroll (/payroll) punya 5 tab: Overview, Employees, Payroll Run, Tax & BPJS, Settings. Overview: Karyawan Aktif, Gaji Bruto, Take Home Pay, Kewajiban Pajak & BPJS, Perlu Perhatian, Kalender Kepatuhan (setor PPh 21, iuran BPJS, lapor SPT Masa). Payroll Run berstatus Draft, Disetujui, Dibayar, dengan slip gaji, pratinjau jurnal penggajian, dan riwayat status. Tax & BPJS: PPh Pasal 21, BPJS, rekap tahunan 1721-A1. Settings: tarif BPJS, PPh 21, akun jurnal.")

f("Login (/login) adalah halaman masuk layar penuh tanpa sidebar dan topbar. Neo baru menyapa dan memperkenalkan diri sekali setelah pengguna masuk. Hak akses client mengikuti role pengguna: super admin dan level tertinggi melihat semua client, role lain hanya client yang diberi akses.")


# =====================================================================
# TAMBAHAN: DETAIL YANG SEBELUMNYA BELUM TERCAKUP (diverifikasi dari kode)
# =====================================================================
f("Financial Statements opsi perbandingan: dropdown Compare with berisi No comparison, Previous period, Same period last year, Custom period (Compare start dan Compare end). Cash Flow bisa Direct Method atau Indirect Method (Operating, Investing, Financing, Net Profit for the Period). Ada tombol Open in General Ledger dan ekspor Excel (XLSX).")

f("Balance Sheet tampilan tambahan: Quarterly Balance Sheet Trend, Assets Composition, Total Assets Trend, Other Assets, Total Liabilities & Equity, dan pembanding Previous month end, Previous year end, Same date last year (vs Previous Year End).")

f("Profit & Loss Trend memuat Key Insights: Average Monthly Revenue, Average Gross Profit, Average Operating Profit, Best Month (Net Profit), Largest Revenue Increase, Largest Revenue Decrease, Highest Revenue, Highest Net Profit. Balance Sheet Trend memuat Average Total Assets, Average Total Liabilities, Average Equity, Highest Month (Total Assets), Largest Assets Increase, Largest Assets Decrease, Highest dan Lowest Total Assets.")

f("Statement Mapping detail: kolom Report line, Equity component, Cash flow category, Cash flow line. Perubahan pemetaan wajib mengisi Reason yang tersimpan di audit trail. Ada pembuatan catatan baru (New note title, Note key untuk memetakan akun ke catatan CALK).")

f("Payroll tab Employees (Data Karyawan): NIP, Nama, Jabatan, Departemen, Tanggal bergabung, Status kerja, NPWP / NIK, Status PTKP, Tunjangan tetap, Tunjangan tidak tetap (transport dan makan), No. rekening; tombol Tambah karyawan. Payroll Run: Payroll Run Baru (semua karyawan aktif otomatis dimasukkan) dan Cetak slip gaji. Tab Tax & BPJS: Setor PPh Pasal 21, Iuran BPJS Kesehatan dan Ketenagakerjaan, Lapor SPT Masa PPh 21/26, Rekap Tahunan (1721-A1).")

f("Payroll tab Settings: BPJS Ketenagakerjaan (JHT, JP karyawan dan perusahaan, JKK, JKM, batas upah JP), BPJS Kesehatan (batas upah), Biaya jabatan (maksimal per bulan), Perusahaan & Pembayaran (nama di slip gaji), dan pemetaan akun jurnal: Beban gaji & tunjangan, Beban BPJS (porsi perusahaan), Hutang gaji, Hutang PPh 21, Hutang BPJS, Piutang karyawan. Payroll run menampilkan Total biaya perusahaan.")

f("Settings > Company (profil perusahaan): Company name, Client code, Legal entity type, Business classification (KLU); Legal & tax (Deed / NIB number, VAT status); Contact & PIC (PIC name, PIC position, Email, Office phone, Mobile / WhatsApp); Address (Street address, City, Province, Postal code); Accounting & engagement (Fiscal year starts, Default currency, Responsible accountant, Engagement start). Logo bisa diganti (Change logo) atau dihapus (Remove logo).")

f("Settings > Product dan Purchase: Product category, Product unit, Product variant, dan Stock info on sales & purchases. Purchase: Activate supplier in Purchase Request, Shipping, Discount per lines. User Management menampilkan Client role dan mengenali Unknown role. Halaman settings punya tombol Refresh, pencarian dengan Clear search, dan indikator Unsaved untuk perubahan yang belum disimpan.")

f("Fixed Assets form Register a new fixed asset: Asset Code, Asset Name, Acquisition Date, Acquisition Cost (IDR), Residual / Salvage Value, Depreciation Method, Useful Life (months), Depreciation Start, Opening Accumulated Depreciation, Department, Custodian, Serial Number, Supplier. Kolom register: Remaining (Months), Opening dan Closing Cost, Opening dan Closing Accum., Accum. Disposed, Group By.")

f("Fixed Assets Depreciation dan Disposal: Depreciation Schedule / Batch List dengan status Ready to Run, Batch Created, Nothing to Run, serta Assets Pending Depreciation Review. Disposal form: Disposal Date, Method, Sale Proceeds (IDR), Buyer / Recipient, Proceeds Account, Gain / Loss on Disposal Account, Reason / Notes, dan Disposal No. Tab Posted: Posted Fixed Asset Journals; status Posted, Unposted, Reversed.")

f("Inventory Item List dan form item: Item Code, Item Name, Barcode, Default Warehouse, Minimum Stock, Reorder Quantity, Purchase Price (IDR), Sale Price (IDR), Inventory Account, COGS Account, Adjustment Account. Kolom daftar: Current Stock, Avg. Cost, Min. Stock. Peringatan stok: Minimum dan Suggested Order. Setup memuat Warehouses and item categories dengan alamat gudang.")

f("Inventory Stock Movement dan laporan: kolom Opening Qty, Closing Qty, Value In, Value Out, Balance Qty, Balance Value, Unit Cost, Warehouse, Reference, Avg. Cost (Rp), Closing Value (Rp). Tab Transfer punya To Warehouse; Adjustments punya Credit Account dan Debit Account Override (opsional). Reports: Inventory Valuation dan Month-end stock value and quantity.")

f("Tax Compliance kolom Tax Ledger: Tax Type, Document No., Party Type, Party NPWP / NIK, Tax Object Code, Tax Object, DPP (Tax Base), Rate (%), e-Faktur / e-Bupot No., Tax Document Date, GL Account (opsional), Source Module, Reporting Status (Filed, Partially Filed, Not Filed, Not Required), Paid / Credited. Tab VAT memuat Output DPP dan Input DPP per Tax Period.")

f("Tax Compliance Payments, Reconciliation, Exceptions, Reports: Payments punya Payment No., Payment Date, Billing Code, NTPN. Reconciliation membandingkan Tax Ledger Amount, GL Amount, Payment Amount dengan Difference Analysis dan Last Reconciliation Date. Exceptions: Issue ID, Severity, Age (days). Reports: Filed Date, Receipt (BPE), Timeliness. Estimated from the standard rate menandai nilai pajak hasil perkiraan tarif standar.")

f("Budget & Forecast kartu dan skenario: Revenue Budget, COGS Budget, Gross Profit Budget, OpEx Budget, EBITDA Budget, Net Profit Budget, Revenue Full-Year Forecast, Total Budget Variance. Ada Cash Position Update, kolom CapEx (Rp M), pengaturan skenario yang bisa dibuat dan dihapus (Hapus skenario), dan indikator confidence rendah pada forecast.")

f("Equity detail: Retained Earnings roll-forward berisi Beginning Retained Earnings, Net Profit (period movement), Dividends Paid, Prior Year Adjustments, Ending Retained Earnings; juga Current Year Profit (YTD), Net Profit (YTD movement), Other Equity Movements. Insight: Dividend Payout Impact dan Stable Capital Base. Aksi per baris: View journal entry.")

f("Liabilities detail: daftar Obligations dengan View details dan View journal entry. Insight otomatis: Overdue Obligation Detected, Upcoming Obligations Due Soon, Outstanding Tax Payable, Payables Concentration. Bila kosong tampil No outstanding obligations atau No liability transactions yet.")

f("Year-End Closing KPI: Open Fiscal Years, Closed Fiscal Years, Re-opened Cases, Pending Pre-Closing Checks, dan Net Profit Closed to Retained Earnings. Chart of Accounts tambahan: Total accounts, Inactive, Unassigned pool, Hierarchy (pengelompokan untuk subtotal laporan), Accum. dep., dan Locked (akun terkunci pada set saldo awal dengan cut-off bulan tertentu); Import history & approval untuk saldo awal.")

f("Reports katalog laporan: Sales by Customer, Purchase Register, Purchases by Vendor, Inventory Valuation, Cash & Bank Summary, Posted Cash & Bank, Production Summary, Production Cost, Laporan Keuangan Lengkap (5 Laporan), Catatan Atas Laporan Keuangan (CALK), Perhitungan PPh Badan (Pasal 31E). Laporan yang belum tersedia menampilkan This report is not available yet.")

f("Reports pilihan dan jadwal: pilihan akun All accounts, Accounts with transactions, Accounts with balance or transactions, Selected accounts; total Total Debit dan Total Credit. Scheduled Reports punya aksi Pause schedule, Resume schedule, Send now, Delete schedule.")

f("Financial Analytics rasio dan growth: Gross Profit Growth, EBITDA Growth, Net Profit Growth, Asset Growth, Cash Conv. Cycle (cash conversion cycle), D/E Ratio (debt to equity), DSO (days) umur piutang, DPO (days) umur utang. Documents: kolom Related Record, Uploaded By, File Size, status dokumen bisa diubah, dan penanda AI flags detected.")

f("Agent AI deteksi kesalahan pembelian (Checklist Pembelian): Deteksi PPh 23 atas jasa, Deteksi harga tidak wajar (riwayat), Deteksi supplier baru, Validasi tanggal, Rekap per Supplier, dan Cross-check ke AP Aging. Ada tombol Hentikan proses, Hapus file, dan Tutup panel.")

f("AI Financial Analyst nama menu analisis (Inggris): Profitability Analysis, Receivables Risk, Payables Risk, Cash Flow Analysis, Quarter Comparison, Anomaly Detection. Tombol cepat: Analyze receivables risk, Review payables risk, Explain cash flow, Compare quarters, Find unusual expenses. Indikator: Anomalies Detected, Total Variance, High Risk Items, Payment Risk Exposure, Bad Debt Exposure, Overdue AR, Due Soon.")

f("Transactions bagian umum: panel detail transaksi (Lihat detail transaksi, Edit transaksi, Tutup panel detail), filter dengan Reset Filter, ekspor Export CSV, Export PDF Report, Export GL Snapshot. Status jurnal: Balanced, Unbalanced, Partial, In Review, Voided. Pajak penjualan: VAT (PPN 11%) dan WHT (PPh 1%); pembelian: Input Tax (GST/VAT), VAT (PPN), WHT (PPh). Journal Entry KPI: Total Entries, Unbalanced Entries, Total Adjustments, Depreciation, Accruals.")


# =====================================================================
# Eksekusi
# =====================================================================
def periksa():
    masalah = []
    n3 = sum(1 for _, p in FAKTA if p == 3)
    if n3 > 6:
        masalah.append(f"penting=3 ada {n3}, tetapi hanya 6 yang selalu dimuat (MAKS_GLOBAL_SELALU)")
    for i, (isi, _) in enumerate(FAKTA, 1):
        if len(isi) > MAKS_PANJANG:
            masalah.append(f"fakta #{i} terlalu panjang ({len(isi)} > {MAKS_PANJANG}): {isi[:60]}...")
    return masalah


def main():
    ap = argparse.ArgumentParser(description="Isi ulang pengetahuan aplikasi (fakta global) untuk Neo.")
    ap.add_argument("--terapkan", action="store_true", help="tulis ke database (tanpa ini hanya pratinjau)")
    ap.add_argument("--pertahankan-lama", action="store_true", help="jangan nonaktifkan fakta global lama")
    args = ap.parse_args()

    masalah = periksa()
    print(f"{len(FAKTA)} fakta siap ({sum(1 for _, p in FAKTA if p == 3)} selalu-ikut, "
          f"{sum(len(i) for i, _ in FAKTA)} karakter total).")
    if masalah:
        print("MASALAH:")
        for m in masalah:
            print(" -", m)
        sys.exit(1)

    if not args.terapkan:
        for i, (isi, p) in enumerate(FAKTA, 1):
            print(f"[{i:02d}] (penting={p}) {isi}")
        print("\nPratinjau saja. Jalankan dengan --terapkan untuk menulis ke database.")
        return

    sys.path.append(str(Path(__file__).resolve().parent.parent))
    import memori_ai as mem
    import db_client as dbc

    mem.ensure_tabel()
    with dbc.SessionLocal() as s:
        T = mem.AiMemoriFakta
        # 1) buang hasil seed sebelumnya (supaya tidak dobel)
        hapus = s.query(T).filter(T.pemilik == mem.PEMILIK_GLOBAL, T.sumber == SUMBER_SEED).delete(synchronize_session=False)
        # 2) nonaktifkan fakta global lama (tetap tersimpan, aktif=False)
        nonaktif = 0
        if not args.pertahankan_lama:
            nonaktif = (
                s.query(T)
                .filter(T.pemilik == mem.PEMILIK_GLOBAL, T.aktif.is_(True), T.sumber != SUMBER_SEED)
                .update({T.aktif: False}, synchronize_session=False)
            )
        # 3) tulis fakta baru
        for isi, penting in FAKTA:
            s.add(T(pemilik=mem.PEMILIK_GLOBAL, isi=isi, kategori=KATEGORI, penting=penting, sumber=SUMBER_SEED, aktif=True))
        s.commit()
    mem._invalidate(mem.PEMILIK_GLOBAL)
    print(f"Selesai: {len(FAKTA)} fakta ditulis, {hapus} hasil seed lama diganti, {nonaktif} fakta global lama dinonaktifkan.")
    print("Cache server berumur 60 detik: tunggu semenit atau restart backend agar Neo langsung memakainya.")


if __name__ == "__main__":
    main()